## 1. Entrada y tipos

- [x] 1.1 Crear `src/lib/precios.ts` con el esquema zod de la entrada (unión por `tipo`: `estandar`, `profunda`, `mudanza` con `dormitorios` entero >= 0 y `banos` entero >= 1, o `paquete` con `horas`; más `aplicaGratis` y `creditoHoras` >= 0 y múltiplo de 0,5) y los tipos `EntradaServicio` y `ResultadoServicio`
- [x] 1.2 Convertir los fallos de validación y un paquete inexistente en `ErrorApi.invalido` con mensajes en español de Perú

## 2. Duración y apoyo

- [x] 2.1 Implementar la búsqueda del nivel (primer nivel cuyos máximos cubren dormitorios y baños; `null` = sin máximo) y las `horas_trabajo` (horas del nivel + `horas_extra_tipo`)
- [x] 2.2 Implementar `requiere_apoyo` (solo por tamaño y `horas_trabajo > umbral_horas`) y `horas_agenda` (factor de agenda redondeado hacia arriba a `intervalo_horarios_minutos`, en minutos enteros)
- [x] 2.3 Paquetes por horas: `horas_trabajo` y `horas_agenda` iguales a las del paquete, sin apoyo

## 3. Precio y monto

- [x] 3.1 Implementar el precio de lista: `round(precios_niveles[nivel] × multiplicador)` por tamaño, o el precio del paquete
- [x] 3.2 Implementar horas gratis aplicadas, crédito aplicado (gratis primero) y `horas_cobrar`, siempre en horas de trabajo
- [x] 3.3 Implementar subtotal, `monto` con una sola redondeada (aritmética entera, mitades hacia arriba) y `descuento = subtotal − monto`; devolver también el número de nivel
- [x] 3.4 Confirmar que la función no importa la base, el reloj ni `process.env` (solo `Configuracion`, zod y `ErrorApi`)

## 4. Pruebas (Vitest, `src/lib/precios.test.ts`, con el fixture `VALORES_DEL_DISENO`)

- [x] 4.1 Niveles estándar: 0/1 → 2 h, 1/1 → 3 h, 2/1, 1/2 y 2/2 → 4 h, 3/2 y 5/4 → 6 h
- [x] 4.2 Duración por tipo para 2/1: estándar 4 h, profunda 5 h, mudanza 6 h; cambiar las horas de un nivel en la configuración cambia el resultado
- [x] 4.3 Precio de lista: 2/1 → S/ 129, S/ 193,50, S/ 219,30; 0/1 estándar → S/ 66; paquetes 3, 4, 6 y 8 h → S/ 99, 129, 189 y 239
- [x] 4.4 Apoyo: sin apoyo hasta 6 h (profunda 2/1, mudanza 2/2, estándar 5/4, paquete 8 h); con apoyo profunda 3/2 (7 h → 3,5 h) y mudanza 3/1 (8 h → 4 h) con el mismo precio; redondeo de 6,5 h a 3,5 h
- [x] 4.5 Descuento de miembro: estándar 2/1 → monto S/ 116,10 y descuento S/ 12,90; con descuento 0,2 en la configuración → S/ 103,20
- [x] 4.6 Horas gratis: profunda 2/1 → monto S/ 69,66; estándar 1/1 y paquete de 3 h → S/ 0; estándar 0/1 → 2 h gratis aplicadas; profunda 3/2 → 4 h a cobrar y S/ 145,80; sin `aplicaGratis` → 0 horas gratis
- [x] 4.7 Crédito: 3 h sobre una estándar de 4 h → S/ 29,03; 6 h sobre 4 h → aplicado 4 y S/ 0; profunda 5 h con gratis y 1 h de crédito → 3 + 1 y S/ 34,83
- [x] 4.8 Propiedades: misma entrada, mismo resultado; `monto` entero, no negativo y `monto + descuento` = subtotal, sobre un barrido de todas las combinaciones de dormitorios 0–6, baños 1–5, tipos y paquetes
- [x] 4.9 Validación: 0 baños, 1,5 y -1 dormitorios, paquete de 5 h, tipo desconocido y crédito negativo o de 1,3 h lanzan `ErrorApi` con estado `422`; 0 dormitorios es válido

## 5. Verificación y despliegue

- [x] 5.1 Correr `npm test` y `npx tsc --noEmit` sin errores (sin Playwright)
- [x] 5.2 Correr `npm run build` sin errores
- [x] 5.3 No hay migración: confirmar con `git status` que `src/db/` no cambió y que no se necesita `npm run db:migrate`
- [x] 5.4 Desplegar con `npx vercel deploy --prod` y comprobar `GET /api/salud` = `200 {"estado":"ok"}` (recordar que los pagos son simulados; no hay variables de entorno nuevas)
- [ ] 5.5 Tarea del usuario (no bloquea): confirmar con el negocio los precios de los paquetes y los multiplicadores de la demo. Si cambian, actualizar `configuracion` y marcar `provisional = false`; si se confirman, solo quitar la marca. Actualizar el `REVISAR` del PRD (fuera de este change)
