'use strict';

/**
 * Stockage sécurisé des credentials via Windows Credential Manager (keytar).
 * Les mots de passe SQL et le token API ne sont JAMAIS écrits en clair sur le disque.
 */

const keytar = require('keytar');
const { KEYTAR_SERVICE } = require('../../shared/constants');

async function saveCredential(key, value) {
  await keytar.setPassword(KEYTAR_SERVICE, key, value);
}

async function getCredential(key) {
  return keytar.getPassword(KEYTAR_SERVICE, key);
}

async function deleteCredential(key) {
  return keytar.deletePassword(KEYTAR_SERVICE, key);
}

module.exports = { saveCredential, getCredential, deleteCredential };
