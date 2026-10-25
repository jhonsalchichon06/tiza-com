## Purpose

Da al cliente la pantalla para subir otro comprobante cuando el administrador rechazó el anterior, dentro del plazo (PRD, caso borde 1; ADR 0009 y 0010). La lógica del reenvío (`POST /api/pagos`, el plazo y el cierre de la membresía) es del ítem #11; este change solo agrega la pantalla y el texto del plazo que el #11 le dejó al #12.

## ADDED Requirements

### Requirement: Subir otro comprobante desde el perfil

Cuando el cliente tiene un pago `rechazado` dentro del plazo (según `pagosRechazadosReenviables`), el perfil MUST mostrar un formulario para elegir Yape o transferencia y una imagen JPG, PNG o WebP de hasta 5 MB. El archivo MUST validarse y comprimirse en el navegador y subirse directo a la tienda privada con el token de `POST /api/subidas`, reutilizando `subirComprobante` y `subirImagen`; después MUST llamarse a `POST /api/pagos` con `pago_id`, `metodo` y la ruta del comprobante. El navegador MUST NOT enviar un monto. Un archivo de otro tipo o de más de 5 MB MUST rechazarse antes de subir nada, con un mensaje claro, y MUST NOT crearse ningún pago.

#### Scenario: Reenvío exitoso

- **WHEN** el cliente elige una imagen válida y confirma
- **THEN** se crea el pago nuevo, el perfil pasa a "Tu pago está en revisión" y desaparece el botón

#### Scenario: Archivo inválido

- **WHEN** el cliente elige un PDF o una imagen de 6 MB
- **THEN** ve el mensaje del archivo y no se llama a `POST /api/pagos`

#### Scenario: Falla la subida

- **WHEN** la subida a la tienda privada falla
- **THEN** ve "No pudimos subir tu imagen. Revisa tu conexión e inténtalo de nuevo." y no se crea ningún pago

#### Scenario: Se muestra el aviso de demostración

- **WHEN** el formulario muestra los datos de pago (QR o CCI)
- **THEN** incluye junto a ellos el aviso «Sitio de demostración: los pagos son simulados. No hagas ninguna transferencia ni pago real.»

### Requirement: Mensajes del servidor traducidos al cliente

La pantalla MUST mostrar el mensaje del servidor para `plazo_vencido` ("Pasó el plazo para subir otro comprobante. Puedes empezar de nuevo con una reserva y un pago nuevos."), `409` por otro pago en revisión y `404`. Ante `plazo_vencido` MUST reemplazar el formulario por el aviso de empezar de nuevo.

#### Scenario: Plazo vencido al enviar

- **WHEN** el plazo venció entre que el cliente abrió la pantalla y confirmó
- **THEN** ve el mensaje de plazo vencido y el enlace para empezar de nuevo

#### Scenario: Doble clic

- **WHEN** el cliente toca "Enviar" dos veces
- **THEN** el botón se deshabilita durante el envío y solo se crea un pago

### Requirement: Sin reserva viva se explica qué sigue

Si el pago rechazado no tiene reserva viva (la reserva ya expiró), el perfil MUST decir "Si se aprueba tu pago, elegirás un nuevo día y hora sin pagar otra vez." Si la reserva sigue `pendiente`, MUST decir que conserva su horario hasta la hora límite de su espera.

#### Scenario: Reserva expirada

- **WHEN** el pago fue rechazado y la reserva ya expiró
- **THEN** el perfil muestra el texto del nuevo día y hora sin pagar otra vez

#### Scenario: Reserva todavía pendiente

- **WHEN** la reserva sigue `pendiente`
- **THEN** el perfil muestra la hora límite de su espera
