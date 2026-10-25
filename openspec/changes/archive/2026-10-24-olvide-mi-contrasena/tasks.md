## 1. Configuración y dependencia

- [x] 1.1 Instalar el paquete `resend` con `npm install resend` y fijar su versión
- [x] 1.2 Agregar `leerEnvCorreo` en `src/lib/env.ts` (`RESEND_API_KEY` y `CORREO_REMITENTE` obligatorios) con su prueba en `env.test.ts`
- [x] 1.3 Documentar `RESEND_API_KEY` y `CORREO_REMITENTE` en `.env.example` (sin valores)
- [x] 1.4 Cargar ambas variables en `.env.local` y en Vercel (producción, preview y desarrollo) — requiere la clave de Resend del usuario; nunca escribirla en el repositorio

## 2. Correo

- [x] 2.1 Crear `src/lib/correo.ts` con `enviarCorreoRestablecimiento({ para, nombre, enlace })` sobre Resend: asunto y cuerpo (texto y HTML mínimo) en español de Perú, con el enlace, el aviso de vencimiento en 1 hora y la nota de ignorarlo si no lo pidió
- [x] 2.2 Pruebas de `correo.ts` con el cliente de Resend simulado: contenido, destinatario, remitente y error de Resend propagado

## 3. Autenticación

- [x] 3.1 En `src/lib/auth.ts`, activar `resetPasswordTokenExpiresIn: 3600`, `revokeSessionsOnPasswordReset: true` y `sendResetPassword` (arma `${BETTER_AUTH_URL}/restablecer?token=…` y envía sin esperar, con el envío inyectable en `crearAuth`)
- [x] 3.2 En `opcionesAuth.verification`, configurar `storeIdentifier` con `overrides` para que solo el prefijo `reset-password:` se guarde `hashed`
- [x] 3.3 Programar el envío con `after()` de `next/server` en la instancia real de `auth()`, y registrar con `console.error` si falla
- [x] 3.4 Pruebas en `auth.test.ts` (adaptador de memoria y correo simulado): un correo para cuenta existente, ninguno para inexistente, `identifier` guardado como hash que no contiene el token, un solo uso, vencimiento con temporizadores simulados, contraseña corta que conserva el token y cierre de las sesiones previas

## 4. Rutas de la API

- [x] 4.1 Agregar en `src/lib/validacion-sesion.ts` los esquemas `esquemaOlvide` (correo) y `esquemaRestablecer` (token y contrasena con las reglas de `contrasenaNueva`)
- [x] 4.2 Mapear `INVALID_TOKEN` a `ErrorApi(400, "enlace_invalido", …)` en `traducirErrorAuth`, con prueba en `validacion-sesion.test.ts`
- [x] 4.3 Agregar `olvide` y `restablecer` a `crearRutasSesion` en `src/lib/rutas-sesion.ts` (JSON obligatorio, mensaje fijo `200` en `olvide`, sin cookies en `restablecer`)
- [x] 4.4 Crear `app/api/sesion/olvide/route.ts` y `app/api/sesion/restablecer/route.ts`
- [x] 4.5 Pruebas en `rutas-sesion.test.ts`: `200` idéntico con y sin cuenta, `422` por correo inválido, `415` sin JSON, `400 enlace_invalido` por token usado, vencido o inventado, `422` por contraseña corta, y que `restablecer` no envía `set-cookie`

## 5. Pantallas

- [x] 5.1 Ampliar `app/(cuenta)/Formulario.tsx` con un modo de éxito opcional (mensaje o destino) sin cambiar el comportamiento actual de ingresar y registro
- [x] 5.2 Crear `app/(cuenta)/olvide/page.tsx`: formulario de correo y mensaje uniforme al enviar
- [x] 5.3 Crear `app/(cuenta)/restablecer/page.tsx`: lee `searchParams` como promesa, formulario de contraseña nueva, aviso de enlace inválido o vencido con enlace a `/olvide`, y al éxito lleva a `/ingresar`; con `Referrer-Policy: no-referrer`
- [x] 5.4 Agregar el enlace "¿Olvidaste tu contraseña?" en `app/(cuenta)/ingresar/page.tsx`

## 6. Verificación y despliegue

- [x] 6.1 Correr `npm test`, `npx tsc --noEmit` y `npm run build` sin errores (sin Playwright)
- [x] 6.2 Probar en local con `curl` y una cuenta `@tiza.test`: solicitud con correo registrado y no registrado (misma respuesta), uso del enlace, segundo uso rechazado, e inicio de sesión con la contraseña nueva; borrar la cuenta de prueba al terminar
- [x] 6.3 Desplegar con `npx vercel deploy --prod` (no hay migraciones) y comprobar `GET /api/salud` = `200 {"estado":"ok"}`
- [x] 6.4 Repetir la prueba con `curl` en producción; la entrega real del correo solo se comprueba con el correo dueño de la cuenta de Resend, salvo que ya haya un dominio verificado
- [x] 6.5 Actualizar `BACKLOG.md` o `TECH-DESIGN.md` solo si cambian los criterios de aceptación de "Olvidé mi contraseña"; anotar el pendiente del límite de frecuencia
