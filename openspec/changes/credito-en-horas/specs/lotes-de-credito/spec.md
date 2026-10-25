## Purpose

Define los lotes de crédito en horas: cuándo se generan, cuántas horas tienen, cuándo vencen y cómo se calcula el saldo, para que lo pagado en una cancelación a tiempo no se pierda y no haya reembolsos en dinero (PRD, "Alcance" punto 4; ADR 0008 y 0012).

## ADDED Requirements

### Requirement: Lotes de crédito con vencimiento propio

El sistema MUST guardar el crédito como lotes en `creditos_horas` (usuario, reserva de origen, horas iniciales, horas disponibles, `vence_en`, fecha de creación) y sus movimientos en `usos_credito` (lote, reserva de destino, horas, estado `reservado`, `consumido` o `devuelto`). La base MUST impedir horas iniciales menores o iguales a 0, horas disponibles negativas o mayores que las iniciales, y horas que no sean múltiplos de 0,5. Un índice único sobre `creditos_horas(reserva_origen_id)` MUST impedir dos lotes por la misma cancelación. El `vence_en` MUST ser `reservas.cancelada_en` más `credito_vence_meses` de `configuracion` (3), calculado con el reloj de la base, nunca con un `3` escrito en el código.

#### Scenario: Un lote por cancelación

- **WHEN** se intenta insertar un segundo lote para la misma reserva de origen
- **THEN** la base lo rechaza por el índice único

#### Scenario: Horas inválidas

- **WHEN** se intenta insertar un lote con 0 horas iniciales, con horas disponibles mayores que las iniciales o con 1,25 horas
- **THEN** la base lo rechaza con un `CHECK`

#### Scenario: El vencimiento es un dato

- **WHEN** `credito_vence_meses` cambia a 2 en `configuracion` y se genera un lote
- **THEN** su `vence_en` es la cancelación más 2 meses sin tocar el código

### Requirement: El saldo se calcula, no se guarda

El saldo del cliente MUST ser la suma de `horas_disponibles` de sus lotes con `vence_en > now()` (reloj de la base). El sistema MUST NOT guardar un saldo aparte ni usar una tarea programada para vencer lotes: un lote vencido deja de contar al leer.

#### Scenario: Saldo de varios lotes

- **WHEN** el cliente tiene un lote vigente con 2 horas disponibles y otro vigente con 1,5
- **THEN** el saldo es 3,5 horas

#### Scenario: Un lote vencido no cuenta

- **WHEN** un lote tiene 3 horas disponibles y `vence_en` un minuto antes de ahora
- **THEN** el saldo no lo incluye

#### Scenario: Justo en el vencimiento

- **WHEN** `vence_en` es igual a ahora
- **THEN** el lote ya no cuenta (la condición es `vence_en > now()`)

### Requirement: Cuándo se genera un crédito

Una función única (`generarCreditoDeCancelacion`) MUST crear el lote de una reserva si y solo si la reserva está `cancelada` con `cancelada_por = 'cliente'`, su pago está `aprobado` y las horas pagadas en dinero son mayores que 0. Las horas MUST ser `horas_trabajo − horas_gratis_aplicadas − credito_aplicado` de la reserva. La función MUST ser idempotente (llamarla otra vez no crea ni modifica nada) y MUST ejecutarse dentro de la transacción que cambia el estado de la reserva o del pago. Una reserva cancelada por el administrador, expirada, rechazada o con el pago `pendiente` o `rechazado` MUST NOT generar crédito.

#### Scenario: Cancelar una limpieza pagada y aprobada

- **WHEN** el cliente cancela, con más de 24 horas de anticipación, una limpieza de 4 horas de trabajo con el pago `aprobado` y sin horas gratis ni crédito
- **THEN** se crea un lote de 4 horas con `vence_en` a los 3 meses de la cancelación y el perfil muestra el saldo y el vencimiento

#### Scenario: Cancelar antes de que se apruebe el pago

- **WHEN** el cliente cancela una reserva cuyo pago está `pendiente`
- **THEN** no se crea ningún lote

#### Scenario: Aprobar después de la cancelación

- **WHEN** el administrador aprueba el pago de una reserva que el cliente ya canceló
- **THEN** el lote se crea en ese momento con el `vence_en` calculado desde la cancelación, no desde la aprobación

#### Scenario: Pago rechazado

- **WHEN** el cliente canceló y el administrador rechaza el pago
- **THEN** no se crea ningún lote

#### Scenario: Cancelada por el administrador

- **WHEN** el administrador cancela una reserva en espera con el comprobante falso y después aprueba su pago por error
- **THEN** no se crea ningún lote y el pago puede usarse para un nuevo horario (aprobación tardía)

#### Scenario: Primera limpieza cancelada

- **WHEN** el cliente cancela una primera limpieza de 5 horas con 3 horas gratis y el pago `aprobado`
- **THEN** el lote es de 2 horas: las 3 horas gratis no pasan a crédito

#### Scenario: Primera limpieza de 3 horas

- **WHEN** el cliente cancela una primera limpieza de 3 horas con 3 horas gratis
- **THEN** no se crea ningún lote (0 horas pagadas)

#### Scenario: Reserva pagada en parte con crédito

- **WHEN** el cliente cancela una reserva de 4 horas que usó 1,5 horas de crédito y tiene el pago `aprobado`
- **THEN** el lote nuevo es de 2,5 horas

#### Scenario: Reserva cubierta con crédito

- **WHEN** el cliente cancela una reserva cubierta por completo con crédito (pago interno de método `credito`)
- **THEN** no se crea un lote nuevo y las horas de crédito vuelven a sus lotes originales (ver `credito-en-transiciones`)

#### Scenario: Cancelar y aprobar a la vez

- **WHEN** el cliente cancela una reserva y el administrador aprueba su pago en el mismo instante, en cualquier orden
- **THEN** existe exactamente un lote con las horas pagadas en dinero

#### Scenario: Idempotente

- **WHEN** la función se llama dos veces para la misma reserva
- **THEN** hay un solo lote y no cambia su `horas_disponibles`

### Requirement: Recuperar las cancelaciones anteriores

La migración MUST rellenar `reservas.cancelada_en` con `actualizada_en` en las reservas ya `canceladas` y MUST generar, con la misma condición que `generarCreditoDeCancelacion` y `ON CONFLICT (reserva_origen_id) DO NOTHING`, los lotes de las cancelaciones del cliente con pago `aprobado` que el ítem #12 dejó sin crédito. Volver a ejecutar esa sentencia MUST NOT crear lotes nuevos.

#### Scenario: Cancelación anterior a este ítem

- **WHEN** existe una reserva cancelada por el cliente con el pago aprobado y sin lote
- **THEN** la sentencia de recuperación crea su lote con `vence_en` desde su fecha de cancelación

#### Scenario: Cancelada por el administrador o con pago pendiente

- **WHEN** la reserva fue cancelada por el administrador o su pago no está aprobado
- **THEN** la recuperación no crea lote

#### Scenario: Segunda ejecución

- **WHEN** la sentencia de recuperación se ejecuta de nuevo
- **THEN** no se crea ni se modifica ningún lote
