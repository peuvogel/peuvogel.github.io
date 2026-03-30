import {
  buildChartContainer,
  renderTStudentDistChart,
  renderTStudentDiffChart
} from '../../assets/js/chart-manager.js';

function splitDelimitedLine(line, delimiter) {
  if (!line) return [''];
  const cells = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    const prev = line[index - 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && char === delimiter) {
      if (delimiter === ',' && /\d/.test(prev || '') && /\d/.test(next || '')) {
        current += char;
      } else {
        cells.push(current.trim());
        current = '';
      }
      continue;
    }

    current += char;
  }

  cells.push(current.trim());
  return cells;
}

function detectDelimiter(lines) {
  const sample = lines.slice(0, Math.min(lines.length, 7));
  let semicolonScore = 0;
  let tabScore = 0;
  let commaScore = 0;

  sample.forEach(line => {
    semicolonScore += (line.match(/;/g) || []).length;
    tabScore += (line.match(/\t/g) || []).length;

    for (let index = 0; index < line.length; index += 1) {
      if (line[index] !== ',') continue;
      if (/\d/.test(line[index - 1] || '') && /\d/.test(line[index + 1] || '')) continue;
      commaScore += 1;
    }
  });

  if (semicolonScore > 0) return ';';
  if (tabScore > 0) return '\t';
  return commaScore > 0 ? ',' : ';';
}

