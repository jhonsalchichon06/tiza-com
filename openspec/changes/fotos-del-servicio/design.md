## Context

Ver `proposal.md`. Estado verificado leyendo el código y los changes previos:

- **#8 (aplicado en local, `src/lib/imagenes/`):** `subirImagen` (navegador) con destino `{ tipo: "foto", reservaId }` sube a `fotos/{reservaId}/` con sufijo aleatorio; `POST /api/subidas` emite token de `fotos/` solo a un administrador; `verificarImagenSubida({ ruta, usuario })` devuelve `{ ruta, tipo, tamano }` y debe llamarse antes de abrir la transacción; `crearRutaEntrega({ obtenerRecurso })` y `entregarImagen` (404 sin leer Blob si `autorizar` niega); `COLUMNAS_CON_IMAGEN` en `referencias.ts` tiene solo `pagos.comprobanteRuta`, y `columnasDeRutaSinDeclarar` falla si una columna llamada `ruta` del esquema no está declarada; el cron `huerfanos.ts` ya lista `fotos/`.
- **Hallazgo en `rutas.ts`:** `validarRutaSubida` comprueba que la ruta esté en `fotos/{cualquier reservaId válido}/` para un administrador, pero **no** que ese `reservaId` sea el de la reserva que se está registrando. Esa comparación es de este change (decisión 3).
- **`reservas.estado`** ya tiene `completada`; **`fotos_servicio` no existe** en `src/db/esquema.ts`. La última migración aplicada es la `0005`; #10, #11 y #12 agregan las siguientes.
- **#16 (`gestion-de-reservas-y-apoyo`, solo propose):** marca `completada` a mano (solo una `confirmada` que ya empezó), deja `src/lib/admin/reservas/` y `app/admin/reservas/page.tsx` con la lista, y fija el patrón de rutas de administración (`requerirAdmin`, `415`, id uuid o `404`, `conReintento` con `errorOriginal`, `manejar`).
- **#12 (`perfil-reservas-y-membresia`, solo propose):** `leerDetalleReserva` en `src/lib/perfil/detalle.ts` (consulta con `usuario_id` en el `WHERE`, `404` para lo ajeno, sin `equipo_id`), `listarHistorial` en `src/lib/perfil/reservas.ts`, la página `app/(cuenta)/cuenta/reservas/[id]/page.tsx` con "el espacio reservado para fotos y reseña". Este change lo llena.
- **Patrón de entrega ya construido:** `app/api/comprobantes/[id]/route.ts` y `src/lib/pagos/comprobante.ts` (`obtenerComprobante`: uuid o `null`, `conReintento`, doble comprobación dueño + carpeta). `obtenerFoto` lo imita.
- **Entorno:** migraciones solo a la rama de Neon `pruebas` (`DATABASE_URL_PRUEBAS`); `DATABASE_URL` de `.env.local` es producción. Producción queda diferida. Sin Playwright.
- **Código de bibliotecas:** no se afirma nada nuevo sobre `@vercel/blob`: la subida y la lectura ya las verificó #8.

## Goals / Non-Goals

**Goals:**

- Que el administrador suba varias fotos a una reserva `completada`, cada una con su ambiente, y que solo así se puedan registrar (PRD alcance 9 y "solo una reserva completada puede tener fotos").
- Que el cliente vea solo las fotos de sus propias reservas en su historial; todo lo ajeno da `404`.
- Que ninguna foto en uso la borre el cron.

**Non-Goals:**

