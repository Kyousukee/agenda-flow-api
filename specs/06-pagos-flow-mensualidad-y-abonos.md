# SPEC 06 — Pagos con Flow: mensualidad Pro y abonos de reservas

> **Estado:** Aprobado
> **Depende de:** SPEC 01 (plan vigente y extensión de Pro), SPEC 02 (correos de reserva nueva)
> **Fecha:** 2026-11-10
> **Objetivo:** Que el back cobre con Flow la mensualidad Pro (a la cuenta Flow de AgendaFlow, sumando 30 días) y el abono de las reservas públicas (a la cuenta Flow de la empresa o de la sucursal), según la configuración de anticipo de cada empresa.

## Por qué existe este spec

Hoy Pro se activa a mano con `suscripcion-pro-extender.sql` después de un cobro externo. `ConfiguracionEmpresa` ya tiene `PermitePagoAnticipado`, `TipoAnticipo` y `MontoAnticipo`, pero nada los usa.

Hay dos flujos de dinero distintos:

- **Mensualidad:** la paga la empresa y el dinero va a la cuenta Flow de AgendaFlow (credenciales en `.env`).
- **Abono:** lo paga el cliente final y el dinero va al local. Cada sucursal puede tener su propia cuenta Flow o usar la de la empresa. Flow no reparte pagos entre comercios, así que el back firma cada cobro con las credenciales del comercio que recibe el dinero.

## Alcance

**Entra:**

- Cliente HTTP de Flow (`payment/create` y `payment/getStatus`) con la firma HMAC-SHA256 de Flow.
- Variables de entorno `FLOW_API_URL`, `FLOW_API_KEY`, `FLOW_SECRET_KEY`, `FLOW_CREDENCIALES_KEY` y `API_PUBLIC_URL`.
- **Mensualidad:**
  - `POST /suscripcion/pagar` crea un cobro de $19.990 a la cuenta de AgendaFlow y devuelve la URL de Flow.
  - Al confirmarse el pago, se extiende Pro 30 días con la misma regla del script de SPEC 01: se suma desde la `FechaFin` vigente, o desde hoy si está en `Gratis` o vencido.
  - `GET /suscripcion/pagos` devuelve el historial de pagos de la mensualidad.
  - Tabla nueva `dbo.PagoSuscripcion`.
- **Cuentas Flow de los locales:**
  - Tabla nueva `dbo.CuentaFlow`: una cuenta por empresa y, opcionalmente, una por sucursal.
  - La `secretKey` se guarda cifrada con AES-256-GCM. La API nunca la devuelve.
  - Endpoints del panel para ver, guardar y borrar las cuentas de la empresa y de cada sucursal.
  - Regla de resolución: cuenta de la sucursal → si no hay, cuenta de la empresa → si no hay, sin pago online.
- **Abonos:**
  - `TipoAnticipo` acepta solo `Monto`, `Porcentaje` o `Completo`.
  - Columna nueva `ConfiguracionEmpresa.PagoObligatorio`. Si es `0`, el cliente elige pagar ahora o en el local.
  - Cálculo del abono por servicio: monto fijo con tope en el precio, porcentaje redondeado hacia arriba o precio completo.
  - Solo en los planes `Prueba` y `Pro`. En `Gratis` las reservas se crean sin pago y activar el anticipo responde `403`.
  - `POST /reservar` crea la reserva en estado `Pendiente`, registra un `Pago` `Pendiente` y devuelve la URL de Flow.
  - La reserva `Pendiente` retiene la hora 15 minutos. Si el pago no se confirma, pasa a `Anulado` y libera la hora (detección perezosa).
  - Al confirmarse el pago, la reserva pasa a `Programada`, el `Pago` a `Pagado` y recién ahí se envían los correos de SPEC 02.
  - Endpoint público `GET /reservar/reservas/:codigo/pago` para que el front muestre el resultado.
  - La página pública recibe la configuración de pago de la empresa y el abono de cada servicio.
- Webhooks de confirmación y retorno de Flow para ambos flujos.
- Migración `005`.
- Prompt para el front (al final de este documento).

**Fuera de alcance (para specs futuros):**

- Cobro recurrente automático de la mensualidad (suscripciones de Flow con tarjeta guardada).
- Plan anual u otros precios.
- Reembolsos por la API de Flow. El local reembolsa desde su panel de Flow y marca el pago `Reembolsado` con `PATCH /pagos/:id/estado`.
- Reintentar el pago de una reserva rechazada. El cliente vuelve a reservar.
- Pagar el saldo restante de la reserva online.
- Comisión de AgendaFlow sobre los abonos.
- Boleta o factura electrónica.
- Correos de "pago recibido" de la mensualidad.
- Cron para anular reservas vencidas.
- Validar las credenciales Flow contra Flow al guardarlas.
- Cambios en el código del front. Aquí solo se entrega el prompt.

## Variables de entorno

