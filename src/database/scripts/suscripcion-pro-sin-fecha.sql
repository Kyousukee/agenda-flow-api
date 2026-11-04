/* =====================================================================
   Suscripción: activar Pro SIN VENCIMIENTO para una empresa (SPEC 01)

   Uso: cambiar @Slug y ejecutar (SSMS / Azure Data Studio / sqlcmd).
   La próxima consulta de la app reactiva lo que se haya desactivado por
   el plan Gratis (ExcedenteDesactivado).
   ===================================================================== */

USE AgendaFlowDB;
GO

DECLARE @Slug NVARCHAR(100) = N'mi-empresa';   -- <<< slug de la empresa

DECLARE @EmpresaId INT = (SELECT Id FROM dbo.Empresa WHERE Slug = @Slug);
IF @EmpresaId IS NULL
BEGIN
    RAISERROR(N'No existe una empresa con el slug "%s".', 16, 1, @Slug);
    RETURN;
END

IF EXISTS (SELECT 1 FROM dbo.Suscripcion WHERE EmpresaId = @EmpresaId)
    UPDATE dbo.Suscripcion
    SET [Plan] = N'Pro',
        FechaFin = NULL,
        FechaActualizacion = GETDATE()
    WHERE EmpresaId = @EmpresaId;
ELSE
    INSERT INTO dbo.Suscripcion (EmpresaId, [Plan], FechaInicio, FechaFin)
    VALUES (@EmpresaId, N'Pro', GETDATE(), NULL);

SELECT e.Slug, s.[Plan], s.FechaFin, s.ExcedenteDesactivado
FROM dbo.Suscripcion s JOIN dbo.Empresa e ON e.Id = s.EmpresaId
WHERE s.EmpresaId = @EmpresaId;
GO
