## Purpose

Permite subir imágenes (comprobantes de pago y fotos del servicio) directo a una tienda privada de Blob, con el tamaño reducido en el navegador y con permisos y verificación en el servidor, sin pasar por el límite de 4,5 MB de las funciones de Vercel.

## ADDED Requirements

### Requirement: Validación del archivo original en el navegador

Antes de subir nada, el navegador MUST aceptar solo archivos JPG, PNG o WebP de hasta 5 MB (5 242 880 bytes). Un archivo de otro tipo o de más de 5 MB MUST rechazarse con un mensaje claro en español de Perú, sin iniciar ninguna subida. El tipo MUST decidirse por el tipo MIME del archivo y su extensión, no solo por uno de los dos.

#### Scenario: Archivo de otro tipo

- **WHEN** el cliente elige un PDF o un GIF
- **THEN** se muestra un mensaje que indica que solo se aceptan JPG, PNG o WebP
- **AND** no se pide ningún token ni se sube nada

#### Scenario: Archivo de más de 5 MB

- **WHEN** el cliente elige una imagen JPG de 5,1 MB
- **THEN** se muestra un mensaje que indica el máximo de 5 MB
- **AND** no se pide ningún token ni se sube nada

#### Scenario: Archivo de entre 4,5 y 5 MB

- **WHEN** el cliente elige una imagen PNG de 4,8 MB
- **THEN** el archivo se acepta y continúa a la compresión

### Requirement: Compresión en el navegador antes de subir

El navegador MUST reducir la imagen a un máximo de 2000 px por lado, sin ampliarla, y volver a codificarla (WebP, o JPEG si el navegador no codifica WebP), con un objetivo de 1 MB o menos. El archivo resultante MUST pesar 4 MB (4 194 304 bytes) o menos para poder subirse. Si la compresión falla, el sistema MUST intentar subir el original solo si pesa 4 MB o menos; si pesa más, MUST pedir al cliente otra imagen con un mensaje claro.

#### Scenario: Foto grande de celular

- **WHEN** el cliente elige una foto de 4,8 MB y 4000 × 3000 px
- **THEN** el archivo que se sube mide como máximo 2000 px por lado y pesa 4 MB o menos
- **AND** conserva la proporción original

#### Scenario: Imagen pequeña

- **WHEN** el cliente elige una imagen de 800 × 600 px
- **THEN** no se amplía; conserva 800 × 600 px

#### Scenario: Falla la compresión con un original liviano

- **WHEN** el navegador no logra comprimir una imagen de 3 MB
- **THEN** se sube el original sin comprimir

#### Scenario: Falla la compresión con un original pesado

- **WHEN** el navegador no logra comprimir una imagen de 4,8 MB
- **THEN** se muestra un mensaje que pide elegir otra imagen
- **AND** no se sube nada

### Requirement: Token de subida con sesión y carpeta del usuario

`POST /api/subidas` MUST exigir sesión (`401` sin ella) y MUST emitir un token de subida directa a la tienda privada de Blob que limite los tipos a `image/jpeg`, `image/png` e `image/webp`, el tamaño a 4 MB y la carpeta, con un sufijo aleatorio en el nombre. Para comprobantes la carpeta MUST ser `comprobantes/{usuarioId}/`, con el `usuarioId` tomado de la sesión. Para fotos del servicio la carpeta MUST ser `fotos/{reservaId}/` y la ruta MUST exigir rol `admin` (`403` si no lo tiene). El servidor MUST rechazar con `422` una ruta pedida fuera de la carpeta permitida, con una extensión que no sea `.jpg`, `.jpeg`, `.png` o `.webp`, o con segmentos como `..`.

#### Scenario: Cliente pide un token para su comprobante

- **WHEN** un cliente con sesión pide un token para `comprobantes/{su id}/foto.webp`
- **THEN** la respuesta incluye un token válido solo para esa carpeta, con los tres tipos de imagen y 4 MB como máximo

#### Scenario: Sin sesión

- **WHEN** alguien sin sesión llama a `POST /api/subidas`
- **THEN** la respuesta es `401` con el formato único de errores
- **AND** no se emite ningún token

#### Scenario: Carpeta de otro usuario

- **WHEN** un cliente pide un token para `comprobantes/{id de otro usuario}/foto.webp`
- **THEN** la respuesta es `422` y no se emite ningún token

#### Scenario: Cliente pide un token para fotos del servicio

- **WHEN** un cliente sin rol `admin` pide un token para `fotos/{reservaId}/foto.webp`
- **THEN** la respuesta es `403` y no se emite ningún token

#### Scenario: Administrador pide un token para fotos del servicio

- **WHEN** un administrador pide un token para `fotos/{reservaId}/foto.webp`
- **THEN** la respuesta incluye un token válido para esa carpeta

#### Scenario: Ruta inválida

- **WHEN** se pide un token para una ruta con `..` o con extensión `.gif`
- **THEN** la respuesta es `422` y no se emite ningún token

### Requirement: Verificación del archivo antes de registrarlo

Las rutas de negocio MUST llamar a `verificarImagenSubida` con la ruta recibida antes de crear cualquier fila que la referencie. La función MUST comprobar que la ruta está dentro de la carpeta permitida para ese usuario o reserva, que el archivo existe en Blob, que pesa 4 MB o menos y que su contenido real es JPG, PNG o WebP según los bytes iniciales, sin fiarse del tipo declarado. Si cualquier comprobación falla, MUST lanzar un error `422` (o `404` si el archivo no existe) y la ruta de negocio MUST NOT crear el pago ni la reserva.

#### Scenario: Archivo válido en la carpeta del usuario

- **WHEN** se verifica `comprobantes/{id del usuario}/abc.webp`, que existe, pesa 800 KB y empieza con la firma de WebP
- **THEN** la verificación termina sin error y devuelve el tipo y el tamaño

#### Scenario: Archivo inexistente

- **WHEN** se verifica una ruta que no existe en Blob
- **THEN** se lanza un error `404` o `422` con un mensaje claro y no se crea ninguna fila

#### Scenario: Archivo en la carpeta de otro usuario

- **WHEN** un cliente envía una ruta dentro de `comprobantes/{id de otro usuario}/`
- **THEN** se lanza un error `422`

#### Scenario: Contenido que no es una imagen permitida

- **WHEN** el archivo existe con extensión `.png` pero sus bytes iniciales corresponden a un ejecutable o a un PDF
- **THEN** se lanza un error `422`

#### Scenario: Archivo de más de 4 MB

- **WHEN** el archivo en Blob pesa 4,3 MB
- **THEN** se lanza un error `422`

### Requirement: Falla de la subida no deja datos

Si la subida a Blob falla, el sistema MUST NOT crear pago ni reserva. Un archivo subido que ninguna fila referencia MUST quedar sin efecto en el negocio y ser eliminado por la limpieza diaria.

#### Scenario: La subida falla

- **WHEN** el navegador no logra subir el archivo a Blob
- **THEN** la ruta de negocio no recibe ninguna ruta de archivo y no se crea ninguna fila
- **AND** el cliente ve un mensaje para reintentar sin perder lo que escribió

#### Scenario: El almacén no está configurado

- **WHEN** falta `BLOB_READ_WRITE_TOKEN` y alguien llama a `POST /api/subidas`
- **THEN** la respuesta es `503` con el mensaje "Inténtalo en unos segundos." y se registra el error en el servidor
