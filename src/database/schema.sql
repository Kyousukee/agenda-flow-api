/* =====================================================================
   AgendaFlow - Esquema de base de datos (SQL Server)
   Generado a partir de las entidades TypeORM en src/**/entities.
   Es idempotente: se puede ejecutar varias veces sin duplicar nada.

   Uso:  sqlcmd -S localhost\SQLEXPRESS -U <usuario> -P <clave> -i src/database/schema.sql
         (o abrirlo y ejecutarlo en SSMS / Azure Data Studio)
   ===================================================================== */

IF DB_ID(N'AgendaFlowDB') IS NULL
    CREATE DATABASE AgendaFlowDB;
GO

USE AgendaFlowDB;
GO

-- Los índices filtrados exigen estas opciones, y sqlcmd trae QUOTED_IDENTIFIER en OFF.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

/* ---------------------------------------------------------------------
   Catálogos
   --------------------------------------------------------------------- */

IF OBJECT_ID(N'dbo.Estado', N'U') IS NULL
CREATE TABLE dbo.Estado (
    id              INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Estado PRIMARY KEY,
    Tipo            VARCHAR(50)    NULL,
    Nombre          VARCHAR(50)    NOT NULL,
    Descripcion     NVARCHAR(250)  NULL,
    Color           VARCHAR(20)    NULL,
    Orden           INT            NULL,
    Activo          BIT            NOT NULL CONSTRAINT DF_Estado_Activo DEFAULT 1,
    FechaCreacion   DATETIME2      NOT NULL CONSTRAINT DF_Estado_FechaCreacion DEFAULT GETDATE()
);
GO

IF OBJECT_ID(N'dbo.Rol', N'U') IS NULL
CREATE TABLE dbo.Rol (
    id              INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Rol PRIMARY KEY,
    Nombre          NVARCHAR(100)  NOT NULL,
    Descripcion     NVARCHAR(300)  NULL,
    Activo          BIT            NOT NULL CONSTRAINT DF_Rol_Activo DEFAULT 1,
    FechaCreacion   DATETIME2      NOT NULL CONSTRAINT DF_Rol_FechaCreacion DEFAULT GETDATE()
);
GO

/* ---------------------------------------------------------------------
   Empresa
   --------------------------------------------------------------------- */

IF OBJECT_ID(N'dbo.Empresa', N'U') IS NULL
CREATE TABLE dbo.Empresa (
    Id                  INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Empresa PRIMARY KEY,
    Nombre              NVARCHAR(150)  NOT NULL,
    NombreComercial     NVARCHAR(150)  NULL,
    Slug                NVARCHAR(100)  NOT NULL CONSTRAINT UQ_Empresa_Slug UNIQUE,
    Descripcion         NVARCHAR(500)  NULL,
    Email               NVARCHAR(150)  NULL,
    Telefono            NVARCHAR(20)   NULL,
    Whatsapp            NVARCHAR(20)   NULL,
    SitioWeb            NVARCHAR(200)  NULL,
    Logo                NVARCHAR(300)  NULL,
    Banner              NVARCHAR(300)  NULL,
    ColorPrincipal      VARCHAR(20)    NULL,
    ColorSecundario     VARCHAR(20)    NULL,
    EstadoId            INT            NOT NULL,
    FechaCreacion       DATETIME2      NOT NULL CONSTRAINT DF_Empresa_FechaCreacion DEFAULT GETDATE(),
    FechaActualizacion  DATETIME2      NULL     CONSTRAINT DF_Empresa_FechaActualizacion DEFAULT GETDATE(),
    CONSTRAINT FK_Empresa_Estado FOREIGN KEY (EstadoId) REFERENCES dbo.Estado(id)
);
GO

