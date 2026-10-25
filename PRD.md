---
title: "Tiza.com"
---

# PRD: Tiza.com

## Problema

Tiza.com es un servicio nuevo de limpieza de hogares en Lima sin canal de reservas propio. Hoy quien quiere contratar no puede ver precios, elegir fecha y confirmar sin escribir y esperar respuesta, y no hay registro de quién reservó ni quién tiene membresía.

Además, una oferta de "primera limpieza gratis" atrae a gente que solo busca lo gratis y se va después de usarla. El problema central es convertir a esos visitantes en clientes leales, no solo conseguir la primera visita. Por eso la primera limpieza gratis se desbloquea únicamente al pagar por adelantado una membresía.

La web es hoy el canal principal del negocio. El frontend ya existe como demo en el navegador (landing, asistente de reserva, Tiza Club, paquetes por hora, inicio de sesión y perfil con datos de ejemplo guardados en `localStorage`). Falta el backend real.

**Contexto del proyecto:** es un proyecto de desarrollo. Los pagos de la membresía son **simulados**, incluso cuando el sitio esté en producción en Vercel: no se mueve dinero real. El flujo completo (elegir Yape o transferencia, ver el QR o la CCI, subir el comprobante y aprobarlo en el portal) funciona igual que en un negocio real, pero es una demostración: el QR de Yape y la CCI que se muestran son los del titular del proyecto, los comprobantes son de prueba y ningún pago se procesa de forma automática. Por eso el sitio muestra un **aviso de demostración** (ver alcance, punto 3).

## Usuario objetivo

**Cliente nuevo.** Adulto de 30 a 70 años que no tiene tiempo para limpiar por el trabajo, o que no puede hacerlo por limitaciones de salud. Hoy tiene empleados que limpian o limpia él mismo, y usaría Tiza para limpieza profunda o especializada, para dejar un departamento listo para alquilar o para devolverlo al terminar un alquiler. Llega a la web, elige un servicio y paga la membresía para recibir la primera limpieza gratis.

**Cliente actual.** El mismo perfil, con la membresía activa. Entra a su perfil para ver su historial, reservar de nuevo, dejar reseñas y gestionar su plan.

Propietarios e inquilinos usan el mismo flujo.

**Anti-persona.** Quien solo quiere lo gratis y se va. El diseño no debe facilitarle ese camino.

**Distritos de v1:** San Borja, San Isidro, Santiago de Surco, Barranco, Miraflores, San Luis, San Miguel, Jesús María y Lince.

<!-- REVISAR: el rango de 30 a 70 años se usa como contexto de diseño (textos grandes, flujo simple), no como filtro en el sistema. -->
<!-- REVISAR: la web hoy lista La Molina, Magdalena, Pueblo Libre y Chorrillos y no incluye San Luis. Hay que alinear la lista a los 9 distritos de v1. -->

## Objetivo / resultado esperado

El cliente continúa con el servicio después de la primera limpieza y se convierte en cliente leal. Un cliente activo realiza al menos **12 limpiezas al año**, es decir, una al mes en promedio.

Se mide con un resultado híbrido:

- **Conversión:** quien llega al paso de pago activa la membresía.
- **Lealtad:** quien paga la membresía llega a 3 limpiezas en sus primeros 4 meses.

## Alcance (qué sí incluye esta versión)

