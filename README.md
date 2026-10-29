# OpsFlow

OpsFlow es una aplicación para que un equipo pequeño registre, asigne y siga incidentes de sus servicios. Se construye como portafolio de ingeniería: el producto debe funcionar de punta a punta y su entrega debe ser repetible, observable y recuperable.

La especificación funcional está en [`docs/PRODUCT_SPEC.md`](docs/PRODUCT_SPEC.md) y el plan técnico en [`PROJECT_PLAN.md`](PROJECT_PLAN.md).

## Arquitectura objetivo

```text
Navegador → interfaz React (Nginx) → API Fastify → PostgreSQL
                                   ↓
                           eventos y auditoría
```

La API y la interfaz se empaquetan por separado. En desarrollo y demostración local se ejecutan con Docker Compose; Kubernetes con kind y Helm forma parte de la validación. La infraestructura AWS de demo usa ALB, ECS Fargate, ECR y RDS privado. El sandbox empleado es temporal y elimina automáticamente sus recursos; la URL no se considera permanente.

## Estado actual

- Especificación de producto, roles y ciclo de vida de incidentes.
- Inicio de sesión con contraseñas Argon2id, sesiones revocables almacenadas como hashes, cookie `HttpOnly` y límite de intentos en el endpoint de login.
- API para usuarios y servicios con permisos administrativos; API de incidentes con filtros, asignación, transiciones, comentarios e historial transaccional.
- Interfaz para iniciar sesión, crear/listar incidentes, filtrar, asignar, cambiar estados y comentar.
- Migraciones SQL versionadas, cuenta y servicios demo locales, health checks y contenedores multi-stage.
- Runtime validado con Docker Compose: login desde la interfaz, tablero/detalle, creación y asignación de incidentes, comentarios, cambios de estado, health/readiness y persistencia tras reiniciar PostgreSQL.
- Suite inicial de integración de la API: readiness, autenticación, validación de origen y ciclo completo de incidentes contra una PostgreSQL desechable.
- Workflow de CI definido con Node 22, `npm ci`, build, migraciones, fixtures desechables, pruebas de integración y build de ambas imágenes Docker. La ejecución remota queda pendiente de publicar/configurar el repositorio.
- Workflow de CD configurado para esperar CI exitoso en `main` y aprobación del entorno `aws-sandbox`; publica imágenes por SHA en ECR, ejecuta migraciones, actualiza ECS Fargate, espera estabilidad y prueba health/UI con rollback. OIDC e IAM mínimo están definidos en Terraform. El despliegue inicial de este sandbox se hizo desde CLI; la ejecución remota de CI/CD sigue pendiente y CD permanece desactivado hasta configurar GitHub.
- Despliegue local verificado en kind 0.33.0 y Helm 4.3.1: PostgreSQL con PVC, Jobs de migración y seed, API y web sanas. Se comprobó readiness, login administrativo y lectura de los tres servicios demo a través del proxy web. Acceso documentado en [`docs/KUBERNETES.md`](docs/KUBERNETES.md).
- Terraform define la arquitectura AWS de demo: VPC y subredes, ALB, servicios web/API en ECS Fargate, ECR, RDS PostgreSQL privado, secreto administrado por RDS, IAM, CloudWatch y descubrimiento privado. En un sandbox temporal se crearon los recursos, se ejecutó la migración con código 0 y se verificaron `GET /health/ready` y la página web con respuestas HTTP 200. El alta de usuarios y los flujos autenticados aún no se validaron en AWS; este endpoint HTTP temporal no es un despliegue apto para usuarios reales.
- El flujo AWS documenta publicación de imágenes inmutables, migración de base de datos, verificación operativa, cálculo de costo y destrucción. Usa [`deploy/terraform/aws/README.md`](deploy/terraform/aws/README.md).

## Requisitos

- Node.js 22 para ejecutar herramientas desde el host.
- Docker Desktop con el motor Linux activo para Compose.

El repositorio declara Node `>=22 <23`. Si el equipo local usa otra versión, ejecuta el proyecto dentro de los contenedores para evitar diferencias con CI.

## Inicio local con contenedores

En PowerShell:

```powershell
Copy-Item .env.example .env
docker compose up --build
```

- Interfaz: <http://opsflow.localhost:8080>
- API liveness: <http://opsflow.localhost:8080/health/live>
- API readiness: <http://opsflow.localhost:8080/health/ready>

