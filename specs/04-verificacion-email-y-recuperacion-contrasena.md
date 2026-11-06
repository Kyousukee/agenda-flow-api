# SPEC 04 — Verificación de email y recuperación de contraseña

> **Estado:** Aprobado
> **Depende de:** SPEC 02 (`CorreosService` y layout de correos), SPEC 03 (solo como contexto: límites por IP y puntos pendientes)
> **Fecha:** 2026-11-06
> **Objetivo:** Que el back envíe vía Resend un correo de verificación al registrar un usuario y permita restablecer una contraseña olvidada con un enlace por correo, cerrando las sesiones abiertas de esa cuenta.

## Por qué existe este spec

El registro no comprueba que el email pertenezca a quien lo escribe, un punto pendiente de la auditoría (SPEC 03). Quien olvida su contraseña hoy no puede recuperar la cuenta sin tocar la base de datos. Además, un JWT no se puede revocar y dura hasta 7 días, así que cambiar la contraseña no bastaría para expulsar a un atacante.

## Alcance

**Entra:**

- Solo `POST /auth/register` crea usuarios hoy, así que es el único punto que dispara la verificación.
- Correo de verificación al registrarse, con un enlace válido por 24 horas.
- Una cuenta sin verificar conserva todo el acceso. El front muestra un aviso con `emailVerificado`.
- Reenvío del correo de verificación para el usuario con sesión.
- "Olvidé mi contraseña": correo con un enlace válido por 1 hora, sin revelar si la cuenta existe.
- Restablecer la contraseña: marca el email como verificado y cierra todas las sesiones abiertas. El usuario debe iniciar sesión de nuevo.
- `TokenVersion` en el JWT, comprobada por `JwtAuthGuard` contra la base de datos.
- Límite por usuario y tipo de correo (1 por minuto, 5 por hora), además del límite por IP.
- Enlaces de un solo uso. Solo se guarda su hash SHA-256.
- Correos enviados con Resend, usando el `CorreosService` existente y la marca AgendaFlow.
- Migración `003` que da por verificados a los usuarios existentes.
- Entregar, al terminar el back, el prompt para implementarlo en el front.

**Fuera de alcance (para specs futuros):**

- Cambios en el código del front. Aquí solo se entrega el prompt.
- Bloquear funciones a las cuentas sin verificar.
- Correo de aviso "tu contraseña cambió".
- Cambio de email de una cuenta.
- Cambiar la contraseña desde el panel, conociendo la actual.
- Logout con revocación, refresh tokens o acortar la duración del JWT.
- Rechazar en `JwtAuthGuard` a usuarios con `Activo = 0`.
- Captcha en el registro.
- Crear cuentas de usuario para empleados.

## Modelo de datos

### Columnas nuevas en `dbo.Usuario`

| Columna | Tipo | Uso |
| --- | --- | --- |
| `EmailVerificado` | `BIT NOT NULL DEFAULT 0` | Si el usuario verificó su email |
| `TokenVersion` | `INT NOT NULL DEFAULT 0` | Sube en 1 al restablecer la contraseña |
| `VerificacionTokenHash` | `NVARCHAR(64) NULL` | SHA-256 en hexadecimal del token vigente |
| `VerificacionExpira` | `DATETIME2 NULL` | Vencimiento del token |
| `VerificacionUltimoEnvio` | `DATETIME2 NULL` | Límite de 1 por minuto |
| `VerificacionVentanaInicio` | `DATETIME2 NULL` | Inicio de la ventana de 1 hora |
| `VerificacionEnviosVentana` | `INT NOT NULL DEFAULT 0` | Envíos dentro de la ventana |
| `ResetTokenHash` | `NVARCHAR(64) NULL` | Igual que arriba, para restablecer |
| `ResetExpira` | `DATETIME2 NULL` | Igual que arriba |
| `ResetUltimoEnvio` | `DATETIME2 NULL` | Igual que arriba |
| `ResetVentanaInicio` | `DATETIME2 NULL` | Igual que arriba |
| `ResetEnviosVentana` | `INT NOT NULL DEFAULT 0` | Igual que arriba |

Se agregan dos índices filtrados, sobre `VerificacionTokenHash` y `ResetTokenHash` (`WHERE ... IS NOT NULL`), porque los endpoints públicos buscan por esas columnas.

Reglas:

- Las columnas de hash llevan `select: false` en la entidad `Usuario`.
- Un token nuevo reemplaza al anterior del mismo tipo, y el enlace anterior deja de servir.
- El token es `randomBytes(32)` en hexadecimal. Solo viaja en el correo y nunca se escribe en el log.
- Las fechas se calculan en la app con `new Date()` y se pasan como parámetro, nunca con `GETDATE()`. Así no se mezclan zonas horarias con lo que guarda el driver.
- Consumir un token es un único `UPDATE` condicional (hash, vencimiento y, al restablecer, `Activo = 1`). Solo vale si afectó una fila, para que dos peticiones simultáneas no usen el mismo enlace.

### JWT

`JwtPayload` suma `tokenVersion?: number`. Un token emitido antes del despliegue no la trae y cuenta como `0`, por lo que nadie pierde la sesión al desplegar.

### Variables de entorno (`.env.example`)

```env
# URL pública del front, usada en los enlaces de los correos. Nunca se toma de la petición.
# En producción: https://agendaflow.cl
FRONT_URL=http://localhost:4200
```

Si `FRONT_URL` falta, se usa `http://localhost:4200` y se registra un `warn` al arrancar.

### Contrato de la API

| Método | Ruta | Auth | Límite por IP | Respuesta |
| --- | --- | --- | --- | --- |
| `POST` | `/auth/verificar-email` | No | 5/min | `200 { emailVerificado: true }`, o `400` si el token no sirve |
| `POST` | `/auth/reenviar-verificacion` | JWT | 5/min | `200 { emailVerificado: boolean }` |
| `POST` | `/auth/olvide-contrasena` | No | 5/min | `200 { message }`, siempre igual |
| `POST` | `/auth/restablecer-contrasena` | No | 5/min | `200 { message }`, o `400` si el token no sirve |

Cuerpos:

- `verificar-email`: `{ token: string }`.
- `olvide-contrasena`: `{ email: string }`.
- `restablecer-contrasena`: `{ token: string, password: string }`, con `password` de 8 a 72 caracteres, porque bcrypt ignora lo que pase de 72 bytes.

Comportamiento:

- Token inválido, vencido o ya usado: siempre el mismo `400`, con el mensaje `El enlace no es válido o venció`.
- `reenviar-verificacion` con el email ya verificado devuelve `{ emailVerificado: true }` y no envía nada. Así el front puede quitar el aviso si se verificó en otro dispositivo.
- `reenviar-verificacion` con el límite por usuario superado responde igual (`{ emailVerificado: false }`) y no envía nada.
- `olvide-contrasena` responde antes de buscar al usuario y procesa en segundo plano, para que el tiempo de respuesta no revele si la cuenta existe. No envía nada si el email no existe, si `Activo = 0` o si se superó el límite. Una cuenta sin verificar sí recibe el correo.
- `POST /auth/login` y `POST /auth/register` suman `user.emailVerificado`. Registrarse sigue devolviendo `accessToken`.

Enlaces de los correos:

- `{FRONT_URL}/verificar-email?token=...`
- `{FRONT_URL}/restablecer-contrasena?token=...`

### Límite por usuario

Se aplica por usuario y por tipo de correo, en una función pura de `src/auth/token-cuenta.ts`:

- No se envía si pasó menos de 1 minuto desde `UltimoEnvio`.
- Si pasó más de 1 hora desde `VentanaInicio`, la ventana se reinicia.
- No se envía si la ventana ya tiene 5 envíos.

El correo del registro cuenta como el primer envío de verificación. La escritura es un `UPDATE` condicionado al valor leído de `UltimoEnvio`, para que dos peticiones simultáneas no envíen dos correos.

### Estructura de archivos

```
src/auth/
  auth.controller.ts              # 4 rutas nuevas
  auth.service.ts                 # register y login: emailVerificado y tokenVersion
  cuenta.service.ts               # nuevo: verificar, reenviar, olvidé y restablecer
  token-cuenta.ts                 # nuevo: generar y hashear el token, y evaluar el límite
  token-cuenta.spec.ts            # nuevo
  cuenta.service.spec.ts          # nuevo
  dto/verificar-email.dto.ts      # nuevo
  dto/olvide-contrasena.dto.ts    # nuevo
  dto/restablecer-contrasena.dto.ts # nuevo
  guards/jwt-auth.guard.ts        # compara tokenVersion
  guards/jwt-auth.guard.spec.ts   # nuevo
src/correos/
  cuenta-correos.service.ts       # nuevo: enviarVerificacion y enviarRestablecimiento
  plantillas/layout.ts            # pie opcional y helper botonAccion
  plantillas/verificar-email.ts   # nuevo
  plantillas/restablecer-contrasena.ts # nuevo
src/database/migrations/003-verificacion-y-recuperacion.sql # nuevo
src/database/schema.sql           # columnas e índices nuevos
```