1. Cuenta real de cliente en Neon con correo y contraseña (mínimo 8 caracteres), y flujo de **"Olvidé mi contraseña"** con enlace por correo enviado con Resend. El enlace vence a la **1 hora** y solo se puede usar una vez.
2. Elegir servicio (por tamaño del hogar o por horas), distrito, fecha y hora. El horario de atención es de **lunes a sábado, de 8 am a 6 pm**.
   - **Capacidad:** se pueden realizar **2 limpiezas al mismo tiempo**. La capacidad es un valor configurable, porque el personal puede seguir creciendo. Cada reserva se asigna automáticamente al primer equipo libre (hoy hay 2 equipos).
   - **Traslado:** después de cada limpieza se bloquea **1 hora** para el traslado del personal, además de las horas del servicio.
   - Los horarios sin cupo disponible se muestran **en gris y deshabilitados** en la interfaz, teniendo en cuenta la duración del servicio elegido.
   - **Anticipación mínima:** toda reserva se agenda con al menos **48 horas** de anticipación, para que la espera de aprobación del pago (máximo 24 horas) termine siempre antes del servicio.
   - **Solo miembros:** para elegir día y hora el cliente necesita una membresía vigente en la fecha del servicio. Si está pagando su primera membresía en ese mismo paso, la fecha debe caer dentro de los 3 meses siguientes.
   - **Dirección con campos de texto:** el cliente elige su distrito de una lista cerrada con los 9 de v1 y escribe la calle, el número y, aparte, su departamento o interior (opcional) y referencias (opcional). El sistema exige un distrito de v1, una calle y un número, y normaliza el texto. No se verifica en un mapa que la dirección exista.
3. Membresía de **3 meses pagada en un solo pago por adelantado**, que desbloquea la primera limpieza gratis. En el paso de pago el cliente elige entre dos opciones:
   - **Yape:** se muestra el código QR de Tiza.
   - **Transferencia:** se muestra la CCI de Tiza.

   En ambos casos el cliente **sube una imagen del comprobante en el portal** (la confirmación del Yape o el comprobante de transferencia, que normalmente muestra el número de operación). La imagen debe ser JPG, PNG o WebP, de **máximo 5 MB**. La membresía queda pendiente hasta que el administrador apruebe el pago, y sus 3 meses de vigencia empiezan a contar desde esa aprobación. La reserva de la primera limpieza gratis queda en espera por un máximo de **24 horas**; pasado ese plazo expira y libera el horario.

   - **Las 3 primeras horas de la primera limpieza son gratis.** Si el servicio dura más, el cliente paga las horas adicionales de forma proporcional y con el descuento de miembro: precio del servicio ÷ horas del servicio × horas adicionales × 0,9. Ese monto se paga en el mismo comprobante de la membresía. *Ejemplo: una limpieza profunda de 2 dormitorios y 1 baño dura 5 h y cuesta S/ 193,50 → 2 h × S/ 38,70 = S/ 77,40, menos 10% = S/ 69,66.*
   - **Una sola limpieza gratis por cliente y por hogar.** La renovación de la membresía **no** da otra. Para evitar que se repita con otra cuenta, el sistema compara la **dirección del hogar**: un hogar (el distrito, la calle y el número escritos y normalizados, más el departamento) recibe la limpieza gratis una sola vez. La normalización unifica tildes, mayúsculas y abreviaturas, pero no detecta toda variante de la misma casa; el administrador revisa las coincidencias al aprobar el pago.
   - **Si la primera limpieza se cancela**, el beneficio no se pierde: se aplica a la siguiente reserva del cliente, siempre que siga siendo su primera limpieza (que no tenga otra realizada, confirmada ni en espera) y que esa dirección no haya recibido ya una limpieza gratis.
   - Si el administrador aprueba el pago **después** de que la reserva expiró, la membresía se activa igual y el perfil le pide al cliente elegir un nuevo día y hora para su limpieza gratis.
   - **Aviso de demostración:** mientras los pagos sean simulados, el sitio lo dice de forma visible y con el mismo texto en tres lugares: un aviso fijo en el paso de pago (junto al QR y la CCI), en la pantalla de reserva enviada y en el pie de todas las páginas públicas. Texto: «Sitio de demostración: los pagos son simulados. No hagas ninguna transferencia ni pago real.» Si alguien paga de verdad por error, el sistema no lo procesa y el administrador no lo aprueba; se coordina por WhatsApp. Cuando el negocio pase a cobrar de verdad, se quitan el aviso y los datos de prueba, y eso requiere actualizar este PRD.
