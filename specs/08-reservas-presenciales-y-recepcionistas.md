# SPEC 08 — Reservas presenciales desde el panel y rol recepcionista

> **Estado:** Implementado
> **Depende de:** SPEC 01 (límites por plan y excedente), SPEC 02 (correos de reserva), SPEC 04 (tokens de un solo uso y `TokenVersion`), SPEC 05 (login con Google), SPEC 06 (abonos y pagos manuales), SPEC 07 (`ZONA_HORARIA_NEGOCIO` y enlace de cancelación)
> **Fecha:** 2026-11-13
> **Objetivo:** Que el dueño o un recepcionista invitado agende desde el panel al cliente que llega al local, en el primer hueco libre del barbero que elija, viendo cuántos clientes tiene antes.

## Por qué existe este spec

Hoy la única forma de crear una reserva es `POST /reservar`, la página pública. El panel (`/reservas`, rol 1) solo lista y cambia estados. El cliente que llega al local sin reserva no queda en la agenda, y su hora puede venderse online.

Además, todo el panel es del rol 1. Quien atiende el mesón usa la cuenta del dueño, con acceso a reembolsos, configuración y suscripción. No existe gestión de usuarios del equipo.

El tamaño del spec es deliberado: el usuario decidió incluir el rol recepcionista aquí y no en un spec aparte.

## Alcance

**Entra:**

- **Reservas desde el panel:**
  - `GET /reservas/proxima-hora`: para un servicio, cada barbero que lo ofrece con su primer hueco del día, cuántas reservas tiene antes y los minutos de espera.
  - `POST /reservas`: crea una reserva en una fecha y hora elegidas (presencial o telefónica). Nace `Programada`, sin abono.
  - Columnas `Reserva.Origen` (`'Online'` | `'Panel'`) y `Reserva.UsuarioCreadorId`.
  - Correo de confirmación al cliente si deja email, con el enlace de cancelación de SPEC 07. Sin aviso interno al local.
- **Rol recepcionista (rol 2):**
  - Rol `2 — Recepcionista`, asignado a exactamente una sucursal (`Usuario.SucursalId`).
  - Gestión del equipo para el rol 1: `GET /equipo`, `POST /equipo`, `PATCH /equipo/:id`, `POST /equipo/:id/reenviar-invitacion`.
  - Invitación por correo con enlace para definir la contraseña: `GET /auth/invitacion/:token` y `POST /auth/aceptar-invitacion`.
  - Login con Google solo después de aceptar la invitación.
  - Permisos del rol 2, siempre sobre su sucursal: agenda (ver, crear, cambiar estado, próxima hora) y pagos (ver, registrar pagos manuales, cambiar estado de pagos manuales).
  - Desactivar un recepcionista corta su sesión al instante (`TokenVersion + 1`).
  - Recurso limitado `recepcionistas`: `Gratis` 0, `Prueba` y `Pro` ilimitado. Al bajar a `Gratis` se desactivan como excedente.
- Migración `007`.
- Prompt para el front (al final de este documento).

**Fuera de alcance (para specs futuros):**

- Buscar hueco en días siguientes de forma automática. `proxima-hora` mira un solo día (por defecto hoy).
- Sobrecupo: agendar encima de otra reserva, de un bloqueo o fuera del horario de atención.
- Cobrar abono Flow en reservas del panel.
- Reembolsos Flow e historial de reembolsos para el rol 2.
- Un recepcionista con varias sucursales.
- Otros roles (barbero con agenda propia, contador, etc.) y permisos configurables.
- Eliminar usuarios del equipo. Solo se desactivan.
- Recordatorios por WhatsApp o SMS al cliente presencial.
- Cambios en el código del front. Aquí solo se entrega el prompt.

## Modelo de datos

### Migración `src/database/migrations/007-reservas-panel-y-recepcionistas.sql`

Es idempotente, como las anteriores. Cada bloque va envuelto en `IF NOT EXISTS` o `IF COL_LENGTH(...) IS NULL`. El DDL se agrega también a `schema.sql`.

