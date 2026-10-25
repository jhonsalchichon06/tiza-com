## Purpose

Garantiza que las 3 primeras horas gratis se entreguen una sola vez por cliente y una sola vez por hogar, aunque se use otra cuenta o lleguen peticiones al mismo tiempo (PRD, "Alcance" punto 3 y caso borde 10; ADR 0008, 0009 y 0013). El hogar se identifica con `(distrito, direccion_normalizada, departamento_normalizado)`.

## ADDED Requirements

### Requirement: Índices únicos parciales de la limpieza gratis

La base de datos MUST tener dos índices únicos parciales sobre `reservas`, ambos con la condición `primera_gratis` verdadero y estado `pendiente`, `confirmada` o `completada`: uno sobre `usuario_id` y otro sobre `(distrito, direccion_normalizada, departamento_normalizado)`. Las reservas `cancelada` y `expirada` MUST NOT contar. La migración MUST solo crear estos índices, sin modificar filas, columnas ni la restricción de exclusión `reservas_sin_solape_por_equipo`.

#### Scenario: Dos reservas gratis vivas del mismo cliente

- **WHEN** se intenta guardar una segunda reserva con `primera_gratis` verdadero para un cliente que ya tiene una `pendiente`, `confirmada` o `completada`
- **THEN** la base rechaza la inserción con `23505` del índice por cliente

#### Scenario: Dos reservas gratis vivas del mismo hogar

- **WHEN** se intenta guardar una reserva con `primera_gratis` verdadero para otro cliente con el mismo distrito, la misma dirección normalizada y el mismo departamento normalizado de una reserva gratis `pendiente`, `confirmada` o `completada`
- **THEN** la base rechaza la inserción con `23505` del índice por hogar

#### Scenario: La reserva cancelada o expirada libera la limpieza gratis

- **WHEN** la reserva gratis del hogar (o del cliente) está `cancelada` o `expirada`
- **THEN** la base acepta otra reserva con `primera_gratis` verdadero para ese hogar (o cliente)

#### Scenario: Las reservas pagadas no ocupan el índice

- **WHEN** un hogar tiene reservas con `primera_gratis` falso
- **THEN** la base acepta cualquier cantidad de ellas y una reserva gratis para ese hogar

### Requirement: La limpieza gratis exige cliente y hogar sin limpieza gratis previa

`decidirLimpiezaGratis` MUST recibir el cliente y la clave del hogar, y MUST devolver verdadero solo si se cumplen las dos condiciones: el cliente no tiene ninguna reserva viva o realizada (`pendiente` vigente, `confirmada` o `completada`) y el hogar no tiene una reserva con `primera_gratis` viva o realizada. Una reserva del hogar con `primera_gratis` falso MUST NOT impedirla. La comparación del hogar MUST usar `distrito`, `direccion_normalizada` y `departamento_normalizado`; las referencias, la calle y el número tal como los escribió el cliente MUST NOT intervenir.

#### Scenario: Cliente y hogar nuevos

- **WHEN** el cliente no tiene reservas y ninguna reserva gratis viva o realizada comparte su hogar
- **THEN** la reserva se crea con las 3 horas gratis y `primera_gratis` verdadero

#### Scenario: Segunda cuenta en el mismo hogar paga el precio completo

- **WHEN** otra cuenta ya tiene una reserva gratis `pendiente`, `confirmada` o `completada` en el mismo hogar y una cuenta distinta reserva con la misma dirección
- **THEN** la reserva se crea con `primera_gratis` falso, `horas_gratis_aplicadas` 0 y el monto del servicio con el descuento de miembro y sin horas gratis, y el pago es de concepto `membresia_y_reserva` por la membresía más ese monto

#### Scenario: La misma dirección escrita de otra forma

- **WHEN** la primera cuenta escribió "Av. Larco", "123" y "Dpto 302" y la segunda escribe "Avenida Larco", "123" y "dpto. 302" en el mismo distrito
- **THEN** las dos tienen la misma clave de hogar y la segunda no recibe las horas gratis

#### Scenario: Dos departamentos distintos del mismo edificio

- **WHEN** una cuenta ya recibió la limpieza gratis en el departamento 302 y otra reserva en el departamento 401 del mismo edificio
- **THEN** la segunda sí recibe las 3 horas gratis

