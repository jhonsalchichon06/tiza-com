## Context

Ver `proposal.md` para el motivo. Estado verificado leyendo el código y los changes previos:

- **Código construido (#1 a #9a, en local):** `transaccionDeEscritura` (marca `expirada` las vencidas al empezar), `insertarEnPrimerEquipoLibre` (un `SAVEPOINT` por equipo, `23P01` pasa al siguiente), `leerOcupacion(base, { desde, hasta, excluirReservaId })`, `validarInicioServicio(config, ahora, inicio, horasAgenda)`, `rangoBloqueado`, `isoConZona`, `validarVigenciaPrimeraMembresia`, `reservaActiva` (`src/db/reservas-activas.ts`), `crearRutaReservas` como patrón de ruta (`415`, `conReintento` con `errorOriginal`, `manejar`), `formatearSoles` y `formatearHoras` (`src/lib/soles.ts`), `enlaceWhatsapp` y `leerEnvWhatsapp`, `AVISO_DEMOSTRACION`, `CCI_TIZA` y `RUTA_QR_YAPE`, y `subirComprobante`/`subirImagen` (navegador).
- **`/cuenta` hoy** (`app/(cuenta)/cuenta/page.tsx`) es una portada mínima. `demo/cuenta.html` y `demo/cuenta.js` son solo referencia visual (datos de ejemplo y sesión en `localStorage`); no se importan.
- **`consultarDisponibilidad` no acepta `excluirReservaId`:** `GET /api/disponibilidad` calcula el servicio desde los parámetros y no sabe nada de una reserva. Por eso este change agrega una ruta propia del dueño (decisión 6).
- **`reservas` no tiene `cancelada_por` todavía.** Lo agrega el change `revision-de-pagos-admin` (#11, con propose, sin aplicar), junto con el estado `caducada`, `ejecutarPasadaDeExpiracion`, `pagosConHorarioPendiente`, `pagosRechazadosReenviables`, `reenvio_hasta`, `reenvio_vigente`, `POST /api/pagos` y la clave `reenvio_comprobante_dias`. **Este change depende de todo eso.**
- **`decidirLimpiezaGratis(tx, usuarioId)` tiene hoy dos argumentos** (`src/lib/reservas/gratis.ts`). El change `una-limpieza-gratis-por-hogar` (#10, en aplicación) lo cambia a `decidirLimpiezaGratis(tx, usuarioId, hogar: ClaveHogar)` con `hogar` obligatorio, expone `decidirPorCliente` y `decidirPorHogar`, agrega `reservaQueCuentaParaGratis` y los índices únicos de `primera_gratis`. Este change usa esa firma.
- **El #10 fija un invariante que respetamos:** todo `insert(reservas)` vive en `src/lib/agenda/asignar.ts` y una prueba lo comprueba. Reprogramar es un `UPDATE`, no un `insert`; su función también va en `asignar.ts` para mantener juntas las reglas de equipos.
- **Entorno:** migraciones solo a la rama de Neon `pruebas` (`DATABASE_URL_PRUEBAS`); `DATABASE_URL` de `.env.local` es producción. Producción queda diferida hasta cerrar los 18 ítems. Sin Playwright.
- **Verificado en las bibliotecas:** `drizzle-kit generate --custom` existe (`npx drizzle-kit generate --help`) y crea una migración vacía para SQL escrito a mano; Drizzle 0.45 tiene `select(...).for("update")` (lo usa el #11). La restricción de exclusión de Postgres, al actualizar una fila, no la compara contra su propia versión anterior: mover una reserva a un rango que se solapa con el suyo viejo no choca consigo misma.

## Goals / Non-Goals

**Goals:**

- Que el cliente vea el estado real de su membresía y sepa qué hacer (esperar, subir otro comprobante, elegir un nuevo horario, empezar de nuevo).
- Que pueda ver sus próximas reservas y su historial, reprogramar y cancelar hasta 24 horas antes, sin pisar a otros clientes y sin ver datos ajenos.
- Que cancelar la primera limpieza gratis no pierda el beneficio.
- Dejar a #13, #14 y #15 sus puntos de extensión claros, sin adelantarlos.

**Non-Goals:**

- Reservar como miembro activo y el botón "elegir nuevo horario" tras una aprobación tardía (#13). Aquí solo el aviso.
- Crédito en horas (#14): ni lotes, ni usos, ni saldo, ni generación al cancelar. Aquí solo un mensaje informativo y un comentario en el punto de extensión.
- Renovación del mes 4 (#15): ni aviso del mes 4, ni pago de renovación, ni bloqueo por membresía vencida (el bloqueo de nuevas reservas por vigencia es de #13/#15). Aquí `vencida` se muestra como dato. Los `<!-- REVISAR -->` del PRD sobre monto, duración de la renovación y reservas del mes 3 siguen sin resolver y no se tocan.
- Marcar `completada`, reasignar equipo, apoyo (#16); fotos (#17); reseñas (#18). El detalle deja espacio pero no tablas ni columnas.
- Notificaciones por correo, SMS o WhatsApp automático (PRD, "No alcance"): el cliente se entera dentro del perfil.
- Límite de reprogramaciones por reserva, límite de frecuencia y de registros por IP (pendientes de `BACKLOG.md`).
- Modificar `PRD.md`, `TECH-DESIGN.md`, los ADR o `BACKLOG.md`: lo que haga falta cambiar ahí se propone en el reporte.
- Migrar o desplegar producción (diferido).

## Decisions

### 1. Contrato de rutas bajo `/api` y páginas que usan las mismas funciones (ADR 0003, 0005)

`GET /api/perfil`, `GET /api/reservas/[id]`, `GET /api/reservas/[id]/disponibilidad`, `POST /api/reservas/[id]/cancelar`, `POST /api/reservas/[id]/reprogramar`. Todas con `requerirSesion` primero (`401`), las `POST` exigen `application/json` (`415`, para que un formulario de otro sitio no las dispare con la cookie `SameSite=Lax`), validan el `id` como uuid (si no, `404`, no un `22P02`), y envuelven la lógica con `conReintento` y `errorOriginal`, igual que `crearRutaReservas`. Las páginas de servidor llaman directamente a las funciones de `src/lib/perfil/` y de `src/lib/reservas/` (sin pasar por HTTP); los componentes de cliente (cancelar, reprogramar, reenviar) llaman a las rutas.

- **Por qué:** es el contrato HTTP explícito del ADR 0003, que se prueba con `curl` y Vitest sin Playwright.
- **Descartada:** Server Actions de Next. Mezclan el contrato con la interfaz y no se prueban con `curl`.
- **Descartada:** `PATCH /api/reservas/:id` con `{estado: "cancelada"}`. Reprogramar y cancelar tienen reglas y respuestas distintas.
- **Descartada:** una ruta `GET /api/reservas` de listado. El perfil siempre necesita membresía, avisos, próximas e historial juntos; una sola lectura evita cuatro viajes a Neon (que puede estar dormido).

### 2. Aislamiento: la condición del dueño va en la consulta, y `404` para todo lo ajeno (ADR 0005)

Toda consulta de reserva por `id` incluye `usuario_id = $sesion` en el mismo `WHERE` (también el `FOR UPDATE`). No existe una consulta "por id" sin dueño. Un id inexistente, de otro cliente o con mal formato responde el mismo `404` con el mismo mensaje. Un administrador que no es el dueño también recibe `404` en estas rutas: su acceso es `/api/admin` (#11, #16).

- **Por qué:** consultar y después comparar el dueño en memoria abre la puerta a olvidar la comparación; con el filtro en SQL no hay camino que devuelva la fila ajena. `403` revelaría que el id existe.
- **Descartada:** `403` para datos ajenos. El criterio de `TECH-DESIGN.md` y el ADR 0005 piden `404`.
- **Prueba:** un recorrido sobre las cinco rutas con un cliente A sobre ids de B (pruebas contra la rama) y un doble que falla si alguna consulta no recibe el `usuario_id`.

### 3. Estado de la membresía derivado, con el reloj de la base (ADR 0008)

`src/lib/perfil/membresia.ts` lee las membresías del cliente con su último pago y calcula el estado con una pura función `estadoDeMembresia`. La vigencia se calcula con `fin > now()` **en SQL** (columna `vigente`), no con el reloj del servidor, igual que `expira_en`. Orden de elección: la `activa` vigente; si no hay, la `pendiente`; si no hay, la `activa` vencida más reciente; las `caducada` no cuentan.

- **`pago_rechazado` vs `plazo vencido`:** la membresía `pendiente` con último pago `rechazado` es `pago_rechazado` solo si ese pago aparece en `pagosRechazadosReenviables(base, usuarioId)` (#11); si no aparece, el plazo venció aunque el cierre no haya corrido (cierre perezoso del #11) y el perfil muestra "empezar de nuevo". Así el perfil nunca depende de que alguien haya disparado el cierre.
- **"Vencida" no se guarda** (ADR 0008). No se agrega ningún estado.
- **Descartada:** calcular la vigencia con `new Date()` del servidor. Desfasa respecto del `fin` y de las demás lecturas.
- **Descartada:** cerrar o marcar algo desde el perfil. La pasada de expiración (decisión 8) ya hace lo que corresponde; el perfil solo lee.

### 4. Cancelar: una transacción, el dueño en el `WHERE`, idempotente (ADR 0009, 0012)

Dentro de `transaccionDeEscritura`: `SELECT ... FOR UPDATE` de la reserva filtrada por dueño → `404` si no existe → si ya está `cancelada` con `cancelada_por = 'cliente'`, devuelve `200` sin escribir (idempotente) → si está `completada`, `expirada` o `cancelada` por el administrador, `409` con mensaje distinto para cada una → si faltan menos de `cancelacion_minima_horas` para el `inicio`, `409 fuera_de_plazo` → `UPDATE reservas SET estado='cancelada', cancelada_por='cliente', expira_en=NULL, actualizada_en=now()`. No toca `pagos` ni `membresias`.

- **Idempotencia:** el reintento de `conReintento` tras un corte durante el `COMMIT` vería la reserva ya cancelada; con `200` el cliente no ve un error falso. Una cancelada por el administrador sí da `409`: no es lo que el cliente pidió.
- **Reloj:** el plazo de 24 horas se compara con el `ahora` que inyecta la ruta (reloj del servidor), como `validarInicioServicio` en el #9a: el límite no es sensible a segundos. El `FOR UPDATE` sirve a la concurrencia, no al reloj. Exactamente 24 horas se permite ("hasta 24 horas antes", PRD).
- **Concurrencia con el administrador (#11):** aprobar bloquea el pago y después actualiza la reserva solo si sigue `pendiente`; cancelar bloquea la reserva. Ninguna toma los dos bloqueos en orden inverso, así que no hay interbloqueo; si el cliente cancela primero, la aprobación no vuelve a confirmar la reserva (su `UPDATE` exige `pendiente`) y deja el pago `aprobado` con la reserva `cancelada`, que es el caso que genera crédito en #14.
- **Punto de extensión #14:** comentario en la transacción: "si el pago está aprobado, generar el lote de crédito (horas de trabajo − horas gratis − crédito aplicado) y devolver a su lote las horas de crédito reservadas por esta reserva; si el pago estaba pendiente, el crédito se genera cuando el administrador lo apruebe (ADR 0012)". El #14 reutiliza `cancelada_por`.
- **Mensaje informativo:** la respuesta calcula `horas_pagadas = horas_trabajo − horas_gratis_aplicadas − credito_aplicado` (nunca menos de 0) con el estado del pago, y la pantalla lo traduce a texto. No escribe nada. Es información, no crédito.
- **Descartada:** exigir un motivo de cancelación. Agrega un paso y el PRD no lo pide.
- **Descartada:** `DELETE`. Rompe el historial y las claves foráneas de fotos y reseñas futuras.
- **Descartada:** devolver `409` en el segundo intento. Ya se explicó arriba.

### 5. La primera limpieza gratis cancelada se conserva por construcción, y el perfil lo dice (ADR 0008)

No hay un campo "beneficio pendiente" que mantener: `reservaQueCuentaParaGratis` y los índices únicos de `primera_gratis` (#10) no cuentan `cancelada`, así que `decidirLimpiezaGratis` vuelve a dar verdadero en la siguiente reserva mientras el cliente no tenga otra viva o realizada y el hogar no haya recibido la limpieza de otra cuenta. Este change **no** agrega una columna ni una regla nueva: agrega la prueba de punta a punta (cancelar con la función real y llamar a `decidirLimpiezaGratis`) y el aviso del perfil, que decide con la misma función.

- **Quién crea "la siguiente reserva":** la reserva de un miembro activo es del #13. Hoy `crearPrimeraReserva` responde `409` a quien ya tiene membresía activa (`MENSAJE_YA_ES_MIEMBRO`), así que *entre el fin de este change y el #13* un miembro que canceló su primera limpieza ve el aviso pero todavía no puede reservar. Es una dependencia de orden declarada (Riesgos), no una brecha de comportamiento: este change deja garantizado que cuando #13 llame a `decidirLimpiezaGratis`, el beneficio sigue ahí. Para el cliente cuyo pago sigue `pendiente` y cuya reserva canceló, el beneficio se aplica cuando se apruebe el pago y elija un nuevo horario (#13, que reutiliza el mismo pago).
- **El aviso usa la clave del hogar de la reserva cancelada** (`claveHogar` de esa fila), no la dirección de la siguiente, que aún no existe: la respuesta es "tu limpieza gratis sigue disponible *para esa dirección*". Si el cliente reserva en otra dirección, #13 volverá a decidir con la dirección nueva.
- **Descartada:** una columna `beneficio_gratis_disponible`. Se desincroniza; la regla es derivable (ADR 0008: "la validación de 'sigue siendo la primera' vive en el servidor").
- **Descartada:** crear automáticamente una reserva nueva al cancelar. El cliente decide cuándo y dónde.
- **Horas adicionales pagadas de una primera limpieza cancelada:** pasan a crédito en el #14 (ADR 0008/0012); aquí solo el mensaje informativo (decisión 4).

### 6. Reprogramar: se actualiza la misma fila con una función hermana de `insertarEnPrimerEquipoLibre`

`moverAlPrimerEquipoLibre(tx, reservaId, equipoIds, rango)` en `src/lib/agenda/asignar.ts`: para cada equipo candidato (primero el actual, luego los demás por `id`), `tx.transaction(sp => sp.update(reservas).set({ equipoId, inicio, fin, finBloqueo, apoyoEstado, actualizadaEn }).where(id))` dentro de su `SAVEPOINT`; si `esConflictoDeExclusion(error)` pasa al siguiente; si ninguno acepta, `ErrorApi.conflicto(MENSAJE_SIN_CUPO)`. El resto (estado, `pago_id`, precio, `primera_gratis`, `expira_en`) no cambia.

Orden en `transaccionDeEscritura`: `FOR UPDATE` de la reserva del dueño → `404`/`409` por estado y por plazo de 24 horas contra el `inicio` **actual** → `validarInicioServicio(config, ahora, nuevoInicio, horas_agenda)` con las horas **guardadas** → vigencia (membresía `activa`: `nuevoInicio < fin`; membresía `pendiente`: `validarVigenciaPrimeraMembresia`) → mismo horario → `422` → `moverAlPrimerEquipoLibre`. Si el servicio tiene apoyo y `apoyo_estado` es `coordinado`, vuelve a `por_coordinar` y la nota se conserva.

- **Por qué un `UPDATE`:** conserva el `id` (el detalle, las fotos y las reseñas futuras no se rompen), el pago, la membresía, el precio y `primera_gratis`, y no toca los índices únicos de `pago_id`, `primera_gratis` ni "una pendiente por cliente". Postgres no compara la fila consigo misma al validar la restricción de exclusión.
- **Por qué una función nueva y no `insertarEnPrimerEquipoLibre`:** el encargo sugiere reutilizar la función de inserción; sirve para crear una fila, no para moverla. Reprogramar por "insertar una nueva y cancelar la vieja" obligaría a cancelar primero la vieja (los índices `reservas_un_pago_por_reserva_viva` y `reservas_primera_gratis_*` no admiten las dos vivas), la marcaría `cancelada` con un `cancelada_por` que el #14 interpretaría como crédito, cambiaría el `id` y rompería la regla del #10 de un solo `insert(reservas)` documentado. Se reutiliza el *patrón* (savepoint por equipo, `esConflictoDeExclusion`, `MENSAJE_SIN_CUPO`, `transaccionDeEscritura`) y los helpers de horario.
- **Horas guardadas, no recalculadas:** `horas_agenda` y el precio son una copia de lo cobrado (ADR 0008); si cambiaron los parámetros, la reprogramación no cambia el servicio.
- **Reserva `pendiente`:** se puede reprogramar y no se extiende su `expira_en` (ADR 0009). Con 48 horas de anticipación mínima para el horario nuevo, el plazo de espera sigue terminando antes del servicio.
- **Reglas del horario nuevo = las de una reserva nueva** (ADR 0009: "Anticipación mínima de 48 horas para toda reserva nueva y para el nuevo horario de una reprogramación").
- **Descartada:** exigir que el nuevo horario sea el mismo día. El PRD dice "reprogramar" sin límite.
- **Descartada:** límite de reprogramaciones por reserva. Es política de negocio que el PRD no define; queda como riesgo (un cliente podría mover una reserva muchas veces ocupando y soltando cupos).

### 7. Disponibilidad para reprogramar: una ruta del dueño, no un parámetro público

`GET /api/reservas/[id]/disponibilidad?fecha=` carga la reserva del dueño (`404` si no es suya), toma sus `horas_agenda` guardadas y llama a `calcularDisponibilidad` con `leerOcupacion(..., { excluirReservaId: id })`. No se agrega `excluir` a `GET /api/disponibilidad`.

- **Por qué:** un parámetro público `excluir=<uuid>` dejaría a cualquiera "liberar" en su vista la reserva de otro y deducir ocupación ajena; con la ruta del dueño, `excluirReservaId` solo recibe ids ya comprobados.
- **Descartada:** reutilizar `consultarDisponibilidad` con el servicio recalculado desde `tipo/dormitorios/banos`: recalcularía con la configuración de hoy y podría ofrecer horarios que no corresponden a las `horas_agenda` guardadas.
- La disponibilidad **informa**; la escritura vuelve a comprobar dentro de la transacción (savepoints), así que un horario mostrado libre puede dar `409` si otro cliente llegó antes (PRD, caso borde 2).

### 8. Pasada de expiración al abrir el perfil (ADR 0009; decisión 5 del #11)

Antes de leer, la página y `GET /api/perfil` llaman a `ejecutarPasadaDeExpiracion()` del #11 bajo `conReintento`. Las rutas de cancelar y reprogramar no la llaman: ya van dentro de `transaccionDeEscritura`, que marca las vencidas al empezar. Todo lo que el perfil muestra se calcula igual con `reservaActiva` y el reloj de la base: la pasada persiste, no decide. Si la pasada falla tras el reintento, el perfil responde `503`, no una lista desactualizada.

- **Descartada:** no llamarla y confiar en `reservaActiva`. El perfil funcionaría, pero el estado guardado quedaría sin marcar para #14 (retorno de horas de crédito) y para el listado del administrador.

### 9. Parámetro `cancelacion_minima_horas` en `configuracion` (ADR 0008)

Clave nueva, entero positivo, valor 24, no provisional (lo fija el PRD: "hasta 24 horas antes"). Esquema zod en `src/lib/configuracion.ts`, valor en `VALORES_DEL_DISENO`, y migración de **solo datos**: se crea con `npm run db:generate -- --custom --name=cancelacion-minima-horas` y se escribe a mano `INSERT INTO "configuracion" ("clave","valor","provisional") VALUES ('cancelacion_minima_horas','24',false) ON CONFLICT ("clave") DO NOTHING;`, como la migración `0001` y la del #11. Sin tablas, columnas ni índices nuevos.

- **Por qué un dato y no un `24`:** `TECH-DESIGN.md`: "Precios, duraciones, montos y plazos son datos (`configuracion`), no constantes del código". La anticipación de 48 horas y la espera de 24 ya son datos.
- **Número de claves:** la prueba "define exactamente las N claves del diseño" y la de migraciones se ajustan al número que haya al aplicarse (16 hoy, 17 si el #11 ya aplicó la suya, y esta suma 1). La migración se genera al aplicarse, después de la de #10 y de la de #11 si ya existen, para partir de su snapshot.
- **Riesgo de orden:** `leerConfiguracion` falla si falta una clave, así que la migración va **antes** de desplegar (diferido a producción).
- **Descartada:** reutilizar `anticipacion_minima_horas` (48). Son reglas distintas (crear/reprogramar vs. cancelar/cambiar).

### 10. Reenvío del comprobante: reutilizar lo del asistente, nada nuevo del servidor

El componente `ReenviarComprobante` (cliente) reutiliza `subirComprobante` y `subirImagen` (que ya validan, comprimen y suben a la tienda privada), muestra QR/CCI desde `datos-de-pago.ts` y `AVISO_DEMOSTRACION`, y llama a `POST /api/pagos` del #11 con `pago_id`, `metodo` y la ruta. Interpreta los códigos `plazo_vencido`, `en_espera` y `404`. El perfil decide si lo muestra con `pagosRechazadosReenviables` (definición única).

- **Por qué en este change:** el #11 lo deja explícito ("La pantalla del cliente para subir otro comprobante y el texto del plazo (#12)").
- **Descartada:** mostrar el formulario según `estado` de la membresía. Podría ofrecer subir un comprobante cuyo plazo venció (el servidor lo rechazaría); la consulta del #11 ya aplica el plazo con el reloj de la base.
- **Probada en lo que se puede sin cuentas:** los componentes con `renderToStaticMarkup` y la lógica con dobles; la subida real necesita `BLOB_READ_WRITE_TOKEN` (tarea del usuario).

### 11. "Elige un nuevo día y hora": la consulta del #11 menos lo cancelado por el cliente

`pagosConHorarioPendiente(base, usuarioId)` (#11) devuelve los pagos `aprobado` sin reserva viva o realizada. El perfil le resta los pagos cuya reserva más reciente está `cancelada` con `cancelada_por = 'cliente'`.

- **Choque entre ADR:** el ADR 0008 dice que una reserva cancelada "no consume el pago, así que puede usarse para otro horario", y el ADR 0009 que un pago aprobado sin reserva viva permite "elegir un nuevo día y hora". Pero el ADR 0012 convierte lo pagado de una reserva **cancelada por el cliente** en crédito en horas, y el PRD dice que no hay reembolsos ni reuso de dinero. Si el mismo pago pudiera además reutilizarse para otro horario, el cliente cobraría dos veces (crédito y reuso). Se resuelve así: la reutilización del mismo pago es solo para expiración y aprobación tardía (y para la cancelación del administrador por comprobante falso); la cancelación del cliente va a crédito (#14). No se decide en silencio: queda dicho aquí y se propone al usuario en el reporte ajustar el texto del ADR 0008 y el comentario del #11/#13.
- **Hasta que el #14 exista,** un cliente que cancela con pago aprobado no tiene crédito ni reuso; el mensaje informativo dice que las horas quedarán como crédito, y #14 debe generar también el crédito de cancelaciones anteriores a su aplicación (en producción no habrá ninguna: no se despliega antes de cerrar los 18 ítems).
- **#13** debe usar el mismo filtro al crear la reserva con el pago aprobado (anotado en el reporte).
- **Descartada:** cambiar la consulta del #11. Es de otro change; el filtro aquí es de una línea y se prueba aquí.

### 12. Pantallas

`app/(cuenta)/cuenta/page.tsx` pasa a ser el resumen (membresía, avisos, próximas, historial). `app/(cuenta)/cuenta/reservas/[id]/page.tsx` es el detalle con `AccionesReserva` (cliente: cancelar con confirmación en dos pasos y reprogramar con selector de fecha, lista de horarios y confirmación). Estilos con un módulo CSS propio (`cuenta.module.css`) siguiendo la referencia visual de `demo/cuenta.html`. Letra base de 18 px o más y botones de 48 px o más (público de 30 a 70 años). Se prueban con `renderToStaticMarkup` y con dobles; las rutas con `curl` contra la rama.

- **Cancelar en dos pasos** ("¿Seguro que quieres cancelar?" y "Sí, cancelar" / "No, volver"): una cancelación por un toque accidental no se puede deshacer salvo reservando de nuevo.
- **Fechas** en español de Perú y hora de Lima con `Intl.DateTimeFormat("es-PE", { timeZone })`; montos con `formatearSoles`.
- **Descartada:** reutilizar `demo/cuenta.js`. Es de demostración, con datos de ejemplo y sesión en `localStorage` (CLAUDE.md, regla 5).

## Cobertura de los criterios de `TECH-DESIGN.md`

| Criterio | Escenario en | Tarea |
|---|---|---|
| (Perfil) El cliente ve solo sus propias membresías, reservas, pagos, fotos y reseñas | `perfil-reservas` (Solo mis datos), `perfil-membresia` (Otra membresía no se mezcla) | 3.1, 3.3, 8.2 |
| (Perfil) Abrir por la URL una reserva o un comprobante de otro cliente responde `404` | `perfil-reservas` (Detalle: reserva de otro cliente, id sin formato, administrador); el comprobante ya lo cubre #9a y #8 | 3.4, 3.5, 8.2, 9.2 |
| (Perfil) Reprogramar o cancelar hasta 24 horas antes; con menos, se bloquea con un mensaje | `cancelar-reserva-cliente` (Con menos de 24 horas, Justo 24 horas), `reprogramar-reserva-cliente` (Con menos de 24 horas) | 4.1, 4.2, 5.1, 5.2, 8.3, 8.4 |
| (Perfil) El historial muestra el detalle con fotos y reseña | `perfil-reservas` (Historial): el detalle y el historial; **fotos y reseña: #17 y #18** | 3.2, 7.2 |
| (Reservar y pagar la membresía) Si el cliente cancela su primera limpieza, su siguiente reserva recibe las 3 horas; con una realizada, no | `cancelar-reserva-cliente` (La primera limpieza gratis cancelada no se pierde), `perfil-membresia` (La limpieza gratis cancelada se conserva) | 4.3, 4.4, 8.5 |
| (Capacidad) Una reserva cancelada libera su cupo de inmediato | `cancelar-reserva-cliente` (Horario libre al instante) | 4.2, 8.3 |
| (Capacidad) Dos peticiones simultáneas por el último cupo: una se guarda | `reprogramar-reserva-cliente` (Dos peticiones por el último cupo) | 5.4, 8.4 |
| (Portal) Al aprobar un pago cuya reserva expiró, el perfil muestra "Elige un nuevo día y hora" | `perfil-membresia` (Aviso "Elige un nuevo día y hora") | 2.4, 8.6 |
| (Portal) Si el pago se rechaza y la reserva ya expiró, el cliente puede subir otro comprobante hasta 7 días; pasado el plazo puede empezar de nuevo | `perfil-membresia` (Comprobante rechazado, Plazo vencido), `reenvio-comprobante-perfil` | 2.3, 6.1 a 6.3, 8.6 |
| (Portal) La membresía activa cuenta 3 meses desde la aprobación | `perfil-membresia` (Los 3 meses cuentan desde la aprobación) | 2.1, 8.6 |
| (Crédito) Cancelar una limpieza pagada y aprobada genera crédito y el perfil muestra el saldo | **Ítem #14**; aquí solo el mensaje informativo | 4.5 |
| (Renovación) Aviso del mes 4, bloqueo, nuevo pago | **Ítem #15**; aquí solo el estado `vencida` | 2.1 |
| (Comprobantes) Un comprobante solo lo ve su dueño y un administrador | ya cubierto por #8 y #9a; el perfil enlaza `/api/comprobantes/:id` | 3.4 |
| (Errores) Si Neon está dormido, se reintenta una vez y luego "inténtalo en unos segundos" | `perfil-membresia` (Neon dormido) | 3.5, 4.2, 5.3 |

## Risks / Trade-offs

- **[Dependencia de orden con #13]** → entre este change y el #13, un miembro que canceló su primera limpieza ve "tu limpieza gratis sigue disponible" pero no puede reservar todavía (`crearPrimeraReserva` responde `409 ya eres miembro`). No se despliega nada hasta cerrar los 18 ítems, así que no llega a un cliente real; el orden de implementación recomendado es #11, #10, #12, #13.
- **[Choque entre los ADR 0008/0009 y 0012]** → decisión 11. Si el usuario prefiere que el pago de una reserva cancelada por el cliente sí se reutilice, se quita el filtro de una línea y se retira el mensaje de crédito; #14 cambia de alcance.
- **[Sin crédito hasta el #14]** → quien cancela con el pago aprobado no tiene saldo todavía. Mensaje informativo, sin escribir. #14 debe recuperar cancelaciones previas.
- **[Reprogramaciones ilimitadas]** → un cliente puede mover una reserva varias veces, soltando y volviendo a tomar cupos, cada vez con 48 horas de anticipación y 24 antes del servicio. Es una política no definida en el PRD; se anota para el negocio.
- **[Carga del administrador y expiración]** → una reserva `pendiente` reprogramada conserva su `expira_en`, así que el administrador no gana tiempo (ADR 0009).
- **[Apoyo coordinado reabierto]** → al reprogramar, `apoyo_estado` vuelve a `por_coordinar`; el administrador lo ve de nuevo en su lista (#16) y puede perder una coordinación hecha. Es lo correcto (la fecha cambió) pero genera trabajo; se avisa al cliente en la pantalla de que el equipo volverá a coordinar.
- **[Pasada de expiración en cada apertura del perfil]** → dos sentencias por petición, casi siempre sin filas afectadas; con Neon dormido puede sumar latencia. El índice `reservas_expira_en_pendiente_idx` la cubre.
- **[Hora mostrada vs. hora guardada]** → todas las fechas salen con el desfase de Lima (`isoConZona`); un cambio de zona en `configuracion` las movería, cosa que ya ocurre en las demás pantallas.
- **[Disponibilidad desactualizada al elegir]** → la lista puede mostrar libre un horario que otro cliente toma antes; la escritura lo detecta (`409`) y la pantalla pide elegir otra hora.
- **[Un administrador sin ser dueño recibe `404`]** → consecuencia deliberada de la decisión 2; el administrador ve las reservas desde `/admin` (#16).
- **[Datos reales de pago con aviso de demostración]** → el formulario de reenvío incluye el aviso de demostración junto al QR y la CCI, igual que `/reservar`.

## Migration Plan

1. Al arrancar, comprobar (tarea 1.1) que #10 y #11 están aplicados en el código y en la rama `pruebas`: `cancelada_por`, `caducada`, `reenvio_comprobante_dias`, `ejecutarPasadaDeExpiracion`, `pagosConHorarioPendiente`, `pagosRechazadosReenviables`, `POST /api/pagos` y la nueva firma de `decidirLimpiezaGratis`. Si falta alguno, pausar y reportar: no se improvisa su contenido.
2. Cambiar `src/lib/configuracion.ts` y el fixture; generar la migración de solo datos con `npm run db:generate -- --custom --name=cancelacion-minima-horas` y escribir a mano el `INSERT ... ON CONFLICT DO NOTHING`.
3. Aplicar **solo a la rama `pruebas`** con `node -e "require('dotenv').config({path:'.env.local',quiet:true});process.env.DATABASE_URL=process.env.DATABASE_URL_PRUEBAS;require('child_process').execSync('npx drizzle-kit migrate',{stdio:'inherit'})"` (no imprime la cadena); correr `PRUEBAS_BD=1 npx vitest run --config vitest.bd.config.ts`.
4. Servidor de desarrollo contra la rama (nunca `npm run dev` a secas, porque `DATABASE_URL` de `.env.local` es producción): `node -e "require('dotenv').config({path:'.env.local',quiet:true});process.env.DATABASE_URL=process.env.DATABASE_URL_PRUEBAS;require('child_process').spawn('npx',['next','dev'],{stdio:'inherit',shell:true})"`.
5. **Producción (diferida hasta cerrar los 18 ítems):** `npm run db:migrate` **antes** de desplegar (agrega la clave; sin ella `leerConfiguracion` falla), `npx vercel deploy --prod`, `GET /api/salud` = `200 {"estado":"ok"}`, prueba de humo con una cuenta `@tiza.test` y su limpieza.
6. Marcha atrás: redesplegar el commit anterior; la clave de configuración no estorba al código viejo.

## Open Questions

1. **¿Se acepta que el pago de una reserva cancelada por el cliente no se reutilice para otro horario, sino que vaya a crédito (#14)?** Se eligió eso (decisión 11) por el ADR 0012 y el PRD ("sin reembolsos"); contradice la frase del ADR 0008 sobre reutilizar el pago de una cancelada. Conviene ajustar el ADR 0008.
2. **¿Cuántas veces puede reprogramar un cliente una misma reserva?** Sin límite hoy (decisión 6). Política de negocio no definida en el PRD.
3. **Texto del aviso de plazo vencido y del mensaje de WhatsApp:** los textos son propuestas; no cambian las specs si se ajustan.
4. **Orden de aplicación:** se recomienda aplicar #11 y #10 antes que este change (tarea 1.1 lo comprueba).
