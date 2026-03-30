import {
  buildRecognizedColumnsChips,
  describeIgnoredRowReason,
  normalizeTabularSpaces,
  parseTabularNumber,
  readTabularFileState,
  readTabularPasteState
} from '../../assets/js/tabular-data-input.js';
import {
  buildChartContainer,
  renderTimeseriesChart,
  renderResidualChart
} from '../../assets/js/chart-manager.js';

const PRAIS_FORMAT_LABEL = 'variavel_1;variavel_2';
const PRAIS_LEGACY_FORMAT_LABEL = 'id;tempo;variavel_y;observacao_opcional';
const PRAIS_HEADER_ALIASES = {
  id: ['id', 'unidade', 'uf', 'serie', 'série', 'nome', 'local'],
  tempo: ['tempo', 'ano', 'year', 'periodo', 'período', 'x', 'variavel_x', 'variável_x'],
  variavel_y: ['variavel_y', 'variável_y', 'variavel y', 'variável y', 'y', 'taxa', 'valor', 'desfecho'],
  observacao_opcional: ['observacao', 'observação', 'obs', 'comentario', 'comentário']
};
PRAIS_HEADER_ALIASES.tempo.push('variavel_1', 'variavel 1', 'variavel1');
PRAIS_HEADER_ALIASES.variavel_y.push('variavel_2', 'variavel 2', 'variavel2', 'indicador', 'internacoes', 'internaÃ§Ãµes');
const PRAIS_FIELD_LABELS = {
  id: 'ID',
  tempo: 'Tempo',
  variavel_y: 'Variavel Y',
  observacao_opcional: 'Observacao opcional'
};
PRAIS_FIELD_LABELS.tempo = 'Variavel 1';
PRAIS_FIELD_LABELS.variavel_y = 'Variavel 2';
const PRAIS_RECOGNIZED_ORDER = [
  { key: 'id', label: PRAIS_FIELD_LABELS.id },
  { key: 'tempo', label: PRAIS_FIELD_LABELS.tempo },
  { key: 'variavel_y', label: PRAIS_FIELD_LABELS.variavel_y },
  { key: 'observacao_opcional', label: PRAIS_FIELD_LABELS.observacao_opcional }
];
PRAIS_RECOGNIZED_ORDER.length = 0;
PRAIS_RECOGNIZED_ORDER.push(
  { key: 'tempo', label: PRAIS_FIELD_LABELS.tempo },
  { key: 'variavel_y', label: PRAIS_FIELD_LABELS.variavel_y }
);
const PRAIS_POSITION_FALLBACK = {
  keysByIndex: ['tempo', 'variavel_y', 'observacao_opcional'],
  minColumns: 2,
  requiredKeys: ['tempo', 'variavel_y'],
  introText: 'Não reconhecemos os nomes padrão das colunas. Usamos a estrutura da planilha por posição: 1ª coluna = variável 1, 2ª = variável 2.',
  headerText: 'Os nomes reais do cabeçalho foram mantidos na interface.',
  failureMessage: 'Não conseguimos identificar automaticamente as colunas nem usar a estrutura por posição.',
  minimumColumnsText: 'Esperávamos pelo menos 2 colunas úteis: variável 1 e variável 2.',
  consistencyText: 'A primeira linha precisa funcionar como cabeçalho, a 1ª coluna deve representar tempo/ordem e a 2ª coluna precisa conter valores numéricos válidos.',
  compatibilityValidators: {
    tempo: (raw, runtimeStats) => parseTemporalValue(raw, runtimeStats).numeric !== null
  }
};
const PRAIS_LEGACY_POSITION_FALLBACK = {
  keysByIndex: ['id', 'tempo', 'variavel_y', 'observacao_opcional'],
  minColumns: 3,
  requiredKeys: ['tempo', 'variavel_y'],
  introText: 'Não reconhecemos os nomes padrão das colunas. Aplicamos a compatibilidade legada por posição: 1ª coluna = identificador, 2ª = variável 1 e 3ª = variável 2.',
  headerText: 'Os nomes reais do cabeçalho foram mantidos na interface.',
  failureMessage: 'Não conseguimos identificar automaticamente as colunas nem usar a estrutura por posição.',
  minimumColumnsText: 'Esperávamos pelo menos 3 colunas úteis para a compatibilidade legada: identificador, variável 1 e variável 2.',
  consistencyText: 'A primeira linha precisa funcionar como cabeçalho, a 2ª coluna deve representar tempo/ordem e a 3ª coluna precisa conter valores numéricos válidos.',
  compatibilityValidators: {
    tempo: (raw, runtimeStats) => parseTemporalValue(raw, runtimeStats).numeric !== null
  }
};
const PRAIS_TABULAR_OPTIONS = {
  aliases: PRAIS_HEADER_ALIASES,
  requiredKeys: ['tempo', 'variavel_y'],
  numericKeys: ['tempo', 'variavel_y'],
  expectedFormatLabel: PRAIS_FORMAT_LABEL,
  positionFallback: PRAIS_POSITION_FALLBACK
};
const PRAIS_LEGACY_TABULAR_OPTIONS = {
  aliases: PRAIS_HEADER_ALIASES,
  requiredKeys: ['tempo', 'variavel_y'],
  numericKeys: ['tempo', 'variavel_y'],
  expectedFormatLabel: PRAIS_LEGACY_FORMAT_LABEL,
  positionFallback: PRAIS_LEGACY_POSITION_FALLBACK
};
const MIN_TEMPORAL_POINTS = 5;

function buildExampleHeaders(config) {
  const headers = Array.isArray(config?.exampleHeaders) ? config.exampleHeaders : [];
  return [
    String(headers[0] || 'variavel_1'),
    String(headers[1] || 'variavel_2')
  ];
}

function buildExampleRows(config) {
  const rows = Array.isArray(config?.exampleRows) ? config.exampleRows : [];
  if (!rows.length) {
    return [
      ['2015', '120,4'],
      ['2016', '125,8'],
      ['2017', '130,2']
    ];
  }

  return rows.map(row => {
    const tempo = row?.[0] ?? '';
    const valor = row?.[1] ?? '';
    return [String(tempo), String(valor)];
  });
}

