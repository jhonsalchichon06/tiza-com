## Why

Hoy `/cuenta` es una portada mínima ("Hola, nombre"). Un cliente que ya pagó su membresía no puede ver si está activa, qué reservas tiene, cambiar el día de una limpieza ni cancelarla, y el PRD pide exactamente eso en el perfil del cliente ("Alcance" punto 7: estado de la membresía y avisos, próximas reservas con reprogramar y cancelar hasta 24 horas antes, historial). Además, el cliente no tiene dónde enterarse de que su pago fue rechazado o aprobado tarde, que es lo que dejó preparado el ítem #11.

Este es el ítem #12 de `BACKLOG.md` (depende del #9a, ya construido, y del #10, en aplicación). Sigue el ADR 0008 (vigencia calculada, la primera limpieza cancelada conserva su beneficio), el ADR 0009 (anticipación de 48 h, reprogramar, aprobación tardía), el ADR 0012 (el crédito en horas solo se informa aquí; lo completa el #14), el ADR 0005 (`404` para datos de otro cliente) y el ADR 0010 (comprobantes por `/api`).

No hay ningún `<!-- REVISAR -->` del PRD que bloquee este ítem. El de la renovación del mes 4 (monto, duración, reservas del mes 3 sin pago) pertenece al #15 y aquí no se implementa.

## What Changes

- **Resumen del perfil** (`GET /api/perfil` y la página `/cuenta`): estado de la membresía calculado (`sin_membresia`, `en_revision`, `pago_rechazado`, `activa`, `vencida`), próximas reservas, historial y los avisos que ya puede dar el servidor: pago en revisión, comprobante rechazado con los días que quedan para subir otro, "Elige un nuevo día y hora" tras una aprobación tardía, plazo vencido para empezar de nuevo y "tu limpieza gratis sigue disponible" tras cancelar la primera.
- **Detalle de una reserva** (`GET /api/reservas/:id` y `/cuenta/reservas/[id]`): servicio, dirección, horario, precio cobrado, horas gratis y estado del pago (el equipo asignado es interno y no se muestra). Una reserva de otro cliente responde `404`, igual que un id sin formato de uuid o inexistente.
- **Cancelar** (`POST /api/reservas/:id/cancelar`): hasta 24 horas antes del servicio (valor en `configuracion`), solo una reserva `pendiente` vigente o `confirmada`. Queda `cancelada` con `cancelada_por = 'cliente'`, su horario se libera en la misma transacción y no se toca el pago ni la membresía. La limpieza gratis cancelada **no se pierde**: ni los índices del #10 ni `decidirLimpiezaGratis` cuentan una reserva `cancelada`, y el perfil se lo dice al cliente. El crédito en horas por lo pagado queda como punto de extensión del #14.
- **Reprogramar** (`POST /api/reservas/:id/reprogramar`, más `GET /api/reservas/:id/disponibilidad` para elegir el nuevo horario): hasta 24 horas antes del servicio; el nuevo horario cumple las mismas reglas que una reserva nueva (atención, intervalo de 30 minutos, 48 h de anticipación, vigencia de la membresía) y no cambia el precio, el pago ni el estado. Se mueve la misma fila al primer equipo libre usando `leerOcupacion` con `excluirReservaId`, para que el hueco de la propia reserva no la bloquee.
- **Reenvío del comprobante desde el perfil:** pantalla para subir otro comprobante tras un rechazo, con el texto del plazo (`reenvio_hasta`), consumiendo `POST /api/pagos` y `pagosRechazadosReenviables` del #11. El #11 dejó esta pantalla al #12.
- **Parámetro nuevo en `configuracion`:** `cancelacion_minima_horas` = 24 (los plazos son datos, `TECH-DESIGN.md`). Migración de solo datos, generada y aplicada **solo a la rama `pruebas`**.
- **Punto de extensión en `asignar.ts`:** `moverAlPrimerEquipoLibre`, hermana de `insertarEnPrimerEquipoLibre`, con el mismo patrón de `SAVEPOINT` y `23P01`.

**Fuera de alcance** (otros ítems): reservar como miembro activo, el botón para elegir el nuevo horario tras una aprobación tardía y la reserva con descuento (#13); el saldo de crédito, su generación al cancelar y su uso (#14; aquí solo un mensaje informativo); el aviso del mes 4, el pago de renovación y el bloqueo de reservas por membresía vencida (#15; aquí solo se muestra el estado `vencida` con su fecha); marcar `completada`, reasignar equipo y apoyo (#16); fotos del servicio (#17) y reseñas (#18); límite de frecuencia y de registros por IP (pendientes de `BACKLOG.md`). Notificaciones por correo, SMS o WhatsApp automático, reembolsos en dinero y renovación automática están fuera del PRD ("No alcance"). La migración a producción y el despliegue quedan diferidos hasta cerrar los 18 ítems, por decisión del usuario.

## Capabilities

### New Capabilities

- `perfil-membresia`: estado de la membresía calculado y avisos del perfil (pago en revisión, rechazado con plazo, aprobación tardía, plazo vencido, vencida, limpieza gratis conservada).
- `perfil-reservas`: próximas reservas, historial, detalle por id con `404` para datos de otro cliente y aislamiento por cliente.
- `cancelar-reserva-cliente`: cancelación hasta 24 horas antes, liberación del horario, conservación de la limpieza gratis y punto de extensión del crédito.
- `reprogramar-reserva-cliente`: cambio de día y hora hasta 24 horas antes, disponibilidad que excluye la propia reserva, mismas reglas que una reserva nueva.
- `reenvio-comprobante-perfil`: pantalla del cliente para subir otro comprobante tras un rechazo y texto del plazo.

### Modified Capabilities

(ninguna: no hay specs archivadas en `openspec/specs/` y los changes previos todavía no están archivados; este change solo agrega.)

## Impact

- **Código nuevo:** `src/lib/perfil/` (membresía, listados, detalle, avisos), `src/lib/reservas/cancelar.ts`, `src/lib/reservas/reprogramar.ts`, `src/lib/reservas/propias.ts` (rutas y fábricas), rutas bajo `app/api/perfil` y `app/api/reservas/[id]/`, páginas `app/(cuenta)/cuenta/` (resumen y detalle) y sus componentes de cliente.
- **Código modificado:** `src/lib/agenda/asignar.ts` (función nueva), `src/lib/configuracion.ts` y su fixture (clave nueva), `app/(cuenta)/cuenta/page.tsx`.
- **Base de datos:** una migración de solo datos (fila de `configuracion`); ninguna tabla, columna ni índice nuevos.
- **Dependencias de otros ítems:** #10 (firma `decidirLimpiezaGratis(tx, usuarioId, hogar)` y los índices de `primera_gratis`), #11 (`reservas.cancelada_por`, estado `caducada`, `ejecutarPasadaDeExpiracion`, `pagosConHorarioPendiente`, `pagosRechazadosReenviables`, `POST /api/pagos`). Si alguno no está aplicado al arrancar, la tarea 1.1 lo detecta y se pausa.
- **Variables de entorno:** ninguna nueva. La prueba manual del reenvío necesita `BLOB_READ_WRITE_TOKEN` (tarea del usuario).
