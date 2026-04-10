'use strict';

/**
 * Installation / désinstallation du service Windows via node-windows.
 * Usage :
 *   node windows-service.js install
 *   node windows-service.js uninstall
 */

const path    = require('path');
const Service = require('node-windows').Service;
const { SERVICE_NAME, SERVICE_DESCRIPTION } = require('../../shared/constants');

const svc = new Service({
  name:        SERVICE_NAME,
  description: SERVICE_DESCRIPTION,
  script:      path.join(__dirname, 'index.js'),
  nodeOptions: ['--max-old-space-size=256'],
  env: [
    { name: 'NODE_ENV', value: 'production' },
  ],
});

const [,, command] = process.argv;

if (command === 'install') {
  svc.on('install', () => {
    console.log(`✅ Service "${SERVICE_NAME}" installé avec succès`);
    svc.start();
    console.log('✅ Service démarré');
  });
  svc.on('error', (err) => {
    console.error('❌ Erreur installation service :', err);
  });
  svc.install();

} else if (command === 'uninstall') {
  svc.on('uninstall', () => {
    console.log(`✅ Service "${SERVICE_NAME}" désinstallé`);
  });
  svc.uninstall();

} else {
  console.error('Usage: node windows-service.js [install|uninstall]');
  process.exit(1);
}
