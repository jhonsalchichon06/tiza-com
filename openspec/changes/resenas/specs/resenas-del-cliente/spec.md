## ADDED Requirements

### Requirement: Tabla de reseñas con una por limpieza
La base MUST tener la tabla `resenas` con `id`, `reserva_id` (clave foránea a `reservas`, no nula y **única**), `estrellas` (entero con `CHECK` entre 1 y 5), `comentario` (texto no nulo), `estado` (`pendiente`, `aprobada` o `rechazada`, por defecto `pendiente`), `revisada_por` (clave foránea a `usuarios`, opcional), `revisada_en`, `creada_en` y `actualizada_en`. Una `CHECK` MUST exigir que `revisada_por` y `revisada_en` existan cuando el estado no es `pendiente`.

#### Scenario: Segunda reseña de la misma limpieza
- **WHEN** se intenta insertar una segunda fila con el mismo `reserva_id`
- **THEN** la base la rechaza por la clave única, aunque dos peticiones lleguen a la vez

#### Scenario: Estrellas fuera de rango
- **WHEN** se intenta insertar una fila con `estrellas` 0 o 6
- **THEN** la base rechaza la fila

### Requirement: Crear la reseña de una limpieza completada
`POST /api/reservas/:id/resena` MUST exigir sesión (`401`) y `Content-Type: application/json` (`415`), y validar el cuerpo con zod: `estrellas` entero de 1 a 5 y `comentario` de 10 a 500 caracteres después de recortar espacios (`422` con mensaje en español). La reserva MUST buscarse con el `usuario_id` de la sesión en el mismo `WHERE`: un id inexistente, con mal formato o de otro cliente (también si quien llama es administrador) MUST responder el mismo `404`. Dentro de `transaccionDeEscritura`, con la reserva bloqueada, MUST exigir que su estado sea `completada` (`409` para cualquier otro estado, con un mensaje distinto por caso) y que no tenga ya reseña (`409`). La reseña MUST crearse `pendiente` y la respuesta `201` MUST llevar `{ id, estrellas, comentario, estado }`.

#### Scenario: Reseña válida de una limpieza completada
- **WHEN** el cliente dueño de una reserva `completada` envía 5 estrellas y un comentario de 40 caracteres
- **THEN** responde `201` con la reseña en estado `pendiente`

#### Scenario: Reserva no completada
- **WHEN** el cliente envía una reseña para su reserva `confirmada`, `pendiente`, `cancelada` o `expirada`
- **THEN** responde `409` y no se crea ninguna fila

#### Scenario: Segunda reseña
- **WHEN** el cliente envía otra reseña para una reserva que ya tiene una (en cualquier estado)
- **THEN** responde `409` y la primera no cambia

#### Scenario: Dos peticiones simultáneas
- **WHEN** llegan dos `POST` a la vez para la misma reserva
- **THEN** una responde `201`, la otra `409`, y queda una sola fila

#### Scenario: Reserva de otro cliente
- **WHEN** el cliente A envía una reseña para la reserva de B, o usa un id inexistente o `abc`
- **THEN** responde `404` con el mismo mensaje en los tres casos y no se escribe nada

#### Scenario: Estrellas o comentario inválidos
- **WHEN** envía 0 o 6 estrellas, 3.5 estrellas, un comentario de 9 caracteres, uno de 501, o solo espacios
- **THEN** responde `422` nombrando el campo y no se escribe nada

#### Scenario: Sin sesión o sin JSON
- **WHEN** no hay sesión, o el `Content-Type` no es JSON
- **THEN** responde `401` o `415` respectivamente, sin consultar la base

#### Scenario: Neon dormido
- **WHEN** la conexión falla una vez
- **THEN** el servidor reintenta una vez; si vuelve a fallar responde `503` "Inténtalo en unos segundos."

