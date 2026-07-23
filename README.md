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

## Known gaps

- WS auth is checked once at connect time; a token expiring mid-session does
  not force a disconnect.
- No RBAC, OAuth2, cursor pagination, score history, presence events, rate
  limiting, or bonus items (Terraform/K8s/Prometheus/load test/dedupe) -
  skipped deliberately, see NOTES.md.
