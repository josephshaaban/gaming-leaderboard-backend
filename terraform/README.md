# Terraform (AWS) — bonus, not applied

Provisions the **data + networking layer** for a production deployment of
this service: a VPC (public + private subnets across 2 AZs), RDS for
PostgreSQL, ElastiCache for Redis, and Secrets Manager entries for the
credentials that are plain `.env` values in local/Compose dev.

This is a snippet demonstrating the direction, not applied infrastructure —
no `terraform apply` has been run, and this repo has no AWS account wired to
it. See [`../docs/production-gaps.md`](../docs/production-gaps.md) for the
full list of what's still missing beyond this snippet, and the root
[`README.md`](../README.md#production-architecture-aws) for how each piece
maps to the Docker Compose component it replaces.

## Deliberately out of scope

- **Compute (ECS Fargate + ALB)**: this snippet stops at the data layer.
  `var.app_security_group_ids` is where the compute layer's security group
  would be wired in once it exists — left empty by default, which means
  Postgres/Redis accept connections from nothing until that's populated.
- **NAT Gateway**: RDS and ElastiCache never need outbound internet access,
  so none is provisioned. Add one (or VPC endpoints for ECR/Secrets
  Manager, which avoid the recurring per-hour NAT cost) once ECS tasks land
  in the private subnets.
- **CI/CD wiring** (`terraform plan`/`apply` in a pipeline, a remote state
  backend): not set up — this is a local snippet, not a deployed pipeline.

## Cost-conscious defaults

- `postgres_multi_az = false`, `redis_num_cache_clusters = 1` — single-AZ
  by default. Flip these for real production uptime; both are called out
  as gaps in [`../docs/production-gaps.md`](../docs/production-gaps.md).
- Small instance classes (`db.t4g.micro` / `cache.t4g.micro`) are
  placeholders — size for real load before using these numbers.

## One note on Redis transit encryption

`transit_encryption_enabled = true` on the replication group means the app
would need to connect over TLS (`rediss://`, plus ioredis's `tls: {}`
client option). The current app code connects to Redis in plaintext — fine
on the Compose network, not across a real VPC. Wiring that up is an
app-side change, not a Terraform one — not done here, flagged so it isn't a
silent mismatch between this snippet and the running app.

## Validating without applying

No AWS credentials are needed for this — `terraform init` only downloads
providers, and `fmt`/`validate` are entirely local:

```bash
cd terraform
terraform init -backend=false
terraform fmt -check -recursive
terraform validate
```
