# ARCHITECTURE AGENT ON-PREMISES — PLATEFORME BI SAGE 100
## Stack : Electron (React) + Node.js Windows Service
## Version : 1.0 — Document de référence pour l'équipe de développement

---

## 1. VUE D'ENSEMBLE

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        SERVEUR WINDOWS CLIENT                               │
│                                                                             │
│  ┌──────────────────┐     ┌──────────────────────────────────────────────┐  │
│  │   INSTALLEUR     │     │          SERVICE WINDOWS (agent)             │  │
│  │   (Electron)     │ ──► │         "MonBI-Agent"                        │  │
│  │   setup.exe      │     │                                              │  │
│  └──────────────────┘     │  ┌─────────────┐   ┌────────────────────┐   │  │
│                           │  │  SQL Engine │   │  Sync Engine       │   │  │
│                           │  │  (mssql)    │◄──│  (incremental)     │   │  │
│                           │  └──────┬──────┘   └─────────┬──────────┘   │  │
│                           │         │                     │              │  │
│                           │  ┌──────▼──────┐   ┌─────────▼──────────┐   │  │
│                           │  │  Vues BI    │   │  HTTPS Client      │   │  │
│                           │  │  Sage 100   │   │  (axios + TLS)     │   │  │
│                           │  └─────────────┘   └─────────┬──────────┘   │  │
│                           └─────────────────────────────┼───────────────┘  │
│                                                         │                   │
│                        SQL Server ◄─── Base Sage 100   │                   │
│                        (port 1433)                      │                   │
└─────────────────────────────────────────────────────────┼───────────────────┘
                                                          │ HTTPS (port 8443)
                                                          │ TLS 1.3
                                                          ▼
                                           ┌──────────────────────────┐
                                           │   PLATEFORME SAAS BI     │
                                           │   (votre cloud)          │
                                           │   /api/v1/agent/ingest   │
                                           └──────────────────────────┘
```

---

## 2. STRUCTURE DU PROJET

```
monbi-agent/
│
├── installer/                          # Installeur Electron
│   ├── src/
│   │   ├── main.js                     # Processus principal Electron
│   │   ├── preload.js                  # Bridge sécurisé Electron ↔ React
│   │   └── renderer/                   # Interface React (installeur UI)
│   │       ├── App.jsx
│   │       ├── steps/
│   │       │   ├── Step1_Welcome.jsx   # Licence + case obligatoire
│   │       │   ├── Step2_Database.jsx  # Paramètres SQL Server
│   │       │   ├── Step3_Detection.jsx # Détection Sage 100 automatique
│   │       │   ├── Step4_Views.jsx     # Création vues (barre de progression)
│   │       │   ├── Step5_Token.jsx     # Email + Token API plateforme
│   │       │   └── Step6_Done.jsx      # Résumé installation
│   │       └── components/
│   │           ├── ProgressBar.jsx
│   │           ├── StatusIndicator.jsx
│   │           └── ConnectionTest.jsx
│   └── package.json
│
├── service/                            # Service Windows Node.js
│   ├── src/
│   │   ├── index.js                    # Point d'entrée du service
│   │   ├── windows-service.js          # Wrapper node-windows
│   │   ├── config.js                   # Lecture config depuis registry/fichier
│   │   ├── scheduler.js                # Planificateur de sync (cron-like)
│   │   ├── sql/
│   │   │   ├── connection.js           # Pool de connexions mssql
│   │   │   ├── detector.js             # Détection version Sage 100
│   │   │   ├── deployer.js             # Exécution script SQL v3
│   │   │   └── extractor.js            # Extraction incrémentale par vue
│   │   ├── sync/
│   │   │   ├── engine.js               # Moteur de synchronisation
│   │   │   ├── watermark.js            # Gestion des watermarks (cbMarq)
│   │   │   ├── transformer.js          # Transformation/nettoyage données
│   │   │   └── uploader.js             # Upload vers API SaaS (HTTPS)
│   │   ├── security/
│   │   │   ├── token.js                # Gestion token API (chiffré AES)
│   │   │   ├── tls.js                  # Configuration TLS/HTTPS
│   │   │   └── credential-store.js     # Stockage sécurisé identifiants SQL
│   │   └── utils/
│   │       ├── logger.js               # Logs Windows Event Viewer
│   │       └── health.js               # Endpoint /health local
│   └── package.json
│
├── shared/
│   ├── sql/
│   │   └── DEPLOY_PLATEFORME_SAGE100_v3.sql   # ← Script SQL embarqué
│   └── constants.js                    # Constantes partagées
│
├── build/                              # Scripts de build
│   ├── build-installer.js              # Build Electron → setup.exe
│   ├── build-service.js                # Package service → .exe via pkg
│   └── sign.js                         # Signature code (Code Signing Cert)
│
└── package.json                        # Racine monorepo
```

---

## 3. FLUX D'INSTALLATION DÉTAILLÉ

### Step 1 — Bienvenue & Consentement obligatoire
```javascript
// Step1_Welcome.jsx
// La case doit être cochée pour activer le bouton "Suivant"
// Sans ça : bouton disabled, tooltip explicatif

