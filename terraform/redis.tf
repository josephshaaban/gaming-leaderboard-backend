resource "aws_elasticache_subnet_group" "this" {
  name       = "${var.environment}-redis-subnets"
  subnet_ids = aws_subnet.private[*].id
}

# transit_encryption_enabled = true means the app must connect over TLS
# (rediss://, plus ioredis's `tls: {}` client option). The current app code
# connects to Redis in plaintext, which is fine on the Compose network but
# not across a real VPC - that's an app-side follow-up, not a Terraform one,
# and is intentionally not silently glossed over here.
resource "aws_elasticache_replication_group" "redis" {
  replication_group_id       = "${var.environment}-redis"
  description                = "Leaderboard cache + pub/sub bus - disposable, rebuilt from Postgres on boot/cache-miss (see NOTES.md)"
  engine                     = "redis"
  engine_version             = var.redis_engine_version
  node_type                  = var.redis_node_type
  num_cache_clusters         = var.redis_num_cache_clusters
  automatic_failover_enabled = var.redis_num_cache_clusters > 1
  subnet_group_name          = aws_elasticache_subnet_group.this.name
  security_group_ids         = [aws_security_group.redis.id]
  at_rest_encryption_enabled = true
  transit_encryption_enabled = true

  tags = {
    Name = "${var.environment}-redis"
  }
}
