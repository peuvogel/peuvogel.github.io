export function createCorrelationWizard(container, onSelect) {
  function selectPearson() {
    if (onSelect) onSelect('pearson');
    closeModal();
  }

  function selectSpearman() {
    if (onSelect) onSelect('spearman');
    closeModal();
  }

  function closeModal() {
    const m = container.closest('dialog');
    if (m) m.close();
  }

  const STYLES = `
    .corr-wizard {
      font-family: inherit;
      color: var(--text-base);
      background: var(--surface-2);
      border: 1px solid var(--border-color);
      border-radius: 16px;
      padding: 0;
      animation: corrFadeIn 0.3s ease-out;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }
    .corr-wizard-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 24px 24px 16px 24px;
      border-bottom: 1px solid var(--border-color);
      background: var(--surface-1);
    }
    .corr-wizard-title {
      font-size: 1.25rem;
      font-weight: 700;
      color: var(--text-strong);
      margin: 0;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .corr-btn-ghost {
      background: transparent;
      border: 1px solid var(--border-color);
      color: var(--text-muted);
      cursor: pointer;
      border-radius: 8px;
      padding: 6px 14px;
      font-size: 0.85rem;
      transition: all 0.2s;
    }
    .corr-btn-ghost:hover {
      background: rgba(255,255,255,0.05);
      color: var(--text-base);
    }
    .corr-wizard-body {
      padding: 24px;
    }
    .corr-intro {
      margin-bottom: 24px;
      color: var(--text-muted);
      line-height: 1.5;
    }
    .corr-options-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 24px;
    }
    @media (max-width: 768px) {
      .corr-options-grid { grid-template-columns: 1fr; }
    }
    .corr-option-card {
      background: var(--surface-1);
      border: 1px solid var(--border-color);
      border-radius: 12px;
      padding: 24px;
      display: flex;
      flex-direction: column;
      position: relative;
    }
    .corr-option-pearson {
      border-top: 4px solid #f97316;
    }
    .corr-option-spearman {
      border-top: 4px solid #22c55e;
    }
    .corr-option-title {
      font-size: 1.25rem;
      font-weight: 700;
      margin: 0 0 12px 0;
    }
    .corr-option-pearson .corr-option-title { color: #fed7aa; }
    .corr-option-spearman .corr-option-title { color: #bbf7d0; }
    
    .corr-svg-container {
      width: 100%;
      background: var(--surface-2);
      border-radius: 8px;
      margin-bottom: 20px;
      padding: 16px 0;
      border: 1px solid rgba(255,255,255,0.05);
      display: flex;
      justify-content: center;
    }
    .corr-svg-container svg {
      width: 100%;
      max-width: 250px;
      height: 120px;
    }
    
    .corr-option-desc {
      font-size: 0.95rem;
      line-height: 1.5;
      color: var(--text-base);
      margin: 0 0 20px 0;
      flex-grow: 1;
    }
    
    .corr-example-box {
      background: var(--surface-2);
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 24px;
      border-left: 3px solid var(--border-color);
    }
    .corr-example-pearson { border-left-color: #f97316; background: rgba(249,115,22,0.05); }
    .corr-example-spearman { border-left-color: #22c55e; background: rgba(34,197,94,0.05); }
    
    .corr-example-title {
      font-size: 0.8rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 8px;
    }
    .corr-example-pearson .corr-example-title { color: #fdba74; }
    .corr-example-spearman .corr-example-title { color: #86efac; }
    
    .corr-example-text {
      font-size: 0.9rem;
      line-height: 1.5;
      margin: 0;
      color: var(--text-muted);
    }
    
    .corr-btn-apply {
      width: 100%;
      padding: 12px;
      border-radius: 8px;
      font-size: 1rem;
      font-weight: 600;
      cursor: pointer;
      border: none;
      transition: all 0.2s;
    }
    .corr-btn-pearson {
      background: rgba(249, 115, 22, 0.15);
      color: #fed7aa;
      border: 1px solid rgba(249, 115, 22, 0.3);
    }
    .corr-btn-pearson:hover {
      background: rgba(249, 115, 22, 0.25);
    }
    .corr-btn-spearman {
      background: rgba(34, 197, 94, 0.15);
      color: #bbf7d0;
      border: 1px solid rgba(34, 197, 94, 0.3);
    }
    .corr-btn-spearman:hover {
      background: rgba(34, 197, 94, 0.25);
    }
    @keyframes corrFadeIn {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: translateY(0); }
    }
  `;

  if (!document.getElementById('corr-wizard-styles')) {
    const styleEl = document.createElement('style');
    styleEl.id = 'corr-wizard-styles';
    styleEl.textContent = STYLES;
    document.head.appendChild(styleEl);
  }

  function render() {
    const html = `
      <div class="corr-wizard">
        <div class="corr-wizard-header">
          <h3 class="corr-wizard-title">
            <svg width="24" height="24" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
            Qual teste escolher?
          </h3>
          <button class="corr-btn-ghost" id="corr-close" title="Fechar">❌ Fechar</button>
        </div>
        
        <div class="corr-wizard-body">
          <p class="corr-intro">A correlação mede como duas variáveis caminham juntas. Escolha o teste que melhor se adapta à realidade dos seus dados, especialmente ao trabalhar com bases do Sistema de Saúde (DATASUS).</p>
          
          <div class="corr-options-grid">
            <div class="corr-option-card corr-option-pearson">
              <h4 class="corr-option-title">Pearson (Linear)</h4>
              
              <div class="corr-svg-container">
                <svg viewBox="0 0 200 120" xmlns="http://www.w3.org/2000/svg">
                  <!-- Axes -->
                  <line x1="20" y1="100" x2="190" y2="100" stroke="#52525b" stroke-width="2" stroke-linecap="round" />
                  <line x1="20" y1="100" x2="20" y2="10" stroke="#52525b" stroke-width="2" stroke-linecap="round" />
                  <!-- Linear trend line (faint) -->
                  <line x1="30" y1="90" x2="170" y2="20" stroke="#f97316" stroke-width="2" stroke-dasharray="4" opacity="0.4" />
                  <!-- Scatter points (linear) -->
                  <circle cx="35" cy="88" r="3.5" fill="#f97316" />
                  <circle cx="45" cy="80" r="3.5" fill="#f97316" />
                  <circle cx="55" cy="85" r="3.5" fill="#f97316" />
                  <circle cx="65" cy="70" r="3.5" fill="#f97316" />
                  <circle cx="80" cy="72" r="3.5" fill="#f97316" />
                  <circle cx="95" cy="55" r="3.5" fill="#f97316" />
                  <circle cx="110" cy="58" r="3.5" fill="#f97316" />
                  <circle cx="120" cy="45" r="3.5" fill="#f97316" />
                  <circle cx="135" cy="40" r="3.5" fill="#f97316" />
                  <circle cx="150" cy="35" r="3.5" fill="#f97316" />
                  <circle cx="165" cy="25" r="3.5" fill="#f97316" />
                </svg>
              </div>

              <p class="corr-option-desc">Ideal para dados paramétricos. Exige que as duas variáveis sejam numéricas contínuas e sigam uma curva normal (sino), formando uma <strong>tendência linear</strong> reta sem valores extremos (outliers) que possam puxar a linha.</p>
              
              <div class="corr-example-box corr-example-pearson">
                <div class="corr-example-title">Exemplo DATASUS</div>
                <p class="corr-example-text">Relação entre o <strong>PIB per capita</strong> e a <strong>Expectativa de Vida</strong> em grandes capitais, assumindo que a distribuição seja suave e sem municípios com distorções absurdas na base.</p>
              </div>
              
              <button class="corr-btn-apply corr-btn-pearson" id="corr-select-pearson">Selecionar Pearson</button>
            </div>
            
            <div class="corr-option-card corr-option-spearman">
              <h4 class="corr-option-title">Spearman (Monotônica)</h4>
              
              <div class="corr-svg-container">
                <svg viewBox="0 0 200 120" xmlns="http://www.w3.org/2000/svg">
                  <!-- Axes -->
                  <line x1="20" y1="100" x2="190" y2="100" stroke="#52525b" stroke-width="2" stroke-linecap="round" />
                  <line x1="20" y1="100" x2="20" y2="10" stroke="#52525b" stroke-width="2" stroke-linecap="round" />
                  <!-- Monotonic curve trend line (faint) -->
                  <path d="M 30 90 Q 120 85 170 20" fill="none" stroke="#22c55e" stroke-width="2" stroke-dasharray="4" opacity="0.4" />
                  <!-- Scatter points (exponential/monotonic) -->
                  <circle cx="35" cy="89" r="3.5" fill="#22c55e" />
                  <circle cx="50" cy="87" r="3.5" fill="#22c55e" />
                  <circle cx="65" cy="88" r="3.5" fill="#22c55e" />
                  <circle cx="80" cy="85" r="3.5" fill="#22c55e" />
                  <circle cx="95" cy="80" r="3.5" fill="#22c55e" />
                  <circle cx="110" cy="75" r="3.5" fill="#22c55e" />
                  <circle cx="125" cy="65" r="3.5" fill="#22c55e" />
                  <circle cx="140" cy="50" r="3.5" fill="#22c55e" />
                  <circle cx="155" cy="35" r="3.5" fill="#22c55e" />
                  <circle cx="165" cy="22" r="3.5" fill="#22c55e" />
                  <!-- Extreme Outlier -->
                  <circle cx="170" cy="90" r="4.5" fill="#ef4444" opacity="0.9" />
                  <text x="170" y="80" font-size="10" font-weight="600" fill="#ef4444" text-anchor="middle">Outlier</text>
                </svg>
              </div>

              <p class="corr-option-desc">Muito mais robusto. Baseado em posições (ranks) ao invés de valores reais. Captura relações em curva (monotônicas) e sobrevive a outliers severos (em vermelho), além de suportar variáveis ordinais.</p>
              
              <div class="corr-example-box corr-example-spearman">
                <div class="corr-example-title">Exemplo DATASUS</div>
                <p class="corr-example-text">Relação entre <strong>Faixa Etária</strong> (1=Jovens, 2=Adultos, 3=Idosos) e <strong>Taxa de Mortalidade</strong>, ou ao analisar milhares de municípios onde pequenas cidades geram enormes distorções.</p>
              </div>
              
              <button class="corr-btn-apply corr-btn-spearman" id="corr-select-spearman">Selecionar Spearman</button>
            </div>
          </div>
        </div>
      </div>
    `;

    container.innerHTML = html;

    const bind = (id, handler) => {
      const el = container.querySelector('#' + id);
      if (el) el.addEventListener('click', handler);
    };

    bind('corr-close', closeModal);
    bind('corr-select-pearson', selectPearson);
    bind('corr-select-spearman', selectSpearman);
  }

  // initial render
  render();

  return {
    getState: () => ({}),
    reset: () => {}
  };
}
