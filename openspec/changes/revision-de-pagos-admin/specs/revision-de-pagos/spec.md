## ADDED Requirements

### Requirement: Solo el administrador revisa pagos
Toda ruta `/api/admin/**` de este ítem MUST exigir una sesión con rol `admin`, leído de la base en cada petición. Sin sesión MUST responder `401` y con rol `cliente` MUST responder `403`. Las páginas `/admin/pagos` y `/admin/pagos/[id]` MUST quedar bajo el layout de `/admin`, que no muestra nada a quien no es administrador.

#### Scenario: Sin sesión
- **WHEN** se llama a `GET /api/admin/pagos` sin sesión
- **THEN** la respuesta es `401` con el formato único de errores

#### Scenario: Cliente sin rol de administrador
- **WHEN** un cliente llama a `GET /api/admin/pagos`, a `POST /api/admin/pagos/:id/aprobar`, a `POST /api/admin/pagos/:id/rechazar` o a `POST /api/admin/reservas/:id/cancelar`
- **THEN** cada una responde `403` y no cambia ninguna fila

#### Scenario: Página de un cliente
- **WHEN** un cliente abre `/admin/pagos`
- **THEN** es redirigido y no recibe ningún dato de pagos

### Requirement: Lista de pagos pendientes
`GET /api/admin/pagos` MUST devolver los pagos del estado pedido (`estado=pendiente` por defecto; también `aprobado` y `rechazado`). Cada elemento MUST incluir el pago (id, concepto, monto en céntimos, método, estado, fecha, motivo de rechazo y el pago al que reemplaza), el cliente (nombre, correo y celular), la membresía (id y estado), la reserva vinculada con su estado efectivo, su `expira_en` y su inicio, y la ruta `/api/comprobantes/:id`. Cada pago `rechazado` MUST incluir además `reenvio_hasta` y `reenvio_vigente` (plazo para subir otro comprobante, spec `reenvio-de-comprobante`); en los demás estados esos campos MUST ser `null`. Los pagos pendientes MUST ordenarse primero por el vencimiento más próximo de su reserva viva y después por antigüedad. La lista MUST tener un máximo de 100 elementos.

#### Scenario: Pagos pendientes con su reserva
- **WHEN** hay un pago `pendiente` con una reserva `pendiente` vigente y otro pago `pendiente` sin reserva viva
- **THEN** la lista devuelve ambos, el primero antes que el segundo, cada uno con el cliente y la ruta de su comprobante

#### Scenario: Nunca se muestra como pendiente una reserva vencida
- **WHEN** la reserva de un pago `pendiente` tiene `expira_en` en el pasado, aunque aún no se haya marcado
- **THEN** la lista muestra su estado como `expirada`, no como `pendiente`

#### Scenario: Estado inválido
- **WHEN** se pide `estado=otro`
- **THEN** la respuesta es `422` con un mensaje claro

#### Scenario: Pagos ya revisados
- **WHEN** se pide `estado=rechazado`
- **THEN** la lista contiene solo pagos rechazados, con su motivo si lo tienen y su `reenvio_hasta`

#### Scenario: Plazo de reenvío en un rechazo
- **WHEN** el administrador rechaza un pago
- **THEN** la respuesta de `POST /api/admin/pagos/:id/rechazar` incluye `reenvio_hasta` igual al instante del rechazo más los días configurados

### Requirement: Detalle del pago con el comprobante
`GET /api/admin/pagos/:id` MUST devolver los mismos datos que la lista más las coincidencias de dirección del pago. El comprobante MUST verse por `GET /api/comprobantes/:id`, que autoriza al administrador sin importar de quién sea el pago. Un `id` que no tiene formato de uuid o que no existe MUST responder `404`.

#### Scenario: El administrador ve el comprobante de un cliente
- **WHEN** el administrador abre `GET /api/comprobantes/:id` de un pago de otro usuario
- **THEN** recibe `200` con la imagen y las cabeceras privadas

#### Scenario: Pago inexistente
- **WHEN** se pide `GET /api/admin/pagos/abc` o el uuid de un pago que no existe
- **THEN** la respuesta es `404`, no `500`

#### Scenario: Pantalla de detalle
- **WHEN** el administrador abre `/admin/pagos/[id]` de un pago pendiente
- **THEN** la página muestra el cliente, el concepto, el monto en soles, el método, el vencimiento de la reserva, la imagen del comprobante y los botones Aprobar y Rechazar

### Requirement: Aprobar un pago
`POST /api/admin/pagos/:id/aprobar` MUST ejecutar, en una sola transacción de escritura que empieza marcando las reservas vencidas: bloquear la fila del pago; responder `409` si no está `pendiente`; marcarlo `aprobado` con el administrador y la fecha de revisión; si su concepto incluye la membresía, pasar la membresía de `pendiente` a `activa` con `inicio` igual al instante de la aprobación y `fin` tres meses después (duración leída de `configuracion`, no escrita en el código); y pasar a `confirmada`, sin `expira_en`, la reserva `pendiente` de ese pago. Si algo falla, MUST NOT quedar ningún cambio a medias.

#### Scenario: Aprobación normal de la membresía con la primera limpieza
- **WHEN** el administrador aprueba un pago `membresia_y_reserva` cuya reserva `pendiente` sigue vigente
- **THEN** el pago queda `aprobado`, la membresía `activa` con `inicio` ahora y `fin` tres meses después, y la reserva `confirmada` sin `expira_en`

