# SPEC 05 — Login y registro con Google

> **Estado:** Implementado
> **Depende de:** SPEC 04 (`EmailVerificado`, `TokenVersion`, "olvidé mi contraseña")
> **Fecha:** 2026-11-09
> **Objetivo:** Que un usuario pueda iniciar sesión o crear su cuenta con Google, manteniendo el JWT propio de la API.

## Por qué existe este spec

Escribir email y contraseña es la principal fricción del registro. Google entrega un ID token firmado que el back puede verificar por sí mismo.

**Se descartó Supabase Auth.** Guarda las identidades en su propio Postgres: habría que sincronizarlas con `dbo.Usuario`, cambiar `JwtAuthGuard` para aceptar sus tokens y perder `TokenVersion`. Con el ID token de Google, el back emite el mismo JWT de siempre y nada más cambia.

## Alcance

**Entra:**

- `POST /auth/google`: inicia sesión, vincula una cuenta existente por email o responde `requiereRegistro`.
- `POST /auth/google/registro`: crea empresa, suscripción de prueba, sucursal, usuario y empleado, como `POST /auth/register`.
- Cuentas sin contraseña (`PasswordHash = NULL`). Pueden crear una con "olvidé mi contraseña".
- Migración `004`.

**Fuera de alcance:**

- Otros proveedores (Microsoft, Apple).
- Desvincular la cuenta de Google desde el panel.
- Usar las APIs de Google (Calendar, Gmail). Solo se pide la identidad, sin client secret ni refresh tokens.
- Cambios en el código del front. Aquí solo se entrega el prompt.

## Modelo de datos

`dbo.Usuario`:

| Columna | Cambio |
|---------|--------|
| `PasswordHash` | Pasa a `NULL`. NULL = cuenta sin contraseña. |
| `GoogleId NVARCHAR(255) NULL` | Nueva. El `sub` del ID token. Índice único filtrado `UX_Usuario_GoogleId`. |

## Variables de entorno

`GOOGLE_CLIENT_ID`: ID de cliente OAuth tipo "Aplicación web" (Google Cloud Console → APIs y servicios → Credenciales). Orígenes JavaScript autorizados: el front local y los de producción. Sin la variable la API arranca, pero las rutas de Google responden `503`.

## Flujo

1. El front muestra el botón de Google Identity Services y recibe `credential`.
2. `POST /auth/google { credential }`. El back verifica firma, emisor, vencimiento, audiencia (`GOOGLE_CLIENT_ID`) y exige `email_verified = true`.
   - Existe un usuario con ese `GoogleId` → login.
   - Existe un usuario con ese email → se vincula (`GoogleId`, `EmailVerificado = 1`, se anula el token de verificación pendiente) → login.
   - No existe → `{ requiereRegistro: true, perfil }`.
3. Si hay que registrarse, el front pide los datos del negocio y llama a `POST /auth/google/registro` con el mismo `credential` (dura ~1 hora; si venció, se vuelve a pedir a Google).

## Decisiones

- **Vincular por email es seguro** porque Google ya comprobó que el usuario controla ese buzón.
- **Vincular una cuenta no verificada borra su contraseña y sube `TokenVersion`.** Otra persona pudo registrar ese email antes que su dueño y conocer la contraseña. Así el dueño queda como único con acceso.
- **No se reemplaza un `GoogleId` existente**: el `UPDATE` exige `GoogleId IS NULL` y si no aplica responde `409`.
- **El registro con Google es stateless**: el back vuelve a verificar el token en vez de guardar un registro pendiente.
- **`GOOGLE_CLIENT_ID` es opcional** para no impedir que la API arranque en entornos sin Google configurado.

## Criterios de aceptación

- [x] Login con una cuenta ya vinculada devuelve el JWT con su `tokenVersion`.
- [x] Login con el email de una cuenta existente la vincula y la deja verificada.
- [x] Vincular una cuenta no verificada borra la contraseña y sube `TokenVersion`.
- [x] Email sin cuenta → `requiereRegistro` sin JWT.
- [x] Registro con Google crea la cuenta verificada, sin contraseña y sin correo de verificación.
- [x] Registro con un email o cuenta de Google existente → `409`.
- [x] `POST /auth/login` con contraseña sobre una cuenta sin contraseña → `401 Credenciales inválidas`.
- [ ] Prueba manual con un token real de Google.

## Prompt para el front

> Implementa "Continuar con Google" en el login y el registro con Google Identity Services (`https://accounts.google.com/gsi/client`), usando `GOOGLE_CLIENT_ID` del environment.
>
> 1. Al recibir `credential` del botón, llama a `POST /auth/google { credential }`.
>    - Si responde `accessToken` y `user`, guárdalos igual que en el login normal.
>    - Si responde `{ requiereRegistro: true, perfil }`, lleva al usuario a un formulario "Completa los datos de tu negocio" con nombre y apellido prellenados desde `perfil` (editables), el email de `perfil` solo lectura y los pasos 2 y 3 del registro actual (empresa y sucursal). Sin campos de contraseña. Guarda `credential` en memoria (no en localStorage).
> 2. El formulario envía `POST /auth/google/registro` con `credential`, `nombre`, `apellido` y los datos del negocio. La respuesta es igual a la de `POST /auth/register`.
> 3. Errores: `401` → "No pudimos validar tu cuenta de Google, inténtalo de nuevo" y vuelve a mostrar el botón (el `credential` dura ~1 hora); `409` → muestra el mensaje del back; `503` → oculta el botón de Google; `429` → "Demasiados intentos".
> 4. Una cuenta creada con Google no tiene contraseña: si intenta el login normal, sugiere "Continuar con Google" u "Olvidé mi contraseña".
