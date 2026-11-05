# SPEC 02 — Correos de reservas con Resend

> **Estado:** Aprobado
> **Depende de:** SPEC 01 (solo como contexto: los correos funcionan igual en todos los planes)
> **Fecha:** 2026-11-05
> **Objetivo:** Que el back envíe correos HTML con la marca de cada empresa vía Resend cuando se agenda una reserva (al cliente, a la empresa y al empleado) y cuando cambia su estado (al cliente y al empleado), sin que un fallo de envío afecte la reserva.

## Por qué existe este spec

`ConfiguracionEmpresa` ya tiene el flag `EnviarCorreo`, pero nada lo usa. Hoy el cliente que agenda una hora no recibe confirmación, el negocio no se entera de una reserva nueva sin abrir el panel y nadie recibe aviso cuando la reserva cambia de estado.

## Alcance

**Entra:**

- Dependencia `resend` (SDK oficial) y las variables `.env` `RESEND_API_KEY` y `MAIL_FROM`.
- Módulo nuevo `src/correos/` con un servicio de bajo nivel para enviar (`CorreosService`) y uno de dominio para las reservas (`ReservaCorreosService`).
- **Reserva nueva** (`POST /reservar`), se envían 3 correos:
  - Al **cliente**: confirmación. Solo si `ConfiguracionEmpresa.EnviarCorreo = 1` y el cliente tiene email.
  - A la **empresa**: aviso "Nueva reserva". Se envía siempre. El destinatario es `Empresa.Email` y, si está vacío, el email del primer `Usuario` activo de la empresa.
  - Al **empleado asignado**: aviso "Nueva reserva". Se envía siempre, si la reserva tiene empleado y el empleado tiene email.
- **Cambio de estado** (`PATCH /reservar/reservas/:id/estado`), para cualquier estado, solo si el estado nuevo es distinto del actual:
  - Al **cliente**: aviso del nuevo estado. Solo si `EnviarCorreo = 1` y el cliente tiene email.
  - Al **empleado asignado**: aviso del nuevo estado. Se envía siempre, si tiene email.
- Plantillas HTML compatibles con clientes de correo (tablas y CSS inline), con logo y `ColorPrincipal` de la empresa, y una versión de texto plano.
- Remitente `"<Nombre de la empresa> <MAIL_FROM>"`. Reply-to con el email resuelto de la empresa en los correos al cliente.
- El envío es en segundo plano: la reserva o el cambio de estado responde aunque Resend falle, y el error queda en el log.
- Funciona en todos los planes (`Prueba`, `Gratis`, `Pro`).
- Instrucciones de configuración de Resend (sección más abajo).

**Fuera de alcance (para specs futuros):**

- Recordatorios automáticos antes de la cita (necesitan un cron).
- Correos de vencimiento de suscripción.
- WhatsApp (flag `EnviarWhatsapp`).
- Tabla de auditoría o reintentos de envíos fallidos.
- Aviso a la empresa en los cambios de estado (los hace la propia empresa).
- Enlace de cancelación para el cliente (el endpoint `PATCH /reservar/:id/cancelar` de `API-SPEC.md` no existe todavía).
- Proteger con JWT `PATCH /reservar/reservas/:id/estado` (hoy es público; ver Riesgos).
- Plantillas editables por la empresa desde el panel.
- Cambios en el front.

## Configuración en Resend (instrucciones para el usuario)

### Ahora, sin dominio (modo prueba)

1. Crear una cuenta en https://resend.com. Usa el correo donde quieres recibir las pruebas.
2. En **API Keys** → **Create API Key**: nombre `agendaflow-dev`, permiso **Sending access**, dominio **All domains**. Copia la key (`re_...`), porque solo se muestra una vez.
3. En el `.env` local:
   ```env
   RESEND_API_KEY=re_xxxxxxxxx
   MAIL_FROM=onboarding@resend.dev
   ```
