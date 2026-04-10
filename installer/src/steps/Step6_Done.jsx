import React from 'react';

export default function Step6_Done({ result, caps }) {
  const healthy = result?.healthy;

  const immoLabel = {
    v21plus: 'Sage 100 v21+',
    v15v17:  'Sage 100 v15–v17',
    fallback: 'Mode compatibilité',
  }[caps?.immoSchema] || '—';

  const summary = [
    { key: 'Statut du service',    value: healthy ? 'En cours d\'exécution ✓' : 'Démarrage…', ok: healthy },
    { key: 'Version Sage détectée', value: immoLabel },
    { key: 'Port health check',     value: '127.0.0.1:8444' },
    { key: 'Intervalle de synchro', value: '1 minute (configurable)' },
    { key: 'Prochain heartbeat',    value: 'Dans 5 minutes' },
  ];

  return (
    <div className="step">
      <div className="done-hero">
        <div className="done-icon">{healthy ? '🎉' : '⚠️'}</div>
        <h1 className="done-title">
          {healthy ? 'Installation réussie !' : 'Agent installé'}
        </h1>
        <p className="done-sub">
          {healthy
            ? 'Le service CockpitAgent est démarré et communique avec la plateforme.'
            : 'Le service a été installé. Il devrait démarrer dans quelques instants.'
          }
        </p>
      </div>

      {!healthy && (
        <div className="alert alert--warning">
          <span>⚠️</span>
          <div>
            Le service n'a pas répondu dans les 30 secondes imparties. Il est possible qu'il démarre encore.
            Vérifiez dans les Services Windows que <strong>CockpitAgent</strong> est démarré.
          </div>
        </div>
      )}

      <div className="summary-list">
        {summary.map((item, i) => (
          <div className="summary-item" key={i}>
            <span className="summary-item__key">{item.key}</span>
            <span className={`summary-item__value ${item.ok !== undefined ? (item.ok ? 'summary-item__value--ok' : '') : ''}`}>
              {item.value}
            </span>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', gap: '16px', marginTop: '32px' }}>
        <button
          className="btn btn--primary"
          onClick={() => window.cockpit.openDashboard()}
        >
          🚀 Ouvrir le tableau de bord Cockpit
        </button>
      </div>

      <div style={{ textAlign: 'center', marginTop: '16px', fontSize: '12px', color: 'var(--text-muted)' }}>
        Vous pouvez fermer cette fenêtre. L'agent tourne en arrière-plan.
      </div>
    </div>
  );
}
