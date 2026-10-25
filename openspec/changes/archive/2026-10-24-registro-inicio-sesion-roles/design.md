# Design

## Context

Ver proposal.md (Why). Estado observado:

- **Base del proyecto (ítem 1):** Next.js 16 en la raíz, Drizzle sobre el `Pool` WebSocket de Neon (`src/db/cliente.ts`), formato único de errores con `manejar` y `ErrorApi` (`src/lib/errores.ts`, que ya define `sinSesion` 401 y `sinPermiso` 403), `conReintento`, y `leerEnv()` que exige `DATABASE_URL`. Producción en https://tiza-com.vercel.app (funciones en `gru1`, Neon en `aws-sa-east-1`).
- **Esquema:** solo `configuracion` y `equipos`. No hay tablas de usuarios.
- **Rutas:** `app/api/[...ruta]` responde `404` a lo que no existe; `app/api/salud`.
- **Restricciones:**
  - ADR 0005: sesiones en la base, no JWT, y rol comprobado en el servidor en cada ruta.
  - ADR 0003: API REST con JSON y el formato único de errores.
  - CLAUDE.md, regla 5: no reutilizar `demo/auth.js`.
  - Preferencia del usuario: no correr Playwright; verificar con Vitest, `tsc`, el build y `curl`.
- **Una sola base para todo:** la `DATABASE_URL` local apunta a la base de producción (no hay ramas de Neon).

## Goals / Non-Goals

**Goals:**
- Que los ítems siguientes protejan una ruta o una página con una sola llamada (`requerirSesion`, `requerirAdmin`, `usuarioActual`).
- Que el comportamiento de autenticación (hash, sesiones, rol) se pruebe con Vitest sin tocar Neon.

**Non-Goals:**
- Proxy de Next.js (`proxy.ts`) para redirecciones optimistas. Las páginas comprueban la sesión en el servidor, y por ahora alcanza.
- Editar el perfil (nombre, celular): eso llega con el ítem 12.
- Límite de intentos y verificación del correo (ver proposal.md).

## Decisions

### 1. Better Auth con el adaptador de Drizzle

`src/lib/auth.ts` exporta `crearAuth(adaptador)` y una instancia por defecto con `drizzleAdapter(db(), { provider: "pg" })`. La configuración es:

- `emailAndPassword: { enabled: true, minPasswordLength: 8, autoSignIn: true }`. El hash es el que trae la biblioteca (scrypt).
- Sesiones en la tabla de sesiones, con la duración por defecto de Better Auth (7 días, renovada cada día de uso). **Sin `cookieCache`:** cada petición lee la sesión y el rol desde la base, así que un rol retirado tiene efecto en la siguiente petición (lo exige la spec `control-acceso`).
- `user.additionalFields`:
  - `telefono: { type: "string", required: true, input: true }`;
  - `rol: { type: "string", defaultValue: "cliente", input: false }`. Con `input: false`, la biblioteca ignora un `rol` que mande el navegador.

**Alternativa:** Auth.js v5. Sigue en beta, con credenciales solo permite sesiones JWT (descartadas en el ADR 0005) y no trae ni hash ni restablecimiento. Lo decidió el usuario en esta propuesta.

### 2. Rutas REST propias; no se publica el manejador de Better Auth

Las rutas llaman a `auth.api.*` desde el servidor y responden con el formato único:

| Ruta | Cuerpo | Respuesta |
|---|---|---|
| `POST /api/sesion/registro` | `{ correo, contrasena, nombre, celular }` | `201 { usuario }` + cookie |
| `POST /api/sesion` | `{ correo, contrasena }` | `200 { usuario }` + cookie |
| `DELETE /api/sesion` | — | `204`, borra la cookie |
| `GET /api/sesion` | — | `200 { usuario }` o `401` |

