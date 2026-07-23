# 2. REST Data Flow — Zoomed View

Maps the required "upload, extraction, persistence, retrieval" flow onto this
project's actual REST surface: **match submission** (upload) and
**leaderboard read** (retrieval), the two REST paths that touch persistence.

```mermaid
sequenceDiagram
    actor Client
    participant Guard as JwtAuthGuard<br/>(trust boundary)
    participant VPipe as ValidationPipe<br/>(class-validator DTO)
    participant MC as MatchesController
    participant MS as MatchesService<br/>(business logic)
    participant GS as GamesService
    participant LS as LeaderboardService
    participant PG as PostgreSQL<br/>(persistence, source of truth)
    participant R as Redis ZSET<br/>(cache)
    participant PS as Redis pub/sub

    rect rgb(235, 245, 255)
    note over Client,PS: Submit (upload) — POST /matches
    Client->>Guard: POST /matches {gameId, playerId, score}<br/>Authorization: Bearer <JWT>
    Guard-->>Client: 401 if missing/invalid/expired JWT
    Guard->>VPipe: authenticated request
    VPipe-->>Client: 400 structured error if DTO invalid
    VPipe->>MC: validated SubmitMatchDto
    MC->>MS: submitMatch(gameId, playerId, score)
    MS->>GS: findByIdOrThrow(gameId)
    GS-->>MS: 404 if game unknown (fails before touching DB writes)
    MS->>LS: ensureCache(gameId) — best-effort rehydrate if ZSET missing
    LS->>PG: SUM(score) GROUP BY playerId (only on cache miss)
    LS->>R: pipeline DEL + ZADD per player
    MS->>PG: INSERT match (gameId, playerId, score, ts)<br/>— unconditional, this is the durability guarantee
    PG-->>MS: match row
    MS->>LS: recordScoreDelta(gameId, playerId, score)
    LS->>R: ZSCORE / ZREVRANK (previous) then ZINCRBY then ZREVRANK (new)
    R-->>LS: previousRank/newRank/previousScore/newScore<br/>(extraction: turns the raw write into a rank diff)
    LS-->>MS: ScoreUpdateResult (or null if Redis is down — non-fatal)
    MS->>LS: getTopN(gameId, 0, 10)
    LS-->>MS: top-10 snapshot
    MS->>PS: PUBLISH leaderboard-updates:{gameId} rank_update JSON<br/>(async hand-off — see WebSocket diagram for delivery)
    MS-->>MC: Match
    MC-->>Client: 201 Created
    end

    rect rgb(240, 255, 240)
    note over Client,R: Retrieve — GET /leaderboard/:gameId
    Client->>Guard: GET /leaderboard/:gameId?offset=&limit=
    Guard->>MC: authenticated request
    MC->>LS: getTopN(gameId, offset, limit)
    LS->>PG: assertGameExists(gameId)
    PG-->>LS: 404 if missing
    LS->>R: EXISTS leaderboard:{gameId}
    alt cache hit
        LS->>R: ZREVRANGE WITHSCORES
    else cache miss
        LS->>PG: rehydrate — SUM(score) GROUP BY playerId
        LS->>R: pipeline DEL + ZADD per player
        LS->>R: ZREVRANGE WITHSCORES
    end
    R-->>LS: ranked entries
    LS-->>MC: LeaderboardEntry[]
    MC-->>Client: 200 OK — paginated top-N
    end
```

**Where validation happens:** global `ValidationPipe` (`whitelist` +
`forbidNonWhitelisted` + `transform`) at the controller boundary, before any
service method runs.

**Where business logic happens:** `MatchesService`/`LeaderboardService` —
game-existence checks, cache-miss rehydration ordering (cache is warmed
*before* the Postgres write to avoid double-counting), rank-diff computation.

**Where persistence happens:** `MatchesRepository`/TypeORM against Postgres
only; Redis is never the write-of-record.

**Where asynchronous behavior exists:** the `PUBLISH` at the end of submit is
fire-and-forget from the REST request's perspective — the HTTP response does
not wait for any WebSocket client to receive the update.