function buildExampleText(config) {
  const headers = buildExampleHeaders(config);
  const rows = buildExampleRows(config);
  return [
    headers.join(';'),
    ...rows.map(row => row.join(';'))
  ].join('\n');
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

function formatDetectedColumnMessage(label, value, utils) {
  return `${label}: ${utils.escapeHtml(value || 'Não identificado')}`;
}

function buildDetectedColumnsCallout(dataset, utils) {
  const hasDetectedColumns = Boolean(
    dataset.recognizedColumns?.tempo
    || dataset.recognizedColumns?.variavel_y
  );
  if (!hasDetectedColumns && !dataset.usedPositionalFallback) return '';

  const details = [
    formatDetectedColumnMessage('Variavel 1 identificada', dataset.timeHeaderLabel, utils),
    formatDetectedColumnMessage('Variavel 2 identificada', dataset.yHeaderLabel, utils)
  ];

  if (dataset.usedPositionalFallback) {
    return `
      <div class="success-box">
        <strong>${utils.escapeHtml(dataset.recognitionDetails?.[0] || 'Não reconhecemos os nomes padrão das colunas. Usamos a estrutura da planilha por posição: 1ª coluna = variável 1, 2ª = variável 2.')}</strong>
        <div class="small-note" style="margin-top:8px;">${details.join(' &middot; ')}</div>
      </div>
    `;
  }

  return `<div class="status-bar">${details.join(' &middot; ')}</div>`;
}

function parseTemporalValue(raw, stats) {
  const cleaned = normalizeTabularSpaces(raw);
  if (!cleaned) {
    return {
      raw: '',
      label: '',
      numeric: null,
      sortKey: '',
      timeType: 'missing'
    };
  }

  const direct = parseTabularNumber(cleaned, stats);
  if (direct !== null) {
    return {
      raw: cleaned,
      label: cleaned,
      numeric: direct,
      sortKey: `num:${direct}`,
      timeType: Number.isInteger(direct) ? 'integer' : 'numeric'
    };
  }

  const compact = cleaned.replace(/\s+/g, '');
  if (/^(18|19|20)\d{2}$/.test(compact)) {
    return {
      raw: cleaned,
      label: compact,
      numeric: Number(compact),
      sortKey: `year:${compact}`,
      timeType: 'year'
    };
  }

  let match = compact.match(/^((18|19|20)\d{2})[-/](0?[1-9]|1[0-2])$/);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[3]);
    return {
      raw: cleaned,
      label: `${year}-${String(month).padStart(2, '0')}`,
      numeric: year + ((month - 1) / 12),
      sortKey: `${year}-${String(month).padStart(2, '0')}`,
      timeType: 'year-month'
    };
  }

  match = compact.match(/^(0?[1-9]|1[0-2])[-/]((18|19|20)\d{2})$/);
  if (match) {
    const month = Number(match[1]);
    const year = Number(match[2]);
    return {
      raw: cleaned,
      label: `${year}-${String(month).padStart(2, '0')}`,
      numeric: year + ((month - 1) / 12),
      sortKey: `${year}-${String(month).padStart(2, '0')}`,
      timeType: 'month-year'
    };
  }

  return {
    raw: cleaned,
    label: cleaned,
    numeric: null,
    sortKey: '',
    timeType: 'invalid'
  };
}

function formatConvertedTime(value, utils) {
  if (value === null || value === undefined) return '-';
  const whole = Math.abs(value - Math.round(value)) < 1e-9;
  return utils.fmtNumber(value, whole ? 0 : 3);
}

function formatConvertedY(value, utils) {
  if (value === null || value === undefined) return '-';
  const digits = Math.abs(value) >= 100 ? 1 : 3;
  return utils.fmtNumber(value, digits);
}

function trendStrength(apc) {
  const abs = Math.abs(apc);
  if (abs < 1) return 'muito discreta';
  if (abs < 3) return 'leve';
  if (abs < 6) return 'moderada';
  return 'marcante';
}

function buildEmptyPraisDataset(sourceKind = 'paste', sourceLabel = 'Dados colados') {
  return {
    sourceKind,
    sourceLabel,
    hasContent: false,
    rows: [],
    validRows: [],
    orderedRows: [],
    ignoredRows: [],
    time: [],
    values: [],
    previewHeaders: {
      id: PRAIS_FIELD_LABELS.id,
      tempo: PRAIS_FIELD_LABELS.tempo,
      y: PRAIS_FIELD_LABELS.variavel_y,
      observation: PRAIS_FIELD_LABELS.observacao_opcional
    },
    idHeaderLabel: PRAIS_FIELD_LABELS.id,
    timeHeaderLabel: PRAIS_FIELD_LABELS.tempo,
    yHeaderLabel: PRAIS_FIELD_LABELS.variavel_y,
    observationHeaderLabel: PRAIS_FIELD_LABELS.observacao_opcional,
    recognizedColumns: {},
    recognitionMode: 'none',
    usedPositionalFallback: false,
    recognitionDetails: [],
    uniqueIds: [],
    errors: [],
    warnings: [],
    infos: [],
    reordered: false,
    duplicateTimes: [],
    fileMeta: null,
    periodLabel: '',
    timeTypeSummary: '',
    validCount: 0
  };
}

