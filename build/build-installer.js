#!/usr/bin/env node
'use strict';

/**
 * build-installer.js — Pipeline de build complet de l'installeur Electron.
 *
 * Étapes :
 *  1. Build service  → dist/service/cockpit-agent-service.exe
 *  2. Build renderer → installer/dist/  (Vite)
 *  3. Package Electron → dist/installer/ (electron-builder, NSIS)
 *
 * Usage : node build/build-installer.js [--skip-service]
 */

const { execSync } = require('child_process');
const path  = require('path');
const fs    = require('fs');

const ROOT      = path.resolve(__dirname, '..');
const INST_DIR  = path.join(ROOT, 'installer');
const DIST_DIR  = path.join(ROOT, 'dist');
const args      = process.argv.slice(2);
const skipSvc   = args.includes('--skip-service');

console.log('=== Cockpit Agent — build complet ===\n');

// ── 1. Build service ─────────────────────────────────────────────────────────
if (!skipSvc) {
  console.log('── Étape 1/3 : Build service\n');
  execSync('node build/build-service.js', { cwd: ROOT, stdio: 'inherit' });
  console.log();
} else {
  console.log('── Étape 1/3 : Build service [ignoré]\n');
}

// Vérification du .exe
const svcExe = path.join(DIST_DIR, 'service', 'cockpit-agent-service.exe');
if (!fs.existsSync(svcExe)) {
  console.error('❌ cockpit-agent-service.exe introuvable. Lancez sans --skip-service.');
  process.exit(1);
}

// ── 2. Build renderer Vite ───────────────────────────────────────────────────
console.log('── Étape 2/3 : Build renderer Vite\n');
execSync('npm run build:renderer', { cwd: INST_DIR, stdio: 'inherit' });
console.log();

// ── 3. Package electron-builder ──────────────────────────────────────────────
console.log('── Étape 3/3 : Packaging Electron (NSIS)\n');

// S'assurer que electron-builder voit le .exe du service comme extraResource
const ebConfig = path.join(ROOT, 'electron-builder.yml');
console.log(`Config : ${ebConfig}`);

execSync('npx electron-builder --config electron-builder.yml --win', {
  cwd: ROOT,
  stdio: 'inherit',
  env: { ...process.env, SERVICE_EXE_PATH: svcExe },
});

console.log('\n✅ Build terminé — installeur disponible dans dist/installer/');
