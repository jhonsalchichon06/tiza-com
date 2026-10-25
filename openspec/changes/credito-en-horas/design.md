## Context

Ver `proposal.md` para el motivo. Estado verificado en el código y en los changes previos:

- **Código construido (#1 a #10 en local):** `expirarVencidas(tx)` devuelve los ids de las reservas que marca `expirada` y su comentario deja el punto de extensión (`src/lib/agenda/expirar.ts`); `transaccionDeEscritura` la llama al empezar cada escritura. `calcularServicio` ya recibe `creditoHoras` y aplica primero las horas gratis y después el crédito, con `credito_aplicado` y `horas_cobrar` en el resultado (`src/lib/precios.ts`). `reservas` ya guarda `credito_aplicado` (`numeric(4,1)`), `horas_gratis_aplicadas` y `horas_trabajo`. `pagos.metodo` ya tiene el valor `credito` y los `CHECK` `pagos_comprobante_si_no_credito` y `pagos_credito_sin_monto`. La clave `credito_vence_meses` (3) ya está en `configuracion` y en `leerConfiguracion` (migración `0001`). Las tablas `creditos_horas` y `usos_credito` **no existen**; `reservas.cancelada_en` tampoco.
- **#11 (`revision-de-pagos-admin`, con propose):** agrega `reservas.cancelada_por` (`cliente` o `admin`), `aprobarPago`, `rechazarPago`, `cancelarReservaComoAdmin` (solo reservas `pendiente`), `ejecutarPasadaDeExpiracion` y `pagosConHorarioPendiente`. Sus comentarios dejan a #14: "crédito al aprobar" y "devolver las horas cuando se rechaza". `aprobar` bloquea primero el pago y después actualiza la reserva solo si sigue `pendiente`.
- **#12 (`perfil-reservas-y-membresia`, con propose):** `cancelarReservaDelCliente` bloquea la reserva del dueño (`FOR UPDATE`), la deja `cancelada` con `cancelada_por = 'cliente'` y es idempotente; solo informa el crédito (`mensajeDeCredito`, `horas_pagadas`) y tiene una prueba que exige que **no** escriba `creditos_horas` ni `usos_credito`. Su decisión 11 filtra los pagos de reservas canceladas por el cliente de "Elige un nuevo día y hora" y pide a #14 recuperar cancelaciones anteriores.
- **#13 (`reservar-como-miembro-activo`, con propose, otro spec-writer en paralelo y todavía sin `design.md` ni `tasks.md`):** reserva de miembro con `creditoParaReserva` (devuelve 0, punto de extensión), `crearPagoInterno` (`src/lib/reservas/pago-interno.ts`: concepto `reserva`, `membresia_id` vacío, método `credito`, monto 0, `aprobado`), reserva `confirmada` sin comprobante cuando el monto es 0, `comprobante` opcional, cotización de miembro, nuevo horario tras una aprobación tardía (copia `credito_aplicado` de la original) y el rechazo `409 pago_en_credito` para pagos de reservas canceladas por el cliente. Los nombres exactos de sus archivos se confirman en la tarea 1.1; este change no los redefine, los completa.
- **#16 (`gestion-de-reservas-y-apoyo`, con propose):** "completada" no cambia pago ni membresía; los usos ya están `consumido` desde que la reserva se confirma (decisión 5), así que no necesita cambios.
- **Entorno:** migraciones solo a la rama `pruebas`; `DATABASE_URL` de `.env.local` es producción y queda diferida hasta cerrar los 18 ítems. Sin Playwright. Drizzle 0.45 tiene `select(...).for("update")` (lo usan #11 y #12).

## Goals / Non-Goals

**Goals:**

- Que lo pagado en una limpieza cancelada a tiempo se convierta en horas que el cliente puede usar, sin reembolsos y sin poder alargar su vencimiento (ADR 0012).
- Que cada cambio de estado de una reserva deje lotes y usos coherentes, probado combinación por combinación (TECH-DESIGN, "Riesgos técnicos abiertos").
- Que una reserva cubierta por el crédito se confirme sin trabajo del administrador, y que el resto se pague con el flujo de siempre.
- Que cliente y administrador vean el saldo y de dónde salió.

**Non-Goals:**

- Crear, editar o mover créditos a mano (ADR 0012: v1 solo lectura para el administrador).
- Qué pasa cuando cancela Tiza (sin persona de apoyo): el PRD (REVISAR de 2026-10-21) decidió reprogramar y conservar el pago, sin crédito. Este change no genera crédito para `cancelada_por = 'admin'`.
- El bloqueo de reservas por membresía vencida y la renovación del mes 4 (#15): aquí solo se muestra el saldo con un aviso.
- Reembolsos en dinero, notificaciones por correo, SMS o WhatsApp automático y vencimientos por tarea programada (PRD, "No alcance"; ADR 0012).
- Modificar `PRD.md`, `TECH-DESIGN.md`, los ADR o `BACKLOG.md`: lo que haga falta cambiar ahí se propone en las preguntas abiertas.
- Migrar o desplegar producción (diferido).

## Decisions

### 1. Lotes y usos como el ADR 0012, más `reservas.cancelada_en`

`creditos_horas` (un lote por cancelación, `reserva_origen_id` único) y `usos_credito` (un uso por lote y reserva de destino, estados `reservado`, `consumido`, `devuelto`), con `numeric(4,1)` como `horas_trabajo` y `CHECK` de múltiplos de 0,5, horas positivas y `horas_disponibles` entre 0 e iniciales. El saldo es `SUM(horas_disponibles) WHERE vence_en > now()`; no se guarda un saldo (ADR 0012, "El saldo visible es la suma…"). **Invariante:** para cada lote, `horas_disponibles` más las horas de sus usos `reservado` y `consumido` es igual a `horas_iniciales`; las pruebas lo verifican (tareas 3.8 y 7.6).

`reservas.cancelada_en` (nulable, `CHECK cancelada_en IS NULL OR estado = 'cancelada'`) lo guardan las dos cancelaciones (cliente y administrador). **Por qué:** el PRD y el ADR 0012 hacen vencer el crédito "a los 3 meses de la cancelación", pero el lote puede nacer después (aprobación posterior) o recuperarse de una cancelación anterior; `actualizada_en` no sirve porque cualquier escritura posterior lo mueve.

- **Descartada:** vencer desde la creación del lote. Alargaría el crédito de quien cancela antes de la aprobación y no cumple el texto del PRD.
- **Descartada:** `actualizada_en` como fecha de cancelación. Es frágil; una columna explícita cuesta una migración trivial.
- **Descartada:** guardar un saldo por cliente (ADR 0012, alternativa ya descartada: se desalinea).
- **Verificado:** la clave `credito_vence_meses` existe en `configuracion`, en el esquema zod y en el fixture; no hace falta clave nueva.

### 2. Una sola función idempotente genera el lote, con dos puntos de llamada

`generarCreditoDeCancelacion(tx, reservaId, meses)` es un `INSERT ... SELECT ... ON CONFLICT (reserva_origen_id) DO NOTHING` con la condición completa en SQL: reserva `cancelada`, `cancelada_por = 'cliente'`, pago `aprobado` y horas pagadas (`horas_trabajo − horas_gratis_aplicadas − credito_aplicado`) mayores que 0. La llaman la cancelación del cliente (si el pago ya estaba aprobado) y la aprobación del pago (si la reserva ya estaba cancelada por el cliente): "sin importar cuál de las dos cosas pasa primero" (ADR 0012). La misma sentencia, sin el filtro por id, es el relleno de la migración.

- **Carrera entre cancelar y aprobar:** ambas corren en `READ COMMITTED`. Si la cancelación lee el pago `pendiente` antes de que el administrador confirme, la aprobación va a bloquearse en la fila de la reserva (que la cancelación ya bloqueó con `FOR UPDATE`), y cuando la cancelación confirma, la sentencia siguiente de la aprobación ve la reserva `cancelada` y genera el lote. Si la aprobación confirma primero, la cancelación (que espera el bloqueo de la reserva) lee después el pago `aprobado` y lo genera. El índice único cubre cualquier doble ejecución. Por eso la cancelación **no** bloquea el pago (`FOR SHARE`): invertiría el orden de bloqueo de `aprobar` (pago y luego reserva) y abriría un interbloqueo. La tarea 7.3 lo prueba en los dos órdenes.
- **Horas del lote:** las horas pagadas en dinero. Las 3 horas gratis de una primera limpieza no pasan a crédito porque se reusan en la siguiente reserva (ADR 0008, "Reuso tras cancelar"); la cuota de membresía tampoco se acredita (solo cuenta `horas_trabajo`).
- **Descartada:** generar el lote desde una vista o al leer el saldo. Mezcla lectura y escritura (ADR 0009 separa ambas).
- **Descartada:** un trigger en la base. Esconde reglas de negocio y no se prueba con Vitest sobre dobles.

### 3. Aplicar el crédito al reservar: bloquear, repartir, descontar, todo en la transacción de #13

Dentro de la transacción de la reserva de miembro, después de las comprobaciones de espera y de vigencia de la membresía (ADR 0008: sin membresía vigente no hay reserva, ni uso de crédito) y antes de calcular: `SELECT ... FROM creditos_horas WHERE usuario_id = $1 AND vence_en > now() AND horas_disponibles > 0 ORDER BY id FOR UPDATE`. Se ordena en memoria por (`vence_en`, `id`) con la función pura `repartirCredito`, se pasa la suma como `creditoHoras` a `calcularServicio` (que aplica primero las horas gratis, ADR 0012) y, con la reserva ya insertada (el uso necesita su id), `tomarCredito` descuenta con `UPDATE ... WHERE horas_disponibles >= $h` e inserta los usos. La sentencia que no afecta filas lanza un error de invariante y deshace todo. `creditoParaReserva` de #13 se reemplaza por esta lectura; el cálculo no cambia.

- **Por qué bloquear los lotes por `id` y ordenar en memoria:** `FOR UPDATE` con `ORDER BY` de otra columna puede bloquear en un orden distinto al ordenado; bloqueando siempre por `id` el orden es el mismo en todas las rutas (decisión 6).
- **Estados del uso:** `consumido` si la reserva nace `confirmada` (cubierta o nuevo horario), `reservado` si nace `pendiente`.
- **`horas_cobrar = 0`:** la reserva es `confirmada`, el pago lo crea `crearPagoInterno` de #13 (mismo módulo que usa el reuso de las horas gratis con monto 0) y un comprobante enviado de más se ignora. Con resto por pagar, el comprobante es obligatorio y su ausencia es `422`, comprobada **dentro** de la transacción porque el crédito solo se conoce ahí (el esquema de entrada ya lo hace opcional en #13; `verificarImagenSubida` corre antes solo si viene).
- **Cotización:** la lectura del saldo para cotizar no bloquea. Si entre la cotización y la confirmación el crédito cambia (venció, se usó en otra reserva), prevalece el cálculo del servidor; el cliente puede haber subido un comprobante por otro monto. Es la misma divergencia que ya aceptó #9a para las horas gratis (ver Riesgos); el administrador ve el monto al aprobar.
- **Descartada:** que el cliente elija cuánto crédito usar. El ADR 0012 lo hace automático y simple para el público de 30 a 70 años.
- **Descartada:** calcular el crédito fuera de la transacción. Dos reservas simultáneas usarían las mismas horas.
- **Descartada:** restar de `horas_disponibles` sin guardar el uso. Perdería el detalle "dónde salió y en qué se usó" que pide el PRD.

### 4. Nuevo horario tras una aprobación tardía: volver a tomar el crédito (hallazgo propio, no está en el ADR 0012)

El ADR 0012 devuelve las horas cuando la reserva expira, pero #13 permite que un pago aprobado tarde cree una reserva nueva con el mismo pago y **copia `credito_aplicado`**. Si el crédito ya volvió al lote, el cliente pagó solo la parte en dinero y la reserva nueva recibiría las horas gratis. Decisión: el nuevo horario vuelve a tomar `credito_aplicado` desde los lotes vigentes (mismo orden, usos `consumido`), con el mismo bloqueo. Si el cliente ya gastó ese crédito (reservó otra limpieza mientras tanto) o venció, se toma lo que haya, la reserva se crea igual (quien ya pagó no queda sin servicio) y la respuesta y el detalle del pago del administrador informan `credito_faltante_horas`.

- **Por qué no bloquear al cliente:** un `409` dejaría a alguien que ya pagó con un pago aprobado sin salida, porque el administrador no puede crear créditos a mano (ADR 0012). El faltante acotado y visible es el menor daño.
- **Descartada:** no devolver el crédito mientras el pago pueda aprobarse tarde. Contradice el criterio de TECH-DESIGN ("si una reserva que usó crédito expira, las horas vuelven").
- **Descartada:** reservar de nuevo las horas al aprobar (usos apuntando a la reserva expirada). Deja horas atrapadas si el cliente nunca elige horario y añade un estado que ningún ADR define.
- **Pregunta abierta 2** para el usuario: si prefiere otra política para el faltante.

### 5. Qué hace cada transición con los usos

| Transición | Usos | Lotes |
|---|---|---|
| Crear con crédito | nuevos: `reservado` (queda `pendiente`) o `consumido` (nace `confirmada`) | `horas_disponibles` baja |
| Aprobar (reserva `pendiente` pasa a `confirmada`) | `reservado` a `consumido` | sin cambio |
| Aprobar con la reserva ya `expirada` o cancelada por el administrador | sin cambio (siguen `devuelto`) | sin cambio |
| Aprobar con la reserva cancelada por el cliente | sin cambio | genera el lote de lo pagado en dinero |
| Rechazar | sin cambio | sin cambio |
| Expirar | `reservado` a `devuelto` | `horas_disponibles` sube, `vence_en` igual |
| Cancelar el cliente | `reservado` o `consumido` a `devuelto` | suben las horas al lote original; lote nuevo si el pago está `aprobado` |
| Cancelar el administrador (solo `pendiente`) | `reservado` a `devuelto` | suben las horas; sin lote nuevo |
| Completar (#16), reprogramar (#12), reasignar | sin cambio | sin cambio |

- **Rechazar no devuelve las horas.** El ADR 0012 dice que se devuelven "con el pago rechazado **al vencer la espera**", y el ADR 0009 deja la reserva `pendiente` hasta `expira_en` para que el cliente suba otro comprobante. Si se devolvieran al rechazar, el reenvío y la aprobación darían una reserva `confirmada` con crédito que ya no está descontado. El criterio de TECH-DESIGN "expira o se rechaza" se cumple porque, tras el rechazo, la reserva expira o se cancela y ahí vuelven. El comentario de #11 ("devolver las horas cuando se rechaza") se reemplaza por esto. Es una lectura del ADR, no una decisión nueva; se anota en la pregunta abierta 3 por si el usuario lee distinto.
- **`consumido` se fija al confirmar**, no al completar: el ADR dice "confirmada o completada: consumido", y confirmar ya es el momento en que el uso deja de poder devolverse por expiración. Cancelar (≥ 24 h antes) lo devuelve desde `consumido`.
- **Descartada:** esperar a `completada` para consumir. Dejaría usos `reservado` en reservas confirmadas y obligaría a #16 a tocar el crédito.

### 6. Orden de bloqueo único

Reservas primero, lotes después, y los lotes siempre por `id`: `aprobar` bloquea pago, luego reserva (su `UPDATE`), luego lotes; `cancelar` (cliente o administrador) bloquea reserva y luego lotes; `expirarVencidas` actualiza reservas y luego lotes; la reserva nueva bloquea lotes antes de insertar una fila que nadie más puede referenciar. Ninguna ruta toma un lote y después una reserva ya existente, así que no hay ciclos. Las sentencias de conjunto de devolución bloquean primero los lotes afectados con `SELECT ... ORDER BY id FOR UPDATE`. Un comentario en `transiciones.ts` lo documenta.

- **Descartada:** bloquear una fila "de cliente" para todo el crédito. Sirve, pero la tabla `usuarios` es de Better Auth y bloquearla frena otras escrituras del cliente.

### 7. `expirarVencidas` devuelve las horas dentro de la misma función

Se extiende `expirarVencidas` (no solo la pasada del administrador): si marcó ids, llama a `devolverCreditoDeReservas(tx, ids)`. Así cualquier escritura que ya la usa (`transaccionDeEscritura`) y `ejecutarPasadaDeExpiracion` devuelven las horas, atómicamente con el cambio de estado. Si una escritura falla y su transacción se deshace, la marca y la devolución se deshacen juntas (decisión 5 de #11) y la siguiente escritura o la pasada las repite. Sin vencidas no hay sentencias nuevas. El tipo de `tx` pasa a `Pick<Transaccion, "update" | "select" | "execute">`; los dobles de las pruebas existentes se actualizan (tarea 3.2).

- **Descartada:** devolver desde un cron diario. El crédito de una reserva vencida quedaría atrapado hasta 24 horas y el ADR 0009 y TECH-DESIGN dicen que la expiración no depende del cron.

### 8. Contradicción entre ADR 0008 y ADR 0012 (dejada por #12)

El ADR 0008, en "Una limpieza por pago", dice que una reserva cancelada o expirada "no consume el pago, así que puede usarse para otro horario"; el ADR 0012 y el PRD ("No alcance": "el de una limpieza cancelada se convierte en crédito en horas") mandan lo pagado a crédito. Si ambas valieran, el cliente cobraría dos veces (un nuevo horario con el mismo pago **y** un lote de crédito). Resolución, ya aplicada en el código de #12 (filtro de `pagosParaElegirHorario`) y de #13 (`409 pago_en_credito`):

- **Pago reutilizable para otro horario:** el de una reserva `expirada` y el de una reserva cancelada por el **administrador** (aprobación tardía y comprobante falso).
- **Pago que va a crédito y no se reutiliza:** el de una reserva cancelada por el **cliente**. Las horas pagadas en dinero se acreditan y el crédito se usa en una reserva nueva con su propio precio.

Redacción propuesta para el ADR 0008 (no se edita desde este change), reemplazando la frase de "Una limpieza por pago": "Una reserva expirada o cancelada por el administrador no consume el pago y este puede usarse para otro horario (ADR 0009). Una reserva cancelada por el cliente sí lo consume: lo pagado en dinero pasa a crédito en horas (ADR 0012) y el pago no se reutiliza." Y en el ADR 0009 (aprobación tardía): "…mientras el pago esté aprobado y no tenga ninguna reserva viva, realizada ni cancelada por el cliente." El índice único `reservas_un_pago_por_reserva_viva` no puede expresar esto (una cancelada queda fuera del `WHERE`), así que lo garantiza el servidor (filtro de #12 y rechazo de #13); la tarea 7.2 prueba que el pago de una cancelada por el cliente no admite un nuevo horario. **Pregunta abierta 1** para el usuario.

### 9. Saldo en el perfil y en el portal: lectura, no escritura

`GET /api/creditos` y `leerCreditos` devuelven saldo, próximo vencimiento, lotes (máximo 20) y los últimos 50 movimientos (`generado` por la fila del lote, `usado` y `devuelto` por los usos), con fechas en hora de Lima (`isoConZona`) y todas las consultas filtradas por `usuario_id` (ADR 0005: datos propios). El perfil agrega `credito` y una tarjeta; `/cuenta/credito` muestra el detalle. Con la membresía vencida el saldo se muestra con el aviso de renovar (ADR 0012: "sigue existiendo, pero no se puede usar hasta renovar"); el bloqueo de reservar es de #13/#15. El administrador ve `GET /api/admin/creditos` y `/admin/creditos` (solo `GET`; otros métodos responden `405`), con el mismo detalle por cliente. El `usuarioId` de Better Auth es texto, no uuid: se valida que exista y, si no, `404`.

- **Descartada:** una tabla de movimientos aparte. Los movimientos se derivan de lotes y usos y no pueden desalinearse.
- **Descartada:** botones para ajustar el saldo (ADR 0012: en v1 el administrador no crea ni edita créditos).
- **Descartada:** Server Actions. El ADR 0003 prefiere un contrato HTTP que se prueba con `curl` y Vitest.

### 10. Recuperar cancelaciones anteriores en la migración

La migración rellena `cancelada_en` con `actualizada_en` en las canceladas (único dato disponible) y ejecuta la sentencia de generación sin filtro de id, con `ON CONFLICT DO NOTHING`. Una prueba contra la rama lee esa sentencia del archivo SQL y la ejecuta dos veces sobre filas insertadas a mano. En producción no habrá cancelaciones de #12 hasta que se despliegue todo junto, pero la sentencia es segura de todos modos.

- **Descartada:** un script aparte. No se puede agregar un script a `package.json` en este change y la migración ya corre en el mismo punto del despliegue.
- **Riesgo aceptado:** un lote recuperado de una cancelación de hace más de 3 meses nace vencido; no daña nada.

## Cobertura de los criterios de `TECH-DESIGN.md`

| Criterio ("Crédito en horas" y portal) | Escenario en | Tarea |
|---|---|---|
| Cancelar (más de 24 h) una limpieza de 4 h pagada y aprobada da 4 h que vencen en 3 meses; el perfil muestra saldo y vencimiento | `lotes-de-credito` (Cancelar una limpieza pagada y aprobada), `saldo-de-credito` (Perfil con crédito) | 2.2, 3.4, 5.3, 7.2 |
| Si cancela antes de la aprobación no hay crédito; si el administrador aprueba después, aparece; si rechaza, no | `lotes-de-credito` (Antes de que se apruebe, Aprobar después, Pago rechazado), `credito-en-transiciones` (Aprobar un pago de una reserva ya cancelada) | 3.3, 3.4, 7.2, 7.3 |
| Una primera limpieza cancelada no genera crédito por sus 3 h, solo por las adicionales | `lotes-de-credito` (Primera limpieza cancelada, Primera de 3 horas) | 2.1, 2.2, 7.2 |
| En la siguiente reserva el crédito se descuenta solo, desde el lote que vence antes, y el monto refleja las horas por pagar | `credito-en-la-reserva` (Se descuenta del lote que vence antes, El monto refleja solo las horas por pagar, Cotización con crédito) | 2.1, 4.1, 4.2, 4.5, 7.4 |
| Si el crédito cubre todas las horas, la reserva se confirma al instante sin comprobante | `credito-en-la-reserva` (Reserva cubierta sin comprobante) | 4.3, 4.6, 4.7, 7.4 |
| Si una reserva que usó crédito expira o se rechaza, las horas vuelven con su vencimiento original | `credito-en-transiciones` (Expirar devuelve el crédito, Rechazar un pago no toca el crédito) | 3.1, 3.2, 3.6, 7.5 |
| Si se cancela una reserva pagada en parte con crédito, esas horas vuelven a su lote y solo lo pagado en dinero genera lote | `credito-en-transiciones` (Cancelar como cliente), `lotes-de-credito` (Reserva pagada en parte con crédito) | 3.1, 3.4, 7.2 |
| Un crédito vencido deja de aparecer en el saldo y no se aplica | `lotes-de-credito` (El saldo se calcula), `credito-en-la-reserva` (Un lote vencido no se aplica) | 2.3, 4.1, 7.4, 7.7 |
| Dos reservas simultáneas no usan las mismas horas | `credito-en-la-reserva` (Dos reservas simultáneas) | 4.1, 7.6 |
| Con la membresía vencida el saldo se ve pero no se puede reservar | `saldo-de-credito` (Membresía vencida), `credito-en-la-reserva` (Membresía vencida) | 4.2, 5.3 |
| (Portal) El administrador ve el saldo de cada cliente | `saldo-de-credito` (Crédito de cada cliente para el administrador) | 6.1, 6.2, 7.7 |
| (Pendiente de #12) Recuperar cancelaciones anteriores | `lotes-de-credito` (Recuperar las cancelaciones anteriores) | 1.4, 1.5, 7.5 |

## Qué cambia de #11, #12 y #13

- **#11:** `expirarVencidas` (devuelve), `aprobarPago` (consume y genera), `cancelarReservaComoAdmin` (devuelve y guarda `cancelada_en`); `rechazarPago` sin cambios (su comentario se reemplaza).
- **#12:** `cancelarReservaDelCliente` (guarda `cancelada_en`, devuelve, genera) y su respuesta (`credito`); `mensajeDeCredito`; se invierte la prueba "cancelar no escribe crédito" y el escenario "No se escribe crédito" de `cancelar-reserva-cliente` queda sustituido.
- **#13:** `creditoParaReserva` pasa a leer los lotes; `miembro.ts` aplica el crédito y confirma sin comprobante; `nuevo-horario.ts` vuelve a tomar el crédito; `cotizar.ts` y el asistente informan `cubierta_por_credito`. #13 todavía no tiene `design.md`: la tarea 1.1 reconcilia los nombres y, si #13 ya implementó el pago interno o el esquema opcional, se reutilizan.

## Risks / Trade-offs

- **[Un error en una transición regala u oculta horas]** → un solo módulo de transiciones, el invariante `horas_disponibles + usos vivos = horas_iniciales` en pruebas con dobles (matriz, 3.8) y contra la rama (7.6), y `CHECK`s en la base que impiden negativos y excesos.
- **[Interbloqueos]** → orden único de bloqueo (decisión 6) y la cancelación no bloquea el pago; la tarea 7.3 prueba las carreras con dos transacciones.
- **[Aprobación tardía con crédito ya gastado]** → decisión 4: el faltante se registra y se muestra, pero las horas se regalan una vez. Es acotado a `credito_aplicado` de una reserva y requiere que el cliente gaste el crédito entre la expiración y la aprobación.
- **[Divergencia entre lo cotizado y lo cobrado]** → si el crédito cambia entre la cotización y la confirmación, el servidor cobra su cálculo y el comprobante puede venir por otro monto. Ya aceptada para las horas gratis en #9a; el administrador ve el monto al aprobar. Mejora posible: que el cuerpo lleve el monto esperado y la ruta responda `409` "el precio cambió" (pregunta abierta 4).
- **[Crédito atrapado en un lote vencido]** → las horas devueltas a un lote ya vencido no se recuperan: es la consecuencia que el ADR 0012 acepta ("cancelar y volver a reservar no sirve para alargar el vencimiento").
- **[Membresía vencida]** → el crédito se pierde si vence antes de renovar (ADR 0012). El perfil lo avisa, pero la renovación y sus avisos son de #15 y no hay notificaciones fuera del perfil (PRD).
- **[Cancelaciones causadas por Tiza]** → fuera de alcance (Non-Goals); el crédito no se genera para `cancelada_por = 'admin'`.
- **[Una hora vale igual en cualquier servicio]** → consecuencia aceptada en los ADR 0008 y 0012.
- **[Dependencia de #13 sin `design.md`]** → los nombres exactos pueden cambiar; la tarea 1.1 pausa si falta un punto de extensión en vez de inventarlo.
- **[Recuperación con `actualizada_en`]** → si una cancelación anterior se tocó después, el vencimiento recuperado sale más tarde del real. Solo afecta a datos de prueba.
- **[Datos reales de pago con aviso de demostración]** → ya decidido en #9a y #9b; este change no lo reabre.

## Migration Plan

1. Al arrancar, tarea 1.1 (dependencias) y 1.2 (rama `pruebas` confirmada por el usuario).
2. Cambiar `src/db/esquema.ts`; `npm run db:generate -- --name=credito-en-horas` **después** de las migraciones de los ítems anteriores; revisar el SQL; agregar a mano el relleno de `cancelada_en` y la sentencia `-- recuperar-creditos`.
3. Aplicar **solo a la rama `pruebas`** con el comando `node -e` de la tarea 1.6; correr `PRUEBAS_BD=1 npx vitest run --config vitest.bd.config.ts`.
4. Servidor de desarrollo contra la rama con el comando `node -e` de la tarea 8.2 (nunca `npm run dev` a secas).
5. **Producción (diferida hasta cerrar los 18 ítems):** `npm run db:migrate` **antes** de desplegar (no hay claves nuevas de `configuracion`, pero el código nuevo consulta las tablas), `npx vercel deploy --prod`, `GET /api/salud` = `200 {"estado":"ok"}`, prueba de humo con una cuenta `@tiza.test` y su limpieza.
6. **Marcha atrás:** redesplegar el commit anterior. Las tablas y la columna nuevas no estorban al código viejo, pero el código viejo ignora el crédito: las horas reservadas por reservas pendientes no se devolverían al expirar. Quitar las tablas es un `DROP` manual y perdería el crédito de los clientes.

## Open Questions

1. **¿Se ajusta el ADR 0008 (y el 0009) con la redacción de la decisión 8?** Recomendado: sí, porque hoy el texto del ADR 0008 se contradice con el 0012 y el PRD.
2. **¿Qué hacer si, al elegir el nuevo horario tras una aprobación tardía, el crédito que usó la reserva original ya no está?** Se eligió crear la reserva igual y mostrar el faltante (decisión 4). Alternativas: `409` y que el cliente escriba por WhatsApp, o cobrar la diferencia con un comprobante nuevo.
3. **¿Se acepta que rechazar un pago no devuelva el crédito hasta que la reserva expire o se cancele?** Es la lectura del ADR 0012 ("al vencer la espera"). Si el usuario prefiere devolver al rechazar, hay que decidir qué pasa si el cliente sube otro comprobante (volver a tomar el crédito) y el ADR debe cambiar.
4. **¿Se agrega el monto esperado al cuerpo de la reserva** para responder `409` si el crédito o las horas gratis cambiaron entre la cotización y la confirmación? Evitaría comprobantes por un monto distinto; toca el contrato de #9a y #13.
5. **Ajustes propuestos a documentos (no se editan desde este change):** en `TECH-DESIGN.md`, agregar `cancelada_por` y `cancelada_en` a `reservas` y la nota de que rechazar no devuelve el crédito; en el ADR 0012, aclarar que "pago rechazado al vencer la espera" es la expiración y que el nuevo horario tras una aprobación tardía vuelve a tomar el crédito; en `BACKLOG.md`, que #14 extiende `expirarVencidas`, `aprobarPago`, `cancelarReservaDelCliente`, `cancelarReservaComoAdmin`, `creditoParaReserva` y el nuevo horario.
