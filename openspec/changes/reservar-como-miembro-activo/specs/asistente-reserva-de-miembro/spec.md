## Purpose

Pantallas para que un miembro reserve y elija un nuevo horario, sobre el asistente `/reservar` del ítem #9b y el perfil del #12. Toda cifra y regla viene del servidor (ADR 0008).

## ADDED Requirements

### Requirement: `/reservar` según la membresía

`decidirVista` MUST devolver `miembro` cuando el cliente tiene una membresía `activa` vigente, `pago_en_revision` si solo tiene una `pendiente`, `membresia_vencida` si su única `activa` está vencida, `asistente` si no tiene membresía y `redirigir` sin sesión. La vigencia MUST llegar calculada por la base. La vista `miembro` MUST mostrar el asistente en modo miembro; `membresia_vencida` MUST mostrar "Tu membresía venció el {fecha}" con el enlace a `/cuenta` y sin asistente.

#### Scenario: Miembro vigente

- **WHEN** un cliente con membresía `activa` vigente abre `/reservar`
- **THEN** ve el asistente y no el mensaje "Ya eres miembro"

#### Scenario: Membresía vencida

- **WHEN** su membresía venció
- **THEN** ve el mensaje de renovar con el enlace a `/cuenta`

#### Scenario: Activa y pendiente

- **WHEN** tiene una `activa` vigente y otra `pendiente`
- **THEN** gana la activa

### Requirement: Asistente en modo miembro

Con `cotizacion.modo = "miembro"` el asistente MUST mostrar el resumen con "Descuento de miembro", sin la línea de la membresía, MUST limitar los días a `fechas.desde` y `fechas.hasta` y los horarios a los anteriores a `limite`, y MUST mostrar en el paso de pago solo el monto de la limpieza con el QR, la CCI y el aviso de demostración. Si `total_a_pagar` es 0, MUST omitir la elección de método y la subida de comprobante y mostrar "Esta limpieza no tiene costo". `confirmarReserva` MUST permitir confirmar sin archivo ni método cuando el monto es 0, y MUST distinguir los `409` por su código: `conflicto` (otra hora, conservando el comprobante), `en_espera` y `horario_pendiente` (bloqueado, con enlace al perfil), `limpieza_gratis_usada` y `422 comprobante_requerido` (volver al paso de pago).

#### Scenario: Resumen con descuento

- **WHEN** el miembro termina el paso del tamaño
- **THEN** ve el precio de lista, el descuento y el total que calculó el servidor

#### Scenario: Monto 0

- **WHEN** la cotización trae `total_a_pagar` 0
- **THEN** el paso de pago no pide método ni comprobante y el botón confirma directamente

#### Scenario: Pantalla final de reserva confirmada

- **WHEN** la respuesta trae una reserva `confirmada`
- **THEN** la pantalla final dice que la limpieza está confirmada y no habla de la revisión del pago

#### Scenario: Pantalla final de reserva en espera

- **WHEN** la reserva está `pendiente`
- **THEN** muestra el texto de espera del plazo y el aviso de demostración

#### Scenario: Pago aprobado esperando horario

- **WHEN** el servidor responde `409 horario_pendiente`
- **THEN** el asistente muestra el mensaje con el enlace a la pantalla del nuevo horario y no ofrece reintentar

#### Scenario: Sin ninguna cifra en el código

- **WHEN** se revisan los componentes del modo miembro
- **THEN** ninguno contiene el 10%, un precio ni un plazo escritos

### Requirement: Pantalla del nuevo horario

`/cuenta/nuevo-horario/[pagoId]` MUST ser una página de servidor que exija sesión (redirige a `/ingresar`), cargue los datos con las mismas funciones de `src/lib/` que la API, muestre el servicio, la dirección y "Ya pagaste esta limpieza: no tienes que pagar otra vez", deje elegir fecha y hora entre los horarios de `GET .../disponibilidad` (en gris los que no caben o están a menos de 48 horas, y los posteriores a `limite`) y confirme con `POST .../nuevo-horario`. MUST llamar a `notFound()` si el pago no es del cliente y mostrar el mensaje de `pago_en_credito` cuando corresponda. El aviso "Elige un nuevo día y hora" del perfil MUST enlazar aquí.

#### Scenario: Elegir el nuevo horario

- **WHEN** el cliente elige un horario libre y confirma
- **THEN** ve la reserva confirmada, sin subir comprobante

#### Scenario: Pago de otro cliente

- **WHEN** abre la pantalla con el pago de otro cliente
- **THEN** ve la página no encontrada

#### Scenario: Sin cupo al confirmar

- **WHEN** el servidor responde `409 conflicto`
- **THEN** vuelve a la lista de horarios con el mensaje y puede elegir otro

#### Scenario: Doble clic

- **WHEN** el cliente pulsa dos veces confirmar
- **THEN** se envía una sola petición
