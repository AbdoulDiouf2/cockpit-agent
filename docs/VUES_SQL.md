# Cockpit Agent — Référence des vues SQL

Les 12 vues sont déployées dans la base de données Sage 100 lors de l'installation.  
Elles sont en **lecture seule** et n'altèrent aucune donnée existante.

Chaque vue expose un champ `Watermark_Sync` — alias sur `cbMarq` — utilisé comme curseur de synchronisation incrémentale.

---

## Fichiers SQL

| Fichier | Contenu |
|---------|---------|
| `shared/sql/deploy_common.sql` | Tables `PLATEFORME_PARAMS` et `PLATEFORME_CONFIG_GROUPE` |
| `shared/sql/views_stable.sql` | 9 vues sans dépendance de version Sage |
| `shared/sql/views_v21plus.sql` | `VW_STOCKS`, `VW_COMMANDES`, `VW_IMMOBILISATIONS` pour Sage v21+ |
| `shared/sql/views_v15v17.sql` | Idem pour Sage v15–v17 |
| `shared/sql/views_fallback.sql` | Variante NULL-safe pour versions non reconnues |

**Ordre de déploiement** : `deploy_common.sql` → `views_stable.sql` → `views_{version}.sql`

---

## Tables de configuration créées

### PLATEFORME_PARAMS

Stocke les paramètres de l'agent et les capacités détectées.

| Colonne | Type | Description |
|---------|------|-------------|
| `PARAM_KEY` | `NVARCHAR(100)` PK | Clé |
| `PARAM_VALUE` | `NVARCHAR(500)` | Valeur |
| `UPDATED_AT` | `DATETIME` | Dernière mise à jour |

Clés utilisées :

| Clé | Valeur exemple |
|-----|---------------|
| `SAGE_VERSION` | `v21plus` |
| `SQL_SERVER_VERSION` | `16` |
| `IMMO_SCHEMA` | `v21plus` |
| `STOCK_SCHEMA` | `v21plus` |
| `HAS_DATE_LIVR` | `1` |
| `NB_ECRITURES` | `145230` |
| `DEPLOY_DATE` | `2026-04-10T10:30:00.000Z` |
| `AGENT_VERSION` | `1.0.0` |
| `watermark_{NOM_VUE}` | `98450` (curseur cbMarq) |

### PLATEFORME_CONFIG_GROUPE

Réservée pour une configuration multi-groupe future.

---

## Vues stables (toutes versions Sage)

### VW_GRAND_LIVRE_GENERAL

Source : `F_ECRITUREC` ⟕ `F_COMPTEG` ⟕ `F_JOURNAUX`  
Sync : INCREMENTAL, toutes les 15 min

| Colonne | Type SQL | Description |
|---------|----------|-------------|
| `Watermark_Sync` | INT | Curseur cbMarq |
| `Num_Piece` | NVARCHAR | Numéro de pièce |
| `Date_Ecriture` | DATETIME | Date de l'écriture |
| `Compte_General` | NVARCHAR | Numéro de compte |
| `Intitule_Compte` | NVARCHAR | Libellé du compte |
| `Libelle` | NVARCHAR | Libellé de l'écriture |
| `Montant` | DECIMAL | Montant brut |
| `Sens` | INT | 0 = Débit, 1 = Crédit |
| `Debit` | DECIMAL | Montant si débit, sinon 0 |
| `Credit` | DECIMAL | Montant si crédit, sinon 0 |
| `Code_Journal` | NVARCHAR | Code journal |
| `Libelle_Journal` | NVARCHAR | Libellé journal |
| `Ref_Piece` | NVARCHAR | Référence pièce |
| `Echeance` | DATETIME | Date d'échéance |
| `No_Ecriture` | INT | Numéro interne écriture |
| `Annee` | INT | Année extraite |
| `Mois` | INT | Mois extrait |

---

### VW_FINANCE_GENERAL

