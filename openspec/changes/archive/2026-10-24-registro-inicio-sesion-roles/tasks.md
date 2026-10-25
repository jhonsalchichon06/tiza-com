# Tasks

## 1. Dependencias y entorno

- [x] 1.1 Instalar `better-auth` con versión exacta y `tsx` como dependencia de desarrollo, y verificar que `npm ls better-auth tsx` los muestra sin errores
- [x] 1.2 Agregar `leerEnvAuth()` a `src/lib/env.ts` (`BETTER_AUTH_SECRET` de 32 caracteres o más; `BETTER_AUTH_URL` que, si falta, usa `https://${VERCEL_URL}`), documentar ambas en `.env.example` sin valores, y verificar con Vitest que nombra la variable que falta, rechaza un secreto corto y aplica el respaldo con `VERCEL_URL`
- [x] 1.3 Generar un secreto aleatorio y cargar `BETTER_AUTH_SECRET` y `BETTER_AUTH_URL` en `.env.local` y en Vercel (producción, preview y desarrollo) sin mostrar el secreto en pantalla, y verificar con `npx vercel env ls` que ambos nombres aparecen y con `git check-ignore .env.local` que el archivo sigue ignorado

## 2. Esquema de usuarios y sesiones

- [x] 2.1 Agregar a `src/db/esquema.ts` el enum `rol_usuario` y las tablas `usuarios` (con `telefono` y `rol` por defecto `cliente`), `sesiones`, `cuentas` y `verificaciones`, con las columnas que espera Better Auth, y verificar que `npx tsc --noEmit` pasa
- [x] 2.2 Generar la migración con `npm run db:generate` y verificar con un test de Vitest que el SQL crea el enum con `cliente` y `admin`, las 4 tablas, el correo único y `rol` con valor por defecto `cliente`

## 3. Configuración de Better Auth

- [x] 3.1 Crear `src/lib/auth.ts` con `crearAuth(adaptador)` (correo y contraseña, mínimo 8 caracteres, inicio automático al registrarse, nombres de modelo en español, `telefono` como entrada y `rol` con `input: false`, sin `cookieCache`) y la instancia por defecto sobre Drizzle, y verificar con Vitest (adaptador en memoria) que la contraseña se guarda como hash distinto del texto plano y que un `rol: "admin"` enviado al registrarse queda como `cliente`

## 4. Protección por sesión y rol

- [x] 4.1 Crear `src/lib/sesion.ts` con `obtenerUsuario`, `requerirSesion`, `requerirAdmin` y `usuarioActual`, y verificar con Vitest (adaptador en memoria) que sin sesión o con cookie inventada `requerirSesion` lanza `401`, que un cliente recibe `403` de `requerirAdmin`, que un admin pasa, y que tras cambiar el rol a `cliente` la siguiente llamada da `403`
- [x] 4.2 Crear `src/lib/volver.ts`, que solo acepta rutas internas como destino tras el inicio de sesión, y verificar con Vitest que acepta `/cuenta` y `/admin` y rechaza `//otro.com`, `/\otro.com`, `https://otro.com` y un valor vacío

## 5. Rutas de la API de sesión

- [x] 5.1 Crear `src/lib/validacion-sesion.ts` con los esquemas zod de registro e inicio de sesión (correo normalizado, contraseña de 8 o más caracteres, nombre no vacío, celular `^9\d{8}$`) y la traducción de errores de Better Auth, y verificar con Vitest los mensajes `422` en español, el `409` del correo repetido y el `401` genérico
- [x] 5.2 Crear `POST /api/sesion/registro`, que exige JSON (`415` si no), valida, registra y copia la cookie de sesión, y verificar con Vitest (adaptador en memoria) que responde `201` con el usuario sin contraseña ni hash y con la cookie, `422` con la contraseña corta o el celular inválido sin crear la cuenta, y `409` con un correo repetido aunque cambien las mayúsculas
- [x] 5.3 Crear `POST`, `GET` y `DELETE` en `/api/sesion`, y verificar con Vitest (adaptador en memoria) que el inicio correcto responde `200` con una cookie `HttpOnly`, que la contraseña incorrecta y el correo inexistente dan el mismo `401` genérico, que `GET` devuelve el usuario con sesión y `401` sin ella, y que después de `DELETE` la cookie anterior recibe `401`

## 6. Páginas

- [x] 6.1 Crear las páginas `/registro` e `/ingresar` con formularios en español que muestran el error junto al campo sin borrar lo escrito y navegan a `volver` o a `/cuenta`, y que llevan a `/cuenta` a quien ya tiene sesión, y verificar que `npm run build` pasa
- [x] 6.2 Crear `/cuenta` (saludo con el nombre y botón para cerrar sesión) y `/admin` (portada vacía con su layout de rol), y verificar con `curl` contra `next dev` que sin sesión `/cuenta` y `/admin` responden `307` a `/ingresar?volver=...`, que con la cookie de un cliente `/cuenta` responde `200` y `/admin` responde `307` a `/cuenta`, y que `/ingresar` con sesión responde `307` a `/cuenta`

## 7. Comando de administrador

- [x] 7.1 Crear `scripts/promover-admin.ts` y el script `admin:promover` en `package.json`, con la lógica en una función de consulta inyectable, y verificar con Vitest que promueve una cuenta existente, normaliza el correo y falla sin crear nada cuando el correo no existe

## 8. Documentación

- [x] 8.1 Actualizar el ADR 0005 con la elección de Better Auth (decisión, consecuencias y alternativa descartada) y quitar el pendiente; en `TECH-DESIGN.md`, actualizar la fila de `usuarios` (`telefono`, `rol` y el hash en `cuentas`) y el riesgo de "Elección de biblioteca"; y verificar que ningún documento menciona todavía la elección como pendiente
- [x] 8.2 Agregar `npm run admin:promover -- <correo>` a la tabla de comandos de `CLAUDE.md` y las variables `BETTER_AUTH_*` a la nota de Vercel, y verificar que el comando corre como está escrito

## 9. Despliegue y verificación integral

- [x] 9.1 Correr `npx vitest run`, `npx tsc --noEmit` y `npm run build`, y verificar que terminan sin errores
- [x] 9.2 Aplicar la migración con `npm run db:migrate` y verificar en la base que existen `usuarios`, `sesiones`, `cuentas` y `verificaciones` y el enum `rol_usuario`
- [x] 9.3 Desplegar a producción y verificar con `curl`, usando una cuenta `prueba-<fecha>@tiza.test`, el flujo completo: registro `201` con cookie, `GET /api/sesion` `200`, cierre `204` y luego `401`, inicio con contraseña incorrecta `401` genérico, y `/api/salud` sigue en `200`
- [x] 9.4 Promover la cuenta de prueba con `npm run admin:promover` y verificar con `curl` que `/admin` responde `200` con su cookie; luego borrar las cuentas `@tiza.test` de la base y verificar que no queda ninguna
