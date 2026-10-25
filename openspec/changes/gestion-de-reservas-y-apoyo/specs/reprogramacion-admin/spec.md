## ADDED Requirements

### Requirement: El administrador reprograma una reserva a nombre del cliente
`POST /api/admin/reservas/:id/reprogramar` con `{ "inicio": "<instante ISO>" }` MUST exigir rol `admin` y `application/json`, y MUST mover una reserva viva (`confirmada` o `pendiente` vigente) cuyo servicio **todavía no empieza** a un nuevo horario. Es la salida acordada cuando el administrador no consigue a la persona de apoyo: se reprograma con el cliente por WhatsApp (fuera del sistema) y el pago se conserva. MUST ejecutarse en `transaccionDeEscritura` con la fila bloqueada (`FOR UPDATE`) y actualizar la misma fila (mismo `id`) sin pedir otro pago. El sistema MUST NOT cancelar la reserva ni generar crédito en horas, MUST NOT cambiar el precio y MUST NOT avisar al cliente. A diferencia del cliente, el administrador MUST poder mover una reserva aunque falten menos de 24 horas para su servicio actual (supuesto: la regla de 24 horas protege la operación del negocio frente al cliente, y el administrador es quien coordina); el servicio que ya empezó MUST rechazarse.

#### Scenario: Reprogramar una confirmada
- **WHEN** el administrador mueve una reserva `confirmada` con apoyo a otro horario libre, válido y dentro de la membresía
- **THEN** la respuesta es `200` con el `inicio` y `fin` nuevos y la reserva sigue `confirmada`, con el mismo `pago_id`

#### Scenario: Reserva pendiente vigente
- **WHEN** el administrador reprograma una reserva `pendiente` cuya espera sigue vigente
- **THEN** conserva el estado `pendiente` y su `expira_en` original

#### Scenario: Menos de 24 horas
- **WHEN** faltan 20 horas para el servicio actual y el nuevo horario es válido
- **THEN** el administrador puede reprogramarla y la respuesta es `200`

#### Scenario: El servicio ya empezó
- **WHEN** el `inicio` actual de la reserva ya pasó
- **THEN** la respuesta es `409` con el mensaje "El servicio ya empezó; no se puede reprogramar." y nada cambia

#### Scenario: Estados que no se pueden reprogramar
- **WHEN** la reserva está `completada`, `cancelada` o `expirada` (incluida una `pendiente` vencida)
- **THEN** la respuesta es `409` con un mensaje que nombra su estado

#### Scenario: Reserva inexistente
- **WHEN** el id no existe o no tiene formato de uuid
- **THEN** la respuesta es `404`

#### Scenario: Permisos y formato
- **WHEN** un visitante, un cliente o una petición sin JSON llama a la ruta
- **THEN** la respuesta es `401`, `403` (sin leer ni escribir) o `415` respectivamente

