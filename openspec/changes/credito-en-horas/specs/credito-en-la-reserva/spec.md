## Purpose

Define cómo se descuenta el crédito en horas al reservar: aplicación automática por vencimiento, bloqueo contra uso doble, reserva cubierta sin comprobante y cotización con crédito (PRD, "Alcance" punto 4; ADR 0008, 0009 y 0012).

## ADDED Requirements

### Requirement: Aplicación automática del crédito

Al crear una reserva de miembro, el servidor MUST bloquear con `SELECT ... FOR UPDATE` (en orden de `id`) los lotes del cliente con `vence_en > now()` y horas disponibles mayores que 0, MUST calcular el servicio con `creditoHoras` igual a su suma, aplicando primero las horas gratis y después el crédito (`calcularServicio`), y MUST repartir las horas aplicadas empezando por el lote que vence antes (desempate por `id`). Cada reparto MUST crear un uso `reservado` y restar de `horas_disponibles` en la misma transacción. El cliente MUST NOT elegir el crédito ni enviar horas de crédito en el cuerpo. El lote MUST estar vigente al **crear** la reserva; si vence entre la creación y el servicio, el uso se mantiene. El crédito MUST NOT usarse sin la comprobación de membresía vigente en la fecha del servicio que ya hace la reserva de miembro.

#### Scenario: Se descuenta del lote que vence antes

- **WHEN** el cliente tiene un lote de 2 horas que vence en 10 días y otro de 3 horas que vence en 40, y reserva un servicio de 4 horas
- **THEN** se usan las 2 horas del primero y 2 del segundo, quedan 1 hora en el segundo, y el monto cubre solo las horas restantes

#### Scenario: Primero las horas gratis y después el crédito

- **WHEN** una primera limpieza de 5 horas conservada tras una cancelación tiene 3 horas gratis y el cliente tiene 2 horas de crédito
- **THEN** `horas_gratis_aplicadas` es 3, `credito_aplicado` es 2 y el monto es 0

#### Scenario: El monto refleja solo las horas por pagar

- **WHEN** el cliente tiene 1 hora de crédito y reserva una estándar de 4 horas (S/ 129) sin horas gratis
- **THEN** `credito_aplicado` es 1, el monto es S/ 129 ÷ 4 × 3 × 0,9 = S/ 87,08 y el pago lo cubre un comprobante por ese monto

#### Scenario: Un lote vencido no se aplica

- **WHEN** el único lote venció hace un minuto
- **THEN** `credito_aplicado` es 0 y no se crea ningún uso

#### Scenario: Vence entre la reserva y el servicio

- **WHEN** el lote estaba vigente al crear la reserva y vence antes de la fecha del servicio
- **THEN** el uso se mantiene y la reserva conserva su crédito

#### Scenario: Más crédito que horas

- **WHEN** el cliente tiene 6 horas de crédito y reserva un servicio de 3 horas
- **THEN** se usan 3 horas y quedan 3 en los lotes

#### Scenario: Dos reservas simultáneas

- **WHEN** dos peticiones del mismo cliente intentan usar a la vez un lote de 4 horas para servicios de 4 horas
- **THEN** una usa las 4 horas y la otra ve `horas_disponibles` en 0 y no aplica crédito; ninguna hora se usa dos veces y ningún lote queda con horas negativas

#### Scenario: Membresía vencida

- **WHEN** el cliente tiene crédito vigente pero su membresía venció
- **THEN** no puede reservar (la comprobación de vigencia de la reserva de miembro falla antes de tocar el crédito) y su saldo no cambia

### Requirement: Reserva cubierta sin comprobante

Cuando `horas_cobrar` es 0 (las horas gratis y el crédito cubren todo el servicio), la reserva MUST crearse `confirmada`, sin `expira_en`, sin pedir comprobante, vinculada a un pago interno creado por `crearPagoInterno` (concepto `reserva`, método `credito`, monto 0, estado `aprobado`), y sus usos MUST quedar `consumido`. Un comprobante enviado de más MUST ignorarse y no guardarse. Cuando queda algo por pagar y no hay comprobante, la ruta MUST responder `422` con el mensaje de comprobante obligatorio y deshacer todo (usos y descuentos incluidos). Con cobertura parcial, el pago MUST ser de concepto `reserva` por el monto restante, con método Yape o transferencia y comprobante, la reserva `pendiente` con `expira_en` a 24 horas y los usos `reservado`. La regla de una sola reserva en espera por cliente sigue valiendo.

