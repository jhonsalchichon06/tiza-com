# ADR 0012: Crédito en horas por cancelación

## Estado

Aceptado

## Contexto

El PRD no permite reembolsos en dinero. Si el cliente cancela una limpieza pagada (hasta 24 horas antes), las horas que pagó pasan a un **crédito en horas** para su siguiente servicio. El crédito vence a los 3 meses de la cancelación que lo generó, se descuenta solo de la siguiente reserva y el saldo se muestra en el perfil.

Hay que resolver varias combinaciones:
- una cancelación antes de que el pago se apruebe;
- una reserva que se pagó en parte con crédito;
- una reserva que se cubre toda con crédito;
- una reserva que usa crédito y después expira o se rechaza.

## Decisión

**Créditos como lotes con vencimiento propio.**
- `creditos_horas`: usuario, reserva de origen, horas iniciales, horas disponibles, `vence_en` (cancelación + 3 meses, en `configuracion`) y fecha de creación.
- `usos_credito`: lote, reserva de destino, horas usadas y estado (`reservado`, `consumido`, `devuelto`).

El saldo visible es la suma de `horas_disponibles` de los lotes con `vence_en > now()`. No se guarda un saldo aparte que pueda desalinearse con los movimientos.

**Cuándo se genera un crédito.** Cuando una reserva queda `cancelada` por el cliente **y** su pago está `aprobado`, sin importar cuál de las dos cosas pasa primero. Las horas del crédito son las horas de trabajo que el cliente pagó en dinero: `horas_trabajo − horas_gratis_aplicadas − credito_aplicado`. Un índice único sobre `creditos_horas(reserva_origen_id)` evita generar dos créditos por la misma cancelación.

**Cómo se usa.** Al crear una reserva, el servidor aplica automáticamente el crédito disponible, empezando por el lote que vence antes. Primero se aplican las horas gratis, si corresponden, y después el crédito (ADR 0008). Las horas aplicadas quedan como uso `reservado` y se descuentan de `horas_disponibles` en la misma transacción, con bloqueo de fila (`SELECT ... FOR UPDATE`) sobre los lotes del cliente, para que dos reservas simultáneas no usen las mismas horas.
- El lote debe estar vigente cuando se **crea** la reserva. Si vence entre la creación y el servicio, el uso se mantiene.
- Si el crédito cubre todas las horas, se crea un pago interno con método `credito`, monto 0 y estado `aprobado`, sin comprobante. La reserva queda `confirmada` sin espera. Este es el único caso en que una reserva se crea sin comprobante; el ADR 0009 sigue valiendo para todo lo demás.

**Qué pasa con un uso según cómo termina la reserva:**
- **Confirmada o completada:** el uso pasa a `consumido`.
- **Expirada o con el pago rechazado al vencer la espera:** el uso pasa a `devuelto` y las horas vuelven a su lote, con su vencimiento original. Rechazar un pago no devuelve las horas por sí solo: vuelven cuando la reserva expira o se cancela. Si la aprobación del pago llega tarde y se crea un nuevo horario con el mismo pago, el crédito de la reserva original se vuelve a tomar del saldo en ese momento; si el cliente ya lo gastó, la reserva se crea igual y el administrador ve las horas faltantes (decisión del usuario, 2026-10-21).
- **Cancelada por el cliente:** las horas pagadas con crédito vuelven a su lote original, con su vencimiento original. Así cancelar y volver a reservar no sirve para alargar el vencimiento. Las horas pagadas en dinero generan un lote nuevo.

**Perfil y administrador.**
- `GET /api/creditos` devuelve el saldo, los lotes con su vencimiento y los movimientos del cliente.
- El perfil muestra el saldo, el próximo vencimiento y el detalle de cada movimiento.
- El portal del administrador muestra el crédito de cada cliente. En v1 el administrador no puede crear ni editar créditos a mano.

**Vencimiento sin tareas programadas.** Un lote vencido simplemente deja de contar en el saldo, porque la condición `vence_en > now()` se evalúa al leer. No hace falta un cron.

## Alternativas consideradas

- **Crédito en soles en vez de horas** — era viable y su valor no cambia según el servicio. No se eligió porque el negocio lo pidió en horas, y las horas son más fáciles de entender para el cliente ("te quedan 3 horas").
- **Un saldo único con un solo vencimiento** — era más simple. No se eligió porque cada cancelación tiene su propio vencimiento de 3 meses, y un saldo único obligaría a que una cancelación nueva alargue o acorte el vencimiento de las anteriores.
- **Devolver las horas con un vencimiento nuevo al cancelar** — era más simple de programar. No se eligió porque permitiría alargar el crédito sin límite cancelando y volviendo a reservar.

## Consecuencias

- El cliente nunca pierde lo pagado por cancelar a tiempo, y el negocio no devuelve dinero.
- El saldo se calcula siempre a partir de los lotes, así que no puede quedar desalineado.
- Una reserva cubierta por completo con crédito se confirma al instante, sin trabajo para el administrador.
- **Más estados y transiciones que probar:** cada cambio de estado de una reserva (confirmar, expirar, rechazar, cancelar) también debe actualizar sus usos de crédito, dentro de la misma transacción. Un error ahí regala horas o las hace desaparecer, así que necesita pruebas de cada combinación.
- Una hora de crédito vale lo mismo en cualquier servicio, aunque en soles una hora de profunda cueste más que una de estándar.
- Si la membresía vence, el crédito sigue existiendo, pero no se puede usar hasta renovar. Si vence antes de renovar, se pierde.
- Falta definir qué pasa cuando la cancelación la causa Tiza (por ejemplo, si no se consigue a la persona de apoyo). Está pendiente en el PRD.
