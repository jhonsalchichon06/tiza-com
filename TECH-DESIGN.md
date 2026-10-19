# Technical Design Document: Tiza.com

**Tipo de proyecto:** Greenfield. El código existente en el repositorio es solo una demo de la landing y se usa como referencia visual.
**Design.md disponible:** No. El modelo de datos se derivó solo del PRD y puede necesitar ajustes cuando se diseñe la interfaz.

## Resumen

Tiza.com es un servicio de limpieza de hogares en Lima que necesita un canal de reservas propio y convertir a los visitantes en clientes leales. Se construye una sola aplicación web que ofrece la landing, el asistente de reserva, el pago de una membresía de 3 meses por Yape o transferencia con comprobante subido por el cliente, el perfil del cliente y un portal de administrador. Debe poder desplegarse en el plan gratuito de Vercel y usar PostgreSQL en Neon. El alcance, los usuarios y los criterios de éxito están en `PRD.md`.

## Arquitectura de componentes

Todo el código propio vive en **un solo repositorio y un solo proyecto de Vercel** (ADR 0001).

- **Aplicación Next.js con TypeScript (nueva):** sirve las páginas públicas (landing y preguntas frecuentes), el asistente de reserva, el perfil del cliente y el portal de administrador bajo `/admin`. Expone la **API REST con JSON** bajo `/api` (ADR 0003) y valida sesión y rol en cada ruta.
- **Neon (PostgreSQL):** persistencia de usuarios, membresías, pagos, equipos, reservas, fotos y reseñas. Garantiza la capacidad con una restricción de exclusión por equipo (ADR 0002 y 0007).
- **Biblioteca de autenticación:** registro, inicio de sesión, restablecimiento de contraseña y sesiones guardadas en la base de datos (ADR 0005).
- **Resend:** envío del correo de "Olvidé mi contraseña".
- **Vercel Blob:** almacenamiento de las imágenes de comprobantes de pago y fotos del servicio (ADR 0004). Los comprobantes solo deben ser accesibles para el cliente que los subió y para el administrador.
- **Enlace a WhatsApp:** solo un enlace con el mensaje prellenado, sin integración.

Qué existía antes: una demo estática con Vite y sesión en `localStorage`, que no se reutiliza como base de producción.

Flujo general: el navegador llama a `/api` con la cookie de sesión → la ruta valida sesión y rol → consulta o modifica Neon con Drizzle → para imágenes, guarda en Blob y registra la referencia en la base.

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

El ADR 0007 ajusta la regla de no solapamiento del ADR 0002 al pasar de 1 a 2 limpiezas simultáneas.

## Modelo de datos

Derivado solo del PRD (no hay `Design.md`). Las fechas son `timestamptz`.

| Entidad | Contenido principal | Relaciones |
|---|---|---|
| `usuarios` | correo único, hash de contraseña, nombre, teléfono, rol (`cliente` o `admin`) | Tiene muchas membresías y reservas |
| `membresias` | usuario, inicio, fin, estado (`pendiente`, `activa`, `vencida`), monto | Pertenece a un usuario; tiene pagos |
| `pagos` | membresía, método (`yape` o `transferencia`), referencia del comprobante, estado (`pendiente`, `aprobado`, `rechazado`), admin que revisó, fecha de revisión | Pertenece a una membresía |
| `equipos` | nombre, activo (hoy 2) | Tiene muchas reservas |
| `reservas` | usuario, equipo, tipo de servicio, horas, distrito, dirección, rango del servicio, rango bloqueado (servicio + 1 hora de traslado), estado, indicador de primera gratis | Pertenece a un usuario y a un equipo |
| `fotos_servicio` | reserva, ambiente, referencia de la imagen | Pertenece a una reserva |
| `resenas` | reserva (única), estrellas, comentario, aprobada | Pertenece a una reserva |
| tablas de la biblioteca | sesiones, cuentas y tokens de restablecimiento | Definidas por la biblioteca (ADR 0005) |

Reglas de datos:

- **Capacidad:** restricción de exclusión sobre `(equipo, rango bloqueado)` para reservas en estado activo (`pendiente` o `confirmada`) (ADR 0007).
- **Estados de la reserva:** `pendiente`, `confirmada`, `completada`, `cancelada`, `expirada`.
- Las contraseñas y los tokens se guardan solo como hash.
- El monto de la membresía es un dato, no una constante del código.
- Las imágenes no se guardan en la base: solo su referencia.
- El traslado de 1 hora y el horario de atención se mantienen en un solo lugar de configuración.

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

- [ ] Solo se pueden elegir los 9 distritos de v1.
- [ ] No se ofrecen domingos ni horas fuera de 8 am a 6 pm.
- [ ] Un horario sin ningún equipo libre durante toda la duración del servicio más 1 hora de traslado se muestra en gris y no se puede seleccionar.
- [ ] Al llegar al pago se ofrecen dos opciones: Yape (con el QR) y transferencia (con la CCI).
- [ ] El cliente puede subir un comprobante JPG, PNG o WebP de hasta 5 MB.
- [ ] Un archivo de otro tipo o de más de 5 MB se rechaza con un mensaje claro y no se crea el pago.
- [ ] Tras subir el comprobante, la membresía y el pago quedan en estado `pendiente` y la reserva de la primera limpieza gratis queda en espera.
- [ ] Si el administrador no aprueba el pago en 24 horas, la reserva pasa a `expirada` y su horario queda libre.
- [ ] Si el cliente cierra el asistente antes de confirmar, no queda ninguna reserva ni borrador en la base de datos.
- [ ] Un cliente de prueba completa el asistente, sin contar la subida del comprobante, en menos de 3 minutos sin ayuda.

