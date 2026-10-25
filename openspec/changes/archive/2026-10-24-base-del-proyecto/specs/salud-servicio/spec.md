## Purpose

Permite comprobar, tras cada despliegue o ante una falla, que la aplicación de Tiza.com está en pie y llega a su base de datos, sin exponer información sensible.

## ADDED Requirements

### Requirement: Estado del servicio con base de datos disponible

`GET /api/salud` MUST responder `200` con `{ "estado": "ok" }` cuando la aplicación logra ejecutar una consulta en la base de datos. No MUST requerir sesión.

#### Scenario: Todo en orden

- **WHEN** se llama a `GET /api/salud` y la base responde
- **THEN** la respuesta es `200` con `{ "estado": "ok" }`

#### Scenario: Base dormida que despierta

- **WHEN** se llama a `GET /api/salud`, la primera consulta falla por un error de conexión y el reintento tiene éxito
- **THEN** la respuesta es `200` con `{ "estado": "ok" }`

### Requirement: Estado del servicio sin base de datos

Si la base no responde tras el reintento, `GET /api/salud` MUST responder `503` con el formato único de error. La respuesta no MUST incluir la cadena de conexión, el host de la base ni el mensaje original del error.

#### Scenario: Base caída

- **WHEN** se llama a `GET /api/salud` y la base no responde ni en el primer intento ni en el reintento
- **THEN** la respuesta es `503` con el mensaje "Inténtalo en unos segundos"
- **AND** el cuerpo no contiene la cadena de conexión ni el host de la base

### Requirement: Configuración incompleta visible en el servidor

Si falta una variable de entorno obligatoria, el servidor MUST registrar en los logs qué variable falta, y la respuesta al cliente MUST ser un error genérico que no la nombre.

#### Scenario: Falta la cadena de conexión

- **WHEN** se llama a `GET /api/salud` en un despliegue sin `DATABASE_URL`
- **THEN** el cliente recibe `500` con un mensaje genérico
- **AND** los logs del servidor indican que falta `DATABASE_URL`
