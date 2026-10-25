## ADDED Requirements

### Requirement: Landing pública en la raíz
La ruta `/` SHALL servir la landing sin pedir sesión, en español de Perú, con las secciones: promoción de las horas gratis, cabecera, hero con formulario de inicio, franja de medios de pago y horario, cómo funciona, servicios por tamaño, paquetes por horas, Tiza Club, distritos, preguntas frecuentes, llamada final y pie.

#### Scenario: Visitante sin cuenta
- **WHEN** un visitante sin sesión abre `/`
- **THEN** recibe `200` con todas las secciones, sin redirigirlo al inicio de sesión

#### Scenario: Visitante con sesión
- **WHEN** un cliente con sesión abre `/`
- **THEN** ve la misma página y el enlace "Ingresar" de la cabecera lo lleva a `/cuenta` por la redirección existente de `/ingresar`

### Requirement: Solo los 9 distritos de v1
El selector del hero y la sección de distritos SHALL listar exactamente los 9 distritos de v1 tomados de la lista única de distritos, y MUST NOT mencionar ningún otro.

#### Scenario: Lista de distritos
- **WHEN** se genera la landing
- **THEN** aparecen Barranco, Jesús María, Lince, Miraflores, San Borja, San Isidro, San Luis, San Miguel y Santiago de Surco, y no aparecen La Molina, Magdalena, Pueblo Libre ni Chorrillos

### Requirement: Enlaces a la reserva
El formulario del hero SHALL enviar por GET a `/reservar` el distrito elegido (opcional) y el tipo de servicio; los servicios y paquetes SHALL enlazar a `/reservar` con `tipo` (y `horas` en los paquetes), y los botones de membresía con `club=1`. El formulario MUST funcionar sin JavaScript. La ruta `/reservar` la crea el ítem #9; este cambio no la crea.

#### Scenario: Formulario del hero
- **WHEN** el visitante elige Miraflores y "Limpieza profunda" y envía el formulario
- **THEN** el navegador va a `/reservar?distrito=Miraflores&tipo=profunda`

#### Scenario: Paquete de 6 horas
- **WHEN** el visitante pulsa el paquete de 6 horas
- **THEN** va a `/reservar?tipo=horas&horas=6`

### Requirement: Sin testimonios inventados
La landing MUST NOT mostrar las reseñas ni los testimonios de ejemplo de la demo, ni ninguna cita atribuida a un cliente, hasta que el ítem de reseñas publique reseñas aprobadas. Tampoco la sección ni su enlace en el menú.

#### Scenario: Ausencia de opiniones
- **WHEN** se genera la landing
- **THEN** el HTML no contiene "Cliente de ejemplo", "Lo que dicen nuestros clientes" ni "Testimonios de ejemplo"

### Requirement: Textos respaldados por el PRD
La landing MUST NOT afirmar nada que el PRD no respalde: no habla de "personal verificado", "reprogramación gratis", avisos automáticos de llegada o término, trabajo en la empresa ni correo de contacto inventado. Sí puede decir "personal propio", "cancela o reprograma hasta 24 horas antes" y que las horas pagadas quedan como crédito.

#### Scenario: Frases retiradas
- **WHEN** se genera la landing
- **THEN** el HTML no contiene "verificado", "Reprogramación gratis", "Trabaja con nosotros" ni "hola@tiza.com"

### Requirement: Tiza Club sin monto
La landing SHALL explicar Tiza Club (pago único por adelantado, duración en meses, horas gratis, descuento de miembro y vigencia del crédito) sin mostrar ningún monto de la membresía, ni mensual ni total, mientras el monto no esté confirmado. El monto se muestra en el paso de pago (ítem #9).

#### Scenario: Sin cifras de dinero de la membresía
- **WHEN** se genera la landing
- **THEN** la sección de Tiza Club no contiene "S/ 89", "S/ 267" ni "al mes"

#### Scenario: Cambia el dato
- **WHEN** `membresia_precio_mensual` cambia en `configuracion`
- **THEN** la landing no cambia por ello

### Requirement: WhatsApp solo con número configurado
El botón flotante y el enlace del pie hacia WhatsApp SHALL construirse con la variable `WHATSAPP_NUMERO` y un mensaje prellenado, y MUST NOT existir si la variable falta o no son solo dígitos.

#### Scenario: Con número
- **WHEN** `WHATSAPP_NUMERO` es `51912345678`
- **THEN** el enlace es `https://wa.me/51912345678?text=` con el mensaje codificado

#### Scenario: Sin número
- **WHEN** `WHATSAPP_NUMERO` no está definida
- **THEN** no aparece ningún enlace a `wa.me` y el resto de la página funciona

### Requirement: Aviso de demostración en el pie de las páginas públicas
El pie del layout `app/(publico)/` SHALL mostrar, de forma visible, el aviso de demostración con el texto exacto de `AVISO_DEMOSTRACION` («Sitio de demostración: los pagos son simulados. No hagas ninguna transferencia ni pago real.»), importado de `src/lib/aviso-demo.ts` y sin repetir el texto en el componente. Como el pie está en el layout, el aviso MUST aparecer en todas las páginas públicas (la landing `/` y `/preguntas`) con el mismo texto. Es uno de los tres lugares que fija el PRD ("Alcance", punto 3); los otros dos (paso de pago y reserva enviada) son del asistente de reserva.

#### Scenario: Pie de la landing
- **WHEN** se genera la landing
- **THEN** el HTML del pie contiene el texto exacto «Sitio de demostración: los pagos son simulados. No hagas ninguna transferencia ni pago real.»

#### Scenario: Pie de las preguntas
- **WHEN** se genera `/preguntas`
- **THEN** su pie, que es el mismo del layout, contiene el mismo texto exacto

#### Scenario: Un solo texto
- **WHEN** se busca el texto del aviso en `app/` y `src/`
- **THEN** solo aparece en `src/lib/aviso-demo.ts` y en sus pruebas

### Requirement: Regeneración incremental y fallos
La landing y las preguntas SHALL leer `configuracion` sin cookies ni sesión y regenerarse cada 5 minutos como máximo. Si la regeneración falla, se sigue sirviendo la última versión buena; si no hay ninguna, se muestra un mensaje genérico en español sin detalles internos y el detalle queda en los logs. La lectura SHALL reintentar una vez si Neon está dormido.

#### Scenario: Cambio de precio sin desplegar
- **WHEN** se edita un precio en `configuracion`
- **THEN** la landing lo muestra a más tardar 5 minutos después, sin nuevo despliegue

#### Scenario: Error inesperado
- **WHEN** la lectura falla y no hay versión previa
- **THEN** el visitante ve un mensaje genérico con opción de reintentar y ninguna traza ni nombre de tabla
