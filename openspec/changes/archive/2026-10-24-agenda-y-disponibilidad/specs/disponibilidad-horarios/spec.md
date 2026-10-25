## ADDED Requirements

### Requirement: Horario de atención e intervalo de inicios

El sistema MUST ofrecer horarios de inicio solo en los días de atención de `configuracion.horario_atencion` (lunes a sábado), cada `intervalo_horarios_minutos` (30 min) desde la apertura (08:00), y solo si el servicio **termina** a más tardar a la hora de cierre (18:00). La hora de traslado MAY pasar del cierre. Un día sin atención (domingo) MUST responder sin horarios. Las horas se interpretan en la zona de `horario_atencion.zona` (`America/Lima`).

#### Scenario: Horarios de una estándar de 4 horas

- **WHEN** se piden los horarios de un sábado para una estándar de 2 dormitorios y 1 baño (4 h en la agenda)
- **THEN** los inicios van de 08:00 a 14:00 cada 30 minutos (13 horarios), porque a las 14:00 el servicio termina a las 18:00

#### Scenario: Un paquete de 8 horas

- **WHEN** se piden los horarios de un martes para un paquete de 8 h
- **THEN** los inicios van de 08:00 a 10:00 cada 30 minutos (5 horarios)

#### Scenario: Con apoyo extra se usan las horas de agenda

- **WHEN** se piden los horarios de un viernes para una profunda de 3 dormitorios y 2 baños (7 h de trabajo, 3,5 h en la agenda)
- **THEN** los inicios van de 08:00 a 14:30 cada 30 minutos (14 horarios)

#### Scenario: No se ofrecen domingos

- **WHEN** se piden los horarios de un domingo
- **THEN** la respuesta indica que ese día no hay atención y la lista de horarios está vacía

#### Scenario: El horario sale de la configuración

- **WHEN** la configuración cambia el cierre a las 17:00 o el intervalo a 60 minutos
- **THEN** los horarios cambian en consecuencia sin cambiar el código

### Requirement: Anticipación mínima de 48 horas

Un horario MUST estar disponible solo si su inicio es igual o posterior a la hora actual más `anticipacion_minima_horas` (48 h). Los horarios que no cumplen MUST aparecer en la respuesta como no disponibles con el motivo `anticipacion`, para que la interfaz los muestre en gris.

#### Scenario: Frontera de las 48 horas

- **WHEN** son las 10:00 del lunes 2 de noviembre de 2026 (hora de Lima) y se piden los horarios del miércoles 4 de noviembre para un servicio de 2 h
- **THEN** los horarios de 08:00 a 09:30 no están disponibles (motivo `anticipacion`) y el de 10:00 sí lo está

#### Scenario: Un día pasado

- **WHEN** se piden los horarios de una fecha anterior a hoy
- **THEN** todos aparecen no disponibles con el motivo `anticipacion`

### Requirement: Rango bloqueado con el traslado

