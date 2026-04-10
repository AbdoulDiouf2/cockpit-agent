-- =============================================================================
-- COCKPIT AGENT — seed_test.sql
-- Schéma Sage 100 minimal + données synthétiques pour tests d'installation.
-- Société fictive : BIJOU DEMO SARL (distribution bijouterie)
-- Exercice courant : 2024-2025
-- =============================================================================

USE master;
GO

-- Crée la base si elle n'existe pas
IF NOT EXISTS (SELECT 1 FROM sys.databases WHERE name = 'SAGE_TEST')
    CREATE DATABASE SAGE_TEST;
GO

USE SAGE_TEST;
GO

-- =============================================================================
-- TABLES SAGE 100 (schéma minimal requis par les vues Cockpit)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- F_JOURNAUX — Journaux comptables
-- ---------------------------------------------------------------------------
IF OBJECT_ID('dbo.F_JOURNAUX', 'U') IS NULL
CREATE TABLE dbo.F_JOURNAUX (
    JO_Num       NVARCHAR(6)   NOT NULL PRIMARY KEY,
    JO_Intitule  NVARCHAR(35)  NOT NULL,
    JO_Type      TINYINT       NOT NULL DEFAULT 0,  -- 0=Achats,1=Ventes,2=Tréso,3=OD,4=Situation
    cbMarq       INT           NOT NULL DEFAULT 0,
    cbModification DATETIME    NULL
);
GO

-- ---------------------------------------------------------------------------
-- F_COMPTEG — Plan comptable général
-- ---------------------------------------------------------------------------
IF OBJECT_ID('dbo.F_COMPTEG', 'U') IS NULL
CREATE TABLE dbo.F_COMPTEG (
    CG_Num       NVARCHAR(13)  NOT NULL PRIMARY KEY,
    CG_Intitule  NVARCHAR(35)  NOT NULL,
    CG_Type      TINYINT       NOT NULL DEFAULT 0,  -- 0=Normal,1=Total,2=Racine
    cbMarq       INT           NOT NULL DEFAULT 0,
    cbModification DATETIME    NULL
);
GO

-- ---------------------------------------------------------------------------
-- F_COMPTET — Tiers (clients + fournisseurs)
-- ---------------------------------------------------------------------------
IF OBJECT_ID('dbo.F_COMPTET', 'U') IS NULL
CREATE TABLE dbo.F_COMPTET (
    CT_Num         NVARCHAR(17)  NOT NULL PRIMARY KEY,
    CT_Intitule    NVARCHAR(35)  NOT NULL,
    CT_Type        TINYINT       NOT NULL DEFAULT 0,  -- 0=Client,1=Fournisseur
    CT_Adresse     NVARCHAR(35)  NULL,
    CT_CodePostal  NVARCHAR(9)   NULL,
    CT_Ville       NVARCHAR(35)  NULL,
    CT_Pays        NVARCHAR(35)  NULL DEFAULT 'FR',
    CT_Telephone   NVARCHAR(21)  NULL,
    CT_Email       NVARCHAR(69)  NULL,
    CT_Siret       NVARCHAR(14)  NULL,
    CT_Sommeil     TINYINT       NOT NULL DEFAULT 0,
    CT_Classement  NVARCHAR(17)  NULL,
    N_CatCompta    TINYINT       NULL,
    CT_Encours     NUMERIC(13,2) NULL DEFAULT 0,
    cbMarq         INT           NOT NULL DEFAULT 0,
    cbModification DATETIME      NULL
);
GO

-- ---------------------------------------------------------------------------
-- F_COMPTEA — Comptes analytiques
-- ---------------------------------------------------------------------------
IF OBJECT_ID('dbo.F_COMPTEA', 'U') IS NULL
CREATE TABLE dbo.F_COMPTEA (
    CA_Num         NVARCHAR(13)  NOT NULL,
    N_Analytique   TINYINT       NOT NULL DEFAULT 1,
    CA_Intitule    NVARCHAR(35)  NOT NULL,
    cbMarq         INT           NOT NULL DEFAULT 0,
    cbModification DATETIME      NULL,
    PRIMARY KEY (CA_Num, N_Analytique)
);
GO

-- ---------------------------------------------------------------------------
-- F_ECRITUREC — Écritures comptables (table centrale)
-- ---------------------------------------------------------------------------
IF OBJECT_ID('dbo.F_ECRITUREC', 'U') IS NULL
CREATE TABLE dbo.F_ECRITUREC (
    EC_No          INT           NOT NULL PRIMARY KEY IDENTITY(1,1),
    EC_Piece       NVARCHAR(13)  NULL,
    EC_Date        DATE          NOT NULL,
    CG_Num         NVARCHAR(13)  NOT NULL,
    CT_Num         NVARCHAR(17)  NULL,
    JO_Num         NVARCHAR(6)   NOT NULL,
    EC_Intitule    NVARCHAR(35)  NULL,
    EC_Montant     NUMERIC(13,2) NOT NULL DEFAULT 0,
    EC_Sens        TINYINT       NOT NULL DEFAULT 0,  -- 0=Débit,1=Crédit
    EC_Lettrage    NVARCHAR(3)   NULL,
    EC_RefPiece    NVARCHAR(17)  NULL,
    EC_Echeance    DATE          NULL,
    cbCreateur     NVARCHAR(8)   NULL DEFAULT 'IMPORT',
    cbCreation     DATETIME      NULL DEFAULT GETDATE(),
    cbModification DATETIME      NULL DEFAULT GETDATE(),
    cbMarq         INT           NOT NULL DEFAULT 0
);
GO

-- ---------------------------------------------------------------------------
-- F_ECRITUREA — Écritures analytiques
-- ---------------------------------------------------------------------------
IF OBJECT_ID('dbo.F_ECRITUREA', 'U') IS NULL
CREATE TABLE dbo.F_ECRITUREA (
    EA_No          INT           NOT NULL IDENTITY(1,1),
    EC_No          INT           NOT NULL,
    EA_Ligne       SMALLINT      NOT NULL DEFAULT 1,
    N_Analytique   TINYINT       NOT NULL DEFAULT 1,
    CA_Num         NVARCHAR(13)  NOT NULL,
    EA_Montant     NUMERIC(13,2) NOT NULL DEFAULT 0,
    EA_Quantite    NUMERIC(13,3) NULL DEFAULT 0,
    cbMarq         INT           NOT NULL DEFAULT 0,
    cbModification DATETIME      NULL,
    PRIMARY KEY (EA_No)
);
GO

-- ---------------------------------------------------------------------------
-- F_FAMILLE — Familles articles
-- ---------------------------------------------------------------------------
IF OBJECT_ID('dbo.F_FAMILLE', 'U') IS NULL
CREATE TABLE dbo.F_FAMILLE (
    FA_CodeFamille NVARCHAR(10)  NOT NULL PRIMARY KEY,
    FA_Intitule    NVARCHAR(35)  NOT NULL,
    cbMarq         INT           NOT NULL DEFAULT 0,
    cbModification DATETIME      NULL
);
GO

