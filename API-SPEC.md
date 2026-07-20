# API Specification - AgendaFlow

## Overview

| Campo         | Valor                        |
|---------------|------------------------------|
| **Base URL**  | `http://localhost:3000/api`  |
| **Auth**      | JWT (Bearer Token)           |
| **Roles**     | `admin`, `empleado`          |
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
