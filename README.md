# Dizzaract Real-Time Gaming Leaderboard Service

A real-time leaderboard backend: players submit match results over REST,
rankings are served from Redis Sorted Sets, and score changes are broadcast
to subscribed WebSocket clients via Redis pub/sub - so it fans out correctly
across multiple app instances, not just within one process.

See [`NOTES.md`](./NOTES.md) for the architecture write-up, design
decisions, and self-critique.

## Docs & diagrams

| File | What's in it |
|---|---|
| [`NOTES.md`](./NOTES.md) | Architecture write-up, design decisions, self-critique |
| [`docs/diagram-requirements.md`](./docs/diagram-requirements.md) | The diagram brief the files below were built against |
| [`docs/diagrams/01-system-architecture.md`](./docs/diagrams/01-system-architecture.md) | Runtime components - client entry points, NestJS boundary, REST/WS surfaces, DB storage, async processing - annotated with the AWS-equivalent for each |
| [`docs/diagrams/02-rest-data-flow.md`](./docs/diagrams/02-rest-data-flow.md) | Zoomed sequence flow for match submit and leaderboard retrieval |
| [`docs/diagrams/03-websocket-data-flow.md`](./docs/diagrams/03-websocket-data-flow.md) | Zoomed sequence flow for WS connect/auth and cross-instance Redis fan-out |
| [`docs/diagrams/04-polling-monitoring-data-flow.md`](./docs/diagrams/04-polling-monitoring-data-flow.md) | Zoomed flow for cache rehydration and health-check polling |
| [`docs/production-gaps.md`](./docs/production-gaps.md) | What's missing between this repo and a real AWS production deployment |
| [`docs/demo-run-output.txt`](./docs/demo-run-output.txt) | Raw terminal output of a real `demo.sh` run - replica fan-out evidence |

## Stack

TypeScript, NestJS, PostgreSQL (TypeORM migrations), Redis (Sorted Sets +
pub/sub), raw `ws`, Docker Compose, nginx.

## Quick start (Docker Compose)

```bash
cp .env.example .env
docker compose up --build
```

This starts, on a clean checkout:

- `postgres` (5432) and `redis` (6379)
- a one-shot `migrate` service that runs TypeORM migrations, then exits
- two API replicas, `api1` and `api2`
- `nginx` on host port **8080**, load-balancing across both replicas

Once everything is healthy, the API is reachable at `http://localhost:8080`.

To tear down: `docker compose down` (add `-v` to also drop the Postgres
volume - Redis intentionally has no volume, see NOTES.md).

## Local development (without Docker)

```bash
cp .env.example .env   # then point DATABASE_URL/REDIS_URL at local instances
npm install
npm run build && npm run migration:run
npm run start:dev
```

Requires a reachable Postgres and Redis - the simplest way to get those
without running the whole app in Docker is:

```bash
docker compose up postgres redis -d
```

## API

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/auth/signup` | public | Create an account, returns access + refresh tokens |
| POST | `/auth/login` | public | Returns access + refresh tokens |
| POST | `/auth/refresh` | public | Rotates a refresh token for a new pair |
| GET | `/games` | public | List games |
| POST | `/games` | required | Create a game |
| POST | `/matches` | required | Submit a match result for the caller |
| GET | `/leaderboard/:gameId` | public | Top-N leaderboard (`?offset=&limit=`) |
| GET | `/leaderboard/:gameId/rank/:playerId` | public | A single player's rank + score |
| GET | `/health` | public | Status, uptime, replica hostname |
| WS | `/ws/leaderboard/:gameId?token=<accessToken>` | required | Live snapshot + rank-update stream |

Send the JWT access token as a Bearer token on REST calls, and as a `token`
query parameter on the WebSocket URL (see NOTES.md for why).

## Tests

```bash
npm test           # unit tests (mocked Redis/Postgres - no infra required)
npm run test:e2e   # includes the cross-instance Redis pub/sub fan-out proof,
                    # needs a real reachable Redis at REDIS_URL
npm run lint
npm run typecheck
```

## Demo

See [`demo.sh`](./demo.sh) for a scripted walkthrough (signup, login, create
a game, submit a match, and watch two separate WebSocket connections - one
against each replica - both receive the broadcast).

## Production architecture (AWS)

This repo runs on Docker Compose for the take-home. The topology was
deliberately chosen so it points at a real AWS deployment without a
rewrite - stateless app containers, a disposable cache, Postgres as the
only source of truth. The full annotated diagram is
[`docs/diagrams/01-system-architecture.md`](./docs/diagrams/01-system-architecture.md);
summary mapping:

| Local (Docker Compose) | AWS production equivalent |
|---|---|
| `nginx` reverse proxy | Application Load Balancer, WS-aware target group |
| `api1` / `api2` NestJS containers | ECS Fargate service, `desiredCount >= 2`, autoscaled |
| `postgres` container + named volume | RDS for PostgreSQL, Multi-AZ, encrypted storage |
| `redis` container (no volume) | ElastiCache for Redis - still fine to run without durable persistence, it's a rebuildable cache |
| one-shot `migrate` service | One-shot ECS task run as a release-pipeline step, not on API boot |
| Docker healthcheck polling `GET /health` | ALB target-group health check + CloudWatch alarm on unhealthy-host count |
| `.env` file | Secrets Manager / SSM Parameter Store, injected into the task definition |

None of this is provisioned - there's no Terraform/CDK in this repo (that
was an optional bonus, explicitly skipped, see NOTES.md). See
[`docs/production-gaps.md`](./docs/production-gaps.md) for the concrete list
of what's missing to actually get from this table to a running AWS
deployment.

## Data governance notes

What's stored and how:

- **PII inventory**: `users.email` is the only PII field in the schema.
  Passwords are argon2-hashed and refresh tokens are SHA-256-hashed before
  storage - neither is ever persisted or logged in plaintext.
- **Leaderboard payloads don't leak PII**: REST/WS leaderboard responses
  only ever expose a player's UUID (`playerId`), never `email` - other
  players never see any PII through the real-time or REST surface.
- **Erasure is structurally possible, not exposed**: there's no
  "delete my account" endpoint, but `refresh_tokens.user_id` and
  `matches.player_id` are both `ON DELETE CASCADE` to `users`, so a user
  delete would already cascade through tokens and match history at the DB
  level if that endpoint existed.
- **No retention policy**: user rows and match rows are kept indefinitely -
  nothing expires or archives them.
- **Known logging gap found while writing this section**: `nestjs-pino`'s
  default HTTP request logger (`app.module.ts`) logs the full request URL,
  including the query string, with no `redact` rule configured. Since the WS
  handshake carries the access token as `?token=<JWT>`
  (see "WebSocket auth decision" in [`NOTES.md`](./NOTES.md)), every WS
  upgrade request currently writes a live JWT to stdout logs verbatim. This
  compounds the token-in-URL trade-off already documented in NOTES.md and
  should be fixed with a pino `redact` rule before logs are shipped anywhere
  persistent.
- **Secrets are plain env vars today**: `JWT_ACCESS_SECRET` and
  `POSTGRES_PASSWORD` come from `.env` (dev placeholders in
  `.env.example`) - fine for local/CI, not appropriate for a real
  deployment. See [`docs/production-gaps.md`](./docs/production-gaps.md).

## Known gaps

- WS auth is checked once at connect time; a token expiring mid-session does
  not force a disconnect.
- No RBAC, OAuth2, cursor pagination, score history, presence events, rate
  limiting, or bonus items (Terraform/K8s/Prometheus/load test/dedupe) -
  skipped deliberately, see [`NOTES.md`](./NOTES.md).