```env
# Flow (SPEC 06). Sandbox: https://sandbox.flow.cl/api · Producción: https://www.flow.cl/api
# La misma URL se usa para tu cuenta y para las cuentas de los locales.
FLOW_API_URL=https://sandbox.flow.cl/api
# Tu cuenta Flow: recibe la mensualidad Pro. Flow → Mis datos → Integración.
FLOW_API_KEY=
FLOW_SECRET_KEY=
# Clave para cifrar las secretKey de los locales: 32 bytes en base64.
# Generar con: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
# Si se pierde o se cambia, hay que volver a cargar todas las cuentas Flow de los locales.
FLOW_CREDENCIALES_KEY=
# URL pública de esta API. Flow llama aquí los webhooks: en local hace falta un túnel (ngrok, cloudflared).
API_PUBLIC_URL=http://localhost:3000
```

Comportamiento degradado:

- Sin `FLOW_API_KEY` o `FLOW_SECRET_KEY`: la API arranca y `POST /suscripcion/pagar` responde `503`.
- Sin `FLOW_CREDENCIALES_KEY` (o con una clave que no mide 32 bytes): la API arranca, guardar una cuenta Flow responde `503` y todas las reservas se crean sin pago.
- Las cinco variables se documentan en `.env.example`.

## Modelo de datos

### Migración `src/database/migrations/005-pagos-flow.sql`

Es idempotente, como las anteriores. El DDL se agrega también a `schema.sql`.

```sql
-- 1. Cuentas Flow de los locales
CREATE TABLE dbo.CuentaFlow (
    Id                 INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_CuentaFlow PRIMARY KEY,
    EmpresaId          INT            NOT NULL,
    SucursalId         INT            NULL,      -- NULL = cuenta de la empresa
    ApiKey             NVARCHAR(100)  NOT NULL,
    SecretKeyCifrada   NVARCHAR(500)  NOT NULL,  -- base64(iv | authTag | cifrado)
    FechaCreacion      DATETIME2      NOT NULL CONSTRAINT DF_CuentaFlow_FechaCreacion DEFAULT GETDATE(),
    FechaActualizacion DATETIME2      NULL,
    FechaBaja          DATETIME2      NULL,      -- baja lógica (ver Decisiones)
    CONSTRAINT FK_CuentaFlow_Empresa  FOREIGN KEY (EmpresaId)  REFERENCES dbo.Empresa(Id),
    CONSTRAINT FK_CuentaFlow_Sucursal FOREIGN KEY (SucursalId) REFERENCES dbo.Sucursal(Id)
);
CREATE UNIQUE INDEX UX_CuentaFlow_Empresa  ON dbo.CuentaFlow (EmpresaId)  WHERE SucursalId IS NULL AND FechaBaja IS NULL;
CREATE UNIQUE INDEX UX_CuentaFlow_Sucursal ON dbo.CuentaFlow (SucursalId) WHERE SucursalId IS NOT NULL AND FechaBaja IS NULL;

-- 2. Pagos de la mensualidad
CREATE TABLE dbo.PagoSuscripcion (
    Id              INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_PagoSuscripcion PRIMARY KEY,
    EmpresaId       INT            NOT NULL,
    Monto           DECIMAL(10,2)  NOT NULL,
    Dias            INT            NOT NULL,
    EstadoId        INT            NOT NULL,     -- Estado tipo 'Pago'
    FlowToken       NVARCHAR(100)  NULL,
    FlowOrder       BIGINT         NULL,
    FechaCreacion   DATETIME2      NOT NULL CONSTRAINT DF_PagoSuscripcion_FechaCreacion DEFAULT GETDATE(),
    FechaPago       DATETIME2      NULL,
    FinAnterior     DATETIME2      NULL,         -- FechaFin antes de extender (auditoría)
    FinNuevo        DATETIME2      NULL,         -- FechaFin después de extender
    CONSTRAINT FK_PagoSuscripcion_Empresa FOREIGN KEY (EmpresaId) REFERENCES dbo.Empresa(Id),
    CONSTRAINT FK_PagoSuscripcion_Estado  FOREIGN KEY (EstadoId)  REFERENCES dbo.Estado(Id)
);
CREATE UNIQUE INDEX UX_PagoSuscripcion_FlowToken ON dbo.PagoSuscripcion (FlowToken) WHERE FlowToken IS NOT NULL;

-- 3. Columnas Flow en los abonos (dbo.Pago)
ALTER TABLE dbo.Pago ADD
    CuentaFlowId     INT            NULL,  -- cuenta que firmó el cobro; NULL = pago manual del panel
    FlowToken        NVARCHAR(100)  NULL,
    FlowOrder        BIGINT         NULL,
    FechaExpiracion  DATETIME2      NULL;  -- fin de la retención de la hora
-- FK_Pago_CuentaFlow sin borrado en cascada; índice único filtrado UX_Pago_FlowToken.

-- 4. Configuración de anticipo
ALTER TABLE dbo.ConfiguracionEmpresa ADD PagoObligatorio BIT NOT NULL
    CONSTRAINT DF_ConfiguracionEmpresa_PagoObligatorio DEFAULT 1;
-- Normalización: TipoAnticipo fuera de ('Monto','Porcentaje','Completo') pasa a NULL
-- y esa fila queda con PermitePagoAnticipado = 0. El script informa cuántas filas cambió.
ALTER TABLE dbo.ConfiguracionEmpresa ADD CONSTRAINT CK_ConfiguracionEmpresa_TipoAnticipo
    CHECK (TipoAnticipo IS NULL OR TipoAnticipo IN (N'Monto', N'Porcentaje', N'Completo'));
```

