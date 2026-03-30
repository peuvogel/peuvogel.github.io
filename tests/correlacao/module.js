import { createDatasusWizard } from '../../assets/js/datasus-wizard.js';
import {
  deriveCorrelationPairs,
  getMetricOptions,
  getPrimaryMetricKey,
  getTimeOptions
} from '../../assets/js/datasus-normalizer.js';
import {
  buildRecognizedColumnsChips,
  describeIgnoredRowReason,
  normalizeTabularSpaces,
  parseTabularNumber,
  readTabularFileState,
  readTabularPasteState
} from '../../assets/js/tabular-data-input.js';
import { DataParser } from '../../assets/js/DataParser.js';
import { createCorrelationWizard } from '../../assets/js/CorrelationWizard.js';
import {
  buildChartContainer,
  renderScatterChart,
  renderRankScatterChart
} from '../../assets/js/chart-manager.js';

const CORRELATION_EMPTY_TEMPLATE_URL = new URL('./templates/modelo-correlacao-vazio.csv', import.meta.url).href;
const CORRELATION_FILLED_TEMPLATE_URL = new URL('./templates/modelo-correlacao-exemplo.csv', import.meta.url).href;
const CORRELATION_FORMAT_LABEL = 'id;variavel_x;variavel_y;observacao_opcional';
const CORRELATION_HEADER_ALIASES = {
  id: ['id', 'unidade', 'uf', 'nome', 'rotulo', 'rotulo', 'identificador'],
  variavel_x: ['variavel_x', 'variavel x', 'x', 'grupo_x'],
  variavel_y: ['variavel_y', 'variavel y', 'y', 'grupo_y'],
  observacao_opcional: ['observacao', 'observacao opcional', 'obs', 'comentario', 'comentario opcional']
};
const CORRELATION_RECOGNIZED_ORDER = [
  { key: 'id', label: 'id' },
  { key: 'variavel_x', label: 'variavel_x' },
  { key: 'variavel_y', label: 'variavel_y' },
  { key: 'observacao_opcional', label: 'observacao_opcional' }
];
const CORRELATION_POSITION_FALLBACK = {
  keysByIndex: ['id', 'variavel_x', 'variavel_y', 'observacao_opcional'],
  minColumns: 3,
  requiredKeys: ['variavel_x', 'variavel_y'],
  introText: 'Nao reconhecemos os nomes padrao das colunas, entao usamos a estrutura por posicao da planilha.',
  assumptionText: 'Assumimos: 1a coluna = identificacao, 2a = variavel x, 3a = variavel y.',
  headerText: 'Os nomes do cabecalho foram aproveitados automaticamente na interface.'
};
const CORRELATION_TABULAR_OPTIONS = {
  aliases: CORRELATION_HEADER_ALIASES,
  requiredKeys: ['variavel_x', 'variavel_y'],
  numericKeys: ['variavel_x', 'variavel_y'],
  expectedFormatLabel: CORRELATION_FORMAT_LABEL,
  positionFallback: CORRELATION_POSITION_FALLBACK
};
const CORRELATION_EXAMPLE_ROWS = [
  ['UF1', '12,3', '45,2', ''],
  ['UF2', '14,1', '43,8', ''],
  ['UF3', '10,9', '48,0', ''],
  ['UF4', '15,2', '42,7', '']
];
const CORRELATION_EXAMPLE_TEXT = [
  CORRELATION_FORMAT_LABEL,
  ...CORRELATION_EXAMPLE_ROWS.map(row => row.join(';'))
].join('\n');
const CORRELATION_BOUND_EVENTS = Symbol('correlation-bound-events');

function clonePlain(value) {
  return value ? JSON.parse(JSON.stringify(value)) : value;
}

function quantile(sorted, q) {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  return sorted[base + 1] !== undefined ? sorted[base] + (rest * (sorted[base + 1] - sorted[base])) : sorted[base];
}

function outlierMask(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const q1 = quantile(sorted, 0.25);
  const q3 = quantile(sorted, 0.75);
  const iqr = q3 - q1;
  const low = q1 - (1.5 * iqr);
  const high = q3 + (1.5 * iqr);
  return values.map(value => value < low || value > high);
}

function classifyStrength(coef) {
  const abs = Math.abs(coef);
  if (abs < 0.1) return 'muito fraca';
  if (abs < 0.3) return 'fraca';
  if (abs < 0.5) return 'moderada';
  if (abs < 0.7) return 'forte';
  return 'muito forte';
}

function classifyDirection(coef) {
  if (Math.abs(coef) < 0.1) return 'ausente ou muito pequena';
  if (coef > 0) return 'positiva';
  return 'negativa';
}

function buildScatterSvg(dataset, pearson, outlierFlags, utils) {
  const width = 880;
  const height = 460;
  const margin = { top: 24, right: 24, bottom: 68, left: 82 };
  const minX = Math.min(...dataset.x);
  const maxX = Math.max(...dataset.x);
  const minY = Math.min(...dataset.y);
  const maxY = Math.max(...dataset.y);
  const xPad = (maxX - minX || 1) * 0.08;
  const yPad = (maxY - minY || 1) * 0.1;
  const px = value => margin.left + ((value - (minX - xPad)) / (((maxX - minX) + (xPad * 2)) || 1)) * (width - margin.left - margin.right);
  const py = value => height - margin.bottom - ((value - (minY - yPad)) / (((maxY - minY) + (yPad * 2)) || 1)) * (height - margin.top - margin.bottom);

  const x1 = minX - xPad;
  const x2 = maxX + xPad;
  const y1 = pearson.intercept + (pearson.slope * x1);
  const y2 = pearson.intercept + (pearson.slope * x2);
  const equationSign = pearson.slope >= 0 ? '+' : '-';
  const equationText = `${dataset.headers[1]} = ${utils.fmtNumber(pearson.intercept, 2)} ${equationSign} ${utils.fmtNumber(Math.abs(pearson.slope), 2)} x ${dataset.headers[0]}`;
  const shouldLabelPoints = dataset.labels.length <= 16;

  const points = dataset.x.map((xValue, index) => {
    const yValue = dataset.y[index];
    const isOutlier = outlierFlags[index];
    const fill = isOutlier ? '#f97316' : '#2563eb';
    const label = shouldLabelPoints
      ? `<text x="${(px(xValue) + 8).toFixed(2)}" y="${(py(yValue) - 8).toFixed(2)}" font-size="10" fill="#5b6b84">${utils.escapeHtml(dataset.labels[index]).slice(0, 18)}</text>`
      : '';
    return `<g><circle cx="${px(xValue).toFixed(2)}" cy="${py(yValue).toFixed(2)}" r="5.6" fill="${fill}" stroke="#fff" stroke-width="1.8"><title>${utils.escapeHtml(dataset.labels[index])} | ${utils.escapeHtml(dataset.headers[0])}: ${utils.fmtNumber(xValue, 2)} | ${utils.escapeHtml(dataset.headers[1])}: ${utils.fmtNumber(yValue, 2)}</title></circle>${label}</g>`;
  }).join('');

  return `
    <svg viewBox="0 0 ${width} ${height}" class="scatter-svg" role="img" aria-label="Dispersao com reta de tendencia">
      <rect x="0" y="0" width="${width}" height="${height}" rx="20" fill="#fff"/>
      <line x1="${margin.left}" y1="${height - margin.bottom}" x2="${width - margin.right}" y2="${height - margin.bottom}" stroke="#9cb0ca"/>
      <line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${height - margin.bottom}" stroke="#9cb0ca"/>
      <line x1="${px(x1).toFixed(2)}" y1="${py(y1).toFixed(2)}" x2="${px(x2).toFixed(2)}" y2="${py(y2).toFixed(2)}" stroke="#0f766e" stroke-width="2.8"/>
      <rect x="${width - 286}" y="26" width="242" height="64" rx="16" fill="rgba(15,118,110,0.08)" stroke="rgba(15,118,110,0.18)"/>
      <text x="${width - 270}" y="50" fill="#17433e" font-size="12" font-weight="700">Reta linear (Pearson)</text>
      <text x="${width - 270}" y="68" fill="#33556f" font-size="11">${utils.escapeHtml(equationText)}</text>
      <text x="${width - 270}" y="84" fill="#33556f" font-size="11">R² = ${utils.fmtNumber(pearson.r2, 3)}</text>
      ${points}
      <text x="${width / 2}" y="${height - 16}" text-anchor="middle" fill="#2c3f57" font-size="13" font-weight="700">${utils.escapeHtml(dataset.headers[0])}</text>
      <text x="22" y="${height / 2}" text-anchor="middle" fill="#2c3f57" font-size="13" font-weight="700" transform="rotate(-90, 22, ${height / 2})">${utils.escapeHtml(dataset.headers[1])}</text>
    </svg>
  `;
}

function countTieGroups(values) {
  const counts = new Map();
  values.forEach(value => {
    counts.set(value, (counts.get(value) || 0) + 1);
  });

  const repeated = [...counts.values()].filter(count => count > 1);
  return {
    groups: repeated.length,
    items: repeated.reduce((sum, count) => sum + count, 0)
  };
}

function buildRankSummary(dataset, stats) {
  return {
    xRanks: stats.rank(dataset.x),
    yRanks: stats.rank(dataset.y),
    xTies: countTieGroups(dataset.x),
    yTies: countTieGroups(dataset.y)
  };
}

function buildRankScatterSvg(dataset, rankSummary, utils) {
  const width = 880;
  const height = 460;
  const margin = { top: 24, right: 24, bottom: 68, left: 82 };
  const xRanks = rankSummary.xRanks;
  const yRanks = rankSummary.yRanks;
  const maxRank = Math.max(...xRanks, ...yRanks, 1);
  const minRank = Math.min(...xRanks, ...yRanks, 1);
  const pad = 0.6;
  const px = value => margin.left + ((value - (minRank - pad)) / (((maxRank - minRank) + (pad * 2)) || 1)) * (width - margin.left - margin.right);
  const py = value => height - margin.bottom - ((value - (minRank - pad)) / (((maxRank - minRank) + (pad * 2)) || 1)) * (height - margin.top - margin.bottom);
  const shouldLabelPoints = dataset.labels.length <= 14;

  const points = dataset.labels.map((label, index) => {
    const xRank = xRanks[index];
    const yRank = yRanks[index];
    const labelSvg = shouldLabelPoints
      ? `<text x="${(px(xRank) + 8).toFixed(2)}" y="${(py(yRank) - 8).toFixed(2)}" font-size="10" fill="#5b6b84">${utils.escapeHtml(label).slice(0, 18)}</text>`
      : '';
    return `<g><circle cx="${px(xRank).toFixed(2)}" cy="${py(yRank).toFixed(2)}" r="5.6" fill="#0f766e" stroke="#fff" stroke-width="1.8"><title>${utils.escapeHtml(label)} | posto X: ${utils.fmtNumber(xRank, 1)} | posto Y: ${utils.fmtNumber(yRank, 1)}</title></circle>${labelSvg}</g>`;
  }).join('');

  return `
    <svg viewBox="0 0 ${width} ${height}" class="scatter-svg" role="img" aria-label="Postos de X versus postos de Y">
      <rect x="0" y="0" width="${width}" height="${height}" rx="20" fill="#fff"/>
      <line x1="${margin.left}" y1="${height - margin.bottom}" x2="${width - margin.right}" y2="${height - margin.bottom}" stroke="#9cb0ca"/>
      <line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${height - margin.bottom}" stroke="#9cb0ca"/>
      <line x1="${px(minRank).toFixed(2)}" y1="${py(minRank).toFixed(2)}" x2="${px(maxRank).toFixed(2)}" y2="${py(maxRank).toFixed(2)}" stroke="#0f766e" stroke-width="2.4" stroke-dasharray="8 6"/>
      <rect x="${width - 286}" y="26" width="242" height="70" rx="16" fill="rgba(15,118,110,0.08)" stroke="rgba(15,118,110,0.18)"/>
      <text x="${width - 270}" y="50" fill="#17433e" font-size="12" font-weight="700">Spearman por postos</text>
      <text x="${width - 270}" y="68" fill="#33556f" font-size="11">Empates em X: ${rankSummary.xTies.groups}</text>
      <text x="${width - 270}" y="84" fill="#33556f" font-size="11">Empates em Y: ${rankSummary.yTies.groups}</text>
      ${points}
      <text x="${width / 2}" y="${height - 16}" text-anchor="middle" fill="#2c3f57" font-size="13" font-weight="700">Postos de ${utils.escapeHtml(dataset.headers[0])}</text>
      <text x="22" y="${height / 2}" text-anchor="middle" fill="#2c3f57" font-size="13" font-weight="700" transform="rotate(-90, 22, ${height / 2})">Postos de ${utils.escapeHtml(dataset.headers[1])}</text>
    </svg>
  `;
}