IF OBJECT_ID(N'dbo.ConfiguracionEmpresa', N'U') IS NULL
CREATE TABLE dbo.ConfiguracionEmpresa (
    Id                          INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_ConfiguracionEmpresa PRIMARY KEY,
    PermitePagoAnticipado       BIT            NOT NULL CONSTRAINT DF_ConfEmp_PermitePagoAnticipado DEFAULT 0,
    TipoAnticipo                NVARCHAR(50)   NULL,
    MontoAnticipo               DECIMAL(10,2)  NOT NULL CONSTRAINT DF_ConfEmp_MontoAnticipo DEFAULT 0,
    TiempoCancelacionHoras      INT            NOT NULL CONSTRAINT DF_ConfEmp_TiempoCancelacionHoras DEFAULT 24,
    TiempoReservaMinutos        INT            NOT NULL CONSTRAINT DF_ConfEmp_TiempoReservaMinutos DEFAULT 30,
    PermiteSeleccionEmpleado    BIT            NOT NULL CONSTRAINT DF_ConfEmp_PermiteSeleccionEmpleado DEFAULT 1,
    MostrarPrecios              BIT            NOT NULL CONSTRAINT DF_ConfEmp_MostrarPrecios DEFAULT 1,
    EnviarCorreo                BIT            NOT NULL CONSTRAINT DF_ConfEmp_EnviarCorreo DEFAULT 0,
    EnviarWhatsapp              BIT            NOT NULL CONSTRAINT DF_ConfEmp_EnviarWhatsapp DEFAULT 0,
    EmpresaId                   INT            NULL,
    CONSTRAINT FK_ConfiguracionEmpresa_Empresa FOREIGN KEY (EmpresaId) REFERENCES dbo.Empresa(Id)
);
GO

-- Relación 1:1 con Empresa (índice filtrado para permitir varios NULL)
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UQ_ConfiguracionEmpresa_EmpresaId')
CREATE UNIQUE INDEX UQ_ConfiguracionEmpresa_EmpresaId
    ON dbo.ConfiguracionEmpresa(EmpresaId) WHERE EmpresaId IS NOT NULL;
GO

IF OBJECT_ID(N'dbo.EmpresaSlug', N'U') IS NULL
CREATE TABLE dbo.EmpresaSlug (
    Id          INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_EmpresaSlug PRIMARY KEY,
    Slug        NVARCHAR(100)  NOT NULL,
    EmpresaId   INT            NULL,
    CONSTRAINT FK_EmpresaSlug_Empresa FOREIGN KEY (EmpresaId) REFERENCES dbo.Empresa(Id)
);
GO

/* ---------------------------------------------------------------------
   Sucursales, horarios y empleados
   --------------------------------------------------------------------- */

IF OBJECT_ID(N'dbo.Sucursal', N'U') IS NULL
CREATE TABLE dbo.Sucursal (
    id              INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Sucursal PRIMARY KEY,
    Nombre          NVARCHAR(150)  NULL,
    Direccion       NVARCHAR(250)  NULL,
    Comuna          NVARCHAR(100)  NULL,
    Ciudad          NVARCHAR(100)  NULL,
    Region          NVARCHAR(100)  NULL,
    Pais            NVARCHAR(100)  NULL,
    Latitud         DECIMAL(10,7)  NULL,
    Longitud        DECIMAL(10,7)  NULL,
    Telefono        NVARCHAR(20)   NULL,
    Activo          BIT            NULL     CONSTRAINT DF_Sucursal_Activo DEFAULT 1,
    FechaCreacion   DATETIME2      NOT NULL CONSTRAINT DF_Sucursal_FechaCreacion DEFAULT GETDATE(),
    EmpresaId       INT            NULL,
    CONSTRAINT FK_Sucursal_Empresa FOREIGN KEY (EmpresaId) REFERENCES dbo.Empresa(Id)
);
GO

IF OBJECT_ID(N'dbo.horarios', N'U') IS NULL
CREATE TABLE dbo.horarios (
    id              UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_horarios PRIMARY KEY
                                     CONSTRAINT DF_horarios_id DEFAULT NEWSEQUENTIALID(),
    dia_semana      INT            NOT NULL,
    hora_inicio     TIME           NOT NULL,
    hora_fin        TIME           NOT NULL,
    abierto         BIT            NOT NULL CONSTRAINT DF_horarios_abierto DEFAULT 1,
    created_at      DATETIME2      NOT NULL CONSTRAINT DF_horarios_created_at DEFAULT GETDATE(),
    updated_at      DATETIME2      NULL     CONSTRAINT DF_horarios_updated_at DEFAULT GETDATE(),
    sucursal_id     INT            NULL,
    CONSTRAINT FK_horarios_Sucursal FOREIGN KEY (sucursal_id) REFERENCES dbo.Sucursal(id)
);
GO

