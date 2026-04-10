-- =============================================================================
-- COCKPIT AGENT — views_stable.sql
-- Vues BI déployées sur la base Sage 100 du client.
-- Définitions de référence tirées de la base BIJOU (production).
-- Compatibles Sage 100 v15 → v24 (sauf VW_KPI_SYNTESE / VW_STOCKS qui utilisent
-- AS_MontSto — champ présent depuis v21).
-- =============================================================================
-- Ordre de déploiement :
--   1. deploy_common.sql    → tables PLATEFORME_PARAMS, calendrier, mapping
--   2. views_stable.sql     → toutes les vues BI (ce fichier)
--   3. views_<version>.sql  → surcharges éventuelles (vide = non utilisé)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- VW_GRAND_LIVRE_GENERAL
-- Détail écritures comptables enrichies (calendrier + mapping BI).
-- Dépend de : dbo.calendrier, dbo.plateforme_mapping_depenses
-- ---------------------------------------------------------------------------
IF OBJECT_ID('dbo.VW_GRAND_LIVRE_GENERAL', 'V') IS NOT NULL DROP VIEW dbo.VW_GRAND_LIVRE_GENERAL;
GO
CREATE VIEW dbo.VW_GRAND_LIVRE_GENERAL AS
SELECT
    ca.*,
    ec.ec_no                                        AS id_ecriture,
    ec.ec_piece                                     AS numero_piece,
    ec.jo_num                                       AS code_journal,
    jo.jo_intitule                                  AS libelle_journal,
    jo.jo_type                                      AS type_journal,
    ec.cg_num                                       AS compte_general,
    cg.cg_intitule                                  AS libelle_compte,
    LEFT(ec.cg_num, 1)                              AS classe_compte,
    LEFT(ec.cg_num, 2)                              AS racine_2,
    LEFT(ec.cg_num, 3)                              AS racine_3,
    pl.type_classe                                  AS famille_compte,
    cg.cg_type                                      AS type_compte,
    ec.ct_num                                       AS compte_tiers,
    ct.ct_intitule                                  AS nom_tiers,
    ct.ct_type                                      AS type_tiers,
    ct.ct_classement                                AS classement_tiers,
    ct.ct_pays                                      AS pays_tiers,
    ec.ec_intitule                                  AS libelle_ecriture,
    ec.ec_montant                                   AS montant_ht,
    ec.ec_sens                                      AS sens_code,
    CASE ec.ec_sens
        WHEN 0 THEN 'debit'
        WHEN 1 THEN 'credit'
        ELSE 'inconnu'
    END                                             AS sens_libelle,
    CASE ec.ec_sens WHEN 0 THEN ec.ec_montant ELSE 0 END        AS montant_debit,
    CASE ec.ec_sens WHEN 1 THEN ec.ec_montant ELSE 0 END        AS montant_credit,
    CASE ec.ec_sens WHEN 0 THEN ec.ec_montant ELSE -ec.ec_montant END AS solde_signe,
    ec.ec_lettrage                                  AS code_lettrage,
    CASE WHEN LTRIM(RTRIM(ISNULL(ec.ec_lettrage, ''))) = '' THEN 0 ELSE 1 END AS est_lettre,
    pl.*,
    ec.cbcreateur                                   AS utilisateur_creation,
    ec.cbcreation                                   AS date_creation_saisie,
    ec.cbmodification                               AS date_modification,
    ec.cbmarq                                       AS watermark_sync
FROM dbo.f_ecriturec ec
LEFT JOIN dbo.f_compteg cg
    ON ec.cg_num = cg.cg_num
LEFT JOIN dbo.f_journaux jo
    ON ec.jo_num = jo.jo_num
LEFT JOIN dbo.f_comptet ct
    ON ec.ct_num = ct.ct_num
LEFT JOIN dbo.plateforme_mapping_depenses pl
    ON CAST(LEFT(ec.cg_num, 2) AS INT) = pl.compte_debut
LEFT JOIN dbo.calendrier ca
    ON ec.ec_date = ca.dt_jour;
GO