const [accepted, setAccepted] = useState(false);

<input type="checkbox" onChange={e => setAccepted(e.target.checked)} />
<label>J'autorise la création de vues SQL en lecture seule sur ma base Sage 100
       pour le fonctionnement de la plateforme BI. Ces vues n'écrivent 
       aucune donnée dans Sage 100.</label>

<button disabled={!accepted} onClick={onNext}>Suivant →</button>
```

### Step 2 — Connexion base de données
```javascript
// Step2_Database.jsx
// Test de connexion via IPC → service Node.js (pas dans le renderer !)

const testConnection = async () => {
    const result = await window.electronAPI.testSqlConnection({
        server: formData.server,
        database: formData.database,
        user: formData.user,
        password: formData.password,
        useWindowsAuth: formData.useWindowsAuth
    });
    setConnectionStatus(result.success ? 'OK' : result.error);
};

// Champs affichés :
// • Serveur SQL : [MONSERVEUR\SAGE] ← suggestion auto (détection instances SQL)
// • Base de données : [BIJOU_MAE]    ← liste des bases disponibles
// • Auth : ○ Windows (recommandé)  ● SQL Server
// • [Tester la connexion]  ✅ Connexion réussie — SQL Server 2019
```

### Step 3 — Détection automatique Sage 100
```javascript
// Step3_Detection.jsx
// L'agent interroge INFORMATION_SCHEMA pour valider que c'est bien Sage 100

const detectSage = async () => {
    const checks = await window.electronAPI.detectSage100();
    // Résultat attendu :
    // { 
    //   isSage100: true, 
    //   tablesFound: ['F_ECRITUREC', 'F_COMPTET', ...],
    //   optionalFields: { 'EC_Signature': false, 'DO_NumFactureX': true, ... },
    //   estimatedVersion: '2021+',
    //   nbEcritures: 485420 
    // }
};

// Affiche :
// ✅ Base Sage 100 France détectée
// ✅ 19 tables principales trouvées
// ℹ️ Version estimée : Sage 100 2021+ (Factur-X présent)
// ℹ️ Volume estimé : ~485 000 écritures
// ⚠️ Anti-fraude TVA : champs non présents (version < 2018 ?)
```

### Step 4 — Création des vues (avec progression)
```javascript
// Step4_Views.jsx
// Exécution du script SQL v3 avec retour de progression en temps réel

const vues = [
    'VW_GRAND_LIVRE_GENERAL',
    'VW_FINANCE_GENERAL',
    'VW_TRESORERIE',
    'VW_CLIENTS',
    'VW_FOURNISSEURS',
    'VW_ANALYTIQUE',
    'VW_STOCKS',
    'VW_COMMANDES',
    'VW_IMMOBILISATIONS',
    'VW_PAIE',
    'VW_METADATA_AGENT',
    'VW_KPI_SYNTESE'
];

