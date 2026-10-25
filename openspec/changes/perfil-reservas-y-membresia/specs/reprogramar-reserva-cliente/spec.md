## Purpose

Permite al cliente cambiar el día y la hora de una reserva hasta 24 horas antes del servicio, con las mismas reglas de horario que una reserva nueva y sin cobrar otra vez (PRD, "Alcance" punto 7; TECH-DESIGN, "Perfil del cliente" y "Capacidad y conflictos de horario"; ADR 0007 y 0009).

## ADDED Requirements

### Requirement: Reprogramar hasta 24 horas antes

`POST /api/reservas/:id/reprogramar` MUST exigir sesión y `application/json`, recibir `{ "inicio": "<instante ISO>" }`, y MUST aceptar una reserva `confirmada` o `pendiente` vigente del cliente de la sesión. MUST rechazar con `409` y el código `fuera_de_plazo` cuando falten menos horas para el `inicio` actual que `cancelacion_minima_horas` (24) con el mensaje "Solo puedes cambiar el horario hasta 24 horas antes del servicio. Si necesitas ayuda, escríbenos por WhatsApp." La operación MUST ir dentro de `transaccionDeEscritura` y bloquear la fila de la reserva (`FOR UPDATE`) filtrada por el dueño.

#### Scenario: Reprogramar con más de 24 horas

- **WHEN** el cliente mueve una reserva `confirmada` que empieza dentro de 4 días a otro horario libre dentro de 6 días
- **THEN** responde `200` con el `inicio` y `fin` nuevos y la reserva sigue `confirmada`

#### Scenario: Con menos de 24 horas

- **WHEN** faltan 20 horas para el servicio actual
- **THEN** responde `409` con el código `fuera_de_plazo` y la reserva no cambia

#### Scenario: Reserva pendiente

- **WHEN** el cliente reprograma una reserva `pendiente` vigente
- **THEN** conserva el estado `pendiente` y su `expira_en` original; el plazo no se extiende (ADR 0009)

#### Scenario: Estados que no se pueden reprogramar

- **WHEN** la reserva está `completada`, `cancelada` o `expirada`
- **THEN** responde `409` con un mensaje que dice por qué

#### Scenario: Reserva de otro cliente

- **WHEN** el cliente A reprograma el id de una reserva de B
- **THEN** responde `404` y la reserva de B no cambia

#### Scenario: Sin sesión o sin JSON

- **WHEN** se llama sin sesión, o con otro tipo de contenido
- **THEN** responde `401` o `415` respectivamente

### Requirement: El nuevo horario cumple las reglas de una reserva nueva

El servidor MUST validar el nuevo `inicio` con `validarInicioServicio` usando las `horas_agenda` guardadas en la reserva (sin recalcular el servicio): lunes a sábado, de 8 am a 6 pm, a intervalos de 30 minutos, terminando antes del cierre y con al menos 48 horas de anticipación; cada incumplimiento MUST responder `422` con su propio mensaje. MUST validar también la vigencia: con la membresía `activa`, el `inicio` nuevo MUST ser anterior a su `fin`; con la primera membresía todavía `pendiente`, MUST caer dentro de los `membresia_meses` siguientes a hoy (`validarVigenciaPrimeraMembresia`). Un horario igual al actual MUST responder `422` con "Elige un horario distinto al que ya tienes."

#### Scenario: Domingo

- **WHEN** el nuevo `inicio` cae en domingo
- **THEN** responde `422` y la reserva no cambia

#### Scenario: Fuera de horario

- **WHEN** el nuevo servicio terminaría después de las 6 pm
- **THEN** responde `422` con el mensaje del horario de atención

#### Scenario: Menos de 48 horas

- **WHEN** el nuevo `inicio` es dentro de 30 horas
- **THEN** responde `422` con "Reserva con al menos 48 horas de anticipación."

#### Scenario: Posterior al fin de la membresía

- **WHEN** el nuevo `inicio` es posterior al `fin` de la membresía activa
- **THEN** responde `422` con un mensaje que dice hasta qué fecha puede reservar

#### Scenario: Mismo horario

- **WHEN** el nuevo `inicio` es igual al actual
- **THEN** responde `422` con "Elige un horario distinto al que ya tienes."

### Requirement: Mover la misma reserva al primer equipo libre

La reprogramación MUST actualizar la misma fila (mismo `id`, mismo pago, misma membresía, mismo estado, mismo precio, mismas horas gratis y mismo `primera_gratis`) con el nuevo `inicio`, `fin` y `fin_bloqueo` calculados con `rangoBloqueado`, probando primero el equipo actual y después los demás, cada intento en un `SAVEPOINT` (error `23P01` pasa al siguiente equipo). Si ningún equipo está libre MUST responder `409` con "Esa hora ya no está disponible. Elige otra hora." y MUST dejar la reserva en su horario anterior. El `UPDATE` MUST NOT permitir que la reserva se solape consigo misma como causa de rechazo.

