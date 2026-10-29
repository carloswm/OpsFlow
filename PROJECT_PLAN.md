# Proyecto de portafolio: OpsFlow

## Objetivo

Construir y operar una aplicación funcional para que un equipo pequeño pueda registrar, asignar y seguir incidentes de sus servicios. El resultado debe servir para una demostración real con usuarios, datos persistentes y flujos completos. El foco del portafolio también está en entregar y operar el sistema de forma repetible, segura y observable: desde el commit hasta una versión desplegable, con instrucciones para diagnosticar y recuperar fallos.

La presentación debe distinguir claramente entre lo probado localmente, lo desplegado en una cuenta personal y lo que sería una decisión de producción. El proyecto demuestra práctica; no se presenta como experiencia de producción empresarial.

## Qué podrá demostrar

- Linux, Git y flujo de trabajo con ramas y pull requests.
- Node.js con TypeScript, API HTTP, PostgreSQL y pruebas.
- Docker, Docker Compose, persistencia y health/readiness.
- CI con GitHub Actions y publicación versionada de imágenes.
- Seguridad básica en el ciclo de entrega: secretos fuera del código, permisos mínimos, escaneo de imagen y dependencias.
- Terraform para describir infraestructura y revisar cambios antes de aplicarlos.
- Despliegue, logs, métricas/alertas básicas, diagnóstico y runbooks.
- Comunicación de decisiones, límites, costos y pasos de recuperación.

## Forma del sistema

Será un **monolito modular**, no una API aislada ni un conjunto de microservicios:

- Una interfaz web responsive para el trabajo cotidiano del equipo.
- Una API HTTP con límites claros entre identidad, servicios e incidentes.
- PostgreSQL como fuente persistente para datos e historial.
- Dos artefactos de aplicación (web y API) más PostgreSQL. La separación sirve al despliegue y al escalado; el dominio sigue siendo un monolito modular.

La UI vuelve visible el valor del producto en la demo; la API permite probar contratos, permisos e integraciones. El monolito mantiene menor carga operativa que varios servicios independientes y sigue permitiendo mostrar separación de capas, calidad y despliegue.

## Stack propuesto

| Área | Tecnología | Motivo |
| --- | --- | --- |
| API | Node.js 22, TypeScript y Fastify | Continúa desde la experiencia con Node y permite mostrar contratos y validación sin añadir complejidad innecesaria. |
| Interfaz | React, TypeScript y Vite | Da al proyecto una experiencia usable y aprovecha la experiencia frontend existente. |
| Datos | PostgreSQL | Persistencia real, migraciones y pruebas de integración. |
| Calidad | Vitest, ESLint y pruebas HTTP | Verificar lógica, contrato y comportamientos importantes. |
| Entorno local | Docker, Docker Compose y Makefile/PowerShell scripts | Levantar, observar y limpiar el entorno con pasos reproducibles. |
| CI y artefactos | GitHub Actions y GHCR | Validar PRs y conservar imágenes identificadas por versión y commit. |
| Seguridad de entrega | Trivy, permisos mínimos y GitHub OIDC para AWS | Mostrar controles prácticos sin guardar llaves cloud en GitHub. |
| IaC y cloud | Terraform y AWS ECS Fargate | Practicar infraestructura declarativa y un patrón gestionado apropiado para un servicio pequeño. |
| Operación | CloudWatch, health checks, alarmas y runbooks | Hacer visible qué ocurre y cómo responder cuando algo falla. |
| Orquestación | Kubernetes local con kind y Helm | Kubernetes forma parte de la entrega requerida: desplegar, observar y actualizar la misma aplicación en un clúster local. |

Mantendremos una sola nube y una ruta principal de despliegue. Kubernetes local es obligatorio; Kubernetes administrado, service mesh y microservicios quedan fuera del alcance base. El despliegue cloud se hará con ECS para evitar que el costo de un clúster EKS sea requisito del portafolio.

## Alcance funcional del producto terminado

