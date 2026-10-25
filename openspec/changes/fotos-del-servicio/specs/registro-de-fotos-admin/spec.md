## ADDED Requirements

### Requirement: Tabla de fotos del servicio
El esquema MUST tener la tabla `fotos_servicio` con `id` (uuid), `reserva_id` (clave foránea a `reservas`, no nula), `ambiente` (texto no nulo), `ruta` (texto no nulo y único: la ruta del archivo en Blob), `subida_por` (clave foránea a `usuarios`) y `creada_en`. MUST tener un índice por `reserva_id`. La columna `ruta` MUST estar declarada en `COLUMNAS_CON_IMAGEN` (`src/lib/imagenes/referencias.ts`). No se guardan imágenes en la base, solo la ruta (TECH-DESIGN, "Reglas de datos").

#### Scenario: El cron no borra una foto en uso
- **WHEN** una foto registrada tiene más de 24 horas en Blob y el cron de huérfanos corre
- **THEN** el archivo no se borra porque `fotos_servicio.ruta` está en `COLUMNAS_CON_IMAGEN`

#### Scenario: La prueba de columnas declaradas
- **WHEN** corre la prueba que recorre el esquema buscando columnas de ruta de imagen
- **THEN** pasa, porque `fotos_servicio.ruta` está declarada

#### Scenario: Una ruta no se registra dos veces
- **WHEN** se intenta insertar una segunda fila con la misma `ruta`
- **THEN** la base lo rechaza por la restricción de unicidad

### Requirement: Registrar fotos con POST /api/admin/reservas/:id/fotos
La ruta MUST exigir rol de administrador (`401` sin sesión, `403` para un cliente, sin ejecutar lógica) y `application/json` (`415`). MUST responder `404` si el `id` no tiene formato de uuid o la reserva no existe. El cuerpo MUST ser `{ "fotos": [{ "ruta": string, "ambiente": string }] }` con al menos una foto y no más que el límite; si no, `422`. Si la reserva existe y no está `completada`, MUST responder `409` con un mensaje que nombra su estado, y MUST NOT leer Blob ni escribir nada. Si todo es válido, MUST registrar todas las fotos en una sola transacción (todas o ninguna) y responder `201` con las fotos creadas (`id`, `ambiente`).

#### Scenario: Registrar varias fotos de una reserva completada
- **WHEN** el administrador envía tres fotos válidas con ambientes distintos para una reserva `completada`
- **THEN** responde `201`, se crean tres filas asociadas a esa reserva con `subida_por` del administrador y la respuesta lista las tres

#### Scenario: Reserva no completada
- **WHEN** envía fotos para una reserva `confirmada`, `pendiente`, `cancelada` o `expirada`
- **THEN** responde `409` con el estado en el mensaje, no consulta Blob y no crea filas

#### Scenario: Reserva inexistente o id inválido
- **WHEN** el `id` es `abc` o un uuid que no existe
- **THEN** responde `404`

#### Scenario: Cliente o visitante
- **WHEN** un cliente llama a la ruta, o alguien sin sesión
- **THEN** responde `403` o `401` y no se ejecuta ninguna lógica

#### Scenario: Cuerpo que no es JSON
- **WHEN** la petición no trae `Content-Type: application/json`
- **THEN** responde `415`

#### Scenario: Lista vacía o formato incorrecto
- **WHEN** `fotos` está vacío, no es una lista o una foto no trae `ruta` o `ambiente`
- **THEN** responde `422` y no crea nada

### Requirement: Verificación del archivo y de la carpeta antes de registrar
Antes de abrir la transacción, la ruta MUST llamar a `verificarImagenSubida` por cada foto, y MUST exigir que la ruta verificada esté en la carpeta `fotos/{id de la reserva de la URL}/`: una ruta de `fotos/` de otra reserva MUST rechazarse con `422`. Si algún archivo no existe, pesa más de 4 MB o su contenido no es JPG, PNG o WebP, MUST responder el error de esa verificación y MUST NOT crear ninguna fila, ni siquiera de las fotos válidas del mismo envío. Solo se guarda la ruta que devuelve la verificación.

