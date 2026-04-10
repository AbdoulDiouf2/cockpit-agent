import React, { useState } from 'react';
import Step1_Welcome    from './steps/Step1_Welcome.jsx';
import Step2_Database   from './steps/Step2_Database.jsx';
import Step3_Detection  from './steps/Step3_Detection.jsx';
import Step4_Views      from './steps/Step4_Views.jsx';
import Step5_Token      from './steps/Step5_Token.jsx';
import Step6_Done       from './steps/Step6_Done.jsx';

const STEPS = [
  { id: 1, label: 'Bienvenue'   },
  { id: 2, label: 'Base de données' },
  { id: 3, label: 'Détection'   },
  { id: 4, label: 'Déploiement' },
  { id: 5, label: 'Activation'  },
  { id: 6, label: 'Terminé'     },
];

export default function App() {
  const [step, setStep]           = useState(1);
  const [sqlConfig, setSqlConfig] = useState(null);
  const [caps, setCaps]           = useState(null);
  const [agentId, setAgentId]     = useState(null);
  const [installResult, setInstallResult] = useState(null);

  const next = () => setStep(s => Math.min(s + 1, 6));
  const prev = () => setStep(s => Math.max(s - 1, 1));

  function renderStep() {
    switch (step) {
      case 1: return <Step1_Welcome onNext={next} />;
      case 2: return <Step2_Database onNext={(cfg) => { setSqlConfig(cfg); next(); }} onBack={prev} />;
      case 3: return <Step3_Detection caps={caps} setCaps={setCaps} onNext={next} onBack={prev} />;
      case 4: return <Step4_Views onNext={next} onBack={prev} />;
      case 5: return <Step5_Token sqlConfig={sqlConfig} agentId={agentId} setAgentId={setAgentId}
                       onNext={(r) => { setInstallResult(r); next(); }} onBack={prev} />;
      case 6: return <Step6_Done result={installResult} caps={caps} />;
      default: return null;
    }
  }

  return (
    <div className="installer">
      {/* Header */}
      <header className="installer__header">
        <div className="installer__logo">Cockpit Agent</div>
        <div className="installer__subtitle">Installation — v1.0.0</div>
      </header>

      {/* Step tabs */}
      <nav className="installer__steps">
        {STEPS.map((s) => (
          <div
            key={s.id}
            className={[
              'step-tab',
              step === s.id  ? 'step-tab--active' : '',
              step  >  s.id  ? 'step-tab--done'   : '',
            ].join(' ')}
          >
            <span className="step-tab__num">
              {step > s.id ? '✓' : s.id}
            </span>
            {s.label}
          </div>
        ))}
      </nav>

      {/* Content */}
      <main className="installer__body">
        {renderStep()}
      </main>
    </div>
  );
}