```sql
-- 1. Rol recepcionista
IF NOT EXISTS (SELECT 1 FROM dbo.Rol WHERE id = 2)
BEGIN
    SET IDENTITY_INSERT dbo.Rol ON;
    INSERT INTO dbo.Rol (id, Nombre, Descripcion, Activo)
    VALUES (2, N'Recepcionista', N'Agenda y pagos manuales de una sucursal', 1);
    SET IDENTITY_INSERT dbo.Rol OFF;
END

-- 2. Usuario: sucursal del recepcionista y excedente del plan
ALTER TABLE dbo.Usuario ADD SucursalId INT NULL
    CONSTRAINT FK_Usuario_Sucursal FOREIGN KEY REFERENCES dbo.Sucursal(Id);
ALTER TABLE dbo.Usuario ADD DesactivadoPorSuscripcion BIT NOT NULL
    CONSTRAINT DF_Usuario_DesactivadoPorSuscripcion DEFAULT 0;

-- 3. Reserva: origen y quién la creó
ALTER TABLE dbo.Reserva ADD Origen NVARCHAR(10) NOT NULL
    CONSTRAINT DF_Reserva_Origen DEFAULT N'Online'
    CONSTRAINT CK_Reserva_Origen CHECK (Origen IN (N'Online', N'Panel'));
ALTER TABLE dbo.Reserva ADD UsuarioCreadorId INT NULL
    CONSTRAINT FK_Reserva_UsuarioCreador FOREIGN KEY REFERENCES dbo.Usuario(id);
```

- `Usuario.SucursalId` solo se usa con `RolId = 2`. En el rol 1 queda `NULL`.
- Las reservas existentes quedan `Origen = 'Online'` y `UsuarioCreadorId = NULL`.

### Entidades

- `Usuario` gana `sucursal?: Sucursal | null` (`SucursalId`) y `desactivadoPorSuscripcion: boolean`.
- `Reserva` gana `origen: 'Online' | 'Panel'` y `usuarioCreador?: Usuario | null` (`UsuarioCreadorId`).

### Roles

```ts
// src/auth/roles.ts
export const ROL_ADMIN = 1;
export const ROL_RECEPCIONISTA = 2;
```

Los `@Roles(1)` existentes se reemplazan por `@Roles(ROL_ADMIN)` solo donde se tocan. Los endpoints abiertos al rol 2 usan `@Roles(ROL_ADMIN, ROL_RECEPCIONISTA)` a nivel de método.

### Alcance por sucursal

`src/auth/alcance-sucursal.ts` → `validarAlcanceSucursal(user: JwtPayload, sucursal: Sucursal): void`. Lanza `403` si:

- La sucursal no es de `user.empresaId` (cualquier rol).
- `user.rolId === ROL_RECEPCIONISTA` y `sucursal.id !== user.sucursalId`.

Se aplica en todos los endpoints abiertos al rol 2: a la sucursal del query o a la sucursal de la reserva o del pago que se toca.

### JWT y respuesta de login

`construirRespuesta` en `auth.service.ts`:

- Rol 2: `sucursalId` sale de `Usuario.SucursalId`, no del empleado con el mismo email.
- `user` agrega `sucursal: { id, nombre } | null` para el rol 2.
- Rol 1 sin cambios.

Cambiar la sucursal de un recepcionista sube su `TokenVersion`. Así el `sucursalId` del JWT nunca queda desactualizado.

### Límite por plan

```ts
// src/suscripciones/planes.ts
export type RecursoLimitado = 'sucursales' | 'empleados' | 'servicios' | 'recepcionistas';

Prueba: { ..., recepcionistas: null },
Pro:    { ..., recepcionistas: null },
Gratis: { ..., recepcionistas: 0 },
```

- `recepcionistas` cuenta los `Usuario` con `EmpresaId = empresa`, `RolId = 2` y `Activo = 1`. Las invitaciones pendientes cuentan.
- `SuscripcionesService.buscarIds` y `contarActivos` agregan el caso `recepcionistas` sobre `dbo.Usuario`.
- Al desactivar el excedente (bajar a `Gratis`), los recepcionistas pasan a `Activo = 0`, `DesactivadoPorSuscripcion = 1` y `TokenVersion + 1`.
- Al volver a `Prueba` o `Pro`, se reactivan los marcados, como el resto del excedente.
- `GET /suscripcion` muestra `limites.recepcionistas` y `uso.recepcionistas` sin cambios extra.

### Hora del negocio

`src/reservas/hora-negocio.ts` → `ahoraEnNegocio(ahora = new Date()): { fecha: string; minutos: number }`. Devuelve la fecha `AAAA-MM-DD` y los minutos desde medianoche en `ZONA_HORARIA_NEGOCIO`. Es pura y recibe `ahora` para las pruebas.

### Primer hueco

`src/reservas/huecos.ts` → `primerHueco(entrada): number | null`. Es una función pura.

