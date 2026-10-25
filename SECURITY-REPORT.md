# Security Pass — Tiza.com

Fecha: 2026-10-24
Alcance revisado:
- **Revisado:** PRD, TECH-DESIGN y ADRs (0005 y 0010 con detalle), CLAUDE.md, código del servidor (`src/lib/**`, `app/api/**`, `app/admin/**`, páginas de `app/(cuenta)`), esquema y migraciones de Drizzle (restricciones únicas), configuración (`next.config.ts`, `vercel.json`, `.gitignore`, `.vercelignore`, `.env.example`), manifiestos de dependencias (`npm audit`), pruebas (por nombre y por las que cubren controles de acceso, importadas por lectura puntual) y soporte de pruebas contra Neon.
- **No revisado / sin material:** CI/CD (no existe `.github/` ni otro pipeline), specs de OpenSpec línea por línea (se leyó su índice, no cada escenario), componentes de React uno por uno (se buscó `dangerouslySetInnerHTML`, `innerHTML` y `eval`: no hay), la demo de `demo/` (código de demostración, no se despliega: `.vercelignore`), la configuración real de Vercel/Neon/Blob/Resend (no es visible desde el repositorio) y el valor de `.env.local` (no se leyó).
- Esta revisión fue estática: no se ejecutó la aplicación ni se probó ningún ataque.

## Resumen ejecutivo

El proyecto está razonablemente sano para su tamaño y su etapa. La autorización se hace en el servidor, con la sesión leída de la base en cada petición, `rol` no editable desde el navegador, filtros por `usuario_id` en las consultas del cliente y entrega de imágenes sin URLs públicas. Las reglas de dinero y de cupos descansan en la base de datos (transacciones, `FOR UPDATE`, índices únicos), no solo en el código.

El riesgo más relevante es la **falta de límite de intentos** en inicio de sesión, registro y "Olvidé mi contraseña": ya estaba reconocido en `TECH-DESIGN.md` y en el ADR 0005, pero no está mitigado, y afecta también a la cuenta de administrador, que aprueba pagos. El resto son endurecimientos de bajo impacto (cabeceras de seguridad, cuota de subidas, dependencias, pruebas que pueden tocar la base de producción). No se encontró ningún hallazgo CRITICAL ni HIGH.

## Fortalezas de seguridad

No conviene tocar estos controles al remediar:

- **Autenticación delegada a una biblioteca** (Better Auth) con hash de contraseña en el servidor, sesión en base de datos y sin `cookieCache`: un cambio de rol o una sesión revocada surten efecto en la siguiente petición (`src/lib/auth.ts:26`, `src/lib/sesion.ts`).
- **Escalada de privilegios cerrada en el registro:** `rol` tiene `input: false` y además zod descarta claves desconocidas (`src/lib/auth.ts:23`, `src/lib/validacion-sesion.ts`). El rol admin solo se otorga con el script `admin:promover`.
- **Control de acceso consistente:** cada ruta `/api/admin/**` usa `requerirAdmin` antes de leer nada; `app/admin/layout.tsx` repite la comprobación en las páginas; las rutas del cliente filtran por `usuario_id` de la sesión junto con el `id` (`src/lib/reservas/cancelar.ts:64`, `nuevo-horario-datos.ts`, `fotos/entrega.ts`), y un recurso ajeno responde igual que uno inexistente (404).
- **Comprobantes y fotos privados:** Blob privado, entrega por el servidor con doble comprobación (dueño del pago **y** carpeta de la ruta), `Cache-Control: private, no-store`, `nosniff`, sin redirección a URL de Blob (`src/lib/imagenes/entrega.ts`, `pagos/comprobante.ts`).
- **Subidas:** la carpeta sale de la sesión, no del navegador; se rechazan `..`, subcarpetas y caracteres de control; el tipo se decide por los bytes iniciales (JPG/PNG/WebP), no por el `Content-Type`; tope de 4 MB; los ids se validan como uuid para evitar 500 por `22P02` (`src/lib/imagenes/rutas.ts`, `firmas.ts`, `verificar.ts`).
- **CSRF:** todas las rutas que cambian estado exigen `application/json` (415 si no), así que un formulario de otro sitio no puede dispararlas con la cookie de sesión.
- **Precios y montos calculados en el servidor:** el esquema de reserva no acepta `monto`, descuentos ni horas gratis del navegador (`src/lib/reservas/esquema-entrada.ts`).
- **Concurrencia e integridad en la base:** transacciones con bloqueo del pago (`bloquearPagoPendiente`), índices únicos parciales (una reserva en espera por cliente, una limpieza gratis por cliente y por hogar, un reemplazo por pago) y restricción de exclusión de horarios (`src/db/esquema.ts`).
- **Restablecimiento de contraseña:** respuesta idéntica exista o no la cuenta, correo enviado con `after()` para no delatar la cuenta por el tiempo de respuesta, token guardado como hash, vencimiento de 1 hora, sesiones revocadas al restablecer, enlace construido con `BETTER_AUTH_URL` (no con la cabecera `Host`).
- **Cron protegido** con comparación en tiempo constante del secreto y sin aceptar sesiones de usuario (`src/lib/imagenes/cron.ts`).
- **Redirección abierta evitada** en `?volver=` (`src/lib/volver.ts`).
- **Secretos:** `.env*` en `.gitignore` y `.vercelignore`; búsqueda de patrones de claves en los archivos versionables sin coincidencias (solo valores de prueba ficticios en tests); variables leídas de forma perezosa y validadas con zod.
- **Errores:** `manejar()` devuelve un 500 genérico sin detalles internos.
- **Cobertura de pruebas de seguridad:** hay pruebas de rutas (sesión, 401/403/404, 415 con `text/plain`), de entrega de imágenes, de firmas, de rutas de subida, de redirección segura y de restablecimiento.