-- ---------------------------------------------------------------------------
-- VW_FINANCE_GENERAL
-- Agrégats financiers par compte / date avec KPIs calculés.
-- Dépend de : dbo.calendrier, dbo.plateforme_mapping_depenses
-- ---------------------------------------------------------------------------
IF OBJECT_ID('dbo.VW_FINANCE_GENERAL', 'V') IS NOT NULL DROP VIEW dbo.VW_FINANCE_GENERAL;
GO
CREATE VIEW dbo.VW_FINANCE_GENERAL AS
WITH agg AS (
    SELECT
        ec.ec_date,
        ec.cg_num,
        LEFT(ec.cg_num, 1) AS classe_compte,
        LEFT(ec.cg_num, 2) AS racine_2,
        LEFT(ec.cg_num, 3) AS racine_3,
        SUM(CASE WHEN ec.EC_Sens = 0 THEN ec.EC_Montant ELSE 0 END)              AS total_debit,
        SUM(CASE WHEN ec.EC_Sens = 1 THEN ec.EC_Montant ELSE 0 END)              AS total_credit,
        SUM(CASE WHEN ec.EC_Sens = 0 THEN ec.EC_Montant ELSE -ec.EC_Montant END) AS solde_net,
        COUNT(*)                                                                  AS nb_ecritures,
        SUM(CASE WHEN LEFT(ec.CG_Num,2)='70'
            THEN CASE ec.EC_Sens WHEN 1 THEN ec.EC_Montant ELSE -ec.EC_Montant END ELSE 0 END) AS ca_ht,
        SUM(CASE WHEN LEFT(ec.CG_Num,2)='60'
            THEN CASE ec.EC_Sens WHEN 0 THEN ec.EC_Montant ELSE -ec.EC_Montant END ELSE 0 END) AS achats,
        SUM(CASE WHEN LEFT(ec.CG_Num,2)='64'
            THEN CASE ec.EC_Sens WHEN 0 THEN ec.EC_Montant ELSE -ec.EC_Montant END ELSE 0 END) AS charges_personnel,
        SUM(CASE WHEN LEFT(ec.CG_Num,2)='68'
            THEN CASE ec.EC_Sens WHEN 0 THEN ec.EC_Montant ELSE -ec.EC_Montant END ELSE 0 END) AS dotations_amort,
        SUM(CASE WHEN LEFT(ec.CG_Num,2)='66'
            THEN CASE ec.EC_Sens WHEN 0 THEN ec.EC_Montant ELSE -ec.EC_Montant END ELSE 0 END) AS charges_financieres,
        SUM(CASE WHEN LEFT(ec.CG_Num,1)='7'
            THEN CASE ec.EC_Sens WHEN 0 THEN ec.EC_Montant ELSE -ec.EC_Montant END ELSE 0 END)
        + SUM(CASE WHEN LEFT(ec.CG_Num,1)='6'
            THEN CASE ec.EC_Sens WHEN 0 THEN ec.EC_Montant ELSE -ec.EC_Montant END ELSE 0 END) AS resultat_net
    FROM dbo.f_ecriturec ec
    GROUP BY ec.ec_date, ec.cg_num
),
kpi_calc AS (
    SELECT
        agg.*,
        ca.dt_jour,
        ca.annee,
        ca.mois,
        ca.semaine,
        ca.trimestre,
        ca.annee_mois,
        ca.annee_semaine,
        cg.cg_intitule,
        pl.type_classe,
        pl.categorie_bi,
        pl.sous_categorie,
        pl.kpi_tags,
        agg.ca_ht * 1.18 AS ca_ttc,
        agg.ca_ht - agg.achats - agg.charges_personnel AS marge_brute,
        CASE WHEN agg.ca_ht <> 0
            THEN (agg.ca_ht - agg.achats - agg.charges_personnel) * 100.0 / agg.ca_ht
            ELSE 0 END                                  AS taux_marge_brute,
        agg.ca_ht - agg.achats - agg.charges_personnel
            - (agg.dotations_amort + agg.charges_financieres) AS ebitda,
        agg.resultat_net                                AS resultat_net_comptable,
        CASE WHEN agg.ca_ht <> 0
            THEN (agg.achats + agg.charges_personnel + agg.dotations_amort + agg.charges_financieres)
                 * 100.0 / agg.ca_ht
            ELSE 0 END                                  AS ratio_charges_ca,
        LAG(agg.ca_ht) OVER (PARTITION BY agg.cg_num ORDER BY agg.ec_date) AS ca_n_1,
        SUM(agg.ca_ht) OVER (
            PARTITION BY YEAR(agg.ec_date)
            ORDER BY agg.ec_date
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        )                                               AS ca_cum_ytd
    FROM agg
    LEFT JOIN dbo.calendrier ca
        ON agg.ec_date = ca.dt_jour
    LEFT JOIN dbo.f_compteg cg
        ON agg.cg_num = cg.cg_num
    LEFT JOIN dbo.plateforme_mapping_depenses pl
        ON CAST(LEFT(agg.cg_num, 2) AS INT) = pl.compte_debut
)
SELECT
    dt_jour, annee, mois, semaine, trimestre, annee_mois, annee_semaine,
    cg_num, classe_compte, racine_2, racine_3,
    cg_intitule, type_classe, categorie_bi, sous_categorie, kpi_tags,
    total_debit, total_credit, solde_net, nb_ecritures,
    ca_ht, achats, charges_personnel, dotations_amort, charges_financieres, resultat_net,
    ca_ttc, marge_brute, taux_marge_brute, ebitda, resultat_net_comptable,
    ratio_charges_ca, ca_n_1, ca_cum_ytd,
    CASE WHEN ca_n_1 IS NULL OR ca_n_1 = 0
        THEN NULL
        ELSE (ca_ht - ca_n_1) * 100.0 / ca_n_1
    END AS variation_ca_n_vs_n1
FROM kpi_calc;
GO

-- ---------------------------------------------------------------------------
-- VW_TRESORERIE
-- Flux de trésorerie (comptes classe 5) avec soldes glissants.
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
    WHERE LEFT(ec.CG_Num, 1) = '5'
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
    SUM(b.Flux_Net) OVER ()                                    AS Solde_Tresorerie_Net_Global,
    SUM(b.Flux_Net) OVER (PARTITION BY b.CG_Num)              AS Solde_Par_Compte,
    (SELECT SUM(Flux_Net) FROM base b2
     WHERE b2.CG_Num = b.CG_Num
       AND b2.EC_Date BETWEEN b.EC_Date AND DATEADD(DAY, 30,  b.EC_Date)) AS Prevision_30j,
    (SELECT SUM(Flux_Net) FROM base b2
     WHERE b2.CG_Num = b.CG_Num
       AND b2.EC_Date BETWEEN b.EC_Date AND DATEADD(DAY, 60,  b.EC_Date)) AS Prevision_60j,
    (SELECT SUM(Flux_Net) FROM base b2
     WHERE b2.CG_Num = b.CG_Num
       AND b2.EC_Date BETWEEN b.EC_Date AND DATEADD(DAY, 90,  b.EC_Date)) AS Prevision_90j,
    SUM(b.Encaissement) OVER (PARTITION BY b.CG_Num)
        - SUM(b.Decaissement) OVER (PARTITION BY b.CG_Num)    AS BFR,
    SUM(b.Flux_Net) OVER (
        PARTITION BY b.CG_Num ORDER BY b.EC_Date
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)     AS TFT,
    SUM(b.Flux_Net) OVER (
        PARTITION BY b.CG_Num ORDER BY b.EC_Date
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)     AS Evolution_Dettes_Creances_Treso,
    b.EC_Lettrage,
    b.cbCreateur,
    b.cbMarq                                                   AS Watermark_Sync