-- ---------------------------------------------------------------------------
-- F_ARTICLE — Articles
-- ---------------------------------------------------------------------------
IF OBJECT_ID('dbo.F_ARTICLE', 'U') IS NULL
CREATE TABLE dbo.F_ARTICLE (
    AR_Ref         NVARCHAR(18)  NOT NULL PRIMARY KEY,
    AR_Design      NVARCHAR(69)  NOT NULL,
    FA_CodeFamille NVARCHAR(10)  NULL,
    AR_PrixVen     NUMERIC(13,2) NULL DEFAULT 0,
    AR_PrixAch     NUMERIC(13,2) NULL DEFAULT 0,
    AR_Coef        NUMERIC(7,4)  NULL DEFAULT 1,
    AR_UniteVen    NVARCHAR(6)   NULL DEFAULT 'U',
    AR_SuiviStock  TINYINT       NULL DEFAULT 1,
    AR_Sommeil     TINYINT       NULL DEFAULT 0,
    cbMarq         INT           NOT NULL DEFAULT 0,
    cbModification DATETIME      NULL
);
GO

-- ---------------------------------------------------------------------------
-- F_DEPOT — Dépôts
-- ---------------------------------------------------------------------------
IF OBJECT_ID('dbo.F_DEPOT', 'U') IS NULL
CREATE TABLE dbo.F_DEPOT (
    DE_No          INT           NOT NULL PRIMARY KEY,
    DE_Intitule    NVARCHAR(35)  NOT NULL,
    cbMarq         INT           NOT NULL DEFAULT 0
);
GO

-- ---------------------------------------------------------------------------
-- F_ARTSTOCK — Stocks par article / dépôt
-- ---------------------------------------------------------------------------
IF OBJECT_ID('dbo.F_ARTSTOCK', 'U') IS NULL
CREATE TABLE dbo.F_ARTSTOCK (
    AR_Ref         NVARCHAR(18)  NOT NULL,
    DE_No          INT           NOT NULL DEFAULT 1,
    AS_QteSto      NUMERIC(13,3) NOT NULL DEFAULT 0,
    AS_QteMini     NUMERIC(13,3) NOT NULL DEFAULT 0,
    AS_QteMaxi     NUMERIC(13,3) NOT NULL DEFAULT 0,
    AS_MontSto     NUMERIC(13,2) NOT NULL DEFAULT 0,
    AS_QteRes      NUMERIC(13,3) NOT NULL DEFAULT 0,
    AS_QteCom      NUMERIC(13,3) NOT NULL DEFAULT 0,
    cbMarq         INT           NOT NULL DEFAULT 0,
    cbModification DATETIME      NULL,
    PRIMARY KEY (AR_Ref, DE_No)
);
GO

-- ---------------------------------------------------------------------------
-- F_DOCENTETE — En-têtes documents commerciaux
-- ---------------------------------------------------------------------------
IF OBJECT_ID('dbo.F_DOCENTETE', 'U') IS NULL
CREATE TABLE dbo.F_DOCENTETE (
    DO_Piece       NVARCHAR(13)  NOT NULL,
    DO_Type        TINYINT       NOT NULL,
    DO_Date        DATE          NOT NULL,
    DO_Tiers       NVARCHAR(17)  NULL,
    DO_TotalHT     NUMERIC(13,2) NOT NULL DEFAULT 0,
    DO_TotalTTC    NUMERIC(13,2) NOT NULL DEFAULT 0,
    DO_TotalTVA    NUMERIC(13,2) NOT NULL DEFAULT 0,
    DO_Statut      TINYINT       NOT NULL DEFAULT 0,
    DO_DateLivr    DATE          NULL,
    DO_Ref         NVARCHAR(17)  NULL,
    cbCreateur     NVARCHAR(8)   NULL DEFAULT 'ADMIN',
    cbCreation     DATETIME      NULL DEFAULT GETDATE(),
    cbModification DATETIME      NULL DEFAULT GETDATE(),
    cbMarq         INT           NOT NULL DEFAULT 0,
    PRIMARY KEY (DO_Piece, DO_Type)
);
GO

-- ---------------------------------------------------------------------------
-- F_DOCLIGNE — Lignes de documents
-- ---------------------------------------------------------------------------
IF OBJECT_ID('dbo.F_DOCLIGNE', 'U') IS NULL
CREATE TABLE dbo.F_DOCLIGNE (
    DL_No          INT           NOT NULL PRIMARY KEY IDENTITY(1,1),
    DO_Piece       NVARCHAR(13)  NOT NULL,
    DO_Type        TINYINT       NOT NULL,
    AR_Ref         NVARCHAR(18)  NULL,
    DE_No          INT           NULL DEFAULT 1,
    DL_Qte         NUMERIC(13,3) NOT NULL DEFAULT 0,
    DL_PrixUnitaire NUMERIC(13,4) NOT NULL DEFAULT 0,
    DL_MontantHT   NUMERIC(13,2) NOT NULL DEFAULT 0,
    cbMarq         INT           NOT NULL DEFAULT 0,
    cbModification DATETIME      NULL
);
GO

-- ---------------------------------------------------------------------------
-- F_FAMILLEIMMO — Familles immobilisations
-- ---------------------------------------------------------------------------
IF OBJECT_ID('dbo.F_FAMILLEIMMO', 'U') IS NULL
CREATE TABLE dbo.F_FAMILLEIMMO (
    FA_CodeFamille NVARCHAR(10)  NOT NULL PRIMARY KEY,
    FA_Intitule    NVARCHAR(35)  NOT NULL,
    cbMarq         INT           NOT NULL DEFAULT 0
);
GO

-- ---------------------------------------------------------------------------
-- F_IMMOBILISATION — Immobilisations
-- ---------------------------------------------------------------------------
IF OBJECT_ID('dbo.F_IMMOBILISATION', 'U') IS NULL
CREATE TABLE dbo.F_IMMOBILISATION (
    IM_Code        NVARCHAR(13)  NOT NULL PRIMARY KEY,
    IM_Intitule    NVARCHAR(35)  NOT NULL,
    IM_Complement  NVARCHAR(35)  NULL,
    FA_CodeFamille NVARCHAR(10)  NULL,
    CT_Num         NVARCHAR(17)  NULL,
    CG_Num         NVARCHAR(13)  NULL,
    IM_DateAcq     DATE          NULL,
    IM_DateServ    DATE          NULL,
    IM_ValAcq      NUMERIC(13,2) NULL DEFAULT 0,
    IM_DotEco      NUMERIC(13,2) NULL DEFAULT 0,
    IM_DotFiscal   NUMERIC(13,2) NULL DEFAULT 0,
    IM_ModeAmort01 TINYINT       NULL DEFAULT 0,
    IM_NbAnnee01   TINYINT       NULL DEFAULT 5,
    IM_NbMois01    TINYINT       NULL DEFAULT 0,
    IM_Etat        TINYINT       NULL DEFAULT 0,
    IM_Quantite    NUMERIC(13,3) NULL DEFAULT 1,
    IM_Observation NVARCHAR(69)  NULL,
    cbMarq         INT           NOT NULL DEFAULT 0,
    cbModification DATETIME      NULL
);
GO

