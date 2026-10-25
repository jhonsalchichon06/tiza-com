## Context

**Este change es 9a, la mitad de servidor del ítem #9.** El usuario decidió partir el ítem en dos changes porque es el más grande del backlog y su servidor se prueba completo sin pantalla (Vitest, pruebas contra la rama `pruebas` y `curl`). La mitad de pantalla es el change **9b, `asistente-de-reserva`** (página `/reservar` y componentes), que **depende de que 9a esté aplicado y desplegado**. Los endpoints que 9a expone y 9b consume: `GET /api/cotizacion`, `POST /api/reservas`, `GET /api/comprobantes/:id` (para ver el comprobante; el asistente no lo usa hoy), el módulo `datos-de-pago.ts` y la imagen `public/pago/yape.jpeg`; 9b usa además `GET /api/disponibilidad` (#6) y `POST /api/subidas` (#8). La decisión 12 (el asistente) y lo que depende solo de la pantalla viven en el design de 9b; aquí queda una referencia.

Ya existe y está verificado en el código (no se reescribe):

- **Ítem #1/#2:** `leerConfiguracion()` (`src/lib/configuracion.ts`) valida todas las claves que este ítem usa: `membresia_precio_mensual` (8900, `provisional`), `membresia_meses` (3), `horas_gratis`, `descuento_miembro`, `espera_pago_horas`, `anticipacion_minima_horas`, `traslado_horas`, `horario_atencion`. `requerirSesion` (`src/lib/sesion.ts`) da `Usuario` con `id`, `nombre`, `celular` y `rol`. `ErrorApi`/`manejar` (`src/lib/errores.ts`) dan el formato único; `conReintento` (`src/lib/reintento.ts`) reintenta una vez. `db()` (`src/db/cliente.ts`) es un `Pool` de Neon con WebSocket.
- **Ítem #4:** `calcularServicio(config, entrada)` (`src/lib/precios.ts`) ya acepta `aplicaGratis` y devuelve `horas_trabajo`, `horas_agenda`, `requiere_apoyo`, `precio_lista`, `horas_gratis_aplicadas`, `credito_aplicado`, `descuento` y `monto` en céntimos. Para una estándar 2/1 con `aplicaGratis` da `monto = 0`; para una profunda 2/1 (5 h, 19350) da `monto = 6966`.
- **Ítem #6:** `transaccionDeEscritura`, `expirarVencidas`, `validarInicioServicio`, `rangoBloqueado`, `isoConZona`, `fechaLocal`, `insertarEnPrimerEquipoLibre` (con un `SAVEPOINT` por equipo; solo `23P01` pasa al siguiente), `esConflictoDeExclusion`, `errorOriginal`, `reservaActiva`, `leerOcupacion` y `GET /api/disponibilidad`. La tabla `reservas` (migración `0003`) no tiene `membresia_id` ni `pago_id`. `FilaReserva` es `Omit<typeof reservas.$inferInsert, "equipoId">`.
- **Ítem #7:** `validarDireccion` devuelve `distrito`, `calle`, `numero`, `departamento`, `referencias`, `direccionNormalizada` y `departamentoNormalizado`; `CamposDireccion` es el formulario de cinco campos.
- **Ítem #8:** `subirImagen(archivo, { destino: { tipo: "comprobante", usuarioId } })` devuelve la ruta final en Blob (`comprobantes/{usuarioId}/...`, con sufijo aleatorio); `verificarImagenSubida({ ruta, usuario })` devuelve `{ ruta, tipo, tamano }` o lanza `404`/`422`; `crearRutaEntrega({ obtenerRecurso })` y `autorizarComprobantePorCarpeta`; `COLUMNAS_CON_IMAGEN` (hoy `[]`) y una prueba que falla si hay una columna de ruta sin declarar.
- **Estado de los ítems vecinos:** #5 (landing) está planificado y sin aplicar (0 de 34 tareas): no existen `src/lib/formato-publico.ts` ni `WHATSAPP_NUMERO` en `.env.example`. Las dependencias del #9 (#2, #4, #6, #7, #8) están completas; quedan sin marcar la prueba manual de compresión de un comprobante real (#8, 3.5) y la confirmación de precios (#4, 5.5), que no bloquean.
- **Verificado en las bibliotecas:** el error de `pg` que Neon expone trae `code` y `constraint` (`node_modules/@neondatabase/serverless/index.d.ts`), y Drizzle lo deja en `cause` (verificado en el ítem #6); `uniqueIndex(...).on(...).where(...)` existe en `drizzle-orm/pg-core`; un valor de `insert` puede ser una expresión `sql` (se usa para `expira_en`); `z.iso.datetime({ offset: true })` existe en zod 4.6.7; en Next 16 el `params` de un Route Handler es una promesa (ya lo usa `crearRutaEntrega`).

## Goals / Non-Goals

**Goals:**

- Que el servidor soporte el flujo del PRD de punta a punta (con 9b como pantalla): cotizar, recibir el comprobante ya subido y crear la membresía, el pago y la reserva gratis en espera, sin dejar membresías, pagos ni reservas a medias.
- Que la base de datos garantice las reglas que cuestan más si fallan: una reserva en espera por cliente, una membresía pendiente por cliente, una reserva viva por pago y la capacidad por equipo (ADR 0008 y 0009).
- Que ningún precio, plazo ni monto esté escrito en el código ni lo decida el navegador (ADR 0008).
- Dejar a #10, #11, #12, #13 y #14 puntos de extensión claros, sin adelantar su comportamiento.

**Non-Goals:**

- Comprobar que el hogar ya recibió la limpieza gratis y el índice único por hogar (#10), aprobar/rechazar/subir otro comprobante, aprobación tardía y coincidencias de dirección (#11), perfil, reprogramar y cancelar (#12), reserva de un miembro con 10% de descuento (#13), crédito en horas (#14), renovación (#15), lista de apoyo del administrador (#16).
- La página `/reservar`, sus componentes y la lógica del navegador: son del change 9b.
- Mostrar el aviso de demostración en pantalla: es de 9b (paso de pago y reserva enviada) y de #5 (pie de las páginas públicas). 9a solo guarda el texto en `src/lib/aviso-demo.ts` (decisión 15).
- Límite de frecuencia y límite de registros por IP (pendientes de `BACKLOG.md`).
- Confirmar los `REVISAR` del PRD que no bloquean: duración de la renovación, reservas del mes 3 sin pago y persona de apoyo que no se consigue. No se implementa ninguno como definitivo.
- Cualquier cobro con tarjeta o pasarela, notificaciones automáticas de WhatsApp, correo o SMS (PRD, "No alcance").
- Modificar `PRD.md`, `TECH-DESIGN.md`, los ADR o `BACKLOG.md`: lo que haga falta cambiar ahí se propone en el reporte.

## Decisions

### 1. Una sola ruta `POST /api/reservas`, que decide por el estado de la membresía

`POST /api/reservas` es la ruta de `TECH-DESIGN.md` para crear reservas. Este ítem la construye para el cliente sin ninguna membresía; si el cliente ya tiene una (pendiente o activa) responde `409` con un mensaje distinto para cada caso. El ítem #13 reemplazará esa segunda rama por la reserva de un miembro, sin tocar la primera.

- **Por qué:** `TECH-DESIGN.md` usa la misma ruta para ambos flujos; así #13 extiende en vez de duplicar.
- **Descartada:** una ruta aparte (`/api/membresias` o `/api/reservas/primera`). Es viable, pero obliga a decidir qué ruta usa el asistente de un miembro y repite la validación del cuerpo.

### 2. Esquema: `membresias`, `pagos` y las dos columnas de `reservas`

```
membresias(id uuid pk, usuario_id fk, monto int > 0, estado estado_membresia 'pendiente'|'activa',
           inicio timestamptz null, fin timestamptz null, creada_en)
  CHECK (pendiente y sin fechas) o (activa, con fechas y fin > inicio)
  UNIQUE INDEX membresias_una_pendiente_por_cliente (usuario_id) WHERE estado = 'pendiente'

pagos(id uuid pk, usuario_id fk, concepto concepto_pago, membresia_id fk null, monto int >= 0,
      metodo metodo_pago 'yape'|'transferencia'|'credito', comprobante_ruta text null,
      estado estado_pago 'pendiente'|'aprobado'|'rechazado' (por defecto 'pendiente'),
      revisado_por fk usuarios null, revisado_en null, creado_en)
  CHECK concepto <> 'reserva' => membresia_id no vacío
  CHECK metodo = 'credito' OR comprobante_ruta no vacío
  CHECK metodo <> 'credito' OR monto = 0

reservas + membresia_id uuid NOT NULL fk, pago_id uuid NOT NULL fk
  UNIQUE INDEX reservas_un_pago_por_reserva_viva (pago_id) WHERE estado IN ('pendiente','confirmada','completada')
  UNIQUE INDEX reservas_una_pendiente_por_cliente (usuario_id) WHERE estado = 'pendiente'
```

- **Por qué estos campos:** son los de `TECH-DESIGN.md` ("Modelo de datos") y el ADR 0008. Se crean ya `revisado_por` y `revisado_en` y el método `credito` aunque este ítem no los use, para que #11 y #14 no necesiten otra migración sobre `pagos`; `credito` solo existe como valor del enum, ningún flujo de #9 lo escribe.
- **Nombre `comprobante_ruta`:** coincide con el patrón que vigila la prueba del ítem #8 (termina en `_ruta`), así que la prueba obliga a declararla.
- **Montos en céntimos enteros**, como `reservas` y `configuracion`. Los `uuid` siguen a `reservas`.
- **Claves foráneas sin cascada**, como `reservas`: nada de lo que toca dinero se borra en cascada.
- **Una membresía por cliente en `pendiente`, no en general:** una `activa` convive con la `pendiente` de la renovación (#15). La regla "este flujo solo para quien no tiene ninguna" la aplica el servidor, no el índice.
- **Descartada:** `membresia_id`/`pago_id` nulables con un `SET NOT NULL` posterior. El ADR 0008 las declara obligatorias y la tabla está vacía.
- **Descartada:** guardar `estado_membresia = 'vencida'`. El ADR 0008 la calcula con `fin`.

### 3. Migración `0004`: precondición de tabla vacía y prueba en la rama `pruebas`

`npm run db:generate -- --name=membresias-y-pagos` genera la migración; el `ALTER TABLE reservas ADD COLUMN ... NOT NULL` solo funciona con `reservas` vacía. Antes de aplicarla se comprueba con una consulta de solo lectura que `reservas` tiene 0 filas en la rama `pruebas` y en producción. Se prueba primero en la rama `pruebas`; recién después se aplica a producción, y antes de desplegar (`CLAUDE.md`).

- **Cómo apuntar `db:migrate` a la rama sin mostrar secretos:** `drizzle.config.ts` carga `.env.local` con `dotenv`, que no pisa variables ya definidas, así que basta definir `DATABASE_URL` desde `DATABASE_URL_PRUEBAS` en el proceso: `node -e "require('dotenv').config({path:'.env.local',quiet:true});process.env.DATABASE_URL=process.env.DATABASE_URL_PRUEBAS;require('child_process').execSync('npx drizzle-kit migrate',{stdio:'inherit'})"`. La URL nunca se imprime.
- **Descartada:** probar solo el SQL con `BEGIN ... ROLLBACK` como en #6. Aquí además hay que comprobar que `drizzle-kit migrate` lo aplica en orden sobre una base con `0000`-`0003`, y que las pruebas `*.bd.test.ts` (decisión 11) pasan contra el esquema nuevo.
- **Riesgo conocido:** si la rama `pruebas` no tiene `0000`-`0003`, hay que refrescarla desde producción (tarea del usuario en Neon).

### 4. Crear la reserva: verificar fuera, escribir dentro, reintentar el conjunto

Orden de `crearPrimeraReserva` (`src/lib/reservas/crear.ts`):

1. **Fuera de la transacción:** validar el cuerpo con zod (`422`), `validarDireccion`, `verificarImagenSubida` (antes de abrir la transacción, como exige el ADR 0010), `leerConfiguracion`, calcular el servicio una primera vez solo para obtener `horas_agenda` (no depende de las horas gratis), `validarInicioServicio` y la vigencia de la primera membresía.
2. **Dentro de `transaccionDeEscritura`:** (a) si el cliente tiene una reserva `pendiente`, `409` de espera; (b) si tiene alguna membresía, `409` de membresía; (c) `decidirLimpiezaGratis`; (d) calcular el servicio de nuevo con `aplicaGratis` y obtener el rango bloqueado; (e) insertar la membresía, luego el pago (su `membresia_id` exige que la membresía exista primero; el ADR 0009 nombra "el pago y la membresía" sin orden, no hay choque) y por último la reserva con `insertarEnPrimerEquipoLibre(tx, equiposActivos, fila)`; `expira_en` se fija con `now() + espera_pago_horas` de la base, no con el reloj del servidor, para coincidir con `reservaActiva` y `expirarVencidas`.
3. **Fuera, después del commit:** construir el enlace de WhatsApp y la respuesta `201`.

Cualquier error dentro de la transacción la deshace entera, de modo que una falta de cupo (`409`) no deja la membresía ni el pago.

- **Reintento:** el conjunto va dentro de `conReintento`, desenvolviendo `cause` con `errorOriginal` (como #6). Si la conexión se corta antes del commit, la transacción se deshace y reintentar es seguro. Si se corta durante el `COMMIT` y el primer intento sí se confirmó, el reintento choca con los índices únicos y responde `409` ("ya tienes una reserva esperando la aprobación"), que es verdad y no duplica nada. Se acepta.
- **Descartada:** verificar el archivo dentro de la transacción. Mantendría la transacción y sus bloqueos abiertos durante una lectura de red a Blob, y contradice el ADR 0010 ("antes de abrir su transacción").
- **Descartada:** sin reintento. El ADR 0006 pide uno si Neon está dormido, y una reserva es lo que más importa que no falle por un arranque en frío.
- **Descartada:** `SELECT ... FOR UPDATE` para serializar al cliente. Los índices únicos ya lo hacen y no bloquean a quien no compite.

### 5. `409` por estado del cliente y por carrera

Las comprobaciones (a) y (b) dan mensajes claros en el caso normal. Para la carrera (dos peticiones del mismo cliente que pasan ambas el `SELECT`), la segunda inserción espera en el índice único y falla con `23505`; `traducirUnicidad(error)` lee `error.cause.code` y `error.cause.constraint` y los convierte: `membresias_una_pendiente_por_cliente` → "Tu pago de la membresía ya está en revisión."; `reservas_una_pendiente_por_cliente` → "Ya tienes una reserva esperando la aprobación de tu pago."; cualquier otro `23505` se propaga como error inesperado. El orden (a) antes de (b) hace que quien tiene una reserva en espera vea el mensaje de la reserva, que es el que pide `TECH-DESIGN.md`.

- **Código `en_espera` para el asistente (9b):** `ErrorApi.conflicto` siempre usa el código `conflicto` (`src/lib/errores.ts`), igual que la falta de cupo de `insertarEnPrimerEquipoLibre`. Para que 9b separe "elige otra hora" de "ya tienes una reserva o un pago en revisión" sin leer el texto, los `409` de las comprobaciones (a) y (b) y de `traducirUnicidad` se lanzan con `new ErrorApi(409, "en_espera", mensaje)`; la falta de cupo conserva `conflicto`. Descartada: distinguirlos por el texto del mensaje (frágil ante cualquier cambio de redacción).
- **Descartada:** capturar cualquier `23505` como "ya tienes una reserva". Esconde un fallo real de otro índice.

### 6. Regla de la limpieza gratis, en un solo lugar

`decidirLimpiezaGratis(tx, usuarioId)` (`src/lib/reservas/gratis.ts`) devuelve verdadero si el cliente no tiene ninguna reserva `pendiente`, `confirmada` ni `completada` (la regla del cliente, ADR 0008). Aquí siempre da verdadero porque un cliente sin membresía no puede tener reservas, pero la regla es real, está probada y la reutilizan #12 (primera limpieza cancelada) y #13. **#10 agrega aquí** la comprobación del hogar y los índices únicos de `primera_gratis`.

- **Por qué no `true` fijo:** el criterio "un cliente que ya tuvo su limpieza gratis no recibe otra, ni siquiera al renovar" necesita una regla verificable, no una constante.
- **Por qué no el hogar aquí:** `BACKLOG.md` asigna al #10 "una segunda cuenta en el mismo hogar paga el precio completo" y las peticiones simultáneas; adelantarlo sin su índice dejaría una verificación a medias sin garantía de concurrencia.
- **Consecuencia (ver Riesgos):** hasta que llegue #10, dos cuentas con la misma dirección pueden recibir las 3 horas.

### 7. Vigencia de la primera membresía: `inicio < ahora + membresia_meses`

`limite = sumarMeses(ahora, membresia_meses)` con meses de calendario (`setUTCMonth` recortando al último día del mes de destino: 30 de noviembre + 3 meses = 28 de febrero; Perú no tiene horario de verano, igual que decide #6). El servidor exige `inicio < limite` y, si no, `422` con la última fecha. Como los 3 meses de la membresía cuentan desde la aprobación, que siempre es posterior a la petición, un servicio anterior al `limite` queda siempre dentro de la vigencia real (ADR 0008, "dentro de los 3 meses siguientes a hoy").

- **Descartada:** exigir `inicio < fin` de la membresía. Aún no tiene `fin` (se llena al aprobar).
- **Descartada:** comparar solo fechas. Dejaría pasar un inicio de las 8 am en el día límite que ya está a menos de 3 meses del instante exacto, o rechazaría uno válido; se compara el instante.

### 8. Cotización calculada por el servidor, también el rango de fechas

`GET /api/cotizacion` devuelve el cálculo, el monto de la membresía, el total, el rango de fechas y el instante `limite`. Con él el navegador no hace aritmética de zonas ni de precios: solo recorre fechas civiles `AAAA-MM-DD` entre `fechas.desde` y `fechas.hasta` y compara el instante de cada horario (la cadena ISO con zona que ya devuelve `/api/disponibilidad`) con `limite`.

- **Por qué:** el ADR 0008 dice "el navegador muestra el resultado que le da la API; no recalcula precios", y #4 dejó explícito que el endpoint de cotización lo define este ítem.
- **Descartada:** que el navegador calcule las 48 horas y los 3 meses con `Date`. Mezcla la zona del dispositivo con la de Lima.
- **Descartada:** que `/api/disponibilidad` filtre por vigencia. Es de #6 (informativa, sin membresía) y #13 la reutiliza con otra regla.
- **Sesión:** exigida, como `/api/disponibilidad`; el cliente se registra antes de llegar al paso de fecha.

### 9. Datos de pago en un solo módulo, con la imagen real del QR

`src/lib/reservas/datos-de-pago.ts` exporta la CCI (`00314301327959666056`, 20 dígitos), el titular (`Jhon Alex Espichan Uscamaita`, el nombre que aparece en el QR de Yape) y la ruta pública de la imagen del QR (`/pago/yape.jpeg`). Los dio el usuario el 21 de octubre de 2026 y reemplazan la CCI de ceros y el QR de relleno que figuraban antes. La imagen está en el repositorio como `yape/yape.jpeg` (el usuario la nombró `yape.jpg`; el archivo real es `.jpeg`, 101 KB) y una tarea la copia a `public/pago/yape.jpeg` para servirla como archivo estático. Se verificó que `.vercelignore` solo excluye `.env*`, `node_modules`, `.next`, `demo`, `test-results`, `playwright-report` y `tsconfig.tsbuildinfo`: no excluye `public/` ni `yape/`, así que la imagen sube con `npx vercel deploy --prod`. Ninguna pantalla repite esos valores; 9b los importa y muestra el QR con un texto alternativo.

- **Por qué un módulo:** cuando cambien los datos se cambian en un solo lugar. Una prueba busca la CCI, el titular y la ruta en `app/` y `src/` y exige que solo estén en el módulo.
- **Por qué copiar a `public/` y no servir `yape/`:** Next.js solo sirve estáticos desde `public/`; `yape/` queda como el original del usuario.
- **Descartada:** guardarlos en `configuracion`. Agrega claves al esquema zod, al fixture de pruebas y a la prueba de "16 claves", y no son precios ni plazos.
- **Descartada:** variables de entorno. La CCI no es un secreto (se muestra a todos los clientes) y obligaría a documentarla y desplegar igual; el número de WhatsApp sí va en entorno (decisión 10) porque el usuario ya lo gestiona allí.
- **Aviso de demostración (decidido, ver decisión 15):** el QR y la CCI son datos reales del titular del proyecto, y el PRD declara los pagos simulados. El usuario decidió que el sitio lo diga con un aviso de texto fijo junto al QR y la CCI, en la reserva enviada y en el pie de las páginas públicas. Esa pantalla es de 9b y #5; aquí solo se guarda el texto.

### 10. Enlace de WhatsApp, sin envío

`enlaceWhatsapp({ numero, mensaje })` (`src/lib/reservas/whatsapp.ts`) devuelve `https://wa.me/<numero>?text=<mensaje codificado>` o `null` si el número falta o no son solo dígitos. El número sale de `WHATSAPP_NUMERO` (lector opcional `leerEnvWhatsapp` en `src/lib/env.ts`); su valor es `51927030914` (número `927030914` con el código de país 51 de Perú), pero **no se escribe en el código ni en el repositorio**: el usuario ya lo configura en Vercel y `.env.local`, y aquí solo se comprueba que existe. El mensaje lleva nombre y celular del cliente, servicio, día y hora (hora de Lima), dirección y que está en espera de la aprobación del pago; no lleva montos. La respuesta del servidor incluye el enlace y el asistente lo muestra como botón; nada se abre solo.

- **Coordinación con #5:** la landing planificada lee la misma variable en su `layout`. Si #5 se aplica antes, ya habrá declarado la variable en `.env.example`; si no, la declara #9. No se comparte código entre ambos para no acoplar los changes.
- **Descartada:** construir el enlace en el navegador. Obligaría a exponer el número con `NEXT_PUBLIC_` o a pedirlo por otra ruta.

### 11. Entrega del comprobante por id de pago

`app/api/comprobantes/[id]/route.ts` instancia `crearRutaEntrega` con un resolvedor (`src/lib/pagos/comprobante.ts`) que valida que `id` tenga formato de uuid (sin esa validación, un `abc` provoca un error de Postgres `22P02` y un `500`), busca el pago y devuelve `{ ruta, autorizar }`. Autoriza si el usuario es administrador, o si es el dueño del pago **y** la ruta está en su carpeta (`autorizarComprobantePorCarpeta`). Un pago inexistente, ajeno o sin ruta (crédito) da `404` sin leer Blob.

- **Descartada:** autorizar solo por carpeta o solo por dueño. Ambas son seguras hoy; combinadas, un error futuro en una no abre el acceso.

### 12. El asistente de reserva: es del change 9b

La página `/reservar`, su lógica pura (`src/lib/reservas/asistente/`), sus componentes, el formato de soles (`src/lib/soles.ts`) y el módulo CSS pertenecen al change **9b, `asistente-de-reserva`**, que define esta decisión con sus alternativas descartadas. 9a solo fija el contrato que 9b consume: el cuerpo y las respuestas de `POST /api/reservas`, la forma de la cotización, el módulo de datos de pago y la imagen del QR. Ninguna tarea de 9a toca `app/reservar/`.

### 13. Seguridad de la ruta

La ruta exige `Content-Type: application/json` (`415` si no, como `/api/subidas`) para que un formulario de otro sitio con `text/plain` no pueda dispararla con la cookie `SameSite=Lax`; limita el largo de los textos con zod; ignora cualquier monto del cuerpo; y deja la carpeta de la ruta del comprobante a `verificarImagenSubida`, que la compara con la sesión. No se escriben secretos: `WHATSAPP_NUMERO` va en el entorno y se documenta sin valor.

### 14. Las pruebas contra Neon de #6 se adaptan

Con `membresia_id` y `pago_id` obligatorios y los dos índices nuevos, `filaReserva` (`src/db/pruebas-bd.ts`) ya no puede insertar varias reservas `pendiente` de un mismo usuario ni varias reservas vivas del mismo pago, como hacen hoy los cuatro `*.bd.test.ts` (la prueba de 10 peticiones simultáneas, por ejemplo). El soporte pasa a crear un "dueño" por reserva (usuario, membresía y pago de prueba con el prefijo `prueba-agenda-`), y la limpieza y `contarRastros` incluyen `pagos` y `membresias` en el orden de las claves foráneas (reservas, pagos, membresías, usuarios, equipos). Las pruebas nuevas contra la base de este ítem usan el mismo soporte, equipos de prueba inactivos y la rama `pruebas`.

- **Descartada:** relajar los índices para las pruebas. Las pruebas deben ejercer el esquema real.

### 15. Aviso de demostración: un módulo, tres lugares

El usuario decidió (21 de octubre de 2026) y el PRD ya recoge ("Alcance" punto 3, "Aviso de demostración") que el sitio muestra, con el mismo texto, en tres lugares: (1) un aviso fijo en el paso de pago, junto al QR y la CCI; (2) la pantalla de reserva enviada; (3) el pie de todas las páginas públicas (landing y preguntas). Texto exacto: «Sitio de demostración: los pagos son simulados. No hagas ninguna transferencia ni pago real.» El QR de Yape y la CCI siguen mostrándose.

9a crea `src/lib/aviso-demo.ts`, que exporta `AVISO_DEMOSTRACION` con ese texto, y su prueba (`aviso-demo.test.ts`): el texto exacto, y que no contiene dígitos, «S/», la CCI, ni palabras como «clave», «token» o «secreto». Los tres lugares viven en otros changes: 9b (`PasoPago` y `PasoListo`) y #5 (pie del layout `app/(publico)/`); ambos importan la constante y no repiten el texto.

- **Por qué lo crea 9a:** es el primero que se aplica; 9b depende de 9a desplegado, y #5 no se despliega antes de 9b. Si #5 se aplicara antes que 9a, su tarea crea el módulo con el mismo contenido y la misma prueba solo si no existe (sin duplicar; el archivo es el mismo).
- **Por qué un módulo y no una cadena en cada componente:** tres lugares con un texto que el PRD fija; si cambia (o el negocio pasa a cobrar de verdad y se quita) se edita un solo archivo. Una prueba de 9b y de #5 compara el HTML con la constante.
- **Por qué sin cifras:** el aviso no debe dar la impresión de un monto ni repetir datos de cuenta.
- **Descartada:** guardar el texto en `configuracion`. Agrega una clave al esquema zod y al fixture, y no es un precio ni un plazo.
- **Descartada:** letra pequeña o un aviso solo en el pie. El riesgo es que alguien pague de verdad en el paso de pago; el aviso va donde está el QR.
- **Choque con ADR:** ninguno; los ADR no tratan el aviso.

## Choques y notas para el archivado

- **Spec del ítem #6:** el requisito "Tabla de reservas con los datos del servicio" (`agenda-y-disponibilidad`, `reservas-agenda`) termina con "La tabla MUST NOT tener todavía `membresia_id` ni `pago_id`, que agrega el ítem #9". Este ítem lo deja obsoleto. Como `openspec/specs/` está vacío (ningún change anterior está archivado), un delta `MODIFIED` no tiene requisito base que modificar y se evitó. Se propone archivar `agenda-y-disponibilidad` primero (sus 45 tareas están completas) y, al archivar este ítem, quitar esa frase con un delta `MODIFIED` en `reservas-agenda`. No se edita aquí.
- **ADR 0003 y 0010** hablan de `POST /api/pagos` para registrar un comprobante. Este ítem no crea esa ruta: el comprobante se registra dentro de `POST /api/reservas`. `POST /api/pagos` (subir otro comprobante tras un rechazo) corresponde a #11. No hay choque.
- **ADR 0009** ("la reserva y su comprobante se crean juntos") se cumple tal cual; la única precisión es el orden de inserción membresía → pago → reserva, que las claves foráneas imponen.
- **ADR 0013 sobre el ADR 0011:** no se usa Google Maps ni `place_id`; la dirección es texto.
- **BACKLOG:** pone "asignación de equipo con savepoints" en #9; #6 ya la construyó y #9 solo la llama dentro de `transaccionDeEscritura`, como pide su contrato.
- **Contrato con 9b y con la landing (#5):** `/reservar` (9b) lee `distrito`, `tipo` (`estandar`, `profunda`, `mudanza`, `horas`), `horas` y `club`; el servicio por horas de la API se llama `paquete` (9b traduce `horas` a `paquete`).
- **Vigencia del archivado:** `asistente-de-reserva` (9b) se archiva después de 9a; no comparten capacidades, así que no hay conflicto de specs entre ambos.

## Cobertura de los criterios de `TECH-DESIGN.md`

"Reservar y pagar la membresía (cliente nuevo)": los criterios se reparten entre 9a (servidor) y 9b (pantalla). La columna "Change" indica quién los cubre; la tabla gemela está en el design de 9b. Los que `BACKLOG.md` asigna a otros ítems se anotan como tales.

| Criterio | Change | Dónde se cubre en 9a |
|---|---|---|
| Asistente pide distrito, calle, número, departamento y referencias | 9b | spec `asistente-de-reserva` (dirección) |
| Distrito fuera de los 9 → `422`; calle vacía o número sin dígito → `422`; guardado normalizado y escrito; opcionales | 9a | spec `primera-reserva-con-membresia` (dirección); tareas 3.4 y 4.3 |
| Sin domingos ni fuera de 8 am a 6 pm; menos de 48 h → `422` | 9a (el gris en pantalla es de 9b) | spec `primera-reserva-con-membresia` (inicio); tarea 4.4 |
| Sin equipo libre → gris | 9b (la disponibilidad es de #6) | spec `asistente-de-reserva` (fecha) |
| Niveles, duración por tipo, precio por tamaño, 0 dormitorios, cada 30 min | 9a (cálculo) y 9b (muestra) | specs de `primera-reserva-con-membresia` (cotización, duración); tareas 3.6 y 4.5 (los horarios cada 30 minutos vienen de #6) |
| Apoyo extra (hasta 6 h sin apoyo, más de 6 h con la mitad, paquete de 8 h) | 9a | spec `primera-reserva-con-membresia` (duración, apoyo); tareas 3.6 y 4.5 |
| Yape y transferencia; comprobante de 4,5 a 5 MB; otro tipo o más de 5 MB rechazado | 9b (la compresión y validación son de #8) | spec `asistente-de-reserva` (pago); en 9a, el módulo de datos de pago (tarea 3.7) |
| Sin comprobante → `422` y nada creado | 9a | spec `primera-reserva-con-membresia` (comprobante); tareas 3.4 y 4.2 |
| Membresía, pago y reserva `pendiente` con `expira_en` a 24 h; 3 h gratis; ejemplos de S/ 69,66 y de 3 h | 9a | spec `primera-reserva-con-membresia` (creación, precio); tareas 4.5 y 5.2 |
| La reserva vencida deja de bloquear y se marca `expirada` en la siguiente escritura | 9a | spec `primera-reserva-con-membresia` (vencidas); tareas 4.7 y 5.5 |
| Reserva pendiente existente → `409` | 9a | spec `primera-reserva-con-membresia` (una en espera); tareas 4.6 y 5.5 |
| Quien ya tuvo la limpieza gratis no recibe otra, ni al renovar | 9a | spec `primera-reserva-con-membresia` (gratis, miembro); tareas 3.3 y 4.6 |
| Segunda cuenta con la misma dirección; dos departamentos; mismo edificio; dos peticiones simultáneas por la misma dirección | **Ítem #10** | no se cubre aquí |
| Primera limpieza cancelada → la siguiente recibe las 3 horas | **Ítem #12** | reutiliza `decidirLimpiezaGratis` (tarea 3.3) |
| Cerrar el asistente antes de confirmar no deja nada; comprobante huérfano se borra | 9a (cron) y 9b (el cierre) | spec `comprobantes-de-pago` (cron); tarea 6.3. 9b: spec `asistente-de-reserva` (confirmar) |
| Aviso de demostración con el texto exacto (PRD, alcance 3) | 9a (módulo del texto), 9b (paso de pago y reserva enviada) y #5 (pie público) | spec `comprobantes-de-pago` (aviso en un solo módulo); tarea 3.10 |
| Menos de 3 minutos sin ayuda | 9b | tarea del usuario en 9b (no automatizable) |
| Capacidad (tercera reserva `409`, dos peticiones por el último cupo, justo al terminar el traslado, cancelada o expirada libera, primer equipo libre) | 9a | spec `primera-reserva-con-membresia` (equipo); tareas 4.6, 5.3 y 5.4 |
| Comprobante solo para su dueño y el administrador; falla la subida → nada creado; archivo inexistente o en carpeta ajena; entrega de 5 MB; limpieza diaria | 9a | specs `comprobantes-de-pago` y `primera-reserva-con-membresia` (verificar); tareas 4.2, 6.2 y 6.3 |
| Neon dormido → un reintento y "inténtalo en unos segundos"; error inesperado genérico | 9a | spec `primera-reserva-con-membresia` (errores); tarea 4.8 |

## Risks / Trade-offs

- **Riesgo residual: alguien paga dinero real por error.** La CCI `00314301327959666056` y el QR de Yape son del titular del proyecto, y el PRD dice que los pagos son simulados. El aviso de demostración (decisión 15) reduce el riesgo pero no lo elimina (PRD, "Riesgos"): un visitante puede ignorarlo y transferir o yapear dinero real, que no se vincula a ninguna reserva y habría que devolver a mano; además, sin #11 nadie aprueba pagos. 9a solo guarda los datos y el texto del aviso; el riesgo se materializa cuando 9b muestra el QR. Mitigación: el aviso fijo junto al QR y la CCI y en la reserva enviada (9b), y no abrir el sitio al público hasta #11.
- **Monto de la membresía provisional (decisión del usuario).** Se usa S/ 89 al mes y S/ 267 en total tal como están en el PRD y en `configuracion` (`provisional`). El `REVISAR` del PRD sigue abierto: cambiar el monto es editar `membresia_precio_mensual` o `membresia_meses`, sin código. Lo cobrado queda guardado en `membresias.monto`, `pagos.monto` y `reservas.monto`, así que un cambio posterior no altera lo ya pagado.
- **Divergencia entre lo cotizado y lo cobrado.** Si `configuracion` cambia entre la cotización y la confirmación, el servidor cobra con los valores nuevos y la pantalla final (9b) muestra lo guardado. Aceptado: los parámetros casi no cambian y el administrador ve el monto al aprobar.
- **Sin #10, la limpieza gratis se puede repetir en el mismo hogar.** Hasta que #10 agregue su índice, dos cuentas con la misma dirección reciben las 3 horas. Mitigación: desplegar #9 y #10 juntos, o aceptar la ventana (los pagos son simulados y no hay clientes reales).
- **Sin #11 nadie aprueba pagos.** Un `/reservar` desplegado crea membresías `pendiente` que nadie puede activar, y las reservas expiran a las 24 h. Recomendación: no abrir el sitio al público hasta #11. Es parte de la decisión sobre cuándo desplegar (pregunta abierta 2). 9a por sí solo no tiene pantalla, así que desplegarlo no expone el flujo a un visitante común, pero la API sí queda accesible a quien se registre.
- **Hueco de diseño sin resolver en ADR 0008, ADR 0009 ni `TECH-DESIGN.md`: membresía atascada.** Si el pago se rechaza y la reserva ya expiró (o expira), el cliente queda con una membresía `pendiente` y un pago `rechazado`, y este flujo le responde `409` para siempre. #11 debe definir una salida (por ejemplo, permitir subir otro comprobante a ese pago sin reserva, o cerrar la membresía y dejar empezar de nuevo). Se propone al usuario; no se resuelve aquí.
- **Bloqueo de horarios con varias cuentas** (`TECH-DESIGN.md`): cada cuenta bloquea a lo sumo un horario hasta 24 h; el límite de registros por IP sigue pendiente de `BACKLOG.md`. La ruta tampoco limita la frecuencia.
- **Archivos huérfanos.** Un `409` o un cierre de página deja la imagen en Blob hasta el cron diario (hasta ~48 h). Cada verificación cuesta una lectura de Blob (plan Hobby con operaciones limitadas).
- **Migración sobre producción.** `ALTER TABLE ... NOT NULL` exige tabla vacía; se comprueba antes y se prueba en la rama. No tiene "deshacer" en Drizzle: la marcha atrás es `DROP` manual o restaurar con Neon.
- **Imagen del QR pesada y pública.** `public/pago/yape.jpeg` pesa 101 KB y es accesible sin sesión (es lo que se muestra a todo cliente). Aceptado: es un QR de cobro, no un dato privado; pero implica que el titular queda expuesto en la imagen y en el módulo.
- **Ambigüedad del `COMMIT`.** Descrita en la decisión 4; el efecto es un `409` veraz.

## Migration Plan

1. Comprobar con una consulta de solo lectura que `reservas` tiene 0 filas en la rama `pruebas` (y refrescar la rama si no tiene `0000`-`0003`: tarea del usuario).
2. Cambiar `src/db/esquema.ts` y generar la migración con `npm run db:generate -- --name=membresias-y-pagos`; revisar el SQL.
3. Aplicarla a la rama `pruebas` (decisión 3) y correr `PRUEBAS_BD=1 npx vitest run --config vitest.bd.config.ts` con `DATABASE_URL_PRUEBAS`.
4. Comprobar con una consulta de solo lectura que `reservas` tiene 0 filas en producción y aplicar `npm run db:migrate` **antes** de desplegar.
5. `npx vercel deploy --prod` y `GET /api/salud` = `200 {"estado":"ok"}`.
6. Prueba de humo en producción con `curl` y una cuenta `@tiza.test` (que se borra al terminar, con sus filas y su archivo de Blob). Esta tarea crea filas reales en producción: solo si el usuario decide desplegar.
7. Marcha atrás: redesplegar el commit anterior; `DROP TABLE pagos, membresias CASCADE` y quitar las dos columnas e índices de `reservas`, o restaurar con Neon. Es seguro solo mientras no haya reservas reales.
   - **Resultado en la rama `pruebas` (21 de octubre de 2026):** la rama tenía `0000`-`0003` y 0 reservas; `drizzle-kit migrate` aplicó `0004` (5 migraciones registradas). Consultas de solo lectura: existen `membresias` y `pagos`, las columnas `reservas.membresia_id` y `reservas.pago_id`, los 3 índices únicos parciales y `reservas_sin_solape_por_equipo`. Producción quedó sin cambios (4 migraciones, sin tablas nuevas, 0 reservas).
8. Después de 9a viene 9b: se aplica y despliega solo cuando 9a ya responde en producción.

## Open Questions

1. ~~Aviso "DEMO"~~ Resuelta el 21 de octubre de 2026: el sitio muestra el aviso «Sitio de demostración: los pagos son simulados. No hagas ninguna transferencia ni pago real.» en el paso de pago, en la reserva enviada y en el pie de las páginas públicas; el PRD ya lo recoge. 9a crea el módulo del texto (decisión 15).
2. **¿Cuándo se despliega #9 a producción?** Sin #10 se puede repetir la limpieza gratis en un hogar y sin #11 nadie aprueba los pagos. El grupo de despliegue de `tasks.md` queda para cuando el usuario lo decida.
3. **Membresía atascada tras un rechazo con la reserva expirada.** ¿Se acepta que #11 defina la salida? (Riesgos.)
4. ~~Datos reales de pago y `WHATSAPP_NUMERO`~~ Resueltas el 21 de octubre de 2026: CCI, titular, imagen del QR y número `51927030914` (en variable de entorno).
5. Se propone actualizar el comentario `REVISAR` del monto de la membresía en `PRD.md` para reflejar la decisión del usuario (S/ 89 al mes, S/ 267 en un pago), y quitar la marca `provisional` solo cuando el negocio lo confirme. No se edita aquí.
6. ~~Ajustar el texto del PRD sobre los datos de demostración~~ El PRD ya se actualizó con el aviso de demostración y dice que el QR y la CCI son los del titular del proyecto. No queda nada por proponer sobre este punto.
