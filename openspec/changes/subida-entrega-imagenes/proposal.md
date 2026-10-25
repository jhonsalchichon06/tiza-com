# Proposal

## Why

Comprobantes de pago y fotos del servicio son imágenes de hasta 5 MB (PRD, alcance 3 y 9), pero las funciones de Vercel solo aceptan unos 4,5 MB por petición y respuesta, y los comprobantes deben ser privados (PRD, caso borde 5). Los ítems 9 (reservar y pagar), 11 (revisión de pagos) y 17 (fotos del servicio) necesitan una base común para subir, verificar y entregar imágenes con permisos. Este ítem la construye una sola vez, según el ADR 0010.

## What Changes

- Módulo del navegador para **validar** (JPG, PNG o WebP, máximo 5 MB) y **comprimir** (máximo 2000 px por lado, WebP o JPEG, objetivo de 1 MB) una imagen antes de subirla, con respaldo al original si la compresión falla y pesa 4 MB o menos.
- Nueva ruta `POST /api/subidas`: exige sesión, emite el token de subida directa a la tienda privada de Vercel Blob y limita tipos (JPG, PNG, WebP), tamaño (4 MB) y carpeta (`comprobantes/{usuarioId}/` para cualquier cliente; `fotos/{reservaId}/` solo para un administrador), con sufijo aleatorio. La carpeta sale de la sesión, nunca de lo que envía el navegador.
- Función del servidor `verificarImagenSubida` que las rutas de negocio (ítems 9, 11 y 17) llamarán antes de guardar una referencia: comprueba carpeta, existencia, tipo real (por bytes iniciales) y tamaño del archivo en Blob.
- Entrega privada: función `entregarImagen` y fábrica de rutas `GET` que comprueban el permiso (`404` si el recurso no es del usuario) y devuelven la imagen desde `/api` con cabeceras que impiden cachearla.
- Cron diario `GET /api/cron/huerfanos` (protegido con `CRON_SECRET`) que borra archivos de más de 24 horas que ninguna fila referencia.
- Variables de entorno nuevas: `BLOB_READ_WRITE_TOKEN` y `CRON_SECRET`, en `.env.example`, `.env.local` y Vercel. **Tarea del usuario:** crear la tienda privada de Blob y cargar ambas.
- Dependencia nueva: `@vercel/blob`. Cron en `vercel.json`.
- Sin cambios de esquema ni migraciones (ver Non-Goals en `design.md`).

## Capabilities

### New Capabilities
- `subida-imagenes`: validación y compresión en el navegador, emisión del token de subida directa con permisos y carpeta, y verificación en el servidor del archivo subido antes de registrarlo.
- `entrega-imagenes`: entrega de una imagen privada por `/api` solo al dueño o a un administrador, con `404` para los demás.
- `limpieza-archivos-huerfanos`: cron diario que borra los archivos de Blob sin ninguna fila que los use, con más de 24 horas.

### Modified Capabilities

(ninguna: no existen specs principales que cambiar.)

## Impact

- **Código:** `src/lib/env.ts` (`leerEnvBlob`, `leerEnvCron`), módulos nuevos en `src/lib/` (nombres de carpeta, almacén Blob, verificación, entrega, limpieza, compresión del navegador), `app/api/subidas/`, `app/api/cron/huerfanos/`, `vercel.json` (cron), `.env.example`.
- **Dependencias:** `@vercel/blob` (instalar con `npm install` al aplicar; hoy no está en `node_modules`, así que su API queda "por verificar").
- **Servicios externos:** tienda privada de Vercel Blob (cuenta del usuario) y `CRON_SECRET`.
- **Dependencias del backlog:** depende del #2 (construido). Las rutas `GET /api/comprobantes/:id` y `GET /api/fotos/:id` y las columnas con referencias a imágenes dependen de tablas que crean los ítems #9 y #17; este ítem deja la base lista y probada con dobles (ver `design.md`).
- **Fuera de alcance (PRD, "No alcance"):** facturación electrónica y cualquier otro uso de imágenes. Tampoco entra aquí crear pagos, reservas ni fotos del servicio en la base.
- **Riesgos abiertos:** API de Blob privado sin verificar, 1 GB y operaciones limitadas del plan Hobby, y que el cron borre archivos en uso si un ítem posterior no registra su columna (ver `design.md`).