IF OBJECT_ID(N'dbo.Empleado', N'U') IS NULL
CREATE TABLE dbo.Empleado (
    Id              INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Empleado PRIMARY KEY,
    Nombre          NVARCHAR(100)  NULL,
    Apellido        NVARCHAR(100)  NULL,
    Email           NVARCHAR(150)  NULL,
    Telefono        NVARCHAR(20)   NULL,
    Foto            NVARCHAR(300)  NULL,
    Descripcion     NVARCHAR(500)  NULL,
    Activo          BIT            NULL     CONSTRAINT DF_Empleado_Activo DEFAULT 1,
    FechaCreacion   DATETIME2      NOT NULL CONSTRAINT DF_Empleado_FechaCreacion DEFAULT GETDATE(),
    SucursalId      INT            NULL,
    CONSTRAINT FK_Empleado_Sucursal FOREIGN KEY (SucursalId) REFERENCES dbo.Sucursal(id)
);
GO

IF OBJECT_ID(N'dbo.BloqueoAgenda', N'U') IS NULL
CREATE TABLE dbo.BloqueoAgenda (
    Id              INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_BloqueoAgenda PRIMARY KEY,
    Fecha           DATE           NOT NULL,
    HoraInicio      TIME           NOT NULL,
    HoraFin         TIME           NOT NULL,
    Motivo          NVARCHAR(255)  NULL,
    EmpleadoId      INT            NULL,
    CONSTRAINT FK_BloqueoAgenda_Empleado FOREIGN KEY (EmpleadoId) REFERENCES dbo.Empleado(Id)
);
GO

/* ---------------------------------------------------------------------
   Servicios
   --------------------------------------------------------------------- */

IF OBJECT_ID(N'dbo.Servicio', N'U') IS NULL
CREATE TABLE dbo.Servicio (
    Id                  INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Servicio PRIMARY KEY,
    Nombre              NVARCHAR(255)  NOT NULL,
    Descripcion         TEXT           NULL,
    DuracionMinutos     INT            NOT NULL,
    Precio              DECIMAL(10,2)  NOT NULL,
    Color               NVARCHAR(7)    NULL,
    Activo              BIT            NOT NULL CONSTRAINT DF_Servicio_Activo DEFAULT 1,
    FechaCreacion       DATETIME2      NOT NULL CONSTRAINT DF_Servicio_FechaCreacion DEFAULT GETDATE(),
    EmpresaId           INT            NULL,
    CONSTRAINT FK_Servicio_Empresa FOREIGN KEY (EmpresaId) REFERENCES dbo.Empresa(Id)
);
GO

IF OBJECT_ID(N'dbo.ServicioEmpleado', N'U') IS NULL
CREATE TABLE dbo.ServicioEmpleado (
    Id          INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_ServicioEmpleado PRIMARY KEY,
    ServicioId  INT NULL,
    EmpleadoId  INT NULL,
    CONSTRAINT FK_ServicioEmpleado_Servicio FOREIGN KEY (ServicioId) REFERENCES dbo.Servicio(Id),
    CONSTRAINT FK_ServicioEmpleado_Empleado FOREIGN KEY (EmpleadoId) REFERENCES dbo.Empleado(Id)
);
GO

/* ---------------------------------------------------------------------
   Clientes y usuarios
   --------------------------------------------------------------------- */

IF OBJECT_ID(N'dbo.Cliente', N'U') IS NULL
CREATE TABLE dbo.Cliente (
    Id              INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Cliente PRIMARY KEY,
    Nombre          NVARCHAR(100)  NULL,
    Apellido        NVARCHAR(100)  NULL,
    Email           NVARCHAR(150)  NOT NULL,
    Telefono        NVARCHAR(20)   NULL,
    FechaCreacion   DATETIME2      NOT NULL CONSTRAINT DF_Cliente_FechaCreacion DEFAULT GETDATE(),
    EmpresaId       INT            NULL,
    CONSTRAINT FK_Cliente_Empresa FOREIGN KEY (EmpresaId) REFERENCES dbo.Empresa(Id)
);
GO

