## ADDED Requirements

### Requirement: Subir otro comprobante tras un rechazo
`POST /api/pagos` MUST exigir sesión, `Content-Type: application/json` (`415` si no) y un cuerpo con `pago_id` (el pago rechazado), `metodo` (`yape` o `transferencia`) y `comprobante` (la ruta ya subida a Blob). MUST verificar el archivo con `verificarImagenSubida` antes de abrir su transacción y guardar solo la ruta que ella devuelve. En una transacción de escritura MUST bloquear el pago rechazado, comprobar el plazo de reenvío, crear un pago nuevo `pendiente` con el mismo usuario, concepto, membresía y monto, y `reemplaza_a` apuntando al rechazado, y, si el rechazado tenía una reserva `pendiente` vigente, apuntarla al pago nuevo sin cambiar su `expira_en`. Ningún monto del cuerpo se acepta. Cada pago rechazado MUST poder reemplazarse una sola vez, y una membresía MUST tener como máximo un pago `pendiente` a la vez.

#### Scenario: Reenvío con la reserva vigente
- **WHEN** un cliente cuyo pago fue rechazado y cuya reserva sigue `pendiente` sube otro comprobante
- **THEN** se crea un pago `pendiente` que reemplaza al rechazado, la reserva apunta al pago nuevo y conserva su `expira_en` original

#### Scenario: Reenvío con la reserva expirada y dentro del plazo
- **WHEN** el pago fue rechazado hace 3 días, la reserva ya expiró y el cliente sube otro comprobante
- **THEN** se crea el pago nuevo `pendiente`, no se crea ninguna reserva y la respuesta indica `reserva: null`

#### Scenario: Pago de otro cliente
- **WHEN** un cliente envía el `pago_id` de un pago de otro cliente
- **THEN** la respuesta es `404` y no se crea nada

#### Scenario: El pago no está rechazado
- **WHEN** el `pago_id` es de un pago `pendiente` o `aprobado`
- **THEN** la respuesta es `409` con un mensaje claro y no se crea nada

#### Scenario: Comprobante inválido
- **WHEN** el archivo no existe en Blob, está en la carpeta de otro usuario o no es una imagen JPG, PNG o WebP
- **THEN** la respuesta es `404` o `422` y no se abre la transacción

#### Scenario: Un solo reemplazo por pago
- **WHEN** dos peticiones simultáneas reemplazan el mismo pago rechazado
- **THEN** una responde `201` y la otra `409`, y existe un único pago nuevo

#### Scenario: Ya hay un comprobante en revisión
- **WHEN** la membresía ya tiene un pago `pendiente` que reemplazó a otro rechazado y el cliente envía el `pago_id` de un rechazado de la misma membresía
- **THEN** la respuesta es `409` y no se crea nada

#### Scenario: Sin sesión o sin JSON
- **WHEN** no hay sesión, o el cuerpo llega como `text/plain`
- **THEN** la respuesta es `401` o `415`

### Requirement: Plazo para subir otro comprobante
El plazo para subir otro comprobante a un pago rechazado MUST ser de `reenvio_comprobante_dias` días (7 en los datos iniciales) contados desde `revisado_en`, el instante del rechazo, y MUST medirse con el reloj de la base de datos. El valor MUST leerse de `configuracion`, validado como entero positivo, y nunca escribirse en el código. Fuera del plazo, `POST /api/pagos` MUST responder `409` con el código estable `plazo_vencido` y un mensaje que explique que el plazo terminó y que puede empezar de nuevo con una reserva y un pago nuevos. El mismo plazo MUST aplicar a cualquier pago rechazado, esté o no su reserva vigente. Una respuesta de la API que muestre un pago `rechazado` MUST incluir `reenvio_hasta` (el instante límite) y `reenvio_vigente` (verdadero mientras el plazo no haya vencido), para que el cliente vea cuánto plazo queda.

#### Scenario: Dentro del plazo
- **WHEN** el pago se rechazó hace 6 días y 23 horas y el cliente sube otro comprobante
- **THEN** la respuesta es `201` y existe un pago `pendiente` que reemplaza al rechazado

#### Scenario: Plazo vencido
- **WHEN** el pago se rechazó hace 7 días y 1 minuto y el cliente intenta subir otro comprobante
- **THEN** la respuesta es `409` con el código `plazo_vencido` y no se crea ningún pago

#### Scenario: El plazo es un dato
- **WHEN** el valor de `reenvio_comprobante_dias` en `configuracion` se cambia a 2 y el pago se rechazó hace 3 días
- **THEN** la respuesta es `409` `plazo_vencido`, sin cambiar el código

#### Scenario: Valor inválido del plazo
- **WHEN** `reenvio_comprobante_dias` guardado no es un entero positivo
- **THEN** la lectura de la configuración falla y el error nombra la clave

#### Scenario: El cliente ve cuánto plazo le queda
- **WHEN** el administrador rechaza un pago, o se consulta un pago `rechazado`
- **THEN** la respuesta incluye `reenvio_hasta` igual a `revisado_en` más los días configurados y `reenvio_vigente: true`; pasado ese instante, `reenvio_vigente` es `false`

