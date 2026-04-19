'use strict';

/**
 * Chiffrement AES-256-GCM du token API Cockpit.
 * La clé est dérivée du machine ID — le fichier chiffré ne peut pas être
 * déchiffré sur une autre machine même s'il est copié.
 */

const crypto    = require('crypto');
const fs        = require('fs');
const path      = require('path');
const { machineIdSync } = require('node-machine-id');
const { PLATFORM_URL, SALT_CRYPTO } = require('../../shared/constants');
const config    = require('./config');

/**
 * Répertoire de données réel (hors asar) où le token est écrit.
 * - En prod (app.isPackaged) : resources/service/dist/ — là où se trouve le .exe du service
 * - En dev                   : cockpit-agent/service/    — chemin de travail habituel
 */
function _getDataDir() {
  const { app } = require('electron');
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'service', 'dist');
  }
  return path.join(__dirname, '..', '..', 'service');
}

function _deriveKey() {
  const id = machineIdSync();
  return crypto.scryptSync(id, SALT_CRYPTO, 32);
}

/**
 * Chiffre et persiste le token API sur le disque.
 */
function saveToken(token) {
  const tokenFile = path.join(_getDataDir(), '.cockpit_token');
  fs.mkdirSync(path.dirname(tokenFile), { recursive: true });

  const key = _deriveKey();
  const iv  = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  const tag       = cipher.getAuthTag();

  const payload = Buffer.concat([iv, tag, encrypted]).toString('base64');
  fs.writeFileSync(tokenFile, payload, 'utf8');
}

/**
 * Déchiffre et retourne le token API depuis le fichier local.
 */
function getToken() {
  const tokenFile = path.join(_getDataDir(), '.cockpit_token');
  if (!fs.existsSync(tokenFile)) {
    throw new Error('Token API introuvable — réinstallez l\'agent ou régénérez le token depuis le portail.');
  }

  const raw     = Buffer.from(fs.readFileSync(tokenFile, 'utf8'), 'base64');
  const iv      = raw.slice(0, 16);
  const tag     = raw.slice(16, 32);
  const payload = raw.slice(32);

  const key      = _deriveKey();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);

  return decipher.update(payload) + decipher.final('utf8');
}

function getPlatformUrl() {
  return config.get('platform_url') || PLATFORM_URL;
}

module.exports = { saveToken, getToken, getPlatformUrl };
