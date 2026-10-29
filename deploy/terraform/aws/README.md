# OpsFlow on AWS with Terraform

This Terraform root module defines an interview/demo deployment of OpsFlow on AWS. It provisions a VPC, an internet-facing Application Load Balancer, separate ECS Fargate services for the web UI and API, ECR repositories, private service discovery, PostgreSQL in isolated subnets, IAM roles, RDS-managed credentials in Secrets Manager, and CloudWatch log groups.

This is a small demo architecture, not a production reference architecture. It uses one task for each application component, a single-AZ database, an HTTP listener, and Fargate tasks with public IPs. Security groups restrict inbound task traffic to the load balancer, and the database is private. Before using it with real users, add HTTPS with an ACM certificate and domain, set `COOKIE_SECURE=true`, review availability and backups, and move Terraform state to an encrypted, access-controlled remote backend.

## Request flow

```text
Browser --HTTP:80--> ALB
                      |-- /, frontend assets --> web task :8080
                      `-- /api/*, /health/* --> API task :3000
                                                    |-- PostgreSQL :5432 (private)
                                                    `-- RDS-managed secret from Secrets Manager

Web task -- private DNS api.opsflow.local --> API task
```

The API enables PostgreSQL TLS with certificate verification. Its image includes the official regional RDS CA bundle for `us-east-1`, selected through `NODE_EXTRA_CA_CERTS`; local Compose keeps TLS disabled for its local PostgreSQL container.

## Requirements

- Terraform `>= 1.10, < 2.0` and the AWS provider version recorded in `.terraform.lock.hcl`.
- AWS CLI v2 configured with a named profile or another supported credential source. The identity needs permissions for the resources in this module and `iam:PassRole` for ECS task roles.
- Docker, AWS CLI access to ECR, and permission to push images.
- An AWS region with at least two Availability Zones and support for the selected Fargate and RDS sizes.

No AWS access keys or passwords belong in this directory. The RDS master password is generated and managed by RDS, then fetched by ECS through the task execution role. Terraform state can still contain resource metadata and sensitive attributes; protect the state file and never commit it.

## Image-first deployment

The ECS task definitions refer to immutable images already stored in ECR. Push the images before creating the services. From this directory in PowerShell:

```powershell
Copy-Item terraform.tfvars.example terraform.tfvars
# Replace the example tags with the same immutable commit tag, such as sha-a1b2c3d.
terraform init
terraform fmt -check -recursive
terraform validate
terraform plan -out opsflow.tfplan
terraform show opsflow.tfplan
```

Review the plan and AWS Pricing Calculator estimate before applying. The image repositories can be bootstrapped without creating the rest of the environment:

```powershell
terraform apply -target=aws_ecr_repository.api -target=aws_ecr_repository.web
terraform output -raw api_repository_url
terraform output -raw web_repository_url
```

Authenticate to ECR, build the application images from the repository root, tag them with the exact values in `terraform.tfvars`, and push them to the two output repositories. Then create the remaining resources:

```powershell
terraform plan -out opsflow.tfplan
terraform show opsflow.tfplan
terraform apply opsflow.tfplan
```

The first apply starts the services, but the database schema still needs the application's migration command. Run the API task definition once with a command override and wait for it to exit successfully before using the application:

```powershell
$cluster = terraform output -raw ecs_cluster_name
$apiService = terraform output -raw ecs_api_service_name
$apiTaskDefinition = "${cluster}-api"
$subnets = terraform output -json public_subnet_ids | ConvertFrom-Json
$apiSecurityGroup = terraform output -raw api_security_group_id
$network = "awsvpcConfiguration={subnets=[$($subnets -join ',')],securityGroups=[$apiSecurityGroup],assignPublicIp=ENABLED}"
$run = aws ecs run-task --cluster $cluster --launch-type FARGATE --task-definition $apiTaskDefinition `
  --network-configuration $network `
  --overrides '{"containerOverrides":[{"name":"api","command":["npm","run","db:migrate","--workspace","@opsflow/api"]}]}'
$taskArn = ($run | ConvertFrom-Json).tasks[0].taskArn
aws ecs wait tasks-stopped --cluster $cluster --tasks $taskArn
aws ecs describe-tasks --cluster $cluster --tasks $taskArn --query 'tasks[0].containers[0].exitCode'
```

Confirm the migration task exited with code `0`; otherwise inspect its CloudWatch logs. After a successful migration, force a fresh deployment so the API is healthy against the initialized schema:

```powershell
aws ecs update-service --cluster $cluster --service $apiService --force-new-deployment
terraform output -raw application_url
```

## Continuous delivery with GitHub Actions

The repository includes [`.github/workflows/cd-aws.yml`](../../../.github/workflows/cd-aws.yml) and [`deploy/aws/deploy-ecs.sh`](../../aws/deploy-ecs.sh). After the `CI` workflow succeeds for a push to `main`, CD waits at the protected `aws-sandbox` environment. Once approved, it checks out the exact commit that passed CI, assumes the Terraform-created IAM role through GitHub OIDC, builds and pushes immutable commit-tagged images to ECR, runs the API migration as a one-off ECS task, updates the API and web services, waits for ECS stability, and calls the readiness and web endpoints. A failed migration stops before service updates. A failed smoke check restores the previously active task-definition revisions; ECS deployment circuit breakers also roll back failed health deployments.

Before enabling CD:

1. Bootstrap ECR and deploy the first working version using the Terraform and migration steps above. The CD workflow updates an existing ECS environment.
2. Create the GitHub environment named `aws-sandbox`, restrict deployments to `main`, and configure required reviewer approval.
3. Add these environment variables from Terraform outputs: `AWS_ACCOUNT_ID`, `AWS_REGION`, `AWS_ROLE_ARN`, `ECS_CLUSTER_NAME`, `ECS_API_SERVICE_NAME`, `ECS_WEB_SERVICE_NAME`, `ECR_API_REPOSITORY_NAME`, `ECR_WEB_REPOSITORY_NAME`, and `APPLICATION_URL`.
4. Keep the repository variable `AWS_CD_ENABLED` unset or set to `false` until the target environment exists. Set it to `true` only after those environment variables and the protected `aws-sandbox` environment are configured; this prevents a normal CI run from attempting a deployment to an unprepared or expired sandbox.
5. Set `github_repository`, `github_owner_id` and `github_repository_id` in `terraform.tfvars` to the exact repository and immutable IDs before applying Terraform. Obtain the numeric IDs from GitHub repository/account settings or the GitHub API. The IAM trust policy uses GitHub's immutable OIDC subject format and accepts tokens only for that repository and the `aws-sandbox` environment.

The workflow uses short-lived OIDC credentials rather than stored AWS access keys. Keep database migrations backward-compatible with the currently running application because CD applies the migration before switching ECS services. The initial bootstrap is a separately reviewed infrastructure operation; CI/CD does not run Terraform apply on every application change.

## Cost and cleanup

This environment incurs charges while resources remain provisioned. The assumptions and component breakdown are in [`docs/AWS_COST_ESTIMATE.md`](../../../docs/AWS_COST_ESTIMATE.md). Use the AWS Pricing Calculator for the selected account and region before applying.

Stop ongoing charges by destroying the environment after the demo. First review what Terraform will remove, then destroy it:

```powershell
terraform plan -destroy -out destroy.tfplan
terraform show destroy.tfplan
terraform apply destroy.tfplan
```

The RDS instance is configured without deletion protection and skips a final snapshot to make demo cleanup complete. Export any data you need before destroy. ECR repositories allow Terraform to remove the tagged demo images as part of teardown. The CD workflow must be disabled or paused before destroying the environment, or a later successful CI run will wait for sandbox approval and then fail because its resources no longer exist.

Some training sandboxes automatically delete the entire account environment at session expiry. Capture the application URL, task/image revisions, health responses, and CloudWatch logs before that happens. Automatic cloud cleanup does not remove the local Terraform state file; keep it out of Git and discard or refresh it before reusing this working copy against a new sandbox account.

## Validation boundary

`terraform fmt`, `terraform validate`, and `terraform plan` answer different questions. Formatting and validation can run without AWS resources; an AWS-backed plan needs valid AWS credentials and reads account/region state. A successful local validation does not prove the infrastructure has been created, the containers are running, or the app has been deployed. Verify those separately after deployment.
