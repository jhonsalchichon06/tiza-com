# ADR 0008: Precios, pago por reserva y vínculo de cada reserva con su membresía

## Estado

Aceptado

## Contexto

El modelo del ADR 0002 solo cobraba la membresía. Pero la landing y el asistente de reserva cobran cada visita aparte, con 10% de descuento para miembros. El PRD se actualizó: cada limpieza que no es la gratis se paga por adelantado con el mismo flujo de la membresía (Yape o transferencia, comprobante y aprobación del administrador).

El PRD también fijó estas reglas:

- **Duración por tamaño del hogar:** la limpieza estándar dura según 4 niveles. Se usa el primer nivel cuyos dormitorios y baños cubren el hogar: 1 baño sin dormitorios → 2 h; hasta 1 dormitorio y 1 baño → 3 h; hasta 2 dormitorios y 2 baños → 4 h; más grande → 6 h, que es el máximo. La profunda dura 1 h más y la de mudanza, 2 h más. Los horarios de inicio se ofrecen cada 30 minutos.
- **Precio por tamaño:** el precio del nivel (S/ 66, 99, 129 o 189) × 1, 1,5 o 1,7 según el tipo. Los servicios por horas son paquetes de precio fijo (3, 4, 6 y 8 h).
- **Hogares grandes:** si un servicio por tamaño dura más de 6 horas con 1 persona, va una persona de apoyo (que no es del equipo y la coordina el administrador) y el servicio ocupa en la agenda la mitad del tiempo, redondeado hacia arriba a 30 minutos. El precio se sigue calculando sobre las horas de trabajo de 1 persona.
- **Limpieza gratis:** las **3 primeras horas** de la primera limpieza son gratis. Las horas adicionales se cobran de forma proporcional con el descuento de miembro. Hay **una sola por cliente y por hogar** (identificado por la dirección), la renovación no da otra, y si la primera limpieza se cancela, el beneficio pasa a la siguiente reserva mientras siga siendo la primera.

Además, en el ADR 0002 una reserva no se relacionaba con ninguna membresía ni con ningún pago. Al aprobar un pago no había una relación que dijera qué reserva confirmar, nada impedía repetir la limpieza gratis y no se podía comprobar que la membresía estuviera vigente en la fecha del servicio.

## Decisión

**Parámetros del negocio como datos.** Una tabla `configuracion` guarda:
- Niveles del hogar: para cada nivel, el máximo de dormitorios y de baños que cubre, las horas de la limpieza estándar y su precio (0/1 → 2 h, S/ 66; 1/1 → 3 h, S/ 99; 2/2 → 4 h, S/ 129; sin máximo → 6 h, S/ 189).
- Duración: horas adicionales de profunda (1) y de mudanza (2), umbral de apoyo extra (6 h) y factor de duración con apoyo (0,5).
- Precio: multiplicadores por tipo (1, 1,5 y 1,7).
- Paquetes por horas: duración y precio de cada uno.
- Membresía y beneficios: precio y duración de la membresía, horas gratis (3) y descuento de miembro (10%).
- Plazos y horario: anticipación mínima (48 h), espera máxima del pago (24 h), traslado (1 h), intervalo entre horarios de inicio (30 min) y horario de atención.

**Cálculo en un solo módulo del servidor.** Una función pura recibe tipo, dormitorios, baños (o el paquete), si aplica la limpieza gratis y el crédito disponible. Devuelve:
- `horas_trabajo`: duración con 1 persona.
- `requiere_apoyo`: verdadero si es un servicio por tamaño y `horas_trabajo > 6`.
- `horas_agenda`: `horas_trabajo`, o `techo_30min(horas_trabajo × 0,5)` si requiere apoyo. Es lo que bloquea la agenda (más la hora de traslado).
- `precio_lista` y el monto a pagar. Con `horas_cobrables = horas_trabajo − horas_gratis_aplicadas − credito_aplicado` (nunca menos de 0), el monto es `precio_lista ÷ horas_trabajo × horas_cobrables × (1 − descuento)`, redondeado a céntimos. Sin horas gratis ni crédito, es el precio de lista con el descuento.

El precio, las horas gratis y el crédito siempre se cuentan en horas de trabajo, nunca en horas de agenda.

El navegador muestra el resultado que le da la API; no recalcula precios.

