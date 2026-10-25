# Design

## Context

Better Auth 1.7.11 ya trae el flujo de restablecimiento (`requestPasswordReset` y `resetPassword`), pero hoy no está activado: falta `sendResetPassword`. No se monta `/api/auth/*` (ADR 0005, memoria del ítem 2), así que las rutas son propias y llaman a `auth().api.*`, igual que registro e inicio de sesión (`src/lib/rutas-sesion.ts`). Los errores salen con el formato único de `src/lib/errores.ts`.

Lo que la biblioteca hace por defecto y se verificó en su código (`dist/api/routes/password.mjs`):

- Guarda el token en `verificaciones` con `identifier = "reset-password:<token>"` y `value = <id del usuario>`. **En texto plano**, así que no cumple "solo como hash" sin configuración.
- Vence a 1 h por defecto (`resetPasswordTokenExpiresIn`, en segundos).
- Consume el token dentro de la transacción que cambia la contraseña (`consumeVerificationValue`), lo que da el uso único.
- Con un correo inexistente responde igual y simula el tiempo de la búsqueda.
- `revokeSessionsOnPasswordReset` está apagado por defecto.
- Espera el envío del correo con `runInBackgroundOrAwait`, salvo que se configure un manejador en segundo plano.

Las variables de entorno se leen de forma perezosa en `src/lib/env.ts` (`next build` no las necesita). `verificaciones` ya existe (migración 0002).

## Goals / Non-Goals

**Goals:**
- Cumplir los criterios de "Olvidé mi contraseña" de `TECH-DESIGN.md` reutilizando la lógica de Better Auth, sin reimplementar tokens ni transacciones.
- Que ni el contenido ni el tiempo de la respuesta revelen si un correo tiene cuenta.

**Non-Goals:**
- Límite de frecuencia de solicitudes (ver Riesgos).
- Montar `/api/auth/*`, enviar otros correos, plantillas HTML elaboradas o diseño de marca del correo.
- Cambiar el correo o la contraseña desde el perfil estando con sesión.

## Decisions

### 1. Usar el flujo de Better Auth y endurecerlo por configuración
`opcionesAuth.emailAndPassword` gana `resetPasswordTokenExpiresIn: 3600`, `revokeSessionsOnPasswordReset: true` y `sendResetPassword`. `opcionesAuth.verification` gana `storeIdentifier: { default: "plain", overrides: { "reset-password:": "hashed" } }`. Así solo los restablecimientos se guardan con hash (SHA-256 en base64url) y no se toca lo demás.
*Alternativa descartada:* tabla propia de tokens con hash y vencimiento. Es más código y más superficie de error (uso único con carreras) para lo que la biblioteca ya resuelve en una transacción.
*Nota:* `storeIdentifier` aplica a nuevas filas; no hay filas antiguas de restablecimiento porque el flujo nunca estuvo activo.

### 2. El enlace lo armamos nosotros
`sendResetPassword` recibe `{ user, token }` e ignora la `url` de Better Auth (apunta a `/api/auth/reset-password/...`, que no existe). El enlace es `${BETTER_AUTH_URL}/restablecer?token=${token}`. La página `/restablecer` envía el token por `POST /api/sesion/restablecer`.
*Alternativa descartada:* montar el manejador de la biblioteca solo para esa ruta: rompe el formato único de errores y expone endpoints sin uso (ADR 0005).

### 3. Enviar el correo después de responder
`sendResetPassword` no espera el envío: lo programa con `after()` de `next/server` (se ejecuta tras la respuesta en Vercel). Así, el tiempo de respuesta es el mismo exista o no la cuenta, y una caída de Resend no cambia la respuesta (se registra el error en el servidor). La función de envío se inyecta en `crearAuth` para probarla sin red ni Next.
*Alternativa descartada:* `await` del envío: la latencia de Resend (cientos de ms) delata las cuentas existentes.