function buildRankComparisonTable(dataset, rankSummary, utils) {
  const rows = dataset.labels.map((label, index) => ({
    label,
    x: dataset.x[index],
    y: dataset.y[index],
    xRank: rankSummary.xRanks[index],
    yRank: rankSummary.yRanks[index]
  }))
    .sort((left, right) => left.xRank - right.xRank || left.yRank - right.yRank);

  return `
    <div class="preview-table-wrap">
      <table class="preview-table correlation-preview-table">
        <thead>
          <tr>
            <th>ID</th>
            <th>${utils.escapeHtml(dataset.headers[0])}</th>
            <th>Posto de ${utils.escapeHtml(dataset.headers[0])}</th>
            <th>${utils.escapeHtml(dataset.headers[1])}</th>
            <th>Posto de ${utils.escapeHtml(dataset.headers[1])}</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(row => `
            <tr>
              <td>${utils.escapeHtml(row.label)}</td>
              <td>${utils.fmtNumber(row.x, 2)}</td>
              <td>${utils.fmtNumber(row.xRank, 1)}</td>
              <td>${utils.fmtNumber(row.y, 2)}</td>
              <td>${utils.fmtNumber(row.yRank, 1)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function compareMessage(pearson, spearman) {
  const gap = Math.abs(Math.abs(pearson.coef) - Math.abs(spearman.coef));
  const pearsonDir = Math.sign(pearson.coef || 0);
  const spearmanDir = Math.sign(spearman.coef || 0);
  if (pearsonDir && spearmanDir && pearsonDir !== spearmanDir) {
    return 'Pearson e Spearman apontaram direcoes diferentes, sinal de estrutura instavel ou alta sensibilidade a pontos extremos.';
  }
  if ((Math.abs(spearman.coef) - Math.abs(pearson.coef)) > 0.18) {
    return 'Spearman ficou substancialmente maior que Pearson, sugerindo relacao monotona com curvatura ou compressao nos extremos.';
  }
  if ((Math.abs(pearson.coef) - Math.abs(spearman.coef)) > 0.18) {
    return 'Pearson ficou acima de Spearman, indicando que a reta linear parece forte, mas a ordenacao relativa nao foi tao estavel quanto a inclinacao sugere.';
  }
  if (gap > 0.12) {
    return 'Pearson e Spearman diferiram moderadamente; vale revisar linearidade, residuos e possiveis outliers antes de interpretar.';
  }
  return 'Pearson e Spearman foram semelhantes, sugerindo que a associacao monotona esta proxima de uma leitura linear.';
}

function correlationMetricCard(label, value, note, extraClass = '') {
  return `<div class="metric-card ${extraClass}"><div class="metric-label">${label}</div><div class="metric-value">${value}</div><div class="metric-mini">${note}</div></div>`;
}

function methodLabel(method) {
  return method === 'spearman' ? 'Spearman' : 'Pearson';
}

function buildMethodInterpretation(dataset, pearson, spearman, outlierLabels, activeMethod, rankSummary, utils) {
  const xName = dataset.headers[0];
  const yName = dataset.headers[1];
  const gap = Math.abs(Math.abs(pearson.coef) - Math.abs(spearman.coef));

  if (activeMethod === 'spearman') {
    const direction = classifyDirection(spearman.coef);
    const strength = classifyStrength(spearman.coef);
    const tieParts = [];
    if (rankSummary.xTies.groups) tieParts.push(`${rankSummary.xTies.groups} empate(s) em ${xName}`);
    if (rankSummary.yTies.groups) tieParts.push(`${rankSummary.yTies.groups} empate(s) em ${yName}`);
    let text = `O metodo de Spearman mede associacao monotona com base nos postos de ${xName} e ${yName}. `;
    text += spearman.p < 0.05
      ? `Observou-se evidencia estatistica de associacao monotona (${utils.fmtSigned(spearman.coef, 3)}; p ${spearman.p < 0.001 ? '< 0,001' : '= ' + utils.fmtP(spearman.p)}). `
      : `Nao houve evidencia estatistica robusta de associacao monotona (${utils.fmtSigned(spearman.coef, 3)}; p ${utils.fmtP(spearman.p)}). `;
    text += `A direcao foi ${direction} e a forca foi classificada como ${strength}, olhando a ordenacao relativa dos valores em vez da reta linear. `;
    text += tieParts.length
      ? `Empates foram tratados por postos medios na implementacao atual (${tieParts.join(' e ')}). `
      : 'Nao houve empates nas observacoes, entao cada posto ficou unico. ';
    if (gap > 0.15) {
      text += `Como Pearson (${utils.fmtSigned(pearson.coef, 3)}) e Spearman (${utils.fmtSigned(spearman.coef, 3)}) divergiram de forma relevante, vale suspeitar de nao linearidade ou sensibilidade de Pearson a pontos extremos.`;
    } else {
      text += `O coeficiente linear de Pearson (${utils.fmtSigned(pearson.coef, 3)}) ficou proximo, reforcando uma leitura consistente entre linearidade e monotonicidade.`;
    }
    return text;
  }

  const direction = classifyDirection(pearson.coef);
  const strength = classifyStrength(pearson.coef);
  let text = `O metodo de Pearson mede associacao linear entre ${xName} e ${yName} usando os valores numericos brutos. `;
  text += pearson.p < 0.05
    ? `Observou-se evidencia estatistica de relacao linear (${utils.fmtSigned(pearson.coef, 3)}; p ${pearson.p < 0.001 ? '< 0,001' : '= ' + utils.fmtP(pearson.p)}). `
    : `Nao houve evidencia estatistica robusta de relacao linear (${utils.fmtSigned(pearson.coef, 3)}; p ${utils.fmtP(pearson.p)}). `;
  text += `A direcao foi ${direction} e a forca foi classificada como ${strength}, com foco na aproximacao por reta. `;
  text += `A inclinacao linear estimada foi ${utils.fmtSigned(pearson.slope, 3)} em ${yName} para cada 1 unidade em ${xName}. `;
  if (outlierLabels.length) {
    text += `Foram detectados possiveis pontos extremos (${outlierLabels.slice(0, 4).join(', ')}${outlierLabels.length > 4 ? ', ...' : ''}), lembrando que Pearson tende a ser mais sensivel a outliers. `;
  }
  if (gap > 0.15) {
    text += `Como Spearman (${utils.fmtSigned(spearman.coef, 3)}) se afastou de Pearson, a associacao pode ser monotona sem seguir bem uma reta linear.`;
  } else {
    text += `Spearman (${utils.fmtSigned(spearman.coef, 3)}) permaneceu proximo, o que sugere consistencia entre leitura linear e monotona.`;
  }
  return text;
}

function buildEmptyCorrelationDataset(sourceKind = 'paste', sourceLabel = 'Dados colados') {
  return {
    sourceKind,
    sourceLabel,
    hasContent: false,
    rows: [],
    validRows: [],
    ignoredRows: [],
    x: [],
    y: [],
    labels: [],
    headers: ['variavel_x', 'variavel_y'],
    previewHeaders: {
      id: 'id',
      x: 'variavel_x',
      y: 'variavel_y'
    },
    recognizedColumns: {},
    errors: [],
    warnings: [],
    infos: [],
    fileMeta: null
  };
}

function buildCorrelationDatasetFromTabularState(fileState, stats, sourceMeta = {}) {
  const {
    sourceKind = fileState?.sourceType || 'paste',
    sourceLabel = sourceKind === 'file' ? 'Arquivo importado' : 'Dados colados'
  } = sourceMeta;

  if (!fileState || fileState.status !== 'loaded') {
    const dataset = buildEmptyCorrelationDataset(sourceKind, sourceLabel);
    if (fileState?.message) dataset.errors.push(fileState.message);
    if (Array.isArray(fileState?.details)) dataset.infos.push(...fileState.details);
    dataset.hasContent = Boolean(fileState?.message);
    return dataset;
  }

  const recognizedColumns = fileState.recognizedColumns || {};
  const previewHeaders = {
    id: recognizedColumns.id?.header || 'id',
    x: recognizedColumns.variavel_x?.header || 'variavel_x',
    y: recognizedColumns.variavel_y?.header || 'variavel_y'
  };
  const mappedRows = fileState.bodyRows.map((row, index) => ({
    index: index + 1,
    idRaw: recognizedColumns.id ? row[recognizedColumns.id.index] || '' : '',
    xRaw: row[recognizedColumns.variavel_x.index] || '',
    yRaw: row[recognizedColumns.variavel_y.index] || '',
    observationRaw: recognizedColumns.observacao_opcional ? row[recognizedColumns.observacao_opcional.index] || '' : ''
  }));

  const hasContent = mappedRows.some(row => (
    normalizeTabularSpaces(row.idRaw)
    || normalizeTabularSpaces(row.xRaw)
    || normalizeTabularSpaces(row.yRaw)
    || normalizeTabularSpaces(row.observationRaw)
  ));

  if (!hasContent) {
    return {
      ...buildEmptyCorrelationDataset(sourceKind, sourceLabel),
      recognizedColumns,
      previewHeaders,
      fileMeta: {
        fileName: fileState.fileName,
        tableName: fileState.tableName,
        delimiter: fileState.delimiter
      }
    };
  }

  const datasetRows = [];
  const validRows = [];
  const x = [];
  const y = [];
  const labels = [];
  let ignoredByTextOrEmpty = false;

  mappedRows.forEach(row => {
    const idRaw = normalizeTabularSpaces(row.idRaw);
    const xRaw = normalizeTabularSpaces(row.xRaw);
    const yRaw = normalizeTabularSpaces(row.yRaw);
    const xValue = parseTabularNumber(xRaw, stats);
    const yValue = parseTabularNumber(yRaw, stats);
    const rowLabel = idRaw || `Linha ${row.index}`;
    const notes = [];
    let statusLabel = 'Ignorada';
    let statusTone = 'ignored';

    if (xValue !== null && yValue !== null) {
      statusLabel = 'Valida';
      statusTone = 'valid';
      x.push(xValue);
      y.push(yValue);
      labels.push(rowLabel);
      validRows.push({ index: row.index, label: rowLabel, xValue, yValue });
    } else {
      if (xRaw && xValue === null) notes.push('variavel_x nao contem valor numerico valido.');
      if (yRaw && yValue === null) notes.push('variavel_y nao contem valor numerico valido.');
      if (!xRaw && !yRaw) notes.push('Linha vazia nas colunas numericas.');
      if (!notes.length) notes.push('Linha sem dois valores numericos utilizaveis.');
      ignoredByTextOrEmpty = true;
    }

    datasetRows.push({
      index: row.index,
      idLabel: rowLabel,
      xRaw,
      yRaw,
      xValue,
      yValue,
      statusLabel,
      statusTone,
      notes
    });
  });

  const warnings = [];
  if (ignoredByTextOrEmpty && datasetRows.some(row => row.statusTone === 'ignored')) {
    warnings.push('Foram encontrados textos ou celulas vazias em linhas ignoradas.');
  }
  datasetRows
    .filter(row => row.statusTone === 'ignored' && row.notes.length)
    .slice(0, 3)
    .forEach(row => warnings.push(describeIgnoredRowReason(row.index, row.notes)));
  const remainingIgnored = datasetRows.filter(row => row.statusTone === 'ignored').length - 3;
  if (remainingIgnored > 0) {
    warnings.push(`Outras ${remainingIgnored} linhas tambem foram ignoradas por falta de valores numericos validos em X e Y.`);
  }

  const infos = [];
  if (fileState.delimiter === ';') infos.push(`${sourceKind === 'file' ? 'Arquivo' : 'Conteudo colado'} lido no padrao ponto e virgula (;).`);
  else if (fileState.delimiter === '\t') infos.push('Conteudo tabulado do Excel interpretado automaticamente.');
  if (fileState.decimalCommaDetected) infos.push('Numeros com virgula decimal foram convertidos automaticamente.');
  if (fileState.usedPositionalFallback) infos.push(...fileState.recognitionDetails);
  infos.push('ID e apenas rotulo; variavel_x e variavel_y entram no calculo.');
  if (!recognizedColumns.id) infos.push('Coluna de ID nao reconhecida; a previa usa a ordem das linhas como referencia.');
  if (fileState.duplicates.length) warnings.push(`Cabecalhos duplicados foram ignorados: ${fileState.duplicates.join(', ')}.`);

  return {
    sourceKind,
    sourceLabel,
    hasContent: true,
    rows: datasetRows,
    validRows,
    ignoredRows: datasetRows.filter(row => row.statusTone === 'ignored'),
    x,
    y,
    labels,
    headers: [
      previewHeaders.x,
      previewHeaders.y
    ],
    previewHeaders,
    recognizedColumns,
    errors: [],
    warnings,
    infos,
    fileMeta: {
      fileName: fileState.fileName,
      tableName: fileState.tableName,
      formatLabel: fileState.formatLabel,
      delimiter: fileState.delimiter,
      headerRowIndex: fileState.headerRowIndex
    }
  };
}

function buildFeedbackBox(messages, toneClass, utils, title = '') {
  if (!messages?.length) return '';
  if (messages.length === 1) {
    return `<div class="${toneClass}">${title ? `<strong>${utils.escapeHtml(title)}</strong> ` : ''}${utils.escapeHtml(messages[0])}</div>`;
  }

  return `
    <div class="${toneClass}">
      ${title ? `<strong>${utils.escapeHtml(title)}</strong>` : ''}
      <ul class="datasus-inline-list">
        ${messages.map(message => `<li>${utils.escapeHtml(message)}</li>`).join('')}
      </ul>
    </div>
  `;
}

function buildCorrelationPreviewTable(dataset, utils) {
  const rows = dataset.rows;
  const formatConverted = value => (
    value === null || value === undefined
      ? '-'
      : utils.fmtNumber(value, Math.abs(value) >= 100 ? 1 : 3)
  );
  const idHeader = dataset.previewHeaders?.id || 'id';
  const xHeader = dataset.previewHeaders?.x || 'variavel_x';
  const yHeader = dataset.previewHeaders?.y || 'variavel_y';

  return `
    <div class="preview-table-wrap">
      <table class="preview-table correlation-preview-table">
        <thead>
          <tr>
            <th>${utils.escapeHtml(idHeader)}</th>
            <th>${utils.escapeHtml(xHeader)} bruto</th>
            <th>${utils.escapeHtml(yHeader)} bruto</th>
            <th>${utils.escapeHtml(xHeader)} convertido</th>
            <th>${utils.escapeHtml(yHeader)} convertido</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${rows.length ? rows.map(row => `
            <tr class="${row.statusTone === 'ignored' ? 'correlation-preview-row-ignored' : 'correlation-preview-row-valid'}">
              <td>${utils.escapeHtml(row.idLabel)}</td>
              <td>${utils.escapeHtml(row.xRaw || '-')}</td>
              <td>${utils.escapeHtml(row.yRaw || '-')}</td>
              <td>${formatConverted(row.xValue)}</td>
              <td>${formatConverted(row.yValue)}</td>
              <td>
                <div class="correlation-preview-status">
                  <strong>${utils.escapeHtml(row.statusLabel)}</strong>
                  ${row.notes.length ? `<small>${utils.escapeHtml(row.notes.join(' '))}</small>` : ''}
                </div>
              </td>
            </tr>
          `).join('') : '<tr><td colspan="6">Nenhum dado interpretado ainda.</td></tr>'}
        </tbody>
      </table>
    </div>
  `;
}

function buildCorrelationFormatPreview(utils) {
  const rows = CORRELATION_EXAMPLE_ROWS.map(row => row.map(value => utils.escapeHtml(value || '')));
  return `
    <div class="tabular-format-box">
      <div class="small-note">Formato recomendado: <strong>${utils.escapeHtml(CORRELATION_FORMAT_LABEL)}</strong></div>
      <div class="preview-table-wrap" style="margin-top:12px;">
        <table class="preview-table">
          <thead>
            <tr>
              <th>id</th>
              <th>variavel_x</th>
              <th>variavel_y</th>
              <th>observacao_opcional</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(row => `<tr>${row.map(value => `<td>${value || '-'}</td>`).join('')}</tr>`).join('')}
          </tbody>
        </table>
      </div>
      <div class="small-note" style="margin-top:12px;">Cada linha e uma observacao. ID e apenas rotulo; variavel_x e variavel_y entram no calculo.</div>
    </div>
  `;
}

function buildInfluenceTable(dataset, pearson, outlierFlags, utils) {
  const ranked = dataset.labels.map((label, index) => {
    const fitted = pearson.intercept + (pearson.slope * dataset.x[index]);
    const residual = dataset.y[index] - fitted;
    return {
      label,
      x: dataset.x[index],
      y: dataset.y[index],
      fitted,
      residual,
      outlier: outlierFlags[index]
    };
  })
    .sort((left, right) => Math.abs(right.residual) - Math.abs(left.residual));

  return `
    <div class="preview-table-wrap">
      <table class="preview-table correlation-preview-table">
        <thead>
          <tr>
            <th>ID</th>
            <th>X</th>
            <th>Y</th>
            <th>Y ajustado</th>
            <th>Residuo</th>
            <th>Leitura</th>
          </tr>
        </thead>
        <tbody>
          ${ranked.map(row => `
            <tr class="${row.outlier ? 'correlation-preview-row-ignored' : 'correlation-preview-row-valid'}">
              <td>${utils.escapeHtml(row.label)}</td>
              <td>${utils.fmtNumber(row.x, 2)}</td>
              <td>${utils.fmtNumber(row.y, 2)}</td>
              <td>${utils.fmtNumber(row.fitted, 2)}</td>
              <td>${utils.fmtSigned(row.residual, 2)}</td>
              <td>${row.outlier ? 'Possivel outlier ou ponto influente' : 'Dentro do padrao geral da reta'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function formatPValue(p, utils) {
  if (!Number.isFinite(p)) return 'n/d';
  return p < 0.001 ? '< 0,001' : utils.fmtP(p);
}

function formatCi(ci, utils, digits = 3) {
  if (!Array.isArray(ci) || ci.length < 2 || !ci.every(Number.isFinite)) return 'IC95% indisponivel';
  return `${utils.fmtNumber(ci[0], digits)} a ${utils.fmtNumber(ci[1], digits)}`;
}

function buildTickValues(min, max, count = 5) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0];
  if (min === max) return [min - 1, min, min + 1];
  const step = (max - min) / (count - 1);
  return Array.from({ length: count }, (_, index) => min + (step * index));
}

function solveLinearSystem(matrix, vector) {
  const n = vector.length;
  const augmented = matrix.map((row, rowIndex) => [...row, vector[rowIndex]]);

  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) {
      if (Math.abs(augmented[row][col]) > Math.abs(augmented[pivot][col])) pivot = row;
    }

    if (Math.abs(augmented[pivot][col]) < 1e-12) return null;
    if (pivot !== col) {
      [augmented[col], augmented[pivot]] = [augmented[pivot], augmented[col]];
    }

    const divisor = augmented[col][col];
    for (let cursor = col; cursor <= n; cursor += 1) {
      augmented[col][cursor] /= divisor;
    }

    for (let row = 0; row < n; row += 1) {
      if (row === col) continue;
      const factor = augmented[row][col];
      for (let cursor = col; cursor <= n; cursor += 1) {
        augmented[row][cursor] -= factor * augmented[col][cursor];
      }
    }
  }

  return augmented.map(row => row[n]);
}