```ts
interface EntradaHueco {
  desde: number;                                  // minutos desde medianoche
  duracion: number;                               // Servicio.DuracionMinutos
  abiertos: { inicio: number; fin: number }[];    // Horario abierto de la sucursal ese día
  ocupados: { inicio: number; fin: number }[];    // reservas activas + bloqueos del empleado
}
```

- Candidatos: `desde`, cada `abiertos[i].inicio` y cada `ocupados[i].fin` que sean `>= desde`.
- Devuelve el menor candidato `c` tal que `[c, c + duracion]` cabe completo en un tramo abierto y no se cruza con ningún ocupado.
- `null` si no hay ninguno.
- `desde` para hoy es `ahoraEnNegocio().minutos` redondeado hacia arriba a múltiplos de 5. Para otra fecha es `0`.
- Las reservas activas son las que no están en `ESTADOS_QUE_LIBERAN` (`Cancelada`, `Rechazado`, `Anulado`). Es la misma regla de `horaOcupada`.

### Cola

`reservasAntes` = reservas del empleado ese día con estado fuera de `ESTADOS_QUE_LIBERAN` y distinto de `Completada`, con `horaFin > desde` y `horaInicio < hueco`. Incluye la que está en curso.

`esperaMinutos` = `hueco − ahora` (sin redondear) si la fecha es hoy. `null` para otra fecha.

### Endpoints de reservas (JWT, roles 1 y 2)

| Método y ruta | Descripción |
| --- | --- |
| `GET /reservas/proxima-hora?sucursalId=&servicioId=&fecha=` | `fecha` es opcional (por defecto hoy en `America/Santiago`) y no puede ser anterior a hoy. Llama a `anularVencidos(sucursalId)` antes de calcular. Responde `{ fecha, ahora: 'HH:mm', servicio: { id, nombre, duracionMinutos }, empleados: [{ empleadoId, nombre, apellido, foto, horaInicio, horaFin, reservasAntes, esperaMinutos }] }`. Incluye cada empleado activo de la sucursal que ofrece el servicio. Sin hueco → `horaInicio`, `horaFin`, `esperaMinutos` en `null`. Orden: `horaInicio` ascendente, los `null` al final. Errores: `400` si el servicio no es de la empresa o está inactivo o la fecha ya pasó, `403` fuera de alcance, `404` si la sucursal no existe. |
| `POST /reservas` | Body `CreateReservaPanelDto`: `{ sucursalId, servicioId, empleadoId, fecha, horaInicio, clienteNombre, clienteEmail?, clienteTelefono?, observacion? }`. Mismas validaciones de formato que `CreateReservaDto`. `empleadoId` es obligatorio. Responde `201 { id, codigo, fecha, horaInicio, horaFin, precio, estado: 'Programada', origen: 'Panel', empleado: { id, nombre, apellido }, cliente: { nombre }, reservasAntes }`. Errores: `400` si los datos no se corresponden, la hora está fuera del horario de atención o es anterior a `ahora` redondeado hacia abajo a 5 min, `403` fuera de alcance, `409 "La hora seleccionada ya no está disponible"` si se cruza con otra reserva o bloqueo. |
| `GET /reservas?sucursalId=` | Abierto al rol 2. Cada reserva agrega `origen` y `usuarioCreador: { id, nombre } \| null`. |
| `PATCH /reservas/:id/estado` | Abierto al rol 2 sobre reservas de su sucursal. Sin otros cambios. |

`POST /reservas` no recalcula la hora. El front manda la `horaInicio` que obtuvo de `proxima-hora` y que se le dijo al cliente. Si otra reserva la tomó entre medio, responde `409` y el front vuelve a consultar.

### Creación compartida

Se extrae de `ReservarService` a `src/reservas/creacion-reserva.service.ts` (`CreacionReservaService`):

- `validarReferencias`, `validarHorarioDeAtencion` y `obtenerCliente`.
- La transacción `SERIALIZABLE` con `horaOcupada` y el manejo del interbloqueo `1205` → `409`.

`ReservarService.createReserva` y `ReservasService.crearDesdePanel` la usan. El comportamiento público no cambia.

`crearDesdePanel`:

1. Valida alcance, referencias, horario y que `fecha + horaInicio` no esté en el pasado.
2. `anularVencidos(sucursalId)` antes del control de solape.
3. En la transacción: control de solape, cliente (reusa el de la empresa si hay email), reserva `Programada`, `Origen = 'Panel'`, `UsuarioCreadorId = user.sub`, `Precio = Servicio.Precio`.
4. No llama a `evaluarCobro` ni crea `Pago`.
5. Después del commit calcula `reservasAntes` y dispara `notificarNuevaReserva(id, { avisoInterno: false })`.

