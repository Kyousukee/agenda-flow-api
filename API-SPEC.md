# API Specification - AgendaFlow

## Overview

| Campo         | Valor                        |
|---------------|------------------------------|
| **Base URL**  | `http://localhost:3000/api`  |
| **Auth**      | JWT (Bearer Token)           |
| **Roles**     | `1` administrador (dueño), `2` recepcionista (SPEC 08) |
| **Formato**   | JSON                         |
| **Soft Delete** | `activo = false`           |

---

## Database Models

### Empresa

| Campo              | Tipo      | Constraints                        |
|--------------------|-----------|------------------------------------|
| `id`               | UUID      | PK, auto-generated                 |
| `nombre`           | VARCHAR   | NOT NULL                           |
| `direccion`        | VARCHAR   | NULL                               |
| `telefono`         | VARCHAR   | NULL                               |
| `email`            | VARCHAR   | NULL                               |
| `logo_url`         | VARCHAR   | NULL                               |
| `created_at`       | TIMESTAMP | DEFAULT NOW()                      |
| `updated_at`       | TIMESTAMP | DEFAULT NOW()                      |

### Sucursal

| Campo              | Tipo      | Constraints                        |
|--------------------|-----------|------------------------------------|
| `id`               | UUID      | PK, auto-generated                 |
| `empresa_id`       | UUID      | FK → Empresa, NOT NULL             |
| `nombre`           | VARCHAR   | NOT NULL                           |
| `direccion`        | VARCHAR   | NULL                               |
| `telefono`         | VARCHAR   | NULL                               |
| `email`            | VARCHAR   | NULL                               |
| `created_at`       | TIMESTAMP | DEFAULT NOW()                      |
| `updated_at`       | TIMESTAMP | DEFAULT NOW()                      |

### Empleado

| Campo              | Tipo      | Constraints                        |
|--------------------|-----------|------------------------------------|
| `id`               | UUID      | PK, auto-generated                 |
| `sucursal_id`      | UUID      | FK → Sucursal, NOT NULL            |
| `nombre`           | VARCHAR   | NOT NULL                           |
| `apellido`         | VARCHAR   | NOT NULL                           |
| `email`            | VARCHAR   | UNIQUE, NOT NULL                   |
| `password`         | VARCHAR   | NOT NULL (hashed)                  |
| `telefono`         | VARCHAR   | NULL                               |
| `rol`              | ENUM      | `'admin'`, `'empleado'`            |
| `activo`           | BOOLEAN   | DEFAULT true                       |
| `created_at`       | TIMESTAMP | DEFAULT NOW()                      |
| `updated_at`       | TIMESTAMP | DEFAULT NOW()                      |

### Servicio

| Campo              | Tipo      | Constraints                        |
|--------------------|-----------|------------------------------------|
| `id`               | UUID      | PK, auto-generated                 |
| `empresa_id`       | UUID      | FK → Empresa, NOT NULL             |
| `nombre`           | VARCHAR   | NOT NULL                           |
| `descripcion`      | TEXT      | NULL                               |
| `duracion_min`     | INT       | NOT NULL (en minutos)              |
| `precio`           | DECIMAL   | NOT NULL                           |
| `activo`           | BOOLEAN   | DEFAULT true                       |
| `created_at`       | TIMESTAMP | DEFAULT NOW()                      |
| `updated_at`       | TIMESTAMP | DEFAULT NOW()                      |

### ServicioEmpleado (Pivot)

| Campo              | Tipo      | Constraints                        |
|--------------------|-----------|------------------------------------|
| `id`               | UUID      | PK, auto-generated                 |
| `servicio_id`      | UUID      | FK → Servicio, NOT NULL            |
| `empleado_id`      | UUID      | FK → Empleado, NOT NULL            |

### Horario

| Campo              | Tipo      | Constraints                        |
|--------------------|-----------|------------------------------------|
| `id`               | UUID      | PK, auto-generated                 |
| `sucursal_id`      | UUID      | FK → Sucursal, NOT NULL            |
| `dia_semana`       | INT       | 0=Dom, 1=Lun, ..., 6=Sab          |
| `hora_inicio`      | TIME      | NOT NULL (HH:MM)                   |
| `hora_fin`         | TIME      | NOT NULL (HH:MM)                   |
| `created_at`       | TIMESTAMP | DEFAULT NOW()                      |
| `updated_at`       | TIMESTAMP | DEFAULT NOW()                      |

### Bloqueo

| Campo              | Tipo      | Constraints                        |
|--------------------|-----------|------------------------------------|
| `id`               | UUID      | PK, auto-generated                 |
| `sucursal_id`      | UUID      | FK → Sucursal, NOT NULL            |
| `empleado_id`      | UUID      | FK → Empleado, NULL (global si null)|
| `fecha`            | DATE      | NOT NULL                           |
| `hora_inicio`      | TIME      | NOT NULL                           |
| `hora_fin`         | TIME      | NOT NULL                           |
| `motivo`           | VARCHAR   | NULL                               |
| `created_at`       | TIMESTAMP | DEFAULT NOW()                      |

### Estado

| Campo              | Tipo      | Constraints                        |
|--------------------|-----------|------------------------------------|
| `id`               | UUID      | PK, auto-generated                 |
| `nombre`           | VARCHAR   | UNIQUE, NOT NULL                   |

**Valores pre-seedeados:**
- Programada
- Completada
- Pagado
- Pendiente
- Cancelada
- Rechazado
- Anulado

### Reserva

