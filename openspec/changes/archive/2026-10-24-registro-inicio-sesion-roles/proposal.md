# Proposal

## Why

Casi todo lo que sigue en el backlog (reservas, pagos, perfil, portal de administrador) depende de saber quién es el cliente y si es administrador. Hoy la única "autenticación" es la de la demo, que guarda la sesión en `localStorage` y no es segura (CLAUDE.md, regla 5). Es el ítem #2 de `BACKLOG.md`, y solo depende de la base del proyecto (#1), que ya está en producción.

## What Changes

- **Better Auth como biblioteca de autenticación**, con sesiones guardadas en Neon y cookie segura. Esto resuelve el pendiente del ADR 0005, que dejaba abierta la elección entre Better Auth y Auth.js.
- **Registro de clientes** con correo, contraseña (mínimo 8 caracteres), nombre y celular. Al registrarse, la cuenta queda con la sesión iniciada y siempre con rol `cliente`: el registro nunca acepta un rol.
- **Inicio y cierre de sesión** con correo y contraseña. Ante credenciales incorrectas, un mensaje genérico que no revela si el correo existe.
- **Protección por sesión y rol en el servidor:**
  - las rutas `/api` privadas responden `401` sin sesión;
  - las rutas de administración responden `403` a quien no es admin;
  - las páginas de cuenta redirigen al inicio de sesión;
  - `/admin` redirige a quien no es admin.
- **Páginas mínimas:** `/registro`, `/ingresar`, `/cuenta` (saludo y cerrar sesión) y `/admin` (portada vacía del portal). Su contenido real llega con los ítems 11, 12 y 16.
- **Comando `npm run admin:promover <correo>`**, que convierte en administrador a una cuenta ya registrada.
- **ADR 0005 actualizado** con la biblioteca elegida.

Fuera de alcance:
- "Olvidé mi contraseña" (ítem 3).
- El perfil real del cliente (ítem 12) y el contenido del portal de administrador (ítems 11 y 16).
- Inicio de sesión social o por código (No alcance del PRD).
- Verificación del correo.
- Límite de intentos de inicio de sesión: no está en los criterios del TDD (advertencia A2 de la revisión adversarial).

## Capabilities

### New Capabilities

- `cuentas-clientes`: registro de clientes con sus datos, validaciones y almacenamiento seguro de la contraseña.
- `sesion-usuario`: inicio y cierre de sesión con correo y contraseña, sesión persistente revocable y consulta de la sesión actual.
- `control-acceso`: exigencia de sesión y de rol `admin` en rutas de la API y en páginas, y asignación del rol de administrador fuera de la web.

### Modified Capabilities

Ninguna. `openspec/specs/` está vacío porque `base-del-proyecto` todavía no se archivó. Las respuestas de error de este cambio siguen el formato único de `api-errores` (definido en ese cambio), sin modificarlo.

## Impact

- **Dependencias:** `better-auth` (y `tsx` para el script de administrador).
- **Base de datos:** una migración nueva con las tablas que requiere Better Auth: usuarios (con `telefono` y `rol`), sesiones, cuentas y verificaciones.
- **Código:** `src/lib/auth.ts` (configuración), `src/lib/sesion.ts` (exigir sesión o admin), rutas `app/api/sesion/**`, páginas `app/(cuenta)/**` y `app/admin/**`, `scripts/promover-admin.ts`, y `src/lib/env.ts` con las variables nuevas.
- **Variables de entorno:** `BETTER_AUTH_SECRET` y `BETTER_AUTH_URL`, en `.env.local` y en Vercel, nunca en el repositorio.
- **Documentación:** ADR 0005 (biblioteca elegida) y la tabla de comandos de `CLAUDE.md`.