Source : `F_ECRITUREC` ⟕ `F_COMPTEG` (agrégé par compte/mois)  
Sync : INCREMENTAL, toutes les 60 min

| Colonne | Type | Description |
|---------|------|-------------|
| `Watermark_Sync` | INT | Curseur cbMarq |
| `Compte` | NVARCHAR | Numéro de compte |
| `Intitule_Compte` | NVARCHAR | Libellé |
| `Annee` | INT | Année |
| `Mois` | INT | Mois |
| `Solde_Net` | DECIMAL | Débit - Crédit |
| `Total_Debit` | DECIMAL | Somme débits |
| `Total_Credit` | DECIMAL | Somme crédits |
| `Nb_Ecritures` | INT | Nombre d'écritures |

---

### VW_TRESORERIE

Source : `F_ECRITUREC` (EC_Compte LIKE `5%`) ⟕ `F_COMPTEG`  
Sync : INCREMENTAL, toutes les 15 min

| Colonne | Type | Description |
|---------|------|-------------|
| `Watermark_Sync` | INT | Curseur cbMarq |
| `Compte_Banque` | NVARCHAR | Compte de classe 5 |
| `Intitule_Banque` | NVARCHAR | Libellé du compte |
| `Date_Operation` | DATETIME | Date de l'opération |
| `Libelle` | NVARCHAR | Libellé |
| `Montant` | DECIMAL | Montant brut |
| `Sens` | INT | 0 = Débit, 1 = Crédit |
| `Flux_Net` | DECIMAL | Montant signé (débit+, crédit-) |
| `Journal` | NVARCHAR | Code journal |
| `Reference` | NVARCHAR | Référence pièce |
| `Annee` | INT | Année |
| `Mois` | INT | Mois |

---

### VW_CLIENTS

Source : `F_COMPTET` WHERE `CT_Type = 0`  
Sync : INCREMENTAL, toutes les 15 min

| Colonne | Type | Description |
|---------|------|-------------|
| `Watermark_Sync` | INT | Curseur cbMarq |
| `Code_Client` | NVARCHAR | Code tiers |
| `Nom_Client` | NVARCHAR | Raison sociale |
| `Adresse` | NVARCHAR | Adresse ligne 1 |
| `Complement` | NVARCHAR | Adresse ligne 2 |
| `Code_Postal` | NVARCHAR | Code postal |
| `Ville` | NVARCHAR | Ville |
| `Pays` | NVARCHAR | Pays |
| `Telephone` | NVARCHAR | Téléphone |
| `Email` | NVARCHAR | Email |
| `SIRET` | NVARCHAR | Numéro SIRET |
| `En_Sommeil` | INT | 0 = Actif, 1 = En sommeil |
| `Cat_Comptable` | INT | Catégorie comptable |
| `Encours_Autorise` | DECIMAL | Encours client autorisé |

---

### VW_FOURNISSEURS

Source : `F_COMPTET` WHERE `CT_Type = 1`  
Sync : INCREMENTAL, toutes les 15 min

| Colonne | Type | Description |
|---------|------|-------------|
| `Watermark_Sync` | INT | Curseur cbMarq |
| `Code_Fournisseur` | NVARCHAR | Code tiers |
| `Nom_Fournisseur` | NVARCHAR | Raison sociale |
| `Adresse` | NVARCHAR | Adresse ligne 1 |
| `Complement` | NVARCHAR | Adresse ligne 2 |
| `Code_Postal` | NVARCHAR | Code postal |
| `Ville` | NVARCHAR | Ville |
| `Pays` | NVARCHAR | Pays |
| `Telephone` | NVARCHAR | Téléphone |
| `Email` | NVARCHAR | Email |
| `SIRET` | NVARCHAR | Numéro SIRET |
| `En_Sommeil` | INT | 0 = Actif, 1 = En sommeil |
| `Cat_Comptable` | INT | Catégorie comptable |

---

### VW_ANALYTIQUE

