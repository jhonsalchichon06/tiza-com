## ADDED Requirements

### Requirement: Pantalla /admin/reservas/[id]/fotos
La pantalla MUST ser un componente de servidor protegido por el layout de `/admin` (visitante a `/ingresar`, cliente a `/cuenta`). Si la reserva no existe o el id no es un uuid MUST mostrar la página de no encontrada. Si la reserva existe y no está `completada` MUST mostrar el mensaje "Solo puedes subir fotos de una limpieza completada." y no mostrar el formulario. Si está `completada` MUST mostrar los datos de la reserva (cliente, servicio, fecha), las fotos ya subidas agrupadas por ambiente (cada una con `src="/api/fotos/<id>"`), cuántas fotos faltan por llegar al límite y el formulario de subida. Con el límite alcanzado MUST ocultar el formulario y decirlo.

#### Scenario: Reserva completada sin fotos
- **WHEN** el administrador abre la pantalla de una reserva `completada` sin fotos
- **THEN** ve el formulario y "Aún no hay fotos"

#### Scenario: Reserva no completada
- **WHEN** abre la pantalla de una reserva `confirmada`
- **THEN** ve el mensaje de que solo se suben fotos de una limpieza completada y no ve el formulario

#### Scenario: Límite alcanzado
- **WHEN** la reserva ya tiene 12 fotos
- **THEN** no ve el formulario y ve que llegó al máximo

#### Scenario: Cliente que abre la URL
- **WHEN** un cliente abre `/admin/reservas/<id>/fotos`
- **THEN** es redirigido a `/cuenta`

### Requirement: Elegir varias fotos con su ambiente y subirlas
El formulario MUST permitir elegir varias imágenes a la vez (hasta las que faltan para el límite), mostrar una vista previa de cada una con un selector de ambiente obligatorio y un botón "Subir fotos". Cada archivo MUST validarse y comprimirse en el navegador con `subirImagen` (#8, destino `{ tipo: "foto", reservaId }`) y subirse directo a Blob; luego un solo `POST /api/admin/reservas/:id/fotos` registra las que subieron bien. Si algunas subidas fallan, MUST registrar las que sí subieron y mostrar cuáles fallaron para reintentarlas, sin duplicar las ya registradas. Un archivo de otro tipo o de más de 5 MB MUST mostrar el mensaje de #8 y no subirse. El botón MUST deshabilitarse mientras se sube, con progreso visible; al terminar MUST refrescar la pantalla. Si el registro responde con error, MUST mostrar el mensaje del servidor.

#### Scenario: Subir tres fotos con ambientes
- **WHEN** el administrador elige tres imágenes, asigna un ambiente a cada una y pulsa "Subir fotos"
- **THEN** se suben, se registran en una sola petición y aparecen en la pantalla agrupadas por ambiente

#### Scenario: Falta el ambiente
- **WHEN** una imagen no tiene ambiente elegido
- **THEN** el botón no sube nada y se pide el ambiente

#### Scenario: Archivo inválido
- **WHEN** elige un PDF o una imagen de 6 MB
- **THEN** ve el mensaje de error de esa imagen y no se sube

#### Scenario: Falla una de tres subidas
- **WHEN** dos subidas funcionan y una falla por red
- **THEN** se registran las dos y se muestra la que falló con la opción de reintentarla, sin volver a subir las dos primeras

#### Scenario: Doble clic
- **WHEN** pulsa "Subir fotos" dos veces seguidas
- **THEN** solo se envía un registro

#### Scenario: Más fotos de las que caben
- **WHEN** faltan 2 para el límite y elige 4 imágenes
- **THEN** la pantalla solo deja subir 2 y lo explica

### Requirement: Enlace desde la lista de reservas
La lista de reservas del administrador (#16) MUST mostrar un enlace "Fotos" a `/admin/reservas/<id>/fotos` solo en las reservas `completada`.

#### Scenario: Reserva completada en la lista
- **WHEN** la lista muestra una reserva `completada`
- **THEN** la fila tiene el enlace "Fotos"

#### Scenario: Reserva confirmada en la lista
- **WHEN** la lista muestra una reserva `confirmada`
- **THEN** la fila no tiene el enlace
