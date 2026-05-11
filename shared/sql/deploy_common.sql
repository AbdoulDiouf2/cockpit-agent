-- =============================================================================
-- COCKPIT AGENT — deploy_common.sql
-- Tables de configuration + tables de référence créées par l'agent.
-- Ces tables ne touchent AUCUNE donnée Sage métier.
-- Aligné sur DEPLOY_PLATEFORME_SAGE100_v1.1.sql
-- =============================================================================

SET NOCOUNT ON;
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;

-- =============================================================================
-- TABLE : PLATEFORME_MAPPING_DEPENSES
-- Classification BI des comptes généraux (PCG français).
-- DROP dans un batch, CREATE dans le batch suivant (séparés par GO) :
-- chaque batch est compilé indépendamment, pas de problème de cache de schéma.
-- =============================================================================
IF OBJECT_ID('dbo.PLATEFORME_MAPPING_DEPENSES', 'U') IS NOT NULL
    DROP TABLE dbo.PLATEFORME_MAPPING_DEPENSES;
GO
CREATE TABLE dbo.PLATEFORME_MAPPING_DEPENSES (
    id              INT IDENTITY(1,1) PRIMARY KEY,
    compte_debut    NVARCHAR(13)  NOT NULL,
    compte_fin      NVARCHAR(13)  NOT NULL,
    type_classe     NVARCHAR(50)  NOT NULL,
    categorie_bi    NVARCHAR(50)  NOT NULL,
    sous_categorie  NVARCHAR(100) NULL,
    kpi_tags        NVARCHAR(200) NULL
);

INSERT INTO dbo.PLATEFORME_MAPPING_DEPENSES
    (compte_debut, compte_fin, type_classe, categorie_bi, sous_categorie, kpi_tags)
