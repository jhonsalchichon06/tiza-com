## ADDED Requirements

### Requirement: Nivel del hogar y horas de trabajo

El sistema MUST calcular las horas de trabajo (de 1 persona) de un servicio por tamaño a partir de los niveles del hogar de `configuracion`. MUST usar el primer nivel cuyos máximos de dormitorios y de baños cubren ambos valores del hogar (un máximo `null` cubre cualquier cantidad). A las horas del nivel MUST sumarle las horas extra del tipo (profunda +1 h, mudanza +2 h). Todo hogar tiene 1 cocina; el cálculo no la cuenta aparte.

#### Scenario: Niveles de la limpieza estándar

- **WHEN** se calcula una limpieza estándar para 0 dormitorios y 1 baño, 1 y 1, 2 y 1, 1 y 2, 2 y 2, 3 y 2, y 5 y 4
- **THEN** las horas de trabajo son 2, 3, 4, 4, 4, 6 y 6, respectivamente

#### Scenario: Horas extra por tipo

- **WHEN** se calcula un hogar de 2 dormitorios y 1 baño en estándar, profunda y mudanza
- **THEN** las horas de trabajo son 4, 5 y 6

#### Scenario: Valores tomados de la configuración

- **WHEN** la configuración recibida cambia las horas del nivel 2 de 3 a 3,5
- **THEN** el resultado para 1 dormitorio y 1 baño en estándar es de 3,5 h, sin cambiar el código

### Requirement: Apoyo extra y horas de agenda

El sistema MUST marcar `requiere_apoyo` cuando el servicio es por tamaño y sus horas de trabajo superan el umbral de apoyo de `configuracion` (6 h). En ese caso `horas_agenda` MUST ser las horas de trabajo × el factor de agenda (0,5), redondeadas hacia arriba al intervalo de horarios (30 min). En los demás casos `horas_agenda` MUST ser igual a las horas de trabajo. Los paquetes por horas MUST NOT llevar apoyo. El apoyo MUST NOT cambiar el precio, las horas gratis ni el crédito, que se cuentan siempre en horas de trabajo.

#### Scenario: Hasta 6 horas no lleva apoyo

- **WHEN** se calcula una profunda de 2 dormitorios y 1 baño (5 h), una mudanza de 2 dormitorios y 2 baños (6 h) y una estándar de 5 dormitorios y 4 baños (6 h)
- **THEN** ninguna requiere apoyo y sus horas de agenda son 5, 6 y 6

#### Scenario: Más de 6 horas lleva apoyo

- **WHEN** se calcula una profunda de 3 dormitorios y 2 baños (7 h) y una mudanza de 3 dormitorios y 1 baño (8 h)
- **THEN** ambas requieren apoyo y sus horas de agenda son 3,5 y 4

#### Scenario: Redondeo hacia arriba al intervalo

- **WHEN** las horas de trabajo con apoyo darían 3,25 h en la agenda (por ejemplo, 6,5 h con factor 0,5)
- **THEN** las horas de agenda son 3,5

#### Scenario: El apoyo no cambia el precio

- **WHEN** se calcula una profunda de 7 h
- **THEN** el precio de lista es el del nivel × 1,5, igual que sin apoyo

#### Scenario: Paquete de 8 horas

- **WHEN** se calcula el paquete por horas de 8 h
- **THEN** no requiere apoyo y sus horas de agenda son 8

### Requirement: Precio de lista

El sistema MUST calcular el precio de lista de un servicio por tamaño como el precio del nivel × el multiplicador del tipo (1, 1,5 o 1,7), y el de un paquete por horas como el precio fijo del paquete en `configuracion`. Los montos MUST manejarse en céntimos enteros, redondeando el resultado al céntimo más cercano.

#### Scenario: Precio por tamaño

- **WHEN** se calcula un hogar de 2 dormitorios y 1 baño en estándar, profunda y mudanza
- **THEN** el precio de lista es S/ 129,00, S/ 193,50 y S/ 219,30

#### Scenario: Nivel mínimo

- **WHEN** se calcula una estándar de 0 dormitorios y 1 baño
- **THEN** el precio de lista es S/ 66,00

#### Scenario: Paquetes por horas

- **WHEN** se calculan los paquetes de 3, 4, 6 y 8 h
- **THEN** los precios de lista son S/ 99, S/ 129, S/ 189 y S/ 239, y sus horas de trabajo y de agenda son iguales a las del paquete

### Requirement: Descuento de miembro

El sistema MUST aplicar el descuento de miembro de `configuracion` (10%) al monto a pagar de toda reserva, porque toda reserva exige una membresía. Sin horas gratis ni crédito, el monto MUST ser el precio de lista con el descuento.

#### Scenario: Limpieza de un miembro

- **WHEN** se calcula una estándar de 2 dormitorios y 1 baño sin horas gratis ni crédito
- **THEN** el monto es S/ 116,10 y el descuento es S/ 12,90

#### Scenario: Descuento distinto en la configuración

- **WHEN** la configuración recibida tiene un descuento de 0,2
- **THEN** el monto de la misma limpieza es S/ 103,20

### Requirement: Horas gratis de la primera limpieza

