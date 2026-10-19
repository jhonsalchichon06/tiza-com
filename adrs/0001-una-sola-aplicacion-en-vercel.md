# ADR 0001: Una sola aplicación desplegada en Vercel

## Estado

Aceptado

## Contexto

El PRD exige una web pública (landing y FAQ), un portal del cliente (cuenta, reservas, perfil, reseñas), un portal de administrador (reservas, comprobantes, fotos) y un backend que guarda cuentas, reservas, comprobantes y fotos. El proyecto es greenfield (el código actual es solo una demo de la landing). El equipo es una persona. Restricciones obligatorias: el sistema debe poder desplegarse en el plan gratuito de Vercel y la base de datos es PostgreSQL en Neon.

Servicios externos que el sistema necesita en cualquier caso: Neon (base de datos), Resend (correo de "Olvidé mi contraseña") y un almacenamiento privado de imágenes (comprobantes y fotos del servicio).

## Decisión

El sistema es **una sola aplicación en un solo repositorio y un solo proyecto de Vercel**. Las páginas del cliente, el portal de administrador (bajo `/admin`) y la API viven en la misma aplicación y se despliegan juntos.

El framework concreto se decide en el ADR de stack tecnológico.

## Alternativas consideradas

- **Frontend estático y funciones `/api` en el mismo repositorio** — era viable y reutiliza la estructura actual de páginas HTML. No se eligió porque las páginas dinámicas (perfil, portales) habría que armarlas a mano con JavaScript y repetir la lógica de sesión en cada página.
- **Dos proyectos separados (frontend y API)** — era viable y permite desplegar y escalar cada parte por separado. No se eligió porque duplica la configuración, las variables de entorno y los proyectos gratuitos a vigilar, y agrega CORS. Es excesivo para un equipo de una persona.

## Consecuencias

- Un solo despliegue, una sola configuración de variables de entorno y sin problemas de CORS. Es lo más simple de mantener para una persona.
- La sesión y los permisos (cliente y admin) se validan en un solo lugar del código.
- El frontend y la API quedan acoplados: separarlos más adelante exigirá trabajo.
- Todo comparte los límites del plan gratuito de Vercel de un único proyecto.
