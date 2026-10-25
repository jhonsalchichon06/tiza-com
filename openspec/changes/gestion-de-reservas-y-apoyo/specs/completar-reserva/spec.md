## ADDED Requirements

### Requirement: Marcar una reserva como completada a mano
`POST /api/admin/reservas/:id/completar` MUST permitir al administrador pasar a `completada` una reserva `confirmada` cuyo `inicio` ya ocurrió, comparado con el reloj de la base. MUST ejecutarse en `transaccionDeEscritura`, bloquear la fila de la reserva y responder `404` si no existe o el id no tiene formato de uuid. Para cualquier otro estado o una reserva futura MUST responder `409` con un mensaje propio de cada caso y no modificar nada. MUST NOT cambiar el pago, la membresía ni el equipo, y MUST registrar `actualizada_en`. Solo una reserva `completada` podrá recibir fotos (#17) y reseña (#18).

#### Scenario: Completar una limpieza realizada
- **WHEN** el administrador completa una reserva `confirmada` cuyo servicio empezó hace una hora
- **THEN** la reserva queda `completada`, el pago y la membresía no cambian y la respuesta devuelve la reserva con su estado nuevo

#### Scenario: Servicio futuro
- **WHEN** el administrador intenta completar una reserva `confirmada` que empieza mañana
- **THEN** la respuesta es `409` con el mensaje "El servicio todavía no empieza." y la reserva sigue `confirmada`

#### Scenario: Reserva pendiente
- **WHEN** intenta completar una reserva `pendiente` vigente
- **THEN** la respuesta es `409` con un mensaje que dice que primero debe aprobarse el pago y la reserva no cambia

#### Scenario: Reserva cancelada, expirada o ya completada
- **WHEN** intenta completar una reserva `cancelada`, `expirada` (incluida una `pendiente` cuya espera acaba de vencer) o `completada`
- **THEN** la respuesta es `409` con un mensaje que nombra su estado y la reserva no cambia

#### Scenario: Reserva inexistente
- **WHEN** el id no existe o es `abc`
- **THEN** la respuesta es `404`

#### Scenario: Dos administradores a la vez
- **WHEN** dos administradores completan la misma reserva al mismo tiempo
- **THEN** uno recibe `200` y el otro `409`, y la reserva queda `completada` una sola vez

### Requirement: Completar libera el cupo solo después del servicio
Una reserva `completada` MUST dejar de contar en la restricción de exclusión de equipos (que solo cubre `pendiente` y `confirmada`); como solo se completa un servicio que ya empezó y toda reserva nueva exige 48 horas de anticipación, MUST NOT quedar ninguna reserva futura que choque.

#### Scenario: Cupo liberado
- **WHEN** se completa una reserva cuyo rango bloqueado sigue en curso
- **THEN** ninguna reserva nueva puede crearse en ese rango porque la anticipación mínima de 48 horas lo impide
