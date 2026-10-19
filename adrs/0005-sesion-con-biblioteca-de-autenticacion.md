# ADR 0005: Sesión con biblioteca de autenticación y estado de la reserva en el navegador

## Estado

Aceptado

## Contexto

El PRD exige que cada cliente vea solo sus propios datos y comprobantes, que el portal de administrador requiera rol de admin, que el inicio de sesión sea solo con correo y contraseña (sin códigos ni redes sociales) y que el enlace de "Olvidé mi contraseña" venza y funcione una sola vez. La autenticación es la parte donde un error propio tiene más costo, y el equipo es una persona.

El asistente de reserva por pasos acumula elecciones temporales (servicio, distrito, fecha y hora) antes de que el cliente confirme.

## Decisión

- **Sesión:** se usa una **biblioteca de autenticación** (Better Auth o Auth.js, a elegir al implementar) con **sesiones guardadas en la base de datos** y cookie segura. La biblioteca maneja el registro, el inicio de sesión, el hash de contraseñas, el restablecimiento de contraseña y las sesiones. El rol (`cliente` o `admin`) se comprueba en el servidor en cada ruta.
- **Estado del asistente de reserva:** vive **en el navegador** hasta que el cliente confirma. La reserva se crea en el servidor solo al confirmar. No se guardan borradores en la base de datos.

## Alternativas consideradas

- **Sesiones propias en la base de datos, escritas a mano** — era viable y da control total. No se eligió porque obliga a escribir el hash de contraseñas, el restablecimiento y la protección contra fuerza bruta, donde los errores de seguridad son fáciles de cometer.
- **JWT firmado en una cookie** — era viable y evita consultar la base en cada petición. No se eligió porque cerrar una sesión o quitar un permiso no tiene efecto hasta que el token expira, lo que no es adecuado para el portal de administrador.
- **Guardar el borrador de la reserva en el servidor** — era viable y evitaría perder lo elegido si el cliente cierra la pestaña. No se eligió porque deja borradores abandonados en la base y agrega complejidad sin que el PRD lo pida.

## Consecuencias

- Menos código de seguridad escrito a mano y menos riesgo de errores en el manejo de contraseñas y sesiones.
- Las sesiones se pueden cerrar o revocar de verdad desde el servidor.
- El proyecto depende de una biblioteca y de su configuración. Hay que aprender su forma de trabajar y seguir sus actualizaciones.
- El modelo de datos del ADR 0002 se amplía con las tablas de sesión y cuenta que requiera la biblioteca. Si la biblioteca ya cubre el restablecimiento de contraseña, la tabla `tokens_reset_password` puede reemplazarse por la suya.
- Cada petición autenticada consulta la base de datos, lo que añade latencia, sobre todo cuando Neon despierta tras inactividad.
- Si el cliente cierra la pestaña a la mitad del asistente, pierde lo elegido.
- **Pendiente al implementar:** elegir entre Better Auth y Auth.js y verificar que soporte el flujo de correo con Resend y contraseña sin otros métodos de acceso.