### Plantillas

- Usan `layoutCorreo` con una marca fija: nombre `AgendaFlow`, sin logo, `COLOR_POR_DEFECTO`, sin teléfono ni email.
- Remitente `AgendaFlow <MAIL_FROM>`, sin reply-to.
- `layoutCorreo` y `pieTexto` aceptan un pie opcional. Estas plantillas usan `Este correo fue enviado por AgendaFlow.`, porque el pie actual diría "AgendaFlow a través de AgendaFlow". Los correos de reservas no cambian.
- Asuntos: `Verifica tu email en AgendaFlow` y `Restablece tu contraseña de AgendaFlow`.
- Contenido: saludo con el nombre (escapado), botón con el enlace, el enlace en texto, la vigencia y la frase "Si no fuiste tú, ignora este correo".
- La versión de texto plano incluye el enlace completo.

## Plan de implementación

1. **Migración y esquema.** Crear `003-verificacion-y-recuperacion.sql` (idempotente) y actualizar `schema.sql`. Los usuarios existentes pasan a `EmailVerificado = 1` solo en el bloque que crea la columna, para que repetir la migración no verifique cuentas nuevas. Se prueba dos veces en local.
2. **Entidad y utilidades.** Agregar las columnas a `Usuario`. Crear `token-cuenta.ts` con su test: el hash es determinista, el token no se repite y el límite cubre minuto, ventana y reinicio. Agregar `FRONT_URL` a `.env.example`.
3. **Plantillas.** Agregar el pie opcional, `botonAccion` y las dos plantillas. Sumar a `plantillas.spec.ts`: nombre escapado, enlace presente en HTML y texto, y pie de reservas sin cambios.
4. **`CuentaCorreosService`.** Arma los enlaces con `FRONT_URL`, envía con `CorreosService.enviar()` y se exporta desde `CorreosModule`. Importar `CorreosModule` en `AuthModule`.
5. **Sesiones.** Incluir `tokenVersion` al firmar en `register` y `login`. Cambiar `JwtAuthGuard` para leer `TokenVersion` y responder `401` si el usuario no existe o la versión no coincide. Un error de base de datos debe salir como `500` y no como `401`, así que esa consulta queda fuera del `try/catch` actual. `AuthModule` exporta `TypeOrmModule`, porque el guard se resuelve en los 9 módulos que importan `AuthModule`. Agregar `jwt-auth.guard.spec.ts`.
6. **Verificación en el registro.** Dentro de la transacción de `register`, guardar el hash, el vencimiento y el primer envío. Después del commit, `void` del envío. Agregar `emailVerificado` a las respuestas de `register` y `login`.
7. **Verificar y reenviar.** Crear `CuentaService`, el DTO y las rutas `verificar-email` y `reenviar-verificacion`, con tests.
8. **Olvidé y restablecer.** Agregar los DTO, los métodos y las rutas `olvide-contrasena` y `restablecer-contrasena`. Restablecer actualiza en un solo `UPDATE`: `PasswordHash`, `TokenVersion + 1`, `EmailVerificado = 1`, y limpia los hash y vencimientos de ambos tipos. Agregar tests.
9. **Documentación.** Agregar a `API-SPEC.md` las 4 rutas y `emailVerificado`. Añadir al spec el resultado de la prueba manual con Resend.
10. **Prompt del front.** Entregar en el chat un prompt, escrito a partir del back ya implementado, para el repo `AgendaFlowFront`. Debe incluir:
    - El contrato real de los 4 endpoints.
    - Las páginas `/olvide-contrasena`, `/verificar-email` y `/restablecer-contrasena`, y el enlace desde el login.
    - El aviso para cuentas sin verificar, con botón de reenviar. Solo se muestra si `emailVerificado === false`, porque una sesión guardada antes del despliegue no trae el campo.
    - Actualizar el usuario guardado después de verificar o reenviar.
    - Quitar el token de la URL después de leerlo (`replaceUrl`) y no cargar recursos de terceros en esas páginas.
    - Tras restablecer, ir al login. Un `401` en otra sesión debe llevar al login.
    - Seguir las convenciones de `AGENTS.md` y `DESIGN.md` del front.

