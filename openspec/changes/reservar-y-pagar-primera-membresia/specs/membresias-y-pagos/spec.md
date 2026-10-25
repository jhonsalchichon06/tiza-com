## Purpose

Guarda la membresía de Tiza Club y el pago que la respalda. Los pagos son simulados: el cliente paga por Yape o transferencia fuera del sistema y sube la imagen del comprobante; un administrador lo aprueba o lo rechaza (ítem #11).

## ADDED Requirements

### Requirement: Tabla de membresías

El sistema MUST tener una tabla `membresias` con: usuario, monto pagado en céntimos, estado (`pendiente` o `activa`), inicio y fin, y la fecha de creación. Mientras la membresía está `pendiente`, el inicio y el fin MUST estar vacíos; cuando está `activa`, ambos MUST tener valor y el fin MUST ser posterior al inicio. "Vencida" MUST calcularse (`activa` con fin pasado) y MUST NOT guardarse como estado. El monto MUST ser mayor que cero. La base de datos MUST rechazar con `CHECK` cualquier combinación incoherente de estado, inicio y fin.

#### Scenario: Una membresía pendiente se guarda sin fechas

- **WHEN** se inserta una membresía `pendiente` con inicio y fin vacíos y monto 26700
- **THEN** la fila se guarda

#### Scenario: Una membresía pendiente con fechas se rechaza

- **WHEN** se inserta una membresía `pendiente` con inicio o fin con valor
- **THEN** la base de datos rechaza la fila

#### Scenario: Una membresía activa exige sus fechas

- **WHEN** se inserta una membresía `activa` con inicio o fin vacíos, o con fin igual o anterior al inicio
- **THEN** la base de datos rechaza la fila

#### Scenario: Monto cero o negativo

- **WHEN** se inserta una membresía con monto 0 o negativo
- **THEN** la base de datos rechaza la fila

### Requirement: Una membresía pendiente por cliente

La base de datos MUST impedir que un cliente tenga más de una membresía `pendiente`. Una membresía `activa` MAY coexistir con una `pendiente` de la renovación (ítem #15).

#### Scenario: Segunda membresía pendiente del mismo cliente

- **WHEN** un cliente que ya tiene una membresía `pendiente` recibe otra `pendiente`
- **THEN** la base de datos rechaza la segunda fila por el índice único parcial

#### Scenario: Pendiente junto a una activa

- **WHEN** un cliente con una membresía `activa` recibe una `pendiente`
- **THEN** ambas filas se guardan

### Requirement: Tabla de pagos

El sistema MUST tener una tabla `pagos` con: usuario, concepto (`membresia`, `reserva` o `membresia_y_reserva`), membresía (cuando el concepto la incluye), monto en céntimos, método (`yape`, `transferencia` o `credito`), ruta del comprobante en Blob, estado (`pendiente`, `aprobado` o `rechazado`), administrador que revisó, fecha de revisión y fecha de creación. La base de datos MUST rechazar con `CHECK`: un concepto que incluye la membresía sin `membresia_id`; un método `yape` o `transferencia` sin ruta de comprobante; y un método `credito` con monto distinto de 0. El método `credito` MUST existir en el modelo pero ningún flujo de este ítem lo usa (lo usa el ítem #14). Las imágenes MUST NOT guardarse en la base: solo su ruta.

#### Scenario: Pago de la membresía con su reserva

- **WHEN** se inserta un pago `membresia_y_reserva` con membresía, método `yape`, ruta de comprobante y estado `pendiente`
- **THEN** la fila se guarda

#### Scenario: Concepto de membresía sin membresía

- **WHEN** se inserta un pago `membresia` o `membresia_y_reserva` con `membresia_id` vacío
- **THEN** la base de datos rechaza la fila

#### Scenario: Pago en Yape sin comprobante

- **WHEN** se inserta un pago con método `yape` o `transferencia` y ruta de comprobante vacía
- **THEN** la base de datos rechaza la fila

#### Scenario: Crédito con monto

- **WHEN** se inserta un pago con método `credito` y monto mayor que 0
- **THEN** la base de datos rechaza la fila
