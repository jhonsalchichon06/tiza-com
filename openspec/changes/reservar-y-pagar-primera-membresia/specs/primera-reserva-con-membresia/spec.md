## Purpose

Permite al cliente nuevo reservar su primera limpieza pagando por adelantado la membresía de Tiza Club. Una sola petición crea la membresía, el pago y la reserva en espera, con las 3 primeras horas gratis (PRD, "Alcance" puntos 2, 3, 5, 6 y 10; ADR 0008, 0009 y 0010). Los pagos son simulados.

## ADDED Requirements

### Requirement: Crear membresía, pago y reserva en una sola transacción

`POST /api/reservas` MUST exigir sesión (`401` sin ella) y, para un cliente que todavía no tiene ninguna membresía, MUST crear en una sola transacción: una membresía `pendiente`, un pago `pendiente` con la ruta del comprobante, y una reserva `pendiente` vinculada a ambos, con `expira_en` igual al momento de la creación más `espera_pago_horas` de `configuracion` (24 h hoy). Si cualquier paso falla, MUST NOT quedar ninguna de las tres filas. La respuesta MUST ser `201` y MUST incluir la reserva (identificador, estado, servicio, inicio, fin, `expira_en` y monto de la reserva), la membresía (identificador, estado y monto), el pago (identificador, concepto, monto, método y estado) y el enlace de WhatsApp o `null`. El monto de la membresía y el de la reserva MUST NOT aceptarse del cuerpo: los calcula el servidor.

#### Scenario: Cliente nuevo reserva y paga

- **WHEN** un cliente con sesión y sin membresía envía un servicio, un inicio válido, una dirección válida, el método `yape` y la ruta de un comprobante que existe en su carpeta
- **THEN** la respuesta es `201` y existen una membresía `pendiente`, un pago `pendiente` y una reserva `pendiente` vinculados entre sí, con `expira_en` 24 horas después de la creación

#### Scenario: Sin sesión

- **WHEN** alguien sin sesión envía la petición
- **THEN** la respuesta es `401` con el formato único de errores y no se crea nada

#### Scenario: Los montos del cuerpo se ignoran

- **WHEN** el cuerpo trae campos de monto, descuento u horas gratis
- **THEN** el servidor los ignora y guarda los que calcula a partir de `configuracion`

#### Scenario: Un paso falla y no queda nada

- **WHEN** la reserva no puede guardarse (por ejemplo, no hay cupo)
- **THEN** no existe ninguna membresía ni pago nuevos para ese cliente

### Requirement: El comprobante es obligatorio

Una reserva MUST crearse solo junto con su comprobante (PRD, "Alcance" punto 5). Si el cuerpo no trae la ruta del comprobante, o el método no es `yape` ni `transferencia`, el servidor MUST responder `422` con un mensaje claro y no crear nada.

#### Scenario: Petición sin comprobante

- **WHEN** el cuerpo no incluye la ruta del comprobante
- **THEN** la respuesta es `422` con un mensaje que pide subir el comprobante y no se crea membresía, pago ni reserva

#### Scenario: Método de pago desconocido

- **WHEN** el método es `tarjeta` o `credito`
- **THEN** la respuesta es `422` y no se crea nada

### Requirement: Verificar el archivo del comprobante antes de abrir la transacción

Antes de abrir la transacción, el servidor MUST verificar que el comprobante exista en la tienda de imágenes, que esté en la carpeta del propio usuario, que pese 4 MB o menos y que sea JPG, PNG o WebP por sus bytes iniciales, y MUST guardar en el pago solo la ruta verificada. Si la verificación falla, MUST NOT crear membresía, pago ni reserva.

#### Scenario: El archivo no existe

- **WHEN** la ruta del comprobante no existe en la tienda de imágenes
- **THEN** la respuesta es `404` con un mensaje que pide subir el archivo de nuevo y no se crea nada

#### Scenario: El archivo está en la carpeta de otro cliente

- **WHEN** la ruta pertenece a `comprobantes/` de otro usuario
- **THEN** la respuesta es un error de validación o de permisos y no se crea nada

#### Scenario: El archivo no es una imagen

- **WHEN** el archivo existe pero sus bytes no son de una imagen JPG, PNG o WebP
- **THEN** la respuesta es `422` y no se crea nada

### Requirement: Validar y guardar la dirección del hogar

El servidor MUST validar la dirección con las reglas del ítem #7 y no confiar en la lista del navegador: un distrito que no sea uno de los 9 de v1, una calle vacía o un número sin ningún dígito MUST responder `422` con un mensaje claro y no crear nada. La reserva MUST guardar el distrito, la calle, el número y el departamento tal como los escribió el cliente, las referencias, y también `direccion_normalizada` y `departamento_normalizado`. El departamento y las referencias MUST ser opcionales.

