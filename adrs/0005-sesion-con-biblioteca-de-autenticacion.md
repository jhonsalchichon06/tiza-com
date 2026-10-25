# ADR 0005: Sesión con biblioteca de autenticación y estado de la reserva en el navegador

## Estado

Aceptado

## Contexto

El PRD exige que cada cliente vea solo sus propios datos y comprobantes, que el portal de administrador requiera rol de admin, que el inicio de sesión sea solo con correo y contraseña (sin códigos ni redes sociales) y que el enlace de "Olvidé mi contraseña" venza y funcione una sola vez. La autenticación es la parte donde un error propio tiene más costo, y el equipo es una persona.

El asistente de reserva por pasos acumula elecciones temporales (servicio, distrito, fecha y hora) antes de que el cliente confirme.

## Decisión

- **Sesión:** se usa **Better Auth** (versión fija en `package.json`) con **sesiones guardadas en la base de datos** y cookie segura (`HttpOnly`, `SameSite=Lax`, `Secure` en producción). La biblioteca maneja el registro, el inicio de sesión, el hash de contraseñas (scrypt), el restablecimiento de contraseña y las sesiones. El rol (`cliente` o `admin`) se lee de la base y se comprueba en el servidor en cada ruta; no se usa la caché de sesión en cookie, para que retirar un rol tenga efecto en la siguiente petición.
- **Integración:** no se publica el manejador HTTP de Better Auth. Las rutas propias (`/api/sesion/registro` y `/api/sesion`) llaman a su API desde el servidor, validan los datos con zod y responden con el formato único de errores y mensajes en español (ADR 0003). Las tablas usan nombres en español (`usuarios`, `sesiones`, `cuentas`, `verificaciones`). El hash de la contraseña vive en `cuentas.password`.
- **Rol de administrador:** el registro siempre crea cuentas `cliente` y el campo `rol` no se acepta como entrada. El rol `admin` solo se otorga con `npm run admin:promover -- <correo>`, que necesita acceso a la base.
- **Estado del asistente de reserva:** vive **en el navegador** hasta que el cliente confirma. La reserva se crea en el servidor solo al confirmar. No se guardan borradores en la base de datos.

## Alternativas consideradas

- **Auth.js (NextAuth v5)** — se evaluó junto a Better Auth. No se eligió porque sigue en beta y, con correo y contraseña, solo admite sesiones JWT (descartadas abajo); además no trae hash ni restablecimiento de contraseña.
- **Publicar el manejador HTTP de Better Auth (`/api/auth/*`)** — es la integración que recomienda la biblioteca. No se eligió porque responde errores en inglés y con otro formato, y expone endpoints que el sitio no usa.
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
- El límite de intentos que trae Better Auth solo actúa sobre su manejador HTTP. Como no se publica, el inicio de sesión no tiene límite de intentos; si hace falta, se agrega aparte (por ejemplo, con el firewall de Vercel).
- Una actualización de Better Auth puede cambiar sus campos o códigos de error. Hay pruebas que comparan el esquema con lo que espera la biblioteca y que verifican la traducción de errores.