## Findings

### MEDIUM

**ID:** SEC-01
**Title:** Sin límite de intentos en inicio de sesión, registro y "Olvidé mi contraseña"
**Severity:** MEDIUM
**Confidence:** HIGH
**Category:** Autenticación / abuso de recursos
**Affected artifact:** Código, diseño técnico (ADR 0005)
**Location:** `src/lib/rutas-sesion.ts:43-90` (llamadas a `a().api.signInEmail`, `signUpEmail`, `requestPasswordReset`); `src/lib/auth.ts`; `TECH-DESIGN.md:229`; `adrs/0005-sesion-con-biblioteca-de-autenticacion.md:36`
**Description:** La aplicación llama a Better Auth directamente (`auth.api.*`) y no publica su manejador HTTP. El limitador de intentos de la biblioteca se ejecuta en el `onRequest` de su enrutador HTTP (`node_modules/better-auth/dist/api/index.mjs:172`), que estas llamadas no atraviesan. Tampoco hay otro limitador en el repositorio (no hay coincidencias de rate limit en `src/` ni `app/`, ni reglas en `vercel.json`). El propio ADR 0005 lo reconoce y deja la mitigación "si hace falta".
**Evidence:** `signInEmail` se invoca sin ningún contador previo; `vercel.json` solo define región y cron; el ADR dice "el inicio de sesión no tiene límite de intentos".
**Attack scenario:** (1) Fuerza bruta o *credential stuffing* contra `POST /api/sesion` con correos conocidos, incluida la cuenta de administrador, con la contraseña mínima de 8 caracteres. (2) Llamadas repetidas a `POST /api/sesion/olvide` con un correo de tercero: cada llamada dispara un correo de Resend (cuota del plan gratuito, reputación del remitente, molestia a la víctima). (3) Registro masivo de cuentas, que además da acceso a `/api/subidas` (ver SEC-04).
**Potential impact:** Toma de una cuenta de cliente (ver sus reservas y comprobantes) o de la de administrador (aprobar pagos, ver comprobantes de todos). Agotamiento de la cuota de Resend, que dejaría sin correo a los restablecimientos legítimos.
**Existing mitigation:** Mensaje uniforme de credenciales incorrectas; hash de contraseña lento de la biblioteca; el sitio es una demostración con pagos simulados (reduce el valor de la cuenta admin, pero no su sensibilidad: contiene datos personales reales de quien se registre).
**Recommended remediation:** Agregar un límite fuera de la biblioteca: regla de rate limit del Firewall de Vercel sobre `/api/sesion*` (el ADR ya lo sugiere) y/o un contador por IP y por correo en la propia ruta. Priorizar `/api/sesion` (POST) y `/api/sesion/olvide`. Para el administrador, usar una contraseña larga y única.
**Suggested verification:** Prueba de ruta que haga N inicios de sesión fallidos seguidos y espere 429; comprobar en Vercel que la regla del Firewall actúa (p. ej. 30 peticiones en 1 minuto a `/api/sesion`).
**Required change type:** CODE FIX

