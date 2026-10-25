## 1. Formato y catálogo (módulos puros)

- [x] 1.1 Crear `src/lib/formato-publico.ts` con `formatearSoles` (prefijo "S/ ", coma decimal, sin decimales si es entero), `formatearHoras` ("1 hora", "3 horas", "3,5 horas") y `describirHorario` (días consecutivos como "lunes a sábado", no consecutivos con "y", horas en "8 am" / "6 pm")
- [x] 1.2 Crear `src/lib/catalogo-publico.ts` con `construirCatalogo(config)`: servicios "desde" con `calcularServicio` (hogar de 0 dormitorios y 1 baño, `precio_lista` y horas de trabajo), paquetes con precio por hora y etiqueta "Mejor precio por hora" solo al de menor precio por hora, descripción del paquete derivada de `niveles_hogar` (texto general si ningún nivel coincide), meses de la membresía (sin monto: no lee `membresia_precio_mensual`), horas gratis, descuento, vigencia del crédito, espera del pago, anticipación, umbral de apoyo, horario y distritos de `DISTRITOS`
- [x] 1.3 Crear `src/lib/preguntas.ts` con `construirPreguntas(catalogo)`: horas gratis, membresía y sin reembolso, por tamaño o por horas, cómo se paga, anticipación y horario, reprogramar o cancelar con crédito, qué pasa tras los 3 meses (sin monto), distritos, hogares grandes con apoyo, y los dos textos heredados de la demo (llave con portería, productos), sin avisos automáticos
- [x] 1.4 Crear `src/lib/leer-catalogo.ts` con `leerCatalogo()` = `conReintento(() => leerConfiguracion())` + `construirCatalogo`
- [x] 1.5 **Crear solo si no existe** (lo crea el change 9a `reservar-y-pagar-primera-membresia`, tarea 3.10): `src/lib/aviso-demo.ts` con `export const AVISO_DEMOSTRACION = "Sitio de demostración: los pagos son simulados. No hagas ninguna transferencia ni pago real."` y `src/lib/aviso-demo.test.ts` (texto exacto; sin dígitos, «S/», la CCI ni las palabras «clave», «token» y «secreto»; el texto no se repite fuera del módulo y de su prueba). Si ya existe, no tocarlo: solo comprobar que el texto coincide con el del PRD

## 2. Pruebas Vitest de los módulos (con `VALORES_DEL_DISENO`)

- [x] 2.1 `formato-publico.test.ts`: 6600 → "S/ 66", 19350 → "S/ 193,50", 22005 → "S/ 220,05"; horas 1, 3 y 3,5; horario 1–6 con 08:00–18:00 → "lunes a sábado, de 8 am a 6 pm"; lunes, miércoles y viernes; cierre 12:30 → "12:30 pm"
- [x] 2.2 `catalogo-publico.test.ts`: "desde" S/ 66, S/ 99 y S/ 112,20 (y los montos coinciden con `calcularServicio`); precio por hora de 4 h = S/ 32,25; solo el de 8 h lleva "Mejor precio por hora"; descripciones de 3, 4 y 6 h derivadas de los niveles y la de 8 h general; el catálogo expone los 3 meses de la membresía y ningún monto (cambiar `membresia_precio_mensual` no lo altera)
- [x] 2.3 `catalogo-publico.test.ts`: con precio del nivel 1 en 7000 el "desde" estándar es S/ 70; con descuento 0,2 el catálogo dice 20%; con un nivel agregado o paquete nuevo aparece sin tocar código; los distritos son exactamente los 9 de v1
- [x] 2.4 `preguntas.test.ts`: cubren los temas de la spec; con descuento 0,2 no aparece "10%"; con anticipación 72 aparece "72 horas" y no "48"; la respuesta del mes 4 no menciona monto; ninguna respuesta contiene "te avisamos cuando llegamos" ni "verificado"
- [x] 2.5 `leer-catalogo.test.ts` (base simulada con `vi.mock("@/db/cliente")`): reintenta una vez si hay error de conexión y falla nombrando la clave si falta un parámetro

## 3. Páginas y componentes

