## Context

**Este change es 9b, la mitad de pantalla del ítem #9.** El usuario partió el ítem en dos changes. **9b depende de que 9a (`reservar-y-pagar-primera-membresia`) esté aplicado y desplegado.** Las decisiones de servidor (esquema, transacción única, `409`, cotización, datos de pago, WhatsApp, entrega del comprobante) las define 9a; aquí solo se copia lo que el asistente consume, citando el número de decisión de 9a.

Qué expone 9a y consume 9b:

| Endpoint o módulo | Definido en | Uso en el asistente |
|---|---|---|
| `GET /api/cotizacion` | 9a, decisión 8 | resumen del servicio, membresía, total a pagar, rango de fechas y `limite` |
| `POST /api/reservas` | 9a, decisiones 1, 4, 5 y 13 | confirmar; responde `201` con reserva, membresía, pago y enlace de WhatsApp, `409` (cupo, reserva o pago en revisión) o `422` |
| `src/lib/reservas/datos-de-pago.ts` y `public/pago/yape.jpeg` | 9a, decisión 9 | CCI, titular y QR del paso de pago |
| `AVISO_DEMOSTRACION` en `src/lib/aviso-demo.ts` | 9a, decisión 15 | aviso fijo del paso de pago y de la reserva enviada |
| Enlace de WhatsApp | 9a, decisión 10 | botón de la pantalla final; el navegador no lo construye |
| `GET /api/disponibilidad` | ítem #6 | horarios del día en el paso de fecha |
| `subirImagen`, `POST /api/subidas`, `validarArchivoOriginal`, `ErrorImagen` | ítem #8 | subida y validación del comprobante |
| `CamposDireccion`, lista de 9 distritos | ítem #7 | paso de dirección |
| `usuarioActual` | ítem #2 | decidir la vista de `/reservar` |

Verificado en el código (no se reescribe): `CamposDireccion` es el formulario de cinco campos y ya se prueba con `renderToStaticMarkup`; los componentes de cliente de Next 16 se pueden probar así sin DOM; `.vercelignore` no excluye `public/`, así que la imagen del QR de 9a se sirve en producción. Estado de los vecinos: #5 (landing) está planificado y sin aplicar; no existe `formato-publico.ts`.

## Goals / Non-Goals

**Goals:**

- Que un cliente nuevo complete la reserva y el pago desde el navegador, con lo que calcula el servidor, sin que el navegador decida un precio, un plazo ni una regla.
- Que el comportamiento que importa (candado del doble envío, volver al paso de fecha tras un `409`, reutilizar el comprobante ya subido) viva en funciones puras probadas con Vitest.
- Que ninguna cifra de precio, horas o plazo esté escrita en el código del asistente.

**Non-Goals:**

