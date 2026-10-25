## Why

El PRD promete que el historial del cliente tiene "una reseña (estrellas y comentario), una sola por limpieza completada", que "una reseña se muestra públicamente en la web solo después de que el administrador la apruebe" y que las reseñas de ejemplo de la landing "se reemplazan por reseñas reales de clientes, aprobadas por el administrador" (alcance 7, 9 y párrafo final del alcance). Hoy no existe la tabla `resenas`, ni la ruta para escribirlas, ni la cola de aprobación, y la landing (#5) salió **sin** sección de opiniones a propósito: las reseñas de ejemplo de la demo no se migraron y esa sección la agrega este ítem con reseñas reales aprobadas. Es el ítem #18 y el último del backlog; depende de #5 (landing, aplicada en local) y de #16 (que marca `completada`, el único estado que admite reseña).

## What Changes

- **Tabla `resenas`** (reserva única, estrellas 1 a 5, comentario, estado `pendiente` / `aprobada` / `rechazada`, quién y cuándo la revisó) con migración, **solo en la rama `pruebas`**. Un `CHECK` y un índice único hacen cumplir en la base "una por limpieza" y el rango de estrellas.
- **Escribir la reseña (cliente):** `POST /api/reservas/:id/resena` crea la reseña de una reserva propia y `completada`; `PUT` la edita mientras no esté aprobada. Estrellas de 1 a 5 y comentario de 10 a 500 caracteres. Reserva ajena, inexistente o con mal formato: `404`; no completada: `409`; segunda reseña: `409`.
- **Pantalla del cliente:** en el detalle de la reserva (#12, con el espacio que dejó y junto a las fotos de #17) un formulario accesible de estrellas y comentario, o la reseña ya enviada con su estado ("En revisión", "Publicada", "No se publicó"). El historial indica qué limpiezas completadas aún no tienen reseña.
- **Rechazo (supuesto marcado):** una reseña rechazada se puede editar y reenviar; vuelve a `pendiente` y sigue siendo la única de esa limpieza. Una aprobada ya no se edita.
- **Moderación (administrador):** `GET /api/admin/resenas` (cola de pendientes), `POST /api/admin/resenas/:id/aprobar` y `.../rechazar`, y la pantalla `/admin/resenas` con el comentario, las estrellas y los datos de la limpieza. Al aprobar se pide revalidar la landing.
- **Lectura pública:** función del servidor que devuelve solo las reseñas aprobadas con **nombre de pila, distrito, estrellas, comentario y mes** (supuesto marcado: nunca apellido, correo, celular ni dirección).
- **Landing:** sección "Opiniones de clientes" (`#opiniones`) con enlace en el menú, **solo si hay reseñas aprobadas**; sin ellas, ni sección ni enlace y nunca testimonios inventados. Si la lectura falla, la landing se publica sin la sección (ADR 0006).
- **Cierre del backlog:** tarea final que recuerda al usuario la lista de pendientes (migrar y desplegar los 18 ítems en orden y con su confirmación).
- **Fuera de este ítem:** editar el comentario desde el administrador, retirar una reseña ya publicada, responder a reseñas, fotos en reseñas, promedio de estrellas público, avisos al cliente (el PRD no tiene notificaciones salientes), reseñas de reservas que no son `completada`.

## Capabilities

### New Capabilities

- `resenas-del-cliente`: tabla, reglas y rutas con las que el cliente escribe, edita y reenvía su reseña; su pantalla en el historial.
- `moderacion-de-resenas`: cola, aprobación y rechazo en el portal de administrador.
- `opiniones-en-la-landing`: lectura pública sin datos personales y sección "Opiniones" con su enlace, o su ausencia honesta.

### Modified Capabilities

Ninguna (`openspec/specs/` está vacío: ningún change anterior está archivado). Extiende código de #5, #12, #16 y #17; ver `design.md`.

## Impact

- **Código nuevo:** `src/lib/resenas/` (límites, validación, crear/editar, moderar, lectura pública, rutas), `app/api/reservas/[id]/resena/route.ts`, `app/api/admin/resenas/**`, `app/admin/resenas/**`, componente de reseña del cliente, componente de opiniones de la landing.
- **Código existente que se toca:** `src/db/esquema.ts` y la migración; `src/lib/perfil/detalle.ts`, `src/lib/perfil/reservas.ts` y `app/(cuenta)/cuenta/reservas/[id]/page.tsx` (de #12, solo se agregan campos); `app/(publico)/page.tsx`, `_componentes/Landing.tsx`, `layout.tsx` (de #5) y su prueba `landing.test.ts`; `app/admin/page.tsx` (enlace); `src/db/pruebas-bd.ts`.
- **Dependencias:** #5 aplicado; #12, #16 y #17 solo con propose: si no están aplicados al empezar, se pausa en la tarea 1.1.
- **Base de datos:** migración solo a la rama `pruebas`. Producción (migrar, desplegar) diferida hasta terminar los 18 ítems.
- **Variables de entorno:** ninguna nueva.
- **Decisiones de negocio pendientes:** ningún `REVISAR` bloquea este ítem. Los supuestos (rechazo editable, largo del comentario, datos públicos, estado `rechazada`) quedan marcados en `design.md`.
