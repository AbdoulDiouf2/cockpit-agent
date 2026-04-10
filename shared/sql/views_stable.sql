-- =============================================================================
-- COCKPIT AGENT — views_stable.sql
-- Vues BI sans dépendance de version Sage : compatibles v15 → v24.
-- Watermark_Sync = alias sur cbMarq (curseur de synchronisation incrémentale).
-- =============================================================================

-- Supprimer et recréer pour garantir la cohérence après mise à jour de l'agent
IF OBJECT_ID('dbo.VW_GRAND_LIVRE_GENERAL', 'V') IS NOT NULL DROP VIEW dbo.VW_GRAND_LIVRE_GENERAL;
GO
CREATE VIEW dbo.VW_GRAND_LIVRE_GENERAL AS
SELECT
    EC.cbMarq                                       AS Watermark_Sync,
    EC.EC_Piece                                     AS Num_Piece,
    EC.EC_Date                                      AS Date_Ecriture,
    EC.EC_Compte                                    AS Compte_General,
    CG.CG_Intitule                                  AS Intitule_Compte,
    EC.EC_Libelle                                   AS Libelle,
    EC.EC_Montant                                   AS Montant,
    EC.EC_Sens                                      AS Sens,           -- 0=Débit 1=Crédit
    CASE EC.EC_Sens WHEN 0 THEN EC.EC_Montant ELSE 0 END AS Debit,
    CASE EC.EC_Sens WHEN 1 THEN EC.EC_Montant ELSE 0 END AS Credit,
    EC.JO_Num                                       AS Code_Journal,
    JO.JO_Intitule                                  AS Libelle_Journal,
    EC.EC_RefPiece                                  AS Ref_Piece,
    EC.EC_Echeance                                  AS Echeance,
    EC.EC_No                                        AS No_Ecriture,
    YEAR(EC.EC_Date)                                AS Annee,
    MONTH(EC.EC_Date)                               AS Mois
FROM  dbo.F_ECRITUREC EC
LEFT  JOIN dbo.F_COMPTEG  CG ON CG.CG_Num  = EC.EC_Compte
LEFT  JOIN dbo.F_JOURNAUX JO ON JO.JO_Num  = EC.JO_Num;
GO

-- ---------------------------------------------------------------------------
IF OBJECT_ID('dbo.VW_FINANCE_GENERAL', 'V') IS NOT NULL DROP VIEW dbo.VW_FINANCE_GENERAL;
GO
CREATE VIEW dbo.VW_FINANCE_GENERAL AS
SELECT
    EC.cbMarq                                       AS Watermark_Sync,
    EC.EC_Compte                                    AS Compte,
    CG.CG_Intitule                                  AS Intitule_Compte,
    YEAR(EC.EC_Date)                                AS Annee,
    MONTH(EC.EC_Date)                               AS Mois,
    SUM(CASE EC.EC_Sens WHEN 0 THEN EC.EC_Montant ELSE -EC.EC_Montant END) AS Solde_Net,
    SUM(CASE EC.EC_Sens WHEN 0 THEN EC.EC_Montant ELSE 0 END)              AS Total_Debit,
    SUM(CASE EC.EC_Sens WHEN 1 THEN EC.EC_Montant ELSE 0 END)              AS Total_Credit,
    COUNT(*)                                        AS Nb_Ecritures
FROM  dbo.F_ECRITUREC EC
LEFT  JOIN dbo.F_COMPTEG CG ON CG.CG_Num = EC.EC_Compte
GROUP BY EC.EC_Compte, CG.CG_Intitule, YEAR(EC.EC_Date), MONTH(EC.EC_Date), EC.cbMarq;
GO

