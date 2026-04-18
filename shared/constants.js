'use strict';

// ─── Plateforme SaaS ──────────────────────────────────────────────────────────
const PLATFORM_URL = process.env.COCKPIT_URL || 'https://cockpit.nafakatech.com';
const AGENT_VERSION = '1.0.0';

// ─── Vues Sage 100 synchronisées ─────────────────────────────────────────────
const VIEWS = {
  VW_KPI_SYNTESE:         { interval: 5,   mode: 'FULL' },
  VW_METADATA_AGENT:      { interval: 5,   mode: 'FULL' },
  VW_GRAND_LIVRE_GENERAL: { interval: 15,  mode: 'INCREMENTAL' },
  VW_CLIENTS:             { interval: 15,  mode: 'INCREMENTAL' },
  VW_FOURNISSEURS:        { interval: 15,  mode: 'INCREMENTAL' },
  VW_TRESORERIE:          { interval: 15,  mode: 'INCREMENTAL' },
  VW_COMMANDES:           { interval: 30,  mode: 'INCREMENTAL' },
  VW_ANALYTIQUE:          { interval: 30,  mode: 'INCREMENTAL' },
  VW_STOCKS:              { interval: 60,  mode: 'INCREMENTAL' },
  VW_FINANCE_GENERAL:     { interval: 60,  mode: 'INCREMENTAL' },
  VW_IMMOBILISATIONS:     { interval: 360, mode: 'FULL' },
  VW_PAIE:                { interval: 360, mode: 'FULL' },
};

// Tables Sage 100 core dont la présence est requise
const SAGE_CORE_TABLES = [
  'F_ECRITUREC', 'F_COMPTET',  'F_COMPTEG', 'F_JOURNAUX',
  'F_DOCENTETE', 'F_DOCLIGNE', 'F_ARTICLE', 'F_ARTSTOCK',
  'F_IMMOBILISATION', 'F_ECRITUREA', 'F_COMPTEA', 'F_ENUMANAL',
];

// Tables de configuration créées par l'agent dans la base Sage
const PLATFORM_TABLES = ['PLATEFORME_PARAMS', 'PLATEFORME_CONFIG_GROUPE'];

// ─── Service Windows ──────────────────────────────────────────────────────────
const SERVICE_NAME        = 'CockpitAgent';
const SERVICE_DESCRIPTION = 'Agent de synchronisation Cockpit ↔ Sage 100';
const HEALTH_PORT         = 8444;

// ─── Sécurité ─────────────────────────────────────────────────────────────────
const KEYTAR_SERVICE      = 'Cockpit-Agent';
const SALT_CRYPTO         = 'cockpit-agent-2026';
const BATCH_SIZE          = 5000;   // Lignes max par batch ingest
const UPLOAD_TIMEOUT_MS   = 30000;  // 30s timeout upload

module.exports = {
  PLATFORM_URL, AGENT_VERSION,
  VIEWS, SAGE_CORE_TABLES, PLATFORM_TABLES,
  SERVICE_NAME, SERVICE_DESCRIPTION, HEALTH_PORT,
  KEYTAR_SERVICE, SALT_CRYPTO, BATCH_SIZE, UPLOAD_TIMEOUT_MS,
};
