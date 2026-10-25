## ADDED Requirements

### Requirement: Página y sección de preguntas frecuentes
El sistema SHALL ofrecer las preguntas frecuentes como sección `#faq` de la landing y como página pública `/preguntas`, con la misma lista de preguntas. Cada pregunta MUST ser desplegable sin JavaScript.

#### Scenario: Página propia
- **WHEN** un visitante sin sesión abre `/preguntas`
- **THEN** recibe `200` con todas las preguntas y un enlace de vuelta al inicio

#### Scenario: Misma lista
- **WHEN** se comparan la sección de la landing y la página `/preguntas`
- **THEN** tienen las mismas preguntas y respuestas

### Requirement: Contenido fiel a las reglas del PRD
Las respuestas SHALL cubrir, al menos: cómo funcionan las horas gratis; qué incluye la membresía y que no se reembolsa ni se cancela antes de los 3 meses; por tamaño o por horas; cómo se paga (Yape con QR, transferencia con CCI, imagen del comprobante, aprobación del administrador y espera máxima); anticipación mínima y horario; reprogramar o cancelar hasta 24 horas antes con crédito en horas (no dinero); qué pasa al terminar los 3 meses; distritos atendidos; y hogares grandes con una segunda persona de apoyo sin cambio de precio. Las respuestas MUST NOT afirmar notificaciones automáticas, ni mostrar el monto de la membresía (mensual ni total), ni, para la renovación, un monto o una duración (siguen sin definir).

#### Scenario: Horas gratis
- **WHEN** se lee la respuesta sobre las horas gratis
- **THEN** dice que son las primeras 3 horas de la primera limpieza, que las adicionales se pagan con el descuento de miembro, que es una por cliente y por hogar y que la renovación no da otra

#### Scenario: Cancelación
- **WHEN** se lee la respuesta sobre reprogramar o cancelar
- **THEN** dice "hasta 24 horas antes", que las horas pagadas pasan a crédito por 3 meses y que no se devuelve dinero

#### Scenario: Mes 4
- **WHEN** se lee la respuesta sobre qué pasa tras los 3 meses
- **THEN** dice que el perfil avisa, que hay que pagar de nuevo para seguir reservando y que la renovación no es automática, sin mencionar monto

#### Scenario: Membresía sin monto
- **WHEN** se lee la respuesta sobre qué incluye la membresía
- **THEN** dice que son 3 meses en un solo pago por adelantado, y ninguna respuesta contiene "S/ 89" ni "S/ 267"

### Requirement: Respuestas calculadas desde la configuración
Las cifras de las respuestas (horas gratis, descuento, meses de la membresía, vigencia del crédito, espera máxima del pago, anticipación, horario y umbral de apoyo) SHALL salir de `configuracion` mediante el mismo formato del catálogo.

#### Scenario: Cambia la anticipación
- **WHEN** `anticipacion_minima_horas` pasa de 48 a 72
- **THEN** la respuesta de anticipación dice "72 horas" y ninguna dice "48"

#### Scenario: Distritos
- **WHEN** se genera la respuesta sobre cobertura
- **THEN** lista los 9 distritos de v1 y ninguno más
