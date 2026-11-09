/* =====================================================================
   Migración 004 - Login y registro con Google (SPEC 05)
   - PasswordHash pasa a aceptar NULL: una cuenta creada con Google no tiene
     contraseña hasta que la cree con "olvidé mi contraseña".
   - Agrega GoogleId (el "sub" del ID token de Google) con un índice único
     filtrado: una cuenta de Google solo se vincula a un usuario.
   Es idempotente: se puede ejecutar varias veces.

   Ejecutar ANTES de desplegar el código de SPEC 05. Los cambios son
   compatibles con el código anterior.

   Uso:  sqlcmd -S localhost -U <usuario> -P <clave> -i src/database/migrations/004-login-google.sql
         (o abrirlo y ejecutarlo en SSMS / Azure Data Studio)
   ===================================================================== */

-- Los índices filtrados exigen estas opciones, y sqlcmd trae QUOTED_IDENTIFIER en OFF.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

USE AgendaFlowDB;
GO

-- 1. PasswordHash opcional
IF EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID(N'dbo.Usuario')
      AND name = N'PasswordHash'
      AND is_nullable = 0
)
ALTER TABLE dbo.Usuario ALTER COLUMN PasswordHash NVARCHAR(MAX) NULL;
GO

-- 2. Identificador de la cuenta de Google
IF COL_LENGTH(N'dbo.Usuario', N'GoogleId') IS NULL
ALTER TABLE dbo.Usuario ADD GoogleId NVARCHAR(255) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_Usuario_GoogleId')
CREATE UNIQUE INDEX UX_Usuario_GoogleId
    ON dbo.Usuario(GoogleId) WHERE GoogleId IS NOT NULL;
GO

SELECT
    COUNT(*) AS UsuariosTotales,
    SUM(CASE WHEN GoogleId IS NOT NULL THEN 1 ELSE 0 END) AS UsuariosConGoogle
FROM dbo.Usuario;
GO
