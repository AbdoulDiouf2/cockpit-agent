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
});