-- ---------------------------------------------------------------------------
IF OBJECT_ID('dbo.VW_TRESORERIE', 'V') IS NOT NULL DROP VIEW dbo.VW_TRESORERIE;
GO
CREATE VIEW dbo.VW_TRESORERIE AS
WITH base AS (
    SELECT
        ec.EC_No,
        ec.EC_Date,
        ec.CG_Num,
        cg.CG_Intitule,
        ec.EC_Piece,
        ec.EC_Intitule                                          AS Libelle_Operation,
        ec.CT_Num,
        ct.CT_Intitule                                         AS Nom_Tiers,
        ec.EC_Montant,
        ec.EC_Sens,
        CASE ec.EC_Sens WHEN 0 THEN 'ENTREE' WHEN 1 THEN 'SORTIE' END AS Type_Flux,
        CASE ec.EC_Sens WHEN 0 THEN ec.EC_Montant ELSE 0 END   AS Encaissement,
        CASE ec.EC_Sens WHEN 1 THEN ec.EC_Montant ELSE 0 END   AS Decaissement,
        CASE ec.EC_Sens WHEN 0 THEN ec.EC_Montant ELSE -ec.EC_Montant END AS Flux_Net,
        ec.EC_Lettrage,
        ec.cbCreateur,
        ec.cbMarq
    FROM dbo.F_ECRITUREC ec
    LEFT JOIN dbo.F_COMPTEG cg ON ec.CG_Num = cg.CG_Num
    LEFT JOIN dbo.F_COMPTET ct ON ec.CT_Num = ct.CT_Num
    WHERE LEFT(ec.CG_Num, 1) = '5'   -- comptes trésorerie
)
SELECT
    b.EC_No,
    b.EC_Date,
    b.CG_Num,
    b.CG_Intitule,
    b.EC_Piece,
    b.Libelle_Operation,
    b.CT_Num,
    b.Nom_Tiers,
    b.Encaissement,
    b.Decaissement,
    b.Flux_Net,

    -- Solde de Trésorerie Net Global
    SUM(b.Flux_Net) OVER()                                      AS Solde_Tresorerie_Net_Global,

    -- Solde par Compte Bancaire
    SUM(b.Flux_Net) OVER(PARTITION BY b.CG_Num)                AS Solde_Par_Compte,

    -- Prévisions 30 / 60 / 90 jours
    (SELECT SUM(Flux_Net) FROM base b2
     WHERE b2.CG_Num = b.CG_Num
       AND b2.EC_Date BETWEEN b.EC_Date AND DATEADD(DAY, 30, b.EC_Date)) AS Prevision_30j,
    (SELECT SUM(Flux_Net) FROM base b2
     WHERE b2.CG_Num = b.CG_Num
       AND b2.EC_Date BETWEEN b.EC_Date AND DATEADD(DAY, 60, b.EC_Date)) AS Prevision_60j,
    (SELECT SUM(Flux_Net) FROM base b2
     WHERE b2.CG_Num = b.CG_Num
       AND b2.EC_Date BETWEEN b.EC_Date AND DATEADD(DAY, 90, b.EC_Date)) AS Prevision_90j,

    -- BFR simplifié par compte
    SUM(b.Encaissement) OVER(PARTITION BY b.CG_Num)
        - SUM(b.Decaissement) OVER(PARTITION BY b.CG_Num)      AS BFR,

    -- Tableau de Flux de Trésorerie (cumul glissant)
    SUM(b.Flux_Net) OVER(
        PARTITION BY b.CG_Num ORDER BY b.EC_Date
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)       AS TFT,

    -- Triple courbe dettes/créances/tréso
    SUM(b.Flux_Net) OVER(
        PARTITION BY b.CG_Num ORDER BY b.EC_Date
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)       AS Evolution_Dettes_Creances_Treso,

    b.EC_Lettrage,
    b.cbCreateur,
    b.cbMarq                                                    AS Watermark_Sync
FROM base b;
GO

