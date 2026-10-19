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
- **Pago:** Yape (se muestra el QR) o transferencia (se muestra la CCI). El cliente sube una imagen del comprobante en el portal y el administrador la aprueba o rechaza. No hay tarjeta ni pasarela de pago. **Los pagos son simulados**, también en producción en Vercel: no se mueve dinero real, y el QR, la CCI y los comprobantes son de demostración.
- **Capacidad:** el personal es propio y puede hacer **2 limpiezas al mismo tiempo** (valor configurable). Una reserva bloquea las horas de su servicio más **1 hora de traslado**. Atención de lunes a sábado, de 8 am a 6 pm.
- **WhatsApp:** solo un enlace con el mensaje prellenado para coordinar. No hay envío automático.
- **Métrica principal:** al menos 50% de los miembros que pagan llegan a 3 limpiezas en sus primeros 4 meses.

### Arquitectura general

**Hoy (demo de frontend, sin backend):**
- Sitio estático de varias páginas con HTML, CSS y JavaScript sin framework, servido por **Vite**.
- Páginas: `index.html` (landing), `reservar.html` + `reservar.js` (asistente de reserva por pasos), `cuenta.html` + `cuenta.js` (perfil del cliente).
- `auth.js`: registro e inicio de sesión de demostración con la sesión en `localStorage`. **No es seguro y no es la versión final.**
- `transition.js`: transición de cortina entre páginas. `script.js`: formulario del hero.
- `styles.css`: estilos de todo el sitio. `assets/`: ilustraciones SVG.
- Los datos del perfil (historial, reseñas, fotos) son de ejemplo y están dentro de `cuenta.js`.
- Pruebas end-to-end con Playwright en `testeo-playw/`.

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

3. **Los comentarios `<!-- REVISAR: ... -->` de `PRD.md` son supuestos sin confirmar, no decisiones.** No los implementes como si fueran definitivos. Si una tarea depende de uno, pregunta al usuario primero. Pendientes importantes: monto de la membresía, duración de la renovación del mes 4 y qué pasa con las reservas del mes 3 si no llega el pago.

4. **Nunca escribas secretos en el repositorio.** Claves de API, cadenas de conexión de Neon y tokens van en variables de entorno (`.env` local y variables de Vercel). Confirma que el archivo esté en `.gitignore` antes de crearlo.

5. **No uses `auth.js` ni los datos de ejemplo como base de producción.** Son una demo. La autenticación real debe guardar las contraseñas con hash en el servidor y validar los permisos allí: cada cliente ve solo sus propios datos y comprobantes, y el portal de administrador exige rol de admin.

6. **Idioma:** la interfaz y los textos del producto están en español de Perú. Los precios van en soles (S/).

## 3. Comandos del entorno

Sistema: Windows 11. Funcionan PowerShell y Git Bash.

| Acción | Comando |
|---|---|
| Instalar dependencias | `npm install` |
| Servidor de desarrollo (puerto 5173) | `npm run dev` |
| Compilar para producción (carpeta `dist/`) | `npm run build` |
| Previsualizar la compilación | `npm run preview` |
| Instalar el navegador de las pruebas (una vez) | `npx playwright install chromium` |
| Correr todas las pruebas end-to-end | `npx playwright test` |
| Correr una sola prueba | `npx playwright test testeo-playw/reserva.spec.ts` |
| Abrir el reporte de la última corrida | `npx playwright show-report` |
| Ver el estado de GitHub CLI | `gh auth status` |

Notas:
- `npx playwright test` levanta Vite por su cuenta con `npm run dev -- --open false` y reutiliza el servidor si ya está corriendo.
- El repositorio remoto es privado: `jhonsalchichon06/tiza-com`, rama `main`.
- Vercel y Neon todavía **no están configurados** en este proyecto. Cuando se configuren, agrega aquí sus comandos (por ejemplo, el despliegue y las migraciones de la base de datos).
- `dist/`, `node_modules/` y los reportes de Playwright están en `.gitignore`.
