import React, { useState, useEffect, useRef } from 'react';

export default function Step5_Token({ sqlConfig, agentId, setAgentId, onNext, onBack }) {
  const [email, setEmail]         = useState('');
  const [token, setToken]         = useState('');
  const [validating, setValid]    = useState(false);
  const [apiResult, setApiResult] = useState(null);
  const [installing, setInstall]  = useState(false);
  const [installErr, setInstErr]  = useState(null);
  const [progress, setProgress]   = useState(null); // { step, total, label }
  const cleanupRef                = useRef(null);

  useEffect(() => {
    return () => { if (cleanupRef.current) cleanupRef.current(); };
  }, []);

  async function handleValidate() {
    setValid(true);
    setApiResult(null);
    const res = await window.cockpit.apiValidate({ email, token });
    setApiResult(res);
    if (res.success) setAgentId(res.agentId);
    setValid(false);
  }

  async function handleInstall() {
    setInstall(true);
    setInstErr(null);
    setProgress(null);

    cleanupRef.current = window.cockpit.onServiceProgress((data) => {
      setProgress(data);
    });

    const res = await window.cockpit.serviceInstall({ sqlConfig, agentId });

    if (cleanupRef.current) { cleanupRef.current(); cleanupRef.current = null; }
    setInstall(false);

    if (res.success) {
      onNext(res);
    } else {
      setInstErr(res.error);
    }
  }

  const canValidate = email && token && token.startsWith('isag_');
  const validated   = apiResult?.success;

  return (
    <div className="step">
      <h1 className="step__title">Activation de l'agent</h1>
      <p className="step__desc">
        Saisissez votre email et le token d'accès fournis depuis la plateforme Cockpit.
        Le token est au format <code style={{ background: 'var(--bg)', padding: '1px 6px', borderRadius: '4px' }}>isag_…</code>
      </p>

      <div className="form-group">
        <label className="form-label">Email de connexion Cockpit</label>
        <input
          className="form-input"
          type="email"
          placeholder="vous@entreprise.fr"
          value={email}
          onChange={e => { setEmail(e.target.value); setApiResult(null); }}
          disabled={validated || validating}
        />
      </div>

      <div className="form-group">
        <label className="form-label">Token d'accès agent</label>
        <input
          className="form-input"
          placeholder="isag_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
          value={token}
          onChange={e => { setToken(e.target.value); setApiResult(null); }}
          disabled={validated || validating}
        />
        <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
          Disponible dans Cockpit → Paramètres → Mon agent
        </div>
      </div>

      {apiResult && !apiResult.success && (
        <div className="alert alert--error">
          <span>❌</span>
          <div><strong>Validation échouée</strong><br />{apiResult.error}</div>
        </div>
      )}

      {apiResult?.success && (
        <div className="alert alert--success">
          <span>✅</span>
          <div>
            <strong>Token validé — {apiResult.clientName}</strong>
            <br />
            Plan : {apiResult.plan} · Agent ID : {apiResult.agentId}
          </div>
        </div>
      )}

      {installErr && (
        <div className="alert alert--error">
          <span>❌</span>
          <div><strong>Erreur d'installation du service</strong><br />{installErr}</div>
        </div>
      )}

      {installing && (
        <div style={{ margin: '16px 0' }}>
          <div className="progress-wrap">
            <div className="progress-label">
              <span>{progress?.label || 'Initialisation…'}</span>
              <span>{progress ? `${progress.step}/${progress.total}` : ''}</span>
            </div>
            <div className="progress-bar">
              <div
                className="progress-bar__fill"
                style={{ width: progress ? `${Math.round((progress.step / progress.total) * 100)}%` : '0%',
                         transition: 'width 0.4s ease' }}
              />
            </div>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '8px' }}>
        <button className="btn btn--secondary" onClick={onBack} disabled={validating || installing}>
          ← Retour
        </button>
        <div style={{ display: 'flex', gap: '12px' }}>
          {!validated && (
            <button className="btn btn--primary" onClick={handleValidate}
              disabled={!canValidate || validating}>
              {validating ? '⏳ Validation…' : 'Valider le token'}
            </button>
          )}
          {validated && (
            <button className="btn btn--primary" onClick={handleInstall} disabled={installing}>
              {installing ? '⏳ Installation…' : '⚙️ Installer le service →'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
