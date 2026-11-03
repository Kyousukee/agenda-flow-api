# SPEC 01 — Suscripciones: prueba de 14 días, plan Gratis con límites y Pro manual

> **Estado:** Aprobado
> **Depende de:** —
> **Fecha:** 2026-11-03
> **Objetivo:** Que el back controle la suscripción de cada empresa (Prueba 14 días → Gratis con límites, o Pro pagado/sin fecha activado por script) y rechace con un error de suscripción todo lo que supere el plan vigente.

## Por qué existe este spec

La landing promete un plan **Gratis** ($0, con límites) y un plan **Pro** ($19.990/mes, sin límites), más "14 días de prueba gratis". Hoy el back no tiene ningún concepto de plan. El cobro se hace fuera de la app, pero la app debe saber qué plan tiene cada empresa, aplicar los límites y avisar cuando el plan está por vencer.

## Alcance

**Entra:**

- Tabla nueva `dbo.Suscripcion`, con una fila por empresa.
- Al registrarse, la empresa recibe el plan `Prueba` (equivale a Pro) por 14 días desde la fecha de registro.
- Al vencer `Prueba` o `Pro` sin renovación, la empresa baja automáticamente a `Gratis`.
- Límites del plan `Gratis`: 1 sucursal activa, 2 empleados activos, 5 servicios activos.
- Al bajar a `Gratis`, se desactiva lo más reciente que supere los límites. Queda marcado como "desactivado por suscripción".
- Al volver a `Pro`, se reactiva solo lo que había desactivado la suscripción.
- Las acciones que superen el límite devuelven un error `403` con el código `SUSCRIPCION_LIMITE`. Eso incluye crear una sucursal, un empleado o un servicio, y reactivar uno.
- Endpoint `GET /suscripcion` con el plan, la fecha de fin, los días restantes, el uso frente a los límites y un mensaje de aviso cuando quedan 3 días o menos.
- La página pública de reservas no muestra una sucursal inactiva.
- Los listados del panel (`GET /sucursales`, `GET /empleados/...`, `GET /servicios`) incluyen el campo `desactivadoPorSuscripcion` en cada registro, para que el front lo muestre (SPEC 02).
- Scripts SQL: migración, Pro sin fecha, extender Pro N días, revocar Pro y consulta de estado.

**Fuera de alcance (para specs futuros):**

- Cobro automático o pasarela de pago. El cobro sigue siendo externo.
- Endpoints o panel de superadmin. Todo se gestiona con scripts SQL.
- Cambios en el front: banner de aviso, manejo del 403, pantalla de plan.
- Límite de reservas mensuales. Las reservas no se limitan en ningún plan.
- Límite de horarios. Quedan acotados de forma natural por la sucursal (7 días por sucursal).
- "Recordatorios básicos/automáticos" y "Analíticas avanzadas" de la landing. Esas funciones no existen todavía.
- Notificaciones por correo de vencimiento.
- Tarea programada (cron). La detección de vencimiento se hace al consultar.

## Modelo de datos

### Script de migración: `src/database/migrations/001-suscripciones.sql`

