## ADDED Requirements

### Requirement: Lectura pública de reseñas aprobadas sin datos personales
El servidor MUST ofrecer una función que devuelva solo las reseñas en estado `aprobada`, de la más reciente a la más antigua y con un máximo de 6, y que por cada una entregue únicamente `nombrePila`, `distrito`, `estrellas`, `comentario` y `mes` (mes y año de la limpieza, en español de Perú). `nombrePila` MUST ser la primera palabra del nombre del cliente. La función MUST NOT devolver apellido, correo, celular, dirección, ids de usuario o de reserva, ni el estado de la reseña. Una reseña `pendiente` o `rechazada` MUST NOT aparecer nunca.

#### Scenario: Solo aprobadas
- **WHEN** hay una reseña aprobada, una pendiente y una rechazada
- **THEN** la función devuelve una sola

#### Scenario: Sin datos personales
- **WHEN** el cliente se llama "María del Pilar Quispe Rojas", con correo, celular y calle
- **THEN** el resultado trae "María", su distrito, las estrellas, el comentario y el mes, y ningún otro campo

#### Scenario: Más de seis
- **WHEN** hay ocho aprobadas
- **THEN** devuelve las seis más recientes

### Requirement: Sección "Opiniones de clientes" en la landing
La landing MUST mostrar una sección `id="opiniones"` titulada "Opiniones de clientes" con una tarjeta por reseña (estrellas, comentario, nombre de pila y distrito) únicamente cuando hay al menos una reseña aprobada. Sin ninguna, MUST NOT mostrar la sección ni su enlace del menú ni ninguna frase sustituta, y MUST NOT incluir testimonios de ejemplo. El menú de las páginas públicas MUST mostrar "Opiniones" (enlace a `/#opiniones`) solo cuando la sección existe. El texto de cada reseña MUST escaparse (nunca HTML). Las páginas conservan `revalidate = 300` y no leen sesión ni cookies.

#### Scenario: Con reseñas aprobadas
- **WHEN** hay dos reseñas aprobadas
- **THEN** la landing tiene la sección `#opiniones` con dos tarjetas y el menú muestra "Opiniones"

#### Scenario: Sin reseñas aprobadas
- **WHEN** no hay ninguna aprobada
- **THEN** la landing no contiene `id="opiniones"`, ni la palabra "Opiniones" en el menú, y sigue teniendo las demás nueve secciones

#### Scenario: Una reseña pendiente no se muestra
- **WHEN** el cliente envía una reseña y el administrador aún no la aprueba
- **THEN** la landing no la muestra

#### Scenario: Aprobación visible
- **WHEN** el administrador aprueba una reseña
- **THEN** la landing la muestra en la siguiente regeneración (revalidación pedida al aprobar, o como máximo 5 minutos)

#### Scenario: Falla la lectura de reseñas
- **WHEN** la consulta de reseñas falla tras el reintento
- **THEN** el error se registra y la landing se publica sin la sección y sin el enlace, con el resto del contenido intacto

#### Scenario: Comentario con HTML
- **WHEN** un comentario aprobado contiene etiquetas HTML
- **THEN** la página las muestra como texto

#### Scenario: Sin cifras escritas a mano
- **WHEN** la prueba de fuentes de las páginas públicas revisa los archivos nuevos
- **THEN** no encuentra montos en soles, `10 %`, `24` ni `48` escritos a mano