#### Scenario: Distrito fuera de los 9

- **WHEN** el distrito enviado es "La Molina"
- **THEN** la respuesta es `422` con el mensaje de elegir uno de los distritos que se atienden

#### Scenario: Calle vacía o número sin dígitos

- **WHEN** la calle viene vacía, o el número es "s/n"
- **THEN** la respuesta es `422` pidiendo el dato que falta y no se crea nada

#### Scenario: Se guarda lo escrito y lo normalizado

- **WHEN** el cliente escribe calle "Av. Larco", número "123", departamento "Dpto. 302"
- **THEN** la reserva guarda esos textos tal cual y además `direccion_normalizada` = "avenida larco 123" y `departamento_normalizado` = "dpto 302"

#### Scenario: Casa sin departamento

- **WHEN** el cliente no envía departamento ni referencias
- **THEN** la reserva se crea con el departamento vacío y `departamento_normalizado` vacío

### Requirement: Validar el inicio del servicio en el servidor

El servidor MUST validar el inicio del servicio con las mismas reglas que la disponibilidad y responder `422` con un mensaje distinto para cada incumplimiento: domingo u otro día sin atención, fuera de 8 am a 6 pm, servicio que terminaría después de las 6 pm, inicio que no es múltiplo de 30 minutos y anticipación menor a 48 horas. El inicio MUST llegar con zona horaria; uno sin zona MUST responder `422`.

#### Scenario: Inicio a menos de 48 horas

- **WHEN** el inicio es 47 horas y 59 minutos después de la petición
- **THEN** la respuesta es `422` con el mensaje de anticipación y no se crea nada

#### Scenario: Domingo

- **WHEN** el inicio cae en domingo
- **THEN** la respuesta es `422` con el mensaje de los días de atención

#### Scenario: Fuera de horario

- **WHEN** el inicio es a las 7:30 am, o a las 3:00 pm para un servicio de 4 h que terminaría a las 7:00 pm
- **THEN** la respuesta es `422` con el mensaje del horario de atención

#### Scenario: Hora que no es múltiplo del intervalo

- **WHEN** el inicio es a las 9:15 am
- **THEN** la respuesta es `422`

#### Scenario: Inicio sin zona horaria

- **WHEN** el inicio es "2026-11-07T10:00:00" sin zona
- **THEN** la respuesta es `422`

### Requirement: La primera membresía autoriza reservar dentro de sus 3 meses

Mientras la primera membresía está `pendiente`, el inicio del servicio MUST ser anterior al momento de la petición más `membresia_meses` meses de calendario (3 hoy). Un inicio igual o posterior MUST responder `422` con un mensaje que indica la última fecha reservable. Como los 3 meses de la membresía cuentan desde la aprobación, que ocurre después de la petición, un servicio dentro de ese límite siempre queda dentro de la vigencia.

#### Scenario: Inicio justo antes del límite

- **WHEN** la petición es el lunes 2 de noviembre de 2026 a las 10:00 (Lima) y el inicio es el lunes 1 de febrero de 2027 a las 10:00
- **THEN** la reserva se crea

#### Scenario: Inicio exactamente a los 3 meses

- **WHEN** la petición es el lunes 2 de noviembre de 2026 a las 10:00 y el inicio es el martes 2 de febrero de 2027 a las 10:00
- **THEN** la respuesta es `422` con la última fecha reservable y no se crea nada

#### Scenario: Fin de mes

- **WHEN** la petición es el 30 de noviembre de 2026
- **THEN** el límite es el 28 de febrero de 2027 (el último día del mes de destino)

### Requirement: Precio, horas gratis y monto del pago

El servidor MUST calcular el servicio con el mismo módulo de precios del ítem #4, aplicando las horas gratis de `configuracion` (3 h hoy) a la primera limpieza, y MUST guardar en la reserva una copia de lo cobrado: precio de lista, horas gratis aplicadas, crédito aplicado (0), descuento y monto de la reserva, con `primera_gratis` verdadero. El monto de la membresía MUST ser `membresia_precio_mensual` × `membresia_meses` de `configuracion` (26700 céntimos con los valores actuales), sin escribirlo en el código. El pago MUST sumar el monto de la membresía y el monto de la reserva: concepto `membresia_y_reserva` si el monto de la reserva es mayor que 0, y concepto `membresia` si es 0. Los montos MUST guardarse en céntimos enteros. Cambiar `configuracion` MUST NOT alterar reservas ya guardadas.