IF OBJECT_ID(N'dbo.Usuario', N'U') IS NULL
CREATE TABLE dbo.Usuario (
    id                  INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Usuario PRIMARY KEY,
    Nombre              NVARCHAR(100)  NOT NULL,
    Apellido            NVARCHAR(100)  NULL,
    Email               NVARCHAR(150)  NOT NULL CONSTRAINT UQ_Usuario_Email UNIQUE,
    PasswordHash        NVARCHAR(MAX)  NULL,     -- NULL: cuenta creada con Google (SPEC 05)
    Telefono            NVARCHAR(20)   NULL,
    Activo              BIT            NOT NULL CONSTRAINT DF_Usuario_Activo DEFAULT 1,
    FechaCreacion       DATETIME2      NOT NULL CONSTRAINT DF_Usuario_FechaCreacion DEFAULT GETDATE(),
    FechaActualizacion  DATETIME2      NULL     CONSTRAINT DF_Usuario_FechaActualizacion DEFAULT GETDATE(),
    EmpresaId           INT            NULL,
    RolId               INT            NULL,
    EstadoId            INT            NULL,
    EmailVerificado     BIT            NOT NULL CONSTRAINT DF_Usuario_EmailVerificado DEFAULT 0,
    TokenVersion        INT            NOT NULL CONSTRAINT DF_Usuario_TokenVersion DEFAULT 0,
    VerificacionTokenHash     NVARCHAR(64) NULL,
    VerificacionExpira        DATETIME2    NULL,
    VerificacionUltimoEnvio   DATETIME2    NULL,
    VerificacionVentanaInicio DATETIME2    NULL,
    VerificacionEnviosVentana INT          NOT NULL CONSTRAINT DF_Usuario_VerificacionEnvios DEFAULT 0,
    ResetTokenHash            NVARCHAR(64) NULL,
    ResetExpira               DATETIME2    NULL,
    ResetUltimoEnvio          DATETIME2    NULL,
    ResetVentanaInicio        DATETIME2    NULL,
    ResetEnviosVentana        INT          NOT NULL CONSTRAINT DF_Usuario_ResetEnvios DEFAULT 0,
    GoogleId                  NVARCHAR(255) NULL,
    CONSTRAINT FK_Usuario_Empresa FOREIGN KEY (EmpresaId) REFERENCES dbo.Empresa(Id),
    CONSTRAINT FK_Usuario_Rol     FOREIGN KEY (RolId)     REFERENCES dbo.Rol(id),
    CONSTRAINT FK_Usuario_Estado  FOREIGN KEY (EstadoId)  REFERENCES dbo.Estado(id)
);
GO

-- Los endpoints públicos buscan por el hash de los tokens (SPEC 04)
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Usuario_VerificacionTokenHash')
CREATE INDEX IX_Usuario_VerificacionTokenHash
    ON dbo.Usuario(VerificacionTokenHash) WHERE VerificacionTokenHash IS NOT NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Usuario_ResetTokenHash')
CREATE INDEX IX_Usuario_ResetTokenHash
    ON dbo.Usuario(ResetTokenHash) WHERE ResetTokenHash IS NOT NULL;
GO

-- Una cuenta de Google se vincula a un solo usuario (SPEC 05)
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_Usuario_GoogleId')
CREATE UNIQUE INDEX UX_Usuario_GoogleId
    ON dbo.Usuario(GoogleId) WHERE GoogleId IS NOT NULL;
GO

/* ---------------------------------------------------------------------
   Reservas y pagos
   --------------------------------------------------------------------- */

IF OBJECT_ID(N'dbo.Reserva', N'U') IS NULL
CREATE TABLE dbo.Reserva (
    Id              INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Reserva PRIMARY KEY,
    Codigo          UNIQUEIDENTIFIER NOT NULL,
    Fecha           DATE           NOT NULL,
    HoraInicio      TIME           NOT NULL,
    HoraFin         TIME           NOT NULL,
    Precio          DECIMAL(10,2)  NOT NULL,
    Observacion     TEXT           NULL,
    FechaCreacion   DATETIME2      NOT NULL CONSTRAINT DF_Reserva_FechaCreacion DEFAULT GETDATE(),
    EmpresaId       INT            NULL,
    SucursalId      INT            NULL,
    ClienteId       INT            NULL,
    EmpleadoId      INT            NULL,
    ServicioId      INT            NULL,
    EstadoId        INT            NULL,
    CONSTRAINT FK_Reserva_Empresa  FOREIGN KEY (EmpresaId)  REFERENCES dbo.Empresa(Id),
    CONSTRAINT FK_Reserva_Sucursal FOREIGN KEY (SucursalId) REFERENCES dbo.Sucursal(id),
    CONSTRAINT FK_Reserva_Cliente  FOREIGN KEY (ClienteId)  REFERENCES dbo.Cliente(Id),
    CONSTRAINT FK_Reserva_Empleado FOREIGN KEY (EmpleadoId) REFERENCES dbo.Empleado(Id),
    CONSTRAINT FK_Reserva_Servicio FOREIGN KEY (ServicioId) REFERENCES dbo.Servicio(Id),
    CONSTRAINT FK_Reserva_Estado   FOREIGN KEY (EstadoId)   REFERENCES dbo.Estado(id)
);
GO

