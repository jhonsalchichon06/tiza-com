## Context

Observado en el repositorio:

- `app/page.tsx` es un marcador (`<main>Tiza.com</main>`). `app/layout.tsx` solo fija `lang="es-PE"` y el título. Las páginas de cuenta (`app/(cuenta)/`) usan un módulo CSS propio con `system-ui`; no dependen de estilos globales.
- `leerConfiguracion()` (`src/lib/configuracion.ts`) lee y valida todas las claves en una consulta; `conReintento` (`src/lib/reintento.ts`) reintenta una vez si Neon está dormido; `db()` es perezoso para que `next build` no exija `DATABASE_URL` por sí solo.
- `calcularServicio(config, entrada)` (`src/lib/precios.ts`) es pura, devuelve `precio_lista` en céntimos y exige `banos >= 1` y `dormitorios >= 0`. Los precios de niveles, multiplicadores, paquetes y la membresía (`membresia_precio_mensual` = 8900) están `provisional = true` en la migración `0001`.
- `DISTRITOS` (`src/lib/distritos.ts`) es la lista única de los 9 distritos.
- Next.js es la 16.4.2 **sin** `cacheComponents` (`next.config.ts` está vacío). Según `node_modules/next/dist/docs/01-app/02-guides/caching-without-cache-components.md` e `incremental-static-regeneration.md`, `export const revalidate = N` activa ISR y `unstable_cache` está reemplazado por `use cache` solo bajo `cacheComponents`. Las pruebas existentes son `*.test.ts` en entorno Node (los componentes se prueban con `createElement` y `renderToStaticMarkup`, como `CamposDireccion.test.ts`).
- `TECH-DESIGN.md` no tiene una sección de criterios de aceptación para la landing ni las preguntas (solo las nombra en "Arquitectura de componentes"). Los criterios de este change salen del PRD (alcance 4 y 11, "No alcance", REVISAR), del ADR 0008 y del pedido del ítem; quedan cubiertos por las specs y por las tareas 5 y 6.

## Goals / Non-Goals

**Goals:**
- Migrar la landing y las preguntas de la demo a Next.js con cada cifra leída de `configuracion` y `calcularServicio`.
- Mostrar solo lo que el PRD respalda y nada que parezca una reseña real.
- Que cambiar un precio sea editar datos (visible en minutos, sin desplegar).