FROM base b;
GO

-- ---------------------------------------------------------------------------
-- VW_CLIENTS
-- Créances clients agrégées : balance âgée, DSO, score risque, Pareto 20/80.
-- ---------------------------------------------------------------------------
IF OBJECT_ID('dbo.VW_CLIENTS', 'V') IS NOT NULL DROP VIEW dbo.VW_CLIENTS;
GO
CREATE VIEW dbo.VW_CLIENTS AS
WITH base AS (
    SELECT
        ec.EC_Date                                              AS ec_date,
        ec.CG_Num                                              AS cg_num,
        ec.EC_Montant                                          AS ec_montant,
        ec.EC_Sens                                             AS ec_sens,
        ec.CT_Num                                              AS ct_num,
        ct.CT_Intitule                                         AS ct_intitule,
        DATEDIFF(DAY, ec.EC_Date, GETDATE())                   AS age_jours,
        YEAR(ec.EC_Date)                                       AS annee,
        MONTH(ec.EC_Date)                                      AS mois,
        CASE WHEN LEFT(ec.CG_Num, 2) = '41'
            THEN CASE WHEN ec.EC_Sens = 0 THEN ec.EC_Montant ELSE -ec.EC_Montant END
            ELSE 0 END                                         AS creance_client,
        CASE WHEN LEFT(ec.CG_Num, 2) = '70'
            THEN CASE WHEN ec.EC_Sens = 1 THEN ec.EC_Montant ELSE -ec.EC_Montant END
            ELSE 0 END                                         AS chiffre_affaires
    FROM dbo.F_ECRITUREC ec
    LEFT JOIN dbo.F_COMPTET ct ON ec.CT_Num = ct.CT_Num
),
agg AS (
    SELECT
        ct_num,
        ct_intitule,
        MAX(annee)                                             AS annee,
        MAX(mois)                                              AS mois,
        SUM(creance_client)                                    AS encours_clients_total,
        SUM(chiffre_affaires)                                  AS chiffre_affaires,
        CASE WHEN SUM(chiffre_affaires) = 0 THEN NULL
             ELSE (SUM(creance_client) / SUM(chiffre_affaires)) * 365 END AS dso_global,
        SUM(CASE WHEN age_jours BETWEEN 0   AND 30  THEN creance_client ELSE 0 END) AS age_0_30,
        SUM(CASE WHEN age_jours BETWEEN 31  AND 60  THEN creance_client ELSE 0 END) AS age_31_60,
        SUM(CASE WHEN age_jours BETWEEN 61  AND 90  THEN creance_client ELSE 0 END) AS age_61_90,
        SUM(CASE WHEN age_jours BETWEEN 91  AND 120 THEN creance_client ELSE 0 END) AS age_91_120,
        SUM(CASE WHEN age_jours > 120              THEN creance_client ELSE 0 END) AS age_120_plus,
        CASE WHEN SUM(creance_client) = 0 THEN 0
             ELSE (SUM(CASE WHEN age_jours > 120 THEN creance_client ELSE 0 END)
                   / SUM(creance_client)) * 100 END            AS taux_impayes,
        (
            ((CASE WHEN SUM(chiffre_affaires) = 0 THEN 0
                   ELSE (SUM(creance_client) / SUM(chiffre_affaires)) * 365 END) * 0.4)
          + ((CASE WHEN SUM(creance_client) = 0 THEN 0
                   ELSE (SUM(CASE WHEN age_jours > 120 THEN creance_client ELSE 0 END)
                         / SUM(creance_client)) * 100 END) * 0.3)
          + ((CASE WHEN SUM(creance_client) = 0 THEN 0
                   ELSE (SUM(CASE WHEN age_jours > 120 THEN creance_client ELSE 0 END)
                         / SUM(creance_client)) * 100 END) * 0.2)
          + ((SUM(creance_client) / SUM(SUM(creance_client)) OVER ()) * 100 * 0.1)
        )                                                       AS score_risque_client
    FROM base
    GROUP BY ct_num, ct_intitule
),
top_clients AS (
    SELECT *, ROW_NUMBER() OVER (ORDER BY chiffre_affaires DESC) AS rank_ca
    FROM agg
),
pareto AS (
    SELECT *,
           CASE WHEN rank_ca <= CEILING(0.2 * (SELECT COUNT(*) FROM agg)) THEN 1 ELSE 0 END AS top_20_pareto
    FROM top_clients
),
churn AS (
    SELECT
        ct_num,
        CASE
            WHEN SUM(CASE WHEN annee = YEAR(GETDATE())   THEN 1 ELSE 0 END) > 0
             AND SUM(CASE WHEN annee = YEAR(GETDATE())-1 THEN 1 ELSE 0 END) > 0 THEN 'fidele'
            WHEN SUM(CASE WHEN annee = YEAR(GETDATE())-1 THEN 1 ELSE 0 END) > 0
             AND SUM(CASE WHEN annee = YEAR(GETDATE())   THEN 0 ELSE 0 END) = 0 THEN 'churn'
            ELSE 'nouveau'
        END                                                     AS statut_fidelisation
    FROM base
    GROUP BY ct_num
),
cumul_12m AS (
    SELECT ct_num, SUM(chiffre_affaires) AS cumul_facturation_12m
    FROM base
    WHERE ec_date >= DATEADD(MONTH, -12, GETDATE())
    GROUP BY ct_num
)
SELECT
    p.ct_num                                                   AS client,
    p.ct_intitule                                              AS nom_client,
    p.annee,
    p.mois,
    p.encours_clients_total,
    p.chiffre_affaires,
    p.dso_global,
    p.age_0_30,
    p.age_31_60,
    p.age_61_90,
    p.age_91_120,
    p.age_120_plus,
    p.taux_impayes,
    p.score_risque_client,
    p.top_20_pareto,
    c.statut_fidelisation                                      AS taux_fidelisation_churn,
    cu.cumul_facturation_12m                                   AS cumul_facturation_vs_solde_creances
