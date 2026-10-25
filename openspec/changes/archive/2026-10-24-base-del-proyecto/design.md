# Design

## Context

Ver proposal.md (Why). Estado observado en el repositorio, sin commit:

- **App:** Next.js 16 (App Router) en la raíz, con `app/layout.tsx`, `app/page.tsx` y una ruta comodín `app/api/[...ruta]/route.ts` que responde `404` con el formato único.
- **Base de datos:** `src/db/cliente.ts` crea un Drizzle perezoso sobre `Pool` de `@neondatabase/serverless` con WebSocket (`ws`), un solo driver para lecturas y transacciones.
- **Esquema:** `src/db/esquema.ts` define `configuracion` (clave, valor `jsonb`, `provisional`, `actualizado_en`) y `equipos` (id, nombre único, activo). La migración `0000_base.sql` las crea, pero no habilita `btree_gist` ni carga datos.
- **Librerías:** `src/lib/errores.ts` (`ErrorApi`, `manejar`), `src/lib/reintento.ts` (`conReintento`) y `src/lib/env.ts` (`leerEnv` con zod), con 16 pruebas de Vitest que pasan.
- **Sin configurar:** no hay `.env.local`, así que la migración nunca se aplicó. No hay proyecto de Vercel ni base de Neon.
- **Demo:** sigue en la raíz (HTML, JS, CSS, `assets/`, `vite.config.js`). Playwright la levanta con `npm run demo:dev` y lee las pruebas de `testeo-playw/`.

Restricciones: plan Hobby de Vercel y Neon (ADR 0001 y 0004); los secretos solo en variables de entorno (CLAUDE.md, regla 4); los valores marcados `REVISAR` en el PRD no son definitivos (CLAUDE.md, regla 3).

## Goals / Non-Goals

**Goals:**
- Que cualquier ítem siguiente pueda leer un parámetro del negocio con su tipo, sin escribir números en el código.
- Que `npm run db:migrate` deje una base nueva lista (extensión, tablas, datos) en un solo paso, igual en desarrollo y en producción.
- Que cada despliegue se pueda verificar con una sola petición.

**Non-Goals:**
- Ramas de Neon por despliegue de vista previa: los previews de Vercel usarán la misma base que producción hasta que haga falta separarlas.
- Edición de parámetros desde un portal: en esta versión se cambian con SQL o con una migración de datos.
- Caché de la configuración.

## Decisions

### 1. Un solo driver de Neon (WebSocket)

Se mantiene el cliente existente: `Pool` con WebSocket para todas las consultas. El ADR 0009 permite usar uno o los dos drivers. `BACKLOG.md` dice "HTTP para lecturas y WebSocket para transacciones", así que hay que alinear ese texto.

- **Alternativa:** HTTP para lecturas y WebSocket para transacciones. Ahorra algo de latencia en la primera consulta, pero obliga a decidir en cada consulta qué cliente usar, y un error ahí rompe una transacción en silencio.
- **Requisito:** las rutas que usan la base deben correr en el runtime de Node.js (el valor por defecto), no en Edge, porque `ws` necesita Node.

### 2. Configuración como filas clave-valor con valores en `jsonb`

Se conserva la tabla existente. Cada parámetro es una fila; los que se usan juntos van en el mismo valor:

| Clave | Valor | Provisional |
|---|---|---|
| `niveles_hogar` | lista ordenada de `{ max_dormitorios, max_banos, horas }`; `null` = sin máximo | no |
| `precios_niveles` | lista de 4 precios en céntimos `[6600, 9900, 12900, 18900]` | sí |
| `horas_extra_tipo` | `{ estandar: 0, profunda: 1, mudanza: 2 }` | no |
| `multiplicadores_precio` | `{ estandar: 1, profunda: 1.5, mudanza: 1.7 }` | sí |
| `paquetes_horas` | lista de `{ horas, precio }` en céntimos: 3/9900, 4/12900, 6/18900, 8/23900 | sí |
| `apoyo_extra` | `{ umbral_horas: 6, factor_agenda: 0.5 }` | no |
| `membresia_precio_mensual` | `8900` (céntimos) | sí |
| `membresia_meses` | `3` | no |
| `horas_gratis` | `3` | no |
| `descuento_miembro` | `0.10` | no |
| `anticipacion_minima_horas` | `48` | no |
| `espera_pago_horas` | `24` | no |
| `traslado_horas` | `1` | no |
| `intervalo_horarios_minutos` | `30` | no |
| `credito_vence_meses` | `3` | no |
| `horario_atencion` | `{ dias: [1,2,3,4,5,6], apertura: "08:00", cierre: "18:00", zona: "America/Lima" }` | no |

- **Precios por nivel separados de las duraciones:** las duraciones las confirmó el negocio y los precios están pendientes (`REVISAR`). Separarlos permite marcar como provisional solo lo que lo es.
- **Montos en céntimos enteros:** evitan errores de redondeo con decimales (por ejemplo, S/ 193,50 = 19350).
- **No se carga la duración de la renovación:** el PRD la tiene sin definir, y la decidirá el ítem 15.
- **Alternativa:** una columna por parámetro en una tabla de una sola fila. Da tipos en la base, pero cada parámetro nuevo exige una migración de esquema. Se descartó porque los parámetros todavía cambian.

### 3. Lectura validada en `src/lib/configuracion.ts`