Cada bloque va envuelto en `IF OBJECT_ID(...) IS NULL` o `IF COL_LENGTH(...) IS NULL`, como en `001` a `004`.

Borrar una sucursal no es un caso real: las sucursales se desactivan (`Activo = 0`). Por eso la FK a `Sucursal` no tiene cascada.

### Entidades

- `src/flow/entities/cuenta-flow.entity.ts` → `CuentaFlow`: `id`, `empresaId`, `sucursalId: number | null`, `apiKey`, `secretKeyCifrada`, `fechaCreacion`, `fechaActualizacion`, `fechaBaja`.
- `src/suscripciones/entities/pago-suscripcion.entity.ts` → `PagoSuscripcion`: `id`, `empresaId`, `monto`, `dias`, `estado: Estado`, `flowToken`, `flowOrder`, `fechaCreacion`, `fechaPago`, `finAnterior`, `finNuevo`.
- `Pago` gana `cuentaFlowId`, `flowToken`, `flowOrder` y `fechaExpiracion`, todos opcionales.
- `ConfiguracionEmpresa` gana `pagoObligatorio: boolean`.

### Constantes

```ts
// suscripciones/planes.ts (se agrega)
export const PRECIO_PRO_CLP = 19990;
export const DIAS_POR_PAGO = 30;
export const PAGOS_ONLINE_POR_PLAN: Record<PlanSuscripcion, boolean> = {
  Prueba: true, Pro: true, Gratis: false,
};

// pagos/abonos.ts
export type TipoAnticipo = 'Monto' | 'Porcentaje' | 'Completo';
export const MINUTOS_RETENCION_PAGO = 15;
export const FLOW_MONTO_MINIMO = 350; // CLP. Confirmar el mínimo vigente en el sandbox de Flow.
```

### Cálculo del abono

`calcularAbono(precio, config): number | null` en `src/pagos/abonos.ts`. Es una función pura.

| `TipoAnticipo` | Resultado |
| --- | --- |
| `Monto` | `min(MontoAnticipo, precio)` |
| `Porcentaje` | `ceil(precio × MontoAnticipo / 100)` |
| `Completo` | `precio` |

- El resultado es un entero en pesos.
- Devuelve `null` (no se cobra) si `PermitePagoAnticipado = 0`, si el precio es `0` o si el resultado es menor que `FLOW_MONTO_MINIMO`.

Validación de `PUT /configuracion-empresa` cuando queda `PermitePagoAnticipado = true`:

- `TipoAnticipo` es obligatorio (`400`).
- `Monto` exige `MontoAnticipo` entero `>= 1`. `Porcentaje` exige un entero entre `1` y `100`. `Completo` ignora `MontoAnticipo`.
- El plan vigente debe permitir pagos online. Si no, responde `403` con `code: "SUSCRIPCION_LIMITE"`, `recurso: "pagosOnline"`, `limite: 0`, `actual: 0` y `message: "Los pagos online están disponibles en el plan Pro."`.
- Cada sucursal activa debe resolver una cuenta Flow (propia o de la empresa). Si no, responde `400` con la lista de sucursales sin cuenta.

### Resolución de la cuenta Flow

`CuentasFlowService.resolver(sucursalId): CuentaFlow | null` busca primero la cuenta con ese `SucursalId` y luego la de la empresa (`SucursalId IS NULL`). Solo considera cuentas vigentes (`FechaBaja IS NULL`). Desactivar la sucursal no borra su cuenta.

### Firma de Flow

`src/flow/flow.client.ts`. Usa `fetch` nativo, sin dependencias nuevas.

- Firma: se ordenan los parámetros por nombre, se concatenan como `nombre + valor` y se aplica HMAC-SHA256 con la `secretKey`. El resultado en hex va en el parámetro `s`.
- `crearPago(credenciales, { commerceOrder, subject, amount, email, urlConfirmation, urlReturn, timeout? })` → `POST {FLOW_API_URL}/payment/create` (form-urlencoded, `currency = CLP`) → `{ url, token, flowOrder }`.
- `obtenerEstado(credenciales, token)` → `GET {FLOW_API_URL}/payment/getStatus` → `{ status, amount, commerceOrder, flowOrder, paymentData }`.
- Estados de Flow: `1` pendiente, `2` pagada, `3` rechazada, `4` anulada.
- La URL que se entrega al navegador es `` `${url}?token=${token}` ``.
- `commerceOrder` es `R-{Pago.Id}` para los abonos y `S-{PagoSuscripcion.Id}` para la mensualidad. Es único dentro de cada cuenta Flow.

### Cifrado

`src/flow/cifrado.ts`: `cifrar(texto)` y `descifrar(base64)` con AES-256-GCM, IV aleatorio de 12 bytes y la clave `FLOW_CREDENCIALES_KEY`. El formato guardado es `base64(iv | authTag | cifrado)`.

### Endpoints

**Panel (JWT, rol 1):**