1. Iniciar sesión como miembro del equipo con permisos diferenciados para miembro y administrador.
2. Administrar servicios del equipo y ver su responsable y nivel de criticidad.
3. Crear, asignar, priorizar, filtrar y buscar incidentes desde una interfaz web.
4. Seguir un flujo de estados con validación; permitir resolver y reabrir incidentes con razón.
5. Agregar comentarios y consultar una línea de tiempo de cambios con autor y fecha.
6. Consultar un tablero con incidentes activos, antigüedad y distribución por severidad/servicio.
7. Exponer `/health/live` y `/health/ready` con semántica distinta y versionar la API.
8. Emitir logs estructurados con identificador de solicitud, sin registrar credenciales ni datos sensibles.
9. Mantener migraciones, datos demo reproducibles y pruebas de integración contra PostgreSQL.

Los datos demo serán sintéticos. Los endpoints de integración por webhook pueden quedar como extensión si no son necesarios para demostrar los flujos principales.

## Fases y evidencia de salida

### Fase 0 — Diseñar el producto y sus límites

- Definir los roles, entidades, permisos y flujo completo de incidentes.
- Dibujar las pantallas principales y separar responsabilidades de UI, API y datos.
- Crear README, diagrama y decisiones técnicas antes de implementar.
- **Evidencia:** especificación de comportamiento completa y verificable, con casos normales y de error.

### Fase 1 — Aplicación funcional

- Implementar UI, API, autenticación/autorización, persistencia, migraciones e historial.
- Cubrir estados inválidos, permisos, validación y errores con pruebas unitarias e integración.
- Añadir accesibilidad básica, estados de carga/error y datos demo.
- **Evidencia:** un usuario puede completar un flujo de punta a punta y sus cambios sobreviven reinicios.

### Fase 2 — Ejecución local reproducible y diagnóstico

- Crear imagen multi-stage que corra como usuario no root.
- Definir PostgreSQL y aplicación en Compose con healthcheck y volumen persistente.
- Documentar recuperación, logs, backup de práctica y fallos deliberados.
- **Evidencia:** arranque limpio, persistencia tras reinicio y diagnóstico de al menos dos fallos inducidos.

### Fase 3 — CI y cadena de suministro

- En pull requests ejecutar instalación reproducible, lint y pruebas.
- Construir la imagen y publicarla al fusionar a la rama principal, con etiquetas inmutables.
- Añadir escaneo de imagen/dependencias y generar SBOM si el flujo queda claro.
- **Evidencia:** ejecución verde del pipeline, artefacto rastreable al commit y captura de un fallo detectado por CI.

### Fase 4 — Kubernetes local

- Crear un clúster kind reproducible y desplegar la aplicación con Helm.
- Configurar Deployment, Service, ConfigMap/Secret, probes, requests/limits, namespace y rollout.
- Practicar actualización, rollback, inspección de eventos/logs y diagnóstico de una falla.
- **Evidencia:** la aplicación funciona en Kubernetes local y se puede actualizar y recuperar siguiendo el runbook.

### Fase 5 — Infraestructura como código

- Definir con Terraform VPC/subredes públicas y privadas, ALB, servicios web/API en ECS Fargate, ECR, IAM, CloudWatch, descubrimiento privado y PostgreSQL RDS con secreto maestro administrado por RDS.
- Mantener estado y variables locales fuera de Git; antes de uso compartido, configurar backend remoto cifrado y control de acceso.
- Revisar `fmt`, `validate`, `plan`, costo estimado, límites y procedimiento de destrucción antes de aplicar.
- **Evidencia:** módulo en [`deploy/terraform/aws`](deploy/terraform/aws/README.md), configuración validada localmente, plan ligado a una identidad AWS, despliegue comprobado y `destroy` documentado.

### Fase 6 — Despliegue y operación

- Configurar GitHub Actions con OIDC y permisos mínimos para publicar imágenes inmutables en ECR y desplegar una versión aprobada en ECS Fargate.
- Ejecutar migraciones controladas, esperar estabilidad del servicio, correr pruebas de humo y recuperar la versión anterior si falla la verificación.
- Verificar health checks, logs, alarmas básicas, rollback y runbook.
- Añadir una prueba de humo contra el entorno desplegado y ensayar una falla controlada.
- **Evidencia:** versión desplegada identificable, alarma observable y recuperación documentada.

