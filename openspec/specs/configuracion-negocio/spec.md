# configuracion-negocio Specification

## Purpose
Guarda los parámetros del negocio de Tiza.com (duraciones, precios, plazos, horario y equipos) como datos en la base, para que cambiarlos no exija un despliegue y para que todos los cálculos usen los mismos valores.

## Requirements

### Requirement: Parámetros iniciales del negocio

La base de datos MUST contener, tras aplicar las migraciones, los parámetros del PRD: los 4 niveles del hogar, las horas adicionales de profunda (1) y mudanza (2), los multiplicadores de precio (1, 1,5, 1,7), los paquetes por horas, el umbral (6 h) y el factor (0,5) del apoyo extra, la membresía y los plazos y horario.

#### Scenario: Niveles del hogar

- **WHEN** se leen los niveles del hogar
- **THEN** son, en orden: 0 dormitorios y 1 baño → 2 h y S/ 66; hasta 1 y 1 → 3 h y S/ 99; hasta 2 y 2 → 4 h y S/ 129; sin máximo → 6 h y S/ 189

#### Scenario: Paquetes por horas

- **WHEN** se leen los paquetes por horas
- **THEN** son 3 h a S/ 99, 4 h a S/ 129, 6 h a S/ 189 y 8 h a S/ 239

#### Scenario: Membresía y beneficios

- **WHEN** se leen los parámetros de la membresía
- **THEN** la membresía cuesta S/ 89 por mes, dura 3 meses y se paga en un solo pago, las horas gratis de la primera limpieza son 3 y el descuento de miembro es 10%

#### Scenario: Plazos y horario

- **WHEN** se leen los plazos y el horario
- **THEN** la anticipación mínima es 48 h, la espera máxima del pago es 24 h, el traslado es 1 h, el intervalo entre horarios de inicio es 30 min, el crédito en horas vence a los 3 meses y la atención es de lunes a sábado de 8:00 a 18:00 en hora de Lima

### Requirement: Valores provisionales identificados

Cada parámetro MUST indicar si es provisional. Los que el PRD tiene pendientes de confirmar (precio de la membresía, precios de los niveles y de los paquetes, y multiplicadores de precio) MUST quedar marcados como provisionales; los demás, como confirmados.

#### Scenario: Precio de la membresía provisional

- **WHEN** se consulta el parámetro del precio de la membresía
- **THEN** está marcado como provisional

#### Scenario: Plazo confirmado

- **WHEN** se consulta la anticipación mínima
- **THEN** está marcada como confirmada, no provisional

### Requirement: Lectura validada sin valores por defecto

Al leer un parámetro, el servidor MUST validar su forma. Si el parámetro no existe o su valor no tiene la forma esperada, la lectura MUST fallar con un error que nombre el parámetro; nunca MUST usar un valor por defecto escrito en el código.

#### Scenario: Parámetro faltante

- **WHEN** se lee un parámetro que no existe en la base
- **THEN** la lectura falla con un error que nombra ese parámetro

#### Scenario: Valor con forma inválida

- **WHEN** se lee un parámetro cuyo valor guardado no tiene la forma esperada (por ejemplo, un texto donde se espera un número)
- **THEN** la lectura falla con un error que nombra ese parámetro

#### Scenario: Cambio de un parámetro sin desplegar

- **WHEN** se actualiza el valor de un parámetro en la base
- **THEN** la siguiente lectura devuelve el valor nuevo, sin cambiar ni desplegar el código

### Requirement: Equipos iniciales

La base de datos MUST contener 2 equipos activos tras aplicar las migraciones. Aumentar la capacidad MUST consistir en agregar un equipo, sin cambiar el esquema.

#### Scenario: Capacidad inicial

- **WHEN** se consultan los equipos activos tras la primera migración
- **THEN** hay exactamente 2

#### Scenario: Nombres únicos

- **WHEN** se intenta agregar un equipo con el nombre de uno que ya existe
- **THEN** la base lo rechaza

### Requirement: Extensión para rangos de tiempo disponible

La base de datos MUST tener habilitada la extensión `btree_gist` tras aplicar las migraciones, para que los ítems siguientes puedan definir restricciones de exclusión por equipo sobre rangos de tiempo.

#### Scenario: Extensión habilitada

- **WHEN** se consultan las extensiones instaladas tras aplicar las migraciones
- **THEN** `btree_gist` aparece entre ellas
