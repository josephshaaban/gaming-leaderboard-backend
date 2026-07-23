# 3. WebSocket Data Flow — Zoomed View

Shows how a local client connects (`WS /ws/leaderboard/:gameId`) and how a
`rank_update` event produced on one instance is delivered to clients
connected to *any* instance.

```mermaid
sequenceDiagram
    actor WSClient as WS Client
    participant Nginx
    participant Upg as httpServer 'upgrade' event<br/>(attach-ws-server.ts)
    participant Auth as authenticateUpgrade()<br/>(trust boundary — JWT + path)
    participant GS as GamesService
    participant Reg as ConnectionRegistry
    participant LS as LeaderboardService

    note over WSClient,Reg: Connect
    WSClient->>Nginx: GET /ws/leaderboard/:gameId?token=<JWT><br/>Upgrade: websocket
    Nginx->>Upg: proxy_pass (Upgrade/Connection headers preserved)
    Upg->>Auth: authenticateUpgrade(req, jwtService)
    Auth->>Auth: regex-match path -> gameId<br/>read ?token= query param<br/>jwtService.verifyAsync(token)
    alt invalid path
        Auth-->>Upg: throw WsAuthError(404)
        Upg->>WSClient: handleUpgrade() then ws.close(4404, "Unknown WebSocket path")
    else missing/invalid/expired token
        Auth-->>Upg: throw WsAuthError(401)
        Upg->>WSClient: handleUpgrade() then ws.close(4401, "Missing/invalid/expired token")
    else authenticated
        Auth-->>Upg: {gameId, userId}
        Upg->>GS: findByIdOrThrow(gameId)
        alt unknown gameId
            GS-->>Upg: throws
            Upg->>WSClient: handleUpgrade() then ws.close(4404, "Unknown gameId")
        else game exists
            Upg->>Upg: wss.handleUpgrade(req, socket, head)
            Upg->>Reg: register(gameId, ws)
            Upg->>LS: getTopN(gameId, 0, 10)
            LS-->>Upg: top-10 entries
            Upg->>WSClient: send {type: "snapshot", gameId, entries, generatedAt}
        end
    end
```

A close frame can only be sent from the WS `OPEN` state, so every rejection
path still completes `handleUpgrade()` before immediately calling
`ws.close(code, reason)` — the socket is never registered and never sent a
snapshot in the rejection cases; see `attach-ws-server.ts`.

```mermaid
sequenceDiagram
    participant ClientA as REST caller<br/>(hits instance A)
    participant MSA as api1: MatchesService
    participant PS as Redis pub/sub<br/>channel leaderboard-updates:{gameId}
    participant SubA as api1: RedisSubscriberService
    participant SubB as api2: RedisSubscriberService
    participant RegA as api1: ConnectionRegistry
    participant RegB as api2: ConnectionRegistry
    actor WSonA as WS client connected to api1
    actor WSonB as WS client connected to api2

    note over ClientA,WSonB: Produce & deliver — cross-instance fan-out
    ClientA->>MSA: POST /matches (handled by api1)
    MSA->>PS: PUBLISH leaderboard-updates:{gameId} rank_update JSON
    PS-->>SubA: pmessage (api1's own subscriber — same code path as every other instance)
    PS-->>SubB: pmessage
    SubA->>RegA: broadcast(gameId, message)
    SubB->>RegB: broadcast(gameId, message)
    RegA->>WSonA: ws.send(rank_update)
    RegB->>WSonB: ws.send(rank_update)
```

`MatchesService` never touches `ConnectionRegistry` directly — the instance
that received the HTTP write reaches its own local sockets through the exact
same Redis subscription path as every other instance, which is what makes
in-process-only broadcast structurally impossible to reintroduce by accident.

**Heartbeat / dead-connection cleanup:** `ConnectionRegistry.startHeartbeat()`
pings every open socket every 30s; a socket that didn't `pong` since the last
sweep is `terminate()`d and removed. `close`/`error` events also unregister
immediately, so a game with zero remaining sockets is dropped from the map.

**Graceful shutdown:** `SIGTERM`/`SIGINT` → `stopHeartbeat()` →
`closeAll()` (closes every socket with code `1001`) → drain → `app.close()`.

**Trust boundary:** JWT validation happens in `authenticateUpgrade()` before
`handleUpgrade()` is ever called for a legitimate connection — no
unauthenticated socket is ever registered or reaches business logic.
