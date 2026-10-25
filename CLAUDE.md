# Tiza.com

## 1. Contexto del proyecto

### Qué es
Tiza.com es un servicio de limpieza de hogares en Lima, Perú. Este repositorio contiene su sitio web: la landing, el asistente de reserva por pasos, el perfil del cliente y, a futuro, el portal de administrador.

### Qué problema resuelve
El negocio es nuevo y no tiene un canal de reservas propio. Hoy quien quiere contratar no puede ver precios, elegir fecha y confirmar sin escribir y esperar respuesta, y no hay registro de quién reservó ni quién tiene membresía.

El problema de fondo es otro: una oferta de "primera limpieza gratis" atrae a gente que solo busca lo gratis y se va. El objetivo es convertir visitantes en **clientes leales** (12 limpiezas al año). Por eso la primera limpieza gratis se desbloquea únicamente al pagar por adelantado una membresía.

### Contexto del negocio
- **Cliente:** adultos de 30 a 70 años que no tienen tiempo para limpiar o tienen limitaciones de salud. También propietarios e inquilinos (limpieza para alquilar o para devolver un departamento). Todos usan el mismo flujo.
- **Distritos de v1 (solo estos 9):** San Borja, San Isidro, Santiago de Surco, Barranco, Miraflores, San Luis, San Miguel, Jesús María y Lince.
- **Membresía (Tiza Club):** 3 meses en un solo pago por adelantado, sin reembolso. Desbloquea la primera limpieza gratis. Los 3 meses cuentan desde que el administrador aprueba el pago. Al llegar al mes 4 el perfil avisa que hay que pagar de nuevo para seguir reservando. La renovación no es automática.
- **Servicios:** limpieza por tamaño del hogar (estándar, profunda, mudanza) y por horas (3, 4, 6 y 8 horas).
- **Pago:** Yape (se muestra el QR) o transferencia (se muestra la CCI). El cliente sube una imagen del comprobante en el portal y el administrador la aprueba o rechaza. No hay tarjeta ni pasarela de pago. **Los pagos son simulados**, también en producción en Vercel: no se procesa ningún pago automático, el QR y la CCI mostrados son los del titular del proyecto, los comprobantes son de prueba y el sitio muestra un aviso de demostración («Sitio de demostración: los pagos son simulados. No hagas ninguna transferencia ni pago real.») en el paso de pago, en la reserva enviada y en el pie de las páginas públicas.
- **Capacidad:** el personal es propio y puede hacer **2 limpiezas al mismo tiempo** (valor configurable). Una reserva bloquea las horas de su servicio más **1 hora de traslado**. Atención de lunes a sábado, de 8 am a 6 pm.
- **WhatsApp:** solo un enlace con el mensaje prellenado para coordinar. No hay envío automático.
- **Métrica principal:** al menos 50% de los miembros que pagan llegan a 3 limpiezas en sus primeros 4 meses.

### Arquitectura general

**Hoy:**
- **Aplicación Next.js en la raíz** (en construcción, ver `BACKLOG.md`): `app/` (páginas y rutas `/api`), `src/db/` (esquema y migraciones de Drizzle), `src/lib/` (utilidades del servidor). Pruebas unitarias con Vitest junto al código (`*.test.ts`).
- **Demo de frontend en `demo/`**, sin backend, como referencia visual hasta que cada página se migre a Next.js:
  - Sitio estático de varias páginas con HTML, CSS y JavaScript sin framework, servido por **Vite**.
  - Páginas: `demo/index.html` (landing), `demo/reservar.html` + `reservar.js` (asistente de reserva por pasos), `demo/cuenta.html` + `cuenta.js` (perfil del cliente).
  - `demo/auth.js`: registro e inicio de sesión de demostración con la sesión en `localStorage`. **No es seguro y no es la versión final.**
  - `transition.js`: transición de cortina entre páginas. `script.js`: formulario del hero.
  - `styles.css`: estilos de todo el sitio. `assets/`: ilustraciones SVG.
  - Los datos del perfil (historial, reseñas, fotos) son de ejemplo y están dentro de `cuenta.js`.
  - Pruebas end-to-end con Playwright en `demo/testeo-playw/`.

**Destino (según `PRD.md`):**
- **Vercel** para la aplicación y las funciones de servidor.
- **Neon** (PostgreSQL) como base de datos: cuentas, membresías, reservas, pagos, reseñas.
- **Resend** para el correo de "Olvidé mi contraseña".
- **Almacenamiento privado de imágenes** (se asume Vercel Blob) para comprobantes de pago y fotos del servicio.
- Autenticación con correo y contraseña, con rol de cliente y rol de administrador.

La fuente de verdad de lo que se construye es `PRD.md`.

## 2. Reglas duras

1. **Lee `PRD.md` completo antes de planificar o generar código.** Hazlo al inicio de cada tarea, aunque creas recordar su contenido. No planifiques ni escribas código sin haberlo leído en esta sesión.