## Criterios de aceptación

- [ ] `npm run build` y `npm run test` pasan.
- [ ] Ejecutar la migración `003` marca como verificados a los usuarios existentes.
- [ ] Ejecutar la migración una segunda vez no cambia a un usuario con `EmailVerificado = 0`.
- [ ] `POST /auth/register` responde `201` con `accessToken` y `user.emailVerificado = false`, y llega el correo a nombre de `AgendaFlow` (visible en el dashboard de Resend).
- [ ] Sin `RESEND_API_KEY`, el registro responde `201` y la cuenta queda sin verificar.
- [ ] Una cuenta sin verificar puede iniciar sesión y usar un endpoint protegido.
- [ ] `POST /auth/verificar-email` con un token válido responde `200` y el siguiente login devuelve `emailVerificado = true`.
- [ ] Repetir el mismo token responde `400`.
- [ ] Un token de verificación vencido responde `400`.
- [ ] Un token de verificación usado en `restablecer-contrasena` responde `400`, y al revés también.
- [ ] Reenviar genera un token nuevo y el enlace anterior responde `400`.
- [ ] Reenviar con el email ya verificado devuelve `{ emailVerificado: true }` y no envía correo.
- [ ] `olvide-contrasena` responde el mismo `200` con un email registrado, uno inexistente y una cuenta con `Activo = 0`, y solo la primera recibe correo.
- [ ] Dos solicitudes seguidas para el mismo usuario generan un solo correo.
- [ ] La sexta solicitud dentro de una hora para el mismo usuario y tipo no genera correo.
- [ ] El contador de un tipo no afecta al otro.
- [ ] `restablecer-contrasena` con un token válido permite entrar con la contraseña nueva y rechaza la anterior.
- [ ] Después de restablecer, un JWT emitido antes responde `401` en un endpoint protegido.
- [ ] Después de restablecer, una cuenta que no estaba verificada queda con `emailVerificado = true`.
- [ ] Un JWT sin `tokenVersion` sigue funcionando si la cuenta tiene `TokenVersion = 0`, y responde `401` si tiene `TokenVersion = 1`.
- [ ] Un token de restablecer de una cuenta con `Activo = 0` responde `400`.
- [ ] Una contraseña de menos de 8 o de más de 72 caracteres responde `400`.
- [ ] La base de datos guarda el hash y no el token, y el token no aparece en el log.
- [ ] Si falla la consulta del guard a la base de datos, la respuesta es `500` y no `401`.
- [ ] Un nombre `<b>x</b>` aparece como texto literal en el correo.
- [ ] El enlace del correo usa `FRONT_URL`, aunque la petición traiga otra cabecera `Host`.
- [ ] Los correos de reservas siguen mostrando su pie original.
- [ ] Al terminar el back, se entrega en el chat el prompt del front.

## Decisiones

- **Sí:** acceso completo sin verificar, con aviso en el front. Lo decidió el usuario. Nadie queda fuera si falla un correo.
- **No:** bloquear el login hasta verificar, ni un plazo de gracia. Consecuencia aceptada: la verificación no frena los registros falsos señalados en SPEC 03.
- **Sí:** los usuarios existentes quedan verificados. Lo decidió el usuario, para no molestar a clientes activos.
- **Sí:** cerrar todas las sesiones al restablecer, con `TokenVersion`. Lo decidió el usuario. Cuesta una consulta por petición autenticada.
- **No:** dejar los JWT activos tras el cambio, porque un atacante conservaría el acceso hasta 7 días.
- **Sí:** marca y remitente AgendaFlow, enviados con Resend. Lo decidió el usuario. Además, evita que un nombre de empresa elegido en el registro firme un correo de seguridad.
- **Sí:** vigencia de 24 horas para verificar y 1 hora para restablecer. Lo decidió el usuario.
- **Sí:** columnas en `Usuario`. Lo decidió el usuario, para no sumar una tabla.
- **No:** tabla `TokenUsuario`. Consecuencia aceptada: el límite por usuario necesita 12 columnas nuevas en total y no queda historial de tokens.
- **Sí:** guardar solo el hash SHA-256. El token ya tiene 256 bits aleatorios, así que no necesita bcrypt, y el hash permite buscarlo directamente.
- **Sí:** tras restablecer, volver al login y dejar el email verificado. Lo decidió el usuario. Usar el enlace ya demuestra que controla el buzón.
- **No:** iniciar sesión automáticamente al restablecer, porque bastaría el enlace para entrar.
- **Sí:** límite por usuario y tipo, además del de IP. Lo decidió el usuario, para que nadie inunde de correos a una víctima desde muchas IP.
- **Sí:** `EmailVerificado` como columna propia.
- **No:** el estado `Usuario/Pendiente`. `Estado` describe si la cuenta está activa, y mezclarlo con la verificación afectaría a quien lo consulte.
- **Sí:** `FRONT_URL` desde el entorno. Construir el enlace con la cabecera `Host` permitiría enviar enlaces envenenados.
- **Sí:** el front llama con `POST` a la API, con el token en el cuerpo.
- **No:** un `GET` en la API desde el correo. Un escáner de correo lo consumiría con solo abrirlo.

