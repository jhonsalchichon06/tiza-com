## Context

Ítem #10 de `BACKLOG.md`. Depende del #9a (`reservar-y-pagar-primera-membresia`), que está implementado en local (43 de 51 tareas; faltan las de producción). Lo que ya existe y se verificó leyendo el código:

- `src/lib/reservas/gratis.ts`: `decidirLimpiezaGratis(tx, usuarioId)` solo mira al cliente (`pendiente`, `confirmada`, `completada`). Su comentario deja a #10 la comprobación del hogar.
- `src/lib/reservas/crear.ts`: `crearPrimeraReserva` llama a `validarDireccion` fuera de la transacción y, dentro de `transaccionDeEscritura`, a `decidirLimpiezaGratis`; con `calculo.monto > 0` el pago es `membresia_y_reserva`, si no `membresia`. Guarda `primeraGratis: gratis`. Ya envuelve el error con `traducirUnicidad`.
- `src/lib/direccion.ts`: `validarDireccion` devuelve `distrito`, `direccionNormalizada` y `departamentoNormalizado`; `claveHogar` extrae esas tres.
- `src/db/esquema.ts`: `reservas.primera_gratis` (booleano, por defecto falso), `distrito`, `direccion_normalizada`, `departamento_normalizado` (`NOT NULL`, por defecto `''`). Índices actuales: `reservas_un_pago_por_reserva_viva` y `reservas_una_pendiente_por_cliente`. Última migración: `0004`.
- `src/lib/reservas/unicidad.ts`: `traducirUnicidad` lee `error.cause.code` y `error.cause.constraint` y traduce tres índices a `409` `en_espera`.
- `src/lib/agenda/expirar.ts`: `transaccionDeEscritura` marca `expirada` las pendientes vencidas al empezar. `src/db/reservas-activas.ts`: `reservaActiva` (`confirmada` o `pendiente` con `expira_en > now()`) no incluye `completada`.
- `src/lib/reservas/cotizar.ts`: `cotizarPrimeraReserva` cotiza siempre con `aplicaGratis: true`; `GET /api/cotizacion` no toca la base ni recibe dirección.
- `calcularServicio` aplica siempre el descuento de miembro; sin horas gratis el monto es lista × 0,9 (change `calculo-precio-duracion`, decisión 6).
- Pruebas contra Neon: `src/db/pruebas-bd.ts` (`crearEscenario`, `crearDuenos`, equipos de prueba inactivos, `contarRastros`), `vitest.bd.config.ts` y `crear-reserva.bd.test.ts`.
- No hay `<!-- REVISAR -->` del PRD que afecte a este ítem. Existe otro change en curso (`revision-de-pagos-admin`, #11): no se toca.

**Reglas del entorno:** las migraciones se generan y se aplican **solo** a la rama de Neon `pruebas` (`DATABASE_URL_PRUEBAS`, `PRUEBAS_BD=1`); la `DATABASE_URL` local es la de producción y el usuario decidió no migrar ni desplegar producción hasta terminar los 18 ítems. Sin Playwright.

## Goals / Non-Goals

**Goals:**

- Una limpieza gratis por cliente y por hogar, garantizada por la base de datos aunque haya peticiones simultáneas (ADR 0008).
- Que la segunda cuenta en el mismo hogar cree su reserva y pague el precio completo (con descuento de miembro), y que la cotización lo anticipe.
- Una sola definición de "esta reserva cuenta para la limpieza gratis", válida para leer y para escribir, que ignore las vencidas (ADR 0009).
- Dejar `decidirLimpiezaGratis` lista para #12 y #13, que la reutilizan.

**Non-Goals:**

- Coincidencias aproximadas de dirección y rechazo del pago por el administrador (#11).
- Reuso de la limpieza gratis al cancelar la primera, conversión de horas adicionales a crédito y su perfil (#12, #14). Aquí solo se garantiza que `cancelada` y `expirada` no cuentan.
- Reserva de un miembro con descuento (#13), pantalla del asistente (9b), verificación de la dirección en un mapa (PRD, "No alcance").
- Normalizar mejor la dirección: "Av. Larco 123" y "Larco 123" siguen siendo hogares distintos (ADR 0013, riesgo aceptado).
- Migrar o desplegar producción (diferido hasta cerrar los 18 ítems).

## Decisions

### 1. Dos índices únicos parciales, con nombre propio (ADR 0008 y 0013)

```
UNIQUE INDEX reservas_primera_gratis_por_cliente (usuario_id)
  WHERE primera_gratis AND estado IN ('pendiente','confirmada','completada')
UNIQUE INDEX reservas_primera_gratis_por_hogar (distrito, direccion_normalizada, departamento_normalizado)
  WHERE primera_gratis AND estado IN ('pendiente','confirmada','completada')
```

Se declaran con `uniqueIndex(...).on(...).where(sql\`...\`)` en `src/db/esquema.ts` y se genera `0005` con `npm run db:generate -- --name=una-gratis-por-cliente-y-hogar`. Los nombres siguen el estilo de los índices de 9a y son los que `traducirUnicidad` reconocerá.

- **Por qué:** es lo que fijan los ADR 0008 y 0013 y `TECH-DESIGN.md`; solo la base garantiza la regla bajo concurrencia. `cancelada` y `expirada` quedan fuera del predicado, y eso permite reusar la limpieza gratis.
- **Descartada:** una restricción `UNIQUE` completa. Impediría que el hogar tenga reservas pagadas y que se reuse tras cancelar.
- **Descartada:** `SELECT ... FOR UPDATE` o un candado consultivo por hogar. Es viable, pero el índice ya serializa a quien compite y no bloquea a quien no.
- **Descartada:** `CREATE INDEX CONCURRENTLY`. `reservas` está vacía y Drizzle ejecuta cada migración en una transacción.
- **Precondición:** el índice falla si ya hay dos reservas gratis vivas del mismo cliente u hogar. 9a creaba `primera_gratis` siempre verdadero y `reservas` está vacía en `pruebas` y en producción; se comprueba con una consulta de solo lectura antes de aplicar.
- **Predicado:** se usa el mismo texto que ya usa `reservas_un_pago_por_reserva_viva` para el `IN`, más `primera_gratis`. Una prueba lee el SQL de `0005` y exige ambos `WHERE`.

### 2. Una sola condición de "cuenta" para leer y escribir

`src/db/reservas-activas.ts` exporta, junto a `reservaActiva`, `reservaQueCuentaParaGratis = or(reservaActiva, eq(estado, 'completada'))`. `decidirLimpiezaGratis` la usa para la regla del cliente y la del hogar. La regla del cliente cambia de `estado IN (...)` a este fragmento: dentro de `transaccionDeEscritura` da lo mismo (las vencidas ya están `expirada`), pero la misma función sirve para la cotización, que lee sin marcar nada.

- **Por qué:** el ADR 0009 pide centralizar la condición "pendiente con `expira_en > now()`" para que ninguna consulta la olvide. Sin ella, la cotización diría "sin gratis" por una vencida que el POST sí ignoraría.
- **Descartada:** reusar `reservaActiva` tal cual. No incluye `completada`, que sí cuenta para la limpieza gratis (la primera ya realizada).
- **Descartada:** dos funciones, una para leer y otra para escribir. Se desviarían con el tiempo.
- **Comparación del hogar:** `primera_gratis` verdadero y `(distrito, direccion_normalizada, departamento_normalizado)` iguales a `claveHogar`. Se compara la clave, no el texto original.
- **Firma:** `decidirLimpiezaGratis(tx, usuarioId, hogar: ClaveHogar)`. El parámetro es obligatorio, para que #12 y #13 no puedan olvidar el hogar. Se agrega una prueba de TypeScript con `// @ts-expect-error` que lo fija.
- **Diferencia con el índice:** el índice cuenta `estado = 'pendiente'` aunque esté vencida; la consulta no. Es seguro por la decisión 5.

### 3. Segunda cuenta: se crea la reserva con el precio completo

Si `decidirLimpiezaGratis` da falso por el hogar, `crearPrimeraReserva` ya calcula `calcularServicio({ aplicaGratis: false })`, guarda `primera_gratis` falso y `horas_gratis_aplicadas` 0, y el pago pasa a `membresia_y_reserva` con membresía + monto sin horas gratis (ya existe: `calculo.monto > 0`). El cambio en `crear.ts` es pasar `claveHogar(direccion)`.

- **"Precio completo" quiere decir precio de lista con el 10% de descuento de miembro y sin las 3 horas gratis.** Es el monto que ya calcula `calcularServicio` con `aplicaGratis: false`; la segunda cuenta también está pagando la membresía en ese paso (ADR 0008, decisión de `calculo-precio-duracion`). Ejemplo: estándar 2/1 → S/ 129 × 0,9 = S/ 116,10, y el pago es S/ 267 + S/ 116,10.
- **Descartada:** rechazar la reserva con `422`/`409` cuando el hogar ya recibió la limpieza. El PRD dice que la segunda cuenta "paga el servicio completo", no que se le niegue.
- **Descartada:** cobrar el precio de lista sin descuento. Contradice el cálculo de #4 y el PRD, que da 10% a quien es miembro.

### 4. Carrera: `409` con código `limpieza_gratis_usada`, sin reintentar con otro precio

Cuando dos transacciones deciden `gratis = true` para el mismo hogar, la segunda inserción espera al índice y, si la primera se confirma, falla con `23505`. `traducirUnicidad` añade:

- `reservas_primera_gratis_por_hogar` → `409`, código `limpieza_gratis_usada`, "Otra cuenta ya recibió la limpieza gratis de esta dirección. Revisa el precio actualizado y confirma de nuevo."
- `reservas_primera_gratis_por_cliente` → `409`, mismo código, "Ya tienes una limpieza gratis reservada o realizada." En la práctica la carrera del mismo cliente la corta antes `membresias_una_pendiente_por_cliente` (la membresía se inserta primero); este índice es la red de seguridad para #12 y #13.

La transacción entera se deshace, así que no queda membresía ni pago. Si la ganadora falla antes del commit, la perdedora entra con las horas gratis (el índice libera la espera). `conReintento` no reintenta un `ErrorApi`.

- **Por qué `409` y no reintentar con `gratis = false`:** el comprobante ya está subido por el monto que el cliente vio. Cobrar otro monto en silencio crea un pago que no coincide con la imagen. Un `409` claro le deja revisar el precio. Es el mismo patrón de 9a para las otras carreras.
- **Descartada:** repetir la transacción con `gratis = false`. Es viable y más cómoda, pero decide el precio por el cliente. Si el negocio prefiere esa experiencia, el cambio está acotado a un `catch` en `crear.ts`.
- **Descartada:** reutilizar el código `en_espera`. 9b debe poder distinguir "ya tienes una reserva o pago en revisión" de "elige de nuevo con el precio completo".
- **Orden de los errores (no verificado, se comprueba en las pruebas contra Neon):** si una inserción viola a la vez la exclusión por equipo y un índice único, no se asume cuál informa Postgres primero. Para evitar ambigüedad, las pruebas de concurrencia usan días distintos para cada cuenta, de modo que solo compiten por el hogar. Si dos cuentas piden el mismo hogar **y** el mismo horario, cualquiera de los dos `409` es correcto.

### 5. Hallazgo de 9a: el `409` que deshace la marca `expirada` no afecta a la regla

Dentro de `transaccionDeEscritura`, `expirarVencidas` marca `expirada` las pendientes vencidas y después se corren las comprobaciones. Si una comprobación lanza `409`, `ROLLBACK` deshace también esa marca: la vencida sigue `pendiente` en disco. ¿Rompe la regla de "una limpieza gratis" (las `expirada` y `cancelada` no cuentan)?

- **No, por tres razones verificadas en el código:** (a) toda inserción de una reserva pasa por `transaccionDeEscritura` (la única llamada a `insert(reservas)` es `insertarEnPrimerEquipoLibre`, ya envuelta por `crearPrimeraReserva`), así que la siguiente escritura vuelve a marcarla antes de decidir y de insertar; el `UPDATE` espera si otra transacción tiene la fila, y al reevaluar la condición ve el resultado. (b) Las lecturas (cotización, agenda) no dependen de la marca porque usan `reservaQueCuentaParaGratis`. (c) Una vencida que nadie marcó nunca provoca un `23505` falso, porque `expira_en <= now()` y la marca usan el mismo `now()` de la transacción.
- **Lo que se hace:** (1) la decisión de la decisión 2 (fragmento con `expira_en > now()`); (2) una prueba contra Neon que reproduce el caso: una escritura marca la vencida y falla con `409`, la vencida sigue `pendiente`, y otra cuenta con el mismo hogar recibe las horas gratis y deja la vencida `expirada`; (3) una prueba que falla si aparece otro `insert(reservas)` fuera de `asignar.ts`, para que el invariante (a) no se rompa en #11, #12 o #13.
- **Descartada:** marcar `expirada` fuera de la transacción que puede fallar (una segunda transacción tras el `409`). Añade escrituras en el camino de error y no corrige nada que la regla necesite.
- **Descartada:** meter la condición de vencimiento en el predicado del índice. Postgres exige expresiones inmutables y `now()` no lo es (ADR 0009).
- **Riesgo residual:** un insert futuro fuera de `transaccionDeEscritura` podría chocar con una vencida sin marcar. La prueba de la tercera acción lo detecta.

### 6. La cotización decide con la misma función

`GET /api/cotizacion` acepta `distrito`, `calle`, `numero` y `departamento`. Si llega alguno de los tres primeros, valida con `validarDireccion` y llama a `decidirLimpiezaGratis(tx_o_db, usuario.id, claveHogar(direccion))`; sin dirección usa solo la regla del cliente (consulta con `hogar` nulo: `decidirLimpiezaGratis` expone `decidirPorCliente` y `decidirPorHogar`, y la compone). `cotizarPrimeraReserva(config, servicio, ahora, { aplicaGratis })` recibe la decisión; sin cuarto argumento se comporta como hoy. La respuesta agrega `motivo_sin_gratis`: `null`, `"cliente"` o `"hogar"`. La ruta lee con la conexión HTTP/WebSocket de `db()` bajo `conReintento` y no escribe.

- **Por qué:** el criterio de `TECH-DESIGN.md` dice que la segunda cuenta "ve el precio completo". Sin esto vería las 3 horas gratis y el POST la cobraría distinto.
- **Descartada:** una ruta nueva (`/api/cotizacion/hogar`). Duplica la validación y los parámetros.
- **Descartada:** devolver siempre ambas cotizaciones. Dobla el cálculo y expone una cifra que no aplica.
- **Descartada:** exigir la dirección en la cotización. 9b cotiza antes de pedirla; seguir aceptando la consulta sin dirección no rompe a nadie.
- **Contrato con 9b (no se edita aquí):** el asistente debe volver a cotizar con la dirección una vez escrita, y mostrar `motivo_sin_gratis`. Se propone en el reporte.
- **Privacidad:** `motivo_sin_gratis: "hogar"` revela que esa dirección ya recibió la oferta. Es información de bajo riesgo (no dice quién) y es inherente a mostrar el precio completo; ver Riesgos.

### 7. Pruebas contra la rama `pruebas`

`src/db/gratis-por-hogar.bd.test.ts` reutiliza `crearEscenario`/`crearDuenos` (soporte de 9a), equipos de prueba inactivos y fechas de 2099 con un día distinto por prueba. Cubre los índices directamente (`intentarInsertar`), `crearPrimeraReserva` de punta a punta (segunda cuenta, variantes de escritura, dos departamentos, cancelada, vencida, 409 que deshace) y la concurrencia (2 y 10 peticiones). `contarRastros()` debe dar 0 al terminar. Los índices necesitan que `filaReserva` admita `primeraGratis`, `distrito`, `direccionNormalizada` y `departamentoNormalizado`; se amplía su `Opciones` sin cambiar los valores por defecto.

- **Descartada:** probar los índices solo con dobles. Un doble no demuestra que la base rechace la carrera.

## Cobertura de los criterios de `TECH-DESIGN.md`

| Criterio (flujo "Reservar y pagar la membresía") | Escenario de spec | Tarea |
|---|---|---|
| Quien ya tuvo la limpieza gratis no recibe otra, ni al renovar | `limpieza-gratis-por-hogar`: "Quien ya tuvo su limpieza gratis no recibe otra"; índice por cliente | 2.2, 3.2, 5.2 |
| Segunda cuenta, misma dirección y departamento escritos distinto → precio completo | "Segunda cuenta en el mismo hogar paga el precio completo" y "La misma dirección escrita de otra forma"; cotización "Hogar que ya recibió la limpieza gratis" | 3.2, 4.2, 5.2 |
| Dos departamentos distintos del mismo edificio, cada uno su limpieza | "Dos departamentos distintos del mismo edificio" | 3.2, 5.2 |
| Mismo edificio con otro número de departamento sí recibe | mismo escenario y "El mismo edificio sin departamento frente a uno con departamento" | 3.2, 5.2 |
| Primera cancelada → la siguiente recibe las 3 horas | "Reuso tras cancelar" y "La reserva cancelada o expirada libera la limpieza gratis" (el flujo de cancelar es del #12) | 2.2, 5.2 |
| Dos peticiones simultáneas por la misma dirección: solo una | "Dos cuentas, mismo hogar, al mismo tiempo" y "Diez cuentas por el mismo hogar" | 5.3 |
| (PRD, caso borde 10) la segunda cuenta ve el precio completo | spec `cotizacion-con-hogar` | 4.1 a 4.4 |
| (ADR 0009) vencidas no cuentan; hallazgo del 9a | "Las reservas vencidas no cuentan para la limpieza gratis" | 3.3, 5.4, 5.5 |

Los criterios "al revisar un pago el administrador ve las coincidencias" y "una primera limpieza cancelada no genera crédito por sus 3 horas" son de #11 y #14.

## Risks / Trade-offs

- **La normalización no detecta toda variante.** "Av. Larco 123" y "Larco 123" son hogares distintos; la defensa es el administrador en #11 (ADR 0013). Es un riesgo aceptado, mayor que con `place_id`.
- **Un departamento mal escrito** puede dejar pasar un duplicado o bloquear a un hogar legítimo; el administrador corrige la dirección a mano (ADR 0013).
- **Cobro distinto al cotizado en la carrera.** Por eso la perdedora recibe `409`. Aun así, si el precio cambia entre la cotización y el POST por un cambio de hogar anterior (no por carrera), el cliente puede subir un comprobante por el monto antiguo: 9b debe cotizar con la dirección y #11 verá el monto al aprobar. Divergencia ya aceptada en 9a.
- **Fuga de información menor:** cualquier cliente con sesión puede preguntar a la cotización si una dirección ya recibió la limpieza gratis. No revela quién, solo que sí. Se acepta; el límite de frecuencia sigue pendiente en `BACKLOG.md`.
- **Falsos bloqueos por escritura "desde otra cuenta":** alguien puede reservar con la dirección de otra persona antes que ella y quitarle la oferta. Lo contiene el administrador en #11 (rechazar el pago). Queda anotado.
- **La migración no tiene "deshacer"** en Drizzle: la marcha atrás es `DROP INDEX` de los dos índices.
- **Producción diferida:** hasta aplicar `0005` en producción, la base de producción no tiene los índices. La app local contra producción funcionaría solo por la comprobación del servidor, sin la garantía ante carreras. No se despliega hasta cerrar los 18 ítems.

## Migration Plan

1. Comprobar con una consulta de solo lectura que la rama `pruebas` no tiene dos reservas gratis vivas del mismo cliente u hogar (hoy `reservas` está vacía).
2. Cambiar `src/db/esquema.ts` y generar `0005` con `npm run db:generate -- --name=una-gratis-por-cliente-y-hogar`; revisar que el SQL solo cree los dos índices.
3. Aplicarla **solo a la rama `pruebas`** con `node -e "require('dotenv').config({path:'.env.local',quiet:true});process.env.DATABASE_URL=process.env.DATABASE_URL_PRUEBAS;require('child_process').execSync('npx drizzle-kit migrate',{stdio:'inherit'})"` (no imprime la cadena) y correr `PRUEBAS_BD=1 npx vitest run --config vitest.bd.config.ts`.
4. **Diferido hasta cerrar los 18 ítems:** `npm run db:migrate` contra producción **antes** de desplegar, `npx vercel deploy --prod` y `GET /api/salud` = `200 {"estado":"ok"}`.
5. Marcha atrás: `DROP INDEX reservas_primera_gratis_por_cliente, reservas_primera_gratis_por_hogar` y redesplegar el commit anterior.

## Open Questions

1. **¿Se acepta el `409` en la carrera, o el negocio prefiere que la perdedora pase a pagar el precio completo en silencio?** Se eligió el `409` (decisión 4). Reversible con un cambio acotado.
2. **9b debe cotizar con la dirección.** ¿Se ajusta el change `asistente-de-reserva` para volver a cotizar tras el paso de dirección y mostrar `motivo_sin_gratis`? Este change no lo edita.
3. **Nota para `BACKLOG.md` (no se edita):** al construir, #10 reemplazó el pendiente "Ítems 9 y 10 con la dirección" y el de "#10: agrega los índices"; conviene marcarlos como resueltos al archivar. #12 y #13 deben pasar `claveHogar` a `decidirLimpiezaGratis`; todo `insert` de reservas debe seguir en `asignar.ts`.

## Resultados de la implementación

- **Migración `0005` en la rama `pruebas` (tarea 1.5).** Ensayada en `BEGIN ... ROLLBACK` (dentro: 2 índices; después del rollback: 0) y aplicada solo a la rama `pruebas` con `DATABASE_URL_PRUEBAS`. Comprobado con consultas de solo lectura: existen `reservas_primera_gratis_por_cliente` y `reservas_primera_gratis_por_hogar`, `reservas_sin_solape_por_equipo` sigue ahí y la rama pasó de 5 a 6 migraciones. Producción, consultada solo en lectura: 4 migraciones y 0 índices `reservas_primera_gratis%` (sin cambios). Antes de aplicar, `reservas` estaba vacía en `pruebas` y no había duplicados.
- **Orden de los errores (tarea 5.3).** Dos cuentas con el mismo hogar y el mismo horario, con un solo equipo y una barrera que hace que ambas decidan gratis antes de insertar: Postgres informó la exclusión por equipo (`conflicto`), no el índice del hogar; la inserción en el equipo falla antes de llegar al índice de `primera_gratis`. Con días distintos (solo compiten por el hogar) informa `reservas_primera_gratis_por_hogar` y la respuesta es `409 limpieza_gratis_usada`. Sin barrera, en 4 rondas de carrera natural las 4 terminaron con `409 limpieza_gratis_usada` para la perdedora y nunca hubo dos gratis.
- **Ajuste del 9b hecho en este mismo apply** (a pedido del coordinador, sin editar el change `asistente-de-reserva`): al llegar al paso de pago el asistente vuelve a cotizar con la dirección (`GET /api/cotizacion?...&distrito&calle&numero&departamento`), muestra el texto de `motivo_sin_gratis` y, si el POST responde `409 limpieza_gratis_usada`, vuelve a cotizar y pide otro comprobante por el monto nuevo.
