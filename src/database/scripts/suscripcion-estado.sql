/* =====================================================================
   Suscripción: estado de todas las empresas (SPEC 01)

   Solo lectura. DiasRestantes usa el mismo redondeo que GET /suscripcion
   (hacia arriba). Una fila "Vencida" se degrada a Gratis en la próxima
   consulta de la app.
   ===================================================================== */

USE AgendaFlowDB;
GO

SELECT
    e.Id                                AS EmpresaId,
    e.Slug,
    e.Nombre,
    ISNULL(s.[Plan], N'(sin fila)')     AS [Plan],
    s.FechaFin,
    CASE WHEN s.FechaFin IS NULL THEN NULL
         ELSE CEILING(DATEDIFF(SECOND, GETDATE(), s.FechaFin) / 86400.0)
    END                                 AS DiasRestantes,
    CASE
        WHEN s.Id IS NULL                                   THEN N'Sin suscripción (la app crea Gratis)'
        WHEN s.[Plan] = N'Pro' AND s.FechaFin IS NULL       THEN N'Pro sin vencimiento'
        WHEN s.[Plan] = N'Gratis'                           THEN N'Gratis'
        WHEN s.FechaFin < GETDATE()                         THEN N'Vencida'
        WHEN DATEDIFF(SECOND, GETDATE(), s.FechaFin) <= 3 * 86400 THEN N'Por vencer'
        ELSE N'Vigente'
    END                                 AS Estado,
    s.ExcedenteDesactivado
FROM dbo.Empresa e
LEFT JOIN dbo.Suscripcion s ON s.EmpresaId = e.Id
ORDER BY
    CASE WHEN s.FechaFin IS NULL THEN 1 ELSE 0 END,
    s.FechaFin,
    e.Slug;
GO
