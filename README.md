# Cockpit Agent — Documentation technique

Agent on-premises qui synchronise les données Sage 100 vers la plateforme SaaS Cockpit.  
Architecture push HTTPS : l'agent initie toutes les communications, aucun port entrant n'est nécessaire.

---

## Table des matières

1. [Vue d'ensemble](#1-vue-densemble)
2. [Architecture](#2-architecture)
3. [Structure du projet](#3-structure-du-projet)
4. [Prérequis](#4-prérequis)
5. [Développement local](#5-développement-local)
6. [Build et packaging](#6-build-et-packaging)
7. [Processus d'installation (côté client)](#7-processus-dinstallation-côté-client)
8. [Cycle de synchronisation](#8-cycle-de-synchronisation)
9. [Sécurité](#9-sécurité)
10. [Health check](#10-health-check)
11. [Gestion des erreurs SQL](#11-gestion-des-erreurs-sql)
12. [Logs](#12-logs)
13. [Commandes distantes](#13-commandes-distantes)
14. [Détection version Sage 100](#14-détection-version-sage-100)
15. [Références](#15-références)

---

## 1. Vue d'ensemble

```
Serveur client (on-premises)              Cloud Cockpit
┌─────────────────────────────┐           ┌──────────────────────┐
│  SQL Server                 │           │  api.cockpit.app     │
│  └─ Base Sage 100           │           │                      │
│       └─ 12 vues BI         │──HTTPS──► │  POST /api/v1/agent/ │
│                             │           │    ingest            │
│  Service Windows            │◄─────────│    heartbeat (cmds)  │
│  └─ CockpitAgent            │           │    config            │
│       └─ health :8444       │           └──────────────────────┘
└─────────────────────────────┘
```

**Principe zéro-copie** : aucune donnée brute ERP ne transite vers le cloud. Seuls les agrégats des vues SQL déployées localement sont envoyés. Les données restent sur le serveur du client.

---

## 2. Architecture

### Composants

| Composant | Technologie | Rôle |
|-----------|-------------|------|
| **Installeur** | Electron 28 + React 18 | Interface graphique d'installation (wizard 6 étapes) |
| **Service** | Node.js 18 + node-windows | Service Windows de synchronisation en arrière-plan |
| **SQL Scripts** | SQL Server (T-SQL) | 12 vues BI déployées dans la base Sage |
| **Shared** | JavaScript | Constantes partagées entre installeur et service |

### Flux de données

```
SAGE 100 DB
    │
    ├─ F_ECRITUREC, F_COMPTEG, F_JOURNAUX → VW_GRAND_LIVRE_GENERAL
    ├─ F_ECRITUREC (EC_Compte LIKE '5%')  → VW_TRESORERIE
    ├─ F_ECRITUREC (agrégé)               → VW_FINANCE_GENERAL
    ├─ F_COMPTET (CT_Type=0)              → VW_CLIENTS
    ├─ F_COMPTET (CT_Type=1)              → VW_FOURNISSEURS
    ├─ F_ECRITUREA                        → VW_ANALYTIQUE
    ├─ F_ECRITUREC (compte 64%)           → VW_PAIE
    ├─ F_DOCENTETE + F_COMPTET            → VW_COMMANDES
    ├─ F_ARTSTOCK + F_ARTICLE             → VW_STOCKS
    ├─ F_IMMOBILISATION                   → VW_IMMOBILISATIONS
    ├─ PLATEFORME_PARAMS                  → VW_METADATA_AGENT
    └─ Sous-requêtes agrégées             → VW_KPI_SYNTESE
           │
    Scheduler (node-schedule)
    ├─ Toutes les minutes → engine.run()
    │     ├─ shouldSync() → vérifie intervalle par vue
    │     ├─ SELECT TOP 5000 WHERE Watermark_Sync > @watermark
    │     ├─ transformer.transform() → normalisation types
    │     ├─ uploader.send() → POST /api/v1/agent/ingest (chunking 5000 lignes)
    │     └─ watermark.set() → curseur mis à jour après ACK
    └─ Toutes les 5 min → sendHeartbeat()
          └─ Reçoit commands[] → FORCE_FULL_SYNC
```

### Mécanisme watermark (cbMarq)

Sage 100 ajoute un champ `cbMarq` (entier auto-incrémenté) à toutes ses tables. Les vues l'exposent sous l'alias `Watermark_Sync`. L'agent persiste le dernier `cbMarq` traité dans `PLATEFORME_PARAMS` et ne re-lit que les lignes supérieures au curseur. Cela rend la synchronisation **incrémentale** sans aucune modification de la base Sage.

---

## 3. Structure du projet

```
cockpit-agent/
├── package.json              # Monorepo root — workspaces: [installer, service]
├── electron-builder.yml      # Config packaging NSIS x64
├── .gitignore
│
├── build/
│   ├── build-service.js      # Compile service → .exe (pkg)
│   └── build-installer.js    # Pipeline complet : service → Vite → NSIS
│
├── shared/
│   ├── constants.js          # VIEWS, BATCH_SIZE, SERVICE_NAME, HEALTH_PORT…
│   └── sql/
│       ├── deploy_common.sql  # Tables PLATEFORME_PARAMS + PLATEFORME_CONFIG_GROUPE
│       ├── views_stable.sql   # 9 vues compatibles toutes versions Sage
│       ├── views_v21plus.sql  # VW_STOCKS / COMMANDES / IMMO pour Sage v21+
│       ├── views_v15v17.sql   # Idem pour Sage v15–v17
│       └── views_fallback.sql # Variante NULL-safe pour versions inconnues
│
├── service/                  # Service Windows Node.js
│   ├── package.json
│   └── src/
│       ├── index.js           # Point d'entrée + graceful shutdown
│       ├── config.js          # Lecture config.json
│       ├── scheduler.js       # node-schedule : sync 1min / heartbeat 5min
│       ├── windows-service.js # CLI install/uninstall
│       ├── sql/
│       │   ├── connection.js  # Pool mssql singleton (Windows Auth ou SQL Auth)
│       │   ├── detector.js    # Détection version Sage via INFORMATION_SCHEMA
│       │   └── deployer.js    # Déploiement vues (split GO, saveCapabilities)
│       ├── sync/
│       │   ├── engine.js      # Boucle sync, shouldSync(), processCommands()
│       │   ├── transformer.js # Normalisation Date→ISO, BigInt→Number, Buffer→hex
│       │   ├── uploader.js    # POST ingest (chunking) + sendHeartbeat
│       │   └── watermark.js   # get/set/reset curseur cbMarq dans PLATEFORME_PARAMS
│       ├── security/
│       │   ├── credential-store.js  # keytar : mot de passe SQL dans Windows Cred. Manager
│       │   └── token.js             # AES-256-GCM : token chiffré lié au machine ID
│       └── utils/
│           ├── health.js      # Serveur HTTP :8444 — dashboard HTML (/) + JSON (/health)
│           └── logger.js      # Winston + DailyRotateFile (30j rétention)
│
└── installer/                # Installeur Electron + React
    ├── main.js                # Process principal — handlers IPC
    ├── preload.js             # contextBridge → window.cockpit
    ├── index.html
    ├── vite.config.js
    └── src/
        ├── main.jsx
        ├── styles.css
        ├── App.jsx            # Routing 6 étapes + état global
        └── steps/
            ├── Step1_Welcome.jsx   # Consentement CGU/RGPD
            ├── Step2_Database.jsx  # Formulaire SQL Server + test connexion
            ├── Step3_Detection.jsx # Affichage capacités Sage détectées
            ├── Step4_Views.jsx     # Déploiement SQL + barre de progression
            ├── Step5_Token.jsx     # Validation token API + installation service
            └── Step6_Done.jsx      # Résumé installation + lien dashboard
```

---

## 4. Prérequis

### Machine cliente (production)

| Prérequis | Version minimale |
|-----------|-----------------|
| Windows Server / Windows 10 | 64 bits |
| Node.js | 18 LTS (embarqué dans le .exe via pkg) |
| SQL Server | 2012+ (pour la fonction FORMAT) |
| Sage 100 | v15 minimum |
| .NET Framework | 4.7.2+ (requis par node-windows) |
| Accès réseau sortant | `api.cockpit.app:443` (HTTPS) |

Le compte SQL utilisé pour la connexion doit avoir :
- `db_datareader` sur la base Sage 100
- `db_ddladmin` pour la création des vues (opération unique à l'installation)

### Poste développeur

| Outil | Version |
|-------|---------|
| Node.js | 18 LTS |
| npm | 9+ |
| Electron | 28 (installé via devDep) |

---

## 5. Développement local

### Installation des dépendances

```bash
# Depuis la racine cockpit-agent/
npm install

# Dépendances installeur
cd installer && npm install && cd ..

# Dépendances service
cd service && npm install && cd ..
```

### Lancer l'installeur en mode dev

```bash
npm run dev:installer
```

Démarre Vite sur `http://localhost:5173` puis lance Electron qui charge cette URL. Les DevTools s'ouvrent automatiquement (`NODE_ENV=development`).

### Tester le service manuellement

```bash
# Depuis service/
node src/index.js
```

Variables d'environnement utiles :

```bash
COCKPIT_URL=http://localhost:3000   # Pointer vers le backend local
NODE_ENV=development
```

### Vérifier le health check

```bash
# Dashboard HTML (navigateur)
start http://127.0.0.1:8444/

# JSON machine-readable
curl http://127.0.0.1:8444/health
```

---

## 6. Build et packaging

### Build complet (service + installeur)

```bash
npm run build
```

Équivalent à :

```bash
node build/build-service.js      # → dist/service/cockpit-agent-service.exe
npm run build:installer          # → dist/installer/Cockpit Agent Setup.exe
```

### Build service seul

```bash
npm run build:service
```

Utilise [pkg](https://github.com/vercel/pkg) pour compiler `service/src/index.js` en un exécutable Windows autonome qui embarque Node.js 18.

### Build installeur seul (si .exe service déjà présent)

```bash
node build/build-installer.js --skip-service
```

### Artefacts produits

```
dist/
├── service/
│   └── cockpit-agent-service.exe   # Service Windows standalone
└── installer/
    └── Cockpit Agent Setup.exe      # Installeur NSIS x64
```

---

## 7. Processus d'installation (côté client)

L'installeur guide l'utilisateur en 6 étapes :

| Étape | Écran | Action |
|-------|-------|--------|
| 1 | Bienvenue | Acceptation CGU / RGPD |
| 2 | Base de données | Saisie SQL Server, instance, BDD, auth → `sql:test` |
| 3 | Détection | Analyse automatique `sql:detect` → affichage version Sage |
| 4 | Déploiement | Création des 12 vues → `sql:deploy` avec progress bar |
| 5 | Activation | Saisie email + token `isag_…` → `api:validate` → `service:install` |
| 6 | Terminé | Résumé + vérification health check + lien tableau de bord |

### Ce que fait `service:install`

1. Sauvegarde le mot de passe SQL dans **Windows Credential Manager** (keytar)
2. Écrit `config.json` avec la configuration SQL et l'agent ID
3. Écrit `CockpitAgent.xml` (configuration winsw) dans le dossier du service
4. Exécute un script PowerShell **élevé** (`Start-Process -Verb RunAs`) qui :
   - Arrête et supprime l'éventuel service précédent via `sc.exe stop/delete` (libère le verrou SCM sur l'exe)
   - Copie `winsw.exe` → `CockpitAgent.exe` (le SCM lock est désormais libéré)
   - Lance `CockpitAgent.exe install` puis `CockpitAgent.exe start`
5. Attend le health check `GET http://127.0.0.1:8444/health` (timeout 30s)

> **Pourquoi winsw ?** Le binaire compilé par `pkg` n'implémente pas le protocole SCM Windows (pas de `SetServiceStatus(SERVICE_RUNNING)`) → Windows renvoie l'erreur 1053. `winsw` sert de wrapper qui parle correctement au SCM et délègue l'exécution au `.exe` pkg.

> **Pourquoi l'élévation UAC ?** L'installeur NSIS lance Electron de-elevated pour éviter que l'interface graphique ne tourne en mode admin. L'opération d'installation du service nécessite elle des droits admin → on demande l'UAC ponctuellement via PowerShell.

### Désinstallation manuelle

```powershell
sc.exe stop   CockpitAgent
sc.exe delete CockpitAgent
# Supprimer ensuite le dossier d'installation
```


---

## 8. Cycle de synchronisation

### Intervalles par vue

| Vue | Intervalle | Mode | Description |
|-----|-----------|------|-------------|
| `VW_KPI_SYNTESE` | 5 min | FULL | Indicateurs synthétiques |
| `VW_METADATA_AGENT` | 5 min | FULL | Paramètres PLATEFORME_PARAMS |
| `VW_GRAND_LIVRE_GENERAL` | 15 min | INCREMENTAL | Écritures comptables |
| `VW_CLIENTS` | 15 min | INCREMENTAL | Référentiel clients |
| `VW_FOURNISSEURS` | 15 min | INCREMENTAL | Référentiel fournisseurs |
| `VW_TRESORERIE` | 15 min | INCREMENTAL | Flux trésorerie (classe 5) |
| `VW_COMMANDES` | 30 min | INCREMENTAL | Documents de vente/achat |
| `VW_ANALYTIQUE` | 30 min | INCREMENTAL | Écritures analytiques |
| `VW_STOCKS` | 60 min | INCREMENTAL | Articles et stocks |
| `VW_FINANCE_GENERAL` | 60 min | INCREMENTAL | Soldes par compte/mois |
| `VW_IMMOBILISATIONS` | 6h | FULL | Immobilisations |
| `VW_PAIE` | 6h | FULL | Charges de personnel (64%) |

Ces intervalles peuvent être **surchargés par la config distante** retournée par `GET /api/v1/agent/config`.

### Mode INCREMENTAL

```sql
SELECT TOP 5000 * FROM dbo.{viewName}
WHERE Watermark_Sync > @watermark
ORDER BY Watermark_Sync ASC
```

Après ACK du serveur, le watermark est mis à jour dans `PLATEFORME_PARAMS`.

### Mode FULL

```sql
SELECT * FROM dbo.{viewName}
```

Utilisé pour les vues dont les données sont des agrégats recalculés (pas de cbMarq stable).

### Chunking

Les résultats sont découpés en batches de **5 000 lignes maximum** avant envoi. En cas de volume élevé, plusieurs appels `POST /ingest` sont effectués pour la même vue.

---

## 9. Sécurité

### Token API

- Format : `isag_` + 48 caractères hexadécimaux
- Durée : 30 jours (renouvelable depuis le portail Cockpit)
- Stockage : fichier `.cockpit_token` **chiffré AES-256-GCM**
- Clé de chiffrement : dérivée du **machine ID** via `scryptSync(machineId, 'cockpit-agent-2026', 32)`
- Le fichier chiffré est inutilisable sur une autre machine

### Mot de passe SQL

- Stocké dans **Windows Credential Manager** (API native `keytar`)
- Jamais en clair dans `config.json`
- Accessible uniquement par le compte Windows qui a installé l'agent

### Communications réseau

- Tout le trafic vers l'API est en **HTTPS/TLS**
- L'agent initie les connexions sortantes — aucun port entrant requis
- `Authorization: Bearer <token>` dans chaque requête

### Isolation Electron

```javascript
webPreferences: {
  contextIsolation: true,   // Isolation activée
  nodeIntegration:  false,  // Node non exposé au renderer
  sandbox:          true,   // Sandbox Chromium
}
```

---

## 10. Health check & Dashboard

Le service expose un serveur HTTP local sur le port **8444** avec deux routes.

### Dashboard HTML

```
GET http://127.0.0.1:8444/
```

Interface web auto-rafraîchissante (10s) accessible depuis n'importe quel navigateur sur la machine cliente. Affiche :

- **Statut global** (Opérationnel / En erreur) avec badge coloré
- **Uptime** depuis le démarrage du service
- **Connexion SQL Server** (Connecté / Déconnecté)
- **Connexion Plateforme** (Connecté / En attente — basé sur le heartbeat)
- **Total de lignes** synchronisées depuis le démarrage
- **Tableau des 12 vues** : mode (INCRÉMENTAL/FULL), intervalle, dernier sync, nb lignes de la dernière batch

### Endpoint JSON

```
GET http://127.0.0.1:8444/health
```

```json
{
  "status": "ok",
  "lastSync": "2026-04-10T14:30:00.000Z",
  "error": null,
  "totalSynced": 145230,
  "sqlConnected": true,
  "platformConnected": true,
  "views": {
    "VW_KPI_SYNTESE": { "lastSync": "2026-04-10T14:30:00.000Z", "lastCount": 1, "mode": "FULL", "interval": 5 },
    "VW_GRAND_LIVRE_GENERAL": { "lastSync": "2026-04-10T14:28:00.000Z", "lastCount": 3550, "mode": "INCREMENTAL", "interval": 15 }
  },
  "version": "1.0.0",
  "uptime": 3612,
  "ts": "2026-04-10T14:35:12.456Z"
}
```

| Champ | Description |
|-------|-------------|
| `status` | `"ok"` ou `"error"` |
| `lastSync` | ISO 8601 de la dernière sync réussie (toutes vues confondues) |
| `error` | Message d'erreur si `status = "error"` |
| `totalSynced` | Total de lignes envoyées depuis le démarrage |
| `sqlConnected` | `true` si le pool SQL Server est actif |
| `platformConnected` | `true` si le dernier heartbeat a réussi |
| `views` | Statut détaillé par vue |
| `uptime` | Durée de fonctionnement en secondes |
| `version` | Version de l'agent |

> Le dashboard écoute sur `0.0.0.0:8444`, accessible depuis le réseau local (pratique pour un monitoring depuis un autre poste). L'endpoint `/health` renvoie HTTP 200 si `status = ok`, 503 sinon.

---

## 11. Gestion des erreurs SQL

Les drivers ODBC Windows (`msnodesqlv8`) peuvent retourner des erreurs dont la propriété `message` est elle-même un objet (pas une chaîne). Le gestionnaire d'événements `execute_sql` dans `ws/agent-socket.js` applique une sérialisation défensive :

```
err.message (string)    → utilisé tel quel
err.message (objet)     → JSON.stringify
err instanceof Error    → err.toString()
autre                   → JSON.stringify(err, Object.getOwnPropertyNames(err))
```

Cela garantit que le backend reçoit toujours un message d'erreur lisible (jamais `[object Object]`).

---

## 12. Logs

Stockés dans `%AppData%\CockpitAgent\logs\` (ou le dossier d'installation).

| Fichier | Contenu |
|---------|---------|
| `cockpit-agent-YYYY-MM-DD.log` | Logs applicatifs (INFO, WARN, ERROR) |

- Rotation quotidienne automatique
- Rétention 30 jours
- Niveau `DEBUG` activable via `LOG_LEVEL=debug`

---

## 13. Commandes distantes

La plateforme peut envoyer des commandes à l'agent via la réponse du heartbeat :

```json
{
  "ok": true,
  "commands": ["FORCE_FULL_SYNC"]
}
```

| Commande | Effet |
|----------|-------|
| `FORCE_FULL_SYNC` | Réinitialise tous les watermarks → prochaine sync re-lit tout |

Les commandes sont traitées au début du prochain cycle de synchronisation.

Pour envoyer une commande depuis le backend :
```http
POST /api/v1/agent/:id/command
Authorization: Bearer <JWT>
{ "command": "FORCE_FULL_SYNC" }
```

---

## 14. Détection version Sage 100

Le détecteur interroge `INFORMATION_SCHEMA.COLUMNS` (sans exécuter de SQL métier) pour identifier la version :

| Test | Résultat | Version |
|------|----------|---------|
| `F_IMMOBILISATION.IM_ValAcq` existe | `v21plus` | Sage 100 v21+ |
| `F_IMMOBILISATION.IM_ValOrigine` existe | `v15v17` | Sage 100 v15–v17 |
| Ni l'un ni l'autre | `fallback` | Version inconnue |

Le résultat détermine quel fichier SQL est déployé pour les vues stocks/commandes/immobilisations :

```
deploy_common.sql + views_stable.sql + views_{immoSchema}.sql
```

Les capacités détectées sont persistées dans `PLATEFORME_PARAMS` sous les clés `SAGE_VERSION`, `IMMO_SCHEMA`, etc.

---

## 15. Références

| Document | Emplacement |
|----------|-------------|
| Référence des 12 vues SQL | [docs/VUES_SQL.md](docs/VUES_SQL.md) |
| Contrats API backend | [docs/API_REFERENCE.md](docs/API_REFERENCE.md) |
| Architecture générale | `ARCHITECTURE_AGENT_ONPREMISES.md` |
| Spécifications client | `DOC_AGENT_ONPREMISES.docx` |
