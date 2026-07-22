#!/usr/bin/env bash
# Demo: sign up, login, create a game, submit a match, and show that TWO
# separate WebSocket connections - one to api1, one to api2 - both receive
# the same rank_update broadcast, proving cross-instance Redis pub/sub
# fan-out. Requires `docker compose up` to be running, and `websocat`
# installed (https://github.com/vi/websocat) for the WebSocket legs.
set -euo pipefail

BASE_URL="http://localhost:8080"
API1_WS="ws://localhost:3001"
API2_WS="ws://localhost:3002"
EMAIL="demo-$(date +%s)@example.com"
PASSWORD="demo-password-123"

json_get() {
  node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d)$1))"
}

echo "==> Signing up as $EMAIL"
SIGNUP_RESPONSE=$(curl -sf -X POST "$BASE_URL/auth/signup" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")
ACCESS_TOKEN=$(echo "$SIGNUP_RESPONSE" | json_get ".accessToken")
echo "    got access token: ${ACCESS_TOKEN:0:20}..."

echo "==> Creating a game"
GAME_RESPONSE=$(curl -sf -X POST "$BASE_URL/games" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name":"demo-game-'"$(date +%s)"'"}')
GAME_ID=$(echo "$GAME_RESPONSE" | json_get ".id")
echo "    gameId: $GAME_ID"

if ! command -v websocat >/dev/null 2>&1; then
  echo ""
  echo "websocat not found - skipping the live WebSocket fan-out demo."
  echo "Install it (https://github.com/vi/websocat) and re-run to see both"
  echo "replicas receive the broadcast. Falling back to a REST-only demo:"
  echo ""
  echo "==> Submitting a match (score=100)"
  curl -sf -X POST "$BASE_URL/matches" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H 'Content-Type: application/json' \
    -d "{\"gameId\":\"$GAME_ID\",\"score\":100}" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.stringify(JSON.parse(d),null,2)))"
  echo ""
  echo "==> Top-N leaderboard for this game"
  curl -sf "$BASE_URL/leaderboard/$GAME_ID" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.stringify(JSON.parse(d),null,2)))"
  exit 0
fi

OUT1=$(mktemp)
OUT2=$(mktemp)

echo "==> Connecting to api1 directly ($API1_WS)"
websocat "$API1_WS/ws/leaderboard/$GAME_ID?token=$ACCESS_TOKEN" > "$OUT1" 2>&1 &
WS1_PID=$!

echo "==> Connecting to api2 directly ($API2_WS)"
websocat "$API2_WS/ws/leaderboard/$GAME_ID?token=$ACCESS_TOKEN" > "$OUT2" 2>&1 &
WS2_PID=$!

sleep 1

echo "==> Submitting a match (score=100) via nginx"
curl -sf -X POST "$BASE_URL/matches" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"gameId\":\"$GAME_ID\",\"score\":100}" >/dev/null

sleep 2
kill "$WS1_PID" "$WS2_PID" 2>/dev/null || true

echo ""
echo "==> Messages received by the client connected to api1:"
cat "$OUT1"
echo ""
echo "==> Messages received by the client connected to api2:"
cat "$OUT2"
echo ""
echo "If both show a 'snapshot' followed by a 'rank_update' for matchId"
echo "above, the match submitted through nginx (which could have landed on"
echo "either replica) fanned out via Redis pub/sub to BOTH replicas' local"
echo "WebSocket connections - the core requirement of this assignment."

rm -f "$OUT1" "$OUT2"
