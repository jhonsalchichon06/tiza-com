## ADDED Requirements

### Requirement: Coincidencias de dirección para el administrador
El detalle de un pago cuya membresía tiene una reserva con `primera_gratis` MUST incluir las coincidencias de esa reserva: las otras reservas con `primera_gratis` del mismo distrito, de otro cliente, que estén `confirmada`, `completada` o `pendiente` vigente, y que cumplan una de estas relaciones, ordenadas de la más cercana a la menos cercana: `misma_direccion` (misma dirección normalizada y mismo departamento normalizado), `otro_departamento` (misma dirección normalizada y otro departamento) o `calle_parecida` (mismo número y una calle parecida, sin ser la misma dirección). Cada coincidencia MUST traer el nivel, el nombre del cliente, el distrito, la calle, el número y el departamento tal como los escribió, el estado y el inicio del servicio. Un pago sin reserva gratis MUST devolver `aplica: false` y ninguna coincidencia. Las coincidencias MUST verse solo por rutas de administrador.

#### Scenario: Misma casa escrita de otra forma
- **WHEN** se revisa la reserva gratis "Larco 123" de Miraflores y otro cliente recibió una gratis en "Av. Larco 123" de Miraflores
- **THEN** el detalle muestra la segunda como `calle_parecida`

#### Scenario: Mismo edificio, otro departamento
- **WHEN** otro cliente tiene una gratis en la misma dirección normalizada con el departamento "402" y la revisada tiene "302"
- **THEN** la coincidencia se muestra como `otro_departamento`

#### Scenario: Otro distrito
- **WHEN** hay una gratis con la misma calle y número en otro distrito
- **THEN** no aparece

#### Scenario: Otro número
- **WHEN** hay una gratis en "Av. Larco 124" y la revisada es "Av. Larco 123"
- **THEN** no aparece

#### Scenario: Calle distinta
- **WHEN** hay una gratis en "Av. Arequipa 123" y la revisada es "Av. Larco 123" en el mismo distrito
- **THEN** no aparece

#### Scenario: Reservas que no cuentan
- **WHEN** la otra gratis está `cancelada`, `expirada` o `pendiente` vencida
- **THEN** no aparece

#### Scenario: No se compara con ella misma ni con el mismo cliente
- **WHEN** la única reserva gratis del distrito es la que se revisa
- **THEN** la lista de coincidencias está vacía y `aplica` es verdadero

#### Scenario: Pago sin limpieza gratis
- **WHEN** el pago corresponde a una membresía cuya reserva no es `primera_gratis`
- **THEN** `aplica` es falso y la lista está vacía

#### Scenario: Pago cuya reserva expiró o se reenvió
- **WHEN** el pago es un reemplazo sin reserva, de una membresía cuya reserva gratis está `expirada`
- **THEN** las coincidencias se calculan con la dirección de esa reserva gratis

### Requirement: Calle parecida
Dos calles MUST considerarse parecidas cuando, normalizadas y sin los tipos de vía (avenida, jirón, calle, pasaje, alameda) ni artículos (de, del, la, las, los, el), sus palabras son las mismas, una está contenida en la otra, o las diferencia como máximo una letra (hasta 8 letras) o dos (más de 8). El número MUST compararse por su primera secuencia de dígitos. Los falsos positivos son aceptables, porque quien decide es el administrador.

#### Scenario: Tipo de vía distinto
- **WHEN** se comparan "Av. Larco" y "Jr. Larco"
- **THEN** son parecidas

#### Scenario: Una dentro de la otra
- **WHEN** se comparan "Javier Prado Este" y "Javier Prado"
- **THEN** son parecidas

#### Scenario: Error de tipeo
- **WHEN** se comparan "Los Pinos" y "Los Pino"
- **THEN** son parecidas

#### Scenario: Calles distintas
- **WHEN** se comparan "Larco" y "Arequipa"
- **THEN** no son parecidas

#### Scenario: Número con letra
- **WHEN** se comparan los números "123" y "123-A"
- **THEN** se consideran el mismo número