-- ---------------------------------------------------------------------------
-- F_IMMOAMORT — Tableau d'amortissement
-- ---------------------------------------------------------------------------
IF OBJECT_ID('dbo.F_IMMOAMORT', 'U') IS NULL
CREATE TABLE dbo.F_IMMOAMORT (
    IM_Code        NVARCHAR(13)  NOT NULL,
    IA_Annee       SMALLINT      NOT NULL,
    IA_TypeAmo     TINYINT       NOT NULL DEFAULT 0,  -- 0=Économique,1=Fiscal
    IA_Taux        NUMERIC(7,4)  NULL DEFAULT 0,
    cbMarq         INT           NOT NULL DEFAULT 0,
    PRIMARY KEY (IM_Code, IA_Annee, IA_TypeAmo)
);
GO

PRINT 'Schéma Sage 100 créé';
GO

-- =============================================================================
-- DONNÉES DE RÉFÉRENCE
-- =============================================================================

-- Journaux
DELETE FROM dbo.F_JOURNAUX;
INSERT INTO dbo.F_JOURNAUX (JO_Num, JO_Intitule, JO_Type) VALUES
('AC',  'Achats',                    0),
('VT',  'Ventes',                    1),
('BQ',  'Banque CIC',                2),
('BQ2', 'Banque LCL',                2),
('CA',  'Caisse',                    2),
('OD',  'Opérations diverses',       3),
('AN',  'À-nouveaux',                3),
('EX',  'Extourne',                  3);
GO

-- Plan comptable
DELETE FROM dbo.F_COMPTEG;
INSERT INTO dbo.F_COMPTEG (CG_Num, CG_Intitule, CG_Type) VALUES
-- Classe 1
('101000', 'Capital social',                  0),
('106100', 'Réserve légale',                  0),
('120000', 'Résultat de l''exercice',         0),
('164000', 'Emprunts établiss. crédit',      0),
-- Classe 2
('215000', 'Installations techniques',        0),
('218100', 'Instal. gén. - Agencements',      0),
('280000', 'Amortissements immos corporelles',0),
-- Classe 3
('370000', 'Stocks de marchandises',          0),
-- Classe 4
('401000', 'Fournisseurs',                    0),
('401100', 'Fournisseurs - effets à payer',   0),
('411000', 'Clients',                         0),
('411100', 'Clients - effets à recevoir',     0),
('421000', 'Personnel - rémunérations dues',  0),
('431000', 'Sécurité sociale',                0),
('445710', 'TVA collectée',                   0),
('445660', 'TVA déductible',                  0),
('445500', 'État - TVA à décaisser',          0),
-- Classe 5
('512000', 'Banque CIC',                      0),
('512100', 'Banque LCL',                      0),
('530000', 'Caisse',                          0),
-- Classe 6
('600000', 'Achats de marchandises',          0),
('601000', 'Achats de matières premières',    0),
('611000', 'Sous-traitance',                  0),
('613200', 'Locations immobilières',          0),
('615000', 'Entretien et réparations',        0),
('616000', 'Assurances',                      0),
('622600', 'Honoraires',                      0),
('623000', 'Publicité et communication',      0),
('626000', 'Frais postaux et télécom',        0),
('627000', 'Services bancaires',              0),
('631000', 'Impôts et taxes',                 0),
('641000', 'Salaires et traitements',         0),
('645000', 'Charges de sécurité sociale',     0),
('661000', 'Charges d''intérêts',             0),
('681000', 'Dotations amortissements',        0),
-- Classe 7
('701000', 'Ventes de marchandises France',   0),
('701100', 'Ventes de marchandises Export',   0),
('706000', 'Prestations de services',         0),
('707000', 'Ventes de produits finis',        0),
('708500', 'Ports et frais accessoires',      0),
('758000', 'Produits divers de gestion',      0),
('764000', 'Revenus des valeurs mobilières',  0);
GO

-- Familles articles
DELETE FROM dbo.F_FAMILLE;
INSERT INTO dbo.F_FAMILLE (FA_CodeFamille, FA_Intitule) VALUES
('BAGUE',   'Bagues'),
('COLLIER', 'Colliers et chaînes'),
('MONTRE',  'Montres'),
('BRACELET','Bracelets'),
('BOUCLE',  'Boucles d''oreilles'),
('COFFRET', 'Coffrets et emballages');
GO

-- Dépôts
DELETE FROM dbo.F_DEPOT;
INSERT INTO dbo.F_DEPOT (DE_No, DE_Intitule) VALUES
(1, 'Dépôt principal - Paris'),
(2, 'Boutique Lyon'),
(3, 'Boutique Bordeaux');
GO

-- Tiers — Fournisseurs
DELETE FROM dbo.F_COMPTET WHERE CT_Type = 1;
INSERT INTO dbo.F_COMPTET (CT_Num, CT_Intitule, CT_Type, CT_Adresse, CT_CodePostal, CT_Ville, CT_Pays, CT_Siret) VALUES
('CHOPARD',  'Chopard France SA',          1, '12 Rue de la Paix',    '75002', 'Paris',   'FR', '31200456700018'),
('CARTIER',  'Cartier International SNC',  1, '23 Place Vendôme',     '75001', 'Paris',   'FR', '31200456700019'),
('SWATCH',   'Swatch Group France',        1, '8 Rue de Mogador',     '75009', 'Paris',   'FR', '44256789100021'),
('PANDORA',  'Pandora France SAS',         1, '15 Rue du Faubourg',   '75008', 'Paris',   'FR', '55312678900034'),
('EMBALLAGE','Emballages Luxe SARL',       1, '45 Zone Industrielle', '93200', 'Saint-Denis','FR','66123456700012'),
('TRANSPORT','Express Transport SARL',     1, '88 Avenue Logistique', '94000', 'Créteil', 'FR', '77234567800023');
GO

-- Tiers — Clients
DELETE FROM dbo.F_COMPTET WHERE CT_Type = 0;
INSERT INTO dbo.F_COMPTET (CT_Num, CT_Intitule, CT_Type, CT_Adresse, CT_CodePostal, CT_Ville, CT_Pays, CT_Sommeil) VALUES
('CL001', 'Bijouterie Dupont',         0, '5 Rue de la Mairie',   '69001', 'Lyon',        'FR', 0),
('CL002', 'Galerie des Joyaux',        0, '12 Grand Rue',         '33000', 'Bordeaux',    'FR', 0),
('CL003', 'Montres Prestige SARL',     0, '8 Place Bellecour',    '69002', 'Lyon',        'FR', 0),
('CL004', 'L''Écrin d''Or',           0, '22 Rue du Commerce',   '44000', 'Nantes',      'FR', 0),
('CL005', 'Luxe & Tradition SAS',      0, '45 Avenue Victor Hugo','31000', 'Toulouse',    'FR', 0),
('CL006', 'Diamants du Midi',          0, '3 Rue des Artisans',   '13001', 'Marseille',   'FR', 0),
('CL007', 'Atelier du Bijou',          0, '17 Rue Nationale',     '59000', 'Lille',       'FR', 0),
('CL008', 'Haute Joaillerie Renard',   0, '9 Rue de la Liberté',  '67000', 'Strasbourg',  'FR', 0),
('CL009', 'Perle & Diamant',           0, '35 Rue Sainte-Claire', '38000', 'Grenoble',    'FR', 0),
('CL010', 'Orfèvrerie Moderne',        0, '6 Rue du Palais',      '06000', 'Nice',        'FR', 0),
('CL011', 'Bijoux Tendance',           0, '14 Rue de la Halle',   '76000', 'Rouen',       'FR', 0),
('CL012', 'Montres et Merveilles',     0, '28 Rue des Fleurs',    '34000', 'Montpellier', 'FR', 0),
('CL013', 'Joaillerie Saint-Nicolas',  0, '11 Place du Marché',   '57000', 'Metz',        'FR', 0),
('CL014', 'Cabinet des Gemmes',        0, '4 Rue du Bac',         '75007', 'Paris',       'FR', 0),
('CL015', 'Élégance Joaillerie',       0, '55 Cours Mirabeau',    '13100', 'Aix-en-Provence','FR',0);
GO

