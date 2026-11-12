# SPEC 07 — Reembolsos con Flow y cancelación pública de reservas

> **Estado:** Aprobado
> **Depende de:** SPEC 02 (correos de reserva), SPEC 04 (tokens de un solo uso guardados como hash), SPEC 06 (abonos con Flow, `CuentaFlow`, webhooks)
> **Fecha:** 2026-11-12
> **Objetivo:** Que el dueño reembolse abonos de Flow desde el panel y que el cliente cancele su reserva desde un enlace del correo, con reembolso del monto neto recibido, si lo hace antes de `TiempoCancelacionHoras`.

## Por qué existe este spec

SPEC 06 dejó los reembolsos fuera: el local devuelve el dinero desde el panel de Flow y marca el pago `Reembolsado` con `PATCH /pagos/:id/estado`. Nada conecta ese estado con lo que hizo Flow, y el cliente no puede cancelar sin escribirle al local.

`ConfiguracionEmpresa.TiempoCancelacionHoras` existe (default `24`), pero nada lo usa.

Flow cobra una comisión sobre cada pago. El local recibe `paymentData.balance` (monto − `fee` − `taxes`), no el monto cobrado. Lo que se devuelve es ese neto.

## Alcance

**Entra:**

- Cliente de Flow para `refund/create` y `refund/getStatus`.
- Tabla nueva `dbo.Reembolso`: varios reembolsos por pago, parciales o totales, con estado propio.
- Columna `Pago.MontoNeto`, guardada al confirmarse el abono.
- **Panel:**
  - `POST /pagos/:id/reembolso`: reembolso total o parcial de un abono Flow `Pagado`, sin plazo. Puede cancelar la reserva con un flag.
  - `GET /pagos/:id/reembolsos`: historial de reembolsos del pago.
  - `PATCH /pagos/:id/estado` rechaza `Reembolsado` en pagos Flow.
- **Cliente:**
  - Token de cancelación aleatorio por reserva (`Reserva.TokenCancelacionHash`). Solo viaja en el correo de confirmación.
  - `GET /reservar/cancelacion/:token` y `POST /reservar/cancelacion/:token`.
  - Se puede cancelar solo una reserva `Programada` y antes del plazo. Si tiene abono Flow `Pagado`, se reembolsa el neto restante. Sin abono, solo se cancela.
  - Si Flow no acepta la solicitud de reembolso, la reserva no se cancela.
- Webhook `POST /flow/reembolso/confirmacion` y consulta perezosa de los reembolsos pendientes.
- **Correos:**
  - Botón "Cancelar mi reserva" con el plazo en la confirmación al cliente.
  - Aviso al local cuando el cliente cancela.
  - Al cliente: cancelación y reembolso.
  - Al local: reembolso rechazado por Flow.
- Migración `006`.
- Prompt para el front (al final de este documento).

**Fuera de alcance (para specs futuros):**

- Reprogramar la hora desde el enlace público.
- Retener un porcentaje según la anticipación (tramos de política). Dentro del plazo se devuelve todo el neto; fuera del plazo no se cancela online.
- Reembolsar pagos manuales (sin Flow). Siguen con `PATCH /pagos/:id/estado`.
- Reembolso automático del pago tardío sobre una reserva anulada (SPEC 06). El dueño lo hace desde el panel.
- Reembolsos de la mensualidad Pro.
- Cancelar online una reserva sin email del cliente (no recibe el enlace).
- Cron para refrescar reembolsos pendientes.
- Cambios en el código del front. Aquí solo se entrega el prompt.

## Modelo de datos

### Migración `src/database/migrations/006-reembolsos-flow.sql`

Es idempotente, como las anteriores. Cada bloque va envuelto en `IF OBJECT_ID(...) IS NULL` o `IF COL_LENGTH(...) IS NULL`. El DDL se agrega también a `schema.sql`.

