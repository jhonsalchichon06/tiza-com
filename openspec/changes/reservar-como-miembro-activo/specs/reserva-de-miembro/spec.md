## Purpose

Permite que un cliente con membresía activa reserve una limpieza pagada con el 10% de descuento de miembro, siempre dentro de la vigencia de su membresía en la fecha del servicio (PRD, "Alcance" puntos 2 y 4; TECH-DESIGN, "Reservar y pagar una limpieza (miembro activo)"; ADR 0008 y 0009). El crédito en horas lo aplica el ítem #14; aquí solo queda el punto de extensión.

## ADDED Requirements

### Requirement: La misma ruta atiende al miembro

`POST /api/reservas` MUST decidir la rama por las membresías del cliente: si tiene una `activa` (vigente o vencida), MUST crear la reserva de miembro; si no tiene ninguna `activa`, MUST seguir el flujo de la primera membresía sin cambios. La rama de miembro MUST exigir sesión y `application/json` (`415`), MUST ignorar cualquier monto, descuento u horas gratis del cuerpo, y MUST responder `201` con `reserva`, `pago`, `membresia: null` y `whatsapp`. La guarda de `crearPrimeraReserva` que responde `409` "Ya eres miembro" MUST conservarse solo para la carrera en que la membresía se activa entre la decisión de la rama y la transacción.

#### Scenario: Un miembro reserva por la misma ruta

- **WHEN** un cliente con membresía `activa` envía `POST /api/reservas` con servicio, dirección, horario, método y comprobante
- **THEN** responde `201` con una reserva `pendiente` y un pago `pendiente` de concepto `reserva`

#### Scenario: Quien no tiene membresía sigue el flujo de la primera

- **WHEN** un cliente sin ninguna membresía envía la misma petición
- **THEN** se crea la membresía, el pago y la reserva como hasta ahora

#### Scenario: Un monto del cuerpo se ignora

- **WHEN** el cuerpo trae `monto: 1`
- **THEN** el pago y la reserva guardan el monto calculado por el servidor

#### Scenario: Carrera con la activación de la membresía

- **WHEN** la membresía se activa justo después de que el cliente fue enviado a la rama de la primera membresía
- **THEN** la transacción responde `409` con el código `en_espera` y no crea una segunda membresía

### Requirement: Precio con 10% de descuento de miembro

El precio mostrado y guardado MUST ser el de lista con el descuento de miembro de `configuracion` (`descuento_miembro`), calculado por `calcularServicio` sobre las horas a cobrar, redondeado a céntimos. La reserva MUST guardar `precio_lista`, `descuento` y `monto`. El navegador MUST NOT calcular el precio.

#### Scenario: Estándar de 2 dormitorios y 1 baño

- **WHEN** un miembro reserva una limpieza estándar de 2 dormitorios y 1 baño (lista S/ 129)
- **THEN** `precio_lista` es 12900, `descuento` 1290 y `monto` 11610 (S/ 116,10)

#### Scenario: Profunda de 2 dormitorios y 1 baño

- **WHEN** reserva una profunda de 2 dormitorios y 1 baño (lista S/ 193,50) sin horas gratis
- **THEN** el monto es S/ 174,15

#### Scenario: Paquete por horas

- **WHEN** reserva un paquete de 4 horas (lista S/ 129)
- **THEN** el monto es S/ 116,10

#### Scenario: El descuento es un dato

- **WHEN** `descuento_miembro` cambia a 0,15 en `configuracion`
- **THEN** la siguiente reserva usa 15% sin cambiar el código

### Requirement: Pago de la reserva con comprobante y espera de 24 horas

La reserva de miembro con monto mayor que 0 MUST exigir `metodo` (`yape` o `transferencia`) y `comprobante` (ruta ya subida, verificada con `verificarImagenSubida` antes de abrir la transacción). En una sola transacción MUST crear un pago `pendiente` con `concepto = reserva`, `membresia_id` vacío, `monto` igual al de la reserva, y una reserva `pendiente` con `expira_en = now() + espera_pago_horas` de la base, `membresia_id` de la membresía activa que autoriza el servicio, `pago_id` del pago nuevo y `primera_gratis` según la regla. Sin comprobante y con monto mayor que 0, MUST responder `422` con el código `comprobante_requerido` y MUST NOT crear nada.

#### Scenario: Reserva en espera

- **WHEN** un miembro reserva con comprobante válido
- **THEN** la reserva queda `pendiente` con `expira_en` a 24 horas, el pago `pendiente` tiene `concepto = reserva` y `membresia_id` vacío

#### Scenario: Sin comprobante

- **WHEN** un miembro envía la reserva sin comprobante y el monto es mayor que 0
- **THEN** responde `422` con `comprobante_requerido` y no queda pago ni reserva

#### Scenario: Comprobante de otro cliente o inexistente

