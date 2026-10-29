data "aws_rds_engine_version" "postgres" {
  engine  = "postgres"
  version = "17"
  latest  = true
}

data "aws_ec2_managed_prefix_list" "cloudfront_origin_facing" {
  name = "com.amazonaws.global.cloudfront.origin-facing"
}

data "aws_cloudfront_cache_policy" "caching_optimized" {
  name = "Managed-CachingOptimized"
}

data "aws_cloudfront_cache_policy" "caching_disabled" {
  name = "Managed-CachingDisabled"
}

data "aws_cloudfront_origin_request_policy" "all_viewer_except_host_header" {
  name = "Managed-AllViewerExceptHostHeader"
}

resource "aws_db_subnet_group" "main" {
  name       = "${local.name_prefix}-database"
  subnet_ids = [for subnet in aws_subnet.database : subnet.id]
  tags       = { Name = "${local.name_prefix}-database" }
}

resource "aws_db_instance" "main" {
  identifier                  = "${local.name_prefix}-postgres"
  engine                      = data.aws_rds_engine_version.postgres.engine
  engine_version              = data.aws_rds_engine_version.postgres.version
  instance_class              = var.database_instance_class
  allocated_storage           = 20
  max_allocated_storage       = 50
  storage_type                = "gp3"
  storage_encrypted           = true
  db_name                     = var.database_name
  username                    = var.database_username
  manage_master_user_password = true
  port                        = 5432
  db_subnet_group_name        = aws_db_subnet_group.main.name
  vpc_security_group_ids      = [aws_security_group.database.id]
  publicly_accessible         = false
  multi_az                    = false
  backup_retention_period     = 1
  auto_minor_version_upgrade  = true
  deletion_protection         = false
  skip_final_snapshot         = true
  apply_immediately           = true

  tags = { Name = "${local.name_prefix}-postgres" }
}
