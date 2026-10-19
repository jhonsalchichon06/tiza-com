---
title: "Tiza.com"
---

# PRD: Tiza.com

## Problema

Tiza.com es un servicio nuevo de limpieza de hogares en Lima sin canal de reservas propio. Hoy quien quiere contratar no puede ver precios, elegir fecha y confirmar sin escribir y esperar respuesta, y no hay registro de quién reservó ni quién tiene membresía.

Además, una oferta de "primera limpieza gratis" atrae a gente que solo busca lo gratis y se va después de usarla. El problema central es convertir a esos visitantes en clientes leales, no solo conseguir la primera visita. Por eso la primera limpieza gratis se desbloquea únicamente al pagar por adelantado una membresía.

La web es hoy el canal principal del negocio. El frontend ya existe como demo en el navegador (landing, asistente de reserva, Tiza Club, paquetes por hora, inicio de sesión y perfil con datos de ejemplo guardados en `localStorage`). Falta el backend real.

**Contexto del proyecto:** es un proyecto de desarrollo. Los pagos de la membresía son **simulados**, incluso cuando el sitio esté en producción en Vercel: no se mueve dinero real. El flujo completo (elegir Yape o transferencia, ver el QR o la CCI, subir el comprobante y aprobarlo en el portal) funciona igual que en un negocio real, pero el QR, la CCI y los comprobantes son de demostración.

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
3. Membresía de **3 meses pagada en un solo pago por adelantado**, que desbloquea la primera limpieza gratis. En el paso de pago el cliente elige entre dos opciones:
   - **Yape:** se muestra el código QR de Tiza.
   - **Transferencia:** se muestra la CCI de Tiza.

   En ambos casos el cliente **sube una imagen del comprobante en el portal** (la confirmación del Yape o el comprobante de transferencia, que normalmente muestra el número de operación). La imagen debe ser JPG, PNG o WebP, de **máximo 5 MB**. La membresía queda pendiente hasta que el administrador apruebe el pago, y sus 3 meses de vigencia empiezan a contar desde esa aprobación. La reserva de la primera limpieza gratis queda en espera por un máximo de **24 horas**; pasado ese plazo expira y libera el horario.
4. Guardar la reserva sin dobles reservas para la misma hora.
5. Perfil del cliente actual:
   - Estado de la membresía y avisos dentro del perfil.
   - Próximas reservas, con opción de reprogramar y cancelar hasta **24 horas antes** del servicio.
   - Historial con detalle de cada servicio: fotos del servicio y una reseña (estrellas y comentario), una sola por limpieza completada. Una reseña se muestra públicamente en la web solo después de que el administrador la apruebe.
6. **Continuidad en el mes 4:** el perfil muestra una notificación indicando que debe realizar un nuevo pago para que el servicio del mes 4 sea válido. Una vez aprobado el pago, el cliente elige día y hora desde el perfil.
7. Portal de administrador:
   - Ver y gestionar las reservas.
   - Revisar los comprobantes subidos y aprobar o rechazar los pagos.
   - Reasignar una reserva a otro equipo cuando haga falta.
   - Subir las fotos del servicio después de cada limpieza.
   - Aprobar las reseñas antes de que se muestren en la web.
8. Enlace a WhatsApp con el mensaje de la reserva ya escrito, solo para coordinar detalles.
9. Sección de preguntas frecuentes (FAQ).

Todo el sistema corre en **Vercel** (aplicación y funciones) con base de datos **Neon**. Las imágenes (fotos del servicio y comprobantes) se guardan en un almacenamiento privado. <!-- REVISAR: asumo Vercel Blob para las imágenes. Los comprobantes deben ser privados y visibles solo para el cliente que los subió y para el admin. -->

Las reseñas de ejemplo de la landing se reemplazan por reseñas reales de clientes, aprobadas por el administrador, a medida que lleguen.

## No alcance (qué explícitamente no incluye esta versión)