## Riesgos

| Riesgo | Mitigación |
| --- | --- |
| Con `onboarding@resend.dev`, Resend solo entrega al email de la cuenta, así que nadie más podría recuperar su contraseña | Verificar el dominio en Resend antes de usar esto en producción (pasos en SPEC 02). El acceso con aviso evita bloquear a los usuarios por la verificación. |
| Desplegar el código sin la migración rompe toda consulta a `Usuario`, incluido el login | Ejecutar primero la migración. Las columnas tienen valor por defecto, así que el código actual sigue funcionando. Definir `FRONT_URL` antes de arrancar. |
| Una caída de la base de datos en el guard cerraría sesiones si se tratara como `401` | Los errores de base de datos salen como `500`, y hay un criterio de aceptación para eso. |
| La consulta por petición agrega carga | Es una lectura por clave primaria de dos columnas. Se acepta para el volumen actual. |
| Un escáner de correo que ejecute JS abre `/verificar-email` y verifica la cuenta | Se acepta: verificar no da acceso. Restablecer no se afecta, porque exige enviar un formulario. |
| El token queda en el historial del navegador o en el `Referer` | Enlaces de un solo uso y con vencimiento. El prompt del front pide quitarlo de la URL y no cargar recursos de terceros. |
| El proceso se cae antes de enviar el correo | El correo se pierde, igual que en SPEC 02. El usuario puede pedirlo de nuevo. |
| Si `FRONT_URL` falta en producción, los enlaces apuntan a `localhost` | `warn` al arrancar, y la variable queda en la lista de despliegue. |

## Resultado de la prueba manual (2026-11-06)

**Envío real con Resend**, con `MAIL_FROM=onboarding@resend.dev` y la dirección de pruebas `delivered@resend.dev`, en una cuenta temporal ya borrada:

- `POST /auth/register` respondió `201` y Resend aceptó `Verifica tu email en AgendaFlow` (id `01a1b14c-8308-7988-b992-4d8dda523b42`).
- `POST /auth/olvide-contrasena` respondió `200` y Resend aceptó `Restablece tu contraseña de AgendaFlow` (id `01a1b14c-8357-76b8-81c7-9436bda8f043`).

**Sin confirmar todavía:**

- Revisión visual de los correos en una bandeja real.
- Abrir los enlaces reales de un correo, que además necesita las páginas del front. Los flujos de verificar y restablecer se probaron contra la API con tokens puestos por SQL.
- Peticiones realmente simultáneas sobre un mismo enlace o un mismo envío.

**Observaciones de la implementación:**

- TypeORM usa `useUTC: false`, así que las fechas se guardan en hora local del proceso. La app escribe y compara con el mismo criterio, pero un cambio de horario o de zona del servidor puede acortar o alargar hasta una hora la vigencia de un enlace y la ventana del límite. No se cambió porque afecta a toda la app.
- En un `WHERE`, TypeORM no usa el tipo de la columna, así que las comparaciones contra `datetime2` declaran el tipo con `MssqlParameter`.
- `schema.sql` no se pudo ejecutar completo sobre una base nueva, porque el usuario `agendaflow` no tiene permiso para crear bases. Solo se validó la definición de `Usuario`.

## Qué **no** entra en este spec

- Cambios en el código del front (solo se entrega el prompt).
- Bloqueo por no verificar el email.
- Correo de aviso "tu contraseña cambió".
- Cambio de email y cambio de contraseña desde el panel.
- Logout con revocación, refresh tokens o cambios en la duración del JWT.
- Rechazar en el guard a usuarios con `Activo = 0`.
- Captcha.
- Cuentas de usuario para empleados.

Cada uno, si se hace, va en su propio spec.
