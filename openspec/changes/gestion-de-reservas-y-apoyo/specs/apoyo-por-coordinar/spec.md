## ADDED Requirements

### Requirement: Lista de apoyo por coordinar
`GET /api/admin/apoyo` MUST devolver las reservas vivas (`confirmada` o `pendiente` vigente) con `requiere_apoyo = true` y `apoyo_estado = 'por_coordinar'`, ordenadas por `inicio` ascendente, con cliente, dirección, `inicio`, `fin`, horas de trabajo y de agenda, estado de la reserva, la nota actual y los días que faltan para el servicio (calculados con el reloj de la base y la zona de Lima). MUST excluir las reservas `completada`, `cancelada`, `expirada` (incluida una `pendiente` vencida) y las de `apoyo_estado = 'coordinado'`. La persona de apoyo NO es parte del equipo ni ocupa cupo: el sistema solo marca y recuerda (ADR 0008).

#### Scenario: Orden por fecha
- **WHEN** hay tres reservas de profunda del nivel 4 que requieren apoyo, con servicio el jueves, el martes y el lunes
- **THEN** la lista las devuelve lunes, martes, jueves

#### Scenario: Solo las que faltan por coordinar
- **WHEN** una reserva con apoyo ya está `coordinado`, otra está `cancelada` y otra `expirada`
- **THEN** ninguna aparece en la lista

#### Scenario: Reserva sin apoyo
- **WHEN** una estándar de 4 horas no requiere apoyo
- **THEN** no aparece en la lista

#### Scenario: Una espera vencida no aparece
- **WHEN** una reserva `pendiente` que requiere apoyo tiene la espera vencida
- **THEN** no aparece en la lista aunque nadie la haya marcado `expirada`

### Requirement: Acceso a reprogramar desde la lista de apoyo
Si el administrador no consigue a la persona de apoyo, la salida acordada es reprogramar con el cliente y conservar el pago (decisión del 2026-10-21, pendiente de confirmar por el negocio; PRD, alcance 4). Cada fila de `GET /api/admin/apoyo` MUST incluir `puede_reprogramar`, el celular del cliente y los datos mínimos para la acción de la capacidad `reprogramacion-admin`; la pantalla `/admin/apoyo` MUST ofrecer "Reprogramar" en cada fila. El sistema MUST NOT imponer una fecha límite para conseguir al apoyo ni avisar solo al cliente; los días que faltan siguen mostrándose para empujar al administrador.

#### Scenario: Fila con acceso a reprogramar
- **WHEN** hay una reserva futura `confirmada` por coordinar
- **THEN** su fila trae `puede_reprogramar = true` y la pantalla muestra "Reprogramar"

#### Scenario: Vuelve a la lista tras reprogramar
- **WHEN** el administrador reprograma una reserva con apoyo ya `coordinado`
- **THEN** reaparece en la lista como `por_coordinar` con su nota y el nuevo horario

#### Scenario: Sin plazo máximo
- **WHEN** quedan 2 días para una reserva con apoyo por coordinar
- **THEN** la lista solo muestra "faltan 2 días"; no se cancela ni se reprograma sola

### Requirement: Marcar el apoyo como coordinado con una nota
`POST /api/admin/reservas/:id/apoyo` con `{ "nota": "<texto>" }` MUST pasar `apoyo_estado` a `coordinado` y guardar la nota en `apoyo_nota`, en `transaccionDeEscritura` con la fila bloqueada. La nota MUST ser un texto de hasta 500 caracteres, recortado; puede ir vacía. La reserva MUST requerir apoyo y estar viva; si no, MUST responder `409` (no requiere apoyo, o su estado) y `404` si no existe o el id no tiene formato de uuid. Repetir la acción sobre una reserva ya `coordinado` MUST ser válido y solo actualiza la nota. La acción MUST NOT cambiar el equipo, el horario, el precio ni el estado de la reserva.

#### Scenario: Marcar con nota
- **WHEN** el administrador marca una reserva con apoyo con la nota "María Pérez, 987654321, confirmó para el lunes"
- **THEN** `apoyo_estado` queda `coordinado`, `apoyo_nota` guarda el texto y la reserva sale de la lista de por coordinar

#### Scenario: Sin nota
- **WHEN** marca el apoyo con la nota vacía
- **THEN** queda `coordinado` y `apoyo_nota` queda vacía

#### Scenario: Corregir la nota
- **WHEN** repite la acción sobre una reserva ya `coordinado` con otra nota
- **THEN** la respuesta es `200`, `apoyo_estado` sigue `coordinado` y la nota nueva reemplaza a la anterior

#### Scenario: Nota demasiado larga
- **WHEN** la nota tiene 501 caracteres
- **THEN** la respuesta es `422` y nada cambia

#### Scenario: La reserva no requiere apoyo
- **WHEN** se marca el apoyo de una reserva con `requiere_apoyo = false`
- **THEN** la respuesta es `409` con el mensaje "Esta reserva no requiere apoyo." y la base no cambia

#### Scenario: Reserva que ya no está viva
- **WHEN** la reserva está `completada`, `cancelada` o `expirada`
- **THEN** la respuesta es `409` con un mensaje que nombra su estado

#### Scenario: Reserva inexistente
- **WHEN** el id no existe o es `abc`
- **THEN** la respuesta es `404`

#### Scenario: Permisos
- **WHEN** un cliente o un visitante llama a la ruta
- **THEN** la respuesta es `403` o `401` y no se escribe nada
