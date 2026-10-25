# Proposal

## Why

Todos los ítems del backlog (autenticación, agenda, reservas, pagos) necesitan una aplicación Next.js conectada a Neon, una base de datos con los parámetros del negocio cargados y una forma común de responder errores. Sin esta base, cada ítem tendría que resolverla por su cuenta. Es el ítem #1 de `BACKLOG.md` y el único sin dependencias.

Parte de la base ya existe en el repositorio, sin commit: la app Next.js en la raíz, el cliente de Drizzle con el driver WebSocket de Neon, el formato único de errores, el reintento ante Neon dormido y la validación de variables de entorno, con pruebas unitarias. Falta lo que deja la base lista para usar y desplegar.

## What Changes

- **Completar la base de datos inicial:**
  - habilitar la extensión `btree_gist`, que necesita la restricción de exclusión de las reservas del ítem #6 (ADR 0002 y 0007);
  - cargar `configuracion` con los parámetros del negocio del PRD, marcando como provisionales los que el PRD tiene pendientes (`REVISAR`);
  - cargar los 2 equipos iniciales.
- **Leer la configuración con tipos:** un módulo del servidor que lee `configuracion` y valida cada valor con zod. Si una clave falta o tiene un valor inválido, falla con un error claro en lugar de usar un valor por defecto.
- **Verificar el estado del servicio:** `GET /api/salud` comprueba que la app llega a la base, usando el reintento ante Neon dormido. Sirve para confirmar cada despliegue.
- **Mover la demo a `demo/`:** las páginas HTML, sus scripts y estilos, `vite.config.js` y las pruebas de Playwright pasan a `demo/`, que sigue funcionando con Vite como referencia visual. La raíz queda solo para la app Next.js.
- **Desplegar en Vercel con Neon:** proyecto de Vercel conectado al repositorio, base de Neon, `DATABASE_URL` en las variables de entorno y migraciones aplicadas.
- **Documentar los comandos nuevos** en `CLAUDE.md`: desarrollo, migraciones, pruebas unitarias y demo.

Fuera de alcance: las tablas de usuarios, reservas, pagos y demás (cada una llega con su ítem), la autenticación (#2), el cálculo de precios (#4) y la migración de la landing a Next.js (#5).

## Capabilities

### New Capabilities

- `api-errores`: formato único de error JSON de la API, códigos de estado estándar, ocultar el detalle de los errores inesperados y un solo reintento ante Neon dormido.
- `configuracion-negocio`: los parámetros del negocio (niveles del hogar, multiplicadores, paquetes, membresía, plazos, horario) y los equipos se guardan como datos, se leen validados y distinguen los valores provisionales.
- `salud-servicio`: un endpoint que informa si la aplicación está en pie y llega a la base de datos.

### Modified Capabilities

Ninguna: `openspec/specs/` está vacío.

## Impact

- **Código:** `src/db/esquema.ts`, nuevas migraciones en `src/db/migraciones/`, nuevo `src/lib/configuracion.ts`, nueva ruta `app/api/salud/route.ts`.
- **Estructura:** la demo pasa de la raíz a `demo/`. Cambian `playwright.config.ts` (ruta de las pruebas y comando del servidor) y los scripts `demo:*` de `package.json`.
- **Sistemas externos:** un proyecto de Vercel (plan Hobby) y una base de Neon. Ambos requieren que el dueño del repositorio cree las cuentas; `DATABASE_URL` vive solo en `.env.local` y en las variables de Vercel.
- **Documentación:** la tabla de comandos de `CLAUDE.md` y la nota de que Vercel y Neon todavía no están configurados.
