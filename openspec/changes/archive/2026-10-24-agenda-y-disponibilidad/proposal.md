## Why

Sin una agenda que garantice la capacidad, el asistente no puede ofrecer horarios ni guardar reservas sin dobles reservas. El PRD fija 2 limpiezas simultáneas, 1 hora de traslado, atención de lunes a sábado de 8 am a 6 pm, 48 horas de anticipación mínima y reservas en espera que expiran a las 24 horas. Este es el ítem #6 de `BACKLOG.md`: crea la tabla `reservas` con la restricción de exclusión por equipo (ADR 0002 y 0007), la consulta de horarios disponibles y la función común que marca como `expirada` toda reserva en espera vencida (ADR 0009). Los ítems #9, #11, #12 y #16 la reutilizan, así que conviene construirla una sola vez y probarla a fondo.

Depende de #1 (`equipos`, `configuracion` y `btree_gist`, ya construidos) y de #4 (`calcularServicio`, que da `horas_agenda`, ya construido).

## What Changes

- **Migración nueva** con la tabla `reservas`, los enums `tipo_servicio`, `estado_reserva` y `estado_apoyo`, y la **restricción de exclusión** por equipo sobre el rango bloqueado (servicio + traslado) para los estados `pendiente` y `confirmada`. Incluye todas las columnas de `reservas` que no dependen de tablas que aún no existen (dirección del hogar con los campos del ADR 0013, copia del cobro, apoyo extra, `primera_gratis`, `expira_en`). Las columnas `membresia_id` y `pago_id`, y los índices únicos que dependen de ellas, los agregan los ítems #9 y #10 (ver `design.md`).
- **Condición común de "reserva activa"** (`confirmada`, o `pendiente` con `expira_en > now()`), en un solo lugar, para que ninguna lectura la olvide.
- **Función común `expirarVencidas(tx)`** y un envoltorio de transacción de escritura que la ejecuta antes que nada. Quedan para los ítems #9, #11, #12 y #16.
- **Reglas del horario** como funciones puras: días y horas de atención, intervalo de 30 minutos, anticipación mínima de 48 horas, rango bloqueado (servicio + traslado) y validación del inicio que el servidor repite al crear (`422`).
- **Disponibilidad de horarios:** `GET /api/disponibilidad` (con sesión) devuelve, para un día y un servicio, los horarios de inicio con su estado (disponible, o en gris por falta de anticipación o de cupo), sin datos de otros clientes.
- **Inserción en el primer equipo libre** con un `SAVEPOINT` por intento, para que el `409` por conflicto y la asignación queden probados aquí; el ítem #9 solo la conecta a `POST /api/reservas`.
- Pruebas Vitest de las reglas puras y pruebas contra Neon (restricción de exclusión, expiración y concurrencia) que **no ensucian los datos reales**: equipos de prueba inactivos, un usuario de prueba y limpieza al terminar.

Fuera de alcance (llegan con otros ítems): `POST /api/reservas` y el asistente (#9), el pago, la membresía y la vigencia en la fecha del servicio (#9, #13), la limpieza gratis por hogar (#10), reprogramar y cancelar (#12), aprobar y rechazar pagos (#11), reasignar equipo y marcar completada (#16), el crédito en horas (#14) y la pantalla de selección de horario.

## Capabilities

### New Capabilities

- `reservas-agenda`: tabla de reservas con capacidad garantizada por equipo en la base de datos, reserva activa frente a vencida, expiración al empezar cada escritura e inserción en el primer equipo libre.
- `disponibilidad-horarios`: reglas del horario de atención, anticipación, intervalo y traslado, y la consulta de horarios disponibles para un día y un servicio.

### Modified Capabilities

Ninguna.

## Impact

- **Código nuevo:** `src/lib/agenda/` (horario, disponibilidad, rango bloqueado, expiración, lectura de ocupación, inserción en equipo libre), `app/api/disponibilidad/route.ts` y sus pruebas.
- **Base de datos:** una migración nueva (`reservas` y tres enums) con la restricción de exclusión escrita a mano en el SQL, porque `drizzle-kit` no genera restricciones `EXCLUDE`. Se aplica con `npm run db:migrate` **antes** de desplegar. Es aditiva: no toca tablas existentes.
- **Esquema:** `src/db/esquema.ts` suma `reservas` y sus enums.
- **Pruebas:** un archivo de configuración de Vitest aparte para las pruebas contra Neon, fuera de `npm test`.
- **Variables de entorno:** ninguna nueva. Las pruebas contra Neon usan la `DATABASE_URL` de `.env.local`, que hoy apunta a producción (riesgo en `design.md`).
- **Despliegue:** `npx vercel deploy --prod` y `GET /api/salud` = `200 {"estado":"ok"}`.
