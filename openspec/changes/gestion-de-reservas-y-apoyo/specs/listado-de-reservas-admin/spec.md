## ADDED Requirements

### Requirement: Solo el administrador gestiona reservas
Toda ruta bajo `/api/admin/reservas` y `/api/admin/apoyo`, y las páginas `/admin/reservas` y `/admin/apoyo`, MUST exigir rol `admin` leído de la base en cada petición (ADR 0005). Sin sesión la API MUST responder `401`; con un cliente, `403` sin leer ni escribir datos. Las páginas MUST redirigir a quien no es administrador, como el resto de `/admin`.

#### Scenario: Visitante sin sesión
- **WHEN** alguien sin sesión llama a `GET /api/admin/reservas`
- **THEN** la respuesta es `401` con el formato único de errores

#### Scenario: Cliente
- **WHEN** un cliente llama a cualquier ruta de gestión de reservas o de apoyo
- **THEN** la respuesta es `403` y no se lee ni se modifica ninguna reserva

#### Scenario: Página del portal
- **WHEN** un cliente abre `/admin/reservas` o `/admin/apoyo`
- **THEN** es redirigido a `/cuenta` y un visitante a `/ingresar`

### Requirement: Listado de reservas con estado y equipo
`GET /api/admin/reservas` MUST devolver las reservas con su id, cliente (nombre, correo, celular), servicio (tipo, dormitorios, baños u horas), dirección, `inicio`, `fin`, rango bloqueado, horas de trabajo y de agenda, **equipo** (id y nombre), **estado efectivo**, `requiere_apoyo`, `apoyo_estado`, `apoyo_nota`, el `pago_id`, y los indicadores `puede_completar`, `puede_reasignar` y `puede_reprogramar` (viva y con servicio futuro) calculados por el servidor, además de `reprogramada_en` y quién reprogramó, si ocurrió. Sin filtro MUST listar las reservas vivas (`confirmada` y `pendiente` vigente) desde hoy, ordenadas por `inicio` ascendente. MUST aceptar el filtro `estado` (`pendiente`, `confirmada`, `completada`, `cancelada`, `expirada` o `por_completar`) y rechazar otro valor con `422`. MUST devolver como máximo 100 filas y la lista de equipos activos para la reasignación, y responder con `Cache-Control: private, no-store`.

#### Scenario: El administrador ve estado y equipo
- **WHEN** el administrador abre el listado y existe una reserva `confirmada` asignada al equipo 2
- **THEN** la fila muestra el estado `confirmada` y el nombre del equipo 2

#### Scenario: Una espera vencida nunca se ve como pendiente
- **WHEN** una reserva `pendiente` tiene `expira_en` en el pasado y nadie la ha marcado todavía
- **THEN** el listado la muestra como `expirada` y no aparece en el listado sin filtro ni en el filtro `pendiente`

#### Scenario: Vista por completar
- **WHEN** el administrador filtra por `por_completar`
- **THEN** ve solo las reservas `confirmada` cuyo `inicio` ya pasó, de la más antigua a la más reciente

#### Scenario: Estado desconocido
- **WHEN** se envía `estado=otro`
- **THEN** la respuesta es `422` con un mensaje que lista los estados válidos

#### Scenario: La pasada de expiración corre antes de leer
- **WHEN** el administrador abre el listado
- **THEN** se ejecuta la pasada de expiración del ítem #11 antes de la lectura, y el listado se calcula con el estado efectivo aunque la pasada falle por un corte de conexión reintentado