### Requirement: Editar y reenviar la reseña propia
`PUT /api/reservas/:id/resena` MUST aplicar las mismas validaciones de sesión, formato, dueño y cuerpo, y MUST permitir cambiar `estrellas` y `comentario` solo mientras la reseña esté `pendiente` o `rechazada`. Al guardar MUST dejarla `pendiente` y limpiar `revisada_por` y `revisada_en`. Sobre una reseña `aprobada` MUST responder `409`; si la reserva no tiene reseña, `404`. El escrito sobre la fila MUST hacerse con la reserva y la reseña bloqueadas para no pisar una decisión del administrador que ocurra a la vez.

#### Scenario: Reenviar una reseña rechazada
- **WHEN** el cliente edita una reseña `rechazada` con datos válidos
- **THEN** responde `200` y la reseña queda `pendiente`, sin datos de revisión, y vuelve a la cola del administrador

#### Scenario: Editar una pendiente
- **WHEN** el cliente edita su reseña `pendiente`
- **THEN** responde `200` y sigue `pendiente` con los datos nuevos

#### Scenario: Editar una aprobada
- **WHEN** el cliente intenta editar su reseña `aprobada`
- **THEN** responde `409` "Tu reseña ya está publicada y no se puede cambiar." y no se modifica

#### Scenario: El administrador aprueba mientras el cliente edita
- **WHEN** el administrador aprueba la reseña y, a la vez, el cliente la edita
- **THEN** se aplica uno primero y el segundo ve el estado nuevo: o el cliente recibe `409` por estar aprobada, o la aprobación recibe `409` por haber cambiado; nunca se publica un texto que el administrador no vio

#### Scenario: Reseña de otro cliente
- **WHEN** el cliente A edita la reseña de la reserva de B
- **THEN** responde `404`

### Requirement: La reseña en el detalle y el historial del cliente
El detalle de la reserva (`leerDetalleReserva`, `GET /api/reservas/:id` y `/cuenta/reservas/[id]`) MUST incluir `resena` (`{ estrellas, comentario, estado }` o `null`), cargada solo después de comprobar que la reserva es del cliente de la sesión, y `puede_resenar` (verdadero si la reserva está `completada` y no tiene reseña). La página MUST mostrar, para una reserva completada sin reseña, un formulario con estrellas (grupo de botones de opción con etiqueta "N estrellas") y un campo de comentario con contador, ambos con tamaño de letra de 18 px o más y botones de 48 px o más. Con reseña MUST mostrarla con el texto de su estado: `pendiente` "En revisión: aún no se muestra en la web", `aprobada` "Publicada en la web", `rechazada` "No se publicó. Puedes editarla y enviarla de nuevo", y ofrecer editar solo en `pendiente` y `rechazada`. Una reserva no completada MUST NOT mostrar la sección. Cada elemento del historial de `/cuenta` y de `GET /api/perfil` MUST incluir `resena_estado` (`null` si no tiene) y mostrar "Deja tu reseña" con enlace al detalle para las completadas sin reseña. Las respuestas MUST NOT incluir `revisada_por`.

#### Scenario: Completada sin reseña
- **WHEN** el cliente abre el detalle de su reserva completada sin reseña
- **THEN** ve el formulario y `puede_resenar` es verdadero

#### Scenario: Reseña rechazada
- **WHEN** abre el detalle con una reseña `rechazada`
- **THEN** ve su texto, el mensaje "No se publicó. Puedes editarla y enviarla de nuevo" y el formulario cargado con sus datos

#### Scenario: Reseña aprobada
- **WHEN** abre el detalle con una reseña `aprobada`
- **THEN** ve "Publicada en la web" y no ve el formulario de edición

#### Scenario: Reserva no completada
- **WHEN** abre el detalle de una reserva confirmada o cancelada
- **THEN** no ve la sección de reseña

#### Scenario: Reserva de otro cliente
- **WHEN** el cliente A abre el detalle de la reserva de B
- **THEN** responde `404` y no se consulta ninguna reseña de B

#### Scenario: Historial
- **WHEN** el historial tiene una completada sin reseña y otra con reseña pendiente
- **THEN** la primera muestra "Deja tu reseña" con enlace al detalle y la segunda no

#### Scenario: Solo mis reseñas
- **WHEN** A y B tienen reseñas
- **THEN** el detalle y el historial de A nunca incluyen las de B