IF OBJECT_ID(N'dbo.Pago', N'U') IS NULL
CREATE TABLE dbo.Pago (
    Id                  INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Pago PRIMARY KEY,
    ReservaId           INT            NOT NULL,
    Monto               DECIMAL(10,2)  NOT NULL,
    MetodoPago          NVARCHAR(50)   NULL,
    CodigoTransaccion   NVARCHAR(100)  NULL,
    FechaPago           DATETIME2      NOT NULL,
    EstadoId            INT            NULL,
    CONSTRAINT FK_Pago_Reserva FOREIGN KEY (ReservaId) REFERENCES dbo.Reserva(Id),
    CONSTRAINT FK_Pago_Estado  FOREIGN KEY (EstadoId)  REFERENCES dbo.Estado(id)
);
GO

/* ---------------------------------------------------------------------
   Suscripciones (SPEC 01 - ver migrations/001-suscripciones.sql)
   --------------------------------------------------------------------- */

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

/* ---------------------------------------------------------------------
   Datos iniciales
   --------------------------------------------------------------------- */

-- Rol 1: el registro (auth.service.ts) asigna RolId = 1 a todo usuario nuevo.
IF NOT EXISTS (SELECT 1 FROM dbo.Rol WHERE id = 1)
BEGIN
    SET IDENTITY_INSERT dbo.Rol ON;
    INSERT INTO dbo.Rol (id, Nombre, Descripcion, Activo)
    VALUES (1, N'Administrador', N'Dueño / administrador de la empresa', 1);
    SET IDENTITY_INSERT dbo.Rol OFF;
END
GO

-- Estados con IDs fijos, en el mismo orden que src/database/seeds/estado.seed.ts.
-- El seed de la app los detecta por (Tipo, Nombre) y no los vuelve a insertar.
SET IDENTITY_INSERT dbo.Estado ON;
MERGE dbo.Estado AS destino
USING (VALUES
    ( 1, 'Reserva', 'Programada', '#3498db', 1),
    ( 2, 'Reserva', 'Completada', '#2ecc71', 2),
    ( 3, 'Reserva', 'Pagado',     '#27ae60', 3),
    ( 4, 'Reserva', 'Pendiente',  '#f39c12', 4),
    ( 5, 'Reserva', 'Cancelada',  '#e74c3c', 5),
    ( 6, 'Reserva', 'Rechazado',  '#c0392b', 6),
    ( 7, 'Reserva', 'Anulado',    '#95a5a6', 7),
    ( 8, 'Usuario', 'Activo',     '#2ecc71', 1),
    ( 9, 'Usuario', 'Inactivo',   '#e74c3c', 2),
    (10, 'Usuario', 'Pendiente',  '#f39c12', 3),
    (11, 'Empresa', 'Activa',     '#2ecc71', 1),
    (12, 'Empresa', 'Inactiva',   '#e74c3c', 2),
    (13, 'Empresa', 'Suspendida', '#f39c12', 3),
    (14, 'Pago',    'Pendiente',  '#f39c12', 1),
    (15, 'Pago',    'Pagado',     '#27ae60', 2),
    (16, 'Pago',    'Rechazado',  '#c0392b', 3),
    (17, 'Pago',    'Reembolsado','#95a5a6', 4)
) AS origen (id, Tipo, Nombre, Color, Orden)
ON destino.Tipo = origen.Tipo AND destino.Nombre = origen.Nombre
WHEN NOT MATCHED THEN
    INSERT (id, Tipo, Nombre, Color, Orden, Activo)
    VALUES (origen.id, origen.Tipo, origen.Nombre, origen.Color, origen.Orden, 1);
SET IDENTITY_INSERT dbo.Estado OFF;
GO