Source : `F_ECRITUREA` ⟕ `F_COMPTEA`  
Sync : INCREMENTAL, toutes les 30 min

| Colonne | Type | Description |
|---------|------|-------------|
| `Watermark_Sync` | INT | Curseur cbMarq |
| `Num_Ecriture` | NVARCHAR | Numéro écriture analytique |
| `Date_Ecriture` | DATETIME | Date |
| `Axe_Analytique` | INT | Numéro d'axe analytique |
| `Compte_Analytique` | NVARCHAR | Code compte analytique |
| `Intitule_Compte` | NVARCHAR | Libellé |
| `Montant` | DECIMAL | Montant |
| `Sens` | INT | 0 = Débit, 1 = Crédit |
| `Journal` | NVARCHAR | Code journal |
| `Piece` | NVARCHAR | Référence pièce |
| `Annee` | INT | Année |
| `Mois` | INT | Mois |

---

### VW_PAIE

Source : `F_ECRITUREC` (EC_Compte LIKE `64%`) ⟕ `F_COMPTEG`  
Sync : FULL, toutes les 6h

| Colonne | Type | Description |
|---------|------|-------------|
| `Watermark_Sync` | INT | Curseur cbMarq |
| `Compte` | NVARCHAR | Compte de classe 64 |
| `Intitule` | NVARCHAR | Libellé du compte |
| `Date_Ecriture` | DATETIME | Date |
| `Libelle` | NVARCHAR | Libellé écriture |
| `Montant` | DECIMAL | Montant |
| `Sens` | INT | 0 = Débit, 1 = Crédit |
| `Annee` | INT | Année |
| `Mois` | INT | Mois |

---

### VW_METADATA_AGENT

Source : `PLATEFORME_PARAMS`  
Sync : FULL, toutes les 5 min

| Colonne | Type | Description |
|---------|------|-------------|
| `Watermark_Sync` | INT | Toujours 0 (vue statique) |
| `Cle` | NVARCHAR | PARAM_KEY |
| `Valeur` | NVARCHAR | PARAM_VALUE |
| `Mis_A_Jour` | DATETIME | UPDATED_AT |

---

### VW_KPI_SYNTESE

Source : Sous-requêtes sur `F_ECRITUREC` + `F_COMPTET`  
Sync : FULL, toutes les 5 min

| Colonne | Type | Description |
|---------|------|-------------|
| `Watermark_Sync` | INT | Toujours 0 |
| `Annee_Courante` | INT | `YEAR(GETDATE())` |
| `Mois_Courant` | INT | `MONTH(GETDATE())` |
| `CA_Annee` | DECIMAL | CA YTD (comptes 70%) |
| `CA_Mois` | DECIMAL | CA mois courant |
| `Charges_Annee` | DECIMAL | Charges YTD (comptes 6%) |
| `Resultat_Annee` | DECIMAL | Résultat (comptes 12%) |
| `Tresorerie_Solde` | DECIMAL | Solde trésorerie (comptes 5%) |
| `Nb_Clients_Actifs` | INT | Clients non en sommeil |
| `Nb_Fournisseurs_Actifs` | INT | Fournisseurs non en sommeil |

---

## Vues dépendantes de la version

### VW_STOCKS

Source : `F_ARTSTOCK` ⟕ `F_ARTICLE`  
Sync : INCREMENTAL, toutes les 60 min

