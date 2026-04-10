-- =============================================================================
-- COCKPIT AGENT — deploy_common.sql
-- Tables de configuration + tables de référence créées par l'agent.
-- Ces tables ne touchent AUCUNE donnée Sage métier.
-- =============================================================================

-- Table de configuration générale de l'agent
IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'PLATEFORME_PARAMS'
)
BEGIN
    CREATE TABLE dbo.PLATEFORME_PARAMS (
        Param_Cle    NVARCHAR(100)  NOT NULL PRIMARY KEY,
        Param_Valeur NVARCHAR(2000) NULL,
        Param_Type   NVARCHAR(50)   NULL,
        Description  NVARCHAR(500)  NULL,
        Date_Modif   DATETIME       NOT NULL DEFAULT GETDATE()
    );
    PRINT 'Table PLATEFORME_PARAMS créée';
END
GO

-- Table de configuration par groupe/dossier Sage (multi-société)
IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'PLATEFORME_CONFIG_GROUPE'
)
BEGIN
    CREATE TABLE dbo.PLATEFORME_CONFIG_GROUPE (
        GROUPE_CODE  NVARCHAR(20)   NOT NULL,
        CONFIG_KEY   NVARCHAR(100)  NOT NULL,
        CONFIG_VALUE NVARCHAR(2000) NULL,
        UPDATED_AT   DATETIME       NOT NULL DEFAULT GETDATE(),
        PRIMARY KEY (GROUPE_CODE, CONFIG_KEY)
    );
    PRINT 'Table PLATEFORME_CONFIG_GROUPE créée';
END
GO

-- Valeur initiale d'installation
IF NOT EXISTS (SELECT 1 FROM PLATEFORME_PARAMS WHERE Param_Cle = 'INSTALL_DATE')
    INSERT INTO PLATEFORME_PARAMS (Param_Cle, Param_Valeur)
    VALUES ('INSTALL_DATE', CONVERT(NVARCHAR, GETDATE(), 126));
GO

-- =============================================================================
-- TABLE : calendrier
-- Dimension temporelle utilisée par VW_GRAND_LIVRE_GENERAL et VW_FINANCE_GENERAL.
-- Peuplée de 2005-01-01 à 2040-12-31 (couvre l'historique Sage).
-- =============================================================================
IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'calendrier'
)
BEGIN
    CREATE TABLE dbo.calendrier (
        dt_jour              DATE        NOT NULL PRIMARY KEY,
        annee                SMALLINT    NOT NULL,
        semestre             TINYINT     NOT NULL,
        trimestre            TINYINT     NOT NULL,
        mois                 TINYINT     NOT NULL,
        libelle_mois         NVARCHAR(20) NOT NULL,
        annee_mois           INT         NOT NULL,
        semaine              TINYINT     NOT NULL,
        annee_semaine        INT         NOT NULL
    );
    PRINT 'Table calendrier créée';
END
GO

-- Peupler le calendrier si vide
IF NOT EXISTS (SELECT 1 FROM dbo.calendrier WHERE dt_jour = '2005-01-01')
BEGIN
    WITH dates AS (
        SELECT CAST('2005-01-01' AS DATE) AS d
        UNION ALL
        SELECT DATEADD(DAY, 1, d) FROM dates WHERE d < '2040-12-31'
    )
    INSERT INTO dbo.calendrier
        (dt_jour, annee, semestre, trimestre, mois, libelle_mois, annee_mois, semaine, annee_semaine)
    SELECT
        d,
        YEAR(d),
        CASE WHEN MONTH(d) <= 6 THEN 1 ELSE 2 END,
        DATEPART(QUARTER, d),
        MONTH(d),
        DATENAME(MONTH, d),
        YEAR(d) * 100 + MONTH(d),
        DATEPART(WEEK, d),
        YEAR(d) * 100 + DATEPART(WEEK, d)
    FROM dates
    OPTION (MAXRECURSION 15000);
    PRINT 'Calendrier peuplé (2005-2040)';
END
GO

-- =============================================================================
-- TABLE : plateforme_mapping_depenses
-- Classification BI des comptes généraux (PCG français).
-- Utilisée par VW_GRAND_LIVRE_GENERAL, VW_FINANCE_GENERAL, VW_FOURNISSEURS.
-- =============================================================================
IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'plateforme_mapping_depenses'
)
BEGIN
    CREATE TABLE dbo.plateforme_mapping_depenses (
        compte_debut  INT           NOT NULL PRIMARY KEY,
        type_classe   NVARCHAR(20)  NOT NULL,
        categorie_bi  NVARCHAR(50)  NOT NULL,
        sous_categorie NVARCHAR(100) NULL,
        kpi_tags      NVARCHAR(200) NULL
    );
    PRINT 'Table plateforme_mapping_depenses créée';
END
GO