`opsflow.localhost` es un hostname local exclusivo que los navegadores Chromium resuelven a loopback. Evita mezclar las cookies de otros proyectos que usan `localhost`. Para comprobar health desde PowerShell, usa `http://127.0.0.1:8080/health/ready`.

Compose requiere que copies `.env.example` a `.env`; falla de forma explícita si faltan variables, en vez de usar valores de respaldo. Espera a que PostgreSQL esté saludable, aplica migraciones y carga un usuario administrador más tres servicios de ejemplo en contenedores de tarea, y luego inicia API y web. La base persiste en el volumen `opsflow-data`.

Para detener los contenedores sin borrar los datos:

```powershell
docker compose down
```

Elimina el volumen solo cuando quieras borrar los datos locales de práctica:

```powershell
docker compose down -v
```

Las contraseñas de `.env.example` son plantillas solo para desarrollo local: reemplázalas antes de iniciar. El usuario demo es el correo indicado por `DEMO_ADMIN_EMAIL`. `.env` está excluido de Git. No reutilices estos valores en cloud ni en una cuenta compartida; el seeder exige `ENABLE_DEMO_SEED=true` y no se activa en un despliegue cloud.

## Pruebas de integración de la API

Las pruebas usan una PostgreSQL aparte con el nombre `opsflow_test`, sin puerto publicado ni volumen persistente. El test runner se niega a arrancar si apunta a otra base.

```powershell
docker compose -p opsflow-test -f compose.yaml -f compose.test.yaml run --build --rm test-runner
```

Al terminar, puedes borrar el contenedor temporal y su red con:

```powershell
docker compose -p opsflow-test -f compose.yaml -f compose.test.yaml down -v
```

El nombre de proyecto `opsflow-test` mantiene aislados esos recursos del entorno normal `devops-flow`.

## Configuración y secretos por entorno

La aplicación recibe configuración mediante variables de entorno en todos los entornos. El archivo `.env` solo es el mecanismo local de Compose para cargar esas variables durante el desarrollo; no se copia a las imágenes ni se publica en Git.

| Entorno | De dónde salen las variables | Tratamiento |
| --- | --- | --- |
| Desarrollo local | `.env` ignorado por Git y creado a partir de `.env.example` | Valores de práctica; nunca se reutilizan en cloud. |
| Kubernetes `kind` | `Secret` creado localmente con `kubectl`, fuera de los manifiestos versionados | Solo valores de desarrollo; el objeto Secret y el clúster local no son un gestor central de secretos. |
| AWS ECS | Referencia a AWS Secrets Manager en la definición de tarea | El rol de ejecución de ECS recibe `secretsmanager:GetSecretValue` solo para el secreto requerido. |

En ECS el agente obtiene el valor de Secrets Manager al iniciar la tarea y lo entrega al proceso como variable de entorno. La aplicación mantiene el mismo contrato de configuración; cambia el mecanismo que almacena y entrega el valor. La rotación no actualiza por sí sola un contenedor que ya está corriendo: se necesita iniciar tareas nuevas o desplegar de nuevo el servicio. Por eso también evitaremos imprimir el entorno, registraremos errores sin credenciales y restringiremos quién puede inspeccionar tareas.

**Respuesta breve para entrevista:** “La aplicación consume configuración por variables de entorno. En desarrollo uso un `.env` local ignorado por Git; en AWS no guardo el secreto en Git ni en texto plano en la tarea, sino que ECS lo obtiene de Secrets Manager con permisos IAM mínimos y lo inyecta al arrancar. Considero la rotación y el acceso al entorno del contenedor como parte del riesgo operativo.”

## Estructura

```text
apps/api/       API, migraciones y lógica del servicio
apps/web/       Interfaz React y configuración de Nginx
docs/           Especificaciones y decisiones del producto
compose.yaml    entorno local de tres servicios
```

## Recorrido de entrega

1. Completar y documentar los flujos de producto.
2. Operar localmente con Compose y datos persistentes.
3. Validar cambios con CI y publicar imágenes identificadas por commit.
4. Instalar y actualizar la aplicación en Kubernetes local con Helm siguiendo [`docs/KUBERNETES.md`](docs/KUBERNETES.md).
5. Revisar y desplegar la infraestructura AWS con Terraform, publicar las imágenes y ejecutar migraciones siguiendo [`deploy/terraform/aws/README.md`](deploy/terraform/aws/README.md).