FROM pareto p
LEFT JOIN churn    c  ON p.ct_num = c.ct_num
LEFT JOIN cumul_12m cu ON p.ct_num = cu.ct_num;
GO

-- ---------------------------------------------------------------------------
-- VW_FOURNISSEURS
-- Dettes fournisseurs : DPO, balance âgée, top 10, évolution N-1.
-- Dépend de : dbo.plateforme_mapping_depenses
-- ---------------------------------------------------------------------------
IF OBJECT_ID('dbo.VW_FOURNISSEURS', 'V') IS NOT NULL DROP VIEW dbo.VW_FOURNISSEURS;
GO
CREATE VIEW dbo.VW_FOURNISSEURS AS
WITH base AS (
    SELECT
        ec.EC_Date                                             AS ec_date,
        ec.CG_Num                                             AS cg_num,
        ec.EC_Montant                                         AS ec_montant,
        ec.EC_Sens                                            AS ec_sens,
        ec.CT_Num                                             AS ct_num,
        ct.CT_Intitule                                        AS ct_intitule,
        pl.*,
        YEAR(ec.EC_Date)                                      AS annee,
        MONTH(ec.EC_Date)                                     AS mois,
        DATEDIFF(DAY, ec.EC_Date, GETDATE())                  AS age_jours,
        LEFT(ec.CG_Num, 2)                                    AS type_depense,
        CASE WHEN LEFT(ec.CG_Num, 2) = '40'
            THEN CASE WHEN ec.EC_Sens = 1 THEN ec.EC_Montant ELSE -ec.EC_Montant END
            ELSE 0 END                                        AS dette_fournisseur,
        CASE WHEN LEFT(ec.CG_Num, 2) IN ('60', '61', '62')
            THEN CASE WHEN ec.EC_Sens = 0 THEN ec.EC_Montant ELSE -ec.EC_Montant END
            ELSE 0 END                                        AS achat_ht,
        CASE WHEN LEFT(ec.CG_Num, 3) = '451'
            THEN CASE WHEN ec.EC_Sens = 1 THEN ec.EC_Montant ELSE -ec.EC_Montant END
            ELSE 0 END                                        AS dette_groupe
    FROM dbo.F_ECRITUREC ec
    LEFT JOIN dbo.F_COMPTET ct
        ON ec.CT_Num = ct.CT_Num
    LEFT JOIN dbo.plateforme_mapping_depenses pl
        ON CAST(LEFT(ec.cg_num, 2) AS INT) = pl.compte_debut
),
agg AS (
    SELECT
        ct_num, ct_intitule, annee, mois, type_depense,
        type_classe, categorie_bi, sous_categorie, kpi_tags,
        SUM(achat_ht)                                         AS total_achats_ht_par_periode,
        SUM(dette_fournisseur)                                AS encours_fournisseurs,
        SUM(dette_groupe)                                     AS dettes_groupe,
        SUM(dette_fournisseur) - SUM(dette_groupe)            AS dettes_externes,
        SUM(CASE WHEN age_jours BETWEEN 0   AND 30  THEN dette_fournisseur ELSE 0 END) AS balance_0_30,
        SUM(CASE WHEN age_jours BETWEEN 31  AND 60  THEN dette_fournisseur ELSE 0 END) AS balance_31_60,
        SUM(CASE WHEN age_jours BETWEEN 61  AND 90  THEN dette_fournisseur ELSE 0 END) AS balance_61_90,
        SUM(CASE WHEN age_jours BETWEEN 91  AND 120 THEN dette_fournisseur ELSE 0 END) AS balance_91_120,
        SUM(CASE WHEN age_jours > 120               THEN dette_fournisseur ELSE 0 END) AS balance_120_plus,
        SUM(CASE WHEN age_jours > 0 AND dette_fournisseur > 0
                 THEN dette_fournisseur ELSE 0 END)           AS dettes_fournisseurs_echues_non_soldees,
        CASE WHEN SUM(achat_ht) = 0 THEN NULL
             ELSE (SUM(dette_fournisseur) / SUM(achat_ht)) * 365 END AS dpo_individuel
    FROM base
    GROUP BY ct_num, ct_intitule, annee, mois, type_depense,
             type_classe, categorie_bi, sous_categorie, kpi_tags
),
top_fournisseurs AS (
    SELECT *, ROW_NUMBER() OVER (ORDER BY total_achats_ht_par_periode DESC) AS rank_fournisseur
    FROM agg
),
evolution_n1 AS (
    SELECT
        ct_num, mois, annee, encours_fournisseurs,
        LAG(encours_fournisseurs) OVER (PARTITION BY ct_num, mois ORDER BY annee) AS evolution_dettes_n1
    FROM agg
)
SELECT
    t.ct_num                                                  AS fournisseur,
    t.ct_intitule                                             AS nom_fournisseur,
    t.annee, t.mois,
    t.type_depense, t.type_classe, t.categorie_bi, t.sous_categorie, t.kpi_tags,
    t.total_achats_ht_par_periode,
    t.encours_fournisseurs,
    t.dettes_groupe,
    t.dettes_externes,
    t.balance_0_30, t.balance_31_60, t.balance_61_90, t.balance_91_120, t.balance_120_plus,
    t.dettes_fournisseurs_echues_non_soldees,
    t.dpo_individuel,
    CASE WHEN rank_fournisseur <= 10 THEN 1 ELSE 0 END        AS top_10_fournisseurs,
    e.evolution_dettes_n1,
    CASE WHEN e.evolution_dettes_n1 IS NULL THEN NULL
         ELSE t.encours_fournisseurs - e.evolution_dettes_n1 END AS variation_dettes_yoy