```sql
-- 1. Reembolsos de abonos
CREATE TABLE dbo.Reembolso (
    Id               INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Reembolso PRIMARY KEY,
    PagoId           INT            NOT NULL,
    Monto            DECIMAL(10,2)  NOT NULL,
    Origen           NVARCHAR(10)   NOT NULL,     -- 'Cliente' | 'Panel'
    UsuarioId        INT            NULL,         -- quien lo pidió desde el panel; NULL si fue el cliente
    EstadoId         INT            NOT NULL,     -- Estado tipo 'Pago': Pendiente | Reembolsado | Rechazado
    FlowToken        NVARCHAR(100)  NULL,
    FlowRefundOrder  BIGINT         NULL,
    ComisionFlow     DECIMAL(10,2)  NULL,         -- `fee` que informa Flow por el reembolso
    Error            NVARCHAR(500)  NULL,         -- mensaje de Flow si se rechazó
    FechaCreacion    DATETIME2      NOT NULL CONSTRAINT DF_Reembolso_FechaCreacion DEFAULT GETDATE(),
    FechaResolucion  DATETIME2      NULL,
    CONSTRAINT FK_Reembolso_Pago    FOREIGN KEY (PagoId)    REFERENCES dbo.Pago(Id),
    CONSTRAINT FK_Reembolso_Usuario FOREIGN KEY (UsuarioId) REFERENCES dbo.Usuario(Id),
    CONSTRAINT FK_Reembolso_Estado  FOREIGN KEY (EstadoId)  REFERENCES dbo.Estado(Id),
    CONSTRAINT CK_Reembolso_Origen  CHECK (Origen IN (N'Cliente', N'Panel'))
);
CREATE UNIQUE INDEX UX_Reembolso_FlowToken ON dbo.Reembolso (FlowToken) WHERE FlowToken IS NOT NULL;
CREATE INDEX IX_Reembolso_PagoId ON dbo.Reembolso (PagoId);

-- 2. Monto neto recibido por el local
ALTER TABLE dbo.Pago ADD MontoNeto DECIMAL(10,2) NULL;  -- paymentData.balance de Flow

-- 3. Token del enlace público de cancelación
ALTER TABLE dbo.Reserva ADD TokenCancelacionHash NVARCHAR(64) NULL;  -- SHA-256 hex
CREATE UNIQUE INDEX UX_Reserva_TokenCancelacionHash ON dbo.Reserva (TokenCancelacionHash)
    WHERE TokenCancelacionHash IS NOT NULL;
```

Los estados del reembolso reusan los de tipo `Pago` (`Pendiente`, `Reembolsado`, `Rechazado`). No se agregan estados nuevos.

### Entidades

- `src/pagos/entities/reembolso.entity.ts` → `Reembolso`: `id`, `pagoId`, `monto`, `origen: 'Cliente' | 'Panel'`, `usuarioId: number | null`, `estado: Estado`, `flowToken`, `flowRefundOrder`, `comisionFlow`, `error`, `fechaCreacion`, `fechaResolucion`.
- `Pago` gana `montoNeto?: number | null` y la relación `reembolsos: Reembolso[]`.
- `Reserva` gana `tokenCancelacionHash?: string | null` (`select: false`).

### Constantes

```ts
// reservas/cancelacion.ts
export const ZONA_HORARIA_NEGOCIO = 'America/Santiago';
```

### Monto reembolsable

`reembolsable(pago) = MontoNeto − Σ Monto de sus reembolsos en Pendiente o Reembolsado`.

- Los reembolsos `Rechazado` no cuentan: el monto vuelve a estar disponible.
- El `Pago` pasa a `Reembolsado` cuando la suma de sus reembolsos `Reembolsado` llega a `MontoNeto`. Con reembolsos parciales queda `Pagado`.
- Los montos son pesos enteros.

**Origen del `MontoNeto`:**

- `AbonosService.confirmarPagado` lo guarda desde `paymentData.balance` de `payment/getStatus`.
- Si es `NULL` al reembolsar (pagos confirmados antes de la migración `006`), se consulta `payment/getStatus` con la cuenta que firmó el cobro y se guarda.
- Si Flow no informa `balance`, el reembolso responde `502` y no se crea nada.

### Plazo de cancelación

`limiteCancelacion(fecha, horaInicio, horas): Date` en `src/reservas/cancelacion.ts`. Es una función pura.

- Interpreta `Fecha` + `HoraInicio` como hora local de `America/Santiago`, con su cambio de horario, y le resta `TiempoCancelacionHoras`.
- Con `TiempoCancelacionHoras = 0` se puede cancelar hasta el inicio.
- `puedeCancelar = ahora < limite` y la reserva está `Programada`.

### Cliente de Flow

