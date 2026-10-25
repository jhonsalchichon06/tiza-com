# DEPLOY-PLAN: Tiza.com

Fecha: 2026-10-24 · Estado: **BORRADOR, pendiente de aprobación** · Nada de este plan se ha ejecutado.

Este plan sale de lo que el repositorio y la cuenta de Vercel muestran hoy (fase DISCOVER). Lo que el proyecto no define queda marcado como **decisión tuya**. No se asume ningún proveedor, secreto ni estrategia que no exista ya.

## 1. Lo que se encontró (DISCOVER)

| Tema | Hallazgo | Fuente |
|---|---|---|
| Stack | Next.js 16 (App Router), React 19, TypeScript, Node 24, npm. Un solo repositorio, sin monorepo. | `package.json` |
| Artefacto | Salida de `next build` (`.next/`), construida por Vercel. No es un paquete publicado. La demo (`demo/`) no se despliega. | `.vercelignore` |
| Hosting | Vercel, proyecto `alcatraz2/tiza-com`, funciones en `gru1`, producción en https://tiza-com.vercel.app. Último despliegue de producción: hace 18 h, `Ready`. | `vercel.json`, `vercel ls` |
| Conexión con Git | **El repositorio no está conectado a Vercel.** Se despliega con la CLI (`vercel deploy --prod`), así que hoy no hay auto-deploy que gobernar. | `CLAUDE.md` |
| Base de datos | Neon (PostgreSQL), `tiza-db`, `aws-sa-east-1`. Drizzle: 13 migraciones (`0000`–`0012`) en `src/db/migraciones/`. Migrar se hace a mano con `npm run db:migrate`, nunca en el build. | `drizzle.config.ts` |
| Servicios externos | Better Auth (sesiones en la base), Resend (correo), Vercel Blob privado (comprobantes y fotos). Pagos simulados, sin pasarela. | `package.json`, `PRD.md` |
| Cron | `/api/cron/huerfanos` diario a las 08:00 UTC, protegido con `CRON_SECRET`. | `vercel.json` |
| Variables | Definidas en Vercel: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `RESEND_API_KEY`, `CORREO_REMITENTE`, `BLOB_READ_WRITE_TOKEN`, `CRON_SECRET`, `WHATSAPP_NUMERO`. Plantilla en `.env.example`. | `vercel env ls` |
| Pruebas | Vitest unitarias (`npm test`, sin conexión a la base). Pruebas contra Neon (`*.bd.test.ts`, a mano). Playwright e2e de la app (`playwright.app.config.ts`, exige `DATABASE_URL_PRUEBAS` distinta de producción). | `vitest*.config.ts`, `e2e/` |
| Verificación | `GET /api/salud` hace `select 1` contra Neon y responde `200 {"estado":"ok"}`. | `app/api/salud/route.ts` |
| CI/CD | **No existe** (`.github/` no existe). | búsqueda en el repo |
| Estado de Git | Rama `main`, 2 commits. **Unos 745 archivos están en el área de preparación sin confirmar**, incluida toda la app Next.js. Lo que corre en producción no corresponde a ningún commit. | `git status` |
| Observabilidad | Solo los logs de Vercel. No hay alertas, métricas ni monitoreo externo. | sin evidencia en el repo |
| Seguridad (Security Pass del 2026-10-24) | Sin hallazgos CRITICAL/HIGH. Pendientes relevantes para publicar: SEC-01 (sin límite de intentos en inicio de sesión, registro y "Olvidé mi contraseña"), SEC-02 (sin cabeceras de seguridad), SEC-05 (pruebas que pueden tocar producción). | `SECURITY-REPORT.md` |

### Riesgos que el descubrimiento dejó a la vista

1. **Producción no es trazable a un commit.** No se puede reconstruir ni auditar qué se desplegó.
2. **Una sola base para todo.** `DATABASE_URL` vale lo mismo en Production, Preview y Development, y también es la de `.env.local`. Un despliegue de vista previa o un `npm run dev` escriben en producción. Es el riesgo más serio del sistema actual.
3. **No hay compuerta.** Nada obliga a pasar pruebas o `next build` antes de `vercel deploy --prod`; depende de la disciplina de quien lo ejecuta.
4. **Revertir el código no revierte los datos.** Las migraciones solo avanzan; un `vercel rollback` deja el esquema en su versión nueva.
5. **Sin observabilidad activa.** Una caída solo se nota si alguien mira.

## 2. Diseño (DESIGN)