### Requirement: El nuevo horario cumple las reglas de una reserva nueva
El servidor MUST validar el nuevo `inicio` con `validarInicioServicio` usando las `horas_agenda` guardadas en la reserva (lunes a sábado, de 8 am a 6 pm, a intervalos de 30 minutos, terminando antes del cierre y con al menos 48 horas de anticipación), cada incumplimiento con `422` y su propio mensaje. MUST validar la vigencia de la membresía de **la reserva** igual que la reprogramación del cliente (ítem #12): con la membresía `activa`, el `inicio` nuevo MUST ser anterior a su `fin`; con la primera membresía `pendiente`, MUST caer dentro de los `membresia_meses` siguientes a hoy. Un horario igual al actual MUST responder `422` con "Elige un horario distinto al que ya tienes."

#### Scenario: Menos de 48 horas
- **WHEN** el nuevo `inicio` es dentro de 30 horas
- **THEN** la respuesta es `422` con "Reserva con al menos 48 horas de anticipación."

#### Scenario: Domingo o fuera de horario
- **WHEN** el nuevo `inicio` cae en domingo, o el servicio terminaría después de las 6 pm
- **THEN** la respuesta es `422` y la reserva no cambia

#### Scenario: Posterior al fin de la membresía
- **WHEN** el nuevo `inicio` es posterior al `fin` de la membresía activa del cliente
- **THEN** la respuesta es `422` con un mensaje que dice hasta qué fecha se puede reservar

#### Scenario: Mismo horario
- **WHEN** el nuevo `inicio` es igual al actual
- **THEN** la respuesta es `422` con "Elige un horario distinto al que ya tienes."

#### Scenario: Cuerpo mal formado
- **WHEN** `inicio` falta o no es un instante ISO válido
- **THEN** la respuesta es `422` y nada cambia

### Requirement: Mover al primer equipo libre y conservar pago y precio
La reprogramación MUST usar `moverAlPrimerEquipoLibre` del ítem #12 (equipo actual primero, un `SAVEPOINT` por equipo, `23P01` pasa al siguiente) sin reimplementarlo. Si ningún equipo está libre MUST responder `409` con "Esa hora ya no está disponible. Elige otra hora." y dejar la reserva en su horario anterior. MUST NOT cambiar `estado`, `pago_id`, `monto`, `precio_lista`, `horas_gratis_aplicadas`, `primera_gratis`, `expira_en` ni las horas de trabajo y de agenda. Si la reserva `requiere_apoyo`, su `apoyo_estado` MUST volver a `por_coordinar` (si estaba `coordinado`) y `apoyo_nota` MUST conservarse.

#### Scenario: Otro equipo libre
- **WHEN** el equipo actual está ocupado en el nuevo horario y el otro está libre
- **THEN** la reserva pasa al otro equipo

#### Scenario: Sin cupo
- **WHEN** los dos equipos están ocupados en el nuevo horario
- **THEN** la respuesta es `409` y la reserva conserva su horario anterior

#### Scenario: Pago y precio intactos
- **WHEN** se reprograma una reserva pagada
- **THEN** `pago_id`, `monto`, `precio_lista`, `horas_gratis_aplicadas` y `primera_gratis` quedan iguales y no se crea crédito ni se cancela nada

#### Scenario: El apoyo se reabre
- **WHEN** se reprograma una reserva con `apoyo_estado = 'coordinado'`
- **THEN** pasa a `por_coordinar`, `apoyo_nota` no cambia y la reserva vuelve a la lista de apoyo por coordinar

#### Scenario: Reserva sin apoyo
- **WHEN** la reserva no requiere apoyo
- **THEN** `apoyo_estado` sigue vacío

#### Scenario: Dos reprogramaciones por el último cupo
- **WHEN** el administrador y un cliente (o dos administradores) mueven reservas distintas al último cupo del mismo horario a la vez
- **THEN** solo una lo obtiene y la otra recibe `409`

### Requirement: Registro de quién reprogramó
Al reprogramar, el sistema MUST guardar en `reservas.reprogramada_por` el id del administrador y en `reprogramada_en` el instante (reloj de la base). Ambas columnas MUST ser opcionales y estar vacías en las reservas nunca reprogramadas por un administrador; la reprogramación del cliente (ítem #12) MUST NOT escribirlas. El listado de reservas MUST exponer `reprogramada_en` y el nombre de quien reprogramó solo al administrador; el perfil del cliente MUST NOT recibirlas.

#### Scenario: Queda registrado
- **WHEN** el administrador A reprograma una reserva
- **THEN** `reprogramada_por` es el id de A y `reprogramada_en` es el instante de la acción

#### Scenario: Reprogramación del cliente
- **WHEN** el cliente reprograma su propia reserva
- **THEN** `reprogramada_por` y `reprogramada_en` no cambian

#### Scenario: Esquema aditivo
- **WHEN** se aplica la migración
- **THEN** las filas existentes quedan con ambas columnas vacías y ninguna restricción existente cambia

### Requirement: Disponibilidad para el administrador
`GET /api/admin/reservas/:id/disponibilidad?fecha=AAAA-MM-DD` MUST exigir rol `admin`, responder `404` si la reserva no existe, y devolver los horarios del día calculados con las `horas_agenda` guardadas en la reserva y con `excluirReservaId` igual a su id, reutilizando el cálculo de disponibilidad del ítem #12 (los horarios sin cupo o a menos de 48 horas salen deshabilitados). MUST NOT agregar ningún parámetro `excluir` a `GET /api/disponibilidad`.

#### Scenario: Horarios del día
- **WHEN** el administrador consulta la disponibilidad de una reserva para una fecha válida
- **THEN** recibe los horarios con cupo, contando como libre el hueco de la propia reserva

#### Scenario: Fecha mal escrita
- **WHEN** `fecha` es `2026-02-30`
- **THEN** la respuesta es `422`

#### Scenario: Cliente o visitante
- **WHEN** un cliente o un visitante llama a la ruta
- **THEN** la respuesta es `403` o `401` y no se lee ninguna reserva

### Requirement: Pantalla de reprogramación y coordinación fuera del sistema
En `/admin/apoyo` y en `/admin/reservas`, cada reserva con `puede_reprogramar` MUST mostrar la acción "Reprogramar", con selector de fecha, lista de horarios (los sin cupo en gris y deshabilitados), confirmación y el celular del cliente para coordinar. La pantalla MUST decir que el sistema no avisa al cliente y que el nuevo horario debe haberse acordado antes por WhatsApp. Tras reprogramar MUST mostrar el nuevo horario y, si la reserva requiere apoyo, que volvió a la lista por coordinar.

#### Scenario: Acceso desde la lista de apoyo
- **WHEN** el administrador ve una reserva por coordinar en `/admin/apoyo`
- **THEN** ve el botón "Reprogramar" junto a "Marcar coordinado"

#### Scenario: Aviso de coordinación
- **WHEN** abre el formulario de reprogramación
- **THEN** ve el texto que indica que el sistema no avisa al cliente y que debe acordar el nuevo horario por WhatsApp

#### Scenario: Reserva que no se puede reprogramar
- **WHEN** la reserva ya empezó o no está viva
- **THEN** no se muestra el botón