-- Comptes analytiques (axe 1 = Activité, axe 2 = Région)
DELETE FROM dbo.F_COMPTEA;
INSERT INTO dbo.F_COMPTEA (CA_Num, N_Analytique, CA_Intitule) VALUES
('1GRO',  1, 'Gros œuvre bijouterie'),
('1DET',  1, 'Détail boutiques'),
('1EXP',  1, 'Export'),
('1SAV',  1, 'Service après-vente'),
('2IDF',  2, 'Île-de-France'),
('2SUD',  2, 'Sud'),
('2OUE',  2, 'Ouest'),
('2EST',  2, 'Est'),
('2NOR',  2, 'Nord');
GO

-- Articles
DELETE FROM dbo.F_ARTICLE;
INSERT INTO dbo.F_ARTICLE (AR_Ref, AR_Design, FA_CodeFamille, AR_PrixVen, AR_PrixAch, AR_Coef) VALUES
('BAG-OR-18',  'Bague or 18 carats solitaire diamant',   'BAGUE',    1850.00,  890.00, 2.08),
('BAG-ARG-01', 'Bague argent 925 pavée',                 'BAGUE',     320.00,  120.00, 2.67),
('COL-OR-45',  'Collier or 18 carats 45cm',              'COLLIER',   980.00,  420.00, 2.33),
('COL-PERL',   'Collier perles de culture 7mm',          'COLLIER',  1250.00,  580.00, 2.16),
('MON-HOMME',  'Montre homme acier automatique',         'MONTRE',   2400.00, 1100.00, 2.18),
('MON-FEMME',  'Montre femme cadran nacre diamants',     'MONTRE',   3200.00, 1450.00, 2.21),
('BRA-OR-19',  'Bracelet or 19cm maille gourmette',      'BRACELET',  760.00,  310.00, 2.45),
('BRA-CHARM',  'Bracelet charms argent',                 'BRACELET',  280.00,   95.00, 2.95),
('BOU-CREO',   'Boucles oreilles créoles or',            'BOUCLE',    450.00,  180.00, 2.50),
('BOU-PEND',   'Boucles oreilles pendantes diamant',     'BOUCLE',   1100.00,  490.00, 2.24),
('COF-PREM',   'Coffret prestige velours bordeaux',      'COFFRET',    45.00,   12.00, 3.75),
('COF-STD',    'Coffret standard écrin blanc',           'COFFRET',    18.00,    5.00, 3.60);
GO

-- Stocks
DELETE FROM dbo.F_ARTSTOCK;
INSERT INTO dbo.F_ARTSTOCK (AR_Ref, DE_No, AS_QteSto, AS_QteMini, AS_QteMaxi, AS_MontSto, AS_QteRes, AS_QteCom) VALUES
('BAG-OR-18',  1,  15,  5,  30, 13350.00,  2,  3),
('BAG-ARG-01', 1,  45,  10, 80,  5400.00,  5,  10),
('COL-OR-45',  1,  22,  5,  40, 9240.00,   3,  5),
('COL-PERL',   1,  12,  3,  20, 6960.00,   1,  2),
('MON-HOMME',  1,   8,  3,  15, 8800.00,   1,  2),
('MON-FEMME',  1,   5,  2,  10, 7250.00,   0,  1),
('BRA-OR-19',  1,  30,  8,  50, 9300.00,   4,  6),
('BRA-CHARM',  1,  80, 20, 150, 7600.00,   8,  20),
('BOU-CREO',   1,  35, 10,  60, 6300.00,   5,  8),
('BOU-PEND',   1,  18,  5,  30, 8820.00,   2,  4),
('COF-PREM',   1, 200, 50, 400, 2400.00,  20,  50),
('COF-STD',    1, 500,100, 800, 2500.00,  40, 100),
('BAG-OR-18',  2,   3,  2,   8,  2670.00,  0,  1),
('BAG-ARG-01', 2,  12,  3,  20,  1440.00,  1,  3),
('COL-OR-45',  2,   6,  2,  12,  2520.00,  1,  2),
('MON-HOMME',  2,   2,  1,   5,  2200.00,  0,  1),
('BRA-CHARM',  2,  25,  5,  40,  2375.00,  2,  5),
('BAG-ARG-01', 3,   8,  2,  15,   960.00,  1,  2),
('COL-OR-45',  3,   4,  1,   8,  1680.00,  0,  1),
('BRA-CHARM',  3,  18,  4,  30,  1710.00,  2,  4);
GO

-- Familles immobilisations
DELETE FROM dbo.F_FAMILLEIMMO;
INSERT INTO dbo.F_FAMILLEIMMO (FA_CodeFamille, FA_Intitule) VALUES
('MAT-INF', 'Matériel informatique'),
('MOB-BUR', 'Mobilier de bureau'),
('AGE-COM', 'Agencements commerciaux'),
('MAT-EXP', 'Matériel d''exploitation');
GO

-- Immobilisations
DELETE FROM dbo.F_IMMOBILISATION;
INSERT INTO dbo.F_IMMOBILISATION
    (IM_Code, IM_Intitule, FA_CodeFamille, CG_Num, IM_DateAcq, IM_DateServ,
     IM_ValAcq, IM_DotEco, IM_DotFiscal, IM_ModeAmort01, IM_NbAnnee01, IM_Etat) VALUES
('IM-INFO-01', 'Serveur Dell PowerEdge',        'MAT-INF', '215000', '2022-03-15', '2022-03-15', 8500.00, 3400.00, 3400.00, 0, 5, 0),
('IM-INFO-02', 'Postes de travail x5',          'MAT-INF', '215000', '2022-06-01', '2022-06-01', 6250.00, 2500.00, 2500.00, 0, 5, 0),
('IM-INFO-03', 'Logiciels Sage 100',            'MAT-INF', '215000', '2021-01-01', '2021-01-01', 4200.00, 2800.00, 2800.00, 0, 3, 0),
('IM-MOB-01',  'Mobilier boutique Paris',       'MOB-BUR', '218100', '2020-09-01', '2020-09-01',12000.00, 7200.00, 7200.00, 0,10, 0),
('IM-MOB-02',  'Vitrines et présentoirs',       'AGE-COM', '218100', '2021-04-15', '2021-04-15',18500.00, 9250.00, 9250.00, 0,10, 0),
('IM-EXP-01',  'Coffre-fort haute sécurité',    'MAT-EXP', '215000', '2019-11-01', '2019-11-01',15000.00,10500.00,10500.00, 0,10, 0),
('IM-EXP-02',  'Système alarme et vidéo',       'MAT-EXP', '215000', '2020-01-15', '2020-01-15', 9800.00, 6533.00, 6533.00, 0, 5, 0);
GO

