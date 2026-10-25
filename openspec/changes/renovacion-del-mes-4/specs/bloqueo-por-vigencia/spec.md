## Purpose

Impide elegir día y hora sin una membresía vigente en la fecha del servicio (PRD, caso borde 6 y "Alcance" punto 2, "Solo miembros"; ADR 0008, "Vigencia"). Una sola función clasifica el estado de la membresía para la disponibilidad y el perfil, y la comparación `inicio < fin` vive en una sola función compartida con la reserva de miembro (#13). Por decisión provisional del PRD (pendiente de confirmar por el negocio), el servicio debe empezar antes del `fin` (también al reprogramar), así que ninguna reserva puede quedar agendada después del `fin` y no hay reservas del mes 3 que resolver: sin pago de renovación solo se bloquea elegir día y hora para reservas nuevas.

## ADDED Requirements

### Requirement: Función única de vigencia para reservar

El servidor MUST tener una función `comprobarVigenciaParaReservar(base, usuarioId, inicioServicio)` que, con el reloj de la base de datos, devuelva uno de: `ok`, `sin_membresia`, `membresia_vencida`, `renovacion_en_revision` o `fuera_de_vigencia`. Considera la membresía `activa` más reciente del cliente. `ok` solo si `fin > now()` y `inicioServicio < fin`. La comparación `inicioServicio < fin` MUST existir en una sola función, la de la reserva de miembro (#13, `validarVigenciaDeMembresia`); esta función MUST reutilizarla y ninguna otra parte del código MUST repetirla. `sin_membresia` MUST significar que el cliente no tiene ninguna membresía `activa` (el flujo de la primera membresía, #9a, no pasa por esta función).

#### Scenario: Servicio dentro de la vigencia

- **WHEN** la membresía vence el 30 de enero y el servicio es el 10 de enero
- **THEN** devuelve `ok`

#### Scenario: Servicio posterior al fin

- **WHEN** la membresía vence el 30 de enero y el servicio es el 2 de febrero
- **THEN** devuelve `fuera_de_vigencia` con la fecha de `fin`

#### Scenario: Servicio justo en el fin

- **WHEN** `inicioServicio` es igual a `fin`
- **THEN** devuelve `fuera_de_vigencia` (el servicio debe empezar antes del `fin`)

#### Scenario: Membresía vencida

- **WHEN** `fin` es anterior a ahora y no hay otra membresía pendiente
- **THEN** devuelve `membresia_vencida`

#### Scenario: Renovación en revisión

- **WHEN** `fin` es anterior a ahora y hay una membresía `pendiente` con el pago `pendiente` o `rechazado` dentro del plazo
- **THEN** devuelve `renovacion_en_revision`

#### Scenario: Reservas ya agendadas no se tocan

- **WHEN** la membresía vence sin pago de renovación
- **THEN** ninguna reserva cambia de estado ni se cancela, porque todas empiezan antes del `fin`; solo se bloquea elegir día y hora para reservas nuevas

#### Scenario: Reloj de la base

- **WHEN** el reloj del servidor adelanta o atrasa un minuto respecto de la base
- **THEN** la decisión de `fin > now()` sigue la de la base

### Requirement: Códigos y mensajes de rechazo

Cuando un flujo traduce el resultado a error MUST usar estos códigos y textos, en español de Perú: `membresia_vencida` con `409` ("Tu membresía venció el {fecha}. Realiza un nuevo pago para seguir reservando."), `renovacion_en_revision` con `409` ("Tu pago de renovación está en revisión. Cuando se apruebe, podrás elegir día y hora.") y `fuera_de_vigencia` con `422` ("Tu membresía vence el {fecha}. Elige una fecha anterior o renueva cuando venza."). Las fechas MUST salir en la zona de `horario_atencion`.

#### Scenario: Fecha posterior al fin pide renovar

- **WHEN** se rechaza un servicio posterior al `fin`
- **THEN** la respuesta es `422 fuera_de_vigencia` y el mensaje menciona renovar

### Requirement: La disponibilidad respeta la vigencia de quien ya es miembro

`GET /api/disponibilidad` MUST aplicar la función anterior cuando el cliente tiene una membresía `activa`: con la membresía vencida o con renovación en revisión MUST responder `409` con el código correspondiente y sin horarios; con una fecha cuyo día completo cae en o después del `fin` MUST responder `422 fuera_de_vigencia`. Para quien no tiene ninguna membresía `activa` (cliente nuevo) MUST NOT cambiar nada. La comprobación definitiva de la hora exacta la hace la reserva del #13 con la misma función.

#### Scenario: Cliente nuevo sin membresía

- **WHEN** un cliente sin membresía consulta la disponibilidad
- **THEN** recibe los horarios como hoy

#### Scenario: Membresía vencida sin pago

- **WHEN** un cliente con la membresía vencida y sin pago aprobado consulta cualquier fecha
- **THEN** recibe `409 membresia_vencida` y ningún horario

#### Scenario: Durante el mes 3, fecha posterior al fin

- **WHEN** a un cliente con la membresía vigente le quedan 10 días y consulta una fecha 20 días adelante
- **THEN** recibe `422 fuera_de_vigencia`

#### Scenario: Fecha dentro de la vigencia

- **WHEN** consulta una fecha anterior al `fin`
- **THEN** recibe los horarios como hoy

#### Scenario: Aprobada la renovación

- **WHEN** el administrador aprueba el pago de renovación
- **THEN** la misma consulta que antes dio `409 membresia_vencida` devuelve los horarios

#### Scenario: Crédito en horas no levanta el bloqueo

- **WHEN** el cliente vencido tiene saldo de crédito en horas
- **THEN** la consulta sigue dando `409 membresia_vencida` (TECH-DESIGN.md: el saldo se ve en el perfil pero no se reserva hasta renovar)

#### Scenario: Sin sesión

- **WHEN** no hay sesión
- **THEN** responde `401`, como hoy

### Requirement: El perfil ofrece reservar solo con vigencia

El perfil MUST ofrecer elegir día y hora (el enlace a reservar como miembro) solo cuando el estado de renovación es `no_aplica` o `por_vencer` y el cliente tiene una membresía `activa` vigente. Con `vencida`, `renovacion_en_revision` o `renovacion_rechazada` MUST ofrecer en su lugar renovar o esperar. Este requisito no crea reservas (las crea #13).

#### Scenario: Vencida

- **WHEN** la membresía está vencida
- **THEN** el perfil no muestra el enlace para elegir día y hora y muestra el botón "Renovar mi membresía"

#### Scenario: Renovación aprobada

- **WHEN** el administrador aprobó la renovación
- **THEN** el perfil muestra de nuevo el enlace para elegir día y hora
