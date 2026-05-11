-- =============================================================================
-- COCKPIT AGENT — views_stable.sql
-- Vues BI déployées sur la base Sage 100 du client.
-- Aligné sur DEPLOY_PLATEFORME_SAGE100_v1.1.sql
-- Compatibles Sage 100 v15 → v24.
-- =============================================================================
-- Ordre de déploiement :
--   1. deploy_common.sql    → tables PLATEFORME_PARAMS, calendrier, mapping, index
--   2. views_stable.sql     → toutes les vues BI + SP_AGENT_SYNC (ce fichier)
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
    ec.ec_no                                                    AS id_ecriture,
    ec.ec_piece                                                 AS numero_piece,
    ec.jo_num                                                   AS code_journal,
    jo.jo_intitule                                              AS libelle_journal,
    jo.jo_type                                                  AS type_journal,
    ec.cg_num                                                   AS compte_general,
    cg.cg_intitule                                              AS libelle_compte,
    LEFT(ec.cg_num, 1)                                          AS classe_compte,
    LEFT(ec.cg_num, 2)                                          AS racine_2,
    LEFT(ec.cg_num, 3)                                          AS racine_3,
    pl.type_classe                                              AS famille_compte,
    cg.cg_type                                                  AS type_compte,
    ec.ct_num                                                   AS compte_tiers,
    ct.ct_intitule                                              AS nom_tiers,
    ct.ct_type                                                  AS type_tiers,
    ct.ct_classement                                            AS classement_tiers,
    ct.ct_pays                                                  AS pays_tiers,
    ec.ec_intitule                                              AS libelle_ecriture,
    ec.ec_montant                                               AS montant_ht,
    ec.ec_sens                                                  AS sens_code,
    CASE ec.ec_sens
        WHEN 0 THEN 'debit'
        WHEN 1 THEN 'credit'
        ELSE 'inconnu'
    END                                                         AS sens_libelle,
    CASE ec.ec_sens WHEN 0 THEN ec.ec_montant ELSE 0 END        AS montant_debit,
    CASE ec.ec_sens WHEN 1 THEN ec.ec_montant ELSE 0 END        AS montant_credit,
    CASE ec.ec_sens WHEN 0 THEN ec.ec_montant ELSE -ec.ec_montant END AS solde_signe,
    ec.ec_lettrage                                              AS code_lettrage,
    CASE WHEN LTRIM(RTRIM(ISNULL(ec.ec_lettrage, ''))) = '' THEN 0 ELSE 1 END AS est_lettre,
    pl.*,
    ec.cbcreateur                                               AS utilisateur_creation,
    ec.cbcreation                                               AS date_creation_saisie,
    ec.cbmodification                                           AS date_modification,
    ec.cbmarq                                                   AS watermark_sync
FROM dbo.f_ecriturec ec
LEFT JOIN dbo.f_compteg cg
    ON ec.cg_num = cg.cg_num
LEFT JOIN dbo.f_journaux jo
    ON ec.jo_num = jo.jo_num
LEFT JOIN dbo.f_comptet ct
    ON ec.ct_num = ct.ct_num
LEFT JOIN dbo.plateforme_mapping_depenses pl
    ON CAST(LEFT(ec.cg_num, 2) AS INT) = CAST(pl.compte_debut AS INT)
LEFT JOIN dbo.calendrier ca
    ON ec.ec_date = ca.dt_jour;
GO