// L'agent exécute le script SQL par blocs (GO → séparateur de batch)
// et renvoie la progression via IPC événement :
window.electronAPI.onSqlProgress((event, { step, total, current, status }) => {
    setProgress(Math.round(current / total * 100));
    setCurrentStep(step);
});
```

### Step 5 — Liaison plateforme SaaS
```javascript
// Step5_Token.jsx
// Validation du token via appel API vers la plateforme

const validateToken = async () => {
    const result = await window.electronAPI.validatePlatformToken({
        email: formData.email,
        token: formData.token
    });
    // Appel : POST https://app.monbi.fr/api/v1/agent/validate
    // Body : { email, token, machineId, sqlServer, sageTables }
    // Response : { valid: true, clientName: 'BIJOU SA', plan: 'PRO' }
};
```

### Step 6 — Installation du service Windows (UAC)
```javascript
// main.js (processus principal Electron)
// Cette étape NÉCESSITE des droits admin → déclenche l'UAC Windows

const { exec } = require('child_process');
const path = require('path');

// L'installeur Electron lui-même doit être signé et demander l'élévation
// via le manifest Windows : requestedExecutionLevel = requireAdministrator

// Installation du service :
const installService = () => {
    return new Promise((resolve, reject) => {
        const servicePath = path.join(process.resourcesPath, 'service', 'agent.exe');
        
        // Utiliser node-windows pour installer le service
        const Service = require('node-windows').Service;
        const svc = new Service({
            name: 'MonBI Agent',
            description: 'Agent de synchronisation MonBI ↔ Sage 100',
            script: servicePath,
            env: [
                { name: 'MONBI_CONFIG', value: configPath }
            ]
        });
        
        svc.on('install', () => {
            svc.start();
            resolve({ success: true });
        });
        
        svc.install();
    });
};

// Ouverture du port firewall (nécessite aussi admin) :
exec(`netsh advfirewall firewall add rule name="MonBI Agent" dir=in action=allow protocol=TCP localport=8443`, 
    (err) => { if (err) console.error('Firewall:', err); }
);
```

---

## 4. SERVICE WINDOWS — MOTEUR DE SYNCHRONISATION

### 4.1 Point d'entrée (index.js)
```javascript
// service/src/index.js
const { Service } = require('node-windows');
const scheduler = require('./scheduler');
const logger = require('./utils/logger');
const health = require('./utils/health');
const config = require('./config');

// Démarrage du serveur health local (pour que l'installeur puisse vérifier l'état)
health.start(config.PORT_HEALTH || 8444);

// Démarrage du planificateur de sync
scheduler.start({
    interval: config.SYNC_INTERVAL_MIN || 15,   // minutes
    onSync: async () => {
        await require('./sync/engine').run();
    }
});

logger.info('MonBI Agent démarré', { version: '1.0', config });
```

### 4.2 Détection version Sage (detector.js)
```javascript
// service/src/sql/detector.js
const sql = require('mssql');

async function detectSage100(pool) {
    // Vérifie que les tables core existent
    const coreTablesQuery = `
        SELECT TABLE_NAME, 
               (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS 
                WHERE TABLE_NAME = t.TABLE_NAME) AS NB_CHAMPS
        FROM INFORMATION_SCHEMA.TABLES t
        WHERE TABLE_NAME IN (
            'F_ECRITUREC','F_COMPTET','F_COMPTEG','F_JOURNAUX',
            'F_DOCENTETE','F_DOCLIGNE','F_ARTICLE','F_ARTSTOCK',
            'F_IMMOBILISATION','F_ECRITUREA','F_COMPTEA','F_ENUMANAL'
        )
        ORDER BY TABLE_NAME`;
    
    const tablesResult = await pool.request().query(coreTablesQuery);
    
    // Détecte les champs optionnels
    const optionalFieldsQuery = `
        SELECT TABLE_NAME, COLUMN_NAME,
               CASE WHEN COLUMN_NAME IS NOT NULL THEN 1 ELSE 0 END AS EXISTE
        FROM (VALUES
            ('F_DOCENTETE', 'DO_NumFactureX'),
            ('F_ECRITUREC', 'EC_Signature'),
            ('F_COMPTET',   'CT_DateDernierRecouvr')
        ) AS champs(TABLE_NAME, COLUMN_NAME)
        -- LEFT JOIN INFORMATION_SCHEMA pour chaque champ...
    `;
    
    const nbEcritures = await pool.request()
        .query('SELECT COUNT(*) AS NB FROM F_ECRITUREC');
    
    return {
        isSage100: tablesResult.recordset.length >= 10,
        tablesFound: tablesResult.recordset.map(r => r.TABLE_NAME),
        nbEcritures: nbEcritures.recordset[0].NB,
        estimatedVersion: detectVersionFromFields(tablesResult.recordset)
    };
}