### Extensión opcional

- Añadir ingesta idempotente de alertas por webhook y una cola de trabajo si los flujos principales ya están sólidos.
- Comparar qué resuelve Compose, Kubernetes y ECS en este proyecto.
- **Evidencia:** integración documentada y protegida contra reintentos duplicados.

## Cómo lo contrastaremos con vacantes

| Lo que se repite en la muestra | Evidencia concreta en OpsFlow |
| --- | --- |
| Git, Linux y soporte a desarrollo | README ejecutable, PRs pequeños, comandos y troubleshooting documentados. |
| Docker y Kubernetes básico | Compose y kind son parte obligatoria; Helm, probes y troubleshooting de workloads. |
| CI/CD | Validación automática de PR, publicación de imagen y despliegue controlado. |
| AWS y operación cloud | Terraform, ECS, IAM, logs, health checks y una demo acotada. |
| IaC | `fmt`/`validate`/`plan`, variables y estado gestionados con cuidado. |
| Seguridad | OIDC, permisos mínimos, secretos fuera del repo y escaneo. |
| Observabilidad e incidentes | Logs, alarmas básicas, prueba de falla, recuperación y runbook. |
| Comunicación | Diagrama, decisiones, limitaciones y guion de demo de cinco minutos. |

La muestra consultada incluye un rol DevOps Junior en Lima y roles remotos LATAM; los anuncios cambian y los requisitos no son idénticos entre empresas. En entrevista vamos a describir cada parte como proyecto personal y explicar qué falta para operación productiva.

## Reglas para mantener el alcance realista

- Completar primero la experiencia funcional local; después automatizarla y finalmente llevarla a cloud.
- No introducir una tecnología sin una pregunta concreta que ayude a responder.
- No aplicar Terraform ni crear recursos facturables antes de revisar una estimación y el plan de limpieza.
- Mantener los secretos fuera del código, los logs y las capturas públicas.
- Enseñar el proyecto bloque por bloque: explicar una pieza, predecir su efecto y continuar con el siguiente ejercicio.
- Registrar explícitamente qué se verificó y qué sigue siendo una hipótesis o una simulación.

## Definición de terminado para el portafolio

- README con arquitectura, requisitos, inicio rápido y troubleshooting.
- Código y pipeline reproducibles, pruebas relevantes y artefacto etiquetado.
- IaC revisable y despliegue demostrado o, si no se autoriza gasto cloud, plan validado y límites explicados.
- Diagrama, runbook, nota de costos y guion corto para entrevista.
- Una demo que muestra inicio de sesión, flujo de incidente, historial, operación normal y una falla recuperada.

## Fuentes de vacantes consultadas el 27 de octubre de 2026

- [Ingeniero DevOps Junior — Apuesta Total, Lima](https://pe.linkedin.com/jobs/view/ingeniero-devops-junior-at-apuesta-total-4482104597): Linux, Git, Docker, Kubernetes básico, AWS CLI, pipelines, soporte, seguridad y documentación.
- [Jr. DevOps Engineer — TrueML](https://jobs.lever.co/trueml/d56d0e86-c4ed-4d6a-a9f8-81b76b5009fc?gh_src=Viola+Group+job+board): Terraform/AWS y mantenimiento de flujos CI/CD con GitHub Actions/ArgoCD; contenedores.
- [DevOps Jr. — Flux IT](https://freehire.me/jobs/devops-jr-flux-it-jf7t6fnz): GCP, Terraform, Docker/Kubernetes, seguridad básica y pipelines CI/CD.
- [Junior DevOps Engineer — Scalyz](https://careers.scalyz.com/job-offer-junior-devops-engineer-aws/terraform): AWS, Terraform, EC2/S3/IAM/VPC; scripting y CI/CD como plus.

Estos enlaces son una muestra para orientar el portafolio, no una garantía de que cada vacante siga aceptando postulaciones.
