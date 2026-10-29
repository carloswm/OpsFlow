variable "aws_region" {
  description = "AWS region used by the OpsFlow demo environment."
  type        = string
  default     = "us-east-1"
}

variable "project_name" {
  description = "Short prefix used to name AWS resources."
  type        = string
  default     = "opsflow"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{2,15}$", var.project_name))
    error_message = "project_name must be 3-16 lowercase letters, digits, or hyphens and start with a letter."
  }
}

variable "environment" {
  description = "Environment name included in resource names and tags."
  type        = string
  default     = "demo"
}

variable "api_image_tag" {
  description = "Existing immutable tag in the API ECR repository. Push this image before creating the ECS service."
  type        = string
}

variable "web_image_tag" {
  description = "Existing immutable tag in the web ECR repository. Push this image before creating the ECS service."
  type        = string
}

variable "database_name" {
  description = "Initial PostgreSQL database name."
  type        = string
  default     = "opsflow"
}

variable "database_username" {
  description = "Initial PostgreSQL master username. The generated password is managed by RDS in Secrets Manager."
  type        = string
  default     = "opsflow_admin"
}

variable "database_instance_class" {
  description = "RDS instance class. Use a small burstable class for the portfolio demo and review regional availability."
  type        = string
  default     = "db.t4g.micro"
}

variable "api_cpu" {
  description = "Fargate CPU units for the API task."
  type        = number
  default     = 256
}

variable "api_memory" {
  description = "Fargate memory in MiB for the API task."
  type        = number
  default     = 512
}

variable "web_cpu" {
  description = "Fargate CPU units for the web task."
  type        = number
  default     = 256
}

variable "web_memory" {
  description = "Fargate memory in MiB for the web task."
  type        = number
  default     = 512
}

variable "github_repository" {
  description = "GitHub owner/repository allowed to deploy through the aws-sandbox GitHub environment."
  type        = string

  validation {
    condition     = can(regex("^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$", var.github_repository))
    error_message = "github_repository must use owner/repository format."
  }
}

variable "github_owner_id" {
  description = "Immutable numeric GitHub owner ID used by GitHub's default OIDC subject for new repositories."
  type        = string

  validation {
    condition     = can(regex("^[0-9]+$", var.github_owner_id))
    error_message = "github_owner_id must be the numeric owner ID from GitHub."
  }
}

variable "github_repository_id" {
  description = "Immutable numeric GitHub repository ID used by GitHub's default OIDC subject for new repositories."
  type        = string

  validation {
    condition     = can(regex("^[0-9]+$", var.github_repository_id))
    error_message = "github_repository_id must be the numeric repository ID from GitHub."
  }
}

variable "origin_verify_header" {
  description = "Random value shared by CloudFront and the ALB listener to reject requests that bypass the distribution. Keep only in ignored terraform.tfvars and protected Terraform state."
  type        = string
  sensitive   = true

  validation {
    condition     = can(regex("^[A-Za-z0-9_-]{40,}$", var.origin_verify_header))
    error_message = "origin_verify_header must be at least 40 URL-safe characters."
  }
}