| Colonne | v21+ | v15–v17 | fallback |
|---------|------|---------|---------|
| `Watermark_Sync` | cbMarq | cbMarq | cbMarq |
| `Ref_Article` | AR_Ref | AR_Ref | AR_Ref |
| `Designation` | AR_Design | AR_Design | AR_Design |
| `Famille` | AR_CodeFamille | AR_CodeFamille | AR_CodeFamille |
| `Depot` | DE_No | DE_No | DE_No |
| `Qte_Stock` | AS_QteSto | AS_QteSto | AS_QteSto |
| `Valeur_Stock` | AS_MontSto | AS_QteSto × AS_PrixAch | NULL |
| `PMP` | AS_MontSto / AS_QteSto | AS_PrixAch | NULL |
| `Qte_Reservee` | AS_QteReserv | AS_QteReserv | AS_QteReserv |
| `Qte_Commandee` | AS_QteCommand | AS_QteCommand | AS_QteCommand |
| `Prix_Vente` | AR_PrixVen | AR_PrixVen | AR_PrixVen |
| `Suivi_Stock` | AR_SuiviStock | AR_SuiviStock | AR_SuiviStock |
| `En_Sommeil` | AR_Sommeil | AR_Sommeil | AR_Sommeil |

---

### VW_COMMANDES

Source : `F_DOCENTETE` ⟕ `F_COMPTET` WHERE `DO_Type IN (1,2,3,6,7)`  
Sync : INCREMENTAL, toutes les 30 min

Types de documents inclus :
- 1 = Commande client
- 2 = Bon de livraison
- 3 = Facture client
- 6 = Commande fournisseur
- 7 = Bon de réception

| Colonne | v21+ | v15–v17 | fallback |
|---------|------|---------|---------|
| `Watermark_Sync` | cbMarq | cbMarq | cbMarq |
| `Num_Document` | DO_Piece | DO_Piece | DO_Piece |
| `Type_Doc` | DO_Type | DO_Type | DO_Type |
| `Date_Document` | DO_Date | DO_Date | DO_Date |
| `Date_Livraison` | DO_DateLivr | NULL | NULL |
| `Code_Tiers` | DO_Tiers | DO_Tiers | DO_Tiers |
| `Nom_Tiers` | CT_Intitule | CT_Intitule | CT_Intitule |
| `Montant_HT` | DO_TotalHT | DO_TotalHT | DO_TotalHT |
| `Montant_TTC` | DO_TotalTTC | DO_TotalTTC | DO_TotalTTC |
| `Montant_TVA` | DO_TotalTVA | DO_TotalTVA | DO_TotalTVA |
| `Statut` | DO_Statut | DO_Statut | DO_Statut |
| `Ref_Client` | DO_Ref | DO_Ref | DO_Ref |
| `Annee` | YEAR(DO_Date) | YEAR(DO_Date) | YEAR(DO_Date) |
| `Mois` | MONTH(DO_Date) | MONTH(DO_Date) | MONTH(DO_Date) |

Valeurs `Statut` : 0 = Brouillon, 1 = Validé, 2 = Transformé

---

### VW_IMMOBILISATIONS

Source : `F_IMMOBILISATION`  
Sync : FULL, toutes les 6h

| Colonne | v21+ | v15–v17 | fallback |
|---------|------|---------|---------|
| `Watermark_Sync` | cbMarq | cbMarq | cbMarq |
| `Ref_Immo` | IM_Ref | IM_Ref | IM_Ref |
| `Designation` | IM_Intitule | IM_Intitule | IM_Intitule |
| `Famille` | FA_CodeFamille | FA_CodeFamille | FA_CodeFamille |
| `Valeur_Acquisition` | IM_ValAcq | IM_ValOrigine | NULL |
| `Date_Acquisition` | IM_DateAcq | IM_DateAcq | IM_DateAcq |
| `Date_Mise_En_Service` | IM_DateMes | IM_DateMes | IM_DateMes |
| `Duree_Amort_Mois` | IM_Duree | IM_Duree | IM_Duree |
| `Taux_Dotation` | IM_TxDotation | IM_TxDotation | NULL |
| `VNC` | IM_VNCNet | IM_VNCNet | NULL |
| `Cumul_Amortissements` | IM_CumAmort | IM_CumAmort | NULL |
| `Date_Cession` | IM_Cession | IM_Cession | IM_Cession |
| `Etat` | IM_Etat | IM_Etat | IM_Etat |

Valeurs `Etat` : 0 = Actif, 1 = Cédé, 2 = Rebut
