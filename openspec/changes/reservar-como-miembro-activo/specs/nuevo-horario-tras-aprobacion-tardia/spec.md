## Purpose

Cuando el administrador aprueba un pago después de que su reserva expiró, el cliente elige un nuevo día y hora y la nueva reserva usa el mismo pago, sin otro comprobante (PRD, caso borde 8; ADR 0009; TECH-DESIGN, "Portal de administrador"). El ítem #11 deja el pago `aprobado`; el #12 muestra el aviso; este ítem crea la reserva.

## ADDED Requirements

### Requirement: Qué pagos admiten un nuevo horario

Un pago MUST admitir un nuevo horario solo si es del cliente de la sesión, está `aprobado`, no tiene ninguna reserva `pendiente` vigente, `confirmada` ni `completada`, y su reserva más reciente está `expirada` o `cancelada` por el administrador. Un pago cuya reserva más reciente fue `cancelada` por el cliente MUST NOT admitirlo: esas horas pasan a crédito (ítem #14). La regla MUST ser la de `pagosParaElegirHorario` (#12), sin reescribirla.

#### Scenario: Reserva expirada y pago aprobado tarde

- **WHEN** el pago está `aprobado` y su única reserva está `expirada`
- **THEN** admite un nuevo horario

#### Scenario: Reserva cancelada por el administrador

- **WHEN** la reserva fue cancelada por el administrador por comprobante falso y el pago se aprobó después
- **THEN** admite un nuevo horario

#### Scenario: Reserva cancelada por el cliente

- **WHEN** la reserva más reciente fue cancelada por el cliente
- **THEN** responde `409` con el código `pago_en_credito` y el mensaje "Las horas de esa cancelación pasan a tu crédito. Úsalo en tu próxima reserva." y no crea nada

#### Scenario: Pago pendiente, rechazado o ya usado

- **WHEN** el pago está `pendiente` o `rechazado`, o ya tiene una reserva viva o realizada
- **THEN** responde `409` y no crea nada

### Requirement: Datos del nuevo horario

`GET /api/pagos/:id/nuevo-horario` MUST exigir sesión, responder `404` para un id que no es uuid, inexistente o de otro cliente (la condición del dueño va en la misma consulta), y devolver, si el pago admite un nuevo horario, el servicio, la dirección tal como se escribió, las horas gratis, el monto ya pagado, `fechas.desde`, `fechas.hasta` y `limite` (el `fin` de la membresía). `GET /api/pagos/:id/nuevo-horario/disponibilidad?fecha=` MUST devolver los horarios del día calculados con las `horas_agenda` guardadas de la reserva original, sin parámetros de servicio.

#### Scenario: Pago de otro cliente

- **WHEN** un cliente abre el pago de otro
- **THEN** responde `404`, igual que para un id inexistente o `abc`

#### Scenario: Un administrador que no es el dueño

- **WHEN** un administrador abre el pago de un cliente por esta ruta
- **THEN** responde `404`

#### Scenario: Horarios con las horas guardadas

- **WHEN** `configuracion` cambió después de la reserva original
- **THEN** los horarios se calculan con las `horas_agenda` guardadas

#### Scenario: Fecha inválida

- **WHEN** `fecha` es `2026-02-30`
- **THEN** responde `422`

### Requirement: Crear la reserva con el mismo pago

`POST /api/pagos/:id/nuevo-horario` MUST exigir sesión y `application/json` (`415`), recibir solo `inicio` (instante ISO con zona), y dentro de `transaccionDeEscritura` bloquear el pago del dueño (`FOR UPDATE`), comprobar las condiciones del primer requisito y crear una reserva `confirmada`, con `expira_en` vacío, `pago_id` igual al del pago, `membresia_id` de la membresía `activa` con `fin` más lejano y asignada al primer equipo libre. MUST copiar de la reserva original el tipo, dormitorios, baños, horas de trabajo y de agenda, apoyo, dirección completa, precio de lista, horas gratis, crédito, descuento, monto y `primera_gratis`, sin recalcular precios. MUST NOT pedir ni aceptar comprobante, monto ni método. Un `apoyo_estado` MUST quedar `por_coordinar` si requiere apoyo. La respuesta MUST ser `201` con la reserva, el pago y el enlace de WhatsApp.

#### Scenario: Nuevo horario sin otro comprobante

- **WHEN** el cliente elige un horario válido para un pago aprobado con reserva expirada
- **THEN** responde `201`, la reserva nace `confirmada` con el mismo `pago_id`, y no se crea ningún pago nuevo

#### Scenario: Se conservan servicio, dirección y montos

- **WHEN** la reserva original era una profunda de 5 horas con 3 horas gratis y monto S/ 69,66
- **THEN** la nueva conserva servicio, dirección, 3 horas gratis, `primera_gratis` y monto

#### Scenario: La reserva expirada no se toca

- **WHEN** se crea la nueva reserva
- **THEN** la original sigue `expirada`

#### Scenario: Con un comprobante en el cuerpo

- **WHEN** el cuerpo trae `comprobante` o `monto`
- **THEN** se ignoran y no se guardan

#### Scenario: Pago de una reserva de miembro

- **WHEN** el pago es de concepto `reserva` y se aprobó tarde
- **THEN** la nueva reserva se crea igual, vinculada a la membresía activa del cliente

#### Scenario: Reintento tras un corte durante el COMMIT

- **WHEN** el primer intento sí se confirmó y la ruta lo repite
- **THEN** responde `409` (el pago ya tiene una reserva) y no duplica nada

### Requirement: Anticipación, vigencia y capacidad del nuevo horario

El nuevo horario MUST cumplir `validarInicioServicio` con las `horas_agenda` guardadas (lunes a sábado, 8 am a 6 pm, intervalo de 30 minutos, 48 horas de anticipación) y MUST empezar antes del `fin` de la membresía; si no, `422` con la fecha límite y la petición de renovar. Sin cupo MUST responder `409` con `conflicto` y el pago MUST quedar intacto para volver a intentar.

#### Scenario: Menos de 48 horas

- **WHEN** el inicio cae dentro de las próximas 48 horas
- **THEN** responde `422`

#### Scenario: Posterior al fin de la membresía

- **WHEN** el inicio es igual o posterior al `fin`
- **THEN** responde `422` pidiendo renovar y el pago sigue aprobado

#### Scenario: Sin cupo

- **WHEN** no hay equipo libre
- **THEN** responde `409` con `conflicto`, no se crea la reserva y el pago puede usarse de nuevo

#### Scenario: Dos intentos a la vez con el mismo pago

- **WHEN** el cliente envía dos veces el mismo pago a la vez
- **THEN** una responde `201` y la otra `409`, y solo existe una reserva viva para el pago

#### Scenario: La limpieza gratis fue tomada por otra cuenta

- **WHEN** la original era `primera_gratis` y otra cuenta recibió la gratis del mismo hogar mientras tanto
- **THEN** responde `409` con `limpieza_gratis_usada` y el mensaje pide escribir por WhatsApp, sin crear nada
