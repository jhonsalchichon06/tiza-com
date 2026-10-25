# Proposal

## Why

Hoy una persona que olvida su contraseña no puede volver a entrar a su cuenta: el ítem 2 dejó registro e inicio de sesión, pero ninguna forma de recuperar el acceso. El PRD (alcance 1 y caso borde 7) exige un flujo de "Olvidé mi contraseña" con correo enviado por Resend, enlace de un solo uso que vence en 1 hora. Es parte de la base de cuentas que necesitan los ítems de reserva y pago.

## What Changes

- Nueva ruta `POST /api/sesion/olvide`: recibe un correo y responde **siempre lo mismo** (`200` y el mismo mensaje) exista o no la cuenta; solo si existe se envía el correo.
- Nueva ruta `POST /api/sesion/restablecer`: recibe el token del enlace y la contraseña nueva (mínimo 8 caracteres); cambia la contraseña, consume el token y **cierra todas las sesiones abiertas** de esa cuenta.
- Correo de restablecimiento en español de Perú, enviado con Resend, con un enlace a `/restablecer?token=…` que vence a la **1 hora** y sirve **una sola vez**.
- El token se guarda en `verificaciones` **solo como hash** (opción `verification.storeIdentifier` de Better Auth, limitada a los restablecimientos).
- Páginas `/olvide` (pide el correo) y `/restablecer` (pide la contraseña nueva), y un enlace "¿Olvidaste tu contraseña?" en la página de inicio de sesión.
- Variables de entorno nuevas: `RESEND_API_KEY` y `CORREO_REMITENTE`, en `.env.example`, `.env.local` y Vercel.
- Sin cambios de esquema ni migraciones: la tabla `verificaciones` ya existe (migración 0002).
- Sigue sin publicarse `/api/auth/*` (ADR 0005): las rutas son propias y llaman a `auth().api.*`.

## Capabilities

### New Capabilities
- `restablecimiento-contrasena`: solicitud de restablecimiento por correo con respuesta uniforme, enlace de un solo uso con vencimiento de 1 h guardado como hash, cambio de contraseña y cierre de las sesiones abiertas.

### Modified Capabilities

(ninguna: los requisitos de `sesion-usuario`, `cuentas-clientes` y `control-acceso` no cambian; la página de inicio de sesión solo gana un enlace.)

## Impact

- **Código:** `src/lib/auth.ts` (`sendResetPassword`, expiración, `revokeSessionsOnPasswordReset`, `storeIdentifier`), `src/lib/env.ts` (variables de Resend), `src/lib/rutas-sesion.ts` y `src/lib/validacion-sesion.ts` (rutas y esquemas), un módulo nuevo de correo en `src/lib/`, `app/api/sesion/olvide/`, `app/api/sesion/restablecer/`, `app/(cuenta)/olvide/`, `app/(cuenta)/restablecer/` y la página `ingresar`.
- **Dependencias:** paquete `resend`.
- **Servicios externos:** cuenta de Resend. Sin dominio verificado, Resend solo envía desde `onboarding@resend.dev` y solo al correo dueño de la cuenta; para correos reales hace falta verificar un dominio.
- **Fuera de alcance (PRD, "No alcance"):** códigos de un solo uso por correo o SMS, inicio de sesión social y cualquier otro correo (confirmación de registro, avisos de renovación).
- **Riesgo abierto:** Better Auth no aplica su límite de intentos porque no se monta su manejador HTTP, así que la solicitud de restablecimiento no tiene límite de frecuencia (ver `design.md`).