### Requirement: Cierre de la membresía vencida
Una membresía `pendiente` cuyos pagos no tienen ninguno `pendiente`, tiene al menos uno `rechazado` y todos sus pagos rechazados superaron el plazo de reenvío MUST pasar al estado `caducada`. El cierre MUST hacerlo la pasada de expiración confiable y, además, MUST ejecutarse dentro de la transacción de `POST /api/reservas` antes de comprobar el estado del cliente, para que quien nunca pasa por el portal de administrador pueda empezar de nuevo. Una membresía `caducada` MUST NOT tener fechas de vigencia, MUST NOT activar nada y MUST NOT generar crédito en horas ni devolución alguna. El cierre MUST bloquear las filas candidatas antes de evaluar la condición, para que un reenvío concurrente no deje un pago `pendiente` en una membresía `caducada`.

#### Scenario: Cierre tras el plazo
- **WHEN** el pago de una membresía `pendiente` se rechazó hace 8 días, la reserva expiró y no hay otro pago
- **THEN** la pasada de expiración deja la membresía `caducada`, sin `inicio` ni `fin`

#### Scenario: Dentro del plazo no se cierra
- **WHEN** el pago se rechazó hace 6 días y 23 horas
- **THEN** la membresía sigue `pendiente`

#### Scenario: Con un comprobante nuevo en revisión no se cierra
- **WHEN** el cliente subió otro comprobante y el pago nuevo está `pendiente`, aunque el rechazado tenga más de 7 días
- **THEN** la membresía sigue `pendiente`

#### Scenario: Una membresía caducada no genera nada
- **WHEN** una membresía pasa a `caducada`
- **THEN** no se crea ningún crédito en horas, no se cambia ningún pago y la reserva expirada no cambia

#### Scenario: Reenvío y cierre simultáneos
- **WHEN** un reenvío válido y el cierre de la misma membresía ocurren a la vez
- **THEN** o la membresía queda `pendiente` con su pago nuevo `pendiente`, o queda `caducada` y el reenvío responde `409` `plazo_vencido`; nunca queda `caducada` con un pago `pendiente`

#### Scenario: La base acepta el estado nuevo
- **WHEN** se guarda una membresía `caducada` sin fechas, o una `activa` con fechas válidas
- **THEN** la base lo acepta; rechaza una `caducada` con `inicio` o `fin`, y una `activa` sin fechas

### Requirement: Empezar de nuevo tras el cierre
Con la membresía `caducada`, `POST /api/reservas` MUST permitir al cliente crear una membresía, un pago y una reserva nuevos, como si no tuviera membresía, y MUST NOT tratar la `caducada` como membresía vigente ni en revisión. Con la membresía `pendiente` y su último pago `rechazado` dentro del plazo, MUST responder `409` con el código `pago_rechazado` y un mensaje que pida subir otro comprobante e indique hasta cuándo puede hacerlo. Con el pago `pendiente`, MUST seguir respondiendo `409` con el código `en_espera` y el mensaje de pago en revisión.

#### Scenario: Empezar de nuevo
- **WHEN** la membresía del cliente está `caducada` y envía una reserva válida con su comprobante a `POST /api/reservas`
- **THEN** se crea una membresía `pendiente`, un pago `pendiente` y una reserva `pendiente`, y la membresía `caducada` no cambia

#### Scenario: Cierre y reserva nueva en la misma petición
- **WHEN** el plazo venció pero la pasada aún no marcó la membresía, y el cliente llama a `POST /api/reservas`
- **THEN** la petición cierra la membresía y crea la membresía, el pago y la reserva nuevos

#### Scenario: Aviso claro dentro del plazo
- **WHEN** un cliente con la membresía `pendiente` y su último pago `rechazado` dentro del plazo llama a `POST /api/reservas`
- **THEN** la respuesta es `409` con el código `pago_rechazado` y un mensaje que le pide subir otro comprobante hasta una fecha, no el de "pago en revisión"

#### Scenario: Pago en revisión conserva su mensaje
- **WHEN** el cliente tiene la membresía `pendiente` y su pago sigue `pendiente`
- **THEN** `POST /api/reservas` responde `409` con el código `en_espera` y el mensaje de pago en revisión, como antes

#### Scenario: Aprobación tardía tras el reenvío
- **WHEN** el administrador rechazó el pago, la reserva expiró, el cliente subió otro comprobante dentro del plazo y el administrador lo aprueba
- **THEN** la membresía se activa con `inicio` en la aprobación, la reserva sigue `expirada` y `nuevo_horario_pendiente` es verdadero

#### Scenario: Consulta de pagos que aún se pueden reenviar
- **WHEN** se consulta por cliente los pagos rechazados cuyo plazo sigue vigente
- **THEN** la consulta devuelve el id del pago, su membresía, `reenvio_hasta` y el motivo, y no devuelve pagos con el plazo vencido ni ya reemplazados
