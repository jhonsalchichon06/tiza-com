## ADDED Requirements

### Requirement: Cola de reseñas pendientes
`GET /api/admin/resenas` MUST exigir rol de administrador (`401` sin sesión, `403` a un cliente, sin consultar la base) y devolver las reseñas `pendiente` de la más antigua a la más reciente, con `id`, `estrellas`, `comentario`, nombre completo del cliente, distrito, fecha del servicio y fecha de la reseña. La pantalla `/admin/resenas` MUST mostrar la misma lista con el comentario como texto (nunca como HTML) y, si no hay pendientes, "No hay reseñas por revisar". `/admin` MUST enlazar a la pantalla y mostrar cuántas hay por revisar.

#### Scenario: Cola con reseñas
- **WHEN** hay tres reseñas pendientes y una aprobada
- **THEN** la lista trae las tres pendientes, ordenadas de la más antigua a la más reciente, y no la aprobada

#### Scenario: Sin pendientes
- **WHEN** no hay reseñas pendientes
- **THEN** la pantalla dice "No hay reseñas por revisar"

#### Scenario: Cliente o visitante
- **WHEN** un cliente llama a la ruta o abre `/admin/resenas`
- **THEN** la ruta responde `403` y la página redirige a `/cuenta`; un visitante recibe `401` o va a `/ingresar`

#### Scenario: Comentario con HTML
- **WHEN** un comentario contiene `<script>alert(1)</script>`
- **THEN** la pantalla lo muestra como texto escapado

### Requirement: Aprobar o rechazar una reseña
`POST /api/admin/resenas/:id/aprobar` y `POST /api/admin/resenas/:id/rechazar` MUST exigir administrador, validar el id como uuid (si no, `404`) y operar dentro de `transaccionDeEscritura` con la reseña bloqueada. Solo una reseña `pendiente` MUST poder cambiar: aprobar la pone `aprobada` y rechazar `rechazada`, ambas con `revisada_por` (el administrador) y `revisada_en`; si ya no está `pendiente`, `409` con el estado actual (repetir la misma decisión también responde `409`). Una reseña inexistente MUST dar `404`. Rechazar no lleva motivo ni borra la reseña. Al aprobar, la ruta MUST pedir revalidar `/` y `/preguntas`, y un fallo al revalidar MUST NOT deshacer la aprobación.

#### Scenario: Aprobar
- **WHEN** el administrador aprueba una reseña pendiente
- **THEN** responde `200`, queda `aprobada` con su autor y fecha de revisión, y la landing puede mostrarla

#### Scenario: Rechazar
- **WHEN** el administrador rechaza una reseña pendiente
- **THEN** queda `rechazada`, no se muestra en la web y el cliente la ve como "No se publicó"

#### Scenario: Ya revisada
- **WHEN** el administrador aprueba o rechaza una reseña que ya está aprobada o rechazada
- **THEN** responde `409` y no cambia nada

#### Scenario: Dos administradores a la vez
- **WHEN** dos administradores deciden sobre la misma reseña al mismo tiempo
- **THEN** una decisión se aplica y la otra recibe `409`

#### Scenario: Cliente intenta aprobar su reseña
- **WHEN** un cliente llama a la ruta de aprobar
- **THEN** responde `403` y la reseña no cambia

#### Scenario: Falla la revalidación
- **WHEN** la reseña se aprueba y `revalidatePath` lanza un error
- **THEN** la aprobación queda guardada y la respuesta es `200`; la landing se actualiza en el siguiente ciclo de 5 minutos

#### Scenario: Mal formato o inexistente
- **WHEN** el id es `abc` o no existe
- **THEN** responde `404`

#### Scenario: Neon dormido
- **WHEN** la conexión falla una vez
- **THEN** reintenta una vez; si falla otra vez responde `503`
