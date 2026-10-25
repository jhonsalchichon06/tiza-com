## 1. Tienda de Blob y dependencia

- [x] 1.1 **Tarea del usuario:** crear una tienda de Vercel Blob **privada** (el acceso no se puede cambiar después) en el proyecto `tiza-com`, y definir `CRON_SECRET` (un valor aleatorio de 32 caracteres o más); cargar `BLOB_READ_WRITE_TOKEN` y `CRON_SECRET` en Vercel (producción, preview y desarrollo) y en `.env.local` con `npx vercel env pull .env.local`. Nunca escribirlos en el repositorio
- [x] 1.2 Instalar `@vercel/blob` con `npm install` fijando la versión, y **verificar leyendo `node_modules/@vercel/blob`** los puntos (a) a (g) de "Verificación de la API de Blob" en `design.md` (tiendas privadas con `handleUpload`, lectura en servidor, `head`, `list` con cursor y fecha, `del`, URLs firmadas, `onUploadCompleted`, nombre de la variable). Anotar los hallazgos en `design.md` y pausar si algo contradice el diseño
- [x] 1.3 Agregar `leerEnvBlob` (`BLOB_READ_WRITE_TOKEN`) y `leerEnvCron` (`CRON_SECRET`, mínimo 32 caracteres) en `src/lib/env.ts`, cada una separada, con sus pruebas en `env.test.ts`
- [x] 1.4 Documentar `BLOB_READ_WRITE_TOKEN` y `CRON_SECRET` en `.env.example`, sin valores

## 2. Reglas de rutas y archivos (puras)

