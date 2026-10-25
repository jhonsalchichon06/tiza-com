## Context

Ver `proposal.md` para el motivo. Estado verificado leyendo `PRD.md`, `TECH-DESIGN.md`, los ADR 0008 y 0009, el código y los changes previos:

- **Construido (#1 a #9a, en local):** `membresias` (`pendiente`/`activa`, `inicio`, `fin`) con el índice único parcial `membresias_una_pendiente_por_cliente` **solo sobre `pendiente`** (`src/db/esquema.ts`), por lo que una `activa` vencida y una `pendiente` de renovación coexisten sin cambios de esquema. `pagos` con concepto `membresia` (ya válido sin reserva por `pagos_membresia_si_concepto`). `configuracion` con `membresia_precio_mensual` y `membresia_meses`; el monto provisional S/ 89 × 3 = S/ 267 lo calcula `crearPrimeraReserva` (`src/lib/reservas/crear.ts`). `comprobarEstadoDelCliente` responde `409` a quien ya tiene una membresía `activa` (por eso la renovación necesita ruta propia). `GET /api/disponibilidad` (`crearRutaDisponibilidad`) exige sesión y hoy no mira la membresía (su propio comentario lo deja a #9 y #13). `AVISO_DEMOSTRACION`, `CCI_TIZA`, `RUTA_QR_YAPE`, `formatearSoles`, `subirComprobante` y `verificarImagenSubida` ya existen.
- **Changes con propose y sin aplicar:** `revision-de-pagos-admin` (#11: aprobar con `inicio = now()` y `fin = now() + membresia_meses`, rechazar, `caducada`, `cerrarMembresiasSinReenvio`, `POST /api/pagos`, `pagosRechazadosReenviables`) y `perfil-reservas-y-membresia` (#12: `estadoDeMembresia`, el orden "activa vigente, luego pendiente, luego activa vencida", los avisos y la pantalla de reenvío). Este change depende de ellos.
- **Decisiones del usuario (2026-10-21, provisionales, pendientes de confirmar por el negocio), ya en `PRD.md` y `BACKLOG.md`:** la renovación es otro período de 3 meses por S/ 267 con el flujo del #11, sin limpieza gratis y solo con la membresía vencida; y se mantiene la regla de que el servicio empiece antes del `fin`, así que no hay reservas del mes 3 que resolver.
- **En paralelo (no se tocan sus archivos):** #13 (`reservar-como-miembro-activo`, con propose y sin aplicar), #14 (crédito) y #17. #13 valida la vigencia con su propia función pura `validarVigenciaDeMembresia(config, fin, inicio)` en `src/lib/reservas/vigencia.ts` (exige `inicio < fin`, `422` con mensaje que pide renovar) y elige la `activa` de `fin` más lejano; **no** llama a `comprobarVigenciaParaReservar`. Ver la decisión 5.
- **El esquema de #11 ya prevé este ítem:** su spec dice "Una membresía `activa` MAY coexistir con una `pendiente` de la renovación (ítem #15)" y `cerrarMembresiasSinReenvio` cierra cualquier `pendiente` sin distinguir si es primera o renovación.
- **Entorno:** migraciones solo a la rama de Neon `pruebas` (`DATABASE_URL_PRUEBAS`); `DATABASE_URL` de `.env.local` es producción y queda diferida hasta cerrar los 18 ítems. Sin Playwright.

## Goals / Non-Goals

**Goals:**

- Que el cliente sepa en su perfil que su membresía vence o venció y qué hacer.
- Que pueda pagar la renovación con el mismo flujo de la membresía y que el administrador la apruebe con la pantalla del #11.
- Que nadie elija día y hora sin membresía vigente en la fecha del servicio, con una sola regla compartida con #13.
- Que el monto y la duración de la renovación (decisiones provisionales del PRD) salgan de `configuracion` por un único punto, `planDeRenovacion`, para que cambiarlas sea editar datos.

**Non-Goals:**

- Cambiar el modelo de datos ni la aprobación del #11 por la renovación.
- Resolver reservas del mes 3 sin pago: con la regla actual no existen (decisión 9).
- Reservar como miembro, descuento y reserva con el mismo pago (#13); crédito en horas (#14); `completada`, apoyo (#16); fotos (#17); reseñas (#18).
- Notificar por correo, SMS o WhatsApp (PRD, "No alcance"); renovación o cobro automáticos; reembolsos.
- Renovar antes de que venza la membresía (decisión 6).
- Límites de frecuencia y de registros por IP (pendientes de `BACKLOG.md`).
- Modificar `PRD.md`, `TECH-DESIGN.md`, los ADR o `BACKLOG.md`: lo que haga falta cambiar ahí se propone en el reporte.
- Migrar o desplegar producción (diferido).

## Decisions

### 1. Un solo punto para el plan: `planDeRenovacion(config)` lee `configuracion`

`src/lib/membresia/plan.ts` exporta el tipo `PlanDeRenovacion = { meses: number; monto: number }` y la función `planDeRenovacion(config)`, que devuelve `{ meses: config.membresia_meses, monto: config.membresia_precio_mensual * config.membresia_meses }` (céntimos; 3 meses y S/ 267 con los valores actuales, el mismo cálculo de `crearPrimeraReserva`, `src/lib/reservas/crear.ts`). Todo el código de este change que necesita el monto o la duración (la ruta de pago, la pantalla) la recibe como dependencia inyectable con `planDeRenovacion` como valor por defecto; ninguno escribe `3`, `89` ni `267`. Una prueba con otra configuración (precio 100, 2 meses) y otra con un plan inyectado distinto (1 mes, S/ 89) demuestran que el plan sale de los datos.

- **Decisión del usuario (provisional, pendiente de confirmar por el negocio):** opción A, otro período de 3 meses por S/ 267, igual que la primera membresía. No hace falta clave, columna ni migración nueva por esta decisión; el `fin` que calcula el #11 con `membresia_meses` ya es el correcto.
- **Por qué un punto único:** si el negocio cambia la respuesta, se edita `configuracion` o una función, no seis archivos.
- **Descartada (opción B, mes a mes por S/ 89):** exige clave `membresia_renovacion_meses`, probablemente una columna `membresias.meses`, cambiar el `fin` del #11 y acortar la ventana de aviso. El usuario no la eligió.
- **Descartada (opción C, a elección de 1 o 3 meses):** lo de B más dos tarjetas y validar la opción en el servidor.
- **Descartada:** escribir `3` y `267` como constantes en la ruta. Contradice "los precios son datos" (`TECH-DESIGN.md`) y la naturaleza provisional del monto.

### 2. El estado de renovación se deriva al leer, con el reloj de la base (ADR 0008)

`src/lib/membresia/renovacion.ts` define `estadoDeRenovacion` (función pura) que recibe las membresías del cliente con `vigente` (calculado en SQL como `fin > now()`), el último pago de la pendiente, `pagosRechazadosReenviables` (#11) y `renovacion_aviso_dias`. No se agrega ningún estado a la tabla ("vencida" no se guarda, ADR 0008; `caducada` ya lo agrega #11). `por_vencer` y los `dias_restantes` salen de `fin - now()` también en SQL, redondeados hacia arriba, igual que el `dias_restantes` del #12.

- **Reutiliza** la definición única "puede subir otro comprobante" del #11 para `renovacion_rechazada`; así el plazo vencido vuelve a `vencida` aunque el cierre no haya corrido.
- **Ajuste al #12:** `estadoDeMembresia` del #12 elige "la `activa` vigente; si no hay, la `pendiente`; si no, la `activa` vencida". Con una renovación pendiente elegiría la `pendiente` y mostraría el texto de la primera membresía ("Tu pago está en revisión..."). Este change agrega el campo `esRenovacion` (la pendiente tiene otra membresía `activa` del mismo cliente) y deriva el bloque `renovacion` aparte; el estado de #12 no cambia de valores. La tarea 1.2 verifica en el código del #12 si ya lo contempla.
- **Descartada:** columna `es_renovacion` o `renueva_a` en `membresias`. Se desincroniza y es derivable. Tampoco hace falta una columna `meses`: todas las membresías duran `membresia_meses`.
- **Descartada:** calcular el vencimiento con `new Date()` del servidor. Desfasa respecto de `fin` y de las demás lecturas.

### 3. Renovar = membresía nueva `pendiente` + pago `membresia`, sin reserva

`POST /api/membresia/renovar` (ruta propia, `src/lib/membresia/renovar.ts`) dentro de `transaccionDeEscritura`: cierre previo de membresías sin reenvío (#11) → bloquear las membresías del cliente → exigir que la `activa` más reciente esté vencida (`409 renovacion_no_aplica` si no) → exigir que no haya una `pendiente` (`409 en_espera`, o `409 pago_rechazado` con la fecha límite si su pago rechazado sigue dentro del plazo) → `insert(membresias)` `pendiente` con el monto del plan → `insert(pagos)` concepto `membresia`, método y comprobante. `verificarImagenSubida` se llama antes de abrir la transacción y se guarda solo la ruta que devuelve (ADR 0010, igual que `crearPrimeraReserva`). La unicidad la garantiza el índice existente `membresias_una_pendiente_por_cliente`: dos envíos simultáneos dan `23505`, que se traduce a `409 en_espera` con `traducirUnicidad`.

- **Por qué una fila de membresía nueva:** el modelo es "membresía = un período pagado" (ADR 0008: `inicio` y `fin` desde la aprobación; pendiente sin fechas). Cada período conserva su monto, su pago y su historia, y `reservas.membresia_id` de las limpiezas pasadas sigue apuntando al período que las autorizó.
- **Descartada:** extender el `fin` de la membresía existente con un `UPDATE`. Pierde el monto y el pago de cada período, rompe `membresias_estado_y_fechas` (una `activa` con un pago pendiente no es un estado representable) y no deja que el administrador apruebe o rechace con el flujo del #11.
- **Descartada:** reutilizar `POST /api/reservas`. Exige una reserva (el ADR 0009 dice "una reserva solo se crea junto con su comprobante") y la renovación no tiene reserva; además `comprobarEstadoDelCliente` rechaza a los miembros.
- **Pago sin reserva:** `pagos_membresia_si_concepto` ya lo permite. El pago `membresia` sin reserva no ocupa ningún horario, no tiene `expira_en` ni plazo de 24 horas; el administrador puede tardar sin que expire nada. Si no responde, el cliente espera con la renovación `renovacion_en_revision`; es el riesgo "Carga del administrador" del PRD.
- **No da limpieza gratis (ADR 0008):** la ruta no llama a `decidirLimpiezaGratis`, no crea reserva y su pago cubre solo la membresía. Hay una prueba de que el resultado de `decidirLimpiezaGratis` no cambia antes y después de renovar.
- **Idempotencia:** si la conexión se corta durante el `COMMIT` y `conReintento` repite, el segundo intento ve la membresía `pendiente` y responde `409 en_espera`, que es verdad y no duplica nada (mismo razonamiento que #9a).

### 4. Qué ya cubre el #11 para la renovación y qué hay que comprobar

- **Aprobar:** el `UPDATE membresias ... estado='activa'` del #11 funciona para la renovación (la `pendiente` pasa a `activa` con `inicio = now()`). El **`fin`** que calcula con `membresia_meses` es justo el de la renovación de 3 meses: este change no toca el código del #11, solo lo prueba (tarea 7.2).
- **Rechazar, reenviar y cerrar:** `POST /api/pagos` copia concepto, membresía y monto del pago rechazado y "mueve la reserva viva, si la hay"; sin reserva no hay nada que mover. `cerrarMembresiasSinReenvio` pasa la renovación a `caducada` y el cliente vuelve a `vencida`. Las tareas 5.5 y 6.x lo prueban contra la rama.
- **Lista del administrador:** el #11 describe la lista con "estado de la reserva" y prevé una reserva `null`. La tarea 5.6 comprueba que un pago de renovación sin reserva se vea bien (sin coincidencias de dirección, que dependen de una reserva `primera_gratis`) y corrige solo eso si falla.
- **Aprobación de un pago de renovación con `caducada`:** imposible, porque el cierre exige que no haya un pago `pendiente` (decisión 4 del #11).
- **Descartada:** una pantalla de administración nueva para renovaciones. El flujo de aprobación es el mismo.

### 5. Una sola comparación de vigencia; el guard clasifica y la reutiliza

`src/lib/membresia/vigencia-miembro.ts`. `comprobarVigenciaParaReservar` lee con el reloj de la base: la membresía `activa` con `fin` más tardío (`vigente = fin > now()`), y si existe una `pendiente` con el estado de su último pago. Devuelve `ok`, `sin_membresia`, `membresia_vencida`, `renovacion_en_revision` o `fuera_de_vigencia`, y una función hermana `aErrorApi(resultado, zona)` los traduce a `ErrorApi` con los códigos de la spec. La comparación `inicioServicio < fin` (un servicio que empieza justo en `fin` no es vigente, ADR 0008) **no se escribe aquí**: se reutiliza la de #13.

- **Verificado en el change de #13 (`reservar-como-miembro-activo`):** #13 **no** llama a `comprobarVigenciaParaReservar`. Escribe `validarVigenciaDeMembresia(config, fin, inicio)` (pura, `src/lib/reservas/vigencia.ts`), que exige `inicio < fin` y lanza `422` ("Tu membresía llega hasta el {fecha}. Elige una fecha anterior o renueva tu membresía..."), y la usa dentro de su transacción con el `fin` de la `activa` más lejana. Para quien tiene la membresía vencida, `POST /api/reservas` de #13 también da `422` (el `inicio` mínimo, 48 h adelante, ya es posterior al `fin`), y su asistente decide la vista `membresia_vencida` con `decidirVista`. Es decir, la afirmación "#13 reutiliza `comprobarVigenciaParaReservar`" no se cumple como estaba escrita; este change se ajusta a lo que #13 hace.
- **Reparto:** `validarVigenciaDeMembresia` (#13) es la **única** comparación `inicio < fin`; `comprobarVigenciaParaReservar` (este change) la reutiliza para `fuera_de_vigencia` y solo añade lo que #13 no tiene: clasificar `membresia_vencida`/`renovacion_en_revision` (409) para `GET /api/disponibilidad` y el perfil. No se duplica la vigencia. La reserva de miembro (#13) sigue con su `422` propio (no pasa por el guard), por lo que no hay un segundo uso del guard en `POST /api/reservas`.
- **Si #13 aún no está aplicado** al llegar a la tarea 4.1: la comparación se toma de `validarVigenciaDeMembresia` si existe; si no, se extrae un predicado puro `servicioDentroDeVigencia(fin, inicio)` en `src/lib/reservas/vigencia.ts` y se avisa para que #13 lo importe. No se aplican dos comparaciones.
- **Dónde se usa en este change:** `GET /api/disponibilidad` (cableado en `crearRutaDisponibilidad` mediante una dependencia inyectable `vigencia`, solo para quien tiene una membresía `activa`) y el perfil (para ofrecer o no "elegir día y hora").
- **Granularidad de la disponibilidad:** la consulta recibe un día (`fecha`), no una hora. Se rechaza el día completo si su primera hora de atención cae en o después del `fin`; un día que contiene el `fin` en mitad del horario muestra todos sus horarios y la reserva (#13) rechaza el que lo supere con el mismo guard. Es una desviación consciente: filtrar horarios por `fin` dentro de `calcularDisponibilidad` toca el código del #6 y se solapa con #13. Queda anotado en Riesgos.
- **Reprogramar (#12)** ya valida `nuevoInicio < fin` con sus propias consultas; este change no lo modifica (la tarea 4.6 anota si conviene unificarlo con el guard al aplicar).
- **Descartada:** repetir la comparación `inicio < fin` en cada ruta (#12, #13, disponibilidad). Garantiza que tarde o temprano dos reglas diverjan.
- **Descartada:** `403` para el vencido. No es un problema de permisos de rol sino del estado de su membresía; `409`/`422` con código estable permiten a la interfaz mostrar "Renovar".

### 6. Solo se renueva con la membresía vencida

El PRD dice que "al llegar al mes 4 el perfil avisa que hay que pagar de nuevo". El aviso `por_vencer` anticipa, pero el pago solo se ofrece cuando `fin <= now()`. Pagar antes obliga a decidir desde cuándo corre el nuevo período (¿desde la aprobación, perdiendo los días que quedan, o desde el `fin` anterior?). El usuario decidió (provisional) que solo se renueva cuando la membresía ya venció, con el período corriendo desde la aprobación como la primera membresía.

- **Efecto conocido:** hasta que venza, el cliente no puede agendar nada posterior al `fin`; tras vencer debe pagar, esperar la aprobación y recién elegir. Es literal con el PRD ("una vez aprobado el pago, el cliente elige día y hora desde el perfil") y con `TECH-DESIGN.md` ("durante el mes 3 no puede agendar para una fecha posterior al fin").
- **Descartada:** permitir pagar durante el aviso con `inicio = now()`. Cobra dos veces los días restantes sin que el usuario lo haya decidido.

### 7. Aviso "por vencer": ventana como dato provisional

Clave nueva `renovacion_aviso_dias` en `configuracion`: entero positivo, valor **14**, `provisional = true` (el PRD no fija cuántos días antes avisar; es una propuesta de este change, igual que el monto provisional). Esquema zod en `src/lib/configuracion.ts`, valor en `VALORES_DEL_DISENO`, migración de **solo datos** con `npm run db:generate -- --custom --name=renovacion-aviso-dias` y `INSERT ... ON CONFLICT ("clave") DO NOTHING`, como las migraciones de #11 y #12. Se genera al aplicarse, después de las de #10, #11 y #12 si ya existen. La prueba "define exactamente las N claves" se ajusta al número real. La migración va **antes** del despliegue (diferido), porque `leerConfiguracion` falla si falta una clave.

- **Por qué un dato:** `TECH-DESIGN.md`: "Precios, duraciones, montos y plazos son datos".
- **Se mantiene en 14 días:** con renovación de 3 meses no hay que acortarla. Pregunta abierta 1: confirmar los 14 días o preferir otra ventana.
- **Descartada:** hardcodear 14 o 7 en el código.
- **Descartada:** no tener aviso anticipado. El PRD lo califica de riesgo ("el cliente puede no ver la notificación") y el encargo lo pide; sin él, el primer aviso llegaría cuando ya no puede reservar.

### 8. Pantalla `/cuenta/renovar` y avisos en `/cuenta`

Componente de servidor que llama a `estadoDeRenovacion` y `planDeRenovacion` directamente (sin pasar por HTTP) y redirige a `/cuenta` si el estado no es `vencida`. Componente de cliente `FormularioRenovacion` que reutiliza `subirComprobante`/`subirImagen` (validan tipo y 5 MB, comprimen y suben a la tienda privada), `datos-de-pago.ts`, `AVISO_DEMOSTRACION` y llama a `POST /api/membresia/renovar`. Estilos con módulo CSS propio, letra de 18 px o más, botones de 48 px o más. El monto sale del servidor (`formatearSoles`). Se prueba con `renderToStaticMarkup` y dobles; la subida real necesita `BLOB_READ_WRITE_TOKEN` (tarea del usuario).

- **Descartada:** reutilizar el asistente `/reservar`. Está armado para un cliente nuevo con servicio, dirección y fecha.
- **Descartada:** Server Actions. El contrato HTTP del ADR 0003 se prueba con `curl` y Vitest.


### 9. Reservas del mes 3 sin pago del mes 4: no hay nada que resolver (decisión (3))

Decisión del usuario (2026-10-21, provisional, pendiente de confirmar por el negocio): se mantiene la regla actual de `TECH-DESIGN.md` y del ADR 0008, según la cual el servicio debe empezar antes del `fin` de la membresía (también al reprogramar en #12 y al reservar en #13). Por tanto toda reserva tiene `inicio < fin`, **no puede existir** una reserva agendada para después del `fin` y no hay reservas del mes 3 que cancelar, mover ni honrar. Sin pago de renovación solo se bloquea elegir día y hora para reservas nuevas (decisión 5). Este change no cancela, expira ni mueve ninguna reserva por el vencimiento, ninguna tarea escribe en `reservas` y hay una prueba que lo demuestra.

- **Descartada (opción B, agendar el mes 4 durante el mes 3 y cancelar si no llega el pago):** exige `cancelada_por = 'sistema'`, un marcador de "reserva condicionada", una pasada que cancele, avisos y decidir el crédito (#14, ADR 0012); y relajar `fuera_de_vigencia`, el ADR 0008 y el criterio de `TECH-DESIGN.md`.
- **Descartada (opción C, honrar las reservas sin pago):** el servicio se presta sin membresía vigente; contradice el caso borde 6 del PRD y el ADR 0008.
- **Descartada (opción D, B con un plazo de N días antes de cada servicio):** variante de B con las mismas necesidades más un plazo configurable.

### 10. Pruebas

Unitarias con Vitest junto al código (`planDeRenovacion` con la configuración real y con otra distinta, `estadoDeRenovacion` con todos los casos y límites, textos, `comprobarVigenciaParaReservar` con dobles, traducción de errores, la ruta de renovar con dobles y un plan inyectado distinto, el esquema de la clave nueva, los componentes con `renderToStaticMarkup`). Contra la rama `pruebas` (`PRUEBAS_BD=1 npx vitest run --config vitest.bd.config.ts`, con cuentas `@tiza.test` y limpieza al final): el guard con el reloj de la base, la coexistencia `activa` + `pendiente`, dos renovaciones simultáneas, la renovación cerrada por `caducada`, el `fin` de 3 meses al aprobar, la no repetición de la limpieza gratis y el aislamiento entre clientes. Sin Playwright.

## Decisiones tomadas por el usuario (provisionales)

Ambas siguen **pendientes de confirmar por el negocio** (comentarios `<!-- REVISAR -->` del `PRD.md`, ya actualizados). Si el negocio las cambia, hay que revisar este change.

1. **Duración de la renovación (opción A):** otro período de 3 meses, en un solo pago de S/ 267 (`membresia_precio_mensual` × `membresia_meses`), con el mismo flujo de pago y aprobación del #11; no da otra limpieza gratis; solo con la membresía ya vencida. Las opciones B (mes a mes por S/ 89) y C (a elección) quedan descartadas en la decisión 1; renovar antes de vencer, en la decisión 6.
2. **Reservas del mes 3 sin pago (opción A):** se mantiene "el servicio empieza antes del `fin`"; las opciones B, C y D quedan descartadas en la decisión 9.

## Open Questions

Ninguna bloquea la aplicación. Quedan dos menores:

### Pregunta 1: ¿se confirma la ventana de aviso "por vencer" de 14 días?

Propuesta de este change (decisión 7, `renovacion_aviso_dias`, `provisional`). Con la renovación de 3 meses no hace falta acortarla. No cambia las specs si se ajusta.

### Pregunta 2: ¿textos del aviso?

Los textos de `aviso-de-renovacion` son propuestas ("Realiza un nuevo pago para que tu servicio del mes 4 sea válido" sigue la frase del PRD). No cambian las specs si se ajustan.

## Cambios que se proponen fuera de este change

- Cuando el negocio confirme las decisiones, quitar los dos `<!-- REVISAR -->` correspondientes del `PRD.md`. Si cambia la duración o la regla de reservas, actualizar también `TECH-DESIGN.md` (modelo y criterios de "Renovación") y el ADR 0008, y revisar este change.
- Registrar en `BACKLOG.md`, al terminar el ítem, que `comprobarVigenciaParaReservar` reutiliza `validarVigenciaDeMembresia` de #13 como única comparación `inicio < fin`.
- Si #13 se aplica antes y sus tareas lo permiten, evaluar que su `POST /api/reservas` use `comprobarVigenciaParaReservar` para dar `409 membresia_vencida` en lugar de `422`; hoy se deja con su `422` propio.

## Cobertura de los criterios de `TECH-DESIGN.md`

| Criterio | Escenario en | Tarea |
|---|---|---|
| (Renovación) Cuando la membresía cumple 3 meses, el perfil muestra el aviso de nuevo pago | `aviso-de-renovacion` (Membresía vencida, Membresía por vencer) | 3.1 a 3.5, 6.2 |
| (Renovación) Vencida y sin pago aprobado, no puede elegir día y hora | `bloqueo-por-vigencia` (Membresía vencida sin pago; Renovación en revisión; El perfil ofrece reservar solo con vigencia) | 4.1 a 4.5, 6.3 |
| (Renovación) Durante el mes 3 no puede agendar para una fecha posterior al `fin` | `bloqueo-por-vigencia` (Servicio posterior al fin; Durante el mes 3, fecha posterior al fin) | 4.1, 4.3, 6.3 |
| (Renovación) Aprobado el nuevo pago, el cliente puede elegir día y hora desde su perfil | `bloqueo-por-vigencia` (Aprobada la renovación), `pago-de-renovacion` (Aprobación) | 5.5, 6.4; la reserva en sí es del #13 |
| (Reservar y pagar una limpieza) Fecha posterior al `fin` se rechaza con `422` y mensaje que pide renovar | `bloqueo-por-vigencia` (Fecha posterior al fin pide renovar) | 4.2; la ruta de reserva es del #13 |
| (Crédito) Con la membresía vencida, el saldo se ve pero no se reserva hasta renovar | `bloqueo-por-vigencia` (Crédito en horas no levanta el bloqueo) | 4.4; el saldo es del #14 |
| (Portal) Aprobar membresía activa con 3 meses desde la aprobación | `pago-de-renovacion` (Aprobación) | 5.5, 7.2 |
| (Comprobantes) Comprobante solo para su dueño y el administrador | `pago-de-renovacion` (Comprobante ajeno) | 5.5, 6.4 |
| (Errores) Neon dormido: un reintento y "inténtalo en unos segundos" | Cubierto por `conReintento` en la ruta y el perfil | 5.2, 3.5 |
| (PRD, caso borde 6) Mes 4 sin pago: no puede reservar nuevas limpiezas | `bloqueo-por-vigencia` | 4.x, 6.3 |
| (PRD, REVISAR) Reservas del mes 3 sin pago del mes 4: no hay reservas posteriores al `fin` | `bloqueo-por-vigencia` (Reservas ya agendadas no se tocan) | 6.5, 8.1 |
| (PRD, REVISAR) Duración de la renovación: 3 meses por S/ 267 | `pago-de-renovacion` (El plan de renovación sale de la configuración; Aprobación) | 5.1, 7.1 a 7.3 |

## Risks / Trade-offs

- **[Decisiones provisionales]** → la duración (3 meses por S/ 267) y la regla de reservas están pendientes de confirmar por el negocio. Mitigación: el plan sale de `configuracion` por un único punto y no hay columnas nuevas; cambiarlas es editar datos o una función.
- **[El aviso solo está en el perfil]** → riesgo conocido del PRD ("Renovación manual en el mes 4"): sin correo ni WhatsApp automáticos, el cliente puede no entrarse. Fuera de alcance.
- **[Día parcial en la disponibilidad]** → la consulta por día deja ver horarios de un día que contiene el `fin` y la reserva (#13) los rechaza con `validarVigenciaDeMembresia`; el cliente puede ver un horario libre que no podrá tomar. Se muestra el aviso "Tu membresía vence el ..." en esa pantalla.
- **[Solapamiento con #13]** → #13 tiene su propia `validarVigenciaDeMembresia`. Mitigación: este change la reutiliza y no repite la comparación (decisión 5, tarea 1.2). Si #13 cambia su firma, el guard se ajusta.
- **[Vencida y 422 distinto en #13]** → `POST /api/reservas` de #13 responde `422` a un vencido, mientras `GET /api/disponibilidad` responde `409 membresia_vencida`. Ambos mensajes piden renovar; se deja así (ver "Cambios que se proponen").
- **[Solapamiento con #12 y #11]** → este change modifica el cálculo del perfil del #12 y comprueba la lista del #11; ambos sin aplicar. La tarea 1.1 detiene la aplicación si no están.
- **[Sin tope de renovaciones fallidas]** → igual que el reenvío del #11, un cliente puede encadenar comprobantes falsos y cada uno cuesta una revisión del administrador (PRD, riesgo "Comprobantes falsos"). No se añade un límite.
- **[Carga del administrador]** → una renovación por cliente cada 3 meses suma comprobantes por revisar.
- **[Datos reales de pago con aviso de demostración]** → la pantalla muestra el aviso junto al QR y la CCI, como `/reservar`.
- **[Reprogramaciones y renovación pendiente]** → un cliente con la membresía vencida no puede reprogramar a una fecha posterior al `fin` porque el #12 lo rechaza; es consecuencia de la regla y se explica en el mensaje de `fuera_de_vigencia`.
- **[Días sin servicio al renovar tarde]** → el período nuevo corre desde la aprobación, no desde el `fin` anterior; entre el vencimiento y la aprobación el cliente no puede elegir día y hora (caso borde 6 del PRD).

## Migration Plan

1. Al arrancar, comprobar (tarea 1.1) que #11 y #12 están aplicados en el código y en la rama `pruebas`. Si falta alguno, pausar y reportar.
2. Cambiar `src/lib/configuracion.ts` y el fixture; generar la migración de solo datos con `npm run db:generate -- --custom --name=renovacion-aviso-dias` y escribir a mano el `INSERT ... ON CONFLICT DO NOTHING`.
3. Aplicar **solo a la rama `pruebas`** con `node -e "require('dotenv').config({path:'.env.local',quiet:true});process.env.DATABASE_URL=process.env.DATABASE_URL_PRUEBAS;require('child_process').execSync('npx drizzle-kit migrate',{stdio:'inherit'})"`; correr `PRUEBAS_BD=1 npx vitest run --config vitest.bd.config.ts`.
4. Servidor de desarrollo contra la rama (nunca `npm run dev` a secas, porque `DATABASE_URL` de `.env.local` es producción): `node -e "require('dotenv').config({path:'.env.local',quiet:true});process.env.DATABASE_URL=process.env.DATABASE_URL_PRUEBAS;require('child_process').spawn('npx',['next','dev'],{stdio:'inherit',shell:true})"`.
5. **Producción (diferida hasta cerrar los 18 ítems):** `npm run db:migrate` **antes** de desplegar, `npx vercel deploy --prod`, `GET /api/salud` = `200 {"estado":"ok"}`, prueba de humo con una cuenta `@tiza.test` y su limpieza.
6. Marcha atrás: redesplegar el commit anterior; la clave de configuración no estorba al código viejo.