function buildPraisDatasetFromTabularState(fileState, stats, sourceMeta = {}) {
  const {
    sourceKind = fileState?.sourceType || 'paste',
    sourceLabel = sourceKind === 'file' ? 'Arquivo importado' : 'Dados colados'
  } = sourceMeta;

  if (!fileState || fileState.status !== 'loaded') {
    const dataset = buildEmptyPraisDataset(sourceKind, sourceLabel);
    if (fileState?.message) dataset.errors.push(fileState.message);
    if (Array.isArray(fileState?.details)) dataset.infos.push(...fileState.details);
    dataset.hasContent = Boolean(fileState?.message);
    return dataset;
  }

  const recognizedColumns = fileState.recognizedColumns || {};
  const bodyRows = Array.isArray(fileState.bodyRows) ? fileState.bodyRows : [];
  const mappedRows = bodyRows.map((row, index) => ({
    index: index + 1,
    idRaw: recognizedColumns.id ? row[recognizedColumns.id.index] || '' : '',
    timeRaw: recognizedColumns.tempo ? row[recognizedColumns.tempo.index] || '' : '',
    yRaw: recognizedColumns.variavel_y ? row[recognizedColumns.variavel_y.index] || '' : '',
    observationRaw: recognizedColumns.observacao_opcional ? row[recognizedColumns.observacao_opcional.index] || '' : ''
  }));

  const hasContent = mappedRows.some(row => (
    normalizeTabularSpaces(row.idRaw)
    || normalizeTabularSpaces(row.timeRaw)
    || normalizeTabularSpaces(row.yRaw)
    || normalizeTabularSpaces(row.observationRaw)
  ));

  const dataset = {
    ...buildEmptyPraisDataset(sourceKind, sourceLabel),
    hasContent,
    recognizedColumns,
    previewHeaders: {
      id: recognizedColumns.id?.header || PRAIS_FIELD_LABELS.id,
      tempo: recognizedColumns.tempo?.header || PRAIS_FIELD_LABELS.tempo,
      y: recognizedColumns.variavel_y?.header || PRAIS_FIELD_LABELS.variavel_y,
      observation: recognizedColumns.observacao_opcional?.header || PRAIS_FIELD_LABELS.observacao_opcional
    },
    idHeaderLabel: recognizedColumns.id?.header || PRAIS_FIELD_LABELS.id,
    timeHeaderLabel: recognizedColumns.tempo?.header || PRAIS_FIELD_LABELS.tempo,
    yHeaderLabel: recognizedColumns.variavel_y?.header || PRAIS_FIELD_LABELS.variavel_y,
    observationHeaderLabel: recognizedColumns.observacao_opcional?.header || PRAIS_FIELD_LABELS.observacao_opcional,
    recognitionMode: fileState.recognitionMode || 'aliases',
    usedPositionalFallback: Boolean(fileState.usedPositionalFallback),
    recognitionDetails: Array.isArray(fileState.recognitionDetails) ? fileState.recognitionDetails : [],
    fileMeta: {
      fileName: fileState.fileName,
      tableName: fileState.tableName,
      formatLabel: fileState.formatLabel,
      delimiter: fileState.delimiter,
      headerRowIndex: fileState.headerRowIndex
    }
  };

  if (!hasContent) {
    dataset.infos.push('Nenhuma linha preenchida foi identificada após o cabeçalho.');
    return dataset;
  }

  if (!recognizedColumns.tempo) {
    dataset.errors.push('Não encontramos uma coluna compatível com tempo/ano.');
  }
  if (!recognizedColumns.variavel_y) {
    dataset.errors.push('Não encontramos uma coluna compatível com variável y/desfecho.');
  }

  const timeTypeCount = new Map();

  mappedRows.forEach(row => {
    const idRaw = normalizeTabularSpaces(row.idRaw);
    const timeRaw = normalizeTabularSpaces(row.timeRaw);
    const yRaw = normalizeTabularSpaces(row.yRaw);
    const observationRaw = normalizeTabularSpaces(row.observationRaw);
    const timeInfo = parseTemporalValue(timeRaw, stats);
    const yValue = parseTabularNumber(yRaw, stats);
    const rowLabel = idRaw || `Linha ${row.index}`;
    const notes = [];
    let statusLabel = 'Ignorada';
    let statusTone = 'ignored';

    if (!timeRaw) {
      notes.push('a coluna temporal está vazia.');
    } else if (timeInfo.numeric === null) {
      notes.push('tempo não contém valor numérico ou ordenável válido.');
    }

    if (!yRaw) {
      notes.push('variavel_y está vazia.');
    } else if (yValue === null) {
      notes.push('a variável y não contém valor numérico válido.');
    } else if (yValue <= 0) {
      notes.push('a variável y precisa ser maior que zero para o modelo log10.');
    }

    if (timeInfo.numeric !== null && yValue !== null && yValue > 0) {
      statusLabel = 'Válida';
      statusTone = 'valid';
      dataset.validRows.push({
        index: row.index,
        idLabel: rowLabel,
        idRaw,
        timeRaw,
        timeLabel: timeInfo.label || timeRaw,
        timeValue: timeInfo.numeric,
        timeSortKey: timeInfo.sortKey,
        yRaw,
        yValue,
        observationRaw,
        timeType: timeInfo.timeType
      });
      dataset.time.push(timeInfo.numeric);
      dataset.values.push(yValue);
      timeTypeCount.set(timeInfo.timeType, (timeTypeCount.get(timeInfo.timeType) || 0) + 1);
    }

    dataset.rows.push({
      index: row.index,
      idLabel: rowLabel,
      timeRaw,
      yRaw,
      timeValue: timeInfo.numeric,
      yValue,
      observationRaw,
      statusLabel,
      statusTone,
      notes
    });
  });

  dataset.ignoredRows = dataset.rows.filter(row => row.statusTone === 'ignored');
  dataset.validCount = dataset.validRows.length;
  dataset.orderedRows = [...dataset.validRows]
    .sort((left, right) => {
      if (left.timeValue !== right.timeValue) return left.timeValue - right.timeValue;
      return left.index - right.index;
    });
  dataset.reordered = dataset.validRows.some((row, index) => row.index !== dataset.orderedRows[index]?.index);
  dataset.time = dataset.orderedRows.map(row => row.timeValue);
  dataset.values = dataset.orderedRows.map(row => row.yValue);

  const duplicateMap = new Map();
  dataset.orderedRows.forEach(row => {
    const list = duplicateMap.get(row.timeSortKey) || [];
    list.push(row.timeLabel);
    duplicateMap.set(row.timeSortKey, list);
  });
  dataset.duplicateTimes = [...duplicateMap.values()]
    .filter(list => list.length > 1)
    .map(list => list[0]);

  if (dataset.duplicateTimes.length) {
    dataset.errors.push(`Há tempos repetidos na série (${dataset.duplicateTimes.slice(0, 4).join(', ')}${dataset.duplicateTimes.length > 4 ? ', ...' : ''}). Mantenha um único valor por tempo.`);
  }

  if (recognizedColumns.id) {
    dataset.uniqueIds = [...new Set(dataset.validRows.map(row => row.idRaw).filter(Boolean))];
    if (dataset.uniqueIds.length > 1) {
      dataset.errors.push(`Foram encontrados ${dataset.uniqueIds.length} IDs distintos. O Prais-Winsten deve analisar uma única série por vez.`);
    }
  }

  if (dataset.validRows.length) {
    const first = dataset.orderedRows[0];
    const last = dataset.orderedRows[dataset.orderedRows.length - 1];
    dataset.periodLabel = first.timeLabel === last.timeLabel
      ? first.timeLabel
      : `${first.timeLabel} a ${last.timeLabel}`;
  }

  if (fileState.delimiter === ';') {
    dataset.infos.push(`${sourceKind === 'file' ? 'Arquivo' : 'Conteúdo colado'} lido no padrão ponto e vírgula (;).`);
  } else if (fileState.delimiter === '\t') {
    dataset.infos.push('Conteúdo tabulado do Excel interpretado automaticamente.');
  } else if (fileState.delimiter === ',') {
    dataset.infos.push('Arquivo CSV/TXT com vírgulas estruturais interpretado automaticamente.');
  }

  if (fileState.decimalCommaDetected) {
    dataset.infos.push('Números com vírgula decimal foram convertidos automaticamente.');
  }
  if (dataset.usedPositionalFallback) {
    dataset.infos.push(...dataset.recognitionDetails);
  }

  if (recognizedColumns.tempo) {
    dataset.infos.push(`Tempo identificado: ${recognizedColumns.tempo.header}.`);
  }
  if (recognizedColumns.variavel_y) {
    dataset.infos.push(`Variavel Y identificada: ${recognizedColumns.variavel_y.header}.`);
  }
  if (recognizedColumns.id) {
    dataset.infos.push(`ID identificado: ${recognizedColumns.id.header}.`);
  } else {
    dataset.infos.push('Nenhuma coluna de ID foi reconhecida; a prévia usa a ordem das linhas como referência.');
  }

  if (dataset.reordered) {
    dataset.infos.push('A série foi ordenada crescentemente por tempo para a análise.');
  }

  if (fileState.duplicates?.length) {
    dataset.warnings.push(`Cabeçalhos duplicados foram ignorados: ${fileState.duplicates.join(', ')}.`);
  }

  dataset.ignoredRows
    .slice(0, 3)
    .forEach(row => dataset.warnings.push(describeIgnoredRowReason(row.index, row.notes)));
  const remainingIgnored = dataset.ignoredRows.length - 3;
  if (remainingIgnored > 0) {
    dataset.warnings.push(`Outras ${remainingIgnored} linhas também foram ignoradas por problemas em tempo ou variável y.`);
  }

  if (dataset.validRows.length > 0 && dataset.validRows.length < MIN_TEMPORAL_POINTS) {
    dataset.warnings.push(`A série tem ${dataset.validRows.length} pontos válidos. Recomenda-se pelo menos ${MIN_TEMPORAL_POINTS} para maior estabilidade.`);
  }

  const dominantTimeType = [...timeTypeCount.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] || '';
  if (dominantTimeType === 'year') dataset.timeTypeSummary = 'anos';
  else if (dominantTimeType === 'year-month' || dominantTimeType === 'month-year') dataset.timeTypeSummary = 'competências mensais';
  else if (dominantTimeType) dataset.timeTypeSummary = 'valores numéricos ordenáveis';
  if (dataset.timeTypeSummary) {
    dataset.infos.push(`A variável temporal foi interpretada como ${dataset.timeTypeSummary}.`);
  }

  dataset.rows.forEach(row => {
    row.notes = row.notes.map(note => String(note)
      .replace(/^variavel_y\b/, 'a variavel 2')
      .replace(/^a variável y\b/, 'a variavel 2'));
  });
  dataset.errors = dataset.errors.map(message => String(message)
    .replace('tempo/ano', 'a variavel 1/tempo')
    .replace('variável y/desfecho', 'a variavel 2/desfecho'));
  dataset.warnings = dataset.warnings.map(message => String(message)
    .replace('tempo ou variável y', 'variavel 1 ou variavel 2'));
  dataset.infos = dataset.infos
    .filter(message => !String(message).includes('Nenhuma coluna de ID foi reconhecida'))
    .map(message => String(message)
      .replace('Tempo identificado:', 'Variavel 1 identificada:')
      .replace('Variavel Y identificada:', 'Variavel 2 identificada:')
      .replace('ID identificado:', 'Coluna adicional reconhecida como identificador:')
      .replace('A variável temporal foi interpretada como', 'A variavel 1 foi interpretada como'));

  return dataset;
}

