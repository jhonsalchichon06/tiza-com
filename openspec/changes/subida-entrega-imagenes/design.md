# Design

## Context

El ADR 0010 fija el camino: validar y comprimir en el navegador, subir directo a una tienda **privada** de Vercel Blob con un token que emite `/api`, registrar la ruta en una ruta de negocio que la verifica, entregar por `/api` con permisos y limpiar huérfanos con un cron diario. El ADR 0005 da la sesión y los roles: `requerirSesion` y `requerirAdmin` en `src/lib/sesion.ts` leen el rol de la base en cada petición y lanzan `ErrorApi` (`401` y `403`); `manejar` en `src/lib/errores.ts` da el formato único de errores. Las variables de entorno se leen de forma perezosa en `src/lib/env.ts` (cada servicio con su función, para que `next build` y `/api/salud` no dependan de ellas).

Estado del código: `src/db/esquema.ts` solo tiene `configuracion`, `equipos` y las tablas de Better Auth. **No existen `pagos`, `reservas` ni `fotos_servicio`** (los crean los ítems #9 y #17). `@vercel/blob` no está en `node_modules` (el único paquete de imágenes presente es `sharp`, dependencia de Next).

**Verificación de la API de Blob: por verificar.** Como el SDK no está instalado, todo lo que sigue sobre `@vercel/blob` es lo que recuerda la documentación y se confirma en la tarea 1.2 leyendo `node_modules/@vercel/blob` tras instalarlo, antes de escribir código que lo use: (a) que `handleUpload` (en `@vercel/blob/client`) acepte tiendas privadas y su `onBeforeGenerateToken` devuelva `allowedContentTypes`, `maximumSizeInBytes`, `addRandomSuffix` y `tokenPayload`; (b) que exista una operación para leer un archivo privado en el servidor (`get`/equivalente) con su tipo, tamaño y cuerpo, y una para leer solo sus metadatos (`head`); (c) `list` con paginación (cursor) y fecha de subida, y `del` por ruta; (d) cómo se declara el acceso privado en `put`/`upload`; (e) si hay URLs firmadas con vencimiento corto; (f) si `onUploadCompleted` es obligatorio; (g) el nombre de la variable del token (`BLOB_READ_WRITE_TOKEN`). Si algo de esto es distinto, se ajusta este diseño antes de implementar y se avisa en el reporte.

## Goals / Non-Goals

**Goals:**
- Cubrir los criterios de aceptación de "Comprobantes privados y errores" de `TECH-DESIGN.md` y los de subida de imágenes (JPG, PNG, WebP, hasta 5 MB, incluido 4,5 a 5 MB) sobre una base reutilizable por los ítems #9, #11 y #17.
- Que ningún permiso dependa de datos que envía el navegador: la carpeta sale de la sesión.
- Que la limpieza de huérfanos nunca borre un archivo en uso.

**Non-Goals:**
- Crear `pagos`, `reservas`, `fotos_servicio` o sus rutas de negocio (`POST /api/reservas`, `POST /api/pagos`, subida de fotos): son de los ítems #9, #11 y #17.
- Las rutas por id `GET /api/comprobantes/:id` y `GET /api/fotos/:id`: necesitan esas tablas. Este ítem entrega la lógica y una fábrica de rutas ya probadas; los ítems #9/#11 y #17 solo las instancian con su resolvedor de permisos.
- Interfaz de usuario del asistente o del portal. Se entrega un módulo (`subirImagen`) que esas pantallas llamarán.
- Subir de verdad al plan de pago de Blob, miniaturas, rotación EXIF avanzada o recorte de imagen.
- Playwright (preferencia del proyecto después del ítem 1).

## Decisions

### 1. Subida directa con `handleUpload`, sin `onUploadCompleted`
`POST /api/subidas` usa `handleUpload` de `@vercel/blob/client`. En `onBeforeGenerateToken(pathname, clientPayload)` se valida la sesión y la carpeta (decisión 2) y se devuelve `{ allowedContentTypes: ["image/jpeg","image/png","image/webp"], maximumSizeInBytes: 4 * 1024 * 1024, addRandomSuffix: true }`. No se usa `onUploadCompleted`: ese callback es un webhook de Blob hacia nuestra URL pública (no funciona en local) y no hace falta, porque la fila se crea en la ruta de negocio con la ruta que el navegador ya conoce (ADR 0010, paso 4).
*Alternativa descartada:* subir a través de una función `/api` (ADR 0003 original): falla con más de ~4,5 MB, límite que el ADR 0010 ya descartó.
*Chequeo:* si el SDK exige `onUploadCompleted`, se pasa uno vacío que no hace nada (tarea 1.2).

### 2. La carpeta sale de la sesión, no del navegador
El navegador envía solo la ruta pedida (`pathname`) y, para fotos, un `clientPayload` con el tipo. El servidor calcula la carpeta permitida: `comprobantes/{usuario.id}/` para cualquier sesión, `fotos/{reservaId}/` solo si `usuario.rol === "admin"` (vía `requerirAdmin`). Una función pura `validarRutaSubida({ ruta, usuario })` en `src/lib/imagenes/rutas.ts` exige: prefijo exacto de la carpeta, un solo segmento de nombre sin `..`, `/`, `\` ni caracteres de control, longitud máxima y extensión `.jpg`, `.jpeg`, `.png` o `.webp`; devuelve `ErrorApi.invalido` en caso contrario. La misma función la reutiliza `verificarImagenSubida` (decisión 3), así la regla vive una vez. `reservaId` solo se valida por formato (`^[A-Za-z0-9_-]{1,64}$`): comprobar que la reserva existe y está completada es del ítem #17, que lo hará en su ruta antes de registrar la foto, porque la tabla no existe aún.
*Alternativa descartada:* dejar que el navegador elija la carpeta y comprobar después: permitiría emitir un token para una carpeta ajena.

### 3. Verificación del archivo en el servidor, por bytes
`verificarImagenSubida({ ruta, usuario })` en `src/lib/imagenes/verificar.ts`: (1) `validarRutaSubida`; (2) consulta los metadatos en Blob (`head`) y lanza `ErrorApi.noEncontrado`/`invalido` si no existe; (3) comprueba el tamaño ≤ 4 MB; (4) lee los primeros bytes y comprueba la firma real: JPEG `FF D8 FF`, PNG `89 50 4E 47 0D 0A 1A 0A`, WebP `RIFF....WEBP`. No se fía del `Content-Type` porque lo declara el navegador y Blob solo lo compara con la lista permitida. Devuelve `{ ruta, tipo, tamano }`. Las rutas de negocio la llaman **antes** de abrir su transacción de base de datos, para no mantenerla abierta durante la red.
*Alternativa descartada:* confiar en `allowedContentTypes` del token: un archivo ejecutable renombrado pasa. *Costo:* una lectura de hasta 4 MB por registro; si Blob permite leer por rango se piden solo 12 bytes (por verificar, tarea 1.2).

### 4. Compresión en el navegador con Canvas, sin dependencia
`src/lib/imagenes/cliente.ts` (solo navegador) exporta `validarArchivoOriginal(file)` (puro, probable en Vitest) y `prepararImagen(file)`. `prepararImagen` decodifica con `createImageBitmap` (que aplica la orientación EXIF con `imageOrientation: "from-image"`), calcula el tamaño con una función pura `calcularDimensiones(ancho, alto, max = 2000)` que no amplía, dibuja en un canvas (`OffscreenCanvas` si existe, `canvas` si no) y llama a `toBlob("image/webp", calidad)`; si el navegador devuelve PNG (no codifica WebP) reintenta en `image/jpeg`. Baja la calidad de 0,85 a 0,5 en pasos hasta llegar a 1 MB o menos, y si aun así supera 4 MB falla. Si cualquier paso lanza, `prepararImagen` devuelve el original solo si pesa ≤ 4 MB; si pesa más, lanza un error con el mensaje de pedir otra imagen. Un envoltorio `subirImagen(file, { tipo, onProgreso })` valida, prepara, pide el token y sube con `upload` de `@vercel/blob/client`, y devuelve la ruta final.
*Alternativa descartada:* `sharp` o `browser-image-compression`: `sharp` es de servidor (la imagen ya habría cruzado el límite de 4,5 MB) y la biblioteca añade peso por algo que Canvas resuelve.
*Nota:* un PNG de captura de pantalla de un Yape se re-codifica a WebP con pérdida; a 2000 px el número de operación sigue legible (ADR 0010), pero se deja una prueba manual con una captura real en las tareas.

### 5. Entrega: una función de permisos desacoplada de las tablas
`entregarImagen({ ruta, usuario, autorizar })` en `src/lib/imagenes/entrega.ts` recibe el usuario ya autenticado y una función `autorizar(usuario, ruta) → Promise<boolean>`. Si niega, lanza `ErrorApi.noEncontrado()` **sin leer Blob** (`404`, no `403`, como pide el PRD, para no confirmar que existe). Si autoriza, lee el archivo de Blob y devuelve una `Response` con el cuerpo, el `Content-Type` real, `X-Content-Type-Options: nosniff`, `Content-Disposition: inline` y `Cache-Control: private, no-store`. Nunca redirige a una URL de Blob. Se exporta `autorizarComprobantePorCarpeta`, que decide solo con la carpeta de la ruta (`comprobantes/{usuarioId}/` es dueño o admin) y sirve a los ítems #9 y #11. La fábrica `crearRutaEntrega({ obtenerRuta })` da el `GET` (sesión → `obtenerRuta(id)` busca la fila y devuelve la ruta y la autorización).
*Por qué no hay `/api/comprobantes/:id` todavía:* el `:id` es del pago y la tabla `pagos` no existe. Para no inventar un esquema que el ítem #9 debe diseñar, este ítem prueba todo el comportamiento con una ruta de ejemplo en las pruebas y deja el cableado a ese ítem.
*Alternativa descartada:* una ruta genérica `GET /api/imagenes?ruta=…`: el ADR 0010 pide entrega por id del recurso, y una ruta por ruta de archivo expondría el esquema de carpetas.
*Alternativa pendiente (ADR 0010):* URLs firmadas de vida corta eliminarían el tope de 4 MB; solo se usan si el SDK las ofrece para tiendas privadas (tarea 1.2). Si existen, se anota en el reporte como mejora y no cambia las rutas.

### 6. Cron de huérfanos con registro explícito de referencias
`limpiarHuerfanos({ listar, referencias, borrar, ahora })` en `src/lib/imagenes/huerfanos.ts` está inyectada (se prueba sin red). La ruta `GET /api/cron/huerfanos` la cablea a Blob y a Drizzle. Reglas: lista `comprobantes/` y `fotos/` paginando; descarta lo subido hace menos de 24 h; borra lo que no esté en el conjunto de rutas referenciadas. Ese conjunto sale de `COLUMNAS_CON_IMAGEN` (en `src/lib/imagenes/referencias.ts`): una lista de `{ tabla, columna }` de Drizzle que hoy está **vacía**. Con el registro vacío no se borra nada. Esto es deliberado: borrar "todo lo no referenciado" cuando todavía no existen las tablas sería correcto hoy, pero el día que el ítem #9 cree `pagos.comprobante_ruta` sin declararla, el cron borraría comprobantes reales a las 24 h. Una prueba lee el esquema de Drizzle y falla si encuentra una columna cuyo nombre termina en `_ruta` o `ruta_imagen` que no esté en el registro. Los ítems #9 (comprobantes) y #17 (fotos) tienen como tarea declarar su columna. La autenticación del cron es la cabecera `Authorization: Bearer ${CRON_SECRET}` que Vercel envía a los cron jobs (por verificar en la documentación vigente al implementar), comparada en tiempo constante.
*Alternativa descartada:* cron que borra por antigüedad sin consultar la base: borraría comprobantes aprobados. *Alternativa descartada:* tabla `archivos_subidos` que registre cada token emitido: duplica estado y no cubre los archivos subidos tras emitir el token sin registrar.
*Cron en el plan Hobby:* una vez al día; `vercel.json` gana `"crons": [{ "path": "/api/cron/huerfanos", "schedule": "0 8 * * *" }]` (08:00 UTC = 03:00 en Lima).

### 7. Errores y variables de entorno
Todas las rutas van envueltas en `manejar` (formato único de errores, ADR 0003/0006). Se agregan `leerEnvBlob` (`BLOB_READ_WRITE_TOKEN`) y `leerEnvCron` (`CRON_SECRET`) en `src/lib/env.ts`, cada una separada. Si falta el token de Blob, el error de configuración se registra y la ruta responde `503 no_disponible` ("Inténtalo en unos segundos."), igual que Neon dormido; nunca se filtra el detalle. Los errores de Blob (red, límite excedido) se traducen igual y no se reintentan (ADR 0006: sin reintentos complejos).

### Choques con ADR
Ninguno. Se desarrolla el ADR 0010 tal cual, con dos precisiones que se declaran aquí en vez de decidirlas en silencio: (1) la entrega por id (`/api/comprobantes/:id`, `/api/fotos/:id`) se difiere al cableado de los ítems #9/#11 y #17 porque sus tablas no existen; (2) el cron borra solo con un registro de columnas declarado. Se propone, si el usuario lo aprueba, anotar en `BACKLOG.md` (fuera de este change) que #9, #11 y #17 deben cablear la entrega y declarar su columna en `COLUMNAS_CON_IMAGEN`.

## Risks / Trade-offs

- **[API de Blob privado sin verificar]** `@vercel/blob` no está instalado, así que lo que se afirma sobre tiendas privadas, `handleUpload`, lectura en servidor, listado con fecha y URLs firmadas es memoria de la documentación. → La tarea 1.2 lo comprueba en `node_modules` antes de escribir código; si algo difiere se pausa y se informa. Es también el "por verificar" del ADR 0010 y de `TECH-DESIGN.md`.
- **[Tienda y token del usuario]** Sin una tienda **privada** de Blob (el acceso no se puede cambiar después de creada) y su token, no se puede probar la subida real ni desplegar. → Tarea del usuario 1.1; las pruebas Vitest usan un almacén simulado y no la requieren. Si el usuario crea la tienda pública por error, los comprobantes serían accesibles por URL: hay que crearla privada.
- **[Cron borra archivos en uso]** Si un ítem posterior guarda rutas de imagen sin declararlas en `COLUMNAS_CON_IMAGEN`. → Registro vacío = no borra, prueba de esquema que detecta columnas de ruta no declaradas, y tareas explícitas en los ítems #9 y #17 (decisión 6).
- **[Límites del plan Hobby de Blob]** 1 GB y operaciones limitadas; al excederlos se bloquea 30 días y no se podrían subir comprobantes. → La compresión a ~1 MB (ADR 0010) multiplica la capacidad; cada comprobante registrado cuesta una lectura de verificación (`head` más bytes) y una de entrega. Se revisa el consumo en el panel de Vercel tras el despliegue (tarea 7.5).
- **[Compresión depende del navegador]** Navegadores muy antiguos sin `createImageBitmap` o `toBlob`. → Respaldo al original si pesa ≤ 4 MB, si no se pide otra imagen (ADR 0010).
- **[Pérdida de legibilidad del comprobante]** La recompresión puede degradar un número de operación pequeño. → Máximo 2000 px y calidad mínima 0,5; prueba manual con una captura real de Yape (tarea 3.5). Si fuera ilegible, el administrador rechaza el pago y el cliente sube otra.
- **[Archivos huérfanos hasta 24 h+]** Ocupan espacio hasta el cron diario; con el cron una vez al día pueden vivir hasta ~48 h. → Aceptado por el ADR 0010.
- **[Fotos sin comprobar la reserva]** El token de fotos de un administrador solo valida el formato del `reservaId`. → Es admin de confianza; el ítem #17 verifica que la reserva exista y esté completada antes de guardar la foto.
- **[Descarga de 4 MB por entrega]** Cada vista de comprobante lee hasta 4 MB desde Blob por la función. → Aceptable por el volumen del negocio; `no-store` evita guardar copias en cachés compartidas.
- **[Sin límite de subidas por usuario]** Un cliente puede emitir muchos tokens y subir archivos que ocupan espacio hasta el cron. → Mismo riesgo abierto que el bloqueo con varias cuentas de `TECH-DESIGN.md`; el firewall de Vercel o un tope por usuario quedan para un ítem aparte.

## Migration Plan

No hay migraciones de base de datos. Orden: (1) el usuario crea la tienda privada de Blob y carga `BLOB_READ_WRITE_TOKEN` y `CRON_SECRET` en Vercel y `.env.local`; (2) implementar y probar con almacén simulado; (3) `npm run build`; (4) desplegar con `npx vercel deploy --prod` y comprobar `GET /api/salud`; (5) prueba real con `curl` y un archivo de prueba en la carpeta de una cuenta `@tiza.test`, que se borra al terminar. Reversión: redesplegar el commit anterior; los archivos de Blob sobrantes los borra el cron o a mano.

## Open Questions

- Ninguna decisión del PRD (`<!-- REVISAR -->`) bloquea este ítem: la nota sobre Vercel Blob privado del PRD es justamente lo que este ítem implementa, y su verificación es la tarea 1.2.
- Confirmar con el usuario que acepta diferir `GET /api/comprobantes/:id` y `GET /api/fotos/:id` a los ítems #9/#11 y #17 (ver Choques con ADR).

## Verificación de la API de Blob (tarea 1.2)

Se instaló `@vercel/blob` 2.8.2 y se leyeron sus tipos y su código en `node_modules/@vercel/blob/dist`. Resultado de los puntos (a) a (g):

- **(a)** `handleUpload` (en `@vercel/blob/client`) recibe `{ body, request, onBeforeGenerateToken, onUploadCompleted? }`, y `onBeforeGenerateToken(pathname, clientPayload, multipart)` puede devolver `allowedContentTypes`, `maximumSizeInBytes`, `validUntil`, `addRandomSuffix`, `allowOverwrite`, `cacheControlMaxAge` y `tokenPayload`. Coincide con el diseño.
- **(b)** `get(rutaOUrl, { access: "private" })` devuelve `{ statusCode: 200, stream, headers, blob: { contentType, size, ... } }` (o `304`/`null` si no existe). `head(ruta)` devuelve `size`, `contentType`, `uploadedAt` y `pathname`. Para verificar la firma del archivo se lee solo el primer fragmento del `stream` y se cancela, sin bajar los 4 MB.
- **(c)** `list({ prefix, cursor, limit, mode })` devuelve `{ blobs[{ pathname, size, uploadedAt, ... }], cursor, hasMore }`. `del(rutaOUrl | lista)` borra por ruta.
- **(d)** El acceso privado se declara con `access: "private"` en `put`, `upload`, `get`, `head` y `del`.
- **(e)** Existen URLs firmadas de vida corta (`presignUrl` con `operation: "get"` y `validUntil`), que requieren un token de delegación. No se usan en este ítem: la entrega pasa por `/api` (decisión 5). Queda como mejora posible.
- **(f)** `onUploadCompleted` es opcional. No se usa.
- **(g)** La variable es `BLOB_READ_WRITE_TOKEN`. El SDK también acepta `BLOB_STORE_ID` y el token OIDC de Vercel; no se usan.

Nada contradice el diseño. `handleUpload` valida su propia firma del cuerpo con ese token, así que `POST /api/subidas` no necesita más secretos.

## Contrato para #9, #11 y #17 (tarea 5.3)

- La ruta de negocio que recibe una ruta de imagen (`POST /api/reservas` o `POST /api/pagos` en #9 y #11, la subida de fotos en #17) llama a `verificarImagenSubida({ ruta, usuario })` (`src/lib/imagenes/verificar.ts`) **antes** de abrir su transacción de base de datos, y guarda en la fila solo la `ruta` que devuelve (`ImagenVerificada`), nunca la que envió el navegador.
- Si la verificación lanza (`404`, `422` o `403`), la ruta de negocio no crea ni el pago ni la reserva.
- La entrega usa `crearRutaEntrega` y `autorizarComprobantePorCarpeta` (`src/lib/imagenes/entrega.ts`): cada ítem instancia su `GET /api/comprobantes/:id` o `GET /api/fotos/:id` con su resolvedor de permisos.
- Cada ítem que guarda rutas de imagen declara su columna en `COLUMNAS_CON_IMAGEN` (`src/lib/imagenes/referencias.ts`); una prueba falla si el esquema tiene una columna de ruta de imagen sin declarar, y con el registro vacío el cron no borra nada.
