## Purpose

Permite al cliente cancelar una reserva hasta 24 horas antes del servicio, libera su horario y conserva el beneficio de la limpieza gratis (PRD, "Alcance" punto 7 y caso borde 11; TECH-DESIGN, "Perfil del cliente"; ADR 0008, 0009 y 0012). El crédito en horas por lo pagado lo genera el ítem #14; aquí solo se deja el punto de extensión y un mensaje informativo.

## ADDED Requirements

### Requirement: Cancelar hasta 24 horas antes

`POST /api/reservas/:id/cancelar` MUST exigir sesión y `application/json` (`415` si no), MUST aceptar una reserva `confirmada` o `pendiente` vigente del cliente de la sesión, y MUST rechazar con `409` y el código `fuera_de_plazo` cuando falten menos horas para el `inicio` que `cancelacion_minima_horas` de `configuracion` (24). Exactamente 24 horas antes MUST permitirse. El mensaje MUST ser "Solo puedes cancelar hasta 24 horas antes del servicio. Si necesitas ayuda, escríbenos por WhatsApp." La respuesta MUST incluir el enlace de WhatsApp (`enlaceWhatsapp`, número de `WHATSAPP_NUMERO`) o `null` si el número no está configurado. La operación MUST ir dentro de `transaccionDeEscritura` y bloquear la fila de la reserva (`FOR UPDATE`) filtrada por el dueño.

#### Scenario: Cancelar con más de 24 horas

- **WHEN** el cliente cancela una reserva `confirmada` que empieza dentro de 3 días
- **THEN** responde `200`, la reserva queda `cancelada` y el cuerpo trae su estado nuevo

#### Scenario: Justo 24 horas antes

- **WHEN** faltan exactamente 24 horas
- **THEN** la cancelación se acepta

#### Scenario: Con menos de 24 horas

- **WHEN** faltan 23 horas y 59 minutos
- **THEN** responde `409` con el código `fuera_de_plazo` y el mensaje del WhatsApp, y la reserva no cambia

#### Scenario: El plazo es un dato

- **WHEN** `cancelacion_minima_horas` cambia a 12 en `configuracion`
- **THEN** una reserva que empieza dentro de 13 horas se puede cancelar sin tocar el código

#### Scenario: Cancelar una pendiente vigente

- **WHEN** el cliente cancela una reserva `pendiente` cuyo pago aún no se revisó
- **THEN** la reserva queda `cancelada`, el pago sigue `pendiente` y no se toca la membresía

#### Scenario: Estados que no se pueden cancelar

- **WHEN** la reserva está `completada`, `expirada` o `cancelada` por el administrador
- **THEN** responde `409` con un mensaje que dice por qué, y no escribe nada

#### Scenario: Reserva de otro cliente

- **WHEN** el cliente A cancela el id de una reserva de B
- **THEN** responde `404` y la reserva de B no cambia

#### Scenario: Sin sesión o sin JSON

- **WHEN** se llama sin sesión, o con otro tipo de contenido
- **THEN** responde `401` o `415` respectivamente

### Requirement: La cancelación libera el horario y registra quién canceló

Al cancelar, la reserva MUST pasar a `cancelada` con `cancelada_por = 'cliente'` y `expira_en` vacío, en la misma transacción, de modo que su rango deje de bloquear al equipo de inmediato (la restricción de exclusión solo cubre `pendiente` y `confirmada`). La cancelación MUST NOT modificar el pago ni la membresía.

#### Scenario: Horario libre al instante

- **WHEN** el cliente cancela y otro cliente pide el mismo horario con el cupo que quedó libre
- **THEN** la reserva del otro cliente se acepta

#### Scenario: Quién canceló

- **WHEN** el cliente cancela
- **THEN** `cancelada_por` es `cliente`

#### Scenario: Pago y membresía intactos

- **WHEN** el cliente cancela una reserva con el pago `aprobado`
- **THEN** el pago sigue `aprobado` y la membresía sigue `activa`

### Requirement: Cancelar es idempotente para el mismo cliente

Si la reserva ya está `cancelada` con `cancelada_por = 'cliente'`, la ruta MUST responder `200` con el estado actual sin escribir, para que un reintento tras un corte de conexión durante el `COMMIT` no muestre un error falso. Una cancelada por el administrador MUST responder `409`.

#### Scenario: Reintento tras un corte

