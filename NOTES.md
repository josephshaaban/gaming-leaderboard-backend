# NOTES

## Architecture overview

Layered per module: **Controller → Service → Repository**. Redis and
Postgres access is confined to services/repositories; controllers hold no
business logic.

```
src/
  auth/          signup/login/refresh, argon2 hashing, JWT strategy/guard
  users/, games/, matches/   standard REST CRUD over TypeORM
  leaderboard/   Redis ZSET reads + Postgres rehydration (the cache layer)
  websocket/     raw `ws` upgrade handler, connection registry, Redis
                 subscriber - the real-time fan-out mechanism
  redis/         global module: one command client, one subscriber client
  database/      TypeORM DataSource + migrations
```

**Write path** (`POST /matches`): validate the game exists → save the match
row to Postgres (unconditional, source of truth) → update the Redis ZSET
(`ZINCRBY`) and compute before/after rank → publish a `rank_update` message
to `leaderboard-updates:{gameId}`. The Redis steps are wrapped in try/catch:
if Redis is down, the match is still durably recorded, and the leaderboard
self-heals via rehydration on the next read - it never crashes the request.

**Read path** (`GET /leaderboard/:gameId`, `/rank/:playerId`): always reads
from the Redis ZSET, never Postgres, on the request path. If the key is
missing (`EXISTS` check), it's lazily rebuilt from Postgres first.

**Real-time path**: `MatchesService` never touches a WebSocket directly - it
only ever publishes to Redis. Every app instance (including the one that
received the original REST call) runs the same `RedisSubscriberService`,
`PSUBSCRIBE`d to `leaderboard-updates:*`, and delivers to its own local
sockets through the same `ConnectionRegistry.broadcast()` call. There is no
special-cased "local" delivery path, which makes it structurally hard to
accidentally reintroduce in-process-only broadcast.

## WebSocket auth decision

Token passed as a **query parameter** (`?token=<accessJWT>`) on the
`WS /ws/leaderboard/:gameId` upgrade request, verified in
`ws-auth.util.ts`. An invalid/expired token or unknown `gameId` completes
the WS opening handshake (a close frame can only be sent from the `OPEN`
state - there is no way to emit one without it) and is then immediately
closed with an application-specific WS close code - `4401` for missing/
invalid/expired token, `4404` for an unknown WS path or unknown `gameId` -
before ever being registered with the connection registry or sent a
snapshot. This satisfies "reject invalid/expired JWT with a correct WS
close code" literally, rather than only rejecting at the HTTP-upgrade
layer with a plain status code.

Considered alternatives:
- **Subprotocol** (`Sec-WebSocket-Protocol`): avoids the token appearing in
  URLs/logs, but many proxies and browser WebSocket clients handle
  subprotocol negotiation inconsistently, and it doesn't materially change
  where the token is exposed (still visible in browser dev tools / any
  proxy access log unless subprotocol traffic itself is excluded from
  logging, which nginx does by default anyway for headers not URLs).
- **First-message handshake**: requires accepting an unauthenticated socket
  before validating it, which means a bigger attack surface (need a timeout
  to drop clients that never send an auth frame, and the server does
  connection-accounting work before it knows the client is legitimate).

Query param was chosen for uniform behavior across browsers, `websocat`,
and automated tests, and because rejecting at the HTTP-upgrade layer (before
any WS frame exchange) is the cleanest place to enforce auth. Trade-off:
the token can appear in nginx access logs and browser history. Mitigated by
a short 15-minute access-token TTL. **Known limitation**: auth is only
checked at connect time - a token that expires mid-session doesn't force a
disconnect (see "What's next").

## Redis strategy

- **ZSET** `leaderboard:{gameId}`: member = `playerId`, score = cumulative
  score. `ZINCRBY` on submit; `ZREVRANGE`/`ZREVRANK`/`ZSCORE` on read.
