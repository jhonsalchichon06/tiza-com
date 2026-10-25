## ADDED Requirements

### Requirement: Entrega de una foto con GET /api/fotos/:id
`GET /api/fotos/:id` MUST instanciar `crearRutaEntrega` con un resolvedor propio. MUST exigir sesión (`401`). Un administrador MUST poder ver cualquier foto. El cliente MUST poder ver una foto solo si la reserva a la que pertenece es suya y la ruta guardada está en `fotos/{id de esa reserva}/`; en cualquier otro caso (foto de otro cliente, foto inexistente, id sin formato de uuid, foto sin archivo en Blob) MUST responder `404` con el mismo mensaje, sin leer Blob cuando se niega el permiso. La respuesta MUST devolver la imagen en el cuerpo (nunca redirigir a una URL de Blob) con `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff` y `Content-Disposition: inline`.

#### Scenario: El cliente dueño ve su foto
- **WHEN** el cliente dueño de la reserva abre `GET /api/fotos/<id>`
- **THEN** responde `200` con la imagen en el cuerpo

#### Scenario: El administrador ve cualquier foto
- **WHEN** un administrador abre la foto de cualquier cliente
- **THEN** responde `200` con la imagen

#### Scenario: Foto de otro cliente
- **WHEN** el cliente A abre `GET /api/fotos/<id de una foto de B>`
- **THEN** responde `404`, igual que para un id inexistente, y no se lee Blob

#### Scenario: Sin sesión
- **WHEN** se llama sin sesión
- **THEN** responde `401`

#### Scenario: Id sin formato de uuid
- **WHEN** se llama a `GET /api/fotos/abc`
- **THEN** responde `404` y no un error de la base de datos

#### Scenario: Imagen de 4 MB
- **WHEN** la foto en Blob pesa 4 MB
- **THEN** se entrega completa sin error y sin cabecera `Location`

#### Scenario: Doble comprobación
- **WHEN** la ruta guardada de una foto apunta a la carpeta de otra reserva (dato corrupto) y quien la pide es el cliente dueño
- **THEN** responde `404`

### Requirement: Entrega con las reglas de #8
La entrega MUST reutilizar `entregarImagen`: no se escribe un segundo mecanismo de lectura de Blob ni de cabeceras.

#### Scenario: Reutilización
- **WHEN** se revisa el código de la ruta
- **THEN** solo define el resolvedor `obtenerFoto` y llama a `crearRutaEntrega`
