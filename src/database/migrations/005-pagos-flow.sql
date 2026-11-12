/* =====================================================================
   Migración 005 - Pagos con Flow (SPEC 06)
   - CuentaFlow: credenciales Flow de cada empresa y, opcionalmente, de
     cada sucursal. La secretKey se guarda cifrada (AES-256-GCM).
   - PagoSuscripcion: pagos de la mensualidad Pro.
   - Pago: columnas para los abonos cobrados con Flow.
   - ConfiguracionEmpresa: PagoObligatorio y valores válidos de TipoAnticipo.
     Un TipoAnticipo fuera de ('Monto','Porcentaje','Completo') pasa a NULL
     y esa empresa queda con PermitePagoAnticipado = 0.
   Es idempotente: se puede ejecutar varias veces.

   Ejecutar ANTES de desplegar el código de SPEC 06. Los cambios son
   compatibles con el código anterior.

   Uso:  sqlcmd -S localhost -U <usuario> -P <clave> -i src/database/migrations/005-pagos-flow.sql
         (o abrirlo y ejecutarlo en SSMS / Azure Data Studio)
   ===================================================================== */

-- Los índices filtrados exigen estas opciones, y sqlcmd trae QUOTED_IDENTIFIER en OFF.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

USE AgendaFlowDB;
GO

-- 1. Cuentas Flow de los locales
IF OBJECT_ID(N'dbo.CuentaFlow', N'U') IS NULL
CREATE TABLE dbo.CuentaFlow (
    Id                 INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_CuentaFlow PRIMARY KEY,
    EmpresaId          INT            NOT NULL,
    SucursalId         INT            NULL,      -- NULL = cuenta de la empresa
    ApiKey             NVARCHAR(100)  NOT NULL,
    SecretKeyCifrada   NVARCHAR(500)  NOT NULL,  -- base64(iv | authTag | cifrado)
    FechaCreacion      DATETIME2      NOT NULL CONSTRAINT DF_CuentaFlow_FechaCreacion DEFAULT GETDATE(),
    FechaActualizacion DATETIME2      NULL,
    FechaBaja          DATETIME2      NULL,      -- baja lógica: los pagos antiguos se siguen verificando con estas credenciales
    CONSTRAINT FK_CuentaFlow_Empresa  FOREIGN KEY (EmpresaId)  REFERENCES dbo.Empresa(Id),
    CONSTRAINT FK_CuentaFlow_Sucursal FOREIGN KEY (SucursalId) REFERENCES dbo.Sucursal(id)
);
GO

-- Para BD donde la primera versión de esta migración creó la tabla sin FechaBaja.
IF COL_LENGTH(N'dbo.CuentaFlow', N'FechaBaja') IS NULL
ALTER TABLE dbo.CuentaFlow ADD FechaBaja DATETIME2 NULL;
GO

-- Una sola cuenta vigente (FechaBaja IS NULL) por empresa y por sucursal.
-- Se recrean los índices si vienen de la primera versión, que no filtraba por FechaBaja.
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_CuentaFlow_Empresa'
           AND ISNULL(filter_definition, N'') NOT LIKE N'%FechaBaja%')
DROP INDEX UX_CuentaFlow_Empresa ON dbo.CuentaFlow;
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_CuentaFlow_Sucursal'
           AND ISNULL(filter_definition, N'') NOT LIKE N'%FechaBaja%')
DROP INDEX UX_CuentaFlow_Sucursal ON dbo.CuentaFlow;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_CuentaFlow_Empresa')
CREATE UNIQUE INDEX UX_CuentaFlow_Empresa
    ON dbo.CuentaFlow(EmpresaId) WHERE SucursalId IS NULL AND FechaBaja IS NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_CuentaFlow_Sucursal')
CREATE UNIQUE INDEX UX_CuentaFlow_Sucursal
    ON dbo.CuentaFlow(SucursalId) WHERE SucursalId IS NOT NULL AND FechaBaja IS NULL;
GO

