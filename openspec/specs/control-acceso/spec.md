# control-acceso Specification

## Purpose
Garantiza en el servidor que solo quien tiene sesión accede a las funciones de cliente y que solo un administrador accede al portal de administración de Tiza.com, y define cómo se otorga el rol de administrador.

## Requirements

### Requirement: Rutas privadas exigen sesión

Toda ruta privada de la API MUST responder `401` con el formato único de error cuando la petición no trae una sesión válida (sin cookie, cookie vencida o sesión cerrada).

#### Scenario: Sin cookie

- **WHEN** se llama a una ruta privada de la API sin cookie de sesión
- **THEN** la respuesta es `401` con el mensaje "Inicia sesión para continuar."

#### Scenario: Cookie inventada

- **WHEN** se llama a una ruta privada con una cookie de sesión que no corresponde a ninguna sesión
- **THEN** la respuesta es `401`

### Requirement: Rutas de administración exigen rol admin

Toda ruta de administración de la API MUST responder `401` sin sesión y `403` con el formato único de error cuando el usuario tiene sesión pero su rol no es `admin`. El rol MUST leerse de la base en cada petición, no de un dato que envíe el navegador.

#### Scenario: Cliente en ruta de administración

- **WHEN** un usuario con rol `cliente` llama a una ruta de administración
- **THEN** la respuesta es `403` con el mensaje "No tienes permiso para hacer esto."

#### Scenario: Rol retirado

- **WHEN** a un administrador se le cambia el rol a `cliente` en la base mientras tiene la sesión abierta
- **THEN** su siguiente petición a una ruta de administración responde `403`

### Requirement: Páginas de cuenta exigen sesión

Las páginas de cuenta (`/cuenta`) MUST redirigir a `/ingresar` cuando no hay sesión, y después del inicio de sesión MUST volver a la página que se intentó abrir.

#### Scenario: Cuenta sin sesión

- **WHEN** alguien sin sesión abre `/cuenta`
- **THEN** es redirigido a `/ingresar`
- **AND** al iniciar sesión vuelve a `/cuenta`

#### Scenario: Después de cerrar sesión

- **WHEN** un usuario cierra sesión y abre `/cuenta`
- **THEN** es redirigido a `/ingresar`

### Requirement: Portal de administración exige rol admin

`/admin` y sus subpáginas MUST redirigir a `/ingresar` sin sesión y a `/cuenta` cuando el usuario no es administrador. Un administrador MUST poder abrirlas.

#### Scenario: Cliente en el portal

- **WHEN** un usuario con rol `cliente` abre `/admin`
- **THEN** es redirigido a `/cuenta` sin ver contenido del portal

#### Scenario: Administrador en el portal

- **WHEN** un usuario con rol `admin` abre `/admin`
- **THEN** ve la portada del portal de administración

### Requirement: Otorgar el rol de administrador fuera de la web

El rol `admin` MUST otorgarse solo con un comando que se ejecuta con acceso a la base de datos, sobre una cuenta ya registrada. Ninguna ruta de la API ni página MUST permitir cambiar un rol.

#### Scenario: Promover una cuenta existente

- **WHEN** se ejecuta el comando de promoción con el correo de una cuenta registrada
- **THEN** esa cuenta pasa a tener rol `admin` y el comando lo confirma

#### Scenario: Correo sin cuenta

- **WHEN** se ejecuta el comando de promoción con un correo que no tiene cuenta
- **THEN** el comando termina con error, indica que no existe esa cuenta y no crea ninguna
