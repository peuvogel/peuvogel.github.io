const DEFAULT_MISSING_TOKENS = new Set([
  '',
  '-',
  '--',
  '...',
  '.',
  'na',
  'n/a',
  'null',
  'nan',
  'sem informacao',
  'sem informacao disponivel',
  'ignorado'
]);

const HEADER_KEYWORDS = [
  'regiao',
  'uf',
  'municipio',
  'hospital',
  'procedimento',
  'sexo',
  'idade',
  'faixa',
  'natureza',
  'capitulo',
  'cid',
  'competencia',
  'ano',
  'mes',
  'periodo',
  'valor',
  'taxa',
  'media',
  'internacao',
  'obito'
];

const MONTH_TOKENS = [
  'jan',
  'fev',
  'mar',
  'abr',
  'mai',
  'jun',
  'jul',
  'ago',
  'set',
  'out',
  'nov',
  'dez'
];

function callOrFallback(fn, fallback) {
  return typeof fn === 'function' ? fn : fallback;
}

function baseNormalizeText(text) {
  return String(text || '')
    .replace(/\u0000/g, '')
    .replace(/\r\n?/g, '\n')
    .normalize('NFC');
}

function baseNormalizeLabel(value) {
  return baseNormalizeText(value).replace(/\s+/g, ' ').trim();
}

export function normalizeDatasusText(text, utils) {
  const normalizeText = callOrFallback(utils?.normalizeImportedText, baseNormalizeText);
  return normalizeText(String(text || ''));
}

export function normalizeDatasusLabel(value, utils) {
  const normalizeLabel = callOrFallback(utils?.normalizeImportedLabel, baseNormalizeLabel);
  return normalizeLabel(String(value || ''));
}

