resource "aws_secretsmanager_secret" "postgres_credentials" {
  name        = "${var.environment}/postgres/master-credentials"
  description = "RDS Postgres master credentials for the leaderboard service - replaces the DATABASE_URL .env placeholder used in local/Compose dev"
}

resource "aws_secretsmanager_secret_version" "postgres_credentials" {
  secret_id = aws_secretsmanager_secret.postgres_credentials.id
  secret_string = jsonencode({
    username = var.postgres_master_username
    password = random_password.postgres_master.result
    host     = aws_db_instance.postgres.address
    port     = aws_db_instance.postgres.port
    dbname   = var.postgres_database_name
  })
}

resource "random_password" "jwt_access_secret" {
  length  = 64
  special = false
}

resource "aws_secretsmanager_secret" "jwt_access_secret" {
  name        = "${var.environment}/app/jwt-access-secret"
  description = "JWT_ACCESS_SECRET for the leaderboard API - replaces the .env placeholder used in local/Compose dev"
}

resource "aws_secretsmanager_secret_version" "jwt_access_secret" {
  secret_id     = aws_secretsmanager_secret.jwt_access_secret.id
  secret_string = random_password.jwt_access_secret.result
}
