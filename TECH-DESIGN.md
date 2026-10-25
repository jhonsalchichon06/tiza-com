# Technical Design Document: Tiza.com

**Tipo de proyecto:** Greenfield. El código existente en el repositorio es solo una demo de la landing y se usa como referencia visual.
**Design.md disponible:** No. El modelo de datos se derivó solo del PRD y puede necesitar ajustes cuando se diseñe la interfaz.

## Resumen

Tiza.com es un servicio de limpieza de hogares en Lima que necesita un canal de reservas propio y convertir a los visitantes en clientes leales. Se construye una sola aplicación web que ofrece la landing, el asistente de reserva, el pago de una membresía de 3 meses y de cada limpieza por Yape o transferencia con comprobante subido por el cliente, el perfil del cliente y un portal de administrador. Debe poder desplegarse en el plan gratuito de Vercel y usar PostgreSQL en Neon. El alcance, los usuarios y los criterios de éxito están en `PRD.md`.

## Arquitectura de componentes

Todo el código propio vive en **un solo repositorio y un solo proyecto de Vercel** (ADR 0001).

- **Aplicación Next.js con TypeScript (nueva):** sirve las páginas públicas (landing y preguntas frecuentes), el asistente de reserva, el perfil del cliente y el portal de administrador bajo `/admin`. Expone la **API REST con JSON** bajo `/api` (ADR 0003) y valida sesión y rol en cada ruta.
- **Neon (PostgreSQL):** persistencia de usuarios, membresías, pagos, equipos, reservas, fotos y reseñas. Garantiza la capacidad con una restricción de exclusión por equipo (ADR 0002 y 0007).
- **Biblioteca de autenticación:** registro, inicio de sesión, restablecimiento de contraseña y sesiones guardadas en la base de datos (ADR 0005).
- **Resend:** envío del correo de "Olvidé mi contraseña".
- **Vercel Blob (tienda privada):** almacenamiento de las imágenes de comprobantes de pago y fotos del servicio (ADR 0004). El navegador comprime la imagen y la sube directo con un token que emite `/api`; la entrega pasa por `/api`, que comprueba el permiso (ADR 0010). Los comprobantes solo deben ser accesibles para el cliente que los subió y para el administrador.
- **Cron diario de Vercel:** solo borra imágenes huérfanas de Blob (ADR 0010). La expiración de reservas no depende de él (ADR 0009).
- **Enlace a WhatsApp:** solo un enlace con el mensaje prellenado, sin integración.

Qué existía antes: una demo estática con Vite y sesión en `localStorage`, que no se reutiliza como base de producción.

Flujo general: el navegador llama a `/api` con la cookie de sesión → la ruta valida sesión y rol → consulta o modifica Neon con Drizzle (las operaciones de varios pasos, en una transacción con el driver WebSocket de Neon, ADR 0009) → para imágenes, el navegador sube primero a Blob con un token y la ruta registra la referencia después de verificar el archivo (ADR 0010).

Flujo de una reserva: el cliente elige el servicio → escribe su dirección (distrito, calle, número y departamento) → elige fecha y hora (al menos 48 h de anticipación) → ve el precio, ya descontadas las horas gratis y el crédito → paga por Yape o transferencia → sube el comprobante a Blob → `POST /api/reservas` valida y normaliza la dirección y crea en una sola transacción el pago (y la membresía, si es la primera), los usos de crédito y la reserva `pendiente` con `expira_en` a 24 h → el administrador aprueba y la reserva pasa a `confirmada`. Si el crédito cubre todo, la reserva se confirma al instante, sin comprobante (ADR 0008, 0009, 0012 y 0013).

## Decisiones de arquitectura