4. **Pago de las demás limpiezas.** Cada limpieza que no es la gratis se paga por adelantado con el mismo flujo de la membresía: Yape o transferencia, comprobante subido en el portal y aprobación del administrador. Los miembros pagan el precio de lista con un **10% de descuento**. La reserva queda en espera hasta la aprobación, con el mismo plazo máximo de 24 horas. Si el pago se aprueba después de que la reserva expiró, el cliente elige un nuevo día y hora desde el perfil sin volver a pagar. Los precios, las duraciones y sus parámetros se guardan como datos, no en el código.
   - **Duración de un servicio por tamaño del hogar:** todo hogar tiene 1 cocina. La limpieza estándar dura según el **nivel** del hogar, y se usa el primer nivel cuyos dormitorios **y** baños alcanzan para cubrirlo:

     | Nivel | Hogar (además de 1 cocina) | Limpieza estándar | Precio estándar |
     |---|---|---|---|
     | 1 | 1 baño, sin dormitorios | 2 h | S/ 66 |
     | 2 | hasta 1 dormitorio y 1 baño | 3 h | S/ 99 |
     | 3 | hasta 2 dormitorios y 2 baños | 4 h | S/ 129 |
     | 4 | más de 2 dormitorios o más de 2 baños | 6 h (máximo) | S/ 189 |

     *Ejemplos: 2 dormitorios y 1 baño → nivel 3 (4 h); 1 dormitorio y 2 baños → nivel 3 (4 h); 3 dormitorios y 2 baños → nivel 4 (6 h); 5 dormitorios y 4 baños → nivel 4 (6 h).* La limpieza profunda dura **1 h más** que la estándar y la de mudanza **2 h más**. Como el apoyo extra puede dejar duraciones con media hora, los horarios de inicio se ofrecen **cada 30 minutos**.
   - **Precio de un servicio por tamaño:** el precio del nivel (que equivale a S/ 33 por hora en el nivel 1 y a los paquetes por horas en los niveles 2 a 4) × 1 (estándar), × 1,5 (profunda) o × 1,7 (mudanza). *Ejemplo: 2 dormitorios y 1 baño → estándar S/ 129, profunda S/ 193,50, mudanza S/ 219,30.*
   - **Servicios por horas:** paquetes de 3 h (S/ 99), 4 h (S/ 129), 6 h (S/ 189) y 8 h (S/ 239).
   - **Hogares grandes con apoyo extra:** si un servicio por tamaño dura **más de 6 horas** con 1 persona, va una **segunda persona de apoyo** y el servicio ocupa en la agenda **la mitad del tiempo**, redondeado hacia arriba a 30 minutos (más la hora de traslado). La persona de apoyo **no es parte del equipo**: el administrador la consigue y la coordina por su cuenta. El sistema solo marca la reserva como "requiere apoyo" y le avisa al administrador. El precio y las 3 horas gratis se calculan siempre sobre las horas de trabajo de 1 persona, así que el precio no cambia según quién vaya. *Ejemplo: 3 dormitorios y 2 baños en profunda = 7 h de trabajo → 3,5 h en la agenda con 2 personas.* Con los niveles actuales, solo llevan apoyo la profunda (7 h) y la mudanza (8 h) del nivel 4. Los paquetes por horas no llevan apoyo, porque el cliente elige el tiempo de 1 profesional.
   <!-- REVISAR: los precios de los paquetes y los multiplicadores salen de la demo; confirmar que siguen vigentes. -->
   <!-- REVISAR: decisión del usuario (2026-10-21), pendiente de confirmar por el negocio: si el administrador no consigue a la persona de apoyo para una reserva confirmada, **se reprograma con el cliente** (por WhatsApp, fuera del sistema) y el pago se conserva: no se cancela ni se convierte en crédito. El administrador cambia el horario de la reserva a nombre del cliente desde el portal. El sistema no avisa solo al cliente: el PRD no tiene notificaciones salientes. -->
   - **Crédito en horas por cancelación:** si el cliente cancela una limpieza pagada (hasta 24 horas antes), las horas que pagó no se devuelven en dinero: pasan a un **crédito en horas** para su siguiente servicio. El crédito **vence a los 3 meses** de la cancelación que lo generó y se descuenta solo, empezando por el que vence antes, de las horas a pagar en la siguiente reserva. Si cubre todas las horas, no hace falta subir un comprobante. Para usarlo hace falta una membresía vigente, como para cualquier reserva.
     - Las 3 horas gratis de una primera limpieza cancelada no se convierten en crédito: se reusan en la siguiente reserva (ver punto 3). Las horas adicionales que sí pagó pasan a crédito.
     - Si la reserva cancelada se había pagado en parte con crédito, esas horas vuelven a su crédito original, con su vencimiento original.
     - El crédito se genera solo cuando el pago de la reserva cancelada está aprobado. Si el cliente cancela antes de la aprobación y el administrador la aprueba después, el crédito se genera en ese momento.