FROM top_fournisseurs t
LEFT JOIN evolution_n1 e
    ON t.ct_num = e.ct_num AND t.annee = e.annee AND t.mois = e.mois;
GO

-- ---------------------------------------------------------------------------
-- VW_ANALYTIQUE
-- Écritures analytiques enrichies (code axe, section, catégorie BI).
-- ---------------------------------------------------------------------------
IF OBJECT_ID('dbo.VW_ANALYTIQUE', 'V') IS NOT NULL DROP VIEW dbo.VW_ANALYTIQUE;
GO
CREATE VIEW dbo.VW_ANALYTIQUE AS
SELECT
    ea.EC_No                                                AS [ID_Ecriture_Comptable],
    ea.N_Analytique                                         AS [N_Analytique],
    ea.EA_Ligne                                             AS [Ligne_Analytique],
    ec.EC_Date                                              AS [Date_Analytique],
    YEAR(ec.EC_Date)                                        AS [Annee],
    MONTH(ec.EC_Date)                                       AS [Mois],
    FORMAT(ec.EC_Date, 'yyyy-MM')                           AS [Periode],
    ec.CG_Num                                               AS [Compte_General],
    cg.CG_Intitule                                          AS [Libelle_Compte],
    ea.CA_Num                                               AS [Compte_Analytique],
    LEFT(ea.CA_Num, 1)                                      AS [Code_Axe],
    ca.CA_Intitule                                          AS [Libelle_Analytique],
    ec.JO_Num                                               AS [Code_Journal],
    jo.JO_Intitule                                          AS [Libelle_Journal],
    ea.EA_Montant                                           AS [Montant],
    ea.EA_Quantite                                          AS [Quantite],
    ec.EC_Sens                                              AS [Sens_Code],
    CASE ec.EC_Sens WHEN 0 THEN 'DEBIT' WHEN 1 THEN 'CREDIT' ELSE 'INCONNU' END AS [Sens_Libelle],
    CASE ec.EC_Sens WHEN 0 THEN ea.EA_Montant ELSE 0 END    AS [Debit],
    CASE ec.EC_Sens WHEN 1 THEN ea.EA_Montant ELSE 0 END    AS [Credit],
    CASE ec.EC_Sens WHEN 0 THEN ea.EA_Montant ELSE -ea.EA_Montant END AS [Solde_Signe],
    CASE LEFT(ec.CG_Num, 2)
        WHEN '60' THEN 'ACHATS'              WHEN '61' THEN 'SERVICES_EXTERNES'
        WHEN '62' THEN 'AUTRES_SERVICES'     WHEN '63' THEN 'IMPOTS_TAXES'
        WHEN '64' THEN 'CHARGES_PERSONNEL'   WHEN '65' THEN 'AUTRES_CHARGES'
        WHEN '66' THEN 'CHARGES_FINANCIERES' WHEN '67' THEN 'CHARGES_EXCEPTION'
        WHEN '68' THEN 'DOTATIONS_AMORT'     WHEN '70' THEN 'CHIFFRE_AFFAIRES'
        WHEN '71' THEN 'PROD_STOCKEE'        WHEN '72' THEN 'PROD_IMMOBILISEE'
        WHEN '74' THEN 'SUBVENTIONS'         WHEN '75' THEN 'AUTRES_PRODUITS'
        WHEN '76' THEN 'PRODUITS_FINANCIERS' WHEN '77' THEN 'PRODUITS_EXCEPTION'
        ELSE NULL
    END                                                     AS [Categorie_BI],
    ea.cbMarq                                               AS [Watermark_Sync]
FROM dbo.F_ECRITUREA ea
INNER JOIN dbo.F_ECRITUREC ec ON ea.EC_No = ec.EC_No
LEFT  JOIN dbo.F_COMPTEG   cg ON ec.CG_Num = cg.CG_Num
LEFT  JOIN dbo.F_COMPTEA   ca ON ea.CA_Num = ca.CA_Num
LEFT  JOIN dbo.F_JOURNAUX  jo ON ec.JO_Num = jo.JO_Num;
GO

-- ---------------------------------------------------------------------------
-- VW_PAIE
-- Vue paie — stub vide (Sage 100 ne stocke pas la paie en standard).
-- Structure à compléter si module paie présent.
-- ---------------------------------------------------------------------------
IF OBJECT_ID('dbo.VW_PAIE', 'V') IS NOT NULL DROP VIEW dbo.VW_PAIE;
GO
CREATE VIEW dbo.VW_PAIE AS
SELECT
    CAST(NULL AS VARCHAR(20))   AS [Matricule],
    CAST(NULL AS VARCHAR(100))  AS [Nom_Complet],
    CAST(NULL AS DATE)          AS [Date_Paie],
    CAST(NULL AS INT)           AS [Annee],
    CAST(NULL AS INT)           AS [Mois],
    CAST(NULL AS VARCHAR(7))    AS [Periode],
    CAST(NULL AS NUMERIC(15,2)) AS [Salaire_Brut],
    CAST(NULL AS NUMERIC(15,2)) AS [Net_A_Payer],
    CAST(NULL AS NUMERIC(15,2)) AS [Cotisations_Patronales],
    CAST(NULL AS NUMERIC(15,2)) AS [Cout_Total_Employeur],
    CAST(NULL AS INT)           AS [Watermark_Sync]
WHERE 1 = 0;
GO