### Correos de la reserva del panel

`ReservaCorreosService.notificarNuevaReserva(reservaId, opciones?: { avisoInterno?: boolean })`. `avisoInterno` es `true` por defecto.

- Con `avisoInterno: false` no se envía `reserva-nueva-interna.ts`.
- El correo al cliente sigue igual (requiere `EnviarCorreo` y email), con el token y el botón de cancelación de SPEC 07.

### Pagos (JWT, roles 1 y 2)

| Método y ruta | Rol 2 |
| --- | --- |
| `GET /pagos?sucursalId=` | Sí, solo su sucursal. Es la lista que el front exporta a Excel. |
| `GET /pagos/estados` | Sí. |
| `POST /pagos` | Sí, si la reserva es de su sucursal. |
| `PATCH /pagos/:id/estado` | Sí, si el pago es de su sucursal y es manual (`CuentaFlowId` nulo). Pago Flow → `403`. |
| `POST /pagos/:id/reembolso`, `GET /pagos/:id/reembolsos` | No. Siguen solo rol 1. |

### Gestión del equipo (JWT, rol 1)

Controlador `src/usuarios/equipo.controller.ts`, ruta `/equipo`, con `EquipoService` en `src/usuarios/`.

| Método y ruta | Descripción |
| --- | --- |
| `GET /equipo` | Recepcionistas de la empresa: `id`, `nombre`, `apellido`, `email`, `sucursal: { id, nombre }`, `activo`, `invitacionPendiente`, `desactivadoPorSuscripcion`. `invitacionPendiente` = `PasswordHash IS NULL AND GoogleId IS NULL AND EmailVerificado = 0`. |
| `POST /equipo` | Body `{ nombre, apellido?, email, sucursalId }`. Valida que la sucursal sea de la empresa y esté activa, y `validarLimite(empresaId, 'recepcionistas')` (`403` de SPEC 01). Email en minúsculas. Email ya usado por cualquier `Usuario` → `409 "Ese email ya tiene una cuenta"`. Crea el `Usuario` con `RolId = 2`, `EmpresaId`, `SucursalId`, `PasswordHash = NULL`, `EmailVerificado = 0`, `Activo = 1` y envía la invitación. Responde `201` con el mismo formato de `GET /equipo`. |
| `PATCH /equipo/:id` | Body `{ nombre?, apellido?, sucursalId?, activo? }`. Cambiar `sucursalId` o pasar `activo` a `false` sube `TokenVersion`. Pasar `activo` a `true` valida el límite y limpia `DesactivadoPorSuscripcion`. `404` si no existe o no es rol 2 de la empresa. |
| `POST /equipo/:id/reenviar-invitacion` | Solo si `invitacionPendiente`. Respeta los límites de envío de SPEC 04 (`evaluarLimiteEnvio`): `429` si se excede. Genera un token nuevo y el anterior deja de servir. |

### Invitación

- El token se genera con `generarToken()` de `src/auth/token-cuenta.ts` y se guarda en `ResetTokenHash` / `ResetExpira`, con vigencia `VIGENCIA_INVITACION_MS = 7 días` (nueva constante en `token-cuenta.ts`).
- URL: `` `${FRONT_URL}/invitacion?token=${token}` ``. Nunca se escribe en el log.
- Plantilla nueva `src/correos/plantillas/invitacion-equipo.ts`, enviada por `CuentaCorreosService`. Incluye el nombre del negocio, la sucursal, quién invita y el botón "Crear mi contraseña". Indica que el enlace vence en 7 días.

**Endpoints públicos** (`@Throttle({ default: { limit: 10, ttl: 60_000 } })`):

| Método y ruta | Descripción |
| --- | --- |
| `GET /auth/invitacion/:token` | `{ nombre, email, empresa, sucursal }`. `400 "El enlace no es válido o expiró"` si el hash no existe, venció o el usuario está inactivo. |
| `POST /auth/aceptar-invitacion` | Body `{ token, password }` con la misma validación de contraseña de `restablecer-contrasena`. Hace el mismo `UPDATE` condicional que `restablecerContrasena` (contraseña, `EmailVerificado = 1`, `TokenVersion + 1`, limpia los tokens). Responde lo mismo que `POST /auth/login`, así el recepcionista entra directo. `400` con el mismo mensaje si el token no sirve. |