#### Scenario: Mismo equipo libre

- **WHEN** el equipo actual está libre en el nuevo horario
- **THEN** la reserva se queda en ese equipo

#### Scenario: Otro equipo libre

- **WHEN** el equipo actual está ocupado en el nuevo horario y el otro está libre
- **THEN** la reserva pasa al otro equipo

#### Scenario: Sin cupo

- **WHEN** los dos equipos están ocupados en el nuevo horario
- **THEN** responde `409` y la reserva conserva su horario anterior

#### Scenario: Traslape con la propia reserva

- **WHEN** el cliente mueve 1 hora la reserva y el nuevo rango se solapa con el viejo
- **THEN** la base no lo rechaza por chocar consigo misma

#### Scenario: Dos peticiones por el último cupo

- **WHEN** dos clientes reprograman a la vez al último cupo del mismo horario
- **THEN** solo uno lo obtiene y el otro recibe `409`

#### Scenario: Una pendiente vencida no estorba

- **WHEN** otra reserva `pendiente` venció y bloqueaba el horario nuevo
- **THEN** la escritura la marca `expirada` al empezar y la reprogramación se acepta

#### Scenario: Precio y pago no cambian

- **WHEN** la reserva se reprograma
- **THEN** `monto`, `precio_lista`, `horas_gratis_aplicadas`, `pago_id` y `primera_gratis` quedan iguales

### Requirement: El apoyo coordinado se reabre al cambiar la fecha

Si la reserva `requiere_apoyo` y su `apoyo_estado` es `coordinado`, al reprogramarla MUST volver a `por_coordinar`, porque el administrador coordinó a la persona de apoyo para otra fecha. La nota del administrador MUST conservarse.

#### Scenario: Apoyo coordinado

- **WHEN** se reprograma una reserva con `apoyo_estado = 'coordinado'`
- **THEN** pasa a `por_coordinar` y `apoyo_nota` no cambia

#### Scenario: Sin apoyo

- **WHEN** la reserva no requiere apoyo
- **THEN** `apoyo_estado` sigue vacío

### Requirement: Disponibilidad para reprogramar

`GET /api/reservas/:id/disponibilidad?fecha=AAAA-MM-DD` MUST exigir sesión, MUST responder `404` si la reserva no es del cliente, y MUST devolver los horarios del día como `GET /api/disponibilidad` pero calculados con las `horas_agenda` guardadas en la reserva y con `excluirReservaId` de `leerOcupacion`, de modo que el hueco de la propia reserva figure libre. La respuesta MUST NOT incluir datos de otros clientes ni de equipos. Solo la ruta del dueño MUST poder excluir una reserva; no existe un parámetro público para excluir una reserva cualquiera.

#### Scenario: Mover una hora

- **WHEN** la reserva ocupa de 10:00 a 13:00 con el traslado y el cliente consulta ese mismo día
- **THEN** los inicios 10:30 y 11:00 aparecen disponibles aunque se solapen con su propio rango

#### Scenario: Reserva de otro cliente

- **WHEN** el cliente A consulta la disponibilidad de la reserva de B
- **THEN** responde `404`

#### Scenario: Fecha mal escrita

- **WHEN** `fecha` es `2026-02-30`
- **THEN** responde `422`

#### Scenario: Horarios sin cupo en gris

- **WHEN** la interfaz muestra los horarios para reprogramar
- **THEN** los que no tienen cupo, o están a menos de 48 horas, salen en gris y deshabilitados

### Requirement: Pantalla de reprogramar

`/cuenta/reservas/[id]` MUST mostrar "Cambiar día y hora" cuando `puede_reprogramar` es verdadero, con selector de fecha, lista de horarios y confirmación, y MUST mostrar el mensaje de WhatsApp cuando faltan menos de 24 horas. Tras reprogramar MUST mostrar el nuevo horario y, si la reserva está `pendiente`, MUST recordar que sigue esperando la aprobación de su pago.

#### Scenario: Faltan menos de 24 horas

- **WHEN** el cliente abre el detalle de una reserva que empieza mañana temprano
- **THEN** no ve los botones y sí el mensaje "Ya no puedes cambiarla desde aquí. Escríbenos por WhatsApp."

#### Scenario: Reprogramación exitosa

- **WHEN** el cliente confirma un nuevo horario
- **THEN** ve el nuevo día y hora y vuelve a la lista de próximas con la reserva actualizada
