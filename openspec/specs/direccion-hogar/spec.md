# direccion-hogar Specification

## Purpose
TBD - created by archiving change direccion-del-hogar. Update Purpose after archive.

## Requirements

### Requirement: Distritos de v1

El sistema MUST ofrecer una lista cerrada con los 9 distritos de v1: Barranco, Jesús María, Lince, Miraflores, San Borja, San Isidro, San Luis, San Miguel y Santiago de Surco. La misma lista MUST ser la que usan el formulario del navegador y la validación del servidor. El sistema MUST NOT atender ni aceptar ningún distrito fuera de ella (PRD, "No alcance").

#### Scenario: La lista tiene los 9 distritos de v1

- **WHEN** se consulta la lista de distritos
- **THEN** contiene exactamente los 9 distritos de v1, incluido San Luis, y no contiene La Molina, Magdalena, Pueblo Libre ni Chorrillos

### Requirement: Campos de la dirección en el navegador

El componente de dirección MUST pedir: distrito (lista cerrada de los 9), calle, avenida o jirón (texto), número de la casa o del edificio (texto), departamento o interior (texto, opcional) y referencias (texto, opcional). El departamento y las referencias MUST estar en campos aparte, marcados como opcionales. El componente MUST NOT cargar mapas, scripts externos ni usar claves de ningún proveedor de mapas. Sus etiquetas y mensajes MUST estar en español de Perú.

#### Scenario: El asistente pide los cinco campos

- **WHEN** se muestra el componente de dirección
- **THEN** hay una lista de distritos con las 9 opciones, un campo de calle, uno de número, uno de departamento o interior y uno de referencias
- **AND** el departamento y las referencias indican que son opcionales

#### Scenario: Sin mapa ni script externo

- **WHEN** se renderiza el componente de dirección
- **THEN** no incluye ningún `<script>`, `<iframe>` ni referencia a Google Maps u otro proveedor de mapas

#### Scenario: Una casa sin departamento

- **WHEN** el cliente deja vacíos el departamento y las referencias
- **THEN** el formulario no exige esos campos y los datos se pueden enviar

### Requirement: Validación de la dirección en el servidor

El servidor MUST validar la dirección y no confiar en la lista del navegador. MUST rechazar con `422` (`ErrorApi.invalido`) y un mensaje claro en español: un distrito que no sea uno de los 9, una calle vacía (o que no deje ningún carácter tras normalizarla) y un número sin ningún dígito. El mensaje MUST nombrar el dato que falta o es inválido. MUST recortar los espacios sobrantes y limitar el largo de cada campo (calle 100, número 20, departamento 30 y referencias 200 caracteres).

#### Scenario: Distrito fuera de los 9

- **WHEN** llega una dirección con distrito "La Molina", aunque el navegador la haya enviado
- **THEN** el servidor responde `422` con un mensaje que pide elegir uno de los distritos atendidos

#### Scenario: Sin distrito

- **WHEN** llega una dirección sin distrito o con el distrito vacío
- **THEN** el servidor responde `422` con un mensaje que pide elegir el distrito

#### Scenario: Calle vacía

- **WHEN** llega una dirección con la calle vacía, solo con espacios o solo con signos (por ejemplo "..")
- **THEN** el servidor responde `422` con un mensaje que pide escribir la calle, avenida o jirón

#### Scenario: Número sin dígitos

- **WHEN** llega una dirección con el número "s/n" o "abc"
- **THEN** el servidor responde `422` con un mensaje que pide escribir un número con al menos un dígito

#### Scenario: Número con letras y dígitos

- **WHEN** llega una dirección con el número "123-A"
- **THEN** la dirección es válida

#### Scenario: Campo demasiado largo

- **WHEN** llega una calle de más de 100 caracteres
- **THEN** el servidor responde `422` con un mensaje que indica que la calle es demasiado larga

### Requirement: Normalización de la calle, el número y el departamento

El servidor MUST normalizar la calle y el departamento así: pasar a minúsculas, quitar las tildes, convertir los signos en espacios (sin cambiar letras ni dígitos), reducir los espacios repetidos y unificar las abreviaturas palabra por palabra: `av` y `avda` → `avenida`; `jr` → `jiron`; `dpto`, `dep`, `depto` y `departamento` → `dpto`; y los símbolos `n°`, `nº` y `#` → `nro`. El número MUST normalizarse con las mismas reglas, sin la palabra `nro` inicial y sin espacios (por ejemplo "N° 123 A" → `123a`). `direccion_normalizada` MUST ser la calle normalizada, un espacio y el número normalizado. El departamento normalizado MUST ser el texto vacío cuando el cliente no escribe departamento. La normalización MUST ser una función pura e idempotente (normalizar un texto ya normalizado no lo cambia).

