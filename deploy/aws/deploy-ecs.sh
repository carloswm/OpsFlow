#!/usr/bin/env bash
set -Eeuo pipefail

required_vars=(
  AWS_ACCOUNT_ID
  AWS_REGION
  ECS_CLUSTER_NAME
  ECS_API_SERVICE_NAME
  ECS_WEB_SERVICE_NAME
  ECR_API_REPOSITORY_NAME
  ECR_WEB_REPOSITORY_NAME
  APPLICATION_URL
  OPSFLOW_IMAGE_TAG
)

for name in "${required_vars[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    printf 'Required environment variable %s is missing.\n' "$name" >&2
    exit 2
  fi
done

api_image="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${ECR_API_REPOSITORY_NAME}:${OPSFLOW_IMAGE_TAG}"
web_image="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${ECR_WEB_REPOSITORY_NAME}:${OPSFLOW_IMAGE_TAG}"

printf 'Building immutable image tag %s\n' "$OPSFLOW_IMAGE_TAG"
docker build --pull --platform linux/amd64 --file apps/api/Dockerfile --tag "$api_image" .
docker build --pull --platform linux/amd64 --file apps/web/Dockerfile --tag "$web_image" .
docker push "$api_image"
docker push "$web_image"

describe_service() {
  local service_name="$1"
  aws ecs describe-services \
    --cluster "$ECS_CLUSTER_NAME" \
    --services "$service_name" \
    --output json \
    | jq -e '.services as $services | ($services | length) == 1 and $services[0].status == "ACTIVE"' >/dev/null
}

current_task_definition() {
  local service_name="$1"
  aws ecs describe-services \
    --cluster "$ECS_CLUSTER_NAME" \
    --services "$service_name" \
    --query 'services[0].taskDefinition' \
    --output text
}

register_image_revision() {
  local current_arn="$1"
  local container_name="$2"
  local image_uri="$3"
  local task_definition_file

  task_definition_file="$(mktemp)"
  aws ecs describe-task-definition \
    --task-definition "$current_arn" \
    --query '{definition: taskDefinition, tags: tags}' \
    --output json \
    | jq --arg container "$container_name" --arg image "$image_uri" '
        (.definition
          | del(.taskDefinitionArn, .revision, .status, .requiresAttributes, .compatibilities, .registeredAt, .registeredBy)
        ) + {tags: [.tags[]? | {key: .key, value: .value}]}
        | (.containerDefinitions[] | select(.name == $container) | .image) = $image
      ' > "$task_definition_file"

  aws ecs register-task-definition \
    --cli-input-json "file://${task_definition_file}" \
    --query 'taskDefinition.taskDefinitionArn' \
    --output text
  rm -f "$task_definition_file"
}

describe_service "$ECS_API_SERVICE_NAME"
describe_service "$ECS_WEB_SERVICE_NAME"

old_api_task_definition="$(current_task_definition "$ECS_API_SERVICE_NAME")"
old_web_task_definition="$(current_task_definition "$ECS_WEB_SERVICE_NAME")"
new_api_task_definition="$(register_image_revision "$old_api_task_definition" api "$api_image")"
new_web_task_definition="$(register_image_revision "$old_web_task_definition" web "$web_image")"

printf 'Running database migrations with %s\n' "$new_api_task_definition"
network_configuration="$(aws ecs describe-services \
  --cluster "$ECS_CLUSTER_NAME" \
  --services "$ECS_API_SERVICE_NAME" \
  --query 'services[0].networkConfiguration.awsvpcConfiguration' \
  --output json)"

migration_task_arn="$(aws ecs run-task \
  --cluster "$ECS_CLUSTER_NAME" \
  --launch-type FARGATE \
  --task-definition "$new_api_task_definition" \
  --network-configuration "$(jq -cn --argjson config "$network_configuration" '{awsvpcConfiguration: $config}')" \
  --overrides '{"containerOverrides":[{"name":"api","command":["npm","run","db:migrate","--workspace","@opsflow/api"]}]}' \
  --query 'tasks[0].taskArn' \
  --output text)"

if [[ -z "$migration_task_arn" || "$migration_task_arn" == "None" ]]; then
  printf 'ECS did not start the migration task. Check the CD job output and ECS service events.\n' >&2
  exit 1
fi

aws ecs wait tasks-stopped --cluster "$ECS_CLUSTER_NAME" --tasks "$migration_task_arn"
migration_exit_code="$(aws ecs describe-tasks \
  --cluster "$ECS_CLUSTER_NAME" \
  --tasks "$migration_task_arn" \
  --query 'tasks[0].containers[0].exitCode' \
  --output text)"

if [[ "$migration_exit_code" != "0" ]]; then
  aws ecs describe-tasks \
    --cluster "$ECS_CLUSTER_NAME" \
    --tasks "$migration_task_arn" \
    --query 'tasks[0].{StoppedReason:stoppedReason,ContainerReason:containers[0].reason,ExitCode:containers[0].exitCode}' \
    --output table >&2
  printf 'Migration task failed with exit code %s; application services were not updated.\n' "$migration_exit_code" >&2
  exit 1
fi

printf 'Migration succeeded. Deploying API revision.\n'
aws ecs update-service \
  --cluster "$ECS_CLUSTER_NAME" \
  --service "$ECS_API_SERVICE_NAME" \
  --task-definition "$new_api_task_definition" >/dev/null
aws ecs wait services-stable --cluster "$ECS_CLUSTER_NAME" --services "$ECS_API_SERVICE_NAME"

printf 'Deploying web revision.\n'
aws ecs update-service \
  --cluster "$ECS_CLUSTER_NAME" \
  --service "$ECS_WEB_SERVICE_NAME" \
  --task-definition "$new_web_task_definition" >/dev/null
aws ecs wait services-stable --cluster "$ECS_CLUSTER_NAME" --services "$ECS_WEB_SERVICE_NAME"

if ! {
  curl --fail --silent --show-error --retry 6 --retry-delay 10 --retry-connrefused "${APPLICATION_URL%/}/health/ready" \
    && curl --fail --silent --show-error "${APPLICATION_URL%/}/"
}; then
  printf '\nSmoke check failed. Restoring the previously active API and web task definitions.\n' >&2
  aws ecs update-service --cluster "$ECS_CLUSTER_NAME" --service "$ECS_API_SERVICE_NAME" --task-definition "$old_api_task_definition" >/dev/null
  aws ecs update-service --cluster "$ECS_CLUSTER_NAME" --service "$ECS_WEB_SERVICE_NAME" --task-definition "$old_web_task_definition" >/dev/null
  aws ecs wait services-stable --cluster "$ECS_CLUSTER_NAME" --services "$ECS_API_SERVICE_NAME" "$ECS_WEB_SERVICE_NAME"
  exit 1
fi

printf '\nDeployment %s completed and smoke checks passed at %s\n' "$OPSFLOW_IMAGE_TAG" "$APPLICATION_URL"
