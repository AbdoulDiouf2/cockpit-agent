import React, { useState, useEffect, useCallback, useRef } from 'react';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function StatusBadge({ ok, labelOk = 'Connecté', labelNok = 'Déconnecté' }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '3px 10px', borderRadius: 20, fontSize: 12, fontWeight: 600,
      background: ok ? '#dcfce7' : '#fee2e2',
      color: ok ? '#16a34a' : '#dc2626',
    }}>
      <span style={{
        width: 7, height: 7, borderRadius: '50%',
        background: ok ? '#22c55e' : '#ef4444',
        display: 'inline-block',
      }} />
      {ok ? labelOk : labelNok}
    </span>
  );
}

function Card({ title, children, style = {} }) {
  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 'var(--radius)', padding: '16px 20px',
      boxShadow: 'var(--shadow)', ...style,
    }}>
      {title && (
        <p style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
          letterSpacing: '.8px', color: 'var(--text-muted)', marginBottom: 12 }}>
          {title}
        </p>
      )}
      {children}
    </div>
  );
}

function InfoRow({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '7px 0', borderBottom: '1px solid var(--border)' }}>
      <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>{label}</span>
      <span style={{ fontWeight: 600, fontSize: 13, fontFamily: 'monospace',
        color: 'var(--text)', maxWidth: 340, textAlign: 'right',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {value ?? '—'}
      </span>
    </div>
  );
}

// ─── Panneau Statut ───────────────────────────────────────────────────────────