- **WHEN** el primer intento se confirmó y la conexión se cortó antes de responder
- **THEN** el reintento responde `200` y no cambia nada

### Requirement: La primera limpieza gratis cancelada no se pierde

Cancelar una reserva con `primera_gratis` verdadero MUST dejar intacto el derecho a las horas gratis: una reserva `cancelada` MUST NOT contar en los índices únicos de `primera_gratis` ni en `decidirLimpiezaGratis`. La respuesta MUST incluir `limpieza_gratis_conservada: true` cuando la cancelada tenía `primera_gratis` y el cliente no tiene otra reserva viva o realizada. Si el cliente tiene una reserva `completada`, la siguiente reserva MUST NOT recibir las horas gratis.

#### Scenario: Siguiente reserva con las horas gratis

- **WHEN** el cliente cancela su primera limpieza gratis y no tiene otra reserva viva ni realizada
- **THEN** `decidirLimpiezaGratis` para su hogar devuelve verdadero y la respuesta trae `limpieza_gratis_conservada: true`

#### Scenario: Ya tiene una limpieza realizada

- **WHEN** el cliente tiene una reserva `completada` y cancela otra con `primera_gratis`
- **THEN** `decidirLimpiezaGratis` devuelve falso y la respuesta trae `limpieza_gratis_conservada: false`

#### Scenario: El hogar ya la recibió otra cuenta

- **WHEN** otra cuenta recibió la limpieza gratis del mismo hogar después de la cancelación
- **THEN** `decidirLimpiezaGratis` devuelve falso para este cliente

#### Scenario: Cancelar y reservar no duplica la oferta

- **WHEN** el cliente cancela su primera limpieza y crea otra reserva con las horas gratis
- **THEN** solo hay una reserva `primera_gratis` viva o realizada

### Requirement: Mensaje informativo del crédito en horas

Después de cancelar una reserva cuyo pago está `aprobado` y con horas pagadas en dinero (horas de trabajo menos horas gratis menos crédito aplicado, mayor que 0), la respuesta MUST incluir `horas_pagadas` y el perfil MUST decir "Las horas que pagaste quedarán como crédito para tu próxima limpieza." Este ítem MUST NOT crear lotes, usos ni saldo de crédito; deja un punto de extensión comentado en la transacción para el ítem #14. Si el pago aún está `pendiente`, el mensaje MUST ser "Si se aprueba tu pago, las horas quedarán como crédito." Si el pago está `rechazado` o no hubo horas pagadas, no hay mensaje de crédito.

#### Scenario: Pago aprobado con horas pagadas

- **WHEN** el cliente cancela una limpieza pagada y aprobada de 4 horas de trabajo sin horas gratis
- **THEN** la respuesta trae `horas_pagadas: 4` y el perfil muestra el mensaje del crédito

#### Scenario: Primera limpieza de 3 horas

- **WHEN** el cliente cancela una primera limpieza de 3 horas con 3 horas gratis
- **THEN** `horas_pagadas` es 0 y no hay mensaje de crédito

#### Scenario: Primera limpieza con horas adicionales

- **WHEN** el cliente cancela una primera limpieza de 5 horas con 3 horas gratis y el pago aprobado
- **THEN** `horas_pagadas` es 2 y el mensaje del crédito se muestra

#### Scenario: Pago pendiente

- **WHEN** el cliente cancela con el pago `pendiente`
- **THEN** el mensaje es "Si se aprueba tu pago, las horas quedarán como crédito."

#### Scenario: No se escribe crédito

- **WHEN** se cancela cualquier reserva
- **THEN** no se inserta ninguna fila en `creditos_horas` ni en `usos_credito`

### Requirement: Concurrencia con la revisión del administrador

La cancelación MUST bloquear la fila de la reserva. Si el administrador aprueba el pago a la vez, el resultado MUST ser coherente: o la reserva se confirma y después se cancela, o se cancela y la aprobación no la vuelve a `confirmada` (el `UPDATE` de la aprobación solo toca `pendiente`).

#### Scenario: Cancelar y aprobar al mismo tiempo

- **WHEN** el cliente cancela una reserva `pendiente` y el administrador aprueba su pago en el mismo instante
- **THEN** la reserva termina `cancelada`, el pago `aprobado` y ninguna operación deja el horario ocupado por una reserva `cancelada`
