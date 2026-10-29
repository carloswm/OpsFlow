output "application_url" {
  description = "HTTP URL for the public demo load balancer. TLS requires a domain and certificate before production use."
  value       = "http://${aws_lb.main.dns_name}"
}

output "api_repository_url" {
  description = "Push an immutable API image tag to this ECR repository before applying the ECS service."
  value       = aws_ecr_repository.api.repository_url
}

output "web_repository_url" {
  description = "Push an immutable web image tag to this ECR repository before applying the ECS service."
  value       = aws_ecr_repository.web.repository_url
}

output "ecs_cluster_name" {
  description = "ECS cluster name for operational commands."
  value       = aws_ecs_cluster.main.name
}

output "aws_account_id" {
  description = "AWS account ID for the protected GitHub Actions environment."
  value       = data.aws_caller_identity.current.account_id
}

output "github_actions_role_arn" {
  description = "Role ARN for the CD workflow; use as the AWS_ROLE_ARN GitHub environment variable."
  value       = aws_iam_role.github_actions_deploy.arn
}

output "ecr_api_repository_name" {
  description = "API ECR repository name for the CD workflow."
  value       = aws_ecr_repository.api.name
}

output "ecr_web_repository_name" {
  description = "Web ECR repository name for the CD workflow."
  value       = aws_ecr_repository.web.name
}

output "ecs_api_service_name" {
  description = "ECS API service name used after running database migrations."
  value       = aws_ecs_service.api.name
}

output "public_subnet_ids" {
  description = "Public subnet IDs for one-off Fargate migration tasks."
  value       = [for subnet in aws_subnet.public : subnet.id]
}

output "api_security_group_id" {
  description = "API task security group used by the one-off migration task."
  value       = aws_security_group.api.id
}

output "database_endpoint" {
  description = "Private PostgreSQL endpoint; it is not published to the internet."
  value       = aws_db_instance.main.address
}