Se agrega a `src/flow/flow.client.ts`, con la misma firma de SPEC 06:

- `crearReembolso(credenciales, { refundCommerceOrder, receiverEmail, amount, urlCallBack, commerceTrxId })` → `POST {FLOW_API_URL}/refund/create` → `{ token, flowRefundOrder, status, amount, fee }`.
- `estadoReembolso(credenciales, token)` → `GET {FLOW_API_URL}/refund/getStatus` → `{ status, amount, fee, flowRefundOrder }`.
- Estados de Flow: `created`, `accepted`, `rejected`, `refunded`, `canceled`.
- `refundCommerceOrder` es `RF-{Reembolso.Id}`. `commerceTrxId` es el `commerceOrder` del abono (`R-{Pago.Id}`). `receiverEmail` es el email del cliente.
- Las credenciales son las de `Pago.CuentaFlowId`, aunque la cuenta esté dada de baja.

Mapeo al estado del `Reembolso`:

| Flow | `Reembolso` |
| --- | --- |
| `created`, `accepted` | `Pendiente` (sin cambios) |
| `refunded` | `Reembolsado` |
| `rejected`, `canceled` | `Rechazado` |

### Flujo de un reembolso

`ReembolsosService.solicitar({ pagoId, monto, origen, usuarioId })` en `src/pagos/reembolsos.service.ts`:

1. En una transacción con bloqueo de la fila del `Pago` (`UPDLOCK`), se valida que el pago es Flow (`CuentaFlowId` no nulo) y está `Pagado`. Se calcula `reembolsable` y se valida el monto. Se inserta el `Reembolso` `Pendiente`, que reserva el monto. Dos solicitudes simultáneas no pueden pasar del neto.
2. Después del commit se llama `crearReembolso`.
3. Si Flow falla o responde `rejected` → el `Reembolso` queda `Rechazado` con `Error`, y se lanza `502` con el mensaje de Flow.
4. Si Flow acepta → se guardan `FlowToken`, `FlowRefundOrder` y `ComisionFlow`, y se aplica el mapeo. Una respuesta `refunded` inmediata cierra el reembolso.
5. Al pasar a `Reembolsado` se recalcula si el `Pago` queda `Reembolsado`.

**Confirmación:** `POST /flow/reembolso/confirmacion` (público, `@SkipThrottle()`, body form-urlencoded con `token`):

- Busca el `Reembolso` por `FlowToken`. Un token desconocido responde `404`.
- Consulta `refund/getStatus` con la cuenta del pago y no confía en el body.
- La transición se hace con `UPDATE ... WHERE EstadoId = <Pendiente>`. Si no afecta filas, otro proceso ya la hizo.
- Al pasar a `Rechazado` se envía el correo "reembolso rechazado" al local, una sola vez. La reserva no cambia.

**Consulta perezosa:** `ReembolsosService.refrescarPendientes(pagoId)` consulta `refund/getStatus` de los reembolsos `Pendiente` con `FlowToken`. Se llama al inicio de `GET /pagos/:id/reembolsos`. Cubre el caso en que el callback no llega.

### Endpoints

**Panel (JWT, rol 1):**

| Método y ruta | Descripción |
| --- | --- |
| `POST /pagos/:id/reembolso` | Body `{ monto?: number, cancelarReserva?: boolean }`. `monto` es un entero entre `1` y el reembolsable; si se omite, se devuelve todo el reembolsable. `cancelarReserva` es `false` por defecto. Responde `201 { reembolso: { id, monto, estado }, reserva: { estado } }`. Errores: `404` si el pago no existe, `403` si es de otra empresa, `400` si no es Flow, no está `Pagado`, el reembolsable es `0` o el monto está fuera de rango, y `502` si Flow no acepta (la reserva no cambia). |
| `GET /pagos/:id/reembolsos` | Refresca los pendientes y lista `id`, `monto`, `origen`, `estado`, `comisionFlow`, `error`, `fechaCreacion`, `fechaResolucion`. Más reciente primero. |
| `GET /pagos?sucursalId=` | Cada pago agrega `montoNeto` y `montoReembolsado` (suma de los `Reembolsado`). |
| `PATCH /pagos/:id/estado` | Con estado `Reembolsado` sobre un pago con `CuentaFlowId` → `400 "Los pagos con Flow se reembolsan con POST /pagos/:id/reembolso"`. Los pagos manuales siguen igual. |

