# Production Gaps (AWS)

This repo is a Docker Compose take-home deliverable, not a deployed AWS
system. The architecture is already shaped to map onto AWS cleanly (see
[`diagrams/01-system-architecture.md`](./diagrams/01-system-architecture.md)
and the README's "Production architecture (AWS)" section) - stateless app
containers, Redis as a disposable cache, Postgres as the sole source of
truth. What follows is what's actually missing to turn that mapping into a
running production deployment. **Yes, there are real gaps** - nothing below
is invented for completeness; every item is either unimplemented in this
repo or a genuine risk if deployed as-is.

## Secrets & credentials

- `JWT_ACCESS_SECRET`, `POSTGRES_PASSWORD`, `DATABASE_URL` are plain
  environment variables sourced from a `.env` file (`.env.example` ships
  dev placeholders). Production needs these in Secrets Manager or SSM
  Parameter Store (`SecureString`), injected into the ECS task definition
  at deploy time - never baked into the image or committed.
- `JWT_ACCESS_SECRET` has no rotation mechanism. A leaked secret currently
  invalidates every issued token with no graceful rollover - there's no
  `kid`/multi-key verification to rotate without a hard cutover.

## Transport security

- `nginx` terminates plain HTTP on port 8080; there is no TLS anywhere in
  the stack, so the assignment's own `wss://` recommendation for production
  isn't met. Needs an ACM certificate + an HTTPS listener on the ALB (with
  an HTTP→HTTPS redirect); traffic from the ALB to the ECS tasks can stay
  plain HTTP inside the VPC.

## Data at rest & durability

- The local Postgres volume is unencrypted. RDS storage encryption (KMS)
  must be enabled **at creation** - it can't be turned on for an existing
  unencrypted instance without a snapshot/restore cycle.
- No backup strategy exists in Compose (`docker volume rm` is total data
  loss). RDS automated backups + point-in-time recovery need an explicit
  retention window configured.
- Single Postgres container, single Redis container - no failover. RDS
  should run Multi-AZ; ElastiCache should have at least one replica in a
  second AZ (Redis here can stay non-persistent/cluster-mode-disabled,
  since the leaderboard is designed to be rebuilt from Postgres - that part
  of the design is already production-appropriate).

## Scaling

- `api1`/`api2` are two fixed named Compose services, not an autoscaling
  group. Production needs ECS Service auto scaling (target tracking on CPU
  or active-connection count) instead of a hardcoded replica count.
- No connection-pooling proxy (e.g. RDS Proxy) in front of Postgres - at
  higher replica counts, each task's own TypeORM pool adds up quickly
  against RDS's max-connections ceiling.

## Observability

- Structured JSON logs (`nestjs-pino`) exist but ship nowhere - no
  CloudWatch Logs integration, no metrics, no distributed tracing (X-Ray).
- No dashboards or alarms beyond the basic `/health` poll. The Prometheus
  `/metrics` bonus (active-connection + match-throughput counters) was
  explicitly skipped - see `NOTES.md`.
- **Logging gap** (also called out in the README's Data Governance
  section): `nestjs-pino`'s default request logger writes the full request
  URL, including query strings, with no `redact` rule. The WS handshake
  carries `?token=<JWT>` - every upgrade request currently logs a live
  access token verbatim. Needs a `redact` rule (or a transport-layer change
  for WS auth) before logs are shipped anywhere persistent.

## Network & edge protection

- Compose runs everything on one flat Docker network - no VPC subnet
  segmentation (public ALB subnet vs. private app subnet vs. isolated DB
  subnet) and no least-privilege security groups.
- No AWS WAF in front of the ALB - no rate limiting, IP reputation, or bot
  control.
- No application-level rate limiting either - the Redis-token-bucket rate
  limiting nice-to-have on `POST /matches` was explicitly skipped (see
  `NOTES.md`). This is a real gap for a public-facing endpoint: nothing
  stops score-spam or credential-stuffing against `/auth/login` today.

## Deployment pipeline

- `.github/workflows/ci.yml` builds and tests the Docker image but doesn't
  publish or deploy it - no ECR push step, no ECS deploy step. Getting from
  a green CI run to a running AWS environment is entirely manual today.
- No infrastructure-as-code exists (Terraform/CDK was an optional bonus,
  explicitly skipped) - the AWS column in the architecture diagram is a
  target, not provisioned infrastructure.
- The one-shot `migrate` Compose service relies on
  `depends_on: service_completed_successfully`, a Compose-only primitive.
  ECS has no equivalent - production needs an explicit one-shot migration
  task as a release-pipeline gate (or a migration lock), otherwise a
  rolling ECS deploy could race two tasks running migrations concurrently.

## What's already production-shaped (not a gap)

Worth noting explicitly, since not everything here is missing:

- No ALB sticky-session configuration is needed - all real-time state lives
  in Redis pub/sub, not in-process, so round-robin across replicas already
  works correctly. This was a deliberate design choice, not an oversight.
- Redis can be lost entirely without losing the leaderboard (rehydrates
  from Postgres) - the "cache is disposable" property production
  architectures usually have to retrofit is already true here by design.
