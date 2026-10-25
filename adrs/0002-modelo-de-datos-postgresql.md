# ADR 0002: Modelo de datos relacional en PostgreSQL con restricción de exclusión para las reservas

## Estado

Aceptado. La capacidad se ajusta en el ADR 0007; los precios, la limpieza gratis por hogar, los pagos por reserva y el vínculo entre reserva, membresía y pago en el ADR 0008; la espera de las reservas en el ADR 0009; la dirección del hogar con campos de texto (distrito, dirección normalizada y departamento normalizado en `reservas`) en el ADR 0013, que reemplaza al 0011; las tablas de crédito en horas (`creditos_horas` y `usos_credito`) en el ADR 0012. El modelo vigente está en `TECH-DESIGN.md`.

## Contexto

El PRD exige cuentas con rol de cliente o administrador, una membresía de 3 meses con pago por adelantado, pagos con imagen de comprobante que el administrador aprueba o rechaza, reservas que no excedan la capacidad (2 limpiezas simultáneas, ver ADR 0007), fotos del servicio, reseñas y un flujo de "Olvidé mi contraseña" con enlace de un solo uso. No existe `Design.md`, así que las entidades se derivan solo del PRD. La base de datos obligatoria es PostgreSQL en Neon.

El monto de la membresía y la duración de la renovación del mes 4 están sin definir en el PRD, por lo que no deben quedar fijos en el código.

## Decisión

Modelo relacional en PostgreSQL con estas entidades:

| Entidad | Contenido principal |
|---|---|
| `usuarios` | correo único, hash de la contraseña, nombre, teléfono, rol (`cliente` o `admin`) |
| `membresias` | usuario, inicio, fin, estado (`pendiente`, `activa`, `vencida`), monto |
| `pagos` | membresía, método (`yape` o `transferencia`), referencia a la imagen del comprobante, estado (`pendiente`, `aprobado`, `rechazado`), admin que lo revisó, fecha de revisión |
| `equipos` | nombre, activo (cada equipo atiende una limpieza a la vez; hoy hay 2) |
| `reservas` | usuario, equipo, tipo de servicio, horas, distrito, dirección, rango del servicio (`inicio`–`fin`), rango bloqueado (`inicio` hasta `fin` + 1 hora de traslado), estado, indicador de primera limpieza gratis |
| `fotos_servicio` | reserva, ambiente, referencia a la imagen |
| `resenas` | reserva (una sola por servicio), estrellas, comentario, indicador de aprobada |
| `tokens_reset_password` | usuario, hash del token, vencimiento, indicador de usado |

Reglas de datos:

- **Sin dobles reservas por equipo:** la tabla `reservas` guarda el rango bloqueado como `tstzrange` y tiene una **restricción de exclusión** (extensión `btree_gist`) que rechaza cualquier reserva que se solape con otra del **mismo equipo** en un estado activo. La capacidad de 2 limpiezas simultáneas se obtiene con 2 equipos (ADR 0007, que ajusta la regla original de "1 limpieza a la vez").
- Las fechas se guardan como `timestamptz`.
- Las contraseñas y los tokens de restablecimiento se guardan solo como hash, nunca en texto plano.
- El monto de la membresía se guarda como dato en `membresias`, no fijo en el código.
- Las imágenes no se guardan en la base de datos: solo su referencia en el almacenamiento privado.

## Alternativas consideradas

- **Tabla de franjas por hora con índice único** — era viable y portable. No se eligió porque obliga a generar y mantener las franjas, y reservar o cancelar un servicio de varias horas toca varias filas a la vez.
- **Validación de solapes solo en el código de la aplicación** — era viable y no exige nada especial de la base de datos. No se eligió porque un error de lógica o una carrera entre dos peticiones puede dejar pasar una doble reserva, y esa regla es crítica para el negocio.

## Consecuencias

- La regla de no solapar reservas dentro de cada equipo queda garantizada aunque haya bugs en el código o dos peticiones simultáneas.
- Un cliente que pierde la carrera recibe un error claro de conflicto y puede elegir otra hora.
- La restricción de exclusión es una característica específica de PostgreSQL y exige la extensión `btree_gist`. Neon la lista como extensión soportada; se habilita con `CREATE EXTENSION IF NOT EXISTS btree_gist;` en la primera migración.
- Las migraciones de esquema son más delicadas que con un modelo sin restricciones, y el rango de tiempo requiere cuidado con las zonas horarias.
- El ADR 0005 amplía este modelo con las tablas de sesión y cuenta que requiera la biblioteca de autenticación, y puede reemplazar `tokens_reset_password` por las suyas.
- Sin `Design.md`, el modelo puede necesitar ajustes cuando se diseñe la interfaz (por ejemplo, campos que una pantalla necesite mostrar).