- `usuario` = `{ id, correo, nombre, celular, rol }`.
- Las cookies que genera Better Auth se copian a la respuesta usando `returnHeaders: true`, sin el plugin `nextCookies`. Así las rutas se pueden probar fuera de una petición de Next.
- **Alternativa:** montar `toNextJsHandler(auth)` en `/api/auth/[...all]`. Se descartó por tres motivos:
  - responde errores en inglés y con otro formato, lo que rompe la spec `api-errores`;
  - publica endpoints que no se usan (cambiar correo, actualizar usuario, etc.), lo que agranda la superficie de ataque;
  - el contrato queda fuera del ADR 0003.
- **Costo:** el límite de intentos de Better Auth solo actúa sobre su manejador HTTP, así que con este enfoque no protege nada. Queda como riesgo (ver más abajo).

### 3. Validación propia antes de llamar a la biblioteca

Un esquema zod en `src/lib/validacion-sesion.ts`:

- el correo se recorta, se pasa a minúsculas y se valida su formato;
- la contraseña debe tener 8 caracteres o más;
- el nombre se recorta y no puede quedar vacío (hasta 100 caracteres);
- el celular debe cumplir `^9\d{8}$`.

Si falla, responde `422` con un mensaje en español.

Los errores de Better Auth se traducen así:
- `USER_ALREADY_EXISTS*` → `409` "Ese correo ya tiene una cuenta. Inicia sesión.";
- `INVALID_EMAIL_OR_PASSWORD` → `401` "Correo o contraseña incorrectos.";
- cualquier otro error sigue a `manejar`, que responde `500` genérico.

**Supuesto registrado:** el celular es peruano de 9 dígitos que empieza con 9, igual que en la demo.

### 4. Tablas con nombres en español y columnas de Better Auth

Better Auth usa sus nombres de modelo (`user`, `session`, `account`, `verification`). Se mapean a las tablas `usuarios`, `sesiones`, `cuentas` y `verificaciones` con `modelName`. Las columnas propias de la biblioteca (`name`, `email`, `email_verified`, `created_at`…) conservan sus nombres, para no mapear cada campo y evitar errores de configuración. Las columnas nuevas van en español: `telefono` y `rol`.

- `rol` es un `pgEnum("rol_usuario", ["cliente", "admin"])` con valor por defecto `cliente`, así la base rechaza cualquier otro valor.
- **El hash de la contraseña vive en `cuentas.password`** (cuenta de tipo `credential`), no en `usuarios` como dice el TDD. Hay que actualizar la tabla del modelo de datos en `TECH-DESIGN.md`.
- La migración se genera con `drizzle-kit generate` a partir de `src/db/esquema.ts`, escrito para coincidir con lo que espera Better Auth.

### 5. Protección por sesión y rol en `src/lib/sesion.ts`

- `obtenerUsuario(headers)`: devuelve el `usuario` o `null` (llama a `auth.api.getSession`).
- `requerirSesion(headers)`: lanza `ErrorApi.sinSesion()` (401).
- `requerirAdmin(headers)`: lanza `401` sin sesión y `ErrorApi.sinPermiso()` (403) si el rol no es `admin`.
- `usuarioActual()`: para páginas, usa `headers()` de `next/headers`.

Las páginas usan `redirect()`:
- `/cuenta` sin sesión → `/ingresar?volver=/cuenta`;
- `/admin` sin sesión → `/ingresar?volver=/admin`;
- `/admin` con rol `cliente` → `/cuenta`;
- `/registro` e `/ingresar` con sesión → `/cuenta`.

