## Purpose

Define qué hacen con los usos y los lotes de crédito las transiciones de una reserva (confirmar, expirar, rechazar, cancelar, completar, reprogramar), para que un cambio de estado nunca regale ni haga desaparecer horas (ADR 0012; ADR 0009).

## ADDED Requirements

### Requirement: Confirmar consume el crédito

Cuando el administrador aprueba un pago y su reserva `pendiente` pasa a `confirmada`, los usos `reservado` de esa reserva MUST pasar a `consumido` en la misma transacción. Completar una reserva (#16) y reprogramarla (#12) MUST NOT modificar sus usos ni los lotes.

#### Scenario: Aprobar una reserva pagada en parte con crédito

- **WHEN** el administrador aprueba el pago de una reserva con 2 horas de crédito `reservado`
- **THEN** la reserva queda `confirmada` y sus usos `consumido`, y `horas_disponibles` de los lotes no cambia

#### Scenario: Completar y reprogramar

- **WHEN** el administrador marca `completada` una reserva con usos `consumido`, o el cliente la reprograma
- **THEN** los usos siguen `consumido` y los lotes no cambian

#### Scenario: Aprobación tardía

- **WHEN** el administrador aprueba un pago cuya reserva ya está `expirada`
- **THEN** los usos de esa reserva siguen `devuelto` y no se toca ningún lote (el crédito se vuelve a tomar al elegir el nuevo horario)

### Requirement: Expirar devuelve el crédito

`expirarVencidas` MUST devolver, en la misma transacción en que marca `expirada` una reserva, las horas de sus usos `reservado` a su lote original (`horas_disponibles` sube lo que se usó, sin cambiar `vence_en`) y marcar esos usos `devuelto`. Debe ocurrir para toda escritura que llame a `transaccionDeEscritura` y para la pasada de expiración del administrador. Si no hay reservas vencidas, MUST NOT ejecutar sentencias adicionales. Si el lote ya venció, las horas vuelven a él pero siguen sin contar en el saldo.

#### Scenario: Reserva en espera que vence

- **WHEN** una reserva `pendiente` con 2 horas de crédito `reservado` pasa su `expira_en` y cualquier escritura la marca `expirada`
- **THEN** los usos quedan `devuelto` y el lote recupera las 2 horas con su vencimiento original

#### Scenario: Pago rechazado y la espera vence

- **WHEN** el pago de esa reserva fue rechazado y la espera vence
- **THEN** las horas vuelven al lote en ese momento

#### Scenario: La escritura falla después

- **WHEN** la transacción que marcó la expiración falla y se deshace
- **THEN** los usos y los lotes también vuelven a su estado anterior, y la siguiente escritura o la pasada del administrador repite la devolución

#### Scenario: Sin vencidas

- **WHEN** ninguna reserva venció
- **THEN** `expirarVencidas` no ejecuta consultas de crédito

#### Scenario: Lote ya vencido

- **WHEN** el lote venció antes de que la reserva expirara
- **THEN** sus `horas_disponibles` suben pero el saldo del cliente no cambia

### Requirement: Rechazar un pago no toca el crédito

Rechazar un pago MUST NOT modificar usos ni lotes: la reserva sigue `pendiente` hasta su `expira_en` y el cliente puede subir otro comprobante (ADR 0009). Las horas de crédito de esa reserva vuelven cuando expira o cuando se cancela.

#### Scenario: Rechazo con reserva en espera

- **WHEN** el administrador rechaza el pago de una reserva `pendiente` con 2 horas de crédito `reservado`
- **THEN** los usos siguen `reservado` y los lotes no cambian

#### Scenario: Reenvío y aprobación

- **WHEN** el cliente sube otro comprobante dentro del plazo y el administrador lo aprueba
- **THEN** la reserva queda `confirmada` con sus usos `consumido`

### Requirement: Cancelar como cliente

Al cancelar el cliente una reserva (#12), en la misma transacción el servidor MUST: guardar `cancelada_en = now()`; devolver a su lote original las horas de sus usos `reservado` o `consumido` (marcándolos `devuelto`, con el vencimiento original del lote); y llamar a `generarCreditoDeCancelacion`. La respuesta MUST informar `credito` con las horas generadas y su vencimiento y las horas de crédito devueltas. Cancelar de nuevo (idempotente) MUST NOT devolver ni generar nada otra vez.

#### Scenario: Pagada en parte con crédito

- **WHEN** el cliente cancela una reserva de 4 horas pagada con 1,5 horas de crédito y 2,5 pagadas en dinero, con el pago `aprobado`
- **THEN** las 1,5 horas vuelven a su lote original con su vencimiento original y se crea un lote nuevo de 2,5 horas que vence a los 3 meses de la cancelación

#### Scenario: Cancelar y volver a reservar no alarga el vencimiento

- **WHEN** el cliente cancela una reserva que usó horas de un lote que vence en 10 días
- **THEN** esas horas vuelven al mismo lote y siguen venciendo en 10 días

#### Scenario: Cubierta por completo con crédito

- **WHEN** el cliente cancela una reserva confirmada cubierta por completo con crédito
- **THEN** todas las horas vuelven a sus lotes originales y no se crea un lote nuevo

#### Scenario: Pago pendiente

- **WHEN** el cliente cancela una reserva `pendiente` con crédito y el pago sin revisar
- **THEN** las horas de crédito vuelven a su lote de inmediato y las horas pagadas en dinero no generan lote hasta que el administrador apruebe el pago

#### Scenario: Cancelar dos veces

- **WHEN** el cliente repite la cancelación
- **THEN** responde `200` sin devolver ni generar horas por segunda vez

#### Scenario: Mensaje del perfil

- **WHEN** la cancelación genera 2,5 horas de crédito
- **THEN** el perfil dice "Te devolvimos 2,5 horas como crédito. Puedes usarlas hasta el" seguido de la fecha en hora de Lima, y si el pago estaba pendiente dice "Si se aprueba tu pago, las horas quedarán como crédito."

### Requirement: Cancelar como administrador

Al cancelar el administrador una reserva `pendiente` (comprobante falso, #11), el servidor MUST guardar `cancelada_en` y devolver las horas de sus usos `reservado` a sus lotes originales, y MUST NOT generar un lote nuevo.

#### Scenario: Comprobante falso

- **WHEN** el administrador cancela una reserva `pendiente` que usó 2 horas de crédito
- **THEN** las 2 horas vuelven a su lote, el horario queda libre y no se crea lote nuevo

### Requirement: Aprobar un pago de una reserva ya cancelada por el cliente

Al aprobar un pago cuya reserva está `cancelada` con `cancelada_por = 'cliente'`, el servidor MUST llamar a `generarCreditoDeCancelacion` en la misma transacción y MUST NOT confirmar la reserva ni ofrecer un nuevo horario con ese pago.

#### Scenario: Aprobación después de la cancelación

- **WHEN** el cliente canceló con el pago pendiente y el administrador lo aprueba
- **THEN** el lote aparece en ese momento y el perfil no ofrece "Elige un nuevo día y hora" para ese pago

### Requirement: Matriz de transiciones probada

Toda combinación de estado final de la reserva (confirmada, completada, expirada, cancelada por el cliente, cancelada por el administrador) con estado de pago (pendiente, aprobado, rechazado) y con uso de crédito (ninguno, parcial, total) MUST tener una prueba que verifique que la suma de `horas_disponibles` más los usos vivos (`reservado` y `consumido`) es siempre igual a las `horas_iniciales` de los lotes.

#### Scenario: Invariante de horas

- **WHEN** se ejecuta cualquier secuencia de crear, aprobar, rechazar, expirar y cancelar
- **THEN** para cada lote, `horas_disponibles` más las horas de sus usos `reservado` y `consumido` es igual a `horas_iniciales`