- **Pub/sub** `leaderboard-updates:{gameId}`: every instance subscribes with
  a single `PSUBSCRIBE leaderboard-updates:*` rather than per-game dynamic
  subscribe/unsubscribe - simpler for this scope, at the cost of some
  pub/sub traffic reaching instances with no local subscribers for that
  particular game (negligible at this scale, and a very small refactor to
  do it precisely later if load ever justified it).
- **Postgres is truth, Redis is a disposable cache**: every game's ZSET is
  rebuilt from a Postgres `SUM(score) GROUP BY player_id` aggregate (a) on
  app startup, and (b) lazily on cache-miss at read time. The `redis`
  Compose service deliberately has **no volume** - the system is meant to
  prove it survives a full Redis wipe, not just claim to.
- Every Redis call on the write/read path is try/catch-wrapped; failures
  are logged and degrade gracefully rather than throwing, satisfying "a
  Redis failure must not crash the WebSocket connection."

## Refresh token strategy (an ambiguity worth flagging)

The assignment doesn't specify refresh-token storage mechanics. Chosen: an
opaque random token (not a JWT), SHA-256-hashed at rest in
`refresh_tokens`, **rotated on every use**, with **reuse detection** - if an
already-rotated-away token is presented again, the entire token family for
that user is revoked (treated as a stolen-token signal). A stateless JWT
refresh token was rejected because making it revocable would require
tracking state anyway, at which point an opaque token is simpler and more
conventional.

## Other ambiguities resolved

- **Rank-diff scope**: broadcasts only the submitting player's own
  before/after rank + score, plus a fresh top-10 snapshot - not a full-board
  "who else moved" diff, which would be an O(N) computation per submission
  disproportionate to this scope.
- **Pagination**: offset/limit, not cursor-based (listed as a nice-to-have).
- **`playerId` on `POST /matches`**: always the authenticated caller's own
  JWT `sub`, never taken from the request body - otherwise any player could
  submit scores on another player's behalf. (A real system might instead
  trust a game server to report on a player's behalf; out of scope here.)
- No leaderboard "reset"/season semantics exist anywhere in the spec, so
  none are implemented.

## What's skipped, and why

Per the assignment's own "scope honestly" guidance, every *nice to have*
and *bonus* item is skipped in favor of a solid, well-tested core:

- **Nice-to-haves skipped**: role-based access (a `role` column exists on
  `User` but isn't enforced anywhere), OAuth2, cursor-based pagination,
  per-player score history, presence events, Redis-token-bucket rate
  limiting.
- **Bonuses skipped (all of them - zero picked)**: load test, Prometheus
  `/metrics`, Terraform snippet, message dedupe via client-supplied
  `match_id`. Time was reinvested into resilience (try/catch around every
  Redis call), the rehydration-on-miss mechanism, and the cross-instance
  fan-out test instead.

## Self-critique / what's next

- WS auth isn't re-checked mid-session - a natural next step is a periodic
  re-validation or a short-lived per-connection expiry timer that closes
  with code `4401`.
- The pub/sub subscriber uses one broad `PSUBSCRIBE leaderboard-updates:*`
  per instance rather than subscribing only to games with active local
  connections; fine at this scale, wasteful at a much larger one.
- Rehydration-on-miss has a benign race: concurrent cache-miss requests for
  the same game could redundantly rebuild the same ZSET. Idempotent and
  cheap, so accepted rather than adding a distributed lock.
- No integration test exercises the full HTTP → Postgres → Redis → WS
  chain in-process (only the Redis pub/sub mechanism itself is tested in
  isolation, plus unit tests for the write path and JWT validation) - the
  full chain is instead demonstrated manually via `demo.sh` against real
  Docker containers, per the assignment's guidance that full coverage isn't
  expected.
- Given more time: add the periodic WS re-auth above, and pick one bonus
  (a small `k6` load test showing fan-out throughput would be the most
  informative given the assignment's weighting).