"Olvidé mi contraseña" sobre una invitación pendiente reemplaza el token por uno de reset. Ese enlace también define la contraseña y verifica el email.

### Login

- `POST /auth/login`: sin cambios. Una invitación pendiente no tiene contraseña y responde `401 "Credenciales inválidas"`. Un recepcionista inactivo responde `401 "Cuenta desactivada"`.
- `POST /auth/google`: si el usuario encontrado por email es rol 2 con `EmailVerificado = 0`, responde `401 "Acepta la invitación que llegó a tu correo antes de entrar con Google"` y no vincula `GoogleId`. Con la invitación aceptada, vincula y entra como en SPEC 05.
- `POST /auth/google/registro` con el email de un recepcionista: sigue el `409` existente de email en uso.
- Un recepcionista nunca crea empresa ni sucursal.

### Endpoints que siguen solo para el rol 1

Empleados, servicios, horarios, bloqueos, sucursales, configuración de la empresa, cuentas Flow, suscripción, reembolsos y `/equipo`. El rol 2 recibe `403`.

Para armar el formulario de reserva, el front del rol 2 usa los endpoints públicos de `/reservar/*` (servicios, empleados, servicios-empleados, horarios, bloqueos, ocupación) con su `sucursalId`.

## Plan de implementación

1. **Migración y entidades.** Crear `007-reservas-panel-y-recepcionistas.sql`, actualizar `schema.sql` y las entidades `Usuario` y `Reserva`. Crear `src/auth/roles.ts`. Ejecutar la migración. La app arranca sin errores de TypeORM.
2. **Hora del negocio y huecos.** `hora-negocio.ts` y `huecos.ts` con sus `.spec.ts`: hueco al inicio del horario, entre dos reservas, que no cabe por 5 minutos, cruce con un bloqueo, horario partido (mañana y tarde), día sin cupo, `desde` redondeado a 5 y la fecha correcta cerca de medianoche en Chile.
3. **Creación compartida.** Extraer `CreacionReservaService` y hacer que `ReservarService.createReserva` la use. Las pruebas existentes de `reservar.service.spec.ts` siguen pasando sin cambios de comportamiento.
4. **Alcance por sucursal.** `alcance-sucursal.ts` con su `.spec.ts`. Usar `sucursalId` del JWT del rol 2.
5. **Próxima hora.** `GET /reservas/proxima-hora` en `ReservasController` y `ReservasService`. Pruebas: orden de empleados, `reservasAntes` con una reserva en curso, empleado sin cupo, fecha futura, fecha pasada.
6. **Crear desde el panel.** `POST /reservas` con `CreateReservaPanelDto` y `crearDesdePanel`. `avisoInterno` en `notificarNuevaReserva`. `origen` y `usuarioCreador` en `GET /reservas`. Pruebas: crea `Programada` sin `Pago`, `409` por solape, hora pasada, cliente reutilizado por email, sin email no envía correo.
7. **Abrir agenda y pagos al rol 2.** `@Roles(ROL_ADMIN, ROL_RECEPCIONISTA)` en los métodos indicados y `validarAlcanceSucursal` en cada uno. Bloqueo de pagos Flow en `PATCH /pagos/:id/estado` para el rol 2. Pruebas de `403` en otra sucursal y en reembolsos.
8. **Límite por plan.** Recurso `recepcionistas` en `planes.ts` y `SuscripcionesService`, con `TokenVersion + 1` al desactivar el excedente. Pruebas en `suscripciones.service.spec.ts`: bajar a `Gratis` desactiva, volver a `Pro` reactiva.
9. **Gestión del equipo.** `EquipoController` y `EquipoService` (`GET`, `POST`, `PATCH`, reenviar). Constante `VIGENCIA_INVITACION_MS` y plantilla `invitacion-equipo.ts` con su caso en `plantillas.spec.ts`. Pruebas: email repetido, límite en `Gratis`, cambio de sucursal sube `TokenVersion`.
10. **Invitación y login.** `GET /auth/invitacion/:token`, `POST /auth/aceptar-invitacion`, `sucursalId` y `sucursal` del rol 2 en `construirRespuesta`, y el rechazo de Google con invitación pendiente. Pruebas en `auth.service.spec.ts` y `cuenta.service.spec.ts`.
11. **Documentación.** Agregar los endpoints nuevos y los cambios de rol a `API-SPEC.md`.

## Criterios de aceptación