#### Scenario: El mismo edificio sin departamento frente a uno con departamento

- **WHEN** una reserva gratis tiene departamento vacío y otra cuenta reserva la misma calle y número con el departamento "302"
- **THEN** la segunda sí recibe las 3 horas gratis (claves de hogar distintas)

#### Scenario: Una reserva pagada del hogar no cuenta

- **WHEN** el hogar solo tiene reservas con `primera_gratis` falso
- **THEN** una cuenta nueva con esa dirección sí recibe las 3 horas gratis

#### Scenario: Quien ya tuvo su limpieza gratis no recibe otra

- **WHEN** el cliente tiene una reserva `completada` (o `confirmada`) y reserva en otro hogar
- **THEN** no recibe horas gratis, aunque el hogar nuevo no haya recibido ninguna

#### Scenario: Reuso tras cancelar

- **WHEN** la única reserva gratis del hogar y del cliente está `cancelada` o `expirada`
- **THEN** la siguiente reserva del cliente en ese hogar sí recibe las 3 horas gratis

### Requirement: Peticiones simultáneas por la misma limpieza gratis

Si dos peticiones pasan a la vez la comprobación del hogar, la base de datos MUST dejar pasar solo una. La que pierde MUST responder `409` con el código `limpieza_gratis_usada` y un mensaje en español que indique que otra cuenta ya recibió la limpieza gratis de esa dirección y que se revise el precio; MUST NOT crear membresía, pago ni reserva, y MUST NOT reintentarse sola con otro precio. Un `23505` de cualquier otro índice MUST seguir tratándose como hasta ahora.

#### Scenario: Dos cuentas, mismo hogar, al mismo tiempo

- **WHEN** dos clientes distintos envían a la vez, con horarios distintos, una reserva para la misma dirección y las dos pasan la comprobación
- **THEN** exactamente una reserva queda con `primera_gratis` verdadero y la otra petición responde `409` con el código `limpieza_gratis_usada`, sin membresía, pago ni reserva nuevos

#### Scenario: El ganador no llega a guardarse

- **WHEN** la petición que iba ganando falla antes del commit y se deshace
- **THEN** la otra petición se guarda con las horas gratis

#### Scenario: Diez cuentas por el mismo hogar

- **WHEN** diez clientes distintos envían a la vez una reserva con la misma dirección
- **THEN** exactamente una tiene `primera_gratis` verdadero

### Requirement: Las reservas vencidas no cuentan para la limpieza gratis

Una reserva `pendiente` con `expira_en <= now()` MUST NOT impedir la limpieza gratis al decidir, ni al leer ni al escribir, aunque nadie la haya marcado `expirada`. La condición MUST vivir en un solo fragmento compartido con la lectura de la agenda. Todo insert de una reserva MUST ocurrir dentro de `transaccionDeEscritura`, que marca las vencidas antes de insertar; así una vencida sin marcar nunca provoca un `23505` falso. Un `409` que deshace la transacción deshace también esa marca, y eso MUST NOT cambiar quién recibe la limpieza gratis.

#### Scenario: Vencida sin marcar de otra cuenta

- **WHEN** otra cuenta tiene una reserva gratis `pendiente` con `expira_en` en el pasado en el mismo hogar y una cuenta nueva reserva esa dirección
- **THEN** la cuenta nueva recibe las 3 horas gratis y la vencida queda `expirada`

#### Scenario: Un 409 deshace la marca y no cambia el resultado

- **WHEN** una escritura marca `expirada` una vencida y después falla con `409`, y luego otra cuenta reserva el mismo hogar
- **THEN** la vencida sigue `pendiente` tras el `409`, y la segunda escritura la marca `expirada` y concede las horas gratis

#### Scenario: Vencida del propio cliente

- **WHEN** el cliente tiene una reserva gratis vencida sin marcar y lee su cotización
- **THEN** la reserva vencida no cuenta contra él

#### Scenario: Ningún otro código inserta reservas

- **WHEN** se revisan los archivos de `src/` (sin pruebas)
- **THEN** la única llamada a `insert(reservas)` está en `src/lib/agenda/asignar.ts`