| Método y ruta | Descripción |
| --- | --- |
| `POST /suscripcion/pagar` | Crea el cobro de la mensualidad. Responde `{ urlPago, pagoId }`. `409` si la empresa tiene Pro sin vencimiento. `503` si falta `FLOW_API_KEY`. `502` si Flow no responde al crear el cobro (el pago queda `Rechazado`). |
| `GET /suscripcion/pagos` | Pagos de la mensualidad de la empresa: `id`, `monto`, `dias`, `estado`, `fechaCreacion`, `fechaPago`, `finNuevo`. Más reciente primero. |
| `GET /configuracion-empresa/flow` | `{ empresa: { configurada, apiKeyFinal } , sucursales: [{ sucursalId, nombre, activa, cuentaPropia, apiKeyFinal, usaCuentaEmpresa }] }`. `apiKeyFinal` son los últimos 4 caracteres. Nunca devuelve la `secretKey`. |
| `PUT /configuracion-empresa/flow/empresa` | `{ apiKey, secretKey }`. Crea la cuenta de la empresa o la reemplaza (baja de la vigente + fila nueva). |
| `DELETE /configuracion-empresa/flow/empresa` | Da de baja la cuenta de la empresa (`FechaBaja = ahora`). |
| `PUT /configuracion-empresa/flow/sucursales/:sucursalId` | `{ apiKey, secretKey }`. Crea o reemplaza (baja + fila nueva) la cuenta propia de la sucursal. `403` si la sucursal es de otra empresa. |
| `DELETE /configuracion-empresa/flow/sucursales/:sucursalId` | Da de baja la cuenta propia. La sucursal vuelve a usar la de la empresa. |

Quitar una cuenta está permitido aunque el anticipo esté activo. Es una baja lógica: la fila se conserva porque `Pago.CuentaFlowId` la referencia y los webhooks de los pagos en curso necesitan las credenciales que firmaron el cobro. Las reservas de las sucursales que queden sin cuenta se crean sin pago y se loguea un warning.

**Públicos:**

| Método y ruta | Cambio |
| --- | --- |
| `GET /reservar/empresa-slug/:slug` | Agrega `pagoOnline: { activo, obligatorio, tipo, monto }`. `activo` es `true` solo si `PermitePagoAnticipado = 1`, el plan lo permite y existe `FLOW_CREDENCIALES_KEY`. |
| `GET /reservar/servicios/:empresaId` | Cada servicio agrega `abono: number \| null`, con el resultado de `calcularAbono`. |
| `POST /reservar` | Acepta `pagarAhora?: boolean` (solo se usa si `PagoObligatorio = 0`). Responde además `estado` y `pago: { monto, urlPago, expiraEn } \| null`. |
| `GET /reservar/reservas/:codigo/pago` | Nuevo. `{ estadoReserva, estadoPago, monto, expiraEn }`. `404` si la reserva no existe o no tiene pago Flow. El `codigo` es el UUID de la reserva. |

**Webhooks de Flow** (públicos, `@SkipThrottle()`, body form-urlencoded con `token`):

| Ruta | Función |
| --- | --- |
| `POST /flow/abono/confirmacion` | Confirma el pago de un abono. Responde `200` siempre que el token exista, aunque ya se haya procesado. |
| `POST /flow/abono/retorno` | Flow envía aquí al navegador. Procesa igual que la confirmación y redirige con `303` a `` `${FRONT_URL}/reserva/pago?codigo={codigo}` ``. |
| `POST /flow/suscripcion/confirmacion` | Confirma el pago de la mensualidad. |
| `POST /flow/suscripcion/retorno` | Procesa y redirige con `303` a `` `${FRONT_URL}/suscripcion/pago?estado=pagado\|rechazado\|pendiente` ``. |

Los webhooks nunca confían en el body. Buscan el pago por `FlowToken`, consultan `payment/getStatus` con las credenciales que firmaron el cobro y comprueban que `amount` y `commerceOrder` coincidan con lo guardado. Un token desconocido responde `404`.

### Flujo del abono

1. `POST /reservar` valida como hoy y calcula `abono` con el precio del servicio.
2. Se cobra si se cumplen todas estas condiciones:
   - `abono !== null`.
   - El plan vigente permite pagos online.
   - La sucursal resuelve una cuenta Flow.
   - Existe `FLOW_CREDENCIALES_KEY`.
   - `PagoObligatorio = 1`, o `PagoObligatorio = 0` y `pagarAhora = true`.
3. Si se cobra y falta `clienteEmail` → `400 "El email es obligatorio para pagar online"`. Flow exige el email del pagador.
4. Si no se cobra, todo sigue igual que hoy: reserva `Programada`, correos inmediatos y `pago: null`.
5. Si se cobra, dentro de la transacción `SERIALIZABLE` actual se crea la reserva en estado `Pendiente` (tipo `Reserva`). También se crea el `Pago` con `Monto = abono`, `MetodoPago = 'Flow'`, estado `Pendiente`, `CuentaFlowId`, `FechaPago = ahora` y `FechaExpiracion = ahora + 15 min`.
6. Después del commit se llama `crearPago` con `timeout = 15 × 60` y se guardan `FlowToken` y `FlowOrder`. No se envían correos todavía.
7. Si `crearPago` falla (credenciales malas o Flow caído), la reserva pasa a `Programada` y el `Pago` a `Rechazado`. Se envían los correos, se loguea el error y la respuesta lleva `pago: null`. La regla es la misma que sin cuenta: no se pierde la reserva.
8. Al confirmarse, según el `status` de Flow:
   - `2` (pagada) → `Pago` `Pagado`, `FechaPago` = fecha de Flow y reserva `Programada`. Se llama a `notificarNuevaReserva` (SPEC 02).
   - `3` o `4` → `Pago` `Rechazado` y reserva `Anulado`.
   - `1` → no cambia nada.