5. **Una sola reserva en espera por cliente:** un cliente no puede tener más de una reserva esperando la aprobación de su pago, y una reserva solo se crea junto con su comprobante. Así nadie puede bloquear horarios sin pagar.
6. Guardar la reserva sin dobles reservas para la misma hora.
7. Perfil del cliente actual:
   - Estado de la membresía y avisos dentro del perfil.
   - Próximas reservas, con opción de reprogramar y cancelar hasta **24 horas antes** del servicio.
   - **Saldo de crédito en horas**, con la fecha de vencimiento de cada crédito y el detalle de dónde salió y en qué se usó.
   - Historial con detalle de cada servicio: fotos del servicio y una reseña (estrellas y comentario), una sola por limpieza completada. Una reseña se muestra públicamente en la web solo después de que el administrador la apruebe.
8. **Continuidad en el mes 4:** el perfil muestra una notificación indicando que debe realizar un nuevo pago para que el servicio del mes 4 sea válido. Una vez aprobado el pago, el cliente elige día y hora desde el perfil.
9. Portal de administrador:
   - Ver y gestionar las reservas, y marcar como **completada** cada limpieza realizada (a mano). Solo una reserva completada puede tener fotos del servicio y reseña.
   - Revisar los comprobantes subidos y aprobar o rechazar los pagos.
   - Reasignar una reserva a otro equipo cuando haga falta.
   - Ver las reservas que requieren una persona de apoyo, ordenadas por fecha, y marcar el apoyo como coordinado.
   - Ver el crédito en horas de cada cliente.
   - Subir las fotos del servicio después de cada limpieza.
   - Aprobar las reseñas antes de que se muestren en la web.
10. Enlace a WhatsApp con el mensaje de la reserva ya escrito, solo para coordinar detalles.
11. Sección de preguntas frecuentes (FAQ).

Todo el sistema corre en **Vercel** (aplicación y funciones) con base de datos **Neon**. Las imágenes (fotos del servicio y comprobantes) se guardan en un almacenamiento privado. <!-- REVISAR: asumo Vercel Blob para las imágenes. Los comprobantes deben ser privados y visibles solo para el cliente que los subió y para el admin. -->

Las reseñas de ejemplo de la landing se reemplazan por reseñas reales de clientes, aprobadas por el administrador, a medida que lleguen.

## No alcance (qué explícitamente no incluye esta versión)

- No hay cobro en línea con tarjeta ni pasarela de pago (solo Yape o transferencia con confirmación manual).
- No hay envío automático de mensajes de WhatsApp (solo el enlace con el mensaje prellenado).
- No hay app ni portal para el personal de limpieza, ni asignación automática de personas a cada servicio. Las reservas se asignan a un equipo (cupo interno), no a una persona concreta. La persona de apoyo de los hogares grandes la coordina el administrador fuera del sistema; el sistema solo marca qué reservas la necesitan.
- No hay boleta o factura electrónica generada por el sistema.
- No hay reembolsos en dinero: el pago de la membresía no se devuelve, y el de una limpieza cancelada se convierte en crédito en horas.
- No se atienden distritos fuera de los 9 definidos.
- No hay inicio de sesión con redes sociales ni códigos de un solo uso por correo o SMS (solo correo y contraseña).
- No hay cupones ni programa de referidos.
- No hay verificación de la dirección en un mapa (Google Maps u otro): la dirección es texto que escribe el cliente.
- No hay cobro automático ni renovación automática de la membresía.
- No hay notificaciones por correo, SMS o WhatsApp para la renovación: los avisos aparecen dentro del perfil.