El rango bloqueado de una reserva MUST ir desde su inicio hasta su inicio más `horas_agenda` más `traslado_horas` (1 h). `horas_agenda` MUST salir de `calcularServicio` (ítem #4), nunca recalcularse aparte. El traslado MUST leerse de `configuracion`.

#### Scenario: Estándar de 2 dormitorios y 1 baño

- **WHEN** se calcula el rango de una estándar de 4 h que empieza a las 10:00
- **THEN** el servicio termina a las 14:00 y el rango bloqueado a las 15:00

#### Scenario: Profunda de 5 horas

- **WHEN** se calcula el rango de una profunda de 2 dormitorios y 1 baño que empieza a las 09:00
- **THEN** el servicio termina a las 14:00 y el rango bloqueado a las 15:00

#### Scenario: Apoyo extra bloquea la mitad

- **WHEN** se calcula el rango de una profunda de 3 dormitorios y 2 baños (7 h) y el de una mudanza de 3 dormitorios y 1 baño (8 h), ambas desde las 08:00
- **THEN** los servicios terminan a las 11:30 y a las 12:00, y los rangos bloqueados a las 12:30 y a las 13:00, con el mismo precio

#### Scenario: Paquete de 8 horas

- **WHEN** se calcula el rango de un paquete de 8 h desde las 08:00
- **THEN** el servicio termina a las 16:00 y el rango bloqueado a las 17:00

#### Scenario: El traslado sale de la configuración

- **WHEN** la configuración cambia el traslado a 1,5 h
- **THEN** una estándar de 4 h desde las 10:00 bloquea hasta las 15:30

### Requirement: Disponibilidad por cupo

Un horario MUST estar disponible si existe al menos un equipo **activo** que esté libre durante **todo** el rango bloqueado; no se puede repartir un rango entre dos equipos. Un equipo está libre si no tiene ninguna reserva activa (condición común de reserva activa) cuyo rango bloqueado se solape con el pedido, con rangos semiabiertos. Un horario sin ningún equipo libre MUST aparecer no disponible con el motivo `sin_cupo`. Los equipos inactivos MUST ignorarse, de modo que agregar un equipo activo suma capacidad sin cambiar el código. La respuesta MUST NOT incluir datos de otros clientes: ni identificadores de reserva, ni nombres, ni direcciones, ni equipos ocupados.

#### Scenario: Sin reservas, todo disponible

- **WHEN** no hay reservas activas ese día
- **THEN** todos los horarios por horario de atención y anticipación están disponibles

#### Scenario: Con un equipo ocupado y otro libre sigue disponible

- **WHEN** el equipo 1 tiene una reserva activa de 10:00 a 15:00 (con traslado) y se piden horarios de 2 h que incluyen ese rango
- **THEN** esos horarios siguen disponibles, por el equipo 2

#### Scenario: Con los dos equipos ocupados no hay cupo

- **WHEN** el equipo 1 está ocupado de 08:00 a 13:00 y el equipo 2 de 10:00 a 15:00 (rangos bloqueados) y se piden horarios de una estándar de 2 h (rango de 3 h)
- **THEN** todos los inicios de 08:00 a 12:30 están `sin_cupo` y el de 13:00 está disponible, porque el equipo 1 queda libre desde las 13:00 (el equipo 2 lo queda desde las 15:00)

#### Scenario: Un rango no se reparte entre equipos

- **WHEN** el equipo 1 está ocupado de 08:00 a 10:00 y de 11:30 a 14:00, el equipo 2 de 09:00 a 12:00, y se piden horarios de un servicio con rango bloqueado de 3 h
- **THEN** el inicio de las 10:00 está `sin_cupo`, aunque en cada tramo haya algún equipo libre

#### Scenario: Las reservas vencidas o terminadas no ocupan

- **WHEN** un equipo solo tiene una reserva `pendiente` vencida, una `cancelada` y una `expirada` en ese rango
- **THEN** el horario está disponible

#### Scenario: Una pendiente vigente sí ocupa

- **WHEN** los dos equipos tienen una reserva `pendiente` con `expira_en` en el futuro que cubre el rango
- **THEN** el horario está `sin_cupo`

#### Scenario: Un equipo inactivo no cuenta

- **WHEN** un equipo está inactivo y el otro ocupado en el rango
- **THEN** el horario está `sin_cupo`

#### Scenario: Más equipos, más capacidad

- **WHEN** se activa un tercer equipo libre y los otros dos están ocupados
- **THEN** el horario pasa a disponible

#### Scenario: Se puede excluir la reserva que se reprograma

- **WHEN** se piden horarios indicando la reserva propia que se quiere mover y esa reserva es la única que ocupa un equipo
- **THEN** su propio rango aparece libre (lo usa el ítem #12)

#### Scenario: La respuesta no revela a otros clientes

- **WHEN** hay reservas de otros clientes en la agenda
- **THEN** la respuesta solo contiene, por horario, la hora, si está disponible y el motivo

### Requirement: Validación del inicio en el servidor

El sistema MUST ofrecer una función que valide el inicio de un servicio con las mismas reglas que la disponibilidad (día de atención, dentro del horario, múltiplo del intervalo, fin del servicio antes del cierre y anticipación mínima) y lance `ErrorApi.invalido` (`422`) con un mensaje claro en español si no se cumplen. El ítem #9 la usa al crear la reserva y el #12 al reprogramar. El navegador MUST NOT ser la única defensa.

#### Scenario: Un inicio válido

- **WHEN** se valida un martes a las 10:00 con más de 48 h de anticipación para un servicio de 4 h
- **THEN** no lanza ningún error

#### Scenario: Domingo

- **WHEN** se valida un inicio en domingo
- **THEN** responde `422` indicando que se atiende de lunes a sábado

#### Scenario: Fuera de horario

- **WHEN** se valida un inicio a las 07:30, o a las 15:00 para un servicio de 4 h (terminaría a las 19:00)
- **THEN** responde `422` indicando el horario de atención

#### Scenario: No coincide con el intervalo

- **WHEN** se valida un inicio a las 09:15
- **THEN** responde `422` indicando que los horarios son cada 30 minutos

#### Scenario: Dentro de las 48 horas

- **WHEN** se valida un inicio a menos de 48 h de la hora actual
- **THEN** responde `422` indicando la anticipación mínima

### Requirement: Consulta de disponibilidad por la API

El sistema MUST exponer `GET /api/disponibilidad` con los parámetros `fecha` (`AAAA-MM-DD`) y el servicio (`tipo` con `dormitorios` y `banos`, o `tipo=paquete` con `horas`). La ruta MUST exigir sesión (`401` sin ella), validar los parámetros (`422` con mensaje claro si la fecha no existe o el servicio es inválido), obtener `horas_agenda` con `calcularServicio` y leer la configuración y las reservas activas en la misma petición. MUST responder `200` con `{ fecha, atendido, horarios: [{ hora, inicio, disponible, motivo }] }`, con `hora` en `HH:mm` de Lima e `inicio` en ISO 8601 con zona, y con `Cache-Control: private, no-store`. Un fallo de conexión con Neon MUST reintentarse una vez y, si persiste, responder `503` con "Inténtalo en unos segundos." La ruta MUST NOT comprobar la membresía (lo hacen #9 y #13) ni escribir en la base.

#### Scenario: Sin sesión

- **WHEN** se llama sin cookie de sesión
- **THEN** responde `401` con el formato único de error

#### Scenario: Fecha inválida

- **WHEN** `fecha` es `2026-02-30`, `mañana` o está ausente
- **THEN** responde `422` con un mensaje que pide una fecha válida

#### Scenario: Servicio inválido

- **WHEN** se pide `tipo=paquete&horas=5`, o una estándar con `banos=0`
- **THEN** responde `422` con el mensaje de `calcularServicio`

#### Scenario: Respuesta correcta

- **WHEN** un cliente con sesión pide un martes futuro para una estándar de 2 dormitorios y 1 baño
- **THEN** responde `200` con 13 horarios (`08:00` a `14:00`), cada uno con `disponible` y, si no lo está, su `motivo`, y la cabecera `Cache-Control: private, no-store`

#### Scenario: Un domingo

- **WHEN** se pide un domingo
- **THEN** responde `200` con `atendido: false` y `horarios: []`

#### Scenario: Neon no responde

- **WHEN** la conexión a Neon falla dos veces
- **THEN** responde `503` con "Inténtalo en unos segundos."