- [x] 3.1 Copiar `demo/assets/*.svg` a `public/assets/` (sin mover los originales)
- [x] 3.2 Crear `app/(publico)/landing.module.css` migrando `demo/styles.css` con las variables y reglas de elemento bajo `.sitio`; sin reinicio global; respetar `prefers-reduced-motion`
- [x] 3.3 Crear `app/(publico)/layout.tsx`: fuentes con `next/font/google` (Fraunces, Inter), clase `.sitio`, promoción, cabecera con "Ingresar" y "Cotizar ahora", el componente `PieSitio` (pie con el aviso de demostración, ver 3.9) y botón de WhatsApp; el número se lee de `WHATSAPP_NUMERO` (solo dígitos, si no, sin enlace); sin `cookies()` ni `headers()`
- [x] 3.4 Crear los componentes síncronos en `app/(publico)/_componentes/`: `Hero` (formulario GET a `/reservar` con `distrito` y `tipo`), `Franja`, `ComoFunciona`, `Servicios`, `Paquetes`, `Club` (sin cifras de dinero de la membresía), `Distritos`, `ListaPreguntas` (`<details>`), `LlamadaFinal`; todos reciben el catálogo por props
- [x] 3.5 Eliminar `app/page.tsx` y crear `app/(publico)/page.tsx` con `export const revalidate = 300`, `leerCatalogo()` y la composición de secciones, sin sección de opiniones ni su enlace; metadatos sin cifras
- [x] 3.6 Crear `app/(publico)/preguntas/page.tsx` (`revalidate = 300`, mismo componente `ListaPreguntas`, enlace de vuelta); `/reservar` no se crea aquí (lo crea el ítem #9)
- [x] 3.7 Crear `app/error.tsx` con mensaje genérico en español y botón "Reintentar", sin mostrar `error.message`
- [x] 3.8 Agregar `WHATSAPP_NUMERO=` con su comentario a `.env.example`, sin valor
- [x] 3.9 Crear `app/(publico)/_componentes/PieSitio.tsx` (síncrono): el pie del sitio con el enlace de WhatsApp opcional y, en un bloque visible aparte (`role="note"`, con estilo propio en `landing.module.css`, no en letra pequeña), el texto de `AVISO_DEMOSTRACION` importado de `src/lib/aviso-demo.ts` sin repetirlo; `layout.tsx` lo renderiza para que salga en todas las páginas públicas

## 4. Pruebas de los componentes (Vitest con `createElement` y `renderToStaticMarkup`, sin Playwright)

- [x] 4.1 `landing.test.ts`: el HTML trae las 9 secciones y los 9 distritos, no trae La Molina, Magdalena, Pueblo Libre ni Chorrillos, ni "Cliente de ejemplo", "Lo que dicen nuestros clientes", "verificado", "Reprogramación gratis", "Trabaja con nosotros" ni "hola@tiza.com", y no contiene `<script`
- [x] 4.2 Enlaces: el formulario del hero es `method="get"` hacia `/reservar` con campos `distrito` y `tipo`; el paquete de 6 h enlaza `/reservar?tipo=horas&horas=6`; los botones de membresía llevan `club=1`; cada servicio lleva su `tipo`
- [x] 4.3 Precios en el HTML: aparecen S/ 66, S/ 99, S/ 112,20 y S/ 32,25 por hora con los valores del diseño; con la configuración modificada (nivel 1 en 7000, descuento 0,2) cambian en el HTML sin tocar código
- [x] 4.4 WhatsApp: con `51912345678` el enlace es `https://wa.me/51912345678?text=…`; sin variable o con letras no existe ningún `wa.me`
- [x] 4.5 `ListaPreguntas`: renderiza las mismas preguntas en la landing y en `/preguntas`, con `<details>` y sin scripts
- [x] 4.6 Ninguna cifra de dinero o de horas está escrita a mano en `app/(publico)` ni en `src/lib/preguntas.ts`: prueba que busca `S/ \d` y literales de 10%/48/24 en los fuentes y solo admite el texto fijo de "24 horas antes" para cancelar, con un comentario que explica la excepción
- [x] 4.7 Sin monto de la membresía: ni el HTML de la landing ni el de `/preguntas` contienen "S/ 89", "S/ 267" ni "al mes", y no cambian al modificar `membresia_precio_mensual` en la configuración de prueba
- [x] 4.8 `pie-sitio.test.ts` (`renderToStaticMarkup`): el HTML de `PieSitio` contiene el texto exacto «Sitio de demostración: los pagos son simulados. No hagas ninguna transferencia ni pago real.» (literal en la prueba, comparado también con la constante) dentro de un bloque con `role="note"`, con y sin enlace de WhatsApp; el pie compone con la landing y con la página de preguntas porque el componente se renderiza desde `layout.tsx` (la prueba lee el fuente de `app/(publico)/layout.tsx` y comprueba que importa y renderiza `PieSitio`, y que `page.tsx` y `preguntas/page.tsx` no lo renderizan por separado); ningún archivo de `app/` repite el texto del aviso

## 5. Verificación (sin Playwright)

- [x] 5.1 Correr `npm test` y `npx tsc --noEmit` sin errores
- [x] 5.2 Correr `npm run build` sin errores y comprobar en su salida que `/` y `/preguntas` quedan como páginas con regeneración incremental (no dinámicas por solicitud)
- [x] 5.3 Con `npm run dev`, comprobar con `curl` que `/` y `/preguntas` responden `200` sin sesión y su HTML contiene el aviso de demostración (y que `/reservar` da `404` hasta el ítem #9), que `/ingresar` sigue igual, y que los precios del HTML coinciden con `configuracion`
- [x] 5.4 Revisar contra las specs: aviso de demostración en el pie de `/` y `/preguntas`, 9 distritos, ausencia de opiniones de ejemplo, sin monto de la membresía, frases retiradas, valores `REVISAR` leídos de `configuracion`, formato en soles con coma, fallo de lectura con mensaje genérico
- [x] 5.5 Confirmar con `git status` que `src/db/` no cambió: no hay migración ni se necesita `npm run db:migrate`

## 6. Despliegue

- [ ] 6.1 Tarea del usuario (no bloquea): definir `WHATSAPP_NUMERO` en las variables de Vercel (`npx vercel env add WHATSAPP_NUMERO`) y en `.env.local`, solo dígitos con código de país
- [ ] 6.2 Tarea del usuario: confirmar los precios de los paquetes y los multiplicadores (el monto de la membresía se confirma para el ítem #9); si cambian, editar `configuracion` y marcar `provisional = false`; actualizar los `REVISAR` del PRD (fuera de este change)
- [ ] 6.3 Solo cuando el ítem #9 esté resuelto, en particular el change 9b `asistente-de-reserva` (hasta entonces no se despliega: `/reservar` no existe): desplegar con `npx vercel deploy --prod` y comprobar `GET /api/salud` = `200 {"estado":"ok"}`, `GET /` y `GET /preguntas` = `200` con precios en soles, y que el HTML de ambas páginas (`curl`) contiene el texto del aviso de demostración en el pie
- [ ] 6.4 Anotar para #9 que debe crear `/reservar`, que `distrito=` puede llegar vacío, que debe leer `tipo`, `horas` y `club`, y que debe mostrar el monto de la membresía al pagar (la landing no lo muestra); y para #18 que agrega la sección de opiniones con reseñas aprobadas (fuera de este change)
