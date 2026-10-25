## Purpose

Lista las próximas reservas y el historial del cliente y abre el detalle de cada una, sin dejar que un cliente vea datos de otro (PRD, "Alcance" punto 7 y caso borde 5; TECH-DESIGN, "Perfil del cliente"; ADR 0005 y 0009). Las fotos del servicio y la reseña del historial las agregan los ítems #17 y #18 sobre este detalle.

## ADDED Requirements

### Requirement: Resumen del perfil por `GET /api/perfil`

`GET /api/perfil` MUST exigir sesión (`401` sin ella) y MUST devolver, solo del cliente de la sesión: el estado de la membresía y sus fechas, los avisos, las próximas reservas y el historial. La respuesta MUST llevar `Cache-Control: private, no-store`. Un administrador que llama a la ruta MUST ver sus propios datos como cualquier cliente.

#### Scenario: Sin sesión

- **WHEN** se llama a `GET /api/perfil` sin cookie de sesión
- **THEN** responde `401` con el formato único de errores

#### Scenario: Solo mis datos

- **WHEN** el cliente A tiene dos reservas y el cliente B tres
- **THEN** la respuesta para A trae solo las dos de A

#### Scenario: Forma de la respuesta

- **WHEN** un cliente con una reserva confirmada abre el perfil
- **THEN** la respuesta trae `membresia`, `avisos`, `proximas` y `historial`, con las fechas como texto ISO con el desfase de Lima y los montos en céntimos enteros

### Requirement: Próximas reservas

Una reserva MUST aparecer en `proximas` solo si es `reservaActiva` (`confirmada`, o `pendiente` con `expira_en` posterior a ahora) y su `inicio` es posterior a ahora, ordenadas de la más cercana a la más lejana. Cada una MUST incluir: `id`, estado, servicio (tipo y tamaño o paquete), `inicio`, `fin`, dirección tal como la escribió el cliente, `monto`, `precio_lista`, `horas_gratis_aplicadas`, `requiere_apoyo`, `expira_en` si está `pendiente`, y las banderas `puede_reprogramar` y `puede_cancelar`. El equipo asignado MUST NOT mostrarse al cliente. Una reserva `pendiente` MUST mostrarse con el texto "Esperando la aprobación de tu pago" y la hora límite.

#### Scenario: Reserva confirmada futura

- **WHEN** el cliente tiene una reserva `confirmada` dentro de 5 días
- **THEN** aparece en `proximas` con `puede_reprogramar` y `puede_cancelar` verdaderos

#### Scenario: Reserva pendiente vigente

- **WHEN** la reserva está `pendiente` con `expira_en` dentro de 10 horas
- **THEN** aparece en `proximas` con el texto de espera y la hora límite

#### Scenario: Pendiente vencida no es próxima

- **WHEN** la reserva está `pendiente` con `expira_en` anterior a ahora
- **THEN** no aparece en `proximas`

#### Scenario: Orden

- **WHEN** hay reservas dentro de 3, 10 y 6 días
- **THEN** salen en ese orden de fecha: 3, 6 y 10 días

#### Scenario: El equipo no se muestra

- **WHEN** se arma la respuesta de una reserva
- **THEN** no incluye `equipo_id` ni el nombre del equipo

### Requirement: Historial

Toda reserva del cliente que no sea una próxima MUST aparecer en `historial`, de la más reciente a la más antigua, con un máximo de 50. El estado mostrado MUST ser el efectivo: una `pendiente` vencida se muestra `expirada`, y una `confirmada` cuyo `inicio` ya pasó sin estar `completada` se muestra con el texto "Servicio realizado, pendiente de cierre". Cada elemento MUST llevar un enlace a su detalle. Las fotos del servicio y la reseña no forman parte de este ítem; el detalle MUST dejar espacio para que los ítems #17 y #18 las agreguen.

#### Scenario: Servicio completado

- **WHEN** el administrador marcó una reserva `completada`
- **THEN** aparece en `historial` con el estado "Completada" y la fecha del servicio

#### Scenario: Cancelada y expirada

- **WHEN** el cliente tiene una reserva `cancelada` y otra `expirada`
- **THEN** ambas aparecen en `historial` con su estado

#### Scenario: Confirmada ya pasada

- **WHEN** una reserva `confirmada` empezó ayer y nadie la marcó `completada`
- **THEN** aparece en `historial` con "Servicio realizado, pendiente de cierre" y no en `proximas`

#### Scenario: Límite

- **WHEN** el cliente tiene 60 reservas anteriores
- **THEN** `historial` trae las 50 más recientes

### Requirement: Detalle de una reserva por `GET /api/reservas/:id`

`GET /api/reservas/:id` MUST exigir sesión y MUST devolver el detalle solo si la reserva pertenece al cliente de la sesión. Si el `id` no tiene formato de uuid, no existe o es de otro cliente, MUST responder `404` con el mismo mensaje, sin distinguir los casos. El detalle MUST incluir el pago asociado (concepto, monto, método, estado, `motivo_rechazo` y la ruta `/api/comprobantes/:pagoId` cuando hay comprobante), pero MUST NOT incluir datos de otro cliente ni el equipo. Un administrador sin ser el dueño MUST recibir `404` en esta ruta (el acceso del administrador es por `/api/admin`).

#### Scenario: Reserva propia

- **WHEN** el cliente abre el detalle de su reserva
- **THEN** responde `200` con el servicio, la dirección, el horario, el precio, las horas gratis y el estado del pago

#### Scenario: Reserva de otro cliente por la URL

- **WHEN** el cliente A abre `GET /api/reservas/<id de una reserva de B>`
- **THEN** responde `404`, igual que para un id inexistente

#### Scenario: Id sin formato de uuid

- **WHEN** se llama a `GET /api/reservas/abc`
- **THEN** responde `404` y no un error de la base de datos

#### Scenario: Sin sesión

- **WHEN** se llama sin sesión
- **THEN** responde `401`

#### Scenario: Administrador que no es el dueño

- **WHEN** un administrador llama a `GET /api/reservas/<id de un cliente>`
- **THEN** responde `404`

### Requirement: Página del perfil y del detalle

`/cuenta` MUST redirigir a `/ingresar?volver=/cuenta` si no hay sesión, y MUST mostrar el estado de la membresía, los avisos, las próximas reservas y el historial. `/cuenta/reservas/[id]` MUST responder la página de "no encontrada" (`404`) cuando la reserva no es del cliente, y para el dueño MUST mostrar el detalle con los botones de reprogramar y cancelar cuando correspondan. Las páginas MUST leer con las mismas funciones que las rutas, sin llamar a su propia API por HTTP. La interfaz MUST seguir la referencia visual de `demo/cuenta.html` sin usar sus datos de ejemplo ni `demo/auth.js`.

#### Scenario: Visitante sin sesión

- **WHEN** alguien abre `/cuenta` sin iniciar sesión
- **THEN** es redirigido a `/ingresar?volver=/cuenta`

#### Scenario: Reserva ajena en la página

- **WHEN** el cliente A abre `/cuenta/reservas/<id de B>`
- **THEN** ve la página de no encontrada y ningún dato de B

#### Scenario: Cliente sin reservas

- **WHEN** el cliente no tiene reservas
- **THEN** las secciones dicen "No tienes limpiezas próximas" y "Aún no tienes historial"

#### Scenario: Sin datos de ejemplo

- **WHEN** se revisan las páginas
- **THEN** no importan nada de `demo/` ni leen `localStorage`