### LOW

**ID:** SEC-02
**Title:** Faltan cabeceras de seguridad HTTP (CSP, anti-iframe, Referrer-Policy)
**Severity:** LOW
**Confidence:** HIGH
**Category:** Misconfiguration
**Affected artifact:** Configuración
**Location:** `next.config.ts` (config vacía), `vercel.json`
**Description:** No se define `headers()` en Next.js ni en Vercel. Solo las respuestas de imágenes llevan `nosniff`. Las páginas de inicio de sesión, pago y el portal admin se pueden incrustar en un iframe de otro sitio y no hay CSP que limite la ejecución de scripts si algún día aparece una inyección.
**Evidence:** `const config: NextConfig = {};`
**Attack scenario:** Un sitio ajeno incrusta `/admin/pagos/[id]` y engaña al administrador para que pulse "Aprobar" o "Rechazar" (*clickjacking*). La cookie de sesión de Better Auth es `SameSite=Lax` por defecto, que no impide el envío de la cookie en un iframe de navegación de nivel superior, pero sí en subpeticiones de terceros en la mayoría de navegadores modernos; por eso la gravedad queda baja y la confianza en la explotación, media.
**Potential impact:** Acciones involuntarias del administrador o del cliente; menor defensa en profundidad frente a XSS.
**Existing mitigation:** React escapa el texto por defecto; no hay `dangerouslySetInnerHTML` ni `innerHTML` en el código.
**Recommended remediation:** Agregar `headers()` en `next.config.ts` con `X-Frame-Options: DENY` (o `frame-ancestors 'none'`), `Referrer-Policy: strict-origin-when-cross-origin`, `X-Content-Type-Options: nosniff` y una CSP básica compatible con Next.js. Revisar que el cliente de Blob (subida directa) siga funcionando con la CSP (`connect-src`).
**Suggested verification:** `curl -I https://tiza-com.vercel.app/admin` muestra las cabeceras; prueba de que la subida de un comprobante sigue funcionando.
**Required change type:** CODE FIX

**ID:** SEC-03
**Title:** Registro sin verificación de correo y respuesta que confirma si un correo ya tiene cuenta
**Severity:** LOW
**Confidence:** MEDIUM
**Category:** Autenticación / privacidad
**Affected artifact:** Código, requisitos
**Location:** `src/lib/validacion-sesion.ts:62-64` ("Ese correo ya tiene una cuenta"); `src/lib/auth.ts` (sin `requireEmailVerification`); `PRD.md` (alcance 1 y "No alcance")
**Description:** Cualquiera puede registrar un correo ajeno sin demostrar que lo controla, y `POST /api/sesion/registro` responde 409 si el correo ya existe. Esto permite enumerar clientes y crear cuentas a nombre de otras personas. Es coherente con lo que dice el PRD (solo correo y contraseña, sin códigos por correo), por lo que es una decisión de producto, no un descuido.
**Evidence:** `ErrorApi.conflicto("Ese correo ya tiene una cuenta. Inicia sesión.")`.
**Attack scenario:** Un atacante comprueba si una persona concreta es clienta de Tiza, o registra su correo con otro celular para que las reservas y los avisos queden asociados a datos falsos.
**Potential impact:** Fuga mínima de pertenencia a la base de clientes; datos de contacto falsos. Sin acceso a datos de otras personas.
**Existing mitigation:** El restablecimiento de contraseña sí responde igual exista o no la cuenta.
**Recommended remediation:** Decidir si se acepta. Si no, verificar el correo antes de permitir reservar y devolver una respuesta uniforme en el registro.
**Suggested verification:** Si se cambia, prueba de ruta que verifique la misma respuesta para un correo nuevo y uno existente.
**Required change type:** ACCEPT RISK