function normalizeSpaces(value) {
  return String(value || '')
    .replace(/\uFEFF/g, '')
    .replace(/\u0000/g, '')
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeToken(value) {
  return normalizeSpaces(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function truncateDisplayLabel(value, maxLength = 28) {
  const normalized = normalizeSpaces(value);
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function cleanCategoryLabel(value) {
  const normalized = normalizeSpaces(value);
  const withoutIndex = normalized.replace(/^\(?\d+\)?(?:[.\-])?\s+(?=[A-ZÀ-ÖØ-Þ])/u, '').trim();
  return withoutIndex || normalized;
}

function labelFromDelimiter(delimiter) {
  if (delimiter === ';') return 'ponto e v\u00edrgula';
  if (delimiter === '\t') return 'tabula\u00e7\u00e3o';
  return 'v\u00edrgula';
}

function isYearToken(token) {
  return /^(18|19|20)\d{2}$/.test(token);
}

function isTotalToken(token) {
  return token === 'total';
}

function quantile(sorted, q) {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  return sorted[base + 1] !== undefined
    ? sorted[base] + rest * (sorted[base + 1] - sorted[base])
    : sorted[base];
}

function summarize(arr, stats) {
  const sorted = [...arr].sort((a, b) => a - b);
  const mean = stats.mean(arr);
  const sd = stats.sd(arr);
  const se = sd / Math.sqrt(arr.length);
  const ci95 = [mean - 1.96 * se, mean + 1.96 * se];

  return {
    n: arr.length,
    mean,
    sd,
    se,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    q1: quantile(sorted, 0.25),
    median: quantile(sorted, 0.5),
    q3: quantile(sorted, 0.75),
    ci95
  };
}

function classifyEffect(d) {
  const abs = Math.abs(d);
  if (abs < 0.2) return 'muito pequeno';
  if (abs < 0.5) return 'pequeno';
  if (abs < 0.8) return 'moderado';
  if (abs < 1.2) return 'grande';
  return 'muito grande';
}

export function parseDataset(text, stats) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

  if (!lines.length) {
    return {
      headers: ['Grupo 1', 'Grupo 2'],
      previewRows: [],
      g1: [],
      g2: [],
      groupNames: ['Grupo 1', 'Grupo 2'],
      mode: 'empty',
      rawRows: 0,
      validRows: 0,
      ignoredRows: 0
    };
  }

  const delimiter = detectDelimiter(lines);
  let rows = lines.map(line => splitDelimitedLine(line, delimiter));
  rows = rows.filter(row => row.some(cell => normalizeSpaces(cell) !== ''));
  rows = rows.map(row => {
    const normalized = [...row];
    while (normalized.length < 2) normalized.push('');
    return normalized;
  });

  const first = rows[0] || [];
  const likelyHeader = stats.parseNumber(first[0]) === null || stats.parseNumber(first[1]) === null;

  let headers = ['Grupo 1', 'Grupo 2'];
  if (likelyHeader) {
    headers = [first[0] || 'Grupo 1', first[1] || 'Grupo 2'];
    rows = rows.slice(1);
  }

  const numericPairs = rows.filter(row => stats.parseNumber(row[0]) !== null || stats.parseNumber(row[1]) !== null).length;
  const categoricalPairs = rows.filter(row => row[0] && stats.parseNumber(row[1]) !== null).length;

  let mode = 'two_numeric';
  if (categoricalPairs >= numericPairs && rows.every(row => row.length >= 2)) {
    const distinct = [...new Set(rows.map(row => normalizeSpaces(row[0])).filter(Boolean))];
    if (distinct.length >= 2 && distinct.length <= 4) mode = 'categorical_numeric';
  }

  const g1 = [];
  const g2 = [];
  const previewRows = [];
  let groupNames = [...headers];

  if (mode === 'categorical_numeric') {
    const bucket = new Map();
    rows.forEach(row => {
      const groupName = normalizeSpaces(row[0]);
      const value = stats.parseNumber(row[1]);
      if (!groupName || value === null) return;
      if (!bucket.has(groupName)) bucket.set(groupName, []);
      bucket.get(groupName).push(value);
      previewRows.push([groupName, String(row[1] || '')]);
    });

    const groups = [...bucket.entries()].sort((a, b) => b[1].length - a[1].length);
    if (groups.length >= 2) {
      groupNames = [groups[0][0], groups[1][0]];
      g1.push(...groups[0][1]);
      g2.push(...groups[1][1]);
    }
  } else {
    rows.forEach(row => {
      const a = stats.parseNumber(row[0]);
      const b = stats.parseNumber(row[1]);
      if (a !== null) g1.push(a);
      if (b !== null) g2.push(b);
      previewRows.push([String(row[0] || ''), String(row[1] || '')]);
    });
  }

  const rawRows = rows.length;
  const validRows = mode === 'categorical_numeric'
    ? previewRows.filter(row => row[0] && stats.parseNumber(row[1]) !== null).length
    : previewRows.filter(row => stats.parseNumber(row[0]) !== null || stats.parseNumber(row[1]) !== null).length;

  return {
    headers,
    previewRows,
    g1,
    g2,
    groupNames,
    mode,
    rawRows,
    validRows,
    ignoredRows: Math.max(0, rawRows - validRows)
  };
}

function findDatasusHeader(rows) {
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    const normalizedCells = row.map(normalizeSpaces);
    const tokens = normalizedCells.map(normalizeToken);
    const yearColumns = [];
    let totalIndex = null;

    tokens.forEach((token, index) => {
      if (isYearToken(token)) {
        yearColumns.push({ index, year: token });
      } else if (totalIndex === null && isTotalToken(token)) {
        totalIndex = index;
      }
    });

    if (yearColumns.length < 2) continue;

    const firstYearIndex = yearColumns[0].index;
    let dimensionIndex = tokens.findIndex((token, index) => index < firstYearIndex && token && !isYearToken(token) && !isTotalToken(token));
    if (dimensionIndex === -1) {
      dimensionIndex = tokens.findIndex(token => token && !isYearToken(token) && !isTotalToken(token));
    }
    if (dimensionIndex === -1) continue;

    return {
      rowIndex,
      dimensionIndex,
      dimensionLabel: normalizedCells[dimensionIndex] || 'Categoria',
      yearColumns,
      totalIndex
    };
  }

  return null;
}

function inferMeasureLabel(metadataLines) {
  const clean = metadataLines.map(normalizeSpaces).filter(Boolean);
  const descriptive = clean.find((line, index) => index > 0 && !line.includes(':'));
  return descriptive || clean.find(line => !line.includes(':')) || clean[0] || '';
}

export function parseDatasusDataset(text, stats) {
  const rawLines = String(text || '')
    .split(/\r?\n/)
    .map(line => line.replace(/\uFEFF/g, '').trimEnd());
  const lines = rawLines.filter(line => line.trim() !== '');

  if (!lines.length) {
    return { ok: false, error: 'Nenhum conteúdo foi encontrado no arquivo informado.' };
  }

  const delimiters = [';', '\t', ','];
  let detected = null;

  for (const delimiter of delimiters) {
    const rows = lines.map(line => splitDelimitedLine(line, delimiter));
    const header = findDatasusHeader(rows);
    if (header) {
      detected = { delimiter, rows, header };
      break;
    }
  }

  if (!detected) {
    return { ok: false, error: 'Não foi possível interpretar o arquivo DATASUS enviado.' };
  }

  const { delimiter, rows, header } = detected;
  const dimensionLabel = normalizeSpaces(rows[header.rowIndex][header.dimensionIndex]) || 'Categoria';
  const bodyRows = rows
    .slice(header.rowIndex + 1)
    .filter(row => row.some(cell => normalizeSpaces(cell) !== ''));
  const maxCols = Math.max(rows[header.rowIndex].length, ...bodyRows.map(row => row.length), 0);
  const previewHeaders = Array.from({ length: maxCols }, (_, index) => {
    const cell = normalizeSpaces(rows[header.rowIndex][index]);
    if (cell) return cell;
    return index === header.dimensionIndex ? dimensionLabel : `Coluna ${index + 1}`;
  });

  const parsedRows = [];
  let ignoredRows = 0;

  bodyRows.forEach((rawRow, bodyIndex) => {
    const row = Array.from({ length: maxCols }, (_, index) => normalizeSpaces(rawRow[index]));
    const rawLabel = row[header.dimensionIndex] || row.find(cell => cell) || '';
    const cleanLabel = cleanCategoryLabelLegacy(rawLabel);
    const isTotalRow = normalizeToken(cleanLabel) === 'total';
    const valuesByYear = {};
    let validCount = 0;

    header.yearColumns.forEach(column => {
      const value = stats.parseNumber(rawRow[column.index]);
      if (value !== null) {
        valuesByYear[column.year] = value;
        validCount += 1;
      }
    });

    const totalValue = header.totalIndex !== null ? stats.parseNumber(rawRow[header.totalIndex]) : null;
    if (!rawLabel && validCount === 0 && totalValue === null) {
      ignoredRows += 1;
      return;
    }
    if (validCount === 0 && !isTotalRow) {
      ignoredRows += 1;
      return;
    }

    parsedRows.push({
      id: `datasus-row-${parsedRows.length + 1}`,
      rowLabel: rawLabel || `Linha ${header.rowIndex + bodyIndex + 2}`,
      cleanLabel: cleanLabel || rawLabel || `Linha ${header.rowIndex + bodyIndex + 2}`,
      isTotalRow,
      valuesByYear,
      totalValue,
      valueCount: validCount,
      rawCells: row
    });
  });

  const years = header.yearColumns
    .map(column => column.year)
    .sort((a, b) => Number(a) - Number(b));
  const selectableRows = parsedRows.filter(row => !row.isTotalRow);
  const metadataLines = lines.slice(0, header.rowIndex).map(normalizeSpaces).filter(Boolean);
  const measureLabel = inferMeasureLabel(metadataLines);

  if (!years.length || !selectableRows.length) {
    return { ok: false, error: 'Não foi possível interpretar o arquivo DATASUS enviado.' };
  }

  return {
    ok: true,
    delimiter,
    headerRowIndex: header.rowIndex,
    dimensionIndex: header.dimensionIndex,
    dimensionLabel,
    totalIndex: header.totalIndex,
    hasTotalColumn: header.totalIndex !== null,
    yearColumns: header.yearColumns,
    years,
    previewHeaders,
    previewRows: bodyRows.map(rawRow => Array.from({ length: maxCols }, (_, index) => normalizeSpaces(rawRow[index]))),
    parsedRows,
    selectableRows,
    totalRows: parsedRows.filter(row => row.isTotalRow),
    detectedRowCount: parsedRows.length,
    rawRowCount: bodyRows.length,
    ignoredRows,
    metadataLines,
    titleLine: metadataLines[0] || '',
    measureLabel
  };
}

export function buildDatasusBlocks(years) {
  const numericYears = years
    .map(year => Number(year))
    .filter(year => Number.isFinite(year))
    .sort((a, b) => a - b);
  const blocks = [];

  for (let index = 0; index < numericYears.length; index += 5) {
    const chunk = numericYears.slice(index, index + 5);
    if (!chunk.length) continue;
    const complete = chunk.length === 5 && (chunk[chunk.length - 1] - chunk[0]) === 4;
    blocks.push({
      key: chunk.join('|'),
      years: chunk.map(String),
      label: `${chunk[0]}-${chunk[chunk.length - 1]}`,
      complete,
      incomplete: !complete
    });
  }

  return {
    complete: blocks.filter(block => block.complete),
    incomplete: blocks.filter(block => block.incomplete),
    all: blocks
  };
}

function getSelectedPeriodYears(state) {
  if (!state.parsed) return [];
  const years = state.parsed.years;

  if (state.periodMode === 'all') {
    return [...years];
  }

  if (state.periodMode === 'single') {
    return years.includes(state.singleYear) ? [state.singleYear] : [];
  }

  if (state.periodMode === 'block') {
    const block = state.blocks.all.find(item => item.key === state.blockKey);
    return block ? block.years : [];
  }

  const start = Number(state.rangeStart);
  const end = Number(state.rangeEnd);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return [];
  const min = Math.min(start, end);
  const max = Math.max(start, end);
  return years.filter(year => {
    const numericYear = Number(year);
    return numericYear >= min && numericYear <= max;
  });
}

function getPeriodLabel(state, selectedYears) {
  if (!selectedYears.length) return 'sem período válido';

  if (state.periodMode === 'all') {
    return `${selectedYears[0]}-${selectedYears[selectedYears.length - 1]} (todos os anos)`;
  }

  if (state.periodMode === 'single') {
    return `ano ${selectedYears[0]}`;
  }

  if (state.periodMode === 'block') {
    const block = state.blocks.all.find(item => item.key === state.blockKey);
    if (!block) return `${selectedYears[0]}-${selectedYears[selectedYears.length - 1]}`;
    return block.complete
      ? `${block.label} (bloco automático de 5 anos)`
      : `${block.label} (bloco incompleto)`;
  }

  return `${selectedYears[0]}-${selectedYears[selectedYears.length - 1]}`;
}

function joinRegionList(labels) {
  if (!labels.length) return 'nenhuma categoria selecionada';
  if (labels.length === 1) return labels[0];
  return `${labels.slice(0, -1).join(', ')} e ${labels[labels.length - 1]}`;
}

export function deriveDatasusComparison(state, stats) {
  if (!state.parsed) {
    return {
      ok: false,
      primaryError: 'Não foi possível interpretar o arquivo DATASUS enviado.',
      validationErrors: ['Não foi possível interpretar o arquivo DATASUS enviado.'],
      selectedYears: [],
      derivedRows: [],
      vectors: { A: [], B: [] },
      selectionCounts: { A: 0, B: 0 },
      validCounts: { A: 0, B: 0 },
      omittedRows: [],
      groupRegions: { A: [], B: [] },
      periodLabel: ''
    };
  }

  const selectedYears = getSelectedPeriodYears(state);
  if (!selectedYears.length) {
    return {
      ok: false,
      primaryError: 'Nenhum ano válido foi encontrado no período selecionado.',
      validationErrors: ['Nenhum ano válido foi encontrado no período selecionado.'],
      selectedYears: [],
      derivedRows: [],
      vectors: { A: [], B: [] },
      selectionCounts: { A: 0, B: 0 },
      validCounts: { A: 0, B: 0 },
      omittedRows: [],
      groupRegions: { A: [], B: [] },
      periodLabel: ''
    };
  }

  const visibleRows = state.parsed.parsedRows.filter(row => state.showTotal || !row.isTotalRow);
  const selectedRows = visibleRows
    .map(row => ({ row, group: state.selectionMap[row.id] || null }))
    .filter(item => item.group === 'A' || item.group === 'B');

  const selectionCounts = {
    A: selectedRows.filter(item => item.group === 'A').length,
    B: selectedRows.filter(item => item.group === 'B').length
  };

  const derivedRows = [];
  const omittedRows = [];

  selectedRows.forEach(item => {
    const validYears = selectedYears.filter(year => Number.isFinite(item.row.valuesByYear[year]));
    if (!validYears.length) {
      omittedRows.push({
        rowId: item.row.id,
        rowLabel: item.row.cleanLabel,
        groupKey: item.group,
        reason: 'Sem valores numéricos no período selecionado.'
      });
      return;
    }

    const values = validYears.map(year => item.row.valuesByYear[year]);
    const summaryValue = stats.mean(values);
    if (!Number.isFinite(summaryValue)) {
      omittedRows.push({
        rowId: item.row.id,
        rowLabel: item.row.cleanLabel,
        groupKey: item.group,
        reason: 'Resumo inválido após a filtragem.'
      });
      return;
    }

    derivedRows.push({
      rowId: item.row.id,
      rowLabel: item.row.cleanLabel,
      rawLabel: item.row.rowLabel,
      groupKey: item.group,
      groupLabel: item.group === 'A' ? 'Grupo A' : 'Grupo B',
      value: summaryValue,
      validYears
    });
  });

  const vectors = {
    A: derivedRows.filter(row => row.groupKey === 'A').map(row => row.value),
    B: derivedRows.filter(row => row.groupKey === 'B').map(row => row.value)
  };

  const validCounts = { A: vectors.A.length, B: vectors.B.length };
  const validationErrors = [];

  if (!derivedRows.length && selectedRows.length) {
    validationErrors.push('O período selecionado não gerou valores suficientes.');
  }
  if (vectors.A.some(value => Number.isNaN(value)) || vectors.B.some(value => Number.isNaN(value))) {
    validationErrors.push('Os vetores finais contêm valores inválidos.');
  }
  if (validCounts.A < 2) {
    validationErrors.push('Grupo A precisa ter pelo menos 2 observações válidas.');
  }
  if (validCounts.B < 2) {
    validationErrors.push('Grupo B precisa ter pelo menos 2 observações válidas.');
  }

  return {
    ok: validationErrors.length === 0,
    primaryError: validationErrors[0] || '',
    validationErrors,
    selectedYears,
    periodLabel: getPeriodLabel(state, selectedYears),
    derivedRows,
    vectors,
    selectionCounts,
    validCounts,
    omittedRows,
    groupRegions: {
      A: derivedRows.filter(row => row.groupKey === 'A').map(row => row.rowLabel),
      B: derivedRows.filter(row => row.groupKey === 'B').map(row => row.rowLabel)
    }
  };
}

export function safeWelch(g1, g2, stats) {
  const n1 = g1.length;
  const n2 = g2.length;
  const m1 = stats.mean(g1);
  const m2 = stats.mean(g2);
  const s1 = stats.sd(g1);
  const s2 = stats.sd(g2);
  const v1 = s1 ** 2;
  const v2 = s2 ** 2;
  const diff = m1 - m2;
  const se = Math.sqrt(v1 / n1 + v2 / n2);
  const t = se === 0 ? 0 : diff / se;
  const dfDen = (((v1 / n1) ** 2) / (n1 - 1)) + (((v2 / n2) ** 2) / (n2 - 1));
  const df = dfDen === 0 ? n1 + n2 - 2 : ((v1 / n1 + v2 / n2) ** 2) / dfDen;
  const p = Number.isFinite(df) && df > 0 ? 2 * (1 - stats.tcdf(Math.abs(t), df)) : NaN;
  const tcrit = Number.isFinite(df) && df > 0 ? stats.tInv(0.975, df) : NaN;
  const ci = Number.isFinite(tcrit) ? [diff - tcrit * se, diff + tcrit * se] : [NaN, NaN];
  const spDen = n1 + n2 - 2;
  const sp = spDen > 0 ? Math.sqrt((((n1 - 1) * v1) + ((n2 - 1) * v2)) / spDen) : NaN;
  const d = !Number.isFinite(sp) || sp === 0 ? 0 : diff / sp;
  return { n1, n2, m1, m2, s1, s2, diff, se, t, df, p, ci, d };
}

function buildDistributionSvg(g1, g2, label1, label2, stats, utils) {
  const width = 760;
  const height = 420;
  const margin = { top: 24, right: 24, bottom: 68, left: 74 };
  const all = [...g1, ...g2];
  const min = Math.min(...all);
  const max = Math.max(...all);
  const pad = (max - min || 1) * 0.1;
  const yMin = min - pad;
  const yMax = max + pad;
  const displayLabel1 = truncateDisplayLabel(label1, 22);
  const displayLabel2 = truncateDisplayLabel(label2, 22);

  const y = value => height - margin.bottom - ((value - yMin) / (yMax - yMin || 1)) * (height - margin.top - margin.bottom);
  const xCenters = [240, 520];
  const jitter = index => ((index % 10) - 4.5) * 5;
  const ticks = Array.from({ length: 6 }, (_, index) => yMin + ((yMax - yMin) * index) / 5);

  const grid = ticks.map(tick => {
    const py = y(tick);
    return `<g><line x1="${margin.left}" y1="${py.toFixed(2)}" x2="${width - margin.right}" y2="${py.toFixed(2)}" stroke="#dbe5f2" stroke-dasharray="4 6"/><text x="${margin.left - 12}" y="${(py + 4).toFixed(2)}" fill="#5b6b84" text-anchor="end" font-size="12">${utils.fmtNumber(tick, 1)}</text></g>`;
  }).join('');

  function drawGroup(values, centerX, color, label) {
    const sum = summarize(values, stats);
    const points = values.map((value, index) => `<circle cx="${(centerX + jitter(index)).toFixed(2)}" cy="${y(value).toFixed(2)}" r="5.4" fill="${color}" fill-opacity="0.9" stroke="#fff" stroke-width="1.8"><title>${utils.escapeHtml(label)}: ${utils.fmtNumber(value, 2)}</title></circle>`).join('');
    return `
      <line x1="${centerX}" y1="${y(sum.max).toFixed(2)}" x2="${centerX}" y2="${y(sum.min).toFixed(2)}" stroke="${color}" stroke-width="2.6" opacity="0.7"/>
      <rect x="${centerX - 28}" y="${y(sum.q3).toFixed(2)}" width="56" height="${Math.max(10, y(sum.q1) - y(sum.q3)).toFixed(2)}" rx="10" fill="${color}" fill-opacity="0.12" stroke="${color}" stroke-width="2"/>
      <line x1="${centerX - 32}" y1="${y(sum.mean).toFixed(2)}" x2="${centerX + 32}" y2="${y(sum.mean).toFixed(2)}" stroke="${color}" stroke-width="3"/>
      ${points}
    `;
  }

  return `
    <svg class="groupplot-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Distribuição dos grupos">
      <rect x="0" y="0" width="${width}" height="${height}" rx="20" fill="#fff"/>
      ${grid}
      <line x1="${margin.left}" y1="${height - margin.bottom}" x2="${width - margin.right}" y2="${height - margin.bottom}" stroke="#8da1bc"/>
      ${drawGroup(g1, xCenters[0], '#2563eb', label1)}
      ${drawGroup(g2, xCenters[1], '#0f766e', label2)}
      <text x="${xCenters[0]}" y="${height - 22}" text-anchor="middle" fill="#334155" font-size="13" font-weight="700">${utils.escapeHtml(displayLabel1)}</text>
      <text x="${xCenters[1]}" y="${height - 22}" text-anchor="middle" fill="#334155" font-size="13" font-weight="700">${utils.escapeHtml(displayLabel2)}</text>
    </svg>
  `;
}

function buildMeanCiSvg(result, labels, utils) {
  const width = 760;
  const height = 300;
  const margin = { top: 28, right: 24, bottom: 68, left: 74 };
  const vals = [result.m1, result.m2, result.ci[0], result.ci[1]];
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const pad = (max - min || 1) * 0.25;
  const yMin = min - pad;
  const yMax = max + pad;
  const y = value => height - margin.bottom - ((value - yMin) / (yMax - yMin || 1)) * (height - margin.top - margin.bottom);
  const x1 = 240;
  const x2 = 520;
  const displayLabel1 = truncateDisplayLabel(labels[0], 20);
  const displayLabel2 = truncateDisplayLabel(labels[1], 20);

  return `
    <svg class="groupplot-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Médias e intervalo de confiança">
      <rect x="0" y="0" width="${width}" height="${height}" rx="20" fill="#fff"/>
      <line x1="${margin.left}" y1="${height - margin.bottom}" x2="${width - margin.right}" y2="${height - margin.bottom}" stroke="#8da1bc"/>
      <line x1="${x1}" y1="${y(result.m1).toFixed(2)}" x2="${x2}" y2="${y(result.m2).toFixed(2)}" stroke="#94a3b8" stroke-dasharray="6 5"/>
      <rect x="${x1 - 40}" y="${y(result.m1).toFixed(2)}" width="80" height="${height - margin.bottom - y(result.m1)}" fill="#2563eb" fill-opacity="0.14"/>
      <rect x="${x2 - 40}" y="${y(result.m2).toFixed(2)}" width="80" height="${height - margin.bottom - y(result.m2)}" fill="#0f766e" fill-opacity="0.14"/>
      <circle cx="${x1}" cy="${y(result.m1).toFixed(2)}" r="8" fill="#2563eb"/>
      <circle cx="${x2}" cy="${y(result.m2).toFixed(2)}" r="8" fill="#0f766e"/>
      <line x1="${width / 2}" y1="${y(result.ci[0]).toFixed(2)}" x2="${width / 2}" y2="${y(result.ci[1]).toFixed(2)}" stroke="#1e293b" stroke-width="3"/>
      <line x1="${width / 2 - 16}" y1="${y(result.ci[0]).toFixed(2)}" x2="${width / 2 + 16}" y2="${y(result.ci[0]).toFixed(2)}" stroke="#1e293b" stroke-width="3"/>
      <line x1="${width / 2 - 16}" y1="${y(result.ci[1]).toFixed(2)}" x2="${width / 2 + 16}" y2="${y(result.ci[1]).toFixed(2)}" stroke="#1e293b" stroke-width="3"/>
      <text x="${x1}" y="${height - 22}" text-anchor="middle" fill="#334155" font-size="13" font-weight="700">${utils.escapeHtml(displayLabel1)}</text>
      <text x="${x2}" y="${height - 22}" text-anchor="middle" fill="#334155" font-size="13" font-weight="700">${utils.escapeHtml(displayLabel2)}</text>
      <text x="${width / 2}" y="${margin.top}" text-anchor="middle" fill="#334155" font-size="12" font-weight="700">IC95% da diferença (${utils.escapeHtml(displayLabel1)} - ${utils.escapeHtml(displayLabel2)})</text>
    </svg>
  `;
}

export function renderAnalysisError(statusEl, metricsEl, chartEl, resultsEl, message) {
  statusEl.className = 'error-box';
  statusEl.textContent = message;
  metricsEl.innerHTML = '';
  chartEl.innerHTML = '';
  resultsEl.innerHTML = '';
}

export function buildResultMetricsHtml(result, labels, utils) {
  return `
    <div class="metric-card">
      <div class="metric-label">Média de ${utils.escapeHtml(labels[0])}</div>
      <div class="metric-value">${utils.fmtNumber(result.m1, 2)}</div>
      <div class="metric-mini">n = ${result.n1} · desvio-padrão = ${utils.fmtNumber(result.s1, 2)}</div>
      <div class="metric-note">Valor médio das observações do grupo.</div>
    </div>
    <div class="metric-card">
      <div class="metric-label">Média de ${utils.escapeHtml(labels[1])}</div>
      <div class="metric-value">${utils.fmtNumber(result.m2, 2)}</div>
      <div class="metric-mini">n = ${result.n2} · desvio-padrão = ${utils.fmtNumber(result.s2, 2)}</div>
      <div class="metric-note">Valor médio das observações do grupo.</div>
    </div>
    <div class="metric-card">
      <div class="metric-label">Diferença entre médias</div>
      <div class="metric-value">${utils.fmtSigned(result.diff, 2)}</div>
      <div class="metric-mini">IC95%: ${utils.fmtNumber(result.ci[0], 2)} a ${utils.fmtNumber(result.ci[1], 2)}</div>
      <div class="metric-note">Quanto a média do primeiro grupo difere da do segundo.</div>
    </div>
    <div class="metric-card">
      <div class="metric-label">Evidência estatística</div>
      <div class="metric-value">${utils.fmtP(result.p)}</div>
      <div class="metric-mini">t = ${utils.fmtNumber(result.t, 3)} · graus de liberdade = ${utils.fmtNumber(result.df, 2)}</div>
      <div class="metric-note">Quanto menor o p-valor, maior a evidência contra a hipótese de médias iguais.</div>
    </div>
    <div class="metric-card">
      <div class="metric-label">Tamanho de efeito (Cohen's d)</div>
      <div class="metric-value">${utils.fmtSigned(result.d, 2)}</div>
      <div class="metric-mini">Classificação: ${utils.escapeHtml(classifyEffect(result.d))}</div>
      <div class="metric-note">Ajuda a interpretar se a diferença é pequena, moderada ou grande.</div>
    </div>
    <div class="metric-card">
      <div class="metric-label">Intervalo de confiança de 95%</div>
      <div class="metric-value tstudent-compact-value">${utils.fmtNumber(result.ci[0], 2)} a ${utils.fmtNumber(result.ci[1], 2)}</div>
      <div class="metric-mini">Faixa plausível para a diferença entre as médias.</div>
      <div class="metric-note">Se o intervalo cruza zero, a diferença pode ser compatível com ausência de efeito.</div>
    </div>
  `;
}

function buildResultChartsHtmlLegacy(result, labels, g1, g2, stats, utils) {
  return `
    <article class="chart-card">
      <h4>Grafico 1 · Distribuicao e dispersao por grupo</h4>
      <div class="chart-wrap">${buildDistributionSvg(g1, g2, labels[0], labels[1], stats, utils)}</div>
    </article>
    <article class="chart-card">
      <h4>Grafico 2 · Comparacao de medias e IC95%</h4>
      <div class="chart-wrap">${buildMeanCiSvg(result, labels, utils)}</div>
      <div class="small-note" style="margin-top:10px;">A barra central indica o IC95% da diferença (${utils.escapeHtml(labels[0])} - ${utils.escapeHtml(labels[1])}).</div>
    </article>
  `;
}

function buildManualInterpretationLegacy(result, alpha, labels, question, utils) {
  const effectClass = classifyEffect(result.d);
  const higherGroup = result.diff >= 0 ? labels[0] : labels[1];
  const diffAbs = Math.abs(result.diff);
  const significant = result.p < alpha;
  const paragraph = significant
    ? `Observou-se diferença estatisticamente significativa entre a média de ${labels[0]} e ${labels[1]}. A média foi maior em ${higherGroup}, com diferença média de ${utils.fmtNumber(diffAbs, 2)} unidades.`
    : `Não se observou diferença estatisticamente significativa entre as médias de ${labels[0]} e ${labels[1]}. Ainda assim, ${higherGroup} apresentou média numericamente maior, com diferença média de ${utils.fmtNumber(diffAbs, 2)} unidades.`;

  return `
    ${utils.buildInterpretationCard('Interpretação automática', paragraph, [
    `Pergunta analisada: ${question || 'Comparação entre duas médias independentes'}.`,
    `Resultado principal: t = ${utils.fmtNumber(result.t, 3)}, gl = ${utils.fmtNumber(result.df, 2)}, p = ${utils.fmtP(result.p)}.`,
    `Tamanho de efeito: ${effectClass}. Em termos práticos, isso indica uma magnitude ${effectClass} da diferença.`
  ])}
    <div class="result-card">
      <h4>Leitura didática final</h4>
      <ul>
        <li>Grupo com maior média: <strong>${utils.escapeHtml(higherGroup)}</strong>.</li>
        <li>Diferença observada: <strong>${utils.fmtSigned(result.diff, 2)}</strong> unidades.</li>
        <li>Classificação do efeito: <strong>${utils.escapeHtml(effectClass)}</strong>.</li>
      </ul>
    </div>
  `;
}

function buildDatasusInterpretationLegacy(result, derived, alpha, question, utils) {
  const significant = result.p < alpha;
  const higherGroup = result.diff >= 0 ? 'Grupo A' : 'Grupo B';
  const paragraph = significant
    ? `Após resumir os valores anuais dentro do período selecionado para cada categoria e comparar os grupos definidos pelo usuário, observou-se diferença estatisticamente significativa entre Grupo A e Grupo B. A média foi maior em ${higherGroup}.`
    : `Após resumir os valores anuais dentro do período selecionado para cada categoria e comparar os grupos definidos pelo usuário, não se observou diferença estatisticamente significativa entre Grupo A e Grupo B. Ainda assim, a média foi numericamente maior em ${higherGroup}.`;

  return `
    ${utils.buildInterpretationCard('Interpretação automática', paragraph, [
    `Pergunta analisada: ${question || 'Comparação entre dois grupos de categorias'}.`,
    `Período analisado: ${derived.periodLabel}.`,
    `Grupo A: ${joinRegionList(derived.groupRegions.A)}.`,
    `Grupo B: ${joinRegionList(derived.groupRegions.B)}.`,
    'Resumo utilizado: média por categoria dentro do período selecionado, mantendo cada categoria como uma observação separada.',
    `Resultado principal: t = ${utils.fmtNumber(result.t, 3)}, gl = ${utils.fmtNumber(result.df, 2)}, p = ${utils.fmtP(result.p)}.`
  ])}
  `;
}

function cleanCategoryLabelLegacy(value) {
  const normalized = normalizeSpaces(value).replace(/^\uFEFF+/, '');
  const withoutIndex = normalized.replace(/^\(?\d+\)?(?:[.\-])?\s+(?=[A-Z\u00c0-\u00d6\u00d8-\u00de])/u, '').trim();
  return withoutIndex || normalized;
}

export function buildResultChartsHtml(result, labels, g1, g2, stats, utils) {
  return [
    buildChartContainer('t-chart-dist', 'Distribuição e dispersão por grupo', 'Resumo visual das médias, desvios e quartis. Passe o mouse para detalhes estatísticos.', 'tstudent-distribuicao.png'),
    buildChartContainer('t-chart-diff', 'Diferença entre médias e IC95%', 'Veja se a diferença estimada se afasta de zero e qual a faixa plausível do efeito.', 'tstudent-diferenca.png')
  ].join('');
}

export function buildManualInterpretation(result, alpha, labels, question, utils) {
  const effectClass = classifyEffect(result.d);
  const higherGroup = result.diff >= 0 ? labels[0] : labels[1];
  const diffAbs = Math.abs(result.diff);
  const significant = result.p < alpha;
  const paragraph = significant
    ? `Observou-se diferença estatisticamente significativa entre a média de ${labels[0]} e ${labels[1]}. A média foi maior em ${higherGroup}, com diferença média de ${utils.fmtNumber(diffAbs, 2)} unidades.`
    : `Não se observou diferença estatisticamente significativa entre as médias de ${labels[0]} e ${labels[1]}. Ainda assim, ${higherGroup} apresentou média numericamente maior, com diferença média de ${utils.fmtNumber(diffAbs, 2)} unidades.`;

  return `
    ${utils.buildInterpretationCard('Interpretação automática', paragraph, [
    `Pergunta analisada: ${question || 'Comparação entre duas médias independentes'}.`,
    `Resultado principal: t = ${utils.fmtNumber(result.t, 3)}, gl = ${utils.fmtNumber(result.df, 2)}, p = ${utils.fmtP(result.p)}.`,
    `Tamanho de efeito: ${effectClass}. Em termos práticos, isso indica uma magnitude ${effectClass} da diferença.`,
    `Grupo com maior média: ${higherGroup}.`
  ])}
    <div class="result-card">
      <h4>Leitura didática final</h4>
      <ul>
        <li>Grupo com maior média: <strong>${utils.escapeHtml(higherGroup)}</strong>.</li>
        <li>Diferença observada: <strong>${utils.fmtSigned(result.diff, 2)}</strong> unidades.</li>
        <li>Classificação do efeito: <strong>${utils.escapeHtml(effectClass)}</strong>.</li>
      </ul>
    </div>
  `;
}

function buildDatasusInterpretation(result, derived, alpha, question, utils) {
  const significant = result.p < alpha;
  const higherGroup = result.diff >= 0 ? 'Grupo A' : 'Grupo B';
  const paragraph = significant
    ? `Após resumir os valores anuais dentro do período selecionado para cada categoria e comparar os grupos definidos pelo usuário, observou-se diferença estatisticamente significativa entre Grupo A e Grupo B. A média foi maior em ${higherGroup}.`
    : `Após resumir os valores anuais dentro do período selecionado para cada categoria e comparar os grupos definidos pelo usuário, não se observou diferença estatisticamente significativa entre Grupo A e Grupo B. Ainda assim, a média foi numericamente maior em ${higherGroup}.`;

  return `
    ${utils.buildInterpretationCard('Interpretação automática', paragraph, [
    `Pergunta analisada: ${question || 'Comparação entre dois grupos de categorias'}.`,
    `Período analisado: ${derived.periodLabel}.`,
    `Grupo A: ${joinRegionList(derived.groupRegions.A)}.`,
    `Grupo B: ${joinRegionList(derived.groupRegions.B)}.`,
    'Resumo utilizado: média por categoria dentro do período selecionado, mantendo cada categoria como uma observação separada.',
    `Grupo com maior média resumida: ${higherGroup}.`,
    `Resultado principal: t = ${utils.fmtNumber(result.t, 3)}, gl = ${utils.fmtNumber(result.df, 2)}, p = ${utils.fmtP(result.p)}.`
  ])}
  `;
}

function parseDatasusMetadata(metadataLines) {
  return (metadataLines || [])
    .map(line => normalizeSpaces(line))
    .filter(Boolean)
    .map(line => {
      const separatorIndex = line.indexOf(':');
      if (separatorIndex === -1) {
        return {
          raw: line,
          key: line,
          normalizedKey: normalizeToken(line),
          value: ''
        };
      }

      const key = normalizeSpaces(line.slice(0, separatorIndex));
      const value = normalizeSpaces(line.slice(separatorIndex + 1));
      return {
        raw: line,
        key,
        normalizedKey: normalizeToken(key),
        value
      };
    });
}

function readDatasusMetadataValue(metadataLines, candidates) {
  const entries = parseDatasusMetadata(metadataLines);
  const normalizedCandidates = candidates.map(candidate => normalizeToken(candidate));

  for (const candidate of normalizedCandidates) {
    const exact = entries.find(entry => entry.normalizedKey === candidate && entry.value);
    if (exact) return exact.value;
  }

  for (const candidate of normalizedCandidates) {
    const partial = entries.find(entry => entry.normalizedKey.includes(candidate) && entry.value);
    if (partial) return partial.value;
  }

  return '';
}

export function inferDatasusProcedureLabel(parsed, fallback = 'Procedimento DATASUS') {
  if (!parsed) return fallback;

  const subgroup = readDatasusMetadataValue(parsed.metadataLines, [
    'subgrupo proced.',
    'subgrupo procedimento',
    'procedimento'
  ]);
  const group = readDatasusMetadataValue(parsed.metadataLines, [
    'grupo procedimento',
    'grupo proced.'
  ]);

  if (subgroup) return subgroup;
  if (group) return group;
  if (parsed.measureLabel) return parsed.measureLabel;
  if (parsed.titleLine) return parsed.titleLine;
  return fallback;
}

function buildDatasusRowMap(parsed) {
  const rowMap = new Map();
  if (!parsed) return rowMap;

  parsed.selectableRows.forEach(row => {
    const key = normalizeToken(row.cleanLabel);
    if (!key || rowMap.has(key)) return;
    rowMap.set(key, row);
  });

  return rowMap;
}

export function getDatasusPairOverlap(leftEntry, rightEntry) {
  if (!leftEntry?.parsed || !rightEntry?.parsed) {
    return {
      commonKeys: [],
      commonLabels: [],
      commonCount: 0,
      sharedYears: []
    };
  }

  const leftMap = buildDatasusRowMap(leftEntry.parsed);
  const rightMap = buildDatasusRowMap(rightEntry.parsed);
  const commonKeys = [...leftMap.keys()].filter(key => rightMap.has(key));
  const sharedYears = leftEntry.parsed.years.filter(year => rightEntry.parsed.years.includes(year));
  const commonLabels = commonKeys.map(key => leftMap.get(key)?.cleanLabel || rightMap.get(key)?.cleanLabel || key);

  return {
    commonKeys,
    commonLabels,
    commonCount: commonKeys.length,
    sharedYears
  };
}

export function findBestPairedSuggestion(entries) {
  const validEntries = entries.filter(entry => entry?.parsed);
  let best = null;

  for (let leftIndex = 0; leftIndex < validEntries.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < validEntries.length; rightIndex += 1) {
      const leftEntry = validEntries[leftIndex];
      const rightEntry = validEntries[rightIndex];
      const overlap = getDatasusPairOverlap(leftEntry, rightEntry);
      if (overlap.commonCount < 2 || overlap.sharedYears.length < 1) continue;

      const sameDimension = normalizeToken(leftEntry.parsed.dimensionLabel) === normalizeToken(rightEntry.parsed.dimensionLabel);
      const score = overlap.commonCount + (sameDimension ? 1000 : 0);

      if (!best || score > best.score) {
        best = {
          leftId: leftEntry.id,
          rightId: rightEntry.id,
          commonCount: overlap.commonCount,
          commonLabels: overlap.commonLabels,
          sharedYears: overlap.sharedYears,
          sameDimension,
          score
        };
      }
    }
  }

  return best;
}

function getSelectedYearsFromAvailableYears(availableYears, periodState) {
  if (!availableYears.length) return [];

  if (periodState.periodMode === 'single') {
    return availableYears.includes(periodState.singleYear)
      ? [periodState.singleYear]
      : [availableYears[availableYears.length - 1]];
  }

  if (periodState.periodMode === 'block') {
    const blocks = buildDatasusBlocks(availableYears);
    const block = blocks.all.find(item => item.key === periodState.blockKey);
    return block ? block.years : [];
  }

  const start = Number(periodState.rangeStart);
  const end = Number(periodState.rangeEnd);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return [];
  const min = Math.min(start, end);
  const max = Math.max(start, end);

  return availableYears.filter(year => {
    const numericYear = Number(year);
    return numericYear >= min && numericYear <= max;
  });
}

function getPeriodLabelFromAvailableYears(periodState, selectedYears, blocks) {
  if (!selectedYears.length) return 'sem período válido';

  if (periodState.periodMode === 'single') {
    return `ano ${selectedYears[0]}`;
  }

  if (periodState.periodMode === 'block') {
    const block = blocks.all.find(item => item.key === periodState.blockKey);
    if (!block) return `${selectedYears[0]}-${selectedYears[selectedYears.length - 1]}`;
    return block.complete
      ? `${block.label} (bloco de 5 anos)`
      : `${block.label} (bloco incompleto)`;
  }

  return `${selectedYears[0]}-${selectedYears[selectedYears.length - 1]}`;
}

export function buildDatasusDerivedErrorState(mode, message, extras = {}) {
  return {
    mode,
    ok: false,
    primaryError: message,
    validationErrors: [message],
    selectedYears: [],
    periodLabel: '',
    derivedRows: [],
    vectors: { A: [], B: [] },
    selectionCounts: { A: 0, B: 0 },
    validCounts: { A: 0, B: 0, pairs: 0 },
    omittedRows: [],
    groupRegions: { A: [], B: [] },
    groupLabels: ['Grupo A', 'Grupo B'],
    unitLabel: 'Categoria',
    explanation: '',
    ...extras
  };
}

export function safePaired(g1, g2, stats) {
  const n = Math.min(g1.length, g2.length);
  const a = g1.slice(0, n);
  const b = g2.slice(0, n);
  const differences = a.map((value, index) => value - b[index]);
  const m1 = stats.mean(a);
  const m2 = stats.mean(b);
  const s1 = stats.sd(a);
  const s2 = stats.sd(b);
  const diff = stats.mean(differences);
  const sdDifference = stats.sd(differences);
  const se = sdDifference / Math.sqrt(n);
  const t = se === 0 ? 0 : diff / se;
  const df = n - 1;
  const p = Number.isFinite(df) && df > 0 ? 2 * (1 - stats.tcdf(Math.abs(t), df)) : NaN;
  const tcrit = Number.isFinite(df) && df > 0 ? stats.tInv(0.975, df) : NaN;
  const ci = Number.isFinite(tcrit) ? [diff - tcrit * se, diff + tcrit * se] : [NaN, NaN];
  const d = !Number.isFinite(sdDifference) || sdDifference === 0 ? 0 : diff / sdDifference;

  return {
    testKind: 'paired',
    n1: n,
    n2: n,
    m1,
    m2,
    s1,
    s2,
    diff,
    meanDifference: diff,
    sdDifference,
    se,
    t,
    df,
    p,
    ci,
    d,
    differences
  };
}

export function derivePairedDatasusComparison(options, stats) {
  const { leftEntry, rightEntry, periodState } = options;

  if (!leftEntry?.parsed || !rightEntry?.parsed) {
    return buildDatasusDerivedErrorState('paired', 'Importe e selecione dois procedimentos válidos.');
  }

  if (leftEntry.id === rightEntry.id) {
    return buildDatasusDerivedErrorState('paired', 'Selecione dois procedimentos diferentes.');
  }

  const overlap = getDatasusPairOverlap(leftEntry, rightEntry);
  if (overlap.commonCount < 2) {
    return buildDatasusDerivedErrorState('paired', 'Não há unidades suficientes em comum para comparação pareada.', {
      groupLabels: [leftEntry.procedureLabel, rightEntry.procedureLabel],
      unitLabel: leftEntry.parsed.dimensionLabel || rightEntry.parsed.dimensionLabel || 'Unidade'
    });
  }

  const availableYears = overlap.sharedYears.sort((a, b) => Number(a) - Number(b));
  const blocks = buildDatasusBlocks(availableYears);
  const selectedYears = getSelectedYearsFromAvailableYears(availableYears, periodState);

  if (!selectedYears.length) {
    return buildDatasusDerivedErrorState('paired', 'Não há dados suficientes no período selecionado.', {
      groupLabels: [leftEntry.procedureLabel, rightEntry.procedureLabel],
      unitLabel: leftEntry.parsed.dimensionLabel || rightEntry.parsed.dimensionLabel || 'Unidade'
    });
  }

  const leftMap = buildDatasusRowMap(leftEntry.parsed);
  const rightMap = buildDatasusRowMap(rightEntry.parsed);
  const derivedRows = [];
  const omittedRows = [];

  overlap.commonKeys.forEach(key => {
    const leftRow = leftMap.get(key);
    const rightRow = rightMap.get(key);
    if (!leftRow || !rightRow) return;

    const validYears = selectedYears.filter(year => Number.isFinite(leftRow.valuesByYear[year]) && Number.isFinite(rightRow.valuesByYear[year]));
    if (!validYears.length) {
      omittedRows.push({
        rowLabel: leftRow.cleanLabel || rightRow.cleanLabel,
        reason: 'Sem valores simultâneos para os dois procedimentos no período selecionado.'
      });
      return;
    }

    const valueA = stats.mean(validYears.map(year => leftRow.valuesByYear[year]));
    const valueB = stats.mean(validYears.map(year => rightRow.valuesByYear[year]));
    if (!Number.isFinite(valueA) || !Number.isFinite(valueB)) {
      omittedRows.push({
        rowLabel: leftRow.cleanLabel || rightRow.cleanLabel,
        reason: 'Resumo inválido após a filtragem.'
      });
      return;
    }

    derivedRows.push({
      rowLabel: leftRow.cleanLabel || rightRow.cleanLabel,
      rawLabelA: leftRow.rowLabel,
      rawLabelB: rightRow.rowLabel,
      valueA,
      valueB,
      diff: valueA - valueB,
      validYears
    });
  });

  derivedRows.sort((a, b) => a.rowLabel.localeCompare(b.rowLabel, 'pt-BR'));

  const vectors = {
    A: derivedRows.map(row => row.valueA),
    B: derivedRows.map(row => row.valueB)
  };
  const validationErrors = [];

  if (vectors.A.length < 2) {
    validationErrors.push('Selecione pelo menos 2 observações pareadas válidas.');
  }

  return {
    mode: 'paired',
    ok: validationErrors.length === 0,
    primaryError: validationErrors[0] || '',
    validationErrors,
    selectedYears,
    periodLabel: getPeriodLabelFromAvailableYears(periodState, selectedYears, blocks),
    derivedRows,
    vectors,
    selectionCounts: { A: overlap.commonCount, B: overlap.commonCount },
    validCounts: { A: vectors.A.length, B: vectors.B.length, pairs: vectors.A.length },
    omittedRows,
    groupRegions: {
      A: derivedRows.map(row => row.rowLabel),
      B: derivedRows.map(row => row.rowLabel)
    },
    groupLabels: [leftEntry.procedureLabel, rightEntry.procedureLabel],
    unitLabel: leftEntry.parsed.dimensionLabel || rightEntry.parsed.dimensionLabel || 'Unidade',
    explanation: 'Comparação pareada: cada unidade contribui com dois valores, um para cada procedimento.',
    sourceLabels: [leftEntry.fileName, rightEntry.fileName]
  };
}

export function deriveIndependentDatasusGuidedComparison(options, stats) {
  const { entry, selectionMap, periodState, showTotal } = options;

  if (!entry?.parsed) {
    return buildDatasusDerivedErrorState('independent', 'Não foi possível interpretar o arquivo DATASUS enviado.');
  }

  const localState = {
    parsed: entry.parsed,
    selectionMap,
    showTotal,
    periodMode: periodState.periodMode,
    singleYear: periodState.singleYear,
    rangeStart: periodState.rangeStart,
    rangeEnd: periodState.rangeEnd,
    blockKey: periodState.blockKey,
    blocks: buildDatasusBlocks(entry.parsed.years)
  };
  const derived = deriveDatasusComparison(localState, stats);
  const simpleErrors = [...derived.validationErrors];

  if (derived.validCounts.A < 2 || derived.validCounts.B < 2) {
    simpleErrors.unshift('Selecione pelo menos 2 observações em cada grupo.');
  }

  return {
    ...derived,
    mode: 'independent',
    ok: simpleErrors.length === 0,
    primaryError: simpleErrors[0] || '',
    validationErrors: [...new Set(simpleErrors.filter(Boolean))],
    groupLabels: ['Grupo A', 'Grupo B'],
    unitLabel: entry.parsed.dimensionLabel || 'Categoria',
    explanation: 'Comparação entre grupos independentes definidos pelo usuário.',
    datasetLabel: entry.procedureLabel,
    sourceLabels: [entry.fileName]
  };
}

export function buildGuidedDatasusMetricsHtml(result, derived, utils) {
  const baseMetrics = buildResultMetricsHtml(result, derived.groupLabels, utils);

  if (derived.mode !== 'paired') {
    return baseMetrics;
  }

  return `
    ${baseMetrics}
    <div class="metric-card">
      <div class="metric-label">Média das diferenças pareadas</div>
      <div class="metric-value">${utils.fmtSigned(result.meanDifference, 2)}</div>
      <div class="metric-mini">n de pares = ${result.n1} · desvio-padrão das diferenças = ${utils.fmtNumber(result.sdDifference, 2)}</div>
      <div class="metric-note">Cada unidade entra com dois valores, mantendo a correspondência entre os procedimentos.</div>
    </div>
  `;
}

export function buildGuidedDatasusStatusText(result, derived, alpha, utils) {
  const significant = result.p < alpha;
  const leftLabel = derived.groupLabels[0] || 'Grupo A';
  const rightLabel = derived.groupLabels[1] || 'Grupo B';

  if (derived.mode === 'paired') {
    return significant
      ? `Há evidência estatística de diferença entre ${leftLabel} e ${rightLabel} nas mesmas unidades (p ${utils.fmtP(result.p)} < ${alpha.toLocaleString('pt-BR')}).`
      : `Não houve evidência estatística suficiente de diferença entre ${leftLabel} e ${rightLabel} nas mesmas unidades (p ${utils.fmtP(result.p)}).`;
  }

  return significant
    ? `Há evidência estatística de diferença entre os grupos independentes definidos pelo usuário (p ${utils.fmtP(result.p)} < ${alpha.toLocaleString('pt-BR')}).`
    : `Não houve evidência estatística suficiente de diferença entre os grupos independentes definidos pelo usuário (p ${utils.fmtP(result.p)}).`;
}

export function buildGuidedDatasusInterpretation(result, derived, alpha, question, utils) {
  const significant = result.p < alpha;
  const effectClass = classifyEffect(result.d);
  const leftLabel = derived.groupLabels[0] || 'Grupo A';
  const rightLabel = derived.groupLabels[1] || 'Grupo B';
  const higherGroup = result.diff >= 0 ? leftLabel : rightLabel;
  const direction = result.diff >= 0
    ? `${leftLabel} apresentou média maior`
    : `${rightLabel} apresentou média maior`;

  if (derived.mode === 'paired') {
    const paragraph = significant
      ? `Comparação pareada entre os procedimentos ${leftLabel} e ${rightLabel} nas mesmas ${derived.unitLabel.toLowerCase()}. Observou-se diferença estatisticamente significativa, com média maior em ${higherGroup}.`
      : `Comparação pareada entre os procedimentos ${leftLabel} e ${rightLabel} nas mesmas ${derived.unitLabel.toLowerCase()}. Não se observou diferença estatisticamente significativa, embora ${direction}.`;

    return `
      ${utils.buildInterpretationCard('Interpretação automática', paragraph, [
      `Pergunta analisada: ${question || `Os procedimentos ${leftLabel} e ${rightLabel} diferem nas mesmas unidades?`}.`,
      `Período analisado: ${derived.periodLabel}.`,
      `Base derivada: ${derived.validCounts.pairs} pares válidos, mantendo apenas unidades com os dois procedimentos.`,
      `Média de ${leftLabel}: ${utils.fmtNumber(result.m1, 2)}.`,
      `Média de ${rightLabel}: ${utils.fmtNumber(result.m2, 2)}.`,
      `Diferença média (${leftLabel} - ${rightLabel}): ${utils.fmtSigned(result.diff, 2)}.`,
      `Resultado principal: t = ${utils.fmtNumber(result.t, 3)}, gl = ${utils.fmtNumber(result.df, 2)}, p = ${utils.fmtP(result.p)}.`
    ])}
      <div class="result-card">
        <h4>Leitura clínica</h4>
        <ul>
          <li>Estrutura do teste: comparação pareada, pois cada unidade contribuiu com dois valores.</li>
          <li>Direção da diferença: <strong>${utils.escapeHtml(direction)}</strong>.</li>
          <li>Tamanho de efeito: <strong>${utils.escapeHtml(effectClass)}</strong>.</li>
        </ul>
      </div>
    `;
  }

  const paragraph = significant
    ? `Comparação entre grupos independentes definidos pelo usuário. Observou-se diferença estatisticamente significativa entre Grupo A e Grupo B, com média maior em ${higherGroup}.`
    : `Comparação entre grupos independentes definidos pelo usuário. Não se observou diferença estatisticamente significativa entre Grupo A e Grupo B, embora ${direction}.`;

  return `
    ${utils.buildInterpretationCard('Interpretação automática', paragraph, [
    `Pergunta analisada: ${question || 'Os grupos independentes definidos pelo usuário diferem entre si?'}.`,
    `Período analisado: ${derived.periodLabel}.`,
    `Grupo A: ${joinRegionList(derived.groupRegions.A)}.`,
    `Grupo B: ${joinRegionList(derived.groupRegions.B)}.`,
    `Média do Grupo A: ${utils.fmtNumber(result.m1, 2)}.`,
    `Média do Grupo B: ${utils.fmtNumber(result.m2, 2)}.`,
    `Resultado principal: t = ${utils.fmtNumber(result.t, 3)}, gl = ${utils.fmtNumber(result.df, 2)}, p = ${utils.fmtP(result.p)}.`
  ])}
    <div class="result-card">
      <h4>Leitura clínica</h4>
      <ul>
        <li>Estrutura do teste: <strong>grupos independentes</strong>, com média resumida por categoria no período selecionado.</li>
        <li>Direção da diferença: <strong>${utils.escapeHtml(direction)}</strong>.</li>
        <li>Tamanho de efeito: <strong>${utils.escapeHtml(effectClass)}</strong>.</li>
      </ul>
    </div>
  `;
}

export async function renderTestModule(ctx) {
  const { root, config, utils, stats } = ctx;

  const moduleState = ctx.shared['tstudent'] || (ctx.shared['tstudent'] = {
    manual: {
      paste: '',
      context: '',
      alpha: '0.05'
    }
  });
  const manualState = moduleState.manual;

  // Forçar limpeza de textos legados para ativar placeholders
  const legacyTexts = [
    'As médias dos grupos são diferentes?',
    'As médias resumidas diferem entre Grupo A e Grupo B?',
    'As médias dos dois grupos são diferentes?'
  ];
  if (legacyTexts.includes(manualState.context)) manualState.context = '';

  root.classList.add('tstudent-module');

  root.innerHTML = `
    <div class="module-grid">
      <section class="module-header tstudent-header">
        <p>${utils.escapeHtml(config.description)}</p>
      </section>
        <details class="didactic-accordion" ${config.didacticExpanded ? 'open' : ''}>
          <summary class="didactic-summary">
            <span class="didactic-summary-icon">📖</span>
            Saber mais
            <span class="didactic-summary-chevron">▼</span>
          </summary>
          <section class="callout-grid tstudent-cards">
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
        <p class="small-note tstudent-section-note">Cole as colunas de dados da sua planilha (Excel) abaixo. O sistema identifica automaticamente se os dados estão em 2 colunas ou em 1 coluna de grupos + 1 de valores.</p>

        <div class="form-grid two" style="margin-bottom: 20px;">
          <div>
            <label for="t-context">Pergunta do estudo</label>
            <input id="t-context" type="text" placeholder="As médias dos dois grupos são diferentes?" value="${utils.escapeHtml(manualState.context || '')}" />
          </div>
          <div>
            <label for="t-alpha">Nível de significância (p-valor)</label>
            <select id="t-alpha">
              <option value="0.01"${manualState.alpha === '0.01' ? ' selected' : ''}>1%</option>
              <option value="0.05"${manualState.alpha === '0.05' ? ' selected' : ''}>5%</option>
              <option value="0.10"${manualState.alpha === '0.10' ? ' selected' : ''}>10%</option>
            </select>
          </div>
        </div>

        <div style="margin-bottom: 24px;">
          <label for="t-paste">Cole seus dados aqui</label>
          <textarea id="t-paste" class="input-box" placeholder="Grupo A&#9;Grupo B&#10;4,8&#9;6,1&#10;5,1&#9;5,8&#10;...">${utils.escapeHtml(manualState.paste)}</textarea>
          <div class="small-note" style="margin-top: 8px;">Dica: Você pode copiar duas colunas inteiras do Excel e colar aqui.</div>
        </div>

        <div class="actions-row" style="justify-content: space-between; align-items: center;">
          <div style="display: flex; gap: 12px; align-items: center;">
            <button type="button" class="lacir-info-btn" id="t-info-btn" title="Como usar" aria-label="Instruções de uso">ℹ</button>
            <button class="btn" id="t-run">Rodar análise</button>
            <button class="btn-ghost" id="t-clear">Limpar tudo</button>
          </div>
        </div>

        <dialog id="t-info-modal" class="lacir-info-modal">
          <div class="lacir-info-modal-header">
            <h4>📋 Como usar — T de Student</h4>
            <button class="btn-close-modal" onclick="this.closest('dialog').close()" aria-label="Fechar">×</button>
          </div>
          <div class="lacir-info-modal-body">
            <ol>
              <li><strong>Cole duas colunas numéricas</strong> da sua planilha no campo de texto — cada coluna representa um grupo.</li>
              <li>O formato esperado é <strong>Grupo A ⇥ Grupo B</strong>, com uma observação por linha.</li>
              <li>Você também pode colar <strong>uma coluna de grupos + uma coluna de valores</strong>, e o sistema separará automaticamente.</li>
              <li>Vírgula decimal (padrão BR) é aceita.</li>
              <div class="lacir-info-modal-tip">💡 Clique em <strong>Rodar análise</strong> para ver o resultado do teste t, intervalo de confiança e tamanho do efeito (d de Cohen).</div>
          </div>
        </dialog>
      </section>

      <section class="surface-card">
        <h4>Pré-visualização</h4>
        <div id="t-preview" class="small-note">Nenhum dado carregado ainda.</div>
        <div id="t-group-summary" class="metrics-grid t-group-summary" style="margin-top:14px;"></div>
      </section>

      <section class="surface-card tstudent-statistics-section">
        <h4>Resultados estatísticos</h4>
        <p class="small-note tstudent-section-note">Leitura rápida do teste t: médias, dispersão, evidência estatística e tamanho de efeito.</p>
        <div id="t-status" class="status-bar">Cole os dados para iniciar.</div>
        <div id="t-metrics" class="metrics-grid" style="margin-top:14px;"></div>
      </section>

      <section class="surface-card tstudent-chart-section">
        <h4>Visualização gráfica</h4>
        <p class="small-note tstudent-section-note">Os gráficos ajudam a inspecionar distribuição, diferença entre médias e incerteza.</p>
        <div id="t-chart" class="chart-grid" style="margin-top:14px;"></div>
      </section>

      <section class="surface-card tstudent-interpretation-section">
        <h4>Interpretação automática</h4>
        <p class="small-note tstudent-section-note">Resumo em linguagem natural para apoiar a leitura didática do resultado.</p>
        <div id="t-results" class="result-grid" style="margin-top:14px;"></div>
      </section>

      </section>
    </div>
  `;

  const manual = {
    pasteEl: root.querySelector('#t-paste'),
    previewEl: root.querySelector('#t-preview'),
    statusEl: root.querySelector('#t-status'),
    groupSummaryEl: root.querySelector('#t-group-summary'),
    metricsEl: root.querySelector('#t-metrics'),
    chartEl: root.querySelector('#t-chart'),
    resultsEl: root.querySelector('#t-results'),
    contextEl: root.querySelector('#t-context'),
    alphaEl: root.querySelector('#t-alpha')
  };


  function refreshManualPreview() {
    const parsed = parseDataset(manual.pasteEl.value, stats);

    if (!parsed.previewRows.length) {
      manual.previewEl.innerHTML = '<div class="small-note">Nenhum dado carregado ainda.</div>';
      manual.groupSummaryEl.innerHTML = '';
      return parsed;
    }

    const previewHeaders = parsed.mode === 'categorical_numeric' ? ['Grupo', 'Valor'] : parsed.headers;
    manual.previewEl.innerHTML = `
      <div class="small-note">Formato detectado: <strong>${parsed.mode === 'categorical_numeric' ? 'Grupo + valor' : 'Duas colunas num\u00e9ricas'}</strong> \u00b7 Linhas v\u00e1lidas: ${parsed.validRows} \u00b7 Linhas ignoradas: ${parsed.ignoredRows}</div>
      ${utils.renderPreviewTable(previewHeaders, parsed.previewRows)}
    `;
    manual.groupSummaryEl.innerHTML = `
      <div class="metric-card"><div class="metric-label">Grupo detectado 1</div><div class="metric-value">${utils.escapeHtml(parsed.groupNames[0] || 'Grupo 1')}</div><div class="metric-mini">n = ${parsed.g1.length}</div></div>
      <div class="metric-card"><div class="metric-label">Grupo detectado 2</div><div class="metric-value">${utils.escapeHtml(parsed.groupNames[1] || 'Grupo 2')}</div><div class="metric-mini">n = ${parsed.g2.length}</div></div>
      <div class="metric-card"><div class="metric-label">Dados v\u00e1lidos</div><div class="metric-value">${parsed.validRows}</div><div class="metric-mini">Total importado = ${parsed.rawRows}</div></div>
    `;

    return parsed;
  }

  function runManualAnalysis() {
    const parsed = refreshManualPreview();
    const alpha = Number(manual.alphaEl.value || 0.05);

    if (parsed.g1.length < 2 || parsed.g2.length < 2) {
      renderAnalysisError(manual.statusEl, manual.metricsEl, manual.chartEl, manual.resultsEl, 'Precisamos de pelo menos 2 valores v\u00e1lidos em cada grupo para rodar o teste t.');
      return;
    }

    const result = safeWelch(parsed.g1, parsed.g2, stats);
    if (!Number.isFinite(result.t) || !Number.isFinite(result.p)) {
      renderAnalysisError(manual.statusEl, manual.metricsEl, manual.chartEl, manual.resultsEl, 'N\u00e3o foi poss\u00edvel calcular o teste com esses dados.');
      return;
    }

    const labels = [parsed.groupNames[0] || 'Grupo 1', parsed.groupNames[1] || 'Grupo 2'];
    const significant = result.p < alpha;

    manual.statusEl.className = significant ? 'success-box' : 'status-bar';
    manual.statusEl.textContent = significant
      ? `Diferen\u00e7a estatisticamente significativa detectada (p ${utils.fmtP(result.p)} < ${alpha.toLocaleString('pt-BR')}).`
      : `N\u00e3o houve evid\u00eancia estat\u00edstica suficiente de diferen\u00e7a entre as m\u00e9dias (p ${utils.fmtP(result.p)}).`;
    manual.metricsEl.innerHTML = buildResultMetricsHtml(result, labels, utils);
    manual.chartEl.innerHTML = buildResultChartsHtml(result, labels, parsed.g1, parsed.g2, stats, utils);

    // Render Chart.js after DOM is ready 
    setTimeout(() => {
      renderTStudentDistChart('t-chart-dist', parsed.g1, parsed.g2, labels[0], labels[1], utils);
      renderTStudentDiffChart('t-chart-diff', result, labels, utils);
    }, 0);
    manual.resultsEl.innerHTML = buildManualInterpretation(result, alpha, labels, manual.contextEl.value || config.defaultQuestion || '', utils);
  }

  function clearManual() {
    manual.pasteEl.value = '';
    manual.contextEl.value = config.defaultQuestion || 'As médias dos grupos são diferentes?';
    manual.alphaEl.value = '0.05';
    manual.previewEl.innerHTML = '<div class="small-note">Nenhum dado carregado ainda.</div>';
    manual.groupSummaryEl.innerHTML = '';
    manual.statusEl.className = 'status-bar';
    manual.statusEl.textContent = 'Campos limpos. Cole novos dados e rode novamente.';
    manual.metricsEl.innerHTML = '';
    manual.chartEl.innerHTML = '';
    manual.resultsEl.innerHTML = '';

    manualState.paste = '';
    manualState.context = manual.contextEl.value;
    manualState.alpha = '0.05';
  }

  function invalidateDatasusRun() {
    datasusState.result = null;
    clearDatasusResultPanels();
    datasusRefs.resultStatusEl.className = 'status-bar';
    datasusRefs.resultStatusEl.textContent = datasusState.parsed
      ? 'A base derivada foi atualizada. Revise os grupos e clique em "Rodar t test" quando estiver v\u00e1lida.'
      : 'Aguardando importa\u00e7\u00e3o de arquivo.';
    updateDatasusRunAvailability();
  }

  function renderDatasusImportStatus() {
    if (datasusState.error) {
      datasusRefs.statusCardEl.className = 'error-box';
      datasusRefs.statusCardEl.innerHTML = datasusState.fileName
        ? `<div class="tstudent-file-status"><strong class="tstudent-file-name" title="${utils.escapeHtml(datasusState.fileName)}">${utils.escapeHtml(datasusState.fileName)}</strong><div>${utils.escapeHtml(datasusState.error)}</div></div>`
        : utils.escapeHtml(datasusState.error);
      return;
    }

    if (!datasusState.parsed) {
      datasusRefs.statusCardEl.className = 'status-bar';
      datasusRefs.statusCardEl.textContent = 'Importe um arquivo DATASUS para habilitar a configura\u00e7\u00e3o da compara\u00e7\u00e3o.';
      return;
    }

    const measureLabel = datasusState.parsed.measureLabel || 'N\u00e3o detectada';
    const titleLabel = datasusState.parsed.titleLine || 'Sem linha-t\u00edtulo identificada';

    datasusRefs.statusCardEl.className = 'info-banner';
    datasusRefs.statusCardEl.innerHTML = `
      <div class="metrics-grid tstudent-status-grid">
        <div class="metric-card">
          <div class="metric-label">Arquivo ativo</div>
          <div class="metric-value tstudent-compact-value tstudent-file-name" title="${utils.escapeHtml(datasusState.fileName)}">${utils.escapeHtml(datasusState.fileName)}</div>
          <div class="metric-mini">${datasusState.activeSource === 'upload' ? 'Arquivo enviado pelo usu\u00e1rio' : 'Exemplo carregado internamente'}</div>
        </div>
        <div class="metric-card">
          <div class="metric-label">Separador</div>
          <div class="metric-value">${utils.escapeHtml(labelFromDelimiter(datasusState.parsed.delimiter))}</div>
          <div class="metric-mini">Dimens\u00e3o detectada: ${utils.escapeHtml(datasusState.parsed.dimensionLabel)}</div>
        </div>
        <div class="metric-card">
          <div class="metric-label">Linhas detectadas</div>
          <div class="metric-value">${datasusState.parsed.detectedRowCount}</div>
          <div class="metric-mini">Linhas ignoradas com seguran\u00e7a: ${datasusState.parsed.ignoredRows}</div>
        </div>
        <div class="metric-card">
          <div class="metric-label">Anos detectados</div>
          <div class="metric-value">${datasusState.parsed.years.length}</div>
          <div class="metric-mini">${utils.escapeHtml(datasusState.parsed.years[0])} a ${utils.escapeHtml(datasusState.parsed.years[datasusState.parsed.years.length - 1])}</div>
        </div>
        <div class="metric-card">
          <div class="metric-label">Coluna Total</div>
          <div class="metric-value">${datasusState.parsed.hasTotalColumn ? 'Sim' : 'N\u00e3o'}</div>
          <div class="metric-mini">Linhas Total detectadas: ${datasusState.parsed.totalRows.length}</div>
        </div>
        <div class="metric-card">
          <div class="metric-label">Medida / descri\u00e7\u00e3o</div>
          <div class="metric-value tstudent-compact-value">${utils.escapeHtml(measureLabel)}</div>
          <div class="metric-mini">${utils.escapeHtml(titleLabel)}</div>
        </div>
      </div>
    `;
  }

  function renderDatasusPreview() {
    if (datasusState.error) {
      datasusRefs.previewEl.innerHTML = `<div class="error-box">${utils.escapeHtml(datasusState.error)}</div>`;
      return;
    }

    if (!datasusState.parsed) {
      datasusRefs.previewEl.innerHTML = '<div class="small-note">Nenhuma base importada ainda.</div>';
      return;
    }

    const metadataNote = datasusState.parsed.metadataLines.length
      ? `<div class="small-note" style="margin-bottom:12px;">Metadados detectados: ${utils.escapeHtml(datasusState.parsed.metadataLines.join(' | '))}</div>`
      : '';

    datasusRefs.previewEl.innerHTML = `
      ${metadataNote}
      <div class="small-note" style="margin-bottom:10px;">Cabe\u00e7alho identificado automaticamente na linha ${datasusState.parsed.headerRowIndex + 1}. A dimens\u00e3o principal detectada foi <strong>${utils.escapeHtml(datasusState.parsed.dimensionLabel)}</strong>.</div>
      ${utils.renderPreviewTable(datasusState.parsed.previewHeaders, datasusState.parsed.previewRows, 10)}
    `;
  }

  function renderDatasusControls() {
    if (!datasusState.parsed) {
      datasusRefs.controlsEl.innerHTML = '<div class="small-note">A configura\u00e7\u00e3o ficar\u00e1 dispon\u00edvel ap\u00f3s a leitura bem-sucedida do arquivo.</div>';
      updateDatasusRunAvailability();
      return;
    }

    const visibleRows = datasusState.parsed.parsedRows.filter(row => datasusState.showTotal || !row.isTotalRow);
    const selectedA = visibleRows.filter(row => datasusState.selectionMap[row.id] === 'A').length;
    const selectedB = visibleRows.filter(row => datasusState.selectionMap[row.id] === 'B').length;
    const availableBlocks = datasusState.blocks.complete.length ? datasusState.blocks.complete : datasusState.blocks.all;
    const incompleteNote = datasusState.blocks.incomplete.length
      ? `<div class="small-note tstudent-advanced-note">Blocos incompletos detectados: ${utils.escapeHtml(datasusState.blocks.incomplete.map(block => block.label).join(', '))}.</div>`
      : '';

    datasusRefs.controlsEl.innerHTML = `
      <div class="tstudent-config-summary">
        <span class="small-chip info">Grupo A selecionado: ${selectedA}</span>
        <span class="small-chip primary">Grupo B selecionado: ${selectedB}</span>
        <span class="small-chip ${datasusState.showTotal ? 'warning' : 'info'}">Linha Total ${datasusState.showTotal ? 'vis\u00edvel' : 'oculta por padr\u00e3o'}</span>
      </div>

      <div class="small-note" style="margin-top:12px;">Cada categoria pode ficar em apenas um grupo por vez. Selecione <strong>Nenhum</strong>, <strong>Grupo A</strong> ou <strong>Grupo B</strong>.</div>

      <div class="form-grid three" style="margin-top:16px;">
        <div>
          <label for="t-datasus-period-mode">Tipo de per\u00edodo</label>
          <select id="t-datasus-period-mode">
            <option value="all"${datasusState.periodMode === 'all' ? ' selected' : ''}>Todos os anos</option>
            <option value="single"${datasusState.periodMode === 'single' ? ' selected' : ''}>Ano \u00fanico</option>
            <option value="range"${datasusState.periodMode === 'range' ? ' selected' : ''}>Intervalo customizado</option>
            <option value="block"${datasusState.periodMode === 'block' ? ' selected' : ''}>Blocos autom\u00e1ticos de 5 anos</option>
          </select>
        </div>
        <div class="tstudent-period-field ${datasusState.periodMode === 'single' ? 'is-visible' : ''}">
          <label for="t-datasus-single-year">Ano</label>
          <select id="t-datasus-single-year">
            ${datasusState.parsed.years.map(year => `<option value="${utils.escapeHtml(year)}"${year === datasusState.singleYear ? ' selected' : ''}>${utils.escapeHtml(year)}</option>`).join('')}
          </select>
        </div>
        <div class="tstudent-period-field ${datasusState.periodMode === 'block' ? 'is-visible' : ''}">
          <label for="t-datasus-block">Bloco autom\u00e1tico</label>
          <select id="t-datasus-block">
            ${availableBlocks.length
        ? availableBlocks.map(block => `<option value="${utils.escapeHtml(block.key)}"${block.key === datasusState.blockKey ? ' selected' : ''}>${utils.escapeHtml(block.label)}</option>`).join('')
        : '<option value="">Nenhum bloco dispon\u00edvel</option>'}
          </select>
        </div>
      </div>

      <div class="form-grid two tstudent-range-grid ${datasusState.periodMode === 'range' ? 'is-visible' : ''}">
        <div>
          <label for="t-datasus-range-start">Ano inicial</label>
          <select id="t-datasus-range-start">
            ${datasusState.parsed.years.map(year => `<option value="${utils.escapeHtml(year)}"${year === datasusState.rangeStart ? ' selected' : ''}>${utils.escapeHtml(year)}</option>`).join('')}
          </select>
        </div>
        <div>
          <label for="t-datasus-range-end">Ano final</label>
          <select id="t-datasus-range-end">
            ${datasusState.parsed.years.map(year => `<option value="${utils.escapeHtml(year)}"${year === datasusState.rangeEnd ? ' selected' : ''}>${utils.escapeHtml(year)}</option>`).join('')}
          </select>
        </div>
      </div>
      ${incompleteNote}

      <label class="tstudent-toggle">
        <input id="t-datasus-show-total" type="checkbox"${datasusState.showTotal ? ' checked' : ''} />
        <span>Mostrar linha "Total" como op\u00e7\u00e3o avan\u00e7ada</span>
      </label>

      <div class="preview-table-wrap tstudent-assignment-wrap">
        <table class="preview-table tstudent-assignment-table">
          <thead>
            <tr>
              <th>${utils.escapeHtml(datasusState.parsed.dimensionLabel)}</th>
              <th>Nenhum</th>
              <th>Grupo A</th>
              <th>Grupo B</th>
              <th>Valores v\u00e1lidos</th>
            </tr>
          </thead>
          <tbody>
            ${visibleRows.map(row => {
          const selectedGroup = datasusState.selectionMap[row.id] || 'none';
          const rawNote = row.cleanLabel !== row.rowLabel ? `<div class="small-note" title="${utils.escapeHtml(row.rowLabel)}">Original: ${utils.escapeHtml(row.rowLabel)}</div>` : '';
          return `
                <tr class="${row.isTotalRow ? 'tstudent-total-option' : ''}">
                  <td class="tstudent-assignment-label">
                    <div class="tstudent-row-label">
                      <strong title="${utils.escapeHtml(row.cleanLabel)}">${utils.escapeHtml(row.cleanLabel)}</strong>
                      ${rawNote}
                    </div>
                  </td>
                  <td class="tstudent-radio-cell"><input type="radio" name="datasus-group-${utils.escapeHtml(row.id)}" value="none" data-role="datasus-group" data-row-id="${utils.escapeHtml(row.id)}"${selectedGroup === 'none' ? ' checked' : ''}></td>
                  <td class="tstudent-radio-cell"><input type="radio" name="datasus-group-${utils.escapeHtml(row.id)}" value="A" data-role="datasus-group" data-row-id="${utils.escapeHtml(row.id)}"${selectedGroup === 'A' ? ' checked' : ''}></td>
                  <td class="tstudent-radio-cell"><input type="radio" name="datasus-group-${utils.escapeHtml(row.id)}" value="B" data-role="datasus-group" data-row-id="${utils.escapeHtml(row.id)}"${selectedGroup === 'B' ? ' checked' : ''}></td>
                  <td>${row.valueCount}</td>
                </tr>
              `;
        }).join('')}
          </tbody>
        </table>
      </div>
    `;

    const periodModeEl = datasusRefs.controlsEl.querySelector('#t-datasus-period-mode');
    const singleYearEl = datasusRefs.controlsEl.querySelector('#t-datasus-single-year');
    const rangeStartEl = datasusRefs.controlsEl.querySelector('#t-datasus-range-start');
    const rangeEndEl = datasusRefs.controlsEl.querySelector('#t-datasus-range-end');
    const blockEl = datasusRefs.controlsEl.querySelector('#t-datasus-block');
    const showTotalEl = datasusRefs.controlsEl.querySelector('#t-datasus-show-total');

    periodModeEl?.addEventListener('change', event => {
      datasusState.periodMode = event.target.value;
      renderDatasusControls();
      renderDatasusDerived();
      invalidateDatasusRun();
    });

    singleYearEl?.addEventListener('change', event => {
      datasusState.singleYear = event.target.value;
      renderDatasusDerived();
      invalidateDatasusRun();
    });

    rangeStartEl?.addEventListener('change', event => {
      datasusState.rangeStart = event.target.value;
      renderDatasusDerived();
      invalidateDatasusRun();
    });

    rangeEndEl?.addEventListener('change', event => {
      datasusState.rangeEnd = event.target.value;
      renderDatasusDerived();
      invalidateDatasusRun();
    });

    blockEl?.addEventListener('change', event => {
      datasusState.blockKey = event.target.value;
      renderDatasusDerived();
      invalidateDatasusRun();
    });

    showTotalEl?.addEventListener('change', event => {
      datasusState.showTotal = event.target.checked;
      renderDatasusControls();
      renderDatasusDerived();
      invalidateDatasusRun();
    });

    datasusRefs.controlsEl.querySelectorAll('input[data-role="datasus-group"]').forEach(input => {
      input.addEventListener('change', event => {
        const rowId = event.target.dataset.rowId;
        const value = event.target.value;
        datasusState.selectionMap[rowId] = value === 'none' ? null : value;
        renderDatasusDerived();
        invalidateDatasusRun();
      });
    });

    updateDatasusRunAvailability();
  }

  function renderDatasusDerived() {
    if (!datasusState.parsed) {
      datasusState.derived = null;
      datasusRefs.derivedEl.innerHTML = '<div class="small-note">Selecione grupos e per\u00edodo para montar a base derivada.</div>';
      updateDatasusRunAvailability();
      return;
    }

    const derived = deriveDatasusComparison(datasusState, stats);
    datasusState.derived = derived;

    const groupList = groupKey => {
      const rows = derived.derivedRows.filter(row => row.groupKey === groupKey);
      if (!rows.length) return '<div class="small-note">Nenhuma observa\u00e7\u00e3o v\u00e1lida neste grupo.</div>';
      return `
        <ul class="tstudent-derived-list">
          ${rows.map(row => `
            <li>
              <span title="${utils.escapeHtml(row.rowLabel)}">
                <strong>${utils.escapeHtml(row.rowLabel)}</strong>
                <small>Anos usados: ${utils.escapeHtml(row.validYears.join(', '))}</small>
              </span>
              <strong class="tstudent-derived-value">${utils.fmtNumber(row.value, 2)}</strong>
            </li>
          `).join('')}
        </ul>
      `;
    };

    const validationBox = derived.validationErrors.length
      ? `
        <div class="error-box" style="margin-bottom:14px;">
          <strong>Base derivada ainda inv\u00e1lida.</strong>
          <ul class="tstudent-inline-list">${derived.validationErrors.map(message => `<li>${utils.escapeHtml(message)}</li>`).join('')}</ul>
        </div>
      `
      : '<div class="success-box" style="margin-bottom:14px;">Base derivada v\u00e1lida. Cada categoria permanece como uma observa\u00e7\u00e3o separada no grupo selecionado.</div>';

    const tableRows = derived.derivedRows.map(row => [
      row.rowLabel,
      row.groupLabel,
      utils.fmtNumber(row.value, 3),
      row.validYears.join(', ')
    ]);

    const omittedHtml = derived.omittedRows.length
      ? `<div class="small-note" style="margin-top:12px;">Categorias sem valores aproveit\u00e1veis no per\u00edodo atual: ${utils.escapeHtml(derived.omittedRows.map(item => item.rowLabel).join(', '))}.</div>`
      : '';

    datasusRefs.derivedEl.innerHTML = `
      ${validationBox}
      <div class="metrics-grid">
        <div class="metric-card">
          <div class="metric-label">Per\u00edodo selecionado</div>
          <div class="metric-value tstudent-compact-value">${utils.escapeHtml(derived.periodLabel || 'sem per\u00edodo v\u00e1lido')}</div>
          <div class="metric-mini">Anos usados: ${derived.selectedYears.length ? utils.escapeHtml(derived.selectedYears.join(', ')) : 'nenhum'}</div>
        </div>
        <div class="metric-card">
          <div class="metric-label">Observa\u00e7\u00f5es v\u00e1lidas no Grupo A</div>
          <div class="metric-value">${derived.validCounts.A}</div>
          <div class="metric-mini">Linhas atribu\u00eddas: ${derived.selectionCounts.A}</div>
        </div>
        <div class="metric-card">
          <div class="metric-label">Observa\u00e7\u00f5es v\u00e1lidas no Grupo B</div>
          <div class="metric-value">${derived.validCounts.B}</div>
          <div class="metric-mini">Linhas atribu\u00eddas: ${derived.selectionCounts.B}</div>
        </div>
      </div>

      <div class="tstudent-derived-groups">
        <article class="mini-card">
          <h4>Grupo A</h4>
          ${groupList('A')}
        </article>
        <article class="mini-card">
          <h4>Grupo B</h4>
          ${groupList('B')}
        </article>
      </div>

      <div class="small-note" style="margin:14px 0 10px;">Resumo utilizado: m\u00e9dia dos anos selecionados dentro de cada categoria, sem colapsar o grupo inteiro em um \u00fanico n\u00famero.</div>
      ${utils.renderPreviewTable([datasusState.parsed.dimensionLabel, 'Grupo', 'Valor resumido', 'Anos usados'], tableRows, 20)}
      ${omittedHtml}
    `;

    updateDatasusRunAvailability();
  }



  root.querySelector('#t-run').addEventListener('click', runManualAnalysis);
  root.querySelector('#t-clear').addEventListener('click', clearManual);
  manual.pasteEl.addEventListener('input', () => {
    manualState.paste = manual.pasteEl.value;
    refreshManualPreview();
  });
  manual.contextEl.addEventListener('input', () => {
    manualState.context = manual.contextEl.value;
  });
  manual.alphaEl.addEventListener('change', () => {
    manualState.alpha = manual.alphaEl.value;
  });


  // Hydrate views if previous state exists
  if (manualState.paste.trim()) {
    setTimeout(() => {
      runManualAnalysis();
    }, 10);
  }

}

// Fim do modulo t-student