**Non-Goals:**
- El asistente de reserva y su contrato de parámetros (#9). Los enlaces respetan los parámetros de la demo (`distrito`, `tipo`, `horas`, `club`) y `/reservar` no existe hasta #9: no hay página temporal.
- Mostrar el monto de la membresía: sigue como `REVISAR` y se muestra al pagar (#9).
- Reseñas reales (#18), `sitemap`/`robots`, analítica, imágenes de redes (Open Graph).
- La transición de cortina entre páginas (`demo/transition.js`).
- El aviso de demostración en el paso de pago y en la reserva enviada: son del change 9b. Aquí solo el pie (decisión 11).
- Confirmar con el negocio precios, multiplicadores y monto de la membresía.
- Hacer configurable el plazo de cancelar/reprogramar (24 h): hoy no es una clave de `configuracion` y lo define #12.

## Decisions

### 1. Grupo de rutas `app/(publico)/` con su propio layout y CSS Module

Cabecera, pie, botón de WhatsApp y fuentes viven en `app/(publico)/layout.tsx`; los estilos se migran de `demo/styles.css` a `landing.module.css`, con las variables (`--ink`, `--brand`, `--chalk`…) y las reglas de elementos colgadas de una clase raíz `.sitio` (los módulos CSS no admiten selectores de etiqueta sueltos). Las fuentes (Fraunces e Inter) se cargan con `next/font/google`; ambas existen en `font-data.json` de la versión instalada.

- **Por qué:** el CSS de la demo tiene un reinicio global (`*{margin:0}`, `body{…}`, `a{…}`) que cambiaría el aspecto de `/ingresar`, `/registro` y `/cuenta`. Con el módulo no se filtra a otras páginas.
- **Descartada:** importar `styles.css` tal cual como CSS global (se filtra a las páginas de cuenta); Tailwind (dependencia nueva sin necesidad, ADR 0004 no la nombra).
- Respalda: ADR 0001 (una aplicación) y ADR 0004 ("las páginas de la demo hay que reescribirlas como componentes de React").

### 2. ISR con `revalidate = 300` y sin sesión en la página

`/` y `/preguntas` exportan `revalidate = 300`, leen la configuración con `conReintento(() => leerConfiguracion())` y no tocan `cookies()` ni `headers()`. La cabecera muestra siempre "Ingresar"; si ya hay sesión, `/ingresar` ya redirige a `/cuenta`.

- **Por qué:** una landing estática sirve rápido, no despierta Neon por cada visita (importa en el plan gratuito) y, si una regeneración falla, Next sigue sirviendo la versión anterior (ADR 0006: resiliencia proporcional). Leer la sesión en la cabecera la volvería dinámica en cada visita.
- **Consecuencia aceptada:** `next build` ahora prerrenderiza la landing y **lee `configuracion` durante el build**, así que necesita `DATABASE_URL` (en Vercel está; en local, `.env.local`). Es solo lectura y la tabla existe desde el ítem 1. Si la base no responde en el build, el despliegue falla a la vista en lugar de publicar una página rota.
- **Descartadas:** `dynamic = "force-dynamic"` (una consulta a Neon por visita y arranque en frío frente al visitante); `unstable_cache` (API reemplazada en Next 16; añade una capa que `revalidate` ya cubre); activar `cacheComponents` (cambia el modelo de caché de toda la app, fuera del ítem); mostrar el nombre del usuario en la cabecera (exige sesión).

### 3. Contenido en módulos puros, componentes sin datos propios

- `src/lib/formato-publico.ts`: `formatearSoles(centimos)`, `formatearHoras`, `describirHorario`. Se formatea a mano porque `Intl` con `es-PE` usa punto decimal y el PRD escribe S/ 193,50.
- `src/lib/catalogo-publico.ts`: `construirCatalogo(config)` devuelve un objeto con servicios "desde", paquetes (con precio por hora y etiqueta de mejor precio), meses de la membresía y beneficios (sin monto), plazos, horario y distritos. Para los servicios por tamaño llama a `calcularServicio` con el hogar mínimo (`dormitorios: 0, banos: 1`) y toma `precio_lista`; no repite multiplicaciones.
- `src/lib/preguntas.ts`: `construirPreguntas(catalogo)` devuelve `{ pregunta, respuesta }[]`.
- `src/lib/leer-catalogo.ts`: lee `configuracion` con reintento y llama a `construirCatalogo`.
- Los componentes de `app/(publico)/_componentes/` son síncronos y reciben el catálogo por props; solo `page.tsx` es asíncrono. Así se prueban con `renderToStaticMarkup` sin simular la base.

- **Por qué:** una función pura por pieza se prueba con el fixture `VALORES_DEL_DISENO` y con variantes (descuento 0,2; anticipación 72) sin tocar la base, como en el ítem #4.
- **Descartada:** escribir los textos con las cifras en JSX (es lo que la demo hacía y lo que el PRD prohíbe); que el navegador pida los precios a una ruta `/api` (ADR 0008: el navegador no recalcula, y una página estática no necesita un viaje extra).

### 4. "Desde" es el precio de lista, no el del miembro

Se muestra `precio_lista` (S/ 66 / 99 / 112,20) y el descuento de miembro y las horas gratis se explican en el texto del club. La demo ya mostraba la lista.

- **Descartada:** mostrar el monto con el 10% (la demo no lo hacía y confundiría con la primera limpieza, que además lleva horas gratis).

### 5. Descripciones de paquetes derivadas de los niveles; etiqueta por dato

La demo escribía "Cocina, 1 baño y 1 dormitorio" para el paquete de 3 h, lo que duplica los máximos de `niveles_hogar`. Si un paquete tiene las mismas horas que un nivel, el texto se arma con los máximos de ese nivel (y el último nivel como "más de X dormitorios o más de Y baños" usando el nivel anterior); si no, texto general ("Día completo para casas grandes u orden total"). La etiqueta "Mejor precio por hora" va al paquete de menor `precio ÷ horas`; se quita "Más pedido" porque no hay datos.

- **Descartada:** conservar las etiquetas de la demo (afirmaciones comerciales sin respaldo, y "Mejor valor" estaba en 6 h cuando 8 h sale más barato por hora).

### 6. Membresía: se explica sin monto

La tarjeta de Tiza Club dice "3 meses en un solo pago por adelantado", las horas gratis, el descuento y la vigencia del crédito, sin ninguna cifra de dinero de la membresía. El PRD marca el monto como `REVISAR` y el usuario decidió no publicarlo hasta confirmarlo: se muestra en el momento del pago (ítem #9). El catálogo no lee `membresia_precio_mensual`.

- **Descartada:** mostrar "S/ 89 al mes · S/ 267 en un solo pago" desde `configuracion` (la versión anterior): publica un valor sin confirmar en la primera página pública.
- No se menciona monto ni duración de la renovación (siguen sin definir).

### 7. Formulario del hero como GET nativo; sin página temporal de reserva

`<form method="get" action="/reservar">` con `distrito` y `tipo`. Si no se elige distrito se envía `distrito=` vacío; #9 debe tratarlo como ausente. `/reservar` lo crea el ítem #9: este change no agrega ninguna página ahí.

- **Qué pasa mientras tanto:** los enlaces a `/reservar` se implementan y se prueban en local (sus `href` se comprueban en el HTML), pero dan `404` hasta que exista el asistente. Por eso la landing **no se despliega a producción hasta que el ítem #9 esté resuelto**; el usuario lo decidió en lugar de publicar una página de aviso.
- **Por qué:** sin JavaScript, accesible y sin componente de cliente.
- **Descartadas:** una página temporal en `/reservar` (la versión anterior; el usuario prefirió esperar al ítem #9); componente de cliente con `router.push` (más código para lo mismo).

### 8. Contenido retirado o sin dato

- Opiniones: se omite la sección completa y su enlace; #18 la agrega con reseñas aprobadas.
- Se retiran "Personal verificado", "Reprogramación gratis", "Te avisamos cuando llegamos y cuando terminamos" (no hay notificaciones, "No alcance"), "Trabaja con nosotros" y `hola@tiza.com`. "Personal propio" y "Lunes a sábado, 8 am a 6 pm" sí tienen respaldo.
- El texto sobre dejar la llave con portería o un familiar, y el de que Tiza lleva aspiradora y productos, vienen de la demo y el PRD no los menciona: se conservan sin cifras y se listan como supuestos.
- WhatsApp: el número `51999999999` de la demo es ficticio. Se lee de `WHATSAPP_NUMERO` (opcional); sin ella, no hay enlace. Esto respeta el PRD (alcance 10): solo un enlace con mensaje prellenado.
- **Descartada:** dejar un número por defecto (llevaría clientes a un número ajeno).

### 9. Imágenes y `app/error.tsx`

Se copian los 4 SVG a `public/assets/` (no se mueven: la demo sigue como referencia y `.vercelignore` excluye `demo/`) y se usan con `<img>` con `width`/`height` y `loading="lazy"` salvo el hero. `app/error.tsx` muestra un mensaje genérico con botón "Reintentar" (ADR 0006: el detalle queda en los logs).

### 10. Sin choque con ningún ADR

Se sigue ADR 0001 (una aplicación), 0004 (Next.js, componentes de React, Vercel), 0006 (reintento y error genérico) y 0008 (datos en `configuracion`, cálculo en un solo módulo). El ADR 0008 dice "el navegador no recalcula": aquí tampoco lo hace, el servidor genera HTML.

### 11. Aviso de demostración en el pie del layout

El usuario decidió (21 de octubre de 2026) y el PRD recoge ("Alcance" punto 3) que el sitio muestre, con el mismo texto, el aviso «Sitio de demostración: los pagos son simulados. No hagas ninguna transferencia ni pago real.» en tres lugares. Este change cubre el tercero: el pie de todas las páginas públicas. Se hace con un componente `PieSitio` en `app/(publico)/_componentes/` que `layout.tsx` renderiza, de modo que el aviso salga en `/` y en `/preguntas` sin tocar cada página, y que se pueda probar con `renderToStaticMarkup` (el layout usa `next/font`, que no se puede renderizar en Vitest). `PieSitio` importa `AVISO_DEMOSTRACION` de `src/lib/aviso-demo.ts` y no repite el texto.

- **Módulo del texto:** lo crea 9a (decisión 15 de `reservar-y-pagar-primera-membresia`) por ser el primero que se aplica. Si #5 se aplicara antes, la tarea 1.5 lo crea con el mismo contenido y la misma prueba "solo si no existe", sin duplicarlo ni cambiar el texto; 9a haría entonces lo mismo en sentido inverso.
- **Visible, no escondido:** el bloque va como aviso aparte dentro del pie, no como línea de derechos de autor ni en letra pequeña.
- **Descartada:** escribir el texto en el pie. Se desincroniza de los otros dos lugares (9b).
- **Descartada:** una cinta fija arriba de cada página. El PRD pide el pie; una cinta cambiaría la cabecera y el hero de la demo.
- **Cambio frente a la versión anterior:** la decisión del 18 de octubre (no agregar el aviso por ahora y recordarlo al desplegar) queda reemplazada por esta; se quitó la tarea que recordaba el aviso al usuario.

## Risks / Trade-offs

- **Valores `REVISAR` visibles en público:** precios de paquetes y multiplicadores están `provisional`. La landing los muestra como vigentes. El monto de la membresía, también `REVISAR`, no se muestra. Mitigación: editar `configuracion` y esperar hasta 5 minutos; el usuario debe confirmarlos antes de compartir la URL.
- **Riesgo residual de pagos reales por error:** la landing no muestra el QR ni la CCI, pero lleva al asistente (9b) donde sí están. El pie de todas las páginas públicas avisa que el sitio es de demostración (decisión 11); alguien puede ignorarlo (PRD, "Riesgos"). Mitigación: el aviso fijo junto al QR y en la reserva enviada (9b) y no abrir el sitio al público hasta #11.
- **El build depende de Neon:** descrito en la decisión 2. Un build con la base dormida reintenta una vez; si falla, se reintenta el despliegue.
- **`next build` local lee la base de producción:** `.env.local` apunta a ella (CLAUDE.md). Es solo lectura.
- **Datos obsoletos hasta 5 minutos** tras editar `configuracion`. Aceptado; la alternativa es una ruta de revalidación bajo demanda, innecesaria hoy.
- **Textos heredados de la demo sin respaldo del PRD** (llave con portería, productos incluidos): hay que confirmarlos con el negocio.
- **Despliegue retenido hasta el ítem #9:** sin `/reservar`, los botones de la landing darían `404` en producción. Mitigación: no se despliega la landing hasta que #9 esté resuelto (el change 9b, `asistente-de-reserva`, es el que crea `/reservar`); el resto se implementa y verifica en local. Mientras tanto el sitio publicado sigue mostrando solo el marcador actual.
- **Tope de 24 h para cancelar** escrito como texto en las preguntas, porque no es un parámetro; si cambia, hay que editar el texto (lo resolverá #12 si lo vuelve dato).
- **Sin límite de intentos ni protección extra:** no cambia con este ítem (pendiente del backlog).
- **Pérdida de la cortina de transición:** cambio visual menor aceptado; con navegación del cliente de Next no se puede replicar sin rediseño.
