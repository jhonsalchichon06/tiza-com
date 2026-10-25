## Purpose

Define cómo responde la API de Tiza.com cuando algo sale mal, para que el frontend muestre siempre un mensaje claro en español y nunca exponga detalles técnicos.

## ADDED Requirements

### Requirement: Formato único de error

Toda respuesta de error de la API MUST ser un JSON con la forma `{ "error": { "codigo": string, "mensaje": string } }`, donde `mensaje` es un texto en español apto para mostrar al cliente.

#### Scenario: Error esperado con su código

- **WHEN** una ruta de la API rechaza una petición por un motivo conocido
- **THEN** la respuesta tiene el código de estado de ese motivo y un cuerpo con `error.codigo` y `error.mensaje`

#### Scenario: Respuesta correcta sin cambios

- **WHEN** una ruta de la API termina sin error
- **THEN** su respuesta se entrega tal cual, sin envolverla en el formato de error

### Requirement: Códigos de estado estándar

La API MUST usar `401` sin sesión, `403` sin permiso, `404` si el recurso no existe o no pertenece al usuario, `409` ante un conflicto, `422` ante datos inválidos, `503` si el servicio no está disponible y `500` ante un error inesperado.

#### Scenario: Cada motivo con su código

- **WHEN** una ruta rechaza una petición por falta de sesión, falta de permiso, recurso inexistente, conflicto, datos inválidos o servicio no disponible
- **THEN** responde `401`, `403`, `404`, `409`, `422` o `503` respectivamente, con el formato único de error

#### Scenario: Ruta inexistente

- **WHEN** se llama a una ruta bajo `/api` que no existe, con cualquier método
- **THEN** la respuesta es `404` con el formato único de error

### Requirement: Errores inesperados ocultos

Ante un error no previsto, la API MUST responder `500` con un mensaje genérico, sin incluir el mensaje original, nombres de tablas ni trazas, y MUST registrar el detalle completo en los logs del servidor.

#### Scenario: Error interno de la base de datos

- **WHEN** una ruta falla con un error inesperado cuyo mensaje menciona una tabla de la base
- **THEN** el cliente recibe `500` con un mensaje genérico que no contiene el nombre de la tabla
- **AND** el error original queda registrado en los logs

### Requirement: Un reintento ante la base de datos dormida

Cuando una operación falla por un error de conexión con la base (por ejemplo, porque Neon despierta tras la inactividad), el servidor MUST reintentarla una sola vez. Si el reintento también falla por conexión, MUST responder `503` con el mensaje "Inténtalo en unos segundos".

#### Scenario: La base despierta al segundo intento

- **WHEN** el primer intento falla por un error de conexión y el segundo tiene éxito
- **THEN** el cliente recibe la respuesta correcta, sin ver el fallo

#### Scenario: La base sigue sin responder

- **WHEN** el primer intento y el reintento fallan por error de conexión
- **THEN** el cliente recibe `503` con el mensaje "Inténtalo en unos segundos"

#### Scenario: Un error de datos no se reintenta

- **WHEN** una operación falla por una regla de los datos (por ejemplo, una clave duplicada o una restricción)
- **THEN** la operación no se reintenta y el error sigue su curso normal