| # | Decisión | Estado |
|---|---|---|
| [ADR-0001](adrs/0001-una-sola-aplicacion-en-vercel.md) | Una sola aplicación desplegada en Vercel | Aceptado |
| [ADR-0002](adrs/0002-modelo-de-datos-postgresql.md) | Modelo de datos relacional en PostgreSQL con restricción de exclusión para las reservas | Aceptado |
| [ADR-0003](adrs/0003-api-rest-con-json.md) | API REST con JSON | Aceptado |
| [ADR-0004](adrs/0004-stack-nextjs-typescript-drizzle.md) | Stack tecnológico: Next.js, TypeScript y Drizzle ORM | Aceptado |
| [ADR-0005](adrs/0005-sesion-con-biblioteca-de-autenticacion.md) | Sesión con biblioteca de autenticación y estado de la reserva en el navegador | Aceptado |
| [ADR-0006](adrs/0006-resiliencia-y-manejo-de-errores.md) | Resiliencia y manejo de errores proporcional | Aceptado |
| [ADR-0007](adrs/0007-capacidad-de-dos-equipos.md) | Capacidad de 2 limpiezas simultáneas con equipos y traslado de 1 hora | Aceptado |
| [ADR-0008](adrs/0008-precios-pagos-por-reserva-y-vinculo-con-membresia.md) | Precios, pago por reserva y vínculo de cada reserva con su membresía | Aceptado |
| [ADR-0009](adrs/0009-ciclo-de-vida-de-reservas-en-espera.md) | Ciclo de vida de las reservas en espera de pago | Aceptado |
| [ADR-0010](adrs/0010-subida-directa-de-imagenes-a-blob.md) | Subida directa de imágenes a Vercel Blob con compresión en el navegador | Aceptado |
| [ADR-0011](adrs/0011-direccion-verificada-con-google-maps.md) | Dirección verificada con Google Maps | Reemplazado por el ADR-0013 |
| [ADR-0012](adrs/0012-credito-en-horas-por-cancelacion.md) | Crédito en horas por cancelación | Aceptado |
| [ADR-0013](adrs/0013-direccion-con-campos-de-texto.md) | Dirección del hogar con campos de texto | Aceptado |

El ADR 0007 ajusta la regla de no solapamiento del ADR 0002 al pasar de 1 a 2 limpiezas simultáneas. Los ADR 0008, 0009 y 0010 salen de una revisión adversarial del diseño: agregan el cobro de cada limpieza y el vínculo entre reserva, membresía y pago, reemplazan la expiración al consultar del ADR 0006 y cambian la forma de subir imágenes de los ADR 0003 y 0004.

## Modelo de datos

Derivado solo del PRD (no hay `Design.md`). Las fechas son `timestamptz`.