```sql
-- 1. Tabla de suscripciones (1:1 con Empresa)
IF OBJECT_ID(N'dbo.Suscripcion', N'U') IS NULL
CREATE TABLE dbo.Suscripcion (
    Id                     INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Suscripcion PRIMARY KEY,
    EmpresaId              INT           NOT NULL CONSTRAINT UQ_Suscripcion_Empresa UNIQUE,
    [Plan]                 NVARCHAR(20)  NOT NULL
                           CONSTRAINT CK_Suscripcion_Plan CHECK ([Plan] IN (N'Prueba', N'Gratis', N'Pro')),
    FechaInicio            DATETIME2     NOT NULL CONSTRAINT DF_Suscripcion_FechaInicio DEFAULT GETDATE(),
    FechaFin               DATETIME2     NULL,   -- NULL + Pro = sin vencimiento; NULL + Gratis = indefinido
    ExcedenteDesactivado   BIT           NOT NULL CONSTRAINT DF_Suscripcion_Excedente DEFAULT 0,
    FechaActualizacion     DATETIME2     NULL     CONSTRAINT DF_Suscripcion_FechaAct DEFAULT GETDATE(),
    CONSTRAINT FK_Suscripcion_Empresa FOREIGN KEY (EmpresaId) REFERENCES dbo.Empresa(Id)
);
GO

-- 2. Marca de "desactivado por suscripción" en los recursos limitados
IF COL_LENGTH('dbo.Sucursal', 'DesactivadoPorSuscripcion') IS NULL
    ALTER TABLE dbo.Sucursal ADD DesactivadoPorSuscripcion BIT NOT NULL
        CONSTRAINT DF_Sucursal_DesactSusc DEFAULT 0;
IF COL_LENGTH('dbo.Empleado', 'DesactivadoPorSuscripcion') IS NULL
    ALTER TABLE dbo.Empleado ADD DesactivadoPorSuscripcion BIT NOT NULL
        CONSTRAINT DF_Empleado_DesactSusc DEFAULT 0;
IF COL_LENGTH('dbo.Servicio', 'DesactivadoPorSuscripcion') IS NULL
    ALTER TABLE dbo.Servicio ADD DesactivadoPorSuscripcion BIT NOT NULL
        CONSTRAINT DF_Servicio_DesactSusc DEFAULT 0;
GO

-- 3. Backfill: las empresas existentes reciben la prueba desde su fecha de registro
INSERT INTO dbo.Suscripcion (EmpresaId, [Plan], FechaInicio, FechaFin)
SELECT e.Id, N'Prueba', e.FechaCreacion, DATEADD(DAY, 14, e.FechaCreacion)
FROM dbo.Empresa e
WHERE NOT EXISTS (SELECT 1 FROM dbo.Suscripcion s WHERE s.EmpresaId = e.Id);
GO
```

El mismo DDL (pasos 1 y 2) se agrega a `src/database/schema.sql` para instalaciones nuevas.

### Entidad y constantes (`src/suscripciones/`)

```ts
// suscripciones/planes.ts
export type PlanSuscripcion = 'Prueba' | 'Gratis' | 'Pro';
export type RecursoLimitado = 'sucursales' | 'empleados' | 'servicios';

export const DIAS_PRUEBA = 14;
export const DIAS_AVISO = 3;

// null = ilimitado
export const LIMITES_PLAN: Record<PlanSuscripcion, Record<RecursoLimitado, number | null>> = {
  Prueba: { sucursales: null, empleados: null, servicios: null },
  Pro:    { sucursales: null, empleados: null, servicios: null },
  Gratis: { sucursales: 1,    empleados: 2,    servicios: 5 },
};
```

Entidad `Suscripcion` (`@Entity('Suscripcion')`): `id`, `empresaId`, `plan`, `fechaInicio`, `fechaFin: Date | null`, `excedenteDesactivado: boolean`, `fechaActualizacion`. Relación `OneToOne` con `Empresa`.

Columna nueva en las entidades `Sucursal`, `Empleado` y `Servicio`:

```ts
@Column({ type: 'bit', default: false, name: 'DesactivadoPorSuscripcion' })
desactivadoPorSuscripcion: boolean;
```

Los `findAllBy...` de los tres servicios devuelven la entidad completa con `find()`. El campo sale en la respuesta en cuanto se agrega a la entidad. No se debe excluir con `select` ni con un mapeo.

### Reglas del plan vigente

`SuscripcionesService.obtenerVigente(empresaId)` es el único punto que resuelve el plan. Aplica estas reglas en orden:

1. `Plan = 'Pro'` y `FechaFin IS NULL` → Pro sin vencimiento.
2. `Plan IN ('Prueba','Pro')` y `FechaFin >= ahora` → ese plan, vigente.
3. `Plan IN ('Prueba','Pro')` y `FechaFin < ahora` → se **degrada**: `Plan = 'Gratis'`, `FechaFin = NULL`, se desactiva el excedente y `ExcedenteDesactivado = 1`.
4. `Plan = 'Gratis'` → límites de Gratis.
5. Si el plan resultante es ilimitado (`Prueba` o `Pro`) y `ExcedenteDesactivado = 1` → se **reactiva** todo lo que tenga `DesactivadoPorSuscripcion = 1` (`Activo = 1`, marca en 0) y `ExcedenteDesactivado = 0`.
6. Si la empresa no tiene fila en `Suscripcion` → se crea `Gratis` (caso defensivo, no debería ocurrir).

