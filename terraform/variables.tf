variable "aws_region" {
  description = "AWS region to provision into."
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Deployment environment name, used as a resource-name prefix/tag."
  type        = string
  default     = "dizzaract-prod"
}

variable "vpc_cidr" {
  description = "CIDR block for the VPC."
  type        = string
  default     = "10.20.0.0/16"
}

variable "availability_zones" {
  description = "AZs to spread subnets across. Two is the minimum for RDS Multi-AZ and an ElastiCache replica."
  type        = list(string)
  default     = ["us-east-1a", "us-east-1b"]
}

variable "private_subnet_cidrs" {
  description = "Private subnet CIDRs (data layer: RDS + ElastiCache), one per AZ."
  type        = list(string)
  default     = ["10.20.10.0/24", "10.20.11.0/24"]
}

variable "public_subnet_cidrs" {
  description = "Public subnet CIDRs (edge layer: where an ALB would live), one per AZ. Provisioned for completeness even though the ALB/ECS compute layer itself is out of scope for this snippet - see README.md in this directory."
  type        = list(string)
  default     = ["10.20.0.0/24", "10.20.1.0/24"]
}

variable "app_security_group_ids" {
  description = "Security group IDs of the compute layer (e.g. the ECS service's SG) that should be allowed to reach Postgres/Redis. Empty by default - compute provisioning is out of scope here, so Postgres/Redis accept connections from nothing until this is populated."
  type        = list(string)
  default     = []
}

variable "postgres_engine_version" {
  description = "RDS Postgres engine version - matches the postgres:16-alpine image in docker-compose.yml."
  type        = string
  default     = "16.4"
}

variable "postgres_instance_class" {
  description = "Placeholder size - re-evaluate against real load before using this."
  type        = string
  default     = "db.t4g.micro"
}

variable "postgres_multi_az" {
  description = "Enable RDS Multi-AZ failover. Off by default (cost) - docs/production-gaps.md calls this out as a real gap to close before production."
  type        = bool
  default     = false
}

variable "postgres_allocated_storage_gb" {
  type    = number
  default = 20
}

variable "postgres_database_name" {
  type    = string
  default = "dizzaract"
}

variable "postgres_master_username" {
  type    = string
  default = "dizzaract"
}

variable "redis_node_type" {
  description = "Placeholder size - re-evaluate against real load before using this."
  type        = string
  default     = "cache.t4g.micro"
}

variable "redis_engine_version" {
  description = "ElastiCache Redis engine version - matches the redis:7-alpine image in docker-compose.yml."
  type        = string
  default     = "7.1"
}

variable "redis_num_cache_clusters" {
  description = "Number of nodes in the replication group. 1 = single node, matching the app's current disposable-cache design (the leaderboard rebuilds from Postgres, see NOTES.md). Set to 2+ for automatic failover once uptime SLAs justify the extra cost - see docs/production-gaps.md."
  type        = number
  default     = 1
}