| Entidad | Contenido principal | Relaciones |
|---|---|---|
| `usuarios` | correo único (en minúsculas), nombre, `telefono` (celular de 9 dígitos), `rol` (enum `cliente` o `admin`, por defecto `cliente`) | Tiene muchas membresías y reservas; sus sesiones y cuentas son de Better Auth |
| `membresias` | usuario, monto, inicio y fin (vacíos hasta la aprobación), estado (`pendiente`, `activa`, `caducada`); "vencida" se calcula con `fin`. `caducada` cierra una membresía cuyo pago fue rechazado y no se reenvió comprobante en el plazo de `configuracion`: no activa nada, no tiene fechas ni genera crédito | Pertenece a un usuario; tiene pagos y reservas |
| `pagos` | usuario, concepto (`membresia`, `reserva`, `membresia_y_reserva`), membresía (si el concepto la incluye), monto, método (`yape`, `transferencia` o `credito`, este último interno, con monto 0 y aprobado automáticamente), referencia del comprobante, estado (`pendiente`, `aprobado`, `rechazado`), admin que revisó, fecha de revisión | Pertenece a un usuario y, si aplica, a una membresía; confirma reservas |
| `configuracion` | niveles del hogar (máximo de dormitorios y baños, horas y precio de la limpieza estándar: 2 h S/ 66, 3 h S/ 99, 4 h S/ 129, 6 h S/ 189), parámetros de duración (+1 h profunda, +2 h mudanza, umbral de apoyo de 6 h y factor de 0,5 con apoyo), vencimiento del crédito (3 meses), multiplicadores de precio (1 / 1,5 / 1,7), paquetes por horas, precio y duración de la membresía, horas gratis (3), descuento de miembro (10%), anticipación mínima, espera máxima del pago, traslado, intervalo de horarios (30 min), horario de atención, plazo para reenviar un comprobante rechazado (7 días corridos), antelación mínima para cancelar o reprogramar (`cancelacion_minima_horas`, 24 horas) y días de aviso antes de que venza la membresía (`renovacion_aviso_dias`, 14, provisional) | — |
| `equipos` | nombre, activo (hoy 2) | Tiene muchas reservas |
| `reservas` | usuario, membresía, pago, equipo, tipo de servicio, dormitorios, baños o paquete, `horas_trabajo` (1 persona), `horas_agenda`, `requiere_apoyo`, `apoyo_estado` (`por_coordinar`, `coordinado`) y nota, distrito (de la lista de los 9), calle y número, departamento y `departamento_normalizado`, referencias, `direccion_normalizada`, rango del servicio, rango bloqueado (servicio + 1 hora de traslado), precio de lista, horas gratis aplicadas, crédito aplicado, descuento, monto, indicador `primera_gratis`, estado, `expira_en` | Pertenece a un usuario, una membresía, un pago y un equipo |
| `creditos_horas` | usuario, reserva de origen (única), horas iniciales, horas disponibles, `vence_en` | Pertenece a un usuario; tiene usos |
| `usos_credito` | lote de crédito, reserva de destino, horas, estado (`reservado`, `consumido`, `devuelto`) | Une créditos y reservas |
| `fotos_servicio` | reserva, ambiente, referencia de la imagen | Pertenece a una reserva |
| `resenas` | reserva (única), estrellas, comentario, aprobada | Pertenece a una reserva |
| `sesiones`, `cuentas`, `verificaciones` | sesiones revocables, cuenta con contraseña (el hash vive en `cuentas.password`) y tokens de restablecimiento | Definidas por Better Auth (ADR 0005) |

Reglas de datos:

