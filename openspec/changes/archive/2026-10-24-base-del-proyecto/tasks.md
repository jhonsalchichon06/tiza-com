# Tasks

## 1. Demo en `demo/`

- [x] 1.1 Mover con `git mv` a `demo/` los 3 HTML, `auth.js`, `cuenta.js`, `reservar.js`, `script.js`, `transition.js`, `styles.css`, `assets/`, `vite.config.js` y `testeo-playw/`, y verificar con `git status` que aparecen como renombrados y que en la raíz ya no queda ninguno
- [x] 1.2 Cambiar los scripts de `package.json` a `demo:dev = vite demo`, `demo:build = vite build demo` y `demo:preview = vite preview demo`, y verificar que `npm run demo:build` genera `demo/dist/` con las 3 páginas
- [x] 1.3 Apuntar `playwright.config.ts` a `testDir: './demo/testeo-playw'` y cambiar en `tsconfig.json` la exclusión de `testeo-playw` por `demo`, y verificar que `npx playwright test demo/testeo-playw/reserva.spec.ts` pasa
- [x] 1.4 Actualizar en `CLAUDE.md` la descripción de la demo (ahora en `demo/`) y los comandos de demo y de Playwright, y verificar que cada comando documentado corre tal como está escrito

## 2. Configuración del negocio

- [x] 2.1 Crear `src/lib/configuracion.ts` con un esquema zod por cada una de las 16 claves del diseño y la función `validarParametro(clave, valor)`, y verificar con Vitest que acepta los valores del diseño, que rechaza un valor con forma inválida nombrando la clave y que exige montos en céntimos enteros
- [x] 2.2 Agregar `leerConfiguracion()`, que lee todas las filas en una consulta y valida cada una, con la consulta inyectable para probarla, y verificar con Vitest que devuelve los parámetros tipados, que falla nombrando la clave si falta una y que no usa valores por defecto
- [x] 2.3 Crear con `npx drizzle-kit generate --custom --name=extension_y_datos_iniciales` la migración con `CREATE EXTENSION IF NOT EXISTS btree_gist`, los 16 parámetros (`provisional = true` solo en `precios_niveles`, `multiplicadores_precio`, `paquetes_horas` y `membresia_precio_mensual`) y los 2 equipos, todo con `ON CONFLICT DO NOTHING`, y verificar con un test de Vitest que lee el SQL, encuentra las 16 claves y valida cada valor con `validarParametro`
- [x] 2.4 Ajustar en `BACKLOG.md` el alcance del ítem 1 a "un solo driver WebSocket de Neon para lecturas y transacciones (ADR 0009)", y verificar que coincide con la decisión 1 del diseño

## 3. Estado del servicio

- [x] 3.1 Crear `app/api/salud/route.ts`: un `GET` envuelto en `manejar` que ejecuta `SELECT 1` dentro de `conReintento` y responde `{ "estado": "ok" }`, y verificar con Vitest (base simulada) que responde `200` si la base contesta, `200` si contesta al reintento y `503` "Inténtalo en unos segundos" sin la cadena de conexión ni el host si falla dos veces
- [x] 3.2 Agregar un test de Vitest que llame a la ruta sin `DATABASE_URL` y verifique que responde `500` con un mensaje genérico que no nombra la variable, y que el log registra `DATABASE_URL`

## 4. Vercel y Neon

- [x] 4.1 (Manual, dueño del repositorio) Crear el proyecto de Vercel conectado a `jhonsalchichon06/tiza-com` y la base de Neon desde la integración del Marketplace, con las funciones y la base en la misma región, y verificar que `DATABASE_URL` aparece en las variables de entorno de Vercel
- [x] 4.2 Copiar `DATABASE_URL` a `.env.local` (confirmar antes que `.gitignore` lo excluye con `git check-ignore .env.local`), correr `npm run db:migrate` y verificar en la base que `btree_gist` está en `pg_extension`, que `configuracion` tiene 16 filas (4 provisionales) y que `equipos` tiene 2 activos
- [x] 4.3 Desplegar a producción y verificar que `GET <url>/api/salud` responde `200 {"estado":"ok"}` y que `GET <url>/api/no-existe` responde `404` con el formato único de error
- [x] 4.4 Actualizar en `CLAUDE.md` la tabla de comandos (desarrollo con Next.js, `db:generate`, `db:migrate`, `npm test` para Vitest) y reemplazar la nota "Vercel y Neon todavía no están configurados" por cómo aplicar las migraciones antes de desplegar, y verificar que cada comando corre como está escrito

## 5. Verificación integral

- [x] 5.1 Correr `npx vitest run`, `npx tsc --noEmit` y `npm run build` y verificar que los tres terminan sin errores
- [x] 5.2 Correr `npx playwright test demo/testeo-playw/reserva.spec.ts` y verificar que la demo sigue funcionando desde `demo/`