## Criterios de éxito

- **Métrica principal (lealtad):** al menos 50% de los miembros que pagan llegan a 3 limpiezas dentro de sus primeros 4 meses.
- **Ancla anual:** un cliente activo promedia 12 limpiezas al año.
- **Conversión:** 3 de cada 10 clientes que llegan al paso de pago activan la membresía.
- **Facilidad:** un cliente nuevo completa su reserva en menos de 3 minutos sin ayuda.
- **Revisión:** 4 meses después del lanzamiento.
- **Métrica que no se mira:** "primeras limpiezas gratis entregadas", porque sube con los cazadores de gratis y no con la lealtad.

<!-- REVISAR: el 50% de lealtad y la ventana de revisión de 4 meses son propuestas mías, no confirmadas. -->
<!-- REVISAR: la conversión se mide como 3 de cada 10 que llegan al paso de pago. La frase original ("que hacen pago") puede referirse a otra base. -->

## Casos borde a contemplar

1. **Comprobante pendiente o rechazado.** La reserva (gratis o pagada) queda en espera hasta que el admin apruebe el pago, con un máximo de **24 horas**. Si el comprobante se rechaza, el cliente puede subir otro dentro de ese plazo; si el plazo vence, la reserva expira y el horario se libera. Si el pago se rechaza y la reserva ya expiró, el cliente tiene **7 días corridos desde el rechazo** para subir otro comprobante (plazo guardado en `configuracion`, no en el código). Si se aprueba, rige la aprobación tardía: la membresía se activa y elige un nuevo día y hora sin volver a pagar. Si pasan los 7 días sin un comprobante nuevo, la membresía en espera se cierra y el cliente puede empezar de nuevo con una reserva y un pago nuevos.
2. **Misma hora, dos clientes.** Cuando una hora ya no tiene cupo (2 limpiezas simultáneas, más el traslado de 1 hora), el sistema acepta solo las reservas que caben y avisa al cliente que llegó tarde para que elija otra hora. Esto incluye varias reservas simultáneas por el mismo cupo.
3. **Cancelación de la membresía.** La membresía dura 3 meses y no se puede cancelar ni reembolsar antes de ese plazo.
4. **Comprobante inválido o falso.** El admin lo rechaza y el cliente sube otra imagen. El sistema solo acepta imágenes JPG, PNG o WebP de hasta 5 MB.
5. **Acceso indebido.** Cada cliente ve solo sus propias reservas y comprobantes. El portal de administrador exige una cuenta con rol de admin. Intentar abrir datos de otro cliente por la URL debe fallar.
6. **Mes 4 sin pago.** Si el cliente no paga la renovación, no puede elegir día y hora para reservar nuevas limpiezas.
7. **Contraseña olvidada.** El enlace de restablecimiento por correo vence a la 1 hora y funciona una sola vez.
8. **Aprobación tardía.** Si el admin aprueba un pago cuando su reserva ya expiró, el pago vale igual: la membresía se activa (si era parte del pago) y el cliente elige un nuevo día y hora desde el perfil, sin volver a pagar.
9. **Bloqueo de horarios sin pagar.** Una reserva solo se crea junto con su comprobante, y cada cliente puede tener como máximo una reserva en espera. Si un comprobante es claramente falso, el admin puede cancelar la reserva para liberar el horario antes de las 24 horas.
10. **Limpieza gratis repetida.** Una segunda cuenta con la misma dirección no recibe las 3 horas gratis: paga el servicio completo. Al aprobar un pago con limpieza gratis, el admin ve las direcciones parecidas del mismo distrito que ya la recibieron y puede rechazar el pago si es la misma casa escrita de otra forma.
11. **Primera limpieza cancelada.** Si el cliente la cancela (hasta 24 horas antes), su siguiente reserva recibe las 3 horas gratis, siempre que siga siendo su primera limpieza.

