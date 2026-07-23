resource "aws_security_group" "postgres" {
  name        = "${var.environment}-postgres-sg"
  description = "Allows Postgres access from the app layer only"
  vpc_id      = aws_vpc.this.id

  tags = {
    Name = "${var.environment}-postgres-sg"
  }
}

resource "aws_security_group_rule" "postgres_ingress" {
  count                    = length(var.app_security_group_ids)
  type                     = "ingress"
  from_port                = 5432
  to_port                  = 5432
  protocol                 = "tcp"
  security_group_id        = aws_security_group.postgres.id
  source_security_group_id = var.app_security_group_ids[count.index]
  description               = "Postgres from app security group ${var.app_security_group_ids[count.index]}"
}

resource "aws_security_group_rule" "postgres_egress" {
  type              = "egress"
  from_port         = 0
  to_port           = 0
  protocol          = "-1"
  security_group_id = aws_security_group.postgres.id
  cidr_blocks       = ["0.0.0.0/0"]
}

resource "aws_security_group" "redis" {
  name        = "${var.environment}-redis-sg"
  description = "Allows Redis access from the app layer only"
  vpc_id      = aws_vpc.this.id

  tags = {
    Name = "${var.environment}-redis-sg"
  }
}

resource "aws_security_group_rule" "redis_ingress" {
  count                    = length(var.app_security_group_ids)
  type                     = "ingress"
  from_port                = 6379
  to_port                  = 6379
  protocol                 = "tcp"
  security_group_id        = aws_security_group.redis.id
  source_security_group_id = var.app_security_group_ids[count.index]
  description               = "Redis from app security group ${var.app_security_group_ids[count.index]}"
}

resource "aws_security_group_rule" "redis_egress" {
  type              = "egress"
  from_port         = 0
  to_port           = 0
  protocol          = "-1"
  security_group_id = aws_security_group.redis.id
  cidr_blocks       = ["0.0.0.0/0"]
}
