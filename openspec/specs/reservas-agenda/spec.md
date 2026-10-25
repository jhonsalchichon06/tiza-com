# reservas-agenda Specification

## Purpose
TBD - created by archiving change agenda-y-disponibilidad. Update Purpose after archive.

## Requirements

### Requirement: Tabla de reservas con los datos del servicio

El sistema MUST tener una tabla `reservas` con: usuario, equipo, tipo de servicio (`estandar`, `profunda`, `mudanza` o `paquete`), dormitorios y baños (solo por tamaño), `horas_trabajo` (de 1 persona), `horas_agenda`, `requiere_apoyo`, `apoyo_estado` (`por_coordinar` o `coordinado`) y nota de apoyo, la dirección del hogar (distrito, calle, número, departamento, `departamento_normalizado`, referencias y `direccion_normalizada`, ADR 0013), el inicio y el fin del servicio, el fin del rango bloqueado (fin del servicio más el traslado), la copia de lo cobrado (precio de lista, horas gratis aplicadas, crédito aplicado, descuento y monto, en céntimos), el indicador `primera_gratis`, el estado (`pendiente`, `confirmada`, `completada`, `cancelada` o `expirada`), `expira_en` y las fechas de creación y actualización. Todas las fechas MUST ser `timestamptz`. La base de datos MUST rechazar con restricciones `CHECK`: un servicio cuyo fin no es posterior a su inicio o cuyo rango bloqueado termina antes que el servicio; una reserva `pendiente` sin `expira_en`; un servicio por tamaño sin dormitorios o baños; un paquete con dormitorios o baños; y `requiere_apoyo` incoherente con `apoyo_estado`. La tabla MUST NOT tener todavía `membresia_id` ni `pago_id`, que agrega el ítem #9.

#### Scenario: Una reserva válida se guarda

- **WHEN** se inserta una reserva de una estándar de 2 dormitorios y 1 baño (4 h) el 2026-12-01 de 10:00 a 14:00 (Lima) con rango bloqueado hasta las 15:00, estado `pendiente` y `expira_en` dentro de 24 h
- **THEN** la fila se guarda y sus fechas se leen como instantes `timestamptz`

#### Scenario: El fin debe ser posterior al inicio

- **WHEN** se inserta una reserva cuyo fin es igual o anterior a su inicio, o cuyo fin de rango bloqueado es anterior a su fin
- **THEN** la base de datos rechaza la fila por la restricción `CHECK`

#### Scenario: Una reserva pendiente exige su vencimiento

- **WHEN** se inserta una reserva `pendiente` con `expira_en` vacío
- **THEN** la base de datos rechaza la fila

#### Scenario: Tamaño y paquete son excluyentes

- **WHEN** se inserta un servicio `paquete` con dormitorios, o un servicio `estandar` sin dormitorios ni baños
- **THEN** la base de datos rechaza la fila

#### Scenario: El apoyo es coherente

- **WHEN** se inserta una reserva con `requiere_apoyo` verdadero y `apoyo_estado` vacío, o con `requiere_apoyo` falso y `apoyo_estado` lleno
- **THEN** la base de datos rechaza la fila

### Requirement: Capacidad por equipo garantizada por la base de datos

La tabla `reservas` MUST tener una restricción de exclusión (extensión `btree_gist`) que rechace cualquier fila cuyo rango bloqueado `[inicio, fin_bloqueo)` se solape con el de otra fila del **mismo equipo** cuando ambas están en estado `pendiente` o `confirmada`. Los rangos MUST ser semiabiertos: una reserva que empieza justo cuando termina el traslado de otra del mismo equipo MUST aceptarse. Las reservas `completada`, `cancelada` y `expirada` MUST NOT bloquear. El rechazo MUST salir como error `23P01` de PostgreSQL, que el servidor convierte en `409`.

#### Scenario: Dos equipos admiten dos reservas simultáneas