<!-- REVISAR: decisión del usuario (2026-10-21), pendiente de confirmar por el negocio: se mantiene la regla actual, según la cual el servicio debe empezar antes del fin de la membresía (también al reprogramar), así que ninguna reserva puede quedar agendada después del fin y no hay reservas del mes 3 que resolver si el pago del mes 4 no llega. Sin pago de renovación solo se bloquea elegir día y hora para reservas nuevas. -->

## Supuestos y riesgos abiertos

**Supuestos:**

- Un cliente de 30 a 70 años puede subir la imagen de un comprobante desde su celular sin ayuda.
- Pagar con Yape o transferencia, sin tarjeta, es aceptable para el público.
- El administrador confirma los pagos a mano y a tiempo.
- El personal propio alcanza para la demanda de los 9 distritos con 2 limpiezas simultáneas y 1 hora de traslado entre servicios.
- Con la membresía propuesta, regalar las 3 primeras horas de la primera limpieza deja margen.
- Comparar direcciones normalizadas basta para frenar la mayoría de los intentos de repetir la limpieza gratis; las variaciones que se escapen las detecta el administrador al aprobar el pago.

**Riesgos:**

- **Renovación manual en el mes 4.** Sin cobro automático y con avisos solo dentro del perfil, el cliente puede no ver la notificación y dejar de usar el servicio.
- **Capacidad limitada.** Con 2 limpiezas simultáneas y 1 hora de traslado, el ingreso máximo lo marca el personal. Es una limitación conocida; la capacidad es configurable para crecer.
- **Cazadores de gratis.** El pago adelantado de 3 meses y la ausencia de reembolsos reducen el riesgo, pero hay una barrera alta de entrada que puede bajar la conversión.
- **Comprobantes falsos.** Un comprobante editado puede pasar si el admin no lo contrasta con su cuenta.
- **Persona de apoyo no disponible.** Los hogares de más de 6 horas dependen de conseguir a una persona extra que no es del equipo. Si no aparece, el servicio no cabe en el tiempo reservado. Además, cada apoyo es un costo que reduce el margen, porque el precio no cambia.
- **Dirección sin verificar.** Sin mapa, el sistema no comprueba que la dirección exista ni que esté en el distrito elegido, y una misma casa escrita de otra forma puede recibir otra limpieza gratis. Lo contiene el administrador al revisar cada pago con limpieza gratis.
- **Carga del administrador.** Como cada limpieza pagada requiere aprobar un comprobante, el trabajo de revisión crece con cada reserva. Si el admin no revisa a tiempo (por ejemplo, los domingos), las reservas expiran y el cliente debe elegir otra hora.
- **Datos de pago reales en un sitio de demostración.** El QR y la CCI mostrados son los del titular del proyecto. El aviso de demostración reduce, pero no elimina, el riesgo de que un visitante transfiera dinero real por error; ese dinero no se vincula a ninguna reserva y habría que devolverlo a mano.
- **Límites de los servicios gratuitos** de Vercel, Neon y Resend si el tráfico crece.

<!-- REVISAR: no indicaste cuál de estos riesgos es el que más te preocupa. -->
<!-- REVISAR: el monto de la membresía de 3 meses sigue sin confirmar por el negocio. Decisión del usuario (2026-10-21): por ahora se toma S/ 89 al mes (el valor de la demo), es decir, S/ 267 en un solo pago. Se guarda en `configuracion` (`membresia_precio_mensual` × `membresia_meses`), marcado `provisional`, y se muestra solo en el paso de pago (no en la landing). Cambiarlo es editar datos, no código. -->
<!-- REVISAR: decisión del usuario (2026-10-21), pendiente de confirmar por el negocio: el pago de renovación es por otro período de 3 meses, en un solo pago de S/ 267 (S/ 89 al mes), igual que la primera membresía y con el mismo flujo de pago y aprobación. La renovación no da otra limpieza gratis. Solo se puede renovar cuando la membresía ya venció. -->
