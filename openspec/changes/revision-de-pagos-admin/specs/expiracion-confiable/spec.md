## ADDED Requirements

### Requirement: Pasada de expiración confirmada
El sistema MUST ofrecer una pasada que marque `expirada` toda reserva `pendiente` con `expira_en` vencido, ejecutada en su propia transacción que se confirma sin depender de otra escritura. Las rutas de lista y detalle de pagos, y cada acción de administración (aprobar, rechazar y cancelar), MUST ejecutarla después de comprobar el rol y antes de leer o abrir su transacción de escritura. Las lecturas MUST seguir usando la condición de reserva activa, de modo que una vencida nunca se muestre como pendiente aunque la pasada no haya corrido.

#### Scenario: La marca sobrevive aunque la acción falle
- **WHEN** hay una reserva `pendiente` vencida y el administrador intenta aprobar un pago inexistente (respuesta `404`)
- **THEN** la reserva vencida queda `expirada` en la base

#### Scenario: La lista persiste la expiración
- **WHEN** el administrador abre `GET /api/admin/pagos` con una reserva vencida sin marcar
- **THEN** después de la respuesta esa reserva está `expirada` en la base

#### Scenario: La pasada también cierra membresías vencidas
- **WHEN** hay una membresía `pendiente` con su único pago rechazado hace más de `reenvio_comprobante_dias` días
- **THEN** la misma pasada la deja `caducada` en la base, dentro de la misma transacción que marca las reservas vencidas

#### Scenario: Una escritura que falla sí deshace la marca (comportamiento previo)
- **WHEN** una transacción de escritura marca una reserva vencida y luego falla con un `409`
- **THEN** la reserva sigue `pendiente` en la base, pero ninguna lectura la cuenta como activa

#### Scenario: Pasada sin trabajo
- **WHEN** no hay reservas vencidas
- **THEN** la pasada no cambia ninguna fila

#### Scenario: No depende del cron
- **WHEN** el cron diario no ha corrido
- **THEN** el administrador ve igualmente el estado correcto de cada reserva

#### Scenario: Neon dormido
- **WHEN** la conexión se corta durante la pasada
- **THEN** se reintenta una vez; si vuelve a fallar, la ruta responde `503` "Inténtalo en unos segundos."