function PanelStatut() {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [restarting, setRestarting] = useState(false);
  const [restartMsg, setRestartMsg] = useState(null);

  // ── Update state ───────────────────────────────────────────────────────────
  const [updateInfo, setUpdateInfo]         = useState(null);  // { version, fileUrl, checksum, changelog }
  const [updateStep, setUpdateStep]         = useState(null);  // null | 'downloading' | 'applying' | 'done' | 'error'
  const [updateProgress, setUpdateProgress] = useState(0);
  const [updateError, setUpdateError]       = useState(null);
  const [updateTmpPath, setUpdateTmpPath]   = useState(null);

  const refresh = useCallback(async () => {
    const result = await window.cockpit.getAgentStatus();
    setData(result);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 10000);
    return () => clearInterval(id);
  }, [refresh]);

  // Vérifier les mises à jour au montage (une seule fois)
  useEffect(() => {
    window.cockpit.checkForUpdate().then((res) => {
      if (res?.hasUpdate && res.latest) setUpdateInfo(res.latest);
    }).catch(() => {});
  }, []);

  // Écouter la progression du téléchargement
  useEffect(() => {
    const unsub = window.cockpit.onUpdateProgress(({ percent }) => {
      setUpdateProgress(percent);
    });
    return unsub;
  }, []);

  const handleUpdate = async () => {
    if (!updateInfo) return;
    setUpdateStep('downloading');
    setUpdateError(null);
    setUpdateProgress(0);

    const dlRes = await window.cockpit.downloadUpdate(updateInfo.fileUrl, updateInfo.checksum);
    if (!dlRes.success) {
      setUpdateStep('error');
      setUpdateError(dlRes.error || 'Échec du téléchargement.');
      return;
    }

    setUpdateTmpPath(dlRes.tmpPath);
    setUpdateStep('applying');

    const applyRes = await window.cockpit.applyUpdate(dlRes.tmpPath);
    if (!applyRes.success) {
      setUpdateStep('error');
      setUpdateError(applyRes.error || 'Échec de l\'application de la mise à jour.');
      return;
    }

    setUpdateStep('done');
    setTimeout(refresh, 4000);
  };

  const handleRestart = async () => {
    setRestarting(true);
    setRestartMsg(null);
    const res = await window.cockpit.restartService();
    setRestarting(false);
    setRestartMsg(res.success
      ? { ok: true,  text: 'Service redémarré avec succès.' }
      : { ok: false, text: res.error || 'Échec du redémarrage.' });
    if (res.success) setTimeout(refresh, 3000);
  };

  const s = data?.status;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Statut global */}
      <Card title="État du service">
        {loading ? (
          <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Chargement…</p>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <StatusBadge
              ok={data.online}
              labelOk="Opérationnel"
              labelNok="Hors ligne"
            />
            {s?.agent && (
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                v{s.agent.version} · {s.agent.hostname} · uptime {formatUptime(s.agent.uptime)}
              </span>
            )}
          </div>
        )}
      </Card>

      {/* Bannière mise à jour */}
      {updateInfo && updateStep === null && (
        <div style={{
          padding: '10px 14px', borderRadius: 6, fontSize: 13,
          background: '#fffbeb', border: '1px solid #fde68a',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
        }}>
          <span style={{ color: '#92400e' }}>
            ⬆ Version <strong>{updateInfo.version}</strong> disponible
            {updateInfo.changelog && (
              <span style={{ color: '#b45309', marginLeft: 6, fontStyle: 'italic' }}>
                — {updateInfo.changelog.slice(0, 80)}{updateInfo.changelog.length > 80 ? '…' : ''}
              </span>
            )}
          </span>
          <button className="btn btn--primary" style={{ fontSize: 12, padding: '4px 12px' }} onClick={handleUpdate}>
            Mettre à jour
          </button>
        </div>
      )}

      {/* Progression téléchargement */}
      {updateStep === 'downloading' && (
        <div style={{ padding: '10px 14px', borderRadius: 6, background: '#eff6ff', border: '1px solid #bfdbfe' }}>
          <p style={{ fontSize: 13, color: '#1d4ed8', marginBottom: 6 }}>
            Téléchargement en cours… {updateProgress}%
          </p>
          <progress value={updateProgress} max={100} style={{ width: '100%', height: 6 }} />
        </div>
      )}

      {/* Application en cours */}
      {updateStep === 'applying' && (
        <div style={{ padding: '10px 14px', borderRadius: 6, background: '#eff6ff', border: '1px solid #bfdbfe',
          fontSize: 13, color: '#1d4ed8' }}>
          ⏳ Application de la mise à jour… (UAC requis — acceptez l'invite Windows)
        </div>
      )}

      {/* Succès mise à jour */}
      {updateStep === 'done' && (
        <div style={{ padding: '10px 14px', borderRadius: 6, background: '#dcfce7', border: '1px solid #86efac',
          fontSize: 13, color: '#16a34a' }}>
          ✓ Mise à jour vers <strong>{updateInfo?.version}</strong> appliquée. Service en cours de redémarrage…
        </div>
      )}

      {/* Erreur mise à jour */}
      {updateStep === 'error' && (
        <div style={{ padding: '10px 14px', borderRadius: 6, background: '#fee2e2', border: '1px solid #fca5a5',
          fontSize: 13, color: '#dc2626' }}>
          <strong>Échec de la mise à jour :</strong> {updateError}
          <button
            style={{ marginLeft: 12, fontSize: 12, textDecoration: 'underline', background: 'none',
              border: 'none', cursor: 'pointer', color: '#dc2626' }}
            onClick={() => { setUpdateStep(null); setUpdateError(null); }}
          >
            Réessayer
          </button>
        </div>
      )}

      {/* Connexions */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <Card title="SQL Sage 100">
          {loading
            ? <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>…</p>
            : <>
                <StatusBadge ok={s?.sage?.connected} />
                {s?.sage?.server && (
                  <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>
                    {s.sage.server} · {s.sage.database}
                  </p>
                )}
              </>
          }
        </Card>
        <Card title="Plateforme Cockpit">
          {loading
            ? <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>…</p>
            : <>
                <StatusBadge
                  ok={s?.backend?.ws_connected}
                  labelOk="WebSocket actif"
                  labelNok="Non connecté"
                />
                {s?.backend?.last_sync && (
                  <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>
                    Dernier sync : {new Date(s.backend.last_sync).toLocaleString('fr-FR')}
                  </p>
                )}
              </>
          }
        </Card>
      </div>

      {/* Token expiry */}
      {s?.backend && (
        <Card title="Token agent">
          <InfoRow label="Lignes synchronisées" value={s.backend.total_synced?.toLocaleString('fr-FR') ?? '0'} />
          {s.backend.error_count > 0 && (
            <InfoRow label="Erreurs" value={s.backend.error_count} />
          )}
          {s.backend.last_error && (
            <div style={{ marginTop: 10, padding: '8px 12px', background: '#fef2f2',
              border: '1px solid #fecaca', borderRadius: 6, fontSize: 12, color: '#dc2626' }}>
              {s.backend.last_error}
            </div>
          )}
        </Card>
      )}

      {/* Restart feedback */}
      {restartMsg && (
        <div style={{
          padding: '10px 14px', borderRadius: 6, fontSize: 13, fontWeight: 500,
          background: restartMsg.ok ? '#dcfce7' : '#fee2e2',
          color: restartMsg.ok ? '#16a34a' : '#dc2626',
          border: `1px solid ${restartMsg.ok ? '#86efac' : '#fca5a5'}`,
        }}>
          {restartMsg.text}
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <button className="btn btn--primary" onClick={() => window.cockpit.openHealthDashboard()}>
          🖥 Console santé
        </button>
        <button className="btn btn--secondary" onClick={() => window.cockpit.openDashboard()}>
          🚀 Portail Cockpit
        </button>
        <button
          className="btn btn--secondary"
          onClick={handleRestart}
          disabled={restarting}
          style={{ marginLeft: 'auto' }}
        >
          {restarting ? '⏳ Redémarrage…' : '🔄 Redémarrer le service'}
        </button>
      </div>
    </div>
  );
}

// ─── Panneau Configuration ────────────────────────────────────────────────────

function PanelConfiguration({ config, onReinstall }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card title="Configuration SQL Server">
        <InfoRow label="Serveur"    value={config.sql_server} />
        <InfoRow label="Port"       value={config.sql_port ?? '1433 (défaut)'} />
        <InfoRow label="Instance"   value={config.sql_instance} />
        <InfoRow label="Base"       value={config.sql_database} />
        <InfoRow label="Auth"       value={config.sql_use_windows_auth ? 'Windows (SSPI)' : 'SQL Server'} />
        {!config.sql_use_windows_auth && (
          <InfoRow label="Utilisateur" value={config.sql_user} />
        )}
      </Card>

      <Card title="Agent">
        <InfoRow label="Type Sage"   value={config.sage_type} />
        <InfoRow label="Version Sage" value={config.sage_version} />
        <InfoRow label="ID Agent"    value={config.agent_id} />
        <InfoRow label="Plateforme"  value={config.platform_url} />
      </Card>

      <div style={{ padding: '12px 16px', background: '#fffbeb',
        border: '1px solid #fde68a', borderRadius: 6, fontSize: 13, color: '#92400e' }}>
        ⚠ Pour modifier la configuration SQL, relancez l'installation complète. Les vues SQL seront redéployées.
      </div>

      <div>
        <button className="btn btn--secondary" onClick={onReinstall}>
          🔧 Relancer l'installation
        </button>
      </div>
    </div>
  );
}

// ─── Panneau Token ────────────────────────────────────────────────────────────

const TOKEN_RE = /^isag_[0-9a-f]{48}$/;

function PanelToken() {
  const [token,   setToken]   = useState('');
  const [status,  setStatus]  = useState(null); // null | { ok, text }
  const [loading, setLoading] = useState(false);

  const valid = TOKEN_RE.test(token.trim());

  const handleSave = async () => {
    setLoading(true);
    setStatus(null);
    const res = await window.cockpit.updateToken(token.trim());
    setLoading(false);
    if (res.success) {
      setToken('');
      setStatus({
        ok: true,
        text: res.restartWarning || 'Token mis à jour et service redémarré avec succès.',
      });
    } else {
      setStatus({ ok: false, text: res.error || 'Erreur inconnue.' });
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card title="Renouvellement manuel du token">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6 }}>
            1. Connectez-vous au portail Cockpit → <strong>Agents</strong> → détail de votre agent<br />
            2. Cliquez <strong>Régénérer le token</strong> et copiez le nouveau token<br />
            3. Collez-le ci-dessous et cliquez <strong>Enregistrer</strong>
          </p>

          <div className="form-group" style={{ margin: 0 }}>
            <label className="form-label">Nouveau token <span>(format : isag_…)</span></label>
            <input
              className="form-input"
              type="text"
              placeholder="isag_…"
              value={token}
              onChange={e => { setToken(e.target.value); setStatus(null); }}
              style={{ fontFamily: 'monospace', fontSize: 13 }}
              spellCheck={false}
            />
            {token && !valid && (
              <p style={{ fontSize: 12, color: 'var(--error)', marginTop: 4 }}>
                Format invalide — le token doit commencer par <code>isag_</code> suivi de 48 caractères hexadécimaux.
              </p>
            )}
          </div>

          <div>
            <button
              className="btn btn--primary"
              onClick={handleSave}
              disabled={!valid || loading}
            >
              {loading ? '⏳ Enregistrement…' : '💾 Enregistrer et redémarrer'}
            </button>
          </div>
        </div>
      </Card>

      {status && (
        <div style={{
          padding: '10px 14px', borderRadius: 6, fontSize: 13, fontWeight: 500,
          background: status.ok ? '#dcfce7' : '#fee2e2',
          color:      status.ok ? '#16a34a' : '#dc2626',
          border: `1px solid ${status.ok ? '#86efac' : '#fca5a5'}`,
        }}>
          {status.ok ? '✓ ' : '✗ '}{status.text}
        </div>
      )}

      <Card title="Renouvellement automatique" style={{ background: 'var(--brand-light)' }}>
        <p style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.6 }}>
          Si votre agent est connecté à la plateforme, le token est renouvelé automatiquement
          7 jours avant son expiration — aucune intervention manuelle nécessaire.
          Ce panneau sert uniquement si l'agent était hors ligne lors du renouvellement automatique.
        </p>
      </Card>
    </div>
  );
}

