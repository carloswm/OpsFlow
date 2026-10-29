# Estimación inicial de costos de OpsFlow en AWS

Estimación de referencia para la arquitectura de demo en `us-east-1`, calculada el 28 de octubre de 2026 con ejecución continua de 730 horas al mes. No es una cotización ni una garantía del importe final. No considera impuestos, transferencia fuera de AWS, créditos promocionales o Free Tier; la cuenta y región elegidas deben revisarse en AWS Pricing Calculator antes de aplicar Terraform.

| Recurso | Supuesto | Estimación mensual |
| --- | --- | ---: |
| ECS Fargate | 2 tareas Linux/x86, cada una 0.25 vCPU y 0.5 GiB, 730 h | ~$17.80 |
| Application Load Balancer | 1 ALB, 730 h, más LCU según tráfico | ~$16.43 + LCU |
| IPv4 públicas | 2 direcciones para ALB y 2 para tareas Fargate, 730 h | ~$14.60 |
| RDS PostgreSQL | `db.t4g.micro`, Single-AZ, 730 h | ~$11.68 + almacenamiento y respaldos |
| Almacenamiento RDS | 20 GiB gp3 | Confirmar en Calculator |
| Secrets Manager | Secreto maestro de RDS | Confirmar en Calculator |
| CloudWatch Logs | Retención 14 días; costo depende de ingesta | Variable |
| ECR y transferencia | Imágenes y tráfico | Variable |
| **Referencia de presupuesto** | Los valores variables se suman a las filas anteriores | **~$65/mes o más** |

Fargate se calcula por vCPU, memoria, arquitectura y duración de cada tarea. La tarifa publicada para Linux/x86 en N. Virginia permite obtener ~$17.80 para las dos tareas. El ALB cobra horas y LCUs. AWS publica un cargo de $0.005 por dirección IPv4 pública-hora; la aproximación de cuatro direcciones agrega ~$14.60. El valor RDS es una referencia de tarifa por hora para `db.t4g.micro`; validar el costo final del motor y región elegidos en el calculador oficial. Instancias `t4g` pueden sumar cargos por CPU burst por encima de la línea base.

## Controles de costo antes de aplicar

1. Abrir [AWS Pricing Calculator](https://calculator.aws/) y seleccionar N. Virginia (`us-east-1`) o la región que se vaya a usar.
2. Añadir dos tareas Linux/x86 de ECS Fargate con 0.25 vCPU y 0.5 GiB cada una, una ALB, RDS PostgreSQL `db.t4g.micro` Single-AZ con 20 GiB, el secreto, logs y cuatro IPv4 públicas como estimación inicial.
3. Revisar créditos/free tier elegibles en la cuenta; no asumir que están activos ni que cubren todos estos recursos.
4. Contrastar el cálculo con `terraform plan`, límites de servicio y el procedimiento de destrucción.
5. Aplicar solo un plan revisado y ejecutar `terraform destroy` cuando termine la demostración.

La decisión de costo de esta arquitectura es evitar NAT Gateway: las tareas ECS usan subred pública y dirección IPv4 pública para salida, pero sus security groups solo reciben tráfico desde el ALB. PostgreSQL reside en subredes sin ruta a Internet y solo recibe conexiones desde el security group de la API. Para una arquitectura productiva, conviene evaluar tareas en subredes privadas con endpoints de VPC/NAT, TLS con ACM, backups/retención y alta disponibilidad, incorporando esos costos al cálculo.

## Fuentes

- [AWS Fargate pricing](https://aws.amazon.com/fargate/pricing/)
- [AWS Elastic Load Balancing pricing](https://aws.amazon.com/elasticloadbalancing/pricing/)
- [AWS VPC pricing: direcciones IPv4 públicas](https://aws.amazon.com/vpc/pricing/)
- [AWS RDS for PostgreSQL pricing](https://aws.amazon.com/rds/postgresql/pricing/)
- [AWS RDS instance types](https://aws.amazon.com/rds/instance-types/)
- [AWS Pricing Calculator](https://calculator.aws/)
