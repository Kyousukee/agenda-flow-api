/* =====================================================================
   Migración 002 - Estados de pago
   - Crea los estados de tipo 'Pago', que no existían en el catálogo.
   - Corrige los pagos guardados con estados de otro tipo. El panel enviaba
     IDs fijos, así que se sabe qué etiqueta eligió el usuario:
       6 -> Pendiente, 7 -> Pagado, 8 -> Rechazado, 9 -> Reembolsado.
     Al registrar un pago se enviaba siempre el 1; esos pagos, y los que
     no tienen estado, pasan a Pagado (registrarlo significa que se recibió).
     Cualquier otro ID no pudo venir del panel: no se toca y se informa.
   Es idempotente: se puede ejecutar varias veces.

   Uso:  sqlcmd -S localhost -U <usuario> -P <clave> -i src/database/migrations/002-estados-pago.sql
         (o abrirlo y ejecutarlo en SSMS / Azure Data Studio)
   ===================================================================== */

USE AgendaFlowDB;
GO

MERGE dbo.Estado AS destino
USING (VALUES
    ('Pago', 'Pendiente',   '#f39c12', 1),
    ('Pago', 'Pagado',      '#27ae60', 2),
    ('Pago', 'Rechazado',   '#c0392b', 3),
    ('Pago', 'Reembolsado', '#95a5a6', 4)
) AS origen (Tipo, Nombre, Color, Orden)
ON destino.Tipo = origen.Tipo AND destino.Nombre = origen.Nombre
WHEN NOT MATCHED THEN
    INSERT (Tipo, Nombre, Color, Orden, Activo)
    VALUES (origen.Tipo, origen.Nombre, origen.Color, origen.Orden, 1);
GO

UPDATE p
SET p.EstadoId = nuevo.id
FROM dbo.Pago AS p
LEFT JOIN dbo.Estado AS actual ON actual.id = p.EstadoId
JOIN dbo.Estado AS nuevo
    ON nuevo.Tipo = 'Pago'
   AND nuevo.Nombre = CASE
        WHEN p.EstadoId = 6 THEN 'Pendiente'
        WHEN p.EstadoId = 7 THEN 'Pagado'
        WHEN p.EstadoId = 8 THEN 'Rechazado'
        WHEN p.EstadoId = 9 THEN 'Reembolsado'
        WHEN p.EstadoId = 1 OR p.EstadoId IS NULL THEN 'Pagado'
       END
WHERE ISNULL(actual.Tipo, '') <> 'Pago';
GO

SELECT COUNT(*) AS PagosSinCorregir
FROM dbo.Pago AS p
LEFT JOIN dbo.Estado AS e ON e.id = p.EstadoId
WHERE ISNULL(e.Tipo, '') <> 'Pago';
GO