Con `cancelarReserva = true`, la reserva pasa a `Cancelada` solo si Flow aceptó. Si ya está `Cancelada` o `Anulado` (pago tardío de SPEC 06), el flag no hace nada. El reembolso desde el panel no depende del plan vigente ni del plazo.

**Públicos** (`@Throttle({ default: { limit: 10, ttl: 60_000 } })`):

| Método y ruta | Descripción |
| --- | --- |
| `GET /reservar/cancelacion/:token` | `{ reserva: { fecha, horaInicio, servicio, sucursal, empresa, estado }, puedeCancelar, motivo, limite, plazoHoras, reembolso: { monto } \| null }`. `motivo` es `null` o uno de `FUERA_DE_PLAZO`, `YA_CANCELADA`, `NO_CANCELABLE`. `reembolso.monto` es el reembolsable actual. `404` si el token no existe. No devuelve datos del cliente. |
| `POST /reservar/cancelacion/:token` | Cancela. `200 { estado: 'Cancelada', reembolso: { monto, estado } \| null }`. `404` si el token no existe. `409` con `motivo` si no se puede cancelar. `502` si Flow no acepta el reembolso (la reserva sigue `Programada`). |

El token se busca por `SHA-256(token)` contra `TokenCancelacionHash`. Sigue sirviendo después de cancelar, para que `GET` muestre `YA_CANCELADA`.

### Flujo de la cancelación pública

1. Se valida el token, que la reserva esté `Programada` y que `ahora < limiteCancelacion`. Si no, `409`.
2. Si la reserva tiene un `Pago` Flow `Pagado` con reembolsable `> 0` → `solicitar({ origen: 'Cliente', monto: reembolsable })`. Si lanza `502`, se termina sin cancelar.
3. La reserva pasa a `Cancelada` con `UPDATE ... WHERE EstadoId = <Programada>`. Si no afecta filas (doble clic), responde `409 YA_CANCELADA`. El reembolso ya creado por la otra petición es el único: el paso 1 del flujo de reembolso bloquea el pago y la segunda petición encuentra reembolsable `0`.
4. Se envían el correo al cliente (cancelación y, si aplica, reembolso) y el aviso al local.
5. Si Flow después rechaza el reembolso, la reserva queda `Cancelada`, el local recibe el correo de rechazo y el dueño reintenta desde el panel.

### Token de cancelación

- Se genera con `generarToken()` de `src/auth/token-cuenta.ts` al enviar la confirmación al cliente en `ReservaCorreosService.notificarNuevaReserva`. Se guarda solo el hash.
- La URL es `` `${FRONT_URL}/reserva/cancelar?token=${token}` ``. Nunca se escribe en el log.
- Sin `clienteEmail` no se genera token.
- Si la confirmación se vuelve a enviar (pago tardío de SPEC 06), se genera un token nuevo y el anterior deja de servir.

### Correos

| Plantilla | Destino | Cuándo |
| --- | --- | --- |
| `reserva-confirmada-cliente.ts` (cambia) | Cliente | Reemplaza "responde este correo o contacta a {local}" por el botón "Cancelar mi reserva" y el texto "Puedes cancelar online hasta el {limite}". Si el plazo ya pasó al enviarlo, no muestra el botón. |
| `cancelacion-cliente.ts` (nueva) | Cliente | Al cancelar desde el enlace, y al reembolsar desde el panel. Variantes: cancelada sin reembolso, cancelada con reembolso de $X y reembolso de $X sin cancelar. Indica que Flow procesa la devolución y puede tardar algunos días hábiles. |
| `estado-reserva-empleado.ts` (se reusa) | Local | Cuando el cliente cancela desde el enlace. |
| `reembolso-rechazado-interno.ts` (nueva) | Local (`resolverEmailEmpresa`) | Cuando un reembolso pasa a `Rechazado` después de aceptado. Incluye monto, reserva, error de Flow y el enlace al panel de pagos. |

Los envíos siguen la regla de SPEC 02: un fallo de Resend se loguea y no revierte nada.

## Plan de implementación