- **Capacidad:** restricción de exclusión sobre `(equipo, rango bloqueado)` para reservas en estado activo (`pendiente` o `confirmada`) (ADR 0007).
- **Estados de la reserva:** `pendiente`, `confirmada`, `completada`, `cancelada`, `expirada`. Una reserva `pendiente` cuenta como activa solo mientras `expira_en > now()`. Las escrituras marcan las vencidas como `expiradas` al empezar su transacción (ADR 0009).
- **Una limpieza gratis por cliente y por hogar:** índices únicos parciales sobre `reservas(usuario_id)` y `reservas(distrito, direccion_normalizada, departamento_normalizado)` con `primera_gratis` en estado `pendiente`, `confirmada` o `completada`. Como las canceladas y las expiradas no cuentan, la limpieza gratis se puede reusar si la primera se cancela (ADR 0008).
- **Cuándo aplica la limpieza gratis:** el servidor la aplica sola si el cliente no tiene ninguna reserva `pendiente`, `confirmada` ni `completada` y su dirección no la recibió ya. La renovación no da otra (ADR 0008).
- **Precio y duración:** los calcula un solo módulo del servidor a partir de `configuracion`. Las 3 primeras horas de la limpieza gratis no se cobran; las adicionales se cobran de forma proporcional con el descuento de miembro (ADR 0008).
- **Apoyo extra:** un servicio por tamaño de más de 6 h de trabajo se marca `requiere_apoyo` y bloquea en la agenda la mitad del tiempo, redondeado hacia arriba a 30 min. El precio, las horas gratis y el crédito se cuentan siempre en horas de trabajo de 1 persona. El apoyo no ocupa un equipo (ADR 0008).
- **Dirección:** el cliente escribe distrito (de una lista cerrada de los 9), calle, número y, aparte, departamento y referencias. El servidor exige un distrito de v1, una calle y un número con algún dígito, y normaliza la dirección y el departamento. No se verifica que la dirección exista y no se guardan coordenadas (ADR 0013).
- **Crédito en horas:** se genera cuando una reserva queda cancelada por el cliente y su pago está aprobado (en cualquier orden), con vencimiento a los 3 meses. Se aplica solo, empezando por el lote que vence antes. Las horas reservadas vuelven a su lote, con su vencimiento original, si la reserva expira, se rechaza o se cancela. El saldo se calcula a partir de los lotes, no se guarda aparte (ADR 0012).
- **Una limpieza por pago:** índice único parcial sobre `reservas(pago_id)` en esos mismos estados; una reserva expirada o cancelada por el administrador no consume el pago; una cancelada por el cliente sí (su pago pasa a crédito en horas, ADR 0008 y 0012) y el servidor lo hace cumplir (ADR 0009).
- **Una reserva en espera por cliente:** índice único parcial sobre `reservas(usuario_id)` con estado `pendiente` (ADR 0009).
- **Una membresía pendiente por cliente:** índice único parcial sobre `membresias(usuario_id)` con estado `pendiente` (ADR 0008).
- **Vigencia en la fecha del servicio:** el servidor comprueba, en la misma transacción, que el inicio del servicio sea anterior al `fin` de la membresía (o caiga dentro de los 3 meses siguientes si es la primera y aún está pendiente) (ADR 0008).
- **Anticipación mínima de 48 h** para crear o reprogramar una reserva (ADR 0009).
- La reserva guarda una copia del precio cobrado; si cambian los parámetros, el historial no cambia.
- Las contraseñas y los tokens se guardan solo como hash.
- Precios, duraciones, montos y plazos son datos (`configuracion`), no constantes del código.
- Las imágenes no se guardan en la base: solo su referencia en Blob.

## Criterios de aceptación por flujo

### Registro e inicio de sesión

- [ ] Un visitante se registra con un correo válido y una contraseña de al menos 8 caracteres y queda con la sesión iniciada.
- [ ] Una contraseña de menos de 8 caracteres se rechaza con un mensaje claro.
- [ ] Un correo ya registrado no crea una cuenta duplicada y muestra un mensaje claro.
- [ ] Credenciales incorrectas muestran un mensaje genérico que no revela si el correo existe.
- [ ] En la base de datos, la contraseña existe solo como hash.
- [ ] Después de cerrar sesión, las rutas `/api` privadas responden `401` y las páginas de cuenta redirigen al inicio de sesión.

### Olvidé mi contraseña

- [ ] Solicitar el restablecimiento con un correo registrado envía un correo con un enlace.
- [ ] Solicitarlo con un correo no registrado muestra la misma respuesta y no envía correo.
- [ ] El enlace funciona una sola vez; un segundo uso se rechaza.
- [ ] El enlace deja de funcionar 1 hora después de enviarse.
- [ ] En la base de datos, el token existe solo como hash.

### Reservar y pagar la membresía (cliente nuevo)

