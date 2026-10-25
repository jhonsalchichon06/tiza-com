# ADR 0010: Subida directa de imágenes a Vercel Blob con compresión en el navegador

## Estado

Aceptado. Ajusta la subida de imágenes de los ADR 0003, 0004 y 0006.

## Contexto

El PRD acepta comprobantes y fotos del servicio en JPG, PNG o WebP de **hasta 5 MB**. Los ADR 0003 y 0004 suben esas imágenes con rutas `/api` dedicadas y las entregan a través de `/api` para comprobar la sesión y el rol. Pero las funciones de Vercel aceptan cuerpos de hasta unos **4,5 MB**, tanto en la petición como en la respuesta. Una foto de 4,6 MB fallaría con error `413`, aunque el PRD la permite, y lo mismo pasaría al entregar una imagen grande.

Además, el plan Hobby de Blob incluye 1 GB y, si se excede, se bloquea 30 días, lo que también impediría subir comprobantes. Una foto de celular pesa de 3 a 5 MB, así que sin comprimir el espacio alcanza para unas pocas decenas de limpiezas con fotos.

## Decisión

1. **Validación en el navegador:** el archivo original debe ser JPG, PNG o WebP de hasta 5 MB. Si no cumple, se muestra un mensaje claro y no se sube nada.
2. **Compresión en el navegador:** antes de subirla, la imagen se reduce a un máximo de 2000 px por lado y se vuelve a codificar (WebP o JPEG), con un objetivo de 1 MB o menos. El número de operación de un comprobante sigue legible a esa resolución.
3. **Subida directa a Blob con token:** el navegador pide un token a `POST /api/subidas`, que comprueba la sesión y el permiso (cualquier cliente para comprobantes; solo un administrador para fotos del servicio). El token limita los tipos de archivo, el tamaño máximo (4 MB, por debajo del límite de las funciones) y la carpeta (`comprobantes/{usuarioId}/` o `fotos/{reservaId}/`, con un sufijo aleatorio). Luego el navegador sube directo a la **tienda privada** de Blob, sin pasar por la función.
4. **Registro en la base:** la ruta de negocio (`POST /api/reservas`, `POST /api/pagos` o la de fotos) recibe la ruta del archivo. Comprueba que esté dentro de la carpeta del usuario o de la reserva, que el archivo exista y que su tipo y tamaño sean válidos, y solo entonces crea la fila.
5. **Entrega:** `GET /api/comprobantes/:id` y `GET /api/fotos/:id` comprueban el permiso (`404` si el recurso no es del usuario) y devuelven la imagen. Como pesa 4 MB o menos, cabe en la respuesta de la función.
6. **Limpieza de archivos huérfanos:** si el archivo se sube pero la reserva no se crea (conflicto `409`, el cliente cierra la pestaña o un error), el archivo queda sin ninguna fila que lo use. Un **cron diario de Vercel** borra los archivos de más de 24 horas que ninguna fila referencia. El plan Hobby solo permite cron una vez al día, pero para esta limpieza la demora no importa.

## Alternativas consideradas

- **Subir a través de la función (ADR 0003 tal cual)** — no se eligió porque falla con archivos de más de unos 4,5 MB, que el PRD permite.
- **Subida directa sin comprimir** — era viable para subir, pero entregar una imagen de 5 MB a través de `/api` vuelve a chocar con el límite, y el GB de Blob se llena pronto.
- **Entregar con URLs firmadas temporales** en vez de pasar por la función — quitaría el tope de 4 MB en la entrega. Queda **por verificar al implementar** si las tiendas privadas de Blob ofrecen URLs firmadas con vencimiento corto. Si las ofrecen, son preferibles para la entrega.

## Consecuencias

- Se cumple el límite de 5 MB del PRD sin chocar con el límite de las funciones de Vercel.
- La compresión multiplica varias veces la cantidad de imágenes que caben en el GB de Blob.
- Ya no se puede garantizar con una transacción que "no quede un pago sin comprobante". Ahora la garantía es: **no hay pago sin un archivo existente** (paso 4), y los archivos sin pago se borran al día siguiente (paso 6). Durante hasta un día habrá archivos huérfanos ocupando espacio.
- El ADR 0006 decía "no se usan tareas programadas". Ahora hay una, solo para limpiar archivos.
- La compresión depende del JavaScript del navegador. Si falla (navegador muy antiguo), se intenta subir el original y, si pesa más de 4 MB, se le pide al cliente otra imagen.
- **Por verificar al implementar:** que la subida directa con token funcione con una tienda **privada** de Blob, y cuántas operaciones incluye el plan Hobby.