2. **Si una solicitud está fuera del alcance definido en `PRD.md`, detente y explícale al usuario por qué.** No escribas código ni lo planifiques primero. En tu respuesta:
   - Indica qué parte de la solicitud queda fuera y cita la sección del PRD que lo muestra (por ejemplo, "No alcance: no hay cupones ni programa de referidos").
   - Explica brevemente la razón.
   - Espera la decisión del usuario. Si decide ampliar el alcance, propón actualizar `PRD.md` antes de implementar.

   Son fuera de alcance, entre otros: cobro con tarjeta o pasarela de pago, WhatsApp automático, app para el personal, facturación electrónica, reembolsos, cupones o referidos, renovación automática, inicio de sesión social o por código, y distritos fuera de los 9.

3. **Los comentarios `<!-- REVISAR: ... -->` de `PRD.md` son supuestos sin confirmar, no decisiones.** No los implementes como si fueran definitivos. Si una tarea depende de uno, pregunta al usuario primero. Decisiones provisionales del usuario, aún sin confirmar por el negocio: el monto de la membresía es S/ 89 al mes (S/ 267 en un solo pago, como dato de `configuracion`); la renovación del mes 4 dura otros 3 meses por S/ 267; ninguna reserva puede empezar después del fin de la membresía; y si no se consigue a la persona de apoyo, se reprograma con el cliente. Estas decisiones no se deben dar por definitivas en el PRD hasta que el negocio las confirme.

4. **Nunca escribas secretos en el repositorio.** Claves de API, cadenas de conexión de Neon y tokens van en variables de entorno (`.env` local y variables de Vercel). Confirma que el archivo esté en `.gitignore` antes de crearlo.

5. **No uses `auth.js` ni los datos de ejemplo como base de producción.** Son una demo. La autenticación real debe guardar las contraseñas con hash en el servidor y validar los permisos allí: cada cliente ve solo sus propios datos y comprobantes, y el portal de administrador exige rol de admin.

6. **Idioma:** la interfaz y los textos del producto están en español de Perú. Los precios van en soles (S/).

## 3. Comandos del entorno

Sistema: Windows 11. Funcionan PowerShell y Git Bash.

| Acción | Comando |
|---|---|
| Instalar dependencias | `npm install` |
| Servidor de desarrollo de la app Next.js (puerto 3000) | `npm run dev` |
| Compilar la app para producción (carpeta `.next/`) | `npm run build` |
| Correr las pruebas unitarias (Vitest) | `npm test` |
| Generar una migración a partir de `src/db/esquema.ts` | `npm run db:generate` |
| Aplicar las migraciones a la base de `.env.local` | `npm run db:migrate` |
| Convertir en administrador a una cuenta ya registrada | `npm run admin:promover -- <correo>` |
| Traer las variables de entorno de Vercel a `.env.local` | `npx vercel env pull .env.local` |
| Ver los nombres de las variables de entorno en Vercel | `npx vercel env ls` |
| Desplegar a producción | `npx vercel deploy --prod` |
| Verificar un despliegue | `curl https://tiza-com.vercel.app/api/salud` |
| Servidor de la demo (puerto 5173) | `npm run demo:dev` |
| Compilar la demo (carpeta `demo/dist/`) | `npm run demo:build` |
| Previsualizar la compilación de la demo | `npm run demo:preview` |
| Instalar el navegador de las pruebas (una vez) | `npx playwright install chromium` |
| Correr todas las pruebas end-to-end (de la demo) | `npx playwright test` |
| Correr una sola prueba | `npx playwright test demo/testeo-playw/reserva.spec.ts` |
| Abrir el reporte de la última corrida | `npx playwright show-report` |
| Ver el estado de GitHub CLI | `gh auth status` |

Notas:
- `npx playwright test` levanta la demo por su cuenta con `npm run demo:dev -- --open false` y reutiliza el servidor si ya está corriendo.
- El repositorio remoto es privado: `jhonsalchichon06/tiza-com`, rama `main`.
- **Vercel:** proyecto `tiza-com` (equipo `alcatraz2`), funciones en `gru1` (São Paulo, fijado en `vercel.json`), producción en https://tiza-com.vercel.app. El repositorio todavía no está conectado a Vercel (la app de GitHub no tiene acceso al repositorio privado), así que se despliega con la CLI. `.vercelignore` evita subir los `.env*`, la demo y los artefactos locales.
- **Neon:** base `tiza-db` en `aws-sa-east-1`, creada desde el Marketplace de Vercel. `DATABASE_URL` vive en las variables de Vercel y en `.env.local` (ignorado por git); nunca la escribas en el repositorio.
- **Autenticación (Better Auth):** `BETTER_AUTH_SECRET` (distinto en producción/preview y en desarrollo) y `BETTER_AUTH_URL` (producción y desarrollo; en los previews se usa `VERCEL_URL`) viven en las variables de Vercel y en `.env.local`. Para rotar el secreto, cambia la variable en Vercel y vuelve a desplegar; eso cierra todas las sesiones abiertas.
- **Migraciones:** aplícalas con `npm run db:migrate` **antes** de desplegar el código que las necesita; nunca en el build. Ojo: hoy la `DATABASE_URL` de `.env.local` es la de la base de producción (todavía no hay ramas de Neon por entorno).
- **Después de cada despliegue,** `GET /api/salud` debe responder `200 {"estado":"ok"}`.
- `dist/` (incluida `demo/dist/`), `.next/`, `node_modules/`, los archivos `.env*` (salvo `.env.example`) y los reportes de Playwright están en `.gitignore`.
