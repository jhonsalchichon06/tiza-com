# ADR 0006: Resiliencia y manejo de errores proporcional

## Estado

Aceptado. La expiración de reservas se reemplaza por la del ADR 0009 y la falla al subir imágenes se ajusta en el ADR 0010.

## Contexto

El PRD define casos borde que el sistema debe manejar: comprobante pendiente o rechazado, dos clientes que quieren el último cupo de una hora, archivos inválidos, acceso indebido y contraseña olvidada. Todo corre en servicios de plan gratuito (Vercel, Neon, Resend), con límites y, en el caso de Neon, con suspensión tras inactividad. El negocio es pequeño y el equipo es una persona, por lo que la solución debe ser proporcional al riesgo real.

El PRD indica que la reserva gratis queda en espera hasta que el administrador apruebe el pago, y propone liberar el horario a las 24 horas (supuesto sin confirmar). Una restricción de exclusión en PostgreSQL (ADR 0002) no puede depender de la hora actual, así que hace falta un mecanismo explícito para marcar como expirada una reserva pendiente.

## Decisión

**Expiración de reservas pendientes:** la expiración ocurre **al consultar**. Cada vez que se crea una reserva o se consulta la disponibilidad de la agenda, el sistema marca como `expirada` toda reserva pendiente vencida, dentro de la misma operación. No se usan tareas programadas.

**Disponibilidad en la interfaz:** los horarios ocupados se muestran **en gris y deshabilitados**, para dar a entender que no están disponibles. La interfaz debe tener en cuenta la duración del servicio elegido: un horario inicial queda en gris si no hay ningún equipo libre durante toda la duración del servicio más 1 hora de traslado (ADR 0007). La API de disponibilidad solo informa qué horarios están disponibles, sin revelar datos de otros clientes. Aun así, el servidor vuelve a validar al confirmar y rechaza el choque con `409`.

**Política de errores:**
- Errores del usuario (datos inválidos, archivo incorrecto, hora ya tomada): mensaje claro en español, sin perder lo que el cliente escribió.
- Conflicto de reserva: respuesta `409` con un mensaje de que esa hora ya fue tomada y que elija otra.
- Neon dormido tras inactividad: un solo reintento automático y, si falla, el mensaje "inténtalo en unos segundos".
- Falla de Resend: se registra el error y al cliente se le indica que revise su correo o lo intente de nuevo. Nunca se revela si un correo está registrado.
- Falla al subir una imagen: no se crea el pago ni la reserva; un archivo que quedó sin usar se borra en la limpieza diaria (ADR 0010).
- Errores inesperados: se registran en los logs de Vercel y se muestra un mensaje genérico, sin detalles técnicos.
- Sin colas, sin reintentos complejos y sin monitoreo externo en v1.

## Alternativas consideradas

- **Tarea programada diaria (cron de Vercel)** — era viable y limpia la agenda aunque nadie la abra. No se eligió porque, según la documentación de Vercel, en el plan gratuito los cron jobs corren como máximo una vez al día (por verificar), así que un horario podría quedar bloqueado hasta 24 horas de más.
- **Cancelación solo manual por el administrador** — era viable y no requiere programar nada. No se eligió porque depende de que no se olvide, y un cliente podría bloquear horarios sin pagar.

## Consecuencias

- No se necesita ninguna tarea programada, así que funciona dentro del plan gratuito y el horario se libera justo cuando alguien lo necesita.
- Si nadie consulta la agenda, una reserva vencida sigue figurando como pendiente hasta la siguiente consulta, y el administrador la verá como pendiente aunque ya haya vencido.
- Cada consulta de disponibilidad hace una escritura (marcar vencidas), lo que añade carga a la base de datos.
- Los horarios en gris dependen de que la disponibilidad esté actualizada. Por eso la validación final siempre se repite en el servidor.
- Los reintentos limitados mantienen el sistema simple, pero una caída prolongada de Neon, Resend o Blob afecta directamente al cliente, sin respaldo.
