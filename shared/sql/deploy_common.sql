-- =============================================================================
-- COCKPIT AGENT — deploy_common.sql
-- Tables de configuration créées par l'agent dans la base Sage 100 cliente.
-- Ces tables ne touchent AUCUNE donnée Sage — elles sont dans le même schéma
-- uniquement pour éviter d'avoir besoin d'une base secondaire.
-- =============================================================================

-- Table de configuration générale de l'agent
IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_NAME = 'PLATEFORME_PARAMS'
)
BEGIN
    CREATE TABLE dbo.PLATEFORME_PARAMS (
        PARAM_KEY    NVARCHAR(100)  NOT NULL PRIMARY KEY,
        PARAM_VALUE  NVARCHAR(2000) NULL,
        UPDATED_AT   DATETIME       NOT NULL DEFAULT GETDATE()
    );
    PRINT 'Table PLATEFORME_PARAMS créée';
END
GO

-- Table de configuration par groupe/dossier Sage (multi-société)
IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_NAME = 'PLATEFORME_CONFIG_GROUPE'
)
BEGIN
    CREATE TABLE dbo.PLATEFORME_CONFIG_GROUPE (
        GROUPE_CODE   NVARCHAR(20)   NOT NULL,
        CONFIG_KEY    NVARCHAR(100)  NOT NULL,
        CONFIG_VALUE  NVARCHAR(2000) NULL,
        UPDATED_AT    DATETIME       NOT NULL DEFAULT GETDATE(),
        PRIMARY KEY (GROUPE_CODE, CONFIG_KEY)
    );
    PRINT 'Table PLATEFORME_CONFIG_GROUPE créée';
END
GO

-- Valeur initiale d'installation
IF NOT EXISTS (SELECT 1 FROM PLATEFORME_PARAMS WHERE PARAM_KEY = 'INSTALL_DATE')
    INSERT INTO PLATEFORME_PARAMS (PARAM_KEY, PARAM_VALUE)
    VALUES ('INSTALL_DATE', CONVERT(NVARCHAR, GETDATE(), 126));
GO
