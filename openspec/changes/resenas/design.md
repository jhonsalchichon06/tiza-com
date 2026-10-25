## Context

Ver `proposal.md`. Estado verificado leyendo el código y los changes previos:

- **`resenas` no existe** en `src/db/esquema.ts`; la última migración aplicada es la `0005` y #10 a #17 agregan las siguientes. `reservas.estado` ya incluye `completada`. `TECH-DESIGN.md` describe `resenas` como "reserva (única), estrellas, comentario, aprobada" y el ADR 0002 como "indicador de aprobada".
- **Landing (#5, aplicada en local):** `app/(publico)/page.tsx` exporta `revalidate = 300` y llama a `leerCatalogo()`; `Landing.tsx` recibe solo `catalogo` y trae un comentario "Sin sección de opiniones: la agrega el ítem #18"; el menú vive en `app/(publico)/layout.tsx` (síncrono, sin sesión) y sirve también a `/preguntas`. `landing.test.ts` cuenta 9 `<section>`, prohíbe frases como "Lo que dicen nuestros clientes" y "Testimonios de ejemplo", y rechaza cifras (`S/ n`, `10 %`, `24`, `48`) escritas a mano en los fuentes de `app/(publico)/`. El design de #5 (decisión 8) deja anotado que #18 agrega la sección.
- **#12 (`perfil-reservas-y-membresia`, solo propose):** `leerDetalleReserva` (`src/lib/perfil/detalle.ts`, el `usuario_id` va en el `WHERE`, `404` para lo ajeno), `listarHistorial` (`src/lib/perfil/reservas.ts`) y `app/(cuenta)/cuenta/reservas/[id]/page.tsx` con "el espacio reservado para fotos y reseña".
- **#16 (`gestion-de-reservas-y-apoyo`, solo propose):** `completarReserva` y el patrón de rutas de administración (`requerirAdmin`, `415`, id uuid o `404`, `conReintento` con `errorOriginal`, `manejar`). Ninguna reseña puede existir sin esa transición.
- **#17 (`fotos-del-servicio`, solo propose):** ya extiende `leerDetalleReserva` y `listarHistorial` agregando `fotos` y `total_fotos`, y llena la mitad "fotos" del espacio de #12. Este change llena la otra mitad sin cambiar firmas, solo agrega campos (`resena`, `puede_resenar`, `resena_estado`).
- **Next 16.4.2 sin `cacheComponents`.** `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/revalidatePath.md` dice que `revalidatePath` se puede llamar en Route Handlers y que ahí "marca la ruta" para revalidarla en la siguiente visita.
- **Entorno:** migraciones solo a la rama de Neon `pruebas` (`DATABASE_URL_PRUEBAS`); `DATABASE_URL` de `.env.local` es producción y su despliegue está diferido hasta cerrar los 18 ítems. Sin Playwright. Ningún `REVISAR` bloquea este ítem.

## Goals / Non-Goals

**Goals:**

- Una reseña por limpieza completada, escrita por su dueño; solo se publica tras la aprobación del administrador (PRD alcance 7 y 9).
- Que la landing muestre únicamente opiniones reales aprobadas, sin datos personales, y nada si no las hay.
- Que cada regla (una por limpieza, estrellas 1 a 5) viva también en la base, no solo en el código.

**Non-Goals:**

- **Editar el comentario desde el administrador, retirar (despublicar) una reseña ya aprobada, responder a reseñas, fotos o respuesta del negocio en la reseña, ordenar o destacar reseñas, promedio público de estrellas:** el PRD solo pide escribir, aprobar y mostrar. Riesgo y pregunta abierta 3.
- Avisar al cliente de que su reseña fue aprobada o rechazada (el PRD no tiene notificaciones salientes; lo ve en su historial).
- Un motivo de rechazo: sería una política que el PRD no define.
- Reseñar reservas que no sean `completada`, o reseñas de un servicio por parte de otra persona.
- Moderación automática de palabras, límite de frecuencia (pendiente del backlog) y datos estructurados `schema.org` para buscadores.
- Migrar o desplegar producción (diferido).
- Modificar `PRD.md`, `TECH-DESIGN.md`, los ADR o `BACKLOG.md`: lo que haga falta cambiar ahí se propone en el reporte.

## Decisions

### 1. Tabla `resenas` con `estado` y no con un booleano (ADR 0002)

Columnas: `id uuid` (`gen_random_uuid`), `reserva_id uuid NOT NULL UNIQUE → reservas.id`, `estrellas smallint NOT NULL CHECK (estrellas BETWEEN 1 AND 5)`, `comentario text NOT NULL`, `estado estado_resena NOT NULL DEFAULT 'pendiente'` (enum `pendiente`, `aprobada`, `rechazada`), `revisada_por text → usuarios.id`, `revisada_en timestamptz`, `creada_en`, `actualizada_en`. `CHECK resenas_revision_coherente`: `(estado = 'pendiente' AND revisada_por IS NULL AND revisada_en IS NULL) OR (estado <> 'pendiente' AND revisada_por IS NOT NULL AND revisada_en IS NOT NULL)`. Índice parcial `resenas_aprobadas_idx (revisada_en DESC) WHERE estado = 'aprobada'` para la landing y otro `resenas_pendientes_idx (creada_en) WHERE estado = 'pendiente'` para la cola. Sin `usuario_id`: el dueño sale de la reserva y repetirlo permitiría que se desincronicen. Sin `ON DELETE CASCADE`, como el resto del esquema.

- **Choque con `TECH-DESIGN.md` y el ADR 0002, dicho en voz alta:** ambos hablan de un indicador "aprobada". Un booleano no distingue "esperando" de "rechazada", y sin eso la cola del administrador volvería a mostrar las rechazadas y el cliente no podría saber qué pasó. Se usa un enum de tres valores; `aprobada` sigue siendo una consulta simple (`estado = 'aprobada'`). Se propone actualizar el texto de ambos documentos (reporte).
- **Descartada:** `aprobada boolean NULL` (verdadero/falso/nulo): significado oculto en el `NULL` y el `CHECK` es más difícil de leer.
- **Descartada:** borrar la reseña al rechazarla. Perdería lo que el cliente escribió, que necesita para editar y reenviar.
- **Descartada:** una tabla de historial de revisiones. Para un evento por reseña, `revisada_por` y `revisada_en` bastan.

### 2. Reglas de entrada en un módulo, límites como constantes (supuesto marcado)

`src/lib/resenas/entrada.ts` exporta el esquema zod `{ estrellas: entero 1..5, comentario: string recortado de 10 a 500 caracteres }` con mensajes en español de Perú y las constantes `COMENTARIO_MIN = 10`, `COMENTARIO_MAX = 500`. **Supuesto:** el PRD pide "estrellas y comentario" sin largos; 10 evita "ok" vacío y 500 cabe en una tarjeta de la landing. Se cuentan caracteres tras `trim()` y se normalizan los saltos de línea repetidos (más de dos seguidos pasan a dos). Son límites de validación de entrada, no precios ni plazos, así que viven en código y no en `configuracion` (el TECH-DESIGN pide datos para "precios, duraciones, montos y plazos"). No hay `CHECK` de longitud en la base (cambiar el límite no costaría migración).

- **Descartada:** comentario opcional. El PRD dice "estrellas y comentario" y una tarjeta pública con solo estrellas aporta poco.
- **Descartada:** guardar HTML o Markdown. Es texto plano; React lo escapa al mostrarlo (decisión 9).

### 3. Crear: una transacción, el dueño en el `WHERE` (ADR 0003, 0005, 0009)

`POST /api/reservas/:id/resena` con el patrón de #12/#16: `requerirSesion` → `415` si no es JSON → id uuid o `404` → zod (`422`) → `conReintento` con `errorOriginal` y `manejar`. Dentro de `transaccionDeEscritura`: `SELECT id, estado FROM reservas WHERE id AND usuario_id = $sesion FOR UPDATE` (`404` si no existe) → `409` por estado distinto de `completada` (un mensaje por caso) → `INSERT` en `resenas`. La violación de la clave única (`23505`, también en `cause`) se traduce a `409` "Ya dejaste tu reseña de esta limpieza." Responde `201`, con `Cache-Control: private, no-store`.

- **Por qué la base manda:** la comprobación previa y la clave única juntas; dos peticiones simultáneas pasan la comprobación pero solo una inserta (ADR 0002: la garantía real es la restricción).
- **Reintento tras un `COMMIT` perdido:** el segundo intento choca con la clave y responde `409`, que es verdad y no duplica. El cliente ve el mensaje y al recargar ve su reseña (mismo razonamiento que #16 y #17).
- **Un administrador que no es dueño recibe `404`** en estas rutas, como en #12.
- **Descartada:** `POST /api/resenas` con `reserva_id` en el cuerpo. La reserva viene de la URL (un solo origen) y sigue la forma de `/api/reservas/:id/...` de #12.
- **Descartada:** Server Actions. El ADR 0003 prefiere un contrato HTTP que se prueba con `curl` y Vitest.

### 4. Rechazo: editar y reenviar, sin límite (supuesto marcado)

**Supuesto, no confirmado por el negocio:** una reseña `rechazada` se puede editar y reenviar con `PUT /api/reservas/:id/resena`; vuelve a `pendiente` y limpia `revisada_*`. También se puede editar una `pendiente` (corregir un error antes de que la revisen). Una `aprobada` no se edita (`409`): si se pudiera editar, un cliente podría cambiar el texto después de la aprobación y saltarse la moderación. El `PUT` bloquea la reserva y la reseña (`FOR UPDATE`) y exige estado `pendiente` o `rechazada` en la misma sentencia (`UPDATE ... WHERE estado <> 'aprobada'`); si no afecta filas, `409`.

- **Por qué no es inventar política:** sigue siendo una reseña por limpieza (el PRD), no cuesta migración y evita el callejón sin salida de un rechazo por una frase mal escrita. Si el negocio prefiere que el rechazo sea definitivo, se quita el `PUT` sobre `rechazada` (un `if` y un escenario).
- **Sin límite de reenvíos:** el PRD no lo define. Riesgo en "Risks": un cliente insistente llenaría la cola. Se anota; el administrador siempre puede rechazar de nuevo.
- **Descartada:** rechazo definitivo. Se consideró, pero castiga errores honestos y el cliente no sabría qué cambiar sin un motivo.
- **Descartada:** rechazar con motivo escrito. Habría que decidir qué decir y la política de moderación es del negocio.

### 5. Moderación: tres rutas y una pantalla (ADR 0003, 0005)

`GET /api/admin/resenas` (cola), `POST /api/admin/resenas/:id/aprobar` y `.../rechazar`, con `requerirAdmin` primero, id uuid o `404`, `conReintento` con `errorOriginal` y `manejar`. La decisión es una sola función `decidirResena(id, decision, adminId)` en `transaccionDeEscritura`: `SELECT ... FOR UPDATE` → `404` → `409` si el estado no es `pendiente` (con el estado actual en el mensaje) → `UPDATE` con `revisada_por`, `revisada_en = now()` (reloj de la base), `actualizada_en`. La cola va ordenada por `creada_en` ascendente (la más antigua primero, para no dejar a nadie esperando) y trae el nombre completo, el distrito y la fecha del servicio para que el administrador reconozca la limpieza.

`app/admin/resenas/page.tsx` (servidor) llama a `listarPendientes` sin pasar por HTTP; `AccionesResena.tsx` (cliente) tiene "Aprobar" y "Rechazar", este último con confirmación de dos pasos ("¿Rechazar esta reseña? El cliente podrá editarla y reenviarla."), muestra el mensaje del servidor y hace `router.refresh()`. `app/admin/page.tsx` agrega un enlace "Reseñas por revisar (N)", editando sobre el contenido que dejen #11 y #16.

- **Descartada:** una sola ruta `PATCH` con `{ estado }`. Las dos transiciones comparten reglas, pero el contrato explícito se prueba mejor y es el patrón de #11/#16.
- **Descartada:** permitir cambiar de `aprobada` a `rechazada` (despublicar). Es política de moderación no pedida; si una reseña publicada resulta problemática hoy se corrige a mano en la base. Pregunta abierta 3.
- **Descartada:** paginación. Se listan hasta 100 pendientes ordenadas; el volumen esperado de un negocio nuevo es muy inferior.

### 6. Qué es público de cada reseña (supuesto marcado)

**Supuesto:** se muestran solo **nombre de pila, distrito, estrellas, comentario y mes de la limpieza**. El PRD pide que haya reseñas reales aprobadas pero no dice qué del cliente se publica. Razonamiento: el nombre de pila y el distrito dan credibilidad sin identificar a la persona ni su casa; el apellido, correo, celular y calle jamás salen. `nombrePila` = primera palabra de `usuarios.name`, recortada (si el nombre fuera solo espacios o vacío, "Cliente"). El distrito sale de `reservas.distrito` (uno de los 9 de v1, no es un dato de ubicación fina). El mes viene de `reservas.inicio` en hora de Lima. La función `leerOpinionesPublicas(base)` en `src/lib/resenas/publicas.ts` hace una consulta con `JOIN` a `reservas` y `usuarios`, `WHERE estado = 'aprobada'`, `ORDER BY revisada_en DESC LIMIT 6`, y mapea a una forma que **no tiene** los campos prohibidos; una prueba comprueba que las claves del resultado son exactamente las permitidas.

- **Riesgo asumido:** el comentario es texto libre y puede traer un dato personal que el cliente escribió ("vivo en la calle X"). Mitigación: el administrador lee cada comentario antes de aprobar y la pantalla se lo advierte; no hay edición del texto (Non-Goals), así que ante un dato personal debe rechazarla.
- **Descartada:** iniciales ("María R."). Apellido aunque sea parcial; menos natural y no hace falta.
- **Descartada:** reseñas anónimas. Pierden credibilidad.
- **Descartada:** permitir que el cliente elija si publica su nombre. Una opción más que el PRD no pide.
- **Descartada:** mostrar más de 6. La landing no es un listado; se anota que más reseñas requeriría una página propia (ítem aparte).

### 7. Landing: sección y menú condicionados a que haya reseñas (ADR 0006, decisión 8 de #5)

`Landing` recibe `opiniones?: Opinion[]` (por defecto `[]`). Si hay al menos una, inserta `<Opiniones opiniones={...} />` (sección `id="opiniones"`, título "Opiniones de clientes", tarjetas con estrellas, comentario, nombre de pila y distrito; las estrellas con `aria-label="5 de 5 estrellas"`) entre "Tiza Club" y "Distritos"; si no, no renderiza nada. El título no coincide con las frases que `landing.test.ts` prohíbe. El menú de `layout.tsx` muestra "Opiniones" solo si hay reseñas; para eso el layout pasa a ser asíncrono y llama a la misma lectura que la página. Ambas usan `cache()` de React sobre `leerOpinionesPublicas` para que, dentro de una misma generación, la consulta se haga una sola vez (se comprueba al aplicar que `cache` deduplica entre layout y página en esta versión de Next; si no, el costo es una consulta extra de 6 filas cada 5 minutos).

La lectura está envuelta así: `conReintento` (un reintento, ADR 0006) y, si aun así falla, `console.error` y se devuelve `[]`. **La landing nunca falla por las opiniones**: es contenido accesorio y el resto de la página (precios, reserva) es lo que importa.

- **Por qué no dejar que falle:** a diferencia de `configuracion`, sin la cual la página mostraría cifras erróneas o rotas, sin opiniones la página es correcta. Consecuencia aceptada: si el error ocurre durante una regeneración o el `next build`, la versión publicada queda sin la sección hasta la siguiente regeneración (5 minutos). El error queda en los logs.
- **Si no hay reseñas:** ni sección, ni enlace, ni mensaje sustituto. Se descartó "Pronto verás aquí opiniones de clientes" porque una sección vacía en la primera página pública resta confianza y es ruido para quien aún no tiene clientes; el PRD solo exige que no haya testimonios inventados. (Descartada también: mostrar las opiniones de ejemplo de la demo; el PRD las reemplaza.)
- **Descartada:** cargar las opiniones en el navegador con `fetch` a una ruta pública. Añade una ruta pública, un parpadeo y un viaje extra; la página ya es estática (ISR).
- **Descartada:** `export const dynamic = "force-dynamic"`. Una consulta a Neon por visita (decisión 2 de #5).
- **Consecuencia en las pruebas:** `landing.test.ts` sigue exigiendo 9 `<section>` sin opiniones y se le agregan casos con ellas (10 `<section>`). Los fuentes nuevos de `app/(publico)/_componentes/` entran en la prueba de "sin cifras escritas a mano".

### 8. Actualizar la landing al aprobar (ADR 0008 en espíritu)

Al aprobar, la ruta llama a `revalidatePath("/")` y `revalidatePath("/preguntas")` dentro de un `try/catch` (el menú está en ambas), después de confirmar la transacción. Según la documentación instalada, en un Route Handler esto marca las rutas para revalidar en la siguiente visita; si fallara, la landing se actualiza sola en como máximo 5 minutos (`revalidate = 300`). Se inyecta como dependencia para probarlo con un doble.

- **Descartada:** esperar solo los 5 minutos. Funciona, pero el administrador aprobaría y no vería nada; con la revalidación lo ve en la siguiente visita.
- **Descartada:** revalidar en el `POST` del cliente. Una reseña pendiente no se publica.

### 9. Texto libre: siempre como texto

Comentarios y nombres se renderizan como hijos de React (escapados). No se usa `dangerouslySetInnerHTML` en ningún lado de este change; una prueba lee los fuentes nuevos y falla si aparece. Los saltos de línea se muestran con `white-space: pre-line` en CSS.

### 10. Pantalla del cliente (extiende #12 y #17)

`app/(cuenta)/cuenta/reservas/[id]/ResenaDelServicio.tsx` (cliente) recibe `resena` y `puedeResenar` del detalle. Estrellas como grupo de `input type="radio"` con etiquetas "1 estrella" a "5 estrellas" (se opera con teclado y lector de pantalla), comentario en un `textarea` con contador "N de 500", botón "Enviar reseña" de 48 px o más, deshabilitado durante el envío (un doble clic no manda dos). Muestra el mensaje del servidor (`409`, `422`, `503`) sin perder lo escrito. Tras enviar, `router.refresh()`. El estado de la reseña se traduce con una función pura `textoDeEstadoResena`. En `leerDetalleReserva`, la reseña se lee **después** de cargar la reserva con el `usuario_id` de la sesión (nunca por `reserva_id` suelto sin ese antecedente); en `listarHistorial` se agrega `resena_estado` con un `LEFT JOIN` dentro de la misma consulta del historial. No se cambia ninguna firma de #12 ni de #17; solo se agregan campos. Si esos archivos no existen al aplicar, se pausa (tarea 1.1).

- **Descartada:** componente de estrellas con SVG clicable sin `radio`. No es accesible por teclado.
- **Descartada:** poner el formulario en el listado del historial. Cargaría un formulario por limpieza; el listado solo enlaza.

### 11. Migración (ADR 0002)

`npm run db:generate -- --name=resenas` después de las migraciones de #10 a #17 si ya existen. Contiene `CREATE TYPE estado_resena`, `CREATE TABLE resenas` con sus `CHECK`, la clave única y las claves foráneas, y los dos índices parciales (drizzle-kit genera índices parciales con `where`; se revisa el SQL). No toca `configuracion` ni `reservas`. Se aplica **solo a la rama `pruebas`**. Una prueba lee el SQL por su nombre y falla si falta la clave única, el `CHECK` de estrellas o si hay un `DROP`.

## Cobertura de los criterios de `TECH-DESIGN.md`

| Criterio | Escenario en | Tarea |
|---|---|---|
| (Portal) El administrador puede aprobar una reseña antes de que se muestre en la web | `moderacion-de-resenas` (Aprobar, Rechazar, Ya revisada), `opiniones-en-la-landing` (Una reseña pendiente no se muestra) | 4.1 a 4.5, 8.2, 8.3 |
| (Perfil) El cliente ve solo sus propias reseñas | `resenas-del-cliente` (Solo mis reseñas, Reserva de otro cliente) | 5.1, 5.2, 8.3 |
| (Perfil) El historial muestra el detalle de cada servicio con su reseña | `resenas-del-cliente` (La reseña en el detalle y el historial) | 5.1 a 5.4 |
| (Crédito/reseñas) Una sola reseña por servicio completado; no reseñar uno no completado ni dejar una segunda | `resenas-del-cliente` (Crear: Reserva no completada, Segunda reseña, Dos peticiones simultáneas; tabla: Segunda reseña) | 1.5, 3.1 a 3.4, 8.2 |
| (Crédito/reseñas) Una reseña se muestra públicamente solo después de que el administrador la apruebe | `opiniones-en-la-landing` (Solo aprobadas, Con reseñas aprobadas, Una reseña pendiente no se muestra) | 6.1 a 6.5, 8.4 |
| (PRD) Las reseñas de ejemplo se reemplazan por reales; sin reseñas, nada inventado | `opiniones-en-la-landing` (Sin reseñas aprobadas) | 6.3, 6.5 |
| (Perfil) Abrir por la URL datos de otro cliente responde `404` | `resenas-del-cliente` (Reserva de otro cliente) | 3.3, 8.3 |
| (Portal) Sin rol `admin`, `/admin` y las rutas dan `403` o redirigen | `moderacion-de-resenas` (Cliente o visitante, Cliente intenta aprobar) | 4.3, 4.5 |
| (Errores) Neon dormido: un reintento y luego "inténtalo en unos segundos" | `resenas-del-cliente`, `moderacion-de-resenas` (Neon dormido) | 3.4, 4.3 |
| (Errores) Un error inesperado muestra un mensaje genérico | `manejar` en todas las rutas | 3.4, 4.3 |

## Risks / Trade-offs

- **[Datos personales en un comentario publicado]** → un cliente puede escribir su calle o celular. Mitigación: el administrador lee cada comentario, la pantalla se lo advierte y no se publica nada sin su aprobación; no hay edición, así que la salida es rechazar. Riesgo residual: un descuido del administrador.
- **[Reseñas falsas o del propio negocio]** → solo el dueño de una reserva `completada` puede reseñar, y el administrador es quien completa las limpiezas y aprueba las reseñas: nada impide que él mismo fabrique cuentas, reservas y reseñas. Es una limitación de que el negocio sea su propio moderador; no se mitiga con código.
- **[Reenvíos ilimitados tras un rechazo]** → un cliente puede reenviar muchas veces y cargar al administrador. Sin límite de frecuencia en el sitio (pendiente del backlog). Si se vuelve un problema, se agrega un tope o se hace definitivo el rechazo (pregunta abierta 1).
- **[Sin despublicar]** → una reseña aprobada por error o que se vuelve problemática solo se corrige a mano en la base. Si se vuelve frecuente, ítem aparte.
- **[Menos de 5 minutos de retraso en la landing]** → si falla `revalidatePath`, o mientras Next regenera. Aceptado.
- **[Landing sin opiniones tras un error de lectura]** → la versión generada durante la falla queda sin la sección hasta la siguiente regeneración. El error queda en los logs de Vercel.
- **[Dependencias con solo propose (#12, #16, #17)]** → los nombres (`leerDetalleReserva`, `listarHistorial`, `completarReserva`, el espacio del detalle, `app/admin/page.tsx`) vienen de sus diseños. Si al aplicarse son otros, se ajusta; si no existen, se pausa en la tarea 1.1.
- **[`app/admin/page.tsx` y el detalle del cliente los editan varios ítems]** → se edita sobre el contenido actual; si hay conflicto, parar y avisar.
- **[El layout público pasa a leer la base]** → antes era síncrono. Las páginas ya leen `configuracion`, así que no cambia la dependencia de Neon; el `next build` hace una consulta más de 6 filas.
- **[Pocas reseñas al inicio]** → un negocio nuevo no tendrá opiniones; la sección no aparece hasta que haya una aprobada. Una sola reseña aislada puede verse rara: es el costo de no inventar.
- **[Estrellas sin promedio]** → no se calcula un promedio público para no engañar con muestras pequeñas.
- **[Textos de interfaz]** ("En revisión", "No se publicó…") son propuestas; no cambian las specs si se ajustan.

## Migration Plan

1. Al arrancar, comprobar (tarea 1.1) que existen en el código #5 (landing), #12 (`leerDetalleReserva`, `listarHistorial`, la página de detalle), #16 (`completarReserva`, patrón de rutas de administración) y #17 (si ya extendió el detalle). Si falta algo, pausar y reportar.
2. Cambiar `src/db/esquema.ts` (enum, tabla, índices) y generar la migración con `npm run db:generate -- --name=resenas`; revisar el SQL.
3. Aplicar **solo a la rama `pruebas`**: `node -e "require('dotenv').config({path:'.env.local',quiet:true});process.env.DATABASE_URL=process.env.DATABASE_URL_PRUEBAS;require('child_process').execSync('npx drizzle-kit migrate',{stdio:'inherit'})"` (no imprime la cadena). Luego `PRUEBAS_BD=1 npx vitest run --config vitest.bd.config.ts`.
4. Servidor de desarrollo contra la rama (nunca `npm run dev` a secas): `node -e "require('dotenv').config({path:'.env.local',quiet:true});process.env.DATABASE_URL=process.env.DATABASE_URL_PRUEBAS;require('child_process').spawn('npx',['next','dev'],{stdio:'inherit',shell:true})"`.
5. **Producción (diferida hasta cerrar los 18 ítems):** `npm run db:migrate` **antes** de desplegar (la landing consulta `resenas`; aunque el error se tolera, hay que migrar primero), `npx vercel deploy --prod`, `GET /api/salud` = `200 {"estado":"ok"}`, prueba de humo y limpieza.
6. Marcha atrás: redesplegar el commit anterior; la tabla nueva no estorba al código anterior.

## Open Questions

1. **¿Una reseña rechazada se puede editar y reenviar, o el rechazo es definitivo?** Se asumió editable y reenviable (decisión 4). Sin límite de reenvíos.
2. **¿Se aceptan los largos (10 a 500 caracteres) y los datos públicos (nombre de pila, distrito, estrellas, comentario, mes)?** El PRD no los define (decisiones 2 y 6). Cambiarlos no cuesta migración.
3. **¿Hace falta despublicar una reseña aprobada, o que el administrador edite el comentario?** El PRD no lo pide; no se incluye. Es un ítem pequeño aparte.
4. **¿Se actualiza el texto de `TECH-DESIGN.md` y del ADR 0002** (`aprobada` → `estado`)? Propuesta en el reporte.
