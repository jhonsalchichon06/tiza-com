## Purpose

La cotización que muestra el asistente debe coincidir con lo que luego cobra `POST /api/reservas`: si el hogar ya recibió la limpieza gratis, el cliente ve el precio completo (PRD, caso borde 10; ADR 0008). El navegador no recalcula precios.

## ADDED Requirements

### Requirement: La cotización considera la dirección del hogar

`GET /api/cotizacion` MUST aceptar opcionalmente `distrito`, `calle`, `numero` y `departamento`. Si llega alguno de `distrito`, `calle` o `numero`, el servidor MUST validar la dirección con `validarDireccion` (`422` con su mensaje si no es válida) y MUST decidir `aplica_gratis` con la misma `decidirLimpiezaGratis` que usa `POST /api/reservas`. Sin dirección, MUST decidir solo con la regla del cliente. La respuesta MUST incluir `aplica_gratis` y `motivo_sin_gratis` (`null`, `"cliente"` o `"hogar"`), y el monto y el total MUST calcularse sin horas gratis cuando `aplica_gratis` es falso. La ruta MUST seguir siendo de solo lectura.

#### Scenario: Hogar que ya recibió la limpieza gratis

- **WHEN** un cliente consulta la cotización de una profunda 2/1 con una dirección cuyo hogar ya tiene una reserva gratis viva o realizada
- **THEN** `aplica_gratis` es falso, `motivo_sin_gratis` es `"hogar"`, `horas_gratis_aplicadas` es 0 y `monto` es el precio de lista con el descuento de miembro

#### Scenario: Hogar nuevo

- **WHEN** el hogar no tiene reserva gratis viva ni realizada y el cliente no tiene reservas
- **THEN** `aplica_gratis` es verdadero, `motivo_sin_gratis` es `null` y el monto descuenta las 3 horas gratis

#### Scenario: Cliente que ya tuvo la limpieza gratis

- **WHEN** el cliente ya tiene una reserva viva o realizada
- **THEN** `aplica_gratis` es falso y `motivo_sin_gratis` es `"cliente"`

#### Scenario: Sin dirección

- **WHEN** la consulta no trae ningún dato de dirección
- **THEN** la respuesta mantiene la forma anterior y decide solo por la regla del cliente

#### Scenario: Dirección inválida

- **WHEN** el distrito no es uno de los 9 o el número no tiene ningún dígito
- **THEN** la respuesta es `422` con el mensaje de `validarDireccion` y no se lee ninguna reserva

#### Scenario: Reserva vencida sin marcar

- **WHEN** el hogar solo tiene una reserva gratis `pendiente` con `expira_en` en el pasado
- **THEN** `aplica_gratis` es verdadero

#### Scenario: Solo lectura

- **WHEN** se consulta la cotización
- **THEN** no se escribe ninguna fila ni se marca ninguna reserva como `expirada`
