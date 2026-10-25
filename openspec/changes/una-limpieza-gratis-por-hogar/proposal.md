## Why

Hoy, tras el change `reservar-y-pagar-primera-membresia` (9a), la primera reserva siempre recibe las 3 horas gratis: `decidirLimpiezaGratis` solo mira al cliente y nada comprueba el hogar. Basta abrir otra cuenta con otro correo y la misma dirección para repetir la oferta, que es justo lo que el PRD quiere evitar ("Una sola limpieza gratis por cliente y por hogar", "Alcance" punto 3; caso borde 10). Además la base de datos no garantiza nada: dos peticiones simultáneas podrían recibir las dos la limpieza gratis.

Este es el ítem #10 de `BACKLOG.md` (depende del #9a, ya implementado en local). Sigue el ADR 0008 (reglas de la limpieza gratis e índices únicos parciales), el ADR 0013 (la clave del hogar es `(distrito, direccion_normalizada, departamento_normalizado)`; el ADR 0011 de Google Maps quedó reemplazado) y el ADR 0009 (reservas vencidas).

No hay ningún `<!-- REVISAR -->` del PRD que bloquee este ítem.

## What Changes

- **Migración nueva (`0005`)** con dos índices únicos parciales sobre `reservas` donde `primera_gratis` es verdadero y el estado es `pendiente`, `confirmada` o `completada`: uno por cliente (`usuario_id`) y otro por hogar (`distrito`, `direccion_normalizada`, `departamento_normalizado`). Las reservas `cancelada` y `expirada` no cuentan, así que la limpieza gratis se puede reusar si la primera se cancela. La columna `primera_gratis` ya existe. Se genera y se aplica solo a la rama de Neon `pruebas`.
- **`decidirLimpiezaGratis` recibe la clave del hogar** (`claveHogar` de `src/lib/direccion.ts`) y devuelve verdadero solo si el cliente no tiene reservas vivas o realizadas **y** esa dirección no tiene una reserva gratis viva o realizada. `crearPrimeraReserva` pasa la clave del hogar que ya calcula `validarDireccion`. Una segunda cuenta en el mismo hogar crea su reserva sin horas gratis y paga el precio completo con el descuento de miembro (sin las 3 horas gratis); el pago pasa a concepto `membresia_y_reserva` por la membresía más ese monto.
- **Una sola condición de "cuenta" para leer y escribir** (`reservaQueCuentaParaGratis` junto a `reservaActiva`): `confirmada`, `completada` o `pendiente` con `expira_en > now()`. Así una pendiente vencida que nadie ha marcado `expirada` no bloquea la limpieza gratis ni al leer ni al escribir.
- **Peticiones simultáneas con la base como garantía:** si dos peticiones pasan ambas la comprobación, el índice único hace fallar a la segunda con `23505`. `traducirUnicidad` lo convierte en `409` con el código `limpieza_gratis_usada` y un mensaje que pide revisar el precio; no se cobra un monto que el cliente no vio.
- **`GET /api/cotizacion` acepta la dirección (opcional)** (`distrito`, `calle`, `numero`, `departamento`) y, con ella, cotiza sin horas gratis si el hogar ya la recibió; la respuesta indica `aplica_gratis` y `motivo_sin_gratis`. Es lo que hace que la segunda cuenta "vea el precio completo".
- **Hallazgo del 9a (`409` que deshace la marca `expirada`)** analizado en `design.md`: no afecta a la regla, porque todo insert de reserva corre dentro de `transaccionDeEscritura` (que vuelve a marcar las vencidas) y las lecturas ignoran las vencidas. Se deja una prueba contra Neon y una prueba que fija ese invariante.

**Fuera de alcance** (otros ítems): coincidencias aproximadas de dirección para el administrador y rechazo del pago (#11); reuso de la limpieza gratis al cancelar la primera y las horas adicionales a crédito (#12 y #14, que reutilizan `decidirLimpiezaGratis`); reserva de un miembro (#13); la pantalla del asistente (9b). Verificación de la dirección en un mapa, cupones y referidos están fuera del PRD ("No alcance"). La migración a producción y el despliegue quedan diferidos hasta cerrar los 18 ítems, por decisión del usuario.

## Capabilities

### New Capabilities

- `limpieza-gratis-por-hogar`: índices únicos parciales de `primera_gratis`, regla del cliente y del hogar en `decidirLimpiezaGratis`, segunda cuenta sin horas gratis, garantía ante peticiones simultáneas y comportamiento con reservas vencidas.
- `cotizacion-con-hogar`: la cotización toma en cuenta la dirección para decidir si aplica la limpieza gratis.

### Modified Capabilities

(ninguna: las specs de 9a todavía no están archivadas en `openspec/specs/`; este change solo agrega.)

## Impact

- **Código:** `src/db/esquema.ts` (dos índices), `src/db/migraciones/0005_*.sql` y su snapshot, `src/db/reservas-activas.ts`, `src/lib/reservas/gratis.ts`, `crear.ts`, `unicidad.ts`, `cotizar.ts`, `rutas.ts`, `src/lib/agenda/consulta.ts` (solo si hace falta reutilizar el parser de parámetros), y las pruebas junto a cada uno más `src/db/gratis-por-hogar.bd.test.ts`.
- **API:** `GET /api/cotizacion` gana parámetros opcionales y el campo `motivo_sin_gratis`; `POST /api/reservas` gana el `409` `limpieza_gratis_usada`. Ambos cambios son compatibles hacia atrás.
- **Datos:** migración `0005` solo crea índices (sin tocar filas). Exige que no existan ya dos reservas gratis vivas del mismo cliente u hogar; `reservas` está vacía en `pruebas` y en producción.
- **Coordinación:** el change 9b (`asistente-de-reserva`) pide la cotización antes de la dirección; para mostrar el precio completo debe volver a cotizar con la dirección. Se propone en el reporte; este change no lo edita.
