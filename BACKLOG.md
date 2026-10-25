# Backlog: Tiza.com

| # | Item | Alcance | Depende de | Contexto extra requerido |
|---|---|---|---|---|
| 1 | Base del proyecto | Next.js + TypeScript + Drizzle conectado a Neon (un solo driver WebSocket de Neon para lecturas y transacciones, ADR 0009), primera migración (`btree_gist`, `configuracion` con los niveles del hogar y parámetros, `equipos` con datos iniciales), formato único de errores, un reintento si Neon está dormido, despliegue en Vercel (ADR 0001, 0004, 0006) | — | — |
| 2 | Registro, inicio de sesión y roles | Biblioteca de autenticación con sesiones en la base; roles de cliente y admin; `/api` privada responde `401` y `/admin` responde `403` (ADR 0005) | #1 | — (se eligió Better Auth, ADR 0005) |
| 3 | Olvidé mi contraseña | Correo con Resend; enlace de un solo uso que vence en 1 h y se guarda como hash; respuesta igual exista o no el correo | #2 | — |
| 4 | Cálculo de precio y duración | Función del servidor: nivel del hogar, horas de trabajo y en agenda, apoyo extra, precio, horas gratis, descuento y crédito aplicado, todo a partir de `configuracion` (ADR 0008) | #1 | Decisión pendiente: confirmar los precios de los paquetes y los multiplicadores de la demo |
| 5 | Landing y FAQ en Next.js | Migrar las páginas públicas de la demo, con los precios leídos desde `configuracion` | #1, #4 | — |
| 6 | Agenda y disponibilidad | Tabla `reservas` con la restricción de exclusión por equipo; consulta de horarios cada 30 min con 48 h de anticipación, horario de atención, traslado y reservas pendientes vencidas ignoradas al leer; función común que las marca como `expirada` al empezar cada escritura, para los ítems 9, 11, 12 y 16 (ADR 0007, 0009) | #1, #4 | — |
| 7 | Dirección del hogar con campos de texto | Distrito (lista de los 9), calle, número, departamento y referencias en el navegador; el servidor valida el distrito, exige calle y número, y normaliza la dirección y el departamento para obtener la clave del hogar (ADR 0013) | #1 | — |
| 8 | Subida y entrega privada de imágenes | Token de Blob, compresión en el navegador, verificación del archivo, entrega por `/api` con permisos, cron diario de archivos huérfanos (ADR 0010) | #2 | — |
| 9a | Reservar y pagar la primera membresía (servidor) | Tablas `membresias` y `pagos`, `membresia_id` y `pago_id` en `reservas`, `GET /api/cotizacion`, `POST /api/reservas` (crea membresía, pago y reserva `pendiente` en una transacción, con 3 h gratis, asignación de equipo con savepoints y una reserva en espera por cliente), datos de pago y `GET /api/comprobantes/:id` (ADR 0008, 0009, 0010) | #2, #4, #6, #7, #8 | Monto de la membresía provisional: S/ 89 al mes, S/ 267 en un solo pago, leído de `configuracion` |
| 9b | Asistente de reserva (`/reservar`) | Página por pasos hasta el pago: servicio, dirección, fecha y hora, precio, Yape o transferencia, comprobante y enlace a WhatsApp; consume lo que expone el #9a | #9a | — |
| 10 | Una limpieza gratis por hogar | Índice único por distrito + dirección normalizada + departamento; una segunda cuenta en el mismo hogar paga el precio completo; peticiones simultáneas (ADR 0008, 0013) | #9a | — |
| 11 | Revisión de pagos (admin) | Lista de pagos pendientes, ver el comprobante, aprobar o rechazar, aprobación tardía, cancelar una reserva fraudulenta, coincidencias de dirección (ADR 0009) | #8, #9a, #10 | — |
| 12 | Perfil: reservas y membresía | Estado de la membresía, próximas reservas, reprogramar o cancelar hasta 24 h antes, historial; `404` para datos de otro cliente; si se cancela la primera limpieza, la siguiente reserva recibe las 3 h gratis (ADR 0008) | #9a, #10 | — |
| 13 | Reservar como miembro activo | Limpieza pagada con 10% de descuento; vigencia en la fecha del servicio; nuevo horario tras una aprobación tardía, sin otro comprobante (ADR 0008, 0009) | #11, #12 | — |
| 14 | Crédito en horas | Lotes con vencimiento a 3 meses, generación al cancelar con pago aprobado, aplicación automática, devoluciones, reserva cubierta sin comprobante, saldo en el perfil y en el admin; extiende las transiciones ya construidas (aprobar, rechazar y expirar del #11, cancelar del #12) para que actualicen los usos de crédito, y las horas adicionales pagadas de una primera limpieza cancelada pasan a crédito (ADR 0008, 0012) | #11, #12, #13 | — |
| 15 | Renovación del mes 4 | Aviso en el perfil, pago de renovación, bloqueo de reservas sin pago | #11, #12 | Decididas (provisionales, REVISAR del PRD): monto S/ 89 al mes; la renovación dura otros 3 meses por S/ 267; ninguna reserva puede empezar después del fin de la membresía |
| 16 | Gestión de reservas y apoyo (admin) | Listado con estado y equipo, marcar como `completada` a mano, reasignar equipo si está libre, lista de apoyo por coordinar con nota (ADR 0007, 0008) | #9a | Decidido: si no se consigue a la persona de apoyo, se reprograma con el cliente y el pago se conserva (REVISAR del PRD, pendiente de confirmar por el negocio) |
| 17 | Fotos del servicio | El admin sube fotos a una reserva completada; el cliente las ve en su historial | #8, #12, #16 | — |
| 18 | Reseñas | Una reseña por limpieza completada, aprobación del admin, publicación en la landing | #5, #16 | — |

## Cómo usar este backlog

Cada ítem es una spec independiente. Al implementarlo, arranca un ciclo de Spec-Driven
Development (`sdd-new` o el flujo equivalente de tu harness) usando este ítem como el
"change", no el proyecto completo. Si la columna "Contexto extra requerido" tiene algo,
compártelo como contexto al generar la spec de ese ítem. Las "decisiones pendientes" son
comentarios `REVISAR` del PRD: resuélvelas y actualiza `PRD.md` antes de generar la spec.

Los criterios de aceptación de cada ítem están en `TECH-DESIGN.md`, en la sección del flujo
correspondiente.

## Pendientes detectados al construir

- **Límite de frecuencia en "Olvidé mi contraseña":** Better Auth no aplica su `rateLimit` porque no se monta su manejador HTTP (ADR 0005), así que `POST /api/sesion/olvide` y el inicio de sesión no limitan intentos. Resolver antes de abrir el sitio al público (ítem aparte: límite por correo e IP).
- **Dominio para Resend:** mientras no haya un dominio verificado, el remitente es `onboarding@resend.dev` y los correos solo llegan al dueño de la cuenta de Resend.
- **Ítems 9 y 10 con la dirección:** la ruta `POST /api/reservas` (#9) debe llamar a `validarDireccion` (`src/lib/direccion.ts`) y guardar el resultado en las columnas de `reservas`; el índice único por hogar de #10 debe usar `claveHogar` (distrito, `direccion_normalizada`, `departamento_normalizado`).
- **Ítems 9, 10, 11, 12, 14 y 16 con la agenda (`src/lib/agenda/`, ya construida en #6):**
  - **#9:** agrega `reservas.membresia_id` y `reservas.pago_id` (`NOT NULL`, con FK) y sus índices únicos parciales (`reservas(pago_id)` y una reserva en espera por cliente). Debe llamar a `validarInicioServicio` y a `insertarEnPrimerEquipoLibre` dentro de `transaccionDeEscritura`, y mostrar el monto de la membresía en el paso de pago.
  - **#10:** agrega los índices únicos de `primera_gratis` (la columna ya existe).
  - **#11, #12 y #16:** escriben siempre con `transaccionDeEscritura` y leen reservas con `reservaActiva`. El #12 usa `excluirReservaId` de `leerOcupacion` al reprogramar.
  - **#14:** extiende `expirarVencidas` para devolver las horas de crédito reservadas.
- **Ítems 9, 11 y 17 con las imágenes (`src/lib/imagenes/`, ya construida en #8):**
  - **#9 y #11:** instancian `crearRutaEntrega` con su resolvedor para `GET /api/comprobantes/:id`, llaman a `verificarImagenSubida` antes de abrir su transacción y guardan solo la ruta que devuelve.
  - **#17:** lo mismo para `GET /api/fotos/:id`, y comprueba que la reserva exista y esté completada antes de registrar la foto.
  - **Todos:** declaran su columna de ruta en `COLUMNAS_CON_IMAGEN` (`src/lib/imagenes/referencias.ts`); si no, el cron diario borraría archivos en uso a las 24 horas. Una prueba falla si el esquema tiene una columna de ruta de imagen sin declarar.
- **Corregir `esErrorDeConexion` (`src/lib/reintento.ts`):** solo mira el error de nivel superior y Drizzle envuelve los errores de conexión en `DrizzleQueryError` (el original queda en `cause`), así que un corte de conexión dentro de una consulta de Drizzle puede no reintentarse. #6 y #8 lo esquivan desenvolviendo `cause`; el resto del código no.
- **Ítems 12 a 18 con lo construido en #11, #12, #15 y #16:**
  - **#12 (cliente):** guarda `cancelada_por = 'cliente'`, muestra «Elige un nuevo día y hora» con `pagosConHorarioPendiente` / `pagosParaElegirHorario`, ofrece «Sube otro comprobante» con `pagosRechazadosReenviables` y llama a `ejecutarPasadaDeExpiracion` al abrir el perfil. No debe devolver al cliente `apoyo_nota`, `reprogramada_por` ni `reprogramada_en`.
  - **#13:** crea la reserva del nuevo horario con el mismo `pago_id`. `comprobarVigenciaParaReservar` (#15) reutiliza `validarVigenciaDeMembresia` de #13; falta que reprogramar (#12) y `POST /api/reservas` usen el mismo guard (hoy un miembro vencido recibe `422` ahí y `409 membresia_vencida` en la disponibilidad).
  - **#14:** extiende aprobar, rechazar, cancelar (`cancelarReservaDelCliente`) y `expirarVencidas`; las membresías `caducada` y los pagos de renovación no generan crédito.
  - **#15:** el enlace «Elegir día y hora» del perfil apunta a `/reservar`; ajustarlo cuando #13 defina su ruta. `aprobarPago` devuelve `nuevo_horario_pendiente: true` para una renovación (no hay reserva); ninguna pantalla lo usa.
  - **#16:** `estadoEfectivoSql` (`src/lib/admin/reservas/estado.ts`) duplica la definición de `src/lib/pagos/listado.ts`; unificarlas. #17 y #18 consultan `estado = 'completada'`. #16 reutiliza `moverAlPrimerEquipoLibre` y `reprogramarEnTransaccion`.
- **Aviso "DEMO" de pagos simulados:** ya está en el PRD (alcance, punto 3). Se implementa en el paso de pago y la reserva enviada (#9b) y en el pie de las páginas públicas (#5).
- **Despliegue de la landing (#5):** espera a que el #9b cree `/reservar`.
