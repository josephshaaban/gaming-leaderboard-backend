provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "dizzaract-gaming-leaderboard"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}