### 2.1 Build
- `npm ci` y `next build` lo ejecuta Vercel al desplegar. Es determinista con `package-lock.json` y Node 24 (fijar `engines.node` en `package.json`: hoy no está fijado).
- Compuerta previa en local o en CI (ver 2.8): `npx tsc --noEmit`, `npm test`, `npm run build`.
- Falta un script `typecheck` en `package.json`; se propone añadirlo en GENERATE.

### 2.2 Artefacto y trazabilidad
- Artefacto: el despliegue de Vercel generado por `next build`.
- Antes de desplegar, **todo el trabajo se confirma en un commit** y se etiqueta (`v<fecha>` o `v1.N`). El despliegue lleva ese commit: `vercel deploy --prod --meta gitCommit=<sha> --meta gitTag=<tag>`.
- Resultado: cada despliegue de producción se rastrea a un commit y se puede reconstruir.

### 2.3 Configuración y secretos
- Secretos y cadenas de conexión solo en variables de Vercel y `.env.local` (ignorado). Nada en el repo; `.env.example` queda como plantilla sin valores.
- Sin cambios en las variables actuales. Rotar `BETTER_AUTH_SECRET` cierra todas las sesiones; se hace solo con tu autorización.
- Si se adopta la opción B de 2.8, aparecerían `VERCEL_TOKEN`, `VERCEL_ORG_ID` y `VERCEL_PROJECT_ID` como secretos de GitHub. **No se crean ni se piden hasta que lo decidas.**

### 2.4 Infraestructura
- Se mantiene lo que ya existe: Vercel (Hobby, `gru1`) + Neon (`sa-east-1`) + Blob + Resend. No se cambia nada.
- El cron diario cabe dentro de los límites del plan actual. <!-- REVISAR: confirmar los límites vigentes del plan de Vercel y de Neon si el tráfico crece. -->

### 2.5 Entornos — **decisión tuya**
Hoy hay un solo entorno de datos efectivo: producción. Propuesta:

| Entorno | Datos | Cambio necesario |
|---|---|---|
| Producción | Rama principal de Neon | ninguno |
| Pruebas / Preview | **Rama de Neon aparte** (ya se usa `DATABASE_URL_PRUEBAS` para e2e) | asignar a Preview una `DATABASE_URL` de una rama de Neon distinta de la de producción |
| Desarrollo local | Rama de Neon de desarrollo (o la de pruebas) | `.env.local` deja de apuntar a producción |

Cambiar variables de Vercel o crear ramas de Neon es una acción sobre infraestructura real: se hace solo con tu autorización puntual (ver EXECUTE).

### 2.6 Estrategia de release — **decisión tuya**
Propuesta: **release directo con verificación inmediata y rollback listo**, no canary ni blue/green.
Razón: sitio de demostración con pagos simulados, un solo desarrollador, tráfico bajo, sin versiones concurrentes que coordinar. Rolling Releases o banderas de funcionalidad añaden complejidad sin un riesgo que lo justifique hoy. Se reconsidera si el negocio pasa a cobrar de verdad (el PRD ya dice que eso exige actualizarlo).

### 2.7 Datos y migraciones
- Orden fijo: **1) migrar la base, 2) desplegar el código** (regla ya vigente en `CLAUDE.md`).
- Las migraciones deben ser **compatibles hacia atrás** (patrón expandir/contraer): el código anterior debe seguir funcionando con el esquema nuevo, porque entre el paso 1 y el 2 conviven, y porque el rollback de código dejará el esquema nuevo. Columnas nuevas nulas o con valor por defecto; borrar o renombrar solo en un segundo despliegue.
- Antes de migrar producción: anotar la hora y crear una rama/instantánea de Neon para poder restaurar (ver 2.10).
- **Un rollback de código no es un rollback de datos.** Revertir datos exige restaurar Neon a un punto en el tiempo y se decide caso por caso.
- Hoy `db:migrate` usa la `DATABASE_URL` de `.env.local`, que es producción: antes de ejecutarlo se muestra a qué base apunta y se pide confirmación.

### 2.8 Compuertas de despliegue (deploy gates) — **decisión tuya**
Como el repositorio no está conectado a Vercel, **no hay auto-deploy-on-push** y por eso no existe el problema de "check rojo + deploy vivo". La compuerta real se puede construir de dos formas:

- **Opción A (propuesta, mínima):** un script `scripts/desplegar` que, en orden, comprueba árbol limpio y commit, ejecuta `tsc --noEmit`, `npm test` y `npm run build`, y recién entonces **te pide autorización** para migrar y para `vercel deploy --prod`. No requiere nuevos secretos ni cuentas. Límite: la compuerta vive en tu máquina; no impide que alguien ejecute `vercel deploy` a mano.
- **Opción B:** GitHub Actions. CI en cada PR y push (typecheck, pruebas, build) y un trabajo de despliegue que solo corre si el CI pasó, con `vercel deploy --prebuilt`. Es una compuerta de verdad y deja registro. Requiere: tres secretos de GitHub, que la app de GitHub tenga acceso al repo privado (hoy no lo tiene, por eso el repo no se conecta a Vercel) y proteger la rama `main`. Además, **la migración de producción seguiría siendo manual** y con tu aprobación, nunca dentro del pipeline.

Recomendación: **A ahora, B cuando haya más de una persona o más ritmo de cambios.** Las pruebas `*.bd.test.ts` y Playwright quedan fuera de la compuerta automática porque necesitan una rama de Neon dedicada (2.5).

Compuertas de contenido, no solo técnicas, antes de abrir el sitio a más público: SEC-01 (límite de intentos) y SEC-02 (cabeceras). Se listan como **recomendación, no como bloqueo**: la decisión de publicar con ellos pendientes es tuya.

### 2.9 Verificación y observabilidad
Después de cada despliegue:
1. `curl https://tiza-com.vercel.app/api/salud` debe responder `200 {"estado":"ok"}` (obligatorio, ya es regla del proyecto).
2. Humo manual de la ruta crítica: abrir `/`, `/reservar`, iniciar sesión, `/cuenta`, y comprobar que el aviso de demostración aparece en el paso de pago y en el pie.
3. Revisar `vercel logs` de los primeros minutos buscando errores 5xx.
4. Tras la primera ejecución del cron, confirmar que `/api/cron/huerfanos` respondió 200 (sin `CRON_SECRET` correcto responde error).

Observación posterior (opciones, sin instalar nada): alerta de caída gratuita sobre `/api/salud` (UptimeRobot u otro) y las alertas de Vercel/Neon. <!-- REVISAR: elegir herramienta de monitoreo; no se asume ninguna. -->

### 2.10 Recuperación
| Falla | Respuesta | Quién decide |
|---|---|---|
| Despliegue roto (build o `/api/salud` falla) | `npx vercel rollback` al despliegue anterior `Ready` (o `vercel promote <url>`). El sitio vuelve al código previo en segundos. | **Tú, cada vez** |
| Migración defectuosa | Restaurar la rama/instantánea de Neon tomada antes de migrar, o aplicar una migración correctiva hacia adelante. Los datos escritos después del respaldo se pierden o se reconcilian a mano. | **Tú, cada vez** |
| Secreto expuesto | Rotar la variable en Vercel y redesplegar (cierra sesiones). | **Tú, cada vez** |
| Caída de Neon / Resend / Blob | Sin conmutación automática. `/api/salud` falla; se espera al proveedor. El correo y las imágenes degradan por separado. | — |

Candidato inmediato de rollback hoy: el despliegue de hace 3 días, `tiza-9exqm16sc-alcatraz2.vercel.app` (`Ready`). Anotado, **no ejecutado**.

## 3. Pasos que propone el plan (GENERATE y EXECUTE)

### GENERATE (tras tu aprobación; solo crea archivos, no ejecuta nada)
1. `scripts/desplegar.*`: la compuerta de la opción A (o `.github/workflows/` si eliges B).
2. Script `typecheck` y `engines.node` en `package.json`.
3. Sección "Despliegue" en `CLAUDE.md` que remita a este plan (opcional, tú decides).

### EXECUTE (cada paso, con tu autorización puntual en ese momento)
| # | Acción | Afecta | Reversible |
|---|---|---|---|
| E1 | Confirmar los cambios pendientes en un commit y etiquetarlo | repo local | sí |
| E2 | Subir `main` y la etiqueta a GitHub | repo remoto | parcial |
| E3 | Crear rama de Neon para pruebas/preview y apuntar `DATABASE_URL` de Preview a ella | infraestructura y variables | sí |
| E4 | Tomar la instantánea de Neon previa a migrar | infraestructura | sí |
| E5 | `npm run db:migrate` (solo si hay migraciones nuevas) | **datos de producción** | **no** |
| E6 | `npx vercel deploy --prod --meta gitCommit=…` | **producción** | sí, con rollback |
| E7 | Verificación 2.9 | lectura | — |
| E8 | `vercel rollback` si E7 falla | **producción** | sí |

