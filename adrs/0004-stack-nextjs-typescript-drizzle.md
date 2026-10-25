# ADR 0004: Stack tecnológico: Next.js, TypeScript y Drizzle ORM

## Estado

Aceptado. El driver de Neon para transacciones se precisa en el ADR 0009 y la subida de imágenes en el ADR 0010.

## Contexto

El sistema es una sola aplicación (ADR 0001) con API REST (ADR 0003) y base de datos PostgreSQL en Neon (ADR 0002). Debe poder desplegarse en el plan gratuito de Vercel. El equipo es una persona. El proyecto es greenfield: la demo existente (HTML, CSS y JavaScript con Vite) es solo referencia visual y puede reescribirse. El modelo de datos usa una restricción de exclusión sobre rangos de tiempo, que el ORM no expresa de forma nativa.

El PRD ya nombra Resend para el correo y asume un almacenamiento privado de imágenes para comprobantes y fotos del servicio.

## Decisión

- **Framework:** Next.js (App Router), que sirve las páginas del cliente, el portal de administrador y las rutas `/api` desde un solo proyecto.
- **Lenguaje:** TypeScript en toda la aplicación.
- **Acceso a datos:** Drizzle ORM con el driver serverless de Neon. Las migraciones que el ORM no expresa bien (rango `tstzrange` y restricción de exclusión con `btree_gist`, ADR 0002) se escriben como SQL en la migración.
- **Correo:** Resend, para el enlace de "Olvidé mi contraseña".
- **Imágenes:** Vercel Blob para los comprobantes de pago y las fotos del servicio.
- **Pruebas:** Playwright para los flujos end-to-end (ya presente en el repositorio).

## Alternativas consideradas

- **Astro con renderizado en servidor** — era viable y su landing se parece a las páginas HTML actuales. No se eligió porque los portales con mucha interacción (perfil, panel de administración, reserva por pasos) exigen agregar componentes interactivos aparte y hay menos ejemplos de autenticación y paneles.
- **SvelteKit** — era viable, con menos código y muy buen rendimiento. No se eligió por tener un ecosistema más pequeño para Neon, Blob y autenticación, y por ser probablemente nuevo para el equipo.
- **SQL directo con el driver de Neon (sin ORM)** — era viable y da control total sobre rangos y restricciones. No se eligió porque no hay tipos automáticos en las consultas, lo que significa más código repetido y más riesgo de errores de escritura.

## Consecuencias

- Es la ruta más documentada para Vercel con Neon, Blob y Resend, y los problemas comunes ya tienen solución publicada.
- TypeScript y Drizzle dan tipos de punta a punta entre el esquema, la API y el frontend.
- Las páginas de la demo hay que reescribirlas como componentes de React.
- Next.js es un framework grande y con muchos conceptos (componentes de servidor y de cliente, cacheo), con una curva de aprendizaje más alta que una solución mínima.
- Los rangos de tiempo y la restricción de exclusión hay que mantenerlos en migraciones SQL a mano, fuera del esquema tipado de Drizzle.
- Vercel Blob permite tiendas privadas en todos los planes. El modo de acceso se elige al crear la tienda y no se puede cambiar, así que los comprobantes y las fotos del servicio deben guardarse en una tienda privada y entregarse a través de rutas `/api` que comprueben la sesión y el rol.
- En el plan Hobby, Blob incluye 1 GB de almacenamiento y un número limitado de operaciones; si se exceden, el servicio se bloquea hasta pasados 30 días.