function fitQuadraticTrend(x, y) {
  if (x.length < 5) return null;
  const sums = {
    s0: x.length,
    s1: 0,
    s2: 0,
    s3: 0,
    s4: 0,
    sy: 0,
    sxy: 0,
    sx2y: 0
  };

  for (let index = 0; index < x.length; index += 1) {
    const x1 = x[index];
    const x2 = x1 * x1;
    sums.s1 += x1;
    sums.s2 += x2;
    sums.s3 += x2 * x1;
    sums.s4 += x2 * x2;
    sums.sy += y[index];
    sums.sxy += x1 * y[index];
    sums.sx2y += x2 * y[index];
  }

  const coefficients = solveLinearSystem(
    [
      [sums.s0, sums.s1, sums.s2],
      [sums.s1, sums.s2, sums.s3],
      [sums.s2, sums.s3, sums.s4]
    ],
    [sums.sy, sums.sxy, sums.sx2y]
  );
  if (!coefficients) return null;

  const [intercept, linear, quadratic] = coefficients;
  const meanY = y.reduce((sum, value) => sum + value, 0) / y.length;
  let ssTot = 0;
  let ssRes = 0;
  const fitted = [];

  for (let index = 0; index < x.length; index += 1) {
    const estimate = intercept + (linear * x[index]) + (quadratic * x[index] * x[index]);
    fitted.push(estimate);
    ssTot += (y[index] - meanY) ** 2;
    ssRes += (y[index] - estimate) ** 2;
  }

  const r2 = ssTot > 0 ? clamp(1 - (ssRes / ssTot), 0, 1) : NaN;
  if (!Number.isFinite(r2)) return null;

  return {
    intercept,
    linear,
    quadratic,
    fitted,
    r2
  };
}

function buildPearsonDiagnostics(dataset, pearson, spearman, outlierFlags) {
  const points = dataset.labels.map((label, index) => {
    const fitted = pearson.intercept + (pearson.slope * dataset.x[index]);
    const residual = dataset.y[index] - fitted;
    return {
      index,
      label,
      x: dataset.x[index],
      y: dataset.y[index],
      fitted,
      residual,
      absResidual: Math.abs(residual),
      outlier: outlierFlags[index]
    };
  });

  const rankedResiduals = [...points].sort((left, right) => right.absResidual - left.absResidual);
  const highlighted = rankedResiduals.slice(0, 6);
  const highlightSet = new Set(highlighted.slice(0, 4).map(point => point.index));
  const mae = points.reduce((sum, point) => sum + point.absResidual, 0) / points.length;
  const rmse = Math.sqrt(points.reduce((sum, point) => sum + (point.residual ** 2), 0) / points.length);
  const yRange = Math.max(...dataset.y) - Math.min(...dataset.y) || 1;
  const normalizedMae = mae / yRange;
  const normalizedRmse = rmse / yRange;
  const quadratic = fitQuadraticTrend(dataset.x, dataset.y);
  const curvatureGain = quadratic ? quadratic.r2 - pearson.r2 : 0;
  const gap = Math.abs(Math.abs(spearman.coef) - Math.abs(pearson.coef));
  let adequacyTone = 'good';
  let adequacyLabel = 'Reta linear resume bem a nuvem de pontos';

  if (curvatureGain > 0.12 || gap > 0.2) {
    adequacyTone = 'warning';
    adequacyLabel = 'Sinal importante de curvatura ou inadequacao linear';
  } else if (curvatureGain > 0.06 || normalizedRmse > 0.18 || gap > 0.12 || highlighted.some(point => point.outlier)) {
    adequacyTone = 'caution';
    adequacyLabel = 'Reta util, mas com ressalvas de linearidade';
  }

  const influenceCount = highlighted.filter(point => point.outlier || point.absResidual > (mae * 1.75)).length;
  return {
    points,
    highlighted,
    highlightSet,
    mae,
    rmse,
    normalizedMae,
    normalizedRmse,
    quadratic,
    curvatureGain,
    adequacyTone,
    adequacyLabel,
    influenceCount
  };
}

function buildSpearmanDiagnostics(dataset, pearson, spearman, rankSummary) {
  const rankedRows = dataset.labels.map((label, index) => ({
    index,
    label,
    x: dataset.x[index],
    y: dataset.y[index],
    xRank: rankSummary.xRanks[index],
    yRank: rankSummary.yRanks[index],
    rankGap: rankSummary.yRanks[index] - rankSummary.xRanks[index],
    absRankGap: Math.abs(rankSummary.yRanks[index] - rankSummary.xRanks[index])
  }));

  const topRankRows = [...rankedRows]
    .sort((left, right) => right.absRankGap - left.absRankGap)
    .slice(0, 8);
  const highlightSet = new Set(topRankRows.slice(0, 4).map(row => row.index));
  const sortedByX = [...rankedRows].sort((left, right) => left.x - right.x || left.y - right.y);
  const expectedDirection = spearman.coef >= 0 ? 1 : -1;
  let comparableSteps = 0;
  let alignedSteps = 0;
  let reversals = 0;

  for (let index = 0; index < sortedByX.length - 1; index += 1) {
    const deltaY = sortedByX[index + 1].y - sortedByX[index].y;
    if (Math.abs(deltaY) < 1e-9) continue;
    comparableSteps += 1;
    const direction = deltaY > 0 ? 1 : -1;
    if (direction === expectedDirection) alignedSteps += 1;
    else reversals += 1;
  }

  const monotonicConsistency = comparableSteps ? alignedSteps / comparableSteps : 1;
  let monotonicLabel = 'monotonicidade moderada';
  if (Math.abs(spearman.coef) >= 0.7 && monotonicConsistency >= 0.8) monotonicLabel = 'monotonicidade muito consistente';
  else if (Math.abs(spearman.coef) >= 0.45 && monotonicConsistency >= 0.68) monotonicLabel = 'monotonicidade consistente';
  else if (monotonicConsistency < 0.55) monotonicLabel = 'monotonicidade irregular';

  const avgRankGap = rankedRows.reduce((sum, row) => sum + row.absRankGap, 0) / rankedRows.length;
  return {
    rankedRows,
    topRankRows,
    highlightSet,
    monotonicConsistency,
    monotonicLabel,
    avgRankGap,
    maxRankGap: topRankRows[0]?.absRankGap || 0,
    reversals,
    comparableSteps,
    gapVsPearson: Math.abs(Math.abs(spearman.coef) - Math.abs(pearson.coef))
  };
}

function buildMetricRows(primaryCards, secondaryCards) {
  return `
    <div class="correlation-metric-row correlation-metric-row-primary">
      ${primaryCards.join('')}
    </div>
    ${secondaryCards.length ? `
      <div class="correlation-metric-row correlation-metric-row-secondary">
        ${secondaryCards.join('')}
      </div>
    ` : ''}
  `;
}

function buildInsightStrip(items, utils) {
  const visibleItems = items.filter(Boolean);
  if (!visibleItems.length) return '';

  return `
    <div class="correlation-insight-strip">
      ${visibleItems.map(item => `
        <article class="correlation-insight-pill ${item.tone ? `is-${item.tone}` : ''}">
          <strong>${utils.escapeHtml(item.label)}</strong>
          <span>${utils.escapeHtml(item.text)}</span>
        </article>
      `).join('')}
    </div>
  `;
}

