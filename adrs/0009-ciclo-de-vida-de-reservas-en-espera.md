# ADR 0009: Ciclo de vida de las reservas en espera de pago

## Estado

Aceptado. Ajusta la expiración al consultar del ADR 0006.

## Contexto

Toda reserva nueva queda en espera (`pendiente`) hasta que el administrador aprueba su pago, por un máximo de 24 horas (ADR 0008). La decisión del ADR 0006 dejaba varios huecos:

- **Aprobación tardía.** La expiración solo ocurría al consultar la agenda. El administrador podía aprobar un pago cuya reserva ya llevaba más de 24 horas y confirmar un horario que quizá ya era de otro cliente.
- **Reservas muy próximas.** Si el cliente reservaba para dentro de pocas horas, la espera de 24 horas terminaba después del servicio.
- **Bloqueo sin pagar.** Una reserva pendiente ocupa su horario hasta 24 horas, el registro no verifica el correo y no había límite de reservas pendientes por cliente. Con 2 equipos y unas 10 horas al día, unas pocas cuentas desechables podían ocupar la semana entera sin pagar nada.
- **Falta de datos.** El modelo no guardaba cuándo vence la espera de cada reserva.

El PRD se actualizó con estas reglas: anticipación mínima de 48 horas, una sola reserva en espera por cliente, la reserva se crea solo junto con su comprobante, y si el pago se aprueba tarde vale igual y el cliente elige un nuevo horario.

## Decisión

**La espera queda guardada.** `reservas.expira_en` se fija al crear la reserva con `now()` + espera máxima (24 h, en `configuracion`), y se borra al confirmarla. Si el cliente sube otro comprobante tras un rechazo, el plazo **no** se extiende.

**Anticipación mínima de 48 horas** para toda reserva nueva y para el nuevo horario de una reprogramación. Como la espera máxima es de 24 horas, siempre termina antes del servicio. Los horarios que no cumplen la anticipación se muestran en gris.

**La reserva y su comprobante se crean juntos.** `POST /api/reservas` recibe los datos de la reserva **y** la referencia del comprobante ya subido (ADR 0010). En una sola transacción crea el pago (y la membresía, si es la primera) y después la reserva. Sin comprobante no hay reserva (`422`). Hay dos excepciones, porque en ellas no queda nada que pagar: una reserva cubierta por completo con crédito en horas (ADR 0012) y el reuso de la limpieza gratis cuando el monto es 0 (ADR 0008). En ambas, la reserva se crea `confirmada`, sin espera.

**Una sola reserva en espera por cliente:** índice único parcial `reservas(usuario_id) WHERE estado = 'pendiente'`. Un segundo intento responde `409` con un mensaje que explica que ya hay una reserva esperando la aprobación del pago.

**Las reservas vencidas se ignoran al leer y se marcan al escribir:**
- **Lecturas** (disponibilidad, perfil, listados del administrador): una reserva cuenta como activa solo si es `confirmada`, o `pendiente` con `expira_en > now()`. Leer no escribe nada, así que el administrador nunca ve como pendiente una reserva vencida.
- **Escrituras** que pueden chocar con la restricción de exclusión (crear, reprogramar, reasignar, aprobar o rechazar un pago, cancelar): al empezar la transacción se ejecuta `UPDATE reservas SET estado = 'expirada' WHERE estado = 'pendiente' AND expira_en <= now()`. Es necesario porque la restricción de exclusión no puede depender de `now()`. En la misma sentencia, o justo después, las horas de crédito reservadas por esas reservas vuelven a sus lotes (ADR 0012).

**Aprobar un pago**, en una sola transacción: marcar las vencidas → pago `aprobado` → si el concepto incluye la membresía, membresía `activa` con `inicio = now()` y `fin` según la duración configurada → reservas `pendiente` de ese pago pasan a `confirmada`.
- Si la reserva ya expiró, el pago se aprueba igual. El perfil muestra "Elige un nuevo día y hora" mientras el pago esté aprobado y no tenga ninguna reserva viva o realizada. La nueva reserva apunta a ese mismo pago, se crea directamente `confirmada` (sin espera) y debe cumplir la anticipación y la vigencia.