1. **Migración y entidades.** Crear `006-reembolsos-flow.sql`, actualizar `schema.sql`, crear `Reembolso` y agregar `MontoNeto` a `Pago` y `TokenCancelacionHash` a `Reserva`. Ejecutar la migración. La app arranca sin errores de TypeORM.
2. **Cliente de Flow.** `crearReembolso` y `estadoReembolso` en `flow.client.ts`, con casos en `flow.client.spec.ts` (parámetros firmados y parseo de la respuesta).
3. **Monto neto.** Guardar `paymentData.balance` en `AbonosService.confirmarPagado`. Agregar el helper que lo obtiene de Flow si falta. Prueba unitaria en `abonos.service.spec.ts`.
4. **Plazo.** `src/reservas/cancelacion.ts` con `limiteCancelacion` y su `.spec.ts`: 24 h, 0 h, una fecha en horario de verano y otra en horario de invierno de Chile.
5. **Servicio de reembolsos.** `ReembolsosService` (`solicitar`, `procesarToken`, `refrescarPendientes`) y el webhook `/flow/reembolso/confirmacion` en `PagosFlowController`. Pruebas en `reembolsos.service.spec.ts`: total, parcial, monto mayor al reembolsable, Flow falla, `refunded` inmediato, callback `rejected` y doble callback.
6. **Panel.** `POST /pagos/:id/reembolso`, `GET /pagos/:id/reembolsos`, `montoNeto` y `montoReembolsado` en `GET /pagos`, y el bloqueo de `Reembolsado` en `PATCH /pagos/:id/estado`.
7. **Token en la confirmación.** Generar y guardar el hash en `notificarNuevaReserva`, y el botón y el plazo en `reserva-confirmada-cliente.ts`. Actualizar `plantillas.spec.ts`.
8. **Cancelación pública.** `GET` y `POST /reservar/cancelacion/:token` en `ReservarController`, con la lógica en `ReservarService` o un `CancelacionService` en `src/reservar/`. Pruebas: dentro y fuera del plazo, sin abono, con abono, Flow falla y doble cancelación.
9. **Correos nuevos.** `cancelacion-cliente.ts`, `reembolso-rechazado-interno.ts` y sus llamadas desde la cancelación, el reembolso del panel y el webhook.
10. **Prueba en sandbox.** Con un túnel en `API_PUBLIC_URL`: pagar un abono, cancelar desde el enlace y verificar el callback. Reembolsar parcialmente desde el panel. Confirmar los nombres de los parámetros y estados de `refund/create` y `refund/getStatus` y si Flow descuenta una comisión por reembolso. Ajustar el spec si algo difiere.

## Criterios de aceptación

- [ ] La migración `006` se puede ejecutar dos veces sin error.
- [ ] Al confirmarse un abono, `Pago.MontoNeto` queda con `paymentData.balance`.
- [ ] Un pago confirmado antes de `006` (`MontoNeto` nulo) obtiene el neto de Flow al reembolsarlo.
- [ ] `limiteCancelacion('2026-12-10', '15:00', 24)` es el 2026-12-09 a las 15:00 hora de Chile. Con `0` horas es el inicio de la reserva.
- [ ] El correo de confirmación al cliente trae el botón "Cancelar mi reserva" con el plazo. En la BD solo queda el hash del token.
- [ ] `GET /reservar/cancelacion/:token` con un token inválido → `404`. Con uno válido no devuelve email ni teléfono del cliente.
- [ ] Dentro del plazo, `POST /reservar/cancelacion/:token` deja la reserva `Cancelada`, crea un `Reembolso` `Origen = 'Cliente'` por el neto y envía el correo al cliente y el aviso al local.
- [ ] Una reserva sin abono se cancela desde el enlace sin crear `Reembolso`.
- [ ] Fuera del plazo → `409` con `motivo: "FUERA_DE_PLAZO"` y la reserva no cambia.
- [ ] Si `refund/create` falla, la cancelación pública responde `502`, la reserva sigue `Programada` y el `Reembolso` queda `Rechazado` con `Error`.
- [ ] Dos `POST` simultáneos de cancelación crean un solo `Reembolso`.
- [ ] El callback con `refunded` deja el `Reembolso` `Reembolsado`. Si cubre todo el neto, el `Pago` queda `Reembolsado`.
- [ ] El callback con `rejected` deja el `Reembolso` `Rechazado`, la reserva `Cancelada` y envía el correo al local una sola vez aunque Flow llame dos veces.
- [ ] Un callback con un token desconocido → `404`.
- [ ] `POST /pagos/:id/reembolso` sin `monto` devuelve todo el reembolsable. Con un `monto` mayor → `400`.
- [ ] Dos reembolsos parciales que suman el neto dejan el `Pago` `Reembolsado`. Un tercero → `400`.
- [ ] `POST /pagos/:id/reembolso` con `cancelarReserva: true` deja la reserva `Cancelada`. Sin el flag, la reserva no cambia.
- [ ] `POST /pagos/:id/reembolso` de otra empresa → `403`. Sobre un pago manual → `400`.
- [ ] Se puede reembolsar el pago tardío de una reserva `Anulado`.
- [ ] `PATCH /pagos/:id/estado` a `Reembolsado` sobre un pago Flow → `400`. Sobre un pago manual sigue funcionando.
- [ ] `GET /pagos/:id/reembolsos` actualiza un reembolso `Pendiente` cuyo callback no llegó.
- [ ] `npm run test` y `npm run build` pasan.
- [ ] Prueba manual en sandbox de Flow: cancelación pública con reembolso y reembolso parcial desde el panel.

