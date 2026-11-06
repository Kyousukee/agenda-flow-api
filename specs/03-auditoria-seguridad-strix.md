# SPEC 03: Auditoría de seguridad Strix (API)

**Fecha:** 2026-11-06 · **Rama:** `security/strix-auditoria` · **Informe del front:** `AgendaFlowFront/specs/05-auditoria-seguridad-strix.md`

Modo `strix-standard`, white-box, con pruebas dinámicas solo en local. Este repositorio es público, así que el informe no incluye pasos de explotación.

## Despliegue

Esta rama y la del front **deben desplegarse juntas**: cambian las rutas de reservas y el contrato de `POST /reservar`.

Variables nuevas:

| Variable | Valor | Si falta |
|---|---|---|
| `CORS_ORIGINS` | En producción: `https://agendaflow.cl,https://www.agendaflow.cl` | Solo se permite `http://localhost:4200` |
| `TRUST_PROXY` | Número de proxies delante de la API | Detrás de un proxy, todos los clientes comparten el mismo límite de peticiones |

`JWT_SECRET` ahora es obligatorio: sin él, la API no arranca.

**Migración obligatoria:** ejecutar `src/database/migrations/002-estados-pago.sql` en cada base. El seed crea el catálogo al arrancar, pero solo la migración corrige los pagos ya guardados. Es idempotente; al final informa cuántos pagos no pudo corregir.

**Si producción ya está activa:** C1, C2 y A1 pueden haber expuesto datos reales de clientes. Revisar los logs de acceso de esas rutas y valorar si corresponde avisar a los afectados.

## Hallazgos

Todos se reprodujeron en local antes de corregirlos y se repitieron después, salvo M7, que se identificó por revisión de código.

| ID | Severidad | Hallazgo | Antes | Después |
|---|---|---|---|---|
| C1 | Crítica | Listado público de reservas con datos de clientes y pagos | 200 | 404; `GET /reservas` exige sesión y empresa propia |
| C2 | Crítica | Cambio público del estado de cualquier reserva, con envío de correos | 200 | 404; `PATCH /reservas/:id/estado` exige sesión y empresa propia |
| A1 | Alta | Una empresa podía leer, crear y modificar pagos de otra | 200/201 | 403 |
| A2 | Alta | `POST /reservar` confiaba en el cliente: precio, relaciones entre entidades, solapes y email | 201 | 400/409; precio y hora de término calculados en el servidor |
| A4 | Alta | Sin límite de intentos en login, registro y reservas | 12 de 12 procesados | 5 procesados, 7 con 429 |
| M1 | Media | Lectura de empleados, bloqueos y horarios de otra empresa; vínculo de empleados a servicios ajenos | 200/201 | 403 |
| M2 | Media | Los endpoints públicos serializaban entidades completas (email y teléfono de empleados, motivo de bloqueos) | Expuesto | Solo los campos que usa la página |
| M3 | Media | CORS abierto a cualquier origen y sin cabeceras de seguridad | `*` | Lista de orígenes y `helmet` |
| M5 | Media | El registro devolvía errores internos de base de datos; slug repetido daba 500 y un nombre solo con símbolos daba slug vacío | 500 con detalle | Mensaje genérico y slug único |
| M7 | Media | El login resolvía el empleado por email sin filtrar por empresa, así que otra empresa podía interferir | Por revisión de código | Búsqueda acotada a la empresa; no se reprodujo en ejecución |

Otros cambios en `POST /reservar`:
- La transacción usa aislamiento `SERIALIZABLE`. Con 6 peticiones simultáneas a la misma hora, se creó 1 reserva y las otras 5 recibieron 409.
- Las reservas `Cancelada`, `Rechazado` y `Anulado` liberan la hora.
- Los clientes se buscan dentro de su empresa.
- La respuesta pública ya no incluye al cliente.

## Correcciones funcionales

- **Estados de pago:** el catálogo no tenía estados de tipo `Pago`. Se añadieron Pendiente, Pagado, Rechazado y Reembolsado, con `GET /pagos/estados` (requiere sesión). Crear o cambiar un pago con un estado de otro tipo responde 400, y un pago nuevo sin estado queda como Pagado.
- **Migración de pagos existentes:** los IDs 6 a 9 se traducen a la etiqueta que mostraba el panel. El ID 1 y los pagos sin estado pasan a Pagado, **lo cual es una suposición**: el panel enviaba siempre el 1 al registrar, así que no se puede saber si alguno no se había cobrado. Probada dentro de una transacción con `ROLLBACK`.
- **Horario de atención:** `POST /reservar` responde 400 si la reserva completa no cabe en un horario abierto de la sucursal para ese día. Una sucursal sin horarios guardados no acepta reservas, igual que la página pública, que tampoco le ofrece horas.

## Revisado sin hallazgos

- `npm audit --omit=dev`: 0 vulnerabilidades.
- `.env` no está versionado, y una búsqueda por regex en el historial no encontró secretos.
- bcrypt, y mensaje de login que no revela si la cuenta existe.
- Consultas parametrizadas.
- Las plantillas de correo escapan el HTML.
- Guards de rol.

## Límites de la auditoría

- `semgrep`, `gitleaks`, `trivy` y `trufflehog` no estaban instalados. Se sustituyeron por revisión manual y búsquedas por regex, que cubren menos.
- No se probó el entorno de producción ni su infraestructura.
- `npm run test:e2e` no se puede ejecutar: Jest no carga `uuid` (ESM) desde `AppModule`. El fallo no viene de esta rama, que no cambia `test/`. Los 58 tests unitarios sí pasan.

## Pendiente

- **Sesión:** el JWT dura 7 días por defecto y no se puede revocar. Decidirlo junto con la rama `Supabase`.
- **Registro abierto:** no verifica el email ni tiene captcha. El límite por IP lo frena, pero no lo evita.
- **Abuso de reservas públicas:** el límite es por IP y no se verifica el email del cliente, así que se pueden seguir enviando correos a terceros a baja velocidad.
- **Horas ya pasadas de hoy:** `POST /reservar` admite una hora anterior a la actual dentro del día, por el margen de husos horarios. La página pública no las ofrece.
- **`JWT_SECRET` corto:** conviene usar al menos 32 caracteres aleatorios en producción.
- **`encrypt: false`** en la conexión a SQL Server (`database.config.ts`): debe activarse si la base no es local.
