-- =============================================================================
-- COCKPIT AGENT — views_v15v17.sql
-- Variantes Sage 100 v15–v17 (champs IM_ValOrigine, AS_PrixAch, pas de DO_DateLivr).
-- Déployé uniquement si detector.js détecte immoSchema = 'v15v17'.
-- =============================================================================

IF OBJECT_ID('dbo.VW_STOCKS', 'V') IS NOT NULL DROP VIEW dbo.VW_STOCKS;
GO
CREATE VIEW dbo.VW_STOCKS AS
SELECT
    AS_.cbMarq                                      AS Watermark_Sync,
    AR.AR_Ref                                       AS Ref_Article,
    AR.AR_Design                                    AS Designation,
    AR.AR_CodeFamille                               AS Famille,
    AS_.DE_No                                       AS Depot,
    AS_.AS_QteSto                                   AS Qte_Stock,
    AS_.AS_QteSto * AS_.AS_PrixAch                  AS Valeur_Stock,          -- v15/v17 : calcul manuel
    AS_.AS_PrixAch                                  AS PMP,
    AS_.AS_QteReserv                                AS Qte_Reservee,
    AS_.AS_QteCommand                               AS Qte_Commandee,
    AR.AR_PrixVen                                   AS Prix_Vente,
    AR.AR_SuiviStock                                AS Suivi_Stock,
    AR.AR_Sommeil                                   AS En_Sommeil
FROM  dbo.F_ARTSTOCK  AS_
JOIN  dbo.F_ARTICLE   AR ON AR.AR_Ref = AS_.AR_Ref;
GO

-- ---------------------------------------------------------------------------
IF OBJECT_ID('dbo.VW_COMMANDES', 'V') IS NOT NULL DROP VIEW dbo.VW_COMMANDES;
GO
CREATE VIEW dbo.VW_COMMANDES AS
SELECT
    DE.cbMarq                                       AS Watermark_Sync,
    DE.DO_Piece                                     AS Num_Document,
    DE.DO_Type                                      AS Type_Doc,
    DE.DO_Date                                      AS Date_Document,
    NULL                                            AS Date_Livraison,        -- v15/v17 : champ absent
    DE.DO_Tiers                                     AS Code_Tiers,
    CT.CT_Intitule                                  AS Nom_Tiers,
    DE.DO_TotalHT                                   AS Montant_HT,
    DE.DO_TotalTTC                                  AS Montant_TTC,
    DE.DO_TotalTVA                                  AS Montant_TVA,
    DE.DO_Statut                                    AS Statut,
    DE.DO_Ref                                       AS Ref_Client,
    YEAR(DE.DO_Date)                                AS Annee,
    MONTH(DE.DO_Date)                               AS Mois
FROM  dbo.F_DOCENTETE DE
LEFT  JOIN dbo.F_COMPTET CT ON CT.CT_Num = DE.DO_Tiers
WHERE DE.DO_Type IN (1, 2, 3, 6, 7);
GO

-- ---------------------------------------------------------------------------
IF OBJECT_ID('dbo.VW_IMMOBILISATIONS', 'V') IS NOT NULL DROP VIEW dbo.VW_IMMOBILISATIONS;
GO
CREATE VIEW dbo.VW_IMMOBILISATIONS AS
SELECT
    IM.cbMarq                                       AS Watermark_Sync,
    IM.IM_Ref                                       AS Ref_Immo,
    IM.IM_Intitule                                  AS Designation,
    IM.FA_CodeFamille                               AS Famille,
    IM.IM_ValOrigine                                AS Valeur_Acquisition,    -- v15/v17 : champ IM_ValOrigine
    IM.IM_DateAcq                                   AS Date_Acquisition,
    IM.IM_DateMes                                   AS Date_Mise_En_Service,
    IM.IM_Duree                                     AS Duree_Amort_Mois,
    IM.IM_TxDotation                                AS Taux_Dotation,
    IM.IM_VNCNet                                    AS VNC,
    IM.IM_CumAmort                                  AS Cumul_Amortissements,
    IM.IM_Cession                                   AS Date_Cession,
    IM.IM_Etat                                      AS Etat
FROM  dbo.F_IMMOBILISATION IM;
GO