**ID:** SEC-04
**Title:** Cualquier cuenta recién registrada puede pedir tokens de subida a Blob sin cuota
**Severity:** LOW
**Confidence:** MEDIUM
**Category:** Abuso de recursos
**Affected artifact:** Código, diseño (ADR 0010)
**Location:** `src/lib/imagenes/subidas.ts:36-76`; `src/lib/imagenes/cron.ts` (limpieza diaria)
**Description:** `POST /api/subidas` entrega un token de subida directa a cualquier usuario con sesión. Cada archivo está limitado a 4 MB y a JPG/PNG/WebP, pero no hay un tope de cantidad de archivos por usuario ni por día. Los archivos que nunca se asocian a un pago se borran solo en el cron diario y tras 24 horas.
**Evidence:** `onBeforeGenerateToken` solo valida la ruta y fija tipo y tamaño máximo; no cuenta archivos existentes en `comprobantes/{usuarioId}/`.
**Attack scenario:** Se registran cuentas (sin límite, ver SEC-01) y cada una sube cientos de imágenes de 4 MB para inflar el almacenamiento y el costo de Blob antes de que pase la limpieza.
**Potential impact:** Costo o agotamiento de la cuota del plan de Blob; no hay exposición de datos.
**Existing mitigation:** Tope de tamaño y tipo por token; limpieza de huérfanos; sesión obligatoria.
**Recommended remediation:** Contar los archivos del usuario en su carpeta antes de emitir el token (p. ej. máximo 10 sin asociar) o limitar la frecuencia por usuario; combinar con SEC-01.
**Suggested verification:** Prueba en `subidas.test.ts` que, con N archivos ya subidos, el token N+1 se rechace.
**Required change type:** CODE FIX

**ID:** SEC-05
**Title:** Las pruebas contra la base usan por defecto la base de producción
**Severity:** LOW
**Confidence:** HIGH
**Category:** Proceso / configuración insegura por defecto
**Affected artifact:** Pruebas, proceso
**Location:** `src/db/pruebas-bd.ts` (`crearBasePruebas`: `process.env.DATABASE_URL_PRUEBAS || process.env.DATABASE_URL`); `vitest.bd.config.ts`; `CLAUDE.md` (la `DATABASE_URL` de `.env.local` es la de producción)
**Description:** Si falta `DATABASE_URL_PRUEBAS`, las pruebas `*.bd.test.ts` escriben y borran filas en la base de producción. Los borrados están acotados por prefijos propios y los equipos de prueba son inactivos, pero el resguardo depende de que nadie se equivoque en un prefijo o en una nueva suite. Además, el e2e de Playwright ya exige la rama `pruebas` y se niega a limpiar en producción; las pruebas de base de datos no tienen ese mismo resguardo.
**Evidence:** `crearBasePruebas` devuelve `esRamaDePruebas: Boolean(process.env.DATABASE_URL_PRUEBAS)` pero no corta si es falso; `e2e/limpieza.ts` sí lanza un error en ese caso.
**Attack scenario:** Una suite nueva o una consulta de limpieza mal acotada borra o altera datos reales de clientes al correrse con `PRUEBAS_BD=1`.
**Potential impact:** Pérdida o contaminación de datos de producción (usuarios, pagos, reservas).
**Existing mitigation:** Opt-in con `PRUEBAS_BD=1`, prefijos únicos por corrida, equipos inactivos, rama `pruebas` ya existente para los e2e.
**Recommended remediation:** Hacer que `crearBasePruebas` falle si falta `DATABASE_URL_PRUEBAS` o si es igual a `DATABASE_URL`, igual que `e2e/limpieza.ts`.
**Suggested verification:** Prueba unitaria de `crearBasePruebas` que lance con la variable ausente o igual a la de producción.
**Required change type:** TEST FIX

