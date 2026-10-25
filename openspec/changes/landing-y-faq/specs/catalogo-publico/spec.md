## ADDED Requirements

### Requirement: Todo número público sale de la configuración
El contenido de las páginas públicas SHALL calcularse a partir de `configuracion` (leída con la validación existente) y de `calcularServicio`. Los precios, las horas, el descuento, los plazos y el horario de atención MUST NOT estar escritos en el código ni en los textos de las páginas.

#### Scenario: Cambia un precio en los datos
- **WHEN** el precio del nivel 1 de `precios_niveles` pasa de S/ 66 a S/ 70 y la página se regenera
- **THEN** el precio "desde" de la limpieza estándar muestra S/ 70 sin cambiar el código

#### Scenario: Cambia el descuento de miembro
- **WHEN** `descuento_miembro` pasa de 0,1 a 0,2
- **THEN** los textos de la landing y de las preguntas dicen "20%" y ninguno dice "10%"

#### Scenario: Falta un parámetro
- **WHEN** falta una clave de `configuracion` o tiene un valor inválido
- **THEN** la lectura falla nombrando la clave y no se usa ningún valor por defecto

### Requirement: Precio "desde" de cada servicio por tamaño
Para cada tipo (estándar, profunda, mudanza) el catálogo SHALL mostrar el precio de lista del hogar más pequeño que acepta `calcularServicio` (0 dormitorios y 1 baño), sin descuento de miembro ni horas gratis, junto con sus horas de trabajo.

#### Scenario: Valores del diseño
- **WHEN** la configuración tiene los valores del diseño
- **THEN** el estándar muestra S/ 66, la profunda S/ 99 y la mudanza S/ 112,20

### Requirement: Paquetes por horas
El catálogo SHALL listar cada paquete de `paquetes_horas` con sus horas, su precio y su precio por hora, y MUST marcar con "Mejor precio por hora" únicamente al paquete de menor precio por hora. No lleva etiqueta de "más pedido" ni equivalentes sin datos que las respalden.

#### Scenario: Precio por hora con decimales
- **WHEN** el paquete de 4 horas cuesta S/ 129
- **THEN** se muestra "S/ 32,25 por hora" y no un valor redondeado

#### Scenario: Mejor precio por hora
- **WHEN** los paquetes son 3 h S/ 99, 4 h S/ 129, 6 h S/ 189 y 8 h S/ 239
- **THEN** solo el de 8 horas lleva la etiqueta "Mejor precio por hora"

#### Scenario: Descripción derivada de los niveles
- **WHEN** un paquete tiene las mismas horas que un nivel del hogar
- **THEN** su descripción indica qué hogar cubre ese nivel usando los máximos de `niveles_hogar`, y si ningún nivel coincide muestra un texto general sin cifras de hogar

### Requirement: Membresía y beneficios
El catálogo SHALL mostrar la duración de la membresía en meses, las horas gratis, el descuento de miembro y la vigencia del crédito en meses, todos de `configuracion`. MUST NOT incluir el monto de la membresía (ni mensual ni total) ni leer `membresia_precio_mensual`: el monto sigue sin confirmar y se muestra al pagar (ítem #9). El texto MUST decir que el pago es único por adelantado, que la primera limpieza gratis es una por cliente y por hogar, y que la renovación no incluye horas gratis.

#### Scenario: Valores del diseño
- **WHEN** la configuración tiene los valores del diseño
- **THEN** se muestran 3 meses en un solo pago por adelantado, 3 horas gratis y 10% de descuento, y ningún monto de la membresía

#### Scenario: Cambia el monto en los datos
- **WHEN** `membresia_precio_mensual` pasa de S/ 89 a S/ 99
- **THEN** el catálogo no cambia

### Requirement: Formato de montos, horas y horario en español de Perú
Los montos SHALL mostrarse en soles con el prefijo "S/ ", coma decimal y sin decimales cuando son enteros (S/ 66, S/ 193,50). Las horas SHALL singularizarse ("1 hora", "3 horas", "3,5 horas"). El horario SHALL describirse a partir de `horario_atencion` ("lunes a sábado, de 8 am a 6 pm"), y si los días no son consecutivos se listan con "y" antes del último.

#### Scenario: Montos
- **WHEN** se formatean 6600, 19350 y 22005 céntimos
- **THEN** el resultado es "S/ 66", "S/ 193,50" y "S/ 220,05"

#### Scenario: Horario de los datos
- **WHEN** `horario_atencion` tiene días 1 a 6, apertura "08:00" y cierre "18:00"
- **THEN** se describe "lunes a sábado, de 8 am a 6 pm"

#### Scenario: Días no consecutivos
- **WHEN** los días son lunes, miércoles y viernes
- **THEN** se describe "lunes, miércoles y viernes"