- [ ] El asistente pide el distrito (lista de los 9 de v1), la calle, el número y, aparte, el departamento o interior y las referencias, que son opcionales.
- [ ] Un distrito que no es uno de los 9 de v1 se rechaza con `422` y un mensaje claro, aunque el navegador lo envíe por fuera de la lista.
- [ ] Una dirección sin calle, o con un número sin ningún dígito, se rechaza con `422` y se pide el dato que falta.
- [ ] La calle y el departamento se guardan normalizados (minúsculas, sin tildes ni signos, abreviaturas unificadas) y también como los escribió el cliente.
- [ ] El departamento y las referencias son opcionales: una casa sin departamento se reserva sin ellos.
- [ ] No se ofrecen domingos ni horas fuera de 8 am a 6 pm.
- [ ] Un horario que empieza dentro de las próximas 48 horas se muestra en gris y el servidor lo rechaza con `422` si se envía igual.
- [ ] Un horario sin ningún equipo libre durante toda la duración del servicio más 1 hora de traslado se muestra en gris y no se puede seleccionar.
- [ ] Nivel del hogar (estándar): 0 dormitorios y 1 baño → 2 h; 1 y 1 → 3 h; 2 y 1, 1 y 2 o 2 y 2 → 4 h; 3 y 2 o 5 y 4 → 6 h. El horario bloquea esa duración más 1 hora de traslado.
- [ ] Duración por tipo: 2 dormitorios y 1 baño → estándar 4 h, profunda 5 h y mudanza 6 h.
- [ ] Precio por tamaño: 2 dormitorios y 1 baño → estándar S/ 129, profunda S/ 193,50, mudanza S/ 219,30; 0 dormitorios y 1 baño en estándar → S/ 66.
- [ ] El asistente permite elegir 0 dormitorios.
- [ ] Los horarios de inicio se ofrecen cada 30 minutos.
- [ ] Hasta 6 h de trabajo, el servicio no lleva apoyo y ocupa sus horas completas. Ejemplos: profunda de 2 dormitorios y 1 baño = 5 h; mudanza de 2 dormitorios y 2 baños = 6 h; estándar de cualquier tamaño (máximo 6 h).
- [ ] Con más de 6 h, se marca "requiere apoyo" y ocupa la mitad en la agenda, redondeada a 30 min. Ejemplos: profunda de 3 dormitorios y 2 baños = 7 h → 3,5 h; mudanza de 3 dormitorios y 1 baño = 8 h → 4 h. El precio no cambia.
- [ ] Un paquete por horas de 8 h no lleva apoyo y ocupa 8 h.
- [ ] Al llegar al pago se ofrecen dos opciones: Yape (con el QR) y transferencia (con la CCI).
- [ ] El cliente puede subir un comprobante JPG, PNG o WebP de hasta 5 MB, incluido un archivo de entre 4,5 y 5 MB.
- [ ] Un archivo de otro tipo o de más de 5 MB se rechaza con un mensaje claro y no se crea el pago.
- [ ] Una reserva no se puede crear sin comprobante: `POST /api/reservas` sin comprobante responde `422` y no crea nada.
- [ ] Tras subir el comprobante, la membresía y el pago quedan en estado `pendiente` y la reserva de la primera limpieza gratis queda `pendiente` con `expira_en` a 24 horas.
- [ ] En la primera limpieza, las 3 primeras horas no se cobran. Ejemplo: profunda de 2 dormitorios y 1 baño (5 h, S/ 193,50) → 2 h × S/ 193,50 ÷ 5 × 0,9 = S/ 69,66, y el pago es la membresía más S/ 69,66.
- [ ] Una estándar de 1 dormitorio y 1 baño (3 h) como primera limpieza no suma nada al pago de la membresía.
- [ ] Un paquete de 3 horas como primera limpieza no suma nada al pago de la membresía.
- [ ] Si el administrador no aprueba el pago en 24 horas, la reserva deja de bloquear su horario de inmediato, aunque nadie consulte la agenda, y se marca `expirada` en la siguiente escritura.
- [ ] Un cliente con una reserva `pendiente` que intenta crear otra recibe `409` con un mensaje claro.
- [ ] Un cliente que ya tuvo su limpieza gratis no recibe otra, ni siquiera al renovar.
- [ ] Una segunda cuenta que escribe la misma dirección con el mismo departamento (aunque lo escriba distinto, por ejemplo "Dpto 302" y "dpto. 302", o "Av." y "Avenida") no recibe las horas gratis y ve el precio completo.
- [ ] Dos departamentos distintos del mismo edificio pueden recibir cada uno su limpieza gratis.
- [ ] El mismo edificio con otro número de departamento sí recibe las horas gratis.
- [ ] Si el cliente cancela su primera limpieza, su siguiente reserva recibe las 3 horas gratis; si ya tiene una limpieza realizada, no.
- [ ] Dos peticiones simultáneas con limpieza gratis para la misma dirección: solo una la recibe.
- [ ] Si el cliente cierra el asistente antes de confirmar, no queda ninguna reserva ni borrador en la base de datos; un comprobante subido sin reserva se borra en la limpieza diaria.
- [ ] Un cliente de prueba completa el asistente, sin contar la subida del comprobante, en menos de 3 minutos sin ayuda.