### Capacidad y conflictos de horario

- [ ] Con 2 reservas activas que se solapan (incluido el traslado), una tercera reserva en el mismo rango se rechaza con `409` y un mensaje para elegir otra hora.
- [ ] Dos peticiones simultáneas por el último cupo: solo una se guarda y la otra recibe `409`.
- [ ] Una reserva que empieza justo cuando termina el traslado de otra del mismo equipo se acepta.
- [ ] Una reserva cancelada o expirada libera su cupo de inmediato.
- [ ] Al crear una reserva, el sistema la asigna al primer equipo libre.

### Portal de administrador

- [ ] Un usuario sin rol `admin` que abre `/admin` o una ruta de administración recibe `403` o es redirigido.
- [ ] El administrador ve las reservas con su estado y su equipo.
- [ ] El administrador puede ver el comprobante de cada pago pendiente.
- [ ] Al aprobar un pago, la membresía pasa a `activa`, sus 3 meses empiezan a contar desde la fecha de aprobación y la reserva de la primera limpieza gratis pasa a `confirmada`.
- [ ] Al rechazar un pago, el cliente puede subir otro comprobante.
- [ ] El administrador puede reasignar una reserva a otro equipo solo si ese equipo está libre en su rango; si no, la acción falla con un mensaje.
- [ ] El administrador puede subir fotos del servicio (JPG, PNG o WebP de hasta 5 MB) a una reserva completada.
- [ ] El administrador puede aprobar una reseña antes de que se muestre en la web.

### Perfil del cliente

- [ ] El cliente ve solo sus propias membresías, reservas, pagos, fotos y reseñas.
- [ ] Abrir por la URL una reserva o un comprobante de otro cliente responde `404`.
- [ ] El cliente puede reprogramar o cancelar una reserva hasta 24 horas antes del servicio; con menos de 24 horas se bloquea con un mensaje.
- [ ] El historial muestra el detalle de cada servicio con sus fotos y su reseña.
- [ ] El cliente puede dejar una sola reseña por servicio completado; no puede reseñar un servicio no completado ni dejar una segunda reseña.
- [ ] Una reseña se muestra públicamente en la web solo después de que el administrador la apruebe.

### Renovación (mes 4)

- [ ] Cuando la membresía cumple sus 3 meses, el perfil muestra un aviso de que debe realizar un nuevo pago para que el servicio sea válido.
- [ ] Con la membresía vencida y sin pago aprobado, el cliente no puede elegir día y hora para nuevas reservas.
- [ ] Una vez que el administrador aprueba el nuevo pago, el cliente puede elegir día y hora desde su perfil.

### Comprobantes privados y errores

- [ ] Un comprobante solo se puede ver por el cliente que lo subió y por un administrador; cualquier otro acceso falla.
- [ ] Si falla la subida de una imagen, la operación se cancela completa y no queda un pago sin comprobante.
- [ ] Si falla el envío del correo, se registra el error y el cliente recibe un mensaje de que revise su correo o lo intente de nuevo.
- [ ] Si Neon está dormido, el servidor reintenta una vez; si falla, el cliente ve el mensaje "inténtalo en unos segundos".
- [ ] Un error inesperado muestra un mensaje genérico al cliente y deja el detalle en los logs de Vercel.

## Riesgos técnicos abiertos

- **Plan gratuito de Vercel (Hobby):** su documentación indica que el plan es solo para uso personal y no comercial. Como los pagos son simulados incluso en producción, el plan es adecuado. Si Tiza.com pasara a cobrar dinero real a clientes, habría que pasar al plan Pro.
- **`btree_gist` en Neon:** la documentación de Neon lo lista como extensión soportada y no indica restricción por plan. Se habilita con `CREATE EXTENSION IF NOT EXISTS btree_gist;` en la primera migración, y hay que comprobar que el comando se ejecute sin error en la base real (ADR 0002 y 0007).
- **Vercel Blob privado:** Vercel Blob ofrece tiendas privadas en todos los planes. El modo de acceso se elige al crear la tienda y no se puede cambiar después, así que los comprobantes y las fotos deben ir en una **tienda privada** y entregarse a través de rutas `/api` que comprueben la sesión y el rol (ADR 0004). En el plan Hobby el almacenamiento incluido es 1 GB, y si se exceden los límites el servicio se bloquea hasta pasados 30 días.
- **Elección de biblioteca de autenticación:** elegir entre Better Auth y Auth.js y verificar que soporte correo y contraseña con Resend (ADR 0005).
- **Reservas del mes 3 sin pago del mes 4:** el PRD no define qué pasa con las ya agendadas.
- **Monto de la membresía y duración de la renovación:** siguen sin definir en el PRD; el modelo los guarda como datos.
- **Reparto de reservas entre equipos:** la asignación al primer equipo libre puede rechazar una reserva que sí cabría con otro reparto; el administrador puede reasignar a mano (ADR 0007).
- **Expiración al consultar:** una reserva vencida sigue como pendiente hasta la siguiente consulta de la agenda (ADR 0006).
- **Límites de los servicios gratuitos** de Vercel, Neon, Resend y Blob si crece el tráfico, y arranque en frío de Neon tras inactividad.
- **Sin `Design.md`:** el modelo puede necesitar campos nuevos cuando se diseñen las pantallas.
