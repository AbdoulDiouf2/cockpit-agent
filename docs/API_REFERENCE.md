# Cockpit Agent — Référence API backend

Endpoints NestJS exposés par `api.cockpit.app` pour communiquer avec les agents on-premises.  
Préfixe global : `/api` · Contrôleur : `AgentV1Controller` · Base path : `/api/v1/agent`

---

## Authentification

### Endpoints publics (pas de JWT)

Les endpoints agent utilisent un **token agent** au format `isag_` + 48 caractères hexadécimaux, différent du JWT utilisateur.

```http
Authorization: Bearer isag_a1b2c3d4e5f6...
```

| Décorateur NestJS | Signification |
|-------------------|---------------|
| `@Public()` | Ignore `JwtAuthGuard` (APP_GUARD global) |
| `@UseGuards(AgentTokenGuard)` | Valide le token agent depuis la DB |

### Endpoints protégés (JWT utilisateur)

Certains endpoints (envoi de commandes, lecture snapshots) requièrent un JWT standard + permission RBAC.

---

## POST /api/v1/agent/validate

Valide le token agent et enregistre le machine ID. Appelé lors de l'installation uniquement.

**Auth** : aucune (endpoint public)

### Corps de la requête

```json
{
  "email": "admin@entreprise.fr",
  "token": "isag_a1b2c3d4...",
  "machineId": "a1b2c3d4-e5f6-...",
  "sageTables": ["F_ARTICLE", "F_COMPTET", "F_ECRITUREC", "..."]
}
```

| Champ | Type | Requis | Description |
|-------|------|--------|-------------|
| `email` | string | non | Email de l'utilisateur Cockpit |
| `token` | string | **oui** | Token agent `isag_…` |
| `machineId` | string | non | Identifiant unique de la machine |
| `sageTables` | string[] | non | Tables Sage 100 détectées |

### Réponses

**200 — Succès**
```json
{
  "valid": true,
  "agentId": "uuid-de-l-agent",
  "clientName": "Entreprise SAS",
  "plan": "business"
}
```

**200 — Échec (token invalide)**
```json
{
  "valid": false,
  "error": "Token agent invalide ou révoqué"
}
```

**400** — Corps invalide  
**401** — Token expiré ou révoqué

### Effets sur la DB

- Mise à jour de `Agent.machineId` et `Agent.sqlServer`
- Le token est ensuite sauvegardé chiffré sur la machine cliente

---

## POST /api/v1/agent/ingest

Reçoit un batch de données d'une vue Sage et l'enregistre.

**Auth** : `AgentTokenGuard` (Bearer token agent)

### En-têtes

```http
Authorization: Bearer isag_...
Content-Type: application/json
X-Agent-Id: uuid-de-l-agent
X-Agent-Version: 1.0.0
```

### Corps de la requête

```json
{
  "view_name": "VW_GRAND_LIVRE_GENERAL",
  "sync_mode": "INCREMENTAL",
  "watermark_min": 45200,
  "watermark_max": 48750,
  "row_count": 3550,
  "schema_version": "v21plus",
  "rows": [
    {
      "Watermark_Sync": 45201,
      "Num_Piece": "AC2600001",
      "Date_Ecriture": "2026-01-15T00:00:00.000Z",
      "Compte_General": "411000",
      "Montant": 12500.00,
      "Sens": 0,
      ...
    }
  ]
}
```

| Champ | Type | Description |
|-------|------|-------------|
| `view_name` | string | Nom de la vue SQL (`VW_*`) |
| `sync_mode` | `"INCREMENTAL"` \| `"FULL"` | Mode de synchronisation |
| `watermark_min` | number | Watermark de départ du batch |
| `watermark_max` | number \| null | Watermark max du batch (null si chunk intermédiaire) |
| `row_count` | number | Nombre de lignes dans `rows` |
| `schema_version` | string | Version Sage (`v21plus`, `v15v17`, `fallback`) |
| `rows` | object[] | Données brutes normalisées |

**Notes sur le chunking** : si les données dépassent 5 000 lignes, l'agent envoie plusieurs requêtes successives. `watermark_max` est `null` sur les chunks intermédiaires et renseigné uniquement sur le dernier.

### Réponse 201

```json
{
  "accepted": true,
  "processed": 3550,
  "watermark_ack": 48750
}
```

| Champ | Description |
|-------|-------------|
| `accepted` | Données enregistrées avec succès |
| `processed` | Nombre de lignes traitées |
| `watermark_ack` | Watermark confirmé — l'agent peut avancer son curseur local |

### Effets sur la DB

- Création d'un enregistrement `AgentSyncBatch`
- Upsert `AgentViewSnapshot` sur `(organizationId, viewName)`
- Incrémentation `Agent.rowsSynced`

---

## POST /api/v1/agent/heartbeat

Signal de vie périodique (toutes les 5 minutes). Permet à la plateforme de détecter les agents hors-ligne et de retourner des commandes.

**Auth** : `AgentTokenGuard`

### Corps de la requête

```json
{
  "status": "online",
  "lastSync": "2026-04-10T14:30:00.000Z",
  "nbRecordsTotal": 145230
}
```

| Champ | Type | Description |
|-------|------|-------------|
| `status` | string | `"online"` \| `"error"` |
| `lastSync` | string (ISO 8601) \| null | Horodatage de la dernière sync réussie |
| `nbRecordsTotal` | number | Total de lignes envoyées depuis le démarrage |

