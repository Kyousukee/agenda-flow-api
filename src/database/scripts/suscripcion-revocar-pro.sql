/* =====================================================================
   Suscripción: revocar Pro (o terminar la Prueba) de una empresa (SPEC 01)

   Uso: cambiar @Slug y ejecutar.
   No escribe 'Gratis' directamente: deja FechaFin en el pasado y conserva
   el plan, para que la app ejecute la degradación normal en la próxima
   consulta (pasa a Gratis y desactiva el excedente).
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
IF NOT EXISTS (SELECT 1 FROM dbo.Suscripcion
               WHERE EmpresaId = @EmpresaId AND [Plan] IN (N'Prueba', N'Pro'))
BEGIN
    RAISERROR(N'La empresa "%s" no tiene Prueba ni Pro; no hay nada que revocar.', 10, 1, @Slug);
    RETURN;
END

UPDATE dbo.Suscripcion
SET FechaFin = DATEADD(SECOND, -1, GETDATE()),
    FechaActualizacion = GETDATE()
WHERE EmpresaId = @EmpresaId;

SELECT e.Slug, s.[Plan], s.FechaFin,
       N'Vencida: pasa a Gratis en la próxima consulta de la app' AS Nota
FROM dbo.Suscripcion s JOIN dbo.Empresa e ON e.Id = s.EmpresaId
WHERE s.EmpresaId = @EmpresaId;
GO