**Excedente al degradar:** por cada recurso se conservan activos los N más antiguos (por `Id` ascendente) y el resto pasa a `Activo = 0` con `DesactivadoPorSuscripcion = 1`. Los empleados se cuentan a nivel de empresa, sumando todas sus sucursales. Lo que el dueño ya había desactivado a mano no se toca.

**Dónde se llama `obtenerVigente`:** en `GET /suscripcion`, en cada validación de límite y en la carga de la página pública (`GET /reservar/empresa-slug/:slug`). Así, el excedente se oculta a los clientes aunque el dueño no entre a la app.

### Error de límite

Respuesta `403 Forbidden`:

```json
{
  "statusCode": 403,
  "code": "SUSCRIPCION_LIMITE",
  "plan": "Gratis",
  "recurso": "servicios",
  "limite": 5,
  "actual": 5,
  "message": "Tu plan Gratis permite hasta 5 servicios activos. Actualiza a Pro para agregar más."
}
```

Clase: `SuscripcionLimiteException extends ForbiddenException`, en `src/suscripciones/suscripcion-limite.exception.ts`.

### Respuesta de `GET /suscripcion`

```json
{
  "plan": "Prueba",
  "sinVencimiento": false,
  "fechaFin": "2026-11-17T15:20:17.734Z",
  "diasRestantes": 2,
  "porVencer": true,
  "aviso": "Tu prueba gratuita vence en 2 días. Contáctanos para activar el plan Pro.",
  "limites": { "sucursales": null, "empleados": null, "servicios": null },
  "uso": { "sucursales": 1, "empleados": 1, "servicios": 3 }
}
```

- `diasRestantes` = `ceil((FechaFin - ahora) / 1 día)`. Vale `null` si no hay `FechaFin`.
- `porVencer` = `diasRestantes !== null && diasRestantes <= DIAS_AVISO`.
- `aviso` según el caso:
  - Prueba por vencer: `"Tu prueba gratuita vence en N días…"`.
  - Pro por vencer: `"Tu plan Pro vence en N días…"`.
  - Plan Gratis: `"Estás en el plan Gratis. Actualiza a Pro para quitar los límites."`.
  - En cualquier otro caso: `null`.
- Cuando faltan menos de 24 horas, el texto dice "vence hoy" en vez de "en 0 días".
- `uso` cuenta solo los registros con `Activo = 1`.

## Plan de implementación