## Decisiones

- **Sí:** se reembolsa el neto que llegó al local (`paymentData.balance`), no el monto cobrado. La comisión de Flow ya se descontó y el local no puede devolver dinero que no recibió.
- **Sí:** guardar `MontoNeto` al confirmar el pago, con consulta a Flow como respaldo. Evita una llamada extra en cada reembolso y cubre los pagos anteriores a `006`.
- **Sí:** fuera del plazo no se cancela online. El cliente contacta al local. Evita cancelaciones de último minuto sin reembolso que el cliente no entienda.
- **No:** cancelar fuera del plazo sin reembolso, o retener un porcentaje. Agrega configuración y casos que no se pidieron.
- **Sí:** las reservas sin abono también se cancelan desde el enlace. Es el mismo flujo sin el reembolso y libera horas.
- **Sí:** token aleatorio propio, guardado como hash. El `Codigo` UUID ya aparece en la URL de `/reserva/pago` (SPEC 06) y no debería bastar para cancelar.
- **Sí:** el token se genera al enviar la confirmación. Es el único momento en que existe en claro, y no hace falta guardarlo.
- **Sí:** tabla `dbo.Reembolso`. Permite varios parciales, guarda el estado asíncrono de Flow y deja auditoría de quién reembolsó.
- **No:** columnas de reembolso en `dbo.Pago`. Solo admitirían un reembolso por pago.
- **Sí:** reusar los estados de tipo `Pago` para el reembolso. Cubren `Pendiente`, `Reembolsado` y `Rechazado` sin tocar `dbo.Estado`.
- **Sí:** si Flow no acepta la solicitud, la reserva del cliente no se cancela. El cliente no pierde la hora sin recibir el dinero.
- **Sí:** la reserva se cancela cuando Flow acepta la solicitud, sin esperar `refunded`. Retener la hora días hasta el callback complica la ocupación. Si Flow rechaza después, el local recibe un correo y reintenta desde el panel.
- **Sí:** el `Reembolso` `Pendiente` se inserta antes de llamar a Flow, con bloqueo del pago. Reserva el monto y evita que dos peticiones reembolsen más que el neto.
- **Sí:** el dueño reembolsa total o parcial, sin plazo, y elige si cancela la reserva. Cubre compensaciones parciales y el pago tardío.
- **Sí:** se bloquea marcar `Reembolsado` a mano en pagos Flow. Ese estado lo calcula el back con los reembolsos, y marcarlo a mano permitiría un doble reembolso.
- **Sí:** el reembolso no depende del plan vigente. Una empresa que pasó a `Gratis` debe poder devolver el dinero que recibió.
- **Sí:** se usan las credenciales de la cuenta que firmó el cobro, aunque esté dada de baja. Es la misma regla de SPEC 06 y es la cuenta que tiene el dinero.
- **Sí:** consulta perezosa de los reembolsos pendientes al ver el historial, sin cron. Es coherente con SPEC 01 y SPEC 06.
- **Sí:** el plazo se calcula en `America/Santiago`. `Fecha` y `HoraInicio` se guardan como hora local del negocio, y Flow opera solo en Chile.

## Riesgos