INSERT INTO dbo.F_IMMOAMORT (IM_Code, IA_Annee, IA_TypeAmo, IA_Taux) VALUES
('IM-INFO-01', 2022, 0, 20.00), ('IM-INFO-01', 2023, 0, 20.00), ('IM-INFO-01', 2024, 0, 20.00),
('IM-INFO-02', 2022, 0, 20.00), ('IM-INFO-02', 2023, 0, 20.00), ('IM-INFO-02', 2024, 0, 20.00),
('IM-MOB-01',  2020, 0, 10.00), ('IM-MOB-01',  2021, 0, 10.00), ('IM-MOB-01',  2022, 0, 10.00),
('IM-MOB-02',  2021, 0, 10.00), ('IM-MOB-02',  2022, 0, 10.00), ('IM-MOB-02',  2023, 0, 10.00),
('IM-EXP-01',  2019, 0, 10.00), ('IM-EXP-01',  2020, 0, 10.00), ('IM-EXP-01',  2021, 0, 10.00),
('IM-EXP-02',  2020, 0, 20.00), ('IM-EXP-02',  2021, 0, 20.00), ('IM-EXP-02',  2022, 0, 20.00);
GO

PRINT 'Données de référence insérées';
GO

-- =============================================================================
-- ÉCRITURES COMPTABLES — Exercice 2023 + 2024 (YTD)
-- Génère ~2000 lignes couvrant : ventes, achats, tréso, salaires, charges
-- =============================================================================