// ─── Panneau Logs ─────────────────────────────────────────────────────────────

const LEVEL_STYLE = {
  info:  { bg: '#f0f9ff', color: '#0369a1', label: 'INFO'  },
  warn:  { bg: '#fffbeb', color: '#b45309', label: 'WARN'  },
  error: { bg: '#fef2f2', color: '#dc2626', label: 'ERROR' },
};

function LevelBadge({ level }) {
  const s = LEVEL_STYLE[level] || LEVEL_STYLE.info;
  return (
    <span style={{
      display: 'inline-block', padding: '1px 7px', borderRadius: 4,
      fontSize: 10, fontWeight: 700, background: s.bg, color: s.color,
      minWidth: 42, textAlign: 'center', flexShrink: 0,
    }}>
      {s.label}
    </span>
  );
}

function PanelLogs() {
  const [lines,  setLines]  = useState([]);
  const [filter, setFilter] = useState('all'); // all | info | warn | error
  const [paused, setPaused] = useState(false);
  const bottomRef = useRef(null);
  const pausedRef = useRef(false);

  pausedRef.current = paused;

  useEffect(() => {
    let cleanup = () => {};

    window.cockpit.getLogs().then(({ lines: initial }) => {
      setLines(initial || []);
    });

    window.cockpit.startLogStream().then(() => {
      cleanup = window.cockpit.onLogLines((newLines) => {
        if (pausedRef.current) return;
        setLines(prev => {
          const merged = [...prev, ...newLines];
          return merged.slice(-500); // garder 500 lignes max
        });
      });
    });

    return () => {
      cleanup();
      window.cockpit.stopLogStream();
    };
  }, []);

  // Auto-scroll uniquement si non pausé
  useEffect(() => {
    if (!paused && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [lines, paused]);

  const visible = filter === 'all'
    ? lines
    : lines.filter(l => l.level === filter);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 12, color: 'var(--text-muted)', marginRight: 4 }}>Filtre :</span>
        {['all', 'info', 'warn', 'error'].map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              padding: '3px 10px', borderRadius: 4, fontSize: 12, fontWeight: 600,
              border: '1px solid var(--border)', cursor: 'pointer',
              background: filter === f ? 'var(--brand)' : 'var(--surface)',
              color: filter === f ? '#fff' : 'var(--text-muted)',
            }}
          >
            {f.toUpperCase()}
          </button>
        ))}
        <button
          onClick={() => setPaused(p => !p)}
          style={{
            marginLeft: 'auto', padding: '3px 12px', borderRadius: 4,
            fontSize: 12, fontWeight: 600, cursor: 'pointer',
            border: '1px solid var(--border)',
            background: paused ? '#fef2f2' : 'var(--surface)',
            color: paused ? '#dc2626' : 'var(--text-muted)',
          }}
        >
          {paused ? '▶ Reprendre' : '⏸ Pause'}
        </button>
        <button
          onClick={() => setLines([])}
          style={{
            padding: '3px 10px', borderRadius: 4, fontSize: 12,
            border: '1px solid var(--border)', cursor: 'pointer',
            background: 'var(--surface)', color: 'var(--text-muted)',
          }}
        >
          🗑 Vider
        </button>
      </div>

      {/* Log viewer */}
      <div style={{
        background: '#0f172a', borderRadius: 8, border: '1px solid #1e293b',
        height: 390, overflowY: 'auto', fontFamily: 'Consolas, monospace', fontSize: 12,
      }}>
        {visible.length === 0 ? (
          <p style={{ color: '#475569', padding: '20px 16px', textAlign: 'center' }}>
            En attente de logs…
          </p>
        ) : (
          visible.map((line, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'flex-start', gap: 10,
              padding: '4px 12px', borderBottom: '1px solid #1e293b',
              background: line.level === 'error' ? '#1a0000' : line.level === 'warn' ? '#1a1200' : 'transparent',
            }}>
              <span style={{ color: '#475569', whiteSpace: 'nowrap', flexShrink: 0, paddingTop: 1 }}>
                {line.timestamp?.slice(11) || ''}
              </span>
              <LevelBadge level={line.level} />
              <span style={{
                color: line.level === 'error' ? '#fca5a5' : line.level === 'warn' ? '#fde68a' : '#e2e8f0',
                wordBreak: 'break-all', lineHeight: 1.5,
              }}>
                {line.message}
              </span>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      <p style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'right' }}>
        {visible.length} ligne{visible.length !== 1 ? 's' : ''} affichée{visible.length !== 1 ? 's' : ''}
        {paused && <span style={{ color: '#dc2626', marginLeft: 8 }}>⏸ Flux pausé</span>}
      </p>
    </div>
  );
}