- Un esquema zod por clave.
- Una función pura `validarParametro(clave, valor)` que devuelve el valor tipado o lanza un error que nombra la clave. Es la que se prueba con Vitest, sin base de datos.
- Una función `leerConfiguracion()` que lee todas las filas en una consulta y valida cada una, para que los cálculos del ítem 4 tengan todos los parámetros de una vez.
- Sin caché: se lee en cada petición, lo que cumple "un cambio se ve en la siguiente lectura". Son unas 16 filas.
- **Alternativa:** caché en memoria con vencimiento. Se descartó por ahora: en Vercel cada instancia tendría su propia copia y un cambio tardaría en verse.

### 4. Datos iniciales en una migración SQL propia

Se crea con `drizzle-kit generate --custom --name=extension_y_datos_iniciales` y contiene:

- `CREATE EXTENSION IF NOT EXISTS btree_gist;`
- `INSERT ... ON CONFLICT (clave) DO NOTHING` para cada parámetro;
- `INSERT ... ON CONFLICT (nombre) DO NOTHING` para los equipos "Equipo 1" y "Equipo 2".

`ON CONFLICT DO NOTHING` hace que volver a aplicar la migración no pise un parámetro que se haya editado después. No se modifica `0000_base.sql`, aunque nunca se haya aplicado, para que el historial de Drizzle siga coherente con su snapshot.

- **Alternativa:** un script `db:seed` aparte. Se descartó porque es un paso manual que se puede olvidar en un entorno, y entonces la lectura validada fallaría.

### 5. Migraciones aplicadas a mano antes de desplegar

`npm run db:migrate` se corre desde la máquina local con la `DATABASE_URL` del entorno de destino, antes del despliegue que necesita el cambio.

- **Alternativa:** correr las migraciones en el comando de build de Vercel. Se descartó porque cada preview migraría la base de producción, y una migración fallida rompería el build sin dejar claro por qué.

### 6. `GET /api/salud`

Una ruta envuelta en `manejar` que ejecuta `SELECT 1` dentro de `conReintento`.

- Si `DATABASE_URL` falta, `leerEnv` lanza un error que `manejar` registra completo y responde como `500` genérico, que es justo lo que pide la spec.
- La ruta no se cachea: en Next.js 16 los Route Handlers `GET` no se cachean por defecto, y el proyecto no activa Cache Components.

### 7. Demo en `demo/`

Se mueven con `git mv`: los 3 HTML, `auth.js`, `cuenta.js`, `reservar.js`, `script.js`, `transition.js`, `styles.css`, `assets/`, `vite.config.js` y `testeo-playw/`.

- `playwright.config.ts` se queda en la raíz y apunta a `demo/testeo-playw`.
- Los scripts quedan `demo:dev = vite demo`, `demo:build = vite build demo` y `demo:preview = vite preview demo`. Vite toma `demo/vite.config.js` porque usa como raíz la carpeta indicada.
- `tsconfig.json` excluye `demo/` en lugar de `testeo-playw`.
- Las rutas internas de la demo son relativas (`styles.css`, `assets/...`), así que no cambian.
- **Alternativa:** dejar la demo en la raíz junto a Next.js. Funciona, pero mezcla dos sitios en la misma carpeta y confunde qué archivo sirve cada uno.

### 8. Vercel y Neon

- La base se crea desde la integración de Neon en el Marketplace de Vercel, que carga `DATABASE_URL` (con pooler) en las variables del proyecto. Para desarrollo, se copia a `.env.local`.
- La región de las funciones de Vercel y la de Neon deben ser la misma, para no sumar latencia en cada consulta.

## Risks / Trade-offs

- **`btree_gist` podría no estar disponible en el plan de Neon** → la migración falla con un error claro en el primer `db:migrate`; se verifica en la tarea de aplicar migraciones, antes de que el ítem 6 dependa de ella.
- **Usar valores provisionales como si fueran reales** → el campo `provisional` queda visible para quien consulte la tabla; el ítem 4 y la landing (ítem 5) deberán decidir si muestran un aviso.
- **Una lectura por petición sin caché** → suma una consulta pequeña por petición; es aceptable para el tráfico esperado y se puede cachear después sin cambiar la spec.
- **El preview de Vercel usa la base de producción** → durante este ítem no hay datos de clientes; antes del ítem 9 conviene revisar si hacen falta ramas de Neon por preview.
- **Mover la demo rompe enlaces o comandos que alguien tenga guardados** → la tabla de comandos de `CLAUDE.md` se actualiza en el mismo cambio, y las pruebas de Playwright confirman que la demo sigue funcionando.
- **Las pruebas de ejemplo de Playwright (`example.spec.ts`) dependen de internet** y fallan sin conexión → no se tocan en este cambio; quedan como están.

## Migration Plan

1. Crear las cuentas y el proyecto de Vercel con Neon (paso manual del dueño del repositorio).
2. Copiar `DATABASE_URL` a `.env.local` y correr `npm run db:migrate`.
3. Verificar en la base: `btree_gist` instalada, 16 parámetros y 2 equipos.
4. Desplegar y llamar a `GET /api/salud` en la URL de producción.

**Rollback:** la base todavía no tiene datos de clientes. Si algo sale mal, se puede borrar y crear de nuevo, y aplicar las migraciones otra vez. El movimiento de la demo se revierte con `git revert`.

## Open Questions

- **Región de despliegue:** por ejemplo, `iad1` con `aws-us-east-1`, o São Paulo, que está más cerca de Lima. No cambia la spec ni las tareas; se decide al crear los proyectos, cuidando que ambas coincidan.
