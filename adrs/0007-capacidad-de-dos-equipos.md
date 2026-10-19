# ADR 0007: Capacidad de 2 limpiezas simultáneas con equipos y traslado de 1 hora

## Estado

Aceptado

## Contexto

El ADR 0002 usaba una restricción de exclusión para que ninguna reserva se solapara con otra, porque el PRD original decía que el personal hacía 1 limpieza a la vez. El personal creció: ahora se pueden realizar **2 limpiezas al mismo tiempo**, y entre una limpieza y la siguiente hace falta **1 hora de traslado**. La capacidad puede seguir creciendo, así que no debe quedar fija en el código.

La restricción de exclusión original, tal como estaba, bloquearía la segunda limpieza simultánea. Además, el PRD excluye la asignación automática de personal; esta decisión asigna cada reserva a un cupo interno, no a una persona concreta, y por eso el PRD se aclaró.

## Decisión

Se modela la capacidad con **equipos** (cupos de trabajo):

- Una tabla `equipos` con un registro por equipo. Hoy hay **2 equipos activos**. Aumentar la capacidad es agregar un equipo.
- Cada reserva guarda su `equipo_id` y dos rangos de tiempo: el del servicio (`inicio`–`fin`) y el **rango bloqueado** (`inicio` hasta `fin` + 1 hora de traslado).
- La restricción de exclusión de PostgreSQL se aplica **por equipo**: un mismo equipo no puede tener dos reservas activas con rangos bloqueados que se solapen. Solo cuentan las reservas en estado activo (`pendiente` o `confirmada`).
- Al confirmar una reserva, el servidor la **asigna automáticamente al primer equipo libre**. Si el primer equipo choca, intenta con el siguiente; si ninguno puede, responde `409` ("esa hora ya no está disponible").
- Un horario se muestra disponible si existe al menos un equipo libre durante toda la duración del servicio más el traslado. Si no hay ninguno, se muestra en gris y deshabilitado (ADR 0006).
- El administrador puede **reasignar una reserva a otro equipo** desde el portal, si el otro equipo está libre en ese rango.

## Alternativas consideradas

- **Conteo de capacidad en una transacción** — era viable, aceptaba cualquier combinación que respetara el máximo de 2 y la capacidad era solo un número. No se eligió porque la garantía dependería de que el código y el bloqueo de la transacción estén bien escritos, y la base de datos ya no impediría por sí sola un error. Se prefirió conservar la garantía en la base de datos que se eligió en el ADR 0002.
- **Mantener 1 limpieza a la vez** — dejó de ser viable porque el personal ya permite 2 simultáneas.

## Consecuencias

- La regla de capacidad sigue garantizada por la base de datos, aunque haya bugs en el código o peticiones simultáneas.
- Sumar capacidad es agregar un equipo, sin cambiar el esquema.
- Coincide con cómo trabaja el personal: un equipo atiende cada casa.
- La asignación al primer equipo libre puede rechazar una reserva que sí cabría con otro reparto de las ya existentes. Con 2 equipos y pocas reservas simultáneas es poco probable, y el administrador puede reasignar a mano para liberar un hueco.
- Si un equipo no puede ir un día, el administrador debe reasignar sus reservas manualmente.
- La disponibilidad se calcula consultando todos los equipos, lo que añade complejidad a la consulta de horarios.
- El rango bloqueado incluye el traslado de 1 hora; ese valor debe ser configurable o estar en un solo lugar del código.
