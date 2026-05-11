-- =============================================================================
-- COCKPIT AGENT — views_v21plus.sql
-- Surcharges pour Sage 100 v21+ : vues nécessitant F_IMMOBILISATION.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- VW_METADATA_AGENT (surcharge v21+)
-- Ajoute F_IMMOBILISATION à la version de base (views_stable.sql).
-- ---------------------------------------------------------------------------
IF OBJECT_ID('dbo.VW_METADATA_AGENT', 'V') IS NOT NULL DROP VIEW dbo.VW_METADATA_AGENT;
GO
CREATE VIEW dbo.VW_METADATA_AGENT AS
SELECT 'F_ECRITUREC'    AS [Table_Source], COUNT(*) AS [Nb_Lignes],
       MIN(EC_Date)     AS [Premiere_Date], MAX(EC_Date) AS [Derniere_Date],
       MAX(cbMarq)      AS [Watermark_Max], MAX(cbModification) AS [Derniere_Modif]
FROM dbo.F_ECRITUREC
UNION ALL
SELECT 'F_ECRITUREA', COUNT(*), NULL, NULL, MAX(cbMarq), MAX(cbModification)
FROM dbo.F_ECRITUREA
UNION ALL
SELECT 'F_COMPTET', COUNT(*), NULL, NULL, MAX(cbMarq), MAX(cbModification)
FROM dbo.F_COMPTET
UNION ALL
SELECT 'F_COMPTEG', COUNT(*), NULL, NULL, MAX(cbMarq), MAX(cbModification)
FROM dbo.F_COMPTEG
UNION ALL
SELECT 'F_DOCENTETE', COUNT(*), MIN(DO_Date), MAX(DO_Date), MAX(cbMarq), MAX(cbModification)
FROM dbo.F_DOCENTETE
UNION ALL
SELECT 'F_ARTICLE', COUNT(*), NULL, NULL, MAX(cbMarq), MAX(cbModification)
FROM dbo.F_ARTICLE
UNION ALL
SELECT 'F_IMMOBILISATION', COUNT(*), MIN(IM_DateAcq), MAX(IM_DateAcq), MAX(cbMarq), MAX(cbModification)
FROM dbo.F_IMMOBILISATION;
GO