-- ---------------------------------------------------------------------------
IF OBJECT_ID('dbo.VW_CLIENTS', 'V') IS NOT NULL DROP VIEW dbo.VW_CLIENTS;
GO
CREATE VIEW dbo.VW_CLIENTS AS
SELECT
    CT.cbMarq                                       AS Watermark_Sync,
    CT.CT_Num                                       AS Code_Client,
    CT.CT_Intitule                                  AS Nom_Client,
    CT.CT_Adresse                                   AS Adresse,
    CT.CT_Complement                                AS Complement,
    CT.CT_CodePostal                                AS Code_Postal,
    CT.CT_Ville                                     AS Ville,
    CT.CT_Pays                                      AS Pays,
    CT.CT_Telephone                                 AS Telephone,
    CT.CT_Email                                     AS Email,
    CT.CT_Siret                                     AS SIRET,
    CT.CT_Sommeil                                   AS En_Sommeil,
    CT.N_CatCompta                                  AS Cat_Comptable,
    CT.CT_Encours                                   AS Encours_Autorise
FROM  dbo.F_COMPTET CT
WHERE CT.CT_Type = 0;           -- Type 0 = clients
GO

-- ---------------------------------------------------------------------------
IF OBJECT_ID('dbo.VW_FOURNISSEURS', 'V') IS NOT NULL DROP VIEW dbo.VW_FOURNISSEURS;
GO
CREATE VIEW dbo.VW_FOURNISSEURS AS
SELECT
    CT.cbMarq                                       AS Watermark_Sync,
    CT.CT_Num                                       AS Code_Fournisseur,
    CT.CT_Intitule                                  AS Nom_Fournisseur,
    CT.CT_Adresse                                   AS Adresse,
    CT.CT_Complement                                AS Complement,
    CT.CT_CodePostal                                AS Code_Postal,
    CT.CT_Ville                                     AS Ville,
    CT.CT_Pays                                      AS Pays,
    CT.CT_Telephone                                 AS Telephone,
    CT.CT_Email                                     AS Email,
    CT.CT_Siret                                     AS SIRET,
    CT.CT_Sommeil                                   AS En_Sommeil,
    CT.N_CatCompta                                  AS Cat_Comptable
FROM  dbo.F_COMPTET CT
WHERE CT.CT_Type = 1;           -- Type 1 = fournisseurs
GO

-- ---------------------------------------------------------------------------
IF OBJECT_ID('dbo.VW_ANALYTIQUE', 'V') IS NOT NULL DROP VIEW dbo.VW_ANALYTIQUE;
GO
CREATE VIEW dbo.VW_ANALYTIQUE AS
SELECT
    EA.cbMarq                                       AS Watermark_Sync,
    EA.EA_Num                                       AS Num_Ecriture,
    EA.EA_Date                                      AS Date_Ecriture,
    EA.N_Analytique                                 AS Axe_Analytique,
    EA.EA_Compte                                    AS Compte_Analytique,
    CA.CA_Intitule                                  AS Intitule_Compte,
    EA.EA_Montant                                   AS Montant,
    EA.EA_Sens                                      AS Sens,
    EA.JO_Num                                       AS Journal,
    EA.EA_Piece                                     AS Piece,
    YEAR(EA.EA_Date)                                AS Annee,
    MONTH(EA.EA_Date)                               AS Mois
FROM  dbo.F_ECRITUREA EA
LEFT  JOIN dbo.F_COMPTEA CA ON CA.CA_Num = EA.EA_Compte
                            AND CA.N_Analytique = EA.N_Analytique;
GO

-- ---------------------------------------------------------------------------
IF OBJECT_ID('dbo.VW_PAIE', 'V') IS NOT NULL DROP VIEW dbo.VW_PAIE;
GO
CREATE VIEW dbo.VW_PAIE AS
-- Paie extraite des écritures comptables de classe 6 (charges de personnel)
SELECT
    EC.cbMarq                                       AS Watermark_Sync,
    EC.EC_Compte                                    AS Compte,
    CG.CG_Intitule                                  AS Intitule,
    EC.EC_Date                                      AS Date_Ecriture,
    EC.EC_Libelle                                   AS Libelle,
    EC.EC_Montant                                   AS Montant,
    EC.EC_Sens                                      AS Sens,
    YEAR(EC.EC_Date)                                AS Annee,
    MONTH(EC.EC_Date)                               AS Mois
