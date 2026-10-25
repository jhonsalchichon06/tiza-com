## Purpose

Muestra al cliente, dentro de su perfil, en qué estado está su membresía y qué debe hacer a continuación (PRD, "Alcance" punto 7 y casos borde 1, 8 y 11; ADR 0008, 0009 y 0012). El estado se calcula a partir de lo guardado; no se guarda un estado "vencida". La renovación del mes 4 (aviso, pago y bloqueo) es del ítem #15 y no se implementa aquí.

## ADDED Requirements

### Requirement: Estado de la membresía calculado al leer

El servidor MUST calcular el estado de la membresía del cliente en cada lectura, con el reloj de la base de datos, y MUST devolver uno de estos valores: `sin_membresia`, `en_revision`, `pago_rechazado`, `activa` o `vencida`. La membresía considerada MUST ser, en este orden, la `activa` con `fin` posterior a ahora; si no hay, la `pendiente`; si no hay, la `activa` con `fin` anterior o igual a ahora más reciente. Una membresía `caducada` MUST NOT contar como membresía: sin otra, el estado es `sin_membresia`. Un cliente MUST ver solo sus propias membresías.

- `en_revision`: membresía `pendiente` cuyo último pago está `pendiente`.
- `pago_rechazado`: membresía `pendiente` cuyo último pago está `rechazado` y aún está dentro del plazo de reenvío.
- `activa`: `estado = 'activa'` y `fin` posterior a ahora; la respuesta MUST incluir `inicio`, `fin` y los días que faltan (redondeados hacia arriba).
- `vencida`: `estado = 'activa'` y `fin` anterior o igual a ahora; la respuesta MUST incluir la fecha de `fin`.

#### Scenario: Cliente sin ninguna membresía

- **WHEN** un cliente que nunca pagó abre su perfil
- **THEN** el estado es `sin_membresia` y el perfil le ofrece reservar su primera limpieza

#### Scenario: Pago de la membresía en revisión

- **WHEN** el cliente tiene una membresía `pendiente` cuyo pago está `pendiente`
- **THEN** el estado es `en_revision` y el perfil dice "Tu pago está en revisión. Te avisaremos aquí cuando se apruebe."

#### Scenario: Membresía activa con sus fechas

- **WHEN** el administrador aprobó el pago y `fin` es dentro de 40 días
- **THEN** el estado es `activa`, la respuesta trae `inicio`, `fin` y `dias_restantes` igual a 40, y el perfil muestra "Tu membresía está activa hasta el" con la fecha en hora de Lima

#### Scenario: Los 3 meses cuentan desde la aprobación

- **WHEN** el pago se creó hace 30 horas y se aprobó hace 1 hora
- **THEN** `inicio` es el instante de la aprobación y el perfil muestra el `fin` calculado desde ahí, no desde la creación del pago

#### Scenario: Membresía vencida calculada

- **WHEN** la membresía está `activa` con `fin` anterior a ahora
- **THEN** el estado es `vencida` aunque la fila no haya cambiado, y el perfil dice "Tu membresía venció el" con la fecha, sin ofrecer reservar

#### Scenario: Membresía caducada no cuenta

- **WHEN** la única membresía del cliente está `caducada`
- **THEN** el estado es `sin_membresia` y el perfil le ofrece empezar de nuevo con una reserva y un pago nuevos

#### Scenario: Otra membresía no se mezcla

- **WHEN** otro cliente tiene una membresía `activa`
- **THEN** no aparece en el perfil del primero

### Requirement: Comprobante rechazado con el plazo para subir otro

Cuando el estado es `pago_rechazado`, el perfil MUST decir que el comprobante fue rechazado, MUST mostrar el motivo si el administrador lo escribió, MUST mostrar cuántos días quedan y la fecha límite (`reenvio_hasta`, en hora de Lima), y MUST ofrecer subir otro comprobante. El servidor MUST obtener estos datos de `pagosRechazadosReenviables`, que es la definición única de "puede subir otro comprobante", y MUST NOT recalcular el plazo con el reloj del servidor ni con un número escrito en el código.

#### Scenario: Rechazado con días restantes

- **WHEN** el pago se rechazó hace 3 días y el plazo configurado es de 7
- **THEN** el perfil dice "Tu comprobante fue rechazado. Te quedan 4 días para subir otro, hasta el" con la fecha, y muestra el botón para subir otro comprobante

#### Scenario: Último día del plazo

- **WHEN** quedan menos de 24 horas del plazo
- **THEN** el perfil dice "Hoy es tu último día para subir otro comprobante" con la hora límite

#### Scenario: Con motivo del administrador

- **WHEN** el rechazo trae `motivo_rechazo`
- **THEN** el perfil lo muestra textualmente bajo el aviso

#### Scenario: El plazo es un dato

- **WHEN** `reenvio_comprobante_dias` cambia a 2 en `configuracion`
- **THEN** el mismo rechazo muestra el plazo de 2 días sin tocar el código

### Requirement: Aviso "Elige un nuevo día y hora" tras una aprobación tardía

