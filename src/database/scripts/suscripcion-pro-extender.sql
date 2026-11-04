/* =====================================================================
   Suscripción: registrar un pago de Pro y extender N días (SPEC 01)

   Uso: cambiar @Slug y @Dias (30 = un mes, 365 = un año) y ejecutar.
   - Si la Prueba o el Pro siguen vigentes, los días se suman desde la
     FechaFin actual (pagar antes de tiempo no hace perder días).
   - Si está en Gratis o ya venció, se cuentan desde hoy.
   - Si ya tiene Pro sin vencimiento, no se toca (se avisa).
   ===================================================================== */

USE AgendaFlowDB;
GO

DECLARE @Slug NVARCHAR(100) = N'mi-empresa';   -- <<< slug de la empresa
DECLARE @Dias INT = 30;                         -- <<< días a extender

DECLARE @EmpresaId INT = (SELECT Id FROM dbo.Empresa WHERE Slug = @Slug);
IF @EmpresaId IS NULL
BEGIN
    RAISERROR(N'No existe una empresa con el slug "%s".', 16, 1, @Slug);
    RETURN;
END
IF @Dias IS NULL OR @Dias <= 0
BEGIN
    RAISERROR(N'@Dias debe ser mayor que 0.', 16, 1);
    RETURN;
END
IF EXISTS (SELECT 1 FROM dbo.Suscripcion
           WHERE EmpresaId = @EmpresaId AND [Plan] = N'Pro' AND FechaFin IS NULL)
BEGIN
    RAISERROR(N'La empresa "%s" ya tiene Pro sin vencimiento; no se modificó.', 10, 1, @Slug);
    RETURN;
END

DECLARE @Ahora DATETIME2 = GETDATE();
DECLARE @Base DATETIME2 = @Ahora;

SELECT @Base = CASE
                 WHEN [Plan] IN (N'Prueba', N'Pro') AND FechaFin > @Ahora THEN FechaFin
                 ELSE @Ahora
               END
FROM dbo.Suscripcion
WHERE EmpresaId = @EmpresaId;

IF EXISTS (SELECT 1 FROM dbo.Suscripcion WHERE EmpresaId = @EmpresaId)
    UPDATE dbo.Suscripcion
    SET [Plan] = N'Pro',
        FechaFin = DATEADD(DAY, @Dias, @Base),
        FechaActualizacion = @Ahora
    WHERE EmpresaId = @EmpresaId;
ELSE
    INSERT INTO dbo.Suscripcion (EmpresaId, [Plan], FechaInicio, FechaFin)
    VALUES (@EmpresaId, N'Pro', @Ahora, DATEADD(DAY, @Dias, @Ahora));

SELECT e.Slug, s.[Plan], s.FechaFin,
       CEILING(DATEDIFF(SECOND, GETDATE(), s.FechaFin) / 86400.0) AS DiasRestantes
FROM dbo.Suscripcion s JOIN dbo.Empresa e ON e.Id = s.EmpresaId
WHERE s.EmpresaId = @EmpresaId;
GO