### Reservar y pagar una limpieza (miembro activo)

- [ ] El precio mostrado y guardado es el de lista con el descuento de miembro de `configuracion`.
- [ ] El cliente paga con Yape o transferencia y sube el comprobante; la reserva queda `pendiente` con `expira_en` a 24 horas.
- [ ] Una fecha de servicio posterior al `fin` de la membresía se rechaza con `422` y un mensaje que pide renovar.
- [ ] Al aprobar el pago, la reserva pasa a `confirmada`.

### Capacidad y conflictos de horario

- [ ] Con 2 reservas activas que se solapan (incluido el traslado), una tercera reserva en el mismo rango se rechaza con `409` y un mensaje para elegir otra hora.
- [ ] Dos peticiones simultáneas por el último cupo: solo una se guarda y la otra recibe `409`.
- [ ] Una reserva que empieza justo cuando termina el traslado de otra del mismo equipo se acepta.
- [ ] Una reserva cancelada o expirada libera su cupo de inmediato.
- [ ] Al crear una reserva, el sistema la asigna al primer equipo libre.

### Portal de administrador

- [ ] Un usuario sin rol `admin` que abre `/admin` o una ruta de administración recibe `403` o es redirigido.
- [ ] El administrador ve las reservas con su estado y su equipo.
- [ ] El administrador marca a mano como `completada` una reserva `confirmada` cuyo servicio ya empezó; no puede completar una reserva pendiente, cancelada, expirada ni futura.
- [ ] El administrador puede ver el comprobante de cada pago pendiente.
- [ ] El administrador nunca ve como pendiente una reserva cuya espera ya venció.
- [ ] Al aprobar un pago, la membresía pasa a `activa`, sus 3 meses empiezan a contar desde la fecha de aprobación y la reserva de la primera limpieza gratis pasa a `confirmada`.
- [ ] Al aprobar un pago cuya reserva ya expiró, la membresía se activa igual, la reserva sigue `expirada` (su horario no se vuelve a ocupar) y el perfil del cliente muestra "Elige un nuevo día y hora".
- [ ] La nueva reserva elegida tras una aprobación tardía usa el mismo pago, se crea `confirmada` y no pide otro comprobante.
- [ ] Al rechazar un pago, el cliente puede subir otro comprobante; la reserva conserva su `expira_en` original.
- [ ] Si el pago se rechaza y la reserva ya expiró, el cliente puede subir otro comprobante hasta 7 días corridos después del rechazo (plazo de `configuracion`); si se aprueba, rige la aprobación tardía, y pasado el plazo la membresía en espera se cierra y puede empezar de nuevo.
- [ ] El administrador puede cancelar una reserva `pendiente` con comprobante falso y su horario queda libre de inmediato.
- [ ] Al revisar un pago con limpieza gratis, el administrador ve las reservas gratis del mismo distrito que comparten número y una calle parecida, o la misma dirección con otro departamento.
- [ ] El administrador ve las reservas que requieren apoyo y aún no lo tienen coordinado, ordenadas por fecha, y puede marcarlas como coordinadas con una nota.
- [ ] El administrador ve el saldo de crédito en horas de cada cliente.
- [ ] El administrador puede reasignar una reserva a otro equipo solo si ese equipo está libre en su rango; si no, la acción falla con un mensaje.
- [ ] El administrador puede subir fotos del servicio (JPG, PNG o WebP de hasta 5 MB) a una reserva completada.
- [ ] El administrador puede aprobar una reseña antes de que se muestre en la web.