9. La transición se hace con `UPDATE ... WHERE EstadoId = <Pendiente>`. Si no afecta filas, otro proceso ya la hizo y no se repite nada (idempotencia: los correos se envían una sola vez).

**Anulación perezosa:** `AbonosService.anularVencidos(sucursalId)` pasa a `Anulado` las reservas `Pendiente` de esa sucursal cuyo `Pago` `Pendiente` tenga `FechaExpiracion < ahora`. Sus pagos quedan `Rechazado`. Se llama al inicio de:

- `getOcupacionBySucursal`.
- `createReserva`, antes del control de solape.
- `GET /reservas` del panel.
- `GET /reservar/reservas/:codigo/pago`.

**Pago tardío:** Flow confirma `2` sobre una reserva ya `Anulado`. El `Pago` pasa a `Pagado` igual, porque el dinero se recibió. La reserva vuelve a `Programada` y se envían los correos solo si la hora sigue libre (mismo control de solape). Si no, se queda `Anulado` y se loguea un error `"Pago {id} recibido sobre reserva anulada: requiere reembolso manual"`.

### Flujo de la mensualidad

1. `POST /suscripcion/pagar` resuelve el plan vigente (`obtenerVigente`). Si es Pro sin vencimiento → `409`.
2. Crea `PagoSuscripcion` `Pendiente` con `Monto = PRECIO_PRO_CLP` y `Dias = DIAS_POR_PAGO`.
3. Llama `crearPago` con las credenciales de `.env`, `subject = "AgendaFlow Pro - 30 días"` y el email del usuario que hace la petición. Guarda `FlowToken` y `FlowOrder`.
4. Al confirmarse con `status = 2`, en una sola transacción:
   - Se hace la transición `Pendiente` → `Pagado` con `UPDATE ... WHERE`. Si no afecta filas, se termina sin hacer nada más.
   - Se ejecuta `SuscripcionesService.extenderPro(empresaId, dias, manager)` con la regla de `suscripcion-pro-extender.sql`.
   - Se guardan `FinAnterior` y `FinNuevo`.
5. La siguiente llamada a `obtenerVigente` reactiva el excedente si la empresa estaba en `Gratis` (regla 5 de SPEC 01). No hace falta nada extra.
6. Con `status` `3` o `4` → `Rechazado`.

## Plan de implementación

1. **Migración y entidades.** Crear `005-pagos-flow.sql`, actualizar `schema.sql`, crear `CuentaFlow` y `PagoSuscripcion` y agregar las columnas nuevas a `Pago` y `ConfiguracionEmpresa`. Ejecutar la migración. La app arranca sin errores de TypeORM.
2. **Variables y módulo `flow`.** Documentar las variables en `.env.example`. Crear `src/flow/flow.module.ts`, `cifrado.ts` (con su `.spec.ts`: ida y vuelta, y un authTag alterado falla) y `flow.client.ts` (con su `.spec.ts`: la firma de un caso fijo coincide con el ejemplo de la documentación de Flow). Registrar el módulo en `AppModule`.
3. **Cuentas Flow.** `CuentasFlowService` (guardar, borrar, listar enmascarado, `resolver`) y `CuentasFlowController` en `/configuracion-empresa/flow`. Prueba manual: guardar una cuenta y ver `apiKeyFinal`, sin `secretKey`.
4. **Cálculo y configuración del anticipo.** Crear `src/pagos/abonos.ts` con `calcularAbono` y su `.spec.ts` (los tres tipos, tope, redondeo, mínimo, precio 0). Agregar `pagoObligatorio` y `@IsIn` en los DTO de configuración, más las validaciones de plan y de cuentas en `ConfiguracionEmpresaService.update`.
5. **Datos públicos.** Agregar `pagoOnline` en `getEmpresaBySlug` y `abono` en `getServiciosByEmpresa`.
6. **Inicio del abono.** Crear `AbonosService.iniciar` y conectarlo a `createReserva`: estado `Pendiente`, `Pago` `Pendiente`, `crearPago`, el fallback del paso 7 y `pagarAhora` en `CreateReservaDto`. Los correos se postergan cuando hay cobro.
7. **Confirmación del abono.** `AbonosService.procesarToken(token)` con idempotencia y pago tardío. Agregar `PagosFlowController` con `/flow/abono/confirmacion` y `/flow/abono/retorno`. Pruebas unitarias en `pagos.service.spec.ts` o un `abonos.service.spec.ts` nuevo: pagado, rechazado, doble confirmación y pago tardío con la hora libre y tomada.
8. **Anulación perezosa.** `anularVencidos` y sus llamadas en los cuatro puntos. Agregar `GET /reservar/reservas/:codigo/pago`.
9. **Mensualidad.** `SuscripcionesService.extenderPro` (con prueba unitaria de la regla de base), `PagosSuscripcionService` (iniciar, procesar token) y los endpoints `POST /suscripcion/pagar`, `GET /suscripcion/pagos`, `/flow/suscripcion/confirmacion` y `/flow/suscripcion/retorno`.
10. **Prueba en sandbox.** Con un túnel en `API_PUBLIC_URL`, pagar una mensualidad y un abono con las tarjetas de prueba de Flow. Confirmar `FLOW_MONTO_MINIMO` y ajustarlo si cambió.