#### Scenario: Archivo inexistente en Blob
- **WHEN** una de las rutas no existe en Blob
- **THEN** responde `404` con el mensaje de #8 y no se crea ninguna fila

#### Scenario: Contenido que no es imagen
- **WHEN** una ruta termina en `.png` pero sus bytes son de un PDF
- **THEN** responde `422` y no se crea ninguna fila

#### Scenario: Foto de la carpeta de otra reserva
- **WHEN** la URL es de la reserva A y una ruta empieza con `fotos/<id de la reserva B>/`
- **THEN** responde `422` y no se crea ninguna fila

#### Scenario: Ruta de comprobante
- **WHEN** una ruta empieza con `comprobantes/`
- **THEN** responde `422`

#### Scenario: Imagen de 5 MB original
- **WHEN** el cliente de #8 comprimió una foto original de 5 MB y la subió
- **THEN** el registro la acepta porque lo que está en Blob pesa 4 MB o menos

### Requirement: Ambiente de una lista cerrada
Cada foto MUST llevar un ambiente de la lista cerrada `cocina`, `bano`, `dormitorio`, `sala`, `comedor`, `lavanderia` y `otro`, validada en el servidor aunque el navegador la envíe por fuera de la lista. La lista y sus etiquetas en español de Perú viven en un solo módulo. (Supuesto marcado en `design.md`.)

#### Scenario: Ambiente válido
- **WHEN** una foto trae `ambiente: "cocina"`
- **THEN** se acepta y se muestra con la etiqueta "Cocina"

#### Scenario: Ambiente fuera de la lista
- **WHEN** una foto trae `ambiente: "garaje"`
- **THEN** responde `422` con un mensaje claro y no se crea nada

### Requirement: Límite de fotos por reserva
Una reserva MUST aceptar como máximo `fotos_maximas_por_reserva` fotos (dato de `configuracion`, valor inicial 12, supuesto marcado). El conteo y la inserción MUST ocurrir en la misma transacción con la fila de la reserva bloqueada (`FOR UPDATE`), de modo que dos envíos simultáneos no superen el límite. Si el envío haría pasar el límite, MUST responder `409` con cuántas fotos faltan por completar el cupo y MUST NOT registrar ninguna del envío.

#### Scenario: Dentro del límite
- **WHEN** la reserva tiene 10 fotos y el administrador envía 2
- **THEN** se registran y la reserva queda con 12

#### Scenario: Pasa el límite
- **WHEN** la reserva tiene 11 fotos y el administrador envía 2
- **THEN** responde `409` indicando que solo caben 1 más y no se registra ninguna

#### Scenario: Dos envíos simultáneos
- **WHEN** dos administradores envían a la vez 7 fotos cada uno a una reserva sin fotos
- **THEN** uno recibe `201` y el otro `409`, y la reserva queda con 7 fotos

#### Scenario: El límite es un dato
- **WHEN** se cambia `fotos_maximas_por_reserva` a 5 en `configuracion`
- **THEN** el servidor aplica 5 sin cambios de código

### Requirement: Errores de conexión y de la base
La ruta MUST reintentar una vez si Neon está dormido (`conReintento` con `errorOriginal`) y responder `503` "Inténtalo en unos segundos." si el segundo intento también falla. Una ruta ya registrada MUST dar `409` (clave única), no `500`.

#### Scenario: Neon dormido
- **WHEN** el primer intento falla por conexión y el segundo funciona
- **THEN** responde `201` sin duplicar filas

#### Scenario: Dos cortes seguidos
- **WHEN** ambos intentos fallan por conexión
- **THEN** responde `503`

#### Scenario: Ruta ya registrada
- **WHEN** el envío repite una ruta que ya tiene una foto
- **THEN** responde `409` y no crea filas