-- Procédure helper pour générer des écritures en masse
CREATE OR ALTER PROCEDURE dbo.usp_seed_ecritures AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @clients TABLE (ct NVARCHAR(17));
    INSERT @clients VALUES ('CL001'),('CL002'),('CL003'),('CL004'),('CL005'),
                           ('CL006'),('CL007'),('CL008'),('CL009'),('CL010'),
                           ('CL011'),('CL012'),('CL013'),('CL014'),('CL015');

    DECLARE @fourn TABLE (ct NVARCHAR(17));
    INSERT @fourn VALUES ('CHOPARD'),('CARTIER'),('SWATCH'),('PANDORA'),
                         ('EMBALLAGE'),('TRANSPORT');

    DECLARE @marq INT = 1;
    DECLARE @mois INT, @annee INT, @jour INT;
    DECLARE @ec_no INT;
    DECLARE @montant NUMERIC(13,2);
    DECLARE @piece NVARCHAR(13);
    DECLARE @client NVARCHAR(17), @fourn_ct NVARCHAR(17);

    -- -------------------------------------------------------------------------
    -- 1. VENTES 2023 — une facture par semaine par client actif
    -- -------------------------------------------------------------------------
    SET @annee = 2023;
    SET @mois  = 1;
    WHILE @mois <= 12
    BEGIN
        SET @jour = 1;
        WHILE @jour <= 28
        BEGIN
            IF @jour % 7 = 0  -- ~4 factures par mois
            BEGIN
                DECLARE client_cur CURSOR LOCAL FAST_FORWARD FOR
                    SELECT ct FROM @clients ORDER BY NEWID();
                OPEN client_cur;
                FETCH NEXT FROM client_cur INTO @client;
                WHILE @@FETCH_STATUS = 0
                BEGIN
                    SET @montant = CAST(1000 + (ABS(CHECKSUM(NEWID())) % 8000) AS NUMERIC(13,2));
                    SET @piece   = 'FA' + RIGHT('00000' + CAST(@marq AS VARCHAR), 5);

                    -- Débit client 411
                    INSERT INTO dbo.F_ECRITUREC (EC_Piece, EC_Date, CG_Num, CT_Num, JO_Num, EC_Intitule, EC_Montant, EC_Sens, cbMarq)
                    VALUES (@piece, DATEFROMPARTS(@annee,@mois,@jour), '411000', @client, 'VT',
                            'Facture ' + @piece, @montant * 1.20, 0, @marq);
                    SET @marq = @marq + 1;

                    -- Crédit ventes 701
                    INSERT INTO dbo.F_ECRITUREC (EC_Piece, EC_Date, CG_Num, CT_Num, JO_Num, EC_Intitule, EC_Montant, EC_Sens, cbMarq)
                    VALUES (@piece, DATEFROMPARTS(@annee,@mois,@jour), '701000', @client, 'VT',
                            'Facture ' + @piece, @montant, 1, @marq);
                    SET @marq = @marq + 1;

                    -- Crédit TVA 445710
                    INSERT INTO dbo.F_ECRITUREC (EC_Piece, EC_Date, CG_Num, CT_Num, JO_Num, EC_Intitule, EC_Montant, EC_Sens, cbMarq)
                    VALUES (@piece, DATEFROMPARTS(@annee,@mois,@jour), '445710', NULL, 'VT',
                            'TVA ' + @piece, @montant * 0.20, 1, @marq);
                    SET @marq = @marq + 1;

                    -- Lettrage règlement (70% des factures réglées)
                    IF ABS(CHECKSUM(NEWID())) % 10 > 2
                    BEGIN
                        DECLARE @lettr NVARCHAR(3) = LEFT('LT' + CAST(@marq AS VARCHAR), 3);
                        -- Règlement banque
                        INSERT INTO dbo.F_ECRITUREC (EC_Piece, EC_Date, CG_Num, CT_Num, JO_Num, EC_Intitule, EC_Montant, EC_Sens, EC_Lettrage, cbMarq)
                        VALUES ('RG' + RIGHT('00000'+CAST(@marq AS VARCHAR),5),
                                DATEADD(DAY, 15 + ABS(CHECKSUM(NEWID()))%30, DATEFROMPARTS(@annee,@mois,@jour)),
                                '512000', @client, 'BQ',
                                'Règlement ' + @piece, @montant * 1.20, 1, @lettr, @marq);
                        SET @marq = @marq + 1;

                        -- Contre-partie 411 lettrée
                        UPDATE dbo.F_ECRITUREC SET EC_Lettrage = @lettr
                        WHERE EC_Piece = @piece AND CG_Num = '411000';
                    END

                    FETCH NEXT FROM client_cur INTO @client;
                    IF @marq > 5000 BREAK; -- sécurité
                END
                CLOSE client_cur; DEALLOCATE client_cur;
            END
            SET @jour = @jour + 1;
        END
        SET @mois = @mois + 1;
    END

    -- -------------------------------------------------------------------------
    -- 2. VENTES 2024 YTD (janvier → octobre)
    -- -------------------------------------------------------------------------
    SET @annee = 2024;
    SET @mois  = 1;
    WHILE @mois <= 10
    BEGIN
        SET @jour = 1;
        WHILE @jour <= 28
        BEGIN
            IF @jour % 7 = 0
            BEGIN
                DECLARE client_cur2 CURSOR LOCAL FAST_FORWARD FOR
                    SELECT ct FROM @clients ORDER BY NEWID();
                OPEN client_cur2;
                FETCH NEXT FROM client_cur2 INTO @client;
                WHILE @@FETCH_STATUS = 0
                BEGIN
                    SET @montant = CAST(1200 + (ABS(CHECKSUM(NEWID())) % 9000) AS NUMERIC(13,2));
                    SET @piece   = 'FA' + RIGHT('00000' + CAST(@marq AS VARCHAR), 5);

                    INSERT INTO dbo.F_ECRITUREC (EC_Piece, EC_Date, CG_Num, CT_Num, JO_Num, EC_Intitule, EC_Montant, EC_Sens, cbMarq)
                    VALUES (@piece, DATEFROMPARTS(@annee,@mois,@jour), '411000', @client, 'VT',
                            'Facture ' + @piece, @montant * 1.20, 0, @marq);
                    SET @marq = @marq + 1;
                    INSERT INTO dbo.F_ECRITUREC (EC_Piece, EC_Date, CG_Num, CT_Num, JO_Num, EC_Intitule, EC_Montant, EC_Sens, cbMarq)
                    VALUES (@piece, DATEFROMPARTS(@annee,@mois,@jour), '701000', @client, 'VT',
                            'Facture ' + @piece, @montant, 1, @marq);
                    SET @marq = @marq + 1;
                    INSERT INTO dbo.F_ECRITUREC (EC_Piece, EC_Date, CG_Num, CT_Num, JO_Num, EC_Intitule, EC_Montant, EC_Sens, cbMarq)
                    VALUES (@piece, DATEFROMPARTS(@annee,@mois,@jour), '445710', NULL, 'VT',
                            'TVA ' + @piece, @montant * 0.20, 1, @marq);
                    SET @marq = @marq + 1;

                    FETCH NEXT FROM client_cur2 INTO @client;
                    IF @marq > 12000 BREAK;
                END
                CLOSE client_cur2; DEALLOCATE client_cur2;
            END
            SET @jour = @jour + 1;
        END
        SET @mois = @mois + 1;
    END

    -- -------------------------------------------------------------------------
    -- 3. ACHATS 2023 + 2024
    -- -------------------------------------------------------------------------
    DECLARE @f_idx INT;
    DECLARE @f_list TABLE (idx INT IDENTITY(1,1), ct NVARCHAR(17));
    INSERT @f_list (ct) VALUES ('CHOPARD'),('CARTIER'),('SWATCH'),('PANDORA'),('EMBALLAGE'),('TRANSPORT');

    SET @annee = 2023;
    WHILE @annee <= 2024
    BEGIN
        SET @mois = 1;
        WHILE @mois <= (CASE WHEN @annee = 2024 THEN 10 ELSE 12 END)
        BEGIN
            SET @f_idx = 1;
            WHILE @f_idx <= 6
            BEGIN
                SELECT @fourn_ct = ct FROM @f_list WHERE idx = @f_idx;
                SET @montant = CAST(2000 + (ABS(CHECKSUM(NEWID())) % 15000) AS NUMERIC(13,2));
                SET @piece   = 'AC' + RIGHT('00000' + CAST(@marq AS VARCHAR), 5);

                INSERT INTO dbo.F_ECRITUREC (EC_Piece, EC_Date, CG_Num, CT_Num, JO_Num, EC_Intitule, EC_Montant, EC_Sens, cbMarq)
                VALUES (@piece, DATEFROMPARTS(@annee,@mois,10), '600000', @fourn_ct, 'AC',
                        'Achat ' + @piece, @montant, 0, @marq);
                SET @marq = @marq + 1;
                INSERT INTO dbo.F_ECRITUREC (EC_Piece, EC_Date, CG_Num, CT_Num, JO_Num, EC_Intitule, EC_Montant, EC_Sens, cbMarq)
                VALUES (@piece, DATEFROMPARTS(@annee,@mois,10), '445660', NULL, 'AC',
                        'TVA achat ' + @piece, @montant * 0.20, 0, @marq);
                SET @marq = @marq + 1;
                INSERT INTO dbo.F_ECRITUREC (EC_Piece, EC_Date, CG_Num, CT_Num, JO_Num, EC_Intitule, EC_Montant, EC_Sens, cbMarq)
                VALUES (@piece, DATEFROMPARTS(@annee,@mois,10), '401000', @fourn_ct, 'AC',
                        'Achat ' + @piece, @montant * 1.20, 1, @marq);
                SET @marq = @marq + 1;
                SET @f_idx = @f_idx + 1;
            END
            SET @mois = @mois + 1;
        END
        SET @annee = @annee + 1;
    END

    -- -------------------------------------------------------------------------
    -- 4. SALAIRES — mensuel 2023 + 2024
    -- -------------------------------------------------------------------------
    SET @annee = 2023;
    WHILE @annee <= 2024
    BEGIN
        SET @mois = 1;
        WHILE @mois <= (CASE WHEN @annee = 2024 THEN 10 ELSE 12 END)
        BEGIN
            SET @piece = 'SAL' + CAST(@annee AS VARCHAR) + RIGHT('00'+CAST(@mois AS VARCHAR),2);
            -- Salaires bruts
            INSERT INTO dbo.F_ECRITUREC (EC_Piece, EC_Date, CG_Num, CT_Num, JO_Num, EC_Intitule, EC_Montant, EC_Sens, cbMarq)
            VALUES (@piece, DATEFROMPARTS(@annee,@mois,28), '641000', NULL, 'OD', 'Salaires ' + @piece, 24500.00, 0, @marq);
            SET @marq = @marq + 1;
            -- Charges patronales
            INSERT INTO dbo.F_ECRITUREC (EC_Piece, EC_Date, CG_Num, CT_Num, JO_Num, EC_Intitule, EC_Montant, EC_Sens, cbMarq)
            VALUES (@piece, DATEFROMPARTS(@annee,@mois,28), '645000', NULL, 'OD', 'Charges soc. ' + @piece, 11025.00, 0, @marq);
            SET @marq = @marq + 1;
            -- Crédit compte courant
            INSERT INTO dbo.F_ECRITUREC (EC_Piece, EC_Date, CG_Num, CT_Num, JO_Num, EC_Intitule, EC_Montant, EC_Sens, cbMarq)
            VALUES (@piece, DATEFROMPARTS(@annee,@mois,28), '421000', NULL, 'OD', 'Net à payer ' + @piece, 19600.00, 1, @marq);
            SET @marq = @marq + 1;
            INSERT INTO dbo.F_ECRITUREC (EC_Piece, EC_Date, CG_Num, CT_Num, JO_Num, EC_Intitule, EC_Montant, EC_Sens, cbMarq)
            VALUES (@piece, DATEFROMPARTS(@annee,@mois,28), '431000', NULL, 'OD', 'Charges soc. ' + @piece, 15925.00, 1, @marq);
            SET @marq = @marq + 1;
            SET @mois = @mois + 1;
        END
        SET @annee = @annee + 1;
    END

    -- -------------------------------------------------------------------------
    -- 5. CHARGES FIXES — loyer + assurance + telecom mensuel
    -- -------------------------------------------------------------------------
    SET @annee = 2023;
    WHILE @annee <= 2024
    BEGIN
        SET @mois = 1;
        WHILE @mois <= (CASE WHEN @annee = 2024 THEN 10 ELSE 12 END)
        BEGIN
            -- Loyer
            INSERT INTO dbo.F_ECRITUREC (EC_Piece, EC_Date, CG_Num, CT_Num, JO_Num, EC_Intitule, EC_Montant, EC_Sens, cbMarq)
            VALUES ('LOY' + CAST(@annee AS VARCHAR) + RIGHT('00'+CAST(@mois AS VARCHAR),2),
                    DATEFROMPARTS(@annee,@mois,1), '613200', NULL, 'BQ', 'Loyer mensuel', 4800.00, 0, @marq);
            SET @marq = @marq + 1;
            INSERT INTO dbo.F_ECRITUREC (EC_Piece, EC_Date, CG_Num, CT_Num, JO_Num, EC_Intitule, EC_Montant, EC_Sens, cbMarq)
            VALUES ('LOY' + CAST(@annee AS VARCHAR) + RIGHT('00'+CAST(@mois AS VARCHAR),2),
                    DATEFROMPARTS(@annee,@mois,1), '512000', NULL, 'BQ', 'Loyer mensuel', 4800.00, 1, @marq);
            SET @marq = @marq + 1;
            -- Assurance
            INSERT INTO dbo.F_ECRITUREC (EC_Piece, EC_Date, CG_Num, CT_Num, JO_Num, EC_Intitule, EC_Montant, EC_Sens, cbMarq)
            VALUES ('ASS' + CAST(@annee AS VARCHAR) + RIGHT('00'+CAST(@mois AS VARCHAR),2),
                    DATEFROMPARTS(@annee,@mois,5), '616000', NULL, 'BQ', 'Assurance', 650.00, 0, @marq);
            SET @marq = @marq + 1;
            INSERT INTO dbo.F_ECRITUREC (EC_Piece, EC_Date, CG_Num, CT_Num, JO_Num, EC_Intitule, EC_Montant, EC_Sens, cbMarq)
            VALUES ('ASS' + CAST(@annee AS VARCHAR) + RIGHT('00'+CAST(@mois AS VARCHAR),2),
                    DATEFROMPARTS(@annee,@mois,5), '512000', NULL, 'BQ', 'Assurance', 650.00, 1, @marq);
            SET @marq = @marq + 1;
            SET @mois = @mois + 1;
        END
        SET @annee = @annee + 1;
    END

    -- -------------------------------------------------------------------------
    -- 6. DOTATIONS AMORTISSEMENTS — annuelles
    -- -------------------------------------------------------------------------
    INSERT INTO dbo.F_ECRITUREC (EC_Piece, EC_Date, CG_Num, CT_Num, JO_Num, EC_Intitule, EC_Montant, EC_Sens, cbMarq)
    VALUES ('DOT2023', '2023-12-31', '681000', NULL, 'OD', 'Dotations amortissements 2023', 8750.00, 0, @marq);
    SET @marq = @marq + 1;
    INSERT INTO dbo.F_ECRITUREC (EC_Piece, EC_Date, CG_Num, CT_Num, JO_Num, EC_Intitule, EC_Montant, EC_Sens, cbMarq)
    VALUES ('DOT2023', '2023-12-31', '280000', NULL, 'OD', 'Dotations amortissements 2023', 8750.00, 1, @marq);
    SET @marq = @marq + 1;
    INSERT INTO dbo.F_ECRITUREC (EC_Piece, EC_Date, CG_Num, CT_Num, JO_Num, EC_Intitule, EC_Montant, EC_Sens, cbMarq)
    VALUES ('DOT2024', '2024-12-31', '681000', NULL, 'OD', 'Dotations amortissements 2024', 8750.00, 0, @marq);
    SET @marq = @marq + 1;
    INSERT INTO dbo.F_ECRITUREC (EC_Piece, EC_Date, CG_Num, CT_Num, JO_Num, EC_Intitule, EC_Montant, EC_Sens, cbMarq)
    VALUES ('DOT2024', '2024-12-31', '280000', NULL, 'OD', 'Dotations amortissements 2024', 8750.00, 1, @marq);
    SET @marq = @marq + 1;

    PRINT 'Écritures insérées : ' + CAST(@marq AS VARCHAR) + ' lignes';
