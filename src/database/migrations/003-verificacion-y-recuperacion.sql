/* =====================================================================
   Migración 003 - Verificación de email y recuperación de contraseña (SPEC 04)
   - Agrega a dbo.Usuario las columnas de verificación, restablecimiento,
     límite de envíos y TokenVersion.
   - Crea índices filtrados sobre los hash de los tokens.
   - Los usuarios existentes quedan verificados. Eso ocurre solo en el bloque
     que crea la columna: repetir la migración no verifica cuentas nuevas.
   Es idempotente: se puede ejecutar varias veces.

   Ejecutar ANTES de desplegar el código de SPEC 04. Las columnas tienen valor
   por defecto, así que el código anterior sigue funcionando.

   Uso:  sqlcmd -S localhost -U <usuario> -P <clave> -i src/database/migrations/003-verificacion-y-recuperacion.sql
         (o abrirlo y ejecutarlo en SSMS / Azure Data Studio)
   ===================================================================== */

-- Los índices filtrados exigen estas opciones, y sqlcmd trae QUOTED_IDENTIFIER en OFF.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

USE AgendaFlowDB;
GO

-- 1. EmailVerificado: al crearla, todos los usuarios existentes quedan verificados
IF COL_LENGTH(N'dbo.Usuario', N'EmailVerificado') IS NULL
BEGIN
    SET XACT_ABORT ON;
    BEGIN TRANSACTION;
    ALTER TABLE dbo.Usuario
        ADD EmailVerificado BIT NOT NULL CONSTRAINT DF_Usuario_EmailVerificado DEFAULT 0;
    -- SQL dinámico: la columna no existe todavía cuando se compila este lote.
    EXEC(N'UPDATE dbo.Usuario SET EmailVerificado = 1;');
    COMMIT TRANSACTION;
END
GO

-- 2. Versión de los JWT: sube en 1 al restablecer la contraseña
IF COL_LENGTH(N'dbo.Usuario', N'TokenVersion') IS NULL
ALTER TABLE dbo.Usuario
    ADD TokenVersion INT NOT NULL CONSTRAINT DF_Usuario_TokenVersion DEFAULT 0;
GO

-- 3. Verificación de email: token vigente y límite de envíos
IF COL_LENGTH(N'dbo.Usuario', N'VerificacionTokenHash') IS NULL
ALTER TABLE dbo.Usuario ADD VerificacionTokenHash NVARCHAR(64) NULL;
GO
IF COL_LENGTH(N'dbo.Usuario', N'VerificacionExpira') IS NULL
ALTER TABLE dbo.Usuario ADD VerificacionExpira DATETIME2 NULL;
GO
IF COL_LENGTH(N'dbo.Usuario', N'VerificacionUltimoEnvio') IS NULL
ALTER TABLE dbo.Usuario ADD VerificacionUltimoEnvio DATETIME2 NULL;
GO
IF COL_LENGTH(N'dbo.Usuario', N'VerificacionVentanaInicio') IS NULL
ALTER TABLE dbo.Usuario ADD VerificacionVentanaInicio DATETIME2 NULL;
GO
IF COL_LENGTH(N'dbo.Usuario', N'VerificacionEnviosVentana') IS NULL
ALTER TABLE dbo.Usuario
    ADD VerificacionEnviosVentana INT NOT NULL CONSTRAINT DF_Usuario_VerificacionEnvios DEFAULT 0;
GO

-- 4. Restablecimiento de contraseña: token vigente y límite de envíos
IF COL_LENGTH(N'dbo.Usuario', N'ResetTokenHash') IS NULL
ALTER TABLE dbo.Usuario ADD ResetTokenHash NVARCHAR(64) NULL;
GO
IF COL_LENGTH(N'dbo.Usuario', N'ResetExpira') IS NULL
ALTER TABLE dbo.Usuario ADD ResetExpira DATETIME2 NULL;
GO
IF COL_LENGTH(N'dbo.Usuario', N'ResetUltimoEnvio') IS NULL
ALTER TABLE dbo.Usuario ADD ResetUltimoEnvio DATETIME2 NULL;
GO
IF COL_LENGTH(N'dbo.Usuario', N'ResetVentanaInicio') IS NULL
ALTER TABLE dbo.Usuario ADD ResetVentanaInicio DATETIME2 NULL;
GO
IF COL_LENGTH(N'dbo.Usuario', N'ResetEnviosVentana') IS NULL
ALTER TABLE dbo.Usuario
    ADD ResetEnviosVentana INT NOT NULL CONSTRAINT DF_Usuario_ResetEnvios DEFAULT 0;
GO

-- 5. Índices filtrados: los endpoints públicos buscan por el hash
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Usuario_VerificacionTokenHash')
CREATE INDEX IX_Usuario_VerificacionTokenHash
    ON dbo.Usuario(VerificacionTokenHash) WHERE VerificacionTokenHash IS NOT NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Usuario_ResetTokenHash')
CREATE INDEX IX_Usuario_ResetTokenHash
    ON dbo.Usuario(ResetTokenHash) WHERE ResetTokenHash IS NOT NULL;
GO

SELECT
    COUNT(*) AS UsuariosTotales,
    SUM(CASE WHEN EmailVerificado = 1 THEN 1 ELSE 0 END) AS UsuariosVerificados
FROM dbo.Usuario;
GO
