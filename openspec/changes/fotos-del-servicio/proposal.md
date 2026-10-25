## Why

El PRD promete que el historial del cliente muestra "fotos del servicio" y que el administrador las sube "después de cada limpieza" (alcance 7 y 9). Hoy no existe la tabla `fotos_servicio`, ni la ruta para registrarlas, ni la entrega con permisos, ni la pantalla del administrador. El ítem #8 ya dejó lista la subida directa a Blob (`fotos/{reservaId}/`, solo administrador), el ítem #16 deja el estado `completada` y el ítem #12 deja un espacio para las fotos en el detalle de la reserva. Falta unir las piezas. Sin esto, la prueba social y el seguimiento de lo que se hizo en cada hogar (clave para la lealtad) no existen, y el cron diario de huérfanos borraría cualquier foto subida porque ninguna fila la referencia.

## What Changes

- **Tabla `fotos_servicio`** (reserva, ambiente, `ruta` de la imagen en Blob, quién la subió y cuándo) con migración, **solo en la rama `pruebas`**. La columna `ruta` se declara en `COLUMNAS_CON_IMAGEN` para que el cron no borre las fotos a las 24 horas (la prueba de #8 falla si falta).
- **Registro de fotos (admin):** `POST /api/admin/reservas/:id/fotos` recibe una lista de `{ ruta, ambiente }`. Comprueba que la reserva exista y esté `completada` **antes** de verificar los archivos y de registrar nada, verifica cada archivo con `verificarImagenSubida` antes de abrir la transacción, exige que la ruta esté en `fotos/{id de esa reserva}/` y guarda todo o nada.
- **Límite por reserva (supuesto, marcado):** 12 fotos como máximo por reserva, guardado como dato en `configuracion` (`fotos_maximas_por_reserva`).
- **Ambiente:** cada foto lleva un ambiente de una lista cerrada (supuesto, marcado).
- **Entrega:** `GET /api/fotos/:id` con `crearRutaEntrega`: la ve el administrador y el cliente dueño de la reserva; cualquier otro recibe `404`.
- **Pantalla del administrador** `/admin/reservas/[id]/fotos`: elegir varias fotos, asignar un ambiente a cada una, subirlas (compresión y subida directa de #8) y registrarlas; ver las ya subidas. Enlace desde la lista de reservas de #16 solo para reservas `completada`.
- **Historial del cliente:** el detalle de la reserva (#12) muestra las fotos agrupadas por ambiente; `GET /api/reservas/:id` y el historial de `GET /api/perfil` incluyen las fotos y su cantidad.
- **Fuera de este ítem:** borrar o reemplazar fotos, reseñas (#18), avisar al cliente de que hay fotos nuevas (el PRD no tiene notificaciones salientes).

## Capabilities

### New Capabilities

- `registro-de-fotos-admin`: tabla, límite, validaciones y registro atómico de las fotos de una reserva completada.
- `entrega-de-fotos`: `GET /api/fotos/:id` con permiso del administrador y del cliente dueño.
- `pantalla-fotos-admin`: pantalla del administrador para subir varias fotos con su ambiente.
- `fotos-en-historial`: fotos en el detalle y el historial del cliente.

### Modified Capabilities

(ninguna: `openspec/specs/` está vacío porque ningún change anterior está archivado. Este change extiende código de #12 y #16, que solo tienen propose; ver `design.md`.)

## Impact

- **Código nuevo:** `src/lib/fotos/` (ambientes, registrar, listar, entrega, subida por lotes, rutas), `app/api/admin/reservas/[id]/fotos/route.ts`, `app/api/fotos/[id]/route.ts`, `app/admin/reservas/[id]/fotos/**`, componente de fotos del cliente.
- **Código existente que se toca:** `src/db/esquema.ts` y la migración; `src/lib/imagenes/referencias.ts` (declarar la columna); `src/lib/configuracion.ts` y su fixture (una clave nueva); `src/lib/perfil/detalle.ts`, `src/lib/perfil/reservas.ts` y `app/(cuenta)/cuenta/reservas/[id]/page.tsx` (de #12); `app/admin/reservas/page.tsx` (de #16, un enlace); `src/db/pruebas-bd.ts` (ayudas y limpieza). Se editan sobre su contenido al aplicar.
- **Dependencias:** #8 (aplicado), #12 y #16 (solo propose): si no están aplicados al empezar, se pausa en la tarea 1.1.
- **Base de datos:** migración solo a la rama `pruebas`. Producción (migración y despliegue) diferida hasta terminar los 18 ítems.
- **Variables de entorno:** ninguna nueva (usa `BLOB_READ_WRITE_TOKEN` de #8).