module.exports = { detectSage100 };
```

### 4.3 Moteur de synchronisation incrémentale (engine.js)
```javascript
// service/src/sync/engine.js
const { getPool } = require('../sql/connection');
const watermark = require('./watermark');
const transformer = require('./transformer');
const uploader = require('./uploader');
const logger = require('../utils/logger');

// Les vues à synchroniser avec leur priorité et config
const SYNC_CONFIG = [
    { vue: 'VW_KPI_SYNTESE',         priority: 1, mode: 'FULL',        interval: 5  }, // KPIs → toutes les 5 min
    { vue: 'VW_GRAND_LIVRE_GENERAL', priority: 2, mode: 'INCREMENTAL', interval: 15 }, // Grand livre → 15 min
    { vue: 'VW_CLIENTS',             priority: 2, mode: 'INCREMENTAL', interval: 15 },
    { vue: 'VW_FOURNISSEURS',        priority: 2, mode: 'INCREMENTAL', interval: 15 },
    { vue: 'VW_TRESORERIE',          priority: 2, mode: 'INCREMENTAL', interval: 15 },
    { vue: 'VW_STOCKS',              priority: 3, mode: 'INCREMENTAL', interval: 60 }, // Stocks → 1h
    { vue: 'VW_COMMANDES',           priority: 3, mode: 'INCREMENTAL', interval: 30 },
    { vue: 'VW_IMMOBILISATIONS',     priority: 4, mode: 'INCREMENTAL', interval: 360 },// Immo → 6h
    { vue: 'VW_ANALYTIQUE',          priority: 3, mode: 'INCREMENTAL', interval: 60 },
    { vue: 'VW_PAIE',                priority: 4, mode: 'INCREMENTAL', interval: 360 },
    { vue: 'VW_METADATA_AGENT',      priority: 1, mode: 'FULL',        interval: 5  }
];

async function run() {
    const pool = await getPool();
    logger.info('Cycle de synchronisation démarré');
    
    for (const config of SYNC_CONFIG) {
        try {
            const lastWatermark = await watermark.get(config.vue);
            
            // Requête incrémentale basée sur cbMarq (watermark Sage 100)
            const query = config.mode === 'INCREMENTAL' 
                ? `SELECT TOP 5000 * FROM dbo.${config.vue} 
                   WHERE Watermark_Sync > @watermark 
                   ORDER BY Watermark_Sync ASC`
                : `SELECT * FROM dbo.${config.vue}`;
            
            const request = pool.request();
            if (config.mode === 'INCREMENTAL') {
                request.input('watermark', lastWatermark);
            }
            
            const result = await request.query(query);
            
            if (result.recordset.length > 0) {
                // Transformer et envoyer à la plateforme SaaS
                const payload = transformer.transform(config.vue, result.recordset);
                const uploadResult = await uploader.send(config.vue, payload);
                
                // Mettre à jour le watermark
                const newWatermark = Math.max(...result.recordset.map(r => r.Watermark_Sync || 0));
                await watermark.set(config.vue, newWatermark);
                
                logger.info(`Sync OK: ${config.vue}`, { 
                    lignes: result.recordset.length, 
                    watermark: newWatermark 
                });
            }
        } catch (err) {
            logger.error(`Sync ERREUR: ${config.vue}`, { error: err.message });
            // Continue avec la vue suivante (pas de crash global)
        }
    }
    
    logger.info('Cycle terminé');
}

