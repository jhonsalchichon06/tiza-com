## Why

Casi todo lo que sigue en el backlog necesita saber cuánto dura y cuánto cuesta un servicio: la agenda (#6) bloquea horas según la duración, la reserva y el pago de la membresía (#9) cobran las horas adicionales de la primera limpieza, la reserva de un miembro (#13) cobra con 10% de descuento y el crédito en horas (#14) se descuenta de las horas a pagar. Si cada ítem repite la cuenta, los números se desalinean. Es el ítem #4 de `BACKLOG.md`; solo depende del #1, que ya dejó `configuracion` cargada y validada (`src/lib/configuracion.ts`).

El ADR 0008 fija que el cálculo vive en **un solo módulo del servidor**, como función pura, y que el navegador no recalcula. Los precios y duraciones salen de `configuracion`, nunca del código.

## What Changes

- Nuevo módulo `src/lib/precios.ts` con una función pura `calcularServicio(config, entrada)`:
  - nivel del hogar (primer nivel cuyos dormitorios y baños alcanzan) y `horas_trabajo` (nivel + horas extra de profunda o mudanza);
  - `requiere_apoyo` y `horas_agenda` (la mitad redondeada hacia arriba al intervalo de horarios, si pasa de 6 h);
  - `precio_lista` por tamaño (precio del nivel × multiplicador del tipo) o por paquete de horas;
  - horas gratis aplicadas, crédito aplicado, horas a cobrar, descuento de miembro y monto final en céntimos.
- Validación de la entrada con errores en el formato único de la API (`422`).
- Pruebas Vitest con los ejemplos del PRD y de `TECH-DESIGN.md`.
- Sin tablas ni migraciones nuevas: `configuracion` ya tiene todos los parámetros.

Fuera de alcance (llegan con otros ítems): decidir si corresponde la limpieza gratis (#9, #10) y cuántas horas de crédito tiene el cliente (#14); el endpoint de cotización que consume el asistente; el monto de la membresía; la agenda, el traslado y los horarios (#6); mostrar precios en la landing (#5).

**Decisión de negocio pendiente (no bloquea):** el PRD marca como `REVISAR` los precios de los paquetes y los multiplicadores. Se guardan como datos y ya están marcados `provisional` en `configuracion`; `TECH-DESIGN.md` autoriza probar con valores provisionales. Si el negocio los cambia, se edita la base y no el código.

## Capabilities

### New Capabilities

- `calculo-servicio`: duración (horas de trabajo y de agenda), apoyo extra, precio de lista, horas gratis, crédito y descuento de miembro de un servicio, calculados a partir de `configuracion`.

### Modified Capabilities

Ninguna.

## Impact

- **Código:** nuevo `src/lib/precios.ts` y `src/lib/precios.test.ts`; reutiliza `Configuracion` de `src/lib/configuracion.ts`, `ErrorApi` de `src/lib/errores.ts` y los valores de `src/lib/__fixtures__/configuracion.ts`.
- **Base de datos:** ninguna migración.
- **Despliegue:** el módulo no tiene consumidores aún, pero se despliega para comprobar que el build y `GET /api/salud` siguen en verde.
- **Documentación:** ninguna variable de entorno nueva.
