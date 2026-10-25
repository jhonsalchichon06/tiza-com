# ADR 0013: Dirección del hogar con campos de texto

## Estado

Aceptado. Reemplaza al ADR 0011 (dirección verificada con Google Maps) y ajusta la identificación del hogar del ADR 0008.

## Contexto

El ADR 0011 decidió verificar la dirección con Google Maps. Esa decisión exigía una cuenta de facturación de Google Cloud con tarjeta, y el negocio no puede usarla. Ningún otro proveedor de mapas cumple a la vez con ser gratuito, tener buena cobertura de números de casa en Lima y permitir el autocompletado y guardar el resultado (Mapbox y Nominatim ya se habían descartado en el ADR 0011).

La limpieza gratis se da una sola vez por hogar (ADR 0008), y el servicio solo atiende 9 distritos. Hay que identificar el hogar y validar el distrito sin un mapa.

## Decisión

**En el navegador (asistente de reserva)**, campos normales:
1. **Distrito**, elegido de una lista cerrada con los 9 distritos de v1.
2. **Calle, avenida o jirón** (texto).
3. **Número** de la casa o del edificio (texto; debe incluir al menos un dígito).
4. **Departamento o interior** (texto, opcional: una casa no lo tiene).
5. **Referencias** (texto, opcional): "puerta verde", "frente al parque". Solo para el personal.

**En el servidor**, al crear la reserva:
- Valida que el distrito sea uno de los 9, que la calle no esté vacía y que el número tenga al menos un dígito. Si no, responde `422` con un mensaje claro. No confía en la lista del navegador.
- Normaliza la calle y el departamento: minúsculas, sin tildes ni signos, con las abreviaturas unificadas (`av` → `avenida`, `jr` → `jiron`, `dpto`/`dep` → `dpto`, `n°`/`#` → `nro`).
- Guarda en la reserva: el distrito, la calle y el número tal como los escribió el cliente, el departamento tal como lo escribió y normalizado (`departamento_normalizado`, vacío si no hay), las referencias y `direccion_normalizada` (calle normalizada más número).

**Clave del hogar:** `(distrito, direccion_normalizada, departamento_normalizado)`. Reemplaza las dos claves del ADR 0008 (`place_id` más departamento, y dirección normalizada). El índice único parcial `reservas(distrito, direccion_normalizada, departamento_normalizado)` con `primera_gratis` en estado `pendiente`, `confirmada` o `completada` garantiza una limpieza gratis por hogar. Dos departamentos distintos del mismo edificio sí pueden recibir una cada uno.

**Coincidencias aproximadas, solo para el administrador:** al revisar un pago con limpieza gratis, el portal muestra las reservas gratis del mismo distrito que comparten número y calle parecida, o la misma dirección con otro departamento. El administrador puede rechazar el pago si es la misma casa escrita de otra forma.

**Sin mapa ni coordenadas.** No se guardan latitud y longitud, ni hay claves de ningún proveedor de mapas. El personal recibe la dirección escrita y las referencias.

## Alternativas consideradas

- **Google Maps con autocompletado y verificación** (ADR 0011) — la mejor opción técnica, pero exige una cuenta de facturación con tarjeta que el negocio no puede abrir. Reemplazada.
- **Mapbox** — tiene capa gratuita, pero sus términos no permiten guardar el resultado de la búsqueda sin pagar la geocodificación permanente, y su cobertura de números en Lima es peor.
- **OpenStreetMap (Nominatim)** — gratis, pero sus servidores públicos prohíben el autocompletado y en Lima faltan muchos números de casa.
- **Calle y número en un solo campo de texto** — es más corto de llenar, pero no permite exigir el número ni comparar calle y número por separado. Se prefieren campos separados.

## Consecuencias

- **Sin costo ni dependencia externa:** no hay cuenta de Google Cloud, claves ni cuotas, y el asistente no carga ningún script de mapas.
- **La dirección no se verifica.** El sistema no comprueba que la calle y el número existan ni que estén en el distrito elegido. Un cliente puede escribir una dirección falsa; el personal lo notaría al llegar y el administrador puede contactarlo por WhatsApp.
- **El distrito lo declara el cliente.** Se valida que sea uno de los 9, pero no que la dirección esté ahí.
- **La limpieza gratis repetida es más fácil de eludir.** "Av. Larco 123" y "Larco 123" no coinciden aunque sean la misma casa, y la normalización solo unifica abreviaturas. La defensa es el administrador, que ve las coincidencias aproximadas al aprobar el pago (ADR 0008). El riesgo es mayor que con `place_id`.
- **El departamento sigue siendo texto libre.** Un error al escribirlo puede dejar pasar un duplicado o bloquear a un hogar legítimo; en ese caso el administrador corrige la dirección a mano.
- Si el negocio llega a tener una cuenta de facturación, se puede añadir un mapa más adelante sin cambiar el modelo de datos, guardando además un identificador de lugar.