El perfil MUST mostrar "Elige un nuevo día y hora para tu limpieza" cuando el cliente tiene un pago `aprobado` sin ninguna reserva viva o realizada, según `pagosConHorarioPendiente` del ítem #11. El servidor MUST excluir de esa lista el pago cuya última reserva fue `cancelada` con `cancelada_por = 'cliente'`: ese pago se devuelve como crédito en horas (ADR 0012, ítem #14) y no se reutiliza para otro horario. El botón que lleva a elegir el horario es del ítem #13; este aviso MUST NOT crear reservas.

#### Scenario: Aprobación tardía

- **WHEN** el administrador aprobó el pago cuando la reserva ya estaba `expirada`
- **THEN** el perfil muestra "Tu pago fue aprobado. Elige un nuevo día y hora para tu limpieza, no tienes que pagar otra vez."

#### Scenario: Reserva cancelada por el administrador y pago aprobado después

- **WHEN** la reserva fue `cancelada` con `cancelada_por = 'admin'` y el pago se aprobó
- **THEN** el perfil muestra el aviso de elegir un nuevo día y hora

#### Scenario: Reserva cancelada por el cliente no genera el aviso

- **WHEN** el cliente canceló su reserva con el pago `aprobado`
- **THEN** el perfil no muestra "Elige un nuevo día y hora" para ese pago

#### Scenario: Con una reserva viva no hay aviso

- **WHEN** el pago aprobado tiene una reserva `confirmada`
- **THEN** el perfil no muestra el aviso

### Requirement: Plazo vencido y empezar de nuevo

Cuando el cliente tiene un pago rechazado cuyo plazo venció, o su membresía en espera quedó `caducada`, el perfil MUST decir "Pasó el plazo para subir otro comprobante. Puedes empezar de nuevo con una reserva y un pago nuevos." y MUST enlazar al asistente de reserva. El perfil MUST NOT mostrar el botón de subir otro comprobante.

#### Scenario: Plazo vencido sin cierre todavía

- **WHEN** el rechazo tiene 8 días y la membresía sigue `pendiente` porque nadie disparó el cierre
- **THEN** el perfil muestra el aviso de empezar de nuevo y no el botón de subir otro comprobante

#### Scenario: Membresía caducada

- **WHEN** la membresía está `caducada`
- **THEN** el perfil muestra el aviso de empezar de nuevo

### Requirement: La limpieza gratis cancelada se conserva

Cuando el cliente tiene la membresía `activa`, ninguna reserva `pendiente` vigente, `confirmada` ni `completada`, y una reserva `cancelada` con `primera_gratis` verdadero, el perfil MUST decir "Tu limpieza gratis sigue disponible: tu próxima reserva llevará las 3 primeras horas sin costo." El servidor MUST decidirlo con `decidirLimpiezaGratis` (la misma regla que aplica la reserva) con la clave del hogar de la reserva cancelada, y MUST NOT mostrarlo si el hogar ya recibió la limpieza gratis de otra cuenta. El número de horas MUST venir de `configuracion` (`horas_gratis`).

#### Scenario: Primera limpieza cancelada

- **WHEN** el cliente canceló su primera limpieza gratis y no tiene otra reserva viva ni realizada
- **THEN** el perfil muestra que su limpieza gratis sigue disponible

#### Scenario: Ya tuvo una limpieza realizada

- **WHEN** el cliente tiene una reserva `completada`
- **THEN** el perfil no muestra el aviso

#### Scenario: Otra cuenta recibió la limpieza gratis de ese hogar

- **WHEN** otra cuenta recibió la limpieza gratis para la misma dirección
- **THEN** el perfil no muestra el aviso

#### Scenario: Horas gratis desde configuración

- **WHEN** `horas_gratis` cambia a 2 en `configuracion`
- **THEN** el aviso dice "las 2 primeras horas" sin tocar el código

### Requirement: La lectura del perfil confirma lo vencido

Antes de leer, el perfil y `GET /api/perfil` MUST ejecutar `ejecutarPasadaDeExpiracion` (ítem #11) bajo `conReintento`, para que el estado guardado coincida con lo mostrado. El estado mostrado MUST calcularse de todas formas con `reservaActiva` y el reloj de la base, así que la pasada persiste pero no decide.

#### Scenario: Reserva vencida al abrir el perfil

- **WHEN** una reserva `pendiente` venció hace una hora y el cliente abre su perfil
- **THEN** la reserva ya no aparece en próximas, figura como `expirada` en el historial y queda marcada `expirada` en la base

#### Scenario: Neon dormido

- **WHEN** la conexión falla una vez durante la lectura
- **THEN** el servidor reintenta una vez y, si vuelve a fallar, responde `503` con "Inténtalo en unos segundos."

### Requirement: Textos del perfil en español de Perú y grandes

Todos los mensajes del perfil MUST estar en español de Perú, con los montos en soles (`S/`) y las fechas en la zona de `horario_atencion`. La interfaz MUST usar tamaño de letra base de al menos 18 px y botones de al menos 48 px de alto, porque el público tiene entre 30 y 70 años.

#### Scenario: Montos y fechas

- **WHEN** el perfil muestra una reserva de 12900 céntimos
- **THEN** el monto aparece como `S/ 129` y la fecha como "martes 15 de diciembre, 10:00 am" en hora de Lima
