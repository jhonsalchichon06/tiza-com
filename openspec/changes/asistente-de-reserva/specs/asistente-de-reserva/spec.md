## Purpose

La página `/reservar` guía al cliente nuevo por pasos hasta el pago de la membresía y la reserva de su primera limpieza gratis. El estado del asistente vive en el navegador hasta que el cliente confirma; no se guardan borradores (ADR 0005). El navegador muestra lo que calcula el servidor y no recalcula precios (ADR 0008). Consume los endpoints que expone el change `reservar-y-pagar-primera-membresia` (9a): `GET /api/cotizacion`, `GET /api/disponibilidad`, `POST /api/subidas` (ítem #8) y `POST /api/reservas`. Los pagos del PRD son simulados y el sitio lo avisa con el texto fijo del PRD (alcance, punto 3), que el paso de pago y la reserva enviada muestran importándolo de `src/lib/aviso-demo.ts` (creado por 9a).

## ADDED Requirements

### Requirement: Acceso a /reservar

`/reservar` MUST exigir sesión: sin ella MUST redirigir a `/registro` conservando en `volver` la ruta y sus parámetros. Con sesión y sin membresía MUST mostrar el asistente. Con una membresía `pendiente` MUST mostrar, en lugar del asistente, que su pago está en revisión y que elegirá nuevo día y hora cuando se apruebe; con una membresía `activa` MUST mostrar un enlace a su cuenta. La página MUST leer los parámetros `distrito`, `tipo`, `horas` y `club` que envía la landing: `distrito` vacío o que no sea uno de los 9 se trata como ausente; `tipo` válido (`estandar`, `profunda`, `mudanza` o `horas`) preselecciona el servicio, y con `tipo=horas` y un `horas` válido preselecciona el paquete; `club` se acepta y no cambia nada, porque todo cliente nuevo paga la membresía.

#### Scenario: Visitante sin sesión

- **WHEN** alguien sin sesión abre `/reservar?tipo=profunda`
- **THEN** es redirigido a `/registro?volver=` con `/reservar?tipo=profunda` codificado

#### Scenario: Parámetros de la landing

- **WHEN** un cliente nuevo abre `/reservar?distrito=Miraflores&tipo=horas&horas=6&club=1`
- **THEN** el asistente arranca con "por horas", el paquete de 6 horas y el distrito Miraflores ya elegidos

#### Scenario: Parámetros inválidos

- **WHEN** la URL trae `distrito=` vacío, `tipo=otro` o `horas=5`
- **THEN** esos valores se ignoran y el asistente arranca desde el primer paso sin error

#### Scenario: Cliente con pago en revisión

- **WHEN** un cliente con una membresía `pendiente` abre `/reservar`
- **THEN** ve que su pago está en revisión y no se le muestra el asistente

#### Scenario: Cliente que ya es miembro

- **WHEN** un cliente con una membresía `activa` abre `/reservar`
- **THEN** ve un enlace a su cuenta y no se le muestra el asistente

### Requirement: Pasos del servicio y del tamaño

El asistente MUST ofrecer elegir el tipo de servicio (estándar, profunda, mudanza o por horas). Para un servicio por tamaño MUST pedir dormitorios (desde 0) y baños (desde 1); para uno por horas MUST ofrecer los paquetes que devuelve la configuración. Antes de pasar al pago MUST mostrar, con datos de `GET /api/cotizacion`, la duración, el precio de lista, las 3 horas gratis y el aviso de apoyo extra cuando corresponda, sin calcular nada en el navegador. Un valor fuera de rango (dormitorios negativos, baños 0) MUST impedir continuar con un mensaje claro.

#### Scenario: Cero dormitorios

- **WHEN** el cliente elige una estándar con 0 dormitorios y 1 baño
- **THEN** puede continuar y ve 2 horas y S/ 66 de precio de lista

#### Scenario: Cotización del servidor

- **WHEN** el cliente elige una profunda de 2 dormitorios y 1 baño
- **THEN** el resumen muestra 5 horas, S/ 193,50, las 3 horas gratis y S/ 69,66 por las horas adicionales, tal como los devuelve el servidor

#### Scenario: Hogar grande con apoyo

- **WHEN** el cliente elige una profunda de 3 dormitorios y 2 baños
- **THEN** el resumen avisa que va una persona de apoyo y que el precio no cambia

### Requirement: Paso de fecha y hora

El asistente MUST mostrar los días reservables entre la primera y la última fecha que da la cotización, sin domingos, y los horarios del día elegido tomados de `GET /api/disponibilidad`. Los horarios sin cupo o sin la anticipación de 48 horas MUST mostrarse en gris y deshabilitados, y no se pueden seleccionar. Los horarios MUST ser cada 30 minutos y sus horas MUST mostrarse en hora de Lima. Cambiar de día MUST limpiar el horario elegido.

#### Scenario: Horarios en gris

- **WHEN** el cliente elige un día en el que la disponibilidad marca un horario como `sin_cupo` o `anticipacion`
- **THEN** ese horario aparece en gris, deshabilitado, y no se puede elegir

#### Scenario: Sin domingos

- **WHEN** el cliente recorre los días ofrecidos
- **THEN** ningún domingo es seleccionable

#### Scenario: No se ofrecen fechas fuera de la primera membresía

- **WHEN** el cliente avanza hasta el último día ofrecido
- **THEN** no hay días posteriores al límite de 3 meses, y en ese último día los horarios iguales o posteriores al instante límite que da la cotización aparecen en gris y deshabilitados

### Requirement: Paso de dirección

El asistente MUST pedir la dirección con los cinco campos del ítem #7: distrito de la lista cerrada de 9 (preseleccionado si llegó de la landing), calle, número, y, aparte, departamento o interior y referencias, que son opcionales. El navegador no valida el distrito como única defensa ni normaliza: el servidor responde `422` (el formato único de errores no dice qué campo falló) y el asistente MUST mostrar su mensaje junto al botón de confirmar, ofrecer volver al paso de dirección y no perder lo escrito. El asistente MUST NOT pedir nombre ni celular: salen de la cuenta.

#### Scenario: Casa sin departamento

- **WHEN** el cliente deja vacíos el departamento y las referencias
- **THEN** puede continuar

#### Scenario: El servidor rechaza la dirección

- **WHEN** el servidor responde `422` por un número sin dígitos
- **THEN** el asistente muestra el mensaje del servidor, ofrece volver al paso de dirección y conserva todo lo escrito, incluido el comprobante ya subido

### Requirement: Paso de pago

El asistente MUST mostrar el resumen del pago con el monto de la membresía (el total y su detalle: precio mensual por meses, leídos de la cotización), el monto de las horas adicionales cuando lo hay y el total a pagar; MUST ofrecer elegir Yape o transferencia; MUST pedir subir una imagen del comprobante (JPG, PNG o WebP, máximo 5 MB) y explicar que la reserva queda en espera hasta que se revise el pago, por un máximo de 24 horas. Con Yape MUST mostrar la imagen real del código QR de Tiza (`public/pago/yape.jpeg`) con un texto alternativo que diga que es el QR de Yape de Tiza y a nombre de quién está; con transferencia MUST mostrar la CCI de 20 dígitos y el nombre del titular. La ruta de la imagen, la CCI y el titular MUST salir del único módulo de datos de pago que define el change 9a (`src/lib/reservas/datos-de-pago.ts`), no de cada pantalla. El paso de pago MUST mostrar de forma visible el aviso de demostración (`AVISO_DEMOSTRACION`, de `src/lib/aviso-demo.ts`), fijo, junto a los datos de pago (el QR y la CCI), sea cual sea el método elegido y sin letra pequeña ni tras un clic; el texto MUST salir de esa constante y no escribirse en el componente (ver `design.md`, decisión 6).

#### Scenario: Aviso de demostración en el paso de pago

- **WHEN** el cliente llega al paso de pago, con Yape o con transferencia
- **THEN** el HTML del paso contiene el texto exacto «Sitio de demostración: los pagos son simulados. No hagas ninguna transferencia ni pago real.» en un bloque propio y visible, junto al QR o la CCI

#### Scenario: Monto de la membresía

- **WHEN** el cliente llega al paso de pago con los valores actuales de `configuracion`
- **THEN** ve S/ 89 por 3 meses, S/ 267 en un solo pago, y el total a pagar

#### Scenario: Elegir Yape

- **WHEN** el cliente elige Yape
- **THEN** ve la imagen del QR de Yape de Tiza servida desde `/pago/yape.jpeg`, con su texto alternativo

#### Scenario: Elegir transferencia

- **WHEN** el cliente elige transferencia
- **THEN** ve la CCI de 20 dígitos y el nombre del titular, tomados del módulo de datos de pago

#### Scenario: Total con horas adicionales

- **WHEN** la cotización trae S/ 267 de membresía y S/ 69,66 de horas adicionales
- **THEN** el total a pagar mostrado es S/ 336,66

#### Scenario: Comprobante de otro tipo o de más de 5 MB

- **WHEN** el cliente elige un PDF o una imagen de más de 5 MB
- **THEN** ve un mensaje claro, no se sube nada y no se crea ningún pago

#### Scenario: Comprobante de entre 4,5 y 5 MB

- **WHEN** el cliente elige una imagen JPG de 4,8 MB
- **THEN** se reduce en el navegador y se sube sin error

### Requirement: Confirmar solo con el comprobante subido

El asistente MUST subir primero la imagen a la tienda privada y solo después enviar `POST /api/reservas` con la ruta que devolvió la subida; el botón de confirmar MUST estar deshabilitado mientras no haya método de pago y comprobante, y mientras la petición está en curso (para no enviar dos veces). Si la subida falla, MUST mostrar el error y no enviar la reserva. Si el servidor responde `409` por falta de cupo, MUST llevar al cliente de vuelta al paso de fecha y hora, con el mensaje y los datos conservados (el comprobante ya subido se reutiliza). Si responde `409` porque ya tiene una reserva o un pago en revisión, MUST mostrar el mensaje y no ofrecer reintentar. Cualquier otro error MUST mostrarse sin perder lo escrito.

#### Scenario: Falla la subida

- **WHEN** la subida de la imagen falla
- **THEN** el asistente muestra el error y no envía `POST /api/reservas`

#### Scenario: Doble clic

- **WHEN** el cliente pulsa confirmar dos veces seguidas
- **THEN** se envía una sola petición

#### Scenario: Se agotó el cupo mientras pagaba

- **WHEN** el servidor responde `409` con el mensaje de elegir otra hora
- **THEN** el asistente vuelve al paso de fecha y hora con ese mensaje, conserva servicio, dirección y comprobante, y no vuelve a subir la imagen

#### Scenario: Cierra el asistente antes de confirmar

- **WHEN** el cliente cierra la página antes de confirmar
- **THEN** no existe ninguna membresía, pago ni reserva y el archivo subido queda para la limpieza diaria

### Requirement: Pantalla de confirmación con WhatsApp

Tras un `201` el asistente MUST mostrar que la reserva quedó en espera hasta que se revise el pago (máximo 24 horas), el resumen de lo reservado y un botón para abrir WhatsApp con el enlace de la respuesta, y un enlace a `/cuenta`. Si el enlace es `null`, MUST omitir el botón sin error. El enlace MUST abrirse solo cuando el cliente lo pulsa. El asistente MUST NOT construir el enlace ni conocer el número: lo entrega `POST /api/reservas` a partir de `WHATSAPP_NUMERO`. La pantalla MUST mostrar también, de forma visible y con el mismo texto, el aviso de demostración (`AVISO_DEMOSTRACION`), para que quien reservó sepa que no debe pagar nada real.

#### Scenario: Aviso de demostración en la reserva enviada

- **WHEN** el servidor responde `201` y se muestra la confirmación, con o sin enlace de WhatsApp
- **THEN** el HTML de la pantalla contiene el texto exacto «Sitio de demostración: los pagos son simulados. No hagas ninguna transferencia ni pago real.» en un bloque visible

#### Scenario: Reserva creada

- **WHEN** el servidor responde `201` con un enlace de WhatsApp
- **THEN** el cliente ve la confirmación, el resumen y el botón de WhatsApp

#### Scenario: Sin número de WhatsApp

- **WHEN** el enlace de la respuesta es `null`
- **THEN** la confirmación se muestra sin botón de WhatsApp

### Requirement: Textos en español de Perú y montos en soles

Todos los textos del asistente MUST estar en español de Perú y los montos MUST mostrarse en soles con coma decimal (por ejemplo, S/ 193,50), sin escribir cifras de precios, horas o plazos en el código del asistente: salen de la respuesta del servidor.

#### Scenario: Formato de montos

- **WHEN** el asistente muestra 19350 céntimos
- **THEN** el texto es "S/ 193,50"