function buildPraisPreviewTable(dataset, utils) {
  const rows = dataset.rows;
  const timeHeader = dataset.previewHeaders?.tempo || 'tempo';
  const yHeader = dataset.previewHeaders?.y || 'variavel_y';

  return `
    <div class="preview-table-wrap">
      <table class="preview-table prais-preview-table">
        <thead>
          <tr>
            <th>${utils.escapeHtml(timeHeader)} bruto</th>
            <th>${utils.escapeHtml(yHeader)} bruto</th>
            <th>${utils.escapeHtml(timeHeader)} convertido</th>
            <th>${utils.escapeHtml(yHeader)} convertido</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${rows.length ? rows.map(row => `
            <tr class="${row.statusTone === 'ignored' ? 'prais-preview-row-ignored' : 'prais-preview-row-valid'}">
              <td>${utils.escapeHtml(row.timeRaw || '-')}</td>
              <td>${utils.escapeHtml(row.yRaw || '-')}</td>
              <td>${formatConvertedTime(row.timeValue, utils)}</td>
              <td>${formatConvertedY(row.yValue, utils)}</td>
              <td>
                <div class="prais-preview-status">
                  <strong>${utils.escapeHtml(row.statusLabel)}</strong>
                  ${row.notes.length ? `<small>${utils.escapeHtml(row.notes.join(' '))}</small>` : ''}
                </div>
              </td>
            </tr>
          `).join('') : '<tr><td colspan="5">Nenhum dado interpretado ainda.</td></tr>'}
        </tbody>
      </table>
    </div>
  `;
}

function buildDerivedSeriesTable(dataset, utils) {
  if (!dataset.orderedRows.length) {
    return '<div class="small-note">A série final aparecerá aqui após a leitura dos dados.</div>';
  }

  const rows = dataset.orderedRows.map(row => [
    row.timeLabel,
    formatConvertedY(row.yValue, utils)
  ]);

  return `
    <div class="small-note" style="margin-bottom:10px;">
      Série pronta para análise em ordem temporal${dataset.reordered ? ' (reordenada automaticamente)' : ''}.
    </div>
    ${utils.renderPreviewTable([dataset.timeHeaderLabel, dataset.yHeaderLabel], rows)}
  `;
}

function buildFormatPreview(config, utils) {
  const exampleHeaders = buildExampleHeaders(config);
  const exampleRows = buildExampleRows(config).slice(0, 4);
  return `
    <div class="prais-format-box">
      <div class="small-note">Formato recomendado: <strong>${utils.escapeHtml(PRAIS_FORMAT_LABEL)}</strong></div>
      <div class="preview-table-wrap" style="margin-top:12px;">
        <table class="preview-table">
          <thead>
            <tr>
              <th>${utils.escapeHtml(exampleHeaders[0])}</th>
              <th>${utils.escapeHtml(exampleHeaders[1])}</th>
            </tr>
          </thead>
          <tbody>
            ${exampleRows.map(row => `<tr>${row.map(value => `<td>${utils.escapeHtml(value || '-')}</td>`).join('')}</tr>`).join('')}
          </tbody>
        </table>
      </div>
      <div class="small-note" style="margin-top:12px;">
        Tempo é a variável independente. Variável y é o desfecho. ID entra apenas como rótulo da série.
      </div>
    </div>
  `;
}

function buildMainTrendSvg(time, observed, fitted, pointLabels, axisLabels, utils) {
  const width = 920;
  const height = 430;
  const margin = { top: 26, right: 26, bottom: 72, left: 82 };
  const xMin = Math.min(...time);
  const xMax = Math.max(...time);
  const yMinRaw = Math.min(...observed, ...fitted);
  const yMaxRaw = Math.max(...observed, ...fitted);
  const yPad = yMinRaw === yMaxRaw ? 1 : (yMaxRaw - yMinRaw) * 0.12;
  const yMin = Math.max(0, yMinRaw - yPad);
  const yMax = yMaxRaw + yPad;
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;
  const xToPx = x => margin.left + ((x - xMin) / (xMax - xMin || 1)) * innerW;
  const yToPx = y => height - margin.bottom - ((y - yMin) / (yMax - yMin || 1)) * innerH;
  const steps = Math.min(6, Math.max(4, time.length));
  const yTicks = Array.from({ length: 5 }, (_, index) => yMin + ((yMax - yMin) * index) / 4);
  const xTicks = Array.from({ length: steps }, (_, index) => xMin + ((xMax - xMin) * index) / (steps - 1 || 1));
  const obsPath = observed.map((value, index) => `${index === 0 ? 'M' : 'L'} ${xToPx(time[index]).toFixed(2)} ${yToPx(value).toFixed(2)}`).join(' ');
  const fitPath = fitted.map((value, index) => `${index === 0 ? 'M' : 'L'} ${xToPx(time[index]).toFixed(2)} ${yToPx(value).toFixed(2)}`).join(' ');

  return `
    <svg viewBox="0 0 ${width} ${height}" class="timeseries-svg" role="img" aria-label="Série temporal com tendência ajustada">
      <rect x="0" y="0" width="${width}" height="${height}" rx="20" fill="#ffffff"/>
      ${xTicks.map(tick => `
        <g>
          <line x1="${xToPx(tick).toFixed(2)}" y1="${margin.top}" x2="${xToPx(tick).toFixed(2)}" y2="${height - margin.bottom}" stroke="#edf2fb"/>
          <text x="${xToPx(tick).toFixed(2)}" y="${height - margin.bottom + 24}" text-anchor="middle" fill="#60728d" font-size="12">${formatConvertedTime(tick, utils)}</text>
        </g>`).join('')}
      ${yTicks.map(tick => `
        <g>
          <line x1="${margin.left}" y1="${yToPx(tick).toFixed(2)}" x2="${width - margin.right}" y2="${yToPx(tick).toFixed(2)}" stroke="#dbe5f4" stroke-dasharray="4 6"/>
          <text x="${margin.left - 14}" y="${(yToPx(tick) + 4).toFixed(2)}" text-anchor="end" fill="#60728d" font-size="12">${utils.fmtNumber(tick, 1)}</text>
        </g>`).join('')}
      <line x1="${margin.left}" y1="${height - margin.bottom}" x2="${width - margin.right}" y2="${height - margin.bottom}" stroke="#89a0bc"/>
      <line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${height - margin.bottom}" stroke="#89a0bc"/>
      <path d="${obsPath}" fill="none" stroke="#2563eb" stroke-width="3" stroke-linecap="round"/>
      <path d="${fitPath}" fill="none" stroke="#0f766e" stroke-width="3" stroke-linecap="round" stroke-dasharray="10 6"/>
      ${observed.map((value, index) => `<circle cx="${xToPx(time[index]).toFixed(2)}" cy="${yToPx(value).toFixed(2)}" r="4.8" fill="#2563eb" stroke="#ffffff" stroke-width="2"><title>${utils.escapeHtml(pointLabels[index])}: ${utils.fmtNumber(value, 2)}</title></circle>`).join('')}
      <text x="${width / 2}" y="${height - 20}" text-anchor="middle" fill="#364b65" font-size="13">${utils.escapeHtml(axisLabels.x)}</text>
      <text x="24" y="${height / 2}" text-anchor="middle" transform="rotate(-90 24 ${height / 2})" fill="#364b65" font-size="13">${utils.escapeHtml(axisLabels.y)}</text>
    </svg>
  `;
}

