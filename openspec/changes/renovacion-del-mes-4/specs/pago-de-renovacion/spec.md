## Purpose

Permite al cliente con la membresía vencida pagar de nuevo por Yape o transferencia con comprobante, y que el administrador lo apruebe o rechace con la revisión del ítem #11 (PRD, "Alcance" puntos 3 y 8). Los pagos son simulados. La renovación NO da otra limpieza gratis (ADR 0008). La renovación es otro período de 3 meses en un solo pago, igual que la primera membresía (decisión provisional del PRD, pendiente de confirmar por el negocio). El monto y la duración los entrega `planDeRenovacion`, que los lee de `configuracion` (`membresia_precio_mensual` × `membresia_meses`: S/ 267 y 3 meses con los valores actuales), sin constantes en el código.

## ADDED Requirements

### Requirement: El plan de renovación sale de la configuración

`planDeRenovacion(config)` MUST devolver `{ meses, monto }` con `meses = membresia_meses` y `monto = membresia_precio_mensual × membresia_meses` (en céntimos), igual que el monto de la primera membresía. MUST NOT contener constantes de meses ni de monto. La ruta de renovar, la pantalla y la aprobación MUST usar este plan.

#### Scenario: Valores actuales

- **WHEN** `membresia_precio_mensual` es S/ 89 y `membresia_meses` es 3
- **THEN** el plan es 3 meses por S/ 267

#### Scenario: El plan sigue a la configuración

- **WHEN** `membresia_precio_mensual` cambia a S/ 100 y `membresia_meses` a 2
- **THEN** el plan es 2 meses por S/ 200, sin cambiar el código

#### Scenario: Plan inyectado distinto

- **WHEN** la ruta de renovar recibe un plan inyectado de 1 mes por S/ 89
- **THEN** la membresía y el pago pendientes guardan S/ 89, lo que demuestra que el monto sale del plan y no de una constante

### Requirement: Renovar crea una membresía y un pago pendientes, sin reserva

`POST /api/membresia/renovar` MUST exigir sesión (`401`) y `Content-Type: application/json` (`415`), y MUST recibir solo el método (`yape` o `transferencia`) y la ruta del comprobante ya subido (ADR 0010). En una sola transacción MUST crear una membresía `pendiente` y un pago `pendiente` de concepto `membresia` con esa membresía, el método y el comprobante. MUST NOT crear ninguna reserva, aplicar horas gratis ni marcar `primera_gratis`. El monto de ambas filas MUST ser el de `planDeRenovacion`, nunca un valor enviado por el cliente. Sin comprobante MUST responder `422` y no crear nada.

#### Scenario: Renovación creada

- **WHEN** un cliente con la membresía vencida envía `yape` y un comprobante válido de su carpeta
- **THEN** se crean una membresía `pendiente` (sin `inicio` ni `fin`) y un pago `pendiente` de concepto `membresia` por el monto del plan, y no se crea ninguna reserva

#### Scenario: Sin comprobante

- **WHEN** el cuerpo no trae comprobante
- **THEN** responde `422` y no se crea ninguna fila

#### Scenario: El monto no viene del cliente

- **WHEN** el cuerpo trae un campo `monto` de 1 sol
- **THEN** se ignora y el pago guarda el monto del plan

#### Scenario: Sin sesión o sin JSON

- **WHEN** la petición no trae sesión, o trae un tipo distinto de `application/json`
- **THEN** responde `401` o `415` respectivamente y no escribe nada

#### Scenario: Comprobante de otro cliente o inexistente

- **WHEN** la ruta del comprobante no existe o está en la carpeta de otro usuario
- **THEN** responde `422` y no se crea el pago

### Requirement: Solo con la membresía vencida y sin otra pendiente

La renovación MUST aceptarse solo si la membresía `activa` más reciente del cliente tiene `fin` anterior o igual a ahora (reloj de la base) y no existe una membresía `pendiente` del cliente. Antes de decidir, la transacción MUST aplicar el cierre de membresías sin reenvío del #11, para que un plazo vencido no impida empezar de nuevo. Los rechazos MUST usar `409` con estos códigos: `renovacion_no_aplica` (sin membresía, o todavía vigente), `en_espera` (ya hay una pendiente en revisión) y `pago_rechazado` (hay una rechazada aún dentro del plazo de reenvío, con la fecha límite).

#### Scenario: Membresía todavía vigente

- **WHEN** a la membresía le quedan 5 días
- **THEN** responde `409 renovacion_no_aplica` con "Tu membresía sigue vigente hasta el ... Podrás renovarla cuando venza." y no escribe nada

#### Scenario: Cliente sin membresía