- **WHEN** hay una reserva activa de 10:00 a 14:00 (bloqueada hasta las 15:00) en el equipo 1 y se inserta otra de 11:00 a 13:00 en el equipo 2
- **THEN** ambas se guardan

#### Scenario: La tercera reserva en el mismo rango se rechaza

- **WHEN** los dos equipos tienen una reserva activa que se solapa con el rango bloqueado de 12:00 a 15:00 y se intenta insertar una tercera en cualquiera de los dos equipos
- **THEN** la base de datos responde `23P01` en ambos intentos y no guarda la fila

#### Scenario: Empezar justo al terminar el traslado se acepta

- **WHEN** una reserva del equipo 1 ocupa de 10:00 a 12:00 con rango bloqueado hasta las 13:00 y se inserta otra del mismo equipo que empieza a las 13:00
- **THEN** la segunda se guarda

#### Scenario: Empezar un minuto antes de que termine el traslado se rechaza

- **WHEN** la misma reserva del equipo 1 bloquea hasta las 13:00 y se inserta otra del mismo equipo que empieza a las 12:59
- **THEN** la base de datos responde `23P01`

#### Scenario: Cancelar o expirar libera el cupo de inmediato

- **WHEN** una reserva activa pasa a `cancelada` (o a `expirada`) y enseguida se inserta otra en el mismo equipo y rango
- **THEN** la segunda se guarda

#### Scenario: Una reserva completada no bloquea

- **WHEN** una reserva `confirmada` pasa a `completada` y se inserta otra en el mismo equipo y rango
- **THEN** la segunda se guarda

#### Scenario: Dos transacciones simultáneas por el último cupo

- **WHEN** dos transacciones abiertas a la vez insertan una reserva en el mismo equipo y rango, y la primera confirma antes que la segunda
- **THEN** la segunda falla con `23P01` y solo queda una fila

### Requirement: Condición común de reserva activa

El sistema MUST definir en un solo lugar la condición de "reserva activa" para todas las lecturas: la reserva está `confirmada`, o está `pendiente` con `expira_en > now()`. Toda lectura de disponibilidad, perfil y listados del administrador MUST usar esa condición. Leer MUST NOT escribir nada (ADR 0009).

#### Scenario: Una pendiente vencida no cuenta aunque nadie la haya marcado

- **WHEN** hay una reserva `pendiente` con `expira_en` en el pasado que sigue sin marcarse como `expirada`
- **THEN** la condición de reserva activa no la incluye y ninguna lectura la trata como ocupada

#### Scenario: Una pendiente vigente y una confirmada cuentan

- **WHEN** hay una reserva `pendiente` con `expira_en` en el futuro y otra `confirmada`
- **THEN** la condición de reserva activa incluye a las dos

#### Scenario: Leer no modifica la base

- **WHEN** se consulta la disponibilidad habiendo una reserva `pendiente` vencida
- **THEN** la fila conserva su estado `pendiente` después de la consulta

### Requirement: Expiración de las reservas vencidas al empezar cada escritura

El sistema MUST ofrecer una función común `expirarVencidas(tx)` que ejecute `UPDATE reservas SET estado = 'expirada' WHERE estado = 'pendiente' AND expira_en <= now()` y devuelva los identificadores marcados. MUST ofrecer también un envoltorio de transacción de escritura que la ejecute como primera sentencia, antes de la lógica del llamante, para que los ítems #9, #11, #12 y #16 no puedan olvidarla (ADR 0009). La función MUST NOT tocar reservas `confirmada` ni `pendiente` vigentes. Llamarla dos veces seguidas MUST dejar la segunda sin efecto.

#### Scenario: Se marcan solo las vencidas

- **WHEN** hay una `pendiente` vencida, una `pendiente` vigente y una `confirmada`, y se ejecuta `expirarVencidas`
- **THEN** solo la vencida pasa a `expirada` y la función devuelve su identificador

#### Scenario: Sin la marca, la vencida bloquea la inserción

