# 4. Polling & Monitoring Data Flow — Zoomed View

> **Interpretation note:** this required view is written for a
> document/news-monitoring domain ("monitored data queried, normalized,
> stored, deduplicated, turned into alert events") that this project doesn't
> have — there is no third-party external source being polled here. This is
> the loosest-fitting mapping of the four required views; per the chosen
> approach it's force-fit onto the closest real equivalents actually built:
> **(a)** the Redis cache-rehydration path, which is a genuine
> query → normalize → store → dedupe pipeline, just sourced from this
> service's own Postgres rather than an external feed, and **(b)** the
> health-check poll loop, which is the genuine "monitoring → alert" surface
> in this system.

## (a) Cache rehydration — the "query, normalize, store, dedupe" pipeline

```mermaid
flowchart LR
    T1["Trigger: app boot\nmain.ts -> rehydrateAll()"] --> Q
    T2["Trigger: cache miss on read/write\nensureCache() from getTopN /\ngetRank / submitMatch"] --> Q

    Q["Query\nPostgres: SELECT playerId, SUM(score)\nFROM matches WHERE gameId = :id\nGROUP BY playerId"] --> N

    N["Normalize\nraw rows -> {playerId, total}\n(this is the 'extraction' step —\ncumulative score per player)"] --> S

    S["Store\nRedis pipeline:\nDEL leaderboard:{gameId}\nZADD leaderboard:{gameId} total playerId\n(per row)"] --> D

    D["Dedupe\nstructural, not a separate step:\nZSET member = playerId, so re-adding\nthe same player overwrites the score —\nno duplicate leaderboard entries possible"] --> R

    R[("Redis ZSET\nleaderboard:{gameId}\nready for reads / next broadcast")]
```

Note the ordering guarantee documented in `LeaderboardService.ensureCache`:
it is always called **before** the new match row is written to Postgres, so a
cache-miss rehydrate can never re-aggregate a row that a subsequent
`ZINCRBY` would then double-count.

## (b) Health monitoring — the "turned into alert events" step

```mermaid
sequenceDiagram
    participant Poller as Docker healthcheck loop<br/>(every 5s, interval/timeout/retries in docker-compose.yml)<br/>[AWS: ALB target-group health check]
    participant HC as HealthController.check()
    participant PG as PostgreSQL
    participant R as Redis
    participant Orch as Container orchestrator
    participant Alert as Alerting<br/>[AWS: CloudWatch alarm -> SNS]

    loop every 5s, per replica
        Poller->>HC: GET /health
        HC->>PG: SELECT 1
        HC->>R: PING
        PG-->>HC: ok / error
        R-->>HC: ok / error
        HC-->>Poller: {status: ok|degraded, uptimeSeconds, replica: hostname(), postgres, redis}
        alt status == ok, N consecutive successes
            Poller->>Orch: mark replica healthy
        else status == degraded / unreachable, N consecutive failures
            Poller->>Orch: mark replica unhealthy
            Orch->>Orch: stop routing traffic to it / restart per policy
            Orch->>Alert: unhealthy-target event<br/>(not implemented in this repo —<br/>production recommendation only)
        end
    end
```

**Where this differs from a real monitoring pipeline:** in this project the
"alert event" is only ever a Docker Compose restart decision (or, in the AWS
production target, an ALB target-group state change) — there is no
persisted alert history, dedupe window, or paging integration, since nothing
in the assignment's actual scope calls for one. A genuine alerting/dedup
layer (e.g. CloudWatch alarm → SNS → on-call) is listed as the production
recommendation, not something this repo implements.
