## Purpose

Cada reserva apunta a la membresía que la autoriza y al pago que la confirma, para que al aprobar un pago el sistema sepa qué activar y qué confirmar (ADR 0008), y la base de datos garantice que nadie bloquea horarios sin pagar (ADR 0009).

## ADDED Requirements

### Requirement: Cada reserva tiene membresía y pago

La tabla `reservas` MUST tener las columnas `membresia_id` y `pago_id`, ambas obligatorias y con clave foránea a `membresias` y `pagos`. Esto reemplaza la nota del ítem #6 que decía que `reservas` todavía no las tenía. La migración MUST aplicarse sin pérdida de datos: `reservas` está vacía antes de este ítem.

#### Scenario: Reserva sin membresía o sin pago

- **WHEN** se inserta una reserva con `membresia_id` o `pago_id` vacíos, o que no existen
- **THEN** la base de datos rechaza la fila

#### Scenario: Reserva con membresía y pago existentes

- **WHEN** se inserta una reserva `pendiente` cuyo `membresia_id` y `pago_id` existen
- **THEN** la fila se guarda

### Requirement: Una reserva viva por pago

La base de datos MUST impedir que dos reservas en estado `pendiente`, `confirmada` o `completada` apunten al mismo pago. Una reserva `cancelada` o `expirada` MUST NOT consumir el pago, para que el cliente pueda elegir otro horario con el mismo pago (ADR 0009).

#### Scenario: Dos reservas vivas para el mismo pago

- **WHEN** una reserva `pendiente` ya usa un pago y se inserta otra reserva `pendiente` con ese pago
- **THEN** la base de datos rechaza la segunda por el índice único parcial

#### Scenario: El pago de una reserva expirada se reutiliza

- **WHEN** la reserva de un pago está `expirada` (o `cancelada`) y se inserta otra reserva viva con ese pago
- **THEN** la fila se guarda

### Requirement: Una sola reserva en espera por cliente

La base de datos MUST impedir que un cliente tenga más de una reserva en estado `pendiente` (PRD, "Alcance" punto 5). Las reservas `confirmada`, `completada`, `cancelada` y `expirada` MUST NOT contar para este límite.

#### Scenario: Segunda reserva pendiente del mismo cliente

- **WHEN** un cliente con una reserva `pendiente` recibe otra reserva `pendiente`
- **THEN** la base de datos rechaza la segunda por el índice único parcial

#### Scenario: Pendiente junto a una confirmada

- **WHEN** un cliente con una reserva `confirmada` recibe una `pendiente`
- **THEN** ambas filas se guardan
