## Why

Hoy un cliente nuevo no puede contratar: no existen `POST /api/reservas`, las tablas de membresías y pagos ni la entrega de comprobantes. Este es el ítem #9 de `BACKLOG.md` y el corazón del negocio (PRD, "Alcance" puntos 2, 3, 5, 6 y 10): el cliente elige servicio, escribe su dirección, escoge día y hora, paga por adelantado una membresía de Tiza Club con Yape o transferencia, sube el comprobante y recibe a cambio las 3 primeras horas de su primera limpieza gratis. La reserva queda en espera hasta que el administrador apruebe el pago, y una sola transacción crea la membresía, el pago y la reserva para que nadie bloquee horarios sin pagar (ADR 0008, 0009 y 0010).

**El ítem #9 se partió en dos changes por decisión del usuario**, porque es el más grande del backlog y su parte de servidor se puede revisar, probar y desplegar sin ninguna pantalla:

- **9a, este change (`reservar-y-pagar-primera-membresia`):** todo el servidor. Esquema y migración, reglas puras, `POST /api/reservas`, `GET /api/cotizacion`, `GET /api/comprobantes/:id`, el módulo de datos de pago con la imagen del QR, y la migración a producción y el despliegue. Se prueba con Vitest, con pruebas contra la rama de Neon `pruebas` y con `curl`.
- **9b, change `asistente-de-reserva`:** la página `/reservar` y sus componentes. **Depende de que 9a esté aplicado y desplegado**, porque consume sus endpoints. Es lo que desbloquea la publicación de la landing (ítem #5).

Depende de #2 (sesión), #4 (`calcularServicio`), #6 (agenda), #7 (dirección) y #8 (imágenes), todos construidos. Aprobar o rechazar el pago es del #11; este ítem deja al cliente con la reserva `pendiente`.

Decisión del usuario sobre el monto: se toma tal como está en el PRD, S/ 89 al mes y S/ 267 en un solo pago por 3 meses, leído de `configuracion` (`membresia_precio_mensual` × `membresia_meses`, 8900 céntimos y 3, marcado `provisional`). No se escribe en el código. Sigue siendo un valor provisional y queda anotado como riesgo.

Datos de pago y WhatsApp aportados por el usuario (21 de octubre de 2026): la CCI `00314301327959666056` a nombre de Jhon Alex Espichan Uscamaita, la imagen real del QR de Yape (`yape/yape.jpeg`) y el número de coordinación `51927030914` (que el usuario ya configura como `WHATSAPP_NUMERO` en Vercel y `.env.local`).

## What Changes

- **Migración nueva** (`0004`): tablas `membresias` y `pagos` (con sus enums), las columnas `reservas.membresia_id` y `reservas.pago_id` (`NOT NULL`, con FK) y tres índices únicos parciales: una membresía pendiente por cliente, una reserva en espera por cliente y una reserva viva por pago (ADR 0008 y 0009). Se prueba primero en la rama de Neon `pruebas`.
- **`POST /api/reservas`** para el cliente nuevo: valida el cuerpo, la dirección (`validarDireccion`), el comprobante (`verificarImagenSubida`, antes de abrir la transacción), el inicio del servicio (`validarInicioServicio`) y la vigencia de la primera membresía (el inicio cae dentro de los 3 meses siguientes). En una sola `transaccionDeEscritura` crea la membresía `pendiente`, el pago `pendiente` (concepto `membresia` o `membresia_y_reserva`) y la reserva `pendiente` con `expira_en` a 24 h, 3 horas gratis y equipo asignado con `insertarEnPrimerEquipoLibre`. Responde `201` con el enlace de WhatsApp.
- **`GET /api/cotizacion`**: el servidor calcula lo que el asistente (9b) mostrará: servicio con las horas gratis, monto de la membresía, total a pagar y rango de fechas reservables. El navegador no recalcula precios (ADR 0008).
- **`GET /api/comprobantes/:id`**: entrega el comprobante de un pago a su dueño o a un administrador con `crearRutaEntrega`; `404` para cualquier otro. La columna `pagos.comprobante_ruta` se declara en `COLUMNAS_CON_IMAGEN` para que el cron diario no la borre.
- **Datos de pago en un solo módulo** (`src/lib/reservas/datos-de-pago.ts`): la CCI, el titular y la ruta del QR real, que se copia de `yape/yape.jpeg` a `public/pago/yape.jpeg`. 9b solo los muestra.
- **Aviso de demostración en un solo módulo** (`src/lib/aviso-demo.ts`): exporta `AVISO_DEMOSTRACION`, con el texto que el usuario decidió el 21 de octubre de 2026 y que el PRD ya recoge ("Alcance" punto 3): «Sitio de demostración: los pagos son simulados. No hagas ninguna transferencia ni pago real.» Lo crea 9a por ser el primero que se aplica; `asistente-de-reserva` (9b: paso de pago y reserva enviada) y `landing-y-faq` (#5: pie de las páginas públicas) lo importan. 9a solo crea el módulo y su prueba; no pinta nada.
- Se adaptan las pruebas contra Neon del ítem #6 (`src/db/pruebas-bd.ts` y los `*.bd.test.ts`) porque `reservas` pasa a exigir membresía y pago, y se actualizan las dos pruebas que afirmaban que `COLUMNAS_CON_IMAGEN` estaba vacío.

**Contrato que 9a deja a 9b:** `GET /api/cotizacion`, `POST /api/reservas` (cuerpo y respuesta `201` con el enlace de WhatsApp, `409` y `422`), el módulo de datos de pago, `public/pago/yape.jpeg` y `WHATSAPP_NUMERO`. 9b además usa `GET /api/disponibilidad` (#6) y `POST /api/subidas` (#8).

Fuera de alcance de 9a (llegan con 9b u otros ítems): la página `/reservar` y sus componentes (9b); decidir si la dirección del hogar ya recibió la limpieza gratis y su índice único (#10; aquí la regla es la del cliente: sin membresía no tiene reservas), aprobar, rechazar y subir otro comprobante, aprobación tardía y coincidencias de dirección (#11), perfil, reprogramar y cancelar (#12), reserva de un miembro con descuento (#13), crédito en horas (#14), renovación (#15), gestión del apoyo extra (#16), límite de frecuencia y límite de registros por IP (pendientes de `BACKLOG.md`), mostrar el aviso de demostración en pantalla (9b y #5; 9a solo crea su módulo), la persona de apoyo cuando no se consigue (REVISAR del PRD) y cualquier cobro con tarjeta o pasarela (PRD, "No alcance").

## Capabilities

### New Capabilities

- `membresias-y-pagos`: tablas de membresías y pagos, estados, concepto del pago, comprobante obligatorio y una membresía pendiente por cliente.
- `vinculo-reserva-membresia-pago`: cada reserva apunta a su membresía y a su pago; una reserva viva por pago y una reserva en espera por cliente.
- `primera-reserva-con-membresia`: `POST /api/reservas` y `GET /api/cotizacion` para el cliente nuevo, con las 3 horas gratis, la vigencia, la asignación de equipo, la transacción única y el enlace a WhatsApp.
- `comprobantes-de-pago`: entrega privada del comprobante por id de pago, declaración de su columna para el cron de huérfanos, módulo único de datos de pago (CCI, titular e imagen del QR) y módulo único del texto del aviso de demostración.

La capacidad `asistente-de-reserva` (la página `/reservar`) **se movió al change 9b** `asistente-de-reserva`; ya no forma parte de este.

### Modified Capabilities

Ninguna en `openspec/specs/` (todavía no hay specs principales: los changes anteriores no se han archivado). Efecto cruzado a tener en cuenta al archivar: el requisito "Tabla de reservas con los datos del servicio" del change `agenda-y-disponibilidad` dice que `reservas` no tiene todavía `membresia_id` ni `pago_id`; ese cierre lo reemplaza `vinculo-reserva-membresia-pago`. Ver `design.md`, "Choques y notas para el archivado".

## Impact

- **Código nuevo:** `src/lib/reservas/` (esquema de entrada, vigencia, regla de limpieza gratis, cotización, creación, WhatsApp, datos de pago, rutas), `src/lib/pagos/` (resolvedor de entrega del comprobante), `src/lib/aviso-demo.ts` (texto del aviso de demostración), `app/api/reservas/route.ts`, `app/api/cotizacion/route.ts`, `app/api/comprobantes/[id]/route.ts`, `public/pago/yape.jpeg` y sus pruebas.
- **Código modificado:** `src/db/esquema.ts` (tablas, enums, columnas, índices), `src/lib/imagenes/referencias.ts` (declara `pagos.comprobante_ruta`), `cron.test.ts` y `huerfanos.test.ts` (el registro ya no está vacío), `src/db/pruebas-bd.ts` y los cuatro `*.bd.test.ts` de #6.
- **Base de datos:** una migración (`0004`). Aditiva salvo `ALTER TABLE reservas ADD COLUMN ... NOT NULL`, que exige que `reservas` esté vacía (lo está: nada la escribía antes de este ítem; se comprueba). Se aplica con `npm run db:migrate` **antes** de desplegar y apunta a producción (`DATABASE_URL` local es la de producción); la prueba previa va contra la rama `pruebas`.
- **Variables de entorno:** `WHATSAPP_NUMERO` (valor `51927030914`; el usuario ya la configura en Vercel y `.env.local`). Se documenta sin valor en `.env.example` si falta; este change solo comprueba que existe. `BLOB_READ_WRITE_TOKEN` ya existe del ítem #8.
- **Archivos estáticos:** `public/pago/yape.jpeg` (copia de `yape/yape.jpeg`). `.vercelignore` no excluye `public/` ni `yape/`, así que se sube con el despliegue; la carpeta `yape/` original no hace falta en producción.
- **Dependencias:** ninguna nueva.
- **Tareas del usuario:** crear o refrescar la rama de Neon `pruebas` si no tiene las migraciones `0000` a `0003`; decidir cuándo se despliega (el aviso de demostración ya está decidido; lo muestran 9b y la landing, así que desplegar 9a solo no expone el QR ni la CCI en pantalla).
- **Despliegue:** `npx vercel deploy --prod` y `GET /api/salud` = `200 {"estado":"ok"}`. La landing (#5) sigue esperando a 9b, que crea `/reservar`.
- **Tamaño:** 6 grupos de tareas de código y uno de verificación y despliegue; el asistente (la otra mitad) vive en 9b.
