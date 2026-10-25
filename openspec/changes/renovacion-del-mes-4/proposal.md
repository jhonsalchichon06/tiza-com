## Why

La membresía de Tiza Club dura 3 meses desde que el administrador aprueba el pago y no se renueva sola (PRD, "Alcance" puntos 3 y 8; "No alcance": sin cobro ni renovación automática). Hoy, cuando `fin` pasa, el perfil del cliente (ítem #12) solo muestra el estado `vencida` como dato: no le dice qué hacer, no hay forma de pagar de nuevo y ninguna ruta impide que un cliente con la membresía vencida (o con un servicio pedido para después del `fin`) siga eligiendo día y hora. El PRD pide un aviso dentro del perfil, un nuevo pago por el mismo flujo de la membresía y que, sin ese pago, no se pueda elegir día y hora (caso borde 6; riesgo "Renovación manual en el mes 4").

Este es el ítem #15 de `BACKLOG.md` (depende de #11, revisión de pagos, y de #12, perfil; ambos con propose hecho y sin aplicar). Sigue el ADR 0008 (vigencia calculada, la renovación NO da otra limpieza gratis) y el ADR 0009 (aprobación del pago, `caducada`, plazo de reenvío).

**Tres decisiones del PRD (`<!-- REVISAR -->`) alimentan este ítem. Las tres están decididas por el usuario (2026-10-21) y siguen siendo provisionales, pendientes de confirmar por el negocio:**

1. **Monto de la membresía:** S/ 89 al mes, S/ 267 en un solo pago, leído de `configuracion`. Ya está en el código (#9a).
2. **Duración de la renovación:** otro período de 3 meses, en un solo pago de S/ 267 (`membresia_precio_mensual` × `membresia_meses`), igual que la primera membresía y con el mismo flujo de pago y aprobación del #11. No da otra limpieza gratis. Solo se renueva cuando la membresía ya venció.
3. **Reservas del mes 3 si no llega el pago del mes 4:** se mantiene la regla actual: el servicio debe empezar antes del `fin` (también al reprogramar), así que ninguna reserva puede quedar agendada después del `fin` y no hay reservas que resolver. Sin pago solo se bloquea elegir día y hora para reservas nuevas.

Como son provisionales, el monto y los meses de la renovación salen de `configuracion` a través de un único punto (`planDeRenovacion`), sin constantes en el código: si el negocio cambia la respuesta, se edita un dato.

## What Changes

- **Aviso de renovación en el perfil:** el perfil calcula un bloque `renovacion` con cinco casos: `por_vencer` (la membresía vence en los próximos `renovacion_aviso_dias` días; solo informa), `vencida` (avisa que hay que pagar de nuevo para que el servicio del mes 4 sea válido y ofrece el botón de renovar), `renovacion_en_revision`, `renovacion_rechazada` (con el plazo de reenvío del #11) y `no_aplica`. Se calcula al leer, con el reloj de la base; no se guarda ningún estado nuevo.
- **Pago de renovación:** `POST /api/membresia/renovar` y la pantalla `/cuenta/renovar`. Con la membresía vencida, el cliente elige Yape o transferencia, sube el comprobante y se crea, en una transacción, una membresía `pendiente` y un pago `pendiente` de concepto `membresia` **sin reserva y sin horas gratis**. El administrador lo aprueba o rechaza con la pantalla del #11; el reenvío tras un rechazo y el cierre `caducada` del #11 funcionan igual. El monto y la duración los entrega una sola función, `planDeRenovacion`, que lee `configuracion` (3 meses, S/ 267 con los valores actuales); la aprobación del #11 no cambia.
- **Bloqueo por vigencia:** una función única, `comprobarVigenciaParaReservar`, rechaza elegir día y hora sin membresía vigente en la fecha del servicio: `409 membresia_vencida`, `409 renovacion_en_revision` y `422 fuera_de_vigencia` (fecha posterior al `fin`). La usa `GET /api/disponibilidad` para quien ya es miembro y queda lista para `POST /api/reservas` del #13. Tras aprobarse la renovación, el bloqueo se levanta solo.
- **Parámetro nuevo en `configuracion`:** `renovacion_aviso_dias` (provisional), con migración de solo datos aplicada **solo a la rama `pruebas`**.

**Decisiones aplicadas (grupos 7 y 8 de `tasks.md`):**

- `planDeRenovacion` devuelve el plan real desde `configuracion`; el `fin` al aprobar (#11) ya usa `membresia_meses`, así que solo se verifica con una prueba; la pantalla muestra el monto del plan. Sin columnas ni claves nuevas por esta decisión.
- Reservas del mes 3 sin pago del mes 4: no hay nada que resolver (ninguna reserva puede empezar después del `fin`); se deja probado que ninguna ruta de este change escribe en `reservas`.

**Fuera de alcance** (otros ítems o excluido por el PRD): reservar como miembro con descuento y el botón "elegir nuevo horario" (#13; aquí solo el guard que #13 llama); crédito en horas (#14; aquí solo se confirma que el bloqueo aplica aunque haya saldo); marcar `completada`, apoyo (#16); fotos (#17); reseñas (#18); correo, SMS o WhatsApp automático para avisar la renovación y cobro o renovación automáticos (PRD, "No alcance": los avisos son solo dentro del perfil). Migrar y desplegar producción queda diferido hasta cerrar los 18 ítems, por decisión del usuario.

## Capabilities

### New Capabilities

- `aviso-de-renovacion`: bloque `renovacion` del perfil (por vencer, vencida, en revisión, rechazada), textos, parámetro `renovacion_aviso_dias`.
- `pago-de-renovacion`: crear la membresía y el pago pendientes de la renovación con comprobante, reglas de unicidad y permisos, sin limpieza gratis y sin reserva; su paso por la revisión del #11.
- `bloqueo-por-vigencia`: función única y códigos de error que impiden elegir día y hora sin membresía vigente en la fecha del servicio, y su uso en la disponibilidad.

### Modified Capabilities

(ninguna: `openspec/specs/` está vacío porque ningún change anterior está archivado; los ajustes a `perfil-membresia` del #12 y a `revision-de-pagos` del #11 se describen en `design.md`.)

## Impact

- **Código nuevo:** `src/lib/membresia/` (`renovacion.ts` estado y avisos, `plan.ts` seam, `renovar.ts` creación, `vigencia-miembro.ts` guard, `rutas.ts`), `app/api/membresia/renovar/route.ts`, `app/(cuenta)/cuenta/renovar/` (pantalla y componente de cliente).
- **Código modificado:** `src/lib/configuracion.ts` y su fixture (clave nueva), el cálculo del perfil del #12 (`src/lib/perfil/`) para incluir `renovacion` y no confundir una renovación en revisión con la primera membresía, `src/lib/agenda/rutas.ts` (guard en `GET /api/disponibilidad`), `app/(cuenta)/cuenta/page.tsx` (aviso y botón).
- **Base de datos:** una migración de solo datos (fila de `configuracion`); ninguna tabla, columna ni índice nuevos. El esquema ya admite una membresía `activa` junto a una `pendiente` (`membresias_una_pendiente_por_cliente` solo cubre `pendiente`).
- **Dependencias de otros ítems:** #11 (`cerrarMembresiasSinReenvio`, `POST /api/pagos`, `pagosRechazadosReenviables`, aprobar y rechazar; el `fin` con `membresia_meses`), #12 (`estadoDeMembresia`, perfil). Si no están aplicados al arrancar, la tarea 1.1 se detiene. #13 (`reservar-como-miembro-activo`, ya con propose) tiene su propia comparación `validarVigenciaDeMembresia` (`src/lib/reservas/vigencia.ts`, `inicio < fin`); el guard de este change la reutiliza y no repite la comparación (tarea 1.2). #14 solo se confirma por el bloqueo con saldo.
- **Variables de entorno:** ninguna nueva. La prueba manual de la subida real necesita `BLOB_READ_WRITE_TOKEN` (tarea del usuario).
