/* =====================================================================
   Migración 001 - Suscripciones (SPEC 01)
   - Crea dbo.Suscripcion (1:1 con Empresa).
   - Agrega DesactivadoPorSuscripcion a Sucursal, Empleado y Servicio.
   - Backfill: cada empresa existente recibe la prueba de 14 días
     contada desde su FechaCreacion.
   Es idempotente: se puede ejecutar varias veces.

   Uso:  sqlcmd -S localhost -U <usuario> -P <clave> -i src/database/migrations/001-suscripciones.sql
         (o abrirlo y ejecutarlo en SSMS / Azure Data Studio)
   ===================================================================== */

USE AgendaFlowDB;
GO

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