module.exports = { run };
```

### 4.4 Uploader vers la plateforme SaaS (uploader.js)
```javascript
// service/src/sync/uploader.js
const axios = require('axios');
const { getToken, getPlatformUrl } = require('../security/token');
const tls = require('../security/tls');

async function send(vueName, payload) {
    const token = await getToken();
    const baseUrl = await getPlatformUrl();
    
    const response = await axios.post(
        `${baseUrl}/api/v1/agent/ingest`,
        {
            source: vueName,
            records: payload.records,
            count: payload.records.length,
            timestamp: new Date().toISOString(),
            agent_version: '1.0'
        },
        {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'X-Agent-Id': payload.agentId
            },
            httpsAgent: tls.getAgent(),  // TLS 1.3 forcé
            timeout: 30000
        }
    );
    
    return response.data;
}

module.exports = { send };
```

---

## 5. SÉCURITÉ

### 5.1 Stockage des identifiants SQL
```javascript
// credential-store.js
// Utilise keytar (wrapper natif Windows Credential Manager)
// Les identifiants SQL ne sont JAMAIS stockés en clair

const keytar = require('keytar');
const SERVICE_NAME = 'MonBI-Agent';

async function saveCredentials(server, user, password) {
    await keytar.setPassword(SERVICE_NAME, `sql:${server}:${user}`, password);
}

async function getCredentials(server, user) {
    return await keytar.getPassword(SERVICE_NAME, `sql:${server}:${user}`);
}
```

### 5.2 Chiffrement du token API
```javascript
// token.js
// Token API chiffré AES-256-GCM avec clé dérivée du machine ID

const crypto = require('crypto');
const { machineId } = require('node-machine-id');

async function saveToken(token) {
    const id = await machineId();
    const key = crypto.scryptSync(id, 'monbi-salt', 32);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    // ... chiffrement et stockage dans le registre Windows
}
```

### 5.3 Droits SQL minimaux (principe du moindre privilège)
```sql
-- L'agent SQL utilise un compte dédié avec droits lecture seule uniquement
-- À exécuter par l'admin Sage avant installation

CREATE LOGIN [monbi_agent] WITH PASSWORD = 'XXXXX';
CREATE USER [monbi_agent] FOR LOGIN [monbi_agent];

-- Droits en lecture seule sur les vues BI uniquement (pas sur les tables Sage !)
GRANT SELECT ON dbo.VW_GRAND_LIVRE_GENERAL   TO [monbi_agent];
GRANT SELECT ON dbo.VW_FINANCE_GENERAL        TO [monbi_agent];
GRANT SELECT ON dbo.VW_TRESORERIE             TO [monbi_agent];
GRANT SELECT ON dbo.VW_CLIENTS                TO [monbi_agent];
GRANT SELECT ON dbo.VW_FOURNISSEURS           TO [monbi_agent];
GRANT SELECT ON dbo.VW_ANALYTIQUE             TO [monbi_agent];
GRANT SELECT ON dbo.VW_STOCKS                 TO [monbi_agent];
GRANT SELECT ON dbo.VW_COMMANDES              TO [monbi_agent];
GRANT SELECT ON dbo.VW_IMMOBILISATIONS        TO [monbi_agent];
GRANT SELECT ON dbo.VW_PAIE                   TO [monbi_agent];
GRANT SELECT ON dbo.VW_METADATA_AGENT         TO [monbi_agent];
GRANT SELECT ON dbo.VW_KPI_SYNTESE            TO [monbi_agent];