1. **Migración SQL.** Crear `src/database/migrations/001-suscripciones.sql` con el contenido de arriba y agregar el DDL a `schema.sql`. Ejecutarla en la BD local. Verificar: `SELECT * FROM dbo.Suscripcion` devuelve una fila `Prueba` por empresa. La app sigue arrancando igual.
2. **Entidades.** Crear `src/suscripciones/entities/suscripcion.entity.ts` y agregar `desactivadoPorSuscripcion` a `Sucursal`, `Empleado` y `Servicio`. Crear `SuscripcionesModule` (vacío de lógica) y registrarlo en `AppModule`. La app arranca sin errores de TypeORM.
3. **Constantes y excepción.** Crear `planes.ts` y `suscripcion-limite.exception.ts`.
4. **`SuscripcionesService.obtenerVigente`.** Implementar las reglas 1 a 6, incluyendo degradar con desactivación del excedente y reactivar al volver a Pro. Exportar el servicio desde el módulo.
5. **`SuscripcionesService.validarLimite(empresaId, recurso)`.** Resuelve el plan vigente, cuenta los activos y lanza `SuscripcionLimiteException` si `actual >= limite`.
6. **`GET /suscripcion`.** Crear `suscripciones.controller.ts` protegido con `JwtAuthGuard`, usando `req.user.empresaId`. Devuelve el objeto descrito arriba.
7. **Registro.** En `auth.service.ts` (`register`), insertar la `Suscripcion` `Prueba` (`FechaFin = ahora + 14 días`) dentro de la misma transacción que crea la empresa.
8. **Límite al crear.** Llamar a `validarLimite` al inicio de `create()` en `sucursales.service.ts`, `empleados.service.ts` y `servicios.service.ts`, solo cuando el nuevo registro quede activo (`dto.activo ?? true`). Importar `SuscripcionesModule` en esos tres módulos.
9. **Límite al reactivar.** En el `update()` de los tres servicios, si `dto.activo === true` y el registro estaba inactivo, llamar a `validarLimite`. Cualquier cambio manual de `activo` pone `desactivadoPorSuscripcion = false`.
10. **Página pública.** En `reservar.service.ts`, llamar a `obtenerVigente(empresa.id)` dentro de `getEmpresaBySlug`. Hacer que `getSucursal` responda `404` si la sucursal tiene `activo = false`.
11. **Scripts de administración** en `src/database/scripts/`:
    - `suscripcion-pro-sin-fecha.sql`: recibe `@Slug`. Deja `Plan = 'Pro'` y `FechaFin = NULL`.
    - `suscripcion-pro-extender.sql`: recibe `@Slug` y `@Dias = 30`. Deja `Plan = 'Pro'` y `FechaFin = DATEADD(DAY, @Dias, base)`, donde `base` es la `FechaFin` actual si sigue vigente (Prueba o Pro) y `GETDATE()` en otro caso.
    - `suscripcion-revocar-pro.sql`: recibe `@Slug`. Deja `FechaFin = DATEADD(SECOND, -1, GETDATE())` y mantiene el plan, para que la app ejecute la degradación normal en la próxima consulta.
    - `suscripcion-estado.sql`: lista todas las empresas con su slug, plan, `FechaFin` y días restantes.

## Criterios de aceptación

- [ ] Después de la migración, cada empresa existente tiene una fila `Prueba` con `FechaFin = FechaCreacion + 14 días`.
- [ ] Una empresa recién registrada tiene `Plan = 'Prueba'` y `FechaFin` a 14 días de la fecha de registro.
- [ ] En `Prueba` o `Pro` vigente se pueden crear más de 5 servicios, más de 2 empleados y más de 1 sucursal sin error.
- [ ] Con `FechaFin` en el pasado, la primera llamada a `GET /suscripcion` devuelve `plan: "Gratis"` y la BD queda con `Plan = 'Gratis'` y `FechaFin = NULL`.
- [ ] Al degradar una empresa con 8 servicios activos, quedan activos los 5 de menor `Id`. Los otros 3 quedan con `Activo = 0` y `DesactivadoPorSuscripcion = 1`.
- [ ] Un servicio que el dueño desactivó a mano antes de degradar mantiene `DesactivadoPorSuscripcion = 0`.
- [ ] En `Gratis`, con 5 servicios activos, `POST /servicios` devuelve `403` con `code: "SUSCRIPCION_LIMITE"`, `recurso: "servicios"`, `limite: 5` y `actual: 5`.
- [ ] En `Gratis`, con 2 empleados activos, `POST /empleados` devuelve `403` con `recurso: "empleados"`.
- [ ] En `Gratis`, con 1 sucursal activa, `POST /sucursales` devuelve `403` con `recurso: "sucursales"`.
- [ ] En `Gratis`, con 5 servicios activos, `PUT /servicios/:id` con `activo: true` sobre un servicio inactivo devuelve `403`.
- [ ] En `Gratis`, crear un servicio con `activo: false` no devuelve error.
- [ ] Después de correr `suscripcion-pro-sin-fecha.sql`, `GET /suscripcion` devuelve `plan: "Pro"`, `sinVencimiento: true`, `diasRestantes: null` y `aviso: null`.
- [ ] Al pasar de `Gratis` (con excedente) a `Pro`, la siguiente consulta reactiva exactamente los registros con `DesactivadoPorSuscripcion = 1` y deja `ExcedenteDesactivado = 0`.
- [ ] `suscripcion-pro-extender.sql` con `@Dias = 30` sobre un Pro que vence en 5 días deja `FechaFin` 35 días adelante.
- [ ] Con 2 días restantes, `GET /suscripcion` devuelve `porVencer: true` y un `aviso` que contiene "2 días".
- [ ] Con 10 días restantes, `GET /suscripcion` devuelve `porVencer: false` y `aviso: null`.
- [ ] `GET /reservar/sucursal/:id` de una sucursal inactiva devuelve `404`.
- [ ] Cargar la página pública de una empresa con la prueba vencida aplica la degradación sin que el dueño inicie sesión.
- [ ] Las reservas públicas (`POST /reservar`) funcionan igual en los tres planes.
- [ ] `GET /servicios`, `GET /sucursales` y el listado de empleados devuelven `desactivadoPorSuscripcion` (booleano) en cada elemento.

