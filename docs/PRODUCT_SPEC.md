# OpsFlow — contrato funcional inicial

## Problema que resuelve

Un equipo pequeño necesita registrar incidentes de sus servicios, saber quién los atiende, coordinar la respuesta y conservar una cronología fiable de lo ocurrido. OpsFlow será la fuente común para ese trabajo y para revisar incidentes después.

## Usuarios y permisos

| Rol | Puede hacer |
| --- | --- |
| Miembro | Ver incidentes y servicios; crear incidentes; asignar o actualizar incidentes; comentar; resolver o reabrir con una razón. |
| Administrador | Todo lo anterior; crear/editar/desactivar servicios y administrar usuarios y roles. |

No habrá registro público. Para la demo se cargarán usuarios de prueba con credenciales documentadas solo en el entorno local.

## Entidades principales

- **Usuario:** nombre, correo, rol y estado activo.
- **Servicio:** nombre, descripción, equipo responsable, criticidad y estado activo.
- **Incidente:** título, descripción, servicio afectado, severidad, estado, creador, responsable, fechas de apertura/actualización/resolución.
- **Comentario:** autor, texto y fecha; no se edita ni se borra desde el flujo normal para preservar el contexto.
- **Evento de incidente:** tipo de cambio, actor, fecha y datos del cambio. Se registra en la misma transacción que el cambio del incidente.

Las contraseñas nunca se almacenan en texto plano. Los secretos no aparecen en logs ni en respuestas de error.

## Flujo de un incidente

`OPEN → ACKNOWLEDGED → MITIGATING → RESOLVED`

- Al crear un incidente queda `OPEN` y se registra el evento de creación.
- Alguien lo toma y pasa a `ACKNOWLEDGED`; puede asignarse a una persona.
- El equipo empieza la mitigación y pasa a `MITIGATING`.
- Se marca `RESOLVED` solo con una nota de resolución.
- Un incidente resuelto se puede reabrir con una razón; vuelve a `ACKNOWLEDGED` y el historial conserva la resolución anterior y la reapertura.
- Las transiciones no permitidas se rechazan sin alterar ni el estado ni el historial.

Severidades: `P1` crítica, `P2` alta, `P3` media y `P4` baja. El producto no calculará impacto automáticamente.

## Flujos que debe completar la aplicación

1. Un miembro inicia sesión y ve el tablero de incidentes activos.
2. Crea un incidente y selecciona un servicio y una severidad.
3. Otro miembro lo asigna, comenta y avanza el estado.
4. El responsable agrega una nota de resolución y cierra el incidente.
5. Un miembro autorizado reabre el incidente con una razón.
6. Un administrador registra un servicio y desactiva otro sin borrar incidentes históricos.
7. El usuario filtra por estado, severidad, servicio y responsable, y busca por texto.
8. El usuario abre un incidente y ve su cronología en orden, con actor y fecha.

## Reglas de integridad

- Todo incidente pertenece a un servicio existente; el servicio desactivado no admite incidentes nuevos.
- Crear un incidente, cambiar su estado, reasignarlo o agregar un comentario produce el evento correspondiente.
- Una falla al escribir el evento revierte el cambio relacionado.
- Los listados usan paginación estable y un orden explícito.
- Las fechas se guardan en UTC y se muestran en la zona local del navegador.
- Los errores de validación explican qué campo corregir sin revelar detalles internos.
- La API y la interfaz son imágenes separadas; ambas se pueden ejecutar en Compose y desplegar en Kubernetes local con configuración externa.

## Fuera del primer alcance funcional

- Integraciones con Slack, correo, PagerDuty u otros sistemas.
- Ingesta automática de alertas por webhook.
- Cálculo de SLA, turnos o escalamiento automático.
- Multi-tenant y facturación.
- Alta disponibilidad o promesas de operación empresarial.

Estos límites mantienen un producto completo para un equipo pequeño sin presentar una demo como plataforma empresarial.

## Criterios de aceptación del flujo principal

- Un usuario puede completar el flujo desde crear hasta resolver y reabrir un incidente desde la interfaz.
- El estado, los comentarios y la cronología persisten tras reiniciar la aplicación y PostgreSQL.
- Un usuario sin permiso recibe una respuesta de acceso denegado y la interfaz no ofrece la acción protegida.
- Una transición inválida no modifica datos.
- Las pruebas de integración verifican persistencia, permisos, transiciones e historial con PostgreSQL real.
- El chart de Helm permite instalar, actualizar y hacer rollback en kind; las probes distinguen liveness de readiness.