VALUES
-- CAPITAUX
('10','109999','CAPITAUX','CAPITAL',                  'Capital social',                    'equity,structure_financiere'),
('11','119999','CAPITAUX','RESERVES',                 'Reserves',                          'equity'),
('12','129999','CAPITAUX','RESULTAT',                 'Resultat exercice',                 'resultat'),
('13','139999','CAPITAUX','SUBVENTIONS_INVEST',       'Subventions investissement',        'financement'),
('14','149999','CAPITAUX','PROVISIONS_REGLEMENTEES',  'Provisions reglementees',           'provisions'),
-- DETTES FINANCIERES
('16','169999','CAPITAUX','EMPRUNTS',                 'Emprunts et dettes financieres',    'endettement,tresorerie'),
-- IMMOBILISATIONS
('20','209999','IMMOBILISATIONS','IMMOBILISATIONS_INCORP',              'Immobilisations incorporelles',  'investissement'),
('21','219999','IMMOBILISATIONS','IMMOBILISATIONS_CORP',                'Immobilisations corporelles',    'investissement'),
('22','229999','IMMOBILISATIONS','IMMOBILISATIONS_MISE_EN_CONCESSION',  'Immobilisations concession',     'investissement'),
('23','239999','IMMOBILISATIONS','IMMOBILISATIONS_EN_COURS',            'Immobilisations en cours',       'investissement'),
('27','279999','IMMOBILISATIONS','IMMOBILISATIONS_FINANCIERES',         'Immobilisations financieres',    'placement'),
-- AMORTISSEMENTS
('28','289999','IMMOBILISATIONS','AMORTISSEMENTS',       'Amortissements immobilisations',  'amortissement,actifs'),
('29','299999','IMMOBILISATIONS','DEPRECIATIONS_IMMO',   'Depreciations immobilisations',   'provisions'),
-- STOCKS
('31','319999','STOCKS','STOCK_MP',              'Stocks matieres premieres',           'stock'),
('32','329999','STOCKS','STOCK_AUTRES_APPRO',    'Stocks autres approvisionnements',    'stock'),
('33','339999','STOCKS','STOCK_ENCOURS',         'Stocks en cours production',          'production'),
('34','349999','STOCKS','STOCK_PRODUITS_INTER',  'Stocks produits intermediaires',      'production'),
('35','359999','STOCKS','STOCK_PRODUITS_FINIS',  'Stocks produits finis',               'stock'),
('37','379999','STOCKS','STOCK_MARCHANDISES',    'Stocks marchandises',                 'stock'),
('39','399999','STOCKS','DEPRECIATION_STOCK',    'Depreciation stocks',                 'provisions'),
-- TIERS
('40','409999','COMPTES_TIERS','FOURNISSEURS',            'Dettes fournisseurs',          'dettes'),
('41','419999','COMPTES_TIERS','CLIENTS',                 'Creances clients',             'recouvrement,ca'),
('42','429999','COMPTES_TIERS','PERSONNEL',               'Dettes personnel',             'rh,paie'),
('43','439999','COMPTES_TIERS','ORGANISMES_SOCIAUX',      'Charges sociales',             'rh'),
('44','449999','COMPTES_TIERS','ETAT_IMPOTS',             'Etat et impots',               'fiscalite'),
('45','459999','COMPTES_TIERS','GROUPE_ASSOCIES',         'Groupe et associes',           'holding'),
('46','469999','COMPTES_TIERS','DEBITEURS_CREDITEURS',    'Debiteurs crediteurs divers',  'divers'),
('48','489999','COMPTES_TIERS','COMPTES_REGULARISATION',  'Comptes regularisation',       'comptabilite'),
('49','499999','COMPTES_TIERS','DEPRECIATION_TIERS',      'Depreciation comptes tiers',   'risque'),
-- TRESORERIE
('50','509999','TRESORERIE','VALEURS_MOBILIERE',  'Valeurs mobilieres placement',  'placement'),
('51','519999','TRESORERIE','BANQUES',            'Banques',                       'tresorerie'),
('53','539999','TRESORERIE','CAISSE',             'Caisse',                        'tresorerie'),
('58','589999','TRESORERIE','VIREMENTS_INTERNES', 'Virements internes',            'tresorerie'),
-- CHARGES
('60','609999','CHARGES','ACHATS',                   'Achats marchandises et matieres',   'marge,stock'),
('61','619999','CHARGES','SERVICES_EXTERNES',        'Services exterieurs',               'charges'),
('62','629999','CHARGES','AUTRES_SERVICES_EXTERNES', 'Autres services exterieurs',        'charges'),
('63','639999','CHARGES','IMPOTS_TAXES',             'Impots et taxes',                   'fiscalite'),
('64','649999','CHARGES','CHARGES_PERSONNEL',        'Charges personnel',                 'masse_salariale,rh'),
('65','659999','CHARGES','AUTRES_CHARGES',           'Autres charges gestion',            'charges'),
('66','669999','CHARGES','CHARGES_FINANCIERES',      'Charges financieres',               'finance,endettement'),
('67','679999','CHARGES','CHARGES_EXCEPTIONNELLES',  'Charges exceptionnelles',           'risque'),
('68','689999','CHARGES','DOTATIONS_AMORT',          'Dotations amortissements',          'investissement'),
('69','699999','CHARGES','IMPOT_BENEFICE',           'Impots sur benefices',              'fiscalite'),
-- PRODUITS
('70','709999','PRODUITS','CHIFFRE_AFFAIRES',      'Ventes produits services',                'ca,revenus'),
('71','719999','PRODUITS','PRODUCTION_STOCKEE',    'Production stockee',                      'production'),
('72','729999','PRODUITS','PRODUCTION_IMMOBILISEE','Production immobilisee',                  'immobilisation'),
('74','749999','PRODUITS','SUBVENTIONS_EXPLOIT',   'Subventions exploitation',                'financement'),
('75','759999','PRODUITS','AUTRES_PRODUITS',       'Autres produits gestion',                 'revenus'),
('76','769999','PRODUITS','PRODUITS_FINANCIERS',   'Produits financiers',                     'placement'),
('77','779999','PRODUITS','PRODUITS_EXCEPTIONNELS','Produits exceptionnels',                  'risque'),
('78','789999','PRODUITS','REPRISES_PROVISIONS',   'Reprises amortissements provisions',      'provisions'),
('79','799999','PRODUITS','TRANSFERT_CHARGES',     'Transfert de charges',                    'comptabilite');

PRINT '  OK PLATEFORME_MAPPING_DEPENSES';
GO

-- =============================================================================
-- TABLE : calendrier
-- Dimension temporelle utilisée par VW_GRAND_LIVRE_GENERAL et VW_FINANCE_GENERAL.
-- 14 colonnes, période 2015-01-01 → 2035-12-31, annee_mois au format VARCHAR 'yyyy-MM'.
-- DROP + RECREATE : table de données générées, recréation sans perte métier.
-- =============================================================================
IF OBJECT_ID('dbo.calendrier', 'U') IS NOT NULL
    DROP TABLE dbo.calendrier;

CREATE TABLE dbo.calendrier (
    dt_jour              DATE         PRIMARY KEY,
    annee                INT,
    semestre             INT,
    trimestre            INT,
    mois                 INT,
    libelle_mois         VARCHAR(20),
    annee_mois           VARCHAR(7),
    semaine              INT,
    annee_semaine        VARCHAR(10),
    libelle_semaine      VARCHAR(10),
    jour_mois            INT,
    jour_annee           INT,
    jour_semaine         INT,
    libelle_jour_semaine VARCHAR(20),
    est_weekend          BIT
);