**ID:** SEC-06
**Title:** Dependencias con avisos de `npm audit` y sin revisión automática
**Severity:** LOW
**Confidence:** MEDIUM
**Category:** Dependencias / cadena de suministro
**Affected artifact:** Manifiestos, proceso
**Location:** `package.json`, `package-lock.json`; no existe `.github/` (sin CI)
**Description:** `npm audit --omit=dev` informa 12 vulnerabilidades. La mayoría son de herramientas de desarrollo que no se despliegan (`vitest` y `tinypool`, marcados critical; `vite`, `esbuild`, `drizzle-kit`). La única que toca el código en ejecución es la cadena `@vercel/blob → @vercel/oidc → @vercel/cli-config → zod` (zod anidado anterior a 4.6.6, agotamiento de memoria al validar colecciones grandes); la `zod` directa del proyecto es `^4.6.7` y no está afectada. La explotación en producción es poco probable porque esa validación no recibe entrada controlada por el visitante.
**Evidence:** Salida de `npm audit` del 2026-10-24. Nota: la corrección sugerida (`npm audit fix --force`) degradaría `@vercel/blob` a 2.4.0 y no debe aplicarse sin revisar.
**Attack scenario:** Para las herramientas de desarrollo: un sitio malicioso contra el servidor de desarrollo de Vite/esbuild mientras se trabaja en local. Para la cadena de Blob: sin escenario concreto demostrado.
**Potential impact:** Principalmente local (equipo de desarrollo). Bajo en producción.
**Existing mitigation:** `.vercelignore` excluye `demo/`; las herramientas de prueba son `devDependencies`; `@vercel/blob` está fijado a 2.8.2.
**Recommended remediation:** Actualizar `vite`, `vitest` y `drizzle-kit` a las versiones que corrigen los avisos cuando sean compatibles; vigilar un `@vercel/blob` que actualice su cadena; agregar `npm audit` a un CI mínimo o a una revisión periódica.
**Suggested verification:** `npm audit --omit=dev` sin avisos high o critical en dependencias de ejecución.
**Required change type:** PROCESS / HARNESS CHANGE

### INFO

**ID:** SEC-07
**Title:** Las acciones del administrador sobre reservas no dejan registro de quién las hizo
**Severity:** INFO
**Confidence:** MEDIUM
**Category:** Trazabilidad
**Affected artifact:** Código
**Location:** `src/lib/pagos/rutas-admin.ts` (`crearRutaCancelarReserva` descarta el resultado de `sesion(...)`); `src/db/esquema.ts` (solo `pagos.revisado_por`)
**Description:** Aprobar o rechazar un pago guarda `revisado_por`, pero cancelar, reasignar, reprogramar, completar o subir fotos no guardan al administrador que actuó. Hoy hay un solo administrador, por lo que el riesgo es mínimo; crece si se suman más.
**Evidence:** `await sesion(req.headers);` sin usar el usuario devuelto en la cancelación por el administrador.
**Attack scenario:** Una cuenta de administrador comprometida cancela reservas y no queda evidencia de qué cuenta lo hizo.
**Potential impact:** Menor capacidad de investigación tras un incidente.
**Existing mitigation:** `revisado_por` en pagos, que es la acción de mayor valor.
**Recommended remediation:** Si se suman administradores, agregar un registro de auditoría (quién, qué, cuándo) a las acciones restantes.
**Suggested verification:** Prueba de que cada acción de administrador escribe su registro.
**Required change type:** SPEC CHANGE

## Prioridad

1. **SEC-01** (límite de intentos): es lo único con impacto real sobre cuentas y sobre la cuota de correo; además reduce SEC-03 y SEC-04, que dependen del registro y de las peticiones sin freno.
2. **SEC-05** (pruebas contra producción): cambio pequeño que evita un error costoso; conviene hacerlo antes de crear más suites `*.bd.test.ts`.
3. **SEC-02** (cabeceras de seguridad): una sola configuración; hacerlo antes de abrir el sitio a más público.
4. **SEC-04** (cuota de subidas) después de SEC-01.
5. **SEC-06** (dependencias) como revisión periódica.
6. **SEC-03** y **SEC-07** cuando se decida el alcance (verificación de correo, más administradores).

## Gobernanza / Decisión requerida

- **SEC-03 (ACCEPT RISK):** aceptar o no que el registro no verifique el correo y que confirme si una cuenta existe. El PRD limita el acceso a correo y contraseña sin códigos por correo, así que cambiarlo implicaría ampliar el alcance de `PRD.md`; esa decisión es del negocio, no de esta revisión.

El resto de los hallazgos (SEC-01, SEC-02, SEC-04, SEC-05, SEC-06, SEC-07) son CODE FIX, TEST FIX, PROCESS / HARNESS CHANGE o SPEC CHANGE y no requieren decisión de producto. Nota sobre SEC-01: el ADR 0005 ya anticipa la mitigación como un paso futuro, por lo que implementarla no contradice ninguna decisión vigente.