- **Borrar, reemplazar o reordenar fotos.** El PRD solo pide subirlas. Riesgo y pregunta abierta 2.
- Reseñas (#18); avisar al cliente de fotos nuevas (el PRD no tiene notificaciones salientes); descargar todas las fotos en un zip; pie de foto libre; fotos de "antes y después" como categoría.
- Marcar `completada` o revertirla (#16).
- Compresión en el servidor: la hace el navegador (ADR 0010).
- Migrar o desplegar producción (diferido).
- Modificar `PRD.md`, `TECH-DESIGN.md`, los ADR o `BACKLOG.md`: lo que haga falta se propone en el reporte.

## Decisions

### 1. Tabla `fotos_servicio` y migración (ADR 0002, 0010)

Columnas: `id uuid` (defecto `gen_random_uuid`), `reserva_id uuid NOT NULL → reservas.id`, `ambiente text NOT NULL`, `ruta text NOT NULL UNIQUE`, `subida_por text NOT NULL → usuarios.id`, `creada_en timestamptz NOT NULL default now()`; índice `fotos_servicio_reserva_idx (reserva_id, creada_en)`. La migración se genera al aplicarse (`npm run db:generate -- --name=fotos-servicio`), después de las de #10, #11 y #12 si ya existen, y se aplica **solo a la rama `pruebas`**. Se agrega a mano al final el `INSERT` de la clave de `configuracion` de la decisión 4, con `ON CONFLICT ("clave") DO NOTHING`, como hizo #11.

- **`ruta` única:** la misma ruta no puede quedar en dos fotos ni en dos reservas; convierte un reintento duplicado en `409` en vez de dos filas.
- **Sin `ON DELETE CASCADE`:** igual que el resto del esquema (las reservas no se borran; el historial se conserva). La limpieza de pruebas borra las fotos antes que las reservas.
- **Sin `CHECK` del ambiente en la base:** la lista puede crecer sin migración; la valida el servidor (decisión 5).
- **Declarar `COLUMNAS_CON_IMAGEN`:** `{ tabla: fotosServicio, columna: fotosServicio.ruta }`. Sin esto, el cron borraría las fotos a las 24 horas; la prueba de #8 lo vigila, y este change agrega una prueba propia que lee las rutas de `fotos_servicio` con `leerRutasReferenciadas`.
- **Descartada:** guardar `tipo` y `tamano` de la imagen. Nadie los consulta y la verificación ya los comprobó al registrar.
- **Descartada:** columna `orden`. Se ordena por `creada_en`; reordenar es un Non-Goal.

### 2. Ruta de registro: `POST /api/admin/reservas/:id/fotos` (ADR 0003, 0005, 0010)

Orden de pasos, que sigue el ADR 0010 y la nota de #8 ("comprobar que la reserva exista y esté completada antes de registrar"):

1. `requerirAdmin` (`401`/`403`) → `415` si no es JSON → id uuid o `404` → cuerpo con zod: `{ fotos: [{ ruta: string, ambiente: enum }] }`, de 1 a N elementos (`422`).
2. **Lectura previa, sin Blob:** `SELECT estado FROM reservas WHERE id` → `404` si no existe → `409` si no es `completada`. Evita gastar llamadas a Blob (plan Hobby) con una reserva que no sirve y da el mensaje claro antes que los demás errores.
3. **Verificación fuera de la transacción:** por cada foto, `verificarImagenSubida({ ruta, usuario })` y, además, que la ruta devuelta empiece por `fotos/<id de la URL>/` (`422` si no). Se verifican en secuencia o con poca concurrencia; si una falla, no se escribe nada.
4. **Escritura:** `transaccionDeEscritura`: `SELECT ... FOR UPDATE` de la reserva → vuelve a exigir `completada` (otro administrador podría haberla cambiado; hoy nadie la revierte, pero la regla vive donde se escribe) → cuenta las fotos existentes → si `existentes + nuevas > límite`, `409` → `INSERT` de todas con `returning`.
5. Responde `201` con `[{ id, ambiente }]`; `Cache-Control: private, no-store`.

- **Por qué el estado se comprueba dos veces (pasos 2 y 4):** el paso 2 es barato y evita Blob; el 4 es la garantía real bajo bloqueo. Descartado dejar solo el 4: cada error de estado costaría llamadas a Blob; descartado solo el 2: hay una ventana entre la lectura y la escritura.
- **Reintento:** `conReintento` con `errorOriginal` (patrón de #16). Si el primer intento se confirmó y la conexión se cortó en el `COMMIT`, el segundo choca con `ruta` única y responde `409`, que es verdad y no duplica nada. Se reconoce `23505` (también dentro de `cause`) y se traduce a `409` "Esas fotos ya estaban registradas."
- **Por qué todo o nada:** un envío parcial dejaría al administrador sin saber qué quedó. El cliente de la pantalla solo envía las rutas que subieron bien (decisión 6), así que "todo o nada" vale por envío.
- **Descartada:** una ruta por foto (`POST` repetido). Multiplica los viajes a Neon (puede estar dormido), complica el límite y no da atomicidad.
- **Descartada:** Server Actions. El ADR 0003 prefiere un contrato HTTP que se prueba con `curl` y Vitest.
- **Descartada:** usar `onUploadCompleted` de Blob para crear la fila: #8 decidió no usarlo (la fila se crea en la ruta de negocio).
- **Descartada:** que la ruta de registro reciba el `reservaId` en el cuerpo. Viene de la URL; un solo origen.

### 3. La carpeta debe ser la de esa reserva

`validarRutaSubida` (de #8) solo prueba que un administrador use una carpeta `fotos/<id válido>/`. Si no se comparara con la reserva de la URL, un administrador podría registrar en la reserva A un archivo subido a la carpeta de B, y `autorizar` de la entrega (decisión 7) lo vería como incoherente. Se compara `ruta.startsWith("fotos/" + id + "/")` sobre la ruta que **devuelve** `verificarImagenSubida` (nunca sobre lo que envió el navegador). No se modifica `src/lib/imagenes/` (código de #8); la comprobación vive en `registrar.ts`.

- **Descartada:** extender `verificarImagenSubida` con un parámetro `carpetaEsperada`. Sería mejor para reutilizar, pero toca un ítem ya aplicado; se propone en el reporte por si el usuario lo prefiere.

### 4. Límite de fotos: 12 por reserva, como dato (supuesto marcado)

**Supuesto, no confirmado por el negocio:** 12 fotos como máximo por reserva. El PRD no fija un número. Razonamiento: una limpieza de un hogar grande cubre cocina, 2 o 3 baños, 3 o 4 dormitorios, sala y comedor; 12 deja una o dos fotos por ambiente. Con la compresión de #8 (objetivo de 1 MB), 12 fotos son unos 12 MB por reserva, es decir unas 80 reservas por GB de Blob (plan Hobby, ADR 0010). Se guarda como `fotos_maximas_por_reserva` en `configuracion` (entero positivo, marcado `provisional = true` porque es un supuesto), con esquema zod en `src/lib/configuracion.ts` y valor en `VALORES_DEL_DISENO`. Las pruebas de "define exactamente las N claves" y de migraciones se ajustan al número que haya al aplicarse (#11 y #12 también suman una clave cada uno).

- **Por qué un dato y no una constante:** TECH-DESIGN: "Precios, duraciones, montos y plazos son datos". Es un límite de negocio que puede cambiar con el plan de Blob.
- **Descartada:** sin límite. Una sola reserva podría llenar el GB de Blob y bloquear la subida de comprobantes 30 días (ADR 0010).
- **Descartada:** límite solo en el navegador. El servidor es quien manda.
- **Límite del tamaño por archivo:** el de #8 (5 MB original, 4 MB subido); no se redefine.
- Tope por envío = el límite; la comprobación con el conteo existente es la que cuenta.

### 5. Ambientes: lista cerrada en un módulo (supuesto marcado)

`src/lib/fotos/ambientes.ts` exporta `AMBIENTES = ["cocina","bano","dormitorio","sala","comedor","lavanderia","otro"]` y sus etiquetas ("Cocina", "Baño", "Dormitorio", "Sala", "Comedor", "Lavandería", "Otro"), más `etiquetaDeAmbiente`. El esquema zod de la ruta usa `z.enum(AMBIENTES)`. **Supuesto:** el PRD dice solo "ambiente"; una lista cerrada permite agrupar en el historial y evita texto libre con errores. Si el negocio quiere otros, es un cambio en un archivo (y no requiere migración porque no hay `CHECK`).

- **Descartada:** texto libre. Agruparía mal ("Baño", "baño", "Baños") y obligaría a normalizar.
- **Descartada:** tomar los ambientes de la reserva (dormitorios y baños). Es solo un dato de tamaño del hogar, no de dónde se tomó la foto; las reservas por horas no lo tienen.
- **Descartada:** guardar la lista en `configuracion`. No es un parámetro de precio ni de plazo y complicaría la validación; queda en código.

### 6. Pantalla de subida y flujo del navegador

`app/admin/reservas/[id]/fotos/page.tsx` (servidor: lee reserva, límite y fotos con funciones de `src/lib/fotos/`, sin pasar por HTTP) y `SubirFotos.tsx` (cliente). La lógica vive en `src/lib/fotos/subir-lote.ts`, función pura con dependencias inyectadas (`subir`, `registrar`) para probarla sin DOM ni red: sube los archivos con una concurrencia pequeña (2, porque el celular o la conexión del administrador pueden ser lentos), junta las rutas que subieron bien, hace **un** `POST` con ellas y devuelve `{ registradas, fallidas }`. Las fallidas quedan en la lista con "Reintentar"; las registradas se quitan de la selección, así un reintento no las duplica.

- **Por qué registrar lo que sí subió:** subir 8 fotos de un celular en una conexión inestable y perderlas todas por una falla es lo peor para quien trabaja (el administrador es una persona sola). El servidor sigue siendo todo o nada por envío.
- **Si el `POST` falla** (por ejemplo `409` por el límite), las rutas subidas quedan sin fila y las limpia el cron en 24 horas (ADR 0010); la pantalla conserva la selección para reintentar con menos fotos.
- **Descartada:** subir y registrar foto por foto. Más viajes, y el límite se comprobaría tarde.
- **Descartada:** arrastrar y soltar con reordenado. Complejidad que el PRD no pide.
- Textos grandes y botones de 48 px o más, igual que las demás pantallas. Vista previa con `URL.createObjectURL` (liberado al quitar).

### 7. Entrega: `GET /api/fotos/:id` (ADR 0010, 0005)

`app/api/fotos/[id]/route.ts`: `export const GET = crearRutaEntrega({ obtenerRecurso: obtenerFoto })`. `obtenerFoto(id, usuario)` en `src/lib/fotos/entrega.ts`: id sin formato de uuid → `null`; `SELECT f.ruta, f.reserva_id, r.usuario_id FROM fotos_servicio f JOIN reservas r ...` con `conReintento` + `errorOriginal` → `null` si no existe; `autorizar = (u, ruta) => u.rol === "admin" || (u.id === dueño && ruta.startsWith("fotos/" + reservaId + "/"))`, la misma doble comprobación de `obtenerComprobante`. `entregarImagen` ya responde `404` sin leer Blob cuando se niega.

- **Por qué `404` y no `403`:** para no confirmar que existe (TECH-DESIGN, perfil; ADR 0005).
- **El dueño ve la foto sin otra condición de estado:** solo una reserva `completada` puede tener fotos (se exige al registrar) y #16 no revierte `completada`.
- **Descartada:** URLs firmadas de Blob. Queda como alternativa por verificar del ADR 0010; entregar por `/api` ya funciona y las fotos pesan 4 MB o menos.
- **Sin caché del navegador (`no-store`):** lo fija `entregarImagen`. Cada visita al historial vuelve a pedir las imágenes por la función. Es un costo aceptado (Riesgos); con `loading="lazy"` se piden solo las visibles.

### 8. Fotos en el perfil del cliente (extiende #12)

- `leerDetalleReserva` (#12) agrega `fotos: [{ id, ambiente, etiqueta }]` con una segunda consulta **después** de haber cargado la reserva con el `usuario_id` de la sesión (nunca por `reserva_id` suelto sin ese antecedente), solo si la reserva está `completada`. No devuelve `ruta`.
- `listarHistorial` (#12) agrega `total_fotos` con un conteo por reserva, filtrado por `reservas.usuario_id`, en la misma consulta del historial (subconsulta o `LEFT JOIN ... GROUP BY`), sin traer filas de fotos.
- La página de detalle (#12) llena su espacio con `FotosDelServicio` (componente de servidor, agrupa por ambiente). `<img loading="lazy" alt="Cocina">`; no usa `next/image` (la ruta es privada y con cookie; el optimizador no la podría pedir con la sesión).
- Se edita sobre el contenido de #12 al aplicar. **No se cambia la firma de lo que #12 exporta, solo se agregan campos.**
- **Descartada:** una ruta `GET /api/reservas/:id/fotos`. El detalle ya trae la lista y un viaje menos a Neon.
- **Descartada:** mostrar las fotos en el listado del historial. Cargaría hasta 50 reservas × 12 imágenes.

### 9. Administrador: listar fotos y enlace

`listarFotosDeReserva(base, reservaId)` (compartida con la pantalla) devuelve las fotos ordenadas por `creada_en`. No hay `GET /api/admin/.../fotos`: la pantalla de servidor usa la función; el administrador ve las imágenes con `/api/fotos/:id`. La lista de #16 recibe el enlace "Fotos" en filas `completada` (cambio de una línea en `app/admin/reservas/page.tsx`, sobre su contenido al aplicar; si el archivo no existe aún, se pausa).

## Cobertura de los criterios de `TECH-DESIGN.md`

| Criterio | Escenario en | Tarea |
|---|---|---|
| (Portal) El administrador puede subir fotos (JPG, PNG o WebP de hasta 5 MB) a una reserva completada | `registro-de-fotos-admin` (registrar, reserva no completada, archivo inexistente, contenido que no es imagen, imagen de 5 MB original), `pantalla-fotos-admin` | 3.1 a 3.4, 5.1 a 5.3, 8.2 |
| (Portal) Solo una reserva completada (PRD alcance 9) | `registro-de-fotos-admin` (Reserva no completada) | 3.2, 8.2 |
| (Perfil) El cliente ve solo sus propias fotos | `entrega-de-fotos` (foto de otro cliente), `fotos-en-historial` (solo mis fotos) | 4.1, 6.1, 6.2, 8.3 |
| (Perfil) Abrir por la URL algo de otro cliente responde `404` | `entrega-de-fotos`, `fotos-en-historial` (reserva de otro cliente) | 4.1, 4.2, 8.3 |
| (Perfil) El historial muestra el detalle con sus fotos | `fotos-en-historial` | 6.1 a 6.4 |
| (Comprobantes y errores) El servidor rechaza registrar un archivo que no existe o está en la carpeta de otro | `registro-de-fotos-admin` (verificación y carpeta) | 3.3, 8.2 |
| (Comprobantes y errores) Si falla la subida, no se crea la fila | `pantalla-fotos-admin` (falla una subida), `registro-de-fotos-admin` (todo o nada) | 3.3, 5.1 |
| (Comprobantes y errores) Una foto se entrega por `/api` sin error aunque el original pesara 5 MB | `entrega-de-fotos` (imagen de 4 MB), `registro-de-fotos-admin` (5 MB original) | 4.1, 4.2 |
| (Comprobantes y errores) La limpieza diaria no borra lo que se usa | `registro-de-fotos-admin` (El cron no borra una foto en uso) | 1.4, 1.5, 8.4 |
| (Errores) Neon dormido: un reintento y luego "inténtalo en unos segundos" | `registro-de-fotos-admin` (errores de conexión) | 3.5 |
| (Portal) Un usuario sin rol `admin` recibe `403` o es redirigido | `registro-de-fotos-admin`, `pantalla-fotos-admin` | 3.5, 5.4 |
| (Capacidad de Blob, ADR 0010) límite por reserva | `registro-de-fotos-admin` (límite) | 2.1, 3.2, 8.2 |

## Risks / Trade-offs

- **[Sin borrar fotos]** → una foto equivocada (de otro hogar, borrosa) queda visible para el cliente y ocupa un lugar del límite. Mitigación: la pantalla advierte antes de subir y pide revisar la vista previa; el límite de 12 deja holgura. Hoy se corrige a mano en la base. Si se vuelve frecuente, ítem aparte (pregunta abierta 2).
- **[Foto de otro cliente subida por error a otra reserva]** → el administrador puede asignar una foto a la reserva equivocada si abre mal la pantalla. Mitigación: la pantalla muestra cliente, servicio y fecha arriba.
- **[Privacidad]** → las fotos muestran el interior de un hogar. Son privadas y solo las ven el administrador y el dueño (`404` para los demás); no se usan en la landing (la reseña, #18, no incluye fotos).
- **[Huérfanos entre subida y registro]** → archivos subidos cuyo registro falló ocupan Blob hasta 24 horas (ADR 0010). Con 12 fotos de 1 MB, es poco.
- **[Costo de entregar por `/api`]** → cada imagen pasa por una función de Vercel (sin caché). Un historial con muchas fotos genera muchas invocaciones; `loading="lazy"` y el límite de 12 lo acotan. Alternativa por verificar: URLs firmadas (ADR 0010).
- **[Dependencia de #12 y #16, solo con propose]** → los nombres (`leerDetalleReserva`, `listarHistorial`, `app/admin/reservas/page.tsx`) vienen de sus diseños. Si al aplicarse son otros, se ajusta; si no existen, se pausa en la tarea 1.1 (no se reescribe su contenido aquí).
- **[Completar por error en #16]** → habilitaría subir fotos a una limpieza que no ocurrió. Ya mitigado en #16 (confirmación y solo servicios iniciados).
- **[Número de claves de `configuracion`]** → las pruebas que cuentan claves dependen del orden de aplicación de #11, #12 y este change. Se ajustan al aplicar.
- **[Subida desde un celular lento]** → 2 subidas en paralelo y reintento de las fallidas; la compresión de #8 reduce el peso.

## Migration Plan

1. Al arrancar, comprobar (tarea 1.1) que existen #8 en el código, y los puntos de extensión de #12 y #16. Si falta alguno, pausar.
2. Cambiar `src/db/esquema.ts` (tabla e índice), `src/lib/configuracion.ts`, el fixture y `referencias.ts`. Generar la migración con `npm run db:generate -- --name=fotos-servicio`, revisar el SQL (solo `CREATE TABLE`, `CREATE INDEX`, `UNIQUE`, claves foráneas; sin tocar `reservas_sin_solape_por_equipo`) y agregar a mano el `INSERT` de `fotos_maximas_por_reserva` (`provisional = true`) con `ON CONFLICT ("clave") DO NOTHING`.
3. Aplicar **solo a la rama `pruebas`**: `node -e "require('dotenv').config({path:'.env.local',quiet:true});process.env.DATABASE_URL=process.env.DATABASE_URL_PRUEBAS;require('child_process').execSync('npx drizzle-kit migrate',{stdio:'inherit'})"` (no imprime la cadena). Luego `PRUEBAS_BD=1 npx vitest run --config vitest.bd.config.ts`.
4. Servidor de desarrollo contra la rama (nunca `npm run dev` a secas): `node -e "require('dotenv').config({path:'.env.local',quiet:true});process.env.DATABASE_URL=process.env.DATABASE_URL_PRUEBAS;require('child_process').spawn('npx',['next','dev'],{stdio:'inherit',shell:true})"`.
5. **Producción (diferida hasta cerrar los 18 ítems):** `npm run db:migrate` **antes** de desplegar (sin la clave nueva `leerConfiguracion` falla), `npx vercel deploy --prod`, `GET /api/salud` = `200 {"estado":"ok"}`, prueba de humo y limpieza.
6. Marcha atrás: redesplegar el commit anterior; la tabla y la clave nuevas no estorban al código anterior (el cron anterior no conocería `fotos_servicio.ruta` y **borraría las fotos de más de 24 horas**: por eso, si se vuelve atrás después de haber fotos reales, hay que deshabilitar el cron antes).

## Open Questions

1. **¿Se acepta el supuesto de 12 fotos por reserva y la lista de ambientes?** El PRD no los define. Son datos/módulo de un archivo: cambiarlos no cuesta migración.
2. **¿Hace falta que el administrador pueda borrar o reemplazar una foto?** El PRD no lo pide; este change no lo incluye. Es un ítem pequeño aparte (ruta `DELETE`, borrar el archivo de Blob, quitar la fila).
3. **¿Se prefiere que `verificarImagenSubida` reciba la carpeta esperada** (decisión 3) en lugar de comprobarla en `registrar.ts`? Sería más reutilizable, pero cambia código ya aplicado de #8.