4. **Restricción importante:** con `onboarding@resend.dev`, Resend **solo entrega a la dirección de la cuenta de Resend**. Para probar, usa ese mismo email como cliente, como `Empresa.Email` y como email de un empleado. Los envíos a otras direcciones fallan con un error de validación (`403`), que la app solo registra en el log.
5. Verifica los envíos en **Emails** dentro del dashboard de Resend (estado `Delivered`/`Bounced` y vista previa del HTML).

### Después, con dominio propio (producción)

1. **Domains** → **Add Domain** → por ejemplo `agendaflow.cl` (o un subdominio como `mail.agendaflow.cl`). Elige la región más cercana.
2. Resend muestra registros DNS (MX y TXT para SPF en un subdominio `send`, y TXT para DKIM `resend._domainkey`). Agrégalos en tu proveedor de DNS tal como aparecen.
3. Agrega un registro DMARC básico: TXT `_dmarc` → `v=DMARC1; p=none;`.
4. Pulsa **Verify** y espera el estado `Verified` (minutos a horas).
5. Crea una API key de producción restringida a ese dominio y cambia el `.env` de producción:
   ```env
   RESEND_API_KEY=re_prod_xxxxx
   MAIL_FROM=reservas@agendaflow.cl
   ```
   No hay que cambiar código: el remitente sale de `MAIL_FROM`.
6. Revisa los límites del plan gratuito de Resend en su página de precios antes de salir a producción.

## Modelo de datos

**No hay cambios en la base de datos.** Se usan columnas que ya existen:

| Dato | Origen |
| --- | --- |
| Flag correo al cliente | `ConfiguracionEmpresa.EnviarCorreo` (si no hay fila, cuenta como `false`) |
| Mostrar precio | `ConfiguracionEmpresa.MostrarPrecios` (si no hay fila, cuenta como `true`) |
| Email empresa | `Empresa.Email` → si es null o vacío, `Usuario.Email` del primer usuario activo de la empresa (`Id` ascendente) |
| Marca | `Empresa.Logo`, `Empresa.ColorPrincipal`, `Empresa.NombreComercial ?? Empresa.Nombre` |
| Email cliente | `Cliente.Email` (puede ser `''`; vacío = no se envía) |
| Email empleado | `Empleado.Email` (nullable) |
| Estado | `Estado.Nombre`, `Estado.Color` |

### Variables de entorno (`.env.example`)

```env
# Resend (correos transaccionales). Ver specs/02-correos-reservas-resend.md
# Sin dominio propio usar onboarding@resend.dev (solo entrega al email de tu cuenta Resend).
RESEND_API_KEY=
MAIL_FROM=onboarding@resend.dev
```

Si `RESEND_API_KEY` está vacía, `CorreosService` registra un `warn` al arrancar y cada envío se omite con un log `debug`. La app no falla.

### Estructura de archivos

```
src/correos/
  correos.module.ts
  correos.service.ts              # Envoltura de Resend: enviar({ to, subject, html, text, fromName, replyTo })
  reserva-correos.service.ts      # notificarNuevaReserva(reservaId), notificarCambioEstado(reservaId)
  plantillas/
    layout.ts                     # layoutCorreo({ marca, titulo, contenidoHtml }) + escapeHtml()
    formato.ts                    # formatearFecha, formatearHora, formatearPrecio
    textos-estado.ts              # Texto y emoji/acento por cada Estado.Nombre
    reserva-confirmada-cliente.ts
    reserva-nueva-interna.ts      # Empresa y empleado (cambia el saludo)
    estado-reserva-cliente.ts
    estado-reserva-empleado.ts
```

### Contratos