#### Scenario: La vigencia cuenta desde la aprobación
- **WHEN** un pago creado el 1 de noviembre se aprueba el 2 de noviembre a las 10:00
- **THEN** la membresía queda con `inicio` el 2 de noviembre a las 10:00 y `fin` el 2 de febrero a las 10:00, no el 1 de febrero

#### Scenario: Pago que solo cubre una reserva
- **WHEN** se aprueba un pago de concepto `reserva` cuya reserva está vigente
- **THEN** la reserva queda `confirmada` y ninguna membresía cambia

#### Scenario: Pago ya revisado
- **WHEN** el administrador aprueba un pago que ya está `aprobado` o `rechazado`
- **THEN** la respuesta es `409` con un mensaje claro y no cambia ninguna fila

#### Scenario: Dos administradores aprueban a la vez
- **WHEN** dos peticiones aprueban el mismo pago al mismo tiempo
- **THEN** una responde `200` y la otra `409`, y la membresía tiene una sola fecha de inicio

#### Scenario: La membresía ya no está pendiente
- **WHEN** se aprueba un pago cuya membresía no está `pendiente`
- **THEN** la respuesta es `409` y el pago sigue `pendiente`

#### Scenario: Pago inexistente
- **WHEN** se aprueba un uuid que no existe
- **THEN** la respuesta es `404`

### Requirement: Aprobación tardía
Cuando se aprueba un pago cuya reserva ya expiró, el pago MUST aprobarse igual y la membresía, si el concepto la incluye, MUST activarse con la misma regla. La reserva MUST seguir `expirada` y su horario MUST NOT volver a ocuparse. La respuesta MUST indicar `nuevo_horario_pendiente: true`. Una consulta reutilizable MUST identificar los pagos `aprobado` que no tienen ninguna reserva `pendiente` vigente, `confirmada` ni `completada`, para que los ítems #12 y #13 muestren "Elige un nuevo día y hora" y creen la reserva con ese mismo pago sin otro comprobante.

#### Scenario: Reserva expirada y pago aprobado
- **WHEN** el administrador aprueba, 30 horas después de crearse, un pago `membresia_y_reserva` cuya reserva venció a las 24 horas
- **THEN** el pago queda `aprobado`, la membresía `activa`, la reserva sigue `expirada` y la respuesta trae `nuevo_horario_pendiente: true`

#### Scenario: El horario expirado no se vuelve a ocupar
- **WHEN** otro cliente reservó el horario liberado por la reserva expirada y luego se aprueba el pago de esta
- **THEN** la reserva expirada no cambia de estado y la del otro cliente no se ve afectada

#### Scenario: Reserva cancelada por el administrador y pago aprobado después
- **WHEN** el administrador cancela una reserva pendiente y después aprueba su pago
- **THEN** el pago se aprueba, la reserva sigue `cancelada` y la respuesta trae `nuevo_horario_pendiente: true`

#### Scenario: La consulta de pagos con horario por elegir
- **WHEN** existe un pago `aprobado` con su única reserva `expirada` y otro `aprobado` con su reserva `confirmada`
- **THEN** la consulta devuelve solo el primero

### Requirement: Rechazar un pago
`POST /api/admin/pagos/:id/rechazar` MUST bloquear la fila del pago, responder `409` si no está `pendiente`, marcarlo `rechazado` con el administrador, la fecha de revisión y un motivo opcional de hasta 200 caracteres, y MUST NOT modificar la reserva, que sigue `pendiente` con su `expira_en` original, ni la membresía, que sigue `pendiente`.

#### Scenario: Rechazo con reserva vigente
- **WHEN** el administrador rechaza un pago cuya reserva sigue `pendiente`
- **THEN** el pago queda `rechazado` con quién y cuándo, y la reserva conserva su estado y su `expira_en`

#### Scenario: Motivo opcional
- **WHEN** se rechaza un pago sin motivo y otro con el motivo "El comprobante no coincide"
- **THEN** ambos se rechazan; el segundo guarda el motivo

#### Scenario: Motivo demasiado largo
- **WHEN** el motivo supera los 200 caracteres
- **THEN** la respuesta es `422` y el pago sigue `pendiente`

#### Scenario: Rechazar un pago ya revisado
- **WHEN** se rechaza un pago `aprobado`
- **THEN** la respuesta es `409` y el pago no cambia

### Requirement: Datos de la revisión coherentes
La base de datos MUST rechazar un pago `pendiente` con revisor o fecha de revisión, y un pago `rechazado` sin ellos.

#### Scenario: Restricción de la base
- **WHEN** se inserta o actualiza un pago `pendiente` con `revisado_por` o un `rechazado` sin `revisado_en`
- **THEN** la base rechaza la operación

### Requirement: Pantallas del portal
La portada `/admin` MUST enlazar a `/admin/pagos`. La lista MUST mostrar los pagos pendientes con el monto en soles (`S/`), el cliente, el método y el vencimiento de la reserva, y un mensaje claro cuando no hay ninguno. Las acciones MUST llamar a la API, mostrar su mensaje de error en español y refrescar la pantalla.

#### Scenario: Lista vacía
- **WHEN** no hay pagos pendientes
- **THEN** `/admin/pagos` dice que no hay pagos por revisar

#### Scenario: Monto en soles
- **WHEN** la lista incluye un pago de 33666 céntimos
- **THEN** la pantalla lo muestra como `S/ 336,66`

#### Scenario: Error de una acción
- **WHEN** el administrador aprueba un pago que otro acaba de aprobar
- **THEN** la pantalla muestra el mensaje del `409` y refresca la lista