- **WHEN** un cliente que nunca fue miembro envía la renovación
- **THEN** responde `409 renovacion_no_aplica` con un mensaje que lo lleva a reservar su primera limpieza

#### Scenario: Ya hay una renovación en revisión

- **WHEN** el cliente vencido ya tiene una membresía `pendiente` con su pago `pendiente`
- **THEN** responde `409 en_espera` y no crea otra

#### Scenario: Rechazada dentro del plazo

- **WHEN** la renovación pendiente tiene su pago `rechazado` dentro del plazo de reenvío
- **THEN** responde `409 pago_rechazado` indicando que suba otro comprobante hasta la fecha límite, desde su perfil

#### Scenario: Plazo vencido, empezar de nuevo

- **WHEN** el pago rechazado superó el plazo, la membresía pendiente se cierra como `caducada` y el cliente vuelve a enviar la renovación
- **THEN** se crea una membresía y un pago nuevos

#### Scenario: Dos envíos simultáneos

- **WHEN** el mismo cliente envía dos renovaciones a la vez
- **THEN** solo una se guarda y la otra recibe `409 en_espera` por el índice único de la membresía `pendiente`

### Requirement: La renovación no da otra limpieza gratis

Ni crear, ni aprobar, ni rechazar una renovación MUST crear una reserva, MUST cambiar `primera_gratis` de ninguna reserva ni MUST alterar el resultado de `decidirLimpiezaGratis` (ADR 0008).

#### Scenario: Cliente que ya recibió su limpieza gratis

- **WHEN** el cliente con una reserva `completada` renueva y el pago se aprueba
- **THEN** `decidirLimpiezaGratis` sigue dando falso y su siguiente reserva no lleva horas gratis

#### Scenario: Primera limpieza gratis no usada

- **WHEN** el cliente nunca realizó su limpieza gratis (por ejemplo, la canceló) y renueva
- **THEN** la renovación no crea otra y `decidirLimpiezaGratis` conserva el mismo resultado que antes de renovar

### Requirement: El administrador revisa la renovación con la revisión de pagos

El pago de renovación MUST aparecer en la lista de pagos pendientes del administrador (#11) aun sin reserva, con concepto `membresia`, monto, método y comprobante visible solo para el cliente y los administradores. Al aprobarlo, el pago MUST quedar `aprobado` y la membresía MUST quedar `activa` con `inicio` igual al instante de la aprobación (reloj de la base) y un `fin` igual a `inicio` más `membresia_meses` meses (3 con los valores actuales), el mismo cálculo de la primera membresía; la renovación no cambia la aprobación del #11. Al rechazarlo MUST valer el reenvío y el cierre `caducada` del #11.

#### Scenario: La renovación aparece sin reserva

- **WHEN** el administrador abre la lista de pagos pendientes
- **THEN** ve el pago de renovación con su cliente, monto y comprobante, y sin estado de reserva ni coincidencias de dirección

#### Scenario: Aprobación

- **WHEN** el administrador aprueba el pago de renovación
- **THEN** el pago queda `aprobado`, la membresía nueva `activa` con `inicio` igual al instante de la aprobación y `fin` 3 meses después, y el perfil pasa a mostrar la membresía vigente sin aviso de renovación

#### Scenario: Rechazo y reenvío

- **WHEN** el administrador rechaza el pago y el cliente sube otro comprobante dentro del plazo
- **THEN** `POST /api/pagos` del #11 crea el pago nuevo sobre la misma membresía pendiente, sin ninguna reserva que mover

#### Scenario: Comprobante ajeno

- **WHEN** otro cliente pide el comprobante de la renovación
- **THEN** responde `404`

### Requirement: Pantalla de renovación con aviso de demostración

`/cuenta/renovar` MUST mostrar, solo a un cliente en estado `vencida`, el monto, las opciones Yape (QR) y transferencia (CCI) y la subida del comprobante (JPG, PNG o WebP de hasta 5 MB), y MUST mostrar el aviso de demostración con el texto de `AVISO_DEMOSTRACION` junto al QR y la CCI. En cualquier otro estado MUST redirigir al perfil. El monto MUST venir del servidor.

#### Scenario: Cliente vencido

- **WHEN** un cliente vencido abre `/cuenta/renovar`
- **THEN** ve el monto del plan, el QR, la CCI, el aviso de demostración y el campo del comprobante

#### Scenario: Cliente con la membresía vigente

- **WHEN** un cliente con la membresía vigente abre `/cuenta/renovar`
- **THEN** es redirigido a `/cuenta`

#### Scenario: Archivo inválido

- **WHEN** el cliente elige un archivo de otro tipo o de más de 5 MB
- **THEN** ve un mensaje claro y no se crea el pago