```ts
// correos.service.ts
export interface CorreoSaliente {
  to: string;
  subject: string;
  html: string;
  text: string;
  fromName: string;     // "Barbería X" → from: "Barbería X <MAIL_FROM>"
  replyTo?: string;
}
// enviar() nunca lanza: captura el error, lo registra con Logger('CorreosService') y devuelve boolean.

// plantillas/*.ts: cada plantilla es una función pura
export interface PlantillaCorreo { subject: string; html: string; text: string; }

export interface MarcaEmpresa {
  nombre: string;
  logoUrl: string | null;
  colorPrincipal: string;   // fallback '#4F46E5' si es null o no es un #hex válido
}

export interface DatosReservaCorreo {
  codigo: string;           // primeros 8 caracteres del UUID en mayúsculas, como referencia visible
  clienteNombre: string;
  clienteEmail: string | null;
  clienteTelefono: string | null;
  servicio: string;
  duracionMinutos: number;
  empleado: string | null;  // "Nombre Apellido"
  sucursal: string;
  direccion: string | null; // Direccion, Comuna, Ciudad unidos con ", " omitiendo vacíos
  fecha: string;            // "jueves, 12 de noviembre de 2026"
  hora: string;             // "10:00 – 10:30"
  precio: string | null;    // "$15.000" o null si MostrarPrecios = false
  observacion: string | null;
  estado: { nombre: string; color: string | null };
}
```

### Diseño de las plantillas

- Ancho máximo de 600px, tabla centrada, fondo exterior `#f4f4f7` y tarjeta blanca con bordes redondeados.
- **Encabezado:** franja de `colorPrincipal` con el logo (`<img>` de máximo 120px de alto, `alt` = nombre de la empresa). Sin logo, el nombre de la empresa en texto blanco.
- **Cuerpo:** título grande, párrafo de saludo y una tabla de detalle (Servicio, Fecha, Hora, Profesional, Sucursal, Dirección, Precio, Código). Las filas sin valor se omiten.
- **Estado:** badge con el `Estado.Color` (fallback `#6b7280`) en los correos de cambio de estado y en el aviso interno.
- **Pie:** "Este correo fue enviado por {empresa} a través de AgendaFlow", más el teléfono o email de la empresa si existen.
- Todo valor dinámico pasa por `escapeHtml()`. Solo CSS inline, sin `<style>` ni fuentes externas (fuente de sistema: `Arial, Helvetica, sans-serif`).
- Asuntos:
  - Cliente, nueva reserva: `Reserva confirmada en {empresa} – {fecha corta} {hora}`.
  - Interno, nueva reserva: `Nueva reserva: {cliente} – {servicio} – {fecha corta} {hora}`.
  - Cliente, cambio de estado: `Tu reserva en {empresa} está {estado en minúscula}`.
  - Empleado, cambio de estado: `Reserva de {cliente} cambió a {estado}`.
- Textos por estado en `textos-estado.ts` (con un texto genérico para un estado desconocido):
  - Programada: "Tu reserva está confirmada".
  - Pendiente: "Tu reserva está pendiente de confirmación".
  - Completada: "¡Gracias por tu visita!".
  - Pagado: "Recibimos tu pago".
  - Cancelada: "Tu reserva fue cancelada".
  - Rechazado: "Tu reserva no pudo ser aceptada".
  - Anulado: "Tu reserva fue anulada".

### Formato

- Fecha: `Intl.DateTimeFormat('es-CL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })`. Acepta `string 'YYYY-MM-DD'` o `Date`.
- Hora: `HH:mm`. Acepta `string 'HH:mm[:ss]'` o `Date` (el driver `mssql` puede devolver `time` como `Date` de 1970), leyendo con `getUTCHours`/`getUTCMinutes`.
- Precio: `Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 })`.

## Plan de implementación

