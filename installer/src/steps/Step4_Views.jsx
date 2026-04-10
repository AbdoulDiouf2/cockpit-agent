import React, { useState, useEffect, useRef } from 'react';

export default function Step4_Views({ onNext, onBack }) {
  const [status, setStatus]     = useState('idle'); // idle | running | done | error
  const [logs, setLogs]         = useState([]);
  const [progress, setProgress] = useState({ step: 0, total: 0, current: '', pct: 0 });
  const cleanupRef              = useRef(null);
  const logEndRef               = useRef(null);

  useEffect(() => {
    return () => { if (cleanupRef.current) cleanupRef.current(); };
  }, []);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  async function handleDeploy() {
    setStatus('running');
    setLogs([]);
    setProgress({ step: 0, total: 0, current: '', pct: 0 });

    // Écouter les événements de progression
    cleanupRef.current = window.cockpit.onSqlProgress((data) => {
      const { step, total, current, status: s } = data;
      const pct = total > 0 ? Math.round((step / total) * 100) : 0;
      setProgress({ step, total, current, pct });
      setLogs(prev => [...prev, {
        text: `[${step}/${total}] ${current}`,
        type: s === 'error' ? 'err' : s === 'warning' ? 'warn' : 'ok',
      }]);
    });

    const res = await window.cockpit.sqlDeploy();

    if (cleanupRef.current) { cleanupRef.current(); cleanupRef.current = null; }

    if (res.success) {
      setStatus('done');
      setLogs(prev => [...prev, { text: '✓ Déploiement terminé avec succès', type: 'ok' }]);
    } else {
      setStatus('error');
      setLogs(prev => [...prev, { text: `✗ Erreur : ${res.error}`, type: 'err' }]);
    }
  }

  return (
    <div className="step">
      <h1 className="step__title">Déploiement des vues SQL</h1>
      <p className="step__desc">
        L'assistant va créer des vues de lecture dans votre base Sage 100.
        Ces vues sont en <strong>lecture seule</strong> et n'altèrent aucune donnée existante.
      </p>

      {status === 'idle' && (
        <div className="alert alert--info">
          <span>ℹ️</span>
          <div>
            12 vues seront créées : Grand Livre, Trésorerie, Stocks, Commandes, Immobilisations, etc.
            L'opération dure environ 10–30 secondes.
          </div>
        </div>
      )}

      {(status === 'running' || status === 'done') && (
        <div className="progress-wrap">
          <div className="progress-label">
            <span>{progress.current || 'En cours…'}</span>
            <span>{progress.pct}%</span>
          </div>
          <div className="progress-bar">
            <div className="progress-bar__fill" style={{ width: `${progress.pct}%` }} />
          </div>
        </div>
      )}

      {status === 'error' && (
        <div className="alert alert--error">
          <span>❌</span>
          <div>
            <strong>Le déploiement a échoué.</strong> Vérifiez que le compte SQL dispose des droits CREATE VIEW sur la base Sage.
          </div>
        </div>
      )}

      {status === 'done' && (
        <div className="alert alert--success">
          <span>✅</span>
          <div><strong>Toutes les vues ont été créées avec succès.</strong></div>
        </div>
      )}

      {logs.length > 0 && (
        <div className="log-list">
          {logs.map((l, i) => (
            <div key={i} className={`log-item log-item--${l.type}`}>{l.text}</div>
          ))}
          <div ref={logEndRef} />
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '24px' }}>
        <button className="btn btn--secondary" onClick={onBack} disabled={status === 'running'}>
          ← Retour
        </button>
        <div style={{ display: 'flex', gap: '12px' }}>
          {(status === 'idle' || status === 'error') && (
            <button className="btn btn--secondary" onClick={onNext} disabled={status === 'running'}>
              Passer (vues déjà en place)
            </button>
          )}
          {status === 'idle' || status === 'error' ? (
            <button className="btn btn--primary" onClick={handleDeploy} disabled={status === 'running'}>
              {status === 'error' ? '🔄 Réessayer' : '🚀 Déployer les vues'}
            </button>
          ) : null}
          {status === 'done' && (
            <button className="btn btn--primary" onClick={onNext}>
              Suivant →
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
