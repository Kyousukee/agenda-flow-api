/* =====================================================================
   Migración 007 - Reservas presenciales y rol recepcionista (SPEC 08)
   - Rol 2 'Recepcionista': agenda y pagos manuales de una sucursal.
   - Usuario.SucursalId: sucursal del recepcionista (NULL en el rol 1).
   - Usuario.DesactivadoPorSuscripcion: excedente del plan Gratis (SPEC 01).
   - Reserva.Origen: 'Online' (página pública) | 'Panel' (dueño o recepcionista).
   - Reserva.UsuarioCreadorId: quién la agendó desde el panel.
   Es idempotente: se puede ejecutar varias veces.

   Ejecutar ANTES de desplegar el código de SPEC 08. Los cambios son
   compatibles con el código anterior.

   Uso:  sqlcmd -S localhost -U <usuario> -P <clave> -i src/database/migrations/007-reservas-panel-y-recepcionistas.sql
         (o abrirlo y ejecutarlo en SSMS / Azure Data Studio)
   ===================================================================== */

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

USE AgendaFlowDB;
GO

-- 1. Rol recepcionista
IF NOT EXISTS (SELECT 1 FROM dbo.Rol WHERE id = 2)
BEGIN
    SET IDENTITY_INSERT dbo.Rol ON;
    INSERT INTO dbo.Rol (id, Nombre, Descripcion, Activo)
    VALUES (2, N'Recepcionista', N'Agenda y pagos manuales de una sucursal', 1);
    SET IDENTITY_INSERT dbo.Rol OFF;
END
GO

-- 2. Usuario: sucursal del recepcionista y excedente del plan
IF COL_LENGTH(N'dbo.Usuario', N'SucursalId') IS NULL
ALTER TABLE dbo.Usuario ADD SucursalId INT NULL
    CONSTRAINT FK_Usuario_Sucursal FOREIGN KEY REFERENCES dbo.Sucursal(id);
GO

IF COL_LENGTH(N'dbo.Usuario', N'DesactivadoPorSuscripcion') IS NULL
ALTER TABLE dbo.Usuario ADD DesactivadoPorSuscripcion BIT NOT NULL
    CONSTRAINT DF_Usuario_DesactivadoPorSuscripcion DEFAULT 0;
GO

-- 3. Reserva: origen y quién la creó
IF COL_LENGTH(N'dbo.Reserva', N'Origen') IS NULL
ALTER TABLE dbo.Reserva ADD Origen NVARCHAR(10) NOT NULL
    CONSTRAINT DF_Reserva_Origen DEFAULT N'Online'
    CONSTRAINT CK_Reserva_Origen CHECK (Origen IN (N'Online', N'Panel'));
GO

IF COL_LENGTH(N'dbo.Reserva', N'UsuarioCreadorId') IS NULL
ALTER TABLE dbo.Reserva ADD UsuarioCreadorId INT NULL
    CONSTRAINT FK_Reserva_UsuarioCreador FOREIGN KEY REFERENCES dbo.Usuario(id);
GO

SELECT
    (SELECT COUNT(*) FROM dbo.Rol WHERE id = 2) AS RolRecepcionista,
    (SELECT COUNT(*) FROM dbo.Reserva WHERE Origen = N'Online') AS ReservasOnline,
    (SELECT COUNT(*) FROM dbo.Reserva WHERE Origen = N'Panel') AS ReservasPanel;
GO