-- ---------------------------------------------------------------------------
-- VW_METADATA_AGENT
-- Statistiques des tables sources Sage (lignes, dates min/max, watermarks).
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

-- ---------------------------------------------------------------------------
-- VW_KPI_SYNTESE
-- Synthèse KPI globaux : CA, trésorerie, créances, dettes, stocks, BFR.
-- ---------------------------------------------------------------------------
IF OBJECT_ID('dbo.VW_KPI_SYNTESE', 'V') IS NOT NULL DROP VIEW dbo.VW_KPI_SYNTESE;
GO
CREATE VIEW dbo.VW_KPI_SYNTESE AS
WITH CA_Stats AS (
    SELECT
        SUM(CASE WHEN YEAR(EC_Date) = YEAR(GETDATE())   AND EC_Sens = 1 THEN EC_Montant ELSE 0 END)   AS CA_N,
        SUM(CASE WHEN YEAR(EC_Date) = YEAR(GETDATE())-1 AND EC_Sens = 1 THEN EC_Montant ELSE 0 END)   AS CA_N1,
        SUM(CASE WHEN YEAR(EC_Date) = YEAR(GETDATE()) AND MONTH(EC_Date) = MONTH(GETDATE())
                  AND EC_Sens = 1 THEN EC_Montant ELSE 0 END)                                         AS CA_Mois
    FROM dbo.F_ECRITUREC WHERE LEFT(CG_Num, 2) = '70'
),
Tresorerie AS (
    SELECT SUM(CASE WHEN EC_Sens = 0 THEN EC_Montant ELSE -EC_Montant END) AS Solde
    FROM dbo.F_ECRITUREC WHERE LEFT(CG_Num, 1) = '5'
),
Creances AS (
    SELECT
        SUM(CASE WHEN LTRIM(RTRIM(ISNULL(EC_Lettrage, ''))) = '' AND EC_Sens = 0
                 THEN EC_Montant ELSE 0 END)                                                          AS Total,
        SUM(CASE WHEN LTRIM(RTRIM(ISNULL(EC_Lettrage, ''))) = '' AND EC_Sens = 0
                  AND DATEDIFF(DAY, EC_Date, GETDATE()) > 30
                 THEN EC_Montant ELSE 0 END)                                                          AS Retard
    FROM dbo.F_ECRITUREC WHERE LEFT(CG_Num, 2) = '41'
),
Dettes AS (
    SELECT SUM(CASE WHEN LTRIM(RTRIM(ISNULL(EC_Lettrage, ''))) = '' AND EC_Sens = 1
                    THEN EC_Montant ELSE 0 END) AS Total
    FROM dbo.F_ECRITUREC WHERE LEFT(CG_Num, 2) = '40'
),
Stocks AS (
    SELECT
        SUM(AS_MontSto)                          AS Valeur,
        COUNT(CASE WHEN AS_QteSto <= 0 THEN 1 END) AS Ruptures
    FROM dbo.F_ARTSTOCK
)
SELECT
    GETDATE()                                               AS [Timestamp_Calcul],
    YEAR(GETDATE())                                         AS [Annee_Courante],
    MONTH(GETDATE())                                        AS [Mois_Courant],
    ca.CA_N                                                 AS [CA_Annuel_N],
    ca.CA_N1                                                AS [CA_Annuel_N1],
    CASE WHEN ca.CA_N1 > 0
        THEN ROUND((ca.CA_N - ca.CA_N1) / ca.CA_N1 * 100, 2)
        ELSE NULL END                                       AS [Croissance_CA_Pct],
    ca.CA_Mois                                              AS [CA_Mois_Courant],
    tr.Solde                                                AS [Solde_Tresorerie],
    cr.Total                                                AS [Creances_Clients],
    cr.Retard                                               AS [Creances_En_Retard],
    CASE WHEN cr.Total > 0 THEN ROUND(cr.Retard / cr.Total * 100, 2) ELSE 0 END AS [Pct_Creances_Retard],
    de.Total                                                AS [Dettes_Fournisseurs],
    st.Valeur                                               AS [Valeur_Stock],
    st.Ruptures                                             AS [Articles_En_Rupture],
    cr.Total + ISNULL(st.Valeur, 0) - de.Total              AS [BFR_Estime]
FROM CA_Stats ca, Tresorerie tr, Creances cr, Dettes de, Stocks st;
GO

-- ---------------------------------------------------------------------------
-- VW_Finances_Clients_Flat
-- Factures clients (types 6/7) — vue plate pour analyses croisées.
-- ---------------------------------------------------------------------------
IF OBJECT_ID('dbo.VW_Finances_Clients_Flat', 'V') IS NOT NULL DROP VIEW dbo.VW_Finances_Clients_Flat;
GO
CREATE VIEW dbo.VW_Finances_Clients_Flat AS
SELECT
    DO_Piece                        AS Numero_Piece,
    DO_Date                         AS Date_Facture,
    YEAR(DO_Date)                   AS Exercice,
    CASE
        WHEN DO_Type = 6 THEN 'FA'
        WHEN DO_Type = 7 THEN 'FD'
    END                             AS Type_Piece,
    DO_TotalHT                      AS Montant_HT,
    DO_TotalTTC                     AS Montant_TTC,
    DO_Tiers                        AS Code_Client
FROM dbo.F_DOCENTETE
WHERE DO_Type IN (6, 7);
GO

