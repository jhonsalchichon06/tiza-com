## ADDED Requirements

### Requirement: Reasignar una reserva a otro equipo si está libre
`POST /api/admin/reservas/:id/reasignar` con `{ "equipo_id": <número> }` MUST mover una reserva viva (`confirmada` o `pendiente` vigente) a otro equipo **activo** solo si ese equipo está libre durante todo el rango bloqueado de la reserva (ADR 0007). MUST ejecutarse en `transaccionDeEscritura`, bloquear la reserva y hacer el `UPDATE` dentro de un `SAVEPOINT`; la decisión de "está libre" MUST ser de la restricción de exclusión de la base (error `23P01`), no de una consulta previa. Si está ocupado MUST responder `409` con el código `equipo_ocupado` y el mensaje "Ese equipo no está libre en ese horario." sin modificar nada. El rango, el estado, el pago y `expira_en` MUST NOT cambiar.

#### Scenario: Equipo destino libre
- **WHEN** el administrador reasigna una reserva `confirmada` del equipo 1 al equipo 2 y el equipo 2 no tiene reservas que choquen
- **THEN** la reserva queda en el equipo 2 con el mismo horario y estado

#### Scenario: Equipo destino ocupado
- **WHEN** el equipo 2 tiene una reserva activa cuyo rango bloqueado se solapa con el de la reserva
- **THEN** la respuesta es `409` `equipo_ocupado` y la reserva sigue en el equipo 1

#### Scenario: Cabe justo después del traslado
- **WHEN** el equipo destino termina su traslado exactamente cuando empieza la reserva
- **THEN** la reasignación se acepta

#### Scenario: Mismo equipo
- **WHEN** el equipo destino es el que ya tiene la reserva
- **THEN** la respuesta es `422` con el mensaje "La reserva ya está en ese equipo." y no se escribe nada

#### Scenario: Equipo inexistente o inactivo
- **WHEN** el `equipo_id` no existe o el equipo no está activo
- **THEN** la respuesta es `422` con el mensaje "Elige un equipo activo." y no se escribe nada

#### Scenario: Reserva que no admite reasignación
- **WHEN** la reserva está `completada`, `cancelada`, `expirada` (incluida una `pendiente` vencida) o no existe
- **THEN** la respuesta es `409` para los tres primeros casos con un mensaje que nombra su estado, y `404` si no existe o el id no tiene formato de uuid

#### Scenario: Cuerpo mal formado
- **WHEN** el cuerpo no es JSON, no es un objeto o `equipo_id` no es un entero positivo
- **THEN** la respuesta es `415` si no es JSON y `422` en los demás casos

#### Scenario: Dos reasignaciones por el mismo hueco
- **WHEN** dos administradores mueven dos reservas distintas al mismo hueco del equipo 2 a la vez
- **THEN** una recibe `200` y la otra `409` `equipo_ocupado`, y el equipo 2 nunca tiene dos reservas activas solapadas

#### Scenario: Una reserva nueva gana el último hueco
- **WHEN** una reserva nueva ocupa el hueco del equipo destino entre la lectura del administrador y su acción
- **THEN** la reasignación responde `409` `equipo_ocupado` porque la base la rechaza