Cuando la entrada indica que aplica la limpieza gratis, el sistema MUST descontar de las horas a cobrar las horas gratis de `configuracion` (3 h), sin superar las horas de trabajo del servicio. Las horas a cobrar MUST valer `horas_trabajo − horas_gratis_aplicadas − crédito_aplicado` y nunca menos de 0. El monto MUST ser `precio_lista ÷ horas_trabajo × horas_a_cobrar × (1 − descuento)`, redondeado al céntimo. Decidir si corresponde la limpieza gratis NO es parte de este cálculo: llega como dato de entrada.

#### Scenario: Profunda con horas adicionales

- **WHEN** se calcula una profunda de 2 dormitorios y 1 baño (5 h, S/ 193,50) con la limpieza gratis
- **THEN** las horas gratis aplicadas son 3, las horas a cobrar son 2 y el monto es S/ 69,66

#### Scenario: Estándar de 3 horas

- **WHEN** se calcula una estándar de 1 dormitorio y 1 baño (3 h) con la limpieza gratis
- **THEN** las horas a cobrar son 0 y el monto es S/ 0,00

#### Scenario: Paquete de 3 horas

- **WHEN** se calcula el paquete de 3 h con la limpieza gratis
- **THEN** el monto es S/ 0,00

#### Scenario: Servicio más corto que las horas gratis

- **WHEN** se calcula una estándar de 0 dormitorios y 1 baño (2 h) con la limpieza gratis
- **THEN** las horas gratis aplicadas son 2, no 3, y el monto es S/ 0,00

#### Scenario: Apoyo extra con horas gratis

- **WHEN** se calcula una profunda de 3 dormitorios y 2 baños (7 h, S/ 283,50) con la limpieza gratis
- **THEN** las horas a cobrar son 4 (de trabajo, no de agenda) y el monto es S/ 145,80

#### Scenario: Sin limpieza gratis

- **WHEN** la entrada indica que no aplica la limpieza gratis
- **THEN** las horas gratis aplicadas son 0

### Requirement: Crédito en horas aplicado

Cuando la entrada trae horas de crédito disponibles, el sistema MUST aplicar primero las horas gratis y después el crédito, usando como máximo las horas de trabajo que aún quedan por cobrar. MUST devolver `credito_aplicado` (nunca más que el disponible) y descontar esas horas de las horas a cobrar. Calcular el saldo y elegir los lotes NO es parte de este cálculo.

#### Scenario: Crédito parcial

- **WHEN** se calcula una estándar de 4 h (S/ 129) con 3 h de crédito
- **THEN** el crédito aplicado es 3, las horas a cobrar son 1 y el monto es S/ 29,03

#### Scenario: Crédito que cubre todo

- **WHEN** se calcula una estándar de 4 h con 6 h de crédito
- **THEN** el crédito aplicado es 4, las horas a cobrar son 0 y el monto es S/ 0,00

#### Scenario: Horas gratis antes que crédito

- **WHEN** se calcula una profunda de 5 h con la limpieza gratis y 1 h de crédito
- **THEN** las horas gratis aplicadas son 3, el crédito aplicado es 1, las horas a cobrar son 1 y el monto es S/ 34,83

### Requirement: Resultado completo y sin efectos secundarios

El cálculo MUST ser una función pura: no MUST leer la base, la hora ni variables de entorno, y MUST recibir la configuración como argumento. MUST devolver, para que el llamador los guarde como copia de lo cobrado: `horas_trabajo`, `horas_agenda`, `requiere_apoyo`, `precio_lista`, `horas_gratis_aplicadas`, `credito_aplicado`, `horas_cobrar`, `descuento` y `monto`, todos los montos en céntimos, y el número de nivel (vacío en un paquete). El monto MUST ser igual al subtotal sin descuento menos el `descuento`.

#### Scenario: Misma entrada, mismo resultado

- **WHEN** se llama dos veces con la misma configuración y entrada
- **THEN** los resultados son iguales y no se consulta ninguna fuente externa

#### Scenario: Consistencia del monto

- **WHEN** se calcula cualquier combinación válida
- **THEN** `monto` es un entero en céntimos, no es negativo y es igual al subtotal sin descuento menos `descuento`

### Requirement: Validación de la entrada

El sistema MUST rechazar con un error `422` del formato único de la API (`ErrorApi.invalido`) una entrada con tipo desconocido, dormitorios que no sean un entero mayor o igual a 0, baños que no sean un entero mayor o igual a 1, o un paquete cuya duración no exista en `configuracion`. MUST rechazar horas de crédito negativas o que no sean múltiplo de 0,5, igual que las demás horas de la configuración.

#### Scenario: Cero dormitorios permitido

- **WHEN** se calcula una estándar con 0 dormitorios y 1 baño
- **THEN** el cálculo se completa

#### Scenario: Hogar sin baños

- **WHEN** se calcula un servicio con 0 baños
- **THEN** falla con `422` y un mensaje claro

#### Scenario: Cantidades no enteras o negativas

- **WHEN** se calcula un servicio con 1,5 dormitorios o con -1 dormitorios
- **THEN** falla con `422`

#### Scenario: Paquete inexistente

- **WHEN** se pide un paquete de 5 h
- **THEN** falla con `422` y un mensaje que indica que ese paquete no existe

#### Scenario: Crédito inválido

- **WHEN** las horas de crédito son -1 o 1,3
- **THEN** falla con `422`

#### Scenario: Tipo desconocido

- **WHEN** el tipo no es estándar, profunda, mudanza ni paquete
- **THEN** falla con `422`