1. **Dependencia y entorno.** `npm install resend`. Agregar `RESEND_API_KEY` y `MAIL_FROM` a `.env.example`. La app arranca igual.
2. **`CorreosService` + `CorreosModule`.** Crear el cliente `Resend` con `ConfigService` y el método `enviar(correo: CorreoSaliente): Promise<boolean>`, que nunca lanza y omite el envío si no hay API key. Registrar `CorreosModule` en `AppModule`. La app arranca, con un warn si falta la key.
3. **Plantillas.** Crear `layout.ts`, `formato.ts`, `textos-estado.ts` y las 4 plantillas como funciones puras `(marca, datos) => PlantillaCorreo`. Agregar `src/correos/plantillas/plantillas.spec.ts` con tests de: escape de HTML (`<script>` en el nombre del cliente sale escapado), formato de fecha/hora con `string` y `Date`, y omisión de la fila de precio cuando `precio = null`. Pasa `npm run test`.
4. **`ReservaCorreosService`.** Con `TypeOrmModule.forFeature([Reserva, ConfiguracionEmpresa, Usuario])` en `CorreosModule`:
   - `cargarContexto(reservaId)`: lee la reserva con `cliente`, `empleado`, `servicio`, `sucursal`, `empresa` y `estado`, más la configuración y el email resuelto de la empresa. Arma `MarcaEmpresa` y `DatosReservaCorreo`.
   - `notificarNuevaReserva(reservaId)`: cliente (si flag y email), empresa y empleado. Si el email del empleado coincide con el de la empresa (sin distinguir mayúsculas), se envía uno solo.
   - `notificarCambioEstado(reservaId)`: cliente (si flag y email) y empleado (si tiene email).
   - Ambos métodos envuelven todo en `try/catch` y solo registran errores. Exportar el servicio.
5. **Enganche en `reservar.service.ts`.** Importar `CorreosModule` en `ReservarModule` e inyectar `ReservaCorreosService`.
   - En `createReserva`, después del `save`: `void this.reservaCorreos.notificarNuevaReserva(saved.id);` (sin `await`). La respuesta del endpoint no cambia.
   - En `actualizarEstadoReserva`, cargar la reserva con `relations: { estado: true }`. Si `estado.id === dto.estadoId`, devolver sin guardar ni notificar. Si no, guardar y llamar `void this.reservaCorreos.notificarCambioEstado(reserva.id);`.
6. **Prueba manual con Resend.** Con `MAIL_FROM=onboarding@resend.dev` y el email de la cuenta Resend como cliente, empresa y empleado: activar `enviarCorreo`, crear una reserva y cambiar su estado. Revisar el inbox y el dashboard de Resend.

## Criterios de aceptación

- [ ] `npm run build` y `npm run test` pasan.
- [ ] Sin `RESEND_API_KEY`, la app arranca con un warn en el log, y `POST /reservar` responde `201` sin intentar enviar.
- [ ] Con `EnviarCorreo = 1`, `POST /reservar` con email de cliente genera 3 envíos (cliente, empresa, empleado), visibles en el dashboard de Resend.
- [ ] Con `EnviarCorreo = 0`, `POST /reservar` genera solo los envíos a la empresa y al empleado. El cliente no recibe nada.
- [ ] Sin `ConfiguracionEmpresa` para la empresa, el cliente no recibe correo y la empresa y el empleado sí.
- [ ] Una reserva sin `empleadoId` no intenta enviar al empleado y no registra error.
- [ ] Un cliente con `email = ''` no recibe correo y no se registra error.
- [ ] Con `Empresa.Email = NULL`, el aviso de nueva reserva llega al email del primer `Usuario` activo de la empresa.
- [ ] Si el email del empleado es igual al de la empresa, se envía un solo aviso interno.
- [ ] `PATCH /reservar/reservas/:id/estado` a un estado distinto genera el envío al cliente (si flag y email) y al empleado (si tiene email).
- [ ] `PATCH` con el mismo `estadoId` que ya tiene la reserva no genera envíos.
- [ ] Con una `RESEND_API_KEY` inválida, `POST /reservar` responde `201`, la reserva queda en BD y el log muestra el error de `CorreosService`.
- [ ] El correo al cliente llega con remitente `"{Nombre empresa} <MAIL_FROM>"` y el "Responder a" apunta al email de la empresa.
- [ ] Con `Empresa.Logo` definido, el encabezado muestra el logo. Sin logo, muestra el nombre. La franja usa `ColorPrincipal` o `#4F46E5`.
- [ ] Con `MostrarPrecios = 0`, ningún correo muestra el precio.
- [ ] Un `clienteNombre` con `<b>x</b>` aparece como texto literal, no como HTML.
- [ ] El correo se ve bien en Gmail web y en Gmail móvil (revisión visual).