- [x] 2.1 Crear `src/lib/imagenes/tipos.ts` con las constantes: tipos permitidos (`image/jpeg`, `image/png`, `image/webp`), extensiones, 5 MB originales, 4 MB subidos, 1 MB objetivo, 2000 px, 24 h de huérfanos
- [x] 2.2 Crear `src/lib/imagenes/rutas.ts` con `validarRutaSubida({ ruta, usuario })` y `carpetaPermitida(usuario, tipo, reservaId)`: carpeta exacta de la sesión, un segmento, extensión permitida, sin `..`, `/` extra, `\` ni caracteres de control, y formato de `reservaId`
- [x] 2.3 Pruebas de `rutas.ts`: carpeta propia válida, carpeta de otro usuario `422`, `..`, extensión `.gif`, nombre vacío, `fotos/` solo con rol `admin`
- [x] 2.4 Crear `src/lib/imagenes/firmas.ts` con `detectarTipoImagen(bytes)` (JPEG, PNG y WebP por sus bytes iniciales) y sus pruebas: tres tipos válidos, un PDF y un ejecutable con extensión `.png` rechazados, buffer corto

## 3. Navegador: validar y comprimir

- [x] 3.1 Crear `src/lib/imagenes/cliente.ts` con `validarArchivoOriginal(file)` (tipo y extensión permitidos, máximo 5 MB, mensajes en español de Perú) y `calcularDimensiones(ancho, alto, max)` sin ampliar
- [x] 3.2 Agregar `prepararImagen(file)`: `createImageBitmap` con orientación EXIF, canvas, WebP con respaldo a JPEG, calidad descendente de 0,85 a 0,5 hasta 1 MB, falla si supera 4 MB, y respaldo al original solo si pesa 4 MB o menos
- [x] 3.3 Agregar `subirImagen(file, { tipo, reservaId, onProgreso })`: valida, prepara, pide el token a `POST /api/subidas` y sube con `upload` de `@vercel/blob/client`; devuelve la ruta final; un fallo no deja nada registrado y devuelve un mensaje para reintentar
- [x] 3.4 Pruebas Vitest de `cliente.ts` con dobles de `createImageBitmap` y canvas: PDF y GIF rechazados, 5,1 MB rechazado, 4,8 MB aceptado y comprimido, 4000 × 3000 px sale a 2000 × 1500, 800 × 600 no se amplía, falla de compresión con 3 MB sube el original, falla con 4,8 MB pide otra imagen, y la subida fallida no llama a ninguna ruta de negocio
- [ ] 3.5 Prueba manual (no automatizada, sin Playwright): comprimir una captura real de comprobante de Yape y comprobar que el número de operación sigue legible

## 4. Token de subida

- [x] 4.1 Crear `src/lib/imagenes/subidas.ts` con `manejarSolicitudSubida(body, request, usuario)` sobre `handleUpload`: `onBeforeGenerateToken` valida con `validarRutaSubida`, exige `requerirAdmin` para fotos y devuelve tipos, 4 MB y `addRandomSuffix`; el almacén de Blob se inyecta para probar sin red
- [x] 4.2 Crear `app/api/subidas/route.ts` (`POST`, envuelto en `manejar`, con `requerirSesion`, JSON obligatorio) y traducir la falta de `BLOB_READ_WRITE_TOKEN` a `503 no_disponible` registrando el error
- [x] 4.3 Pruebas: `401` sin sesión, token solo para la carpeta del usuario, `422` para carpeta ajena, `..` y `.gif`, `403` a un cliente que pide `fotos/`, token de `fotos/` para un administrador, límites de tipo y tamaño en el token emitido, y `503` sin variable de entorno

## 5. Verificación del archivo subido

- [x] 5.1 Crear `src/lib/imagenes/verificar.ts` con `verificarImagenSubida({ ruta, usuario }, almacen)`: `validarRutaSubida`, metadatos en Blob (`404` si no existe), tamaño ≤ 4 MB y firma real con `detectarTipoImagen`; devuelve `{ ruta, tipo, tamano }`
- [x] 5.2 Pruebas con almacén simulado: archivo válido, inexistente, carpeta de otro usuario, contenido de PDF con extensión `.png`, y archivo de 4,3 MB, todos con el código de error esperado y sin que la función cree filas
- [x] 5.3 Exportar un tipo y documentar en `design.md` el contrato que deben seguir los ítems #9, #11 y #17: llamar a `verificarImagenSubida` antes de abrir su transacción y guardar solo la ruta devuelta

## 6. Entrega privada y limpieza

- [x] 6.1 Crear `src/lib/imagenes/entrega.ts` con `entregarImagen`, `autorizarComprobantePorCarpeta` y `crearRutaEntrega`: `404` sin leer Blob si se niega el permiso, cabeceras `Content-Type`, `nosniff`, `inline` y `Cache-Control: private, no-store`, sin redirección a Blob, y `404` si el archivo ya no existe
- [x] 6.2 Pruebas de entrega: el dueño y el administrador reciben `200`, otro cliente `404` sin lectura de Blob, sin sesión `401`, un resolvedor que niega da `404`, la imagen de 4 MB sale completa, y no hay cabecera `Location` ni URL de Blob
- [x] 6.3 Crear `src/lib/imagenes/referencias.ts` con `COLUMNAS_CON_IMAGEN` (vacío hoy) y `leerRutasReferenciadas(db)`; prueba que recorre `src/db/esquema.ts` y falla si una columna de ruta de imagen no está declarada
- [x] 6.4 Crear `src/lib/imagenes/huerfanos.ts` con `limpiarHuerfanos` (lista paginada de `comprobantes/` y `fotos/`, menos de 24 h no se toca, referenciados no se tocan, registro vacío no borra, falla de lectura de referencias aborta, falla de un borrado continúa y se cuenta)
- [x] 6.5 Pruebas de `huerfanos.ts`: huérfano de 30 h se borra, de 2 h no, referenciado de 30 días no, varias páginas, registro vacío, lectura de base fallida y un borrado fallido entre varios
- [x] 6.6 Crear `app/api/cron/huerfanos/route.ts` (`GET`, `Authorization: Bearer ${CRON_SECRET}` comparado en tiempo constante, `401` sin ella o con la sesión de un administrador, `503` sin `CRON_SECRET`) con sus pruebas, y agregar el cron diario a `vercel.json` (`0 8 * * *`)

## 7. Verificación y despliegue

- [x] 7.1 Correr `npm test`, `npx tsc --noEmit` y `npm run build` sin errores (sin Playwright)
- [x] 7.2 Revisar que cada escenario de los tres specs tenga una prueba y que los criterios de "Comprobantes privados y errores" de `TECH-DESIGN.md` queden cubiertos: archivo ausente o de otra carpeta rechazado, imagen de 5 MB entregada sin error, limpieza que borra solo lo huérfano de más de 24 h, y error de subida sin pago ni reserva
- [x] 7.3 Desplegar con `npx vercel deploy --prod` (no hay migraciones) y comprobar `GET /api/salud` = `200 {"estado":"ok"}`
- [x] 7.4 Probar en producción con `curl` y una cuenta `@tiza.test`: `POST /api/subidas` sin sesión `401`, con sesión devuelve token, subida real de una imagen de prueba a `comprobantes/{id}/`, `GET /api/cron/huerfanos` sin secreto `401` y con secreto `200`; borrar la cuenta de prueba y el archivo al terminar
- [x] 7.5 Revisar en el panel de Vercel el consumo de Blob (almacenamiento y operaciones) tras la prueba y anotar el resultado en el reporte
- [x] 7.6 Proponer al usuario (sin editar `BACKLOG.md` desde este change) las notas para los ítems #9, #11 y #17: cablear `GET /api/comprobantes/:id` y `GET /api/fotos/:id`, llamar a `verificarImagenSubida` antes de su transacción y declarar su columna en `COLUMNAS_CON_IMAGEN`
