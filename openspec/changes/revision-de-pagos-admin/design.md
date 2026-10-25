## Context

Ver `proposal.md` para el motivo. Estado verificado en el código antes de diseñar:

- **#9a (`reservar-y-pagar-primera-membresia`, 43 de 51 tareas; faltan las de producción):** tablas `membresias` y `pagos` y las columnas `reservas.membresia_id` y `reservas.pago_id` (`src/db/esquema.ts`); `POST /api/reservas` crea membresía, pago y reserva `pendiente` con `expira_en = now() + espera_pago_horas`; `pagos.revisado_por` y `pagos.revisado_en` ya existen; el método `credito` existe como valor del enum; los índices únicos parciales `reservas_un_pago_por_reserva_viva`, `reservas_una_pendiente_por_cliente` y `membresias_una_pendiente_por_cliente`. `crearPrimeraReserva` responde `409 en_espera` (`MENSAJE_MEMBRESIA_EN_REVISION`) a quien tiene **cualquier** membresía (`existentes.length > 0` en `comprobarEstadoDelCliente`), sin mirar el estado de su pago. `estado_membresia` es hoy `('pendiente','activa')` y el `CHECK membresias_estado_y_fechas` solo conoce esos dos. `configuracion` tiene 16 claves (migración `0001`, con `ON CONFLICT ("clave") DO NOTHING`); `leerConfiguracion` falla si falta alguna.
- **#8:** `GET /api/comprobantes/:id` (`src/lib/pagos/comprobante.ts` + `crearRutaEntrega`) ya autoriza al administrador sin importar el dueño y al dueño solo si la ruta está en su carpeta; `pagos.comprobanteRuta` ya está en `COLUMNAS_CON_IMAGEN`; `verificarImagenSubida` se llama antes de abrir la transacción.
- **#6:** `transaccionDeEscritura(fn, base)` ejecuta `expirarVencidas(tx)` y `fn` en la misma transacción; si `fn` lanza, **todo** se revierte, también las marcas `expirada`. `reservaActiva` (`src/db/reservas-activas.ts`) es `confirmada`, o `pendiente` con `expira_en > now()`. La restricción de exclusión `reservas_sin_solape_por_equipo` solo cubre `pendiente` y `confirmada` y no puede usar `now()`.
- **#2:** `requerirAdmin(cabeceras)` responde `401` sin sesión y `403` para un cliente. `app/admin/layout.tsx` **redirige** (a `/ingresar` o `/cuenta`) en vez de responder `403`; `TECH-DESIGN.md` acepta "`403` o redirigido", así que no se cambia.
- **#7:** `claveHogar` y `validarDireccion` (`src/lib/direccion.ts`). `direccion_normalizada` es `"<calle normalizada> <número normalizado>"` y `normalizarNumero` no deja espacios, así que el **último token** es siempre el número.
- **#10 (otro spec-writer, en paralelo, sin código todavía):** agregará los índices únicos de `primera_gratis` y la comprobación del hogar en `decidirLimpiezaGratis`. Este change no toca esos archivos.
- **`openspec/specs/` está vacío** (nada archivado), así que no hay requisitos base que modificar; los cambios a la ruta del #9a se describen aquí.
- **Verificado en las bibliotecas:** Drizzle 0.45 tiene `select(...).for("update")` (`drizzle-orm/pg-core/query-builders/select.d.ts`) y `AnyPgColumn` para la clave foránea a la misma tabla; `crear.ts` ya usa `make_interval(...)` en un `sql`. Postgres suma meses a un `timestamptz` recortando al último día del mes de destino (30 de noviembre + 3 meses = 28 de febrero), igual que `sumarMeses` del #9a; Neon corre en UTC y Perú no tiene horario de verano.
- **Postgres y los enums:** `ALTER TYPE ... ADD VALUE` se puede ejecutar dentro de una transacción, pero el valor nuevo no se puede **usar** (en un `CHECK`, un índice o un `INSERT`) hasta que esa transacción se confirme. Drizzle aplica las migraciones pendientes en una sola transacción, así que la migración de este change no debe nombrar `'caducada'` en ningún `CHECK` ni índice (decisión 4); la tarea 1.8 lo comprueba aplicándola a la rama.

## Goals / Non-Goals

**Goals:**

- Que el administrador pueda ver, aprobar y rechazar cada pago, y cancelar una reserva fraudulenta, sin dejar datos a medias ni confirmar un horario vencido (ADR 0009).
- Resolver los cuatro hallazgos del #9a sin inventar política de negocio. El de la membresía atascada lo decidió el usuario (opción C, ya recogida en el PRD, caso borde 1, y en el ADR 0009).
- Dejar a #12, #13 y #14 los datos y los puntos de extensión que necesitan (`cancelada_por`, consulta de pagos sin reserva, consulta de pagos reenviables, pasada de expiración).

**Non-Goals:**