**Rechazar un pago:** el pago queda `rechazado` y la reserva sigue `pendiente` hasta su `expira_en`. El cliente puede subir otro comprobante en ese plazo. Si el comprobante es claramente falso, el administrador puede **cancelar** la reserva desde el portal para liberar el horario de inmediato. **Actualización (2026-10-21):** Si el pago se rechaza y la reserva ya expiró, el cliente tiene **7 días corridos desde el rechazo** para subir otro comprobante (plazo guardado en `configuracion`, no en el código). Si se aprueba, rige la aprobación tardía: la membresía se activa y elige un nuevo día y hora sin volver a pagar. Si pasan los 7 días sin un comprobante nuevo, la membresía en espera se cierra y el cliente puede empezar de nuevo con una reserva y un pago nuevos. **Cancelación y reuso del pago (2026-10-21):** una reserva expirada o cancelada por el administrador libera su pago para otro horario; una cancelada por el cliente NO lo libera, porque su pago pasa a crédito en horas (ADR 0012). El índice único `reservas_un_pago_por_reserva_viva` no distingue esos casos, así que lo hace cumplir el servidor con `cancelada_por`.

**Asignación de equipo dentro de la transacción:** cada intento de insertar con un equipo va dentro de un `SAVEPOINT`. Si la restricción de exclusión lo rechaza (error `23P01`), se vuelve al savepoint y se prueba el siguiente equipo (ADR 0007). Todo esto exige transacciones interactivas, así que estas rutas usan el driver de Neon con WebSocket (`Pool`), no el driver HTTP, que solo permite lotes de sentencias.

## Alternativas consideradas

- **Mantener la expiración solo al consultar la agenda (ADR 0006 tal cual)** — no se eligió por el problema de la aprobación tardía y porque el administrador veía reservas vencidas como pendientes.
- **Espera variable (24 horas o hasta 12 horas antes del servicio, lo que ocurra primero)** — era viable y permitía reservar con menos anticipación. No se eligió porque complica la regla y le da menos tiempo al administrador para revisar.
- **Bloquear la aprobación si la reserva expiró** — era viable y más simple. No se eligió porque castiga al cliente por la demora del administrador, cuando el cliente sí pagó.
- **Verificar el correo antes de permitir reservar** — era viable y frena las cuentas desechables. No se eligió porque agrega un paso al flujo de un público de 30 a 70 años, y la regla de "comprobante obligatorio más una sola reserva en espera" ya sube el costo de abusar.

## Consecuencias

- Nunca se confirma un horario vencido, y el administrador ve el estado real de cada reserva sin esperar a que alguien consulte la agenda.
- Bloquear un horario cuesta subir una imagen por cuenta, y cada cuenta bloquea como máximo un horario.
- Las lecturas ya no escriben, lo que quita la escritura en cada consulta de disponibilidad que mencionaba el ADR 0006.
- **Costo para el cliente:** no puede reservar para mañana ni para pasado mañana temprano. Un cliente que necesita una limpieza urgente queda fuera del sistema y tiene que escribir por WhatsApp.
- **Riesgo que queda:** alguien con varias cuentas y comprobantes falsos todavía puede bloquear algunos horarios hasta que el administrador los cancele. Para frenarlo se necesita un límite de registros por IP (pendiente, junto con el límite de intentos del ADR 0005).
- Si el administrador no revisa los domingos, lo pagado el sábado en la tarde expira. El pago sigue valiendo, pero el cliente debe elegir otro horario.
- Hay que usar dos drivers de Neon (HTTP para lecturas simples y WebSocket para transacciones), o solo el de WebSocket, que tiene algo más de latencia en el primer uso.
- La condición "pendiente con `expira_en > now()`" debe repetirse en todas las lecturas. Conviene centralizarla en una vista o una función, para que ninguna consulta la olvide.
