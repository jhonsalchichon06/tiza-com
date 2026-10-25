## Context

Ya existe, de los ítems anteriores y verificado en el código:

- `equipos` (`id`, `nombre` único, `activo`) con "Equipo 1" y "Equipo 2" cargados por la migración `0001`, que también habilita `btree_gist` y carga `configuracion` (`src/db/migraciones/0001_extension_y_datos_iniciales.sql`). Migraciones aplicadas hasta `0002_autenticacion`; esta sería la `0003`.
- `leerConfiguracion()` (`src/lib/configuracion.ts`) valida con zod todos los parámetros que la agenda necesita: `horario_atencion` (`dias`, con 0 = domingo, `apertura`, `cierre`, `zona`), `intervalo_horarios_minutos`, `traslado_horas`, `anticipacion_minima_horas`, `espera_pago_horas`.
- `calcularServicio(config, entrada)` (`src/lib/precios.ts`, ítem #4) devuelve `horas_trabajo`, `horas_agenda`, `requiere_apoyo`, `precio_lista`, `monto`, etc. en céntimos enteros, y lanza `ErrorApi.invalido` (`422`) si la entrada es inválida.
- `db()` (`src/db/cliente.ts`) es un `Pool` de Neon con WebSocket para lecturas y transacciones interactivas (ADR 0009). Verificado en `node_modules/drizzle-orm/neon-serverless/session.js`: `tx.transaction()` dentro de una transacción abre un `SAVEPOINT spN` y, si el callback lanza, hace `ROLLBACK TO SAVEPOINT`; y `pg-core/session.js` envuelve los errores de la base en `DrizzleQueryError`, con el error original de `pg` (y su `code`, por ejemplo `23P01`) en `.cause`. Por eso el código que detecta el conflicto debe mirar `error.cause.code` y no solo `error.code`.
- `ErrorApi` y `manejar` (`src/lib/errores.ts`), `conReintento` (`src/lib/reintento.ts`), `requerirSesion` (`src/lib/sesion.ts`) y `validarDireccion` (`src/lib/direccion.ts`, ítem #7) cubren errores, reintento, sesión y dirección.

`reservas` no existe y no hay `membresias` ni `pagos` (los crea el ítem #9). No hay datos de `reservas` en producción ni código que las cree antes del #9.

## Goals / Non-Goals

**Goals:**

- Que la base de datos garantice la capacidad de 2 equipos con traslado de 1 hora, aunque haya errores en el código o peticiones simultáneas (ADR 0002 y 0007).
- Que la expiración de reservas vencidas y la condición de "reserva activa" vivan cada una en un solo lugar, listas para #9, #11, #12 y #16 (ADR 0009).
- Que los horarios (atención, intervalo, anticipación, traslado, cupo) sean funciones puras sobre `configuracion`, con los ejemplos del PRD y de `TECH-DESIGN.md` como pruebas.
- Probar la restricción de exclusión y la concurrencia contra Neon real sin dejar datos ni afectar a clientes.

**Non-Goals:**

- `POST /api/reservas`, el asistente, el pago, la membresía y la vigencia en la fecha del servicio (#9, #13). La ruta de disponibilidad no comprueba membresía.
- La unicidad por pago, por cliente y por hogar de la limpieza gratis, y "una reserva en espera por cliente" (#9, #10).
- Aprobar o rechazar pagos (#11), reprogramar o cancelar (#12), reasignar equipo y marcar completada (#16), crédito en horas (#14). Aquí solo se deja el punto de extensión de la expiración.
- Calendario mensual y la pantalla con horarios en gris (#9): esta API entrega `disponible` y `motivo` por horario de un día.
- Límite de frecuencia de la API y límite de registros por IP (pendientes en `BACKLOG.md`, ADR 0005 y 0009).
- Confirmar los `REVISAR` del PRD: ninguno bloquea este ítem. La agenda no usa precios ni el monto de la membresía.

## Decisions

### 1. Rango bloqueado como columnas `inicio`, `fin` y `fin_bloqueo`

La tabla guarda `inicio`, `fin` y `fin_bloqueo` (`timestamptz`) y la restricción construye el rango en su expresión:

```sql
ALTER TABLE "reservas" ADD CONSTRAINT "reservas_sin_solape_por_equipo"
  EXCLUDE USING gist ("equipo_id" WITH =, tstzrange("inicio", "fin_bloqueo", '[)') WITH &&)
  WHERE ("estado" IN ('pendiente', 'confirmada'));
```

- **Por qué:** `drizzle-orm` no tiene un tipo `tstzrange` ni genera `EXCLUDE`; con columnas simples el esquema de Drizzle, las lecturas (`inicio`, `fin_bloqueo` como `Date`) y los `CHECK` quedan tipados sin un `customType`. El SQL de la restricción se agrega a mano al archivo generado por `npm run db:generate`; `drizzle-kit` compara snapshots y no introspecciona la base, así que no la borra después.
- **Choque menor con el ADR 0002 y 0007:** dicen que la reserva "guarda el rango bloqueado como `tstzrange`". Aquí se guardan sus dos extremos y el rango se arma en la restricción. El comportamiento (exclusión por equipo sobre el rango semiabierto) es el mismo; si se prefiere la columna `tstzrange`, solo cambia la migración y el esquema, no el resto del diseño. Se deja asentado en vez de decidirlo en silencio.
- **Descartada:** una columna `tstzrange` con `customType` de Drizzle, o una columna generada. Es viable, pero agrega un tipo propio para escribir y leer fechas de todos los ítems siguientes, y dos fuentes de verdad (extremos y rango).
- **Rangos semiabiertos `[)`:** una reserva que empieza justo cuando termina el traslado de otra del mismo equipo es válida (criterio de `TECH-DESIGN.md`).
- **Solo `pendiente` y `confirmada` bloquean.** `completada` no, porque el servicio ya ocurrió y la anticipación mínima impide crear reservas en el pasado (ADR 0007).
- **Por qué `expirarVencidas` es obligatoria:** el `WHERE` de una restricción de exclusión no puede usar `now()`, así que una `pendiente` vencida sigue bloqueando hasta que alguien la marque `expirada` (ADR 0009).

### 2. La migración crea `reservas` sin `membresia_id` ni `pago_id`

La migración `0003` crea los enums `tipo_servicio`, `estado_reserva` y `estado_apoyo` y la tabla `reservas` con todas las columnas que no dependen de tablas inexistentes: `usuario_id` (FK a `usuarios`, sin cascada), `equipo_id` (FK a `equipos`), tipo, dormitorios, baños, `horas_trabajo`, `horas_agenda` (`numeric(4,1)`, se leen con `Number`; todas son múltiplos de 0,5), `requiere_apoyo`, `apoyo_estado`, `apoyo_nota`, la dirección completa del ADR 0013 (`distrito`, `calle`, `numero`, `departamento`, `departamento_normalizado` por defecto `''`, `referencias`, `direccion_normalizada`), `inicio`, `fin`, `fin_bloqueo`, la copia del cobro en céntimos enteros (`precio_lista`, `descuento`, `monto`) y en horas (`horas_gratis_aplicadas`, `credito_aplicado`), `primera_gratis` (por defecto `false`), `estado`, `expira_en`, `creada_en` y `actualizada_en`. Más la restricción de exclusión, los `CHECK` y dos índices de apoyo (`reservas(inicio)` para la lectura de ocupación y un índice parcial `reservas(expira_en) WHERE estado = 'pendiente'` para la expiración).

Qué agregan los ítems siguientes, para no duplicar trabajo:

| Ítem | Agrega a `reservas` |
|---|---|
| #9 | `membresia_id` y `pago_id` (`NOT NULL`, con FK a las tablas que ese ítem crea; la tabla está vacía, así que basta `ADD COLUMN ... NOT NULL`, y su tarea comprueba antes que lo esté), el índice único parcial `reservas(pago_id)` y el índice único parcial `reservas(usuario_id) WHERE estado = 'pendiente'` |
| #10 | El índice único parcial `reservas(usuario_id) WHERE primera_gratis AND estado IN ('pendiente','confirmada','completada')` y el de `reservas(distrito, direccion_normalizada, departamento_normalizado)` con la misma condición (la columna `primera_gratis` ya está) |

- **Por qué:** el ADR 0008 exige `membresia_id` y `pago_id` obligatorios con FK; crearlas ahora sin FK o como `NULL` dejaría una forma más débil que la del ADR hasta que llegue #9. Como nada inserta reservas antes del #9, agregarlas entonces cuesta lo mismo.
- **Descartada:** crear `membresias` y `pagos` vacías aquí. Mete en #6 el diseño del pago y de la membresía, que #9 todavía debe decidir (monto pendiente en el PRD).
- **Descartada:** columnas nulables `membresia_id`/`pago_id` ahora. Obliga a una segunda migración con `SET NOT NULL` y a que las pruebas de #6 inserten filas que el ADR 0008 declara inválidas.
- **Distrito como `text`:** los 9 distritos viven en `src/lib/distritos.ts` y el servidor los valida (ADR 0013). Un `CHECK` con la lista duplicaría la lista y obligaría a una migración si el PRD la amplía.
- Una reserva `pendiente` MUST tener `expira_en` (`CHECK`): sin él bloquearía el horario para siempre.

### 3. Condición de "reserva activa" y expiración centralizadas

`src/db/reservas-activas.ts` exporta el fragmento SQL `reservaActiva` (`estado = 'confirmada' OR (estado = 'pendiente' AND expira_en > now())`), que usa la lectura de ocupación y usarán los ítems siguientes. `src/lib/agenda/expirar.ts` exporta `expirarVencidas(tx)`, que ejecuta el `UPDATE ... RETURNING id` del ADR 0009 y devuelve los identificadores, y `transaccionDeEscritura(fn)`, que abre `db().transaction`, llama primero a `expirarVencidas` y luego a `fn(tx)`.

- **Por qué:** el ADR 0009 señala que repetir la condición en cada lectura es el riesgo, y que las escrituras deben marcar las vencidas al empezar. El envoltorio hace imposible olvidarlo.
- **Punto de extensión:** `expirarVencidas` devuelve los ids para que el ítem #14 devuelva a su lote las horas de crédito reservadas (ADR 0012) editando solo esta función; #9, #11, #12 y #16 no cambian.
- **Sin reintento dentro del envoltorio:** un reintento tras un fallo de conexión durante el `COMMIT` podría duplicar la escritura si el primer intento sí se confirmó. Los índices únicos y la exclusión lo convertirían en `409`, pero es mejor decidir el reintento en cada ruta. La ruta de lectura de este ítem sí usa `conReintento`.
- **Descartada:** una vista de Postgres con la condición. Es viable (el ADR 0009 la menciona), pero una vista no se expresa en el esquema de Drizzle ni en el snapshot de `drizzle-kit`, y la condición solo se usa en un puñado de consultas.
- **Descartada:** un cron para expirar. Los cron del plan gratuito corren una vez al día; el ADR 0009 ya lo descartó.

### 4. La inserción en el primer equipo libre se construye aquí

`src/lib/agenda/asignar.ts` exporta `insertarEnPrimerEquipoLibre(tx, equipoIds, fila)`: recorre los equipos en orden, cada intento dentro de `tx.transaction(...)` (un `SAVEPOINT`), captura solo `error.cause.code === '23P01'` (o `error.code`), y si ninguno cabe lanza `ErrorApi.conflicto("Esa hora ya no está disponible. Elige otra hora.")`. Los ids de los equipos candidatos los pasa el llamante (los activos, por id).

- **Se aparta del backlog:** `BACKLOG.md` pone la "asignación de equipo con savepoints" en el ítem #9. Se adelanta porque los criterios de "Capacidad y conflictos de horario" de `TECH-DESIGN.md` (primer equipo libre, `409`, dos peticiones por el último cupo) no se pueden verificar sin ella, y ese bloque es la razón de ser del #6. El #9 solo la llama dentro de `transaccionDeEscritura`. Si se prefiere respetar el backlog al pie de la letra, el grupo 5 de `tasks.md` pasa al #9 sin otros cambios.
- **Descartada:** probar la restricción solo con inserciones directas y dejar `409` y "primer equipo" al #9. Deja sin verificar la parte más delicada (la transacción tras un error de la base) hasta un ítem que depende de pagos y membresías.
- **Descartada:** elegir el equipo con un `SELECT` previo y luego insertar. Es una carrera: dos peticiones eligen el mismo equipo; la restricción sigue protegiendo, pero la persona recibe un `409` aunque el otro equipo estuviera libre.

### 5. Disponibilidad: leer la ocupación una vez y calcular en memoria

`leerOcupacion(db, { desde, hasta, equipoIds?, excluirReservaId? })` hace dos consultas (equipos activos, o los `equipoIds` dados, y las reservas activas cuyo `[inicio, fin_bloqueo)` toca la ventana) y devuelve `{ equipos, ocupadas: { equipoId, inicio, finBloqueo }[] }` (nada de datos de clientes). `calcularDisponibilidad({ config, ahora, fecha, horasAgenda, equipos, ocupadas })` es una función pura que arma los inicios del día, filtra por horario de atención y marca `anticipacion` o `sin_cupo`.

- **Por qué:** un día tiene como mucho unos 21 inicios y pocos equipos; leer las ocupaciones del día una vez y comparar en memoria evita una consulta por horario (ADR 0008 advierte que los horarios cada 30 minutos duplican la cantidad a calcular) y se prueba sin base. La verdad final sigue siendo la restricción de exclusión: la lectura es solo informativa y el servidor vuelve a validar al crear (ADR 0006).
- **Descartada:** `generate_series` y un `NOT EXISTS` por equipo en SQL. Es viable y una sola consulta, pero la regla de horario, anticipación y apoyo quedaría repartida entre SQL y TypeScript y sería difícil de probar con ejemplos.
- **`equipoIds` opcional:** solo lo usan las pruebas contra Neon, que trabajan con equipos propios inactivos (decisión 8). Por defecto cuenta los equipos `activo = true`.
- **`excluirReservaId` opcional:** deja que #12 muestre libre el hueco de la reserva que el cliente está moviendo. Es un parámetro de una línea, con una prueba.
- **La ventana** va del inicio del día de atención hasta el cierre más la duración bloqueada máxima, para capturar reservas de la víspera que terminan con traslado en el día.

### 6. El servicio debe terminar antes del cierre; el traslado puede pasar

Un inicio es válido si `inicio + horas_agenda <= cierre`. El traslado posterior puede pasar de las 18:00.

- **Por qué:** el horario de atención del PRD es el del servicio; el traslado es después de la limpieza y el último trabajo del día no tiene nada detrás. Con el tope actual (paquete de 8 h, mudanza con apoyo de 4 h), todo cabe en la jornada (ADR 0008).
- **Es un supuesto, no un dato del PRD.** Alternativa descartada: exigir que el rango bloqueado también termine a las 18:00. Quita el último horario posible a cada servicio sin una razón de negocio. Se lista en las preguntas abiertas para que el negocio lo confirme.

### 7. Horas locales con `Intl`, sin biblioteca de fechas

`src/lib/agenda/horario.ts` convierte "fecha + hora" de la zona de `horario_atencion.zona` a un instante con `Intl.DateTimeFormat` (calcula el desfase de la zona en esa fecha y lo aplica, con una segunda pasada), y el día de la semana se calcula sobre la fecha civil (UTC), que no depende de la zona. Perú no tiene horario de verano, pero no se asume en el código.

- **Por qué:** evita una dependencia nueva para dos funciones; Node 24 trae los datos de zonas completos.
- **Descartada:** `date-fns-tz` o `Temporal`. Agregan una dependencia (o un API aún no estable) por poco código.

### 8. Pruebas contra Neon: equipos propios inactivos, usuario de prueba y limpieza

La `DATABASE_URL` de `.env.local` es la de producción (`CLAUDE.md`). Las pruebas contra Neon van en archivos `*.bd.test.ts`, con su propio `vitest.bd.config.ts`, fuera de `npm test` (el `vitest.config.ts` los excluye) y con una guarda extra: no corren sin `PRUEBAS_BD=1`. Cada corrida crea un prefijo único, un usuario `prueba-agenda-<uuid>@tiza.test`, 3 equipos `PRUEBA-agenda-<uuid>-N` con `activo = false`, y usa fechas en 2099. Al terminar (`afterAll`, aunque falle) borra, en este orden, sus reservas, su usuario y sus equipos, y una última consulta comprueba que no quedó nada con el prefijo.

- **Por qué equipos inactivos:** la consulta de disponibilidad real solo cuenta equipos activos, y las reservas reales se asignan a los activos, así que los datos de prueba nunca se cruzan con un cliente aunque una limpieza fallara. Las pruebas pasan sus ids explícitos a las funciones.
- **Descartada:** una transacción con `ROLLBACK` al final. Sirve para la restricción en una conexión, pero no para la concurrencia, que exige dos transacciones que confirmen. Se usa igual para las pruebas de una sola conexión (menos rastro).
- **Descartada:** una rama de Neon para pruebas. Es lo más limpio, pero hoy no hay ramas por entorno (`CLAUDE.md`) y crearla requiere la cuenta del usuario. Queda como **tarea opcional del usuario**: si existe una rama, bastaría una `DATABASE_URL_PRUEBAS` y el riesgo desaparece.
- **Descartada:** probar la restricción solo en el SQL de la migración leyendo el texto (como hace `migraciones.test.ts`). Eso se hace también (barato), pero no demuestra que Postgres rechace los solapes.
- **No se usa Better Auth** para el usuario de prueba: basta una fila en `usuarios` (`id`, `name`, `email`, `telefono`). No se crean sesiones, cuentas ni correos.

### 9. API de disponibilidad con sesión, un día por llamada

`GET /api/disponibilidad?fecha=AAAA-MM-DD&tipo=...&dormitorios=...&banos=...|horas=...` con `requerirSesion`, `manejar`, `conReintento` y `Cache-Control: private, no-store`. El motivo de un horario no disponible es `anticipacion` o `sin_cupo`.

- **Por qué la sesión:** el PRD reserva la elección de día y hora a quien paga una membresía, y una agenda pública permitiría ver la ocupación del negocio sin cuenta. El cliente nuevo se registra antes de llegar a ese paso (ítem #2). Es un supuesto.
- **Por qué un día:** el asistente pide los horarios del día elegido; el calendario mensual (qué días tienen cupo) lo decide la interfaz de #9.
- **Descartada:** ruta pública. Revela la ocupación sin necesidad.
- El `409` por choque no se devuelve aquí: la respuesta es informativa y la creación vuelve a validar (ADR 0006).

### 10. Los errores de la base se leen desde `cause`

`DrizzleQueryError` guarda el error de `pg` en `.cause`. La función que detecta `23P01` revisa `error.code` y `error.cause?.code`. Con una prueba que lo fija contra Neon real (para que un cambio de versión de Drizzle no rompa el `409` en silencio).

## Risks / Trade-offs

- **Las pruebas contra Neon apuntan a producción.** Aunque usan equipos inactivos, usuario `@tiza.test` y fechas de 2099, y se limpian en `afterAll`, un fallo del proceso (corte de red, `Ctrl+C`) podría dejar filas. Mitigación: prefijo único y fácil de buscar, una tarea final con la consulta de verificación y la de limpieza por prefijo, y ejecutarlas con la migración ya aplicada y fuera de horas de uso. Una rama de Neon lo eliminaría (tarea opcional).
- **La migración corre en producción.** Es aditiva (tabla y enums nuevos), pero no tiene "deshacer" en Drizzle. Mitigación: probar antes el SQL en una transacción con `ROLLBACK` en Neon (la restricción `EXCLUDE` con `tstzrange` en la expresión es lo que más conviene validar); si algo sale mal después, `DROP TABLE reservas` y los tres tipos, y Neon permite restaurar a un punto anterior.
- **Aplicar la migración antes de desplegar** (`CLAUDE.md`): el código nuevo no se usa en producción hasta el #9, y `GET /api/disponibilidad` solo lee. Un orden equivocado no rompe nada visible, pero se sigue el orden de todos modos.
- **La asignación al primer equipo libre puede rechazar un caso que cabría con otro reparto** (ADR 0007). Con 2 equipos y pocas reservas es poco probable; el administrador reasigna en #16.
- **La disponibilidad puede quedar desfasada:** entre que el cliente ve un horario y confirma, otro puede tomarlo. La restricción lo resuelve con `409` al crear (ADR 0006).
- **El tope por traslado y horario es un supuesto** (decisión 6) y la API exige sesión (decisión 9); ambos se confirman en las preguntas abiertas.
- **`drizzle-kit generate` no ve la restricción `EXCLUDE`.** Si alguien regenera el esquema desde cero la perdería; mitigación: una prueba lee el SQL de la migración y falla si falta, y las pruebas contra Neon fallarían si no existe.
- **El hueco del `REVISAR` de la persona de apoyo:** una reserva con apoyo solo bloquea la mitad del tiempo; si el administrador no consigue a la persona, el servicio no cabe (PRD y ADR 0008). El ítem #16 lo resuelve; aquí solo se guarda `requiere_apoyo`.
- **`conReintento` y los errores de Drizzle (observación, fuera de este ítem):** `esErrorDeConexion` (`src/lib/reintento.ts`) lee `error.code` y `error.message`, pero Drizzle envuelve el error original en `DrizzleQueryError` (mensaje "Failed query: ..."), así que un corte de conexión dentro de una consulta de Drizzle puede no reconocerse y no reintentarse. Se anota para el usuario; la lectura de este ítem desenvuelve `cause` al decidir si reintenta (tarea 6.3) sin modificar `reintento.ts`.
- **Sin límite de frecuencia:** una cuenta puede consultar la disponibilidad sin límite. Está en los pendientes de `BACKLOG.md`.

## Migration Plan

1. `npm run db:generate -- --name=reservas` produce la migración `0003_reservas` con la tabla, los enums, los `CHECK` y los índices; se le agrega a mano la restricción `EXCLUDE`.
2. Probar el SQL completo dentro de `BEGIN ... ROLLBACK` contra Neon (sin efecto).
3. `npm run db:migrate` (producción), antes de desplegar.
4. Correr las pruebas contra Neon (`PRUEBAS_BD=1`) y comprobar que no quedan filas.
5. `npx vercel deploy --prod` y `GET /api/salud`.
6. Marcha atrás: `DROP TABLE reservas; DROP TYPE estado_apoyo, estado_reserva, tipo_servicio;` y borrar la fila de `drizzle.__drizzle_migrations` (o restaurar con Neon).

## Open Questions

Ninguna bloquea la propuesta; son supuestos que conviene confirmar al revisarla:

1. ¿Debe terminar el **servicio** antes de las 18:00 (supuesto) o también el traslado? (decisión 6)
2. ¿La disponibilidad exige **sesión** (supuesto) o debe ser pública? (decisión 9)
3. ¿Se acepta adelantar al #6 la **inserción en el primer equipo libre** que `BACKLOG.md` asigna al #9? (decisión 4)
4. ¿Se puede crear una **rama de Neon para pruebas** (opcional, elimina el riesgo de probar contra producción)? (decisión 8)
5. Se acepta que el rango bloqueado se guarde como `inicio` y `fin_bloqueo` en vez de una columna `tstzrange` (decisión 1, matiz del ADR 0002 y 0007).

## Contrato para #9, #12 y #16 (tarea 5.3)

- Toda escritura de reservas va dentro de `transaccionDeEscritura(fn)` (`src/lib/agenda/expirar.ts`): marca primero las vencidas como `expirada` y luego ejecuta `fn(tx)`.
- Para crear una reserva, `fn` llama a `validarInicioServicio` (`src/lib/agenda/horario.ts`) y a `insertarEnPrimerEquipoLibre(tx, equipoIds, fila)` (`src/lib/agenda/asignar.ts`) con los ids de los equipos activos en orden. No se reimplementa el savepoint ni se elige el equipo con un `SELECT` previo.
- Para decidir si un conflicto es de capacidad se usa `esConflictoDeExclusion` (`src/lib/agenda/errores-bd.ts`), que mira `error.cause.code`.
- Toda lectura que filtre reservas por estado usa `reservaActiva` (`src/db/reservas-activas.ts`); #12 usa `excluirReservaId` de `leerOcupacion` al reprogramar.

## Resultado de la prueba de la migración (tarea 1.5)

El SQL completo de `0003_reservas` se ejecutó dentro de `BEGIN ... ROLLBACK` en la rama de Neon `pruebas` (no en producción): `btree_gist` ya estaba habilitada, la restricción `reservas_sin_solape_por_equipo` con `tstzrange("inicio", "fin_bloqueo", '[)')` en la expresión se creó sin error, una reserva que se solapa en el mismo equipo se rechazó con `23P01` y una que empieza justo al terminar el traslado se aceptó. Tras el `ROLLBACK` la tabla `reservas` no existía.
