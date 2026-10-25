## Why

Hoy el servidor crea membresías, pagos y reservas `pendiente` (ítem #9a), pero nadie puede aprobar un pago: toda membresía queda `pendiente` y toda reserva expira a las 24 horas. Sin la revisión de pagos el administrador no activa membresías ni confirma limpiezas, y el flujo de Tiza Club no cierra (PRD, alcance 9: "Revisar los comprobantes subidos y aprobar o rechazar los pagos"). Además, la construcción del #9a dejó cuatro huecos que este ítem debe resolver: una membresía que queda atascada tras un rechazo, la aprobación tardía, una expiración que un `409` deshace y el inicio de la vigencia de 3 meses.

## What Changes

- **Lista y detalle de pagos (admin):** `GET /api/admin/pagos` y `GET /api/admin/pagos/:id`, y las pantallas `/admin/pagos` y `/admin/pagos/[id]`. La lista muestra los pagos `pendiente` con su cliente, concepto, monto, método, estado de la reserva y vencimiento; el detalle muestra el comprobante (por `GET /api/comprobantes/:id`, que ya autoriza al administrador) y las coincidencias de dirección.
- **Aprobar un pago:** `POST /api/admin/pagos/:id/aprobar`. Marca el pago `aprobado`, activa la membresía con `inicio = now()` y `fin` a los 3 meses de la aprobación (valor de `configuracion`), y confirma la reserva `pendiente` de ese pago.
- **Aprobación tardía:** si la reserva ya expiró, el pago se aprueba igual, la membresía se activa y la reserva sigue `expirada` (su horario no se vuelve a ocupar). La respuesta y una consulta reutilizable dejan marcado que el cliente debe elegir un nuevo horario; la nueva reserva y el texto del perfil los completan los ítems #13 y #12.
- **Rechazar un pago:** `POST /api/admin/pagos/:id/rechazar` con motivo opcional. La reserva conserva su `expira_en`.
- **Subir otro comprobante tras un rechazo:** `POST /api/pagos` (cliente). Crea un pago nuevo que reemplaza al rechazado y, si la reserva sigue viva, la apunta a él sin extender su plazo.
- **Salida de la membresía atascada (decidido por el usuario, opción C; PRD caso borde 1, ADR 0009):** el reenvío también vale cuando la reserva ya expiró, pero solo hasta `reenvio_comprobante_dias` (7) días después del rechazo, medidos con el reloj de la base. Pasado el plazo sin comprobante nuevo, la membresía `pendiente` pasa a un estado nuevo `caducada` (lo hace la pasada de expiración o la propia `POST /api/reservas`) y el cliente puede empezar de nuevo con una reserva y un pago nuevos. Fuera de plazo, `POST /api/pagos` responde `409 plazo_vencido`; dentro del plazo, `POST /api/reservas` responde `409 pago_rechazado` con la fecha límite.
- **Plazo como dato:** nueva clave `reenvio_comprobante_dias` en `configuracion` (valor 7, no provisional), con su esquema zod, el fixture y una migración de datos.
- **Cancelar una reserva fraudulenta:** `POST /api/admin/reservas/:id/cancelar` cancela una reserva `pendiente` y libera su horario de inmediato.
- **Coincidencias de dirección:** al revisar un pago con limpieza gratis, el detalle lista las reservas gratis del mismo distrito con el mismo número y una calle parecida, o la misma dirección con otro departamento.
- **Pasada de expiración confiable:** una función que marca `expirada` lo vencido y cierra las membresías cuyo plazo de reenvío terminó, en su propia transacción confirmada; la ejecutan la lista, el detalle y cada acción de administración antes de leer o escribir, sin depender del cron diario.
- **Esquema (una migración):** `pagos.motivo_rechazo`, `pagos.reemplaza_a` (con índice único), `reservas.cancelada_por`, una restricción de coherencia de la revisión, un índice parcial de pagos pendientes, el valor `caducada` del enum `estado_membresia` (con su `CHECK` de fechas reescrito) y la fila `reenvio_comprobante_dias` en `configuracion`.

## Capabilities

### New Capabilities

- `revision-de-pagos`: lista y detalle de pagos para el administrador, ver el comprobante, aprobar, rechazar y aprobación tardía, con los permisos de administrador.
- `reenvio-de-comprobante`: el cliente sube otro comprobante tras un rechazo, el plazo de reenvío, el cierre de la membresía vencida (`caducada`) y empezar de nuevo.
- `cancelacion-de-reserva-fraudulenta`: el administrador cancela una reserva en espera para liberar su horario.
- `coincidencias-de-direccion`: direcciones parecidas del mismo distrito que ya recibieron la limpieza gratis, para el administrador.
- `expiracion-confiable`: pasada de expiración que persiste las marcas `expirada` y el cierre de membresías vencidas sin depender del cron ni de una escritura exitosa.

### Modified Capabilities

(ninguna: `openspec/specs/` está vacío porque ningún change anterior está archivado; los cambios que este ítem hace a `POST /api/reservas` del #9a se describen en `design.md` y en `reenvio-de-comprobante`.)

## Impact

- **Código nuevo:** `src/lib/pagos/` (revisión, listado, reenvío, cierre de membresías, plazo, rutas), `src/lib/agenda/pasada.ts`, `src/lib/pagos/coincidencias.ts`, `app/api/admin/pagos/**`, `app/api/admin/reservas/[id]/cancelar/`, `app/api/pagos/`, `app/admin/pagos/**`.
- **Código del #9a y anteriores que se toca:** `src/lib/reservas/crear.ts` (cierre previo, la membresía `caducada` no cuenta y el código `pago_rechazado`), `src/db/esquema.ts`, `src/lib/configuracion.ts` y su fixture, y las pruebas que cuentan las claves de configuración (`configuracion.test.ts`, `migraciones.test.ts`); `src/db/pruebas-bd.ts` (limpieza). `app/admin/page.tsx` pasa de portada vacía a enlazar la revisión.
- **Base de datos:** una migración sobre `pagos` y `reservas`, probada solo en la rama `pruebas`. La de producción queda diferida hasta terminar los 18 ítems.
- **Ítem #10 (en paralelo):** este change no toca sus archivos; qué parte de las coincidencias depende de él está en `design.md`.
- **Ítems posteriores:** #12 (`cancelada_por = 'cliente'`, pasada al abrir el perfil, texto "Elige un nuevo día y hora"), #13 (nueva reserva con el mismo pago), #14 (crédito en aprobar, rechazar, expirar y cancelar), #15 y #16.
- **Sin dependencias nuevas ni variables de entorno nuevas.** Producción necesita la fila de `configuracion` antes del código (la migración va antes del despliegue): `leerConfiguracion` falla si falta una clave.
