## Purpose

Muestra el saldo de crédito en horas al cliente (API, perfil y detalle) y al administrador (solo lectura), con el vencimiento de cada lote y el detalle de dónde salió y en qué se usó (PRD, "Alcance" puntos 7 y 9; ADR 0012).

## ADDED Requirements

### Requirement: Crédito del cliente por API

`GET /api/creditos` MUST exigir sesión (`401`) y devolver solo los datos del cliente de la sesión, con `Cache-Control: private, no-store`: `saldo_horas`, `proximo_vencimiento` (horas y `vence_en` del lote vigente que vence primero, o `null`), `lotes` (id, horas iniciales, horas disponibles, `vence_en` con zona de Lima, `vigente`, fecha de la cancelación de origen y la reserva de origen) y `movimientos` (los últimos 50: `generado`, `usado`, `devuelto`, con horas, fecha y la reserva de origen o de destino con su fecha de servicio). Los lotes vencidos MUST aparecer con `vigente: false` y sin sumar al saldo. La lectura MUST pasar por `conReintento` y responder `503` "Inténtalo en unos segundos." si Neon sigue dormido.

#### Scenario: Cliente con crédito

- **WHEN** el cliente tiene un lote de 2 horas que vence el 15 de enero y otro de 1 hora que vence el 20 de febrero
- **THEN** `saldo_horas` es 3 y `proximo_vencimiento` es el del 15 de enero con 2 horas

#### Scenario: Movimientos

- **WHEN** el cliente canceló una limpieza (2 horas) y usó 1,5 horas en otra reserva
- **THEN** los movimientos muestran un `generado` de 2 horas con su reserva de origen y un `usado` de 1,5 con la fecha del servicio donde se usó

#### Scenario: Sin crédito

- **WHEN** el cliente nunca canceló
- **THEN** el saldo es 0, `proximo_vencimiento` es `null` y las listas están vacías

#### Scenario: Datos de otro cliente

- **WHEN** el cliente A consulta
- **THEN** no aparece ningún lote ni movimiento del cliente B

#### Scenario: Sin sesión

- **WHEN** se llama sin sesión
- **THEN** responde `401`

### Requirement: Saldo en el perfil

El perfil (`GET /api/perfil` y `/cuenta`) MUST incluir `credito` con el saldo y el próximo vencimiento y mostrar una tarjeta "Tu crédito" con un enlace a `/cuenta/credito`, página de servidor que muestre los lotes con su vencimiento y el detalle de cada movimiento, con fechas en español de Perú y hora de Lima, letra base de 18 px o más y botones de 48 px o más. Con la membresía vencida el perfil MUST mostrar el saldo y decir que hace falta una membresía vigente para usarlo, sin ofrecer reservar. Un saldo de 0 MUST mostrar "No tienes crédito por ahora."

#### Scenario: Perfil con crédito

- **WHEN** el cliente tiene 3,5 horas de crédito
- **THEN** el perfil muestra "3,5 horas" y la fecha del próximo vencimiento

#### Scenario: Membresía vencida

- **WHEN** el cliente tiene crédito vigente y su membresía venció
- **THEN** el perfil muestra el saldo con el aviso de que debe renovar para usarlo y no ofrece reservar

#### Scenario: Página de detalle ajena a otros

- **WHEN** un cliente abre `/cuenta/credito` sin sesión
- **THEN** es redirigido a `/ingresar`

### Requirement: Crédito de cada cliente para el administrador

`GET /api/admin/creditos` MUST exigir rol de administrador (`401` sin sesión, `403` para un cliente) y devolver, hasta 100 clientes con algún lote, su nombre, correo, saldo vigente y próximo vencimiento, ordenados por el vencimiento más próximo. `GET /api/admin/creditos/:usuarioId` MUST devolver el mismo detalle que ve el cliente (`404` si el cliente no existe). Las páginas `/admin/creditos` y `/admin/creditos/[usuarioId]` MUST mostrarlo y MUST ser de solo lectura: no hay ninguna ruta para crear, editar ni borrar créditos (ADR 0012, v1).

#### Scenario: Lista del administrador

- **WHEN** el administrador abre `/admin/creditos`
- **THEN** ve a cada cliente con crédito, su saldo y el vencimiento más próximo

#### Scenario: Cliente sin permisos

- **WHEN** un cliente llama a `GET /api/admin/creditos`
- **THEN** responde `403` y no lee datos

#### Scenario: Sin edición

- **WHEN** se llama a `POST`, `PATCH` o `DELETE` sobre `/api/admin/creditos`
- **THEN** responde `405` y no cambia nada

#### Scenario: Cliente inexistente

- **WHEN** el administrador pide el detalle de un `usuarioId` que no existe
- **THEN** responde `404`
