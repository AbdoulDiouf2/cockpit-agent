'use strict';

function escapeXmlText(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function formatServiceInstallFailure(diagnostic) {
  const phase = ['prepare', 'remove-old', 'install', 'start'].includes(diagnostic?.phase)
    ? diagnostic.phase : 'unknown';
  const code = Number.isInteger(diagnostic?.code) ? diagnostic.code : 'unknown';
  const eventId = diagnostic?.eventId === 7038 ? 7038 : null;

  if (eventId === 7038 || (phase === 'start' && code === 15)) {
    return `CockpitAgent: echec au demarrage (WinSW ${code}, SCM ${eventId || 'non lu'}). ` +
      'Le compte Windows du service ne peut pas ouvrir de session. ' +
      'Verifier le nom du compte, son vrai mot de passe Windows (pas le code PIN) ' +
      'et le droit Ouvrir une session en tant que service. ' +
      'Consulter les evenements Systeme 7038/7000 sur ce serveur.';
  }

  return `CockpitAgent: echec pendant ${phase} (WinSW ${code}). ` +
    'Consulter les evenements Systeme du Service Control Manager et ' +
    'CockpitAgent.wrapper.log dans le dossier daemon de l installation.';
}

module.exports = { formatServiceInstallFailure, escapeXmlText };
