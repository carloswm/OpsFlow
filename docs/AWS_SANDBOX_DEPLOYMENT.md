# Evidencia de despliegue en AWS sandbox

## Alcance y vigencia

Validación temporal realizada el 2026-10-28 en `us-east-1`. El sandbox elimina automáticamente el entorno al vencer la sesión; la URL y los recursos no son permanentes.

## Resultado

- Terraform creó 2 repositorios ECR y después 49 recursos AWS para red, ALB, ECS Fargate, RDS PostgreSQL privado, IAM, CloudWatch y Cloud Map.
- Las imágenes API y web se construyeron para `linux/amd64` y se publicaron en ECR con etiquetas inmutables.
- RDS PostgreSQL 17.11 quedó en subredes privadas y ECS obtuvo la contraseña desde el secreto administrado por RDS.
- La migración se ejecutó como una tarea ECS independiente y terminó con código `0`.
- Los servicios ECS llegaron a estado estable; el target group de la API reportó `healthy`.
- CloudFront publicó el sitio por HTTPS en `https://d3a8fw4vmu501j.cloudfront.net` y redirige a HTTPS.
- A través de CloudFront, `GET /health/ready` respondió HTTP `200` con `{"status":"ready","dependencies":{"database":"ready"}}` y `GET /` respondió HTTP `200` con `Content-Type: text/html`.
- El ALB solo acepta conexiones originadas desde el prefijo administrado de CloudFront y sus reglas requieren un encabezado compartido de origen. El acceso directo al ALB no forma parte de la ruta pública.

## Diagnóstico realizado

El primer intento de migración falló porque RDS rechazó conexiones sin TLS. Se habilitó TLS con verificación del certificado y se incluyó en la imagen API el bundle CA regional oficial de RDS para `us-east-1`, suministrado a Node mediante `NODE_EXTRA_CA_CERTS`. Tras publicar una nueva etiqueta de imagen, la migración terminó correctamente y readiness confirmó la conexión a la base.

Durante una actualización posterior, Terraform intentó reemplazar el servicio de Cloud Map mientras ECS aún tenía una instancia registrada. AWS rechazó el reemplazo. Se retiró de la configuración el bloque opcional de health check que provocaba el reemplazo; el siguiente plan dejó de proponer esa destrucción y actualización.

## Límites

- El frontend y la readiness con conexión a PostgreSQL se verificaron a través de HTTPS; el login y las operaciones autenticadas no se validaron en AWS porque no se creó una cuenta demo.
- El origen ALB usa HTTP dentro de AWS. CloudFront sirve HTTPS a los visitantes con el certificado predeterminado `*.cloudfront.net`; AWS fija su mínimo TLS en 1.0. Para exigir TLS 1.2 o superior, configura un dominio propio y un certificado ACM en CloudFront ([documentación de políticas TLS de CloudFront](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/DownloadDistValuesGeneral.html)).
- El workflow remoto de CI pasó en GitHub. CD permanece desactivada por defecto hasta configurar y proteger el entorno `aws-sandbox` en GitHub.
- El estado de Terraform permanece en el equipo local y contiene metadatos sensibles. No debe subirse al repositorio. Si AWS elimina el sandbox, refresca o elimina el estado antes de usar otro entorno.
