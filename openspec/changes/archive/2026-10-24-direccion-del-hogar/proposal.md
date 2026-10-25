## Why

La limpieza gratis se da una sola vez por hogar y el servicio solo atiende 9 distritos (PRD, "Alcance" punto 2 y 3). Hay que identificar el hogar y validar el distrito sin mapa: el ADR 0013 reemplazó a Google Maps (ADR 0011) por campos de texto, porque el negocio no puede abrir una cuenta de facturación. El asistente de reserva (#9) y el índice de una limpieza gratis por hogar (#10) necesitan antes este bloque: los campos de la dirección, su validación en el servidor y la clave del hogar.

## What Changes

- Un módulo del servidor que valida la dirección (distrito de la lista cerrada de los 9 de v1, calle no vacía, número con al menos un dígito) y responde `422` con un mensaje claro si falla.
- Normalización de la calle, el número y el departamento (minúsculas, sin tildes ni signos, abreviaturas unificadas) para obtener `direccion_normalizada` y `departamento_normalizado`, y por tanto la **clave del hogar** `(distrito, direccion_normalizada, departamento_normalizado)`.
- La lista de los 9 distritos como constante compartida entre servidor y navegador.
- Un componente de formulario reutilizable con los cinco campos (distrito, calle, número, departamento opcional, referencias opcional) que #9 incrustará en el paso 2 del asistente. Sin mapa, sin claves y sin script externo.
- Sin migración: las columnas de la dirección en `reservas` y los índices únicos nacen con las tablas de #6, #9 y #10.

## Capabilities

### New Capabilities

- `direccion-hogar`: captura, validación y normalización de la dirección del hogar, y su clave de identificación.

### Modified Capabilities

(ninguna)

## Impact

- Código nuevo: `src/lib/distritos.ts`, `src/lib/direccion.ts` y sus pruebas, y `app/_componentes/CamposDireccion.tsx` con su prueba.
- Sin cambios en la base, rutas `/api`, variables de entorno ni dependencias. No agrega ninguna ruta: el `422` lo emite quien llame al módulo (`POST /api/reservas`, ítem #9).
- Consumidores futuros: #9 (asistente y creación de la reserva), #10 (índice único y limpieza gratis por hogar) y #11 (coincidencias aproximadas del administrador).
- Cierra el ADR 0013 en lo que toca a este ítem; el ADR 0011 queda sin uso y no se toma como guía.