**Un pago puede cubrir la membresía, una reserva o ambas.** `pagos` guarda el usuario, el concepto (`membresia`, `reserva` o `membresia_y_reserva`), la membresía cuando el concepto la incluye, el monto, el método, el comprobante, el estado y la revisión. Si el comprobante se rechaza y el cliente sube otro, se crea un pago nuevo y la reserva pasa a apuntar a él.

**Cada reserva apunta a su membresía y a su pago y guarda lo cobrado.**
- `reservas.membresia_id` (obligatorio): la membresía que autoriza esa limpieza.
- `reservas.pago_id` (obligatorio): el pago que la confirma. La primera limpieza gratis apunta al pago de la membresía: concepto `membresia_y_reserva` si hay horas adicionales, o `membresia` si el servicio dura 3 h o menos.
- Copia de lo cobrado: tipo, dormitorios, baños, `horas_trabajo`, `horas_agenda`, precio de lista, horas gratis aplicadas, crédito aplicado, descuento, monto e indicador `primera_gratis`. Si después cambian los parámetros, el historial no cambia.
- Apoyo extra: `requiere_apoyo` y `apoyo_estado` (`por_coordinar` o `coordinado`), más una nota libre del administrador. El apoyo no ocupa un equipo ni afecta la restricción de capacidad.

**El hogar se identifica con una clave** (detalle en el ADR 0013):
- `(distrito, direccion_normalizada, departamento_normalizado)`: la clave del hogar. Dos departamentos distintos del mismo edificio son hogares distintos.
- `direccion_normalizada` y `departamento_normalizado`: la calle más el número y el departamento en minúsculas, sin tildes ni signos, con las abreviaturas unificadas (`av` → `avenida`, `jr` → `jiron`, `dpto`/`dep` → `dpto`, `n°`/`#` → `nro`). El departamento queda vacío si no hay.

**Reglas en la base de datos:**
- **Una limpieza gratis por cliente:** índice único parcial `reservas(usuario_id) WHERE primera_gratis AND estado IN ('pendiente','confirmada','completada')`.
- **Una limpieza gratis por hogar:** índice único parcial `reservas(distrito, direccion_normalizada, departamento_normalizado) WHERE primera_gratis AND estado IN ('pendiente','confirmada','completada')`. Una segunda cuenta con la misma casa no la recibe, aunque use otro correo.
- **Una limpieza por pago:** índice único parcial `reservas(pago_id) WHERE estado IN ('pendiente','confirmada','completada')`. Una reserva expirada o cancelada por el administrador no consume el pago, y este puede usarse para otro horario (ADR 0009). Una reserva cancelada por el cliente sí lo consume: lo pagado en dinero pasa a crédito en horas (ADR 0012) y el pago no se reutiliza, para que el cliente no cobre dos veces. El índice único parcial no puede expresar esa diferencia, así que el servidor la hace cumplir.
- **Una membresía pendiente por cliente:** índice único parcial `membresias(usuario_id) WHERE estado = 'pendiente'`.
- `CHECK`: si el concepto incluye la membresía, `membresia_id` no puede estar vacío.

Las cancelaciones y expiraciones quedan fuera de los dos primeros índices, y eso es lo que permite **reusar la limpieza gratis** si la primera se cancela.

**Reglas en el servidor**, dentro de la misma transacción que crea o reprograma la reserva:
- **Cuándo aplica la limpieza gratis:** el cliente no tiene ninguna reserva `pendiente`, `confirmada` ni `completada`, y esa dirección no tiene una reserva gratis viva o realizada. Se aplica sola: el cliente no la elige.
- **Reuso tras cancelar:** las horas adicionales que se pagaron en la reserva cancelada pasan a crédito (ADR 0012). La nueva reserva gratis aplica las 3 horas gratis y después el crédito. Si el monto queda en 0, se crea `confirmada` sin comprobante; si no, se paga con un comprobante nuevo de concepto `reserva`. La renovación nunca crea una limpieza gratis nueva; solo puede usarse la que el cliente no llegó a usar.
- **Vigencia:** con una membresía activa, el inicio del servicio debe ser anterior a su `fin`. Con la primera membresía todavía pendiente, debe caer dentro de los 3 meses siguientes a hoy.

**Coincidencias aproximadas, solo para el administrador.** Al revisar un pago con limpieza gratis, el portal muestra las reservas gratis del mismo distrito que comparten número y una calle parecida, o la misma dirección con otro departamento. El administrador puede rechazar el pago si es la misma casa escrita de otra forma.

