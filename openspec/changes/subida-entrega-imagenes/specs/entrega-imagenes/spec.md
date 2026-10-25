## Purpose

Entrega las imágenes privadas (comprobantes y fotos del servicio) solo a quien tiene permiso, a través de `/api`, sin exponer nunca la tienda de Blob al navegador.

## ADDED Requirements

### Requirement: Permiso para ver un comprobante

Un comprobante MUST poder verlo únicamente el cliente que lo subió y un administrador. El permiso de un comprobante MUST decidirse en el servidor a partir de la sesión y de la carpeta `comprobantes/{usuarioId}/` de su ruta. Cualquier otro acceso, incluido un cliente que pide el comprobante de otro, MUST responder `404` (no `403`, para no revelar que existe). Sin sesión MUST responder `401`.

#### Scenario: El dueño ve su comprobante

- **WHEN** un cliente pide un comprobante cuya ruta está en `comprobantes/{su id}/`
- **THEN** la respuesta es `200` con la imagen

#### Scenario: Un administrador ve cualquier comprobante

- **WHEN** un administrador pide un comprobante de cualquier cliente
- **THEN** la respuesta es `200` con la imagen

#### Scenario: Otro cliente pide un comprobante ajeno

- **WHEN** un cliente pide un comprobante cuya ruta está en la carpeta de otro usuario
- **THEN** la respuesta es `404` y no se lee el archivo de Blob

#### Scenario: Sin sesión

- **WHEN** alguien sin sesión pide un comprobante
- **THEN** la respuesta es `401` con el formato único de errores

### Requirement: Permiso para ver una foto del servicio

Una foto del servicio MUST poder verla un administrador y el cliente dueño de la reserva a la que pertenece. La decisión MUST tomarla un resolvedor de permisos que cada ruta proporciona, porque la relación entre foto, reserva y cliente vive en tablas que construye el ítem 17. Si el resolvedor niega el acceso o el recurso no existe, la respuesta MUST ser `404`.

#### Scenario: El resolvedor permite el acceso

- **WHEN** la ruta de fotos usa un resolvedor que autoriza a este usuario
- **THEN** la respuesta es `200` con la imagen

#### Scenario: El resolvedor niega el acceso

- **WHEN** el resolvedor niega el acceso a este usuario
- **THEN** la respuesta es `404` y no se lee el archivo de Blob

### Requirement: Entrega por `/api` sin exponer la tienda

La entrega MUST leer el archivo desde Blob en el servidor y devolverlo en el cuerpo de la respuesta con el `Content-Type` real, `X-Content-Type-Options: nosniff` y `Cache-Control: private, no-store`. La respuesta MUST NOT contener ni redirigir a una URL directa de la tienda. Una imagen de 4 MB MUST entregarse sin error `413` ni `500`.

#### Scenario: Cabeceras de la entrega

- **WHEN** se entrega una imagen autorizada
- **THEN** la respuesta lleva `Content-Type` igual al del archivo, `X-Content-Type-Options: nosniff` y `Cache-Control: private, no-store`
- **AND** no hay cabecera `Location` ni URL de Blob en el cuerpo

#### Scenario: Imagen del tamaño máximo

- **WHEN** se entrega una imagen de 4 MB
- **THEN** la respuesta es `200` con los 4 MB completos

#### Scenario: El archivo ya no existe en Blob

- **WHEN** el permiso es válido pero el archivo no está en Blob
- **THEN** la respuesta es `404` con el formato único de errores