END
GO

EXEC dbo.usp_seed_ecritures;
GO
DROP PROCEDURE dbo.usp_seed_ecritures;
GO

-- =============================================================================
-- DOCUMENTS COMMERCIAUX — Factures et commandes 2024
-- =============================================================================

-- Quelques commandes clients en cours
INSERT INTO dbo.F_DOCENTETE (DO_Piece, DO_Type, DO_Date, DO_Tiers, DO_TotalHT, DO_TotalTTC, DO_TotalTVA, DO_Statut, DO_DateLivr, cbMarq)
VALUES
('CMD-2024-001', 1, '2024-09-15', 'CL001',  4500.00,  5400.00,  900.00, 0, '2024-10-01', 1),
('CMD-2024-002', 1, '2024-09-18', 'CL003',  8200.00,  9840.00, 1640.00, 0, '2024-10-05', 2),
('CMD-2024-003', 1, '2024-09-22', 'CL007',  3100.00,  3720.00,  620.00, 0, '2024-10-08', 3),
('CMD-2024-004', 1, '2024-10-01', 'CL010',  6700.00,  8040.00, 1340.00, 0, '2024-10-15', 4),
('CMD-2024-005', 1, '2024-10-05', 'CL014', 12500.00, 15000.00, 2500.00, 0, '2024-10-20', 5);
GO

-- Factures émises (type 6) et quelques avoirs (type 7)
INSERT INTO dbo.F_DOCENTETE (DO_Piece, DO_Type, DO_Date, DO_Tiers, DO_TotalHT, DO_TotalTTC, DO_TotalTVA, DO_Statut, cbMarq)
VALUES
('FA-2024-0001', 6, '2024-01-15', 'CL001',  3200.00,  3840.00,  640.00, 1, 10),
('FA-2024-0002', 6, '2024-01-22', 'CL005',  5800.00,  6960.00, 1160.00, 1, 11),
('FA-2024-0003', 6, '2024-02-08', 'CL003',  2400.00,  2880.00,  480.00, 1, 12),
('FA-2024-0004', 6, '2024-02-14', 'CL009',  7100.00,  8520.00, 1420.00, 1, 13),
('FA-2024-0005', 6, '2024-03-03', 'CL002',  4300.00,  5160.00,  860.00, 1, 14),
('FA-2024-0006', 6, '2024-03-20', 'CL011',  1900.00,  2280.00,  380.00, 1, 15),
('FA-2024-0007', 6, '2024-04-11', 'CL004',  6500.00,  7800.00, 1300.00, 1, 16),
('FA-2024-0008', 6, '2024-04-25', 'CL013',  3800.00,  4560.00,  760.00, 1, 17),
('FA-2024-0009', 6, '2024-05-07', 'CL006',  9200.00, 11040.00, 1840.00, 1, 18),
('FA-2024-0010', 6, '2024-05-19', 'CL008',  4100.00,  4920.00,  820.00, 1, 19),
('FA-2024-0011', 6, '2024-06-03', 'CL015',  2700.00,  3240.00,  540.00, 1, 20),
('FA-2024-0012', 6, '2024-06-17', 'CL012',  5400.00,  6480.00, 1080.00, 1, 21),
('FA-2024-0013', 6, '2024-07-08', 'CL001',  8900.00, 10680.00, 1780.00, 1, 22),
('FA-2024-0014', 6, '2024-07-22', 'CL007',  3300.00,  3960.00,  660.00, 1, 23),
('FA-2024-0015', 6, '2024-08-05', 'CL003', 11200.00, 13440.00, 2240.00, 1, 24),
('FA-2024-0016', 6, '2024-08-19', 'CL010',  2800.00,  3360.00,  560.00, 1, 25),
('FA-2024-0017', 6, '2024-09-02', 'CL014', 15000.00, 18000.00, 3000.00, 1, 26),
('FA-2024-0018', 6, '2024-09-16', 'CL005',  6200.00,  7440.00, 1240.00, 1, 27),
('FA-2024-0019', 6, '2024-10-01', 'CL002',  4700.00,  5640.00,  940.00, 1, 28),
('FA-2024-0020', 6, '2024-10-10', 'CL009',  8800.00, 10560.00, 1760.00, 1, 29),
-- Avoirs
('AV-2024-0001', 7, '2024-03-25', 'CL003', -1200.00, -1440.00, -240.00, 1, 30),
('AV-2024-0002', 7, '2024-07-30', 'CL001',  -800.00,  -960.00, -160.00, 1, 31);
GO