#### Scenario: Abreviaturas de la calle

- **WHEN** se normalizan "Av. Larco", "AVENIDA LARCO", "avda larco" y "Av Larco"
- **THEN** las cuatro dan `avenida larco`

#### Scenario: Jirón y tildes

- **WHEN** se normalizan "Jr. Junín" y "Jirón Junin"
- **THEN** las dos dan `jiron junin`

#### Scenario: Abreviaturas del departamento

- **WHEN** se normalizan "Dpto 302", "dpto. 302", "Departamento 302", "DEPTO. 302" y "Dep 302"
- **THEN** las cinco dan `dpto 302`

#### Scenario: Símbolo de número

- **WHEN** se normaliza la calle "Calle Los Pinos N° 5" y "Calle Los Pinos # 5"
- **THEN** las dos dan `calle los pinos nro 5`

#### Scenario: Dirección normalizada

- **WHEN** se normaliza la calle "Av. Larco" con el número "123"
- **THEN** `direccion_normalizada` es `avenida larco 123`

#### Scenario: Sin departamento

- **WHEN** el cliente no escribe departamento, o escribe solo espacios
- **THEN** el departamento normalizado es el texto vacío y el departamento original es `null`

#### Scenario: Idempotencia

- **WHEN** se normaliza dos veces cualquier texto de una muestra con tildes, signos, mayúsculas y abreviaturas
- **THEN** el segundo resultado es igual al primero

#### Scenario: Una variante que la normalización no unifica

- **WHEN** se normalizan "Av. Larco 123" y "Larco 123"
- **THEN** las claves del hogar son distintas, porque solo se unifican abreviaturas (ADR 0013); detectar la coincidencia es trabajo del administrador (ítem #11)

### Requirement: Resultado de la dirección y clave del hogar

El módulo MUST devolver, para una dirección válida: el distrito (nombre exacto de la lista); la calle y el número como los escribió el cliente (recortados); el departamento como lo escribió (o `null`); las referencias (o `null`); `direccion_normalizada`; y `departamento_normalizado`. MUST ofrecer una función que devuelva la clave del hogar `(distrito, direccion_normalizada, departamento_normalizado)`. Dos direcciones MUST tener la misma clave cuando coinciden esas tres partes, y las referencias MUST NOT formar parte de la clave. El módulo MUST NOT devolver ni guardar coordenadas ni identificadores de lugar.

#### Scenario: Mismo hogar escrito distinto

- **WHEN** dos cuentas escriben "Av. Larco 123, Dpto 302" y "Avenida LARCO 123, dpto. 302" en Miraflores
- **THEN** las dos claves del hogar son iguales

#### Scenario: Dos departamentos del mismo edificio

- **WHEN** se comparan "Av. Larco 123, Dpto 302" y "Av. Larco 123, Dpto 303" en Miraflores
- **THEN** las claves del hogar son distintas

#### Scenario: Mismo edificio, una casa sin departamento

- **WHEN** se compara "Av. Larco 123" sin departamento con "Av. Larco 123, Dpto 302"
- **THEN** las claves del hogar son distintas

#### Scenario: Mismo texto en otro distrito

- **WHEN** se comparan "Av. Larco 123" en Miraflores y en Barranco
- **THEN** las claves del hogar son distintas

#### Scenario: Las referencias no cambian la clave

- **WHEN** se comparan dos direcciones iguales con referencias distintas ("puerta verde" y sin referencias)
- **THEN** las claves del hogar son iguales

#### Scenario: Se conserva lo que escribió el cliente

- **WHEN** el cliente escribe la calle " Av. Larco " y el departamento "Dpto. 302"
- **THEN** el resultado guarda "Av. Larco" y "Dpto. 302" (recortados) además de sus versiones normalizadas

#### Scenario: Sin coordenadas

- **WHEN** se valida una dirección correcta
- **THEN** el resultado no incluye latitud, longitud ni identificador de lugar