## Decisiones

- **Sí:** el plan `Prueba` es distinto de `Pro`, aunque tenga los mismos límites. Permite avisos distintos ("tu prueba vence" frente a "tu Pro vence") y reportes.
- **Sí:** al vencer se baja a `Gratis`, no se bloquea la empresa. Calza con la landing ("Gratis para siempre").
- **Sí:** se desactiva el excedente (los más recientes por `Id`) en lugar de solo bloquear la creación. Así el plan Gratis respeta los límites de verdad, también en la página pública.
- **Sí:** la marca `DesactivadoPorSuscripcion` permite reactivar solo lo que desactivó el sistema. No se toca lo que el dueño desactivó a mano.
- **Sí:** `ExcedenteDesactivado` en `Suscripcion` evita buscar registros marcados en cada request.
- **Sí:** la detección de vencimiento es perezosa (al consultar), no un cron. No agrega dependencias. Cubre la página pública porque `getEmpresaBySlug` también la dispara.
- **No:** cron diario con `@nestjs/schedule`. Agrega una dependencia y un proceso que no hacen falta con el volumen actual.
- **Sí:** la gestión es solo con scripts SQL. El cobro es externo y hay un solo administrador.
- **No:** rol SuperAdmin ni API key de administración. Quedan para un spec futuro si hace falta un panel.
- **Sí:** las empresas se crean con el registro normal. El script solo activa Pro, así que no hay que generar hashes bcrypt en SQL.
- **Sí:** revocar Pro pone `FechaFin` en el pasado, en lugar de escribir `Gratis` directo. Así pasa por la misma lógica de degradación y desactivación.
- **Sí:** extender suma días desde la `FechaFin` vigente. Pagar antes de tiempo no hace perder días.
- **Sí:** el error de límite es `403` con un `code` estable (`SUSCRIPCION_LIMITE`), para que el front lo distinga de otros 403.
- **No:** `402 Payment Required`. Su soporte en clientes HTTP es irregular.
- **No:** limitar reservas por mes. Lo decidió el usuario.
- **No:** limitar horarios. Ya quedan limitados por el número de sucursales.
- **Sí:** el empleado dueño que se crea al registrarse cuenta para el límite de 2 empleados.

## Riesgos

| Riesgo | Mitigación |
| --- | --- |
| Dos creaciones simultáneas pueden superar el límite por 1 | Se acepta. El volumen es bajo y la siguiente degradación o validación lo corrige. |
| La degradación corre en medio de un request de creación | `obtenerVigente` se ejecuta antes de contar, así que la validación usa el estado ya degradado. |
| El reloj del servidor de BD y el de Node difieren | Toda comparación de fechas se hace en Node con `new Date()`. Los scripts usan `GETDATE()` solo para escribir. |
| Se desactiva la única sucursal que tiene empleados o servicios asignados | Se conserva la sucursal más antigua, que es la creada en el registro. Las demás quedan ocultas, no borradas. |
| Una empresa sin fila en `Suscripcion` (datos corruptos) | Regla 6: se crea en `Gratis` en vez de fallar. |

## Qué **no** entra en este spec

- Pasarela de pago o cobro automático.
- Panel o endpoints de superadmin.
- Cambios en el front (banner de vencimiento, manejo del 403, pantalla de plan).
- Límites de reservas u horarios.
- Recordatorios y analíticas avanzadas.
- Correos de aviso de vencimiento.
- Cron de vencimientos.

Cada uno, si se hace, va en su propio spec.
