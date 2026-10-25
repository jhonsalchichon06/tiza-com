## Purpose

Entrega el comprobante de un pago solo a quien tiene permiso y evita que el cron diario de archivos huérfanos borre comprobantes en uso (ADR 0010). Reutiliza la entrega privada del ítem #8.

## ADDED Requirements

### Requirement: Entrega del comprobante por id de pago

`GET /api/comprobantes/:id` MUST recibir el identificador de un pago, exigir sesión (`401` sin ella) y devolver la imagen del comprobante leyéndola en el servidor, sin redirigir nunca a una dirección de la tienda de imágenes. Solo el cliente dueño del pago y un administrador MUST poder verla (`200`). Cualquier otro caso MUST responder `404` sin leer el archivo: el pago de otro cliente, un pago que no existe, un identificador que no tiene el formato de un pago y un pago sin comprobante (como los pagos internos con crédito).

#### Scenario: El dueño ve su comprobante

- **WHEN** un cliente pide el comprobante de su propio pago
- **THEN** la respuesta es `200` con la imagen y las cabeceras de entrega privada (`Cache-Control: private, no-store`)

#### Scenario: Un administrador ve cualquier comprobante

- **WHEN** un administrador pide el comprobante del pago de cualquier cliente
- **THEN** la respuesta es `200` con la imagen

#### Scenario: Un cliente pide el comprobante de otro

- **WHEN** un cliente pide el comprobante de un pago que es de otro cliente
- **THEN** la respuesta es `404` y no se lee ningún archivo

#### Scenario: Identificador inventado o con formato inválido

- **WHEN** se pide `/api/comprobantes/abc` o el identificador de un pago que no existe
- **THEN** la respuesta es `404` y no ocurre un error del servidor

#### Scenario: Sin sesión

- **WHEN** alguien sin sesión pide un comprobante
- **THEN** la respuesta es `401`

### Requirement: Datos de pago de Tiza en un solo módulo

El sistema MUST guardar en un único módulo (`src/lib/reservas/datos-de-pago.ts`) la CCI de Tiza (`00314301327959666056`, 20 dígitos), el nombre del titular (`Jhon Alex Espichan Uscamaita`, el que aparece en el QR de Yape) y la ruta pública de la imagen del QR (`/pago/yape.jpeg`). La imagen MUST servirse desde `public/pago/yape.jpeg`, copiada de `yape/yape.jpeg`, y el despliegue MUST incluirla. Ningún otro archivo de `app/` ni de `src/` MUST repetir la CCI, el titular ni la ruta de la imagen. Estos datos son los reales del titular del proyecto, mientras que el PRD declara los pagos simulados: el aviso de demostración que los acompaña en pantalla (requisito siguiente) lo muestran 9b y la landing, con el texto que guarda este change.

#### Scenario: Módulo único

- **WHEN** se busca la CCI, el titular o la ruta `/pago/yape.jpeg` en `app/` y `src/`
- **THEN** solo aparecen en `datos-de-pago.ts` (y en sus pruebas, que los leen del módulo)

#### Scenario: La CCI tiene 20 dígitos

- **WHEN** una prueba lee la CCI del módulo
- **THEN** son exactamente 20 dígitos

#### Scenario: La imagen del QR se sirve

- **WHEN** se pide `/pago/yape.jpeg` en el sitio desplegado
- **THEN** la respuesta es `200` con una imagen JPEG

### Requirement: Aviso de demostración en un solo módulo

El sistema MUST guardar en un único módulo (`src/lib/aviso-demo.ts`) la constante `AVISO_DEMOSTRACION` con el texto exacto «Sitio de demostración: los pagos son simulados. No hagas ninguna transferencia ni pago real.» (PRD, "Alcance" punto 3, "Aviso de demostración"). El texto MUST NOT contener cifras de dinero, números de cuenta, claves ni ningún dígito. Los componentes que lo muestran (el paso de pago y la reserva enviada de 9b, y el pie de las páginas públicas de la landing) MUST importarlo de ese módulo y MUST NOT repetir el texto. Este change solo crea el módulo; mostrarlo en pantalla es de los changes `asistente-de-reserva` y `landing-y-faq`.

#### Scenario: Texto exacto

- **WHEN** una prueba lee `AVISO_DEMOSTRACION`
- **THEN** es exactamente «Sitio de demostración: los pagos son simulados. No hagas ninguna transferencia ni pago real.»

#### Scenario: Sin cifras ni claves

- **WHEN** una prueba revisa el texto del aviso
- **THEN** no contiene dígitos, el símbolo «S/», la CCI del módulo de datos de pago ni palabras como «clave», «token» o «secreto»

#### Scenario: Módulo único del aviso

- **WHEN** se busca el texto del aviso en `app/` y `src/`
- **THEN** solo aparece en `aviso-demo.ts` y en su prueba

### Requirement: La limpieza diaria no borra comprobantes en uso

La columna de la ruta del comprobante de los pagos MUST estar declarada en el registro de columnas con imagen para que el cron diario no borre los comprobantes que un pago referencia. Una prueba MUST fallar si el esquema tiene una columna de ruta de imagen sin declarar.

#### Scenario: Comprobante de un pago

- **WHEN** el cron revisa un archivo de `comprobantes/` de más de 24 horas que referencia un pago
- **THEN** no se borra

#### Scenario: Comprobante subido y nunca registrado

- **WHEN** un archivo de `comprobantes/` de más de 24 horas no lo referencia ningún pago (la reserva falló o el cliente cerró la página)
- **THEN** el cron lo borra

#### Scenario: Columna de ruta sin declarar

- **WHEN** el esquema tiene una columna de ruta de imagen que no está en el registro
- **THEN** la prueba de esquema falla
