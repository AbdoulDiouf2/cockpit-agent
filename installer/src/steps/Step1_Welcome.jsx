import React, { useState } from 'react';

export default function Step1_Welcome({ onNext }) {
  const [accepted, setAccepted] = useState(false);

  return (
    <div className="step">
      <h1 className="step__title">Bienvenue dans l'assistant d'installation</h1>
      <p className="step__desc">
        Cet assistant va vous guider pour connecter votre base de données Sage 100 à la plateforme Cockpit.
        L'agent s'installe en tant que service Windows et communique de façon sécurisée avec le cloud.
      </p>

      <div className="alert alert--info">
        <span>ℹ️</span>
        <div>
          <strong>Aucune donnée confidentielle ne quitte votre réseau.</strong>
          <br />
          L'agent envoie uniquement des agrégats financiers (KPI, stocks, commandes) vers la plateforme Cockpit.
          Les données brutes restent sur votre serveur.
        </div>
      </div>

      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '20px 24px', marginBottom: '24px' }}>
        <h3 style={{ fontSize: '15px', fontWeight: '700', marginBottom: '12px' }}>Ce que l'assistant va effectuer :</h3>
        <ul style={{ paddingLeft: '20px', lineHeight: '2', color: 'var(--text-muted)' }}>
          <li>Connexion à votre base SQL Server Sage 100</li>
          <li>Détection automatique de votre version Sage</li>
          <li>Déploiement des vues SQL nécessaires (lecture seule)</li>
          <li>Validation de votre token d'accès Cockpit</li>
          <li>Installation du service Windows CockpitAgent</li>
        </ul>
      </div>

      <label className="form-checkbox" style={{ marginBottom: '28px' }}>
        <input
          type="checkbox"
          checked={accepted}
          onChange={e => setAccepted(e.target.checked)}
        />
        J'accepte les{' '}
        <a href="https://cockpit.app/cgu" style={{ color: 'var(--brand)' }} onClick={e => { e.preventDefault(); window.cockpit?.openDashboard(); }}>
          conditions d'utilisation
        </a>{' '}
        et la{' '}
        <a href="https://cockpit.app/privacy" style={{ color: 'var(--brand)' }} onClick={e => e.preventDefault()}>
          politique de confidentialité
        </a>.
      </label>

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button className="btn btn--primary" onClick={onNext} disabled={!accepted}>
          Commencer l'installation →
        </button>
      </div>
    </div>
  );
}
