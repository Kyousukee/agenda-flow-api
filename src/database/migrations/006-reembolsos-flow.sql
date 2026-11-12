/* =====================================================================
   Migración 006 - Reembolsos con Flow y cancelación pública (SPEC 07)
   - Reembolso: reembolsos de abonos Flow, parciales o totales, con el
     estado asíncrono de Flow. Usa los estados de tipo 'Pago'.
   - Pago.MontoNeto: paymentData.balance de Flow (monto - fee - taxes).
     Es lo que recibe el local y lo máximo que se puede reembolsar.
   - Reserva.TokenCancelacionHash: SHA-256 del token del enlace público
     de cancelación. El token en claro solo viaja en el correo.
   Es idempotente: se puede ejecutar varias veces.

   Ejecutar ANTES de desplegar el código de SPEC 07. Los cambios son
   compatibles con el código anterior.

   Uso:  sqlcmd -S localhost -U <usuario> -P <clave> -i src/database/migrations/006-reembolsos-flow.sql
         (o abrirlo y ejecutarlo en SSMS / Azure Data Studio)
   ===================================================================== */

-- Los índices filtrados exigen estas opciones, y sqlcmd trae QUOTED_IDENTIFIER en OFF.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

USE AgendaFlowDB;
GO

-- 1. Reembolsos de abonos
IF OBJECT_ID(N'dbo.Reembolso', N'U') IS NULL
CREATE TABLE dbo.Reembolso (
    Id               INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Reembolso PRIMARY KEY,
    PagoId           INT            NOT NULL,
    Monto            DECIMAL(10,2)  NOT NULL,
    Origen           NVARCHAR(10)   NOT NULL,     -- 'Cliente' | 'Panel'
    UsuarioId        INT            NULL,         -- quien lo pidió desde el panel; NULL si fue el cliente
    EstadoId         INT            NOT NULL,     -- Estado tipo 'Pago': Pendiente | Reembolsado | Rechazado
    FlowToken        NVARCHAR(100)  NULL,
    FlowRefundOrder  BIGINT         NULL,
    ComisionFlow     DECIMAL(10,2)  NULL,         -- fee que informa Flow por el reembolso
    Error            NVARCHAR(500)  NULL,         -- mensaje de Flow si se rechazó
    FechaCreacion    DATETIME2      NOT NULL CONSTRAINT DF_Reembolso_FechaCreacion DEFAULT GETDATE(),
    FechaResolucion  DATETIME2      NULL,
    CONSTRAINT FK_Reembolso_Pago    FOREIGN KEY (PagoId)    REFERENCES dbo.Pago(Id),
    CONSTRAINT FK_Reembolso_Usuario FOREIGN KEY (UsuarioId) REFERENCES dbo.Usuario(id),
    CONSTRAINT FK_Reembolso_Estado  FOREIGN KEY (EstadoId)  REFERENCES dbo.Estado(id),
    CONSTRAINT CK_Reembolso_Origen  CHECK (Origen IN (N'Cliente', N'Panel'))
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_Reembolso_FlowToken')
CREATE UNIQUE INDEX UX_Reembolso_FlowToken
    ON dbo.Reembolso(FlowToken) WHERE FlowToken IS NOT NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Reembolso_PagoId')
CREATE INDEX IX_Reembolso_PagoId ON dbo.Reembolso(PagoId);
GO

-- 2. Monto neto recibido por el local
IF COL_LENGTH(N'dbo.Pago', N'MontoNeto') IS NULL
ALTER TABLE dbo.Pago ADD MontoNeto DECIMAL(10,2) NULL;  -- paymentData.balance de Flow
GO

-- 3. Token del enlace público de cancelación
IF COL_LENGTH(N'dbo.Reserva', N'TokenCancelacionHash') IS NULL
ALTER TABLE dbo.Reserva ADD TokenCancelacionHash NVARCHAR(64) NULL;  -- SHA-256 hex
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_Reserva_TokenCancelacionHash')
CREATE UNIQUE INDEX UX_Reserva_TokenCancelacionHash
    ON dbo.Reserva(TokenCancelacionHash) WHERE TokenCancelacionHash IS NOT NULL;
GO

SELECT
    (SELECT COUNT(*) FROM dbo.Reembolso) AS Reembolsos,
    (SELECT COUNT(*) FROM dbo.Pago WHERE CuentaFlowId IS NOT NULL AND MontoNeto IS NULL) AS PagosFlowSinMontoNeto;
GO