#### Scenario: Profunda de 2 dormitorios y 1 baño

- **WHEN** la primera limpieza es una profunda de 2 dormitorios y 1 baño (5 h, precio de lista S/ 193,50)
- **THEN** la reserva guarda precio de lista 19350, 3 horas gratis y monto 6966 (2 h × S/ 193,50 ÷ 5 × 0,9 = S/ 69,66), y el pago es `membresia_y_reserva` por 33666 (S/ 267 + S/ 69,66)

#### Scenario: Estándar de 3 horas

- **WHEN** la primera limpieza es una estándar de 1 dormitorio y 1 baño (3 h)
- **THEN** el monto de la reserva es 0, el pago es de concepto `membresia` por 26700 y la reserva sigue `pendiente`

#### Scenario: Paquete de 3 horas

- **WHEN** la primera limpieza es el paquete de 3 horas
- **THEN** el monto de la reserva es 0 y el pago es de concepto `membresia` por 26700

#### Scenario: Servicio de menos de 3 horas

- **WHEN** la primera limpieza es una estándar de 0 dormitorios y 1 baño (2 h)
- **THEN** las horas gratis aplicadas son 2, el monto de la reserva es 0 y el pago es de concepto `membresia`

#### Scenario: El monto de la membresía sale de la configuración

- **WHEN** `membresia_precio_mensual` vale 10000 y `membresia_meses` vale 2
- **THEN** la membresía y el pago incluyen 20000 por la membresía

#### Scenario: Un cambio de precios no toca lo guardado

- **WHEN** después de crear la reserva se cambia el precio del nivel 3 en `configuracion`
- **THEN** la reserva ya guardada conserva su precio de lista, descuento y monto

### Requirement: Duración, apoyo extra y rango bloqueado

La reserva MUST guardar `horas_trabajo` (de 1 persona), `horas_agenda` y `requiere_apoyo` tal como los calcula el módulo de precios, y su rango bloqueado MUST ser el inicio hasta el fin del servicio (`horas_agenda`) más `traslado_horas`. Si requiere apoyo, `apoyo_estado` MUST quedar `por_coordinar`; el apoyo no ocupa un equipo y no cambia el precio.

#### Scenario: Estándar de 2 dormitorios y 1 baño

- **WHEN** se reserva una estándar de 2 dormitorios y 1 baño desde las 10:00
- **THEN** la reserva dura 4 h, termina a las 14:00 y bloquea hasta las 15:00

#### Scenario: Servicio con apoyo

- **WHEN** se reserva una profunda de 3 dormitorios y 2 baños (7 h de trabajo) desde las 08:00
- **THEN** la reserva guarda `horas_trabajo` 7, `horas_agenda` 3,5, `requiere_apoyo` verdadero y `apoyo_estado` `por_coordinar`, bloquea hasta las 12:30 y su precio de lista es 28350 (el mismo con o sin apoyo)

#### Scenario: Mudanza con apoyo

- **WHEN** se reserva una mudanza de 3 dormitorios y 1 baño (8 h de trabajo) desde las 08:00
- **THEN** la reserva guarda `horas_agenda` 4 y `requiere_apoyo` verdadero, y bloquea hasta las 13:00

#### Scenario: Servicio de hasta 6 horas sin apoyo

- **WHEN** se reserva una profunda de 2 dormitorios y 1 baño (5 h) o una mudanza de 2 dormitorios y 2 baños (6 h)
- **THEN** no requiere apoyo, `apoyo_estado` queda vacío y la agenda ocupa las horas completas

#### Scenario: Paquete de 8 horas

- **WHEN** se reserva el paquete de 8 horas desde las 08:00
- **THEN** no requiere apoyo, dura 8 h y bloquea hasta las 17:00

### Requirement: Asignar al primer equipo libre y rechazar con 409 si no hay cupo

La reserva MUST asignarse al primer equipo activo cuyo rango bloqueado no choque con otra reserva activa, probando cada equipo en un punto de guardado propio para que un rechazo no aborte la transacción. Si ningún equipo está libre, MUST responder `409` con el mensaje de elegir otra hora y no dejar membresía ni pago. Dos peticiones simultáneas por el último cupo MUST producir exactamente una reserva y un `409`. Una reserva que empieza justo cuando termina el traslado de otra del mismo equipo MUST aceptarse.

#### Scenario: Primer equipo libre

- **WHEN** el equipo 1 está libre en el rango
- **THEN** la reserva queda en el equipo 1

#### Scenario: El primer equipo está ocupado