function buildEnhancedScatterSvg(dataset, pearson, diagnostics, utils) {
  const width = 980;
  const height = 560;
  const margin = { top: 42, right: 36, bottom: 84, left: 94 };
  const minX = Math.min(...dataset.x);
  const maxX = Math.max(...dataset.x);
  const minY = Math.min(...dataset.y);
  const maxY = Math.max(...dataset.y);
  const xPad = (maxX - minX || 1) * 0.1;
  const yPad = (maxY - minY || 1) * 0.12;
  const chartWidth = width - margin.left - margin.right;
  const chartHeight = height - margin.top - margin.bottom;
  const px = value => margin.left + ((value - (minX - xPad)) / (((maxX - minX) + (xPad * 2)) || 1)) * chartWidth;
  const py = value => height - margin.bottom - ((value - (minY - yPad)) / (((maxY - minY) + (yPad * 2)) || 1)) * chartHeight;
  const xTicks = buildTickValues(minX, maxX, 5);
  const yTicks = buildTickValues(minY, maxY, 5);
  const x1 = minX - xPad;
  const x2 = maxX + xPad;
  const y1 = pearson.intercept + (pearson.slope * x1);
  const y2 = pearson.intercept + (pearson.slope * x2);
  const shouldLabelPoints = dataset.labels.length <= 14;
  const highlightLines = diagnostics.highlighted.slice(0, 4).map(point => `
    <line
      x1="${px(point.x).toFixed(2)}"
      y1="${py(point.y).toFixed(2)}"
      x2="${px(point.x).toFixed(2)}"
      y2="${py(point.fitted).toFixed(2)}"
      stroke="rgba(180,83,9,0.65)"
      stroke-width="2.4"
      stroke-dasharray="6 6"
      stroke-linecap="round"
    />
  `).join('');

  const points = diagnostics.points.map(point => {
    const isHighlighted = diagnostics.highlightSet.has(point.index);
    const fill = point.outlier ? '#d97706' : (isHighlighted ? '#0f766e' : '#2563eb');
    const halo = isHighlighted
      ? `<circle cx="${px(point.x).toFixed(2)}" cy="${py(point.y).toFixed(2)}" r="10.8" fill="rgba(15,118,110,0.12)" />`
      : '';
    const label = shouldLabelPoints || isHighlighted
      ? `<text x="${(px(point.x) + 9).toFixed(2)}" y="${(py(point.y) - 10).toFixed(2)}" font-size="11" fill="#48627f">${utils.escapeHtml(point.label).slice(0, 18)}</text>`
      : '';
    return `
      <g>
        ${halo}
        <circle cx="${px(point.x).toFixed(2)}" cy="${py(point.y).toFixed(2)}" r="${isHighlighted ? '6.7' : '5.4'}" fill="${fill}" stroke="#ffffff" stroke-width="${isHighlighted ? '2.4' : '1.8'}">
          <title>${utils.escapeHtml(point.label)} | ${utils.escapeHtml(dataset.headers[0])}: ${utils.fmtNumber(point.x, 2)} | ${utils.escapeHtml(dataset.headers[1])}: ${utils.fmtNumber(point.y, 2)} | Ajustado: ${utils.fmtNumber(point.fitted, 2)} | Residuo: ${utils.fmtSigned(point.residual, 2)}</title>
        </circle>
        ${label}
      </g>
    `;
  }).join('');

  const gridX = xTicks.map(value => `
    <g>
      <line x1="${px(value).toFixed(2)}" y1="${margin.top}" x2="${px(value).toFixed(2)}" y2="${height - margin.bottom}" stroke="rgba(148,163,184,0.22)" />
      <text x="${px(value).toFixed(2)}" y="${height - margin.bottom + 28}" text-anchor="middle" fill="#5b6b84" font-size="12">${utils.fmtNumber(value, 2)}</text>
    </g>
  `).join('');
  const gridY = yTicks.map(value => `
    <g>
      <line x1="${margin.left}" y1="${py(value).toFixed(2)}" x2="${width - margin.right}" y2="${py(value).toFixed(2)}" stroke="rgba(148,163,184,0.22)" />
      <text x="${margin.left - 14}" y="${(py(value) + 4).toFixed(2)}" text-anchor="end" fill="#5b6b84" font-size="12">${utils.fmtNumber(value, 2)}</text>
    </g>
  `).join('');

  const equationText = `${dataset.headers[1]} = ${utils.fmtNumber(pearson.intercept, 2)} ${pearson.slope >= 0 ? '+' : '-'} ${utils.fmtNumber(Math.abs(pearson.slope), 2)} x ${dataset.headers[0]}`;
  return `
    <svg viewBox="0 0 ${width} ${height}" class="scatter-svg" role="img" aria-label="Dispersao com reta de tendencia para Pearson">
      <defs>
        <linearGradient id="pearson-bg" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stop-color="#ffffff"/>
          <stop offset="100%" stop-color="#f8fbff"/>
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="${width}" height="${height}" rx="24" fill="url(#pearson-bg)"/>
      <rect x="${margin.left}" y="${margin.top}" width="${chartWidth}" height="${chartHeight}" rx="18" fill="rgba(255,255,255,0.78)" stroke="rgba(217,229,241,0.9)"/>
      ${gridX}
      ${gridY}
      <line x1="${margin.left}" y1="${height - margin.bottom}" x2="${width - margin.right}" y2="${height - margin.bottom}" stroke="#9cb0ca" stroke-width="1.4"/>
      <line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${height - margin.bottom}" stroke="#9cb0ca" stroke-width="1.4"/>
      ${highlightLines}
      <line x1="${px(x1).toFixed(2)}" y1="${py(y1).toFixed(2)}" x2="${px(x2).toFixed(2)}" y2="${py(y2).toFixed(2)}" stroke="#0f766e" stroke-width="3.2" stroke-linecap="round"/>
      ${points}
      <rect x="${width - 298}" y="28" width="258" height="96" rx="18" fill="rgba(15,118,110,0.10)" stroke="rgba(15,118,110,0.20)"/>
      <text x="${width - 278}" y="52" fill="#164e63" font-size="12" font-weight="700">Pearson | reta linear</text>
      <text x="${width - 278}" y="71" fill="#33556f" font-size="11">${utils.escapeHtml(equationText)}</text>
      <text x="${width - 278}" y="89" fill="#33556f" font-size="11">R2 = ${utils.fmtNumber(pearson.r2, 3)} | MAE = ${utils.fmtNumber(diagnostics.mae, 2)}</text>
      <text x="${width - 278}" y="107" fill="#33556f" font-size="11">IC95% de r: ${utils.escapeHtml(formatCi(pearson.ci, utils))}</text>
      <text x="${width / 2}" y="${height - 22}" text-anchor="middle" fill="#1e293b" font-size="14" font-weight="700">${utils.escapeHtml(dataset.headers[0])}</text>
      <text x="26" y="${height / 2}" text-anchor="middle" fill="#1e293b" font-size="14" font-weight="700" transform="rotate(-90, 26, ${height / 2})">${utils.escapeHtml(dataset.headers[1])}</text>
    </svg>
  `;
}

function buildEnhancedRankScatterSvg(dataset, spearman, rankSummary, diagnostics, utils) {
  const width = 980;
  const height = 560;
  const margin = { top: 42, right: 36, bottom: 84, left: 94 };
  const xRanks = rankSummary.xRanks;
  const yRanks = rankSummary.yRanks;
  const maxRank = Math.max(...xRanks, ...yRanks, 1);
  const minRank = Math.min(...xRanks, ...yRanks, 1);
  const pad = 0.8;
  const chartWidth = width - margin.left - margin.right;
  const chartHeight = height - margin.top - margin.bottom;
  const px = value => margin.left + ((value - (minRank - pad)) / (((maxRank - minRank) + (pad * 2)) || 1)) * chartWidth;
  const py = value => height - margin.bottom - ((value - (minRank - pad)) / (((maxRank - minRank) + (pad * 2)) || 1)) * chartHeight;
  const ticks = buildTickValues(minRank, maxRank, 5);
  const sortedByXRank = [...diagnostics.rankedRows].sort((left, right) => left.xRank - right.xRank || left.yRank - right.yRank);
  const monotonePath = sortedByXRank
    .map((row, index) => `${index === 0 ? 'M' : 'L'} ${px(row.xRank).toFixed(2)} ${py(row.yRank).toFixed(2)}`)
    .join(' ');
  const shouldLabelPoints = dataset.labels.length <= 14;

  const grid = ticks.map(value => `
    <g>
      <line x1="${px(value).toFixed(2)}" y1="${margin.top}" x2="${px(value).toFixed(2)}" y2="${height - margin.bottom}" stroke="rgba(148,163,184,0.22)" />
      <line x1="${margin.left}" y1="${py(value).toFixed(2)}" x2="${width - margin.right}" y2="${py(value).toFixed(2)}" stroke="rgba(148,163,184,0.22)" />
      <text x="${px(value).toFixed(2)}" y="${height - margin.bottom + 28}" text-anchor="middle" fill="#5b6b84" font-size="12">${utils.fmtNumber(value, 1)}</text>
      <text x="${margin.left - 14}" y="${(py(value) + 4).toFixed(2)}" text-anchor="end" fill="#5b6b84" font-size="12">${utils.fmtNumber(value, 1)}</text>
    </g>
  `).join('');

  const points = diagnostics.rankedRows.map(row => {
    const isHighlighted = diagnostics.highlightSet.has(row.index);
    const halo = isHighlighted
      ? `<circle cx="${px(row.xRank).toFixed(2)}" cy="${py(row.yRank).toFixed(2)}" r="10.8" fill="rgba(37,99,235,0.12)" />`
      : '';
    const label = shouldLabelPoints || isHighlighted
      ? `<text x="${(px(row.xRank) + 9).toFixed(2)}" y="${(py(row.yRank) - 10).toFixed(2)}" font-size="11" fill="#48627f">${utils.escapeHtml(row.label).slice(0, 18)}</text>`
      : '';
    return `
      <g>
        ${halo}
        <circle cx="${px(row.xRank).toFixed(2)}" cy="${py(row.yRank).toFixed(2)}" r="${isHighlighted ? '6.7' : '5.4'}" fill="${isHighlighted ? '#2563eb' : '#0f766e'}" stroke="#ffffff" stroke-width="${isHighlighted ? '2.4' : '1.8'}">
          <title>${utils.escapeHtml(row.label)} | posto X: ${utils.fmtNumber(row.xRank, 1)} | posto Y: ${utils.fmtNumber(row.yRank, 1)} | diferenca: ${utils.fmtSigned(row.rankGap, 1)}</title>
        </circle>
        ${label}
      </g>
    `;
  }).join('');

  return `
    <svg viewBox="0 0 ${width} ${height}" class="scatter-svg" role="img" aria-label="Postos de X versus postos de Y para Spearman">
      <defs>
        <linearGradient id="spearman-bg" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stop-color="#ffffff"/>
          <stop offset="100%" stop-color="#f8fbff"/>
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="${width}" height="${height}" rx="24" fill="url(#spearman-bg)"/>
      <rect x="${margin.left}" y="${margin.top}" width="${chartWidth}" height="${chartHeight}" rx="18" fill="rgba(255,255,255,0.78)" stroke="rgba(217,229,241,0.9)"/>
      ${grid}
      <line x1="${margin.left}" y1="${height - margin.bottom}" x2="${width - margin.right}" y2="${height - margin.bottom}" stroke="#9cb0ca" stroke-width="1.4"/>
      <line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${height - margin.bottom}" stroke="#9cb0ca" stroke-width="1.4"/>
      <line x1="${px(minRank).toFixed(2)}" y1="${py(minRank).toFixed(2)}" x2="${px(maxRank).toFixed(2)}" y2="${py(maxRank).toFixed(2)}" stroke="rgba(15,118,110,0.65)" stroke-width="2.2" stroke-dasharray="8 6"/>
      <path d="${monotonePath}" fill="none" stroke="rgba(37,99,235,0.35)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
      ${points}
      <rect x="${width - 306}" y="28" width="266" height="98" rx="18" fill="rgba(37,99,235,0.09)" stroke="rgba(37,99,235,0.18)"/>
      <text x="${width - 286}" y="52" fill="#1d4ed8" font-size="12" font-weight="700">Spearman | leitura por ranks</text>
      <text x="${width - 286}" y="71" fill="#33556f" font-size="11">rho = ${utils.fmtSigned(spearman.coef, 3)} | IC95% ${utils.escapeHtml(formatCi(spearman.ci, utils))}</text>
      <text x="${width - 286}" y="89" fill="#33556f" font-size="11">Consistencia monotona: ${utils.fmtNumber(diagnostics.monotonicConsistency * 100, 0)}%</text>
      <text x="${width - 286}" y="107" fill="#33556f" font-size="11">Empates: X ${rankSummary.xTies.groups} | Y ${rankSummary.yTies.groups}</text>
      <text x="${width / 2}" y="${height - 22}" text-anchor="middle" fill="#1e293b" font-size="14" font-weight="700">Postos de ${utils.escapeHtml(dataset.headers[0])}</text>
      <text x="26" y="${height / 2}" text-anchor="middle" fill="#1e293b" font-size="14" font-weight="700" transform="rotate(-90, 26, ${height / 2})">Postos de ${utils.escapeHtml(dataset.headers[1])}</text>
    </svg>
  `;
}