### Perfil del cliente

- [ ] El cliente ve solo sus propias membresías, reservas, pagos, fotos y reseñas.
- [ ] Abrir por la URL una reserva o un comprobante de otro cliente responde `404`.
- [ ] El cliente puede reprogramar o cancelar una reserva hasta 24 horas antes del servicio; con menos de 24 horas se bloquea con un mensaje.
- [ ] El historial muestra el detalle de cada servicio con sus fotos y su reseña.

### Crédito en horas

- [ ] Al cancelar (con más de 24 h) una limpieza pagada y aprobada de 4 h de trabajo, el cliente recibe un crédito de 4 h que vence a los 3 meses; el perfil muestra el saldo y el vencimiento.
- [ ] Si cancela antes de que se apruebe el pago, no hay crédito; si el administrador aprueba después, el crédito aparece en ese momento. Si lo rechaza, no hay crédito.
- [ ] Una primera limpieza cancelada no genera crédito por sus 3 horas gratis, solo por las horas adicionales pagadas.
- [ ] En la siguiente reserva, el crédito se descuenta solo, empezando por el lote que vence antes, y el monto refleja solo las horas que quedan por pagar.
- [ ] Si el crédito cubre todas las horas, la reserva se confirma al instante, sin comprobante.
- [ ] Si una reserva que usó crédito expira o se rechaza, las horas vuelven al saldo con su vencimiento original.
- [ ] Si se cancela una reserva pagada en parte con crédito, esas horas vuelven a su lote original y solo la parte pagada en dinero genera un crédito nuevo.
- [ ] Un crédito vencido deja de aparecer en el saldo y no se aplica.
- [ ] Dos reservas simultáneas no pueden usar las mismas horas de crédito.
- [ ] Con la membresía vencida, el saldo se ve en el perfil pero no se puede reservar hasta renovar.
- [ ] El cliente puede dejar una sola reseña por servicio completado; no puede reseñar un servicio no completado ni dejar una segunda reseña.
- [ ] Una reseña se muestra públicamente en la web solo después de que el administrador la apruebe.

### Renovación (mes 4)

- [ ] Cuando la membresía cumple sus 3 meses, el perfil muestra un aviso de que debe realizar un nuevo pago para que el servicio sea válido.
- [ ] Con la membresía vencida y sin pago aprobado, el cliente no puede elegir día y hora para nuevas reservas.
- [ ] Durante el mes 3, el cliente no puede agendar una limpieza para una fecha posterior al fin de su membresía.
- [ ] Una vez que el administrador aprueba el nuevo pago, el cliente puede elegir día y hora desde su perfil.

### Comprobantes privados y errores

- [ ] Un comprobante solo se puede ver por el cliente que lo subió y por un administrador; cualquier otro acceso falla.
- [ ] Si falla la subida de una imagen, no se crea el pago ni la reserva.
- [ ] El servidor rechaza registrar un comprobante cuyo archivo no existe en Blob o está en la carpeta de otro usuario.
- [ ] Un comprobante o una foto se entrega por `/api` sin error aunque el original pesara 5 MB.
- [ ] La limpieza diaria borra los archivos de más de 24 horas que ninguna fila referencia, y no borra ninguno que sí se use.
- [ ] Si falla el envío del correo, se registra el error y el cliente recibe un mensaje de que revise su correo o lo intente de nuevo.
- [ ] Si Neon está dormido, el servidor reintenta una vez; si falla, el cliente ve el mensaje "inténtalo en unos segundos".
- [ ] Un error inesperado muestra un mensaje genérico al cliente y deja el detalle en los logs de Vercel.

## Riesgos técnicos abiertos