WITH dates AS (
    SELECT CAST('20150101' AS DATE) AS d
    UNION ALL
    SELECT DATEADD(DAY, 1, d) FROM dates WHERE d < '20351231'
)
INSERT INTO dbo.calendrier
SELECT
    d                                                           AS dt_jour,
    YEAR(d)                                                     AS annee,
    CASE WHEN MONTH(d) <= 6 THEN 1 ELSE 2 END                  AS semestre,
    DATEPART(QUARTER, d)                                        AS trimestre,
    MONTH(d)                                                    AS mois,
    DATENAME(MONTH, d)                                          AS libelle_mois,
    FORMAT(d, 'yyyy-MM')                                        AS annee_mois,
    DATEPART(WEEK, d)                                           AS semaine,
    CONCAT(YEAR(d), '-S', FORMAT(DATEPART(WEEK, d), '00'))     AS annee_semaine,
    CONCAT('S', FORMAT(DATEPART(WEEK, d), '00'))               AS libelle_semaine,
    DAY(d)                                                      AS jour_mois,
    DATEPART(DAYOFYEAR, d)                                      AS jour_annee,
    DATEPART(WEEKDAY, d)                                        AS jour_semaine,
    DATENAME(WEEKDAY, d)                                        AS libelle_jour_semaine,
    CASE WHEN DATEPART(WEEKDAY, d) IN (1, 7) THEN 1 ELSE 0 END AS est_weekend
FROM dates
OPTION (MAXRECURSION 0);

PRINT '  OK calendrier (2015-2035)';
GO

-- =============================================================================
-- TABLE : PLATEFORME_CONFIG_GROUPE
-- Métadonnées par dossier Sage (multi-société).
-- =============================================================================
IF OBJECT_ID('dbo.PLATEFORME_CONFIG_GROUPE', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.PLATEFORME_CONFIG_GROUPE (
        ID              INT IDENTITY(1,1) PRIMARY KEY,
        Code_Entite     NVARCHAR(20)  NOT NULL,
        Nom_Entite      NVARCHAR(100) NOT NULL,
        SIREN           NVARCHAR(9)   NULL,
        Devise_Base     NVARCHAR(3)   DEFAULT 'EUR',
        Exercice_Debut  DATE          NULL,
        Exercice_Fin    DATE          NULL,
        Actif           BIT           DEFAULT 1,
        Date_Creation   DATETIME      DEFAULT GETDATE(),
        Token_Agent     NVARCHAR(200) NULL
    );
    PRINT '  OK PLATEFORME_CONFIG_GROUPE';
END
ELSE PRINT '  ~ PLATEFORME_CONFIG_GROUPE existe';
GO

-- =============================================================================
-- TABLE : PLATEFORME_PARAMS
-- Paramètres de l'agent — MERGE idempotent sur table existante,
-- CREATE complet si absente.
-- =============================================================================
IF OBJECT_ID('dbo.PLATEFORME_PARAMS', 'U') IS NOT NULL
BEGIN
    -- Compatibilité ancienne structure : ajouter colonnes manquantes
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
                   WHERE TABLE_NAME = 'PLATEFORME_PARAMS' AND COLUMN_NAME = 'Param_Type')
        ALTER TABLE dbo.PLATEFORME_PARAMS ADD Param_Type NVARCHAR(50) NULL;

    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
                   WHERE TABLE_NAME = 'PLATEFORME_PARAMS' AND COLUMN_NAME = 'Description')
        ALTER TABLE dbo.PLATEFORME_PARAMS ADD Description NVARCHAR(200) NULL;

    -- MERGE : INSERT uniquement si la clé n'existe pas encore
    MERGE dbo.PLATEFORME_PARAMS AS tgt
    USING (VALUES
        ('AGENT_VERSION',     '5.3',                                'AGENT', 'Version script déploiement agent'),
        ('PLATEFORME_URL',    '',                                   'AGENT', 'URL plateforme SaaS BI'),
        ('TOKEN_API',         '',                                   'AGENT', 'Token API de liaison'),
        ('EMAIL_LIAISON',     '',                                   'AGENT', 'Email de liaison'),
        ('SYNC_INTERVAL_MIN', '15',                                 'AGENT', 'Intervalle sync en minutes'),
        ('SYNC_MODE',         'INCREMENTAL',                        'AGENT', 'INCREMENTAL ou FULL'),
        ('DATE_INSTALL',      CONVERT(VARCHAR, GETDATE(), 120),     'AGENT', 'Date installation agent'),
        ('LAST_SYNC',         '',                                   'AGENT', 'Dernière sync réussie'),
        ('PORT_AGENT',        '8443',                               'AGENT', 'Port HTTPS agent')
    ) AS src (Param_Cle, Param_Valeur, Param_Type, Description)
    ON tgt.Param_Cle = src.Param_Cle
    WHEN NOT MATCHED THEN
        INSERT (Param_Cle, Param_Valeur, Param_Type, Description)
        VALUES (src.Param_Cle, src.Param_Valeur, src.Param_Type, src.Description);

    PRINT '  OK PLATEFORME_PARAMS (MERGE sur table existante)';
