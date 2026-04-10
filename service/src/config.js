'use strict';

/**
 * Lecture de la configuration de l'agent.
 * Stockée dans le registre Windows (HKLM\SOFTWARE\CockpitAgent) ou
 * dans un fichier JSON adjacent (config.json) pour le dev.
 */

const path = require('path');
const fs   = require('fs');

let _config = null;

function load() {
  if (_config) return _config;

  // 1. Tentative lecture depuis le registre Windows (production)
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const reg = require('winreg');
    // Lecture synchrone simulée — en production on lit avant le démarrage du scheduler
    // Voir windows-service.js pour la logique d'écriture au moment de l'installation
  } catch (_) {
    // winreg non disponible (dev Linux/Mac) — fallback fichier
  }

  // 2. Fallback : fichier config.json — chemin fixe relatif au module
  const configPaths = [
    path.join(__dirname, '..', 'config.json'),       // service/config.json  (dev + prod)
    path.join(__dirname, '..', '..', 'config.json'), // cockpit-agent/config.json
    path.join(process.cwd(), 'config.json'),          // CWD (fallback ultime)
  ];

  for (const p of configPaths) {
    if (fs.existsSync(p)) {
      try {
        _config = JSON.parse(fs.readFileSync(p, 'utf8'));
        return _config;
      } catch (e) {
        throw new Error(`Impossible de lire ${p} : ${e.message}`);
      }
    }
  }

  throw new Error(
    'Configuration introuvable. Lancez l\'installeur pour configurer l\'agent.'
  );
}

function get(key) {
  const cfg = load();
  return cfg[key];
}

/**
 * Sauvegarde la configuration dans config.json (utilisé par l'installeur).
 * Chemin fixe : cockpit-agent/service/config.json (trouvé par load() via __dirname)
 */
function save(config) {
  const dest = path.join(__dirname, '..', 'config.json');
  fs.writeFileSync(dest, JSON.stringify(config, null, 2), 'utf8');
  _config = config;
}

module.exports = { load, get, save };