function buildResidualTableEnhanced(dataset, diagnostics, utils) {
  const rows = diagnostics.highlighted;
  return `
    <div class="preview-table-wrap">
      <table class="preview-table correlation-preview-table">
        <thead>
          <tr>
            <th>ID</th>
            <th>${utils.escapeHtml(dataset.headers[0])}</th>
            <th>${utils.escapeHtml(dataset.headers[1])}</th>
            <th>Y ajustado</th>
            <th>Residuo</th>
            <th>|Residuo|</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(row => `
            <tr class="${row.outlier ? 'correlation-preview-row-ignored' : 'correlation-preview-row-valid'}">
              <td>${utils.escapeHtml(row.label)}</td>
              <td>${utils.fmtNumber(row.x, 2)}</td>
              <td>${utils.fmtNumber(row.y, 2)}</td>
              <td>${utils.fmtNumber(row.fitted, 2)}</td>
              <td>${utils.fmtSigned(row.residual, 2)}</td>
              <td>${utils.fmtNumber(row.absResidual, 2)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function buildRankComparisonTableEnhanced(dataset, diagnostics, utils) {
  const rows = diagnostics.topRankRows;
  return `
    <div class="preview-table-wrap">
      <table class="preview-table correlation-preview-table">
        <thead>
          <tr>
            <th>ID</th>
            <th>${utils.escapeHtml(dataset.headers[0])}</th>
            <th>Posto X</th>
            <th>${utils.escapeHtml(dataset.headers[1])}</th>
            <th>Posto Y</th>
            <th>Dif. postos</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(row => `
            <tr class="${Math.abs(row.rankGap) >= diagnostics.avgRankGap ? 'correlation-preview-row-ignored' : 'correlation-preview-row-valid'}">
              <td>${utils.escapeHtml(row.label)}</td>
              <td>${utils.fmtNumber(row.x, 2)}</td>
              <td>${utils.fmtNumber(row.xRank, 1)}</td>
              <td>${utils.fmtNumber(row.y, 2)}</td>
              <td>${utils.fmtNumber(row.yRank, 1)}</td>
              <td>${utils.fmtSigned(row.rankGap, 1)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function buildPearsonInterpretationHtml(dataset, pearson, spearman, diagnostics, outlierLabels, utils, alpha, context) {
  const direction = classifyDirection(pearson.coef);
  const strength = classifyStrength(pearson.coef);
  const alphaValue = parseFloat(alpha) || 0.05;
  const mainFinding = pearson.p < alphaValue
    ? `Pearson indicou associacao linear ${direction} de intensidade ${strength} entre ${dataset.headers[0]} e ${dataset.headers[1]} (r = ${utils.fmtSigned(pearson.coef, 3)}; p ${formatPValue(pearson.p, utils)}).`
    : `Pearson nao encontrou evidencia estatistica robusta de associacao linear entre ${dataset.headers[0]} e ${dataset.headers[1]} (r = ${utils.fmtSigned(pearson.coef, 3)}; p ${formatPValue(pearson.p, utils)}).`;
  const adequacyText = diagnostics.adequacyTone === 'warning'
    ? `A reta linear parece resumir os pontos com limitacoes importantes; o ganho de um ajuste curvo foi de ${utils.fmtNumber(diagnostics.curvatureGain, 3)} em R2.`
    : diagnostics.adequacyTone === 'caution'
      ? `A reta linear ainda ajuda na leitura, mas ha sinais de ressalva: desvio medio de ${utils.fmtNumber(diagnostics.mae, 2)} e possivel curvatura leve a moderada.`
      : `A reta linear resume os pontos de forma satisfatoria para uma leitura inicial, com desvio medio de ${utils.fmtNumber(diagnostics.mae, 2)}.`;
  const influenceText = outlierLabels.length
    ? `Os pontos ${outlierLabels.slice(0, 4).join(', ')}${outlierLabels.length > 4 ? ', ...' : ''} merecem revisao porque Pearson e mais sensivel a outliers e aos maiores residuos.`
    : `Nao apareceram outliers fortes na triagem inicial, embora os maiores residuos continuem visiveis no painel auxiliar.`;

  return `
    ${context ? `<p><strong>Pergunta do estudo.</strong> ${utils.escapeHtml(context)}</p>` : ''}
    <p><strong>Achado principal.</strong> ${utils.escapeHtml(mainFinding)}</p>
    <ul>
      <li>Forca e direcao: ${strength}, ${direction}, com IC95% de r em ${utils.escapeHtml(formatCi(pearson.ci, utils))}.</li>
      <li>Adequacao da reta: ${utils.escapeHtml(adequacyText)}</li>
      <li>Comparacao didatica: ${utils.escapeHtml(compareMessage(pearson, spearman))}</li>
      <li>Pontos influentes: ${utils.escapeHtml(influenceText)}</li>
    </ul>
  `;
}

function buildSpearmanInterpretationHtml(dataset, pearson, spearman, diagnostics, rankSummary, utils, alpha, context) {
  const direction = classifyDirection(spearman.coef);
  const strength = classifyStrength(spearman.coef);
  const alphaValue = parseFloat(alpha) || 0.05;
  const mainFinding = spearman.p < alphaValue
    ? `Spearman indicou associacao monotona ${direction} de intensidade ${strength} entre ${dataset.headers[0]} e ${dataset.headers[1]} (rho = ${utils.fmtSigned(spearman.coef, 3)}; p ${formatPValue(spearman.p, utils)}).`
    : `Spearman nao encontrou evidencia estatistica robusta de associacao monotona entre ${dataset.headers[0]} e ${dataset.headers[1]} (rho = ${utils.fmtSigned(spearman.coef, 3)}; p ${formatPValue(spearman.p, utils)}).`;
  const tieText = rankSummary.xTies.groups || rankSummary.yTies.groups
    ? `Empates foram tratados com postos medios (${rankSummary.xTies.groups} grupo(s) em X e ${rankSummary.yTies.groups} em Y).`
    : 'Nao houve empates relevantes; a ordenacao relativa ficou limpa.';
  const monotonicText = diagnostics.monotonicConsistency >= 0.8
    ? `A ordem relativa dos dados foi bastante coerente com a tendencia monotona esperada (${utils.fmtNumber(diagnostics.monotonicConsistency * 100, 0)}% das transicoes alinhadas).`
    : diagnostics.monotonicConsistency >= 0.6
      ? `A ordenacao relativa mostrou monotonicidade parcial (${utils.fmtNumber(diagnostics.monotonicConsistency * 100, 0)}% das transicoes alinhadas), sem exigir uma reta perfeita.`
      : `A ordenacao relativa foi irregular (${utils.fmtNumber(diagnostics.monotonicConsistency * 100, 0)}% das transicoes alinhadas), sugerindo cautela mesmo com a leitura por ranks.`;

  return `
    ${context ? `<p><strong>Pergunta do estudo.</strong> ${utils.escapeHtml(context)}</p>` : ''}
    <p><strong>Achado principal.</strong> ${utils.escapeHtml(mainFinding)}</p>
    <ul>
      <li>Forca e direcao monotona: ${strength}, ${direction}, com IC95% de rho em ${utils.escapeHtml(formatCi(spearman.ci, utils))}.</li>
      <li>Base do calculo: ${utils.escapeHtml(tieText)}</li>
      <li>Monotonicidade: ${utils.escapeHtml(monotonicText)}</li>
      <li>Comparacao didatica: ${utils.escapeHtml(compareMessage(pearson, spearman))}</li>
    </ul>
  `;
}

export async function renderTestModule(ctx) {
  const { root, config, utils, stats, shared } = ctx;

  const moduleState = ctx.shared['correlacao'] || (ctx.shared['correlacao'] = {
    manual: {
      paste: '',
      context: '',
      alpha: '0.05',
      activeMethod: 'pearson',
      dataset: buildEmptyCorrelationDataset(),
      lastResult: null
    },
    datasus: {
      session: null,
      sharedSession: clonePlain(shared?.datasus?.lastSession || null),
      xSourceId: '',
      ySourceId: '',
      metricBySource: {},
      timeKey: '',
      labelMode: 'category-time',
      context: '',
      alpha: '0.05',
      derived: null
    }
  });
  const state = moduleState.manual;
  const datasusState = moduleState.datasus;
  // Ensure new fields are present for sessions created before they were added
  state.alpha = state.alpha || '0.05';
  state.context = state.context || '';
  datasusState.alpha = datasusState.alpha || '0.05';
  datasusState.context = datasusState.context || '';

  root.classList.add('correlacao-module-shell');

  try {
    const warnedUiKeys = new Set();

    function warnMissingUi(label, selector, detail = 'O modulo seguira carregando com os elementos disponiveis.') {
      const key = `${label}:${selector}`;
      if (warnedUiKeys.has(key)) return;
      warnedUiKeys.add(key);
      console.warn(`[correlacao] Elemento nao encontrado para ${label} (${selector}). ${detail}`);
    }

    function createMissingElementRef(label, selector) {
      const noop = () => { };
      return {
        __correlationMissingRef: true,
        label,
        selector,
        value: '',
        innerHTML: '',
        textContent: '',
        className: '',
        disabled: true,
        files: [],
        dataset: {},
        classList: {
          add: noop,
          remove: noop,
          toggle: noop,
          contains: () => false
        },
        addEventListener: noop,
        removeEventListener: noop,
        querySelector: () => null,
        querySelectorAll: () => [],
        setAttribute: noop,
        getAttribute: () => null,
        focus: noop
      };
    }

    function isMissingElementRef(element) {
      return Boolean(element?.__correlationMissingRef);
    }

    function findInContainer(container, selector, options = {}) {
      const { label = selector, optional = false } = options;
      const element = container?.querySelector?.(selector) || null;
      if (element) return element;
      warnMissingUi(
        label,
        selector,
        optional
          ? 'Controle opcional ausente nesta renderizacao.'
          : 'Revise se o seletor ainda corresponde ao HTML atual do modulo.'
      );
      return createMissingElementRef(label, selector);
    }

    function safeBindElement(element, eventName, handler, options = {}) {
      const { label = 'elemento', bindingKey = `${eventName}:${label}`, listenerOptions } = options;
      if (!element || isMissingElementRef(element)) return null;
      if (!element[CORRELATION_BOUND_EVENTS]) {
        element[CORRELATION_BOUND_EVENTS] = new Set();
      }
      if (element[CORRELATION_BOUND_EVENTS].has(bindingKey)) {
        return element;
      }
      element[CORRELATION_BOUND_EVENTS].add(bindingKey);
      element.addEventListener(eventName, handler, listenerOptions);
      return element;
    }

    function safeBind(container, selector, eventName, handler, options = {}) {
      const { label = selector, optional = false, bindingKey, listenerOptions } = options;
      const element = container?.querySelector?.(selector) || null;
      if (!element) {
        warnMissingUi(
          label,
          selector,
          optional
            ? `O listener opcional de ${eventName} nao sera registrado.`
            : `O listener de ${eventName} nao foi registrado; revise o HTML atual do modulo.`
        );
        return null;
      }
      return safeBindElement(element, eventName, handler, { label, bindingKey, listenerOptions });
    }

    function safeBindAll(container, selector, eventName, handler, options = {}) {
      const { label = selector, optional = false, bindingKey = `${eventName}:${selector}`, listenerOptions } = options;
      const elements = Array.from(container?.querySelectorAll?.(selector) || []);
      if (!elements.length) {
        warnMissingUi(
          label,
          selector,
          optional
            ? 'Nenhum controle opcional encontrado para este grupo.'
            : 'Nenhum elemento encontrado para o grupo de listeners.'
        );
        return [];
      }
      return elements.map((element, index) => safeBindElement(element, eventName, handler, {
        label: `${label} #${index + 1}`,
        bindingKey,
        listenerOptions
      })).filter(Boolean);
    }

    function toneClass(kind) {
      if (kind === 'success') return 'success-box';
      if (kind === 'error') return 'error-box';
      return 'status-bar';
    }

    root.innerHTML = `
      <div class="module-grid correlacao-module">
        <section class="module-header">
          <p>${utils.escapeHtml(config.subtitle || '')}</p>
          <p>${utils.escapeHtml(config.description || '')}</p>
        </section>

        <details class="didactic-accordion" ${config.didacticExpanded ? 'open' : ''}>
          <summary class="didactic-summary">
            <span class="didactic-summary-icon">📖</span>
            Saber mais
            <span class="didactic-summary-chevron">▼</span>
          </summary>
          <section class="callout-grid correlacao-cards">
            ${(config.didacticCards || []).map(card => `
              <article class="help-card didactic-card">
                <h4>${utils.escapeHtml(card.title || '')}</h4>
                <p>${utils.escapeHtml(card.text || '')}</p>
              </article>
            `).join('')}
          </section>
        </details>

        <section class="surface-card decorated">
          <h4 style="font-size: 1.6rem; margin-bottom: 8px;">Entrada de dados</h4>
          <p class="small-note" style="margin-bottom: 24px">Cole as duas colunas numéricas da sua planilha (Excel, etc.) na caixa abaixo ou importe um arquivo.</p>
          
          <div class="form-grid two" style="margin-bottom: 20px;">
            <div>
              <label for="c-context">Pergunta do estudo</label>
              <input id="c-context" type="text" placeholder="Existe correlação entre as duas variáveis agregadas?" value="${utils.escapeHtml(state.context || '')}" />
            </div>
            <div>
              <label for="c-alpha">Nível de significância (p-valor)</label>
              <select id="c-alpha">
                <option value="0.01"${state.alpha === '0.01' ? ' selected' : ''}>1%</option>
                <option value="0.05"${state.alpha === '0.05' ? ' selected' : ''}>5%</option>
                <option value="0.10"${state.alpha === '0.10' ? ' selected' : ''}>10%</option>
              </select>
            </div>
          </div>

          <div style="margin-bottom: 20px;">
            <label for="c-paste">Cole seus dados aqui</label>
            <textarea id="c-paste" class="input-box" placeholder="Coluna X\tColuna Y&#10;10,5\t22,1&#10;12,2\t25,4&#10;...">${utils.escapeHtml(state.paste)}</textarea>
          </div>
          
          <div class="actions-row" style="justify-content: space-between; align-items: center;">
            <div style="display: flex; gap: 10px;">
              <button type="button" class="lacir-info-btn" id="c-info-btn" title="Como usar" aria-label="Instruções de uso">ℹ</button>
              <button type="button" class="btn" id="c-run-analysis">Rodar análise</button>
              <button type="button" class="btn-ghost" id="c-clear">Limpar</button>
            </div>
            <div class="module-file-picker">
              <label for="c-file" class="btn-ghost" style="margin-bottom:0; cursor:pointer;">Importar CSV/Excel</label>
              <input id="c-file" type="file" style="display:none;" />
            </div>
          </div>
          
          <div id="c-intake-status" class="status-bar" style="margin-top:16px;">Cole os dados ou importe um arquivo para continuar.</div>

          <dialog id="c-info-modal" class="lacir-info-modal">
            <div class="lacir-info-modal-header">
              <h4>📋 Como usar — Correlação</h4>
              <button class="btn-close-modal" onclick="this.closest('dialog').close()" aria-label="Fechar">×</button>
            </div>
            <div class="lacir-info-modal-body">
              <ol>
                <li><strong>Copie duas colunas</strong> da sua planilha (Excel, Google Sheets, DATASUS).</li>
                <li><strong>Cole na área de texto</strong> — o sistema detecta automaticamente os cabeçalhos e separadores.</li>
                <li>O formato esperado é <strong>Coluna X ⇥ Coluna Y</strong>, uma linha por observação.</li>
                <li>Variáveis com vírgula decimal (padrão BR) são aceitas normalmente.</li>
                <li>Clique em <strong>Rodar análise</strong> ou clique no botão 🔮 Mágico para que o assistente escolha o método ideal.</li>
              </ol>
              <div class="lacir-info-modal-tip">💡 Dica: variáveis ordinais (ex: &quot;10 a 14 anos&quot;) são automaticamente convertidas para postos pelo Spearman.</div>
            </div>
          </dialog>
        </section>

        <section class="surface-card">
          <h4>Previa dos dados</h4>
          <div id="c-preview-meta" class="tabular-preview-stack">
            <div class="small-note">Nenhum dado lido ainda.</div>
          </div>
          <div id="c-preview-table" style="margin-top:14px;"></div>
        </section>

        <section class="surface-card" style="position:relative;">
          <dialog id="c-wizard-modal" class="lacir-modal">
            <div class="lacir-modal-body" id="c-wizard-container"></div>
          </dialog>
          
          <div class="lacir-action-bar" style="margin-top:0;">
            <div class="lacir-action-group" style="align-items: center; gap: 12px;">
              <button type="button" class="lacir-info-btn" id="c-open-wizard" title="Saiba mais sobre Pearson e Spearman" aria-label="Guia de escolha do teste" style="margin-right: 4px;">ℹ</button>
              <span style="font-weight:600; color:var(--text-muted); font-size:0.9rem;">MÉTODOS DE CÁLCULO:</span>
              <div class="lacir-toggle-switch" role="tablist" aria-label="Método de correlação em destaque">
                <button type="button" class="lacir-toggle-btn is-active" data-correlation-method="pearson" aria-selected="true">Pearson (Paramétrico)</button>
                <button type="button" class="lacir-toggle-btn" data-correlation-method="spearman" aria-selected="false">Spearman (Não-Paramétrico)</button>
              </div>
            </div>
            <div style="display: flex; align-items: center; gap: 12px;">
              <button type="button" class="btn" id="c-run-analysis" style="font-size:1.05rem; padding:10px 28px; box-shadow:0 4px 16px rgba(34,197,94,0.2);">
                <span style="margin-right:8px;">▶</span> Rodar Análise
              </button>
            </div>
          </div>
          <div id="c-error" style="margin-top:14px;"></div>
          <div id="c-status" class="status-bar" style="margin-top:14px;">Leia ou importe uma base para continuar.</div>
          <div id="c-metrics" class="metrics-grid" style="margin-top:14px;"></div>
        </section>

        <section class="surface-card">
          <h4>Interpretação automática</h4>
          <div id="c-interpretation" class="result-card"><p class="muted">A interpretação aparecerá aqui após rodar a análise.</p></div>
          <div id="c-outlier-alert" style="margin-top:14px;"></div>
        </section>

        <section class="surface-card">
          <h4>Visualização e pontos influentes</h4>
          <div id="c-charts" class="chart-grid"></div>
        </section>
      </div>
    `;

    const els = {
      file: findInContainer(root, '#c-file', { label: 'arquivo de entrada' }),
      fileName: findInContainer(root, '#c-file-name', { label: 'nome do arquivo' }),
      paste: findInContainer(root, '#c-paste', { label: 'área de colagem' }),
      intakeStatus: findInContainer(root, '#c-intake-status', { label: 'status da leitura' }),
      previewMeta: findInContainer(root, '#c-preview-meta', { label: 'resumo da prévia' }),
      previewTable: findInContainer(root, '#c-preview-table', { label: 'tabela de prévia' }),
      error: findInContainer(root, '#c-error', { label: 'área de erro' }),
      status: findInContainer(root, '#c-status', { label: 'status da análise' }),
      metrics: findInContainer(root, '#c-metrics', { label: 'métricas' }),
      interpretation: findInContainer(root, '#c-interpretation', { label: 'interpretação' }),
      outlier: findInContainer(root, '#c-outlier-alert', { label: 'alerta de outliers', optional: true }),
      charts: findInContainer(root, '#c-charts', { label: 'graficos' }),
      wizardContainer: findInContainer(root, '#c-wizard-container', { label: 'assistente magico', optional: true }),
      datasusWizard: findInContainer(root, '#c-datasus-wizard', { label: 'wizard DATASUS', optional: true }),
      datasusControls: findInContainer(root, '#c-datasus-controls', { label: 'controles DATASUS', optional: true }),
      datasusPreview: findInContainer(root, '#c-datasus-preview', { label: 'previa DATASUS', optional: true })
    };

    function setIntakeStatus(kind, message) {
      els.intakeStatus.className = toneClass(kind);
      els.intakeStatus.textContent = message;
    }

    function resetResultVisuals(statusMessage = 'Leia ou importe uma base para continuar.') {
      els.error.innerHTML = '';
      els.status.className = 'status-bar';
      els.status.textContent = statusMessage;
      els.metrics.innerHTML = '';
      els.interpretation.innerHTML = '<p class="muted">A interpretacao aparecera aqui apos rodar a analise.</p>';
      els.outlier.innerHTML = '';
      els.charts.innerHTML = '';
    }

    function renderPreview() {
      const dataset = state.dataset;
      const recognized = buildRecognizedColumnsChips(dataset.recognizedColumns, CORRELATION_RECOGNIZED_ORDER);

      if (!dataset.hasContent && !dataset.errors.length) {
        els.previewMeta.innerHTML = '<div class="small-note">Nenhum dado lido ainda.</div>';
        els.previewTable.innerHTML = '';
        return;
      }

      els.previewMeta.innerHTML = `
        <div class="tabular-preview-grid">
          <article class="mini-card">
            <h4>Colunas reconhecidas</h4>
            <div class="tabular-chip-row">${recognized || '<span class="small-note">Nenhuma coluna reconhecida.</span>'}</div>
          </article>
          <article class="mini-card">
            <h4>Linhas válidas</h4>
            <p>${dataset.x.length}</p>
          </article>
          <article class="mini-card">
            <h4>Linhas ignoradas</h4>
            <p>${dataset.ignoredRows.length}</p>
          </article>
        </div>
        ${buildFeedbackBox(dataset.infos, 'status-bar', utils, 'Leitura')}
        ${buildFeedbackBox(dataset.warnings, 'status-bar outlier-note', utils, 'Linhas ignoradas')}
        ${buildFeedbackBox(dataset.errors, 'error-box', utils, 'Problemas encontrados')}
      `;
      els.previewTable.innerHTML = buildCorrelationPreviewTable(dataset, utils);
    }

    function applyDataset(dataset, statusMessage, statusKind = 'status') {
      state.dataset = dataset;
      state.lastResult = null;
      renderPreview();
      resetResultVisuals();
      setIntakeStatus(statusKind, statusMessage);
    }

    async function readSelectedFile(file) {
      if (!file) return;
      els.fileName.textContent = file.name || 'Arquivo selecionado';
      setIntakeStatus('status', 'Lendo arquivo...');
      const fileState = await readTabularFileState(file, utils, stats, CORRELATION_TABULAR_OPTIONS);
      const dataset = buildCorrelationDatasetFromTabularState(fileState, stats, {
        sourceKind: 'file',
        sourceLabel: 'Arquivo importado'
      });

      applyDataset(
        dataset,
        fileState.status === 'loaded'
          ? `Arquivo "${file.name}" lido com sucesso. Revise a previa antes de rodar a analise.`
          : (fileState.message || 'Nao foi possivel ler o arquivo enviado.'),
        fileState.status === 'loaded' ? 'success' : 'error'
      );
    }

    function readPastedData(rawText, statusMessage = 'Dados colados lidos. Revise a prévia antes de rodar a análise.', statusKind = 'success') {
      if (!rawText || !rawText.trim()) {
        state.dataset = buildEmptyCorrelationDataset();
        renderPreview();
        resetResultVisuals();
        setIntakeStatus('status', 'Cole seus dados na área designada para continuar.');
        return state.dataset;
      }

      const { headers, data } = DataParser.parseClipboard(rawText);
      const dataset = buildEmptyCorrelationDataset('paste', 'Dados colados');
      dataset.hasContent = true;

      let numericCols = [];
      let textCols = [];

      if (data.length > 0) {
        const colCount = data[0].length;
        for (let c = 0; c < colCount; c++) {
          if (data.some(row => typeof row[c] === 'number')) {
            numericCols.push(c);
          } else if (data.some(row => typeof row[c] === 'string' && row[c].trim() !== '')) {
            textCols.push(c);
          }
        }
      }

      let xCol = -1, yCol = -1;
      let isOrdinalX = false;
      if (numericCols.length >= 2) {
        xCol = numericCols[0];
        yCol = numericCols[1];
      } else if (numericCols.length === 1 && textCols.length >= 1) {
        xCol = textCols[0]; // Ordinal
        yCol = numericCols[0]; // Numeric
        isOrdinalX = true;
      }

      if (xCol === -1 || yCol === -1) {
        dataset.errors.push('Nenhum par numérico ou ordinal válido identificado.');
        dataset.hasContent = false;
      } else {
        dataset.headers = [headers[xCol] || 'Var X', headers[yCol] || 'Var Y'];
        dataset.previewHeaders.x = dataset.headers[0];
        dataset.previewHeaders.y = dataset.headers[1];

        let ordinalMap = new Map();
        let ordinalCounter = 1;

        data.forEach((row, i) => {
          let xVal = row[xCol];
          let yVal = row[yCol];
          let xRawStr = String(row[xCol] || '');
          let yRawStr = String(row[yCol] || '');
          let labelStr = isOrdinalX ? xRawStr.trim() || `L${i + 1}` : `L${i + 1}`;

          if (isOrdinalX && typeof xVal === 'string') {
            const xStr = xVal.trim();
            if (xStr) {
              if (!ordinalMap.has(xStr)) ordinalMap.set(xStr, ordinalCounter++);
              xVal = ordinalMap.get(xStr);
            } else {
              xVal = null;
            }
          }

          if (typeof xVal === 'number' && typeof yVal === 'number') {
            dataset.x.push(xVal);
            dataset.y.push(yVal);
            dataset.labels.push(labelStr);
            dataset.validRows.push({ index: i + 1, label: labelStr, xValue: xVal, yValue: yVal });
            dataset.rows.push({
              index: i + 1, idLabel: labelStr, xRaw: xRawStr, yRaw: yRawStr,
              xValue: xVal, yValue: yVal, statusLabel: 'Válida', statusTone: 'valid', notes: []
            });
          } else {
            dataset.ignoredRows.push({});
          }
        });

        if (dataset.x.length === 0) {
          dataset.errors.push('Nenhum par numérico válido encontrado.');
          dataset.hasContent = false;
        } else if (isOrdinalX) {
          dataset.infos.push(`Coluna "${dataset.headers[0]}" identificada como variável Ordinal e mapeada como Postos para cálculo (excepcional para Spearman).`);
        }
      }

      applyDataset(
        dataset,
        dataset.hasContent ? statusMessage : 'Falha ao ler dados.',
        dataset.hasContent ? statusKind : 'error'
      );
      return dataset;
    }

    function loadExample() {
      readPastedData(CORRELATION_EXAMPLE_TEXT, 'Exemplo carregado e interpretado.', 'success');
      runAnalysis();
    }

    function clearAll() {
      state.dataset = buildEmptyCorrelationDataset();
      state.lastResult = null;
      state.paste = '';
      els.paste.value = '';
      els.file.value = '';
      els.fileName.textContent = 'Nenhum arquivo selecionado.';
      renderPreview();
      resetResultVisuals();
      setIntakeStatus('status', 'Campos limpos. Importe base ou cole dados para recomeçar.');
    }

    function renderMethodSpecificAnalysisResult(result) {
      const {
        dataset,
        pearson,
        spearman,
        outlierLabels,
        rankSummary,
        pearsonDiagnostics,
        spearmanDiagnostics
      } = result;
      const isSpearman = state.activeMethod === 'spearman';
      const activeAlpha = state.activeSource === 'datasus' ? datasusState.alpha : state.alpha;
      const activeContext = state.activeSource === 'datasus' ? datasusState.context : state.context;

      els.error.innerHTML = '';
      els.status.className = 'success-box';

      if (isSpearman) {
        els.status.textContent = `Spearman rodado com ${dataset.x.length} pares validos: rho = ${utils.fmtSigned(spearman.coef, 3)} e p ${formatPValue(spearman.p, utils)}.`;

        const primaryCards = [
          correlationMetricCard('Método principal', 'Spearman', 'Associação monótona baseada em ranks.', 'is-active is-primary'),
          correlationMetricCard('n válido', String(dataset.x.length), 'Pares usados no cálculo de Spearman.', 'is-primary'),
          correlationMetricCard('rho', utils.fmtSigned(spearman.coef, 3), `${classifyDirection(spearman.coef)} | ${classifyStrength(spearman.coef)}`, 'is-primary'),
          correlationMetricCard('p-valor', formatPValue(spearman.p, utils), 'Teste sobre postos e ordenação relativa.', 'is-primary')
        ];
        const secondaryCards = [
          correlationMetricCard('IC95% de rho', formatCi(spearman.ci, utils), 'Intervalo aproximado via transformação de Fisher nos ranks.', 'is-secondary'),
          correlationMetricCard('Consistência monótona', `${utils.fmtNumber(spearmanDiagnostics.monotonicConsistency * 100, 0)}%`, spearmanDiagnostics.monotonicLabel, spearmanDiagnostics.monotonicConsistency < 0.6 ? 'is-secondary is-warning' : 'is-secondary'),
          correlationMetricCard('Empates tratados', String(rankSummary.xTies.groups + rankSummary.yTies.groups), `X: ${rankSummary.xTies.groups} grupo(s) | Y: ${rankSummary.yTies.groups} grupo(s).`, 'is-secondary'),
          correlationMetricCard('Dif. média de ranks', utils.fmtNumber(spearmanDiagnostics.avgRankGap, 1), `Maior diferença observada: ${utils.fmtNumber(spearmanDiagnostics.maxRankGap, 1)}.`, 'is-secondary'),
          correlationMetricCard('Referência Pearson', utils.fmtSigned(pearson.coef, 3), compareMessage(pearson, spearman), Math.abs(Math.abs(spearman.coef) - Math.abs(pearson.coef)) > 0.12 ? 'is-secondary is-warning' : 'is-secondary')
        ];

        els.metrics.innerHTML = buildMetricRows(primaryCards, secondaryCards);
        els.interpretation.innerHTML = buildSpearmanInterpretationHtml(dataset, pearson, spearman, spearmanDiagnostics, rankSummary, utils, activeAlpha, activeContext);
        els.outlier.innerHTML = buildInsightStrip([
          {
            label: 'Metodo principal',
            text: 'Spearman mede monotonicidade pela ordenacao relativa, nao pela melhor reta.',
            tone: 'info'
          },
          {
            label: 'Comparacao com Pearson',
            text: compareMessage(pearson, spearman),
            tone: Math.abs(Math.abs(spearman.coef) - Math.abs(pearson.coef)) > 0.12 ? 'warning' : 'info'
          },
          {
            label: 'Monotonicidade',
            text: `${utils.fmtNumber(spearmanDiagnostics.monotonicConsistency * 100, 0)}% das transicoes ficaram alinhadas com a tendencia monotona esperada.`,
            tone: spearmanDiagnostics.monotonicConsistency < 0.6 ? 'warning' : 'success'
          },
          {
            label: 'Empates e ranks',
            text: rankSummary.xTies.groups || rankSummary.yTies.groups
              ? `Empates foram resolvidos por postos medios antes do calculo do coeficiente.`
              : 'Sem empates relevantes; os postos ficaram bem definidos.',
            tone: 'neutral'
          }
        ], utils);

        els.charts.innerHTML = buildChartContainer('corr-chart-ranks', 'Gráfico principal de Spearman — Ranks', 'Os pontos mostram os postos de X e Y. Passe o mouse sobre um ponto para ver seu rótulo e postos.', 'spearman-ranks.png');

        // Deferred Chart.js render so DOM is ready
        setTimeout(() => {
          renderRankScatterChart('corr-chart-ranks', dataset, spearman, spearmanDiagnostics, utils);
        }, 0);

        return;
      }

      els.status.textContent = `Pearson rodado com ${dataset.x.length} pares válidos: r = ${utils.fmtSigned(pearson.coef, 3)} e p ${formatPValue(pearson.p, utils)}.`;

      const primaryCards = [
        correlationMetricCard('Método principal', 'Pearson', 'Associação linear sobre valores brutos.', 'is-active is-primary'),
        correlationMetricCard('n válido', String(dataset.x.length), 'Pares usados no ajuste da reta.', 'is-primary'),
        correlationMetricCard('r de Pearson', utils.fmtSigned(pearson.coef, 3), `${classifyDirection(pearson.coef)} | ${classifyStrength(pearson.coef)}`, 'is-primary'),
        correlationMetricCard('p-valor', formatPValue(pearson.p, utils), 'Teste de associação linear.', 'is-primary')
      ];
      const secondaryCards = [
        correlationMetricCard('IC95% de r', formatCi(pearson.ci, utils), 'Intervalo de confiança aproximado para o coeficiente.', 'is-secondary'),
        correlationMetricCard('R2', utils.fmtNumber(pearson.r2, 3), 'Proporção da variação linear explicada por X.', 'is-secondary'),
        correlationMetricCard('Inclinação', utils.fmtSigned(pearson.slope, 3), `${utils.escapeHtml(dataset.headers[1])} por unidade de ${utils.escapeHtml(dataset.headers[0])}.`, 'is-secondary'),
        correlationMetricCard('Intercepto', utils.fmtNumber(pearson.intercept, 3), `Valor esperado de ${utils.escapeHtml(dataset.headers[1])} quando ${utils.escapeHtml(dataset.headers[0])} = 0.`, 'is-secondary'),
        correlationMetricCard('Adequação linear', pearsonDiagnostics.adequacyTone === 'warning' ? 'Cautela alta' : pearsonDiagnostics.adequacyTone === 'caution' ? 'Com ressalvas' : 'Boa', pearsonDiagnostics.adequacyLabel, pearsonDiagnostics.adequacyTone !== 'good' ? 'is-secondary is-warning' : 'is-secondary'),
        correlationMetricCard('Desvio médio', utils.fmtNumber(pearsonDiagnostics.mae, 2), `RMSE = ${utils.fmtNumber(pearsonDiagnostics.rmse, 2)} | influência destacada em ${pearsonDiagnostics.influenceCount} ponto(s).`, 'is-secondary'),
        correlationMetricCard('Referência Spearman', utils.fmtSigned(spearman.coef, 3), compareMessage(pearson, spearman), Math.abs(Math.abs(spearman.coef) - Math.abs(pearson.coef)) > 0.12 ? 'is-secondary is-warning' : 'is-secondary')
      ];

      els.metrics.innerHTML = buildMetricRows(primaryCards, secondaryCards);
      els.interpretation.innerHTML = buildPearsonInterpretationHtml(dataset, pearson, spearman, pearsonDiagnostics, outlierLabels, utils, activeAlpha, activeContext);
      els.outlier.innerHTML = buildInsightStrip([
        {
          label: 'Adequação da reta',
          text: pearsonDiagnostics.adequacyLabel,
          tone: pearsonDiagnostics.adequacyTone === 'good' ? 'success' : 'warning'
        },
        {
          label: 'Curvatura',
          text: pearsonDiagnostics.curvatureGain > 0.06
            ? `O ajuste quadrático ganhou ${utils.fmtNumber(pearsonDiagnostics.curvatureGain, 3)} em R2 sobre a reta linear.`
            : 'Não apareceu ganho relevante de curvatura sobre a reta linear.',
          tone: pearsonDiagnostics.curvatureGain > 0.06 ? 'warning' : 'neutral'
        },
        {
          label: 'Pontos influentes',
          text: outlierLabels.length
            ? `${outlierLabels.slice(0, 4).join(', ')}${outlierLabels.length > 4 ? ', ...' : ''} merecem revisão por distância da reta ou perfil extremo.`
            : 'Não houve outliers fortes na triagem inicial; o painel auxiliar mostra os maiores resíduos.',
          tone: outlierLabels.length ? 'warning' : 'info'
        },
        {
          label: 'Comparação com Spearman',
          text: compareMessage(pearson, spearman),
          tone: Math.abs(Math.abs(spearman.coef) - Math.abs(pearson.coef)) > 0.12 ? 'warning' : 'info'
        }
      ], utils);

      els.charts.innerHTML = buildChartContainer('corr-chart-pearson', 'Gráfico principal de Pearson — Dispersão', 'Dispersão com reta de tendência. Passe o mouse sobre cada ponto para ver o rótulo e os valores. Outliers destacados em vermelho.', 'pearson-dispersao.png');

      // Deferred Chart.js render so DOM is ready
      setTimeout(() => {
        renderScatterChart('corr-chart-pearson', dataset, pearson, result.outlierFlags || [], utils);
      }, 0);
      // Export handled globally by chart-manager canvas delegate
    }

    function runAnalysis() {
      const dataset = state.dataset;
      resetResultVisuals();

      if (!dataset.hasContent || dataset.errors.length) {
        els.error.innerHTML = '<div class="error-box">Leia um arquivo compatível ou cole a tabela no formato padrão antes de rodar a análise.</div>';
        return;
      }

      if (dataset.x.length < 4) {
        els.error.innerHTML = '<div class="error-box">Forneça ao menos 4 pares válidos para uma análise mais estável.</div>';
        return;
      }

      const pearson = stats.pearson(dataset.x, dataset.y);
      const spearman = stats.spearman(dataset.x, dataset.y);

      if (!Number.isFinite(pearson.coef) || !Number.isFinite(spearman.coef)) {
        els.error.innerHTML = '<div class="error-box">Não foi possível calcular a correlação. Revise se as colunas possuem variação suficiente.</div>';
        return;
      }

      const xOut = outlierMask(dataset.x);
      const yOut = outlierMask(dataset.y);
      const outlierFlags = xOut.map((flag, index) => flag || yOut[index]);
      const outlierLabels = dataset.labels.filter((_, index) => outlierFlags[index]);

      const result = {
        dataset,
        pearson,
        spearman,
        outlierFlags,
        outlierLabels,
        rankSummary: buildRankSummary(dataset, stats)
      };
      result.pearsonDiagnostics = buildPearsonDiagnostics(dataset, pearson, spearman, outlierFlags);
      result.spearmanDiagnostics = buildSpearmanDiagnostics(dataset, pearson, spearman, result.rankSummary);
      state.lastResult = result;
      renderMethodSpecificAnalysisResult(result);
    }

    function setActiveMethod(method) {
      state.activeMethod = method === 'spearman' ? 'spearman' : 'pearson';
      Array.from(root.querySelectorAll('[data-correlation-method]')).forEach(button => {
        const isActive = button.getAttribute('data-correlation-method') === state.activeMethod;
        button.classList.toggle('is-active', isActive);
        button.setAttribute('aria-selected', isActive ? 'true' : 'false');
      });
      if (state.lastResult) {
        renderMethodSpecificAnalysisResult(state.lastResult);
      }
    }

    function currentDatasusSession() {
      if (datasusState.session?.confirmedSources?.length) return datasusState.session;
      if (datasusState.sharedSession?.confirmedSources?.length) return datasusState.sharedSession;
      return null;
    }

    function confirmedSources() {
      return currentDatasusSession()?.confirmedSources || [];
    }

    function getSource(sourceId) {
      return confirmedSources().find(source => source.id === sourceId) || null;
    }

    function labelForPair(pair) {
      if (datasusState.labelMode === 'category') return pair.category || pair.label;
      if (datasusState.labelMode === 'time') return pair.time || pair.label;
      return pair.label;
    }

    function sharedTimeOptions(leftSource, rightSource) {
      const leftOptions = getTimeOptions(leftSource);
      const rightKeys = new Set(getTimeOptions(rightSource).map(option => option.key));
      return leftOptions.filter(option => rightKeys.has(option.key));
    }

    function availableTimeOptions() {
      const xSource = getSource(datasusState.xSourceId);
      const ySource = getSource(datasusState.ySourceId);
      if (!xSource || !ySource) return [];
      if (xSource.id === ySource.id) return getTimeOptions(xSource);
      return sharedTimeOptions(xSource, ySource);
    }

    function ensureDatasusDefaults() {
      const sources = confirmedSources();
      if (!sources.length) {
        datasusState.derived = null;
        datasusState.xSourceId = '';
        datasusState.ySourceId = '';
        datasusState.timeKey = '';
        return;
      }

      if (!sources.some(source => source.id === datasusState.xSourceId)) {
        datasusState.xSourceId = sources[0].id;
      }
      if (!sources.some(source => source.id === datasusState.ySourceId)) {
        datasusState.ySourceId = sources[1]?.id || sources[0].id;
      }

      sources.forEach(source => {
        if (!datasusState.metricBySource[source.id]) {
          datasusState.metricBySource[source.id] = getPrimaryMetricKey(source);
        }
      });

      const timeOptions = availableTimeOptions();
      if (timeOptions.length && !timeOptions.some(option => option.key === datasusState.timeKey)) {
        datasusState.timeKey = '';
      }
    }

    function deriveDatasusPairs() {
      ensureDatasusDefaults();
      const xSource = getSource(datasusState.xSourceId);
      const ySource = getSource(datasusState.ySourceId);

      if (!xSource || !ySource) {
        return {
          ok: false,
          primaryError: 'Confirme pelo menos uma base DATASUS para montar a correlacao.',
          errors: ['Confirme pelo menos uma base DATASUS para montar a correlacao.'],
          pairs: []
        };
      }

      return deriveCorrelationPairs({
        xSource,
        ySource,
        xMetricKey: datasusState.metricBySource[xSource.id],
        yMetricKey: datasusState.metricBySource[ySource.id],
        timeKeys: datasusState.timeKey ? [datasusState.timeKey] : [],
        stats
      });
    }

    function renderDatasusPreview() {
      if (isMissingElementRef(els.datasusPreview)) return;

      const derived = deriveDatasusPairs();
      datasusState.derived = derived;

      if (!derived.ok) {
        els.datasusPreview.innerHTML = `
          <div class="error-box">
            <strong>Base derivada ainda inválida.</strong>
            <ul class="datasus-inline-list">
              ${(derived.errors || [derived.primaryError || 'Não há pares válidos suficientes.']).map(item => `<li>${utils.escapeHtml(item)}</li>`).join('')}
            </ul>
          </div>
        `;
        return;
      }

      const rows = derived.pairs.map((pair, index) => [
        labelForPair(pair) || `Obs ${index + 1}`,
        utils.fmtNumber(pair.x, 3),
        utils.fmtNumber(pair.y, 3)
      ]);

      els.datasusPreview.innerHTML = `
        <div class="success-box">A base derivada está pronta para alimentar o módulo de correlação.</div>
        <div class="small-note" style="margin:14px 0 10px;">Cada linha abaixo corresponde a um par válido X/Y para Pearson e Spearman.</div>
        ${utils.renderPreviewTable(['ID', derived.xLabel || 'X', derived.yLabel || 'Y'], rows)}
      `;
    }

    function pushDatasusToCorrelation() {
      const derived = deriveDatasusPairs();
      datasusState.derived = derived;
      renderDatasusPreview();

      if (!derived.ok) {
        if (!isMissingElementRef(els.datasusControls)) {
          els.datasusControls.innerHTML = `<div class="error-box">${utils.escapeHtml(derived.primaryError || 'Não há pares válidos suficientes.')}</div>`;
        }
        return;
      }

      els.paste.value = [
        'id;variavel_x;variavel_y',
        ...derived.pairs.map((pair, index) => `${labelForPair(pair) || `Obs ${index + 1}`};${pair.x};${pair.y}`)
      ].join('\n');
      state.paste = els.paste.value;
      els.file.value = '';
      els.fileName.textContent = 'Nenhum arquivo selecionado.';
      readPastedData('Base derivada do DATASUS enviada para a análise.', 'success');
      runAnalysis();
    }

    function renderDatasusControls() {
      if (isMissingElementRef(els.datasusControls)) return;

      const sources = confirmedSources();
      if (!sources.length) {
        const hasShared = Boolean(shared?.datasus?.lastSession?.confirmedSources?.length);
        els.datasusControls.innerHTML = `
          <div class="status-bar">Confirme uma base DATASUS no wizard para liberar a derivação da correlação.</div>
          ${hasShared ? '<div class="actions-row" style="margin-top:14px;"><button type="button" class="btn-secondary" id="c-datasus-use-shared">Usar última sessão DATASUS confirmada</button></div>' : ''}
        `;
        if (!isMissingElementRef(els.datasusPreview)) {
          els.datasusPreview.innerHTML = '';
        }
        safeBind(els.datasusControls, '#c-datasus-use-shared', 'click', () => {
          datasusState.sharedSession = clonePlain(shared?.datasus?.lastSession || null);
          renderDatasusControls();
          renderDatasusPreview();
        }, { optional: true, label: 'usar sessao DATASUS compartilhada' });
        return;
      }

      ensureDatasusDefaults();
      const xSource = getSource(datasusState.xSourceId);
      const ySource = getSource(datasusState.ySourceId);
      const xMetrics = getMetricOptions(xSource);
      const yMetrics = getMetricOptions(ySource);
      const timeOptions = availableTimeOptions();

      els.datasusControls.innerHTML = `
        <div class="form-grid two" style="margin-bottom: 14px;">
          <div>
            <label for="c-datasus-context">Pergunta do estudo</label>
            <input id="c-datasus-context" type="text" value="${utils.escapeHtml(datasusState.context)}" />
          </div>
          <div>
            <label for="c-datasus-alpha">Nível de significância (p-valor)</label>
            <select id="c-datasus-alpha">
              <option value="0.01"${datasusState.alpha === '0.01' ? ' selected' : ''}>1%</option>
              <option value="0.05"${datasusState.alpha === '0.05' ? ' selected' : ''}>5%</option>
              <option value="0.10"${datasusState.alpha === '0.10' ? ' selected' : ''}>10%</option>
            </select>
          </div>
        </div>
        <div class="form-grid two">
          <div>
            <label for="c-datasus-x-source">Fonte X</label>
            <select id="c-datasus-x-source">
              ${sources.map(source => `<option value="${utils.escapeHtml(source.id)}"${source.id === datasusState.xSourceId ? ' selected' : ''}>${utils.escapeHtml(source.fileName)}</option>`).join('')}
            </select>
          </div>
          <div>
            <label for="c-datasus-y-source">Fonte Y</label>
            <select id="c-datasus-y-source">
              ${sources.map(source => `<option value="${utils.escapeHtml(source.id)}"${source.id === datasusState.ySourceId ? ' selected' : ''}>${utils.escapeHtml(source.fileName)}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="form-grid two" style="margin-top:14px;">
          <div>
            <label for="c-datasus-x-metric">Variavel X</label>
            <select id="c-datasus-x-metric">
              ${xMetrics.map(option => `<option value="${utils.escapeHtml(option.key)}"${option.key === datasusState.metricBySource[xSource.id] ? ' selected' : ''}>${utils.escapeHtml(option.label)}</option>`).join('')}
            </select>
          </div>
          <div>
            <label for="c-datasus-y-metric">Variavel Y</label>
            <select id="c-datasus-y-metric">
              ${yMetrics.map(option => `<option value="${utils.escapeHtml(option.key)}"${option.key === datasusState.metricBySource[ySource.id] ? ' selected' : ''}>${utils.escapeHtml(option.label)}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="form-grid two" style="margin-top:14px;">
          <div>
            <label for="c-datasus-time">Periodo</label>
            <select id="c-datasus-time">
              <option value="">Todos os periodos disponiveis</option>
              ${timeOptions.map(option => `<option value="${utils.escapeHtml(option.key)}"${option.key === datasusState.timeKey ? ' selected' : ''}>${utils.escapeHtml(option.label)}</option>`).join('')}
            </select>
          </div>
          <div>
            <label for="c-datasus-label-mode">Rotulo dos pares</label>
            <select id="c-datasus-label-mode">
              <option value="category"${datasusState.labelMode === 'category' ? ' selected' : ''}>Categoria</option>
              <option value="time"${datasusState.labelMode === 'time' ? ' selected' : ''}>Tempo</option>
              <option value="category-time"${datasusState.labelMode === 'category-time' ? ' selected' : ''}>Categoria + tempo</option>
            </select>
          </div>
        </div>
        <div class="actions-row" style="margin-top:14px;">
          <button type="button" class="btn" id="c-datasus-send">Enviar base derivada</button>
        </div>
      `;

      safeBind(els.datasusControls, '#c-datasus-x-source', 'change', event => {
        datasusState.xSourceId = event.target.value;
        ensureDatasusDefaults();
        renderDatasusControls();
        renderDatasusPreview();
      }, { label: 'fonte X DATASUS' });

      safeBind(els.datasusControls, '#c-datasus-y-source', 'change', event => {
        datasusState.ySourceId = event.target.value;
        ensureDatasusDefaults();
        renderDatasusControls();
        renderDatasusPreview();
      }, { label: 'fonte Y DATASUS' });

      safeBind(els.datasusControls, '#c-datasus-x-metric', 'change', event => {
        datasusState.metricBySource[xSource.id] = event.target.value;
        renderDatasusPreview();
      }, { label: 'metrica X DATASUS' });

      safeBind(els.datasusControls, '#c-datasus-y-metric', 'change', event => {
        datasusState.metricBySource[ySource.id] = event.target.value;
        renderDatasusPreview();
      }, { label: 'metrica Y DATASUS' });

      safeBind(els.datasusControls, '#c-datasus-time', 'change', event => {
        datasusState.timeKey = event.target.value;
        renderDatasusPreview();
      }, { label: 'periodo DATASUS' });

      safeBind(els.datasusControls, '#c-datasus-label-mode', 'change', event => {
        datasusState.labelMode = event.target.value;
        renderDatasusPreview();
      }, { label: 'modo de rotulo DATASUS' });

      safeBind(els.datasusControls, '#c-datasus-context', 'input', event => {
        datasusState.context = event.target.value;
      }, { label: 'contexto DATASUS' });

      safeBind(els.datasusControls, '#c-datasus-alpha', 'change', event => {
        datasusState.alpha = event.target.value;
      }, { label: 'alpha DATASUS' });

      safeBind(els.datasusControls, '#c-datasus-send', 'click', pushDatasusToCorrelation, { label: 'enviar base DATASUS ao modulo' });
    }

    function mountDatasusWizard() {
      if (isMissingElementRef(els.datasusWizard)) return;
      createDatasusWizard({
        root: els.datasusWizard,
        utils,
        stats,
        shared,
        onSessionChange(session) {
          datasusState.session = clonePlain(session);
          datasusState.sharedSession = clonePlain(shared?.datasus?.lastSession || null);
          renderDatasusControls();
          renderDatasusPreview();
        }
      });
    }

    safeBind(root, '#c-file', 'change', async event => {
      const file = event.target.files?.[0];
      if (!file) return;
      await readSelectedFile(file);
    }, { label: 'importar arquivo' });
    safeBind(root, '#c-use-example', 'click', loadExample, { label: 'usar exemplo' });
    safeBind(root, '#c-clear', 'click', clearAll, { label: 'limpar dados' });
    safeBind(root, '#c-run-analysis', 'click', runAnalysis, { label: 'rodar análise' });
    safeBindAll(root, '[data-correlation-method]', 'click', event => {
      setActiveMethod(event.currentTarget.getAttribute('data-correlation-method'));
    }, { label: 'alternância Pearson/Spearman' });

    safeBind(root, '#c-context', 'input', event => {
      state.context = event.target.value;
    }, { label: 'contexto manual' });

    safeBind(root, '#c-alpha', 'change', event => {
      state.alpha = event.target.value;
    }, { label: 'alpha manual' });

    const pasteEl = els.paste;
    if (pasteEl) {
      pasteEl.addEventListener('input', () => {
        state.paste = pasteEl.value;
      });
      pasteEl.addEventListener('paste', () => {
        // Delay slightly to let the browser populate the textarea
        setTimeout(() => {
          state.paste = pasteEl.value;
          readPastedData(pasteEl.value, 'Dados colados! Clique em "Rodar análise" ou aguarde.', 'success');
          if (state.dataset.hasContent) runAnalysis();
        }, 30);
      });
    }

    renderPreview();

    if (state.dataset.hasContent) {
      setIntakeStatus('success', 'Base restaurada da sessão anterior. Clique em "Rodar análise" se necessário.');
    } else {
      resetResultVisuals();
      setIntakeStatus('status', 'Escolha um arquivo ou cole a tabela para ler os dados.');
    }

    setActiveMethod(state.activeMethod || 'pearson');

    if (state.dataset.hasContent && state.lastResult) {
      setTimeout(() => {
        runAnalysis();
      }, 10);
    }

    if (els.wizardContainer) {
      const modal = root.querySelector('#c-wizard-modal');
      const openBtn = root.querySelector('#c-open-wizard');
      if (openBtn && modal) {
        openBtn.addEventListener('click', () => modal.showModal());
      }

      createCorrelationWizard(els.wizardContainer, (method) => {
        const methodBtn = root.querySelector(`[data-correlation-method="${method}"]`);
        if (methodBtn) methodBtn.click();

        if (modal) modal.close();
        if (state.dataset && state.dataset.hasContent) {
          runAnalysis();
        }
      });
    }
  } catch (error) {
    console.error('[correlacao] Falha ao renderizar o modulo.', error);
    root.innerHTML = `
      <div class="module-grid correlacao-module">
        <section class="surface-card">
          <h4>Modulo indisponivel no momento</h4>
          <p class="small-note">Nao foi possivel montar a interface de correlacao agora. Atualize a pagina e tente novamente.</p>
        </section>
      </div>
    `;
  }
}