- **WHEN** la ruta del comprobante está en la carpeta de otro usuario o no existe en Blob
- **THEN** se rechaza como en el flujo de la primera membresía y no se crea nada

#### Scenario: Al aprobar el pago, la reserva se confirma

- **WHEN** el administrador aprueba el pago de concepto `reserva` (flujo del ítem #11)
- **THEN** la reserva pasa a `confirmada` y la membresía no cambia

### Requirement: Vigencia de la membresía en la fecha del servicio

El inicio del servicio MUST ser anterior al `fin` de la membresía `activa` con `fin` más lejano, leída dentro de la misma transacción. Si es igual o posterior, MUST responder `422` con un mensaje que diga hasta qué fecha puede reservar y pida renovar. Con la membresía ya vencida (`fin` pasado) MUST responder el mismo `422` para cualquier fecha. La comparación MUST hacerse entre instantes, no entre fechas.

#### Scenario: Fecha posterior al fin

- **WHEN** la membresía termina el 10 de enero y el cliente elige el 12 de enero
- **THEN** responde `422` con un mensaje que menciona el 10 de enero y pide renovar, y no crea nada

#### Scenario: Justo antes del fin

- **WHEN** el inicio es 30 minutos antes del `fin`
- **THEN** la reserva se acepta

#### Scenario: Exactamente en el fin

- **WHEN** el inicio es igual al `fin`
- **THEN** responde `422`

#### Scenario: Membresía vencida

- **WHEN** el cliente tiene solo una membresía `activa` con `fin` pasado
- **THEN** responde `422` pidiendo renovar y no crea nada

### Requirement: Anticipación, horario y capacidad

La reserva de miembro MUST cumplir las mismas reglas que cualquier reserva nueva: `validarInicioServicio` (lunes a sábado, 8 am a 6 pm, intervalo de 30 minutos y 48 horas de anticipación) antes de la transacción, asignación al primer equipo libre con `insertarEnPrimerEquipoLibre` dentro de `transaccionDeEscritura`, y `409` con el código `conflicto` si no hay cupo.

#### Scenario: Menos de 48 horas

- **WHEN** el inicio cae dentro de las próximas 48 horas
- **THEN** responde `422` y no crea nada

#### Scenario: Sin cupo

- **WHEN** no hay ningún equipo libre en el rango
- **THEN** responde `409` con `conflicto` y no queda pago ni reserva

#### Scenario: Dos peticiones por el último cupo

- **WHEN** dos miembros reservan a la vez el último cupo
- **THEN** una responde `201` y la otra `409`

### Requirement: Una reserva en espera por cliente

El miembro MUST tener como máximo una reserva `pendiente`. Si ya tiene una, la ruta MUST responder `409` con el código `en_espera` y el mensaje "Ya tienes una reserva esperando la aprobación de tu pago.", comprobándolo dentro de la transacción y apoyándose en el índice único `reservas_una_pendiente_por_cliente` ante una carrera.

#### Scenario: Segunda reserva en espera

- **WHEN** un miembro con una reserva `pendiente` vigente intenta crear otra
- **THEN** responde `409` con `en_espera` y no crea nada

#### Scenario: Una reserva confirmada no impide otra

- **WHEN** el miembro tiene una reserva `confirmada` y ninguna `pendiente`
- **THEN** puede reservar otra

#### Scenario: Pendiente vencida

- **WHEN** su reserva `pendiente` ya venció
- **THEN** se marca `expirada` al empezar la transacción y la nueva reserva se acepta

### Requirement: Un pago aprobado esperando horario bloquea reservar otra

Mientras el cliente tenga un pago `aprobado` que `pagosParaElegirHorario` (ítem #12) considere pendiente de horario, `POST /api/reservas` en la rama de miembro MUST responder `409` con el código `horario_pendiente` y el mensaje "Tienes un pago aprobado esperando horario. Elige tu nuevo día y hora desde tu cuenta.", sin crear nada. Un pago cuya reserva canceló el cliente MUST NOT bloquear.

#### Scenario: Aprobación tardía pendiente

- **WHEN** el miembro tiene un pago aprobado cuya reserva expiró y quiere reservar otra limpieza
- **THEN** responde `409` con `horario_pendiente`

#### Scenario: Pago de una cancelación del cliente

- **WHEN** el único pago aprobado sin reserva viva es el de una reserva que el cliente canceló
- **THEN** no bloquea y la reserva se acepta

### Requirement: Limpieza gratis conservada tras cancelar la primera

La rama de miembro MUST decidir las horas gratis con `decidirLimpiezaGratis(tx, usuarioId, claveHogar(dirección))` dentro de la transacción. Un miembro cuya primera limpieza gratis quedó `cancelada` o `expirada`, sin otra reserva `pendiente`, `confirmada` ni `completada`, y cuyo hogar no recibió ya la limpieza gratis de otra cuenta, MUST recibir las 3 horas gratis (`config.horas_gratis`) en su siguiente reserva, con `primera_gratis` verdadero; las horas adicionales se cobran con el descuento. Quien ya tiene una limpieza realizada MUST pagar el servicio completo.

#### Scenario: Primera cancelada, siguiente de 5 horas

- **WHEN** un miembro canceló su primera limpieza y reserva una profunda de 2 dormitorios y 1 baño (5 h, S/ 193,50) en su hogar
- **THEN** la reserva tiene 3 horas gratis, `primera_gratis` verdadero y monto S/ 69,66, y se paga con comprobante

#### Scenario: Primera cancelada, siguiente de 3 horas

- **WHEN** reserva una estándar de 1 dormitorio y 1 baño (3 h)
- **THEN** el monto es 0 y se aplica el escenario de reserva sin pago

#### Scenario: Con una limpieza realizada

- **WHEN** el miembro tiene una reserva `completada`
- **THEN** no recibe horas gratis y paga el precio de lista con descuento

#### Scenario: Hogar ya usado por otra cuenta

- **WHEN** otra cuenta recibió la limpieza gratis de esa dirección
- **THEN** no recibe horas gratis; si el índice único del hogar la rechaza en una carrera, responde `409` con `limpieza_gratis_usada`

#### Scenario: Otra dirección

- **WHEN** el miembro reserva la siguiente en una dirección distinta cuyo hogar no recibió la gratis
- **THEN** la regla se decide con la dirección nueva

### Requirement: Reserva sin pago cuando el monto es 0

Cuando el monto calculado es 0, la reserva de miembro MUST crearse `confirmada`, con `expira_en` vacío y sin pedir comprobante, vinculada a un pago interno nuevo con `concepto = reserva`, `membresia_id` vacío, método `credito`, monto 0 y estado `aprobado`. Un comprobante enviado de más MUST ignorarse y no guardarse. El pago interno MUST crearlo un único módulo reutilizable (`crearPagoInterno`).

#### Scenario: Primera conservada de 3 horas

- **WHEN** el monto es 0
- **THEN** responde `201` con la reserva `confirmada`, sin `expira_en`, y el pago interno `aprobado` de monto 0

#### Scenario: Comprobante de más

- **WHEN** el cuerpo trae un comprobante y el monto es 0
- **THEN** la reserva se confirma y la ruta del comprobante no se guarda en ningún pago

#### Scenario: La regla de espera se comprueba antes del monto

- **WHEN** el miembro ya tiene otra reserva `pendiente`
- **THEN** la reserva de monto 0 también responde `409 en_espera` (la regla de una sola en espera se comprueba antes de calcular el monto)

### Requirement: Cotización de miembro

`GET /api/cotizacion` MUST devolver, para un cliente con membresía `activa`, `modo: "miembro"`, `membresia: null`, `membresia_fin` (ISO con zona), `total_a_pagar` igual al monto de la reserva, `fechas.desde` (primer día con 48 horas de anticipación), `fechas.hasta` (último día civil con inicio anterior al `fin`), `limite` igual al `fin` y las horas gratis según la misma regla de cliente y hogar de la reserva (`aplica_gratis` y `motivo_sin_gratis`). Para quien no tiene membresía activa MUST devolver `modo: "primera"` con el contenido actual. El cálculo MUST pasar `creditoHoras` obtenido de `creditoParaReserva`, que devuelve 0 hasta que el ítem #14 lo reemplace. Con `fin` pasado MUST indicar `membresia_vigente: false`.

#### Scenario: Cotización de un miembro

- **WHEN** un miembro cotiza una estándar de 2 dormitorios y 1 baño
- **THEN** `modo` es `miembro`, `total_a_pagar` es 11610, `membresia` es `null` y `limite` es el `fin`

#### Scenario: Cotización de quien no es miembro

- **WHEN** un cliente sin membresía cotiza
- **THEN** `modo` es `primera` y `total_a_pagar` incluye la membresía

#### Scenario: Con horas gratis conservadas

- **WHEN** el miembro canceló su primera limpieza y cotiza una de 3 horas
- **THEN** `aplica_gratis` es verdadero y `total_a_pagar` es 0

#### Scenario: Membresía vencida

- **WHEN** el `fin` ya pasó
- **THEN** la respuesta trae `membresia_vigente: false` y ninguna fecha reservable

#### Scenario: Punto de extensión del crédito

- **WHEN** `creditoParaReserva` devuelve 2 horas (doble de prueba)
- **THEN** el cálculo resta 2 horas a cobrar y `credito_aplicado` es 2

### Requirement: Mensaje de WhatsApp según el estado

El enlace de WhatsApp de la respuesta MUST decir "en espera de la aprobación de mi pago" cuando la reserva es `pendiente` y "confirmada" cuando nace `confirmada`, sin montos.

#### Scenario: Reserva confirmada

- **WHEN** la reserva nace `confirmada`
- **THEN** el mensaje dice que está confirmada y no menciona la aprobación del pago
