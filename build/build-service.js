#!/usr/bin/env node
'use strict';

/**
 * build-service.js — Compile le service Node.js en exécutable Windows autonome.
 *
 * Utilise pkg (https://github.com/vercel/pkg) pour créer un .exe qui embarque
 * Node.js, le code JS et les dépendances natives précompilées.
 *
 * Usage : node build/build-service.js
 */

const { execSync } = require('child_process');
const path  = require('path');
const fs    = require('fs');

const ROOT    = path.resolve(__dirname, '..');
const SVC_DIR = path.join(ROOT, 'service');
const OUT_DIR = path.join(ROOT, 'dist', 'service');

console.log('=== Build service ===');

// 1. Créer le dossier de sortie
fs.mkdirSync(OUT_DIR, { recursive: true });

// 2. Installer les dépendances du service (toutes — pkg en devDep est nécessaire au build)
console.log('📦 npm install (service)…');
execSync('npm install', { cwd: SVC_DIR, stdio: 'inherit' });

// 3. Compiler avec pkg
const entry  = path.join(SVC_DIR, 'src', 'index.js');
const output = path.join(OUT_DIR, 'cockpit-agent-service.exe');

console.log('🔨 pkg compile…');
execSync(
  `npx pkg "${entry}" --targets node18-win-x64 --output "${output}"`,
  { cwd: ROOT, stdio: 'inherit', shell: true }
);

console.log(`✅ Service compilé → ${output}`);
