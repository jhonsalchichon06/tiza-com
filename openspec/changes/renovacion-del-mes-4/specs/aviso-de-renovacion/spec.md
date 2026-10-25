## Purpose

Avisa al cliente, dentro de su perfil, que su membresía vence o ya venció y qué debe hacer (PRD, "Alcance" punto 8; riesgo "Renovación manual en el mes 4"). No hay correo, SMS ni WhatsApp automático (PRD, "No alcance"). La renovación es otro período de 3 meses (decisión provisional del PRD, pendiente de confirmar por el negocio), así que el aviso se repite cada 3 meses y la ventana de 14 días no necesita acortarse.

## ADDED Requirements

### Requirement: Bloque de renovación calculado al leer

`GET /api/perfil` y la página `/cuenta` MUST incluir un bloque `renovacion` con un `estado` entre `no_aplica`, `por_vencer`, `vencida`, `renovacion_en_revision` y `renovacion_rechazada`. El estado MUST calcularse en cada lectura con el reloj de la base de datos (`fin > now()`), a partir de las membresías y pagos del propio cliente, y MUST NOT guardarse. Un cliente MUST ver solo su propio bloque.

- `por_vencer`: tiene una membresía `activa` con `fin` posterior a ahora y faltan `renovacion_aviso_dias` días o menos. Solo informa; no ofrece pagar.
- `vencida`: su membresía `activa` más reciente tiene `fin` anterior o igual a ahora y no tiene una membresía `pendiente`. Ofrece renovar.
- `renovacion_en_revision`: está `vencida` y tiene una membresía `pendiente` cuyo último pago está `pendiente`.
- `renovacion_rechazada`: está `vencida`, tiene una membresía `pendiente` y su último pago está `rechazado` dentro del plazo de `pagosRechazadosReenviables` (#11).
- `no_aplica`: cualquier otro caso (sin membresía, primera membresía en revisión, membresía vigente fuera de la ventana de aviso).

Una membresía `caducada` MUST NOT contar: si la renovación pendiente se cierra por plazo vencido, el estado vuelve a `vencida`.

#### Scenario: Membresía vigente fuera de la ventana

- **WHEN** a la membresía `activa` le faltan 60 días y `renovacion_aviso_dias` es 14
- **THEN** `renovacion.estado` es `no_aplica` y el perfil no muestra aviso de renovación

#### Scenario: Membresía por vencer

- **WHEN** a la membresía `activa` le faltan 10 días
- **THEN** `renovacion.estado` es `por_vencer`, trae `fin` y `dias_restantes` igual a 10, y el perfil dice "Tu membresía vence el" con la fecha en hora de Lima, "No podrás agendar limpiezas para después de esa fecha. Cuando venza, deberás realizar un nuevo pago para seguir reservando." sin botón de pago

#### Scenario: Membresía vencida

- **WHEN** la membresía `activa` tiene `fin` anterior a ahora y el cliente no tiene otra pendiente
- **THEN** `renovacion.estado` es `vencida`, el perfil dice "Tu membresía venció el" con la fecha, "Realiza un nuevo pago para que tu servicio del mes 4 sea válido." y muestra el botón "Renovar mi membresía" hacia `/cuenta/renovar`

#### Scenario: Se calcula, no se guarda

- **WHEN** nadie escribe en la base entre el último segundo de vigencia y el siguiente
- **THEN** la lectura posterior a `fin` devuelve `vencida` sin que ninguna fila haya cambiado

#### Scenario: Renovación en revisión

- **WHEN** el cliente vencido subió el comprobante de renovación y su pago está `pendiente`
- **THEN** `renovacion.estado` es `renovacion_en_revision` y el perfil dice "Tu pago de renovación está en revisión. Cuando se apruebe, podrás elegir día y hora desde tu perfil." sin botón de renovar

#### Scenario: Renovación rechazada con plazo

- **WHEN** el administrador rechazó el pago de renovación hace 3 días y el plazo es de 7
- **THEN** `renovacion.estado` es `renovacion_rechazada`, el perfil muestra el motivo si existe, los días que quedan y la fecha límite, y ofrece subir otro comprobante con la pantalla de reenvío del #12

#### Scenario: Plazo de reenvío vencido

- **WHEN** el pago de renovación fue rechazado hace 8 días y nadie subió otro
- **THEN** `renovacion.estado` es `vencida` (no ofrece el reenvío) y el cliente puede pagar de nuevo desde `/cuenta/renovar`

#### Scenario: Otro cliente no se mezcla

- **WHEN** otro cliente tiene la membresía vencida
- **THEN** el bloque `renovacion` del primer cliente no cambia

### Requirement: La ventana de aviso es un dato

El número de días del aviso `por_vencer` MUST leerse de `configuracion` (`renovacion_aviso_dias`, entero positivo, `provisional`), MUST NOT escribirse en el código y MUST usarse en el texto del aviso.

#### Scenario: Cambiar la ventana

- **WHEN** `renovacion_aviso_dias` cambia a 7 y a la membresía le faltan 10 días
- **THEN** `renovacion.estado` es `no_aplica`

### Requirement: Una renovación en revisión no se confunde con la primera membresía

El perfil MUST distinguir una membresía `pendiente` de renovación (el cliente tiene además una `activa` vencida) de la primera membresía en revisión. Para la renovación MUST usar los textos de este requisito y MUST NOT ofrecer reservar la limpieza gratis ni mostrar "tu primera limpieza".

#### Scenario: Primera membresía en revisión

- **WHEN** el cliente nuevo tiene una membresía `pendiente` y ninguna `activa`
- **THEN** `renovacion.estado` es `no_aplica` y el aviso de primera membresía del #12 no cambia

### Requirement: Textos grandes y en español de Perú

Los avisos MUST estar en español de Perú, con las fechas en la zona de `horario_atencion` y los montos en soles (`S/`). La interfaz MUST usar letra base de al menos 18 px y botones de al menos 48 px de alto.

#### Scenario: Fecha de vencimiento

- **WHEN** `fin` es el 14 de enero a las 15:30 hora de Lima
- **THEN** el aviso muestra "14 de enero" con la hora de Lima, no la de UTC
