import React, { useState, useEffect } from 'react';

export default function Step3_Detection({ caps, setCaps, onNext, onBack }) {
  const [detecting, setDetecting] = useState(false);
  const [error, setError]         = useState(null);

  useEffect(() => {
    if (!caps) runDetection();
  }, []);

  async function runDetection() {
    setDetecting(true);
    setError(null);
    const res = await window.cockpit.sqlDetect();
    setDetecting(false);
    if (res.success) {
      setCaps(res.caps);
    } else {
      setError(res.error);
    }
  }

  if (detecting) {
    return (
      <div className="step">
        <h1 className="step__title">Détection en cours…</h1>
        <p className="step__desc">Analyse du schéma Sage 100 et de la version SQL Server.</p>
        <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>
          <div style={{ fontSize: '40px', marginBottom: '16px' }}>🔍</div>
          <p>Interrogation de INFORMATION_SCHEMA…</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="step">
        <h1 className="step__title">Détection</h1>
        <div className="alert alert--error">
          <span>❌</span>
          <div><strong>Échec de détection</strong><br />{error}</div>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          <button className="btn btn--secondary" onClick={onBack}>← Retour</button>
          <button className="btn btn--primary" onClick={runDetection}>Réessayer</button>
        </div>
      </div>
    );
  }

  if (!caps) return null;

  const immoLabel = {
    v21plus: 'Sage 100 v21+',
    v15v17:  'Sage 100 v15–v17',
    fallback: 'Version ancienne / atypique',
  }[caps.immoSchema] || caps.immoSchema;

  return (
    <div className="step">
      <h1 className="step__title">Détection Sage 100</h1>
      <p className="step__desc">
        Les informations ci-dessous ont été détectées automatiquement à partir de votre base de données.
        Vérifiez qu'elles correspondent à votre installation Sage.
      </p>

      {caps.immoSchema === 'fallback' && (
        <div className="alert alert--warning">
          <span>⚠️</span>
          <div>
            Version Sage ancienne détectée. Certaines vues utiliseront des valeurs nulles pour les champs non disponibles.
          </div>
        </div>
      )}

      <div className="caps-grid">
        <div className="caps-card">
          <div className="caps-card__label">Version SQL Server</div>
          <div className="caps-card__value">SQL Server {caps.sqlServerVersion || '—'}</div>
        </div>
        <div className="caps-card">
          <div className="caps-card__label">Version Sage détectée</div>
          <div className={`caps-card__value caps-card__value--${caps.immoSchema === 'fallback' ? 'warn' : 'ok'}`}>
            {immoLabel}
          </div>
        </div>
        <div className="caps-card">
          <div className="caps-card__label">Tables Sage trouvées</div>
          <div className="caps-card__value caps-card__value--ok">
            {Array.isArray(caps.tablesFound) ? caps.tablesFound.length : caps.tablesFound} tables F_*
          </div>
          {Array.isArray(caps.tablesFound) && (
            <div style={{ marginTop: '6px', fontSize: '11px', color: 'var(--text-muted)', lineHeight: '1.6' }}>
              {caps.tablesFound.join(' · ')}
            </div>
          )}
        </div>
        <div className="caps-card">
          <div className="caps-card__label">Écritures comptables</div>
          <div className="caps-card__value">{caps.nbEcritures?.toLocaleString('fr-FR') ?? '—'}</div>
        </div>
        <div className="caps-card">
          <div className="caps-card__label">Champ Date Livraison</div>
          <div className={`caps-card__value ${caps.hasDateLivr ? 'caps-card__value--ok' : 'caps-card__value--warn'}`}>
            {caps.hasDateLivr ? 'Disponible' : 'Non disponible'}
          </div>
        </div>
        <div className="caps-card">
          <div className="caps-card__label">Schéma Stocks</div>
          <div className="caps-card__value caps-card__value--ok">{caps.stockSchema || '—'}</div>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '32px' }}>
        <button className="btn btn--secondary" onClick={onBack}>← Retour</button>
        <button className="btn btn--primary" onClick={onNext}>Déployer les vues →</button>
      </div>
    </div>
  );
}
