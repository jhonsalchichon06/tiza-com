# cuentas-clientes Specification

## Purpose
Permite que un visitante cree su cuenta de cliente en Tiza.com con correo y contraseña, guardando sus datos de contacto y su contraseña de forma segura, como base para reservar y pagar.

## Requirements

### Requirement: Registro con datos válidos

Un visitante MUST poder registrarse con correo, contraseña de al menos 8 caracteres, nombre y celular peruano (9 dígitos que empiezan con 9). Al registrarse, la cuenta MUST quedar con la sesión iniciada.

#### Scenario: Registro correcto

- **WHEN** un visitante se registra con un correo nuevo, una contraseña de 8 o más caracteres, un nombre y el celular `987654321`
- **THEN** la cuenta se crea, la respuesta indica éxito y el visitante queda con la sesión iniciada

#### Scenario: Correo con mayúsculas o espacios

- **WHEN** un visitante se registra con `  Ana@Correo.COM `
- **THEN** la cuenta queda guardada con el correo `ana@correo.com`

### Requirement: Validación de los datos del registro

El registro MUST rechazar con `422` y un mensaje claro en español una contraseña de menos de 8 caracteres, un correo con formato inválido, un nombre vacío o un celular que no tenga 9 dígitos empezando con 9. Ante cualquiera de estos errores no MUST crearse la cuenta.

#### Scenario: Contraseña corta

- **WHEN** un visitante se registra con una contraseña de 7 caracteres
- **THEN** la respuesta es `422` con un mensaje que indica que la contraseña debe tener al menos 8 caracteres
- **AND** no se crea ninguna cuenta

#### Scenario: Celular inválido

- **WHEN** un visitante se registra con el celular `12345678`
- **THEN** la respuesta es `422` con un mensaje sobre el celular y no se crea ninguna cuenta

### Requirement: Un correo, una cuenta

Un correo ya registrado no MUST poder crear una segunda cuenta. El registro MUST responder `409` con un mensaje claro, sin iniciar sesión.

#### Scenario: Correo repetido

- **WHEN** un visitante se registra con un correo que ya tiene cuenta, aunque lo escriba con otras mayúsculas
- **THEN** la respuesta es `409` con un mensaje que indica que ese correo ya tiene una cuenta
- **AND** sigue habiendo una sola cuenta con ese correo

### Requirement: Rol de cliente al registrarse

Toda cuenta creada desde el registro MUST tener rol `cliente`. El registro MUST ignorar cualquier rol que se envíe en la petición.

#### Scenario: Intento de registrarse como administrador

- **WHEN** un visitante envía al registro un campo `rol` con el valor `admin`
- **THEN** la cuenta se crea con rol `cliente`

### Requirement: Contraseña guardada solo como hash

La contraseña MUST guardarse únicamente como hash, nunca en texto plano. Las respuestas de la API no MUST incluir la contraseña ni su hash.

#### Scenario: Revisión de la base

- **WHEN** se consulta en la base de datos la cuenta recién registrada
- **THEN** no aparece la contraseña en texto plano en ninguna columna, sino un hash

#### Scenario: Respuesta sin secretos

- **WHEN** el registro responde con éxito
- **THEN** la respuesta no contiene la contraseña ni su hash