// ─── Composant principal ──────────────────────────────────────────────────────

const TABS = [
  { id: 'statut',        label: '📡 Statut'        },
  { id: 'configuration', label: '⚙ Configuration'  },
  { id: 'token',         label: '🔑 Token'          },
  { id: 'logs',          label: '📋 Logs'           },
];

export default function ManagementDashboard({ config, onReinstall }) {
  const [activeTab, setActiveTab] = useState('statut');

  return (
    <div className="installer">
      {/* Header */}
      <header className="installer__header">
        <div className="installer__logo">Cockpit Agent</div>
        <div className="installer__subtitle">Gestion — v1.0.0</div>
      </header>

      {/* Tabs navigation */}
      <nav className="installer__steps">
        {TABS.map(tab => (
          <div
            key={tab.id}
            className={['step-tab', activeTab === tab.id ? 'step-tab--active' : ''].join(' ')}
            onClick={() => setActiveTab(tab.id)}
            style={{ cursor: 'pointer' }}
          >
            {tab.label}
          </div>
        ))}
      </nav>

      {/* Content */}
      <main className="installer__body">
        <div style={{ maxWidth: activeTab === 'logs' ? 860 : 700 }}>
          {activeTab === 'statut'        && <PanelStatut />}
          {activeTab === 'configuration' && <PanelConfiguration config={config} onReinstall={onReinstall} />}
          {activeTab === 'token'         && <PanelToken />}
          {activeTab === 'logs'          && <PanelLogs />}
        </div>
      </main>
    </div>
  );
}

// ─── Util ─────────────────────────────────────────────────────────────────────

function formatUptime(sec) {
  if (!sec) return '—';
  if (sec < 60)   return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  const h = Math.floor(sec / 3600);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}j`;
}