-- Droits limités sur les tables config de la plateforme (pas les tables Sage !)
GRANT SELECT, INSERT, UPDATE ON dbo.PLATEFORME_PARAMS         TO [monbi_agent];
GRANT SELECT, INSERT, UPDATE ON dbo.PLATEFORME_CONFIG_GROUPE  TO [monbi_agent];
GRANT EXECUTE ON dbo.SP_AGENT_SYNC TO [monbi_agent];
```

---

## 6. BUILD ET PACKAGING

### 6.1 Dépendances (package.json)
```json
{
  "name": "monbi-agent",
  "version": "1.0.0",
  "dependencies": {
    "electron": "^28.0.0",
    "react": "^18.0.0",
    "mssql": "^10.0.0",
    "node-windows": "^1.0.0",
    "keytar": "^7.9.0",
    "axios": "^1.6.0",
    "node-machine-id": "^1.1.12",
    "node-schedule": "^2.1.1",
    "winston": "^3.11.0"
  },
  "devDependencies": {
    "electron-builder": "^24.0.0",
    "@electron/fuses": "^1.7.0",
    "pkg": "^5.8.0"
  }
}
```

### 6.2 electron-builder.yml (génère le setup.exe)
```yaml
appId: fr.monbi.agent
productName: MonBI Agent
copyright: Copyright © 2025 MonBI SAS

win:
  target:
    - target: nsis       # → génère un setup.exe
      arch: [x64]
  icon: assets/icon.ico
  signingHashAlgorithms: [sha256]
  sign: ./build/sign.js  # Code Signing Certificate

nsis:
  oneClick: false        # Installation guidée (pas silencieuse)
  allowToChangeInstallationDirectory: true
  runAfterFinish: false  # L'agent démarre via le service, pas l'UI
  installerIcon: assets/installer.ico
  createDesktopShortcut: false
  createStartMenuShortcut: true

files:
  - dist/**
  - shared/sql/**       # ← Le script SQL v3 est embarqué ici
  - service/dist/**
```

---

## 7. API ENDPOINTS PLATEFORME SAAS (côté serveur à implémenter)

```
POST /api/v1/agent/validate
  Body: { email, token, machineId, sqlServer, sageTables[] }
  Response: { valid, clientName, plan, agentId }

POST /api/v1/agent/ingest
  Auth: Bearer {token}
  Body: { source, records[], count, timestamp, agent_version }
  Response: { accepted, processed, watermark_ack }

GET  /api/v1/agent/config
  Auth: Bearer {token}  
  Response: { sync_intervals, views_enabled[], features }

POST /api/v1/agent/heartbeat
  Auth: Bearer {token}
  Body: { agentId, status, lastSync, nbRecordsTotal }
  Response: { ok, commands[] }  ← commandes (ex: FORCE_FULL_SYNC)
```

---

## 8. ROADMAP DE DÉVELOPPEMENT

| Sprint | Durée  | Livrable |
|--------|--------|----------|
| S1     | 2 sem. | Script SQL v3 validé + détection Sage (FAIT ✅) |
| S2     | 2 sem. | Service Node.js : connexion SQL + extraction données |
| S3     | 2 sem. | Service Node.js : sync incrémentale + upload API |
| S4     | 2 sem. | Installeur Electron : UI Steps 1 à 6 |
| S5     | 1 sem. | Build + signature Code Signing + tests |
| S6     | 1 sem. | Tests clients pilotes + corrections |
| **Total** | **10 sem.** | **MVP Agent On-Premises v1.0** |

---

## 9. NOTES IMPORTANTES POUR L'ÉQUIPE

1. **Le script SQL v3 est embarqué dans `shared/sql/`** — il ne faut JAMAIS le modifier 
   après build car sa signature est vérifiée au démarrage.

2. **Le renderer Electron ne touche jamais SQL Server directement** — toujours via IPC 
   (preload.js → main.js → mssql). C'est une règle de sécurité Electron.

3. **cbMarq est le watermark de Sage 100** — c'est un entier auto-incrémenté par Sage 
   à chaque modification. C'est la base de toute notre synchronisation incrémentale.

4. **Un seul compte SQL dédié** `monbi_agent` avec droits SELECT uniquement sur les vues.
   Jamais de droits sur les tables Sage 100 directement.

5. **Le port 8443** est utilisé pour le health check local + communication sécurisée. 
   Le firewall est ouvert lors de l'installation (UAC requis).

6. **Code Signing Certificate** : acheter chez DigiCert ou Sectigo (~200€/an). 
   Sans ça, Windows Defender SmartScreen bloquera le setup.exe chez les clients.
