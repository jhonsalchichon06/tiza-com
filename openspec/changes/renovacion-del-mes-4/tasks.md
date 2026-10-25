## 1. Verificación previa y coordinación

- [x] 1.1 Comprobar que #11 y #12 están aplicados en el código y en la rama `pruebas`: `cerrarMembresiasSinReenvio`, `pagosRechazadosReenviables`, `POST /api/pagos`, aprobar/rechazar pagos, `estadoDeMembresia` y `GET /api/perfil`. Si falta alguno, pausar y reportar: no se improvisa su contenido.
- [x] 1.2 Revisar la vigencia de #13 (`reservar-como-miembro-activo`): su `validarVigenciaDeMembresia(config, fin, inicio)` en `src/lib/reservas/vigencia.ts` es la única comparación `inicio < fin`. Si ya está en el código, `comprobarVigenciaParaReservar` la reutiliza (no escribir otra); si no, extraer el predicado puro `servicioDentroDeVigencia(fin, inicio)` en ese archivo y avisar para que #13 lo importe. Revisar también si #12 ya distingue una membresía `pendiente` de renovación.
- [x] 1.3 Confirmar que `membresias_una_pendiente_por_cliente` solo cubre `pendiente` (una `activa` vencida y una `pendiente` coexisten) y que `pagos_membresia_si_concepto` admite concepto `membresia` sin reserva.
- [x] 1.4 Dejar anotado en el reporte que las decisiones del plan de 3 meses por S/ 267 y de la regla de reservas son provisionales, pendientes de confirmar por el negocio (`PRD.md`, `<!-- REVISAR -->`).

## 2. Parámetro `renovacion_aviso_dias`

