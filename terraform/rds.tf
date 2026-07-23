resource "random_password" "postgres_master" {
  length           = 32
  special          = true
  override_special = "!#$%&*()-_=+[]{}<>:?"
}

resource "aws_db_subnet_group" "this" {
  name       = "${var.environment}-postgres-subnets"
  subnet_ids = aws_subnet.private[*].id

  tags = {
    Name = "${var.environment}-postgres-subnets"
  }
}

resource "aws_db_instance" "postgres" {
  identifier     = "${var.environment}-postgres"
  engine         = "postgres"
  engine_version = var.postgres_engine_version

  instance_class    = var.postgres_instance_class
  allocated_storage = var.postgres_allocated_storage_gb
  storage_type      = "gp3"
  storage_encrypted = true

  db_name  = var.postgres_database_name
  username = var.postgres_master_username
  password = random_password.postgres_master.result

  db_subnet_group_name   = aws_db_subnet_group.this.name
  vpc_security_group_ids = [aws_security_group.postgres.id]
  publicly_accessible    = false

  multi_az = var.postgres_multi_az

  backup_retention_period   = 7
  deletion_protection       = true
  skip_final_snapshot       = false
  final_snapshot_identifier = "${var.environment}-postgres-final"

  tags = {
    Name = "${var.environment}-postgres"
  }
}