- [ ] La migración `007` se puede ejecutar dos veces sin error y deja las reservas existentes con `Origen = 'Online'`.
- [ ] `primerHueco` con horario 10:00–20:00, reservas 10:00–10:30 y 10:45–11:30, duración 30 y `desde` 10:05 devuelve 11:30.
- [ ] Con las mismas reservas y duración 15, devuelve 10:30.
- [ ] `GET /reservas/proxima-hora` lista solo empleados activos de la sucursal que ofrecen el servicio, ordenados por hora, con los sin cupo al final y `horaInicio: null`.
- [ ] Con una reserva en curso y otra después, el hueco siguiente informa `reservasAntes: 2`.
- [ ] Una reserva `Completada` o `Cancelada` no cuenta en `reservasAntes`.
- [ ] `GET /reservas/proxima-hora` con una fecha anterior a hoy → `400`.
- [ ] `POST /reservas` crea la reserva `Programada`, `Origen = 'Panel'`, `UsuarioCreadorId` del usuario y sin filas en `dbo.Pago`, aunque la empresa cobre abono.
- [ ] `POST /reservas` sobre una hora ocupada → `409`. Fuera del horario de atención → `400`. Con una hora de hoy ya pasada → `400`.
- [ ] Una reserva del panel con email envía la confirmación al cliente con el botón de cancelar y no envía el aviso interno. Sin email no envía nada.
- [ ] La reserva del panel bloquea la hora en `GET /reservar/ocupacion/:sucursalId`.
- [ ] `POST /reservar` (público) sigue funcionando igual: mismas respuestas y mismas pruebas.
- [ ] `POST /equipo` en plan `Gratis` → `403` de límite. En `Pro` crea el usuario rol 2 y envía el correo de invitación.
- [ ] `POST /equipo` con un email que ya existe → `409`.
- [ ] En la BD queda solo el hash del token de invitación.
- [ ] `POST /auth/aceptar-invitacion` con un token válido define la contraseña, deja `EmailVerificado = 1` y devuelve un JWT con `rolId: 2` y el `sucursalId` asignado.
- [ ] Un token de invitación vencido o usado → `400`.
- [ ] `POST /auth/google` con el email de una invitación pendiente → `401` y no se guarda `GoogleId`. Después de aceptar, entra.
- [ ] Con JWT de rol 2: `GET /reservas`, `POST /reservas`, `PATCH /reservas/:id/estado`, `GET /reservas/proxima-hora`, `GET /pagos`, `POST /pagos` y `PATCH /pagos/:id/estado` (pago manual) funcionan sobre su sucursal.
- [ ] Con JWT de rol 2, cualquiera de esos endpoints sobre otra sucursal → `403`.
- [ ] Con JWT de rol 2: `PATCH /pagos/:id/estado` de un pago Flow, `POST /pagos/:id/reembolso`, `/empleados`, `/servicios`, `/configuracion-empresa`, `/suscripcion` y `/equipo` → `403`.
- [ ] `PATCH /equipo/:id { activo: false }` hace que la siguiente petición del recepcionista responda `401`.
- [ ] `PATCH /equipo/:id { sucursalId }` invalida el JWT anterior. El login siguiente trae la sucursal nueva.
- [ ] Bajar de `Pro` a `Gratis` desactiva a todos los recepcionistas con `DesactivadoPorSuscripcion = 1` y corta sus sesiones. Volver a `Pro` los reactiva.
- [ ] `GET /suscripcion` incluye `limites.recepcionistas` y `uso.recepcionistas`.
- [ ] `npm run test` y `npm run build` pasan.

## Decisiones