-- Lignes de documents (pour VW_STOCKS_LOGISTIQUE)
INSERT INTO dbo.F_DOCLIGNE (DO_Piece, DO_Type, AR_Ref, DE_No, DL_Qte, DL_PrixUnitaire, DL_MontantHT, cbMarq)
VALUES
('FA-2024-0001', 6, 'BAG-OR-18',   1,  1, 1850.00, 1850.00, 101),
('FA-2024-0001', 6, 'BOU-CREO',    1,  3,  450.00, 1350.00, 102),
('FA-2024-0002', 6, 'MON-HOMME',   1,  2, 2400.00, 4800.00, 103),
('FA-2024-0003', 6, 'BRA-CHARM',   1,  8,  280.00, 2240.00, 104),  -- légèrement > total car arrondi
('FA-2024-0004', 6, 'MON-FEMME',   1,  2, 3200.00, 6400.00, 105),
('FA-2024-0005', 6, 'COL-OR-45',   1,  4,  980.00, 3920.00, 106),
('FA-2024-0006', 6, 'BAG-ARG-01',  1,  5,  320.00, 1600.00, 107),
('FA-2024-0007', 6, 'BOU-PEND',    1,  5, 1100.00, 5500.00, 108),
('FA-2024-0008', 6, 'COL-PERL',    1,  3, 1250.00, 3750.00, 109),
('FA-2024-0009', 6, 'BAG-OR-18',   1,  4, 1850.00, 7400.00, 110),
('FA-2024-0009', 6, 'COF-PREM',    1,  4,   45.00,  180.00, 111),
('FA-2024-0010', 6, 'BRA-OR-19',   1,  5,  760.00, 3800.00, 112),
('FA-2024-0011', 6, 'BAG-ARG-01',  1,  8,  320.00, 2560.00, 113),
('FA-2024-0012', 6, 'MON-HOMME',   2,  2, 2400.00, 4800.00, 114),
('FA-2024-0013', 6, 'MON-FEMME',   1,  2, 3200.00, 6400.00, 115),
('FA-2024-0013', 6, 'MON-HOMME',   1,  1, 2400.00, 2400.00, 116),
('FA-2024-0014', 6, 'COL-OR-45',   3,  3,  980.00, 2940.00, 117),
('FA-2024-0015', 6, 'BAG-OR-18',   1,  5, 1850.00, 9250.00, 118),
('FA-2024-0015', 6, 'COL-PERL',    1,  1, 1250.00, 1250.00, 119),
('FA-2024-0016', 6, 'BOU-CREO',    2,  6,  450.00, 2700.00, 120),
('FA-2024-0017', 6, 'MON-FEMME',   1,  4, 3200.00,12800.00, 121),
('FA-2024-0018', 6, 'BAG-OR-18',   1,  3, 1850.00, 5550.00, 122),
('FA-2024-0019', 6, 'BRA-OR-19',   1,  5,  760.00, 3800.00, 123),
('FA-2024-0020', 6, 'MON-HOMME',   1,  3, 2400.00, 7200.00, 124);
GO

-- =============================================================================
-- ÉCRITURES ANALYTIQUES (échantillon pour VW_ANALYTIQUE)
-- =============================================================================
INSERT INTO dbo.F_ECRITUREA (EC_No, EA_Ligne, N_Analytique, CA_Num, EA_Montant, EA_Quantite, cbMarq)
SELECT
    ec.EC_No,
    1,
    1,
    CASE
        WHEN ec.CT_Num IN ('CL001','CL002','CL003') THEN '1GRO'
        WHEN ec.CT_Num IN ('CL004','CL005','CL006') THEN '1DET'
        ELSE '1EXP'
    END,
    ec.EC_Montant,
    0,
    ec.cbMarq + 50000
FROM dbo.F_ECRITUREC ec
WHERE ec.CG_Num = '701000'
  AND ec.EC_Date >= '2024-01-01';
GO

PRINT 'Données commerciales insérées';
GO

-- =============================================================================
-- INDEX POUR LES PERFORMANCES (simuler un vrai Sage)
-- =============================================================================
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ECRITUREC_Date')
    CREATE INDEX IX_ECRITUREC_Date    ON dbo.F_ECRITUREC (EC_Date);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ECRITUREC_CG')
    CREATE INDEX IX_ECRITUREC_CG      ON dbo.F_ECRITUREC (CG_Num);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ECRITUREC_CT')
    CREATE INDEX IX_ECRITUREC_CT      ON dbo.F_ECRITUREC (CT_Num);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_DOCENTETE_Date')
    CREATE INDEX IX_DOCENTETE_Date    ON dbo.F_DOCENTETE (DO_Date);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_DOCENTETE_Tiers')
    CREATE INDEX IX_DOCENTETE_Tiers   ON dbo.F_DOCENTETE (DO_Tiers);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_DOCLIGNE_Piece')
    CREATE INDEX IX_DOCLIGNE_Piece    ON dbo.F_DOCLIGNE (DO_Piece, DO_Type);
GO

-- Vérification finale
SELECT 'F_ECRITUREC'    AS [Table], COUNT(*) AS [Lignes] FROM dbo.F_ECRITUREC
UNION ALL SELECT 'F_ECRITUREA',    COUNT(*) FROM dbo.F_ECRITUREA
UNION ALL SELECT 'F_COMPTET',      COUNT(*) FROM dbo.F_COMPTET
UNION ALL SELECT 'F_DOCENTETE',    COUNT(*) FROM dbo.F_DOCENTETE
UNION ALL SELECT 'F_ARTICLE',      COUNT(*) FROM dbo.F_ARTICLE
UNION ALL SELECT 'F_ARTSTOCK',     COUNT(*) FROM dbo.F_ARTSTOCK
UNION ALL SELECT 'F_IMMOBILISATION', COUNT(*) FROM dbo.F_IMMOBILISATION;
GO

PRINT '=== SAGE_TEST prêt pour les tests Cockpit Agent ===';
GO