function buildResidualSvg(time, residuals, pointLabels, axisLabels, utils) {
  const width = 920;
  const height = 320;
  const margin = { top: 24, right: 26, bottom: 62, left: 82 };
  const xMin = Math.min(...time);
  const xMax = Math.max(...time);
  const rMin = Math.min(...residuals, 0);
  const rMax = Math.max(...residuals, 0);
  const pad = rMin === rMax ? 0.2 : (rMax - rMin) * 0.18;
  const yMin = rMin - pad;
  const yMax = rMax + pad;
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;
  const xToPx = x => margin.left + ((x - xMin) / (xMax - xMin || 1)) * innerW;
  const yToPx = y => height - margin.bottom - ((y - yMin) / (yMax - yMin || 1)) * innerH;
  const path = residuals.map((value, index) => `${index === 0 ? 'M' : 'L'} ${xToPx(time[index]).toFixed(2)} ${yToPx(value).toFixed(2)}`).join(' ');
  const zeroY = yToPx(0).toFixed(2);

  return `
    <svg viewBox="0 0 ${width} ${height}" class="timeseries-svg" role="img" aria-label="Resíduos ao longo do tempo">
      <rect x="0" y="0" width="${width}" height="${height}" rx="20" fill="#ffffff"/>
      <line x1="${margin.left}" y1="${zeroY}" x2="${width - margin.right}" y2="${zeroY}" stroke="#94a3b8" stroke-dasharray="6 4"/>
      <path d="${path}" fill="none" stroke="#7c3aed" stroke-width="2.8"/>
      ${residuals.map((value, index) => `<circle cx="${xToPx(time[index]).toFixed(2)}" cy="${yToPx(value).toFixed(2)}" r="4.2" fill="#7c3aed" stroke="#fff" stroke-width="1.6"><title>${utils.escapeHtml(pointLabels[index])}: ${utils.fmtSigned(value, 4)}</title></circle>`).join('')}
      <text x="${width / 2}" y="${height - 16}" text-anchor="middle" fill="#364b65" font-size="13">${utils.escapeHtml(axisLabels.x)}</text>
      <text x="24" y="${height / 2}" text-anchor="middle" transform="rotate(-90 24 ${height / 2})" fill="#364b65" font-size="13">${utils.escapeHtml(axisLabels.y)}</text>
    </svg>
  `;
}

function buildInterpretation(model, dataset, context, alpha) {
  const alphaValue = parseFloat(alpha) || 0.05;
  const pText = model.p < alphaValue ? 'com evidência estatística' : 'sem evidência estatística robusta';
  const directionText = model.classification === 'crescente'
    ? 'os valores tenderam a aumentar ao longo do período'
    : model.classification === 'decrescente'
      ? 'os valores tenderam a diminuir ao longo do período'
      : 'não houve mudança consistente ao longo do período';
  const idText = dataset.uniqueIds.length === 1
    ? ` para ${dataset.idHeaderLabel} = ${dataset.uniqueIds[0]}`
    : '';
  return `Analisou-se a tendência temporal de ${dataset.yHeaderLabel}${idText}, usando ${dataset.timeHeaderLabel} como eixo temporal, em ${dataset.periodLabel || 'todo o período disponível'}, com ${dataset.validRows.length} pontos válidos. A série foi classificada como ${model.classification}, ${pText}; em termos práticos, ${directionText}. Contexto informado: ${context || 'tendência temporal do indicador'}.`;
}

function buildResidualSummaryRows(orderedRows, fitted, residuals) {
  return orderedRows.map((row, index) => ({
    idLabel: row.idLabel,
    timeLabel: row.timeLabel,
    observed: row.yValue,
    fitted: fitted[index],
    residual: residuals[index]
  }));
}

