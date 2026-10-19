# ADR 0003: API REST con JSON

## Estado

Aceptado

## Contexto

La aplicación (ADR 0001) tiene tres grupos de operaciones entre el navegador y el servidor: las del cliente (registrarse, iniciar sesión, reservar, reprogramar, cancelar, subir el comprobante de pago, escribir una reseña), las del administrador (aprobar o rechazar pagos, ver y gestionar reservas, subir fotos del servicio) y la recuperación de contraseña. El PRD exige que cada cliente vea solo sus propios datos y que el portal de administrador requiera rol de admin. El equipo es una persona y las pruebas end-to-end se hacen con Playwright.

## Decisión

El contrato entre el frontend y el servidor es una **API REST con JSON**, bajo el prefijo `/api`, dentro de la misma aplicación.

- Un recurso por tipo de dato: usuarios y sesión, membresías, pagos, reservas, reseñas y fotos del servicio.
- Cada ruta valida los datos de entrada y comprueba la sesión y el rol antes de actuar. Un cliente solo accede a sus propios recursos; las rutas de administración exigen rol `admin`.
- Códigos de estado estándar: `401` sin sesión, `403` sin permiso, `404` si el recurso no existe o no pertenece al usuario, `409` cuando una reserva choca con otra, `422` para datos inválidos.
- Las respuestas de error usan un formato JSON único con un mensaje legible para mostrar al usuario.
- Las imágenes (comprobantes y fotos del servicio) se suben con rutas dedicadas que validan tipo y tamaño de archivo.

## Alternativas consideradas

- **RPC tipado (tRPC o similar)** — era viable y comparte los tipos de punta a punta sin repetir código. No se eligió porque exige TypeScript en todo el sistema, y es menos transparente para depurar y para probar desde fuera.
- **Funciones de servidor llamadas directamente (por ejemplo Server Actions)** — era viable y reduce el código intermedio en los formularios. No se eligió porque depende del framework que se elija, el contrato queda implícito y es más difícil de probar de forma aislada.

## Consecuencias

- El contrato es explícito, documentable y se puede probar con Playwright o con herramientas externas sin depender del framework.
- Los permisos se verifican en cada ruta, en un lugar visible y revisable.
- Hay que escribir y mantener a mano la validación de entradas y los tipos que comparten el frontend y la API, con más código repetido que en RPC.
- Cambios en una ruta pueden romper al frontend sin aviso si no hay pruebas que lo cubran.
