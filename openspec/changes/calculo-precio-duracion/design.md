## Context

`configuracion` ya existe (ítem #1) con todos los parámetros que este cálculo necesita, y `src/lib/configuracion.ts` los lee validados con zod. Verificado en el código:

- `niveles_hogar` es una lista ordenada de `{ max_dormitorios, max_banos, horas }`; `null` significa "sin máximo". `precios_niveles` es una lista paralela de precios en céntimos (`leerConfiguracion` comprueba que tengan la misma longitud).
- `horas_extra_tipo` y `multiplicadores_precio` tienen las claves `estandar`, `profunda` y `mudanza`. `paquetes_horas` es una lista de `{ horas, precio }`.
- `apoyo_extra` trae `umbral_horas` y `factor_agenda`; `horas_gratis`, `descuento_miembro` e `intervalo_horarios_minutos` son valores sueltos.
- Los precios de los niveles, los multiplicadores y los paquetes ya están marcados `provisional = true` en la migración `0001`; el resto, no.
- `src/lib/__fixtures__/configuracion.ts` tiene un `Configuracion` completo con los valores del diseño, reutilizable en las pruebas.
- `ErrorApi.invalido` (`src/lib/errores.ts`) da el `422` del formato único.

El módulo no tiene consumidores todavía: lo usarán la agenda (#6), la reserva (#9), la reserva de miembro (#13) y el crédito (#14).

## Goals / Non-Goals

**Goals:**
- Un solo módulo puro que devuelva duración, apoyo, precio y monto de un servicio, con los ejemplos del PRD y de `TECH-DESIGN.md` como pruebas.
- Que cambiar un precio, una duración, el descuento o las horas gratis sea editar `configuracion`, sin tocar el código.

**Non-Goals:**
- Decidir si corresponde la limpieza gratis (cliente sin otras reservas, dirección que no la recibió): es de #9 y #10. Aquí llega como dato.
- Calcular el saldo de crédito, elegir lotes o generar créditos: es de #14. Aquí llega la cantidad de horas disponibles.
- El monto de la membresía y el pago combinado `membresia_y_reserva`: lo arma #9, que suma el resultado de este módulo al precio de la membresía.
- Endpoint de cotización para el asistente (el navegador no recalcula, ADR 0008): lo define el ítem que construya el asistente (#9). Este cambio no agrega rutas.
- Horarios, traslado y capacidad (#6). Se devuelve `horas_agenda`; sumar la hora de traslado es de la agenda.
- Confirmar los precios de los paquetes y los multiplicadores (ver Riesgos).

## Decisions

### 1. Función pura que recibe la configuración

`calcularServicio(config: Configuracion, entrada)` no lee la base ni el reloj. Quien la llama lee `configuracion` (con `leerConfiguracion`, dentro de su transacción si hace falta) y la pasa.

- **Por qué:** se prueba sin base ni mocks, y #9 puede usar la misma lectura de configuración para toda la transacción.
- **Descartada:** una función que lea sola la configuración. Mezcla E/S con cálculo y obliga a simular la base en cada prueba. Respalda la decisión: ADR 0008 ("función pura").

### 2. Entrada como unión discriminada

`{ tipo: "estandar" | "profunda" | "mudanza", dormitorios, banos } | { tipo: "paquete", horas }`, más `aplicaGratis: boolean` y `creditoHoras: number`. Se valida con zod y los fallos salen como `ErrorApi.invalido`.

- **Por qué:** impide por tipos pedir dormitorios para un paquete. Se acepta 0 dormitorios (nivel 1) y se exigen al menos 1 baño, porque el PRD define el nivel 1 como "1 baño" y todo hogar tiene baño.
- **Supuesto:** no se fija un máximo de dormitorios ni baños; el tope de la interfaz lo decide el asistente (#9).
- **Descartada:** una entrada con un solo campo `servicio` en texto. Pierde la validación por tipo.

### 3. Nivel por primer ajuste, sin tope escrito en el código

Se recorre `niveles_hogar` en orden y se toma el primero con `dormitorios <= max_dormitorios` y `banos <= max_banos` (o `max` nulo). El precio del nivel es `precios_niveles[indice]`. El tope de 6 h de la estándar sale de que el último nivel no tiene máximo.

- **Por qué:** es la regla literal del PRD y ADR 0008, y si el negocio agrega un nivel, es un dato.
- **Descartada:** una fórmula por dormitorio y baño (la versión anterior del ADR 0008): el negocio la reemplazó por niveles.

### 4. Aritmética en céntimos enteros y una sola redondeada

Todos los montos son céntimos enteros. El precio por tamaño es `round(precio_nivel × multiplicador)`. El monto es `round(precio_lista × horas_cobrar × (1 − descuento) ÷ horas_trabajo)`, con una sola redondeada final (la fórmula del ADR 0008), calculada con enteros para evitar errores de punto flotante: horas × 2 (todas son múltiplos de 0,5) y el descuento en diezmilésimos. Las mitades se redondean hacia arriba. El subtotal sin descuento es `round(precio_lista × horas_cobrar ÷ horas_trabajo)` y `descuento = subtotal − monto`, de modo que `monto + descuento = subtotal` siempre.

- **Por qué:** `19350 × 0,9 ÷ 5` en punto flotante puede dar `3483.0000000000005`; con enteros el resultado es exacto, y el historial guarda céntimos reproducibles.
- **Descartada:** redondear primero el subtotal y luego el descuento. Es viable, pero se aparta de la fórmula del ADR 0008 y puede diferir en un céntimo.

### 5. Orden: horas gratis, luego crédito, luego descuento

`horas_gratis_aplicadas = aplicaGratis ? min(horas_gratis, horas_trabajo) : 0`; `credito_aplicado = min(creditoHoras, horas_trabajo − horas_gratis_aplicadas)`; `horas_cobrar = horas_trabajo − gratis − crédito`. Todo en horas de trabajo, nunca de agenda.

- **Por qué:** es el orden del ADR 0012 ("primero se aplican las horas gratis, después el crédito") y no consume crédito que las horas gratis ya cubren.
- **Descartada:** aplicar el crédito antes que las horas gratis: gastaría crédito del cliente que el beneficio gratuito ya cubría.

### 6. El descuento de miembro se aplica siempre

Toda reserva exige una membresía vigente (PRD, punto 2), y la primera se paga en el mismo paso, así que no hay una entrada "es miembro". Los criterios de `TECH-DESIGN.md` ("El precio mostrado y guardado es el de lista con el descuento de miembro") y el ejemplo del PRD (× 0,9) lo confirman.

- **Descartada:** un parámetro `esMiembro`. No existe un caso válido sin membresía y abriría la puerta a cobrar precio de lista por error.

### 7. Redondeo de la agenda con el intervalo de horarios

`horas_agenda = ceil(horas_trabajo × factor_agenda ÷ intervalo) × intervalo`, con el intervalo tomado de `intervalo_horarios_minutos` (30 min), trabajando en minutos enteros.

- **Por qué:** el PRD dice "redondeado hacia arriba a 30 minutos"; ese valor ya es un dato, así que no se escribe `0.5` en el código.
- **Descartada:** redondear a media hora fija. Funciona hoy, pero duplicaría un valor que ya es configurable.

### 8. Sin choque con ningún ADR

El diseño sigue ADR 0008 (módulo único, función pura, fórmulas) y ADR 0012 (orden gratis y crédito). La columna "Depende de" del backlog marca #1 como único requisito y está construido.

## Risks / Trade-offs

- **Precios de paquetes y multiplicadores sin confirmar (`REVISAR` del PRD):** las pruebas usan los valores del diseño. Mitigación: están en `configuracion` marcados `provisional`; confirmarlos o cambiarlos es editar datos. Las pruebas de ejemplos fijos (S/ 129, 193,50, 219,30) usan el fixture, no la base, así que no se rompen si se editan los datos reales.
- **Persona de apoyo no definida (`REVISAR`):** el cálculo solo marca `requiere_apoyo`; qué pasa si no se consigue la persona queda para el ítem #16.
- **El tope de 6 h no distingue hogares muy grandes** (ADR 0008): una casa de 5 dormitorios y 4 baños cuesta lo mismo que una de 3 y 3. Es una decisión del negocio, no un defecto del cálculo.
- **Una hora de crédito vale lo mismo en cualquier servicio** (ADR 0012): al descontarse en horas, una hora de profunda cancelada paga una hora de estándar.
- **Entrada inconsistente de quien llama:** este módulo confía en `aplicaGratis` y `creditoHoras`; si #9 o #14 los calculan mal, el monto sale mal. Mitigación: cada uno prueba su propia decisión.
- **Mitades de céntimo:** el redondeo hacia arriba puede cobrar o regalar medio céntimo; no hay valores de la configuración actual que lo eviten (por ejemplo, S/ 29,025 se cobra S/ 29,03). Se acepta y queda fijado por una prueba.