-- ---------------------------------------------------------------------------
-- VW_STOCKS
-- Stocks articles par dépôt avec statut (OK / ALERTE / RUPTURE).
-- ---------------------------------------------------------------------------
IF OBJECT_ID('dbo.VW_STOCKS', 'V') IS NOT NULL DROP VIEW dbo.VW_STOCKS;
GO
CREATE VIEW dbo.VW_STOCKS AS
SELECT
    a.AR_Ref                                                AS [Reference_Article],
    a.AR_Design                                             AS [Designation],
    a.FA_CodeFamille                                        AS [Code_Famille],
    fa.FA_Intitule                                          AS [Libelle_Famille],
    a.AR_PrixVen                                            AS [Prix_Vente_HT],
    a.AR_PrixAch                                            AS [Cout_Achat_Article],
    a.AR_Coef                                               AS [Coefficient],
    CASE WHEN a.AR_PrixAch > 0
         THEN ROUND((a.AR_PrixVen - a.AR_PrixAch) / a.AR_PrixAch * 100, 2)
         ELSE NULL END                                      AS [Taux_Marge_Pct],
    s.DE_No                                                 AS [Code_Depot],
    dep.DE_Intitule                                         AS [Libelle_Depot],
    s.AS_QteSto                                             AS [Quantite_Stock],
    s.AS_QteMini                                            AS [Stock_Minimum],
    s.AS_QteMaxi                                            AS [Stock_Maximum],
    s.AS_MontSto                                            AS [Valeur_Stock],
    s.AS_QteRes                                             AS [Qte_Reservee],
    s.AS_QteCom                                             AS [Qte_Commandee],
    CASE
        WHEN s.AS_QteSto <= 0            THEN 'RUPTURE'
        WHEN s.AS_QteSto <= s.AS_QteMini THEN 'ALERTE'
        WHEN s.AS_QteSto <= s.AS_QteMini * 1.2 THEN 'FAIBLE'
        ELSE 'OK'
    END                                                     AS [Statut_Stock],
    a.AR_UniteVen                                           AS [Unite_Vente],
    a.AR_Sommeil                                            AS [Est_Sommeil],
    a.cbMarq                                                AS [Watermark_Sync]
FROM dbo.F_ARTICLE a
LEFT JOIN dbo.F_ARTSTOCK s  ON a.AR_Ref = s.AR_Ref
LEFT JOIN dbo.F_FAMILLE  fa ON a.FA_CodeFamille = fa.FA_CodeFamille
LEFT JOIN dbo.F_DEPOT    dep ON s.DE_No = dep.DE_No
WHERE ISNULL(a.AR_Sommeil, 0) = 0;
GO

-- ---------------------------------------------------------------------------
-- VW_STOCKS_LOGISTIQUE
-- Mouvements stocks issus des lignes de documents commerciaux.
-- ---------------------------------------------------------------------------
IF OBJECT_ID('dbo.VW_STOCKS_LOGISTIQUE', 'V') IS NOT NULL DROP VIEW dbo.VW_STOCKS_LOGISTIQUE;
GO
CREATE VIEW dbo.VW_STOCKS_LOGISTIQUE AS
SELECT
    dl.AR_Ref                                               AS [ar_ref],
    a.AR_Design                                             AS [Designation],
    a.FA_CodeFamille                                        AS [Code_Famille],
    dl.DE_No                                                AS [Code_Depot],
    dep.DE_Intitule                                         AS [Libelle_Depot],
    de.DO_Piece                                             AS [N_Piece],
    de.DO_Date                                              AS [Date_Document],
    de.DO_Type                                              AS [Type_Document],
    CASE de.DO_Type
        WHEN 3  THEN 'BON_LIVRAISON'
        WHEN 13 THEN 'BON_RECEPTION'
        WHEN 6  THEN 'FACTURE'
        WHEN 16 THEN 'FACTURE_ACHAT'
        ELSE 'AUTRE'
    END                                                     AS [Type_Libelle],
    CASE WHEN de.DO_Type BETWEEN 0  AND 9  THEN 'SORTIE'
         WHEN de.DO_Type BETWEEN 10 AND 19 THEN 'ENTREE'
         ELSE 'INTERNE' END                                 AS [Sens_Mouvement],
    de.DO_Tiers                                             AS [Code_Tiers],
    ct.CT_Intitule                                          AS [Nom_Tiers],
    dl.DL_Qte                                               AS [Quantite],
    dl.DL_PrixUnitaire                                      AS [Prix_Unitaire],
    dl.DL_MontantHT                                         AS [Montant_HT],
    YEAR(de.DO_Date)                                        AS [Annee],
    MONTH(de.DO_Date)                                       AS [Mois],
    FORMAT(de.DO_Date, 'yyyy-MM')                           AS [Periode],
    dl.cbMarq                                               AS [Watermark_Sync]
FROM dbo.F_DOCLIGNE dl
INNER JOIN dbo.F_DOCENTETE de  ON dl.DO_Piece = de.DO_Piece AND dl.DO_Type = de.DO_Type
LEFT  JOIN dbo.F_ARTICLE   a   ON dl.AR_Ref   = a.AR_Ref
LEFT  JOIN dbo.F_COMPTET   ct  ON de.DO_Tiers = ct.CT_Num
LEFT  JOIN dbo.F_DEPOT     dep ON dl.DE_No    = dep.DE_No
WHERE dl.AR_Ref IS NOT NULL AND dl.AR_Ref != '';
GO

