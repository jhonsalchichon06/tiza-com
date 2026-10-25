## Why

El administrador ya podrá revisar pagos (ítem #11), pero todavía no puede ver las reservas, saber qué equipo atiende cada una, marcar una limpieza como realizada ni llevar el control de las personas de apoyo que necesitan los hogares grandes (PRD, alcance 9). Sin "marcar como completada" nunca habrá reservas con fotos (#17) ni reseñas (#18), y sin la lista de apoyo el aviso de "requiere apoyo" que guarda el sistema (ADR 0008) no le sirve a nadie.

## What Changes

- **Listado de reservas (admin):** `GET /api/admin/reservas` y la pantalla `/admin/reservas`, con el cliente, el servicio, la dirección, el horario, el **equipo** y el **estado efectivo** (una reserva `pendiente` cuya espera venció se muestra `expirada`, nunca `pendiente`). Filtro por estado y vista "por completar" (confirmadas cuyo servicio ya empezó).
- **Marcar como completada a mano:** `POST /api/admin/reservas/:id/completar`. Solo una reserva `confirmada` cuyo servicio ya empezó; no sirve para pendientes, canceladas, expiradas ni futuras.
- **Reasignar equipo:** `POST /api/admin/reservas/:id/reasignar` con el equipo destino. Solo si ese equipo está libre en el rango bloqueado de la reserva; la base de datos lo decide con la restricción de exclusión y, si está ocupado, la acción falla con un mensaje (ADR 0007).
- **Apoyo por coordinar:** `GET /api/admin/apoyo` y la pantalla `/admin/apoyo`, con las reservas vivas que `requiere_apoyo` y siguen `por_coordinar`, ordenadas por fecha del servicio; `POST /api/admin/reservas/:id/apoyo` las marca `coordinado` con una nota (ADR 0008).
- **Pasada de expiración:** cada lectura y escritura de estas rutas ejecuta antes la pasada de expiración del ítem #11 (`ejecutarPasadaDeExpiracion`), sin depender del cron.
- **Reprogramar en nombre del cliente (decisión del usuario, opción A):** `POST /api/admin/reservas/:id/reprogramar` y `GET /api/admin/reservas/:id/disponibilidad?fecha=`. Si el administrador no consigue a la persona de apoyo (PRD, `<!-- REVISAR -->` del alcance 4, decisión del 2026-10-21, **pendiente de confirmar por el negocio**), acuerda otra fecha con el cliente por WhatsApp (fuera del sistema) y cambia el horario de la reserva desde el portal. El **pago se conserva** (no se cancela ni se convierte en crédito), no cambia el precio y `apoyo_estado` vuelve a `por_coordinar`. Mismas validaciones que una reserva nueva; el administrador puede mover una reserva a menos de 24 h del servicio (supuesto). El acceso está en la lista de apoyo (`/admin/apoyo`) y en el listado de reservas. El sistema **no avisa** al cliente ni impone un plazo máximo.
- **Esquema: solo dos columnas nuevas, opcionales:** `reservas.reprogramada_por` y `reservas.reprogramada_en` (quién y cuándo reprogramó), aditivas y sin valor por defecto, con una migración. `equipo_id`, `estado = 'completada'`, `requiere_apoyo`, `apoyo_estado` y `apoyo_nota` ya existen.
- **Depende del change #12 (`perfil-reservas-y-membresia`):** reutiliza `moverAlPrimerEquipoLibre`, las reglas de `reprogramarReserva` y el cálculo de disponibilidad con `excluirReservaId`, sin duplicarlos.

## Capabilities

### New Capabilities

- `listado-de-reservas-admin`: ver las reservas con estado efectivo y equipo, con permisos de administrador.
- `completar-reserva`: marcar a mano como `completada` una reserva confirmada cuyo servicio ya empezó.
- `reasignacion-de-equipo`: mover una reserva a otro equipo solo si está libre en su rango.
- `apoyo-por-coordinar`: lista de reservas que requieren apoyo, ordenada por fecha, marcarlas como coordinadas con una nota y acceso a reprogramarlas.
- `reprogramacion-admin`: reprogramar una reserva viva a nombre del cliente, conservando pago y precio, con registro de quién lo hizo.

### Modified Capabilities

(ninguna: `openspec/specs/` está vacío porque ningún change anterior está archivado.)

## Impact

- **Código nuevo:** `src/lib/admin/reservas/` (estado efectivo, listado, completar, reasignar, apoyo, reprogramar, rutas), `app/api/admin/reservas/route.ts`, `app/api/admin/reservas/[id]/{completar,reasignar,apoyo,reprogramar,disponibilidad}/route.ts`, `app/api/admin/apoyo/route.ts`, `app/admin/reservas/**` y `app/admin/apoyo/**`.
- **Código existente que se toca:** `app/admin/page.tsx` (enlaces; también lo edita #11, se conservan los suyos), `src/db/pruebas-bd.ts` (ayudas de prueba) y `src/db/esquema.ts` (solo las dos columnas de reprogramación). Si `reprogramarReserva` de #12 no deja reutilizar su núcleo, se extrae un núcleo común en `src/lib/reservas/reprogramar.ts` sin cambiar su comportamiento.
- **Convive con #11** en `app/api/admin/reservas/[id]/cancelar` (de #11): este change no lo toca. Depende de la pasada `src/lib/agenda/pasada.ts` de #11 y de `moverAlPrimerEquipoLibre`, `reprogramar.ts` y la disponibilidad con `excluirReservaId` de #12.
- **Ítems posteriores:** #17 y #18 consultan `estado = 'completada'`; #14 no se ve afectado (el pago se conserva, no hay crédito); #12 no debe devolver `apoyo_nota` ni `reprogramada_por` al cliente.
- **Base de datos:** una migración aditiva (dos columnas opcionales de `reservas`), que se aplica con `npm run db:migrate` antes de desplegar. Producción diferida hasta terminar los 18 ítems. Sin dependencias ni variables de entorno nuevas.