- La reserva nueva tras una aprobación tardía, el texto "Elige un nuevo día y hora" del perfil y los avisos del cliente (#12 y #13). La pantalla del cliente para subir otro comprobante y el texto que muestra cuánto plazo le queda (#12); aquí solo están `POST /api/pagos` y los datos `reenvio_hasta` y `reenvio_vigente`.
- Crédito en horas (#14): aprobar, rechazar, expirar, cancelar y cerrar una membresía no tocan `creditos_horas` ni `usos_credito` todavía. Cada punto de extensión queda comentado.
- Marcar reservas `completada`, reasignar equipo y apoyo (#16); fotos (#17); reseñas (#18); renovación del mes 4 (#15).
- Notificar al cliente por correo, SMS o WhatsApp (PRD, "No alcance"): el cliente se entera en su perfil.
- Límite de frecuencia y de registros por IP (pendientes de `BACKLOG.md`), y un tope de intentos de reenvío por cliente más allá de "un reemplazo por pago rechazado".
- Rechazar o cancelar en bloque, reabrir un pago rechazado o un registro de auditoría más allá de `revisado_por` y `revisado_en`.
- Modificar `PRD.md`, `TECH-DESIGN.md`, los ADR o `BACKLOG.md`: lo que haga falta cambiar ahí se propone en el reporte.

## Decisions

### 1. Rutas bajo `/api/admin` y una transacción por acción

`GET /api/admin/pagos`, `GET /api/admin/pagos/:id`, `POST /api/admin/pagos/:id/aprobar`, `POST /api/admin/pagos/:id/rechazar` y `POST /api/admin/reservas/:id/cancelar`, cada una con `requerirAdmin` primero (ADR 0003: "las rutas de administración exigen rol `admin`"). Las acciones exigen `application/json` (`415`, como `/api/reservas`) para que un formulario de otro sitio no las dispare con la cookie `SameSite=Lax`, y validan el `id` con formato de uuid (si no, `404`, no un `22P02`). La fábrica sigue el patrón de `crearRutaReservas`: dependencias inyectables (`sesion`, `base`, `ahora`), `conReintento` con `errorOriginal` y `manejar`.

- **Reintento:** cada acción es idempotente en el sentido útil. Si la conexión se corta durante el `COMMIT` y el primer intento sí se confirmó, el reintento ve el pago ya revisado y responde `409`, que es verdad y no duplica nada (mismo razonamiento que la decisión 4 del #9a).
- **Descartada:** Server Actions de Next. El ADR 0003 prefiere un contrato HTTP explícito que se prueba con `curl` y Vitest, y no se usa Playwright.
- **Descartada:** `PATCH /api/admin/pagos/:id` con `{estado}`. Mezcla dos transiciones con reglas distintas en un solo cuerpo y complica la validación.

### 2. Aprobar: bloquear el pago, activar la membresía, confirmar la reserva

Dentro de `transaccionDeEscritura` (que ya marca las vencidas): `SELECT ... FOR UPDATE` del pago → `404` si no existe, `409` si no está `pendiente` → `UPDATE pagos SET estado='aprobado', revisado_por, revisado_en=now()` → si el concepto incluye la membresía, `UPDATE membresias SET estado='activa', inicio=now(), fin = now() + make_interval(months => membresia_meses) WHERE id=… AND estado='pendiente'` (si no actualiza ninguna fila, `409`; la transacción se deshace) → `UPDATE reservas SET estado='confirmada', expira_en=NULL, actualizada_en=now() WHERE pago_id=… AND estado='pendiente' RETURNING`. La respuesta trae el pago, la membresía, la reserva (`confirmada`, `expirada`, `cancelada` o `null`) y `nuevo_horario_pendiente`.

- **Hallazgo 4 (3 meses desde la aprobación):** `inicio` y `fin` salen de `now()` de la base, **no** de `pagos.creado_en`. `now()` es el instante de inicio de la transacción, igual en ambas columnas, así que cumple `fin > inicio`. Se lee `membresia_meses` de `configuracion` (ya validado por `leerConfiguracion`), nunca un `3` en el código. El `fin` no depende del reloj del servidor, como `expira_en` en el #9a.
- **Por qué `FOR UPDATE` y no solo el `UPDATE ... WHERE estado='pendiente'`:** serializa a dos administradores y da el `409` claro al segundo; con el `UPDATE` condicional solo se enteraría por filas afectadas y la membresía podría activarse dos veces si las sentencias se intercalan.
- **La reserva solo se confirma si sigue `pendiente`:** la marca de vencidas ocurre al inicio de la misma transacción, con el mismo `now()`, así que una reserva vencida ya es `expirada` y el `UPDATE` no la toca (ADR 0009: "nunca se confirma un horario vencido").
- **Confirmar no puede chocar con la restricción de exclusión:** `pendiente` y `confirmada` están ambas en su `WHERE` y el rango no cambia.
- **Una membresía `caducada` nunca llega aquí:** el cierre exige que no haya ningún pago `pendiente` (decisión 4), así que el administrador no puede aprobar un pago de una membresía cerrada; el pago rechazado ya no es `pendiente` y daría `409`.
- **Descartada:** bloquear la aprobación cuando la reserva expiró (alternativa ya descartada en el ADR 0009: castiga al cliente por la demora del administrador).
- **Punto de extensión #14:** "si la reserva cancelada por el cliente tenía pago pendiente y se aprueba, generar el crédito en este momento" (ADR 0012). Se deja un comentario, no código.

### 3. Aprobación tardía: qué hace #11 y qué completa #13

**#11 hace:** aprobar el pago, activar la membresía, dejar la reserva `expirada` (o `cancelada`) y devolver `nuevo_horario_pendiente: true`; y una consulta reutilizable `pagosConHorarioPendiente(base, usuarioId?)` (`src/lib/pagos/horario-pendiente.ts`) que devuelve los pagos `aprobado` cuyas reservas no incluyen ninguna `pendiente` vigente, `confirmada` ni `completada`. La consulta usa `reservaActiva` y es la definición única del estado "debe elegir un nuevo horario" (ADR 0009: "mientras el pago esté aprobado y no tenga ninguna reserva viva o realizada").

**#12 y #13 completan:** #12 muestra "Elige un nuevo día y hora" en el perfil usando esa consulta; #13 crea la reserva `confirmada` (sin espera) que apunta al **mismo `pago_id`**, valida la anticipación de 48 horas y la vigencia, y conserva las horas gratis y los montos del pedido original (la primera limpieza gratis expirada no cuenta como "ya realizada", así que `decidirLimpiezaGratis` sigue dando verdadero). Eso corresponde al criterio "La nueva reserva elegida tras una aprobación tardía usa el mismo pago…" de `TECH-DESIGN.md`, que `BACKLOG.md` asigna a #13.

- **Por qué la consulta vive aquí y no en #12:** la regla nace de lo que #11 deja en la base; si #12 y #13 la escribieran por separado podrían divergir. Es una función de lectura, probada contra la rama.
- **Descartada:** guardar un indicador `horario_pendiente` en `pagos`. Se desincroniza con cada reserva que nace o se cancela; derivarlo cuesta una consulta y nunca miente.

### 4. Hallazgo 1, membresía atascada: opción C, decidida por el usuario

**Problema:** con el pago `rechazado` y la reserva `expirada`, el cliente tiene una membresía `pendiente` (el índice `membresias_una_pendiente_por_cliente` impide otra) y `POST /api/reservas` le responde `409 en_espera` para siempre.

**Decisión del usuario (PRD, caso borde 1; ADR 0009, "Rechazar un pago"):** si el pago se rechaza y la reserva ya expiró, el cliente puede subir otro comprobante hasta **7 días después del rechazo**. Si se aprueba, rige la aprobación tardía. Si pasan los 7 días sin comprobante nuevo, la membresía en espera se **cierra** y el cliente puede empezar de nuevo con una reserva y un pago nuevos. No choca con ningún ADR: concreta el "en ese plazo" del ADR 0009.

**4.1 El plazo es un dato.** Clave nueva `reenvio_comprobante_dias` en `configuracion`: esquema zod `z.number().int().positive()` en `src/lib/configuracion.ts`, valor `7`, **no** provisional (lo decidió el usuario), insertada por la migración con `ON CONFLICT ("clave") DO NOTHING` y reflejada en `VALORES_DEL_DISENO`. Corre desde `pagos.revisado_en` (el instante del rechazo) y se compara con `now()` de la base, nunca con el reloj del servidor: `revisado_en + make_interval(days => N) > now()`. El mismo plazo vale para cualquier pago rechazado, tenga o no la reserva viva; si la reserva sigue viva, vence antes (máximo 24 horas) que el plazo, así que no hay conflicto.
- **Descartada:** una constante `7` en el código (viola "los plazos son datos", `TECH-DESIGN.md`) o contar desde `creado_en` del pago (el plazo es "después del rechazo", y el administrador puede tardar horas en rechazar).

**4.2 Mecanismo de cierre: un estado nuevo `caducada` de la membresía.** Se agrega `caducada` a `estado_membresia`. Una función `cerrarMembresiasSinReenvio(tx, plazoDias)` (`src/lib/pagos/cierre.ts`) pasa a `caducada` toda membresía `pendiente` sin ningún pago `pendiente`, con al menos un pago `rechazado` y cuyos pagos rechazados ya superaron todos el plazo. Se ejecuta en dos puntos:
1. **La pasada de expiración confiable** (`ejecutarPasadaDeExpiracion`, decisión 5), en la misma transacción que `expirarVencidas`.
2. **Al inicio de la transacción de `POST /api/reservas`**, antes de `comprobarEstadoDelCliente`. Es imprescindible: la pasada solo corre cuando el administrador abre su portal, y quien debe poder empezar de nuevo es el cliente. Así la salida no depende de que alguien más entre.

Así `POST /api/reservas` ya no choca con el índice único de la membresía `pendiente`: la `caducada` queda fuera del `WHERE estado='pendiente'`. `comprobarEstadoDelCliente` deja de contar las `caducada` (ni vigente ni en revisión) y distingue la membresía `pendiente`: si su último pago está `pendiente` responde `409 en_espera` (como hoy); si está `rechazado` (necesariamente dentro del plazo, porque el cierre corrió antes) responde `409 pago_rechazado` con el mensaje "Tu comprobante fue rechazado. Sube otro comprobante desde tu perfil antes del {fecha}." (la fecha en hora de Lima). Una `caducada` no activa nada, no tiene fechas y no genera crédito en horas ni devolución (no se aprobó ningún pago).

- **Concurrencia con el reenvío:** el cierre bloquea primero las filas candidatas (`SELECT id FROM membresias WHERE estado='pendiente' ... FOR UPDATE`) y evalúa la condición en una segunda sentencia (en `READ COMMITTED` cada sentencia ve su propia instantánea, así que ve el pago `pendiente` que un reenvío confirmó mientras esperaba el bloqueo). El reenvío bloquea también la fila de la membresía antes de insertar. Resultado: o gana el reenvío y no se cierra, o gana el cierre y el reenvío ve la membresía `caducada` y responde `409 plazo_vencido`.
- **Es una escritura derivable y no una decisión:** si una transacción que cerró falla después (`409` en `POST /api/reservas`), el cierre se deshace, pero la condición sigue siendo verdadera y se vuelve a aplicar en la siguiente. El estado guardado es un caché de un hecho calculable con `revisado_en` y el reloj de la base.
- **Migración y `CHECK`:** `membresias_estado_y_fechas` se reescribe sin nombrar el valor nuevo, para que no choque con la regla de "usar un valor de enum en la misma transacción que lo agrega": `(estado = 'activa' AND inicio IS NOT NULL AND fin IS NOT NULL AND fin > inicio) OR (estado <> 'activa' AND inicio IS NULL AND fin IS NULL)`. Es equivalente al anterior para `pendiente` y `activa`, y deja a `caducada` sin fechas. Es el único `DROP` permitido de la migración.

**Alternativas descartadas:**
- **Cerrar sin estado nuevo, ignorando la membresía vencida en el índice** (por ejemplo, añadir `AND rechazo reciente` al índice único): un índice parcial no puede usar `now()`, y los predicados con subconsultas no son válidos. Habría que borrar o reasignar la fila.
- **Borrar la membresía rechazada:** rompe la clave foránea de `pagos.membresia_id` y `reservas.membresia_id` y pierde la historia del rechazo; el ADR 0008 conserva los pagos.
- **Reutilizar `estado = 'pendiente'` con una columna `cerrada_en`:** exige que el índice único y todas las lecturas filtren por la columna; un estado explícito es más fácil de consultar y de probar.
- **Cerrar al rechazar o al expirar la reserva (opción B original):** descarta un pago que el cliente aún puede corregir; la opción C da 7 días.
- **Cerrar solo desde la pasada o solo desde un cron:** el cron de Hobby corre una vez al día y la pasada depende del administrador; el cliente quedaría atascado hasta entonces. Cerrar al intentar reservar lo evita.
- **Un estado distinto, `rechazada` o `cerrada`:** `caducada` dice mejor lo que ocurrió (venció el plazo) y no se confunde con un rechazo del administrador, que no cierra nada.

**Efecto en `POST /api/pagos`:** ver decisión 7.

**Lo que no cambia:** el `409 pago_rechazado` de `POST /api/reservas` (antes "parte segura en cualquier opción") se mantiene; solo gana la fecha límite en el mensaje.

### 5. Hallazgo 3, pasada de expiración confiable

**Qué pasa hoy:** `transaccionDeEscritura` marca las vencidas dentro de la transacción de cada escritura. Si luego `fn` lanza un `409` o `422`, `base.transaction` hace `ROLLBACK` y la marca desaparece: la reserva sigue `pendiente` en la base hasta una escritura que sí se confirme. Las **lecturas** no se ven afectadas (usan `reservaActiva`), y el `EXCLUDE` no hace daño porque cada escritura vuelve a marcar al empezar. Lo que se desfasa es el estado **guardado**: la lista del administrador, cualquier consulta que filtre `estado = 'pendiente'` sin `reservaActiva`, y en #14 el retorno de las horas de crédito.

**Decisión:** `ejecutarPasadaDeExpiracion(base = db())` (`src/lib/agenda/pasada.ts`) abre **su propia transacción** (`base.transaction(tx => ...)`) y la confirma. Dentro llama a `expirarVencidas(tx)` y, después, a `cerrarMembresiasSinReenvio(tx, plazoDias)` (decisión 4), con el plazo leído de `configuracion`. En una transacción y no en una sentencia suelta porque #14 extiende `expirarVencidas` con más sentencias (devolver horas de crédito), que deben ser atómicas. Se ejecuta con `conReintento`, después de `requerirAdmin` y antes de leer o escribir, en: la lista, el detalle y cada acción (aprobar, rechazar, cancelar). El estado mostrado se calcula igual con `reservaActiva`, así que la pasada persiste, no decide.

- **Por qué en las rutas del administrador y no dentro de `transaccionDeEscritura`:** cambiar el helper compartido afectaría a los dobles de `base.transaction` de #6 y #9a, y una pasada tras un `ROLLBACK` de un fallo de conexión pelearía con el reintento. El administrador es quien abre la lista y por tanto quien necesita la verdad guardada; la agenda del #16 y el perfil del #12 llamarán a la misma función. El cierre de membresías sí se repite dentro de `POST /api/reservas` (decisión 4) porque ahí es el cliente quien lo necesita.
- **Descartada:** depender del cron diario. En Hobby solo corre una vez al día y el ADR 0009 y `TECH-DESIGN.md` dicen que la expiración no depende de él.
- **Descartada:** un `pg_cron` o un trigger en Neon. Agrega infraestructura y el `now()` de la expiración sigue siendo el de la base sin necesidad.
- **Descartada:** reintentar la marca en un `catch` de `transaccionDeEscritura`. Duplica la lógica y es la opción que más pelea con el reintento.
- **Costo:** dos sentencias por petición del administrador (la segunda, un `SELECT ... FOR UPDATE` sobre muy pocas filas), que casi nunca afectan filas; el índice `reservas_expira_en_pendiente_idx` cubre la primera.

### 6. Rechazar y cancelar

**Rechazar** (ADR 0009): bloquea el pago, `409` si no está `pendiente`, lo marca `rechazado` con `revisado_por`, `revisado_en` y `motivo_rechazo` opcional (hasta 200 caracteres, validado con zod y con un `CHECK` en la base). No toca la reserva ni la membresía. La respuesta incluye `reenvio_hasta` (`revisado_en` + `reenvio_comprobante_dias`, calculado en SQL) y `reenvio_vigente`, para que el cliente sepa cuánto plazo tiene (el texto lo muestra #12). Punto de extensión #14: "si la reserva usó crédito, devolver las horas cuando se rechaza" (ADR 0012).

**Cancelar** (PRD, caso borde 9): `SELECT ... FOR UPDATE` de la reserva → `404` si no existe → `409` si no está `pendiente` → `UPDATE ... estado='cancelada', cancelada_por='admin'`. Como `cancelada` sale del `WHERE` de la restricción de exclusión, el horario queda libre en la misma transacción. Solo `pendiente`: `TECH-DESIGN.md` dice "cancelar una reserva `pendiente` con comprobante falso". Cancelar una `confirmada` es otra decisión (¿crédito?, ¿aviso al cliente?) que no es de este ítem.

- **La cancelación no rechaza el pago.** El PRD solo pide "cancelar la reserva para liberar el horario". El pago queda `pendiente` y sin reserva viva en la lista, donde el administrador lo rechaza o, si se equivocó, lo aprueba (aprobación tardía). Mientras el pago siga `pendiente` la membresía no se cierra. **Pregunta abierta menor (Open Questions 1):** si el administrador prefiere un solo botón que cancele y rechace.
- **`cancelada_por` (`cliente` o `admin`):** la regla del ADR 0012 "se genera crédito cuando la reserva queda cancelada **por el cliente**" necesita distinguirlo; sin la columna, #14 no podría separar la cancelación por fraude de la del cliente. Se agrega ahora, nullable y con `CHECK (cancelada_por IS NULL OR estado = 'cancelada')`; #12 guarda `cliente`. Es un dato, no política.
- **Descartada:** borrar la reserva fraudulenta. Rompe el historial y la clave foránea de futuras fotos o reseñas.

### 7. Reenvío del comprobante (`POST /api/pagos`)

El pago nuevo copia usuario, concepto, membresía y monto del rechazado (nunca del cuerpo), apunta a él con `pagos.reemplaza_a` y deja la reserva viva, si la hay, apuntando al pago nuevo. La reserva **no** extiende su `expira_en` (ADR 0009). `pagos.reemplaza_a` lleva un índice único parcial (`WHERE reemplaza_a IS NOT NULL`): cada pago rechazado se reemplaza una vez, y dos reenvíos simultáneos dan `409` por la base (`traducirUnicidad` se extiende con el nuevo índice).

Orden dentro de `transaccionDeEscritura`:
1. Bloquear el pago rechazado (`FOR UPDATE`): `404` si no es del cliente o no existe; `409` si no está `rechazado`.
2. Si tiene membresía, bloquear su fila (`FOR UPDATE`): `409 plazo_vencido` si está `caducada`.
3. Comprobar el plazo con la base: `revisado_en + make_interval(days => reenvio_comprobante_dias) > now()`; si no, `409 plazo_vencido` con el mensaje "Pasó el plazo para subir otro comprobante. Puedes empezar de nuevo con una reserva y un pago nuevos."
4. Comprobar que la membresía no tenga otro pago `pendiente` (`409`).
5. Insertar el pago nuevo y mover la reserva viva, si la hay.

- **Código estable `plazo_vencido` con `409`:** el pago existe pero su estado ya no admite la operación; `422` quedó para datos mal formados. El cliente (#12) distingue "plazo vencido" de "pago en revisión" por el código y ofrece empezar de nuevo.
- **Por qué un pago nuevo y no actualizar el rechazado:** el ADR 0008 lo dice ("se crea un pago nuevo y la reserva pasa a apuntar a él") y conserva la historia del rechazo (qué comprobante, quién, cuándo, motivo).
- **`verificarImagenSubida` antes de la transacción** y guardar solo la ruta que devuelve (ADR 0010). `pagos.comprobanteRuta` ya está en `COLUMNAS_CON_IMAGEN`: el comprobante rechazado sigue referenciado y el cron no lo borra.
- **Encadenamiento:** si el pago de reenvío también se rechaza, tiene su propio plazo desde su rechazo y se puede reemplazar una vez más. Cada intento cuesta una revisión del administrador; es el riesgo residual de la decisión 4 (ver Riesgos).
- **Consulta para #12:** `pagosRechazadosReenviables(base, usuarioId)` (`src/lib/pagos/reenvio-plazo.ts`) devuelve los pagos rechazados del cliente con el plazo vigente y sin reemplazo, con `reenvio_hasta`; es la definición única de "puede subir otro comprobante" para el perfil.
- **Descartada:** reenvío en `PATCH /api/pagos/:id`. El ADR 0003 y 0010 nombran `POST /api/pagos` para registrar un comprobante.

### 8. Coincidencias de dirección

`buscarCoincidencias(base, reservaGratis)` (`src/lib/pagos/coincidencias.ts`) hace una consulta acotada por distrito y filtra en memoria con funciones puras. La consulta trae las reservas con `primera_gratis` del mismo distrito, de otro cliente y que sean `completada` o cumplan `reservaActiva`. Las funciones puras clasifican en `misma_direccion`, `otro_departamento` o `calle_parecida` (spec `coincidencias-de-direccion`):

- El número es el último token de `direccion_normalizada`; se compara su primera secuencia de dígitos ("123" y "123a" coinciden).
- La calle es el resto: se le quitan los tipos de vía (avenida, jiron, calle, pasaje, alameda) y los artículos (de, del, la, las, los, el); son parecidas si los conjuntos de palabras son iguales, uno contiene al otro, o la distancia de edición entre las calles unidas es de a lo sumo 1 (hasta 8 letras) o 2 (más de 8). Los tipos de vía y los umbrales son constantes con nombre del módulo, no datos de negocio.
- **La reserva que se revisa** es la `primera_gratis` más reciente de `pago.membresia_id`, sin importar su estado ni su `pago_id`. Así un pago de reenvío (que ya no tiene reserva) conserva su contexto.
- **Por qué no una consulta SQL con `similarity`/`pg_trgm`:** agrega una extensión a Neon y las reglas (tipos de vía, número) son más fáciles de probar y de explicar en TypeScript. El volumen es una reserva gratis viva por hogar: pocas por distrito.
- **Por qué mostrar `otro_departamento`:** el PRD permite dos departamentos del mismo edificio, pero el administrador debe poder ver que el edificio ya recibió una (PRD, caso borde 10; ADR 0013).
- **Descartada:** coincidencia por distancia de edición del texto completo. Da falsos negativos con "Av." y "Jr." y falsos positivos con números cercanos.

**Qué depende del ítem #10 y qué no:**
- **No depende:** las columnas `distrito`, `direccion_normalizada`, `departamento_normalizado` y `primera_gratis` existen desde #6 y #9a, y `claveHogar` desde #7. La consulta, el clasificador y la pantalla funcionan sin #10. Antes de #10 incluso es la **única** defensa: dos cuentas con la misma dirección pueden recibir las 3 horas, y la coincidencia `misma_direccion` se las muestra al administrador.
- **Depende de #10:** (a) las garantías. Con su índice único por hogar, una segunda reserva gratis con la misma clave ya no puede existir viva, así que `misma_direccion` solo aparecerá en datos viejos; (b) las **pruebas contra la rama**: un caso `misma_direccion` insertando dos filas gratis con la misma clave fallaría en cuanto #10 aplique su índice. Por eso las pruebas de este change cubren `misma_direccion` con funciones puras y dobles, y las pruebas contra Neon solo insertan filas de claves distintas (`otro_departamento`, `calle_parecida`), válidas con o sin #10. No se usa ni se modifica `decidirLimpiezaGratis` ni el índice de #10.
- **Número de migración:** la migración de este change y la de #10 se generan a partir del mismo `_journal.json`. Cada una se genera **al aplicarse**, una después de otra; no se fija un número en las tareas. La segunda en generarse parte del snapshot de la primera.

### 9. Esquema (una migración)

```
pagos       + motivo_rechazo text null, CHECK (char_length <= 200)
            + reemplaza_a uuid null FK pagos(id), UNIQUE INDEX (reemplaza_a) WHERE reemplaza_a IS NOT NULL
            + CHECK pagos_revision_coherente:
                (estado = 'pendiente' AND revisado_por IS NULL AND revisado_en IS NULL)
                OR estado = 'aprobado'
                OR (estado = 'rechazado' AND revisado_por IS NOT NULL AND revisado_en IS NOT NULL)
            + INDEX pagos_pendientes_idx (creado_en) WHERE estado = 'pendiente'
reservas    + cancelada_por quien_cancela ('cliente','admin') null
            + CHECK (cancelada_por IS NULL OR estado = 'cancelada')
membresias  estado_membresia + 'caducada' (ALTER TYPE ... ADD VALUE)
            CHECK membresias_estado_y_fechas reescrito (sin nombrar 'caducada'):
                (estado = 'activa' AND inicio IS NOT NULL AND fin IS NOT NULL AND fin > inicio)
                OR (estado <> 'activa' AND inicio IS NULL AND fin IS NULL)
configuracion  INSERT 'reenvio_comprobante_dias' = 7, provisional = false, ON CONFLICT ("clave") DO NOTHING
```

- `aprobado` queda sin exigir revisor porque los pagos internos con crédito (#14) se aprueban solos, con monto 0.
- No hay filas que migrar con valores: todas las columnas son nulables, y los pagos y reservas existentes en la rama `pruebas` son filas de prueba que cumplen el `CHECK` (los `pendiente` no tienen revisor). Las membresías existentes son `pendiente` sin fechas o `activa` con fechas: cumplen el `CHECK` nuevo.
- La inserción en `configuracion` se agrega **a mano al final del SQL generado** (`drizzle-kit generate` no genera datos), con `ON CONFLICT ("clave") DO NOTHING` como la migración `0001`: volver a aplicarla no pisa un valor que el negocio haya editado.
- **Descartada:** el `CHECK` que nombra `'caducada'` (más legible): fallaría al aplicarse porque el valor se agrega en la misma transacción. Alternativa si aun así falla en la rama: dos migraciones, con el `ADD VALUE` en la primera; Drizzle las aplica en una sola transacción, así que habría que comprobarlo (tarea 1.8).
- La migración se **genera y aplica solo a la rama `pruebas`** (`DATABASE_URL_PRUEBAS`). Producción queda diferida (Migration Plan).

### 10. Pantallas del portal

`app/admin/pagos/page.tsx` (lista) y `app/admin/pagos/[id]/page.tsx` (detalle) son componentes de servidor que llaman a las funciones de `src/lib/pagos/` (sin llamar a su propia API por HTTP), tras ejecutar la pasada. Los botones viven en un componente de cliente `AccionesPago` que llama a las rutas, muestra el mensaje del error y hace `router.refresh()`. El comprobante se muestra con `<img src="/api/comprobantes/{id}">` (la ruta ya exige sesión y rol y entrega la imagen en línea con `Cache-Control: private, no-store`). El formato de soles es una función pura `formatearSoles(céntimos)` (`S/ 336,66`); si el change `asistente-de-reserva` (9b) ya creó `src/lib/soles.ts`, se reutiliza; si no, la crea este change con el mismo contrato y la misma prueba, sin duplicar el archivo.

- Las pantallas se prueban con `renderToStaticMarkup` (como `CamposDireccion.test.ts`) y las rutas con `curl` contra la rama. Sin Playwright.
- Estilos con módulos CSS propios (`app/admin/pagos/pagos.module.css`); el portal no reutiliza los estilos de formularios del cliente.
- **Descartada:** paginación y filtros por cliente: con el volumen esperado, 100 elementos ordenados por urgencia bastan.

## Cobertura de los criterios de `TECH-DESIGN.md`

| Criterio (Portal de administrador, salvo indicación) | Escenario en | Tarea |
|---|---|---|
| Sin rol `admin`, `/admin` y las rutas de administración dan `403` o redirigen | `revision-de-pagos` (solo el administrador) | 4.4, 5.3, 7.3 |
| El administrador puede ver el comprobante de cada pago pendiente | `revision-de-pagos` (detalle) | 5.2, 7.2, 9.2 |
| El administrador nunca ve como pendiente una reserva cuya espera ya venció | `revision-de-pagos` (lista), `expiracion-confiable` | 2.4, 5.1, 8.3 |
| Al aprobar: membresía `activa`, 3 meses desde la aprobación, reserva `confirmada` | `revision-de-pagos` (aprobar) | 4.1, 4.2, 8.2 |
| Aprobar un pago cuya reserva expiró: membresía activa, reserva sigue `expirada`, perfil "Elige un nuevo día y hora" | `revision-de-pagos` (aprobación tardía) | 4.2, 4.3, 8.4; el texto del perfil es de #12 |
| La nueva reserva tras la aprobación tardía usa el mismo pago, `confirmada`, sin comprobante | **Ítem #13** | solo la consulta `pagosConHorarioPendiente` (4.3) |
| Al rechazar, el cliente puede subir otro comprobante y la reserva conserva su `expira_en` | `revision-de-pagos` (rechazar), `reenvio-de-comprobante` | 4.5, 6.1, 6.2, 8.5 |
| Si el pago se rechaza y la reserva ya expiró, el cliente puede subir otro comprobante hasta 7 días después del rechazo (plazo de `configuracion`) | `reenvio-de-comprobante` (plazo, reenvío) | 1.4, 6.1, 6.2, 8.5, 8.6 |
| Si se aprueba, rige la aprobación tardía | `reenvio-de-comprobante` (aprobación tardía tras el reenvío) | 4.3, 8.5 |
| Pasado el plazo la membresía en espera se cierra y puede empezar de nuevo | `reenvio-de-comprobante` (cierre, empezar de nuevo), `expiracion-confiable` | 2.1, 2.2, 2.3, 6.3, 8.6, 8.7 |
| El administrador cancela una reserva `pendiente` con comprobante falso y el horario queda libre | `cancelacion-de-reserva-fraudulenta` | 4.6, 8.8 |
| Al revisar un pago con limpieza gratis, ve las gratis del mismo distrito con el mismo número y calle parecida, o la misma dirección con otro departamento | `coincidencias-de-direccion` | 3.1 a 3.4, 8.9 |
| (Miembro activo) Al aprobar el pago, la reserva pasa a `confirmada` | `revision-de-pagos` (pago que solo cubre una reserva) | 4.2 |
| (Comprobantes privados) Un comprobante solo lo ve su dueño y un administrador | ya cubierto por #9a; este change comprueba al administrador | 9.2 |
| Completar reserva, apoyo, reasignar, crédito del cliente, fotos, reseñas | **Ítems #16, #14, #17, #18** | no se cubre aquí |
| Vigencia por la fecha del servicio y reserva de miembro | **Ítem #13** | no se cubre aquí |

## Risks / Trade-offs

- **[Comprobantes falsos dentro del plazo (riesgo residual de la opción C)]** → durante los 7 días posteriores a un rechazo el cliente puede subir otro comprobante, también falso, y cada uno cuesta una revisión del administrador. Lo limitan "un reemplazo por pago rechazado" (índice único), "un pago `pendiente` por membresía" y que sin reserva viva no se bloquea ningún horario; no hay tope de intentos encadenados (cada rechazo abre un plazo nuevo). Un tope por cliente sería otra política. Se mantiene el riesgo "Comprobantes falsos" del PRD: lo contrasta el administrador con su cuenta.
- **[Cierre perezoso: la membresía queda `pendiente` en la base hasta que alguien dispare el cierre]** → el cliente no se entera de que su plazo venció hasta que reserva de nuevo o abre el perfil (#12). Las lecturas y el reenvío usan siempre la condición de plazo con el reloj de la base, no el estado guardado, así que nunca dependen de que el cierre haya corrido.
- **[Valor de enum en la misma transacción]** → el `CHECK` se reescribe sin nombrar `caducada`; la tarea 1.8 lo comprueba en la rama. Si fallara, se parte la migración.
- **[El `CHECK` de membresías se reescribe en una tabla con filas]** → `DROP CONSTRAINT` y `ADD CONSTRAINT` validan las filas existentes; el volumen es mínimo y son filas que cumplen ambos.
- **[Aprobar sin leer el comprobante]** → la pantalla muestra la imagen y las coincidencias en la misma página, pero el sistema no verifica contra la cuenta bancaria (PRD, riesgo "Comprobantes falsos"). Lo contrasta el administrador.
- **[Falsos negativos en las coincidencias]** → "Larco 123" y "Larco 1234" no coinciden, y una calle con otro nombre común ("Jr. Pardo" y "Av. Pardo y Aliaga") sí puede. Es una ayuda, no una garantía (ADR 0013).
- **[Falsos positivos]** → mostrar de más es aceptable: decide el administrador.
- **[La pasada depende de que el administrador abra la pantalla]** → hasta entonces el estado guardado de las reservas puede desfasarse, pero las lecturas ya no cuentan lo vencido y las escrituras lo marcan. El desfase solo afecta a #14 (horas de crédito) y se resuelve ahí extendiendo `expirarVencidas`.
- **[Dos administradores a la vez]** → `FOR UPDATE` y `409`; la pantalla muestra el mensaje y refresca.
- **[Hobby y operaciones de Blob]** → el detalle carga el comprobante con una lectura de Blob por vista; el listado no carga imágenes.
- **[Aprobar un pago de una reserva ya cancelada por el cliente]** (#12) → hoy válido y sin crédito; #14 genera el crédito en ese momento (ADR 0012).
- **[Producción sin la fila de configuración]** → `leerConfiguracion` falla si falta `reenvio_comprobante_dias`; la migración va antes del despliegue (Migration Plan) y la tarea 10.2 lo comprueba.
- **[Número de migración compartido con #10]** → se genera al aplicar, en orden.
- **[Datos reales de pago con aviso de demostración]** → ya decidido en #9a y #9b; este change no lo reabre.

## Migration Plan

1. **Rama `pruebas` (este change):** cambiar `src/db/esquema.ts`; `npm run db:generate -- --name=revision-de-pagos`; revisar el SQL (`ALTER TABLE ... ADD COLUMN`, `ALTER TYPE ... ADD VALUE 'caducada'`, el índice único, el índice parcial, el enum `quien_cancela`, los `CHECK` y el reemplazo del de membresías; el único `DROP` es `DROP CONSTRAINT "membresias_estado_y_fechas"`; sin cambios al `EXCLUDE`); agregar a mano al final el `INSERT` de `reenvio_comprobante_dias` con `ON CONFLICT ("clave") DO NOTHING`; aplicarla con `node -e "require('dotenv').config({path:'.env.local',quiet:true});process.env.DATABASE_URL=process.env.DATABASE_URL_PRUEBAS;require('child_process').execSync('npx drizzle-kit migrate',{stdio:'inherit'})"` (no imprime la cadena); correr `PRUEBAS_BD=1 npx vitest run --config vitest.bd.config.ts`.
2. **Servidor de desarrollo contra la rama:** `npm run dev` usa `DATABASE_URL` de `.env.local`, que es **producción**. Para las pruebas con `curl` se arranca con la cadena de la rama: `node -e "require('dotenv').config({path:'.env.local',quiet:true});process.env.DATABASE_URL=process.env.DATABASE_URL_PRUEBAS;require('child_process').spawn('npx',['next','dev'],{stdio:'inherit',shell:true})"`. El administrador de prueba se promueve con ese mismo truco aplicado a `npm run admin:promover -- <correo>`; nunca sin sobrescribir `DATABASE_URL`.
3. **Producción (diferida):** el usuario decidió no migrar ni desplegar producción hasta terminar los 18 ítems. Las tareas del grupo 10 quedan sin hacer y marcadas como diferidas: comprobar que `pagos`, `reservas`, `membresias` y `configuracion` se pueden alterar (consulta de solo lectura), `npm run db:migrate` **antes** de desplegar (agrega el estado, el `CHECK` y la fila de configuración), `npx vercel deploy --prod`, `GET /api/salud` = `200 {"estado":"ok"}`, prueba de humo con cuenta `@tiza.test` y su limpieza.
4. **Marcha atrás:** redesplegar el commit anterior; las columnas nuevas son nulables, el valor `caducada` del enum y la clave de configuración no estorban al código viejo (que no los lee; ojo, el código viejo no conoce las membresías `caducada`: una cuenta con esa membresía vería "pago en revisión" hasta reponer el despliegue). Quitar las columnas es un `DROP COLUMN` manual; un valor de enum no se quita.

## Open Questions

1. **¿Un solo botón "Cancelar y rechazar" para el comprobante falso?** El PRD solo pide cancelar la reserva; este change deja dos acciones. Se puede responder después sin cambiar las specs (se agregaría un parámetro opcional).
2. **Revisar las coincidencias:** las listas de tipos de vía y los umbrales de la distancia de edición son heurísticas iniciales; conviene ajustarlas con direcciones reales. No cambian las specs.
3. **Texto del perfil para el plazo (#12):** este change deja `reenvio_hasta` y `reenvio_vigente`; el texto exacto ("Te quedan N días para subir otro comprobante") lo decide el ítem 12.

Decididas por el usuario (ya no son preguntas abiertas): membresía atascada, opción C con plazo de 7 días desde el rechazo y cierre de la membresía (PRD, caso borde 1; ADR 0009).
