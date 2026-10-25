## Context

Ver `proposal.md` para el motivo. Estado verificado en el código antes de diseñar:

- **Decisión del usuario (2026-10-21), pendiente de confirmar por el negocio (PRD, `<!-- REVISAR -->` del alcance 4):** si no se consigue a la persona de apoyo, se reprograma con el cliente por WhatsApp y el pago se conserva. Se plasma en la decisión 7 y en el grupo 10.
- **Esquema (`src/db/esquema.ts`):** `reservas` ya tiene `equipo_id`, `estado` (`pendiente`, `confirmada`, `completada`, `cancelada`, `expirada`), `requiere_apoyo`, `apoyo_estado` (`por_coordinar`, `coordinado`), `apoyo_nota`, `inicio`, `fin` y `fin_bloqueo`, con el `CHECK reservas_apoyo_coherente` (requiere apoyo si y solo si hay `apoyo_estado`). La restricción de exclusión `reservas_sin_solape_por_equipo` vive solo en el SQL de la migración y cubre `pendiente` y `confirmada`. **Las acciones de completar, reasignar y apoyo no necesitan migración; la reprogramación agrega dos columnas opcionales (decisión 7).**
- **Agenda (#6):** `transaccionDeEscritura` marca las vencidas y ejecuta `fn` en la misma transacción; `reservaActiva` (`src/db/reservas-activas.ts`) es `confirmada`, o `pendiente` con `expira_en > now()`; `esConflictoDeExclusion` y `errorOriginal` (`src/lib/agenda/errores-bd.ts`) reconocen `23P01` también dentro de `cause`; `insertarEnPrimerEquipoLibre` ya usa un `SAVEPOINT` por equipo con `tx.transaction(...)`.
- **Administración (#2):** `requerirAdmin` responde `401` y `403`; `app/admin/layout.tsx` redirige. `app/admin/page.tsx` es una portada vacía que #11 convierte en enlaces.
- **#11 (`revision-de-pagos-admin`, solo propose, no aplicado):** planifica `ejecutarPasadaDeExpiracion` (`src/lib/agenda/pasada.ts`), `reservas.cancelada_por`, la ruta `POST /api/admin/reservas/:id/cancelar` y el patrón de rutas de administración (`415` si no es JSON, id con formato uuid o `404`, `conReintento` con `errorOriginal`). Este change reutiliza ese patrón y esa pasada; **no toca sus archivos.**
- **#12 (`perfil-reservas-y-membresia`, solo propose, no aplicado):** planifica `moverAlPrimerEquipoLibre(tx, reservaId, equipoIds, cambios)` en `src/lib/agenda/asignar.ts`, `reprogramarReserva` en `src/lib/reservas/reprogramar.ts` (dueño, plazo de 24 h, `validarInicioServicio` con las `horas_agenda` guardadas, vigencia de membresía, `apoyo_estado` a `por_coordinar`) y `GET /api/reservas/:id/disponibilidad` con `excluirReservaId` de `leerOcupacion`. La reasignación de equipo no los necesita, pero la reprogramación del administrador (decisión 7) **sí los reutiliza**; este change no los copia. Ninguna de esas funciones existe aún en `src/`.
- **`openspec/specs/` está vacío**: no hay requisitos base que modificar.
- **Verificado en el código de las bibliotecas:** Drizzle 0.45 ofrece `select(...).for("update")` (lo usa el diseño de #11) y `sql` para `now()`. Una restricción de exclusión de Postgres se evalúa también en un `UPDATE` de `equipo_id` y falla con `23P01`; `insertarEnPrimerEquipoLibre` ya depende de ese mismo comportamiento para el `INSERT`.

## Goals / Non-Goals

**Goals:**

- Que el administrador vea cada reserva con su estado real y su equipo, la marque `completada` a mano, la mueva de equipo cuando haga falta y lleve el control del apoyo por coordinar (PRD, alcance 9; `TECH-DESIGN.md`, "Portal de administrador").
- Todas las escrituras en `transaccionDeEscritura`, con la fila bloqueada, para no pisar a otro administrador ni a un cliente (ADR 0009).
- Dejar el estado `completada` listo para #17 y #18.
- Dar al administrador la salida cuando no consigue a la persona de apoyo: reprogramar a nombre del cliente conservando el pago (decisión 7).

**Non-Goals:**

- **Avisar al cliente, fijar un plazo máximo para conseguir al apoyo o cambiar el precio** cuando se reprograma: el PRD no tiene notificaciones salientes y el precio no depende de quién vaya (alcance 4).
- Crédito en horas del cliente (#14) y su saldo en el admin; fotos (#17); reseñas (#18); revisar pagos y cancelar reservas fraudulentas (#11); reprogramar o cancelar del cliente (#12).
- Reprogramar a nombre del cliente **reservas que ya empezaron** o no están vivas, o cambiar el servicio, el precio o el pago al reprogramar.
- Cancelar una reserva `confirmada` desde el portal con crédito (descartado por la decisión 7; la cancelación por fraude es de #11).
- Asignar personas concretas al servicio o gestionar a la persona de apoyo en el sistema: el PRD ("No alcance") la deja fuera; el sistema solo guarda el estado y una nota libre.
- Volver una reserva `completada` a `confirmada`, o un apoyo `coordinado` a `por_coordinar`. Si el administrador se equivoca al completar, hoy se corrige a mano en la base; si se vuelve frecuente, se abre un ítem aparte.
- Notificar al cliente por correo, SMS o WhatsApp (PRD, "No alcance").
- Paginación y filtros por cliente o fecha: 100 filas ordenadas por `inicio` bastan para el volumen esperado.
- Modificar `PRD.md`, `TECH-DESIGN.md`, los ADR o `BACKLOG.md`: lo que haga falta cambiar ahí se propone en el reporte.

## Decisions

### 1. Rutas bajo `/api/admin` con el patrón de #11

`GET /api/admin/reservas`, `GET /api/admin/apoyo`, `POST /api/admin/reservas/:id/completar`, `POST /api/admin/reservas/:id/reasignar` y `POST /api/admin/reservas/:id/apoyo`, cada una con `requerirAdmin` primero (ADR 0003 y 0005). Las acciones exigen `application/json` cuando llevan cuerpo (`415`), validan el `id` con formato de uuid (si no, `404`, no un `22P02`) y usan `conReintento` con `errorOriginal` y `manejar`, igual que `crearRutaReservas`. La fábrica inyecta `sesion`, `base`, `ahora` y las funciones de dominio, para probarlas con dobles. `completar` no lleva cuerpo: no exige `Content-Type`, pero sí es `POST` y por tanto no se dispara desde un `<img>` ni un enlace; la cookie es `SameSite=Lax`, que no la envía en un `POST` entre sitios.

- **Reintento:** si el primer intento se confirmó y la conexión se cortó en el `COMMIT`, el reintento ve el estado ya cambiado y responde `409`, que es verdad y no duplica nada (mismo razonamiento que #9a y #11). En `apoyo`, repetir es válido (solo reescribe la nota), así que el reintento responde `200`.
- **Descartada:** Server Actions de Next. El ADR 0003 prefiere un contrato HTTP que se prueba con `curl` y Vitest, y no se usa Playwright.
- **Descartada:** una sola ruta `PATCH /api/admin/reservas/:id` con `{estado, equipo_id, apoyo...}`. Mezcla tres transiciones con reglas distintas; el mismo motivo por el que #11 descartó `PATCH` en pagos.

### 2. Estado efectivo en un solo lugar

`estadoEfectivoSql` (`src/lib/admin/reservas/estado.ts`) es un `CASE`: `pendiente` con `expira_en <= now()` es `expirada`; los demás estados se devuelven tal cual. El listado, el filtro `estado` y `puede_completar` lo usan; ninguna consulta repite la condición (ADR 0009: "debe centralizarse"). Para filtrar "vivas" se usa `reservaActiva` tal cual. La pasada de #11 persiste las marcas; el estado mostrado no depende de ella.

- **Por qué la pasada y también el estado efectivo:** la pasada deja la base coherente (útil para #14), el `CASE` garantiza que el administrador nunca ve una espera vencida aunque la pasada falle. Cada acción de escritura además ya marca las vencidas en `transaccionDeEscritura`.
- **Descartada:** crear una vista SQL. Agrega una migración que este change no necesita.

### 3. Listado, filtros y "por completar"

`listarReservas(base, { estado })` hace una sola consulta con `JOIN` a `usuarios` y `equipos`, `ORDER BY inicio ASC`, `LIMIT 100`. Sin filtro: `reservaActiva AND inicio >= now()`. Con `estado=pendiente`: `reservaActiva AND estado = 'pendiente'`. Con `por_completar`: `estado = 'confirmada' AND inicio <= now()`, el trabajo atrasado del administrador. Con `completada`, `cancelada` o `expirada`: por estado efectivo, en orden descendente por `inicio` (lo más reciente primero). `puede_completar` es `confirmada AND inicio <= now()`; `puede_reasignar` es "viva y con un equipo activo más". Todo con el reloj de la base, no el del servidor.

La respuesta incluye los equipos activos (`id`, `nombre`) para el selector de la pantalla. No devuelve datos de otros módulos (comprobantes, montos del pago): el detalle del pago vive en `/admin/pagos/[id]` de #11, y la fila lleva `pago_id` para enlazar.

- **Descartada:** paginación y filtros por cliente o rango de fechas (Non-Goals).
- **Descartada:** mostrar las reservas pasadas por defecto. El administrador ve primero lo que viene; lo atrasado se pide con `por_completar`.

### 4. Completar a mano

Dentro de `transaccionDeEscritura`: `SELECT id, estado, expira_en, inicio, (inicio <= now()) AS ya_empezo ... FOR UPDATE` → `404` si no existe → decide con la función pura `evaluarCompletar({ estadoEfectivo, yaEmpezo })`, que devuelve `ok` o el mensaje del `409` (uno por caso: pendiente, cancelada, expirada, completada, futura) → `UPDATE reservas SET estado = 'completada', actualizada_en = now()`. La marca de vencidas ya corrió al inicio de la transacción, así que una `pendiente` vencida llega como `expirada`.

- **Por qué `FOR UPDATE`:** serializa a dos administradores y a un cliente que cancele a la vez (#12); el segundo ve el estado nuevo y recibe `409`.
- **Completar libera el cupo** (la restricción de exclusión solo cubre `pendiente` y `confirmada`). Es seguro: solo se completa un servicio que ya empezó y toda reserva nueva exige 48 horas de anticipación, así que no puede quedar una reserva futura que choque con un rango en curso.
- **No cambia pago ni membresía.** Completar no activa nada ni genera crédito; #14 ya trata `completada` como "limpieza realizada" (ADR 0008).
- **Descartada:** completar automáticamente al pasar la hora de fin. El PRD dice "(a mano)" y una limpieza que no se hizo no debe contar para la primera gratis ni para la lealtad.
- **Descartada:** permitir completar antes de que el servicio empiece. `TECH-DESIGN.md` lo prohíbe y abriría la puerta a fotos y reseñas de servicios que no ocurrieron.

### 5. Reasignar: la base decide si el equipo está libre

Dentro de `transaccionDeEscritura`: validar el cuerpo con zod (`equipo_id` entero positivo, `422`) → `SELECT ... FOR UPDATE` de la reserva (`404`; `409` si su estado efectivo no es `confirmada` ni `pendiente`) → leer el equipo destino (`422` "Elige un equipo activo." si no existe o `activo = false`; `422` "La reserva ya está en ese equipo." si es el mismo) → `tx.transaction(sp => sp.update(reservas).set({ equipoId }).where(id))` en un **savepoint** → si falla con `esConflictoDeExclusion`, `409` con código `equipo_ocupado` y el mensaje "Ese equipo no está libre en ese horario." Cualquier otro error se propaga.

- **Por qué la base y no una consulta previa:** una consulta de "¿está libre?" tiene una carrera con un cliente que reserva ese mismo hueco; la restricción de exclusión (ADR 0002 y 0007) es la única garantía real y ya probada. La consulta previa solo daría un mensaje más temprano, a costa de lógica duplicada. El savepoint evita que el `23P01` aborte la transacción antes de devolver el `409` limpio, como en `insertarEnPrimerEquipoLibre`.
- **El rango no cambia:** la reasignación no recalcula `inicio`, `fin` ni `fin_bloqueo`; con la misma duración el único choque posible es con las reservas del equipo destino.
- **`pendiente` vigente también se puede reasignar.** El ADR 0007 dice "una reserva" y la restricción cubre ambos estados. Una `pendiente` vencida llega como `expirada` y se rechaza.
- **Por qué `exigirActivo` es una dependencia:** las pruebas contra Neon usan equipos inactivos para no tocar la agenda real; la función acepta `exigirActivo = true` por defecto y las pruebas de la rama lo desactivan. La regla de "equipo activo" se prueba por separado con dobles.
- **Alternativa descartada:** intercambiar dos reservas entre equipos en una sola acción. Es útil para destrabar un hueco, pero no está en el PRD ni en `TECH-DESIGN.md`; el administrador puede hacerlo con dos reasignaciones en el orden correcto cuando exista un hueco intermedio. No siempre existe (dos reservas que solo caben cruzadas); queda anotado como riesgo.
- **Descartada:** mover el equipo de reservas `completada` o ya terminadas: no hay restricción que proteger y ensucia el historial.

### 6. Apoyo por coordinar

`listarApoyoPorCoordinar(base)` consulta `requiere_apoyo AND apoyo_estado = 'por_coordinar' AND reservaActiva` ordenada por `inicio` ascendente, con los días que faltan calculados en SQL (`(inicio AT TIME ZONE zona)::date - (now() AT TIME ZONE zona)::date`, con la zona de `configuracion.horario_atencion.zona`). Incluye las `pendiente` vigentes (con su estado a la vista) para que el administrador empiece a buscar a la persona sin esperar; si el pago no se aprueba y la reserva expira, sale de la lista sola.

`marcarApoyoCoordinado({ reservaId, nota })`, en `transaccionDeEscritura` con la fila bloqueada: `404` si no existe; `409` si `requiere_apoyo` es falso ("Esta reserva no requiere apoyo.") o si el estado efectivo no es `confirmada`/`pendiente`; `UPDATE ... SET apoyo_estado = 'coordinado', apoyo_nota = nota`. La nota es opcional, se recorta con `trim()`, máximo 500 caracteres con zod (sin `CHECK` en la base para no abrir una migración; el límite de la aplicación basta para un campo que solo escribe el administrador). Repetirla sobre una reserva `coordinado` reescribe la nota (corregir un número de teléfono mal escrito) en vez de dar `409`.

- **Por qué la nota va solo al marcar:** el PRD pide "marcar el apoyo como coordinado"; `TECH-DESIGN.md` lo pide "con una nota". Una nota mientras sigue `por_coordinar` (por ejemplo "esperando respuesta de María") sería otro estado de trabajo que nadie pidió. Pregunta abierta menor 2.
- **El apoyo no ocupa cupo:** no toca `equipo_id` ni la restricción de exclusión (ADR 0008).
- **Descartada:** guardar el nombre y el teléfono de la persona en columnas propias. El PRD dice que se coordina fuera del sistema; una nota libre basta y no abre un registro de personal.
- **Descartada:** `CHECK` de longitud de nota en la base (costaría una migración por un campo de uso interno).

### 7. Persona de apoyo no conseguida: reprogramar a nombre del cliente y conservar el pago (opción A)

**Decisión del usuario (2026-10-21), pendiente de confirmar por el negocio** (PRD, alcance 4): si el administrador no consigue a la persona de apoyo, se reprograma con el cliente por WhatsApp (fuera del sistema) y el pago se conserva; no se cancela ni se convierte en crédito. El administrador cambia el horario desde el portal. El sistema no avisa solo al cliente, no impone plazo máximo y no cambia el precio. Se implementa en el grupo 10.

**Cómo (reutiliza #12, no duplica).** `reprogramarReservaPorAdmin({ reservaId, cuerpo, adminId, ahora }, dependencias)` en `src/lib/admin/reservas/reprogramar.ts`, dentro de `transaccionDeEscritura`:

1. `FOR UPDATE` de la reserva **sin filtrar por dueño** → `404`; `409` si el estado efectivo no es `confirmada` ni `pendiente` vigente; `409` "El servicio ya empezó; no se puede reprogramar." si `inicio <= now()` (reloj de la base).
2. `validarInicioServicio(config, ahora, nuevoInicio, horas_agenda guardadas)`, vigencia de **la membresía de esa reserva** (activa: `nuevoInicio < fin`; pendiente: `validarVigenciaPrimeraMembresia`) y "horario distinto" — los mismos pasos que `reprogramarReserva` de #12.
3. `rangoBloqueado` y `moverAlPrimerEquipoLibre` de #12 (equipo actual primero, savepoint por equipo, `409` "Esa hora ya no está disponible. Elige otra hora."). `apoyo_estado` vuelve a `por_coordinar` si `requiere_apoyo`; la nota se conserva.
4. Un segundo `UPDATE` en la misma transacción escribe `reprogramada_por` (id del administrador) y `reprogramada_en = now()`. Va aparte para no depender de la forma del parámetro `cambios` de `moverAlPrimerEquipoLibre`; no tiene restricción de exclusión que lo afecte.

`GET /api/admin/reservas/:id/disponibilidad?fecha=` carga la reserva (sin dueño), toma sus `horas_agenda` y llama a `calcularDisponibilidad` con `leerOcupacion(..., { excluirReservaId: id })`, igual que la ruta del dueño de #12. Solo se expone bajo `requerirAdmin`; no se agrega `excluir` a la ruta pública.

**Supuesto, excepción a las 24 horas:** el administrador puede reprogramar a menos de 24 h del servicio actual. La regla de 24 h limita al cliente (ADR 0009); aquí el administrador ya acordó el cambio por WhatsApp y la causa es una falta de apoyo que suele descubrirse cerca de la fecha. Se mantiene la anticipación de 48 h para el **horario nuevo** y se rechaza una reserva que ya empezó. Si el negocio prefiere aplicar también las 24 h, es quitar la excepción.

**Núcleo compartido con #12.** Si `reprogramarReserva` de #12 ya separa los pasos 2 y 3 en una función que no filtra por dueño ni exige el plazo, se llama tal cual. Si los mezcla, se extrae un núcleo (`reprogramarEnTransaccion`, con `exigirPlazo` y filtro de dueño como parámetros) en `src/lib/reservas/reprogramar.ts` sin cambiar el comportamiento de #12 (sus pruebas deben seguir pasando). Es la única edición permitida a archivos de #12; si #12 no está aplicado al empezar el grupo 10, se pausa.

**Registro de quién reprogramó.** Dos columnas **aditivas y opcionales** en `reservas`: `reprogramada_por text` (id del administrador, sin clave foránea para no atar el historial a la cuenta) y `reprogramada_en timestamptz`. Migración con `npm run db:generate`; no cambian datos ni restricciones existentes.

- **Alternativa descartada:** guardar quién reprogramó dentro de `apoyo_nota`. Mezcla datos libres con un campo de la persona de apoyo, que solo existe en reservas con apoyo, y se pierde al corregir la nota.
- **Alternativa descartada:** una tabla de auditoría. Es más de lo que el PRD pide para un solo evento; las dos columnas bastan y se revisan en el listado. Si se necesita historial de varios cambios, se abre un ítem.
- **Alternativa descartada:** pasar `reprogramada_por` dentro de `cambios` de `moverAlPrimerEquipoLibre`. Acopla este change a un detalle de #12 aún no aplicado.

**Alternativas descartadas (no se implementan):**

| Opción | Por qué se descartó |
|---|---|
| **B. Cancelar con crédito completo** | El usuario eligió conservar el pago. Habría exigido cancelar una `confirmada` desde el portal, extender #14 para generar crédito cuando cancela el administrador (ADR 0012 lo limita al cliente) y decidir el vencimiento y las 3 horas gratis |
| **C. Mantener y avisar al cliente** | El servicio no cabe en el tiempo bloqueado con 1 persona y obligaría a un tercer estado de apoyo y a un aviso que el PRD no contempla |
| **D. Combinación con plazo** | Añade un plazo y dos caminos que el negocio no pidió |

Ninguna de las decisiones 1 a 6 depende de esta. El ADR 0008 y el ADR 0012 no cambian; se propone al usuario actualizar `TECH-DESIGN.md` si describe esta política como abierta.

### 8. Pantallas del portal

`app/admin/reservas/page.tsx` y `app/admin/apoyo/page.tsx` son componentes de servidor que ejecutan la pasada y llaman a las funciones de `src/lib/admin/reservas/` (no a su propia API por HTTP). Los botones viven en componentes de cliente (`AccionesReserva`: Completar y Reasignar con un selector de equipos; `AccionApoyo`: campo de nota y Marcar coordinado; `ReprogramarReserva`: fecha, horarios con los sin cupo en gris, el celular del cliente, el aviso de que el sistema no avisa al cliente y confirmación; se usa en `/admin/apoyo` y en `/admin/reservas`) que llaman a las rutas, muestran el mensaje de error y hacen `router.refresh()`. Fechas y horas en hora de Lima con `isoConZona`/`horaLocal`/`fechaLocal` (`src/lib/agenda/horario.ts`); montos y horas con `formatearHoras` (`src/lib/soles.ts`). La fila de reserva enlaza a `/admin/pagos/<pago_id>` (existe cuando #11 se aplique; es un enlace, no una dependencia de código). Estilos con módulos CSS propios (`reservas.module.css`).

- Las pantallas se prueban con `renderToStaticMarkup` y las rutas con `curl` contra la rama, sin Playwright.
- `app/admin/page.tsx` agrega los enlaces a `/admin/reservas` y `/admin/apoyo` **conservando** los que agregue #11; si el archivo ya cambió, se edita sobre su contenido actual.
- **Descartada:** tabla con edición en línea. Los botones por fila son más simples de probar y de usar con una persona sola.

## Cobertura de los criterios de `TECH-DESIGN.md`

| Criterio (Portal de administrador) | Escenario en | Tarea |
|---|---|---|
| Sin rol `admin`, `/admin` y las rutas de administración dan `403` o redirigen | `listado-de-reservas-admin` (solo el administrador) | 6.5, 7.3, 9.2 |
| El administrador ve las reservas con su estado y su equipo | `listado-de-reservas-admin` (listado) | 2.2, 2.3, 7.1, 8.1 |
| Marca a mano `completada` una `confirmada` cuyo servicio ya empezó; no pendiente, cancelada, expirada ni futura | `completar-reserva` | 3.1, 3.2, 8.2 |
| El administrador nunca ve como pendiente una reserva cuya espera ya venció | `listado-de-reservas-admin` (espera vencida), `apoyo-por-coordinar` | 2.1, 2.3, 8.1 |
| Ve las reservas que requieren apoyo y no tienen coordinado, ordenadas por fecha, y las marca coordinadas con una nota | `apoyo-por-coordinar` | 5.1 a 5.4, 8.4 |
| Reasigna a otro equipo solo si está libre en su rango; si no, falla con un mensaje | `reasignacion-de-equipo` | 4.1 a 4.3, 8.3 |
| Si no se consigue al apoyo, se reprograma con el cliente y el pago se conserva (PRD, alcance 4; decisión del 2026-10-21) | `reprogramacion-admin` (todos los requisitos), `apoyo-por-coordinar` (acceso a reprogramar) | 10.1 a 10.8 |
| El saldo de crédito en horas de cada cliente | **Ítem #14** | no se cubre aquí |
| Subir fotos / aprobar reseñas | **Ítems #17 y #18** | no se cubre aquí |
| Revisar pagos, cancelar reserva fraudulenta | **Ítem #11** | no se cubre aquí |

## Risks / Trade-offs

- **[Completar por error]** → no hay marcha atrás desde el portal (Non-Goals) y #17/#18 dejarían subir fotos y reseña. Mitigación: la pantalla pide confirmación antes de completar y la ruta solo acepta servicios que ya empezaron.
- **[Reparto inicial de equipos]** → la reasignación mueve una reserva a la vez; si dos reservas solo caben cruzadas, el administrador no puede destrabarlas sin un hueco intermedio (ADR 0007, "puede rechazar una reserva que sí cabría con otro reparto"). Mitigación: queda como riesgo conocido; un intercambio atómico sería un ítem aparte.
- **[Persona de apoyo no disponible]** → la política es reprogramar con el cliente y conservar el pago (decisión 7), pendiente de confirmar por el negocio. Sin plazo máximo ni aviso automático, nada impide que llegue el día sin apoyo; la lista muestra los días que faltan para empujar al administrador. **Si el administrador decide atender igualmente fuera del sistema con 1 persona, el servicio dura el doble de lo bloqueado en la agenda y puede chocar con la siguiente reserva del equipo**; el sistema no lo impide ni lo registra. Si el hogar sigue necesitando apoyo tras reprogramar, el problema se repite. Riesgo del PRD ("Persona de apoyo no disponible").
- **[Reprogramar sin aviso al cliente]** → el sistema no notifica (PRD, "No alcance"); el administrador debe haber acordado el horario por WhatsApp antes de confirmar. Si lo mueve por error, el cliente no se entera hasta ver su perfil. Mitigación: aviso en la pantalla y confirmación previa.
- **[Excepción a las 24 horas]** → supuesto del administrador (decisión 7); un administrador podría mover una reserva de mañana. Se mantiene el registro `reprogramada_por`/`reprogramada_en`.
- **[Dependencia de #12]** → `moverAlPrimerEquipoLibre`, la disponibilidad con `excluirReservaId` y las reglas de reprogramar vienen de #12. Si #12 no está aplicado al empezar el grupo 10, se pausa (tarea 10.1).
- **[`reprogramada_por` es personal]** → solo la ven los administradores; #12 no debe devolverla al cliente.
- **[La pasada depende de que el administrador abra la pantalla]** → igual que en #11; las lecturas ya ignoran lo vencido y las escrituras lo marcan.
- **[Dos administradores a la vez]** → `FOR UPDATE` y `409`; la pantalla muestra el mensaje y refresca.
- **[Confirmar y completar a destiempo]** → el reloj de comparación es el de la base, no el del navegador ni el del servidor; el servicio "ya empezó" a la hora exacta de `inicio`.
- **[Nota con datos personales de la persona de apoyo]** → la nota es texto libre con un nombre y un teléfono; solo la ve el administrador (las rutas exigen rol) y no se devuelve a los clientes. El perfil (#12) no debe incluir `apoyo_nota` en lo que le devuelve al cliente: se anota para #12.
- **[`app/admin/page.tsx` lo editan #11 y este change]** → se edita sobre el contenido actual; si hay conflicto, parar y avisar.
- **[Dependencia de #11]** → la pasada y el patrón de rutas vienen de #11. El `BACKLOG.md` lista este ítem como dependiente de #9a; la dependencia de #11 es una conveniencia (reutilizar `pasada.ts`) y se avisa en el reporte. Si #11 no está aplicado al empezar, se pausa en la tarea 1.1.

## Migration Plan

1. **Una migración aditiva** (grupo 10): `reservas.reprogramada_por` y `reservas.reprogramada_en`, ambas opcionales. Se aplica a la rama `pruebas` con `DATABASE_URL` sobrescrita (ver punto 2) y a producción con `npm run db:migrate` **antes** de desplegar. Las acciones de los grupos 2 a 7 no dependen de ella. Las pruebas contra Neon corren en la rama `pruebas` (`DATABASE_URL_PRUEBAS`): `PRUEBAS_BD=1 npx vitest run --config vitest.bd.config.ts`.
2. **Servidor de desarrollo contra la rama:** `npm run dev` usa `DATABASE_URL` de `.env.local`, que es **producción**. Para las pruebas con `curl` se arranca con `node -e "require('dotenv').config({path:'.env.local',quiet:true});process.env.DATABASE_URL=process.env.DATABASE_URL_PRUEBAS;require('child_process').spawn('npx',['next','dev'],{stdio:'inherit',shell:true})"`. El administrador de prueba se promueve con ese mismo truco aplicado a `npm run admin:promover -- <correo>`; nunca sin sobrescribir `DATABASE_URL`.
3. **Producción (diferida):** el usuario decidió no migrar ni desplegar producción hasta terminar los 18 ítems. Quedan la migración (columnas opcionales), el despliegue con `npx vercel deploy --prod` y `GET /api/salud` (grupo 11, sin hacer).
4. **Marcha atrás:** redesplegar el commit anterior; las dos columnas opcionales quedan sin uso y no estorban al código anterior. Las reservas `completada`, las notas de apoyo y las reprogramadas siguen siendo válidas.

## Open Questions

1. **Decisión tomada, pendiente de confirmar por el negocio: apoyo no conseguido.** Se reprograma con el cliente y el pago se conserva (decisión 7; PRD, `<!-- REVISAR -->` del alcance 4). Sigue abierto para el negocio: confirmarla, y si quiere un plazo máximo, un aviso automático (hoy el PRD no tiene notificaciones salientes) o atender con 1 persona con otro precio. Hasta entonces se aplica tal cual. Se propone al usuario revisar `TECH-DESIGN.md` si presenta este riesgo como abierto.
2. **Nota de apoyo antes de marcar coordinado.** El change solo permite escribir la nota al marcar (y corregirla después). Si el administrador quiere anotar "esperando respuesta" antes, se agregaría un estado o un campo de nota independiente; no cambia las specs actuales.
3. **Excepción a las 24 horas para el administrador.** Supuesto tomado (decisión 7); confirmar con el negocio.
4. **Apoyo en reservas `pendiente`.** Se muestran en la lista por coordinar con su estado a la vista. Si el administrador prefiere ver solo las confirmadas, es un cambio de un filtro y de un escenario.
