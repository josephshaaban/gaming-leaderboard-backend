output "vpc_id" {
  value = aws_vpc.this.id
}

output "private_subnet_ids" {
  value = aws_subnet.private[*].id
}

output "public_subnet_ids" {
  value = aws_subnet.public[*].id
}

output "postgres_endpoint" {
  description = "RDS Postgres connection endpoint (host:port)"
  value       = aws_db_instance.postgres.endpoint
}

output "postgres_secret_arn" {
  value = aws_secretsmanager_secret.postgres_credentials.arn
}

output "redis_primary_endpoint" {
  description = "ElastiCache Redis primary endpoint - use rediss:// since transit encryption is enabled"
  value       = aws_elasticache_replication_group.redis.primary_endpoint_address
}

output "jwt_secret_arn" {
  value = aws_secretsmanager_secret.jwt_access_secret.arn
}
