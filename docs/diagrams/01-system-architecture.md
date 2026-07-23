# 1. System Architecture View

> **Domain-mapping note:** `docs/diagram-requirements.md` is a generic template
> (it references document upload/extraction and an external news-monitoring
> source) that does not describe this project. This service is the
> Real-Time Gaming Leaderboard from the assignment PDF. The diagrams below
> map every required "view" onto the closest real equivalent actually built
> here, called out explicitly wherever the fit is loose - see the note at
> the top of [`04-polling-monitoring-data-flow.md`](./04-polling-monitoring-data-flow.md)
> for the biggest stretch (there is no third-party external source in this
> domain; Postgres plays that role for the rehydration flow).

This is the "as built" topology (`docker-compose.yml`), annotated with the
AWS-equivalent managed service each box would become in a production
deployment, since the project runs on plain Docker Compose rather than AWS.

```mermaid
flowchart TB
    subgraph clients["Client / Caller Entry Points"]
        REST_CLIENT["REST client\n(browser / curl / Postman)"]
        WS_CLIENT["WebSocket client\n(browser / websocat)"]
    end

    subgraph edge["Edge — trust boundary"]
        NGINX["nginx reverse proxy\nround-robin upstream\n(AWS: Application Load Balancer)"]
    end

    subgraph compute["NestJS service boundary — 2 replicas (AWS: ECS Fargate service, desiredCount=2)"]
        direction TB
        subgraph api1["api1 (container)"]
            direction TB
            REST1["REST controllers\nauth / games / matches / leaderboard / health"]
            WS1["WS upgrade handler\n+ ConnectionRegistry"]
            SUB1["RedisSubscriberService\nPSUBSCRIBE leaderboard-updates:*"]
        end
        subgraph api2["api2 (container)"]
            direction TB
            REST2["REST controllers"]
            WS2["WS upgrade handler\n+ ConnectionRegistry"]
            SUB2["RedisSubscriberService"]
        end
    end

    subgraph async["Background / async processing"]
        MIGRATE["migrate (one-shot job)\nTypeORM migration:run"]
        BOOT["Startup rehydration\nLeaderboardService.rehydrateAll()"]
        PUBSUB["Redis pub/sub\nchannel: leaderboard-updates:{gameId}"]
    end

    subgraph storage["DB Storage"]
        PG[("PostgreSQL\nsource of truth\nusers, refresh_tokens, games, matches\n(AWS: RDS for PostgreSQL)")]
        REDIS[("Redis\nZSET cache: leaderboard:{gameId}\npub/sub bus, no volume — disposable\n(AWS: ElastiCache for Redis)")]
    end

    subgraph monitor["Polling / Monitoring"]
        HC["Docker healthcheck\npolls GET /health every 5s\n(AWS: ALB target-group health check\n+ CloudWatch alarms)"]
    end

    REST_CLIENT -- "HTTP" --> NGINX
    WS_CLIENT -- "WS upgrade + Bearer JWT (?token=)" --> NGINX
    NGINX -- "round robin" --> REST1
    NGINX -- "round robin" --> REST2
    NGINX -. "Upgrade/Connection headers" .-> WS1
    NGINX -. "Upgrade/Connection headers" .-> WS2

    REST1 --> PG
    REST2 --> PG
    REST1 --> REDIS
    REST2 --> REDIS

    SUB1 -. subscribes .-> PUBSUB
    SUB2 -. subscribes .-> PUBSUB
    REST1 -. "PUBLISH on match submit" .-> PUBSUB
    REST2 -. "PUBLISH on match submit" .-> PUBSUB
    PUBSUB -. "pmessage" .-> SUB1
    PUBSUB -. "pmessage" .-> SUB2
    SUB1 --> WS1
    SUB2 --> WS2
    WS1 -. "push rank_update" .-> WS_CLIENT
    WS2 -. "push rank_update" .-> WS_CLIENT

    MIGRATE --> PG
    BOOT -- "aggregate & rebuild ZSETs" --> PG
    BOOT --> REDIS

    HC -.-> REST1
    HC -.-> REST2
```

**Trust boundaries:** the edge (nginx) is the only public entry point;
everything behind it (api1/api2, Postgres, Redis) is on a private Docker
network with no direct external ports needed in production (the demo compose
file exposes `3001`/`3002` directly only so the demo script can address a
specific replica). JWT validation happens at the REST `JwtAuthGuard` and at
the WS `upgrade` handler — both before any business logic runs.

**Validation:** `class-validator`/`class-transformer` DTOs at every REST
controller boundary (global `ValidationPipe`).

**Business logic:** service layer only (`MatchesService`, `LeaderboardService`,
`AuthService`, `GamesService`) — controllers stay thin.

**Persistence:** Postgres via TypeORM repositories is the only source of
truth; Redis is a rebuildable cache.

**Asynchronous behavior:** Redis pub/sub fan-out (decouples the instance that
received the HTTP write from every instance holding a live WS connection),
the one-shot `migrate` job, and boot-time cache rehydration.
