# ADR 0011: Dirección verificada con Google Maps

## Estado

Reemplazado por el [ADR 0013](0013-direccion-con-campos-de-texto.md). El negocio no puede abrir la cuenta de facturación de Google Cloud que esta decisión exigía, así que la dirección se captura con campos de texto. Se conserva como registro de la decisión anterior.

## Contexto

La limpieza gratis se da una sola vez por hogar (ADR 0008). Comparar el texto normalizado de la dirección no detecta todas las formas de escribir la misma casa: "Av. Larco 123 dpto 401" y "Larco 123 - 401" no coinciden. Además, el distrito lo elegía el cliente en una lista, y nada garantizaba que la dirección estuviera de verdad en uno de los 9 distritos de v1.

El negocio decidió que la dirección debe coincidir con el mapa y eligió Google Maps. Es el proveedor con mejor cobertura de números de casa en Lima, y sus términos permiten guardar el identificador del lugar (`place_id`) sin vencimiento.

## Decisión

**En el navegador (asistente de reserva):**
1. Un campo de búsqueda con el autocompletado de lugares de Google, restringido a Perú y con preferencia por Lima.
2. El cliente elige una sugerencia y ve el punto en un mapa para confirmar que es su casa.
3. Un campo aparte para el departamento o interior. Google identifica el edificio, no el departamento.
4. Un campo opcional de referencias ("puerta verde", "frente al parque"), solo para el personal.

**En el servidor**, al crear la reserva:
- Recibe el `place_id` y consulta los detalles del lugar a Google. No confía en lo que manda el navegador.
- Exige un resultado con número de casa (tipo `street_address`, `premise` o `subpremise`). Si es solo una calle o una zona, responde `422` y pide elegir la dirección exacta.
- Toma el distrito de los componentes de la dirección y comprueba que sea uno de los 9 de v1. Si no lo es, responde `422` con un mensaje que lo explica.
- Guarda en la reserva: `place_id`, la dirección con el formato de Google, el distrito, el departamento tal como lo escribió el cliente y normalizado (`departamento_normalizado`), las referencias y `direccion_normalizada` (la clave de respaldo del ADR 0008).

**Coordenadas:** no se guardan de forma permanente. Los términos de Google limitan guardar latitud y longitud a 30 días. Cuando el administrador necesita ver el mapa, se vuelve a consultar con el `place_id`.

**Claves y costo:**
- Una clave de navegador, restringida por dominio (referrer) y solo a las APIs de autocompletado y mapa. Es pública por naturaleza, así que su protección es esa restricción.
- Una clave de servidor, solo para los detalles del lugar, guardada en una variable de entorno de Vercel. Nunca va en el repositorio.
- Límites diarios de cuota y alertas de presupuesto en Google Cloud, para que un pico de tráfico o un abuso no genere cobros.
- Se usan sesiones de autocompletado (un token por búsqueda), para que una búsqueda completa se cobre como una sola sesión y no como cada tecla.

**Si Google no responde:** el asistente muestra "No pudimos cargar el mapa, inténtalo en unos segundos" y no deja continuar. No hay forma de reservar sin una dirección verificada, porque la regla de un hogar por limpieza gratis depende de ella.

## Alternativas consideradas

- **Solo texto normalizado** — gratis y sin dependencias, pero no detecta las variaciones de una misma casa ni verifica el distrito. Se mantiene como clave de respaldo.
- **Mapbox** — tiene capa gratuita sin tarjeta, pero sus términos no permiten guardar el resultado de la búsqueda si no se paga la geocodificación permanente, y su cobertura de números en Lima es peor.
- **OpenStreetMap (Nominatim)** — gratis, pero sus servidores públicos prohíben el autocompletado y en Lima faltan muchos números de casa.

## Consecuencias

- La misma casa queda identificada por un `place_id` estable, aunque el cliente la escriba de otra forma.
- El distrito sale del mapa, así que una dirección fuera de los 9 distritos se rechaza en el servidor.
- El personal recibe una dirección con formato estándar, el departamento y las referencias.
- **Costo y cuenta:** Google exige una cuenta de facturación con tarjeta. Hay una cuota gratuita mensual por servicio, pero el tráfico por encima de ella se cobra. Las cuotas y precios vigentes **hay que verificarlos al implementar**.
- **Dependencia externa crítica:** si Google cae o se agota la cuota, nadie puede reservar.
- Algunas casas nuevas o en calles mal mapeadas pueden no aparecer con número. Esos clientes no pueden reservar en línea y tienen que escribir por WhatsApp; el administrador podría registrarlos a mano en una versión futura.
- El `place_id` no distingue departamentos, así que en un edificio la unicidad depende del departamento escrito a mano (ADR 0008).
- Google recomienda refrescar un `place_id` guardado si tiene más de 12 meses, porque puede cambiar. Si cambia, una casa podría recibir dos limpiezas gratis; la clave de respaldo por texto reduce ese riesgo.
- El asistente necesita cargar el script de Google Maps, que suma peso a la página de reserva.
