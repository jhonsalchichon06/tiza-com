## Why

Hoy `app/page.tsx` solo dice "Tiza.com". La landing real existe únicamente como demo estática (`demo/index.html`) con precios, horas gratis, descuento y plazos escritos a mano en el HTML, y con testimonios de ejemplo. El PRD pide una landing y una sección de preguntas frecuentes (alcance, punto 11) dentro de la misma aplicación (ADR 0001), y que los precios y duraciones sean datos y no código (alcance, punto 4; ADR 0008). Es el ítem #5 de `BACKLOG.md`; depende de #1 (`configuracion` ya cargada y validada) y de #4 (`calcularServicio` en `src/lib/precios.ts`), que ya están construidos.

La landing es la puerta de entrada del embudo: cada número que muestra (precio "desde", paquetes, 3 horas gratis, 10%) debe salir de `configuracion` para que, cuando el negocio confirme los valores marcados `REVISAR`, baste editar datos.

## What Changes

- Reemplazar `app/page.tsx` por la landing en una página pública de Next.js (grupo de rutas `app/(publico)/`), con las secciones de la demo: promoción, cabecera, hero, franja de confianza, cómo funciona, servicios, paquetes por horas, Tiza Club, distritos, preguntas frecuentes, llamada final y pie.
- Nueva página `/preguntas` con las preguntas frecuentes completas, reutilizando el mismo componente que la sección de la landing.
- Nuevo módulo puro del servidor que arma el contenido público a partir de `Configuracion`: precio "desde" de cada servicio por tamaño (con `calcularServicio`), paquetes con su precio por hora, membresía, horas gratis, descuento, plazos y horario de atención. Un módulo de formato (soles con coma decimal, horas, días y horas de atención) y otro que arma el texto de las preguntas con esos mismos datos.
- Lista de distritos tomada de `DISTRITOS` (los 9 de v1).
- La página se genera con regeneración incremental (ISR): lee `configuracion` sin sesión ni cookies, y un cambio de precios se ve en minutos sin desplegar.
- Se copian a `public/assets/` las 4 ilustraciones SVG de `demo/assets/` (el despliegue excluye `demo/`).
- Las reseñas de ejemplo de la demo **no se migran**: no hay sección de opiniones hasta que el ítem #18 publique reseñas aprobadas.
- Se quitan de la demo los textos que el PRD no respalda: "Personal verificado", "Reprogramación gratis", avisos de llegada y término, "Trabaja con nosotros", el correo `hola@tiza.com`, y las etiquetas "Más pedido".
- Tiza Club se explica sin ningún monto, ni mensual ni total: el monto de la membresía sigue como `REVISAR` y se muestra al pagar (ítem #9). La landing y las preguntas no leen `membresia_precio_mensual`.
- El formulario del hero pasa a ser un `<form method="get">` hacia `/reservar` (sin JavaScript). El asistente es del ítem #9, que crea `/reservar`: no se agrega página temporal, así que esos enlaces dan `404` en local hasta entonces y la landing no se despliega a producción hasta que el ítem #9 esté resuelto.
- **Aviso de demostración en el pie** de todas las páginas públicas (landing y `/preguntas`), con el texto exacto que decidió el usuario y recoge el PRD («Sitio de demostración: los pagos son simulados. No hagas ninguna transferencia ni pago real.»), mediante un componente `PieSitio` del layout `app/(publico)/` que importa `AVISO_DEMOSTRACION` de `src/lib/aviso-demo.ts`. Ese módulo lo crea el change 9a; si #5 se aplicara antes, este change lo crea con el mismo contenido y la misma prueba solo si no existe.
- Nueva variable opcional `WHATSAPP_NUMERO` (en `.env.example`, sin valor): si falta, no se muestra ningún botón de WhatsApp.
- Un `app/error.tsx` genérico, porque la landing es la primera página pública que depende de la base.

Fuera de alcance (llegan con otros ítems): el asistente de reserva y su contrato de parámetros (#9), reseñas reales (#18), el aviso de demostración en el paso de pago y en la reserva enviada (son del asistente de reserva, 9b), la transición de cortina entre páginas de la demo, `sitemap`/`robots`, y el límite de intentos en `/api`. Tampoco el monto de la membresía (se muestra en el pago, ítem #9) ni una página temporal de `/reservar`.

**Decisiones de negocio pendientes (no bloquean):** el PRD marca como `REVISAR` los precios de los paquetes y los multiplicadores. Se leen de `configuracion`, donde ya están `provisional`; la landing los muestra tal cual están guardados. El monto de la membresía, también `REVISAR`, no se muestra en este change.

## Capabilities

### New Capabilities

- `catalogo-publico`: el contenido numérico de las páginas públicas (precios "desde", paquetes, beneficios de la membresía sin monto, plazos y horario) se arma solo a partir de `configuracion` y `calcularServicio`, con formato en soles de Perú.
- `landing-publica`: la página de inicio pública, sus secciones, enlaces, distritos, avisos honestos y comportamiento ante fallos.
- `preguntas-frecuentes`: la sección y la página de preguntas frecuentes, con respuestas que reflejan las reglas del PRD y los valores de `configuracion`.

### Modified Capabilities

Ninguna.

## Impact

- **Código nuevo:** `src/lib/aviso-demo.ts` con su prueba (solo si 9a no lo creó antes), `src/lib/formato-publico.ts`, `src/lib/catalogo-publico.ts`, `src/lib/preguntas.ts`, `src/lib/leer-catalogo.ts` (con sus `*.test.ts`); `app/(publico)/layout.tsx`, `page.tsx`, `preguntas/page.tsx`, componentes y un módulo CSS; `app/error.tsx`; `public/assets/*.svg`.
- **Código modificado:** se elimina `app/page.tsx` (lo reemplaza `app/(publico)/page.tsx`); `.env.example` gana `WHATSAPP_NUMERO`.
- **Base de datos:** ninguna migración. Solo lecturas de `configuracion`.
- **Despliegue:** `next build` pasa a leer `configuracion` al prerrenderizar la landing (ver `design.md`); `GET /api/salud` debe seguir en `200`. La landing no se despliega a producción hasta que el ítem #9 esté resuelto, en particular el change 9b que crea `/reservar` (hasta entonces sus botones dan `404`).
- **Variables de entorno:** `WHATSAPP_NUMERO` opcional (Vercel y `.env.local`), tarea del usuario.