export function normalizeDatasusToken(value, utils) {
  return normalizeDatasusLabel(value, utils)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

export function isMissingToken(value, utils) {
  return DEFAULT_MISSING_TOKENS.has(normalizeDatasusToken(value, utils));
}

export function parseDatasusNumber(raw, stats) {
  if (stats?.parseNumber) {
    return stats.parseNumber(raw);
  }

  if (raw === null || raw === undefined) return null;
  let source = String(raw).trim();
  if (!source) return null;
  source = source.replace(/\s+/g, '');
  if (source.includes(',') && source.includes('.')) {
    if (source.lastIndexOf(',') > source.lastIndexOf('.')) {
      source = source.replace(/\./g, '').replace(',', '.');
    } else {
      source = source.replace(/,/g, '');
    }
  } else if (source.includes(',') && !source.includes('.')) {
    source = source.replace(',', '.');
  }

  const value = Number(source);
  return Number.isFinite(value) ? value : null;
}

export function splitDelimitedLine(line, delimiter) {
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
        cells.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  cells.push(current);
  return cells;
}

function dominantCount(values) {
  const counts = new Map();
  values.forEach(value => {
    counts.set(value, (counts.get(value) || 0) + 1);
  });

  let winner = { value: 0, frequency: 0 };
  counts.forEach((frequency, value) => {
    if (frequency > winner.frequency) {
      winner = { value, frequency };
    }
  });
  return winner;
}

function scoreDelimiter(lines, delimiter, utils) {
  const sample = lines.slice(0, 20).map(line => line.clean).filter(Boolean);
  if (!sample.length) return -Infinity;

  const counts = sample.map(line => splitDelimitedLine(line, delimiter).filter(cell => normalizeDatasusLabel(cell, utils) !== '').length);
  const meaningful = counts.filter(count => count >= 2);
  if (!meaningful.length) return -Infinity;

  const winner = dominantCount(meaningful);
  const average = meaningful.reduce((sum, value) => sum + value, 0) / meaningful.length;
  const spreadPenalty = meaningful.reduce((sum, value) => sum + Math.abs(value - winner.value), 0);
  const bias = delimiter === ';' ? 0.35 : delimiter === '\t' ? 0.25 : 0.05;

  return (winner.frequency * 4.5) + (winner.value * 2.2) + average + bias - spreadPenalty;
}

export function detectDatasusDelimiter(lines, utils) {
  const candidates = [';', '\t', ','];
  const scored = candidates
    .map(delimiter => ({ delimiter, score: scoreDelimiter(lines, delimiter, utils) }))
    .sort((left, right) => right.score - left.score);

  return scored[0]?.delimiter || ';';
}

export function delimiterLabel(delimiter) {
  if (delimiter === ';') return ';';
  if (delimiter === '\t') return 'tab';
  return ',';
}

export function isYearLikeToken(value, utils) {
  return /^(18|19|20)\d{2}$/.test(normalizeDatasusToken(value, utils));
}

export function isTimeLikeToken(value, utils) {
  const token = normalizeDatasusToken(value, utils);
  if (!token) return false;
  if (isYearLikeToken(token, utils)) return true;
  if (/^(18|19|20)\d{2}[-/](0?[1-9]|1[0-2])$/.test(token)) return true;
  if (/^(0?[1-9]|1[0-2])[-/](18|19|20)\d{2}$/.test(token)) return true;
  if (/^comp(etencia)?\s*(18|19|20)?\d{2}/.test(token)) return true;
  if (MONTH_TOKENS.some(month => token.includes(month)) && /(?:18|19|20)\d{2}/.test(token)) return true;
  if (['ano', 'anos', 'mes', 'meses', 'tempo', 'periodo', 'competencia'].includes(token)) return true;
  return false;
}

export function isTotalLikeToken(value, utils) {
  const token = normalizeDatasusToken(value, utils);
  return token === 'total' || token.startsWith('total ');
}

export function cleanDatasusCategoryLabel(value, utils) {
  const normalized = normalizeDatasusLabel(value, utils);
  const withoutDots = normalized.replace(/^(?:\.\.?)+\s*/, '').trim();
  const withoutIndex = withoutDots.replace(/^\(?\d+\)?(?:[.\-])?\s+/, '').trim();
  return withoutIndex || withoutDots || normalized;
}

function buildLineObjects(text, utils) {
  return normalizeDatasusText(text, utils)
    .split('\n')
    .map((raw, index) => ({
      index,
      raw,
      clean: normalizeDatasusLabel(raw, utils)
    }));
}

function buildRowMatrix(lines, delimiter, utils) {
  return lines.map(line => {
    const rawCells = splitDelimitedLine(line.raw, delimiter);
    const cleanCells = rawCells.map(cell => normalizeDatasusLabel(cell, utils));
    return {
      lineIndex: line.index,
      rawLine: line.raw,
      rawCells,
      cleanCells
    };
  });
}

function headerKeywordHits(cells, utils) {
  return cells.reduce((hits, cell) => {
    const token = normalizeDatasusToken(cell, utils);
    return hits + (HEADER_KEYWORDS.some(keyword => token.includes(keyword)) ? 1 : 0);
  }, 0);
}

function scoreHeaderCandidate(row, followingRows, utils, stats) {
  const nonEmptyCells = row.cleanCells.filter(Boolean);
  if (nonEmptyCells.length < 2) {
    return {
      score: -100,
      reasons: ['Poucas células preenchidas.']
    };
  }

  const numericCount = nonEmptyCells.filter(cell => parseDatasusNumber(cell, stats) !== null).length;
  const timeCount = nonEmptyCells.filter(cell => isTimeLikeToken(cell, utils)).length;
  const textCount = nonEmptyCells.length - numericCount;
  const keywordCount = headerKeywordHits(nonEmptyCells, utils);
  const nextAlignedRows = followingRows.filter(nextRow => {
    const rowCount = nextRow.cleanCells.filter(Boolean).length;
    return rowCount >= Math.max(2, nonEmptyCells.length - 1);
  });
  const nextNumericCells = followingRows.reduce((sum, nextRow) => sum + nextRow.cleanCells.filter(cell => parseDatasusNumber(cell, stats) !== null).length, 0);
  const firstCell = nonEmptyCells[0] || '';
  const metadataPenalty = firstCell.includes(':') && nonEmptyCells.length <= 3 ? 5 : 0;

  const score = (
    (textCount * 1.4) +
    (timeCount * 3.4) +
    (keywordCount * 2.4) +
    (nextAlignedRows.length * 2.2) +
    Math.min(8, nextNumericCells * 0.45) -
    (numericCount * 1.25) -
    metadataPenalty
  );

  const reasons = [];
  if (timeCount) reasons.push(`${timeCount} coluna(s) temporais sugeridas`);
  if (keywordCount) reasons.push(`${keywordCount} termo(s) típicos de cabeçalho`);
  if (nextAlignedRows.length) reasons.push(`${nextAlignedRows.length} linha(s) seguintes com estrutura compatível`);
  if (metadataPenalty) reasons.push('Linha parece metadado');

  return { score, reasons };
}

export function buildHeaderCandidates(rowMatrix, utils, stats) {
  const upperLimit = Math.min(rowMatrix.length, 24);
  const candidates = [];

  for (let index = 0; index < upperLimit; index += 1) {
    const row = rowMatrix[index];
    const followingRows = rowMatrix.slice(index + 1, index + 6).filter(nextRow => nextRow.cleanCells.some(Boolean));
    const { score, reasons } = scoreHeaderCandidate(row, followingRows, utils, stats);
    candidates.push({
      rowIndex: row.lineIndex,
      preview: row.cleanCells.filter(Boolean).slice(0, 5).join(' | ') || `Linha ${row.lineIndex + 1}`,
      score,
      reasons
    });
  }

  return candidates.sort((left, right) => right.score - left.score);
}

function padCells(cells, size) {
  const padded = [...cells];
  while (padded.length < size) padded.push('');
  return padded;
}

function profileColumn({ header, values, index }, utils, stats) {
  const nonEmptyValues = values.filter(value => !isMissingToken(value, utils));
  const numericCount = nonEmptyValues.filter(value => parseDatasusNumber(value, stats) !== null).length;
  const timeCount = nonEmptyValues.filter(value => isTimeLikeToken(value, utils)).length;
  const totalCount = nonEmptyValues.filter(value => isTotalLikeToken(value, utils)).length;
  const normalizedHeader = normalizeDatasusToken(header, utils);
  const textCount = Math.max(0, nonEmptyValues.length - numericCount);
  const numericRatio = nonEmptyValues.length ? numericCount / nonEmptyValues.length : 0;
  const timeRatio = nonEmptyValues.length ? timeCount / nonEmptyValues.length : 0;

  let suggestedRole = 'category';
  if (isTotalLikeToken(header, utils) || normalizedHeader === 'total') {
    suggestedRole = 'total';
  } else if (isTimeLikeToken(header, utils) || normalizedHeader.includes('ano') || normalizedHeader.includes('mes') || normalizedHeader.includes('compet')) {
    suggestedRole = 'time';
  } else if (numericRatio >= 0.8 && nonEmptyValues.length > 0) {
    suggestedRole = 'measure';
  } else if (timeRatio >= 0.8) {
    suggestedRole = 'time';
  } else if (totalCount && totalCount === nonEmptyValues.length) {
    suggestedRole = 'total';
  }

  const suggestedType = suggestedRole === 'time'
    ? 'temporal'
    : suggestedRole === 'measure'
      ? 'quantitative'
      : suggestedRole === 'total'
        ? 'total'
        : 'categorical';

  return {
    index,
    header: header || `Coluna ${index + 1}`,
    normalizedHeader,
    sampleValues: nonEmptyValues.slice(0, 4),
    nonEmptyCount: nonEmptyValues.length,
    numericCount,
    timeCount,
    totalCount,
    textCount,
    numericRatio,
    timeRatio,
    suggestedRole,
    suggestedType
  };
}

function detectProbableFormat(columnProfiles) {
  const timeColumns = columnProfiles.filter(profile => profile.suggestedRole === 'time');
  const measureColumns = columnProfiles.filter(profile => profile.suggestedRole === 'measure');

  if (timeColumns.length >= 2) return 'wide';
  if (measureColumns.length >= 2) return 'long';
  if (timeColumns.length >= 1 && measureColumns.length >= 1) return 'long';
  return 'hybrid';
}

function findPrimaryCategoryColumn(columnProfiles, formatType) {
  const categories = columnProfiles.filter(profile => profile.suggestedRole === 'category');
  if (!categories.length) return null;

  if (formatType === 'wide') {
    return categories[0];
  }

  return categories.sort((left, right) => {
    if (right.textCount !== left.textCount) return right.textCount - left.textCount;
    return left.index - right.index;
  })[0];
}

function buildDiagnosis({ delimiter, headerRowIndex, metadataLines, columnProfiles, formatType, primaryCategory, bodyRows, utils }) {
  const timeColumns = columnProfiles.filter(profile => profile.suggestedRole === 'time');
  const measureColumns = columnProfiles.filter(profile => profile.suggestedRole === 'measure');
  const totalColumns = columnProfiles.filter(profile => profile.suggestedRole === 'total');
  const totalRows = bodyRows.filter(row => {
    const candidate = primaryCategory ? row.cleanCells[primaryCategory.index] : row.cleanCells[0];
    return isTotalLikeToken(candidate, utils);
  });
  const timeLabels = timeColumns.map(profile => profile.header).filter(Boolean);

  return {
    delimiter,
    delimiterLabel: delimiterLabel(delimiter),
    headerRowIndex,
    metadataLines,
    formatType,
    primaryCategoryIndex: primaryCategory?.index ?? null,
    primaryCategoryLabel: primaryCategory?.header || 'Categoria',
    timeColumnIndices: timeColumns.map(profile => profile.index),
    timeLabels,
    measureColumnIndices: measureColumns.map(profile => profile.index),
    measureLabels: measureColumns.map(profile => profile.header),
    totalColumnIndices: totalColumns.map(profile => profile.index),
    hasTotalColumn: totalColumns.length > 0,
    totalRowCount: totalRows.length,
    summaryText: [
      'Arquivo DATASUS detectado.',
      `Separador: ${delimiterLabel(delimiter)}.`,
      `Formato provável: ${formatType}.`,
      `Dimensão principal nas linhas: ${primaryCategory?.header || 'não identificada'}.`,
      `Colunas temporais detectadas: ${timeLabels.length ? timeLabels.join(', ') : 'não identificadas'}.`,
      `Colunas de medida detectadas: ${measureColumns.length ? measureColumns.map(profile => profile.header).join(', ') : 'não identificadas'}.`,
      `Coluna Total detectada: ${totalColumns.length ? 'sim' : 'não'}.`,
      `Cabeçalho provável: linha ${headerRowIndex + 1}.`
    ].join(' ')
  };
}

export function createInitialDatasusMapping(parsed) {
  const columns = parsed.columnProfiles.map(profile => {
    let role = profile.suggestedRole;
    if (parsed.diagnosis.primaryCategoryIndex === profile.index) {
      role = 'primary-category';
    }

    const variableType = role === 'primary-category' || role === 'category'
      ? 'categorical'
      : role === 'time'
        ? 'temporal'
        : role === 'measure'
          ? 'quantitative'
          : role === 'total'
            ? 'total'
            : 'metadata';

    return {
      index: profile.index,
      header: profile.header,
      role,
      variableType
    };
  });

  return {
    headerRowIndex: parsed.headerRowIndex,
    formatType: parsed.diagnosis.formatType,
    columns,
    excludeTotalByDefault: true
  };
}

export function parseDatasusText({ text, fileName = '', utils, stats, headerRowIndex = null }) {
  const lines = buildLineObjects(text, utils).filter(line => line.clean !== '');
  if (!lines.length) {
    return {
      ok: false,
      fileName,
      error: 'Nenhum conteúdo foi encontrado no arquivo informado.'
    };
  }

  const delimiter = detectDatasusDelimiter(lines, utils);
  const rowMatrix = buildRowMatrix(lines, delimiter, utils);
  const headerCandidates = buildHeaderCandidates(rowMatrix, utils, stats);
  const fallbackHeaderRowIndex = rowMatrix.find(row => row.cleanCells.filter(Boolean).length >= 2)?.lineIndex ?? 0;
  const effectiveHeaderRowIndex = Number.isInteger(headerRowIndex)
    ? Math.max(0, Math.min(headerRowIndex, rowMatrix[rowMatrix.length - 1].lineIndex))
    : (headerCandidates[0]?.rowIndex ?? fallbackHeaderRowIndex);

  const headerRow = rowMatrix.find(row => row.lineIndex === effectiveHeaderRowIndex) || rowMatrix[0];
  const bodyRows = rowMatrix.filter(row => row.lineIndex > effectiveHeaderRowIndex && row.cleanCells.some(Boolean));
  const maxCols = Math.max(
    headerRow.cleanCells.length,
    ...bodyRows.map(row => row.cleanCells.length),
    0
  );
  const headers = padCells(headerRow.cleanCells, maxCols).map((cell, index) => cell || `Coluna ${index + 1}`);
  const normalizedBodyRows = bodyRows.map(row => ({
    ...row,
    rawCells: padCells(row.rawCells, maxCols),
    cleanCells: padCells(row.cleanCells, maxCols)
  }));
  const metadataLines = rowMatrix
    .filter(row => row.lineIndex < effectiveHeaderRowIndex)
    .map(row => row.cleanCells.filter(Boolean).join(' | '))
    .filter(Boolean);

  const columnProfiles = headers.map((header, index) => profileColumn({
    header,
    index,
    values: normalizedBodyRows.map(row => row.cleanCells[index] || '')
  }, utils, stats));
  const formatType = detectProbableFormat(columnProfiles);
  const primaryCategory = findPrimaryCategoryColumn(columnProfiles, formatType);
  const diagnosis = buildDiagnosis({
    delimiter,
    headerRowIndex: effectiveHeaderRowIndex,
    metadataLines,
    columnProfiles,
    formatType,
    primaryCategory,
    bodyRows: normalizedBodyRows,
    utils
  });

  const parsed = {
    ok: true,
    fileName,
    rawText: normalizeDatasusText(text, utils),
    lines,
    delimiter,
    headerCandidates,
    headerRowIndex: effectiveHeaderRowIndex,
    headers,
    rowMatrix,
    bodyRows: normalizedBodyRows,
    columnProfiles,
    diagnosis
  };

  parsed.initialMapping = createInitialDatasusMapping(parsed);
  return parsed;
}