**La vigencia se calcula, no se guarda.** La membresía solo guarda los estados `pendiente` y `activa`, más `inicio` y `fin` (vacíos hasta la aprobación). "Vencida" se calcula como `activa` con `fin <= now()`.

## Alternativas consideradas

- **Cobrar fuera del sistema (WhatsApp o el día del servicio)** — era viable y no amplía el alcance. No se eligió porque el sistema no sabría qué limpiezas están pagadas.
- **Tabla con una fila por cada combinación de tipo, dormitorios y baños** — era viable y permite precios a medida. No se eligió porque el negocio ya definió 4 niveles y 3 multiplicadores, y una tabla repetiría muchas filas que habría que mantener alineadas con ellos.
- **Fórmula por dormitorio y por baño** (la versión anterior: 2 h + 1 h por dormitorio + 0,5 h por baño, y S/ 70 + S/ 25 por dormitorio + S/ 20 por baño) — el negocio la reemplazó por niveles, que reflejan mejor el tiempo real de limpieza y ponen un tope de 6 h en estándar.
- **Niveles con los números escritos en el código** — era viable y más simple. No se eligió porque los valores todavía pueden cambiar, y cambiarlos exigiría un despliegue.
- **Identificar el hogar por el lugar de Google Maps (`place_id`)** — fue la decisión del ADR 0011, reemplazada por el ADR 0013 porque el negocio no puede abrir una cuenta de facturación de Google Cloud. Reconocía mejor la misma casa escrita de formas distintas, que ahora solo detecta el administrador.
- **Una sola limpieza gratis por cliente, sin mirar la dirección** — no se eligió porque basta otra cuenta con otro correo para repetirla.
- **Duración con apoyo calculada con un factor menor a la mitad** (por ejemplo, 60% porque dos personas no siempre rinden el doble) — era viable y más conservador. El negocio eligió la mitad. El factor queda en `configuracion` para poder ajustarlo si en la práctica no alcanza el tiempo.

## Consecuencias

- Al aprobar un pago, el sistema sabe exactamente qué membresía activar y qué reserva confirmar.
- La regla de una limpieza gratis por cliente y por hogar la garantiza la base de datos, aunque haya dos peticiones simultáneas.
- Cambiar precios, duraciones u horas gratis es editar datos, sin desplegar.
- **La dirección y el departamento son texto libre.** No se verifica que la dirección exista, y una misma casa escrita de otra forma (por ejemplo, "Av. Larco 123" y "Larco 123") puede recibir otra limpieza gratis. Un error al escribir el departamento puede dejar pasar un duplicado o bloquear a un hogar legítimo; en ese caso el administrador corrige la dirección a mano.
- Las duraciones con media hora que deja el apoyo extra (por ejemplo, 7 h → 3,5 h) obligan a ofrecer horarios cada 30 minutos, lo que duplica las opciones de la agenda y la cantidad de horarios que hay que calcular en cada consulta.
- **Todo cabe en la jornada:** con el tope de 6 h en estándar, el servicio más largo es la mudanza del nivel 4 (8 h de trabajo), que con apoyo ocupa 4 h en la agenda. A cambio, la profunda y la mudanza del nivel 4 dependen de que el administrador consiga a la persona de apoyo. Si no la consigue, el servicio no cabe en el rango bloqueado, y ese caso está pendiente en el PRD.
- **El tope de 6 h no distingue hogares muy grandes:** una casa de 5 dormitorios y 4 baños dura y cuesta lo mismo que una de 3 dormitorios y 3 baños.
- El apoyo extra es un costo para el negocio que el precio no cubre aparte.
- El crédito en horas vale igual en cualquier servicio: una hora de profunda cancelada paga una hora de estándar y al revés. Es simple, pero el valor en soles de una hora cambia según el servicio.
- **El trabajo del administrador crece:** cada limpieza pagada exige revisar un comprobante, y cada limpieza gratis, además, mirar las coincidencias de dirección.
- La validación de vigencia y la de "sigue siendo la primera" viven en el servidor, porque un `CHECK` no puede consultar otras filas. Cada una necesita su propia prueba.
- Siguen pendientes de confirmar en el PRD: los precios de los paquetes y los multiplicadores de la demo, qué pasa si no se consigue a la persona de apoyo y qué pasa con las reservas del mes 3 si no llega el pago del mes 4.