- **Sí:** el rol recepcionista y la gestión del equipo van en este spec. Lo decidió el usuario, aunque agranda el spec.
- **Sí:** `proxima-hora` busca solo en un día (hoy por defecto). El cliente está en el local: si su barbero no tiene cupo hoy, se le ofrece otro barbero, no otro día.
- **Sí:** `proxima-hora` devuelve todos los barberos que ofrecen el servicio. Cubre "quiero con tal barbero" y "con cualquiera" con una sola llamada.
- **Sí:** el primer hueco se busca desde ahora redondeado a 5 minutos, sin alinearse a `TiempoReservaMinutos`. Aprovecha los huecos entre reservas.
- **No:** grilla de `TiempoReservaMinutos` ni "al final de la cola". Dejan huecos sin usar o hacen esperar de más.
- **Sí:** `POST /reservas` recibe la hora explícita y no la recalcula. La hora que se le dijo al cliente es la que se guarda, o falla con `409`.
- **Sí:** `POST /reservas` acepta cualquier fecha y hora futura válida. Cubre reservas por teléfono con el mismo endpoint.
- **Sí:** `empleadoId` obligatorio en el panel. El hueco y la cola dependen del barbero.
- **No:** sobrecupo. Las mismas reglas de solape, bloqueos y horario que la reserva online.
- **Sí:** la reserva del panel nace `Programada` y nunca cobra abono Flow. El cliente paga en el local con el flujo de pagos manuales.
- **Sí:** columnas `Origen` y `UsuarioCreadorId`. Distinguen reservas online de presenciales y dejan auditoría de quién agendó.
- **Sí:** nombre obligatorio, email y teléfono opcionales. Con email se reusa el `Cliente` de la empresa y recibe la confirmación con el enlace de cancelación.
- **No:** aviso interno al local por las reservas del panel. Quien la crea ya está en el local.
- **Sí:** `reservasAntes` cuenta las reservas activas de hoy que terminan después de ahora y empiezan antes del hueco, incluida la que está en curso. Es lo que el cliente percibe como "tiene 2 antes que tú".
- **Sí:** un recepcionista pertenece a una sola sucursal (`Usuario.SucursalId`). Evita una tabla intermedia y un selector de sucursal.
- **Sí:** el rol 2 ve y opera la agenda y los pagos de su sucursal, y registra pagos manuales. No reembolsa ni toca configuración: mover dinero de Flow es del dueño.
- **Sí:** el rol 2 usa los endpoints públicos `/reservar/*` para servicios y empleados. Ya devuelven lo necesario sin datos internos y evitan abrir los CRUD del rol 1.
- **Sí:** invitación por correo con token de un solo uso en las columnas de reset de SPEC 04. El dueño nunca conoce la contraseña y no se agregan columnas.
- **No:** el dueño define la contraseña. Menos seguro y la contraseña viaja fuera del sistema.
- **Sí:** invitación válida 7 días. El reset de 1 hora es corto para alguien que recibe el correo sin esperarlo.
- **Sí:** Google solo después de aceptar la invitación. Evita que el login de Google active una cuenta sin pasar por el enlace.
- **Sí:** desactivar o cambiar de sucursal sube `TokenVersion`. El `JwtAuthGuard` ya lo compara y la sesión se corta en la siguiente petición.
- **No:** eliminar recepcionistas. Sus reservas guardan `UsuarioCreadorId`. Se desactivan.
- **Sí:** recurso limitado `recepcionistas` con `Gratis: 0`. Reusa el excedente de SPEC 01 y es un incentivo para Pro. Las reservas del panel del dueño siguen en todos los planes.
- **Sí:** las invitaciones pendientes cuentan contra el límite. Si no, en `Gratis` se podrían acumular invitaciones y activarlas después.

## Riesgos

| Riesgo | Mitigación |
| --- | --- |
| La hora del servidor no está en Chile y "hoy" sale corrido | `ahoraEnNegocio` usa `ZONA_HORARIA_NEGOCIO` explícita y tiene pruebas cerca de medianoche. |
| Dos recepcionistas, o un recepcionista y un cliente online, toman la misma hora | La creación sigue en la transacción `SERIALIZABLE` con `horaOcupada`. El segundo recibe `409`. |
| Extraer `CreacionReservaService` rompe la reserva pública | Paso 3 del plan: las pruebas existentes de `reservar.service.spec.ts` deben pasar sin modificarse. |
| Un endpoint abierto al rol 2 olvida validar la sucursal | `validarAlcanceSucursal` es el único punto de control y cada endpoint tiene su prueba de `403` en otra sucursal. |
| `sucursalId` del JWT desactualizado tras mover al recepcionista | Cambiar la sucursal sube `TokenVersion`. |
| Invitación reenviada muchas veces (spam al correo del invitado) | Límites de envío de SPEC 04 y `429`. |
| Un usuario invitado ya tiene cuenta de dueño con ese email | `Usuario.Email` es único: `POST /equipo` responde `409`. El dueño usa otro email. |
| El cliente presencial deja un email ajeno | Solo recibe la confirmación y el enlace de cancelación de esa reserva. Es el mismo riesgo de la reserva online. |

## Prompt para el front

