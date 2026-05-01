'use strict';

/**
 * Preload Electron — pont contextBridge entre le main process et le renderer React.
 * Expose uniquement les fonctions nécessaires via window.cockpit.
 * nodeIntegration = false, contextIsolation = true → sécurité maximale.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cockpit', {
  // ── SQL ──────────────────────────────────────────────────────────────────
  sqlTest: (params) =>
    ipcRenderer.invoke('sql:test', params),

  sqlDetect: () =>
    ipcRenderer.invoke('sql:detect'),

  sqlDeploy: () =>
    ipcRenderer.invoke('sql:deploy'),

  onSqlProgress: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('sql:progress', handler);
    // Retourner une fonction de nettoyage
    return () => ipcRenderer.removeListener('sql:progress', handler);
  },

  // ── API ───────────────────────────────────────────────────────────────────
  apiValidate: (params) =>
    ipcRenderer.invoke('api:validate', params),

  // ── Service Windows ───────────────────────────────────────────────────────
  serviceInstall: (params) =>
    ipcRenderer.invoke('service:install', params),

  onServiceProgress: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('service:progress', handler);
    return () => ipcRenderer.removeListener('service:progress', handler);
  },

  // ── Système ───────────────────────────────────────────────────────────────
  // Compte Windows courant (pré-rempli dans l'UI quand Windows Auth est sélectionné)
  windowsUser: {
    domain: process.env.USERDOMAIN || '.',
    user:   process.env.USERNAME   || '',
  },

  // ── App ───────────────────────────────────────────────────────────────────
  openDashboard: () =>
    ipcRenderer.invoke('app:openDashboard'),

  openHealthDashboard: () =>
    ipcRenderer.invoke('app:openHealthDashboard'),

  // ── Gestion (mode post-installation) ─────────────────────────────────────
  checkInstalled: () =>
    ipcRenderer.invoke('app:checkInstalled'),

  getAgentStatus: () =>
    ipcRenderer.invoke('app:getAgentStatus'),

  updateToken: (token) =>
    ipcRenderer.invoke('app:updateToken', { token }),

  restartService: () =>
    ipcRenderer.invoke('app:restartService'),

  // ── Logs temps réel ───────────────────────────────────────────────────────
  getLogs: () =>
    ipcRenderer.invoke('app:getLogs'),

  startLogStream: () =>
    ipcRenderer.invoke('app:startLogStream'),

  stopLogStream: () =>
    ipcRenderer.invoke('app:stopLogStream'),

  onLogLines: (callback) => {
    const handler = (_, lines) => callback(lines);
    ipcRenderer.on('logs:lines', handler);
    return () => ipcRenderer.removeListener('logs:lines', handler);
  },

  // ── Mise à jour automatique ───────────────────────────────────────────────
  checkForUpdate: () =>
    ipcRenderer.invoke('app:checkForUpdate'),

  downloadUpdate: (fileUrl, checksum) =>
    ipcRenderer.invoke('app:downloadUpdate', { fileUrl, checksum }),

  applyUpdate: (tmpPath) =>
    ipcRenderer.invoke('app:applyUpdate', { tmpPath }),

  onUpdateProgress: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('update:progress', handler);
    return () => ipcRenderer.removeListener('update:progress', handler);
  },
});