### 4. Módulo de correo pequeño y aislado
`src/lib/correo.ts` exporta `enviarCorreoRestablecimiento({ para, nombre, enlace })` sobre el SDK `resend`, con texto plano y HTML mínimo en español de Perú. Lee `RESEND_API_KEY` y `CORREO_REMITENTE` mediante una función nueva `leerEnvCorreo` en `env.ts`, separada de las demás para que `/api/salud` y el inicio de sesión no dependan de ellas. Si Resend responde con error, se lanza para que se registre; nunca llega al cliente.

### 5. Rutas y esquemas propios
En `rutas-sesion.ts` se agregan `olvide` y `restablecer` a `crearRutasSesion`:
- `olvide`: `exigirJson`, valida `{ correo }` con el esquema de correo ya existente, llama a `a().api.requestPasswordReset({ body: { email } })` y responde `200 { mensaje }` con un texto fijo.
- `restablecer`: `exigirJson`, valida `{ token, contrasena }` (la contraseña con las reglas de `contrasenaNueva`), llama a `a().api.resetPassword({ body: { token, newPassword } })` y responde `200 { ok: true }` sin cookies.
- `traducirErrorAuth` mapea `INVALID_TOKEN` a `ErrorApi(400, "enlace_invalido", "El enlace no es válido o ya venció. Pide uno nuevo.")`, igual para token inexistente, vencido o usado (no se distingue entre ellos).

### 6. Pantallas con el `Formulario` existente donde sirve
`/olvide` reutiliza el estilo de `app/(cuenta)/formularios.module.css`. `Formulario` hoy redirige al éxito; `/olvide` necesita mostrar un mensaje y `/restablecer` ir a `/ingresar`, así que se amplía con una prop opcional de éxito (`mensajeExito` o destino) sin cambiar el comportamiento actual. `/restablecer` lee `searchParams` como promesa (Next.js 16) y, sin token, muestra el aviso de enlace inválido. Un `enlace_invalido` del servidor muestra el mismo aviso con el enlace a `/olvide`.

### 7. Pruebas con el adaptador de memoria
Pruebas Vitest con `crearAuth(memoryAdapter(...))`, un correo simulado inyectado y `vi.useFakeTimers` para el vencimiento. Cubren: respuesta uniforme, un solo correo para una cuenta existente, ninguno para una inexistente, hash en `verificaciones`, un solo uso, vencimiento, contraseña corta que conserva el token y cierre de sesiones. Sin Playwright (preferencia del proyecto desde el ítem 2); la verificación de producción es con `curl` usando una cuenta `@tiza.test`.

## Risks / Trade-offs

- **[Sin límite de frecuencia]** El `rateLimit` de Better Auth solo actúa sobre su manejador HTTP, que no se monta; alguien podría pedir correos en masa a una cuenta ajena. → Se deja anotado como pendiente fuera de este ítem; Resend limita el envío en su plan gratuito y cada solicitud inválida no envía nada. Conviene abrir un ítem aparte (límite por correo e IP) antes de abrir al público.
- **[Remitente sin dominio verificado]** Con `onboarding@resend.dev` Resend solo entrega al correo dueño de la cuenta, así que en pruebas solo llegan correos a esa dirección. → `CORREO_REMITENTE` es una variable; se cambia al verificar un dominio, sin tocar código. La verificación real de entrega por correo queda sujeta a ese dominio.
- **[Correo fallido en silencio]** Al enviar después de responder, un fallo de Resend no se ve en el cliente. → Se registra con `console.error` (visible en los registros de Vercel); la persona puede volver a pedir el enlace.
- **[Token en la URL]** El token queda en la URL de `/restablecer` y en el historial. → Es de un solo uso y vence en 1 h; la página envía `Referrer-Policy: no-referrer` y el token se manda por `POST`, no en la URL de la API.
- **[Cerrar todas las sesiones]** Si alguien pide restablecer a una cuenta ajena, no pierde la sesión hasta que complete el cambio con el enlace, que solo llega al dueño del correo. → Sin riesgo adicional.
- **[Actualizaciones de Better Auth]** Los nombres `INVALID_TOKEN` y el formato del identificador son de la versión fijada 1.7.11. → La versión está fija; las pruebas fallan si cambian.
