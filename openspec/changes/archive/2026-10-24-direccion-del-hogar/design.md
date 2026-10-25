## Context

El ADR 0013 reemplaza al 0011: la dirección son campos de texto, sin mapa. Fija los cinco campos, la validación del servidor, la normalización y la clave del hogar `(distrito, direccion_normalizada, departamento_normalizado)`, que a su vez ajusta el ADR 0008. El ADR 0011 no se usa como guía.

Estado del código (verificado):

- No existe todavía la tabla `reservas` ni ninguna lista de distritos en `src/` (solo la demo `demo/reservar.html` tiene las 9 opciones). Por eso este ítem no toca el esquema: las columnas `distrito`, `calle`, `numero`, `departamento`, `departamento_normalizado`, `referencias` y `direccion_normalizada` las crea quien cree `reservas` (#6/#9), y los índices únicos son de #10.
- `ErrorApi.invalido` (`src/lib/errores.ts`) da el `422` del formato único, y `validar` (`src/lib/validacion-sesion.ts`) ya traduce zod a ese error con mensajes en español usando `zod` v4. Se sigue el mismo patrón.
- Los formularios de cuenta (`app/(cuenta)/Formulario.tsx`) son componentes de cliente con CSS Modules. Vitest solo incluye `*.test.ts` (no `.tsx`) y no hay jsdom.

## Goals / Non-Goals

**Goals:**
- Un módulo puro, `validarDireccion(entrada)`, que devuelva la dirección validada y normalizada, y `claveHogar(direccion)`.
- Un componente reutilizable con los cinco campos para el paso 2 del asistente.
- Cubrir con pruebas todos los criterios de aceptación de dirección de `TECH-DESIGN.md` que dependen de este ítem.

**Non-Goals:**
- Guardar la dirección: columnas de `reservas` (#6/#9), índice único por hogar y "una limpieza gratis por hogar" (#10; esa parte de los criterios "segunda cuenta", "dos departamentos" y "peticiones simultáneas" se verifica allí).
- La ruta `POST /api/reservas` (#9): aquí solo se entrega la función que esa ruta llamará. Este change no agrega rutas.
- Las coincidencias aproximadas para el administrador (calle parecida, otro departamento): son de #11.
- Verificar que la calle exista o esté en el distrito, geocodificar o guardar coordenadas (fuera de alcance, PRD "No alcance").
- El asistente completo y su estilo final (#9); el componente usa estilos mínimos propios.

## Decisions

### 1. Módulo puro con zod, sin base ni reloj

`src/lib/direccion.ts` exporta `esquemaDireccion` (zod), `validarDireccion(cuerpo)` y `claveHogar(d)`. `validarDireccion` usa `validar` de `validacion-sesion.ts` para producir `ErrorApi.invalido` con el primer mensaje.

- **Por qué:** se prueba sin base ni mocks y #9/#10 lo llaman dentro de su transacción. Sigue el patrón ya construido en el ítem 2.
- **Descartada:** validar con expresiones sueltas en la ruta de #9. Duplicaría reglas en cada consumidor (#9, #13 al reprogramar). Respalda: ADR 0013 ("el servidor ... no confía en la lista del navegador").

### 2. Distritos como constante en código, no en `configuracion`

`src/lib/distritos.ts` exporta `DISTRITOS` (tupla `as const` de 9 nombres, orden alfabético) y el tipo `Distrito`. El servidor y el componente importan la misma lista.

- **Por qué:** los 9 distritos son un límite de alcance del PRD, no un parámetro de negocio ajustable; ampliarlos exige antes cambiar el PRD. Una sola constante evita que el navegador y el servidor se desalineen (el PRD ya señala que la demo listaba distritos distintos).
- **Descartada:** guardarlos en `configuracion` (lo exigido para precios y plazos). Requeriría migración y validación de otra clave sin ganar nada, porque cambiarlos no es una operación de negocio sino un cambio de alcance. Se deja constancia: no choca con el ADR 0013 ni el 0008, que solo piden "lista cerrada".

### 3. Normalización por tokens

Pasos, en este orden, sobre calle y departamento: (1) NFD y quitar marcas combinadas, minúsculas; (2) reemplazar `n°`, `nº` y `#` por ` nro `; (3) reemplazar todo lo que no sea letra o dígito por espacio; (4) dividir en palabras y mapear abreviaturas completas (`av`, `avda` → `avenida`; `jr` → `jiron`; `dpto`, `dep`, `depto`, `departamento` → `dpto`); (5) unir con un espacio. El número aplica los mismos pasos 1 a 3, quita un `nro` inicial y une sin espacios.

- **Por qué:** el mapeo por palabra completa evita corromper nombres de calle (por ejemplo "Avenida" o "Jr" dentro de otra palabra), y es idempotente. "Peña" y "Pena" se igualan al quitar la tilde de la ñ, lo que favorece detectar duplicados. Es exactamente lo que enumera el ADR 0013.
- **Descartada:** usar `normalize("NFKD")` o una biblioteca de slugs; añade comportamiento no pedido (por ejemplo, transliterar símbolos) y una dependencia. Descartada también una lista mayor de abreviaturas (`int`, `urb`, `mz`, `lt`, `psje`): el ADR 0013 fija solo estas; ampliarla es una decisión de negocio para después de ver direcciones reales.
- **Número sin espacios:** "123 A" y "123A" dan la misma clave. Descartado conservar los espacios, porque separaría escrituras que casi seguro son la misma puerta.

### 4. Reglas de validación

- Distrito: coincidencia exacta con `DISTRITOS` tras recortar espacios (el navegador envía el nombre de la lista). No se acepta otra grafía, para que el valor guardado sea siempre el canónico.
- Calle: no vacía y con al menos un carácter tras normalizar (rechaza "..").
- Número: al menos un dígito (`/\d/`), como pide el ADR 0013.
- Largos: calle 100, número 20, departamento 30 y referencias 200. Son un supuesto mío (el ADR no fija topes) para acotar datos y evitar abuso; se anotan en Riesgos.
- Departamento y referencias opcionales: vacíos o solo espacios se guardan como `null` (original) y, para el departamento, `""` normalizado.

### 5. Clave del hogar sin las referencias

`claveHogar` devuelve `{ distrito, direccionNormalizada, departamentoNormalizado }`. Las referencias ("puerta verde") quedan fuera porque son solo para el personal (ADR 0013) y cambiarlas no cambia la casa.

- **Descartada:** incluir calle y número en columnas separadas dentro de la clave. El ADR 0013 fija `direccion_normalizada` (calle más número) como parte de la clave.

### 6. Componente de formulario controlado, con la lógica en el servidor

`app/_componentes/CamposDireccion.tsx` es un componente de cliente controlado: recibe `valor` y `onCambio` (los cinco campos como texto) y muestra una lista de distritos, calle, número, departamento y referencias, con etiquetas en español, `autoComplete="off"` en la calle y el número (el autocompletado del navegador mezclaría la dirección en un solo campo) y el texto "(opcional)" en los dos campos que lo son. No valida más allá de atributos de ayuda (por ejemplo `required` en los obligatorios): el servidor es quien decide.

- **Por qué:** #9 incrusta los campos dentro de su propio estado de asistente y envía todo a la API. El navegador no repite la normalización (la clave del hogar la calcula solo el servidor), igual que no recalcula precios (ADR 0008).
- **Descartada:** un formulario completo con su propio envío (como `Formulario.tsx`). El paso 2 del asistente reúne además hogar y servicio, y se envía junto con el comprobante en una sola petición (`POST /api/reservas`), así que un envío propio sobraría.
- La prueba del componente usa `renderToStaticMarkup` de `react-dom/server` desde un `*.test.ts` con `createElement`, porque Vitest no incluye `.tsx` ni hay jsdom y no se quiere cambiar su configuración ni agregar dependencias.

## Risks / Trade-offs

- **La dirección no se verifica (ADR 0013):** un cliente puede escribir una calle que no existe o un distrito que no corresponde. El personal lo nota al llegar y el administrador puede escribirle por WhatsApp. Está registrado en el PRD ("Dirección sin verificar").
- **La limpieza gratis repetida es más fácil de eludir:** "Av. Larco 123" y "Larco 123" no dan la misma clave. La defensa es el administrador con las coincidencias de #11. Aceptado por el ADR 0013.
- **El departamento es texto libre:** "302" y "Dpto 302" dan claves distintas, porque solo se unifican las abreviaturas listadas, no se quita el prefijo. Un error al escribirlo puede dejar pasar un duplicado o bloquear a un hogar legítimo; el administrador corrige la dirección a mano.
- **Largos máximos y lista de abreviaturas son supuestos míos:** si el negocio ve direcciones reales que no caben o que no se unifican (`interior`, `mz`, `lt`), se ajustan en el módulo con una prueba nueva.
- **Cambiar la normalización después de tener datos** obligaría a recalcular `direccion_normalizada` de las reservas guardadas; mientras no haya reservas (hoy no hay) el costo es nulo. Conviene fijarla bien antes de que #9 guarde datos.
- Sin mapa no se puede validar que el distrito corresponda a la dirección; el distrito lo declara el cliente (ADR 0013).

## Migration Plan

No hay migración ni variables de entorno nuevas. Se despliega el código; `GET /api/salud` debe seguir en `200 {"estado":"ok"}`. Revertir es quitar el código, que nadie consume todavía.

## Open Questions

Ninguna bloquea. Para la revisión: confirmar los largos máximos y la lista de abreviaturas (Decisiones 3 y 4). Al implementar #9, esa ruta debe llamar a `validarDireccion` y guardar el resultado en las columnas de `reservas`; y #10 debe crear el índice único con la clave de este módulo.