-- ---------------------------------------------------------------------------
-- VW_FINANCE_GENERAL
-- Agrégats financiers par compte / date avec KPIs calculés.
-- Réécrite directement sur F_ECRITUREC (pas de dépendance à VW_GRAND_LIVRE_GENERAL).
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
        -- CA TTC = CA HT * (1 + TVA)
        agg.ca_ht * 1.18 AS ca_ttc,
        -- Marge brute
        agg.ca_ht - agg.achats - agg.charges_personnel AS marge_brute,
        CASE WHEN agg.ca_ht <> 0
            THEN (agg.ca_ht - agg.achats - agg.charges_personnel) * 100.0 / agg.ca_ht
            ELSE 0 END                                              AS taux_marge_brute,
        -- EBITDA
        agg.ca_ht - agg.achats - agg.charges_personnel
            - (agg.dotations_amort + agg.charges_financieres)      AS ebitda,
        agg.resultat_net                                            AS resultat_net_comptable,
        -- Ratio Charges / CA
        CASE WHEN agg.ca_ht <> 0
            THEN (agg.achats + agg.charges_personnel + agg.dotations_amort + agg.charges_financieres)
                 * 100.0 / agg.ca_ht
            ELSE 0 END                                              AS ratio_charges_ca,
        -- Variation CA N vs N-1
        LAG(agg.ca_ht) OVER (PARTITION BY agg.cg_num ORDER BY agg.ec_date) AS ca_n_1,
        -- CA cumul YTD
        SUM(agg.ca_ht) OVER (
            PARTITION BY YEAR(agg.ec_date)
            ORDER BY agg.ec_date
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        )                                                           AS ca_cum_ytd
    FROM agg
    LEFT JOIN dbo.calendrier ca
        ON agg.ec_date = ca.dt_jour
    LEFT JOIN dbo.f_compteg cg
        ON agg.cg_num = cg.cg_num
    LEFT JOIN dbo.plateforme_mapping_depenses pl
        ON CAST(LEFT(agg.cg_num, 2) AS INT) = CAST(pl.compte_debut AS INT)
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
        ec.EC_Intitule                                              AS Libelle_Operation,
        ec.CT_Num,
        ct.CT_Intitule                                              AS Nom_Tiers,
        ec.EC_Montant,
        ec.EC_Sens,
        CASE ec.EC_Sens WHEN 0 THEN 'ENTREE' WHEN 1 THEN 'SORTIE' END AS Type_Flux,
        CASE ec.EC_Sens WHEN 0 THEN ec.EC_Montant ELSE 0 END        AS Encaissement,
        CASE ec.EC_Sens WHEN 1 THEN ec.EC_Montant ELSE 0 END        AS Decaissement,
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
    -- Solde de Trésorerie Net Global
    SUM(b.Flux_Net) OVER ()                                         AS Solde_Tresorerie_Net_Global,
    -- Solde par Compte Bancaire
    SUM(b.Flux_Net) OVER (PARTITION BY b.CG_Num)                   AS Solde_Par_Compte,
    -- Prévision de Trésorerie 30/60/90 jours
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
    SUM(b.Encaissement) OVER (PARTITION BY b.CG_Num)
        - SUM(b.Decaissement) OVER (PARTITION BY b.CG_Num)         AS BFR,
    -- Tableau de Flux de Trésorerie Net par Compte
    SUM(b.Flux_Net) OVER (
        PARTITION BY b.CG_Num ORDER BY b.EC_Date
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)          AS TFT,
    -- Évolution Dettes / Créances / Tréso (Triple Courbe) : cumul
    SUM(b.Flux_Net) OVER (
        PARTITION BY b.CG_Num ORDER BY b.EC_Date
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)          AS Evolution_Dettes_Creances_Treso,
    b.EC_Lettrage,
    b.cbCreateur,
    b.cbMarq                                                        AS Watermark_Sync
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
        ec.EC_Date                                                  AS ec_date,
        ec.CG_Num                                                   AS cg_num,
        ec.EC_Montant                                               AS ec_montant,
        ec.EC_Sens                                                  AS ec_sens,
        ec.CT_Num                                                   AS ct_num,
        ct.CT_Intitule                                              AS ct_intitule,
        DATEDIFF(DAY, ec.EC_Date, GETDATE())                        AS age_jours,
        YEAR(ec.EC_Date)                                            AS annee,
        MONTH(ec.EC_Date)                                           AS mois,
        CASE WHEN LEFT(ec.CG_Num, 2) = '41'
            THEN CASE WHEN ec.EC_Sens = 0 THEN ec.EC_Montant ELSE -ec.EC_Montant END
            ELSE 0 END                                              AS creance_client,
        CASE WHEN LEFT(ec.CG_Num, 2) = '70'
            THEN CASE WHEN ec.EC_Sens = 1 THEN ec.EC_Montant ELSE -ec.EC_Montant END
            ELSE 0 END                                              AS chiffre_affaires
    FROM dbo.F_ECRITUREC ec
    LEFT JOIN dbo.F_COMPTET ct ON ec.CT_Num = ct.CT_Num
),
agg AS (
    SELECT
        ct_num,
        ct_intitule,
        MAX(annee)                                                  AS annee,
        MAX(mois)                                                   AS mois,
        SUM(creance_client)                                         AS encours_clients_total,
        SUM(chiffre_affaires)                                       AS chiffre_affaires,
        CASE WHEN SUM(chiffre_affaires) = 0 THEN NULL
             ELSE (SUM(creance_client) / SUM(chiffre_affaires)) * 365 END AS dso_global,
        SUM(CASE WHEN age_jours BETWEEN 0   AND 30  THEN creance_client ELSE 0 END) AS age_0_30,
        SUM(CASE WHEN age_jours BETWEEN 31  AND 60  THEN creance_client ELSE 0 END) AS age_31_60,
        SUM(CASE WHEN age_jours BETWEEN 61  AND 90  THEN creance_client ELSE 0 END) AS age_61_90,
        SUM(CASE WHEN age_jours BETWEEN 91  AND 120 THEN creance_client ELSE 0 END) AS age_91_120,
        SUM(CASE WHEN age_jours > 120               THEN creance_client ELSE 0 END) AS age_120_plus,
        CASE WHEN SUM(creance_client) = 0 THEN 0
             ELSE (SUM(CASE WHEN age_jours > 120 THEN creance_client ELSE 0 END)
                   / SUM(creance_client)) * 100 END                 AS taux_impayes,
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
        )                                                           AS score_risque_client
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
        END                                                         AS statut_fidelisation
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
    p.ct_num                                                        AS client,
    p.ct_intitule                                                   AS nom_client,
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
    c.statut_fidelisation                                           AS taux_fidelisation_churn,
    cu.cumul_facturation_12m                                        AS cumul_facturation_vs_solde_creances
