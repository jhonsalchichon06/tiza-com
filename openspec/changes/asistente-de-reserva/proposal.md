## Why

El cliente nuevo todavía no tiene dónde contratar: no existe la página `/reservar`. Esta es la mitad de pantalla del ítem #9 de `BACKLOG.md` (PRD, "Alcance" puntos 2, 3 y 10): un asistente por pasos que lleva al cliente de elegir el servicio a pagar la membresía de Tiza Club con Yape o transferencia, subir el comprobante y recibir el enlace de WhatsApp. Desbloquea la publicación de la landing (ítem #5), cuyos botones apuntan a `/reservar`.

El ítem #9 se partió en dos changes por decisión del usuario. Este es **9b**; la mitad de servidor es **9a, `reservar-y-pagar-primera-membresia`**, que define las tablas, `POST /api/reservas`, `GET /api/cotizacion`, `GET /api/comprobantes/:id`, el módulo de datos de pago y la imagen del QR.

**9b depende de que 9a esté aplicado y desplegado** (con `npm run db:migrate` ya ejecutado en producción), porque consume sus endpoints. También consume `GET /api/disponibilidad` (#6), `POST /api/subidas` y `subirImagen` (#8), `CamposDireccion` (#7) y la sesión (#2), todos construidos.

El asistente no calcula precios ni valida reglas de negocio: muestra lo que devuelve el servidor (ADR 0008) y guarda su estado solo en el navegador (ADR 0005, sin borradores en la base). Los pagos del PRD son simulados; los datos de pago (CCI y QR) que muestra son los del titular del proyecto, así que el paso de pago y la pantalla de reserva enviada muestran el aviso de demostración decidido por el usuario, y queda un riesgo residual (ver `design.md`).

## What Changes

- **Página `/reservar`** en Next.js (servidor): exige sesión (redirige a `/registro?volver=...`), consulta la membresía del cliente y decide entre mostrar el asistente, "pago en revisión" o el enlace a la cuenta. Lee los parámetros `distrito`, `tipo`, `horas` y `club` de la landing.
- **Asistente de seis pasos** (componentes de cliente): servicio, tamaño del hogar o paquete por horas con el resumen de la cotización, fecha y hora (horarios sin cupo en gris y deshabilitados), dirección con `CamposDireccion`, pago (monto de la membresía, Yape con la imagen real del QR o transferencia con la CCI, comprobante con `subirImagen`) y pantalla final con el enlace de WhatsApp.
- **Lógica pura probada con Vitest** en `src/lib/reservas/asistente/`: parámetros iniciales, estado y reductor, días reservables, armado del cuerpo, `confirmarReserva` (subir, enviar, resultado tipado, candado contra el doble envío) y cliente de la API. Más `src/lib/soles.ts` (formato de soles).
- **Estilos** en un módulo CSS propio (`reservar.module.css`) tomado de la demo, sin estilos globales.
- Muestra los datos de pago desde el módulo `datos-de-pago.ts` de 9a: la imagen del QR (`/pago/yape.jpeg`) con su texto alternativo, y la CCI y el titular.
- **Aviso de demostración** visible y fijo, con el texto exacto «Sitio de demostración: los pagos son simulados. No hagas ninguna transferencia ni pago real.», en el paso de pago (junto al QR y la CCI) y en la pantalla de reserva enviada. Los componentes importan `AVISO_DEMOSTRACION` de `src/lib/aviso-demo.ts`, que crea 9a.
- No cambia el esquema ni hay migración; no agrega dependencias.

Fuera de alcance (llegan con otros ítems o decisiones): todo el servidor y la base de datos (9a); el aviso en el pie de las páginas públicas (es de #5); aprobar, rechazar y subir otro comprobante (#11); el perfil, reprogramar y cancelar (#12); la reserva de un miembro con descuento (#13); la renovación (#15); límite de frecuencia; cobro con tarjeta o pasarela y envío automático de WhatsApp (PRD, "No alcance"); pruebas con navegador (Playwright y `jsdom` quedan descartados).

## Capabilities

### New Capabilities

- `asistente-de-reserva`: la página `/reservar` y sus pasos, hasta el pago y la confirmación (movida desde el change 9a, donde estaba como quinta capacidad).

### Modified Capabilities

Ninguna.

## Impact

- **Código nuevo:** `app/reservar/` (página, `Asistente.tsx`, un componente por paso y `reservar.module.css`), `src/lib/reservas/asistente/` (parámetros, estado, días, solicitud, confirmar, cliente de la API), `src/lib/soles.ts` y sus pruebas.
- **Código modificado:** ninguno de 9a (solo importa `src/lib/aviso-demo.ts`, `datos-de-pago.ts` y los endpoints de 9a). Si el ítem #5 ya creó un formateador de soles (`formato-publico.ts`), se reutiliza en vez de duplicarlo (ver `design.md`).
- **Base de datos:** ninguna; no hay migración.
- **Variables de entorno:** ninguna nueva. El enlace de WhatsApp lo construye el servidor (9a) con `WHATSAPP_NUMERO`.
- **Dependencias:** ninguna nueva.
- **Tareas del usuario:** comprobar a ojo que el aviso de demostración se ve claro en el paso de pago y en la reserva enviada; recorrer el asistente en producción con un comprobante real y medir los 3 minutos.
- **Despliegue:** `npx vercel deploy --prod` y `GET /api/salud` = `200 {"estado":"ok"}`. No hay migración que aplicar antes.
- **Tamaño:** 3 grupos de código (lógica pura, componentes, verificación) y uno de despliegue.
