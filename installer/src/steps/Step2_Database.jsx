import React, { useState } from 'react';

const INITIAL = {
  sageType:        '100',
  server:          '',
  port:            '',
  instance:        '',
  database:        '',
  useWindowsAuth:  false,
  user:            '',
  password:        '',
  windowsPassword: '', // Requis quand useWindowsAuth=true pour que le service s'exécute sous ce compte
};

export default function Step2_Database({ onNext, onBack }) {
  const [form, setForm]     = useState(INITIAL);
  const [testing, setTest]  = useState(false);
  const [result, setResult] = useState(null); // { success, version, error }

  function set(key, val) {
    setForm(f => ({ ...f, [key]: val }));
    setResult(null);
  }

  async function handleTest() {
    setTest(true);
    setResult(null);
    const res = await window.cockpit.sqlTest(form);
    setResult(res);
    setTest(false);
  }

  function handleNext() {
    if (result?.success) onNext(form);
  }

  const canTest = form.server && form.database && (form.useWindowsAuth || (form.user && form.password));
  const canNext = result?.success && (!form.useWindowsAuth || form.windowsPassword);

  const winInfo = window.cockpit.windowsUser;

  return (
    <div className="step">
      <h1 className="step__title">Connexion à SQL Server</h1>
      <p className="step__desc">
        Renseignez les paramètres de connexion à votre base de données Sage.
        Le compte doit disposer des droits de lecture sur la base Sage.
      </p>

      <div className="form-group">
        <label className="form-label">Solution Sage</label>
        <select className="form-input" value={form.sageType} onChange={e => set('sageType', e.target.value)}>
          <option value="100">Sage 100</option>
          <option value="X3">Sage X3</option>
        </select>
      </div>

      <div className="form-row">
        <div className="form-group">
          <label className="form-label">Serveur SQL</label>
          <input className="form-input" placeholder="ex : 192.168.1.10 ou MONSERVEUR"
            value={form.server} onChange={e => set('server', e.target.value)} />
        </div>
        <div className="form-group" style={{ flex: '0 0 120px' }}>
          <label className="form-label">Port <span>(optionnel)</span></label>
          <input className="form-input" placeholder="1433"
            value={form.port} onChange={e => set('port', e.target.value)} />
        </div>
        <div className="form-group" style={{ flex: '0 0 180px' }}>
          <label className="form-label">Instance <span>(optionnel)</span></label>
          <input className="form-input" placeholder="ex : SQLEXPRESS"
            value={form.instance} onChange={e => set('instance', e.target.value)} />
        </div>
      </div>

      <div className="form-group">
        <label className="form-label">Base de données Sage</label>
        <input className="form-input" placeholder="ex : GESCOM"
          value={form.database} onChange={e => set('database', e.target.value)} />
      </div>

      <div className="form-group">
        <label className="form-checkbox">
          <input type="checkbox" checked={form.useWindowsAuth}
            onChange={e => set('useWindowsAuth', e.target.checked)} />
          Authentification Windows (connexion de confiance)
        </label>
      </div>

      {!form.useWindowsAuth && (
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Identifiant SQL</label>
            <input className="form-input" autoComplete="username"
              value={form.user} onChange={e => set('user', e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Mot de passe SQL</label>
            <input className="form-input" type="password" autoComplete="current-password"
              value={form.password} onChange={e => set('password', e.target.value)} />
          </div>
        </div>
      )}

      {form.useWindowsAuth && (
        <div className="form-group">
          <label className="form-label">
            Mot de passe Windows
            <span style={{ fontWeight: 'normal', color: '#666', marginLeft: '6px' }}>
              (compte {winInfo.domain}\{winInfo.user})
            </span>
          </label>
          <input className="form-input" type="password" autoComplete="current-password"
            placeholder="Mot de passe de votre session Windows"
            value={form.windowsPassword} onChange={e => set('windowsPassword', e.target.value)} />
          <small style={{ color: '#888', marginTop: '4px', display: 'block' }}>
            Le service Windows s'exécutera sous votre compte pour accéder à SQL Server
            via l'authentification Windows intégrée.
          </small>
        </div>
      )}

      {result && (
        <div className={`alert alert--${result.success ? 'success' : 'error'}`}>
          <span>{result.success ? '✅' : '❌'}</span>
          <div>
            {result.success
              ? <><strong>Connexion réussie</strong><br />{result.version}</>
              : <><strong>Échec de connexion</strong><br />{result.error}</>
            }
          </div>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '8px' }}>
        <button className="btn btn--secondary" onClick={onBack}>← Retour</button>
        <div style={{ display: 'flex', gap: '12px' }}>
          <button className="btn btn--secondary" onClick={handleTest} disabled={!canTest || testing}>
            {testing ? '⏳ Test en cours…' : '🔌 Tester la connexion'}
          </button>
          <button className="btn btn--primary" onClick={handleNext} disabled={!canNext}>
            Suivant →
          </button>
        </div>
      </div>
    </div>
  );
}