- **WHEN** una `pendiente` vencida sigue sin marcarse y se inserta otra reserva en su mismo equipo y rango
- **THEN** la base de datos responde `23P01`, porque la restricción de exclusión no puede depender de `now()`

#### Scenario: Con la marca, el horario queda libre

- **WHEN** en la misma transacción se ejecuta `expirarVencidas` y después se inserta la reserva en el equipo y rango de la vencida
- **THEN** la inserción se guarda

#### Scenario: El envoltorio expira antes de la lógica del llamante

- **WHEN** se ejecuta una función dentro del envoltorio de transacción de escritura y hay una `pendiente` vencida
- **THEN** cuando la función empieza, la vencida ya figura `expirada`

#### Scenario: Repetir no tiene efecto

- **WHEN** se ejecuta `expirarVencidas` dos veces seguidas
- **THEN** la segunda devuelve una lista vacía y no cambia ninguna fila

### Requirement: Inserción en el primer equipo libre

El sistema MUST ofrecer una función que, dentro de una transacción, inserte una reserva probando los equipos candidatos en orden de identificador y envolviendo cada intento en un `SAVEPOINT`. Si la restricción de exclusión rechaza el intento (`23P01`), MUST volver al `SAVEPOINT` y probar el siguiente equipo. Si ningún equipo está libre, MUST lanzar `ErrorApi.conflicto` (`409`) con el mensaje "Esa hora ya no está disponible. Elige otra hora." Cualquier otro error de la base MUST propagarse sin convertirse en `409`. Tras un intento fallido, la transacción MUST seguir siendo utilizable (ADR 0007 y 0009).

#### Scenario: Se asigna al primer equipo libre

- **WHEN** los equipos A y B (en ese orden) están libres en el rango pedido
- **THEN** la reserva se guarda con el equipo A

#### Scenario: Si el primero está ocupado, se usa el siguiente

- **WHEN** el equipo A tiene una reserva activa que choca con el rango y el B está libre
- **THEN** la reserva se guarda con el equipo B y la transacción sigue abierta y utilizable

#### Scenario: Sin ningún equipo libre responde 409

- **WHEN** A y B tienen reservas activas que chocan con el rango
- **THEN** la función lanza un `ErrorApi` con estado `409` y el mensaje para elegir otra hora, y no queda ninguna fila nueva

#### Scenario: Otro error no se disfraza de conflicto

- **WHEN** el insert falla por una restricción `CHECK` (por ejemplo, un fin anterior al inicio)
- **THEN** el error original se propaga y no se prueba otro equipo

#### Scenario: Dos peticiones simultáneas por el último cupo

- **WHEN** dos transacciones intentan a la vez reservar el único cupo libre, ambas con la función de inserción
- **THEN** una se guarda y la otra recibe `409`

### Requirement: Las pruebas contra Neon no ensucian los datos reales

Las pruebas que usan la base de datos real MUST estar separadas de `npm test` y MUST NOT correr salvo que se pidan explícitamente. MUST usar equipos propios con `activo = false` (nunca los equipos reales), un usuario de prueba con correo `@tiza.test` y fechas lejanas, y MUST borrar al terminar sus reservas, su usuario y sus equipos, aunque la prueba falle. MUST comprobar al final que no quedan filas de prueba.

#### Scenario: `npm test` no toca la base

- **WHEN** se ejecuta `npm test` con `DATABASE_URL` definida
- **THEN** ninguna prueba abre una conexión a Neon

#### Scenario: Las pruebas reales no afectan a los clientes

- **WHEN** corren las pruebas contra Neon
- **THEN** los equipos de prueba están inactivos, así que ninguna consulta de disponibilidad real los considera ni ninguna reserva real se asigna a ellos

#### Scenario: Al terminar no queda nada

- **WHEN** terminan las pruebas contra Neon, hayan pasado o fallado
- **THEN** no existen filas de `reservas`, `usuarios` ni `equipos` con el prefijo de prueba