- **WHEN** el equipo 1 tiene una reserva activa que se solapa y el equipo 2 está libre
- **THEN** la reserva queda en el equipo 2

#### Scenario: Ningún equipo libre

- **WHEN** los dos equipos tienen una reserva activa que se solapa con el rango bloqueado
- **THEN** la respuesta es `409` con el mensaje de elegir otra hora y no existe ninguna membresía ni pago nuevos

#### Scenario: Dos peticiones por el último cupo

- **WHEN** dos clientes distintos envían a la vez una reserva por el único cupo libre
- **THEN** una recibe `201` y la otra `409`, y solo la primera tiene membresía y pago

#### Scenario: Empezar justo al terminar el traslado

- **WHEN** un equipo tiene una reserva que bloquea hasta las 13:00 y se reserva desde las 13:00
- **THEN** la reserva se acepta

### Requirement: Una reserva en espera y una membresía por cliente

Un cliente MUST tener como máximo una reserva `pendiente`. Si ya tiene una reserva esperando la aprobación de su pago, la respuesta MUST ser `409` con un mensaje que lo explica. Un cliente que ya tiene una membresía (`pendiente` o `activa`) MUST NOT crear otra con este flujo: la respuesta MUST ser `409` con un mensaje claro (si la membresía está pendiente, que su pago está en revisión y que elegirá nuevo día y hora cuando se apruebe; si ya es miembro, que reserve desde su perfil). Estos `409` MUST llevar el código de error `en_espera` en el formato único de errores, distinto del `conflicto` de la falta de cupo, para que el asistente (change 9b) los distinga sin leer el texto del mensaje. Las reservas de un miembro con descuento las construye el ítem #13 sobre esta misma ruta. Si dos peticiones del mismo cliente llegan a la vez, MUST crearse a lo sumo una membresía y una reserva, y la otra MUST responder `409`.

#### Scenario: Reserva pendiente existente

- **WHEN** un cliente con una reserva `pendiente` vigente intenta crear otra
- **THEN** la respuesta es `409` con el mensaje de que ya tiene una reserva esperando la aprobación de su pago y no se crea nada

#### Scenario: Membresía pendiente sin reserva viva

- **WHEN** un cliente cuya reserva ya expiró y cuya membresía sigue `pendiente` intenta reservar de nuevo
- **THEN** la respuesta es `409` con el mensaje de que su pago está en revisión y no se crea una segunda membresía

#### Scenario: Cliente que ya es miembro

- **WHEN** un cliente con una membresía `activa` envía la petición
- **THEN** la respuesta es `409` con el mensaje de reservar desde su perfil y no recibe otra limpieza gratis

#### Scenario: Dos peticiones simultáneas del mismo cliente

- **WHEN** un cliente nuevo envía dos peticiones a la vez
- **THEN** exactamente una responde `201` y la otra `409`, y el cliente tiene una membresía, un pago y una reserva

### Requirement: Las reservas vencidas se marcan al empezar la escritura

Toda creación MUST empezar marcando como `expirada` las reservas `pendiente` cuyo plazo venció, dentro de la misma transacción. Una reserva vencida de otro cliente MUST NOT impedir reservar su horario.

#### Scenario: Horario ocupado por una pendiente vencida

- **WHEN** un cliente reserva un horario que solo ocupaba una reserva `pendiente` cuyo `expira_en` ya pasó
- **THEN** la nueva reserva se crea y la anterior queda `expirada`

#### Scenario: Reserva vencida de otro cliente no cuenta para el límite

- **WHEN** un cliente tiene una reserva `pendiente` vencida y otro cliente reserva
- **THEN** la reserva del primero pasa a `expirada` y no afecta la creación del segundo

### Requirement: La limpieza gratis depende del historial del cliente

La primera limpieza MUST recibir las horas gratis solo si el cliente no tiene ninguna reserva `pendiente`, `confirmada` ni `completada`; el servidor lo decide solo y el cliente no lo elige. Un cliente que ya recibió su limpieza gratis (por ejemplo, al renovar) MUST NOT recibir otra. Comprobar que el hogar (distrito, dirección y departamento normalizados) no la recibió antes, y el índice único por hogar, pertenecen al ítem #10; este ítem solo deja un punto único donde #10 agrega esa regla.

#### Scenario: Cliente sin reservas

- **WHEN** un cliente sin membresía ni reservas reserva
- **THEN** la reserva tiene `primera_gratis` verdadero y 3 horas gratis (o las del servicio si dura menos)

#### Scenario: Cliente que ya tiene una reserva viva o realizada

