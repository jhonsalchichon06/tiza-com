## Context

Ver `proposal.md` para el motivo. Estado verificado en el código y en los changes vecinos antes de diseñar:

- **Aplicado y leído en `src/`:** `crearPrimeraReserva` (`src/lib/reservas/crear.ts`) valida fuera de la transacción (cuerpo, `validarDireccion`, `verificarImagenSubida`, `validarInicioServicio`, vigencia de la primera membresía) y dentro de `transaccionDeEscritura` comprueba el estado del cliente (`comprobarEstadoDelCliente`: `409 en_espera` por reserva pendiente, `409 MENSAJE_YA_ES_MIEMBRO` con una membresía `activa`, `409 MENSAJE_MEMBRESIA_EN_REVISION` con cualquier otra), llama a `decidirLimpiezaGratis(tx, usuarioId, claveHogar(direccion))` (#10 ya aplicado: `src/lib/reservas/gratis.ts` con `decidirPorCliente`, `decidirPorHogar` y `reservaQueCuentaParaGratis`, que no cuenta `cancelada` ni `expirada`), inserta membresía, pago y reserva con `insertarEnPrimerEquipoLibre` y traduce la unicidad con `traducirUnicidad` (`unicidad.ts`, ya con los índices de la gratis). `calcularServicio` (`src/lib/precios.ts`) ya aplica `descuento_miembro` a las horas a cobrar y ya acepta `aplicaGratis` y `creditoHoras`. `cotizarPrimeraReserva` y `crearRutaCotizacion` (`cotizar.ts`, `rutas.ts`) cotizan siempre la primera membresía. El asistente (`src/lib/reservas/asistente/`, `app/reservar/`) tiene `decidirVista` con `ya_es_miembro`, `confirmarReserva` (sube, envía y distingue `conflicto` de `en_espera`) y `ResumenCotizacion` que ya dice "con tu descuento de miembro".
- **Esquema ya listo, sin migración:** `pagos.concepto` admite `reserva` con `membresia_id` nulo (`pagos_membresia_si_concepto`), el método `credito` exige monto 0 y no pide comprobante (`pagos_credito_sin_monto`, `pagos_comprobante_si_no_credito`), `reservas.membresia_id` y `pago_id` son obligatorios, y los índices `reservas_un_pago_por_reserva_viva` y `reservas_una_pendiente_por_cliente` existen.
- **Pendiente de aplicar (solo propose):** #11 (`revision-de-pagos-admin`) agrega `reservas.cancelada_por`, `pagosConHorarioPendiente`, `ejecutarPasadaDeExpiracion`, `POST /api/pagos`; #12 (`perfil-reservas-y-membresia`) agrega `pagosParaElegirHorario` (decisión 11: resta de `pagosConHorarioPendiente` los pagos cuya reserva más reciente canceló el cliente) y el aviso "Elige un nuevo día y hora". También existen en paralelo los changes de #14 y #15, que este change no toca. La tarea 1.1 comprueba todo esto y pausa si falta algo.
- **Entorno:** las migraciones solo van a la rama de Neon `pruebas` y producción queda diferida; este change no tiene migración. Sin Playwright.
- **Verificado en las bibliotecas:** `select(...).for("update")` existe en Drizzle 0.45 (lo usan #11 y #12); un `insert` acepta una expresión `sql` para `expira_en`; `uniqueIndex ... where` ya está en uso.

## Goals / Non-Goals

**Goals:**

- Que un miembro activo reserve una limpieza pagada con 10% de descuento, dentro de la vigencia de su membresía en la fecha del servicio, por la misma ruta y el mismo asistente.
- Que el pago de una aprobación tardía se use para un nuevo horario sin otro comprobante, sin permitir pagar dos veces ni reusar un pago que debe ir a crédito.
- Que la primera limpieza gratis cancelada conserve las 3 horas en la siguiente reserva, con prueba de punta a punta.
- Dejar el crédito en horas (#14) como un punto de extensión explícito, sin adelantar su comportamiento.

**Non-Goals:**

- Crédito en horas: lotes, generación al cancelar, aplicación real, devoluciones y saldo (#14).
- Renovación del mes 4, su pago, el aviso y el bloqueo por membresía vencida en el perfil (#15); aquí solo el `422` por vigencia y un mensaje.
- Aprobar o rechazar pagos (#11), reprogramar y cancelar (#12), marcar `completada`, reasignar y apoyo (#16), fotos (#17), reseñas (#18).
- Elegir cuál de varios pagos aprobados usar: si hubiera más de uno, el cliente los usa uno por uno desde el perfil.
- Prellenar la dirección con la de la reserva anterior (mejora del asistente, no pedida).
- Límite de reprogramaciones, de frecuencia y de registros por IP (pendientes de `BACKLOG.md`).
- Modificar `PRD.md`, `TECH-DESIGN.md`, los ADR o `BACKLOG.md`: lo que haga falta se propone en el reporte.
- Migrar o desplegar producción (diferido).

## Decisions

### 1. Una sola ruta, despachada por la membresía `activa`

`crearReserva` (nuevo punto de entrada en `src/lib/reservas/crear.ts`) lee, con `conReintento`, si el cliente tiene alguna membresía `activa` (sin mirar `fin`): si la tiene, llama a `crearReservaDeMiembro`; si no, a `crearPrimeraReserva` sin cambios. La ruta `crearRutaReservas` llama a `crearReserva`. En `crearPrimeraReserva`, la comprobación `MENSAJE_YA_ES_MIEMBRO` se conserva como guarda: si la membresía se activa entre la lectura y la transacción (el administrador aprobó en ese instante), responde `409 en_espera` en vez de crear una segunda membresía.

- **Por qué:** `TECH-DESIGN.md` usa la misma ruta para ambos flujos y el #9a dejó esta rama para #13 (decisión 1 de ese design).
- **Por qué `activa` sin mirar `fin`:** una membresía vencida también es de un miembro; recibe el `422` por vigencia con el mensaje de renovar, no el flujo de la primera membresía (que le crearía otra membresía sin pasar por la renovación, que es de #15).
- **Descartada:** una ruta aparte (`/api/reservas/miembro`). Duplica la validación del cuerpo y obliga al asistente a decidir la ruta.
- **Descartada:** decidir la rama dentro de una sola transacción. Cada rama valida cosas distintas antes de abrirla (la primera, la vigencia calculada; el miembro, la vigencia contra el `fin` leído dentro), y mezclarlas complica ambas.

### 2. El pago de un miembro es de concepto `reserva`, sin membresía

El pago nuevo lleva `concepto = reserva`, `membresia_id` nulo (el `CHECK` lo permite), el monto de la reserva, el método y la ruta del comprobante. La reserva apunta a la membresía que la autoriza: la `activa` con `fin` más lejano (`leerMembresiaQueAutoriza(tx, usuarioId)` en `src/lib/reservas/membresia-vigente.ts`). Al aprobar el pago, el ítem #11 solo confirma la reserva: no hay membresía que activar.

- **Por qué la de `fin` más lejano:** con una renovación (#15) puede haber dos `activa`; la que cubre más tiempo es la que permite el mayor rango de fechas, y la vigencia se compara con ese `fin`.
- **Descartada:** poner `membresia_id` en el pago. Contradice `TECH-DESIGN.md` ("membresía, si el concepto la incluye") y haría que el #11 intente activarla de nuevo.
- **Orden de inserción:** pago y luego reserva (no hay membresía que insertar).

### 3. Monto 0: reserva `confirmada` con un pago interno

Cuando el monto es 0 (las 3 horas gratis cubren todo, o el crédito del #14), la reserva nace `confirmada` con `expira_en` vacío y su `pago_id` apunta a un pago interno: `crearPagoInterno(tx, { usuarioId, concepto: "reserva" })` en `src/lib/reservas/pago-interno.ts` inserta método `credito`, monto 0, estado `aprobado`, sin comprobante ni revisor. La ruta ignora el comprobante enviado de más (nunca lo guarda, así el cron lo borra a las 24 h).

- **Por qué el método `credito`:** `pagos_comprobante_si_no_credito` solo deja un pago sin comprobante con ese método, y `TECH-DESIGN.md` lo define como "interno, con monto 0 y aprobado automáticamente". `reservas.pago_id` es obligatorio, así que sin pago interno no hay reserva sin comprobante (ADR 0008: "se crea `confirmada` sin comprobante"; ADR 0009 lo admite como excepción).
- **Descartada:** un valor nuevo del enum (`gratis`) o `pago_id` nulable. Exige una migración y un cambio de modelo que el ADR 0008 no pide; el nombre `credito` es un poco engañoso para las horas gratis, y se documenta en el comentario del módulo. Para #14 el módulo es el punto único de creación de pagos internos.
- **La regla de una reserva en espera se comprueba antes de calcular el monto** (también para el monto 0): evita que alguien abra la agenda con reservas en espera y confirmadas sin límite a la vez que bloquea su pendiente.
- **Si el monto es mayor que 0 y no hay comprobante:** `422 comprobante_requerido` dentro de la transacción (se deshace todo). El comprobante y el método son opcionales en el esquema del miembro (`esquemaReservaMiembro`) precisamente porque el monto solo se conoce dentro de la transacción (depende de la limpieza gratis y del crédito).
- **Verificación del archivo:** si el cuerpo trae comprobante, se verifica con `verificarImagenSubida` antes de la transacción (ADR 0010); si el monto resulta 0, se descarta.

### 4. Cotización de miembro con `modo`

`Cotizacion` pasa a ser una unión por `modo`: `"primera"` (contenido actual) o `"miembro"` (`membresia: null`, `membresia_fin`, `membresia_vigente`, `total_a_pagar = monto`, `fechas.hasta` = último día civil con inicio anterior al `fin` (`fechaLocal(fin − 1 ms)`), `limite = fin`). `cotizarReservaDeMiembro(config, servicio, ahora, opciones)` es una función pura; `crearRutaCotizacion` lee, además de `decidir`, la membresía activa y elige la función. `fechas.desde` es la misma de la primera (48 horas). Si `fin <= ahora + 48 h`, `fechas.hasta < fechas.desde` y la lista de días queda vacía; `membresia_vigente: false` cuando `fin <= ahora`.

- **Por qué en el servidor:** el ADR 0008 dice que el navegador no recalcula precios ni zonas horarias (decisión 8 del #9a).
- **Punto de extensión del crédito:** `creditoParaReserva(lector, usuarioId, horasMaximas)` (`src/lib/reservas/credito.ts`) devuelve 0 y tiene el comentario del contrato que #14 implementará (lotes que vencen antes, `FOR UPDATE`, usos `reservado`). La cotización y la reserva pasan su resultado como `creditoHoras` a `calcularServicio` (que ya lo soporta). Una prueba con un doble que devuelve 2 fija el contrato del cálculo.
- **Descartada:** otro endpoint para la cotización de miembro. El cliente no debería elegirlo, y el servidor ya sabe quién es.
- **Descartada:** un `GET /api/cotizacion?modo=miembro`. El modo lo decide la membresía, no el navegador.

### 5. Vigencia: se compara el instante contra el `fin` leído dentro de la transacción

`validarVigenciaDeMembresia(config, fin, inicio)` (puro, en `vigencia.ts`) exige `inicio < fin` y, si no, lanza `ErrorApi.invalido("Tu membresía llega hasta el {fecha}. Elige una fecha anterior o renueva tu membresía para seguir reservando.")` con la fecha en hora de Lima. Se llama dentro de `transaccionDeEscritura` con el `fin` de la fila leída ahí (ADR 0008: "dentro de la misma transacción"). El `inicio` no depende del reloj; el `fin` viene de la base, así que no hay desfase.

- **Descartada:** comparar fechas civiles (rechaza o deja pasar mal el día límite; ya lo descartó el #9a para la primera).
- **Descartada:** validarla fuera de la transacción. Un `fin` leído antes podría estar desfasado respecto de una renovación.

### 6. Nuevo horario: rutas bajo `/api/pagos/:id/nuevo-horario`, copia de la reserva original

El recurso es el pago (el que ya está aprobado), por eso las rutas cuelgan de `/api/pagos/[id]/`: `GET .../nuevo-horario` (datos), `GET .../nuevo-horario/disponibilidad?fecha=` y `POST .../nuevo-horario`. No chocan con `POST /api/pagos` (#11) ni con `/api/reservas/[id]` (#12). Todas con `requerirSesion`, `id` uuid o `404` (nunca un `22P02`), la condición del dueño en la misma consulta (`404` para lo ajeno, incluido un administrador), y el `POST` exige JSON (`415`).

`crearReservaDeNuevoHorario` dentro de `transaccionDeEscritura`: `FOR UPDATE` del pago del dueño → `reservaOrigenDelPago` (la reserva más reciente de ese `pago_id`) → comprueba estado y elegibilidad (decisión 8) → `validarInicioServicio` con las `horas_agenda` guardadas → `leerMembresiaQueAutoriza` y `validarVigenciaDeMembresia` → `rangoBloqueado` → `insertarEnPrimerEquipoLibre` con la fila copiada y `estado = confirmada`. Se copian servicio, dirección, horas gratis, crédito, descuento, monto y `primera_gratis`; no se recalcula nada, porque el pago ya cubre ese monto y recalcular con una `configuracion` cambiada dejaría el pago desalineado.

- **Por qué un `POST` con solo `inicio`:** el cliente no puede cambiar el servicio, la dirección ni el monto con un pago ya hecho (ADR 0009: "usa el mismo pago"). Para algo distinto, reserva de nuevo.
- **Por qué `insertarEnPrimerEquipoLibre` y no un `insert` nuevo:** la regla del #10 es que todo `insert(reservas)` vive en `src/lib/agenda/asignar.ts`; esta función lo hace. Una prueba existente lo vigila y debe seguir pasando.
- **`apoyo_estado`:** si requiere apoyo, nace `por_coordinar` (es un horario nuevo y el administrador lo coordina).
- **Idempotencia:** igual que el #9a (decisión 4), un reintento tras un `COMMIT` perdido choca con `reservas_un_pago_por_reserva_viva` y responde `409` ("Ese pago ya tiene una reserva asociada."), veraz y sin duplicar.
- **`primera_gratis` en una carrera:** si otra cuenta tomó la limpieza gratis del hogar mientras la original estaba expirada, el índice único `reservas_primera_gratis_por_hogar` rechaza el `insert` y se traduce a `409 limpieza_gratis_usada` con el mensaje "Otra cuenta ya recibió la limpieza gratis de esta dirección. Escríbenos por WhatsApp para coordinar tu limpieza.". El cliente ya pagó la membresía y las horas adicionales: es un caso raro (el administrador ve las coincidencias al aprobar) cuya salida es política de negocio y queda en Open Questions.
- **Descartada:** `POST /api/reservas` con un `pago_id`. Mezcla dos flujos con validaciones distintas (uno con comprobante y cálculo, otro sin).
- **Descartada:** actualizar la reserva `expirada` a `confirmada`. Su horario ya se liberó (ADR 0009: "su horario no se vuelve a ocupar") y el `UPDATE` fallaría o pisaría a otro cliente.
- **Descartada:** permitir elegir otro servicio con el crédito del pago. Sería crédito en horas, que es de #14.

### 7. Un pago aprobado esperando horario bloquea otra reserva

En la rama de miembro, antes de calcular, `pagosParaElegirHorario(tx, usuarioId)` (#12) vacío o `409 horario_pendiente`. Sin esto el cliente podría reservar otra limpieza con las 3 horas gratis (la expirada no cuenta) y quedar con un pago aprobado sin usar; o reservar y pagar dos veces el mismo servicio.

- **Por qué:** protege el dinero del cliente sin crear política nueva: el perfil ya le pide elegir ese horario (ADR 0009: "mientras el pago esté aprobado y no tenga ninguna reserva viva o realizada").
- **El pago de una cancelación del cliente no bloquea** (decisión 8).
- **Riesgo:** si el cliente ya no quiere ese servicio, queda bloqueado hasta que lo use (puede reprogramarlo después desde el perfil, #12). Ver Open Questions.
- **Descartada:** permitirlo con un aviso. Es viable, pero deja dinero aprobado sin usar y abre dos caminos para las horas gratis.

### 8. Choque entre el ADR 0008/0009 y el ADR 0012: el pago de una cancelación del cliente no se reutiliza

El ADR 0008 dice que una reserva cancelada "no consume el pago, así que puede usarse para otro horario", y el ADR 0009 permite "elegir un nuevo día y hora" con un pago aprobado sin reserva viva. El ADR 0012 convierte en crédito en horas lo pagado de una reserva **cancelada por el cliente** y el PRD no admite reembolsos. Si el mismo pago pudiera reutilizarse además de generar crédito, el cliente cobraría dos veces. Se sigue la decisión 11 del #12: el nuevo horario con el mismo pago solo vale para la expiración, la aprobación tardía y la cancelación del administrador; la cancelación del cliente va a crédito. No se decide en silencio: el reporte propone ajustar el texto del ADR 0008. Se usa `pagosParaElegirHorario` (#12) en vez de reescribir el filtro.

- **Consecuencia (c):** la "primera limpieza cancelada" no reutiliza su pago: la siguiente reserva es una reserva de miembro normal (decisión 1) que recibe las 3 horas gratis por `decidirLimpiezaGratis` y paga lo que falte. Hasta que #14 exista, las horas adicionales ya pagadas por la cancelada no se descuentan (no hay crédito); #14 debe cubrir también cancelaciones previas a su aplicación (en producción no habrá ninguna, porque no se despliega antes de cerrar los 18 ítems).
- **Descartada:** permitir ambos caminos.

### 9. Limpieza gratis conservada: ninguna columna ni regla nuevas

`decidirLimpiezaGratis` ya no cuenta `cancelada` ni `expirada`, así que la siguiente reserva del miembro vuelve a recibir las 3 horas mientras no tenga otra viva o realizada y el hogar no la haya recibido otra cuenta. #13 la llama con la dirección de la reserva nueva, dentro de la transacción. El índice único parcial de la gratis es la red ante la carrera (`limpieza_gratis_usada`).

- **Pruebas contra la rama:** primera cancelada y siguiente de 5 horas (monto S/ 69,66 con comprobante), siguiente de 3 horas (monto 0, `confirmada`, pago interno), con una `completada` (sin gratis), otro hogar, hogar ocupado por otra cuenta y dos peticiones simultáneas.
- **Descartada:** una columna `beneficio_gratis_disponible`. Se desincroniza y el ADR 0008 dice que la regla vive en el servidor.

### 10. Asistente: el mismo, en modo miembro

El modo sale de `cotizacion.modo`; no hay un estado nuevo en el navegador. `decidirVista(usuario, membresias)` recibe `{ estado, vigente }[]` (la página la arma con `fin > now()` en SQL) y devuelve `miembro` o `membresia_vencida` en vez de `ya_es_miembro`. Cambios en `src/lib/reservas/asistente/`: `puedeAvanzar(5)` es verdadero con `total_a_pagar = 0`; `construirCuerpo` omite método y comprobante cuando el monto es 0; `confirmarReserva` no exige archivo con monto 0 y mapea los códigos `horario_pendiente`, `limpieza_gratis_usada` y `comprobante_requerido`. Los componentes cambian poco: `ResumenCotizacion` muestra "Descuento de miembro" sin la línea de la membresía, `PasoPago` solo muestra el monto de la limpieza (o "Esta limpieza no tiene costo"), `PasoListo` distingue `confirmada` de `pendiente`. La pantalla del nuevo horario (`app/(cuenta)/cuenta/nuevo-horario/[pagoId]/`) reutiliza `PasoFecha` y `dias.ts`.

- **Descartada:** un asistente aparte para miembros. Duplica 6 componentes y su lógica probada.
- **Probada con:** funciones puras y `renderToStaticMarkup`, sin jsdom ni Playwright (decisión 1 del 9b).

### 11. WhatsApp según el estado

`mensajeDeReserva` recibe `estado: "pendiente" | "confirmada"`: en `confirmada` dice "Estado: confirmada." en vez de la espera del pago. Sin montos, como hoy.

## Cobertura de los criterios de `TECH-DESIGN.md`

| Criterio | Escenario en | Tarea |
|---|---|---|
| (Miembro) El precio mostrado y guardado es el de lista con el descuento de miembro | `reserva-de-miembro` (Precio con 10%) | 3.1, 3.2, 8.2 |
| (Miembro) Paga con Yape o transferencia, sube el comprobante; reserva `pendiente` con `expira_en` a 24 h | `reserva-de-miembro` (Pago con comprobante) | 4.1, 4.2, 8.2 |
| (Miembro) Fecha posterior al `fin` → `422` que pide renovar | `reserva-de-miembro` (Vigencia) | 2.2, 4.2, 8.3 |
| (Miembro) Al aprobar el pago, la reserva pasa a `confirmada` | `reserva-de-miembro` (Al aprobar el pago) | 8.2 (con la función de aprobar del #11) |
| (Portal) La nueva reserva tras una aprobación tardía usa el mismo pago, `confirmada`, sin comprobante | `nuevo-horario-tras-aprobacion-tardia` (Crear la reserva con el mismo pago) | 5.2, 5.3, 8.5 |
| (Portal) Aprobar con reserva expirada: perfil "Elige un nuevo día y hora" | #12 muestra el aviso; aquí enlaza y crea la reserva | 7.2, 8.5 |
| (Reservar, cliente nuevo) Si cancela su primera limpieza, la siguiente recibe las 3 horas; con una realizada, no | `reserva-de-miembro` (Limpieza gratis conservada) | 3.4, 4.3, 8.4 |
| (Reservar, cliente nuevo) Anticipación de 48 h, horario y capacidad aplican a toda reserva | `reserva-de-miembro` (Anticipación), `nuevo-horario...` (Anticipación, vigencia y capacidad) | 4.2, 5.3, 8.2, 8.5 |
| (Capacidad) Dos peticiones por el último cupo; una `409` | `reserva-de-miembro` (Anticipación, horario y capacidad) | 8.2 |
| (Crédito) El crédito se aplica en la siguiente reserva | **Ítem #14**; aquí el punto de extensión | 3.3 |
| (Renovación) Con la membresía vencida no se reserva; mes 3 sin fechas posteriores al fin | `reserva-de-miembro` (Vigencia) cubre el `422`; el aviso y el pago son de **#15** | 2.2, 8.3 |
| (Errores) Neon dormido: un reintento y "inténtalo en unos segundos" | `reserva-de-miembro` (reintento en las rutas) | 4.4, 5.4 |
| (Comprobantes) Solo su dueño; archivo inexistente o ajeno rechazado | `reserva-de-miembro` (Comprobante de otro cliente) | 4.2 |

## Risks / Trade-offs

- **[#11 y #12 sin aplicar]** → este change depende de `cancelada_por`, `pagosConHorarioPendiente`, `pagosParaElegirHorario` y de aprobar un pago de concepto `reserva`. La tarea 1.1 los comprueba y pausa; el orden recomendado es #11, #12 y luego #13.
- **[Choque ADR 0008/0009 vs ADR 0012]** → decisión 8; se propone ajustar el texto del ADR 0008 y del comentario del #11.
- **[Pago interno con método `credito` también para horas gratis]** → el nombre es engañoso; documentado. #14 reutiliza `crearPagoInterno` y `creditoParaReserva` (coordinar con el spec-writer del #14: si crea su propia versión, dejar una sola).
- **[Sin crédito hasta el #14]** → quien cancela con el pago aprobado no recibe saldo todavía y el miembro paga de nuevo las horas adicionales de una primera cancelada. #14 debe recuperar cancelaciones previas.
- **[Hogar tomado por otra cuenta durante una aprobación tardía]** → `409 limpieza_gratis_usada` sin salida automática. Open Questions.
- **[Bloqueo por pago aprobado sin horario]** → decisión 7.
- **[Carga del administrador]** → cada reserva de miembro exige aprobar un comprobante (PRD, "Riesgos"); las de monto 0 no.
- **[Divergencia cotización/cobro]** → si `configuracion` cambia entre la cotización y la confirmación, el servidor cobra lo nuevo y la pantalla final muestra lo guardado (igual que en #9a).
- **[Reserva sin comprobante abre una vía de abuso]** → solo con monto 0, que requiere gratis conservada o crédito, ambos acotados por reglas de la base (índices únicos) o por #14; no bloquea horarios sin límite porque sigue la regla de una sola en espera.
- **[Datos reales de pago con aviso de demostración]** → ya decidido en #9a/#9b; el paso de pago del miembro conserva el aviso.
- **[Sin pruebas de clic]** → sin jsdom ni Playwright, la interacción solo se prueba en la verificación manual del usuario.

## Migration Plan

1. Comprobar #10, #11 y #12 (tarea 1.1). Sin migración ni claves nuevas en `configuracion`.
2. Verificar en local con `npm test`, `npx tsc --noEmit`, `npm run build` y las pruebas contra la rama `pruebas` (`PRUEBAS_BD=1 npx vitest run --config vitest.bd.config.ts`). El servidor de desarrollo contra la rama se arranca con el comando `node -e` que sobrescribe `DATABASE_URL` con `DATABASE_URL_PRUEBAS` (nunca `npm run dev` a secas: `.env.local` apunta a producción).
3. **Producción (diferida hasta cerrar los 18 ítems):** antes de desplegar, las migraciones pendientes de #11 y #12 deben estar aplicadas con `npm run db:migrate`; este change no agrega ninguna. `npx vercel deploy --prod`, `GET /api/salud` = `200 {"estado":"ok"}`, prueba de humo con una cuenta `@tiza.test` y su limpieza.
4. Marcha atrás: redesplegar el commit anterior; no hay esquema que deshacer.

## Open Questions

1. **¿Se acepta que el pago de una cancelación del cliente no se reutilice y vaya a crédito?** (decisión 8). Contradice una frase del ADR 0008; conviene ajustarla.
2. **¿Qué se hace si otra cuenta tomó la limpieza gratis del hogar mientras la reserva original estaba expirada?** Hoy `409 limpieza_gratis_usada` y coordinar por WhatsApp. Alternativa: crear la reserva sin horas gratis y cobrar la diferencia, o devolver a crédito.
3. **¿Debe un pago aprobado sin horario bloquear nuevas reservas?** (decisión 7). Se eligió bloquear por seguridad del dinero del cliente.
4. **¿Cuál es el nombre correcto del método del pago interno?** Se reutiliza `credito` para no migrar; el negocio podría preferir un valor propio.
5. **Textos de los mensajes** (renovar, horario pendiente, WhatsApp) son propuestas y se pueden ajustar sin cambiar las specs.

Ningún `<!-- REVISAR -->` del PRD queda sin resolver para este ítem.
