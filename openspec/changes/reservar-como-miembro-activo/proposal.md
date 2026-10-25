## Why

Hoy `POST /api/reservas` solo atiende al cliente sin membresía y responde `409` ("Ya eres miembro de Tiza Club") a quien ya tiene una, y `/reservar` le dice "Ya eres miembro" y lo manda a su cuenta. Un miembro activo no puede reservar su segunda limpieza, que es justo lo que busca el negocio (12 limpiezas al año, PRD "Objetivo"). Tampoco hay forma de usar el pago de una reserva expirada que el administrador aprobó tarde (el #11 deja el pago `aprobado` y el perfil del #12 solo avisa "Elige un nuevo día y hora").

Este es el ítem #13 de `BACKLOG.md` (depende del #11 y del #12). Sigue el PRD (alcance, puntos 2 y 4, y casos borde 6, 8 y 11), el ADR 0008 (10% de descuento de miembro, vigencia en la fecha del servicio, un pago por reserva), el ADR 0009 (aprobación tardía: nuevo horario sin otro comprobante, anticipación de 48 h) y el ADR 0012 (solo el punto de extensión del crédito). Ningún `<!-- REVISAR -->` del PRD bloquea este ítem: el monto de la membresía ya está decidido (S/ 267 provisional) y los pendientes de la renovación (mes 4) son del #15.

## What Changes

- **Reserva de un miembro** (`POST /api/reservas`, misma ruta): si el cliente tiene una membresía `activa`, la ruta crea una limpieza pagada con el precio de lista menos el 10% de descuento de miembro (el descuento ya lo calcula `calcularServicio`), en una transacción: pago nuevo con `concepto = reserva` y **sin** membresía, y reserva `pendiente` con `expira_en` a 24 horas, vinculada a la membresía activa. Exige comprobante, anticipación de 48 h y que el inicio del servicio sea anterior al `fin` de la membresía (si no, `422` con mensaje que pide renovar). La rama `409 ya eres miembro` de `crearPrimeraReserva` deja de ser el camino normal: queda solo como guarda ante una carrera.
- **Sin comprobante cuando no hay nada que pagar:** si el monto es 0 (la primera limpieza gratis que se conservó tras cancelarla y dura 3 h o menos), la reserva se crea `confirmada` sin espera, con un pago interno (método `credito`, monto 0, `aprobado`).
- **Limpieza gratis conservada:** el miembro que canceló su primera limpieza recibe las 3 horas gratis en la siguiente reserva, decidido con `decidirLimpiezaGratis(tx, usuarioId, hogar)` del #10 (que no cuenta las canceladas). Se planifica y prueba aquí, porque #13 es quien crea esa reserva siguiente.
- **Cotización de miembro** (`GET /api/cotizacion`): para un cliente con membresía activa devuelve `modo: "miembro"`, sin la línea de la membresía, el total igual al monto de la reserva, el descuento, el rango de fechas hasta el `fin` de la membresía y `limite` = `fin`. Incluye el punto de extensión del crédito en horas (`creditoHoras` = 0 hasta el #14).
- **Nuevo horario tras una aprobación tardía** (`GET` y `POST /api/pagos/:id/nuevo-horario`, y `GET .../disponibilidad`): con un pago `aprobado` sin reserva viva ni realizada, el cliente elige día y hora; se crea una reserva `confirmada` que apunta al **mismo pago**, sin otro comprobante, copiando servicio, dirección, horas gratis y montos de la reserva original, con anticipación de 48 h y vigencia de la membresía. No se ofrece con un pago cuya reserva canceló el **cliente** (esas horas pasan a crédito, #14): se reutiliza el filtro `pagosParaElegirHorario` del #12.
- **Asistente `/reservar` para miembros:** la vista "Ya eres miembro" pasa a ser el mismo asistente en modo miembro (resumen con descuento, fechas hasta el fin de la membresía, paso de pago sin membresía, paso de pago omitido si el monto es 0, pantalla final de reserva confirmada) y una vista de "Tu membresía venció". Nueva pantalla `/cuenta/nuevo-horario/[pagoId]` para elegir el nuevo día y hora.
- **Un pago aprobado esperando horario bloquea reservar otra:** mientras el cliente tenga un pago aprobado sin horario, `POST /api/reservas` responde `409 horario_pendiente` para evitar que pague dos veces (decisión 7 del design).
- **Sin migración, sin claves nuevas en `configuracion`.** Todo el esquema (`pagos.concepto = reserva` con `membresia_id` nulo, método `credito`, `reservas.cancelada_por`) ya existe por #9a y #11.

**Fuera de alcance** (otros ítems): el crédito en horas, sus lotes, su generación al cancelar y su aplicación real (#14; aquí solo `creditoParaReserva` devuelve 0 y el cálculo ya lo recibe); la renovación del mes 4, su pago y el aviso (#15); aprobar o rechazar pagos (#11); reprogramar y cancelar (#12); marcar `completada`, reasignar y apoyo (#16); fotos y reseñas (#17, #18). Cobro con tarjeta, WhatsApp automático, reembolsos, cupones y renovación automática están fuera del PRD ("No alcance"). La migración a producción y el despliegue quedan diferidos hasta cerrar los 18 ítems, por decisión del usuario.

## Capabilities

### New Capabilities

- `reserva-de-miembro`: reserva pagada de un miembro activo (precio con 10% de descuento, vigencia en la fecha del servicio, pago de concepto `reserva`, reserva sin comprobante cuando el monto es 0, limpieza gratis conservada, una en espera, cotización de miembro y punto de extensión del crédito).
- `nuevo-horario-tras-aprobacion-tardia`: reserva `confirmada` que reutiliza un pago aprobado, sin otro comprobante, con su disponibilidad y sus reglas.
- `asistente-reserva-de-miembro`: el asistente `/reservar` en modo miembro, la vista de membresía vencida y la pantalla del nuevo horario.

### Modified Capabilities

(ninguna: `openspec/specs/` está vacío y los changes previos no están archivados; el cambio de comportamiento sobre `POST /api/reservas`, `GET /api/cotizacion`, `decidirVista` y el asistente del #9a/#9b se describe aquí y en el design.)

## Impact

- **Código nuevo:** `src/lib/reservas/miembro.ts` (crear reserva de miembro), `src/lib/reservas/nuevo-horario.ts`, `src/lib/reservas/pago-interno.ts`, `src/lib/reservas/credito.ts` (punto de extensión), `src/lib/reservas/membresia-vigente.ts` (leer la membresía que autoriza), rutas bajo `app/api/pagos/[id]/nuevo-horario/`, y la página `app/(cuenta)/cuenta/nuevo-horario/[pagoId]/`.
- **Código modificado:** `src/lib/reservas/crear.ts` (despachador por membresía; la guarda de carrera), `src/lib/reservas/cotizar.ts` y `rutas.ts` (modo miembro), `src/lib/reservas/esquema-entrada.ts` (esquema del miembro, comprobante opcional), `src/lib/reservas/unicidad.ts` (código `horario_pendiente` si aplica), `src/lib/reservas/whatsapp.ts` (estado "confirmada"), el asistente (`estado.ts`, `vista.ts`, `confirmar.ts`, `solicitud.ts`, `api-cliente.ts`) y los componentes de `app/reservar/` (`page.tsx`, `ResumenCotizacion`, `PasoPago`, `PasoListo`).
- **Base de datos:** ninguna migración. Las pruebas contra Neon usan la rama `pruebas`.
- **Dependencias de otros ítems:** #10 (`decidirLimpiezaGratis` con hogar, aplicado), #11 (`cancelada_por`, `pagosConHorarioPendiente`, `ejecutarPasadaDeExpiracion`) y #12 (`pagosParaElegirHorario`, aviso del perfil). #11 y #12 tienen propose y no están aplicados: la tarea 1.1 lo comprueba y pausa si falta algo.
- **Coordinación con #14:** #14 reemplazará `creditoParaReserva` y reutilizará `crearPagoInterno`; ver riesgos del design.
- **Variables de entorno:** ninguna nueva.
