## Why

El PRD no permite reembolsos en dinero: si el cliente cancela una limpieza pagada (hasta 24 horas antes), las horas que pagó pasan a un **crédito en horas** para su siguiente servicio (PRD, "Alcance" punto 4 y 7; "No alcance"). Hoy eso no existe. Los ítems #11, #12 y #13 dejaron todo preparado pero sin hacerlo: `cancelarReservaDelCliente` solo muestra un mensaje informativo, `aprobarPago`, `rechazarPago` y `expirarVencidas` tienen comentarios de extensión, `calcularServicio` ya recibe `creditoHoras`, y la reserva de miembro usa un `creditoParaReserva` que devuelve 0. Sin este ítem, quien cancela a tiempo pierde lo que pagó, y el perfil no puede mostrar un saldo.

Este es el ítem #14 de `BACKLOG.md` (depende de #11, #12 y #13). Sigue el ADR 0012 (lotes con vencimiento, generación solo si cancela el cliente y el pago está aprobado, aplicación automática, devoluciones, reserva cubierta sin comprobante), el ADR 0008 (las 3 horas gratis de una primera limpieza cancelada no pasan a crédito, las adicionales pagadas sí) y el ADR 0009 (expiración y transiciones). Ningún `<!-- REVISAR -->` del PRD bloquea este ítem.

## What Changes

- **Lotes de crédito** (tablas `creditos_horas` y `usos_credito`): un lote por cancelación, con `vence_en` = cancelación + `credito_vence_meses` (3, ya existe en `configuracion`). El saldo se calcula siempre desde los lotes (`vence_en > now()`), nunca se guarda aparte. Una columna nueva `reservas.cancelada_en` registra cuándo canceló el cliente, para fijar el vencimiento aunque el crédito se genere después (aprobación tardía) o se recupere.
- **Generación al cancelar:** una sola función idempotente (`generarCreditoDeCancelacion`) que crea el lote cuando la reserva está `cancelada` por el cliente **y** su pago `aprobado`, en cualquier orden: la llama la cancelación del cliente (#12) y la aprobación del pago (#11). Horas = `horas_trabajo − horas_gratis_aplicadas − credito_aplicado`; las 3 horas gratis de una primera limpieza no cuentan. Un índice único sobre la reserva de origen evita duplicados.
- **Aplicación automática al reservar:** al crear una reserva de miembro (#13) se bloquean los lotes vigentes del cliente (`FOR UPDATE`), se aplican primero las horas gratis y después el crédito, empezando por el lote que vence antes, y quedan como usos `reservado` descontados de `horas_disponibles` en la misma transacción. Reemplaza el `creditoParaReserva` que devuelve 0.
- **Reserva cubierta sin comprobante:** si no queda nada que pagar, la reserva nace `confirmada` con el pago interno (`crearPagoInterno` del #13, método `credito`, monto 0) y los usos `consumido`. Si queda un resto, el comprobante cubre solo el resto.
- **Transiciones que actualizan los usos** (extiende lo construido): confirmar (aprobar, #11) pasa los usos a `consumido`; expirar (`expirarVencidas`, #11) y cancelar una reserva en espera como administrador (#11) devuelven las horas a su lote original con su vencimiento; cancelar como cliente (#12) devuelve las horas de crédito a su lote original y genera un lote nuevo con lo pagado en dinero; rechazar un pago no toca los usos (la reserva sigue en espera y las horas vuelven cuando expira). El nuevo horario tras una aprobación tardía (#13) vuelve a tomar el crédito de la reserva original.
- **Saldo y detalle:** `GET /api/creditos` (saldo, lotes con vencimiento y movimientos), tarjeta de crédito en el perfil y página `/cuenta/credito`; con la membresía vencida el saldo se ve pero se avisa que hace falta renovar. En el portal del administrador, lista de clientes con su crédito (`GET /api/admin/creditos`, `/admin/creditos` y detalle por cliente), solo lectura.
- **Recuperar cancelaciones anteriores:** la migración rellena `cancelada_en` con `actualizada_en` en las canceladas existentes y genera los lotes de las cancelaciones del cliente con pago aprobado que #12 dejó sin crédito.
- **Contradicción entre ADR 0008 y 0012 resuelta en el diseño:** el pago de una reserva cancelada por el cliente va a crédito y **no** se reutiliza para otro horario; solo se reutiliza el de una reserva expirada o cancelada por el administrador. Se propone la redacción para ajustar el ADR 0008 (pregunta abierta para el usuario).
- Sin claves nuevas en `configuracion`. Una migración (tablas, columna, `CHECK`, índices y los dos rellenos), **generada y aplicada solo a la rama `pruebas`**; producción queda diferida.

**Fuera de alcance:** que el administrador cree o edite créditos a mano (ADR 0012: v1 solo lo ve); qué pasa cuando la cancelación la causa Tiza (sin apoyo): el PRD lo resuelve con reprogramar y conservar el pago, no con crédito; la renovación del mes 4 y el bloqueo de reservas por membresía vencida (#15); reembolsos en dinero, cupones, notificaciones por correo, SMS o WhatsApp automático (PRD, "No alcance"). Playwright no se usa.

## Capabilities

### New Capabilities

- `lotes-de-credito`: tablas, vencimiento, saldo calculado, generación al cancelar con pago aprobado (en cualquier orden), horas del lote y recuperación de cancelaciones anteriores.
- `credito-en-la-reserva`: aplicación automática al reservar (orden por vencimiento, horas gratis primero, bloqueo), reserva cubierta sin comprobante, cobertura parcial, cotización con crédito y nuevo horario tras una aprobación tardía.
- `credito-en-transiciones`: qué hacen con los usos y los lotes confirmar, expirar, rechazar, cancelar (cliente y administrador), completar y reprogramar.
- `saldo-de-credito`: `GET /api/creditos`, perfil, página de detalle y vista de solo lectura para el administrador.

### Modified Capabilities

(ninguna en `openspec/specs/`, que está vacío porque los changes previos no están archivados. Cuando #11, #12 y #13 se archiven, este change sustituye el requisito "Mensaje informativo del crédito en horas" y el escenario "No se escribe crédito" de `cancelar-reserva-cliente`, y el punto de extensión `creditoParaReserva` de `reserva-de-miembro`; ver design, "Qué cambia de #11, #12 y #13".)

## Impact

- **Código nuevo:** `src/lib/creditos/` (reparto, lotes, aplicar, transiciones, consulta, rutas, textos), `app/api/creditos/`, `app/api/admin/creditos/`, `app/(cuenta)/cuenta/credito/`, `app/admin/creditos/`.
- **Código modificado:** `src/lib/agenda/expirar.ts` (`expirarVencidas` devuelve las horas), `src/lib/pagos/revision.ts` (aprobar), `src/lib/reservas/cancelar.ts` y `cancelar-admin.ts` (cancelar), `src/lib/reservas/credito.ts` y `miembro.ts` y `nuevo-horario.ts` y `cotizar.ts` (#13), `src/lib/perfil/` (resumen y textos), el asistente `/reservar` (paso de pago omitido), `app/admin/page.tsx` (enlace), `src/db/esquema.ts`, `src/db/pruebas-bd.ts`.
- **Base de datos:** una migración generada y aplicada solo a la rama `pruebas`.
- **Dependencias de otros ítems:** #11, #12 y #13 (la tarea 1.1 comprueba los nombres reales y pausa si falta algo).
- **Variables de entorno:** ninguna nueva.