#### Scenario: Cubierta por completo

- **WHEN** el cliente tiene 4 horas de crédito y reserva un servicio de 4 horas sin enviar comprobante
- **THEN** responde `201`, la reserva queda `confirmada` sin `expira_en`, el pago interno es `aprobado` de monto 0, los usos quedan `consumido` y el saldo baja 4 horas

#### Scenario: Comprobante de más

- **WHEN** el cuerpo trae un comprobante y el crédito cubre todo
- **THEN** la reserva se confirma y la ruta del comprobante no se guarda en ningún pago

#### Scenario: Cobertura parcial

- **WHEN** el crédito cubre 2 de 4 horas
- **THEN** la reserva queda `pendiente` con `expira_en` a 24 horas, el pago es de concepto `reserva` con el monto de 2 horas y los usos quedan `reservado`

#### Scenario: Falta el comprobante

- **WHEN** queda algo por pagar y el cuerpo no trae comprobante
- **THEN** responde `422`, no se crea ningún pago ni reserva y los lotes conservan sus horas

#### Scenario: Ya hay una reserva en espera

- **WHEN** el cliente tiene otra reserva `pendiente` y reserva con crédito completo
- **THEN** responde `409 en_espera` y no usa crédito

#### Scenario: Sin cupo

- **WHEN** no hay equipo libre para el horario
- **THEN** responde `409`, la transacción se deshace y el crédito no se descuenta

### Requirement: Cotización con crédito

`GET /api/cotizacion` de un miembro MUST leer el saldo vigente del cliente (sin bloquear nada), pasarlo como `creditoHoras` y devolver `credito_disponible`, `credito_aplicado`, `cubierta_por_credito` (verdadero cuando `horas_cobrar` es 0) y el monto resultante. El asistente `/reservar` MUST omitir el paso de pago cuando `cubierta_por_credito` es verdadero y MUST NOT pedir comprobante. La confirmación vuelve a calcular dentro de la transacción: si el crédito cambió entre la cotización y la confirmación, MUST prevalecer el cálculo del servidor.

#### Scenario: Cotización con crédito

- **WHEN** un miembro con 2 horas de crédito cotiza una estándar de 4 horas
- **THEN** la respuesta trae `credito_disponible` 2, `credito_aplicado` 2 y el monto de 2 horas

#### Scenario: Cotización cubierta

- **WHEN** el crédito cubre todo el servicio
- **THEN** `cubierta_por_credito` es verdadero y el asistente confirma sin paso de pago

#### Scenario: Sin sesión o sin crédito

- **WHEN** quien cotiza no tiene crédito vigente
- **THEN** `credito_disponible` es 0 y el resultado es el de #13

### Requirement: Nuevo horario tras una aprobación tardía conserva el crédito

Al crear la reserva del nuevo horario (reutiliza el mismo pago), el servidor MUST volver a tomar los lotes vigentes del cliente por el `credito_aplicado` de la reserva original, con usos `consumido` y el mismo orden por vencimiento, porque ese crédito volvió a su lote cuando la reserva original expiró o fue cancelada por el administrador. Si los lotes vigentes no alcanzan, MUST tomar lo que haya, crear la reserva igual con los montos y `credito_aplicado` copiados del pedido original (para no dejar sin servicio a quien ya pagó) y devolver `credito_faltante_horas` en la respuesta; el administrador MUST poder ver ese faltante en el detalle del pago. La función MUST bloquear los lotes como la reserva normal.

#### Scenario: Se vuelve a tomar el crédito

- **WHEN** la reserva original usó 2 horas de crédito, expiró, el pago se aprobó tarde y los lotes siguen vigentes
- **THEN** la nueva reserva queda `confirmada` con 2 horas de crédito `consumido` y el saldo baja 2 horas

#### Scenario: Sin crédito original

- **WHEN** la reserva original no usó crédito
- **THEN** no se toca ningún lote

#### Scenario: El crédito ya no alcanza

- **WHEN** el cliente gastó el crédito devuelto en otra reserva antes de elegir el nuevo horario
- **THEN** la nueva reserva se crea igual, la respuesta trae `credito_faltante_horas` con las horas que no se pudieron tomar y los lotes no quedan negativos
