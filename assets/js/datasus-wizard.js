import { parseDatasusText } from './datasus-importer.js';
import { normalizeDatasusSource, suggestTestsForSources } from './datasus-normalizer.js';

export const DATASUS_COLUMN_ROLES = [
  { value: 'primary-category', label: 'Dimensão principal' },
  { value: 'category', label: 'Categoria extra' },
  { value: 'time', label: 'Temporal' },
  { value: 'measure', label: 'Quantitativa' },
  { value: 'total', label: 'Total/agregado' },
  { value: 'ignore', label: 'Ignorar' }
];

const TYPE_OPTIONS = [
  { value: 'categorical', label: 'Categórica' },
  { value: 'temporal', label: 'Temporal' },
  { value: 'quantitative', label: 'Quantitativa' },
  { value: 'total', label: 'Total/agregado' },
  { value: 'metadata', label: 'Metadado' }
];

function clonePlain(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function roleToType(role) {
  if (role === 'primary-category' || role === 'category') return 'categorical';
  if (role === 'time') return 'temporal';
  if (role === 'measure') return 'quantitative';
  if (role === 'total') return 'total';
  return 'metadata';
}

function formatToneClass(tone) {
  if (tone === 'error') return 'error-box';
  if (tone === 'success') return 'success-box';
  return 'status-bar';
}

function publicSource(source) {
  return {
    id: source.id,
    fileName: source.fileName,
    sourceKind: source.sourceKind,
    confirmed: source.confirmed,
    diagnosis: clonePlain(source.parsed.diagnosis),
    mapping: clonePlain(source.mapping),
    normalized: clonePlain(source.normalized)
  };
}

function buildSession(state) {
  const sources = state.sources.map(publicSource);
  const confirmedSources = sources.filter(source => source.confirmed && source.normalized?.ok);
  const suggestedSources = confirmedSources.length ? confirmedSources : sources.filter(source => source.normalized?.ok);

  return {
    sources,
    confirmedSources,
    activeSourceId: state.activeSourceId,
    suggestions: suggestTestsForSources(suggestedSources),
    status: {
      tone: state.statusTone,
      message: state.statusMessage
    }
  };
}

function linePreview(source) {
  return source.parsed.lines.map(line => [
    `Linha ${line.index + 1}`,
    line.clean || line.raw || '(vazia)'
  ]);
}

function headerSelectOptions(source, utils) {
  const topCandidates = source.parsed.headerCandidates.slice(0, 12).map(candidate => candidate.rowIndex);
  const previewLines = source.parsed.lines.slice(0, 20).map(line => line.index);
  const uniqueLineIndexes = [...new Set([...topCandidates, ...previewLines, source.parsed.headerRowIndex])].sort((left, right) => left - right);

  return uniqueLineIndexes.map(lineIndex => {
    const line = source.parsed.lines.find(item => item.index === lineIndex);
    return {
      rowIndex: lineIndex,
      preview: line?.clean || line?.raw || `Linha ${lineIndex + 1}`
    };
  });
}

function headerOptionLabel(candidate, utils) {
  return `Linha ${candidate.rowIndex + 1} - ${utils.escapeHtml(candidate.preview || 'Sem conteúdo relevante')}`;
}

function mappingRoleLabel(role) {
  return DATASUS_COLUMN_ROLES.find(option => option.value === role)?.label || role;
}

function typeLabel(value) {
  return TYPE_OPTIONS.find(option => option.value === value)?.label || value;
}

function setSourceNormalized(source, utils, stats) {
  source.normalized = normalizeDatasusSource(source, utils, stats);
}

function reparseSource(source, utils, stats, headerRowIndex = null) {
  source.parsed = parseDatasusText({
    text: source.rawText,
    fileName: source.fileName,
    utils,
    stats,
    headerRowIndex
  });
  source.mapping = clonePlain(source.parsed.initialMapping);
  source.confirmed = false;
  setSourceNormalized(source, utils, stats);
}

function sourceCardHtml(source, activeId, utils) {
  const tone = source.confirmed && source.normalized?.ok ? 'primary' : source.normalized?.ok ? 'info' : 'warning';
  const stateText = source.confirmed
    ? 'confirmada'
    : source.normalized?.ok
      ? 'mapeada'
      : 'revisar';

  return `
    <button type="button" class="datasus-source-card ${source.id === activeId ? 'is-active' : ''}" data-source-id="${utils.escapeHtml(source.id)}">
      <span class="small-chip ${tone}">${utils.escapeHtml(stateText)}</span>
      <strong>${utils.escapeHtml(source.fileName)}</strong>
      <span>${utils.escapeHtml(source.parsed.diagnosis.formatType)} · cabeçalho linha ${source.parsed.headerRowIndex + 1}</span>
    </button>
  `;
}

function mappingTableHtml(source, utils) {
  const preview = source.parsed.columnProfiles.map(profile => {
    const mapped = source.mapping.columns.find(column => column.index === profile.index) || {
      index: profile.index,
      header: profile.header,
      role: profile.suggestedRole,
      variableType: profile.suggestedType
    };
    const sample = profile.sampleValues.length ? profile.sampleValues.join(' | ') : 'Sem amostra';

    return `
      <tr>
        <td><strong>${utils.escapeHtml(profile.header)}</strong></td>
        <td>${utils.escapeHtml(sample)}</td>
        <td>
          <select data-action="column-role" data-column-index="${profile.index}">
            ${DATASUS_COLUMN_ROLES.map(option => `<option value="${option.value}"${option.value === mapped.role ? ' selected' : ''}>${utils.escapeHtml(option.label)}</option>`).join('')}
          </select>
        </td>
        <td>
          <select data-action="column-type" data-column-index="${profile.index}">
            ${TYPE_OPTIONS.map(option => `<option value="${option.value}"${option.value === mapped.variableType ? ' selected' : ''}>${utils.escapeHtml(option.label)}</option>`).join('')}
          </select>
        </td>
        <td class="datasus-preview-note">${utils.escapeHtml(mappingRoleLabel(profile.suggestedRole))} · ${utils.escapeHtml(typeLabel(profile.suggestedType))}</td>
      </tr>
    `;
  }).join('');

  return `
    <div class="preview-table-wrap datasus-mapping-table">
      <table class="preview-table">
        <thead>
          <tr>
            <th>Coluna</th>
            <th>Amostra</th>
            <th>Papel</th>
            <th>Tipo</th>
            <th>Leitura automática</th>
          </tr>
        </thead>
        <tbody>${preview}</tbody>
      </table>
    </div>
  `;
}

function normalizedPreviewHtml(source, utils) {
  if (!source.normalized || !source.normalized.previewRows || !source.normalized.previewRows.length) {
    return '<div class="small-note">Ainda não há linhas normalizadas suficientes para pré-visualização.</div>';
  }

  const rows = source.normalized.previewRows.map(row => [
    row.category || '',
    row.time || '',
    row.value === null || row.value === undefined ? '' : String(row.value),
    row.isTotal ? 'Sim' : 'Não'
  ]);

  return utils.renderPreviewTable(['Categoria', 'Tempo', 'Valor', 'Total'], rows);
}

export function createDatasusWizard({
  root,
  utils,
  stats,
  shared = null,
  title = 'Camada Universal DATASUS',
  description = 'Importe, revise, corrija e confirme uma base padronizada antes de enviar os dados ao teste.',
  exampleSources = [],
  onSessionChange = () => { }
}) {
  const state = {
    nextId: 1,
    sources: [],
    activeSourceId: '',
    statusTone: 'status',
    statusMessage: 'Importe um ou mais arquivos DATASUS para iniciar o assistente.'
  };

  function activeSource() {
    return state.sources.find(source => source.id === state.activeSourceId) || state.sources[0] || null;
  }

  function syncSharedStore() {
    if (!shared) return;
    if (!shared.datasus) shared.datasus = {};

    const session = buildSession(state);
    if (session.confirmedSources.length) {
      shared.datasus.lastSession = clonePlain(session);
    } else if (!state.sources.length) {
      shared.datasus.lastSession = null;
    }
  }

  function notify() {
    syncSharedStore();
    onSessionChange(buildSession(state));
  }

  function render() {
    const source = activeSource();
    const session = buildSession(state);
    const suggestionHtml = session.suggestions.length
      ? `
        <div class="info-banner" style="margin-top:14px;">
          <strong>Orientação metodológica</strong>
          <ul class="datasus-inline-list">
            ${session.suggestions.map(item => `<li>${utils.escapeHtml(item)}</li>`).join('')}
          </ul>
        </div>
      `
      : '';

    root.innerHTML = `
      <div class="datasus-wizard">
        <div class="datasus-toolbar">
          <div>
            <h4>${utils.escapeHtml(title)}</h4>
            <p class="small-note">${utils.escapeHtml(description)}</p>
          </div>
          <div class="datasus-toolbar-actions">
            ${exampleSources.length ? '<button type="button" class="btn-secondary datasus-example-btn" data-action="load-example">Carregar exemplo</button>' : ''}
            <button type="button" class="btn-ghost" data-action="clear-all">Limpar fluxo</button>
          </div>
        </div>

        <div class="${formatToneClass(state.statusTone)}" style="margin-top:14px;">${utils.escapeHtml(state.statusMessage)}</div>

        ${state.sources.length ? `
          <div class="datasus-source-list" style="margin-top:14px;">
            ${state.sources.map(item => sourceCardHtml(item, state.activeSourceId, utils)).join('')}
          </div>
        ` : ''}

        ${source ? `
          <div class="datasus-step-grid">
            <section class="surface-card">
              <div class="tstudent-step-head">
                <span class="small-chip info">Passo 1</span>
                <h4>Confirmar a linha de cabeçalho</h4>
              </div>
              <div class="form-grid two" style="margin-top:14px;">
                <div>
                  <label for="datasus-header-select">Linha do cabeçalho real</label>
                  <select id="datasus-header-select">
                    ${headerSelectOptions(source, utils).map(option => `
                      <option value="${option.rowIndex}"${option.rowIndex === source.parsed.headerRowIndex ? ' selected' : ''}>
                        Linha ${option.rowIndex + 1} - ${utils.escapeHtml(option.preview)}
                      </option>
                    `).join('')}
                  </select>
                </div>
                <div>
                  <label>Diagnóstico automático</label>
                  <div class="small-note datasus-diagnosis-box">${utils.escapeHtml(source.parsed.diagnosis.summaryText)}</div>
                </div>
              </div>
              <div style="margin-top:14px;">
                ${utils.renderPreviewTable(['Linha', 'Conteúdo'], linePreview(source))}
              </div>
            </section>

            <section class="surface-card">
              <div class="tstudent-step-head">
                <span class="small-chip info">Passo 2</span>
                <h4>Confirmar o tipo da base</h4>
              </div>
              <div class="form-grid two" style="margin-top:14px;">
                <div>
                  <label for="datasus-format-select">Formato</label>
                  <select id="datasus-format-select">
                    <option value="wide"${source.mapping.formatType === 'wide' ? ' selected' : ''}>wide</option>
                    <option value="long"${source.mapping.formatType === 'long' ? ' selected' : ''}>long</option>
                    <option value="hybrid"${source.mapping.formatType === 'hybrid' ? ' selected' : ''}>Não tenho certeza / híbrida</option>
                  </select>
                </div>
                <div>
                  <label>Resumo rápido</label>
                  <div class="datasus-summary-metrics">
                    <span class="small-chip info">Colunas: ${source.parsed.headers.length}</span>
                    <span class="small-chip primary">Linhas de dados: ${source.parsed.bodyRows.length}</span>
                    <span class="small-chip ${source.parsed.diagnosis.hasTotalColumn ? 'warning' : 'info'}">Total: ${source.parsed.diagnosis.hasTotalColumn ? 'sim' : 'não'}</span>
                  </div>
                </div>
              </div>
            </section>

            <section class="surface-card">
              <div class="tstudent-step-head">
                <span class="small-chip info">Passo 3</span>
                <h4>Mapear os papéis das colunas</h4>
              </div>
              <p class="small-note datasus-step-note">Defina a dimensão principal, as colunas temporais, medidas, totais e o que deve ser ignorado.</p>
              ${mappingTableHtml(source, utils)}
            </section>

            <section class="surface-card">
              <div class="tstudent-step-head">
                <span class="small-chip info">Passo 4</span>
                <h4>Confirmar tipos de variável</h4>
              </div>
              <div class="datasus-type-summary">
                ${(source.mapping.columns || []).map(column => `
                  <div class="mini-card">
                    <h4>${utils.escapeHtml(column.header)}</h4>
                    <p>${utils.escapeHtml(mappingRoleLabel(column.role))} · ${utils.escapeHtml(typeLabel(column.variableType))}</p>
                  </div>
                `).join('')}
              </div>
            </section>

            <section class="surface-card">
              <div class="tstudent-step-head">
                <span class="small-chip info">Passo 5</span>
                <h4>Pré-visualizar a base normalizada</h4>
              </div>
              <div class="metrics-grid" style="margin-top:14px;">
                <div class="metric-card">
                  <div class="metric-label">Registros normalizados</div>
                  <div class="metric-value">${source.normalized.summary.recordCount}</div>
                  <div class="metric-mini">Válidos: ${source.normalized.summary.validRecordCount}</div>
                </div>
                <div class="metric-card">
                  <div class="metric-label">Categorias</div>
                  <div class="metric-value">${source.normalized.summary.categoryCount}</div>
                  <div class="metric-mini">${utils.escapeHtml(source.normalized.schema.categoryLabel || 'Categoria')}</div>
                </div>
                <div class="metric-card">
                  <div class="metric-label">Tempo</div>
                  <div class="metric-value">${source.normalized.summary.timeCount}</div>
                  <div class="metric-mini">${utils.escapeHtml(source.normalized.schema.timeLabel || 'Sem eixo temporal')}</div>
                </div>
                <div class="metric-card">
                  <div class="metric-label">Medidas</div>
                  <div class="metric-value">${source.normalized.schema.metricOptions.length}</div>
                  <div class="metric-mini">${utils.escapeHtml(source.normalized.schema.metricOptions.map(option => option.label).join(', ') || 'Nenhuma')}</div>
                </div>
              </div>
              ${source.normalized.errors.length ? `
                <div class="error-box" style="margin-top:14px;">
                  <strong>Normalização incompleta.</strong>
                  <ul class="datasus-inline-list">
                    ${source.normalized.errors.map(error => `<li>${utils.escapeHtml(error)}</li>`).join('')}
                  </ul>
                </div>
              ` : `
                <div class="success-box" style="margin-top:14px;">A base interna está pronta para ser usada pelos módulos estatísticos.</div>
              `}
              <div style="margin-top:14px;">
                ${normalizedPreviewHtml(source, utils)}
              </div>
              ${suggestionHtml}
            </section>

            <section class="surface-card">
              <div class="tstudent-step-head">
                <span class="small-chip info">Passo 6</span>
                <h4>Confirmar e enviar para a análise</h4>
              </div>
              <p class="small-note datasus-step-note">A confirmação trava esta versão da base como entrada confiável para o módulo atual e para outros módulos que usem a última sessão DATASUS.</p>
              <div class="actions-row" style="margin-top:14px;">
                <button type="button" class="btn" data-action="confirm-source"${source.normalized.ok ? '' : ' disabled'}>Confirmar base normalizada</button>
              </div>
              <div class="${source.confirmed ? 'success-box' : 'status-bar'}" style="margin-top:14px;">
                ${utils.escapeHtml(source.confirmed ? 'Base confirmada. Os testes já podem consumi-la.' : 'Base ainda não confirmada. Revise o mapeamento antes de prosseguir.')}
              </div>
            </section>
          </div>
        ` : `
          <div class="datasus-paste-zone paste-area" tabindex="0" style="margin-top:24px;">
            <span class="icon">✨</span>
            <h3>Cole a tabela do DATASUS aqui</h3>
            <p>Selecione as células no TabNet, pressione <strong>Ctrl + C</strong> e em seguida <strong>Ctrl + V</strong> aqui</p>
          </div>
        `}
      </div>
    `;

    root.querySelector('.datasus-paste-zone')?.addEventListener('paste', async event => {
      event.preventDefault();
      const rawText = (event.clipboardData || window.clipboardData).getData('text');
      if (!rawText.trim()) return;

      state.statusTone = 'status';
      state.statusMessage = 'Lendo tabela DATASUS colada...';
      render();
      try {
        await addTextSources([{ text: rawText, fileName: 'tabela-colada-datasus.tsv', sourceKind: 'paste' }], 'Tabela DATASUS lida com sucesso. Revise as colunas abaixo.');
      } catch (error) {
        state.statusTone = 'error';
        state.statusMessage = error?.message || 'Não foi possível interpretar os dados colados.';
        render();
        notify();
      }
    });

    root.querySelectorAll('[data-source-id]').forEach(button => {
      button.addEventListener('click', () => {
        state.activeSourceId = button.dataset.sourceId;
        render();
        notify();
      });
    });

    root.querySelector('[data-action="clear-all"]')?.addEventListener('click', () => {
      state.sources = [];
      state.activeSourceId = '';
      state.statusTone = 'status';
      state.statusMessage = 'Fluxo DATASUS limpo. Importe um novo arquivo para recomeçar.';
      render();
      notify();
    });

    root.querySelector('.datasus-example-btn')?.addEventListener('click', async () => {
      if (!exampleSources.length) return;
      await addTextSources(exampleSources, 'Exemplo DATASUS carregado para revisão guiada.');
    });

    if (!source) return;

    root.querySelector('#datasus-header-select')?.addEventListener('change', event => {
      reparseSource(source, utils, stats, Number(event.target.value));
      state.statusTone = 'status';
      state.statusMessage = `Cabecalho atualizado para a linha ${source.parsed.headerRowIndex + 1}.`;
      render();
      notify();
    });

    root.querySelector('#datasus-format-select')?.addEventListener('change', event => {
      source.mapping.formatType = event.target.value;
      source.confirmed = false;
      setSourceNormalized(source, utils, stats);
      state.statusTone = 'status';
      state.statusMessage = `Formato ajustado manualmente para ${source.mapping.formatType}.`;
      render();
      notify();
    });

    root.querySelectorAll('[data-action="column-role"]').forEach(select => {
      select.addEventListener('change', event => {
        const columnIndex = Number(event.target.dataset.columnIndex);
        const targetColumn = source.mapping.columns.find(column => column.index === columnIndex);
        if (!targetColumn) return;

        if (event.target.value === 'primary-category') {
          source.mapping.columns.forEach(column => {
            if (column.role === 'primary-category') column.role = 'category';
          });
        }

        targetColumn.role = event.target.value;
        targetColumn.variableType = roleToType(targetColumn.role);
        source.confirmed = false;
        setSourceNormalized(source, utils, stats);
        state.statusTone = 'status';
        state.statusMessage = `Papel da coluna ${targetColumn.header} atualizado.`;
        render();
        notify();
      });
    });

    root.querySelectorAll('[data-action="column-type"]').forEach(select => {
      select.addEventListener('change', event => {
        const columnIndex = Number(event.target.dataset.columnIndex);
        const targetColumn = source.mapping.columns.find(column => column.index === columnIndex);
        if (!targetColumn) return;
        targetColumn.variableType = event.target.value;
        source.confirmed = false;
        setSourceNormalized(source, utils, stats);
        state.statusTone = 'status';
        state.statusMessage = `Tipo da coluna ${targetColumn.header} atualizado.`;
        render();
        notify();
      });
    });

    root.querySelector('[data-action="confirm-source"]')?.addEventListener('click', () => {
      source.confirmed = true;
      state.statusTone = 'success';
      state.statusMessage = `${source.fileName} foi confirmado como base DATASUS normalizada.`;
      render();
      notify();
    });
  }

  async function addFiles(files) {
    const loaded = await Promise.all(files.map(async file => {
      try {
        const text = await utils.readFileText(file);
        return {
          ok: true,
          fileName: file.name,
          rawText: text,
          sourceKind: 'upload'
        };
      } catch {
        return {
          ok: false,
          fileName: file.name,
          error: 'Nao foi possivel ler o arquivo selecionado.'
        };
      }
    }));

    const failures = loaded.filter(item => !item.ok);
    const sources = [];

    loaded.filter(item => item.ok).forEach(item => {
      const source = {
        id: `datasus-source-${state.nextId + 1}`,
        fileName: item.fileName,
        rawText: item.rawText,
        sourceKind: item.sourceKind
      };

      try {
        state.nextId += 1;
        reparseSource(source, utils, stats);
        state.sources.push(source);
        sources.push(source);
      } catch (error) {
        console.error(`[datasus-wizard] Falha ao interpretar ${item.fileName}.`, error);
        failures.push({
          ok: false,
          fileName: item.fileName,
          error: error?.message || 'Nao foi possivel interpretar o arquivo DATASUS.'
        });
      }
    });

    if (sources.length) {
      state.activeSourceId = sources[0].id;
    }

    if (sources.length && failures.length) {
      state.statusTone = 'status';
      state.statusMessage = `${sources.length} arquivo(s) DATASUS carregado(s). Alguns itens precisaram de revisão: ${failures.map(item => `${item.fileName}: ${item.error}`).join(' | ')}`;
    } else if (sources.length) {
      state.statusTone = 'success';
      state.statusMessage = `${sources.length} arquivo(s) DATASUS carregado(s). Revise o mapeamento antes de confirmar.`;
    } else if (failures.length) {
      state.statusTone = 'error';
      state.statusMessage = failures.map(item => `${item.fileName}: ${item.error}`).join(' | ');
    }

    render();
    notify();
  }

  async function addTextSources(textSources, successMessage = 'Fonte DATASUS carregada.') {
    const failures = [];
    let loadedCount = 0;

    textSources.forEach(item => {
      const source = {
        id: `datasus-source-${state.nextId + 1}`,
        fileName: item.fileName || `fonte-datasus-${state.nextId + 1}.txt`,
        rawText: item.text || '',
        sourceKind: item.sourceKind || 'example'
      };

      try {
        state.nextId += 1;
        reparseSource(source, utils, stats);
        state.sources.push(source);
        loadedCount += 1;
        if (!state.activeSourceId) state.activeSourceId = source.id;
      } catch (error) {
        console.error(`[datasus-wizard] Falha ao preparar ${source.fileName}.`, error);
        failures.push(`${source.fileName}: ${error?.message || 'Nao foi possivel interpretar a fonte DATASUS.'}`);
      }
    });

    if (loadedCount && failures.length) {
      state.activeSourceId = state.activeSourceId || state.sources[0]?.id || '';
      state.statusTone = 'status';
      state.statusMessage = `${successMessage} Alguns itens precisaram de revisão: ${failures.join(' | ')}`;
    } else if (loadedCount) {
      state.activeSourceId = state.activeSourceId || state.sources[0]?.id || '';
      state.statusTone = 'success';
      state.statusMessage = successMessage;
    } else if (failures.length) {
      state.statusTone = 'error';
      state.statusMessage = failures.join(' | ');
    }

    render();
    notify();
  }

  render();
  notify();

  return {
    addTextSources,
    clear() {
      state.sources = [];
      state.activeSourceId = '';
      state.statusTone = 'status';
      state.statusMessage = 'Fluxo DATASUS limpo.';
      render();
      notify();
    },
    getSession() {
      return buildSession(state);
    },
    render
  };
}