FROM pareto p
LEFT JOIN churn     c  ON p.ct_num = c.ct_num
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
        ec.EC_Date                                                  AS ec_date,
        ec.CG_Num                                                   AS cg_num,
        ec.EC_Montant                                               AS ec_montant,
        ec.EC_Sens                                                  AS ec_sens,
        ec.CT_Num                                                   AS ct_num,
        ct.CT_Intitule                                              AS ct_intitule,
        pl.*,
        YEAR(ec.EC_Date)                                            AS annee,
        MONTH(ec.EC_Date)                                           AS mois,
        DATEDIFF(DAY, ec.EC_Date, GETDATE())                        AS age_jours,
        LEFT(ec.CG_Num, 2)                                          AS type_depense,
        CASE WHEN LEFT(ec.CG_Num, 2) = '40'
            THEN CASE WHEN ec.EC_Sens = 1 THEN ec.EC_Montant ELSE -ec.EC_Montant END
            ELSE 0 END                                              AS dette_fournisseur,
        CASE WHEN LEFT(ec.CG_Num, 2) IN ('60', '61', '62')
            THEN CASE WHEN ec.EC_Sens = 0 THEN ec.EC_Montant ELSE -ec.EC_Montant END
            ELSE 0 END                                              AS achat_ht,
        CASE WHEN LEFT(ec.CG_Num, 3) = '451'
            THEN CASE WHEN ec.EC_Sens = 1 THEN ec.EC_Montant ELSE -ec.EC_Montant END
            ELSE 0 END                                              AS dette_groupe
    FROM dbo.F_ECRITUREC ec
    LEFT JOIN dbo.F_COMPTET ct
        ON ec.CT_Num = ct.CT_Num
    LEFT JOIN dbo.plateforme_mapping_depenses pl
        ON CAST(LEFT(ec.cg_num, 2) AS INT) = CAST(pl.compte_debut AS INT)
),
agg AS (
    SELECT
        ct_num, ct_intitule, annee, mois, type_depense,
        type_classe, categorie_bi, sous_categorie, kpi_tags,
        SUM(achat_ht)                                               AS total_achats_ht_par_periode,
        SUM(dette_fournisseur)                                      AS encours_fournisseurs,
        SUM(dette_groupe)                                           AS dettes_groupe,
        SUM(dette_fournisseur) - SUM(dette_groupe)                  AS dettes_externes,
        SUM(CASE WHEN age_jours BETWEEN 0   AND 30  THEN dette_fournisseur ELSE 0 END) AS balance_0_30,
        SUM(CASE WHEN age_jours BETWEEN 31  AND 60  THEN dette_fournisseur ELSE 0 END) AS balance_31_60,
        SUM(CASE WHEN age_jours BETWEEN 61  AND 90  THEN dette_fournisseur ELSE 0 END) AS balance_61_90,
        SUM(CASE WHEN age_jours BETWEEN 91  AND 120 THEN dette_fournisseur ELSE 0 END) AS balance_91_120,
        SUM(CASE WHEN age_jours > 120               THEN dette_fournisseur ELSE 0 END) AS balance_120_plus,
        SUM(CASE WHEN age_jours > 0 AND dette_fournisseur > 0
                 THEN dette_fournisseur ELSE 0 END)                 AS dettes_fournisseurs_echues_non_soldees,
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
    t.ct_num                                                        AS fournisseur,
    t.ct_intitule                                                   AS nom_fournisseur,
    t.annee, t.mois,
    t.type_depense, t.type_classe, t.categorie_bi, t.sous_categorie, t.kpi_tags,
    t.total_achats_ht_par_periode,
    t.encours_fournisseurs,
    t.dettes_groupe,
    t.dettes_externes,
    t.balance_0_30, t.balance_31_60, t.balance_61_90, t.balance_91_120, t.balance_120_plus,
    t.dettes_fournisseurs_echues_non_soldees,
    t.dpo_individuel,
    CASE WHEN rank_fournisseur <= 10 THEN 1 ELSE 0 END              AS top_10_fournisseurs,
    e.evolution_dettes_n1,
    CASE WHEN e.evolution_dettes_n1 IS NULL THEN NULL
         ELSE t.encours_fournisseurs - e.evolution_dettes_n1 END    AS variation_dettes_yoy
FROM top_fournisseurs t
LEFT JOIN evolution_n1 e
    ON t.ct_num = e.ct_num AND t.annee = e.annee AND t.mois = e.mois;
GO

-- ---------------------------------------------------------------------------
-- VW_ANALYTIQUE
-- Écritures analytiques enrichies (code axe, section, catégorie BI, KPIs).
-- F_ECRITUREA vrais champs : EC_No, N_Analytique, EA_Ligne, CA_Num, EA_Montant, EA_Quantite
-- Date/sens/CG_Num/JO_Num récupérés via INNER JOIN F_ECRITUREC.
-- ---------------------------------------------------------------------------
IF OBJECT_ID('dbo.VW_ANALYTIQUE', 'V') IS NOT NULL DROP VIEW dbo.VW_ANALYTIQUE;
GO
CREATE VIEW dbo.VW_ANALYTIQUE AS
SELECT
    ea.ec_no                                                    AS id_ecriture_comptable,
    ea.n_analytique                                             AS n_analytique,
    ea.ea_ligne                                                 AS ligne_analytique,

    ec.ec_date                                                  AS date_analytique,
    YEAR(ec.ec_date)                                            AS annee,
    MONTH(ec.ec_date)                                           AS mois,
    FORMAT(ec.ec_date, 'yyyy-MM')                               AS periode,

    ec.cg_num                                                   AS compte_general,
    cg.cg_intitule                                              AS libelle_compte,

    ea.ca_num                                                   AS compte_analytique,
    LEFT(ea.ca_num, 1)                                          AS code_axe,
    ca.ca_intitule                                              AS libelle_analytique,

    ec.jo_num                                                   AS code_journal,
    jo.jo_intitule                                              AS libelle_journal,

    ea.ea_montant                                               AS montant,
    ea.ea_quantite                                              AS quantite,

    ec.ec_sens                                                  AS sens_code,
    CASE ec.ec_sens
        WHEN 0 THEN 'debit'
        WHEN 1 THEN 'credit'
        ELSE 'inconnu'
    END                                                         AS sens_libelle,

    CASE ec.ec_sens WHEN 0 THEN ea.ea_montant ELSE 0 END        AS debit,
    CASE ec.ec_sens WHEN 1 THEN ea.ea_montant ELSE 0 END        AS credit,
    CASE ec.ec_sens WHEN 0 THEN ea.ea_montant ELSE -ea.ea_montant END AS solde_signe,

    -- Catégorisation BI
    CASE LEFT(ec.cg_num, 2)
        WHEN '60' THEN 'achats'
        WHEN '61' THEN 'services_externes'
        WHEN '62' THEN 'autres_services'
        WHEN '63' THEN 'impots_taxes'
        WHEN '64' THEN 'charges_personnel'
        WHEN '65' THEN 'autres_charges'
        WHEN '66' THEN 'charges_financieres'
        WHEN '67' THEN 'charges_exception'
        WHEN '68' THEN 'dotations_amort'
        WHEN '70' THEN 'chiffre_affaires'
        WHEN '71' THEN 'prod_stockee'
        WHEN '72' THEN 'prod_immobilisee'
        WHEN '74' THEN 'subventions'
        WHEN '75' THEN 'autres_produits'
        WHEN '76' THEN 'produits_financiers'
        WHEN '77' THEN 'produits_exception'
        ELSE NULL
    END                                                         AS categorie_bi,

    -- AN-01 CA par axe
    SUM(
        CASE WHEN LEFT(ec.cg_num, 2) = '70'
            THEN CASE WHEN ec.ec_sens = 1 THEN ea.ea_montant ELSE -ea.ea_montant END
            ELSE 0 END
    ) OVER (PARTITION BY ea.ca_num)                             AS ca_par_axe,

    -- AN-02 Charges par axe
    SUM(
        CASE WHEN LEFT(ec.cg_num, 1) = '6'
            THEN CASE WHEN ec.ec_sens = 0 THEN ea.ea_montant ELSE -ea.ea_montant END
            ELSE 0 END
    ) OVER (PARTITION BY ea.ca_num)                             AS charges_par_axe,

    -- AN-03 Résultat par centre
    SUM(
        CASE WHEN LEFT(ec.cg_num, 1) = '7'
            THEN CASE WHEN ec.ec_sens = 1 THEN ea.ea_montant ELSE -ea.ea_montant END
            ELSE 0 END
    ) OVER (PARTITION BY ea.ca_num)
    + SUM(
        CASE WHEN LEFT(ec.cg_num, 1) = '6'
            THEN CASE WHEN ec.ec_sens = 0 THEN ea.ea_montant ELSE -ea.ea_montant END
            ELSE 0 END
    ) OVER (PARTITION BY ea.ca_num)                             AS resultat_par_centre,

    -- AN-04 Écart budget (placeholder — à alimenter via table budget)
    NULL                                                        AS budget,
    NULL                                                        AS ecart_budget,

    -- AN-05 CA par commercial (axe = commercial)
    SUM(
        CASE WHEN LEFT(ec.cg_num, 2) = '70'
            THEN CASE WHEN ec.ec_sens = 1 THEN ea.ea_montant ELSE -ea.ea_montant END
            ELSE 0 END
    ) OVER (PARTITION BY ea.ca_num, LEFT(ea.ca_num, 1))        AS ca_par_commercial,

    -- AN-06 CA par région
    SUM(
        CASE WHEN LEFT(ec.cg_num, 2) = '70'
            THEN CASE WHEN ec.ec_sens = 1 THEN ea.ea_montant ELSE -ea.ea_montant END
            ELSE 0 END
    ) OVER (PARTITION BY LEFT(ea.ca_num, 1))                   AS ca_par_region,

    ea.cbmarq                                                   AS watermark_sync

FROM dbo.f_ecriturea ea
INNER JOIN dbo.f_ecriturec ec
    ON ea.ec_no = ec.ec_no
LEFT JOIN dbo.f_compteg cg
    ON ec.cg_num = cg.cg_num
LEFT JOIN dbo.f_comptea ca
    ON ea.ca_num = ca.ca_num
LEFT JOIN dbo.f_journaux jo
    ON ec.jo_num = jo.jo_num;
GO

-- ---------------------------------------------------------------------------
-- VW_AUDIT_ANOMALIES
-- Détection d'anomalies comptables : z-score, doublons, Benford, hors-horaire.
-- ---------------------------------------------------------------------------
IF OBJECT_ID('dbo.VW_AUDIT_ANOMALIES', 'V') IS NOT NULL DROP VIEW dbo.VW_AUDIT_ANOMALIES;
GO
CREATE VIEW dbo.VW_AUDIT_ANOMALIES AS
WITH base AS (
    SELECT
        ec.ec_no,
        ec.ec_date,
        ec.ec_piece,
        ec.cg_num,
        ec.ct_num,
        ct.ct_intitule,
        ec.ec_montant,
        ec.ec_sens,
        ec.ec_lettrage,
        ec.cbcreation,
        ec.cbmodification,
        CASE WHEN ec.ec_sens = 0 THEN ec.ec_montant ELSE -ec.ec_montant END AS montant_signe,
        DATEPART(HOUR, ec.cbcreation)                                        AS heure_saisie
    FROM dbo.f_ecriturec ec
    LEFT JOIN dbo.f_comptet ct ON ec.ct_num = ct.ct_num
),
doublons AS (
    SELECT ec_piece, ct_num, ec_montant, COUNT(*) AS nb_occurrences
    FROM base
    GROUP BY ec_piece, ct_num, ec_montant
    HAVING COUNT(*) > 1
),
benford AS (
    SELECT ec_no, LEFT(CAST(ABS(ec_montant) AS VARCHAR), 1) AS premier_chiffre
    FROM base
),
stats AS (
    SELECT
        AVG(ABS(ec_montant))   AS moyenne,
        STDEV(ABS(ec_montant)) AS ecart_type
    FROM base
)
SELECT
    b.ec_no,
    b.ec_date,
    b.ec_piece,
    b.cg_num,
    b.ct_num,
    b.ct_intitule,
    b.ec_montant,
    b.montant_signe,
    -- AU-01 Anomaly score (z-score)
    CASE WHEN s.ecart_type = 0 THEN 0
         ELSE ABS(ABS(b.ec_montant) - s.moyenne) / s.ecart_type
    END                                                             AS anomaly_score,
    -- AU-02 Doublon facture
    CASE WHEN d.nb_occurrences IS NOT NULL THEN 1 ELSE 0 END        AS is_doublon_facture,
    -- AU-03 Transaction hors plage horaire (avant 7h ou après 20h)
    CASE WHEN b.heure_saisie < 7 OR b.heure_saisie > 20 THEN 1 ELSE 0 END AS transaction_hors_horaire,
    -- AU-04 Montant rond suspect (multiple de 1000)
    CASE WHEN b.ec_montant % 1000 = 0 THEN 1 ELSE 0 END             AS montant_rond_suspect,
    -- AU-04 Benford (chiffre 1 attendu dominant)
    CASE WHEN ben.premier_chiffre NOT IN ('1','2','3','4','5','6','7','8','9')
         THEN 1 ELSE 0 END                                          AS anomalie_benford,
    -- AU-05 Modification d'écriture lettrée
    CASE WHEN b.ec_lettrage IS NOT NULL
              AND b.cbmodification > b.cbcreation
         THEN 1 ELSE 0 END                                          AS modification_ecriture_lettree
FROM base b
LEFT JOIN doublons d
    ON b.ec_piece = d.ec_piece AND b.ct_num = d.ct_num AND b.ec_montant = d.ec_montant
LEFT JOIN benford ben
    ON b.ec_no = ben.ec_no
CROSS JOIN stats s;
GO

-- ---------------------------------------------------------------------------
-- VW_STOCKS_LOGISTIQUE
-- Articles et stocks par dépôt avec KPIs (rotation, couverture, ABC, surstock).
-- Source : F_ARTICLE + F_ARTSTOCK (stock statique, pas mouvements).
-- ---------------------------------------------------------------------------
IF OBJECT_ID('dbo.VW_STOCKS_LOGISTIQUE', 'V') IS NOT NULL DROP VIEW dbo.VW_STOCKS_LOGISTIQUE;
GO
CREATE VIEW dbo.VW_STOCKS_LOGISTIQUE AS
SELECT
    a.ar_ref                                                    AS reference_article,
    a.ar_design                                                 AS designation,
    a.fa_codefamille                                            AS code_famille,
    fa.fa_intitule                                              AS libelle_famille,
    s.de_no                                                     AS code_depot,
    dep.de_intitule                                             AS libelle_depot,
    a.ar_uniteven                                               AS unite_vente,
    s.as_qtesto                                                 AS quantite_stock,
    s.as_qtemini                                                AS stock_minimum,
    s.as_qtemaxi                                                AS stock_maximum,
    s.as_qteres                                                 AS quantite_reservee,
    s.as_qtecom                                                 AS quantite_commandee,
    s.as_montsto                                                AS valeur_stock,
    a.ar_prixach                                                AS cout_achat,
    a.ar_prixven                                                AS prix_vente,
    -- Valeur stock total PUMP
    s.as_montsto                                                AS valeur_stock_total_pump,
    -- Prix moyen pondéré
    CASE WHEN s.as_qtesto > 0 THEN s.as_montsto / s.as_qtesto END AS prix_moyen_pondere,
    -- Marge article
    a.ar_prixven - a.ar_prixach                                 AS marge_article,
    -- Taux marge %
    CASE WHEN a.ar_prixach > 0
         THEN ROUND((a.ar_prixven - a.ar_prixach) / a.ar_prixach * 100, 2)
    END                                                         AS taux_marge_pct,
    -- Marge par famille
    SUM(a.ar_prixven - a.ar_prixach) OVER (PARTITION BY a.fa_codefamille) AS marge_famille,
    -- Valorisation par dépôt
    SUM(s.as_montsto) OVER (PARTITION BY s.de_no)               AS valorisation_stock_depot,
    -- Couverture stock (ratio)
    CASE WHEN s.as_qtecom > 0 THEN ROUND(s.as_qtesto / s.as_qtecom, 2) END AS couverture_stock,
    -- Couverture stock en jours
    CASE WHEN s.as_qtecom > 0 THEN ROUND((s.as_qtesto / s.as_qtecom) * 30, 2) END AS couverture_stock_jours,
    -- Taux de rotation
    CASE WHEN s.as_qtesto > 0 THEN ROUND(s.as_qtecom / s.as_qtesto, 2) END AS taux_rotation_stock,
    -- Stock dormant (quantité sans commandes)
    CASE WHEN s.as_qtesto > 0 AND s.as_qtecom = 0 THEN s.as_montsto ELSE 0 END AS stock_dormant,
    -- Stock obsolète (article en sommeil)
    CASE WHEN a.ar_sommeil = 1 THEN s.as_montsto ELSE 0 END     AS stock_obsolete,
    -- Taux de service commandes
    CASE WHEN s.as_qtecom > 0
         THEN ROUND((s.as_qtesto / s.as_qtecom) * 100, 2)
    END                                                         AS taux_service_commandes,
    -- Statut stock
    CASE
        WHEN s.as_qtesto <= 0            THEN 'rupture'
        WHEN s.as_qtesto <= s.as_qtemini THEN 'alerte'
        WHEN s.as_qtesto <= s.as_qtemini * 1.2 THEN 'faible'
        ELSE 'ok'
    END                                                         AS statut_stock,
    -- Classification ABC par valeur
    CASE
        WHEN s.as_montsto >= 1000000 THEN 'a'
        WHEN s.as_montsto >= 200000  THEN 'b'
        ELSE 'c'
    END                                                         AS classe_abc,
    -- Surstock
    CASE WHEN s.as_qtesto > s.as_qtemaxi THEN s.as_qtesto - s.as_qtemaxi END AS surstock,
    -- Valeur surstock
    CASE WHEN s.as_qtesto > s.as_qtemaxi
         THEN (s.as_qtesto - s.as_qtemaxi) * a.ar_prixach
    END                                                         AS valeur_surstock,
    a.ar_sommeil                                                AS article_inactif,
    a.cbmarq                                                    AS watermark_sync
FROM dbo.f_article a
LEFT JOIN dbo.f_artstock s   ON a.ar_ref = s.ar_ref
LEFT JOIN dbo.f_famille  fa  ON a.fa_codefamille = fa.fa_codefamille
LEFT JOIN dbo.f_depot    dep ON s.de_no = dep.de_no
WHERE ISNULL(a.ar_sommeil, 0) = 0;
GO

-- ---------------------------------------------------------------------------
-- VW_COMMANDES
-- Documents commerciaux agrégés par tiers/période avec KPIs vente.
-- ---------------------------------------------------------------------------
IF OBJECT_ID('dbo.VW_COMMANDES', 'V') IS NOT NULL DROP VIEW dbo.VW_COMMANDES;
GO
CREATE VIEW dbo.VW_COMMANDES AS
WITH base AS (
    SELECT
        de.do_piece                                             AS n_piece,
        de.do_date                                             AS date_document,
        YEAR(de.do_date)                                       AS annee,
        MONTH(de.do_date)                                      AS mois,
        FORMAT(de.do_date, 'yyyy-MM')                          AS periode,
        de.do_type                                             AS type_code,
        CASE de.do_type
            WHEN 0  THEN 'devis'
            WHEN 1  THEN 'commande_client'
            WHEN 3  THEN 'bon_livraison'
            WHEN 5  THEN 'bon_avoir'
            WHEN 6  THEN 'facture'
            WHEN 11 THEN 'commande_fournisseur'
            WHEN 13 THEN 'bon_reception'
            WHEN 16 THEN 'facture_achat'
            ELSE 'autre'
        END                                                    AS type_libelle,
        CASE
            WHEN de.do_type BETWEEN 0  AND 9  THEN 'vente'
            WHEN de.do_type BETWEEN 10 AND 19 THEN 'achat'
            ELSE 'interne'
        END                                                    AS sens_commercial,
        de.do_tiers                                            AS code_tiers,
        ct.ct_intitule                                         AS nom_tiers,
        de.do_totalht                                          AS total_ht,
        de.do_totalttc                                         AS total_ttc,
        de.do_totalttc - de.do_totalht                         AS total_tva,
        de.do_statut                                           AS statut_code,
        de.do_datelivr                                         AS date_livraison_prevue,
        DATEDIFF(DAY, de.do_date, GETDATE())                   AS age_jours
    FROM dbo.f_docentete de
    LEFT JOIN dbo.f_comptet ct ON de.do_tiers = ct.ct_num
),
agg AS (
    SELECT
        annee, mois, code_tiers, nom_tiers,
        COUNT(*)                                               AS nb_documents,
        SUM(total_ht)                                          AS total_ca,
        -- Backlog (commandes clients non clôturées)
        SUM(CASE WHEN type_libelle = 'commande_client' AND statut_code = 0
                 THEN total_ht ELSE 0 END)                     AS backlog,
        SUM(CASE WHEN type_libelle = 'devis'           THEN 1 ELSE 0 END) AS nb_devis,
        SUM(CASE WHEN type_libelle = 'commande_client' THEN 1 ELSE 0 END) AS nb_commandes,
        SUM(CASE WHEN type_libelle = 'bon_avoir'       THEN total_ht ELSE 0 END) AS total_avoirs,
        SUM(CASE WHEN type_libelle = 'facture'         THEN total_ht ELSE 0 END) AS total_facture,
        AVG(
            CASE WHEN date_livraison_prevue IS NOT NULL
                 THEN DATEDIFF(DAY, date_document, date_livraison_prevue)
            END
        )                                                      AS delai_moyen_livraison
    FROM base
    GROUP BY annee, mois, code_tiers, nom_tiers
)
SELECT
    *,
    -- V-01 Taux de transformation devis → commande
    CASE WHEN nb_devis = 0 THEN NULL
         ELSE ROUND(nb_commandes * 1.0 / nb_devis * 100, 2)
    END                                                        AS taux_transformation_devis_commande,
    -- V-02 Backlog
    backlog                                                    AS commandes_en_cours,
    -- V-04 Ticket moyen commande
    CASE WHEN nb_commandes = 0 THEN NULL
         ELSE ROUND(total_ca * 1.0 / nb_commandes, 2)
    END                                                        AS ticket_moyen_commande,
    -- V-05 Taux de retour (avoirs / factures)
    CASE WHEN total_facture = 0 THEN NULL
         ELSE ROUND(total_avoirs * 1.0 / total_facture * 100, 2)
    END                                                        AS taux_retour_avoir
FROM agg;
GO

-- ---------------------------------------------------------------------------
-- VW_IMMOBILISATIONS
-- Immobilisations avec amortissements cumulés, VNC et KPIs parc.
-- IM_Code (clé) | IM_ValAcq | IM_DotEco | IM_Etat | IM_DateServ | IM_ModeAmort01
-- FA_CodeFamille (jointure F_FAMILLEIMMO) | F_IMMOAMORT : IM_Code, IA_TypeAmo, IA_Annee, IA_Taux
-- ---------------------------------------------------------------------------
IF OBJECT_ID('dbo.VW_IMMOBILISATIONS', 'V') IS NOT NULL DROP VIEW dbo.VW_IMMOBILISATIONS;
GO
CREATE VIEW dbo.VW_IMMOBILISATIONS AS
SELECT
    im.im_code                                                  AS code_immobilisation,
    im.im_intitule                                              AS designation,
    im.im_complement                                            AS complement,
    im.fa_codefamille                                           AS code_famille,
    fi.fa_intitule                                              AS libelle_famille,
    im.ct_num                                                   AS code_fournisseur,
    im.cg_num                                                   AS compte_immo,
    im.im_dateacq                                               AS date_acquisition,
    im.im_dateserv                                              AS date_mise_en_service,
    YEAR(im.im_dateacq)                                         AS annee_acquisition,
    im.im_valacq                                                AS valeur_acquisition,
    im.im_doteco                                                AS dotations_eco_cumul,
    im.im_dotfiscal                                             AS dotations_fiscal_cumul,
    -- VNC
    im.im_valacq - im.im_doteco                                 AS valeur_nette_comptable,
    -- Taux amort cumulé
    CASE WHEN im.im_valacq > 0
         THEN ROUND(im.im_doteco / im.im_valacq * 100, 2)
         ELSE 0 END                                             AS taux_amort_cumul_pct,
    im.im_modeamort01                                           AS mode_amort_code,
    CASE im.im_modeamort01
        WHEN 0 THEN 'lineaire'
        WHEN 1 THEN 'degressif'
        WHEN 2 THEN 'exceptionnel'
        ELSE 'autre'
    END                                                         AS mode_amort_libelle,
    im.im_nbannee01                                             AS duree_annees,
    im.im_nbmois01                                              AS duree_mois_compl,
    im.im_nbannee01 * 12 + im.im_nbmois01                      AS duree_totale_mois,
    im.im_etat                                                  AS etat_code,
    CASE im.im_etat
        WHEN 0 THEN 'en_service'
        WHEN 1 THEN 'cede'
        WHEN 2 THEN 'rebut'
        ELSE 'inconnu'
    END                                                         AS etat_libelle,
    im.im_quantite                                              AS quantite,
    ia.ia_typeamo                                               AS type_amort,
    ia.ia_annee                                                 AS annee_amort,
    ia.ia_taux                                                  AS taux_amort_annee,
    -- KPIs parc global
    -- I-01 Valeur brute totale
    SUM(im.im_valacq) OVER ()                                   AS valeur_brute_totale,
    -- I-02 VNC totale
    SUM(im.im_valacq - im.im_doteco) OVER ()                    AS vnc_totale,
    -- I-03 Taux amort moyen
    CASE WHEN SUM(im.im_valacq) OVER () = 0 THEN NULL
         ELSE ROUND(SUM(im.im_doteco) OVER () * 100.0 / SUM(im.im_valacq) OVER (), 2)
    END                                                         AS taux_amort_moyen,
    -- I-04 Dotation prévisionnelle annuelle
    CASE WHEN (im.im_nbannee01 * 12 + im.im_nbmois01) > 0
         THEN (im.im_valacq - im.im_doteco)
              / (im.im_nbannee01 * 12 + im.im_nbmois01) * 12
    END                                                         AS dotation_previsionnelle_annuelle,
    im.cbmarq                                                   AS watermark_sync
FROM dbo.f_immobilisation im
LEFT JOIN dbo.f_familleimmo fi ON im.fa_codefamille = fi.fa_codefamille
LEFT JOIN dbo.f_immoamort   ia ON im.im_code = ia.im_code;
GO

-- ---------------------------------------------------------------------------
-- VW_PAIE
-- Vue paie — placeholder (Sage 100 ne stocke pas la paie en standard).
-- Structure complète avec KPIs RH à relier via synonymes si module paie présent.
-- ---------------------------------------------------------------------------
IF OBJECT_ID('dbo.VW_PAIE', 'V') IS NOT NULL DROP VIEW dbo.VW_PAIE;
GO
CREATE VIEW dbo.VW_PAIE AS
SELECT
    CAST(NULL AS VARCHAR(20))   AS matricule,
    CAST(NULL AS VARCHAR(100))  AS nom_complet,
    CAST(NULL AS DATE)          AS date_paie,
    CAST(NULL AS INT)           AS annee,
    CAST(NULL AS INT)           AS mois,
    CAST(NULL AS VARCHAR(7))    AS periode,
    CAST(NULL AS VARCHAR(100))  AS departement,
    CAST(NULL AS NUMERIC(15,2)) AS salaire_brut,
    CAST(NULL AS NUMERIC(15,2)) AS net_a_payer,
    CAST(NULL AS NUMERIC(15,2)) AS cotisations_patronales,
    CAST(NULL AS NUMERIC(15,2)) AS cout_total_employeur,
    -- RH-01 Masse salariale totale
    SUM(CAST(NULL AS NUMERIC(15,2))) OVER ()                    AS masse_salariale_totale,
    -- RH-02 Ratio masse salariale / CA (placeholder)
    CAST(NULL AS NUMERIC(10,2))                                 AS ratio_masse_salariale_ca,
    -- RH-03 Coût moyen par collaborateur
    CASE WHEN COUNT(*) OVER () = 0 THEN NULL
         ELSE SUM(CAST(NULL AS NUMERIC(15,2))) OVER () / COUNT(*) OVER ()
    END                                                         AS cout_moyen_par_collaborateur,
    -- RH-04 Masse salariale par département
    SUM(CAST(NULL AS NUMERIC(15,2))) OVER (
        PARTITION BY CAST(NULL AS VARCHAR(100))
    )                                                           AS masse_salariale_par_departement,
    CAST(NULL AS INT)                                           AS watermark_sync
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
FROM dbo.F_ARTICLE;
GO

-- ---------------------------------------------------------------------------
-- VW_KPI_SYNTESE
-- Synthèse KPI globaux : CA, trésorerie, créances, dettes, stocks, BFR.
-- AS_MontSto (certifié INFORMATION_SCHEMA — présent depuis Sage 100 v21).
-- ---------------------------------------------------------------------------
IF OBJECT_ID('dbo.VW_KPI_SYNTESE', 'V') IS NOT NULL DROP VIEW dbo.VW_KPI_SYNTESE;
GO
CREATE VIEW dbo.VW_KPI_SYNTESE AS
WITH CA_Stats AS (
    SELECT
        SUM(CASE WHEN YEAR(EC_Date) = YEAR(GETDATE())   AND EC_Sens = 1 THEN EC_Montant ELSE 0 END) AS CA_N,
        SUM(CASE WHEN YEAR(EC_Date) = YEAR(GETDATE())-1 AND EC_Sens = 1 THEN EC_Montant ELSE 0 END) AS CA_N1,
        SUM(CASE WHEN YEAR(EC_Date) = YEAR(GETDATE()) AND MONTH(EC_Date) = MONTH(GETDATE())
                  AND EC_Sens = 1 THEN EC_Montant ELSE 0 END)                                       AS CA_Mois
    FROM dbo.F_ECRITUREC WHERE LEFT(CG_Num, 2) = '70'
),
Tresorerie AS (
    SELECT SUM(CASE WHEN EC_Sens = 0 THEN EC_Montant ELSE -EC_Montant END) AS Solde
    FROM dbo.F_ECRITUREC WHERE LEFT(CG_Num, 1) = '5'
),
Creances AS (
    SELECT
        SUM(CASE WHEN LTRIM(RTRIM(ISNULL(EC_Lettrage, ''))) = '' AND EC_Sens = 0
                 THEN EC_Montant ELSE 0 END)                                                        AS Total,
        SUM(CASE WHEN LTRIM(RTRIM(ISNULL(EC_Lettrage, ''))) = '' AND EC_Sens = 0
                  AND DATEDIFF(DAY, EC_Date, GETDATE()) > 30
                 THEN EC_Montant ELSE 0 END)                                                        AS Retard
    FROM dbo.F_ECRITUREC WHERE LEFT(CG_Num, 2) = '41'
),
Dettes AS (
    SELECT SUM(CASE WHEN LTRIM(RTRIM(ISNULL(EC_Lettrage, ''))) = '' AND EC_Sens = 1
                    THEN EC_Montant ELSE 0 END)                                                     AS Total
    FROM dbo.F_ECRITUREC WHERE LEFT(CG_Num, 2) = '40'
),
Stocks AS (
    SELECT
        SUM(AS_MontSto)                                                                             AS Valeur,
        COUNT(CASE WHEN AS_QteSto <= 0 THEN 1 END)                                                  AS Ruptures
    FROM dbo.F_ARTSTOCK
)
SELECT
    GETDATE()                                                   AS [Timestamp_Calcul],
    YEAR(GETDATE())                                             AS [Annee_Courante],
    MONTH(GETDATE())                                            AS [Mois_Courant],
    ca.CA_N                                                     AS [CA_Annuel_N],
    ca.CA_N1                                                    AS [CA_Annuel_N1],
    CASE WHEN ca.CA_N1 > 0
         THEN ROUND((ca.CA_N - ca.CA_N1) / ca.CA_N1 * 100, 2)
         ELSE NULL END                                          AS [Croissance_CA_Pct],
    ca.CA_Mois                                                  AS [CA_Mois_Courant],
    tr.Solde                                                    AS [Solde_Tresorerie],
    cr.Total                                                    AS [Creances_Clients],
    cr.Retard                                                   AS [Creances_En_Retard],
    CASE WHEN cr.Total > 0 THEN ROUND(cr.Retard / cr.Total * 100, 2) ELSE 0 END AS [Pct_Creances_Retard],
    de.Total                                                    AS [Dettes_Fournisseurs],
    st.Valeur                                                   AS [Valeur_Stock],
    st.Ruptures                                                 AS [Articles_En_Rupture],
    cr.Total + ISNULL(st.Valeur, 0) - de.Total                  AS [BFR_Estime]
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
    DO_Piece                                                    AS Numero_Piece,
    DO_Date                                                     AS Date_Facture,
    YEAR(DO_Date)                                               AS Exercice,
    CASE
        WHEN DO_Type = 6 THEN 'FA'
        WHEN DO_Type = 7 THEN 'FD'
    END                                                         AS Type_Piece,
    DO_TotalHT                                                  AS Montant_HT,
    DO_TotalTTC                                                 AS Montant_TTC,
    DO_Tiers                                                    AS Code_Client
FROM dbo.F_DOCENTETE
WHERE DO_Type IN (6, 7);
GO

-- ---------------------------------------------------------------------------
-- VW_STOCKS
-- Stocks articles par dépôt avec statut (OK / ALERTE / FAIBLE / RUPTURE).
-- Vue simplifiée — pour les KPIs étendus voir VW_STOCKS_LOGISTIQUE.
-- ---------------------------------------------------------------------------
IF OBJECT_ID('dbo.VW_STOCKS', 'V') IS NOT NULL DROP VIEW dbo.VW_STOCKS;
GO
CREATE VIEW dbo.VW_STOCKS AS
SELECT
    a.AR_Ref                                                    AS [Reference_Article],
    a.AR_Design                                                 AS [Designation],
    a.FA_CodeFamille                                            AS [Code_Famille],
    fa.FA_Intitule                                              AS [Libelle_Famille],
    a.AR_PrixVen                                                AS [Prix_Vente_HT],
    a.AR_PrixAch                                                AS [Cout_Achat_Article],
    a.AR_Coef                                                   AS [Coefficient],
    CASE WHEN a.AR_PrixAch > 0
         THEN ROUND((a.AR_PrixVen - a.AR_PrixAch) / a.AR_PrixAch * 100, 2)
         ELSE NULL END                                          AS [Taux_Marge_Pct],
    s.DE_No                                                     AS [Code_Depot],
    dep.DE_Intitule                                             AS [Libelle_Depot],
    s.AS_QteSto                                                 AS [Quantite_Stock],
    s.AS_QteMini                                                AS [Stock_Minimum],
    s.AS_QteMaxi                                                AS [Stock_Maximum],
    s.AS_MontSto                                                AS [Valeur_Stock],
    s.AS_QteRes                                                 AS [Qte_Reservee],
    s.AS_QteCom                                                 AS [Qte_Commandee],
    CASE
        WHEN s.AS_QteSto <= 0                THEN 'RUPTURE'
        WHEN s.AS_QteSto <= s.AS_QteMini     THEN 'ALERTE'
        WHEN s.AS_QteSto <= s.AS_QteMini * 1.2 THEN 'FAIBLE'
        ELSE 'OK'
    END                                                         AS [Statut_Stock],
    a.AR_UniteVen                                               AS [Unite_Vente],
    a.AR_Sommeil                                                AS [Est_Sommeil],
    a.cbMarq                                                    AS [Watermark_Sync]
FROM dbo.F_ARTICLE a
LEFT JOIN dbo.F_ARTSTOCK s   ON a.AR_Ref = s.AR_Ref
LEFT JOIN dbo.F_FAMILLE  fa  ON a.FA_CodeFamille = fa.FA_CodeFamille
LEFT JOIN dbo.F_DEPOT    dep ON s.DE_No = dep.DE_No
WHERE ISNULL(a.AR_Sommeil, 0) = 0;
GO

-- ---------------------------------------------------------------------------
-- SP_AGENT_SYNC
-- Procédure appelée par l'agent après chaque sync réussie.
-- Met à jour LAST_SYNC et retourne un ticket de confirmation.
-- ---------------------------------------------------------------------------
IF OBJECT_ID('dbo.SP_AGENT_SYNC', 'P') IS NOT NULL DROP PROCEDURE dbo.SP_AGENT_SYNC;
GO
CREATE PROCEDURE dbo.SP_AGENT_SYNC
    @Vue          NVARCHAR(100),
    @WatermarkMin BIGINT = 0,
    @BatchSize    INT    = 5000
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE dbo.PLATEFORME_PARAMS
    SET Param_Valeur = CONVERT(VARCHAR, GETDATE(), 120), Date_Modif = GETDATE()
    WHERE Param_Cle = 'LAST_SYNC';

    SELECT @Vue AS [Vue], @WatermarkMin AS [Watermark_Min], GETDATE() AS [Timestamp_Sync];
END;
GO