-- 2. Pagos de la mensualidad
IF OBJECT_ID(N'dbo.PagoSuscripcion', N'U') IS NULL
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
    CONSTRAINT FK_PagoSuscripcion_Estado  FOREIGN KEY (EstadoId)  REFERENCES dbo.Estado(id)
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_PagoSuscripcion_FlowToken')
CREATE UNIQUE INDEX UX_PagoSuscripcion_FlowToken
    ON dbo.PagoSuscripcion(FlowToken) WHERE FlowToken IS NOT NULL;
GO

-- 3. Columnas Flow en los abonos (dbo.Pago)
IF COL_LENGTH(N'dbo.Pago', N'CuentaFlowId') IS NULL
ALTER TABLE dbo.Pago ADD CuentaFlowId INT NULL;  -- cuenta que firmó el cobro; NULL = pago manual del panel
IF COL_LENGTH(N'dbo.Pago', N'FlowToken') IS NULL
ALTER TABLE dbo.Pago ADD FlowToken NVARCHAR(100) NULL;
IF COL_LENGTH(N'dbo.Pago', N'FlowOrder') IS NULL
ALTER TABLE dbo.Pago ADD FlowOrder BIGINT NULL;
IF COL_LENGTH(N'dbo.Pago', N'FechaExpiracion') IS NULL
ALTER TABLE dbo.Pago ADD FechaExpiracion DATETIME2 NULL;  -- fin de la retención de la hora
GO

IF OBJECT_ID(N'dbo.FK_Pago_CuentaFlow', N'F') IS NULL
ALTER TABLE dbo.Pago ADD CONSTRAINT FK_Pago_CuentaFlow
    FOREIGN KEY (CuentaFlowId) REFERENCES dbo.CuentaFlow(Id);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_Pago_FlowToken')
CREATE UNIQUE INDEX UX_Pago_FlowToken
    ON dbo.Pago(FlowToken) WHERE FlowToken IS NOT NULL;
GO

-- 4. Configuración de anticipo
IF COL_LENGTH(N'dbo.ConfiguracionEmpresa', N'PagoObligatorio') IS NULL
ALTER TABLE dbo.ConfiguracionEmpresa ADD PagoObligatorio BIT NOT NULL
    CONSTRAINT DF_ConfiguracionEmpresa_PagoObligatorio DEFAULT 1;
GO

-- La collation de la BD no distingue mayúsculas: 'monto' cumpliría el CHECK,
-- pero la app compara exacto. Se deja la escritura canónica.
UPDATE dbo.ConfiguracionEmpresa
SET TipoAnticipo = CASE LTRIM(RTRIM(LOWER(TipoAnticipo)))
                     WHEN N'monto'      THEN N'Monto'
                     WHEN N'porcentaje' THEN N'Porcentaje'
                     WHEN N'completo'   THEN N'Completo'
                   END
WHERE LTRIM(RTRIM(LOWER(TipoAnticipo))) IN (N'monto', N'porcentaje', N'completo')
  AND TipoAnticipo COLLATE Latin1_General_BIN NOT IN (N'Monto', N'Porcentaje', N'Completo');
GO

UPDATE dbo.ConfiguracionEmpresa
SET TipoAnticipo = NULL,
    PermitePagoAnticipado = 0
WHERE TipoAnticipo IS NOT NULL
  AND TipoAnticipo NOT IN (N'Monto', N'Porcentaje', N'Completo');
SELECT @@ROWCOUNT AS ConfiguracionesConTipoAnticipoInvalido;
GO

IF OBJECT_ID(N'dbo.CK_ConfiguracionEmpresa_TipoAnticipo', N'C') IS NULL
ALTER TABLE dbo.ConfiguracionEmpresa ADD CONSTRAINT CK_ConfiguracionEmpresa_TipoAnticipo
    CHECK (TipoAnticipo IS NULL OR TipoAnticipo IN (N'Monto', N'Porcentaje', N'Completo'));
GO

SELECT
    (SELECT COUNT(*) FROM dbo.CuentaFlow)      AS CuentasFlow,
    (SELECT COUNT(*) FROM dbo.PagoSuscripcion) AS PagosSuscripcion,
    (SELECT COUNT(*) FROM dbo.ConfiguracionEmpresa WHERE PermitePagoAnticipado = 1) AS EmpresasConAnticipo;
GO