`volver` solo acepta rutas internas: debe empezar con `/`, pero no con `//` ni con `/\`. Esto evita redirecciones abiertas hacia otros sitios.

### 6. Protección contra CSRF en las rutas que cambian estado

La cookie es `SameSite=Lax`, de modo que el navegador no la envía en un POST desde otro sitio. Además, `POST` y `DELETE` en `/api/sesion/**` exigen `Content-Type: application/json`: un formulario de otro sitio no puede enviar ese tipo sin pasar por CORS, que no está habilitado. Si falta, la respuesta es `415`.

### 7. Variables de entorno separadas para la autenticación

`leerEnvAuth()` en `src/lib/env.ts` exige:
- `BETTER_AUTH_SECRET`, de 32 caracteres o más;
- `BETTER_AUTH_URL`, que si falta se completa con `https://${VERCEL_URL}` en los previews.

Va separada de `leerEnv()` para que `/api/salud` no falle por una variable de autenticación. El secreto se genera al azar al implementar, se guarda en `.env.local` y en Vercel con `vercel env add` (sin mostrarlo en pantalla) y nunca se escribe en el repositorio.

### 8. Páginas mínimas

- `app/(cuenta)/registro`, `app/(cuenta)/ingresar` y `app/(cuenta)/cuenta`, más `app/admin` con un layout que comprueba el rol.
- Los formularios son componentes cliente que llaman a la API con `fetch`, muestran el error junto al campo sin borrar lo escrito y, si sale bien, navegan a `volver` o a `/cuenta`.
- El texto es grande y en español (el público va de 30 a 70 años).
- El estilo es mínimo: el diseño de la landing llega con el ítem 5.

### 9. Comando para promover administradores

`scripts/promover-admin.ts` se ejecuta con `tsx` (que respeta el alias `@/`) mediante `npm run admin:promover -- <correo>`.

- Normaliza el correo, actualiza `rol = 'admin'` y confirma.
- Si no existe una cuenta con ese correo, termina con código 1 y no crea nada.
- La lógica va en una función con la consulta inyectable, para probarla con Vitest.

### 10. Pruebas sin Neon ni Playwright

- **Vitest con la biblioteca real:** `crearAuth(memoryAdapter(...))` cubre hash, sesiones, cierre y el rol ignorado. Las rutas se prueban llamando a sus funciones con un `Request`, pasando a mano la cookie que devolvió el registro.
- **Páginas:** se verifican con `curl` contra `next dev` (código `307` y la cabecera `Location`), y con el build.
- **En la base real:** la prueba usa cuentas con correo `prueba-<fecha>@tiza.test`, que se borran al terminar. La base local es la de producción.

## Risks / Trade-offs

- **Sin límite de intentos, alguien puede probar contraseñas por fuerza bruta** → no está en el alcance del ítem. Se puede agregar después con el `rateLimit` de Better Auth sobre su API, o con el firewall de Vercel, sin cambiar las specs.
- **Nombres de error de Better Auth que cambien entre versiones** → la traducción vive en un solo lugar y tiene pruebas. Se fija una versión exacta de `better-auth` en `package.json`.
- **Cada petición autenticada lee la sesión de la base** → suma una consulta. Es lo que pide el ADR 0005 para poder revocar sesiones. Se puede activar `cookieCache` más adelante si la latencia molesta, aceptando una demora en la revocación.
- **El registro revela si un correo ya tiene cuenta** (`409`) → lo pide el TDD ("un correo ya registrado muestra un mensaje claro"). El inicio de sesión, en cambio, no lo revela.
- **Las pruebas manuales escriben en la base de producción** → solo con correos `@tiza.test`, que se borran al terminar. Todavía no hay clientes reales.

## Migration Plan

1. Generar `BETTER_AUTH_SECRET` y cargarlo, junto con `BETTER_AUTH_URL`, en `.env.local` y en Vercel (producción, preview y desarrollo).
2. Aplicar la migración nueva con `npm run db:migrate` antes de desplegar.
3. Desplegar y probar con `curl` el flujo completo en producción: registro, sesión, cierre y `401`.
4. Registrar la cuenta del dueño y promoverla con `npm run admin:promover`.

**Rollback:** se puede revertir el despliegue a la versión anterior en Vercel. Las tablas nuevas no afectan a las existentes; si hiciera falta, se borran con una migración inversa, porque no hay cuentas reales que perder.