FROM  dbo.F_ECRITUREC EC
LEFT  JOIN dbo.F_COMPTEG CG ON CG.CG_Num = EC.EC_Compte
WHERE EC.EC_Compte LIKE '64%';  -- Charges de personnel
GO

-- ---------------------------------------------------------------------------
IF OBJECT_ID('dbo.VW_METADATA_AGENT', 'V') IS NOT NULL DROP VIEW dbo.VW_METADATA_AGENT;
GO
CREATE VIEW dbo.VW_METADATA_AGENT AS
SELECT
    0                                               AS Watermark_Sync,
    PARAM_KEY                                       AS Cle,
    PARAM_VALUE                                     AS Valeur,
    UPDATED_AT                                      AS Mis_A_Jour
FROM  dbo.PLATEFORME_PARAMS;
GO

-- ---------------------------------------------------------------------------
IF OBJECT_ID('dbo.VW_KPI_SYNTESE', 'V') IS NOT NULL DROP VIEW dbo.VW_KPI_SYNTESE;
GO
CREATE VIEW dbo.VW_KPI_SYNTESE AS
SELECT
    0                                               AS Watermark_Sync,
    YEAR(GETDATE())                                 AS Annee_Courante,
    MONTH(GETDATE())                                AS Mois_Courant,

    -- Chiffre d'affaires (comptes 70)
    (SELECT ISNULL(SUM(CASE EC_Sens WHEN 1 THEN EC_Montant ELSE -EC_Montant END), 0)
     FROM F_ECRITUREC WHERE EC_Compte LIKE '70%'
       AND YEAR(EC_Date) = YEAR(GETDATE()))         AS CA_Annee,

    -- CA mois courant
    (SELECT ISNULL(SUM(CASE EC_Sens WHEN 1 THEN EC_Montant ELSE -EC_Montant END), 0)
     FROM F_ECRITUREC WHERE EC_Compte LIKE '70%'
       AND YEAR(EC_Date) = YEAR(GETDATE())
       AND MONTH(EC_Date) = MONTH(GETDATE()))       AS CA_Mois,

    -- Charges (comptes 6)
    (SELECT ISNULL(SUM(CASE EC_Sens WHEN 0 THEN EC_Montant ELSE -EC_Montant END), 0)
     FROM F_ECRITUREC WHERE EC_Compte LIKE '6%'
       AND YEAR(EC_Date) = YEAR(GETDATE()))         AS Charges_Annee,

    -- Résultat net estimé
    (SELECT ISNULL(SUM(CASE EC_Sens WHEN 1 THEN EC_Montant ELSE -EC_Montant END), 0)
     FROM F_ECRITUREC WHERE EC_Compte LIKE '12%'
       AND YEAR(EC_Date) = YEAR(GETDATE()))         AS Resultat_Annee,

    -- Trésorerie (solde comptes 5)
    (SELECT ISNULL(SUM(CASE EC_Sens WHEN 0 THEN EC_Montant ELSE -EC_Montant END), 0)
     FROM F_ECRITUREC WHERE EC_Compte LIKE '5%')   AS Tresorerie_Solde,

    -- Nombre de clients actifs
    (SELECT COUNT(*) FROM F_COMPTET WHERE CT_Type = 0 AND CT_Sommeil = 0) AS Nb_Clients_Actifs,

    -- Nombre de fournisseurs actifs
    (SELECT COUNT(*) FROM F_COMPTET WHERE CT_Type = 1 AND CT_Sommeil = 0) AS Nb_Fournisseurs_Actifs;
GO
