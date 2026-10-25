# restablecimiento-contrasena Specification

## Purpose
Permite que una persona con cuenta en Tiza.com recupere el acceso cuando olvida su contraseña, mediante un enlace enviado a su correo que vence rápido y sirve una sola vez.

## Requirements

### Requirement: Solicitud de restablecimiento con respuesta uniforme

`POST /api/sesion/olvide` MUST recibir un correo (sin importar mayúsculas ni espacios alrededor) y responder `200` con el mismo mensaje y la misma forma de respuesta exista o no una cuenta con ese correo. Solo si la cuenta existe, el sistema MUST enviar un correo con el enlace. La respuesta MUST NOT esperar al envío del correo, para que el tiempo de respuesta no revele si la cuenta existe.

#### Scenario: Correo registrado

- **WHEN** alguien solicita el restablecimiento con el correo de una cuenta existente
- **THEN** la respuesta es `200` con el mensaje "Si el correo tiene una cuenta, te enviamos un enlace para restablecer tu contraseña."
- **AND** se envía un correo con un enlace a esa dirección

#### Scenario: Correo no registrado

- **WHEN** alguien solicita el restablecimiento con un correo sin cuenta
- **THEN** la respuesta es `200` con el mismo mensaje
- **AND** no se envía ningún correo

#### Scenario: Correo con formato inválido

- **WHEN** alguien envía un texto que no es un correo
- **THEN** la respuesta es `422` con un mensaje en español

#### Scenario: Cuerpo que no es JSON

- **WHEN** la petición no usa `Content-Type: application/json`
- **THEN** la respuesta es `415` con el formato único de errores

### Requirement: Correo con enlace de restablecimiento

El correo MUST estar en español de Perú, salir del remitente configurado y contener un enlace a `/restablecer?token=<token>` en la URL pública de la aplicación. El correo MUST indicar que el enlace vence en 1 hora y que se puede ignorar si la persona no lo pidió.

#### Scenario: Contenido del correo

- **WHEN** se envía el correo de restablecimiento
- **THEN** su asunto y su cuerpo están en español
- **AND** el cuerpo incluye el enlace a `/restablecer` con el token y el aviso de que vence en 1 hora

### Requirement: Enlace de un solo uso

El enlace MUST funcionar una sola vez. Un segundo uso del mismo token MUST rechazarse con `400` y el código `enlace_invalido`.

#### Scenario: Uso correcto

- **WHEN** alguien envía a `POST /api/sesion/restablecer` un token vigente y una contraseña nueva válida
- **THEN** la respuesta es `200`
- **AND** la cuenta puede iniciar sesión con la contraseña nueva y ya no con la anterior

#### Scenario: Segundo uso del mismo enlace

- **WHEN** alguien reutiliza un token que ya cambió una contraseña
- **THEN** la respuesta es `400` con el código `enlace_invalido`
- **AND** la contraseña no cambia

#### Scenario: Dos usos simultáneos

- **WHEN** llegan dos peticiones a la vez con el mismo token vigente
- **THEN** solo una cambia la contraseña y la otra responde `400` con `enlace_invalido`

### Requirement: Vencimiento a la hora

El enlace MUST dejar de funcionar 1 hora después de enviarse. Un token vencido o inexistente MUST responder igual que un token ya usado.

#### Scenario: Enlace vencido

- **WHEN** alguien usa un token pasada 1 hora desde su envío
- **THEN** la respuesta es `400` con el código `enlace_invalido`
- **AND** la contraseña no cambia

#### Scenario: Token inventado

- **WHEN** alguien envía un token que nunca se emitió
- **THEN** la respuesta es `400` con el código `enlace_invalido`

### Requirement: Token guardado solo como hash

En la base de datos el token MUST existir solo como hash: ninguna fila de `verificaciones` MUST contener el token que viaja en el enlace.

#### Scenario: Fila guardada

- **WHEN** se solicita un restablecimiento para una cuenta existente
- **THEN** la fila de `verificaciones` creada tiene un `identifier` que es el hash del token y no contiene el texto del token enviado por correo

### Requirement: Contraseña nueva válida

La contraseña nueva MUST cumplir las mismas reglas que en el registro: de 8 a 128 caracteres. Si no las cumple, MUST responder `422` con un mensaje en español y el token MUST seguir vigente.

#### Scenario: Contraseña demasiado corta

- **WHEN** alguien envía un token vigente con una contraseña de menos de 8 caracteres
- **THEN** la respuesta es `422` con el mensaje "La contraseña debe tener al menos 8 caracteres."
- **AND** el mismo token todavía puede usarse con una contraseña válida

### Requirement: Cierre de las sesiones abiertas

Al restablecer la contraseña, el sistema MUST cerrar todas las sesiones abiertas de esa cuenta. La respuesta MUST NOT iniciar una sesión nueva: la persona entra después con su contraseña nueva.

#### Scenario: Sesión previa

- **WHEN** una cuenta con una sesión abierta restablece su contraseña
- **THEN** la cookie de la sesión anterior deja de servir y se trata como sin sesión
- **AND** la respuesta de `restablecer` no establece ninguna cookie

### Requirement: Pantallas de recuperación

La aplicación MUST ofrecer `/olvide`, donde se escribe el correo y se muestra el mensaje uniforme, y `/restablecer`, donde se escribe la contraseña nueva usando el token de la URL. La página de inicio de sesión MUST enlazar a `/olvide`. Al restablecer con éxito, la pantalla MUST llevar a iniciar sesión. Con un enlace inválido, la pantalla MUST mostrar un mensaje y un camino para pedir otro enlace.

#### Scenario: Enlace desde el inicio de sesión

- **WHEN** una persona abre `/ingresar`
- **THEN** ve el enlace "¿Olvidaste tu contraseña?" que lleva a `/olvide`

#### Scenario: Enlace inválido en la pantalla

- **WHEN** la persona abre `/restablecer` sin token o el envío responde `enlace_invalido`
- **THEN** la pantalla muestra que el enlace no es válido o venció y ofrece pedir uno nuevo en `/olvide`