## Criterios de aceptación

- [ ] La migración `005` se puede ejecutar dos veces sin error.
- [ ] Un `TipoAnticipo` no válido queda en `NULL` con `PermitePagoAnticipado = 0` después de la migración.
- [ ] `calcularAbono(10000, Monto 15000)` = `10000`, `calcularAbono(9990, Porcentaje 30)` = `2997` y `calcularAbono(10000, Completo)` = `10000`.
- [ ] Un abono calculado menor que `FLOW_MONTO_MINIMO` devuelve `null`.
- [ ] `PUT /configuracion-empresa` con `PermitePagoAnticipado = true` y sin `TipoAnticipo` → `400`.
- [ ] `PUT /configuracion-empresa` con `Porcentaje` y `MontoAnticipo = 120` → `400`.
- [ ] En `Gratis`, activar `PermitePagoAnticipado` → `403` con `code: "SUSCRIPCION_LIMITE"` y `recurso: "pagosOnline"`.
- [ ] Activar el anticipo con una sucursal activa sin cuenta propia ni de empresa → `400` que nombra esa sucursal.
- [ ] `GET /configuracion-empresa/flow` nunca incluye la `secretKey`. En la BD, `SecretKeyCifrada` no contiene la clave en claro.
- [ ] Una sucursal sin cuenta propia usa la de la empresa. Con cuenta propia, el `Pago` guarda el `CuentaFlowId` de la sucursal.
- [ ] Con anticipo obligatorio, `POST /reservar` responde `estado: "Pendiente"` y `pago.urlPago`. La reserva queda `Pendiente` y el `Pago` `Pendiente`.
- [ ] Con anticipo obligatorio y sin `clienteEmail` → `400`.
- [ ] Con `PagoObligatorio = 0` y sin `pagarAhora`, la reserva queda `Programada` y `pago: null`.
- [ ] Mientras la reserva está `Pendiente`, `GET /reservar/ocupacion/:sucursalId` muestra la hora como ocupada.
- [ ] Mientras la reserva está `Pendiente`, no se envía ningún correo.
- [ ] Pasados 15 minutos sin confirmación, la siguiente llamada a la ocupación anula la reserva, libera la hora y marca el pago `Rechazado`.
- [ ] Confirmar con `status 2` deja la reserva `Programada` y el pago `Pagado`, y dispara los correos de SPEC 02 una sola vez aunque Flow llame dos veces.
- [ ] Confirmar con `status 3` deja la reserva `Anulado` y el pago `Rechazado`.
- [ ] Un webhook con un token desconocido → `404`. Un `amount` distinto al guardado no cambia nada y se loguea.
- [ ] `POST /flow/abono/retorno` redirige con `303` a `FRONT_URL/reserva/pago?codigo=...`.
- [ ] Si `crearPago` falla, la reserva queda `Programada`, los correos se envían y la respuesta trae `pago: null`.
- [ ] En `Gratis`, con la configuración de anticipo activa de antes, `POST /reservar` crea la reserva sin pago.
- [ ] `POST /suscripcion/pagar` devuelve `urlPago`. Con Pro sin vencimiento → `409`. Sin `FLOW_API_KEY` → `503`.
- [ ] Pagar la mensualidad con Pro que vence en 5 días deja `FechaFin` 35 días adelante. Pagar desde `Gratis` deja `Plan = 'Pro'` y `FechaFin` en 30 días, y reactiva el excedente.
- [ ] Una doble confirmación de la mensualidad extiende una sola vez.
- [ ] `GET /suscripcion/pagos` lista el pago con `finNuevo`.
- [ ] Sin `FLOW_CREDENCIALES_KEY`, la API arranca, `PUT /configuracion-empresa/flow/empresa` → `503` y las reservas se crean sin pago.
- [ ] `npm run test` y `npm run build` pasan.
- [ ] Prueba manual en sandbox de Flow de ambos flujos.

## Decisiones

