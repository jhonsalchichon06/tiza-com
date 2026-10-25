## Purpose

Libera el espacio de Blob borrando cada día los archivos que se subieron pero nunca se usaron (cliente que cierra la pestaña, conflicto de horario, error), para no agotar el 1 GB del plan Hobby.

## ADDED Requirements

### Requirement: Cron diario protegido

Debe existir una tarea programada de Vercel que llame a `GET /api/cron/huerfanos` una vez al día. La ruta MUST exigir la cabecera `Authorization: Bearer <CRON_SECRET>` y responder `401` si falta o no coincide; MUST NOT aceptar la sesión de un usuario como credencial. Si `CRON_SECRET` no está configurada, MUST responder `503` y no borrar nada.

#### Scenario: Llamada con el secreto correcto

- **WHEN** Vercel llama a la ruta con `Authorization: Bearer <CRON_SECRET>`
- **THEN** la ruta ejecuta la limpieza y responde `200` con la cantidad de archivos borrados

#### Scenario: Llamada sin secreto o con otro

- **WHEN** alguien llama a la ruta sin la cabecera, o con un secreto distinto, o con la sesión de un administrador
- **THEN** la respuesta es `401` y no se borra nada

#### Scenario: Secreto sin configurar

- **WHEN** falta `CRON_SECRET` en el entorno
- **THEN** la respuesta es `503` y no se borra nada

### Requirement: Borrar solo archivos huérfanos de más de 24 horas

La limpieza MUST listar los archivos de las carpetas `comprobantes/` y `fotos/`, y MUST borrar únicamente los que (a) se subieron hace más de 24 horas y (b) no están referenciados por ninguna fila de la base. Un archivo referenciado MUST NOT borrarse nunca, sin importar su antigüedad. Un archivo de menos de 24 horas MUST NOT borrarse aunque nadie lo referencie, porque su reserva puede estar por crearse.

#### Scenario: Archivo huérfano antiguo

- **WHEN** existe un archivo de 30 horas que ninguna fila referencia
- **THEN** la limpieza lo borra y lo cuenta en la respuesta

#### Scenario: Archivo huérfano reciente

- **WHEN** existe un archivo de 2 horas que ninguna fila referencia
- **THEN** la limpieza no lo borra

#### Scenario: Archivo antiguo pero en uso

- **WHEN** existe un archivo de 30 días referenciado por una fila
- **THEN** la limpieza no lo borra

#### Scenario: Muchos archivos

- **WHEN** Blob lista más archivos de los que caben en una página
- **THEN** la limpieza recorre todas las páginas

### Requirement: Registro único de columnas con imágenes y borrado seguro

Las columnas de la base que guardan una ruta de imagen MUST declararse en un único registro (`COLUMNAS_CON_IMAGEN`). La limpieza MUST leer las referencias solo desde ese registro. Si el registro está vacío, la limpieza MUST NOT borrar ningún archivo y MUST responder `200` indicando que omitió el borrado. Si leer las referencias de la base falla, la limpieza MUST abortar sin borrar nada.

#### Scenario: Registro vacío

- **WHEN** el registro no tiene ninguna columna declarada
- **THEN** la limpieza no borra ningún archivo y responde `200` indicando que omitió el borrado

#### Scenario: Falla la lectura de referencias

- **WHEN** la consulta de referencias a la base falla
- **THEN** la limpieza no borra ningún archivo y la ruta responde con el error genérico

#### Scenario: Falla el borrado de un archivo

- **WHEN** Blob falla al borrar uno de varios huérfanos
- **THEN** se registra el error, se continúa con los demás y la respuesta indica cuántos se borraron y cuántos fallaron