- No hay cobro en línea con tarjeta ni pasarela de pago (solo Yape o transferencia con confirmación manual).
- No hay envío automático de mensajes de WhatsApp (solo el enlace con el mensaje prellenado).
- No hay app ni portal para el personal de limpieza, ni asignación automática de personas a cada servicio. Las reservas se asignan a un equipo (cupo interno), no a una persona concreta.
- No hay boleta o factura electrónica generada por el sistema.
- No hay reembolsos: el pago de la membresía no se devuelve.
- No se atienden distritos fuera de los 9 definidos.
- No hay inicio de sesión con redes sociales ni códigos de un solo uso por correo o SMS (solo correo y contraseña).
- No hay cupones ni programa de referidos.
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

1. **Comprobante pendiente o rechazado.** La reserva gratis queda en espera hasta que el admin apruebe el pago, con un máximo de **24 horas**. Si el comprobante se rechaza, el cliente puede subir otro dentro de ese plazo; si el plazo vence, la reserva expira y el horario se libera.
2. **Misma hora, dos clientes.** Cuando una hora ya no tiene cupo (2 limpiezas simultáneas, más el traslado de 1 hora), el sistema acepta solo las reservas que caben y avisa al cliente que llegó tarde para que elija otra hora. Esto incluye varias reservas simultáneas por el mismo cupo.
3. **Cancelación de la membresía.** La membresía dura 3 meses y no se puede cancelar ni reembolsar antes de ese plazo.
4. **Comprobante inválido o falso.** El admin lo rechaza y el cliente sube otra imagen. El sistema solo acepta imágenes JPG, PNG o WebP de hasta 5 MB.
5. **Acceso indebido.** Cada cliente ve solo sus propias reservas y comprobantes. El portal de administrador exige una cuenta con rol de admin. Intentar abrir datos de otro cliente por la URL debe fallar.
6. **Mes 4 sin pago.** Si el cliente no paga la renovación, no puede elegir día y hora para reservar nuevas limpiezas.
7. **Contraseña olvidada.** El enlace de restablecimiento por correo vence a la 1 hora y funciona una sola vez.

<!-- REVISAR: no se definió qué pasa con las reservas ya agendadas del mes 3 si el pago del mes 4 no llega. -->

## Supuestos y riesgos abiertos

**Supuestos:**

- Un cliente de 30 a 70 años puede subir la imagen de un comprobante desde su celular sin ayuda.
- Pagar con Yape o transferencia, sin tarjeta, es aceptable para el público.
- El administrador confirma los pagos a mano y a tiempo.
- El personal propio alcanza para la demanda de los 9 distritos con 2 limpiezas simultáneas y 1 hora de traslado entre servicios.
- Con la membresía propuesta, la primera limpieza gratis de hasta S/ 150 deja margen.

**Riesgos:**

- **Renovación manual en el mes 4.** Sin cobro automático y con avisos solo dentro del perfil, el cliente puede no ver la notificación y dejar de usar el servicio.
- **Capacidad limitada.** Con 2 limpiezas simultáneas y 1 hora de traslado, el ingreso máximo lo marca el personal. Es una limitación conocida; la capacidad es configurable para crecer.
- **Cazadores de gratis.** El pago adelantado de 3 meses y la ausencia de reembolsos reducen el riesgo, pero hay una barrera alta de entrada que puede bajar la conversión.
- **Comprobantes falsos.** Un comprobante editado puede pasar si el admin no lo contrasta con su cuenta.
- **Límites de los servicios gratuitos** de Vercel, Neon y Resend si el tráfico crece.

<!-- REVISAR: no indicaste cuál de estos riesgos es el que más te preocupa. -->
<!-- REVISAR: el monto de la membresía de 3 meses no está definido. La demo usa S/ 89 al mes, lo que daría S/ 267 en un solo pago. -->
<!-- REVISAR: no está definido cuánto dura el pago de la renovación (otro período de 3 meses o mes a mes). -->