- [x] 2.1 Agregar `renovacion_aviso_dias` a `src/lib/configuracion.ts` (entero positivo) y a `VALORES_DEL_DISENO` (14) y al fixture; ajustar las pruebas que cuentan las claves (`configuracion.test.ts`, `migraciones.test.ts`) al número real.
- [x] 2.2 Generar la migración de solo datos con `npm run db:generate -- --custom --name=renovacion-aviso-dias` y escribir a mano `INSERT INTO "configuracion" ("clave","valor","provisional") VALUES ('renovacion_aviso_dias','14',true) ON CONFLICT ("clave") DO NOTHING;` (se genera al aplicarse, después de las migraciones de #10, #11 y #12).
- [x] 2.3 Aplicar la migración **solo a la rama `pruebas`** (`DATABASE_URL_PRUEBAS`, sin imprimir la cadena) y comprobar que `leerConfiguracion` valida la clave nueva.
- [x] 2.4 Prueba Vitest: la clave se rechaza si es 0, negativa o no entera; y su valor cambia el resultado de `estadoDeRenovacion` (escenario "Cambiar la ventana").

## 3. Estado y aviso de renovación

- [x] 3.1 Crear `src/lib/membresia/renovacion.ts` con `estadoDeRenovacion` (función pura) y sus tipos: `no_aplica`, `por_vencer`, `vencida`, `renovacion_en_revision`, `renovacion_rechazada`. Pruebas Vitest de cada caso, de los límites (`fin` igual a ahora, exactamente `renovacion_aviso_dias` días) y de que una `caducada` no cuenta.
- [x] 3.2 Leer en SQL, con el reloj de la base, las membresías del cliente con `vigente` (`fin > now()`) y los días restantes redondeados hacia arriba; usar `pagosRechazadosReenviables` del #11 para `renovacion_rechazada`. Filtrar siempre por `usuario_id` de la sesión.
- [x] 3.3 Distinguir una membresía `pendiente` de renovación (el cliente tiene otra `activa`) de la primera membresía en el cálculo del perfil del #12, sin cambiar los valores del estado de #12. Prueba: la primera membresía en revisión da `no_aplica` y conserva su texto.
- [x] 3.4 Textos de los avisos en español de Perú con fecha en la zona de `horario_atencion` y días del parámetro (`por_vencer`, `vencida`, `renovacion_en_revision`, `renovacion_rechazada`, con motivo y fecha límite). Pruebas Vitest de cada texto.
- [x] 3.5 Incluir `renovacion` en `GET /api/perfil` y en `app/(cuenta)/cuenta/page.tsx` (aviso y botón "Renovar mi membresía"; en `por_vencer` solo el aviso), con la pasada de expiración y el reintento del #12 (Neon dormido responde `503` con "Inténtalo en unos segundos."). Prueba de los componentes con `renderToStaticMarkup`: letra base de 18 px o más y botones de 48 px o más.

## 4. Bloqueo por vigencia

- [x] 4.1 Crear `src/lib/membresia/vigencia-miembro.ts` con `comprobarVigenciaParaReservar(base, usuarioId, inicioServicio)`: lee con el reloj de la base la `activa` con `fin` más tardío y la `pendiente` con su último pago, reutiliza la comparación de #13 (tarea 1.2) para `fuera_de_vigencia` sin repetirla; devuelve `ok`, `sin_membresia`, `membresia_vencida`, `renovacion_en_revision` o `fuera_de_vigencia`. Pruebas Vitest con dobles: dentro de la vigencia, posterior al fin, justo en el fin (`fuera_de_vigencia`), vencida, renovación en revisión, rechazada dentro del plazo, sin membresía.
- [x] 4.2 Función `aErrorApi(resultado, zona)` con los códigos y mensajes de la spec (`409 membresia_vencida`, `409 renovacion_en_revision`, `422 fuera_de_vigencia`; el mensaje de fecha posterior al fin menciona renovar). Pruebas de cada traducción y de que la fecha sale en hora de Lima.
- [x] 4.3 Cablear el guard en `crearRutaDisponibilidad` (`src/lib/agenda/rutas.ts`) con una dependencia inyectable: solo para quien tiene una membresía `activa`; `409` si vencida o con renovación en revisión; `422 fuera_de_vigencia` si el día completo cae en o después del `fin`; sin cambios para un cliente nuevo. Pruebas de ruta con dobles, incluida la ausencia de sesión (`401`).
- [x] 4.4 Prueba de que el saldo de crédito en horas no levanta el bloqueo (el guard no lee `creditos_horas`; el saldo es del #14).
- [x] 4.5 Hacer que el perfil ofrezca "elegir día y hora" solo con membresía vigente y estado `no_aplica` o `por_vencer`; con `vencida`, `renovacion_en_revision` o `renovacion_rechazada`, mostrar renovar o esperar. Prueba con `renderToStaticMarkup`. No crear reservas.
- [x] 4.6 Documentar el guard (comentario con la firma, los códigos y que la comparación `inicio < fin` es la de #13) y anotar en el reporte si conviene que reprogramar (#12) y `POST /api/reservas` (#13) usen la misma comparación o el guard; no modificar `reprogramar.ts` ni el código de #13 sin la aprobación del usuario.

## 5. Pago de renovación

- [x] 5.1 Crear `src/lib/membresia/plan.ts` con el tipo `PlanDeRenovacion { meses, monto }` y `planDeRenovacion(config)` que devuelve `{ meses: membresia_meses, monto: membresia_precio_mensual × membresia_meses }` leyendo `configuracion` (mismo cálculo que `crearPrimeraReserva`; reutilizarlo si existe una función). No escribir ningún `3`, `89` ni `267`. Pruebas Vitest: con el fixture da 3 meses y 26700 céntimos (S/ 267); con otra configuración (precio 10000, 2 meses) da 2 meses y 20000.
- [x] 5.2 Crear `src/lib/membresia/renovar.ts` y `app/api/membresia/renovar/route.ts` (patrón de `crearRutaReservas`: `requerirSesion`, `415`, `conReintento` con `errorOriginal`, `manejar`). Validar con zod solo `metodo` y `comprobante`; `verificarImagenSubida` antes de la transacción; dentro de `transaccionDeEscritura`: cierre previo del #11, `409 renovacion_no_aplica` / `en_espera` / `pago_rechazado` según la spec, `insert` de la membresía `pendiente` y del pago `membresia` con el monto del plan, y `traducirUnicidad` para `23505`. El plan entra como dependencia inyectable con `planDeRenovacion` por defecto. Pruebas Vitest con dobles (incluida una con un plan inyectado distinto, 1 mes por S/ 89, que demuestra que el monto guardado sale del plan): renovación creada, sin comprobante (`422`), monto ignorado si viene del cliente, sin sesión (`401`), sin JSON (`415`), vigente (`409`), sin membresía (`409`), pendiente (`409`), rechazada dentro del plazo (`409`), plazo vencido (se crea otra) y un corte de conexión que se reintenta una vez.
- [x] 5.3 Declarar que no se llama a `decidirLimpiezaGratis` ni se crea una reserva en este flujo. Prueba: tras renovar, el resultado de `decidirLimpiezaGratis` es el mismo que antes y `reservas` no tiene filas nuevas.
- [x] 5.4 Crear `app/(cuenta)/cuenta/renovar/` (página de servidor que redirige a `/cuenta` si el estado no es `vencida`) y `FormularioRenovacion` (cliente): monto del servidor con `formatearSoles`, Yape (QR), transferencia (CCI), `AVISO_DEMOSTRACION` junto a ambos, subida con `subirComprobante`/`subirImagen`, mensajes de error por código y estilos con módulo CSS propio. Pruebas con `renderToStaticMarkup`: cliente vencido ve monto, QR, CCI y aviso; vigente es redirigido; archivo inválido muestra mensaje.
- [x] 5.5 Pruebas contra la rama `pruebas` del paso por la revisión del #11: el pago de renovación se aprueba (membresía `activa` con `inicio` igual a la aprobación y una `fin` posterior), se rechaza y se reenvía con `POST /api/pagos` sin reserva, un tercero recibe `404` en `GET /api/comprobantes/:id`, y el perfil vuelve a `no_aplica` tras la aprobación. Usar el plan real de `configuracion` y cuentas `@tiza.test`, con limpieza al final.
- [x] 5.6 Comprobar que la lista del administrador (#11) muestra un pago de renovación sin reserva ni coincidencias de dirección; corregir solo lo que falle, con su prueba.
- [ ] 5.7 Tarea del usuario: probar la subida real del comprobante con `BLOB_READ_WRITE_TOKEN` en `.env.local` (no escribir el valor en el repositorio).

## 6. Verificación con la base de pruebas

- [x] 6.1 Prueba contra la rama: una `activa` vencida y una `pendiente` conviven; dos renovaciones simultáneas del mismo cliente guardan solo una (la otra recibe `409 en_espera`).
- [x] 6.2 Prueba contra la rama del aviso: `por_vencer`, `vencida`, `renovacion_en_revision`, `renovacion_rechazada`, plazo vencido que vuelve a `vencida`, `caducada` cerrada por la pasada del #11, y aislamiento entre clientes.
- [x] 6.3 Prueba contra la rama del guard con el reloj de la base: fecha dentro de la vigencia, posterior al `fin` (`422`), vencida (`409`), renovación en revisión (`409`), y `GET /api/disponibilidad` por cada caso; un cliente nuevo no cambia.
- [x] 6.4 Prueba de punta a punta contra la rama con el plan real: vencida → renovar → admin aprueba → disponibilidad vuelve a responder horarios → el perfil ofrece elegir día y hora.
- [x] 6.5 Prueba de que ninguna ruta de este change escribe en `reservas` (el bloqueo solo impide elegir; no toca lo ya agendado, decisión 9).
- [x] 6.6 Ejecutar `npm test`, `npx tsc --noEmit` y `npm run build` y dejar el resultado en el reporte. Sin Playwright.

## 7. Renovación de 3 meses por S/ 267 (decisión provisional 1)

Decisión del usuario, pendiente de confirmar por el negocio. No cambia el modelo ni la aprobación del #11.

- [x] 7.1 Prueba contra la rama `pruebas`: `planDeRenovacion` con la configuración real de la base da 3 meses y S/ 267, y el pago y la membresía pendientes de una renovación guardan ese monto.
- [x] 7.2 Prueba contra la rama de la aprobación (#11): al aprobar una renovación, `fin` es `inicio` más `membresia_meses` (3 meses) y la primera membresía conserva el mismo cálculo. No modificar el código del #11; si la prueba falla, pausar y reportar.
- [x] 7.3 `/cuenta/renovar` y los textos del perfil muestran el monto y la duración del plan (por ejemplo "por 3 meses: S/ 267"), leídos del servidor con `planDeRenovacion`; verificar que el costo mostrado coincide con el pago guardado. Prueba con `renderToStaticMarkup`.
- [x] 7.4 Prueba de que no se puede renovar antes de que venza (`409 renovacion_no_aplica`) y de que la ventana `por_vencer` de 14 días se mantiene sin cambios.
- [x] 7.5 Dejar anotado en el reporte que el monto y la duración son provisionales y que cambiarlos es editar `configuracion` (o `planDeRenovacion` si cambia la regla).

## 8. Reservas del mes 3 sin pago del mes 4 (decisión provisional 2)

La regla actual se mantiene: el servicio empieza antes del `fin`, así que no hay reservas posteriores al `fin` que resolver.

- [x] 8.1 Prueba contra la rama: con una membresía vencida o por vencer, reprogramar (#12) a una fecha en o después del `fin` se rechaza, y ninguna reserva existente cambia de estado al vencer la membresía.
- [x] 8.2 Confirmar por escrito en el reporte que no se agregaron `cancelada_por = 'sistema'`, marcadores ni pasadas sobre `reservas` (la tarea 6.5 prueba que ninguna ruta de este change escribe en `reservas`).

## 9. Despliegue a producción (DIFERIDO hasta cerrar los 18 ítems; no hacer ahora)

- [ ] 9.1 Confirmar que 7.1 a 7.4 pasan contra la rama y que el negocio no cambió las decisiones provisionales (si las cambió, revisar este change antes).
- [ ] 9.2 `npm run db:migrate` **antes** de desplegar (agrega `renovacion_aviso_dias`; sin la clave, `leerConfiguracion` falla).
- [ ] 9.3 `npx vercel deploy --prod`.
- [ ] 9.4 `GET /api/salud` debe responder `200 {"estado":"ok"}`.
- [ ] 9.5 Prueba de humo en producción con una cuenta `@tiza.test` y limpieza de los datos creados; recordar que el sitio mantiene el aviso de demostración.