END
ELSE
BEGIN
    CREATE TABLE dbo.PLATEFORME_PARAMS (
        Param_Cle       NVARCHAR(100) PRIMARY KEY,
        Param_Valeur    NVARCHAR(500) NOT NULL,
        Param_Type      NVARCHAR(50)  NULL,
        Description     NVARCHAR(200) NULL,
        Date_Modif      DATETIME      DEFAULT GETDATE()
    );
    INSERT INTO dbo.PLATEFORME_PARAMS (Param_Cle, Param_Valeur, Param_Type, Description) VALUES
    ('AGENT_VERSION',     '5.3',                                'AGENT', 'Version script déploiement agent'),
    ('PLATEFORME_URL',    '',                                   'AGENT', 'URL plateforme SaaS BI'),
    ('TOKEN_API',         '',                                   'AGENT', 'Token API de liaison'),
    ('EMAIL_LIAISON',     '',                                   'AGENT', 'Email de liaison'),
    ('SYNC_INTERVAL_MIN', '15',                                 'AGENT', 'Intervalle sync en minutes'),
    ('SYNC_MODE',         'INCREMENTAL',                        'AGENT', 'INCREMENTAL ou FULL'),
    ('DATE_INSTALL',      CONVERT(VARCHAR, GETDATE(), 120),     'AGENT', 'Date installation'),
    ('LAST_SYNC',         '',                                   'AGENT', 'Dernière sync réussie'),
    ('PORT_AGENT',        '8443',                               'AGENT', 'Port HTTPS agent');
    PRINT '  OK PLATEFORME_PARAMS (créée)';
END
GO

-- =============================================================================
-- INDEX DE PERFORMANCE
-- Sur F_ECRITUREC (grande table, très sollicitée par toutes les vues BI)
-- et F_DOCENTETE. Création conditionnelle — idempotent.
-- =============================================================================
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ECRITUREC_BI_DATE' AND object_id = OBJECT_ID('F_ECRITUREC'))
BEGIN
    CREATE NONCLUSTERED INDEX IX_ECRITUREC_BI_DATE ON dbo.F_ECRITUREC (EC_Date, JO_Num, CG_Num)
    INCLUDE (EC_No, EC_Piece, EC_Intitule, EC_Montant, EC_Sens, EC_Lettrage, CT_Num);
    PRINT '  OK IX_ECRITUREC_BI_DATE';
END ELSE PRINT '  ~ IX_ECRITUREC_BI_DATE existe';

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ECRITUREC_BI_COMPTE' AND object_id = OBJECT_ID('F_ECRITUREC'))
BEGIN
    CREATE NONCLUSTERED INDEX IX_ECRITUREC_BI_COMPTE ON dbo.F_ECRITUREC (CG_Num, EC_Date)
    INCLUDE (EC_Montant, EC_Sens, JO_Num);
    PRINT '  OK IX_ECRITUREC_BI_COMPTE';
END ELSE PRINT '  ~ IX_ECRITUREC_BI_COMPTE existe';

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ECRITUREC_BI_TIERS' AND object_id = OBJECT_ID('F_ECRITUREC'))
BEGIN
    CREATE NONCLUSTERED INDEX IX_ECRITUREC_BI_TIERS ON dbo.F_ECRITUREC (CT_Num, EC_Date)
    INCLUDE (EC_Montant, EC_Sens, EC_Lettrage, CG_Num);
    PRINT '  OK IX_ECRITUREC_BI_TIERS';
END ELSE PRINT '  ~ IX_ECRITUREC_BI_TIERS existe';

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_DOCENTETE_BI_DATE' AND object_id = OBJECT_ID('F_DOCENTETE'))
BEGIN
    CREATE NONCLUSTERED INDEX IX_DOCENTETE_BI_DATE ON dbo.F_DOCENTETE (DO_Date, DO_Type, DO_Piece)
    INCLUDE (DO_Tiers, DO_TotalHT, DO_TotalTTC, DO_Statut);
    PRINT '  OK IX_DOCENTETE_BI_DATE';
END ELSE PRINT '  ~ IX_DOCENTETE_BI_DATE existe';
GO
