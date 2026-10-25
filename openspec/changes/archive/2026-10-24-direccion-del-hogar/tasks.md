## 1. Distritos

- [x] 1.1 Crear `src/lib/distritos.ts` con `DISTRITOS` (los 9 de v1, `as const`) y el tipo `Distrito`
- [x] 1.2 Prueba `src/lib/distritos.test.ts`: tiene exactamente los 9 distritos de v1 (incluido San Luis) y ninguno de La Molina, Magdalena, Pueblo Libre ni Chorrillos

## 2. Normalización

- [x] 2.1 Crear `src/lib/direccion.ts` con `normalizarTexto` (pasos 1 a 5 del diseño) para calle y departamento, y `normalizarNumero`
- [x] 2.2 Prueba: "Av. Larco", "AVENIDA LARCO", "avda larco" y "Av Larco" dan `avenida larco`; "Jr. Junín" y "Jirón Junin" dan `jiron junin`
- [x] 2.3 Prueba: "Dpto 302", "dpto. 302", "Departamento 302", "DEPTO. 302" y "Dep 302" dan `dpto 302`; `n°`, `nº` y `#` dan `nro`
- [x] 2.4 Prueba: el número "123-A" y "N° 123 A" dan `123a`; el mapeo por palabra completa no cambia "Avenida" ni una calle que contenga "av" dentro de otra palabra
- [x] 2.5 Prueba de idempotencia sobre una muestra con tildes, signos, mayúsculas y abreviaturas
- [x] 2.6 Prueba: "Av. Larco 123" y "Larco 123" dan claves distintas (límite conocido, ADR 0013)

## 3. Validación y clave del hogar

- [x] 3.1 Agregar `esquemaDireccion` (zod) y `validarDireccion` con `validar` de `validacion-sesion.ts`: distrito exacto de `DISTRITOS`, calle no vacía tras normalizar, número con al menos un dígito, recorte de espacios y largos máximos (100, 20, 30 y 200), con mensajes en español de Perú que nombran el dato
- [x] 3.2 Devolver distrito, calle, número, departamento (`null` si vacío), referencias (`null` si vacías), `direccionNormalizada` y `departamentoNormalizado` (`""` si no hay); sin coordenadas ni identificador de lugar
- [x] 3.3 Implementar `claveHogar` (distrito, dirección normalizada, departamento normalizado, sin referencias)
- [x] 3.4 Prueba: distrito "La Molina", ausente o vacío lanza `ErrorApi` con estado `422` y mensaje que pide elegir un distrito atendido
- [x] 3.5 Prueba: calle vacía, solo espacios o ".." lanza `422` pidiendo la calle; número "s/n" o "abc" lanza `422` pidiendo un número con dígito; "123-A" es válido; calle de 101 caracteres lanza `422`
- [x] 3.6 Prueba: departamento y referencias vacíos o ausentes son válidos (casa sin departamento); el original queda `null` y el normalizado `""`
- [x] 3.7 Prueba: " Av. Larco " y "Dpto. 302" se guardan recortados tal como los escribió el cliente, junto con sus versiones normalizadas
- [x] 3.8 Prueba de claves: "Av. Larco 123, Dpto 302" y "Avenida LARCO 123, dpto. 302" (Miraflores) dan la misma clave; "Dpto 302" y "Dpto 303" dan claves distintas; con y sin departamento, distintas; Miraflores y Barranco, distintas; las referencias no cambian la clave
- [x] 3.9 Prueba: el resultado no tiene claves `latitud`, `longitud` ni `place_id`

## 4. Componente del navegador

- [x] 4.1 Crear `app/_componentes/CamposDireccion.tsx` (componente de cliente controlado, props `valor` y `onCambio`) con la lista de los 9 distritos, calle, número, departamento y referencias, etiquetas en español, "(opcional)" en los dos últimos y `required` solo en los obligatorios
- [x] 4.2 Agregar un módulo CSS mínimo, sin scripts ni recursos externos
- [x] 4.3 Prueba `app/_componentes/CamposDireccion.test.ts` con `createElement` y `renderToStaticMarkup`: aparecen las 9 opciones de distrito y los cinco campos, el departamento y las referencias figuran como opcionales, y el HTML no contiene `<script`, `<iframe` ni "google" / "maps"
- [x] 4.4 Confirmar que no se agregó ninguna variable de entorno ni línea nueva en `.env.example`

## 5. Verificación y despliegue

- [x] 5.1 Correr `npm test` y `npx tsc --noEmit` sin errores (sin Playwright)
- [x] 5.2 Correr `npm run build` sin errores
- [x] 5.3 No hay migración: confirmar con `git status` que `src/db/` no cambió y que no se necesita `npm run db:migrate`
- [x] 5.4 Revisar los criterios de dirección de `TECH-DESIGN.md` (campos del asistente, `422` por distrito, `422` por calle o número, normalización, campos opcionales, abreviaturas de "segunda cuenta") contra las pruebas de los grupos 2 a 4; los criterios de persistencia, índice único y concurrencia quedan para #9 y #10
- [x] 5.5 Desplegar con `npx vercel deploy --prod` y comprobar `GET /api/salud` = `200 {"estado":"ok"}` (recordar que los pagos son simulados; no hay variables de entorno nuevas)
- [x] 5.6 Dejar anotado para #9 y #10 que la ruta de reservas debe llamar a `validarDireccion` y que el índice único debe usar `claveHogar` (fuera de este change)