function buildResidualSummaryTable(rows, dataset, utils) {
  const ranked = [...rows]
    .sort((left, right) => Math.abs(right.residual) - Math.abs(left.residual));

  return `
    <div class="preview-table-wrap">
      <table class="preview-table prais-preview-table">
        <thead>
          <tr>
            <th>${utils.escapeHtml(dataset.timeHeaderLabel)}</th>
            <th>${utils.escapeHtml(dataset.yHeaderLabel)} observado</th>
            <th>${utils.escapeHtml(dataset.yHeaderLabel)} ajustado</th>
            <th>Resíduo (log10)</th>
          </tr>
        </thead>
        <tbody>
          ${ranked.map(row => `
            <tr>
              <td>${utils.escapeHtml(row.timeLabel)}</td>
              <td>${formatConvertedY(row.observed, utils)}</td>
              <td>${formatConvertedY(row.fitted, utils)}</td>
              <td>${utils.fmtSigned(row.residual, 4)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function metricCard(label, value, note = '') {
  return `
    <article class="metric-card">
      <div class="metric-label">${label}</div>
      <div class="metric-value">${value}</div>
      <div class="metric-mini">${note}</div>
    </article>
  `;
}

function buildPreviewMetaCardsHtml({ sourceText, variable1Label, variable2Label, validCount, periodLabel = '', orderingText = '', hasContent }) {
  const cards = [
    `<article class="mini-card"><h4>Fonte</h4><p>${sourceText}</p></article>`,
    `<article class="mini-card"><h4>Variavel 1 identificada</h4><p>${variable1Label}</p></article>`,
    `<article class="mini-card"><h4>Variavel 2 identificada</h4><p>${variable2Label}</p></article>`,
    `<article class="mini-card"><h4>Linhas validas</h4><p>${validCount}</p></article>`
  ];

  if (hasContent) {
    cards.push(`<article class="mini-card"><h4>Periodo</h4><p>${periodLabel}</p></article>`);
    cards.push(`<article class="mini-card"><h4>Serie ordenada</h4><p>${orderingText}</p></article>`);
  }

  return cards.join('');
}

export async function renderTestModule(ctx) {
  const { root, config, utils, stats, shared } = ctx;

  const moduleState = ctx.shared['prais-winsten'] || (ctx.shared['prais-winsten'] = {
    manual: {
      paste: '',
      context: '',
      alpha: '0.05',
      dataset: buildEmptyPraisDataset(),
      activeSource: 'none',
      fileState: null,
      hasResult: false
    }
  });
  const state = moduleState.manual;
  // Ensure new fields are present for sessions created before they were added
  state.alpha = state.alpha || '0.05';
  state.context = state.context || '';

  const exampleText = buildExampleText(config);

  root.classList.add('prais-module');
  root.innerHTML = `
    <div class="module-grid">
      <section class="module-header">
        <p>${utils.escapeHtml(config.description)}</p>
      </section>

        <details class="didactic-accordion" ${config.didacticExpanded ? 'open' : ''}>
          <summary class="didactic-summary">
            <span class="didactic-summary-icon">📖</span>
            Saber mais
            <span class="didactic-summary-chevron">▼</span>
          </summary>
          <section class="callout-grid prais-cards">
            ${(config.didacticCards || []).map(card => `
              <article class="help-card didactic-card">
                <h4>${utils.escapeHtml(card.title || '')}</h4>
                <p>${utils.escapeHtml(card.text || '')}</p>
              </article>
            `).join('')}
          </section>
        </details>

      <section class="surface-card decorated">
        <h4 style="font-size: 1.6rem; margin-bottom: 8px;">Dados para análise</h4>
        <p class="small-note" style="margin-bottom: 24px">Cole as colunas de <strong>ano | valor</strong> da sua planilha abaixo ou importe um arquivo .csv.</p>
        
        <div class="form-grid two" style="margin-bottom: 20px;">
          <div>
            <label for="pw-context">Pergunta do estudo</label>
            <input id="pw-context" type="text" placeholder="Tendência temporal do indicador em dados agregados" value="${utils.escapeHtml(state.context || '')}" />
          </div>
          <div>
            <label for="pw-alpha">Nível de significância (p-valor)</label>
            <select id="pw-alpha">
              <option value="0.01"${state.alpha === '0.01' ? ' selected' : ''}>1%</option>
              <option value="0.05"${state.alpha === '0.05' ? ' selected' : ''}>5%</option>
              <option value="0.10"${state.alpha === '0.10' ? ' selected' : ''}>10%</option>
            </select>
          </div>
        </div>

        <div style="margin-bottom: 20px;">
          <label for="pw-paste">Cole seus dados de série temporal</label>
          <textarea id="pw-paste" class="input-box" placeholder="Ano\tValor&#10;2010\t145,2&#10;2011\t150,8&#10;...">${utils.escapeHtml(state.paste)}</textarea>
        </div>
        
        <div class="actions-row" style="justify-content: space-between; align-items: center;">
          <div style="display: flex; gap: 10px; align-items: center;">
            <button type="button" class="lacir-info-btn" id="pw-info-btn" title="Como usar" aria-label="Instruções de uso">ℹ</button>
            <button class="btn" id="pw-run-btn">Rodar análise</button>
            <button class="btn-ghost" id="pw-clear-btn">Limpar</button>
          </div>
          <div class="module-file-picker">
            <label for="pw-file" class="btn-ghost" style="margin-bottom:0; cursor:pointer;">Importar CSV/Excel</label>
            <input id="pw-file" type="file" style="display:none;" />
          </div>
        </div>
        
        <div id="pw-file-status" class="status-bar" style="margin-top:16px;">Cole os dados ou importe um arquivo para continuar.</div>

        <dialog id="pw-info-modal" class="lacir-info-modal">
          <div class="lacir-info-modal-header">
            <h4>📋 Como usar — Prais-Winsten</h4>
            <button class="btn-close-modal" onclick="this.closest('dialog').close()" aria-label="Fechar">×</button>
          </div>
          <div class="lacir-info-modal-body">
            <ol>
              <li><strong>Copie a tabela</strong> do DATASUS ou outra fonte com pelo menos duas colunas: <em>tempo</em> (anos) e <em>indicador</em> (taxa, proporção).</li>
              <li><strong>Cole na área de texto</strong> — o parser identifica automaticamente as colunas de ID, tempo e desfecho.</li>
              <li>São necessários pelo menos <strong>5 pontos temporais</strong> válidos para o ajuste.</li>
              <li>Os valores do indicador podem usar vírgula decimal (padrão BR).</li>
              <li>Clique em <strong>Rodar análise</strong> para obter o APC e a tendência ajustada.</li>
            </ol>
            <div class="lacir-info-modal-tip">💡 O Prais-Winsten corrige automaticamente a autocorrelação dos resíduos (ρ), produzindo estimativas mais robustas que o OLS simples em séries temporais.</div>
          </div>
        </dialog>
      </section>

      <section class="surface-card">
        <h4>Prévia / revisão</h4>
        <div id="pw-preview-meta" class="prais-preview-cards"></div>
        <div id="pw-preview-messages" style="margin-top:14px;"></div>
        <div id="pw-preview-table" style="margin-top:14px;"></div>
        <div id="pw-preview-series" style="margin-top:14px;"></div>
      </section>

      <section class="surface-card">
        <h4>Resultados</h4>
        <div id="pw-error"></div>
        <div id="pw-status" class="status-bar">Carregue, leia e revise uma série temporal para iniciar a análise.</div>
        <div id="pw-metrics" class="metrics-grid" style="margin-top:14px;"></div>
        <div id="pw-charts" class="chart-grid" style="margin-top:14px;"></div>
        <div id="pw-results" class="result-grid" style="margin-top:14px;"></div>
      </section>
    </div>
  `;

  const els = {
    context: root.querySelector('#pw-context'),
    alpha: root.querySelector('#pw-alpha'),
    exampleButton: root.querySelector('#pw-example'),
    clearButton: root.querySelector('#pw-clear-btn'),
    runButton: root.querySelector('#pw-run-btn'),
    file: root.querySelector('#pw-file'),
    fileStatus: root.querySelector('#pw-file-status'),
    paste: root.querySelector('#pw-paste'),
    previewMeta: root.querySelector('#pw-preview-meta'),
    previewMessages: root.querySelector('#pw-preview-messages'),
    previewTable: root.querySelector('#pw-preview-table'),
    previewSeries: root.querySelector('#pw-preview-series'),
    error: root.querySelector('#pw-error'),
    status: root.querySelector('#pw-status'),
    metrics: root.querySelector('#pw-metrics'),
    charts: root.querySelector('#pw-charts'),
    results: root.querySelector('#pw-results')
  };

  const pasteSectionNote = root.querySelector('#pw-paste')?.closest('section')?.querySelector('.small-note');
  if (pasteSectionNote) {
    pasteSectionNote.textContent = 'Cole a tabela com cabeçalho na primeira linha. O fluxo principal usa 1ª coluna = variável 1 e 2ª coluna = variável 2; colagem tabulada do Excel continua aceita.';
  }
  if (els.paste) {
    els.paste.placeholder = 'variavel_1;variavel_2\n2015;120,4\n2016;125,8\n2017;130,2';
  }
  const runCardNote = root.querySelector('.prais-run-card p');
  if (runCardNote) {
    runCardNote.textContent = 'Revise a leitura antes de seguir. A variável 1 entra como eixo temporal e a variável 2 como desfecho.';
  }

  function clearOutput(statusMessage = 'Área limpa. Leia uma série temporal para iniciar a análise.') {
    els.error.innerHTML = '';
    els.status.className = 'status-bar';
    els.status.textContent = statusMessage;
    els.metrics.innerHTML = '';
    els.charts.innerHTML = '';
    els.results.innerHTML = '';
  }

  function renderFileStatus() {
    if (state.activeSource === 'file' && state.fileState) {
      if (state.fileState.status === 'error') {
        els.fileStatus.innerHTML = `<div class="error-box">${utils.escapeHtml(state.fileState.message || 'Não foi possível interpretar o arquivo.')}</div>`;
        return;
      }

      const pieces = [
        `Arquivo: ${state.fileState.fileName}`,
        state.fileState.tableName ? `Bloco: ${state.fileState.tableName}` : '',
        state.fileState.formatLabel ? `Formato: ${state.fileState.formatLabel}` : '',
        Number.isInteger(state.fileState.headerRowIndex) ? `Cabeçalho na linha ${state.fileState.headerRowIndex + 1}` : ''
      ].filter(Boolean);

      els.fileStatus.innerHTML = `
        <div class="success-box">${utils.escapeHtml(pieces.join(' · '))}</div>
      `;
      return;
    }

    if (state.activeSource === 'paste') {
      els.fileStatus.innerHTML = '<div class="status-bar">Prévia baseada no conteúdo colado na área de texto.</div>';
      return;
    }

    els.fileStatus.textContent = 'Nenhum arquivo selecionado.';
  }

  function renderPreview(dataset = state.dataset) {
    state.dataset = dataset;
    renderFileStatus();

    if (!dataset.hasContent) {
      els.previewMeta.innerHTML = buildPreviewMetaCardsHtml({
        sourceText: 'Nenhum conteúdo lido',
        variable1Label: 'Aguardando leitura',
        variable2Label: 'Aguardando leitura',
        validCount: '0',
        hasContent: false
      });
      els.previewMessages.innerHTML = buildFeedbackBox(
        dataset.errors.length ? dataset.errors : ['Cole dados, importe um arquivo ou use o exemplo para montar a prévia.'],
        dataset.errors.length ? 'error-box' : 'status-bar',
        utils
      );
      els.previewTable.innerHTML = '<div class="small-note">Nenhuma linha interpretada ainda.</div>';
      els.previewSeries.innerHTML = '<div class="small-note">A série final aparecerá aqui após a leitura dos dados.</div>';
      return dataset;
    }

    const recognizedChips = buildRecognizedColumnsChips(dataset.recognizedColumns, PRAIS_RECOGNIZED_ORDER);
    const orderingText = dataset.reordered ? 'Reordenada por tempo' : 'Ordem temporal já estava correta';
    const sourceText = dataset.sourceKind === 'file' ? (dataset.fileMeta?.fileName || 'Arquivo importado') : 'Dados colados';

    els.previewMeta.innerHTML = buildPreviewMetaCardsHtml({
      sourceText: utils.escapeHtml(sourceText),
      variable1Label: utils.escapeHtml(dataset.timeHeaderLabel || 'Não identificado'),
      variable2Label: utils.escapeHtml(dataset.yHeaderLabel || 'Não identificado'),
      validCount: String(dataset.validCount),
      periodLabel: utils.escapeHtml(dataset.periodLabel || 'Ainda não definido'),
      orderingText: utils.escapeHtml(orderingText),
      hasContent: true
    });
    els.previewMessages.innerHTML = [
      buildDetectedColumnsCallout(dataset, utils),
      recognizedChips ? `<div class="prais-chip-row">${recognizedChips}</div>` : '',
      buildFeedbackBox(dataset.errors, 'error-box', utils, 'Validação'),
      buildFeedbackBox(dataset.warnings, 'status-bar', utils, 'Atenção'),
      buildFeedbackBox(dataset.infos, 'success-box', utils, 'Leitura')
    ].join('');

    els.previewTable.innerHTML = buildPraisPreviewTable(dataset, utils);
    els.previewSeries.innerHTML = buildDerivedSeriesTable(dataset, utils);
    return dataset;
  }

  function buildDatasetFromPaste() {
    let fileState = readTabularPasteState(els.paste.value, stats, PRAIS_TABULAR_OPTIONS);
    if (fileState.status !== 'loaded') {
      fileState = readTabularPasteState(els.paste.value, stats, PRAIS_LEGACY_TABULAR_OPTIONS);
    }
    state.fileState = fileState;
    state.activeSource = 'paste';
    return buildPraisDatasetFromTabularState(fileState, stats, {
      sourceKind: 'paste',
      sourceLabel: 'Dados colados'
    });
  }

  async function buildDatasetFromFile(file) {
    let fileState = await readTabularFileState(file, utils, stats, PRAIS_TABULAR_OPTIONS);
    if (fileState.status !== 'loaded') {
      fileState = await readTabularFileState(file, utils, stats, PRAIS_LEGACY_TABULAR_OPTIONS);
    }
    state.fileState = fileState;
    state.activeSource = 'file';
    return buildPraisDatasetFromTabularState(fileState, stats, {
      sourceKind: 'file',
      sourceLabel: 'Arquivo importado'
    });
  }

  async function readCurrentInput() {
    const pastedContent = String(els.paste.value || '').trim();
    if (pastedContent) {
      return renderPreview(buildDatasetFromPaste());
    }

    const file = els.file.files?.[0];
    if (file) {
      return renderPreview(await buildDatasetFromFile(file));
    }

    state.activeSource = 'none';
    return renderPreview(buildEmptyPraisDataset());
  }

  async function runAnalysis() {
    const dataset = await readCurrentInput();
    clearOutput();

    if (!dataset.hasContent) {
      els.error.innerHTML = '<div class="error-box">Nenhum dado foi encontrado. Importe um arquivo, cole a tabela ou use o exemplo antes de rodar a análise.</div>';
      return;
    }

    if (dataset.errors.length) {
      els.error.innerHTML = buildFeedbackBox(dataset.errors, 'error-box', utils, 'Corrija antes de rodar');
      els.status.className = 'error-box';
      els.status.textContent = 'A série ainda não está válida para o Prais-Winsten.';
      return;
    }

    if (dataset.validRows.length < MIN_TEMPORAL_POINTS) {
      els.error.innerHTML = `<div class="error-box">Forneça pelo menos ${MIN_TEMPORAL_POINTS} pontos temporais válidos para estimar a tendência com estabilidade mínima.</div>`;
      els.status.className = 'error-box';
      els.status.textContent = 'Número insuficiente de pontos temporais válidos.';
      return;
    }

    const model = stats.praisWinsten(dataset.time, dataset.values);
    const fitted = dataset.time.map(timeValue => Math.pow(10, model.alpha + (model.beta * timeValue)));
    const residuals = dataset.values.map((value, index) => Math.log10(value) - (model.alpha + (model.beta * dataset.time[index])));
    const pointLabels = dataset.orderedRows.map(row => row.timeLabel);
    const residualRows = buildResidualSummaryRows(dataset.orderedRows, fitted, residuals);
    const largestResidual = [...residualRows].sort((left, right) => Math.abs(right.residual) - Math.abs(left.residual))[0] || null;
    const meanAbsResidual = residuals.reduce((sum, value) => sum + Math.abs(value), 0) / residuals.length;
    const acText = Math.abs(model.rho) < 0.3
      ? 'autocorrelação fraca'
      : Math.abs(model.rho) < 0.6
        ? 'autocorrelação moderada'
        : 'autocorrelação forte';

    state.hasResult = true;
    els.status.className = 'success-box';
    els.status.textContent = `Análise concluída para ${dataset.yHeaderLabel} com ${model.n} pontos válidos. ${dataset.reordered ? 'A série foi ordenada crescentemente por tempo antes do ajuste.' : 'A ordem temporal original já estava adequada.'}`;

    els.metrics.innerHTML = [
      metricCard('Pontos temporais', String(model.n), `Período analisado: ${dataset.periodLabel || 'não informado'}`),
      metricCard('Coeficiente da tendência (β)', utils.fmtSigned(model.beta, 4), 'Estimado na escala log10 do indicador.'),
      metricCard('Erro-padrão (β)', Number.isFinite(model.seBeta) ? utils.fmtNumber(model.seBeta, 4) : '—', 'Usado no teste t e no intervalo de confiança.'),
      metricCard('p-valor', utils.fmtP(model.p), `t = ${utils.fmtNumber(model.t, 3)} · gl = ${model.df}`),
      metricCard('Classificação', utils.escapeHtml(model.classification), `Mudança ${trendStrength(model.apc)}.`),
      metricCard('Variação percentual (APC)', `${utils.fmtSigned(model.apc, 2)}%`, `IC95% ${utils.fmtNumber(model.ciApc[0], 2)} a ${utils.fmtNumber(model.ciApc[1], 2)}`),
      metricCard('Autocorrelação (ρ)', utils.fmtSigned(model.rho, 3), acText)
    ].join('');

    els.charts.innerHTML = [
      buildChartContainer('pw-chart-trend', `${utils.escapeHtml(dataset.yHeaderLabel)} observada e linha ajustada`, 'Veja a tendência do Prais-Winsten sobre os dados. Passe o mouse para valores exatos.', 'prais-tendencia.png'),
      buildChartContainer('pw-chart-resid', `Resíduos de ${utils.escapeHtml(dataset.yHeaderLabel)} ao longo de ${utils.escapeHtml(dataset.timeHeaderLabel)}`, 'Barras positivas = acima da tendência; negativas = abaixo. Colunas muito altas sugerem possível padrão residual.', 'prais-residuos.png')
    ].join('');

    // Render Chart.js after DOM is ready
    setTimeout(() => {
      renderTimeseriesChart('pw-chart-trend', dataset.time, dataset.values, fitted, pointLabels, { x: dataset.timeHeaderLabel, y: dataset.yHeaderLabel }, utils);
      renderResidualChart('pw-chart-resid', dataset.time, residuals, pointLabels, { x: dataset.timeHeaderLabel, y: 'Resíduos (log10)' }, utils);
    }, 0);

    els.results.innerHTML = `
      <article class="result-card">
        <h4>Interpretação automática</h4>
        <p>${utils.escapeHtml(buildInterpretation(model, dataset, state.context, state.alpha))}</p>
        <ul>
          <li>ID identificado: ${utils.escapeHtml(dataset.idHeaderLabel)}.</li>
          <li>Tempo entendido como variável independente: ${utils.escapeHtml(dataset.timeHeaderLabel)}.</li>
          <li>Desfecho analisado: ${utils.escapeHtml(dataset.yHeaderLabel)}.</li>
          <li>Resultado principal: APC ${utils.fmtSigned(model.apc, 2)}% (IC95% ${utils.fmtNumber(model.ciApc[0], 2)} a ${utils.fmtNumber(model.ciApc[1], 2)}), p = ${utils.fmtP(model.p)}.</li>
          <li>Autocorrelação estimada: ρ = ${utils.fmtSigned(model.rho, 3)} (${acText}).</li>
          ${dataset.uniqueIds.length === 1 ? `<li>Série analisada: ${utils.escapeHtml(dataset.idHeaderLabel)} = ${utils.escapeHtml(dataset.uniqueIds[0])}.</li>` : ''}
        </ul>
      </article>
      <article class="result-card">
        <h4>Painel do ajuste</h4>
        <p>O gráfico 2 foi mantido como resíduos ao longo do tempo porque ele é mais útil para revisar a adequação do modelo do que um segundo gráfico apenas ilustrativo.</p>
        <ul>
          <li>Resíduo absoluto médio: ${utils.fmtNumber(meanAbsResidual, 4)} na escala log10.</li>
          <li>${largestResidual ? `Maior resíduo em ${largestResidual.timeLabel}: ${utils.fmtSigned(largestResidual.residual, 4)}.` : 'Sem resumo residual adicional.'}</li>
          <li>${dataset.reordered ? 'A série precisou ser ordenada crescentemente por tempo antes do ajuste.' : 'A série já estava ordenada crescentemente por tempo.'}</li>
        </ul>
        ${buildResidualSummaryTable(residualRows, dataset, utils)}
      </article>
    `;
    els.results.innerHTML = els.results.innerHTML.replace(
      /<li>ID identificado:[\s\S]*?<\/li>\s*<li>Tempo entendido[\s\S]*?<\/li>\s*<li>Desfecho analisado:[\s\S]*?<\/li>/,
      `<li>Variavel 1 identificada: ${utils.escapeHtml(dataset.timeHeaderLabel)}.</li>
       <li>Variavel 2 identificada: ${utils.escapeHtml(dataset.yHeaderLabel)}.</li>
       <li>Na modelagem, ${utils.escapeHtml(dataset.timeHeaderLabel)} entrou como eixo temporal e ${utils.escapeHtml(dataset.yHeaderLabel)} como desfecho.</li>`
    );

    // Export is handled globally by the canvas delegate in chart-manager.js
  }

  async function loadExample() {
    els.paste.value = exampleText;
    els.file.value = '';
    state.activeSource = 'paste';
    await readCurrentInput();
    clearOutput('Exemplo carregado. Revise a prévia e clique em Rodar análise.');
  }

  function clearAll() {
    state.paste = '';
    els.paste.value = '';
    els.file.value = '';
    state.dataset = buildEmptyPraisDataset();
    state.fileState = null;
    state.activeSource = 'none';
    state.hasResult = false;
    renderPreview(state.dataset);
    clearOutput();
  }

  els.exampleButton?.addEventListener('click', loadExample);
  els.clearButton?.addEventListener('click', clearAll);
  els.runButton?.addEventListener('click', runAnalysis);

  const runTop = root.querySelector('#pw-run-top');
  if (runTop) runTop.addEventListener('click', runAnalysis);

  els.file?.addEventListener('change', async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    els.paste.value = '';
    renderPreview(await buildDatasetFromFile(file));
    clearOutput('Arquivo carregado e lido. Revise a prévia e clique em Rodar análise.');
  });

  if (els.paste) {
    els.paste.addEventListener('input', () => {
      state.paste = els.paste.value;
    });
    els.paste.addEventListener('paste', () => {
      setTimeout(async () => {
        state.paste = els.paste.value;
        state.activeSource = 'paste';
        await readCurrentInput();
        clearOutput('Série interpretada! Clique em "Rodar análise" se desejar atualizar os cálculos.');
        if (state.dataset && state.dataset.hasContent) runAnalysis();
      }, 30);
    });
  }

  if (els.context) {
    els.context.addEventListener('input', () => {
      state.context = els.context.value;
    });
  }

  if (els.alpha) {
    els.alpha.addEventListener('change', () => {
      state.alpha = els.alpha.value;
    });
  }

  renderPreview();
  if (state.dataset.hasContent) {
    els.status.className = 'status-bar success-box';
    els.status.textContent = 'Série restaurada da sessão anterior. Clique em "Rodar análise" se necessário.';
  }
  if (state.dataset.hasContent && state.hasResult) {
    setTimeout(() => runAnalysis(), 10);
  }

}