### Réponse 200

```json
{
  "ok": true,
  "serverTime": "2026-04-10T14:35:00.000Z",
  "nextHeartbeat": 300,
  "commands": []
}
```

| Champ | Description |
|-------|-------------|
| `ok` | Plateforme accessible |
| `serverTime` | Heure serveur (pour sync NTP légère) |
| `nextHeartbeat` | Délai recommandé avant prochain heartbeat (secondes) |
| `commands` | Liste de commandes à exécuter |

**Commandes possibles :**

| Valeur | Effet côté agent |
|--------|-----------------|
| `"FORCE_FULL_SYNC"` | Réinitialise tous les watermarks |

### Effets sur la DB

- Mise à jour `Agent.lastSeen`
- Consommation de `Agent.pendingCommand` (remis à null après lecture)
- Agent marqué `offline` si aucun heartbeat depuis > 2 minutes (job séparé)

---

## GET /api/v1/agent/config

Retourne la configuration distante : intervalles de sync et vues activées. Appelé au démarrage du service.

**Auth** : `AgentTokenGuard`

### Réponse 200

```json
{
  "sync_intervals": [
    { "view": "VW_KPI_SYNTESE",         "interval": 5   },
    { "view": "VW_GRAND_LIVRE_GENERAL", "interval": 15  },
    { "view": "VW_COMMANDES",           "interval": 30  },
    { "view": "VW_STOCKS",              "interval": 60  },
    { "view": "VW_IMMOBILISATIONS",     "interval": 360 }
  ],
  "views_enabled": [
    "VW_KPI_SYNTESE", "VW_GRAND_LIVRE_GENERAL", "VW_CLIENTS",
    "VW_FOURNISSEURS", "VW_TRESORERIE", "VW_COMMANDES",
    "VW_ANALYTIQUE", "VW_STOCKS", "VW_FINANCE_GENERAL",
    "VW_IMMOBILISATIONS", "VW_PAIE", "VW_METADATA_AGENT"
  ],
  "features": {
    "incrementalSync": true,
    "fullSyncOnDemand": true
  }
}
```

Si `sync_intervals` est vide ou absent, l'agent utilise les intervalles définis dans `shared/constants.js`.

---

## POST /api/v1/agent/:id/command

Envoie une commande à un agent spécifique. Sera retournée au prochain heartbeat.

**Auth** : JWT + permission `manage:agents`

### Corps de la requête

```json
{
  "command": "FORCE_FULL_SYNC"
}
```

### Réponse 200

```json
{
  "ok": true,
  "agentId": "uuid-agent",
  "command": "FORCE_FULL_SYNC"
}
```

---

## GET /api/v1/agent/:id/sync-batches

Liste l'historique des batches de synchronisation d'un agent.

**Auth** : JWT + permission `read:agents`

### Query params

| Paramètre | Type | Default | Description |
|-----------|------|---------|-------------|
| `page` | number | 1 | Page |
| `limit` | number | 20 | Résultats par page (max 100) |
| `viewName` | string | — | Filtrer par vue |

### Réponse 200

```json
{
  "data": [
    {
      "id": "uuid",
      "viewName": "VW_GRAND_LIVRE_GENERAL",
      "syncMode": "INCREMENTAL",
      "watermarkMin": "45200",
      "watermarkMax": "48750",
      "rowCount": 3550,
      "schemaVersion": "v21plus",
      "processedAt": "2026-04-10T14:30:00.000Z"
    }
  ],
  "total": 142,
  "page": 1,
  "limit": 20
}
```

> `watermarkMin` et `watermarkMax` sont des **strings** (BigInt JSON-serialisé).

---

## GET /api/v1/agent/snapshots/:viewName

Retourne le dernier snapshot d'une vue pour l'organisation courante.

**Auth** : JWT + permission `read:dashboards`

### Réponse 200

```json
{
  "id": "uuid",
  "organizationId": "uuid-org",
  "agentId": "uuid-agent",
  "viewName": "VW_KPI_SYNTESE",
  "watermarkMax": "0",
  "rowCount": 1,
  "data": [
    {
      "CA_Annee": 1250000.00,
      "CA_Mois": 98500.00,
      "Tresorerie_Solde": 345000.00,
      "Nb_Clients_Actifs": 142
    }
  ],
  "syncMode": "FULL",
  "schemaVersion": "v21plus",
  "updatedAt": "2026-04-10T14:30:00.000Z"
}
```

---

## Codes d'erreur communs

| Code HTTP | Cas |
|-----------|-----|
| `400 Bad Request` | Corps de requête invalide (validation DTO) |
| `401 Unauthorized` | Token absent, invalide, révoqué ou expiré |
| `403 Forbidden` | Permission RBAC insuffisante |
| `404 Not Found` | Agent ou ressource introuvable |
| `429 Too Many Requests` | Rate limiting (si configuré) |
| `500 Internal Server Error` | Erreur serveur |

---

## Types de données normalisées

Le transformer (`service/src/sync/transformer.js`) normalise les types avant envoi :

| Type source | Type JSON envoyé |
|-------------|-----------------|
| `Date` JavaScript | String ISO 8601 (`"2026-04-10T00:00:00.000Z"`) |
| `BigInt` | Number (si < 2^53) |
| `Buffer` | String hexadécimale |
| `null` / `undefined` | `null` |
| Autres | Passthrough |