- **WHEN** el cliente ya tiene una reserva `pendiente`, `confirmada` o `completada`
- **THEN** no se le aplican horas gratis (y este flujo responde `409` por su membresía existente)

### Requirement: Cotización calculada por el servidor

`GET /api/cotizacion` MUST exigir sesión (`401`) y devolver, para un servicio (`tipo` con `dormitorios` y `banos`, o `tipo=paquete` con `horas`), el cálculo del servicio con las horas gratis aplicadas (nivel, horas de trabajo, horas de agenda, apoyo, precio de lista, horas gratis, monto), el monto de la membresía (mensual, meses y total, leídos de `configuracion`), el total a pagar, la espera máxima del pago en horas y el rango de fechas reservables (desde la fecha local en que se cumplen las 48 horas de anticipación hasta la fecha local del límite de la primera membresía) y el instante exacto de ese límite, con su zona horaria. Los datos inválidos MUST responder `422`. La respuesta MUST llevar `Cache-Control: private, no-store`. La ruta MUST ser de solo lectura. El navegador MUST NOT recalcular precios.

#### Scenario: Profunda de 2 dormitorios y 1 baño

- **WHEN** se pide la cotización de una profunda de 2 dormitorios y 1 baño
- **THEN** la respuesta indica 5 h, precio de lista 19350, 3 horas gratis, monto de la reserva 6966, membresía 26700 y total a pagar 33666

#### Scenario: Estándar de 3 horas

- **WHEN** se pide la cotización de una estándar de 1 dormitorio y 1 baño
- **THEN** el monto de la reserva es 0 y el total a pagar es 26700

#### Scenario: Ejemplos de duración y precio por tamaño

- **WHEN** se piden estándar, profunda y mudanza de 2 dormitorios y 1 baño, y una estándar de 0 dormitorios y 1 baño
- **THEN** las duraciones son 4, 5 y 6 horas con precios de lista 12900, 19350 y 21930, y la estándar de 0 y 1 dura 2 horas con precio de lista 6600

#### Scenario: Rango de fechas reservables

- **WHEN** se pide una cotización el lunes 2 de noviembre de 2026 a las 10:00 (Lima)
- **THEN** la primera fecha es 2026-11-04, la última es 2027-02-02 y el límite es 2027-02-02T10:00:00-05:00

#### Scenario: Datos inválidos

- **WHEN** se pide un paquete de 5 horas, o una estándar con 0 baños
- **THEN** la respuesta es `422` con un mensaje claro

#### Scenario: Sin sesión

- **WHEN** alguien sin sesión pide una cotización
- **THEN** la respuesta es `401`

### Requirement: Enlace de WhatsApp con el mensaje de la reserva

La respuesta de `POST /api/reservas` MUST incluir un enlace `https://wa.me/<número>?text=<mensaje>` cuyo mensaje, ya escrito, resume la reserva (nombre y celular del cliente, servicio, día y hora, dirección y que está en espera de la aprobación del pago). El número MUST leerse de la variable de entorno `WHATSAPP_NUMERO`; si falta o no son solo dígitos, el enlace MUST ser `null`. El sistema MUST NOT enviar ningún mensaje por su cuenta (PRD, "No alcance").

#### Scenario: Con número configurado

- **WHEN** `WHATSAPP_NUMERO` es `51912345678`
- **THEN** la respuesta trae un enlace que empieza con `https://wa.me/51912345678?text=` y cuyo texto decodificado nombra el servicio, el día y la hora, y el distrito

#### Scenario: Sin número

- **WHEN** `WHATSAPP_NUMERO` no está definida o tiene letras
- **THEN** el enlace es `null` y la reserva se crea igual

### Requirement: Errores con el formato único y reintento si Neon está dormido

Todas las respuestas de error MUST usar el formato único de errores en español. Si la base de datos no responde por estar dormida, el servidor MUST reintentar una vez toda la operación y, si vuelve a fallar, responder `503` con "Inténtalo en unos segundos." Un error inesperado MUST mostrar un mensaje genérico y dejar el detalle en los registros.

#### Scenario: Neon dormido

- **WHEN** la primera conexión falla por conexión cortada y la segunda funciona
- **THEN** la reserva se crea una sola vez y la respuesta es `201`

#### Scenario: Neon no responde

- **WHEN** ambos intentos fallan por conexión
- **THEN** la respuesta es `503` con "Inténtalo en unos segundos." y no queda ninguna fila nueva

#### Scenario: Error inesperado

- **WHEN** ocurre un error que no es del cliente
- **THEN** la respuesta es `500` con un mensaje genérico que no contiene detalles técnicos