| Campo              | Tipo      | Constraints                        |
|--------------------|-----------|------------------------------------|
| `id`               | UUID      | PK, auto-generated                 |
| `sucursal_id`      | UUID      | FK → Sucursal, NOT NULL            |
| `empleado_id`      | UUID      | FK → Empleado, NOT NULL            |
| `servicio_id`      | UUID      | FK → Servicio, NOT NULL            |
| `estado_id`        | UUID      | FK → Estado, NOT NULL              |
| `cliente_nombre`   | VARCHAR   | NOT NULL                           |
| `cliente_email`    | VARCHAR   | NULL                               |
| `cliente_telefono` | VARCHAR   | NULL                               |
| `fecha`            | DATE      | NOT NULL (YYYY-MM-DD)              |
| `hora`             | TIME      | NOT NULL (HH:MM)                   |
| `notas`            | TEXT      | NULL                               |
| `created_at`       | TIMESTAMP | DEFAULT NOW()                      |
| `updated_at`       | TIMESTAMP | DEFAULT NOW()                      |

### Pago

| Campo              | Tipo      | Constraints                        |
|--------------------|-----------|------------------------------------|
| `id`               | UUID      | PK, auto-generated                 |
| `reserva_id`       | UUID      | FK → Reserva, NOT NULL             |
| `monto`            | DECIMAL   | NOT NULL                           |
| `metodo_pago`      | VARCHAR   | NULL                               |
| `fecha_pago`       | TIMESTAMP | DEFAULT NOW()                      |
| `created_at`       | TIMESTAMP | DEFAULT NOW()                      |

### ConfiguracionEmpresa

| Campo              | Tipo      | Constraints                        |
|--------------------|-----------|------------------------------------|
| `id`               | UUID      | PK, auto-generated                 |
| `empresa_id`       | UUID      | FK → Empresa, UNIQUE, NOT NULL     |
| `antelacion_min_reserva` | INT  | DEFAULT 30 (minutos mínimos)       |
| `max_dias_futuro`  | INT       | DEFAULT 30                         |
| `timezone`         | VARCHAR   | DEFAULT 'America/Lima'             |
| `created_at`       | TIMESTAMP | DEFAULT NOW()                      |
| `updated_at`       | TIMESTAMP | DEFAULT NOW()                      |

---

## API Endpoints

### Auth

| Método | Endpoint              | Auth | Rol    | Descripción          |
|--------|-----------------------|------|--------|----------------------|
| POST   | `/auth/login`         | No   | -      | Login, retorna JWT   |
| POST   | `/auth/register`      | No   | -      | Registrar empleado   |
| POST   | `/auth/verificar-email` | No | - | Verifica el email con el token del correo |
| POST   | `/auth/reenviar-verificacion` | Sí | - | Reenvía el correo de verificación |
| POST   | `/auth/olvide-contrasena` | No | - | Pide el correo para restablecer la contraseña |
| POST   | `/auth/restablecer-contrasena` | No | - | Cambia la contraseña con el token del correo |

**POST `/auth/login`**

Request:
```json
{
  "email": "admin@empresa.com",
  "password": "secret123"
}
```