> Implementa las reservas presenciales y el rol recepcionista de AgendaFlow (SPEC 08 del back).
>
> **1. Agendar presencial (rol 1 y rol 2).**
> - En la agenda del panel agrega el botón "Agendar cliente". Abre un panel con: servicio (de `GET /reservar/servicios/:empresaId`), y luego la lista de `GET /reservas/proxima-hora?sucursalId=&servicioId=`.
> - Cada fila de la lista: foto y nombre del barbero, "Hoy a las {horaInicio}", "{reservasAntes} antes" (o "Sin espera" si es 0) y "~{esperaMinutos} min". Si `horaInicio` es `null`: "Sin cupo hoy", deshabilitada. La primera fila con hora va destacada como "Más pronto".
> - Al elegir un barbero pide: nombre (obligatorio), teléfono y email (opcionales) y observación. Muestra el resumen "Corte con {barbero} hoy a las {hora} — {reservasAntes} antes". Confirma con `POST /reservas` mandando la `horaInicio` mostrada y `fecha` de la respuesta de `proxima-hora`.
> - `201` → "Reserva agendada", cierra el panel y recarga la agenda. Si mandó email: "Le enviamos la confirmación". `409` → "Esa hora se acaba de ocupar" y vuelve a consultar `proxima-hora` automáticamente. `400` → muestra el mensaje.
> - Agrega la opción "Otra fecha u hora": selector de fecha (desde hoy) que llama a `proxima-hora` con `fecha=`, y un selector de hora libre construido con `GET /reservar/horarios`, `/reservar/bloqueos` y `/reservar/ocupacion` de la sucursal (la misma lógica de la página pública). Envía igual a `POST /reservas`.
> - En la lista de reservas, muestra un distintivo "Presencial" cuando `origen === 'Panel'` y "Agendó: {usuarioCreador.nombre}" en el detalle.
>
> **2. Equipo (solo rol 1).**
> - Nueva sección "Equipo" en el menú. Lista `GET /equipo`: nombre, email, sucursal, estado ("Invitación pendiente", "Activo", "Desactivado", "Desactivado por plan").
> - Botón "Invitar recepcionista": nombre, apellido, email y sucursal → `POST /equipo`. `201` → "Invitación enviada a {email}". `409` → "Ese email ya tiene una cuenta". `403` de límite → el mismo aviso de upgrade a Pro que ya usan sucursales y empleados.
> - Por fila: "Reenviar invitación" (si pendiente, `POST /equipo/:id/reenviar-invitacion`; `429` → "Espera un momento antes de reenviar"), "Cambiar sucursal" y "Desactivar/Activar" (`PATCH /equipo/:id`). Antes de desactivar o cambiar sucursal avisa "Se cerrará su sesión".
> - En la pantalla de suscripción muestra el uso de `recepcionistas` junto a los otros límites.
>
> **3. Aceptar invitación (pública).**
> - Ruta `/invitacion?token=`. Llama a `GET /auth/invitacion/:token` y muestra "Hola {nombre}, te invitaron a {empresa} — {sucursal}" con el formulario de contraseña (mismas reglas que restablecer contraseña).
> - Envía `POST /auth/aceptar-invitacion { token, password }`. La respuesta es igual a la del login: guarda la sesión y redirige a la agenda. `400` → "El enlace no es válido o expiró. Pide al dueño que te reenvíe la invitación".
>
> **4. Panel del recepcionista (`rolId === 2`).**
> - Menú solo con Agenda y Pagos. Oculta empleados, servicios, horarios, bloqueos, sucursales, configuración, cuentas Flow, suscripción, equipo y reembolsos.
> - Sin selector de sucursal: usa `user.sucursal` de la respuesta de login y muestra su nombre en la cabecera.
> - Pagos: lista y exportar Excel igual que el dueño, registrar pago manual y cambiar estado solo en pagos manuales. Oculta "Reembolsar" y "Ver reembolsos".
> - Para servicios, empleados y horarios usa los endpoints públicos `/reservar/*` con su `sucursalId`.
> - Un `401` en cualquier petición cierra la sesión con "Tu sesión terminó. Vuelve a iniciar sesión".
> - En el login con Google, un `401` con el mensaje de invitación pendiente se muestra tal cual.

## Qué **no** entra en este spec

- Búsqueda automática de hueco en días siguientes.
- Sobrecupo.
- Abono Flow en reservas del panel.
- Reembolsos para el rol 2.
- Recepcionistas con varias sucursales.
- Otros roles o permisos configurables.
- Eliminar usuarios del equipo.
- Recordatorios por WhatsApp o SMS.
- Cambios en el código del front.

Cada uno, si se hace, va en su propio spec.