-- Peupler le mapping si vide
IF NOT EXISTS (SELECT 1 FROM dbo.plateforme_mapping_depenses)
BEGIN
    INSERT INTO dbo.plateforme_mapping_depenses VALUES
    -- Charges (classe 6)
    (60, 'CHARGES', 'ACHATS',              'Achats marchandises/matières',      'ACHATS,MARGE,BFR'),
    (61, 'CHARGES', 'SERVICES_EXTERNES',   'Services extérieurs',               'CHARGES_OPEX'),
    (62, 'CHARGES', 'AUTRES_SERVICES',     'Autres services extérieurs',        'CHARGES_OPEX'),
    (63, 'CHARGES', 'IMPOTS_TAXES',        'Impôts et taxes',                   'CHARGES_FIXES'),
    (64, 'CHARGES', 'CHARGES_PERSONNEL',   'Salaires et charges sociales',      'MASSE_SALARIALE,EBITDA'),
    (65, 'CHARGES', 'AUTRES_CHARGES',      'Autres charges de gestion',         'CHARGES_OPEX'),
    (66, 'CHARGES', 'CHARGES_FINANCIERES', 'Charges financières',               'CHARGES_FINANCIERES'),
    (67, 'CHARGES', 'CHARGES_EXCEPTION',   'Charges exceptionnelles',           'CHARGES_EXCEPTION'),
    (68, 'CHARGES', 'DOTATIONS_AMORT',     'Amortissements et provisions',      'AMORT,EBIT'),
    (69, 'CHARGES', 'IMPOTS_BENEFICES',    'Impôts sur les bénéfices',          'IS'),
    -- Produits (classe 7)
    (70, 'PRODUITS', 'CHIFFRE_AFFAIRES',    'Ventes de produits et services',   'CA,EBITDA,RESULTAT'),
    (71, 'PRODUITS', 'PROD_STOCKEE',        'Production stockée',               'PRODUCTION'),
    (72, 'PRODUITS', 'PROD_IMMOBILISEE',    'Production immobilisée',           'PRODUCTION'),
    (73, 'PRODUITS', 'PROD_VENDUE',         'Production vendue',                'CA'),
    (74, 'PRODUITS', 'SUBVENTIONS',         'Subventions d''exploitation',      'SUBVENTIONS'),
    (75, 'PRODUITS', 'AUTRES_PRODUITS',     'Autres produits de gestion',       'AUTRES_PRODUITS'),
    (76, 'PRODUITS', 'PRODUITS_FINANCIERS', 'Produits financiers',              'PRODUITS_FINANCIERS'),
    (77, 'PRODUITS', 'PRODUITS_EXCEPTION',  'Produits exceptionnels',           'PRODUITS_EXCEPTION'),
    (78, 'PRODUITS', 'REPRISES_PROVISIONS', 'Reprises sur provisions',          'REPRISES'),
    -- Tiers (classe 4)
    (40, 'BILAN', 'DETTES_FOURNISSEURS',   'Fournisseurs et comptes rattachés', 'BFR,DPO'),
    (41, 'BILAN', 'CREANCES_CLIENTS',      'Clients et comptes rattachés',      'BFR,DSO'),
    (42, 'BILAN', 'PERSONNEL',             'Personnel et comptes rattachés',    'SOCIAL'),
    (43, 'BILAN', 'ORGANISMES_SOCIAUX',    'Organismes sociaux',                'SOCIAL'),
    (44, 'BILAN', 'ETAT_FISC',             'État et collectivités publiques',   'FISCAL'),
    (45, 'BILAN', 'GROUPE_ASSOCIES',       'Groupe et associés',                'GROUPE'),
    (46, 'BILAN', 'DEBITEURS_CREANCIERS',  'Débiteurs et créanciers divers',    'TIERS_DIVERS'),
    (47, 'BILAN', 'COMPTES_TRANSITOIRES',  'Comptes transitoires',              'TRANSITOIRE'),
    (48, 'BILAN', 'COMPTES_REGULARISATION','Comptes de régularisation',         'REGULARISATION'),
    -- Trésorerie (classe 5)
    (50, 'TRESORERIE', 'TRESORERIE', 'Valeurs mobilières de placement',  'TRESORERIE'),
    (51, 'TRESORERIE', 'TRESORERIE', 'Banques et établissements financiers','TRESORERIE,BFR'),
    (53, 'TRESORERIE', 'TRESORERIE', 'Caisse',                            'TRESORERIE'),
    (58, 'TRESORERIE', 'TRESORERIE', 'Virements internes',                'TRESORERIE'),
    -- Fonds propres (classe 1)
    (10, 'BILAN', 'FONDS_PROPRES',     'Capital et primes',              'FONDS_PROPRES'),
    (11, 'BILAN', 'FONDS_PROPRES',     'Réserves',                       'FONDS_PROPRES'),
    (12, 'BILAN', 'RESULTAT',          'Résultat de l''exercice',        'RESULTAT'),
    (13, 'BILAN', 'FONDS_PROPRES',     'Provisions réglementées',        'FONDS_PROPRES'),
    (16, 'BILAN', 'DETTES_FINANCIERES','Emprunts et dettes assimilées',  'DETTES_LT'),
    -- Immobilisations (classe 2)
    (20, 'BILAN', 'IMMOBILISATIONS', 'Immobilisations incorporelles',   'ACTIF'),
    (21, 'BILAN', 'IMMOBILISATIONS', 'Immobilisations corporelles',     'ACTIF'),
    (22, 'BILAN', 'IMMOBILISATIONS', 'Immobilisations en cours',        'ACTIF'),
    (28, 'BILAN', 'AMORTISSEMENTS',  'Amortissements des immobilisations','ACTIF'),
    -- Stocks (classe 3)
    (30, 'BILAN', 'STOCKS', 'Stocks de marchandises',    'STOCKS,BFR'),
    (31, 'BILAN', 'STOCKS', 'Matières premières',        'STOCKS,BFR'),
    (35, 'BILAN', 'STOCKS', 'Stocks de produits finis',  'STOCKS,BFR'),
    (37, 'BILAN', 'STOCKS', 'Stocks de marchandises',    'STOCKS,BFR');

    PRINT 'plateforme_mapping_depenses peuplée';
END
GO