Response `200`:
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIs...",
  "empleado": {
    "id": "uuid-...",
    "nombre": "Juan",
    "email": "admin@empresa.com",
    "rol": "admin",
    "sucursal_id": "uuid-..."
  }
}
```

**POST `/auth/register`**

Request:
```json
{
  "nombre": "Juan",
  "apellido": "Perez",
  "email": "juan@empresa.com",
  "password": "secret123",
  "telefono": "999999999",
  "sucursal_id": "uuid-...",
  "rol": "empleado"
}
```

Response `201`:
```json
{
  "id": "uuid-...",
  "nombre": "Juan",
  "apellido": "Perez",
  "email": "juan@empresa.com",
  "rol": "empleado",
  "sucursal_id": "uuid-..."
}
```

**Verificación de email y recuperación de contraseña** (ver `specs/04-verificacion-email-y-recuperacion-contrasena.md`)

`POST /auth/login` y `POST /auth/register` devuelven `user.emailVerificado` (boolean). Una cuenta sin verificar conserva todo el acceso.

Estas 4 rutas tienen un límite de 5 peticiones por minuto por IP. Si se supera, responden `429`.

**POST `/auth/verificar-email`**

Request:
```json
{ "token": "..." }
```

Response `200`:
```json
{ "emailVerificado": true }
```

Response `400` si el token no existe, venció (24 horas) o ya se usó: `El enlace no es válido o venció`.

**POST `/auth/reenviar-verificacion`** (requiere JWT, sin cuerpo)

Response `200`:
```json
{ "emailVerificado": false }
```

- Devuelve `true` y no envía nada si el email ya está verificado.
- Devuelve `false` también si se superó el límite por usuario (1 por minuto, 5 por hora), sin enviar nada.
- Un token nuevo invalida el enlace anterior.

**POST `/auth/olvide-contrasena`**

Request:
```json
{ "email": "juan@empresa.com" }
```

Response `200`, siempre la misma, exista o no la cuenta:
```json
{ "message": "Si el email está registrado, te enviaremos un enlace para restablecer tu contraseña." }
```

No se envía correo si el email no existe, si la cuenta está desactivada o si se superó el límite por usuario (1 por minuto, 5 por hora).

**POST `/auth/restablecer-contrasena`**

Request (`password` de 8 a 72 caracteres):
```json
{ "token": "...", "password": "secret123" }
```

Response `200`:
```json
{ "message": "Tu contraseña fue restablecida. Inicia sesión." }
```

- Deja el email verificado y cierra todas las sesiones: los JWT anteriores responden `401`.
- No inicia sesión: hay que llamar a `POST /auth/login`.
- Response `400` si el token no existe, venció (1 hora), ya se usó o la cuenta está desactivada: `El enlace no es válido o venció`.
- También sirve para que una cuenta creada con Google cree su primera contraseña.

**Login con Google** (ver `specs/05-login-google.md`)

| Método | Endpoint | Auth | Rol | Descripción |
|--------|----------|------|-----|-------------|
| POST | `/auth/google` | No | - | Inicia sesión con el ID token de Google |
| POST | `/auth/google/registro` | No | - | Crea la cuenta con Google y los datos del negocio |

`credential` es el ID token que entrega Google Identity Services al front. Ambas rutas tienen el límite de 5 peticiones por minuto por IP. Si la API no tiene `GOOGLE_CLIENT_ID`, responden `503`.

**POST `/auth/google`**

Request:
```json
{ "credential": "eyJhbGciOiJSUzI1NiIs..." }
```

Response `200` si la cuenta existe: el mismo cuerpo que `POST /auth/login` (`accessToken` y `user`).

- Si el email ya tenía cuenta con contraseña, la vincula a Google y la marca verificada.
- Si esa cuenta no estaba verificada, se borra su contraseña y se cierran sus sesiones (se puede crear otra con "olvidé mi contraseña").

Response `200` si no hay cuenta (no inicia sesión):
```json
{
  "requiereRegistro": true,
  "perfil": { "email": "ana@gmail.com", "nombre": "Ana", "apellido": "Pérez" }
}
```

Errores: `401` si el token no es válido, venció, es de otra app o el email no está verificado por Google; `401 Cuenta desactivada`; `409` si el email ya está vinculado a otra cuenta de Google.

**POST `/auth/google/registro`**

Request: `credential` más los datos del negocio y la sucursal de `POST /auth/register` (`empresaNombre` obligatorio). No lleva `email` ni `password`: el email sale del token. `nombre` y `apellido` son opcionales; por defecto se usan los de Google.
```json
{
  "credential": "eyJhbGciOiJSUzI1NiIs...",
  "empresaNombre": "Barbería Central",
  "sucursalNombre": "Casa matriz",
  "telefono": "+56912345678"
}
```

Response `201`: el mismo cuerpo que `POST /auth/register`, con `user.emailVerificado = true`. No envía correo de verificación.

Errores: `401` como en `/auth/google`; `409` si ya existe una cuenta con ese email o esa cuenta de Google.

**Invitación de recepcionistas** (ver `specs/08-reservas-presenciales-y-recepcionistas.md`)

| Método | Endpoint | Auth | Rol | Descripción |
|--------|----------|------|-----|-------------|
| GET | `/auth/invitacion/:token` | No | - | Datos de la invitación para la página pública |
| POST | `/auth/aceptar-invitacion` | No | - | El recepcionista crea su contraseña y entra |

Ambas rutas tienen un límite de 10 peticiones por minuto por IP (`429`). El token llega en el correo de invitación (`{FRONT_URL}/invitacion?token=...`), vence en 7 días y solo se guarda su hash. Reenviar la invitación invalida el enlace anterior.

**GET `/auth/invitacion/:token`**

Response `200`:
```json
{
  "nombre": "Rocío",
  "email": "rocio@correo.cl",
  "empresa": "Barbería Central",
  "sucursal": "Casa Matriz"
}
```

Response `400` si el token no existe, venció, ya se usó o el recepcionista está desactivado: `El enlace no es válido o expiró`.

**POST `/auth/aceptar-invitacion`**

Request (`password` de 8 a 72 caracteres):
```json
{ "token": "...", "password": "secret123" }
```

Response `200`: el mismo cuerpo que `POST /auth/login`. El recepcionista queda con sesión iniciada y el email verificado. Response `400` con el mismo mensaje si el token no sirve.

**Sesión del recepcionista (rol 2)**

- El JWT lleva `rolId: 2` y el `sucursalId` asignado por el dueño (`Usuario.SucursalId`). Ese `sucursalId` fija su alcance en todos los endpoints.
- `user` agrega `sucursal: { id, nombre }`. El rol 1 no recibe ese campo.
- Antes de aceptar la invitación, `POST /auth/login` responde `401 Credenciales inválidas`.
- `POST /auth/google` con el email de una invitación pendiente responde `401 Acepta la invitación que llegó a tu correo antes de entrar con Google` y no vincula la cuenta. Después de aceptarla, entra con Google como cualquier cuenta.
- Desactivar al recepcionista o cambiarlo de sucursal cierra su sesión: la siguiente petición responde `401` y debe volver a iniciar sesión.

---

### Empresas

| Método | Endpoint              | Auth | Rol    | Descripción          |
|--------|-----------------------|------|--------|----------------------|
| GET    | `/empresas`           | Si   | admin  | Listar todas         |
| GET    | `/empresas/:id`       | Si   | admin  | Obtener una          |
| POST   | `/empresas`           | Si   | admin  | Crear                |
| PATCH  | `/empresas/:id`       | Si   | admin  | Actualizar           |
| DELETE | `/empresas/:id`       | Si   | admin  | Eliminar             |

**GET `/empresas`**

Response `200`:
```json
[
  {
    "id": "uuid-...",
    "nombre": "Salon Bella",
    "direccion": "Av. Principal 123",
    "telefono": "012345678",
    "email": "info@salonbella.com",
    "created_at": "2025-01-15T10:00:00.000Z"
  }
]
```

**POST `/empresas`**

Request:
```json
{
  "nombre": "Salon Bella",
  "direccion": "Av. Principal 123",
  "telefono": "012345678",
  "email": "info@salonbella.com"
}
```

Response `201`:
```json
{
  "id": "uuid-...",
  "nombre": "Salon Bella",
  "direccion": "Av. Principal 123",
  "telefono": "012345678",
  "email": "info@salonbella.com",
  "created_at": "2025-01-15T10:00:00.000Z"
}
```

**PATCH `/empresas/:id`**

Request:
```json
{
  "nombre": "Salon Bella 2.0"
}
```

Response `200`:
```json
{
  "id": "uuid-...",
  "nombre": "Salon Bella 2.0",
  "direccion": "Av. Principal 123",
  "telefono": "012345678",
  "email": "info@salonbella.com",
  "created_at": "2025-01-15T10:00:00.000Z"
}
```

**DELETE `/empresas/:id`**

Response `200`:
```json
{
  "message": "Empresa eliminada"
}
```

---

### Sucursales

| Método | Endpoint                          | Auth | Rol    | Descripción          |
|--------|-----------------------------------|------|--------|----------------------|
| GET    | `/empresas/:empresaId/sucursales` | Si   | admin  | Listar sucursales    |
| GET    | `/sucursales/:id`                 | Si   | admin  | Obtener una          |
| POST   | `/empresas/:empresaId/sucursales` | Si   | admin  | Crear                |
| PATCH  | `/sucursales/:id`                 | Si   | admin  | Actualizar           |
| DELETE | `/sucursales/:id`                 | Si   | admin  | Eliminar             |

**GET `/empresas/:empresaId/sucursales`**

Response `200`:
```json
[
  {
    "id": "uuid-...",
    "empresa_id": "uuid-...",
    "nombre": "Sucursal Centro",
    "direccion": "Jr. Lima 456",
    "telefono": "012345679",
    "email": "centro@salonbella.com"
  }
]
```

**POST `/empresas/:empresaId/sucursales`**

Request:
```json
{
  "nombre": "Sucursal Centro",
  "direccion": "Jr. Lima 456",
  "telefono": "012345679",
  "email": "centro@salonbella.com"
}
```

Response `201`:
```json
{
  "id": "uuid-...",
  "empresa_id": "uuid-...",
  "nombre": "Sucursal Centro",
  "direccion": "Jr. Lima 456",
  "telefono": "012345679",
  "email": "centro@salonbella.com"
}
```

---

### Empleados

| Método | Endpoint                              | Auth | Rol    | Descripción          |
|--------|---------------------------------------|------|--------|----------------------|
| GET    | `/sucursales/:sucursalId/empleados`   | Si   | admin  | Listar empleados     |
| GET    | `/empleados/:id`                      | Si   | admin  | Obtener uno          |
| POST   | `/sucursales/:sucursalId/empleados`   | Si   | admin  | Crear                |
| PATCH  | `/empleados/:id`                      | Si   | admin  | Actualizar           |
| DELETE | `/empleados/:id`                      | Si   | admin  | Soft delete          |

**GET `/sucursales/:sucursalId/empleados`**

Response `200`:
```json
[
  {
    "id": "uuid-...",
    "sucursal_id": "uuid-...",
    "nombre": "Maria",
    "apellido": "Garcia",
    "email": "maria@salonbella.com",
    "telefono": "988888888",
    "rol": "empleado",
    "activo": true
  }
]
```

**POST `/sucursales/:sucursalId/empleados`**

Request:
```json
{
  "nombre": "Maria",
  "apellido": "Garcia",
  "email": "maria@salonbella.com",
  "password": "secret123",
  "telefono": "988888888",
  "rol": "empleado"
}
```

Response `201`:
```json
{
  "id": "uuid-...",
  "sucursal_id": "uuid-...",
  "nombre": "Maria",
  "apellido": "Garcia",
  "email": "maria@salonbella.com",
  "telefono": "988888888",
  "rol": "empleado",
  "activo": true
}
```

**DELETE `/empleados/:id`** (Soft Delete)

Response `200`:
```json
{
  "message": "Empleado desactivado"
}
```

---

### Servicios

| Método | Endpoint                          | Auth | Rol    | Descripción          |
|--------|-----------------------------------|------|--------|----------------------|
| GET    | `/empresas/:empresaId/servicios`  | Si   | admin  | Listar servicios     |
| GET    | `/servicios/:id`                  | Si   | admin  | Obtener uno          |
| POST   | `/empresas/:empresaId/servicios`  | Si   | admin  | Crear                |
| PATCH  | `/servicios/:id`                  | Si   | admin  | Actualizar           |
| DELETE | `/servicios/:id`                  | Si   | admin  | Soft delete          |

**GET `/empresas/:empresaId/servicios`**

Response `200`:
```json
[
  {
    "id": "uuid-...",
    "empresa_id": "uuid-...",
    "nombre": "Corte de Cabello",
    "descripcion": "Corte básico",
    "duracion_min": 30,
    "precio": 25.00,
    "activo": true
  }
]
```

**POST `/empresas/:empresaId/servicios`**

Request:
```json
{
  "nombre": "Corte de Cabello",
  "descripcion": "Corte básico",
  "duracion_min": 30,
  "precio": 25.00
}
```

Response `201`:
```json
{
  "id": "uuid-...",
  "empresa_id": "uuid-...",
  "nombre": "Corte de Cabello",
  "descripcion": "Corte básico",
  "duracion_min": 30,
  "precio": 25.00,
  "activo": true
}
```

**DELETE `/servicios/:id`** (Soft Delete)

Response `200`:
```json
{
  "message": "Servicio desactivado"
}
```

---

### Servicios-Empleados (Pivot)

| Método | Endpoint                                  | Auth | Rol    | Descripción              |
|--------|-------------------------------------------|------|--------|--------------------------|
| GET    | `/empleados/:empleadoId/servicios`        | Si   | admin  | Servicios del empleado   |
| POST   | `/empleados/:empleadoId/servicios`        | Si   | admin  | Asignar servicio         |
| DELETE | `/empleados/:empleadoId/servicios/:id`    | Si   | admin  | Desasignar servicio      |

**GET `/empleados/:empleadoId/servicios`**

Response `200`:
```json
[
  {
    "id": "uuid-...",
    "servicio_id": "uuid-...",
    "empleado_id": "uuid-...",
    "servicio": {
      "id": "uuid-...",
      "nombre": "Corte de Cabello",
      "duracion_min": 30,
      "precio": 25.00
    }
  }
]
```

**POST `/empleados/:empleadoId/servicios`**

Request:
```json
{
  "servicio_id": "uuid-..."
}
```

Response `201`:
```json
{
  "id": "uuid-...",
  "servicio_id": "uuid-...",
  "empleado_id": "uuid-..."
}
```

---

### Horarios

| Método | Endpoint                                  | Auth | Rol    | Descripción              |
|--------|-------------------------------------------|------|--------|--------------------------|
| GET    | `/sucursales/:sucursalId/horarios`        | Si   | admin  | Horarios de sucursal     |
| POST   | `/sucursales/:sucursalId/horarios`        | Si   | admin  | Crear horario            |
| DELETE | `/horarios/:id`                           | Si   | admin  | Eliminar horario         |

**GET `/sucursales/:sucursalId/horarios`**

Response `200`:
```json
[
  {
    "id": "uuid-...",
    "sucursal_id": "uuid-...",
    "dia_semana": 1,
    "hora_inicio": "09:00",
    "hora_fin": "18:00"
  }
]
```

**POST `/sucursales/:sucursalId/horarios`**

Request:
```json
{
  "dia_semana": 1,
  "hora_inicio": "09:00",
  "hora_fin": "18:00"
}
```

Response `201`:
```json
{
  "id": "uuid-...",
  "sucursal_id": "uuid-...",
  "dia_semana": 1,
  "hora_inicio": "09:00",
  "hora_fin": "18:00"
}
```

---

### Bloqueos

| Método | Endpoint                                  | Auth | Rol    | Descripción              |
|--------|-------------------------------------------|------|--------|--------------------------|
| GET    | `/sucursales/:sucursalId/bloqueos`        | Si   | admin  | Listar bloqueos          |
| POST   | `/sucursales/:sucursalId/bloqueos`        | Si   | admin  | Crear bloqueo            |
| DELETE | `/bloqueos/:id`                           | Si   | admin  | Eliminar bloqueo         |

**GET `/sucursales/:sucursalId/bloqueos`**

Response `200`:
```json
[
  {
    "id": "uuid-...",
    "sucursal_id": "uuid-...",
    "empleado_id": null,
    "fecha": "2025-12-25",
    "hora_inicio": "00:00",
    "hora_fin": "23:59",
    "motivo": "Navidad"
  }
]
```

**POST `/sucursales/:sucursalId/bloqueos`**

Request:
```json
{
  "empleado_id": "uuid-...|null",
  "fecha": "2025-12-25",
  "hora_inicio": "00:00",
  "hora_fin": "23:59",
  "motivo": "Navidad"
}
```

Response `201`:
```json
{
  "id": "uuid-...",
  "sucursal_id": "uuid-...",
  "empleado_id": null,
  "fecha": "2025-12-25",
  "hora_inicio": "00:00",
  "hora_fin": "23:59",
  "motivo": "Navidad"
}
```

---

### Reservas (Admin)

| Método | Endpoint                          | Auth | Rol    | Descripción              |
|--------|-----------------------------------|------|--------|--------------------------|
| GET    | `/sucursales/:sucursalId/reservas` | Si  | admin  | Listar reservas          |
| GET    | `/reservas/:id`                   | Si   | admin  | Obtener una              |
| PATCH  | `/reservas/:id`                   | Si   | admin  | Actualizar estado        |
| DELETE | `/reservas/:id`                   | Si   | admin  | Anular reserva           |

**GET `/sucursales/:sucursalId/reservas`**

Query params: `?fecha=2025-07-15&empleado_id=uuid`

Response `200`:
```json
[
  {
    "id": "uuid-...",
    "fecha": "2025-07-15",
    "hora": "10:00",
    "cliente_nombre": "Carlos Lopez",
    "cliente_email": "carlos@email.com",
    "cliente_telefono": "977777777",
    "notas": null,
    "empleado": {
      "id": "uuid-...",
      "nombre": "Maria",
      "apellido": "Garcia"
    },
    "servicio": {
      "id": "uuid-...",
      "nombre": "Corte de Cabello",
      "duracion_min": 30,
      "precio": 25.00
    },
    "estado": {
      "id": "uuid-...",
      "nombre": "Programada"
    }
  }
]
```

**PATCH `/reservas/:id`**

Request:
```json
{
  "estado_id": "uuid-..."
}
```

Response `200`:
```json
{
  "id": "uuid-...",
  "fecha": "2025-07-15",
  "hora": "10:00",
  "estado": {
    "id": "uuid-...",
    "nombre": "Completada"
  }
}
```

---

### Reservas presenciales y recepcionistas (SPEC 08)

Ver `specs/08-reservas-presenciales-y-recepcionistas.md`. Todas las rutas requieren JWT. "Rol 2" significa que el recepcionista puede usarla **solo sobre su sucursal**: otra sucursal, aunque sea de su empresa, responde `403 No tienes permiso para acceder a esta sucursal`.

| Método | Endpoint | Roles | Descripción |
|--------|----------|-------|-------------|
| GET | `/reservas/proxima-hora?sucursalId=&servicioId=&fecha=` | 1, 2 | Primer hueco de cada barbero y su cola |
| POST | `/reservas` | 1, 2 | Reserva presencial o telefónica |
| GET | `/reservas?sucursalId=` | 1, 2 | Reservas de la sucursal |
| PATCH | `/reservas/:id/estado` | 1, 2 | Cambiar el estado de una reserva |
| GET | `/pagos?sucursalId=` | 1, 2 | Pagos de la sucursal (lista que se exporta a Excel) |
| GET | `/pagos/estados` | 1, 2 | Estados de pago |
| POST | `/pagos` | 1, 2 | Registrar un pago manual |
| PATCH | `/pagos/:id/estado` | 1, 2 | Rol 2: solo pagos manuales. Un pago Flow → `403` |
| POST | `/pagos/:id/reembolso`, GET `/pagos/:id/reembolsos` | 1 | Reembolsos Flow (SPEC 07) |
| GET | `/equipo` | 1 | Recepcionistas de la empresa |
| POST | `/equipo` | 1 | Invitar a un recepcionista |
| PATCH | `/equipo/:id` | 1 | Editar, cambiar de sucursal, activar o desactivar |
| POST | `/equipo/:id/reenviar-invitacion` | 1 | Reenviar el correo de invitación |
| GET | `/suscripcion` | 1 | Plan y límites. Antes estaba abierto a cualquier JWT |

Empleados, servicios, horarios, bloqueos, sucursales, configuración, cuentas Flow y suscripción siguen solo para el rol 1. Para armar el formulario de reserva, el rol 2 usa los endpoints públicos de `/reservar/*` con su `sucursalId`.

"Hoy" y "ahora" son la fecha y la hora de `America/Santiago`, no las del servidor.

**GET `/reservas/proxima-hora`**

Query: `sucursalId`, `servicioId` y `fecha` opcional (`AAAA-MM-DD`, por defecto hoy, no puede ser anterior a hoy).

Response `200`:
```json
{
  "fecha": "2026-11-13",
  "ahora": "10:02",
  "servicio": { "id": 97, "nombre": "Corte + Barba", "duracionMinutos": 45 },
  "empleados": [
    {
      "empleadoId": 76,
      "nombre": "Diego",
      "apellido": "Fuentes",
      "foto": null,
      "horaInicio": "10:45",
      "horaFin": "11:30",
      "reservasAntes": 0,
      "esperaMinutos": 43
    },
    {
      "empleadoId": 75,
      "nombre": "Matías",
      "apellido": "Rojas",
      "foto": null,
      "horaInicio": null,
      "horaFin": null,
      "reservasAntes": 4,
      "esperaMinutos": null
    }
  ]
}
```

- Incluye cada empleado activo de la sucursal que ofrece el servicio, ordenados por `horaInicio`. Los que no tienen cupo ese día van al final, con `horaInicio`, `horaFin` y `esperaMinutos` en `null`.
- El hueco es el primer tramo libre donde cabe el servicio completo, dentro del horario de atención y sin cruzarse con reservas activas ni bloqueos. Para hoy se busca desde ahora redondeado hacia arriba a 5 minutos; para otra fecha, desde la apertura.
- `reservasAntes`: reservas del barbero ese día que no están canceladas, rechazadas, anuladas ni completadas, que terminan después de ahora y empiezan antes del hueco. Incluye la que está en curso. Sin hueco, cuenta las que quedan en el día.
- `esperaMinutos`: minutos desde ahora hasta el hueco. `null` para otra fecha.
- Errores: `400` si el servicio no es de la empresa o está inactivo, o si la fecha ya pasó; `403` fuera de alcance; `404` si la sucursal no existe.

**POST `/reservas`**

Request (`empleadoId` obligatorio; `clienteEmail`, `clienteTelefono` y `observacion` opcionales):
```json
{
  "sucursalId": 1,
  "servicioId": 97,
  "empleadoId": 76,
  "fecha": "2026-11-13",
  "horaInicio": "10:45",
  "clienteNombre": "Pedro",
  "clienteTelefono": "+56912345678"
}
```

Response `201`:
```json
{
  "id": 187,
  "codigo": "ec88b752-3608-44af-9f38-aad6ac1e79be",
  "fecha": "2026-11-13",
  "horaInicio": "10:45",
  "horaFin": "11:30",
  "precio": 12000,
  "estado": "Programada",
  "origen": "Panel",
  "empleado": { "id": 76, "nombre": "Diego", "apellido": "Fuentes" },
  "cliente": { "nombre": "Pedro" },
  "reservasAntes": 0
}
```

- La hora no se recalcula: se guarda la `horaInicio` enviada (la que mostró `proxima-hora`) o falla.
- Nace `Programada`, con `origen: "Panel"` y el usuario que la creó. Nunca cobra abono Flow: el cliente paga en el local con `POST /pagos`.
- Con `clienteEmail` se reusa el cliente de la empresa con ese email y se le envía la confirmación con el enlace de cancelación (SPEC 07). No se envía aviso interno al local.
- No acepta `empresaId` (sale del JWT) ni `pagarAhora`: un campo extra responde `400`.
- Errores: `400` si los datos no se corresponden, la hora está fuera del horario de atención o ya pasó; `403` fuera de alcance; `404` si la sucursal no existe; `409 La hora seleccionada ya no está disponible` si se cruza con otra reserva o un bloqueo. Ante un `409`, volver a consultar `proxima-hora`.

**GET `/reservas?sucursalId=`**

Cada reserva agrega `origen` (`"Online"` o `"Panel"`) y `usuarioCreador: { id, nombre } | null` (`null` en las reservas online).

**POST `/equipo`**

Request:
```json
{ "nombre": "Rocío", "apellido": "Soto", "email": "rocio@correo.cl", "sucursalId": 1 }
```

Response `201` (mismo formato que cada elemento de `GET /equipo`):
```json
{
  "id": 31,
  "nombre": "Rocío",
  "apellido": "Soto",
  "email": "rocio@correo.cl",
  "sucursal": { "id": 1, "nombre": "Casa Matriz" },
  "activo": true,
  "invitacionPendiente": true,
  "desactivadoPorSuscripcion": false
}
```

- Envía el correo de invitación. El recepcionista no tiene contraseña hasta aceptarla.
- `invitacionPendiente` deja de ser `true` cuando acepta la invitación.
- Errores: `400 La sucursal no es válida` (de otra empresa o inactiva); `403` con `code: "SUSCRIPCION_LIMITE"` y `recurso: "recepcionistas"` en el plan Gratis; `409 Ese email ya tiene una cuenta`.

**PATCH `/equipo/:id`**

Request (todos opcionales): `{ "nombre", "apellido", "sucursalId", "activo" }`. Responde `200` con el recepcionista actualizado.

- Cambiar `sucursalId` o pasar `activo` a `false` cierra su sesión.
- Pasar `activo` a `true` valida el límite del plan.
- Un `apellido` vacío lo borra.
- `404` si no existe o no es un recepcionista de la empresa.

**POST `/equipo/:id/reenviar-invitacion`**

Response `204`. Genera un enlace nuevo y el anterior deja de servir. Errores: `409` si la invitación ya fue aceptada o el recepcionista está desactivado; `429` si se reenvió hace menos de 1 minuto o más de 5 veces en una hora.

**Límite por plan**

`GET /suscripcion` incluye `limites.recepcionistas` y `uso.recepcionistas`. Gratis: `0`; Prueba y Pro: `null` (ilimitado). Las invitaciones pendientes cuentan. Al bajar a Gratis, los recepcionistas quedan desactivados con `desactivadoPorSuscripcion: true` y se cierra su sesión; al volver a Pro se reactivan. Un recepcionista desactivado a mano no se reactiva solo.

---

### Reservas (Public - Sin Auth)

| Método | Endpoint                          | Auth | Rol    | Descripción              |
|--------|-----------------------------------|------|--------|--------------------------|
| GET    | `/reservar/disponibilidad`        | No   | -      | Ver horarios disponibles |
| POST   | `/reservar`                       | No   | -      | Crear reserva            |
| GET    | `/reservar/:id`                   | No   | -      | Ver estado de reserva    |
| PATCH  | `/reservar/:id/cancelar`          | No   | -      | Cancelar reserva         |

**GET `/reservar/disponibilidad`**

Query params: `?sucursal_id=uuid&servicio_id=uuid&fecha=2025-07-15`

Response `200`:
```json
{
  "fecha": "2025-07-15",
  "empleado": {
    "id": "uuid-...",
    "nombre": "Maria"
  },
  "servicio": {
    "id": "uuid-...",
    "nombre": "Corte de Cabello",
    "duracion_min": 30
  },
  "horarios_disponibles": [
    { "hora": "09:00" },
    { "hora": "09:30" },
    { "hora": "10:00" },
    { "hora": "11:00" }
  ]
}
```

**POST `/reservar`**

Request:
```json
{
  "sucursal_id": "uuid-...",
  "empleado_id": "uuid-...",
  "servicio_id": "uuid-...",
  "cliente_nombre": "Carlos Lopez",
  "cliente_email": "carlos@email.com",
  "cliente_telefono": "977777777",
  "fecha": "2025-07-15",
  "hora": "10:00",
  "notas": "Prefiere silla de barbero"
}
```

Response `201`:
```json
{
  "id": "uuid-...",
  "fecha": "2025-07-15",
  "hora": "10:00",
  "cliente_nombre": "Carlos Lopez",
  "empleado": {
    "id": "uuid-...",
    "nombre": "Maria",
    "apellido": "Garcia"
  },
  "servicio": {
    "id": "uuid-...",
    "nombre": "Corte de Cabello",
    "precio": 25.00
  },
  "estado": {
    "id": "uuid-...",
    "nombre": "Programada"
  }
}
```

**GET `/reservar/:id`**

Response `200`:
```json
{
  "id": "uuid-...",
  "fecha": "2025-07-15",
  "hora": "10:00",
  "cliente_nombre": "Carlos Lopez",
  "cliente_email": "carlos@email.com",
  "empleado": {
    "nombre": "Maria",
    "apellido": "Garcia"
  },
  "servicio": {
    "nombre": "Corte de Cabello",
    "precio": 25.00,
    "duracion_min": 30
  },
  "estado": {
    "nombre": "Programada"
  }
}
```

**PATCH `/reservar/:id/cancelar`**

Response `200`:
```json
{
  "message": "Reserva cancelada",
  "id": "uuid-...",
  "estado": {
    "nombre": "Cancelada"
  }
}
```

---

### Pagos (Admin - Read Only)

| Método | Endpoint                          | Auth | Rol    | Descripción              |
|--------|-----------------------------------|------|--------|--------------------------|
| GET    | `/reservas/:reservaId/pagos`      | Si   | admin  | Pagos de una reserva     |
| GET    | `/pagos/:id`                      | Si   | admin  | Detalle de pago          |

**GET `/reservas/:reservaId/pagos`**

Response `200`:
```json
[
  {
    "id": "uuid-...",
    "reserva_id": "uuid-...",
    "monto": 25.00,
    "metodo_pago": "efectivo",
    "fecha_pago": "2025-07-15T12:00:00.000Z"
  }
]
```

---

### Configuracion Empresa

| Método | Endpoint                              | Auth | Rol    | Descripción          |
|--------|---------------------------------------|------|--------|----------------------|
| GET    | `/empresas/:empresaId/configuracion`  | Si   | admin  | Obtener config       |
| PATCH  | `/empresas/:empresaId/configuracion`  | Si   | admin  | Actualizar config    |

**GET `/empresas/:empresaId/configuracion`**

Response `200`:
```json
{
  "id": "uuid-...",
  "empresa_id": "uuid-...",
  "antelacion_min_reserva": 30,
  "max_dias_futuro": 30,
  "timezone": "America/Lima"
}
```

**PATCH `/empresas/:empresaId/configuracion`**

Request:
```json
{
  "antelacion_min_reserva": 60,
  "max_dias_futuro": 45
}
```

Response `200`:
```json
{
  "id": "uuid-...",
  "empresa_id": "uuid-...",
  "antelacion_min_reserva": 60,
  "max_dias_futuro": 45,
  "timezone": "America/Lima"
}
```

#### Logo de la empresa

| Método | Endpoint                       | Auth | Rol   | Descripción                  |
|--------|--------------------------------|------|-------|------------------------------|
| POST   | `/configuracion-empresa/logo`  | Si   | admin | Subir/reemplazar el logo     |
| DELETE | `/configuracion-empresa/logo`  | Si   | admin | Eliminar el logo             |

La empresa se toma del JWT. La imagen se guarda en Cloudinary y su URL en `Empresa.Logo`
(la devuelve también `GET /reservar/empresa-slug/:slug`).

**POST `/configuracion-empresa/logo`** — `multipart/form-data`, campo `logo`.
PNG, JPG o WEBP, máx. 2 MB (se redimensiona a 512×512 como máximo). Cada subida reemplaza la anterior.

Response `201`:
```json
{ "logo": "https://res.cloudinary.com/<cloud>/image/upload/v.../agendaflow/logos/empresa-1.png" }
```

Errores: `400` sin archivo / tipo no permitido / > 2 MB · `404` empresa no encontrada · `500` fallo de Cloudinary.

**DELETE `/configuracion-empresa/logo`** — Response `204`.

---

## Date/Time Formats

| Campo        | Formato       | Ejemplo               |
|--------------|---------------|-----------------------|
| Fecha        | `YYYY-MM-DD`  | `2025-07-15`          |
| Hora         | `HH:MM`       | `10:00`, `14:30`      |
| Timestamp    | ISO 8601      | `2025-07-15T10:00:00.000Z` |
| `dia_semana` | Int (0-6)     | `0`=Dom, `1`=Lun, ..., `6`=Sab |

---

## Notes

- **Soft Deletes**: `empleados` y `servicios` usan `activo = false` en vez de borrar el registro
- **Nested vs Flat**: Las respuestas usan objetos anidados (`empleado`, `servicio`, `estado`), pero los payloads de creación usan IDs planos (`empleado_id`, `servicio_id`, `estado_id`)
- **Public vs Auth**: Las rutas `/reservar/*` son públicas (sin token); las demás requieren JWT
- **JWT Checks**: Las rutas admin validan `rol === 'admin'` desde el payload del token
- **Estado Table**: Tabla pre-seedeados al iniciar la aplicación
- **UUIDs**: Todos los IDs son UUIDs generados automáticamente

---

## Project Structure

```
agenda-flow-api/
├── src/
│   ├── main.ts
│   ├── app.module.ts
│   ├── app.controller.ts
│   ├── app.service.ts
│   ├── app.controller.spec.ts
│   ├── auth/
│   │   ├── auth.module.ts
│   │   ├── auth.controller.ts
│   │   ├── auth.service.ts
│   │   ├── auth.controller.spec.ts
│   │   ├── jwt.strategy.ts
│   │   ├── jwt-auth.guard.ts
│   │   ├── roles.guard.ts
│   │   ├── roles.decorator.ts
│   │   └── dto/
│   │       ├── login.dto.ts
│   │       └── register.dto.ts
│   ├── empresas/
│   │   ├── empresas.module.ts
│   │   ├── empresas.controller.ts
│   │   ├── empresas.service.ts
│   │   ├── empresas.controller.spec.ts
│   │   ├── entities/
│   │   │   └── empresa.entity.ts
│   │   └── dto/
│   │       ├── create-empresa.dto.ts
│   │       └── update-empresa.dto.ts
│   ├── sucursales/
│   │   ├── sucursales.module.ts
│   │   ├── sucursales.controller.ts
│   │   ├── sucursales.service.ts
│   │   ├── sucursales.controller.spec.ts
│   │   ├── entities/
│   │   │   └── sucursal.entity.ts
│   │   └── dto/
│   │       ├── create-sucursal.dto.ts
│   │       └── update-sucursal.dto.ts
│   ├── empleados/
│   │   ├── empleados.module.ts
│   │   ├── empleados.controller.ts
│   │   ├── empleados.service.ts
│   │   ├── empleados.controller.spec.ts
│   │   ├── entities/
│   │   │   └── empleado.entity.ts
│   │   └── dto/
│   │       ├── create-empleado.dto.ts
│   │       └── update-empleado.dto.ts
│   ├── servicios/
│   │   ├── servicios.module.ts
│   │   ├── servicios.controller.ts
│   │   ├── servicios.service.ts
│   │   ├── servicios.controller.spec.ts
│   │   ├── entities/
│   │   │   └── servicio.entity.ts
│   │   └── dto/
│   │       ├── create-servicio.dto.ts
│   │       └── update-servicio.dto.ts
│   ├── servicios-empleados/
│   │   ├── servicios-empleados.module.ts
│   │   ├── servicios-empleados.controller.ts
│   │   ├── servicios-empleados.service.ts
│   │   ├── servicios-empleados.controller.spec.ts
│   │   ├── entities/
│   │   │   └── servicio-empleado.entity.ts
│   │   └── dto/
│   │       └── create-servicio-empleado.dto.ts
│   ├── horarios/
│   │   ├── horarios.module.ts
│   │   ├── horarios.controller.ts
│   │   ├── horarios.service.ts
│   │   ├── horarios.controller.spec.ts
│   │   ├── entities/
│   │   │   └── horario.entity.ts
│   │   └── dto/
│   │       └── create-horario.dto.ts
│   ├── bloqueos/
│   │   ├── bloqueos.module.ts
│   │   ├── bloqueos.controller.ts
│   │   ├── bloqueos.service.ts
│   │   ├── bloqueos.controller.spec.ts
│   │   ├── entities/
│   │   │   └── bloqueo.entity.ts
│   │   └── dto/
│   │       └── create-bloqueo.dto.ts
│   ├── reservas/
│   │   ├── reservas.module.ts
│   │   ├── reservas.controller.ts
│   │   ├── reservas.service.ts
│   │   ├── reservas.controller.spec.ts
│   │   ├── public/
│   │   │   ├── public.controller.ts
│   │   │   └── public.service.ts
│   │   ├── entities/
│   │   │   ├── reserva.entity.ts
│   │   │   └── estado.entity.ts
│   │   └── dto/
│   │       ├── create-reserva.dto.ts
│   │       └── update-reserva.dto.ts
│   ├── pagos/
│   │   ├── pagos.module.ts
│   │   ├── pagos.controller.ts
│   │   ├── pagos.service.ts
│   │   ├── pagos.controller.spec.ts
│   │   ├── entities/
│   │   │   └── pago.entity.ts
│   │   └── dto/
│   │       └── query-pago.dto.ts
│   └── configuracion-empresa/
│       ├── configuracion-empresa.module.ts
│       ├── configuracion-empresa.controller.ts
│       ├── configuracion-empresa.service.ts
│       ├── configuracion-empresa.controller.spec.ts
│       ├── entities/
│       │   └── configuracion-empresa.entity.ts
│       └── dto/
│           └── update-configuracion.dto.ts
├── test/
│   ├── app.e2e-spec.ts
│   └── jest-e2e.json
├── .gitignore
├── .prettierrc
├── eslint.config.mjs
├── nest-cli.json
├── package.json
├── tsconfig.json
├── tsconfig.build.json
└── README.md
```