## 4. Decisiones que necesito de ti para aprobar el plan

1. ¿Opción **A** (script local) u opción **B** (GitHub Actions) para la compuerta?
2. ¿Separamos los datos de Preview y desarrollo creando una rama de Neon (2.5)? Es la recomendación más importante de este plan.
3. ¿Confirmamos el trabajo pendiente en un commit antes del próximo despliegue (y con qué mensaje/etiqueta)?
4. ¿Tratamos SEC-01 y SEC-02 como requisito previo a abrir el sitio al público, o los aceptas por ahora?
5. ¿Release directo con rollback listo (2.6) te parece adecuado para una demostración con pagos simulados?

## 5. Registro de ejecución

### 2026-10-24: plan aprobado, GENERATE hecho
- Decisiones del usuario: compuerta **opción A**; **rama de Neon aparte** para Preview y desarrollo. Plan aprobado en conjunto. Quedan sin respuesta explícita las decisiones 3 (commit), 4 (SEC-01/SEC-02) y 5 (release directo): se mantienen como propuestas y se preguntan en su paso.
- Generado: `scripts/desplegar.mjs` (exige árbol limpio y commit etiquetado; corre `typecheck`, `npm test` y `npm run build`; pide escribir `migrar` y `desplegar` por separado; verifica `/api/salud`; si falla, imprime el rollback sin ejecutarlo).
- `package.json`: scripts `typecheck` y `desplegar`, y `engines.node >=24`.
- Comprobado en local: la sintaxis del script y `npm run typecheck` pasan. El script **no se ha ejecutado**.
- **E3 (parcial), autorizado por el usuario, 2026-10-25:** creada la rama de Neon `desarrollo` (`br-polished-grass-b64k2b9w`, proyecto `orange-dream-96376163`) a partir de `main`, estado `ready`. Ya existía la rama `pruebas` (e2e). La rama es una copia de los datos de producción de ese momento. Pendiente: apuntar `DATABASE_URL` de Preview en Vercel y la de `.env.local` a esta rama (cambio de variables, requiere autorización puntual). La CLI imprimió la cadena de conexión completa en la terminal; no se escribió en ningún archivo del repo.
- **E3 (local), autorizado por el usuario, 2026-10-25:** `DATABASE_URL` de `.env.local` apunta ahora a la rama `desarrollo` (endpoint pooled `ep-damp-term-…`). Respaldo del `.env.local` anterior en el scratchpad de la sesión (contiene la cadena de producción). Consecuencia: `npm run db:migrate` y `npm run dev` ya no tocan producción, **y `scripts/desplegar.mjs` migraría la rama `desarrollo`, no producción**; migrar producción exige pasar su cadena a propósito. Pendiente de ajustar el script.
- **E3 (Vercel), NO hecho:** `DATABASE_URL` sigue siendo una sola variable para Production, Preview y Development, y `vercel env update` cambiaría los tres a la vez. Separarla exige borrarla y recrearla (Production con el valor actual; Preview y Development con `desarrollo`). El intento fue denegado por el clasificador de permisos de Claude Code antes de ejecutarse; no se cambió nada. `vercel env ls` confirma la variable intacta.
- **GENERATE adicional, pedido por el usuario, 2026-10-25:** `.github/workflows/ci-cd.yml` (opción B conviviendo con la A). Trabajo `ci` en cada PR y push a `main` (tipos, pruebas, build). Trabajo `desplegar` solo con disparo manual desde `main`, tras `ci`, en el entorno de GitHub `produccion`, con `vercel pull/build/deploy --prebuilt` y verificación de `/api/salud`. No migra. Requiere los secretos `VERCEL_TOKEN`, `VERCEL_ORG_ID` (`team_1EWrVoTBfxKYAhxaOIzSVprT`) y `VERCEL_PROJECT_ID` (`prj_TWBpwQ6kCZRXWVblA39AxbyA4jFy`); no se crearon. El flujo no se ha ejecutado ni validado en GitHub.
- `scripts/desplegar.mjs`: la migración de producción ahora solo se ofrece si existe `DATABASE_URL_PRODUCCION` (o `.env.produccion`), porque `.env.local` apunta a `desarrollo`. Sintaxis verificada.
- Sin ejecutar todavía: E1, E2, E4 a E8. Hoy `npm run desplegar` se detendría en el primer paso por los cambios sin confirmar.