- **Plan gratuito de Vercel (Hobby):** su documentación indica que el plan es solo para uso personal y no comercial. Como los pagos son simulados incluso en producción, el plan es adecuado. Si Tiza.com pasara a cobrar dinero real a clientes, habría que pasar al plan Pro.
- **`btree_gist` en Neon:** la documentación de Neon lo lista como extensión soportada y no indica restricción por plan. Se habilita con `CREATE EXTENSION IF NOT EXISTS btree_gist;` en la primera migración, y hay que comprobar que el comando se ejecute sin error en la base real (ADR 0002 y 0007).
- **Vercel Blob privado:** Vercel Blob ofrece tiendas privadas en todos los planes. El modo de acceso se elige al crear la tienda y no se puede cambiar después, así que los comprobantes y las fotos deben ir en una **tienda privada** y entregarse a través de rutas `/api` que comprueben la sesión y el rol (ADR 0004). En el plan Hobby el almacenamiento incluido es 1 GB, y si se exceden los límites el servicio se bloquea hasta pasados 30 días; la compresión en el navegador lo mitiga (ADR 0010). Por verificar: que la subida directa con token funcione con una tienda privada y si hay URLs firmadas para la entrega.
- **Límite de 4,5 MB de las funciones de Vercel:** por eso las imágenes se suben directo a Blob y se comprimen a 4 MB o menos antes de entregarse por `/api` (ADR 0010).
- **Reglas del negocio sin confirmar (ADR 0008):** que los precios de los paquetes y los multiplicadores de la demo sigan vigentes, y qué pasa si no se consigue a la persona de apoyo (incluido el crédito si la cancelación la causa Tiza). Decisión provisional del usuario (2026-10-21), pendiente de confirmar por el negocio: se reprograma con el cliente por WhatsApp, fuera del sistema, y el pago se conserva; el administrador cambia el horario desde el portal. El modelo los guarda como datos, pero las pruebas usan valores provisionales.
- **Dirección sin verificar (ADR 0013):** el sistema no comprueba que la dirección exista ni que esté en el distrito elegido, y una misma casa escrita de otra forma puede recibir otra limpieza gratis. Lo contiene el administrador al revisar cada pago con limpieza gratis. La dirección y el departamento son texto libre.
- **Persona de apoyo:** las reservas de más de 6 h de trabajo dependen de conseguir a alguien externo. Si no aparece, el servicio no cabe en el rango bloqueado (ADR 0008).
- **Crédito en horas (ADR 0012):** cada transición de estado de una reserva actualiza también sus usos de crédito; un error regala horas o las hace perder, así que necesita pruebas de cada combinación.
- **Carga del administrador:** cada limpieza pagada exige aprobar un comprobante; si no se revisa a tiempo (por ejemplo, los domingos), las reservas expiran y el cliente debe elegir otro horario (ADR 0009).
- **Bloqueo con varias cuentas:** cada cuenta puede bloquear como máximo un horario hasta 24 h con un comprobante falso; falta un límite de registros por IP (ADR 0009).
- **Sin límite de intentos de inicio de sesión:** se eligió Better Auth sin publicar su manejador HTTP, así que su límite de intentos no actúa (ADR 0005). Si aparece fuerza bruta, agregarlo aparte (por ejemplo, con el firewall de Vercel).
- **Reservas del mes 3 sin pago del mes 4:** el PRD no define qué pasa con las ya agendadas.
- **Monto de la membresía y duración de la renovación:** siguen sin definir en el PRD; el modelo los guarda como datos.
- **Reparto de reservas entre equipos:** la asignación al primer equipo libre puede rechazar una reserva que sí cabría con otro reparto; el administrador puede reasignar a mano (ADR 0007).
- **Límites de los servicios gratuitos** de Vercel, Neon, Resend y Blob si crece el tráfico, y arranque en frío de Neon tras inactividad.
- **Sin `Design.md`:** el modelo puede necesitar campos nuevos cuando se diseñen las pantallas.