-- ---------------------------------------------------------------------------
-- VW_COMMANDES
-- Documents commerciaux (devis, commandes, BL, factures, achats...).
-- ---------------------------------------------------------------------------
IF OBJECT_ID('dbo.VW_COMMANDES', 'V') IS NOT NULL DROP VIEW dbo.VW_COMMANDES;
GO
CREATE VIEW dbo.VW_COMMANDES AS
SELECT
    de.DO_Piece                                             AS [N_Piece],
    de.DO_Date                                              AS [Date_Document],
    YEAR(de.DO_Date)                                        AS [Annee],
    MONTH(de.DO_Date)                                       AS [Mois],
    FORMAT(de.DO_Date, 'yyyy-MM')                           AS [Periode],
    de.DO_Type                                              AS [Type_Code],
    CASE de.DO_Type
        WHEN 0  THEN 'DEVIS'               WHEN 1  THEN 'COMMANDE_CLIENT'
        WHEN 2  THEN 'BON_PREPARATION'     WHEN 3  THEN 'BON_LIVRAISON'
        WHEN 4  THEN 'BON_RETOUR'          WHEN 5  THEN 'BON_AVOIR'
        WHEN 6  THEN 'FACTURE'             WHEN 7  THEN 'FACTURE_COMPTABILISEE'
        WHEN 11 THEN 'COMMANDE_FOURNISSEUR' WHEN 13 THEN 'BON_RECEPTION'
        WHEN 16 THEN 'FACTURE_ACHAT'       WHEN 17 THEN 'FACTURE_ACHAT_COMPTAB'
        ELSE 'AUTRE'
    END                                                     AS [Type_Libelle],
    CASE WHEN de.DO_Type BETWEEN 0  AND 9  THEN 'VENTE'
         WHEN de.DO_Type BETWEEN 10 AND 19 THEN 'ACHAT'
         ELSE 'INTERNE' END                                 AS [Sens_Commercial],
    de.DO_Tiers                                             AS [Code_Tiers],
    ct.CT_Intitule                                          AS [Nom_Tiers],
    ct.CT_Classement                                        AS [Classement_Tiers],
    ct.CT_Pays                                              AS [Pays_Tiers],
    de.DO_TotalHT                                           AS [Total_HT],
    de.DO_TotalTTC                                          AS [Total_TTC],
    de.DO_TotalTTC - de.DO_TotalHT                          AS [Total_TVA],
    de.DO_Statut                                            AS [Statut_Code],
    CASE de.DO_Statut
        WHEN 0 THEN 'EN_COURS' WHEN 1 THEN 'CLOTURE' WHEN 2 THEN 'TRANSFERE' ELSE 'AUTRE'
    END                                                     AS [Statut_Libelle],
    de.DO_DateLivr                                          AS [Date_Livraison_Prevue],
    DATEDIFF(DAY, de.DO_Date, GETDATE())                    AS [Age_Jours],
    de.cbCreateur                                           AS [Operateur],
    de.cbCreation                                           AS [Date_Saisie],
    de.cbMarq                                               AS [Watermark_Sync]
FROM dbo.F_DOCENTETE de
LEFT JOIN dbo.F_COMPTET ct ON de.DO_Tiers = ct.CT_Num;
GO

-- ---------------------------------------------------------------------------
-- VW_IMMOBILISATIONS
-- Immobilisations avec amortissements cumulés et VNC.
-- ---------------------------------------------------------------------------
IF OBJECT_ID('dbo.VW_IMMOBILISATIONS', 'V') IS NOT NULL DROP VIEW dbo.VW_IMMOBILISATIONS;
GO
CREATE VIEW dbo.VW_IMMOBILISATIONS AS
SELECT
    im.IM_Code                                              AS [Code_Immobilisation],
    im.IM_Intitule                                          AS [Designation],
    im.IM_Complement                                        AS [Complement],
    im.FA_CodeFamille                                       AS [Code_Famille],
    fi.FA_Intitule                                          AS [Libelle_Famille],
    im.CT_Num                                               AS [Code_Fournisseur],
    im.CG_Num                                               AS [Compte_Immo],
    im.IM_DateAcq                                           AS [Date_Acquisition],
    im.IM_DateServ                                          AS [Date_Mise_En_Service],
    YEAR(im.IM_DateAcq)                                     AS [Annee_Acquisition],
    im.IM_ValAcq                                            AS [Valeur_Acquisition],
    im.IM_DotEco                                            AS [Dotations_Eco_Cumul],
    im.IM_DotFiscal                                         AS [Dotations_Fiscal_Cumul],
    im.IM_ValAcq - im.IM_DotEco                             AS [Valeur_Nette_Comptable],
    CASE WHEN im.IM_ValAcq > 0
         THEN ROUND(im.IM_DotEco / im.IM_ValAcq * 100, 2)
         ELSE 0 END                                         AS [Taux_Amort_Cumul_Pct],
    im.IM_ModeAmort01                                       AS [Mode_Amort_Code],
    CASE im.IM_ModeAmort01
        WHEN 0 THEN 'LINEAIRE' WHEN 1 THEN 'DEGRESSIF' WHEN 2 THEN 'EXCEPTIONNEL' ELSE 'AUTRE'
    END                                                     AS [Mode_Amort_Libelle],
    im.IM_NbAnnee01                                         AS [Duree_Annees],
    im.IM_NbMois01                                          AS [Duree_Mois_Compl],
    im.IM_NbAnnee01 * 12 + im.IM_NbMois01                  AS [Duree_Totale_Mois],
    im.IM_Etat                                              AS [Etat_Code],
    CASE im.IM_Etat
        WHEN 0 THEN 'EN_SERVICE' WHEN 1 THEN 'CEDE' WHEN 2 THEN 'REBUT' ELSE 'INCONNU'
    END                                                     AS [Etat_Libelle],
    im.IM_Quantite                                          AS [Quantite],
    im.IM_Observation                                       AS [Observation],
    ia.IA_TypeAmo                                           AS [Type_Amort],
    ia.IA_Annee                                             AS [Annee_Amort],
    ia.IA_Taux                                              AS [Taux_Amort_Annee],
    im.cbMarq                                               AS [Watermark_Sync]
FROM dbo.F_IMMOBILISATION im
LEFT JOIN dbo.F_FAMILLEIMMO fi ON im.FA_CodeFamille = fi.FA_CodeFamille
LEFT JOIN dbo.F_IMMOAMORT   ia ON im.IM_Code = ia.IM_Code;
GO