- **Sí:** la mensualidad es un pago único que suma 30 días. Reusa la regla de SPEC 01 y no necesita guardar tarjetas.
- **No:** suscripción recurrente de Flow. Agrega registro de tarjeta, cobros fallidos y cancelación. Va en otro spec.
- **Sí:** cuenta Flow por empresa con override por sucursal. Cubre locales con la misma cuenta y con cuentas distintas sin copiar credenciales.
- **Sí:** baja lógica de las cuentas Flow (`FechaBaja`), también al reemplazarlas. Un `DELETE` físico fallaría por `FK_Pago_CuentaFlow`, y los pagos en curso o tardíos se deben verificar con las credenciales que los firmaron. Se decidió durante la implementación (paso 3).
- **No:** borrado físico desvinculando los pagos. Un cliente que ya pagó vería su reserva anulada por no poder verificar el pago.
- **Sí:** el back firma cada cobro con las credenciales del comercio que recibe el dinero. Flow no tiene split de pagos entre comercios.
- **Sí:** `secretKey` cifrada con AES-256-GCM y una clave de entorno. Un volcado de la BD no expone las cuentas de los locales.
- **No:** validar las credenciales contra Flow al guardarlas. Flow no tiene un endpoint de verificación sin efectos. Una credencial mala se detecta en el primer cobro y cae al fallback.
- **Sí:** la reserva se crea `Pendiente` y retiene la hora 15 minutos. Evita que otro cliente tome la hora mientras se paga.
- **No:** crear la reserva solo al confirmarse el pago. La hora podría estar tomada y habría que reembolsar.
- **Sí:** el mismo valor de 15 minutos se pasa como `timeout` a Flow, para que el link de pago expire junto con la retención.
- **Sí:** anulación perezosa, sin cron. Es coherente con SPEC 01 y sin dependencias nuevas.
- **Sí:** `PagoObligatorio` configurable por empresa. Si es opcional, el cliente decide con `pagarAhora`.
- **Sí:** el monto fijo tiene tope en el precio del servicio y el porcentaje se redondea hacia arriba a pesos enteros.
- **Sí:** los pagos online son solo para `Prueba` y `Pro`. Es un incentivo para pagar Pro.
- **Sí:** si falta la cuenta Flow o Flow falla, la reserva se crea sin pago. El local no pierde clientes por un problema de configuración.
- **Sí:** los correos de reserva nueva salen al confirmarse el pago. No se avisa de reservas que nunca se pagaron.
- **Sí:** los abonos reusan `dbo.Pago`, que ya está ligado a `Reserva` y tiene estados de pago. La mensualidad va en `dbo.PagoSuscripcion` porque no tiene reserva.
- **No:** una tabla única `PagoFlow` para ambos. Duplica `dbo.Pago` y mezcla dos dueños del dinero.
- **Sí:** los webhooks consultan `getStatus` y no confían en el body. Es lo que exige Flow y evita confirmaciones falsas.
- **Sí:** el retorno pasa por el back y redirige con `303`. Flow envía un POST al retorno, que una SPA no puede recibir.
- **Sí:** la transición de estado es un `UPDATE` condicional. Confirmación y retorno pueden llegar a la vez, y así los correos y la extensión ocurren una sola vez.
- **No:** reembolsos por API. El local los hace desde Flow y marca `Reembolsado` en el panel.
- **Sí:** el precio de Pro es una constante en código (`PRECIO_PRO_CLP`). Hay un solo precio y cambiarlo es un deploy.

## Riesgos

| Riesgo | Mitigación |
| --- | --- |
| Se pierde o cambia `FLOW_CREDENCIALES_KEY` | Las cuentas no se pueden descifrar. Los cobros fallan y caen al fallback sin pago. Documentado en `.env.example`: hay que volver a cargar las cuentas. |
| Flow confirma después de anular la reserva | Regla de pago tardío: se reactiva si la hora sigue libre. Si no, error en el log para reembolso manual. |
| En local, Flow no alcanza los webhooks | `API_PUBLIC_URL` con un túnel. El retorno también procesa el token, así que el resultado se ve aunque la confirmación no llegue. |
| Un atacante llama al webhook con un token ajeno | Solo se aceptan tokens guardados. El estado se consulta a Flow con la `secretKey` del comercio y se comparan monto y orden. |
| Un cliente reserva y no paga para bloquear horas | La retención dura 15 minutos y el throttling global limita las peticiones. Se acepta con el volumen actual. |
| Cambió el mínimo de Flow | `FLOW_MONTO_MINIMO` se confirma en el paso 10 del plan. Bajo el mínimo no se cobra. |
| La empresa borra su cuenta con el anticipo activo | Sus reservas se crean sin pago y se loguea un warning. El panel muestra las sucursales sin cuenta en `GET /configuracion-empresa/flow`. |
| `PATCH /reservar/reservas/:id/estado` es público (SPEC 02) | No se agrava aquí, pero alguien podría pasar una reserva `Pendiente` a `Programada` sin pagar. Queda anotado para el spec que proteja ese endpoint. |

## Prompt para el front