## Decisiones

- **Sí:** envío en segundo plano (`void` sin `await`) con `catch` interno. Un fallo de Resend nunca rompe una reserva. Lo decidió el usuario.
- **No:** tabla de auditoría o reintentos. Basta con el log y el dashboard de Resend para el volumen actual.
- **Sí:** `EnviarCorreo` controla solo los correos al cliente. Los avisos internos (empresa y empleado) se envían siempre. Lo decidió el usuario.
- **Sí:** los correos funcionan en todos los planes. Lo decidió el usuario.
- **Sí:** en la reserva nueva se avisa a cliente, empresa y empleado. En el cambio de estado, solo a cliente y empleado, porque el cambio lo hace la propia empresa.
- **Sí:** se notifica cualquier cambio de estado, con el texto que corresponda a cada uno. No se notifica si el estado no cambia.
- **Sí:** plantillas como funciones TS puras con HTML inline. No suman dependencias, el `nest build` no necesita copiar assets y se pueden testear.
- **No:** archivos `.html` con placeholders (requiere configurar assets y escapar a mano) ni React Email (agrega React al back).
- **Sí:** marca por empresa (logo + `ColorPrincipal`) con fallback a la marca AgendaFlow.
- **Sí:** el remitente es único (`MAIL_FROM`) con el nombre de la empresa como display name, y reply-to a la empresa. Así no hay que verificar un dominio por empresa.
- **Sí:** si falta `Empresa.Email`, se usa el email del primer usuario activo (el dueño creado en el registro).
- **Sí:** `MAIL_FROM=onboarding@resend.dev` mientras no haya dominio. El cambio a producción es solo de `.env`.
- **Sí:** la lógica vive en un módulo propio (`src/correos/`), separado de `reservar`, para reutilizarla en specs futuros (recordatorios, vencimiento de suscripción).

## Riesgos

| Riesgo | Mitigación |
| --- | --- |
| Sin dominio verificado, Resend solo entrega al email de la cuenta | Documentado en las instrucciones. En pruebas se usa ese email para todos los roles. Los rechazos solo se registran en el log. |
| `PATCH /reservar/reservas/:id/estado` es público: cualquiera podría disparar correos cambiando estados | Fuera de alcance aquí. Se recomienda un spec aparte para protegerlo con `JwtAuthGuard` y validar `empresaId`. |
| El driver `mssql` devuelve `date`/`time` como `Date` y la fecha se corre un día por la zona horaria | `formato.ts` acepta `string` y `Date`, y formatea en `UTC`. Hay tests para ambos casos. |
| Gmail u Outlook rompen el diseño | Tablas + CSS inline, sin `<style>` ni fuentes web. Revisión visual en el criterio de aceptación. |
| El logo de Cloudinary no carga (cliente bloquea imágenes) | `alt` con el nombre de la empresa y el color de fondo en la franja, así el encabezado sigue legible. |
| Spam: correos sin SPF/DKIM | En producción se verifica el dominio con SPF, DKIM y DMARC antes de usarlo. |
| El proceso se cae entre el `save` y el envío | El correo se pierde. Se acepta, porque no hay reintentos en este alcance. |

## Qué **no** entra en este spec

- Recordatorios automáticos y cron.
- Correos de vencimiento de suscripción.
- WhatsApp.
- Auditoría o reintentos de envíos.
- Enlace de cancelación para el cliente.
- Protección JWT del endpoint de cambio de estado.
- Plantillas editables desde el panel.
- Cambios en el front.

Cada uno, si se hace, va en su propio spec.
