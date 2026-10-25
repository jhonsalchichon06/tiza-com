# sesion-usuario Specification

## Purpose
Permite que un cliente o administrador de Tiza.com inicie y cierre sesión con correo y contraseña, con una sesión que el servidor puede revocar, y que el frontend sepa quién tiene la sesión abierta.

## Requirements

### Requirement: Inicio de sesión con correo y contraseña

Una cuenta MUST poder iniciar sesión con su correo (sin importar mayúsculas ni espacios alrededor) y su contraseña. Con credenciales correctas, la respuesta MUST establecer una cookie de sesión `HttpOnly`, `SameSite=Lax`, y `Secure` en producción.

#### Scenario: Credenciales correctas

- **WHEN** una cuenta inicia sesión con su correo y su contraseña
- **THEN** la respuesta indica éxito y establece la cookie de sesión `HttpOnly`

### Requirement: Mensaje genérico ante credenciales incorrectas

Ante un correo inexistente o una contraseña incorrecta, el inicio de sesión MUST responder `401` con el mismo mensaje genérico, de modo que la respuesta no revele si el correo está registrado.

#### Scenario: Contraseña incorrecta

- **WHEN** una cuenta existente intenta iniciar sesión con una contraseña incorrecta
- **THEN** la respuesta es `401` con el mensaje "Correo o contraseña incorrectos." y no se establece la cookie

#### Scenario: Correo no registrado

- **WHEN** alguien intenta iniciar sesión con un correo que no tiene cuenta
- **THEN** la respuesta es `401` con el mismo mensaje y el mismo código que ante una contraseña incorrecta

### Requirement: Sesión guardada en el servidor y revocable

La sesión MUST guardarse en la base de datos. Cerrar sesión MUST invalidarla en el servidor, de modo que la misma cookie deje de servir aunque alguien la haya copiado.

#### Scenario: Cerrar sesión

- **WHEN** un usuario con sesión la cierra
- **THEN** la respuesta borra la cookie de sesión
- **AND** una petición posterior con la cookie anterior se trata como sin sesión

### Requirement: Consulta de la sesión actual

`GET /api/sesion` MUST devolver, con sesión, el id, correo, nombre, celular y rol del usuario, sin la contraseña ni su hash; y `401` sin sesión.

#### Scenario: Con sesión

- **WHEN** un usuario con sesión llama a `GET /api/sesion`
- **THEN** la respuesta es `200` con su id, correo, nombre, celular y rol

#### Scenario: Después de cerrar sesión

- **WHEN** un usuario cierra sesión y luego llama a `GET /api/sesion`
- **THEN** la respuesta es `401` con el formato único de error

### Requirement: Páginas de registro e inicio de sesión

El sitio MUST ofrecer las páginas `/registro` e `/ingresar`, en español, con los errores mostrados junto al formulario sin perder lo escrito. Un usuario que ya tiene sesión y abre cualquiera de las dos MUST ser llevado a `/cuenta`.

#### Scenario: Error visible sin perder datos

- **WHEN** un visitante envía el registro con una contraseña de 7 caracteres
- **THEN** la página muestra el mensaje de error y conserva el correo, el nombre y el celular escritos

#### Scenario: Usuario con sesión

- **WHEN** un usuario con sesión abre `/ingresar`
- **THEN** es llevado a `/cuenta`
