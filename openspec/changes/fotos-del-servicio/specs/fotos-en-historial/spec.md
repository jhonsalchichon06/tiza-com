## ADDED Requirements

### Requirement: Fotos en el detalle de la reserva del cliente
El detalle de una reserva (`leerDetalleReserva`, `GET /api/reservas/:id` y `/cuenta/reservas/[id]`) MUST incluir las fotos de esa reserva (`id`, `ambiente`, etiqueta) solo después de comprobar que la reserva es del cliente de la sesión, en la misma consulta de dueño de #12. La página MUST mostrarlas agrupadas por ambiente con `<img src="/api/fotos/<id>" loading="lazy">` y un texto alternativo con el ambiente, en el espacio que #12 dejó. Sin fotos, una reserva `completada` MUST decir "Aún no hay fotos de este servicio"; una reserva no completada MUST NOT mostrar la sección. La respuesta MUST NOT incluir `ruta` ni la URL de Blob.

#### Scenario: Reserva completada con fotos
- **WHEN** el cliente abre el detalle de su reserva completada con cinco fotos en dos ambientes
- **THEN** ve las cinco imágenes agrupadas bajo sus dos ambientes

#### Scenario: Sin fotos
- **WHEN** abre una reserva completada sin fotos
- **THEN** ve "Aún no hay fotos de este servicio"

#### Scenario: Reserva no completada
- **WHEN** abre una reserva confirmada o cancelada
- **THEN** no ve la sección de fotos

#### Scenario: Reserva de otro cliente
- **WHEN** el cliente A abre el detalle de una reserva de B
- **THEN** responde `404` y no se consulta ninguna foto de B

#### Scenario: Sin ruta de Blob
- **WHEN** se arma la respuesta del detalle
- **THEN** cada foto trae `id` y `ambiente`, y no `ruta`

### Requirement: Cantidad de fotos en el historial
Cada elemento del historial de `GET /api/perfil` y de `/cuenta` MUST incluir `total_fotos` (conteo solo de reservas del cliente) y, si es mayor que cero, mostrar "N fotos" con el enlace al detalle. MUST NOT cargar las imágenes en la lista.

#### Scenario: Historial con fotos
- **WHEN** una reserva completada tiene 4 fotos
- **THEN** su elemento del historial dice "4 fotos" y enlaza al detalle

#### Scenario: Historial sin fotos
- **WHEN** la reserva no tiene fotos
- **THEN** el elemento no muestra el contador

#### Scenario: Solo mis fotos
- **WHEN** A y B tienen reservas completadas con fotos
- **THEN** el historial de A cuenta solo las fotos de las reservas de A