| Riesgo | Mitigación |
| --- | --- |
| El local no tiene saldo en Flow para reembolsar | `refund/create` falla: la cancelación pública responde `502` y la reserva no cambia. El front muestra "contacta al local". |
| Flow rechaza el reembolso después de aceptarlo | La reserva ya está cancelada. Correo al local y reintento desde el panel. El reembolso rechazado libera su monto. |
| Los nombres de los parámetros o estados de `refund/*` difieren de los supuestos | Se confirman en el paso 10 del plan contra el sandbox antes de dar el spec por implementado. |
| Flow cobra una comisión por reembolso | Se guarda en `ComisionFlow` y se muestra en el historial. No cambia el monto devuelto al cliente. |
| El callback de Flow no llega | `GET /pagos/:id/reembolsos` consulta el estado. Si nadie lo abre, el reembolso queda `Pendiente` en la BD, pero Flow igual lo procesa. |
| Se filtra el enlace de cancelación | Solo cancela dentro del plazo, no muestra datos del cliente y el reembolso va al email del pagador, no a quien abre el enlace. |
| Fuerza bruta sobre tokens | 32 bytes aleatorios y throttling de 10 peticiones por minuto. |
| El cambio de horario de Chile corre el plazo una hora | `limiteCancelacion` usa la zona `America/Santiago` y tiene pruebas en ambos horarios. |

## Prompt para el front

> Implementa los reembolsos y la cancelación pública de AgendaFlow (SPEC 07 del back). No llames a Flow directamente.
>
> **1. Cancelación pública.**
> - Crea la ruta pública `/reserva/cancelar`, que recibe `?token=`. Llama a `GET /reservar/cancelacion/:token`.
> - Muestra el resumen de la reserva (empresa, sucursal, servicio, fecha y hora) y el plazo: "Puedes cancelar online hasta el {limite}".
> - Si `puedeCancelar`, muestra el botón "Cancelar mi reserva". Si `reembolso` no es nulo, agrega "Te devolveremos ${monto}" con la nota "Es el monto que recibió el local, descontada la comisión de Flow". Pide confirmación antes de llamar a `POST /reservar/cancelacion/:token`.
> - Según `motivo`: `FUERA_DE_PLAZO` → "Ya no puedes cancelar online. Contacta a {empresa}". `YA_CANCELADA` → "Esta reserva ya está cancelada". `NO_CANCELABLE` → "Esta reserva no se puede cancelar online".
> - Respuesta `200` → "Tu reserva fue cancelada" y, si trae `reembolso`, "Flow procesará la devolución de ${monto}; puede tardar algunos días hábiles". `409` → muestra el mensaje según `motivo`. `502` → "No pudimos procesar el reembolso. Tu reserva sigue activa; contacta a {empresa}". `404` → "El enlace no es válido". `429` → "Demasiados intentos".
>
> **2. Reembolsos en el panel (admin, pagos).**
> - En la lista de pagos, los pagos Flow `Pagado` muestran el botón "Reembolsar" y, si `montoReembolsado > 0`, "Reembolsado ${montoReembolsado} de ${montoNeto}".
> - El botón abre un diálogo con el monto (por defecto `montoNeto − montoReembolsado`, editable, entero, máximo ese valor), la casilla "Cancelar también la reserva" y la nota "Se devuelve lo que recibiste de Flow, descontada su comisión". Envía `POST /pagos/:id/reembolso { monto, cancelarReserva }`.
> - `201` → "Reembolso solicitado" y recarga la lista. `400` → muestra el mensaje. `502` → "Flow no aceptó el reembolso: {message}. Revisa tu saldo en Flow".
> - Agrega "Ver reembolsos" con `GET /pagos/:id/reembolsos`: fecha, monto, origen ("Cliente" o "Panel"), estado con su color y el error si fue rechazado.
> - Quita la opción de marcar `Reembolsado` a mano en los pagos Flow. En los pagos manuales se mantiene.

## Qué **no** entra en este spec

- Reprogramar la hora desde el enlace público.
- Tramos de reembolso según la anticipación.
- Reembolsos de pagos manuales o de la mensualidad Pro.
- Reembolso automático del pago tardío.
- Cancelación online sin email del cliente.
- Cron de reembolsos pendientes.
- Cambios en el código del front.

Cada uno, si se hace, va en su propio spec.
