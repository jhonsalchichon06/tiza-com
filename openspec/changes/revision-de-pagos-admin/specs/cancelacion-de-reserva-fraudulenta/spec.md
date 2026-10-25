## ADDED Requirements

### Requirement: Cancelar una reserva en espera
`POST /api/admin/reservas/:id/cancelar` MUST permitir al administrador cancelar una reserva `pendiente` vigente. En una transacción de escritura MUST bloquear la reserva, responder `409` si ya no está `pendiente` (incluida una que acaba de expirar o que ya está `confirmada`, `cancelada` o `completada`), marcarla `cancelada` con `cancelada_por = 'admin'` y liberar su horario de inmediato. MUST NOT modificar el pago ni la membresía: el administrador rechaza el pago con la acción de rechazo.

#### Scenario: Cancelar un comprobante falso
- **WHEN** el administrador cancela una reserva `pendiente` vigente
- **THEN** la reserva queda `cancelada` con `cancelada_por = 'admin'` y otro cliente puede reservar ese horario en la misma hora

#### Scenario: El pago no cambia
- **WHEN** se cancela la reserva de un pago `pendiente`
- **THEN** el pago sigue `pendiente` y aparece en la lista como pago sin reserva viva, listo para rechazar

#### Scenario: Reserva que ya expiró
- **WHEN** el administrador intenta cancelar una reserva cuyo plazo venció
- **THEN** la respuesta es `409` con un mensaje que dice que ya expiró y su horario ya está libre

#### Scenario: Reserva confirmada
- **WHEN** se intenta cancelar una reserva `confirmada`
- **THEN** la respuesta es `409` y la reserva no cambia

#### Scenario: Permisos y existencia
- **WHEN** un cliente llama a la ruta, o el id no existe o no tiene formato de uuid
- **THEN** la respuesta es `403` para el cliente y `404` para el id inválido

### Requirement: Quién canceló queda registrado
La tabla de reservas MUST guardar `cancelada_por` (`cliente` o `admin`), vacío mientras la reserva no esté `cancelada`; la base MUST rechazar un valor en una reserva que no está `cancelada`. El ítem #12 MUST guardar `cliente` cuando cancele el cliente; el ítem #14 usa este dato para generar crédito solo si cancela el cliente.

#### Scenario: Valor fuera de lugar
- **WHEN** se intenta guardar `cancelada_por` en una reserva `confirmada`
- **THEN** la base rechaza la operación
