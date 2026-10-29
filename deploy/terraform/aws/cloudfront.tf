resource "aws_cloudfront_distribution" "main" {
  comment             = "HTTPS edge for the OpsFlow demo."
  default_root_object = "index.html"
  enabled             = true
  is_ipv6_enabled     = true
  price_class         = "PriceClass_100"
  wait_for_deployment = true

  origin {
    domain_name = aws_lb.main.dns_name
    origin_id   = "${local.name_prefix}-alb-origin"

    custom_header {
      name  = "X-OpsFlow-Origin-Verify"
      value = var.origin_verify_header
    }

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "http-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  default_cache_behavior {
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD", "OPTIONS"]
    target_origin_id       = "${local.name_prefix}-alb-origin"
    viewer_protocol_policy = "redirect-to-https"
    cache_policy_id        = data.aws_cloudfront_cache_policy.caching_optimized.id
    compress               = true
  }

  ordered_cache_behavior {
    path_pattern             = "/api/*"
    allowed_methods          = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods           = ["GET", "HEAD", "OPTIONS"]
    target_origin_id         = "${local.name_prefix}-alb-origin"
    viewer_protocol_policy   = "redirect-to-https"
    cache_policy_id          = data.aws_cloudfront_cache_policy.caching_disabled.id
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.all_viewer_except_host_header.id
    compress                 = true
  }

  ordered_cache_behavior {
    path_pattern             = "/health/*"
    allowed_methods          = ["GET", "HEAD", "OPTIONS"]
    cached_methods           = ["GET", "HEAD", "OPTIONS"]
    target_origin_id         = "${local.name_prefix}-alb-origin"
    viewer_protocol_policy   = "redirect-to-https"
    cache_policy_id          = data.aws_cloudfront_cache_policy.caching_disabled.id
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.all_viewer_except_host_header.id
    compress                 = true
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
    # CloudFront fixes this to TLSv1 when using its default *.cloudfront.net certificate.
    # A custom domain and ACM certificate are required to select a newer policy.
    minimum_protocol_version = "TLSv1"
  }

  tags = { Name = "${local.name_prefix}-cloudfront" }

  depends_on = [
    aws_lb_listener_rule.api_paths,
    aws_lb_listener_rule.web_from_cloudfront,
    aws_vpc_security_group_ingress_rule.load_balancer_http,
  ]
}