- Cualquier cambio de servidor, de esquema o de migración (9a).
- El aviso de demostración en el pie de las páginas públicas: es de #5. Aquí solo el paso de pago y la reserva enviada.
- Crear el módulo del texto del aviso: lo crea 9a (decisión 15 de 9a).
- Aprobación, rechazo y nuevo comprobante (#11), perfil (#12), reserva de miembro (#13), renovación (#15).
- Pruebas con navegador: Playwright está excluido para los ítems posteriores al 1 y `jsdom`/Testing Library no se agregan.
- Verificar la dirección en un mapa (PRD, "No alcance").
- Modificar `PRD.md`, `TECH-DESIGN.md`, los ADR o `BACKLOG.md`: lo que haga falta se propone en el reporte.

## Decisions

### 1. El asistente: lógica pura probada, componentes delgados

(Es la decisión 12 del design original de 9a, ahora de 9b.) La lógica vive en `src/lib/reservas/asistente/` y se prueba con Vitest sin DOM: `parametros.ts` (parámetros de la landing; `tipo=horas` se traduce a `paquete`, `distrito=` vacío es ausente), `estado.ts` (estado y reductor, `puedeAvanzar(paso, estado)`), `dias.ts` (fechas civiles sin domingos), `solicitud.ts` (arma el cuerpo de `POST /api/reservas`) y `confirmar.ts` (`confirmarReserva`: subir → enviar → resultado tipado `ok`, `sin_cupo`, `bloqueado` o `error`, con un candado contra el doble envío y reutilizando la ruta ya subida). Los componentes (`app/reservar/`) solo pintan y llaman a esas funciones; se prueban con `renderToStaticMarkup`, como `CamposDireccion`.

- **Pasos:** 1 servicio, 2 tamaño o paquete (llama a la cotización), 3 fecha y hora, 4 dirección, 5 pago, 6 confirmación. Atrás conserva los valores. El estado vive en el navegador (ADR 0005).
- **`/reservar` en servidor:** lee la sesión (`usuarioActual`), consulta si el cliente tiene membresía y decide entre redirigir a `/registro?volver=...`, mostrar "pago en revisión", mostrar el enlace a la cuenta o el asistente. Pasa al asistente el `usuarioId` (carpeta de la subida) y los valores iniciales.
- **Un `422` del servidor no dice qué campo falló** (formato único de errores, ADR 0003); se muestra el mensaje junto al botón de confirmar con "Revisar mis datos". Un `409` de cupo vuelve al paso de fecha y hora con el comprobante ya subido.
- **El parámetro `club` se lee y no hace nada:** todo cliente nuevo paga la membresía.
- **Estilos:** un módulo CSS propio (`reservar.module.css`) tomado de la demo (`demo/reservar.html` y `demo/styles.css`) sin estilos globales, para no chocar con la landing de #5.
- **Descartada:** añadir `jsdom` o Testing Library para probar los clics. Es una dependencia nueva que ningún ítem nombra; la lógica que importa vive en funciones puras.
- **Descartada:** Playwright. El usuario lo excluyó para los ítems posteriores al 1.
- **Descartada:** guardar borradores en la base (ADR 0005 y ADR 0009).
- **Verificación manual:** el criterio "menos de 3 minutos sin ayuda" no se automatiza; es una tarea del usuario.

### 2. El navegador no calcula precios ni zonas horarias

Consume `GET /api/cotizacion` (9a, decisión 8): solo recorre fechas civiles `AAAA-MM-DD` entre `fechas.desde` y `fechas.hasta` y compara el instante ISO de cada horario con `limite`. El único formato propio es `formatearSoles` (`src/lib/soles.ts`) sobre céntimos que ya vienen del servidor.

- **Descartada:** calcular las 48 horas y los 3 meses con `Date` en el navegador (mezcla la zona del dispositivo con la de Lima).
- **Formato de soles:** si #5 ya creó `formato-publico.ts` con `formatearSoles` al aplicar este change, se reutiliza y no se crea `soles.ts`; si no, se crea `soles.ts` y #5 puede reutilizarlo.

### 3. Datos de pago: se muestran desde el módulo de 9a, con la imagen real del QR

`PasoPago` importa la CCI, el titular y la ruta del QR de `datos-de-pago.ts` (9a, decisión 9). Con Yape muestra la imagen `/pago/yape.jpeg` con un texto alternativo que diga que es el QR de Yape de Tiza y a nombre de quién está; con transferencia, la CCI de 20 dígitos y el titular. Ningún componente repite esos valores (la prueba de 9a lo vigila en `app/`).

- **Descartada:** copiar los valores a los componentes o pedirlos a una API. Es un solo lugar y no son secretos.
- **Aviso de demostración:** decidido; ver decisión 6. El riesgo que queda está en Riesgos.

### 4. Confirmar: subir primero, enviar después, un solo envío

`confirmarReserva` (decisión 1) sube la imagen con `subirImagen` y recién entonces envía `POST /api/reservas` con la ruta devuelta (el servidor la vuelve a verificar: 9a, decisión 4). Resultados: `ok` (`201`), `sin_cupo` (`409` de elegir otra hora: vuelve al paso de fecha y reutiliza la ruta subida), `bloqueado` (`409` de reserva o pago en revisión: sin reintentar) y `error` (`422`, red u otro: mensaje sin perder lo escrito). Un candado impide dos envíos simultáneos.

- **Distinguir los `409`:** 9a (decisión 5) responde la falta de cupo con el código `conflicto` y la reserva o el pago en revisión con el código `en_espera`. `confirmarReserva` los separa por ese código del formato único de errores, no por el texto del mensaje.
- **Descartada:** subir el archivo dentro del envío de la reserva (multipart). Contradice el ADR 0010 (subida directa a Blob).

### 5. WhatsApp: solo se muestra el enlace

La pantalla final muestra el botón con el `href` de la respuesta (`target="_blank"`) o lo omite si es `null`. El navegador no conoce el número (9a, decisión 10).

### 6. Aviso de demostración visible en el paso de pago y en la reserva enviada

El usuario decidió (21 de octubre de 2026) y el PRD recoge ("Alcance" punto 3) un aviso con el texto exacto «Sitio de demostración: los pagos son simulados. No hagas ninguna transferencia ni pago real.», en tres lugares; 9b cubre dos: (1) un aviso fijo en `PasoPago`, junto al QR y la CCI, y (2) la pantalla `PasoListo` de la reserva enviada. El tercero (pie de las páginas públicas) es de #5. Ambos componentes importan `AVISO_DEMOSTRACION` de `src/lib/aviso-demo.ts` (lo crea 9a, decisión 15) y lo pintan en un bloque propio con `role="note"`, fondo y borde que lo distingan y texto de tamaño normal, no en letra pequeña.

- **En `PasoPago`:** el bloque va en el mismo contenedor que el QR y la CCI, y se muestra con Yape y con transferencia (también antes de elegir el método), para que quien vea el QR vea el aviso. No depende de un clic ni de un despliegue colapsable.
- **En `PasoListo`:** el bloque aparece con o sin enlace de WhatsApp.
- **Por qué importar la constante:** el texto lo fija el PRD y se repite en tres lugares; una prueba compara el HTML con la constante, y si cambia se edita un solo archivo.
- **Descartada:** escribir el texto en cada componente (se desincroniza). **Descartada:** letra pequeña o solo en el pie (el riesgo está en el paso de pago, donde está el QR).
- **Dependencia:** si `src/lib/aviso-demo.ts` no existe al aplicar 9b, 9a no está aplicado; la tarea 1.1 lo comprueba y se detiene.

## Cobertura de los criterios de `TECH-DESIGN.md`

Reparto con 9a (su tabla gemela está en el design de 9a). Solo los criterios de pantalla están aquí:

| Criterio | Dónde se cubre en 9b |
|---|---|
| Asistente pide distrito, calle, número, departamento y referencias | spec `asistente-de-reserva` (dirección); tarea 3.5 |
| Sin domingos; menos de 48 h → gris | spec `asistente-de-reserva` (fecha); tareas 2.4 y 3.4 (el `422` es de 9a) |
| Sin equipo libre → gris | spec `asistente-de-reserva` (fecha), apoyada en `GET /api/disponibilidad` (#6); tarea 3.4 |
| Niveles, 0 dormitorios, duración y precio mostrados | specs `asistente-de-reserva` (servicio, tamaño); tarea 3.3 (el cálculo es de 9a) |
| Yape y transferencia; comprobante de 4,5 a 5 MB; otro tipo o más de 5 MB rechazado | spec `asistente-de-reserva` (pago); tareas 3.6 y 3.7 (la compresión es de #8) |
| Cerrar el asistente antes de confirmar no deja nada | spec `asistente-de-reserva` (confirmar); tareas 2.6 y 3.7 (el cron es de 9a) |
| Aviso de demostración con el texto exacto en el paso de pago y en la reserva enviada (PRD, alcance 3; el del pie es de #5) | spec `asistente-de-reserva` (pago, confirmación); tareas 3.9 y 3.10 |
| Menos de 3 minutos sin ayuda | tarea del usuario 5.4 (no automatizable) |

## Risks / Trade-offs

- **Riesgo residual: alguien paga dinero real por error (riesgo principal de este change).** La CCI y el QR de Yape que muestra el paso de pago son del titular del proyecto, y el PRD dice que los pagos son simulados. El aviso fijo (decisión 6) lo reduce, pero un visitante puede ignorarlo y transferir o yapear dinero real; no se vincula a ninguna reserva, no se aprueba y habría que devolverlo a mano (PRD, "Riesgos"). Además el administrador no puede aprobar hasta #11. Mitigación: aviso visible junto al QR y la CCI y en la reserva enviada, y no abrir el sitio al público hasta #11.
- **Sin #11 nadie aprueba pagos, y sin #10 se puede repetir la limpieza gratis** (9a, Riesgos): `/reservar` desplegado crea reservas que expiran a las 24 h. No abrir el sitio al público hasta #11.
- **Disponibilidad desfasada.** Entre ver un horario y confirmar, otro cliente puede tomarlo; el `409` con vuelta al paso de fecha lo resuelve sin perder el comprobante.
- **Legibilidad del comprobante comprimido.** Sigue pendiente la prueba manual de #8 (tarea 3.5) con una captura real de Yape; se cierra en la tarea 5.4. Si no se lee, el administrador rechaza y el cliente sube otra.
- **Dos formateadores de soles.** Ver decisión 2.
- **Apoyo extra.** El resumen dice que "coordinamos una persona de apoyo" y que el precio no cambia, sin prometer más: qué pasa si no se consigue es un `REVISAR` del PRD que queda abierto (#16).
- **Sin pruebas de clic.** Al no usar `jsdom` ni Playwright, la interacción real (clics, foco, teclado) solo se prueba en la verificación manual. Se mitiga con la lógica pura probada y el recorrido de la tarea 5.4.
- **Divergencia cotización/cobro.** Si `configuracion` cambia entre la cotización y la confirmación, el servidor cobra lo nuevo y la pantalla final muestra lo guardado (9a, Riesgos).
- **Archivos huérfanos.** Cerrar la página tras subir deja la imagen hasta el cron diario (9a).

## Migration Plan

1. Confirmar que 9a está desplegado (tarea 1.1). Este change no tiene migración.
2. Verificar localmente (grupo 4) y desplegar con `npx vercel deploy --prod`; `GET /api/salud` = `200 {"estado":"ok"}`.
3. Prueba de humo con `curl` y recorrido del usuario (grupo 5); limpiar los datos de prueba.
4. Marcha atrás: redesplegar el commit anterior. Es seguro: 9b no escribe esquema.

## Open Questions

1. ~~Aviso "DEMO"~~ Resuelta el 21 de octubre de 2026: aviso con el texto exacto del PRD en el paso de pago y en la reserva enviada (decisión 6); el del pie de las páginas públicas es de #5.
2. **Código de error para distinguir los `409`.** Resuelta: 9a agrega el código `en_espera` (decisión 5 de 9a). La tarea 1.1 confirma que 9a ya lo implementa antes de empezar.
3. **¿Cuándo se despliega 9b?** Depende de si #11 ya existe. La landing (#5) espera a este change.
4. Se confirma el supuesto de que el `422` del servidor no indica el campo y el asistente solo ofrece volver al paso de dirección (decisión 1).
5. ~~Actualizar `PRD.md` con el aviso~~ El PRD ya lo recoge. Nada que proponer.