> Implementa los pagos con Flow de AgendaFlow (SPEC 06 del back). El back ya expone todo; no llames a Flow directamente.
>
> **1. Mensualidad Pro (panel, admin).**
> - En la pantalla de plan/suscripción agrega el botón "Pagar Pro – $19.990 / 30 días". Al pulsarlo, llama a `POST /suscripcion/pagar` y redirige con `window.location.href = urlPago`.
> - Si responde `409`, muestra "Tu plan Pro no tiene vencimiento". Si responde `503`, muestra "Pagos no disponibles por ahora" y oculta el botón. Si responde `502`, muestra "No pudimos conectar con Flow, inténtalo de nuevo" y deja el botón activo.
> - Crea la ruta `/suscripcion/pago`, que recibe `?estado=pagado|rechazado|pendiente`. Si es `pagado`: "¡Listo! Tu plan Pro se extendió 30 días", recarga `GET /suscripcion` y vuelve al panel. Si es `rechazado`: "El pago no se completó" con el botón para reintentar. Si es `pendiente`: "Estamos confirmando tu pago"; reconsulta `GET /suscripcion` cada 5 s, hasta 1 minuto.
> - Muestra el historial con `GET /suscripcion/pagos` (fecha, monto, estado con su color y "Pro hasta {finNuevo}").
> - En el banner de vencimiento de SPEC 01, cambia "Contáctanos" por un botón que inicie el pago.
>
> **2. Cuentas Flow del negocio (panel, admin, Configuración → Pagos).**
> - Carga `GET /configuracion-empresa/flow`. Arriba va la "Cuenta Flow del negocio" (estado configurada / no configurada, `••••{apiKeyFinal}`) con un formulario de API Key y Secret Key (input de tipo password) → `PUT /configuracion-empresa/flow/empresa`, y un botón "Quitar" → `DELETE`.
> - Debajo, una fila por sucursal con "Usa la cuenta del negocio" o "Cuenta propia ••••xxxx", más las acciones "Usar cuenta propia" (mismo formulario → `PUT /configuracion-empresa/flow/sucursales/:id`) y "Volver a la cuenta del negocio" (`DELETE`).
> - Destaca en rojo las sucursales activas sin cuenta (`!cuentaPropia && !usaCuentaEmpresa`).
> - Agrega un enlace de ayuda: "Encuentra tus llaves en Flow → Mis datos → Integración".
> - Nunca muestres ni guardes la Secret Key después de enviarla.
>
> **3. Configuración del anticipo (panel).**
> - En la configuración de la empresa: switch "Cobrar al reservar" (`permitePagoAnticipado`), selector `tipoAnticipo` con las opciones `Monto` ("Monto fijo"), `Porcentaje` ("Porcentaje del servicio") y `Completo` ("Servicio completo"), y el campo `montoAnticipo`. Ese campo aparece solo en Monto (CLP, entero) y en Porcentaje (1–100, sufijo %).
> - Agrega un switch "El cliente debe pagar para reservar" (`pagoObligatorio`). Si está apagado, el cliente puede elegir pagar en el local.
> - Errores: `403` con `code: "SUSCRIPCION_LIMITE"` y `recurso: "pagosOnline"` → muestra el `message` y un botón "Pagar Pro". `400` → muestra el mensaje (por ejemplo, las sucursales sin cuenta Flow) con un enlace a Configuración → Pagos.
>
> **4. Reserva pública.**
> - `GET /reservar/empresa-slug/:slug` trae `pagoOnline: { activo, obligatorio, tipo, monto }`. Cada servicio de `GET /reservar/servicios/:empresaId` trae `abono` (número o `null`).
> - Si `pagoOnline.activo` y `abono !== null`, muestra en el resumen "Abono a pagar ahora: $X" (o "Pago total: $X" si `tipo === 'Completo'`) y el saldo en el local.
> - Si `!obligatorio`, muestra la opción "Pagar ahora $X" / "Pagar en el local" y envía `pagarAhora: true|false` en `POST /reservar`.
> - Cuando aplica el pago, el email del cliente es obligatorio en el formulario.
> - La respuesta de `POST /reservar` es la fuente de verdad. Si trae `pago` no nulo, muestra "Te llevamos a Flow para pagar. Tu hora queda reservada 15 minutos" y redirige a `pago.urlPago`. Si `pago` es `null`, muestra la confirmación de siempre.
> - Crea la ruta pública `/reserva/pago`, que recibe `?codigo=`. Llama a `GET /reservar/reservas/:codigo/pago`:
>   - `estadoPago` `Pagado` → confirmación de la reserva con el monto pagado.
>   - `Rechazado` → "El pago no se completó y la hora se liberó" con el botón "Volver a reservar" (lleva a la página de la empresa).
>   - `Pendiente` → "Confirmando tu pago…"; reconsulta cada 3 s, hasta 1 minuto, y luego muestra "Te avisaremos por correo cuando se confirme".
> - Errores de `POST /reservar`: `400` → muestra el mensaje; `409` → "La hora ya no está disponible" y recarga la ocupación.
>
> **5. Panel de reservas y pagos.** Las reservas `Pendiente` muestran la etiqueta "Esperando pago". En la lista de pagos, los que tienen `metodoPago === 'Flow'` muestran el ícono de Flow y no se editan a mano, salvo para marcarlos `Reembolsado`.

## Qué **no** entra en este spec

- Cobro recurrente automático de la mensualidad.
- Plan anual u otros precios.
- Reembolsos por la API de Flow.
- Reintentar un pago rechazado sobre la misma reserva.
- Pago online del saldo.
- Comisión de AgendaFlow sobre los abonos.
- Boleta o factura electrónica.
- Correo de "pago recibido" de la mensualidad.
- Cron de anulación.
- Proteger `PATCH /reservar/reservas/:id/estado`.
- Cambios en el código del front.

Cada uno, si se hace, va en su propio spec.
