import { createDatasusWizard } from '../../assets/js/datasus-wizard.js';
import {
  deriveIndependentTTest,
  derivePairedTTest,
  findBestNormalizedPair,
  getCategoryOptions,
  getMetricOptions,
  getPrimaryMetricKey,
  getTimeOptions
} from '../../assets/js/datasus-normalizer.js';
import {
  safeWelch,
  safePaired,
  renderAnalysisError,
  buildResultMetricsHtml,
  buildResultChartsHtml,
  buildManualInterpretation
} from './module.js';

const MANUAL_EMPTY_TEMPLATE_URL = new URL('./templates/modelo-t-student-vazio.csv', import.meta.url).href;
const MANUAL_FILLED_TEMPLATE_URL = new URL('./templates/modelo-t-student-exemplo.csv', import.meta.url).href;
const MANUAL_WIDE_FORMAT_LABEL = 'unidade;grupo_a;grupo_b;observacao_opcional';
const MANUAL_WIDE_PREVIEW_HEADERS = ['unidade', 'grupo_a', 'grupo_b', 'observacao_opcional'];
const MANUAL_HEADER_ALIASES = {
  unidade: ['unidade', 'uf', 'unidade_analitica', 'unidade analitica', 'estado'],
  grupo_a: ['grupo_a', 'grupo a', 'grupo1', 'grupo_1', 'grupo 1'],
  grupo_b: ['grupo_b', 'grupo b', 'grupo2', 'grupo_2', 'grupo 2'],
  observacao_opcional: ['observacao', 'observacao opcional', 'obs', 'comentario', 'comentario opcional']
};
const MANUAL_POSITION_FALLBACK = {
  keysByIndex: ['unidade', 'grupo_a', 'grupo_b', 'observacao_opcional'],
  minColumns: 3,
  requiredKeys: ['grupo_a', 'grupo_b'],
  introText: 'Nao reconhecemos os nomes padrao das colunas, entao usamos a estrutura por posicao da planilha.',
  assumptionText: 'Assumimos: 1a coluna = identificacao, 2a = grupo A, 3a = grupo B.',
  headerText: 'Os nomes do cabecalho foram aproveitados automaticamente na interface.'
};
const MANUAL_WIDE_EXAMPLE_ROWS = [
  ['Rondonia', '2,2', '2,2', ''],
  ['Acre', '3', '3,3', ''],
  ['Amazonas', '3,7', '2,8', ''],
  ['Roraima', '2,9', '3,3', '']
];
const MANUAL_WIDE_EXAMPLE_TEXT = [
  MANUAL_WIDE_FORMAT_LABEL,
  ...MANUAL_WIDE_EXAMPLE_ROWS.map(row => row.join(';'))
].join('\n');
const MANUAL_QUICK_EXAMPLES = {
  independent: {
    units: '',
    groupA: MANUAL_WIDE_EXAMPLE_ROWS.map(row => row[1]).join('\n'),
    groupB: MANUAL_WIDE_EXAMPLE_ROWS.map(row => row[2]).join('\n')
  },
  paired: {
    units: MANUAL_WIDE_EXAMPLE_ROWS.map(row => row[0]).join('\n'),
    groupA: MANUAL_WIDE_EXAMPLE_ROWS.map(row => row[1]).join('\n'),
    groupB: MANUAL_WIDE_EXAMPLE_ROWS.map(row => row[2]).join('\n')
  }
};

function normalizeManualText(value) {
  return String(value || '')
    .replace(/\uFEFF/g, '')
    .replace(/\u0000/g, '')
    .replace(/\r\n?/g, '\n')
    .normalize('NFC');
}

function normalizeManualSpaces(value) {
  return normalizeManualText(value)
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeManualToken(value) {
  return normalizeManualSpaces(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[_-]+/g, ' ')
    .replace(/[^a-z0-9\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .trim();
}

function structuralCommaCount(line) {
  let count = 0;

  for (let index = 0; index < line.length; index += 1) {
    if (line[index] !== ',') continue;
    if (/\d/.test(line[index - 1] || '') && /\d/.test(line[index + 1] || '')) continue;
    count += 1;
  }

  return count;
}

function splitManualDelimitedLine(line, delimiter) {
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
        cells.push(normalizeManualSpaces(current));
        current = '';
      }
      continue;
    }

    current += char;
  }

  cells.push(normalizeManualSpaces(current));
  return cells;
}

function detectManualDelimiter(lines) {
  const sample = (lines || []).slice(0, Math.min((lines || []).length, 10));
  let semicolonScore = 0;
  let tabScore = 0;
  let commaScore = 0;

  sample.forEach(line => {
    semicolonScore += (line.match(/;/g) || []).length;
    tabScore += (line.match(/\t/g) || []).length;
    commaScore += structuralCommaCount(line);
  });

  if (semicolonScore > 0 && semicolonScore >= tabScore && semicolonScore >= commaScore) return ';';
  if (tabScore > 0 && tabScore >= commaScore) return '\t';
  if (commaScore > 0) return ',';
  return ';';
}

function delimiterLabel(delimiter) {
  if (delimiter === '\t') return 'tabulacao';
  if (delimiter === ';') return 'ponto e virgula';
  if (delimiter === ',') return 'virgula';
  return 'texto simples';
}

function normalizeManualNumericSource(raw) {
  if (raw === null || raw === undefined) return '';

  let source = String(raw)
    .replace(/\u00A0/g, ' ')
    .trim();

  if (!source) return '';

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

  return source;
}

function parseManualNumericValue(raw, stats) {
  const normalized = normalizeManualNumericSource(raw);
  if (!normalized) return null;

  const direct = Number(normalized);
  if (Number.isFinite(direct)) return direct;

  if (typeof stats?.parseNumber === 'function') {
    return stats.parseNumber(normalized);
  }

  return null;
}

function rawUsesDecimalComma(raw) {
  return /,\d/.test(String(raw || ''));
}

function describeIgnoredRowReason(index, notes = []) {
  const first = String(notes[0] || 'linha sem valor numerico utilizavel.')
    .trim()
    .replace(/\.$/, '');
  const normalized = first ? `${first.charAt(0).toLowerCase()}${first.slice(1)}` : 'a linha nao trouxe valores numericos validos';
  return `A linha ${index} foi ignorada porque ${normalized}.`;
}

function splitQuickInputTokens(text, { numeric = false } = {}) {
  const lines = normalizeManualText(text)
    .split('\n')
    .map(line => line.trimEnd());
  const tokens = [];

  lines.forEach(line => {
    const source = line.trim();
    if (!source) return;

    let cells = [source];
    if (source.includes('\t')) {
      cells = splitManualDelimitedLine(source, '\t');
    } else if (source.includes(';')) {
      cells = splitManualDelimitedLine(source, ';');
    } else if (structuralCommaCount(source) > 0) {
      cells = splitManualDelimitedLine(source, ',');
    } else if (numeric && /\s{2,}/.test(source)) {
      cells = source.split(/\s{2,}/).map(value => normalizeManualSpaces(value));
    }

    cells
      .map(cell => normalizeManualSpaces(cell))
      .filter(Boolean)
      .forEach(raw => tokens.push({ raw }));
  });

  return tokens;
}

function summarizeQuickInput(text, stats, { numeric = false } = {}) {
  const tokens = splitQuickInputTokens(text, { numeric });
  const valid = numeric
    ? tokens.filter(item => parseManualNumericValue(item.raw, stats) !== null).length
    : tokens.length;

  return {
    total: tokens.length,
    valid,
    invalid: Math.max(0, tokens.length - valid)
  };
}

function buildEmptyManualDataset(mode, sourceKind = 'quick', sourceLabel = 'Edicao por grupos') {
  return {
    mode,
    sourceKind,
    sourceLabel,
    hasContent: false,
    rows: [],
    vectors: { A: [], B: [] },
    validCounts: { A: 0, B: 0, pairs: 0 },
    numericCounts: { A: 0, B: 0 },
    ignoredRows: [],
    errors: [],
    warnings: [],
    infos: [],
    rawRows: 0,
    recognizedColumns: {},
    fileMeta: null,
    displayLabels: {
      unit: 'Unidade',
      groupA: 'Grupo A',
      groupB: 'Grupo B',
      observation: 'Observacao',
      groupAWithRole: 'Grupo A',
      groupBWithRole: 'Grupo B'
    }
  };
}

function buildManualDisplayLabels(recognizedColumns = {}) {
  const isCustomHeader = (header, aliases) => {
    const normalized = normalizeManualToken(header);
    if (!normalized) return false;
    return !(aliases || []).some(alias => normalizeManualToken(alias) === normalized);
  };

  const rawUnit = recognizedColumns.unidade?.header || '';
  const rawGroupA = recognizedColumns.grupo_a?.header || '';
  const rawGroupB = recognizedColumns.grupo_b?.header || '';
  const rawObservation = recognizedColumns.observacao_opcional?.header || '';
  const groupA = isCustomHeader(rawGroupA, MANUAL_HEADER_ALIASES.grupo_a) ? rawGroupA : 'Grupo A';
  const groupB = isCustomHeader(rawGroupB, MANUAL_HEADER_ALIASES.grupo_b) ? rawGroupB : 'Grupo B';

  return {
    unit: isCustomHeader(rawUnit, MANUAL_HEADER_ALIASES.unidade) ? rawUnit : 'Unidade',
    groupA,
    groupB,
    observation: isCustomHeader(rawObservation, MANUAL_HEADER_ALIASES.observacao_opcional) ? rawObservation : 'Observacao',
    groupAWithRole: groupA !== 'Grupo A' ? `Grupo A (${groupA})` : 'Grupo A',
    groupBWithRole: groupB !== 'Grupo B' ? `Grupo B (${groupB})` : 'Grupo B'
  };
}

function buildManualDatasetFromStructuredRows(options, stats) {
  const {
    mode,
    sourceKind = 'quick',
    sourceLabel = 'Edicao por grupos',
    rows = [],
    recognizedColumns = {},
    fileMeta = null,
    displayLabels = buildManualDisplayLabels(recognizedColumns)
  } = options;

  const hasContent = rows.some(row => (
    normalizeManualSpaces(row.unitRaw)
    || normalizeManualSpaces(row.groupARaw)
    || normalizeManualSpaces(row.groupBRaw)
    || normalizeManualSpaces(row.observationRaw)
  ));

  if (!hasContent) {
    return {
      ...buildEmptyManualDataset(mode, sourceKind, sourceLabel),
      recognizedColumns,
      fileMeta,
      displayLabels
    };
  }

  const datasetRows = [];
  const vectors = { A: [], B: [] };
  const numericCounts = { A: 0, B: 0 };
  const validCounts = { A: 0, B: 0, pairs: 0 };
  let mismatchDetected = false;
  let ignoredByTextOrEmpty = false;

  rows.forEach((row, index) => {
    const unitRaw = normalizeManualSpaces(row.unitRaw);
    const groupARaw = normalizeManualSpaces(row.groupARaw);
    const groupBRaw = normalizeManualSpaces(row.groupBRaw);
    const observationRaw = normalizeManualSpaces(row.observationRaw);
    const groupAValue = parseManualNumericValue(groupARaw, stats);
    const groupBValue = parseManualNumericValue(groupBRaw, stats);
    const notes = [];
    const unitLabel = unitRaw || `Linha ${index + 1}`;

    if (groupAValue !== null) numericCounts.A += 1;
    if (groupBValue !== null) numericCounts.B += 1;

    let statusLabel = 'Ignorada';
    let statusTone = 'ignored';
    let usedInA = false;
    let usedInB = false;
    let usedAsPair = false;

    if (mode === 'paired') {
      if (groupAValue !== null && groupBValue !== null) {
        statusLabel = 'Valida (par mantido)';
        statusTone = 'valid';
        usedInA = true;
        usedInB = true;
        usedAsPair = true;
        vectors.A.push(groupAValue);
        vectors.B.push(groupBValue);
        validCounts.A += 1;
        validCounts.B += 1;
        validCounts.pairs += 1;
      } else {
        if (groupAValue !== null || groupBValue !== null) mismatchDetected = true;
        if (!groupARaw || !groupBRaw) {
          notes.push('Falta valor correspondente para formar o par.');
        }
        if (groupARaw && groupAValue === null) {
          notes.push(`${displayLabels.groupA} nao contem valor numerico valido.`);
        }
        if (groupBRaw && groupBValue === null) {
          notes.push(`${displayLabels.groupB} nao contem valor numerico valido.`);
        }
        if (!notes.length) {
          notes.push('Linha sem dois valores numericos utilizaveis.');
        }
        ignoredByTextOrEmpty = true;
      }
    } else {
      if (groupAValue !== null || groupBValue !== null) {
        usedInA = groupAValue !== null;
        usedInB = groupBValue !== null;
        statusTone = 'valid';
        if (usedInA && usedInB) {
          statusLabel = 'Valida para os dois grupos';
        } else if (usedInA) {
          statusLabel = `Valida so para ${displayLabels.groupAWithRole}`;
        } else {
          statusLabel = `Valida so para ${displayLabels.groupBWithRole}`;
        }

        if (usedInA) {
          vectors.A.push(groupAValue);
          validCounts.A += 1;
        }
        if (usedInB) {
          vectors.B.push(groupBValue);
          validCounts.B += 1;
        }

        if (groupARaw && groupAValue === null) {
          notes.push(`${displayLabels.groupA} nao contem valor numerico valido.`);
          ignoredByTextOrEmpty = true;
        }
        if (groupBRaw && groupBValue === null) {
          notes.push(`${displayLabels.groupB} nao contem valor numerico valido.`);
          ignoredByTextOrEmpty = true;
        }
      } else {
        if (groupARaw && groupAValue === null) {
          notes.push(`${displayLabels.groupA} nao contem valor numerico valido.`);
        }
        if (groupBRaw && groupBValue === null) {
          notes.push(`${displayLabels.groupB} nao contem valor numerico valido.`);
        }
        if (!groupARaw && !groupBRaw) {
          notes.push('Linha vazia nas duas colunas de grupo.');
        }
        if (!notes.length) {
          notes.push('Linha sem valor numerico utilizavel.');
        }
        ignoredByTextOrEmpty = true;
      }
    }

    datasetRows.push({
      index: index + 1,
      unitLabel,
      observationRaw,
      groupARaw,
      groupBRaw,
      groupAValue,
      groupBValue,
      statusLabel,
      statusTone,
      usedInA,
      usedInB,
      usedAsPair,
      notes
    });
  });

  const errors = [];
  if (mode === 'paired') {
    if (numericCounts.A < 2) errors.push(`${displayLabels.groupAWithRole} tem menos de 2 observacoes validas.`);
    if (numericCounts.B < 2) errors.push(`${displayLabels.groupBWithRole} tem menos de 2 observacoes validas.`);
    if (numericCounts.A !== numericCounts.B || mismatchDetected) {
      errors.push(`No t pareado, ${displayLabels.groupAWithRole} e ${displayLabels.groupBWithRole} precisam ter o mesmo numero de linhas validas.`);
    }
  } else {
    if (validCounts.A < 2) errors.push(`${displayLabels.groupAWithRole} tem menos de 2 observacoes validas.`);
    if (validCounts.B < 2) errors.push(`${displayLabels.groupBWithRole} tem menos de 2 observacoes validas.`);
  }

  const warnings = [];
  if (ignoredByTextOrEmpty && datasetRows.some(row => row.statusTone === 'ignored' || row.notes.length)) {
    warnings.push('Foram encontrados textos ou celulas vazias em linhas ignoradas.');
  }
  datasetRows
    .filter(row => row.statusTone === 'ignored' && row.notes.length)
    .slice(0, 3)
    .forEach(row => warnings.push(describeIgnoredRowReason(row.index, row.notes)));
  const extraIgnored = datasetRows.filter(row => row.statusTone === 'ignored' && row.notes.length).length - 3;
  if (extraIgnored > 0) {
    warnings.push(`Outras ${extraIgnored} linhas tambem foram ignoradas por ausencia de valor numerico valido.`);
  }

  const infos = [];
  if (mode === 'paired') {
    infos.push('No t pareado, a mesma linha representa a mesma unidade nas duas colunas.');
  } else {
    infos.push('No t independente, cada grupo pode aproveitar linhas validas mesmo sem pareamento.');
  }

  return {
    mode,
    sourceKind,
    sourceLabel,
    hasContent: true,
    rows: datasetRows,
    vectors,
    validCounts,
    numericCounts,
    ignoredRows: datasetRows.filter(row => row.statusTone === 'ignored'),
    errors,
    warnings,
    infos,
    rawRows: datasetRows.length,
    recognizedColumns,
    fileMeta,
    displayLabels
  };
}

function buildQuickManualRows(mode, inputs) {
  const groupATokens = splitQuickInputTokens(inputs.groupA, { numeric: true });
  const groupBTokens = splitQuickInputTokens(inputs.groupB, { numeric: true });
  const unitTokens = splitQuickInputTokens(inputs.units, { numeric: false });
  const rowCount = Math.max(groupATokens.length, groupBTokens.length, unitTokens.length, 0);

  if (!rowCount) return [];

  return Array.from({ length: rowCount }, (_, index) => ({
    unitRaw: mode === 'paired' ? (unitTokens[index]?.raw || '') : '',
    groupARaw: groupATokens[index]?.raw || '',
    groupBRaw: groupBTokens[index]?.raw || '',
    observationRaw: ''
  }));
}

function matchManualColumns(headers) {
  const recognizedColumns = {};
  const duplicates = [];

  headers.forEach((header, index) => {
    const normalized = normalizeManualToken(header);
    if (!normalized) return;

    const matchedKey = Object.entries(MANUAL_HEADER_ALIASES).find(([, aliases]) => (
      aliases.some(alias => normalizeManualToken(alias) === normalized)
    ))?.[0];

    if (!matchedKey) return;
    if (recognizedColumns[matchedKey]) {
      duplicates.push(`${recognizedColumns[matchedKey].header} / ${normalizeManualSpaces(header) || `Coluna ${index + 1}`}`);
      return;
    }

    recognizedColumns[matchedKey] = {
      index,
      header: normalizeManualSpaces(header) || `Coluna ${index + 1}`
    };
  });

  return {
    recognizedColumns,
    duplicates,
    requiredFound: Boolean(recognizedColumns.grupo_a && recognizedColumns.grupo_b)
  };
}

function manualCellLooksLikeHeader(value, stats) {
  const normalized = normalizeManualSpaces(value);
  if (!normalized) return false;
  if (/[a-z\u00c0-\u024f]/i.test(normalized)) return true;
  if (/[_-]/.test(normalized)) return true;
  return parseManualNumericValue(normalized, stats) === null;
}

function buildManualPositionalRecognizedColumns(headers) {
  const recognizedColumns = {};

  for (let index = 0; index < Math.min(headers.length, MANUAL_POSITION_FALLBACK.keysByIndex.length); index += 1) {
    const key = MANUAL_POSITION_FALLBACK.keysByIndex[index];
    if (!key) continue;
    recognizedColumns[key] = {
      index,
      header: normalizeManualSpaces(headers[index]) || `Coluna ${index + 1}`,
      detection: 'position'
    };
  }

  return recognizedColumns;
}

function manualRowLooksLikeFallbackHeader(headers, bodyRows, stats) {
  const headerCells = headers
    .slice(0, MANUAL_POSITION_FALLBACK.minColumns)
    .map(value => normalizeManualSpaces(value))
    .filter(Boolean);

  if (headerCells.length < MANUAL_POSITION_FALLBACK.minColumns) return false;

  const requiredPositions = MANUAL_POSITION_FALLBACK.requiredKeys
    .map(key => MANUAL_POSITION_FALLBACK.keysByIndex.indexOf(key))
    .filter(index => index >= 0);
  const firstDataRow = bodyRows[0] || [];
  const textualRequiredHeaders = requiredPositions.filter(index => manualCellLooksLikeHeader(headers[index], stats)).length;
  const textualHeaderCount = headerCells.filter(value => manualCellLooksLikeHeader(value, stats)).length;
  const firstRowHasNumericSignal = requiredPositions.some(index => parseManualNumericValue(firstDataRow[index], stats) !== null);

  return textualRequiredHeaders === requiredPositions.length
    || (textualHeaderCount >= Math.min(2, headerCells.length) && firstRowHasNumericSignal);
}

function buildManualFallbackCandidate(table, rowIndex, headers, bodyRows, stats) {
  if (!manualRowLooksLikeFallbackHeader(headers, bodyRows, stats)) return null;

  const recognizedColumns = buildManualPositionalRecognizedColumns(headers);
  const compatibleCounts = { grupo_a: 0, grupo_b: 0 };

  bodyRows.forEach(row => {
    if (parseManualNumericValue(row[recognizedColumns.grupo_a.index], stats) !== null) compatibleCounts.grupo_a += 1;
    if (parseManualNumericValue(row[recognizedColumns.grupo_b.index], stats) !== null) compatibleCounts.grupo_b += 1;
  });

  const minimumCompatibleRows = Math.min(2, Math.max(bodyRows.length, 1));
  if (compatibleCounts.grupo_a < minimumCompatibleRows || compatibleCounts.grupo_b < minimumCompatibleRows) {
    return null;
  }

  return {
    table,
    headers,
    headerRowIndex: rowIndex,
    bodyRows,
    score: (Object.keys(recognizedColumns).length * 100) + ((compatibleCounts.grupo_a + compatibleCounts.grupo_b) * 10) - rowIndex,
    numericRows: compatibleCounts.grupo_a + compatibleCounts.grupo_b,
    recognizedColumns,
    duplicates: [],
    recognitionMode: 'position',
    recognitionDetails: [
      MANUAL_POSITION_FALLBACK.introText,
      MANUAL_POSITION_FALLBACK.assumptionText,
      MANUAL_POSITION_FALLBACK.headerText
    ]
  };
}

function parseDelimitedRows(text) {
  const lines = normalizeManualText(text)
    .split('\n')
    .map(line => line.trimEnd())
    .filter(line => line.trim() !== '');

  if (!lines.length) {
    return {
      rows: [],
      delimiter: ';',
      formatLabel: 'texto'
    };
  }

  const delimiter = detectManualDelimiter(lines);
  const rows = lines.map(line => splitManualDelimitedLine(line, delimiter));

  return {
    rows,
    delimiter,
    formatLabel: delimiter === ';'
      ? 'CSV com ponto e virgula'
      : delimiter === '\t'
        ? 'Tabela tabulada'
        : 'CSV/TXT'
  };
}

function xmlNodes(node, localName) {
  return Array.from(node.getElementsByTagName('*')).filter(item => item.localName === localName);
}

function parseXmlDocument(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const parserError = xmlNodes(doc, 'parsererror')[0];
  if (parserError) {
    throw new Error('Nao foi possivel interpretar a estrutura XML interna do arquivo XLSX.');
  }
  return doc;
}

function cellReferenceToIndex(ref) {
  const match = String(ref || '').match(/[A-Z]+/i);
  if (!match) return null;

  return match[0]
    .toUpperCase()
    .split('')
    .reduce((acc, char) => (acc * 26) + (char.charCodeAt(0) - 64), 0) - 1;
}

async function unzipDeflateRaw(bytes) {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('Este navegador nao consegue abrir arquivos XLSX sem suporte a DecompressionStream.');
  }

  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const buffer = await new Response(stream).arrayBuffer();
  return new Uint8Array(buffer);
}

function findEndOfCentralDirectory(view) {
  const signature = 0x06054b50;
  const minimumOffset = Math.max(0, view.byteLength - 65557);

  for (let offset = view.byteLength - 22; offset >= minimumOffset; offset -= 1) {
    if (view.getUint32(offset, true) === signature) return offset;
  }

  return -1;
}

async function unzipXlsxEntries(arrayBuffer) {
  const view = new DataView(arrayBuffer);
  const directoryOffset = findEndOfCentralDirectory(view);
  if (directoryOffset === -1) {
    throw new Error('Nao foi possivel localizar a estrutura ZIP do arquivo XLSX.');
  }

  const entryCount = view.getUint16(directoryOffset + 10, true);
  const centralDirectoryOffset = view.getUint32(directoryOffset + 16, true);
  const decoder = new TextDecoder('utf-8');
  const entries = new Map();
  let offset = centralDirectoryOffset;

  for (let index = 0; index < entryCount; index += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) {
      throw new Error('A tabela central do arquivo XLSX esta corrompida.');
    }

    const compressionMethod = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const fileNameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    const fileName = decoder.decode(new Uint8Array(arrayBuffer, offset + 46, fileNameLength)).replace(/\\/g, '/');

    const localNameLength = view.getUint16(localHeaderOffset + 26, true);
    const localExtraLength = view.getUint16(localHeaderOffset + 28, true);
    const dataOffset = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const compressedBytes = new Uint8Array(arrayBuffer.slice(dataOffset, dataOffset + compressedSize));

    let contentBytes;
    if (compressionMethod === 0) {
      contentBytes = compressedBytes;
    } else if (compressionMethod === 8) {
      contentBytes = await unzipDeflateRaw(compressedBytes);
    } else {
      throw new Error('O arquivo XLSX usa um metodo de compressao nao suportado.');
    }

    entries.set(fileName, contentBytes);
    offset += 46 + fileNameLength + extraLength + commentLength;
  }

  return entries;
}

function decodeEntryText(entries, path) {
  const bytes = entries.get(path);
  if (!bytes) return '';
  return normalizeManualText(new TextDecoder('utf-8').decode(bytes));
}

function readRelationshipMap(entries) {
  const relText = decodeEntryText(entries, 'xl/_rels/workbook.xml.rels');
  if (!relText) return new Map();

  const relDoc = parseXmlDocument(relText);
  const relMap = new Map();
  xmlNodes(relDoc, 'Relationship').forEach(node => {
    relMap.set(node.getAttribute('Id'), node.getAttribute('Target') || '');
  });
  return relMap;
}

function readSharedStrings(entries) {
  const sharedText = decodeEntryText(entries, 'xl/sharedStrings.xml');
  if (!sharedText) return [];

  const sharedDoc = parseXmlDocument(sharedText);
  return xmlNodes(sharedDoc, 'si').map(item => (
    xmlNodes(item, 't').map(node => node.textContent || '').join('')
  ));
}

function parseWorksheetRows(sheetText, sharedStrings) {
  const sheetDoc = parseXmlDocument(sheetText);

  return xmlNodes(sheetDoc, 'row')
    .map(rowNode => {
      const cells = new Map();
      let maxIndex = -1;

      xmlNodes(rowNode, 'c').forEach(cellNode => {
        const index = cellReferenceToIndex(cellNode.getAttribute('r'));
        if (index === null) return;

        const type = cellNode.getAttribute('t') || '';
        let rawValue = '';

        if (type === 'inlineStr') {
          rawValue = xmlNodes(cellNode, 't').map(node => node.textContent || '').join('');
        } else {
          const valueNode = xmlNodes(cellNode, 'v')[0];
          const valueText = valueNode?.textContent || '';

          if (type === 's') {
            rawValue = sharedStrings[Number(valueText)] ?? '';
          } else if (type === 'b') {
            rawValue = valueText === '1' ? 'TRUE' : 'FALSE';
          } else {
            rawValue = valueText;
          }
        }

        cells.set(index, normalizeManualSpaces(rawValue));
        maxIndex = Math.max(maxIndex, index);
      });

      return Array.from({ length: maxIndex + 1 }, (_, index) => cells.get(index) || '');
    })
    .filter(row => row.some(cell => normalizeManualSpaces(cell) !== ''));
}

function readWorkbookSheets(entries) {
  const workbookText = decodeEntryText(entries, 'xl/workbook.xml');
  if (!workbookText) {
    throw new Error('Nao foi possivel localizar a pasta de trabalho dentro do arquivo XLSX.');
  }

  const workbookDoc = parseXmlDocument(workbookText);
  const relationshipMap = readRelationshipMap(entries);
  const sharedStrings = readSharedStrings(entries);

  return xmlNodes(workbookDoc, 'sheet').map(sheetNode => {
    const relationId = sheetNode.getAttribute('r:id') || sheetNode.getAttribute('id') || '';
    const target = relationshipMap.get(relationId) || '';
    const normalizedTarget = target.replace(/^\/?xl\//, '');
    const path = normalizedTarget ? `xl/${normalizedTarget}` : '';
    const sheetText = decodeEntryText(entries, path);

    return {
      name: normalizeManualSpaces(sheetNode.getAttribute('name')) || 'Planilha',
      rows: sheetText ? parseWorksheetRows(sheetText, sharedStrings) : []
    };
  });
}

async function readWorkbookTablesFromFile(file, utils) {
  const fileName = normalizeManualSpaces(file?.name || 'arquivo');
  const extension = fileName.toLowerCase().split('.').pop();

  if (extension === 'xlsx') {
    const buffer = await file.arrayBuffer();
    const entries = await unzipXlsxEntries(buffer);
    return {
      kind: 'xlsx',
      tables: readWorkbookSheets(entries)
    };
  }

  const text = await utils.readFileText(file);
  const parsed = parseDelimitedRows(text);

  return {
    kind: 'text',
    tables: [{
      name: fileName,
      rows: parsed.rows,
      delimiter: parsed.delimiter,
      formatLabel: parsed.formatLabel
    }]
  };
}

function findBestWideTableCandidate(tables, stats) {
  const aliasCandidates = (tables || []).map(table => {
    const rows = (table.rows || []).filter(row => row.some(cell => normalizeManualSpaces(cell) !== ''));

    for (let rowIndex = 0; rowIndex < Math.min(rows.length, 20); rowIndex += 1) {
      const headers = rows[rowIndex].map(value => normalizeManualSpaces(value));
      const headerMatch = matchManualColumns(headers);
      if (!headerMatch.requiredFound) continue;

      const bodyRows = rows
        .slice(rowIndex + 1)
        .filter(row => row.some(cell => normalizeManualSpaces(cell) !== ''));
      const groupAIndex = headerMatch.recognizedColumns.grupo_a.index;
      const groupBIndex = headerMatch.recognizedColumns.grupo_b.index;
      const numericRows = bodyRows.filter(row => (
        parseManualNumericValue(row[groupAIndex], stats) !== null || parseManualNumericValue(row[groupBIndex], stats) !== null
      )).length;
      const score = (Object.keys(headerMatch.recognizedColumns).length * 100) + (numericRows * 10) - rowIndex;

      return {
        table,
        headers,
        headerRowIndex: rowIndex,
        bodyRows,
        score,
        numericRows,
        recognizedColumns: headerMatch.recognizedColumns,
        duplicates: headerMatch.duplicates,
        recognitionMode: 'aliases',
        recognitionDetails: []
      };
    }

    return null;
  }).filter(Boolean);

  if (aliasCandidates.length) {
    aliasCandidates.sort((left, right) => right.score - left.score);
    return aliasCandidates[0];
  }

  const positionalCandidates = (tables || []).map(table => {
    const rows = (table.rows || []).filter(row => row.some(cell => normalizeManualSpaces(cell) !== ''));

    for (let rowIndex = 0; rowIndex < Math.min(rows.length, 20); rowIndex += 1) {
      const headers = rows[rowIndex].map(value => normalizeManualSpaces(value));
      const bodyRows = rows
        .slice(rowIndex + 1)
        .filter(row => row.some(cell => normalizeManualSpaces(cell) !== ''));
      const candidate = buildManualFallbackCandidate(table, rowIndex, headers, bodyRows, stats);
      if (candidate) return candidate;
    }

    return null;
  }).filter(Boolean);

  if (!positionalCandidates.length) return null;
  positionalCandidates.sort((left, right) => right.score - left.score);
  return positionalCandidates[0];
}

function analyzeManualNumericFormatting(bodyRows, recognizedColumns, stats) {
  const numericIndexes = [
    recognizedColumns?.grupo_a?.index,
    recognizedColumns?.grupo_b?.index
  ].filter(Number.isInteger);

  let decimalCommaDetected = false;
  let numericCellCount = 0;

  (bodyRows || []).forEach(row => {
    numericIndexes.forEach(index => {
      const raw = row?.[index] || '';
      if (parseManualNumericValue(raw, stats) === null) return;
      numericCellCount += 1;
      if (rawUsesDecimalComma(raw)) {
        decimalCommaDetected = true;
      }
    });
  });

  return {
    decimalCommaDetected,
    numericCellCount
  };
}

function buildLoadedTabularState(candidate, extra = {}, stats) {
  const formatting = analyzeManualNumericFormatting(candidate.bodyRows, candidate.recognizedColumns, stats);

  return {
    status: 'loaded',
    fileName: extra.fileName || 'dados',
    workbookKind: extra.workbookKind || 'text',
    tableName: extra.tableName || candidate.table.name || 'Tabela principal',
    formatLabel: extra.formatLabel || candidate.table.formatLabel || 'texto',
    delimiter: extra.delimiter ?? candidate.table.delimiter ?? '',
    headerRowIndex: candidate.headerRowIndex,
    headers: candidate.headers,
    bodyRows: candidate.bodyRows,
    recognizedColumns: candidate.recognizedColumns,
    duplicates: candidate.duplicates,
    sheetNames: extra.sheetNames || [],
    decimalCommaDetected: formatting.decimalCommaDetected,
    numericCellCount: formatting.numericCellCount,
    sourceType: extra.sourceType || 'file',
    recognitionMode: candidate.recognitionMode || 'aliases',
    usedPositionalFallback: candidate.recognitionMode === 'position',
    recognitionDetails: candidate.recognitionDetails || []
  };
}

async function readManualFileState(file, utils, stats) {
  const fileName = normalizeManualSpaces(file?.name || 'arquivo');

  try {
    const workbook = await readWorkbookTablesFromFile(file, utils);
    const candidate = findBestWideTableCandidate(workbook.tables, stats);
    const availableNames = workbook.tables.map(table => table.name).filter(Boolean);

    if (!candidate) {
      return {
        status: 'error',
        fileName,
        message: 'O arquivo foi lido, mas nao conseguimos identificar as colunas automaticamente nem pela posicao.',
        details: [
          `Use o modelo: ${MANUAL_WIDE_FORMAT_LABEL}.`,
          `Esperavamos pelo menos ${MANUAL_POSITION_FALLBACK.minColumns} colunas uteis com cabecalho na primeira linha.`,
          availableNames.length ? `Abas/blocos lidos: ${availableNames.join(', ')}.` : ''
        ].filter(Boolean)
      };
    }

    return buildLoadedTabularState(candidate, {
      fileName,
      workbookKind: workbook.kind,
      tableName: candidate.table.name,
      formatLabel: candidate.table.formatLabel || (workbook.kind === 'xlsx' ? 'XLSX' : 'texto'),
      delimiter: candidate.table.delimiter || '',
      sheetNames: availableNames,
      sourceType: 'file'
    }, stats);
  } catch (error) {
    return {
      status: 'error',
      fileName,
      message: error?.message || 'Nao foi possivel ler o arquivo enviado.',
      details: [`Use o modelo: ${MANUAL_WIDE_FORMAT_LABEL}.`]
    };
  }
}

function readManualPasteState(text, stats) {
  const parsed = parseDelimitedRows(text);
  const candidate = findBestWideTableCandidate([{
    name: 'Conteudo colado',
    rows: parsed.rows,
    delimiter: parsed.delimiter,
    formatLabel: parsed.formatLabel
  }], stats);

  if (!candidate) {
    return {
      status: 'error',
      fileName: 'dados-colados',
      message: 'Nao conseguimos identificar as colunas automaticamente nem pela posicao.',
      details: [
        `Use o modelo: ${MANUAL_WIDE_FORMAT_LABEL}.`,
        `Esperavamos pelo menos ${MANUAL_POSITION_FALLBACK.minColumns} colunas uteis com cabecalho na primeira linha.`,
        'Cole a tabela com cabecalho no formato brasileiro ou use um arquivo CSV/XLSX/TXT compativel.'
      ],
      sourceType: 'paste'
    };
  }

  return buildLoadedTabularState(candidate, {
    fileName: 'dados-colados',
    workbookKind: 'text',
    tableName: 'Conteudo colado',
    formatLabel: parsed.formatLabel,
    delimiter: parsed.delimiter,
    sourceType: 'paste'
  }, stats);
}

function buildManualDatasetFromTabularState(fileState, mode, stats, sourceMeta = {}) {
  const {
    sourceKind = fileState?.sourceType || 'file',
    sourceLabel = sourceKind === 'paste' ? 'Dados colados' : 'Arquivo lido'
  } = sourceMeta;

  if (!fileState || fileState.status !== 'loaded') {
    const dataset = buildEmptyManualDataset(mode, sourceKind, sourceLabel);
    if (fileState?.message) dataset.errors.push(fileState.message);
    if (Array.isArray(fileState?.details)) dataset.infos.push(...fileState.details);
    dataset.hasContent = Boolean(fileState?.message);
    return dataset;
  }

  const displayLabels = buildManualDisplayLabels(fileState.recognizedColumns);

  const mappedRows = fileState.bodyRows.map(row => ({
    unitRaw: fileState.recognizedColumns.unidade ? row[fileState.recognizedColumns.unidade.index] || '' : '',
    groupARaw: row[fileState.recognizedColumns.grupo_a.index] || '',
    groupBRaw: row[fileState.recognizedColumns.grupo_b.index] || '',
    observationRaw: fileState.recognizedColumns.observacao_opcional ? row[fileState.recognizedColumns.observacao_opcional.index] || '' : ''
  }));

  const dataset = buildManualDatasetFromStructuredRows({
    mode,
    sourceKind,
    sourceLabel,
    rows: mappedRows,
    recognizedColumns: fileState.recognizedColumns,
    displayLabels,
    fileMeta: {
      fileName: fileState.fileName,
      tableName: fileState.tableName,
      formatLabel: fileState.formatLabel,
      delimiter: fileState.delimiter,
      headerRowIndex: fileState.headerRowIndex,
      sourceType: fileState.sourceType || sourceKind
    }
  }, stats);

  if (!fileState.recognizedColumns.unidade) {
    dataset.infos.push('Coluna de unidade nao reconhecida; a previa usa a ordem das linhas.');
  }
  if (fileState.usedPositionalFallback) {
    dataset.infos.push(...fileState.recognitionDetails);
  }
  if (fileState.duplicates.length) {
    dataset.warnings.push(`Cabecalhos duplicados foram ignorados: ${fileState.duplicates.join(', ')}.`);
  }
  if (fileState.delimiter === ';') {
    dataset.infos.unshift(`${sourceKind === 'paste' ? 'Conteudo colado' : 'Arquivo'} lido no padrao ponto e virgula (;).`);
  } else if (fileState.delimiter === '\t') {
    dataset.infos.unshift('Conteudo tabulado interpretado automaticamente.');
  }
  if (fileState.decimalCommaDetected) {
    dataset.infos.unshift('Numeros com virgula decimal foram convertidos automaticamente.');
  }

  return dataset;
}

function buildManualPreviewTable(dataset, utils) {
  const rows = dataset.rows;
  const note = '';
  const formatConverted = value => (value === null || value === undefined
    ? '-'
    : utils.fmtNumber(value, Math.abs(value) >= 100 ? 1 : 3));
  const labels = dataset.displayLabels || buildManualDisplayLabels(dataset.recognizedColumns);

  return `
    <div class="preview-table-wrap">
      <table class="preview-table tstudent-manual-preview-table">
        <thead>
          <tr>
            <th>${utils.escapeHtml(labels.unit)}</th>
            <th>${utils.escapeHtml(labels.groupA)} bruto</th>
            <th>${utils.escapeHtml(labels.groupB)} bruto</th>
            <th>${utils.escapeHtml(labels.groupA)} convertido</th>
            <th>${utils.escapeHtml(labels.groupB)} convertido</th>
            <th>Status</th>
            <th>${utils.escapeHtml(labels.observation)}</th>
          </tr>
        </thead>
        <tbody>
          ${rows.length ? rows.map(row => `
            <tr class="${row.statusTone === 'ignored' ? 'tstudent-preview-row-ignored' : 'tstudent-preview-row-valid'}">
              <td>${utils.escapeHtml(row.unitLabel)}</td>
              <td>${utils.escapeHtml(row.groupARaw || '')}</td>
              <td>${utils.escapeHtml(row.groupBRaw || '')}</td>
              <td>${utils.escapeHtml(formatConverted(row.groupAValue))}</td>
              <td>${utils.escapeHtml(formatConverted(row.groupBValue))}</td>
              <td>
                <div class="tstudent-preview-status ${row.statusTone}">
                  <strong>${utils.escapeHtml(row.statusLabel)}</strong>
                  ${row.notes.length ? `<small>${utils.escapeHtml(row.notes.join(' '))}</small>` : ''}
                </div>
              </td>
              <td>${utils.escapeHtml(row.observationRaw || '')}</td>
            </tr>
          `).join('') : '<tr><td colspan="7">Sem linhas para exibir.</td></tr>'}
        </tbody>
      </table>
    </div>
    ${note}
  `;
}

function buildRecognizedColumnsChips(recognizedColumns) {
  const order = [
    ['unidade', 'unidade'],
    ['grupo_a', 'grupo_a'],
    ['grupo_b', 'grupo_b'],
    ['observacao_opcional', 'observacao_opcional']
  ];

  return order
    .filter(([, key]) => recognizedColumns[key])
    .map(([label, key]) => `<span class="small-chip info">${label} <- ${recognizedColumns[key].header}</span>`)
    .join('');
}

function buildManualPairedInterpretation(result, alpha, question, groupLabels, utils) {
  return buildGuidedInterpretation(result, {
    mode: 'paired',
    groupLabels,
    periodLabel: 'informado manualmente'
  }, alpha, question, utils);
}

function clonePlain(value) {
  return value ? JSON.parse(JSON.stringify(value)) : value;
}

function buildTimeBlocks(options) {
  const blocks = [];
  for (let index = 0; index < options.length; index += 5) {
    const chunk = options.slice(index, index + 5);
    if (!chunk.length) continue;
    blocks.push({
      key: chunk.map(item => item.key).join('|'),
      keys: chunk.map(item => item.key),
      label: `${chunk[0].label} a ${chunk[chunk.length - 1].label}`
    });
  }
  return blocks;
}

function sharedTimeOptions(leftSource, rightSource) {
  const leftOptions = getTimeOptions(leftSource);
  const rightKeys = new Set(getTimeOptions(rightSource).map(option => option.key));
  return leftOptions.filter(option => rightKeys.has(option.key));
}

function toneClass(kind) {
  if (kind === 'success') return 'success-box';
  if (kind === 'error') return 'error-box';
  return 'status-bar';
}

const TSTUDENT_BOUND_EVENTS = Symbol('t-student-bound-events');

function procedureLabel(source) {
  return source?.fileName || 'Fonte DATASUS';
}

function buildGuidedStatusText(result, derived, alpha, utils) {
  const significant = result.p < alpha;
  if (derived.mode === 'paired') {
    return significant
      ? `Comparacao pareada concluida com ${derived.validCounts.pairs} pares validos. A diferenca media foi ${utils.fmtSigned(result.diff, 2)} e houve significancia estatistica (p ${utils.fmtP(result.p)}).`
      : `Comparacao pareada concluida com ${derived.validCounts.pairs} pares validos. A diferenca media foi ${utils.fmtSigned(result.diff, 2)}, sem evidencia estatistica robusta (p ${utils.fmtP(result.p)}).`;
  }

  return significant
    ? `Comparacao entre grupos independentes concluida. Grupo A media ${utils.fmtNumber(result.m1, 2)} versus Grupo B media ${utils.fmtNumber(result.m2, 2)}, com significancia estatistica (p ${utils.fmtP(result.p)}).`
    : `Comparacao entre grupos independentes concluida. Grupo A media ${utils.fmtNumber(result.m1, 2)} versus Grupo B media ${utils.fmtNumber(result.m2, 2)}, sem evidencia estatistica robusta (p ${utils.fmtP(result.p)}).`;
}

function buildGuidedExtraMetrics(derived, utils) {
  if (derived.mode === 'paired') {
    const meanDiff = derived.derivedRows.length
      ? derived.derivedRows.reduce((sum, row) => sum + row.diff, 0) / derived.derivedRows.length
      : NaN;

    return `
      <div class="metric-card">
        <div class="metric-label">Periodo analisado</div>
        <div class="metric-value tstudent-compact-value">${utils.escapeHtml(derived.periodLabel || 'Sem periodo valido')}</div>
        <div class="metric-mini">Comparacao entre os dois procedimentos nas mesmas unidades.</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Pares validos</div>
        <div class="metric-value">${derived.validCounts.pairs}</div>
        <div class="metric-mini">Somente unidades com os dois valores foram mantidas.</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Media das diferencas</div>
        <div class="metric-value">${utils.fmtSigned(meanDiff, 2)}</div>
        <div class="metric-mini">Procedimento A - Procedimento B.</div>
      </div>
    `;
  }

  return `
    <div class="metric-card">
      <div class="metric-label">Periodo analisado</div>
      <div class="metric-value tstudent-compact-value">${utils.escapeHtml(derived.periodLabel || 'Sem periodo valido')}</div>
      <div class="metric-mini">Cada categoria selecionada permaneceu como observacao separada.</div>
    </div>
    <div class="metric-card">
      <div class="metric-label">Observacoes validas no Grupo A</div>
      <div class="metric-value">${derived.validCounts.A}</div>
      <div class="metric-mini">Categorias atribuidas: ${derived.selectionCounts.A}</div>
    </div>
    <div class="metric-card">
      <div class="metric-label">Observacoes validas no Grupo B</div>
      <div class="metric-value">${derived.validCounts.B}</div>
      <div class="metric-mini">Categorias atribuidas: ${derived.selectionCounts.B}</div>
    </div>
  `;
}

function buildGuidedInterpretation(result, derived, alpha, question, utils) {
  const significant = result.p < alpha;

  if (derived.mode === 'paired') {
    const higherLabel = result.diff >= 0 ? derived.groupLabels[0] : derived.groupLabels[1];
    const paragraph = `Comparacao pareada entre os procedimentos ${derived.groupLabels[0]} e ${derived.groupLabels[1]} nas mesmas unidades, no periodo ${derived.periodLabel}. A media do primeiro procedimento foi ${utils.fmtNumber(result.m1, 2)} e a do segundo foi ${utils.fmtNumber(result.m2, 2)}. A direcao da diferenca favoreceu ${higherLabel}${significant ? ', com significancia estatistica.' : ', sem significancia estatistica.'}`;

    return `
      ${utils.buildInterpretationCard('Interpretacao automatica', paragraph, [
      `Pergunta analisada: ${question || 'Comparacao pareada entre procedimentos.'}`,
      `Resultado principal: t = ${utils.fmtNumber(result.t, 3)}, gl = ${utils.fmtNumber(result.df, 2)}, p = ${utils.fmtP(result.p)}.`,
      `Media das diferencas por unidade: ${utils.fmtSigned(result.diff, 2)}.`,
      'Leitura metodologica: comparacao pareada, pois cada unidade contribuiu com dois valores.'
    ])}
    `;
  }

  const higherLabel = result.diff >= 0 ? 'Grupo A' : 'Grupo B';
  const paragraph = `Comparacao entre grupos independentes definidos pelo usuario, no periodo ${derived.periodLabel}. A media do Grupo A foi ${utils.fmtNumber(result.m1, 2)} e a do Grupo B foi ${utils.fmtNumber(result.m2, 2)}. A direcao da diferenca favoreceu ${higherLabel}${significant ? ', com significancia estatistica.' : ', sem significancia estatistica.'}`;

  return `
    ${utils.buildInterpretationCard('Interpretacao automatica', paragraph, [
    `Pergunta analisada: ${question || 'Comparacao entre grupos independentes.'}`,
    `Resultado principal: t = ${utils.fmtNumber(result.t, 3)}, gl = ${utils.fmtNumber(result.df, 2)}, p = ${utils.fmtP(result.p)}.`,
    `Grupo A: ${derived.groupAItems.join(', ') || 'nenhuma categoria valida'}.`,
    `Grupo B: ${derived.groupBItems.join(', ') || 'nenhuma categoria valida'}.`,
    'Leitura metodologica: comparacao independente, pois os grupos foram definidos por categorias distintas.'
  ])}
  `;
}

function exampleSourcesFromConfig(config) {
  if (Array.isArray(config.exampleDatasusPairedFiles) && config.exampleDatasusPairedFiles.length) {
    return config.exampleDatasusPairedFiles.map(item => ({
      fileName: item.fileName,
      text: item.text,
      sourceKind: 'example'
    }));
  }

  if (config.exampleDatasusText) {
    return [{
      fileName: 'exemplo-datasus.tsv',
      text: config.exampleDatasusText,
      sourceKind: 'example'
    }];
  }

  return [];
}

export async function renderTestModule(ctx) {
  const { root, config, utils, stats, shared } = ctx;
  root.classList.add('tstudent-module');

  const defaultManualQuestion = config.defaultQuestion || 'As medias dos grupos sao diferentes?';
  const defaultDatasusQuestion = config.defaultDatasusQuestion || 'Ha diferenca media entre as selecoes comparadas no DATASUS?';

  try {
    const warnedUiKeys = new Set();

    function warnMissingUi(label, selector, detail = 'O modulo seguira carregando com os elementos disponiveis.') {
      const key = `${label}:${selector}`;
      if (warnedUiKeys.has(key)) return;
      warnedUiKeys.add(key);
      console.warn(`[t-student] Elemento nao encontrado para ${label} (${selector}). ${detail}`);
    }

    function createMissingElementRef(label, selector) {
      const noop = () => { };
      return {
        __tStudentMissingRef: true,
        label,
        selector,
        value: '',
        innerHTML: '',
        textContent: '',
        className: '',
        disabled: true,
        dataset: {},
        files: [],
        classList: {
          add: noop,
          remove: noop,
          toggle: noop,
          contains: () => false
        },
        setAttribute: noop,
        getAttribute: () => null,
        querySelector: () => null,
        querySelectorAll: () => [],
        addEventListener: noop,
        removeEventListener: noop,
        focus: noop
      };
    }

    function isMissingElementRef(element) {
      return Boolean(element?.__tStudentMissingRef);
    }

    function findInContainer(container, selector, options = {}) {
      const { label = selector, optional = false } = options;
      const element = container?.querySelector?.(selector) || null;
      if (element) return element;
      warnMissingUi(
        label,
        selector,
        optional
          ? 'O listener ou controle opcional sera ignorado nesta renderizacao.'
          : 'Revise se o seletor ainda corresponde ao HTML atual do modulo.'
      );
      return createMissingElementRef(label, selector);
    }

    function findAllInContainer(container, selector, options = {}) {
      const { label = selector, optional = false } = options;
      const elements = Array.from(container?.querySelectorAll?.(selector) || []);
      if (elements.length) return elements;
      warnMissingUi(
        label,
        selector,
        optional
          ? 'Nenhum elemento opcional foi encontrado para este grupo de controles.'
          : 'Revise se o seletor ainda corresponde ao HTML atual do modulo.'
      );
      return [];
    }

    function safeBindElement(element, eventName, handler, options = {}) {
      const { label = 'elemento', bindingKey = `${eventName}:${label}`, listenerOptions } = options;
      if (!element || isMissingElementRef(element)) return null;
      if (!element[TSTUDENT_BOUND_EVENTS]) {
        element[TSTUDENT_BOUND_EVENTS] = new Set();
      }
      if (element[TSTUDENT_BOUND_EVENTS].has(bindingKey)) {
        return element;
      }
      element[TSTUDENT_BOUND_EVENTS].add(bindingKey);
      element.addEventListener(eventName, handler, listenerOptions);
      return element;
    }

    function safeBind(container, selector, eventName, handler, options = {}) {
      const { label = selector, optional = false, listenerOptions, bindingKey } = options;
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
      const { label = selector, optional = false, listenerOptions, bindingKey = `${eventName}:${selector}` } = options;
      const elements = findAllInContainer(container, selector, { label, optional });
      return elements
        .map((element, index) => safeBindElement(element, eventName, handler, {
          label: `${label} #${index + 1}`,
          bindingKey,
          listenerOptions
        }))
        .filter(Boolean);
    }

    root.innerHTML = `
    <div class="module-grid">
      <section class="module-header tstudent-header">
        <div class="chip chip-primary">M\u00f3dulo guiado \u00b7 t de Student</div>
        <h3>${utils.escapeHtml(config.title)}</h3>
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

      <div class="tstudent-mode-panel active" data-mode-panel="manual">
        <section class="surface-card decorated">
          <div class="tstudent-step-head">
            <span class="small-chip info">Fluxo principal</span>
            <h4>Importar arquivo e colar dados</h4>
          </div>
          <p class="small-note tstudent-section-note">Use planilhas brasileiras com <strong>;</strong>, decimal com <strong>,</strong> e colagem direta do Excel. O editor por grupos continua disponivel logo abaixo.</p>
          <div class="tstudent-manual-mode-grid" style="margin-top:14px;">
            <button type="button" class="tstudent-choice-card is-active" data-manual-analysis="independent">
              <strong>t independente</strong>
              <span>Use apenas Grupo A e Grupo B. Os grupos podem ter tamanhos diferentes.</span>
            </button>
            <button type="button" class="tstudent-choice-card" data-manual-analysis="paired">
              <strong>t pareado</strong>
              <span>Use Grupo A + Grupo B na mesma ordem das unidades. Linhas sem par serao ignoradas.</span>
            </button>
          </div>
          <div id="t-manual-mode-status" class="small-note tstudent-section-note" style="margin-top:14px;">t independente: cole um grupo por campo. O site valida n minimo e mostra exatamente o que entrou no calculo.</div>
          <div class="form-grid two" style="margin-top:14px;">
            <div>
              <label for="t-context">Pergunta do estudo</label>
              <input id="t-context" type="text" value="${utils.escapeHtml(defaultManualQuestion)}" />
            </div>
            <div>
              <label for="t-alpha">Nivel de significancia</label>
              <select id="t-alpha">
                <option value="0.01">1%</option>
                <option value="0.05" selected>5%</option>
                <option value="0.10">10%</option>
              </select>
            </div>
          </div>

          <div class="tstudent-intake-grid">
            <article class="tstudent-workflow-block">
              <div class="tstudent-workflow-head">
                <h5>Importar arquivo</h5>
                <span class="small-chip primary">CSV/XLSX/TXT</span>
              </div>
              <p class="small-note">Aceita planilhas exportadas do Excel, CSV, TXT e colagem tabulada de planilhas brasileiras.</p>
              <div class="tstudent-file-picker">
                <label for="t-file" class="btn-secondary">Importar arquivo</label>
                <input id="t-file" class="tstudent-hidden-file" type="file" accept=".csv,.tsv,.txt,.xlsx,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" />
                <span class="small-note">Preferencia: CSV com ; e decimal com virgula.</span>
              </div>
              <div class="small-note">
                Modelo oficial: <code>${utils.escapeHtml(MANUAL_WIDE_FORMAT_LABEL)}</code><br />
                Aliases: unidade, uf, unidade_analitica, grupo_a, grupo_b, observacao/opcional.
              </div>
              <div class="actions-row tstudent-actions-compact">
                <a class="btn-secondary" href="${MANUAL_EMPTY_TEMPLATE_URL}" download="modelo_t_student_vazio.csv">Baixar modelo</a>
                <a class="btn-ghost" href="${MANUAL_FILLED_TEMPLATE_URL}" download="modelo_t_student_exemplo.csv">Exemplo CSV</a>
              </div>
              <div id="t-file-status" class="status-bar" style="margin-top:14px;">Nenhum arquivo lido ainda.</div>
              <div id="t-file-recognition" class="tstudent-config-summary" style="margin-top:12px;"></div>
            </article>

            <div id="t-paste-zone" class="paste-area" tabindex="0">
              <span class="icon">✨</span>
              <h3>Cole seus dados aqui</h3>
              <p>Pressione <strong>Ctrl + V</strong> para importar planilhas</p>
            </div>
            <textarea id="t-paste-data" style="display:none;"></textarea>

            <div class="actions-row" style="margin-top:24px; justify-content: center;">
              <button class="btn" id="t-example" type="button">Testar com Exemplo Pratico</button>
              <button class="btn-ghost" id="t-clear" type="button">Limpar Area</button>
            </div>
            <div id="t-paste-status" class="status-bar" style="margin-top:14px; display:none;"></div>
            <div id="t-paste-recognition" class="tstudent-config-summary" style="margin-top:12px;"></div>

            <article class="tstudent-workflow-block tstudent-workflow-block-full">
              <div class="tstudent-workflow-head">
                <h5>Editar por grupos</h5>
                <span class="small-chip info">Entrada rapida</span>
              </div>
              <p class="small-note">Se preferir revisar ou montar os grupos manualmente, cole cada coluna abaixo. O sistema limpa espacos extras e aceita decimal com virgula.</p>
              <div class="tstudent-quick-entry-grid tstudent-quick-entry-grid-compact">
                <article class="tstudent-input-block">
                  <div class="tstudent-input-block-head">
                    <h5>Grupo A</h5>
                    <span id="t-group-a-count" class="small-chip info">0 validos</span>
                  </div>
                  <textarea id="t-group-a" placeholder="2,2&#10;3&#10;3,7&#10;2,9"></textarea>
                  <div class="small-note">Aceita uma coluna do Excel, uma linha por valor ou colagem com tabulacao.</div>
                </article>
                <article class="tstudent-input-block">
                  <div class="tstudent-input-block-head">
                    <h5>Grupo B</h5>
                    <span id="t-group-b-count" class="small-chip info">0 validos</span>
                  </div>
                  <textarea id="t-group-b" placeholder="2,2&#10;3,3&#10;2,8&#10;3,3"></textarea>
                  <div class="small-note">Inteiros, virgula decimal e linhas vazias sao tratados automaticamente.</div>
                </article>
                <article class="tstudent-input-block tstudent-input-block-aux" id="t-units-wrap">
                  <div class="tstudent-input-block-head">
                    <h5>Unidades / labels</h5>
                    <span id="t-units-count" class="small-chip info">0 labels</span>
                  </div>
                  <textarea id="t-units" placeholder="Rondonia&#10;Acre&#10;Amazonas&#10;Roraima"></textarea>
                  <div class="small-note">Opcional no t pareado. Cada linha representa a mesma unidade nas duas colunas.</div>
                </article>
              </div>
            </article>
          </div>
        </section>

        <section class="surface-card">
          <div class="tstudent-step-head">
            <span class="small-chip info">Revisão</span>
            <h4>Prévia / revisão dos dados</h4>
          </div>
          <div class="tstudent-manual-source-switch" role="tablist" aria-label="Fonte ativa da análise" style="margin-top:14px;">
            <button type="button" class="tstudent-source-btn is-active" data-manual-source="quick">Grupos</button>
            <button type="button" class="tstudent-source-btn" data-manual-source="paste" disabled>Tabela colada</button>
            <button type="button" class="tstudent-source-btn" data-manual-source="file" disabled>Arquivo</button>
          </div>
          <div id="t-preview" class="small-note" style="margin-top:14px;">Nenhum dado carregado ainda.</div>
          <div id="t-group-summary" class="metrics-grid t-group-summary" style="margin-top:14px;"></div>
          <div class="actions-row" style="margin-top:14px;">
            <button class="btn" id="t-run" type="button">Rodar análise</button>
          </div>
        </section>

        <section class="surface-card tstudent-statistics-section">
          <h4>Resultados estatísticos</h4>
          <div id="t-status" class="status-bar">Importe um arquivo, cole uma tabela ou edite os grupos para iniciar.</div>
          <div id="t-metrics" class="metrics-grid" style="margin-top:14px;"></div>
        </section>

        <section class="surface-card tstudent-chart-section">
          <h4>Visualização gráfica</h4>
          <div id="t-chart" class="chart-grid" style="margin-top:14px;"></div>
        </section>

        <section class="surface-card tstudent-interpretation-section">
          <h4>Interpretacao automatica</h4>
          <div id="t-results" class="result-grid" style="margin-top:14px;"></div>
        </section>
      </div>
    </div>
  `;

    const manual = {
      modeButtons: findAllInContainer(root, '[data-manual-analysis]', { label: 'botoes de modo manual' }),
      modeSummaryEl: findInContainer(root, '#t-manual-mode-status', { label: 'resumo do modo manual' }),
      groupAEl: findInContainer(root, '#t-group-a', { label: 'campo do Grupo A' }),
      groupBEl: findInContainer(root, '#t-group-b', { label: 'campo do Grupo B' }),
      unitsEl: findInContainer(root, '#t-units', { label: 'campo de unidades', optional: true }),
      unitsWrapEl: findInContainer(root, '#t-units-wrap', { label: 'bloco de unidades', optional: true }),
      groupACountEl: findInContainer(root, '#t-group-a-count', { label: 'contador do Grupo A' }),
      groupBCountEl: findInContainer(root, '#t-group-b-count', { label: 'contador do Grupo B' }),
      unitsCountEl: findInContainer(root, '#t-units-count', { label: 'contador de unidades', optional: true }),
      pasteEl: findInContainer(root, '#t-paste-data', { label: 'area de dados colados', optional: true }),
      pasteStatusEl: findInContainer(root, '#t-paste-status', { label: 'status dos dados colados', optional: true }),
      pasteRecognitionEl: findInContainer(root, '#t-paste-recognition', { label: 'colunas reconhecidas dos dados colados', optional: true }),
      fileEl: findInContainer(root, '#t-file', { label: 'upload manual', optional: true }),
      fileStatusEl: findInContainer(root, '#t-file-status', { label: 'status do upload manual', optional: true }),
      fileRecognitionEl: findInContainer(root, '#t-file-recognition', { label: 'colunas reconhecidas do upload', optional: true }),
      sourceButtons: findAllInContainer(root, '[data-manual-source]', { label: 'botoes de origem manual' }),
      previewEl: findInContainer(root, '#t-preview', { label: 'previa manual' }),
      statusEl: findInContainer(root, '#t-status', { label: 'status do teste manual' }),
      groupSummaryEl: findInContainer(root, '#t-group-summary', { label: 'resumo dos grupos' }),
      metricsEl: findInContainer(root, '#t-metrics', { label: 'metricas manuais' }),
      chartEl: findInContainer(root, '#t-chart', { label: 'grafico manual' }),
      resultsEl: findInContainer(root, '#t-results', { label: 'interpretacao manual' }),
      contextEl: findInContainer(root, '#t-context', { label: 'pergunta manual' }),
      alphaEl: findInContainer(root, '#t-alpha', { label: 'alpha manual' })
    };

    const manualState = {
      analysisMode: 'independent',
      activeSource: 'quick',
      pasteState: null,
      fileState: null,
      currentDataset: buildEmptyManualDataset('independent')
    };

    const datasusRefs = {
      wizardEl: findInContainer(root, '#t-datasus-wizard', { label: 'wizard DATASUS', optional: true }),
      analysisEl: findInContainer(root, '#t-datasus-analysis-step', { label: 'etapa de análise DATASUS', optional: true }),
      selectionEl: findInContainer(root, '#t-datasus-selection-step', { label: 'etapa de seleção DATASUS', optional: true }),
      derivedEl: findInContainer(root, '#t-datasus-derived', { label: 'prévia derivada DATASUS', optional: true }),
      contextEl: findInContainer(root, '#t-datasus-context', { label: 'pergunta DATASUS', optional: true }),
      alphaEl: findInContainer(root, '#t-datasus-alpha', { label: 'alpha DATASUS', optional: true }),
      runBtn: findInContainer(root, '#t-datasus-run', { label: 'botão rodar DATASUS', optional: true }),
      statusEl: findInContainer(root, '#t-datasus-status', { label: 'status DATASUS', optional: true }),
      metricsEl: findInContainer(root, '#t-datasus-metrics', { label: 'métricas DATASUS', optional: true }),
      chartEl: findInContainer(root, '#t-datasus-chart', { label: 'gráfico DATASUS', optional: true }),
      resultsEl: findInContainer(root, '#t-datasus-results', { label: 'interpretação DATASUS', optional: true })
    };

    const datasusState = {
      session: null,
      sharedSession: clonePlain(shared?.datasus?.lastSession || null),
      analysisMode: 'independent',
      sourceId: '',
      leftSourceId: '',
      rightSourceId: '',
      metricBySource: {},
      assignmentsBySource: {},
      includeTotalBySource: {},
      periodMode: 'single',
      singleTimeKey: '',
      rangeStart: '',
      rangeEnd: '',
      blockKey: '',
      derived: null
    };

    function setActiveModePanel(target) {
      root.querySelectorAll('.tstudent-mode-btn').forEach(button => {
        const active = button.dataset.modeTarget === target;
        button.classList.toggle('active', active);
        button.setAttribute('aria-selected', active ? 'true' : 'false');
      });

      root.querySelectorAll('.tstudent-mode-panel').forEach(panel => {
        panel.classList.toggle('active', panel.dataset.modePanel === target);
      });
    }

    function refreshManualPreviewLegacy() {
      return refreshManualPreview();
      const parsed = null;

      if (!parsed.previewRows.length) {
        manual.previewEl.innerHTML = '<div class="small-note">Nenhum dado carregado ainda.</div>';
        manual.groupSummaryEl.innerHTML = '';
        return parsed;
      }

      const previewHeaders = parsed.mode === 'categorical_numeric' ? ['Grupo', 'Valor'] : parsed.headers;
      manual.previewEl.innerHTML = `
      <div class="small-note">Formato detectado: <strong>${parsed.mode === 'categorical_numeric' ? 'Grupo + valor' : 'Duas colunas numericas'}</strong> · Linhas validas: ${parsed.validRows} · Linhas ignoradas: ${parsed.ignoredRows}</div>
      ${utils.renderPreviewTable(previewHeaders, parsed.previewRows, 8)}
    `;
      manual.groupSummaryEl.innerHTML = `
      <div class="metric-card"><div class="metric-label">Grupo detectado 1</div><div class="metric-value">${utils.escapeHtml(parsed.groupNames[0] || 'Grupo 1')}</div><div class="metric-mini">n = ${parsed.g1.length}</div></div>
      <div class="metric-card"><div class="metric-label">Grupo detectado 2</div><div class="metric-value">${utils.escapeHtml(parsed.groupNames[1] || 'Grupo 2')}</div><div class="metric-mini">n = ${parsed.g2.length}</div></div>
      <div class="metric-card"><div class="metric-label">Dados validos</div><div class="metric-value">${parsed.validRows}</div><div class="metric-mini">Total importado = ${parsed.rawRows}</div></div>
    `;

      return parsed;
    }

    function runManualAnalysisLegacy() {
      return runManualAnalysis();
      const parsed = refreshManualPreview();
      const alpha = Number(manual.alphaEl.value || 0.05);

      if (parsed.g1.length < 2 || parsed.g2.length < 2) {
        renderAnalysisError(manual.statusEl, manual.metricsEl, manual.chartEl, manual.resultsEl, 'Precisamos de pelo menos 2 valores validos em cada grupo para rodar o teste t.');
        return;
      }

      const result = safeWelch(parsed.g1, parsed.g2, stats);
      if (!Number.isFinite(result.t) || !Number.isFinite(result.p)) {
        renderAnalysisError(manual.statusEl, manual.metricsEl, manual.chartEl, manual.resultsEl, 'Nao foi possivel calcular o teste com esses dados.');
        return;
      }

      const labels = [parsed.groupNames[0] || 'Grupo 1', parsed.groupNames[1] || 'Grupo 2'];
      const significant = result.p < alpha;

      manual.statusEl.className = significant ? 'success-box' : 'status-bar';
      manual.statusEl.textContent = significant
        ? `Diferença estatisticamente significativa detectada (p ${utils.fmtP(result.p)}).`
        : `Não houve evidência estatística suficiente de diferença entre as médias (p ${utils.fmtP(result.p)}).`;
      manual.metricsEl.innerHTML = buildResultMetricsHtml(result, labels, utils);
      manual.chartEl.innerHTML = buildResultChartsHtml(result, labels, parsed.g1, parsed.g2, stats, utils);
      manual.resultsEl.innerHTML = buildManualInterpretation(result, alpha, labels, manual.contextEl.value || defaultManualQuestion, utils);
    }

    function clearManualLegacy() {
      return clearManual();
      manual.groupAEl.value = '';
      manual.contextEl.value = defaultManualQuestion;
      manual.alphaEl.value = '0.05';
      manual.previewEl.innerHTML = '<div class="small-note">Nenhum dado carregado ainda.</div>';
      manual.groupSummaryEl.innerHTML = '';
      manual.statusEl.className = 'status-bar';
      manual.statusEl.textContent = 'Campos limpos. Cole novos dados e rode novamente.';
      manual.metricsEl.innerHTML = '';
      manual.chartEl.innerHTML = '';
      manual.resultsEl.innerHTML = '';
    }

    function invalidateManualResults(message = 'A prévia foi atualizada. Revise os dados e clique em "Rodar análise".') {
      manual.statusEl.className = 'status-bar';
      manual.statusEl.textContent = message;
      manual.metricsEl.innerHTML = '';
      manual.chartEl.innerHTML = '';
      manual.resultsEl.innerHTML = '';
    }

    function refreshQuickCounters() {
      const groupASummary = summarizeQuickInput(manual.groupAEl.value, stats, { numeric: true });
      const groupBSummary = summarizeQuickInput(manual.groupBEl.value, stats, { numeric: true });
      const unitsSummary = summarizeQuickInput(manual.unitsEl.value, stats, { numeric: false });

      manual.groupACountEl.textContent = `${groupASummary.valid} validos`;
      manual.groupBCountEl.textContent = `${groupBSummary.valid} validos`;
      manual.unitsCountEl.textContent = `${unitsSummary.valid} labels`;
    }

    function syncManualModeUi() {
      const paired = manualState.analysisMode === 'paired';

      manual.modeButtons.forEach(button => {
        button.classList.toggle('is-active', button.dataset.manualAnalysis === manualState.analysisMode);
      });
      manual.unitsWrapEl.classList.toggle('is-visible', paired);
      manual.modeSummaryEl.textContent = paired
        ? 't pareado: Grupo A e Grupo B precisam ter a mesma ordem de unidades. Linhas sem correspondencia ou com texto ficam marcadas como ignoradas.'
        : 't independente: use apenas Grupo A e Grupo B. Cada grupo pode ter tamanhos diferentes, desde que tenha pelo menos 2 observacoes validas.';
    }

    function syncManualSourceUi() {
      const hasPasteSource = Boolean(manualState.pasteState);
      const hasFileSource = Boolean(manualState.fileState);

      manual.sourceButtons.forEach(button => {
        const source = button.dataset.manualSource;
        button.classList.toggle('is-active', source === manualState.activeSource);
        if (source === 'paste') button.disabled = !hasPasteSource;
        if (source === 'file') button.disabled = !hasFileSource;
      });
    }

    function renderManualPasteStatus() {
      const rawPaste = normalizeManualText(manual.pasteEl.value).trim();

      if (!manualState.pasteState) {
        manual.pasteStatusEl.className = 'status-bar';
        manual.pasteStatusEl.textContent = rawPaste
          ? 'Clique em "Ler dados" para interpretar a tabela.'
          : 'Nenhum dado colado ainda.';
        manual.pasteRecognitionEl.innerHTML = '';
        return;
      }

      if (manualState.pasteState.status === 'error') {
        manual.pasteStatusEl.className = 'error-box';
        manual.pasteStatusEl.innerHTML = utils.escapeHtml(manualState.pasteState.message);
        manual.pasteRecognitionEl.innerHTML = Array.isArray(manualState.pasteState.details) && manualState.pasteState.details.length
          ? `<div class="small-note">${manualState.pasteState.details.map(item => utils.escapeHtml(item)).join(' ')}</div>`
          : '';
        return;
      }

      const delimiterText = manualState.pasteState.delimiter
        ? `Leitura detectada: ${delimiterLabel(manualState.pasteState.delimiter)}.`
        : '';
      const decimalText = manualState.pasteState.decimalCommaDetected
        ? 'Numeros com virgula decimal foram convertidos automaticamente.'
        : '';

      manual.pasteStatusEl.className = 'success-box';
      manual.pasteStatusEl.innerHTML = utils.escapeHtml([delimiterText, decimalText].filter(Boolean).join(' '));
      manual.pasteRecognitionEl.innerHTML = buildRecognizedColumnsChips(manualState.pasteState.recognizedColumns);
    }

    function renderManualFileStatus() {
      if (!manualState.fileState) {
        manual.fileStatusEl.className = 'status-bar';
        manual.fileStatusEl.textContent = 'Nenhum arquivo lido ainda.';
        manual.fileRecognitionEl.innerHTML = '';
        return;
      }

      if (manualState.fileState.status === 'error') {
        manual.fileStatusEl.className = 'error-box';
        manual.fileStatusEl.innerHTML = `
        <strong class="module-file-name" title="${utils.escapeHtml(manualState.fileState.fileName || 'arquivo')}">${utils.escapeHtml(manualState.fileState.fileName || 'arquivo')}</strong><br />
        ${utils.escapeHtml(manualState.fileState.message)}
      `;
        manual.fileRecognitionEl.innerHTML = Array.isArray(manualState.fileState.details) && manualState.fileState.details.length
          ? `<div class="small-note">${manualState.fileState.details.map(item => utils.escapeHtml(item)).join(' ')}</div>`
          : '';
        return;
      }

      const headerText = Number.isFinite(manualState.fileState.headerRowIndex)
        ? `Cabecalho reconhecido na linha ${manualState.fileState.headerRowIndex + 1}.`
        : '';
      const delimiterText = manualState.fileState.delimiter
        ? `Arquivo lido no padrao ${delimiterLabel(manualState.fileState.delimiter)}.`
        : '';
      const decimalText = manualState.fileState.decimalCommaDetected
        ? 'Numeros com virgula decimal foram convertidos automaticamente.'
        : '';

      manual.fileStatusEl.className = 'success-box';
      manual.fileStatusEl.innerHTML = `
      <strong class="module-file-name" title="${utils.escapeHtml(manualState.fileState.fileName)}">${utils.escapeHtml(manualState.fileState.fileName)}</strong><br />
      ${utils.escapeHtml(`Arquivo lido em ${manualState.fileState.tableName}. ${headerText} ${delimiterText} ${decimalText}`.trim())}
    `;
      manual.fileRecognitionEl.innerHTML = buildRecognizedColumnsChips(manualState.fileState.recognizedColumns);
    }

    function buildCurrentQuickDataset() {
      return buildManualDatasetFromStructuredRows({
        mode: manualState.analysisMode,
        sourceKind: 'quick',
        sourceLabel: 'Edicao por grupos',
        rows: buildQuickManualRows(manualState.analysisMode, {
          groupA: manual.groupAEl.value,
          groupB: manual.groupBEl.value,
          units: manual.unitsEl.value
        })
      }, stats);
    }

    function currentManualDataset() {
      if (manualState.activeSource === 'paste' && manualState.pasteState) {
        return buildManualDatasetFromTabularState(manualState.pasteState, manualState.analysisMode, stats, {
          sourceKind: 'paste',
          sourceLabel: 'Tabela colada'
        });
      }
      if (manualState.activeSource === 'file' && manualState.fileState) {
        return buildManualDatasetFromTabularState(manualState.fileState, manualState.analysisMode, stats, {
          sourceKind: 'file',
          sourceLabel: 'Arquivo lido'
        });
      }
      return buildCurrentQuickDataset();
    }

    function refreshManualPreview() {
      refreshQuickCounters();
      syncManualModeUi();
      syncManualSourceUi();
      renderManualPasteStatus();
      renderManualFileStatus();

      const dataset = currentManualDataset();
      manualState.currentDataset = dataset;

      if (!dataset.hasContent) {
        manual.previewEl.innerHTML = '<div class="small-note">Nenhum dado carregado ainda.</div>';
        manual.groupSummaryEl.innerHTML = '';
        return dataset;
      }

      const sourceChips = [
        `<span class="small-chip ${dataset.sourceKind === 'file' ? 'primary' : 'info'}">Fonte ativa: ${utils.escapeHtml(dataset.sourceLabel)}</span>`,
        `<span class="small-chip info">Modo: ${dataset.mode === 'paired' ? 't pareado' : 't independente'}</span>`
      ];
      if (dataset.fileMeta?.tableName) {
        sourceChips.push(`<span class="small-chip info">Aba/bloco: ${utils.escapeHtml(dataset.fileMeta.tableName)}</span>`);
      }

      const primaryTone = dataset.errors.length ? 'error-box' : dataset.warnings.length ? 'status-bar' : 'success-box';
      const primaryMessage = dataset.errors[0]
        || (dataset.sourceKind === 'file'
          ? 'Arquivo interpretado com transparencia. Revise as linhas antes de rodar o teste.'
          : dataset.sourceKind === 'paste'
            ? 'Tabela colada interpretada. Revise bruto x convertido antes de rodar o teste.'
            : 'Entrada por grupos interpretada. Revise as linhas antes de rodar o teste.');
      const warningsHtml = dataset.warnings.length
        ? `<div class="status-bar" style="margin-top:12px;"><ul class="tstudent-inline-list">${dataset.warnings.map(message => `<li>${utils.escapeHtml(message)}</li>`).join('')}</ul></div>`
        : '';
      const infoHtml = dataset.infos.length
        ? `<div class="small-note" style="margin-top:12px;">${dataset.infos.map(message => utils.escapeHtml(message)).join(' ')}</div>`
        : '';
      const recognizedHtml = ['file', 'paste'].includes(dataset.sourceKind) && Object.keys(dataset.recognizedColumns).length
        ? `<div class="tstudent-config-summary" style="margin-top:12px;">${buildRecognizedColumnsChips(dataset.recognizedColumns)}</div>`
        : '';

      manual.previewEl.innerHTML = `
      <div class="tstudent-config-summary">${sourceChips.join('')}</div>
      ${recognizedHtml}
      <div class="${primaryTone}" style="margin-top:12px;">${utils.escapeHtml(primaryMessage)}</div>
      ${warningsHtml}
      ${infoHtml}
      ${buildManualPreviewTable(dataset, utils)}
    `;
      manual.groupSummaryEl.innerHTML = `
      <div class="metric-card">
        <div class="metric-label">${utils.escapeHtml(dataset.displayLabels.groupAWithRole)} validos</div>
        <div class="metric-value">${dataset.validCounts.A}</div>
        <div class="metric-mini">${utils.escapeHtml(dataset.mode === 'paired' ? `pares mantidos em ${dataset.displayLabels.groupAWithRole}` : `observacoes usadas em ${dataset.displayLabels.groupAWithRole}`)}</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">${utils.escapeHtml(dataset.displayLabels.groupBWithRole)} validos</div>
        <div class="metric-value">${dataset.validCounts.B}</div>
        <div class="metric-mini">${utils.escapeHtml(dataset.mode === 'paired' ? `pares mantidos em ${dataset.displayLabels.groupBWithRole}` : `observacoes usadas em ${dataset.displayLabels.groupBWithRole}`)}</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">${dataset.mode === 'paired' ? 'Pares mantidos' : 'Linhas ignoradas'}</div>
        <div class="metric-value">${dataset.mode === 'paired' ? dataset.validCounts.pairs : dataset.ignoredRows.length}</div>
        <div class="metric-mini">${dataset.mode === 'paired' ? `Linhas ignoradas = ${dataset.ignoredRows.length}` : `Total interpretado = ${dataset.rawRows}`}</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Fonte ativa</div>
        <div class="metric-value tstudent-compact-value">${utils.escapeHtml(dataset.sourceKind === 'file' ? (dataset.fileMeta?.fileName || 'Arquivo lido') : dataset.sourceKind === 'paste' ? 'Tabela colada' : 'Edicao por grupos')}</div>
        <div class="metric-mini">${dataset.mode === 'paired' ? `Linhas numericas A/B = ${dataset.numericCounts.A}/${dataset.numericCounts.B}` : `Observacoes validas A/B = ${dataset.validCounts.A}/${dataset.validCounts.B}`}</div>
      </div>
    `;

      return dataset;
    }

    function runManualAnalysis() {
      const dataset = refreshManualPreview();
      const alpha = Number(manual.alphaEl.value || 0.05);
      const labels = [dataset.displayLabels.groupA, dataset.displayLabels.groupB];

      if (!dataset.hasContent) {
        renderAnalysisError(manual.statusEl, manual.metricsEl, manual.chartEl, manual.resultsEl, 'Importe um arquivo, cole uma tabela ou preencha os grupos antes de rodar o teste.');
        return;
      }

      if (dataset.errors.length) {
        renderAnalysisError(manual.statusEl, manual.metricsEl, manual.chartEl, manual.resultsEl, dataset.errors[0]);
        return;
      }

      const result = manualState.analysisMode === 'paired'
        ? safePaired(dataset.vectors.A, dataset.vectors.B, stats)
        : safeWelch(dataset.vectors.A, dataset.vectors.B, stats);
      if (!Number.isFinite(result.t) || !Number.isFinite(result.p)) {
        renderAnalysisError(manual.statusEl, manual.metricsEl, manual.chartEl, manual.resultsEl, 'Nao foi possivel calcular o teste com esses dados.');
        return;
      }

      const significant = result.p < alpha;

      manual.statusEl.className = significant ? 'success-box' : 'status-bar';
      manual.statusEl.textContent = manualState.analysisMode === 'paired'
        ? (significant
          ? `Diferença estatisticamente significativa detectada no t pareado (p ${utils.fmtP(result.p)}).`
          : `Não houve evidência estatística suficiente no t pareado (p ${utils.fmtP(result.p)}).`)
        : (significant
          ? `Diferença estatisticamente significativa detectada no t independente (p ${utils.fmtP(result.p)}).`
          : `Não houve evidência estatística suficiente no t independente (p ${utils.fmtP(result.p)}).`);
      manual.metricsEl.innerHTML = `
      ${buildResultMetricsHtml(result, labels, utils)}
      ${manualState.analysisMode === 'paired' ? `
        <div class="metric-card">
          <div class="metric-label">Pares validos</div>
          <div class="metric-value">${dataset.validCounts.pairs}</div>
          <div class="metric-mini">Somente linhas com dois valores numericos entraram no calculo.</div>
        </div>
      ` : ''}
    `;
      manual.chartEl.innerHTML = buildResultChartsHtml(result, labels, dataset.vectors.A, dataset.vectors.B, stats, utils);
      manual.resultsEl.innerHTML = manualState.analysisMode === 'paired'
        ? buildManualPairedInterpretation(result, alpha, manual.contextEl.value || defaultManualQuestion, labels, utils)
        : buildManualInterpretation(result, alpha, labels, manual.contextEl.value || defaultManualQuestion, utils);
    }

    function clearManual() {
      manual.pasteEl.value = '';
      manual.groupAEl.value = '';
      manual.groupBEl.value = '';
      manual.unitsEl.value = '';
      manual.fileEl.value = '';
      manualState.pasteState = null;
      manualState.fileState = null;
      manualState.activeSource = 'quick';
      manual.contextEl.value = defaultManualQuestion;
      manual.alphaEl.value = '0.05';
      manual.previewEl.innerHTML = '<div class="small-note">Nenhum dado carregado ainda.</div>';
      manual.groupSummaryEl.innerHTML = '';
      renderManualPasteStatus();
      renderManualFileStatus();
      refreshQuickCounters();
      syncManualModeUi();
      syncManualSourceUi();
      invalidateManualResults('Campos limpos. Cole novos dados ou leia um arquivo para continuar.');
    }

    function setManualAnalysisMode(mode) {
      if (!['independent', 'paired'].includes(mode)) return;
      manualState.analysisMode = mode;
      refreshManualPreview();
      invalidateManualResults('Modo manual atualizado. Revise a base antes de rodar o teste.');
    }

    function setManualSource(source) {
      if (source === 'paste' && !manualState.pasteState) return;
      if (source === 'file' && !manualState.fileState) return;
      manualState.activeSource = source;
      refreshManualPreview();
      invalidateManualResults(source === 'file'
        ? 'Fonte alterada para o arquivo lido. Revise a base antes de rodar o teste.'
        : source === 'paste'
          ? 'Fonte alterada para a tabela colada. Revise a base antes de rodar o teste.'
          : 'Fonte alterada para a edicao por grupos. Revise a base antes de rodar o teste.');
    }

    function applyManualExample() {
      const example = MANUAL_QUICK_EXAMPLES[manualState.analysisMode] || MANUAL_QUICK_EXAMPLES.independent;
      manual.pasteEl.value = MANUAL_WIDE_EXAMPLE_TEXT;
      manual.groupAEl.value = example.groupA;
      manual.groupBEl.value = example.groupB;
      manual.unitsEl.value = example.units;
      manual.fileEl.value = '';
      manualState.pasteState = readManualPasteState(MANUAL_WIDE_EXAMPLE_TEXT, stats);
      manualState.fileState = null;
      manualState.activeSource = 'paste';
      refreshManualPreview();
      invalidateManualResults('Exemplo aplicado no formato brasileiro. Revise a base e clique em "Rodar análise".');
    }

    function handlePastedTextInput() {
      manualState.pasteState = null;
      if (manualState.activeSource === 'paste') {
        manualState.activeSource = 'quick';
      }
      refreshManualPreview();
      invalidateManualResults('Conteudo colado atualizado. Clique em "Ler dados" para revisar essa tabela.');
    }

    function readManualPasteInput() {
      const rawPaste = normalizeManualText(manual.pasteEl.value).trim();
      if (!rawPaste) {
        manualState.pasteState = null;
        manualState.activeSource = 'quick';
        refreshManualPreview();
        invalidateManualResults('Cole uma tabela antes de usar "Ler dados".');
        return;
      }

      manualState.pasteState = readManualPasteState(rawPaste, stats);
      manualState.activeSource = 'paste';
      refreshManualPreview();
      invalidateManualResults(manualState.pasteState.status === 'loaded'
        ? 'Dados colados lidos. Revise a previa e clique em "Rodar analise".'
        : 'Nao foi possivel interpretar os dados colados. Confira a mensagem acima.');
    }

    async function handleManualFile(event) {
      const file = event.target.files?.[0];
      if (!file) return;

      manual.fileStatusEl.className = 'status-bar';
      manual.fileStatusEl.textContent = 'Lendo arquivo selecionado...';
      manual.fileRecognitionEl.innerHTML = '';

      manualState.fileState = await readManualFileState(file, utils, stats);
      manualState.activeSource = 'file';
      refreshManualPreview();
      invalidateManualResults(manualState.fileState.status === 'loaded'
        ? 'Arquivo lido. Revise a prévia e clique em "Rodar análise".'
        : 'Houve um problema na leitura do arquivo. Confira a mensagem acima.');
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

    function ensureAssignments(source) {
      if (!source) return {};
      if (!datasusState.assignmentsBySource[source.id]) {
        datasusState.assignmentsBySource[source.id] = {};
      }
      return datasusState.assignmentsBySource[source.id];
    }

    function availableTimeOptions() {
      if (datasusState.analysisMode === 'paired') {
        const leftSource = getSource(datasusState.leftSourceId);
        const rightSource = getSource(datasusState.rightSourceId);
        if (!leftSource || !rightSource) return [];
        return sharedTimeOptions(leftSource, rightSource);
      }

      const source = getSource(datasusState.sourceId);
      return source ? getTimeOptions(source) : [];
    }

    function ensureDatasusDefaults() {
      const sources = confirmedSources();
      if (!sources.length) {
        datasusState.derived = null;
        datasusState.sourceId = '';
        datasusState.leftSourceId = '';
        datasusState.rightSourceId = '';
        return;
      }

      sources.forEach(source => {
        if (!datasusState.metricBySource[source.id]) {
          datasusState.metricBySource[source.id] = getPrimaryMetricKey(source);
        }
        if (typeof datasusState.includeTotalBySource[source.id] !== 'boolean') {
          datasusState.includeTotalBySource[source.id] = false;
        }
        ensureAssignments(source);
      });

      if (!sources.some(source => source.id === datasusState.sourceId)) {
        datasusState.sourceId = sources[0].id;
      }

      const suggestedPair = findBestNormalizedPair(sources);
      if (!sources.some(source => source.id === datasusState.leftSourceId)) {
        datasusState.leftSourceId = suggestedPair?.leftId || sources[0].id;
      }
      if (!sources.some(source => source.id === datasusState.rightSourceId)) {
        datasusState.rightSourceId = suggestedPair?.rightId || sources[1]?.id || sources[0].id;
      }

      const timeOptions = availableTimeOptions();
      if (!timeOptions.length) {
        datasusState.singleTimeKey = '';
        datasusState.rangeStart = '';
        datasusState.rangeEnd = '';
        datasusState.blockKey = '';
        return;
      }

      const latest = timeOptions[timeOptions.length - 1].key;
      if (!timeOptions.some(option => option.key === datasusState.singleTimeKey)) {
        datasusState.singleTimeKey = latest;
      }
      if (!timeOptions.some(option => option.key === datasusState.rangeStart)) {
        datasusState.rangeStart = timeOptions[0].key;
      }
      if (!timeOptions.some(option => option.key === datasusState.rangeEnd)) {
        datasusState.rangeEnd = latest;
      }

      const blocks = buildTimeBlocks(timeOptions);
      if (!blocks.some(block => block.key === datasusState.blockKey)) {
        datasusState.blockKey = blocks[0]?.key || '';
      }
      if (!['single', 'range', 'block'].includes(datasusState.periodMode)) {
        datasusState.periodMode = 'single';
      }
      if (!datasusState.blockKey && datasusState.periodMode === 'block') {
        datasusState.periodMode = 'single';
      }
    }

    function selectedTimeKeys() {
      const options = availableTimeOptions();
      if (!options.length) return [];

      if (datasusState.periodMode === 'single') {
        return datasusState.singleTimeKey ? [datasusState.singleTimeKey] : [];
      }

      if (datasusState.periodMode === 'block') {
        const block = buildTimeBlocks(options).find(item => item.key === datasusState.blockKey);
        return block ? block.keys : [];
      }

      const indexStart = options.findIndex(option => option.key === datasusState.rangeStart);
      const indexEnd = options.findIndex(option => option.key === datasusState.rangeEnd);
      if (indexStart === -1 || indexEnd === -1) return [];
      const min = Math.min(indexStart, indexEnd);
      const max = Math.max(indexStart, indexEnd);
      return options.slice(min, max + 1).map(option => option.key);
    }

    function invalidateDatasusResults(message = 'A base derivada foi atualizada. Revise os dados e execute o teste.') {
      datasusRefs.statusEl.className = 'status-bar';
      datasusRefs.statusEl.textContent = message;
      datasusRefs.metricsEl.innerHTML = '';
      datasusRefs.chartEl.innerHTML = '';
      datasusRefs.resultsEl.innerHTML = '';
      datasusRefs.runBtn.disabled = !(datasusState.derived && datasusState.derived.ok);
    }

    function deriveCurrentData() {
      ensureDatasusDefaults();

      if (!confirmedSources().length) {
        return {
          ok: false,
          mode: datasusState.analysisMode,
          primaryError: 'Confirme pelo menos uma base DATASUS antes de prosseguir.',
          errors: ['Confirme pelo menos uma base DATASUS antes de prosseguir.']
        };
      }

      if (datasusState.analysisMode === 'paired') {
        const leftSource = getSource(datasusState.leftSourceId);
        const rightSource = getSource(datasusState.rightSourceId);
        return derivePairedTTest({
          leftSource,
          rightSource,
          leftMetricKey: datasusState.metricBySource[leftSource?.id],
          rightMetricKey: datasusState.metricBySource[rightSource?.id],
          timeKeys: selectedTimeKeys(),
          includeTotal: Boolean(datasusState.includeTotalBySource[leftSource?.id] || datasusState.includeTotalBySource[rightSource?.id]),
          stats
        });
      }

      const source = getSource(datasusState.sourceId);
      const assignments = ensureAssignments(source);
      const groupAKeys = Object.entries(assignments).filter(([, value]) => value === 'A').map(([key]) => key);
      const groupBKeys = Object.entries(assignments).filter(([, value]) => value === 'B').map(([key]) => key);

      return deriveIndependentTTest({
        source,
        metricKey: datasusState.metricBySource[source?.id],
        groupAKeys,
        groupBKeys,
        timeKeys: selectedTimeKeys(),
        includeTotal: Boolean(datasusState.includeTotalBySource[source?.id]),
        stats
      });
    }

    function buildPeriodControlsHtml() {
      const options = availableTimeOptions();
      if (!options.length) {
        return '<div class="small-note" style="margin-top:14px;">Esta base nao possui eixo temporal utilizavel. Todos os registros validos serao considerados.</div>';
      }

      const blocks = buildTimeBlocks(options);

      return `
      <div class="form-grid three" style="margin-top:16px;">
        <div>
          <label for="t-datasus-period-mode">Periodo analisado</label>
          <select id="t-datasus-period-mode">
            <option value="single"${datasusState.periodMode === 'single' ? ' selected' : ''}>Ano unico (default)</option>
            <option value="range"${datasusState.periodMode === 'range' ? ' selected' : ''}>Intervalo</option>
            <option value="block"${datasusState.periodMode === 'block' ? ' selected' : ''}>Bloco de 5 periodos</option>
          </select>
        </div>
        <div class="tstudent-period-field ${datasusState.periodMode === 'single' ? 'is-visible' : ''}">
          <label for="t-datasus-single">Periodo</label>
          <select id="t-datasus-single">
            ${options.map(option => `<option value="${utils.escapeHtml(option.key)}"${option.key === datasusState.singleTimeKey ? ' selected' : ''}>${utils.escapeHtml(option.label)}</option>`).join('')}
          </select>
        </div>
        <div class="tstudent-period-field ${datasusState.periodMode === 'block' ? 'is-visible' : ''}">
          <label for="t-datasus-block">Bloco</label>
          <select id="t-datasus-block">
            ${blocks.map(block => `<option value="${utils.escapeHtml(block.key)}"${block.key === datasusState.blockKey ? ' selected' : ''}>${utils.escapeHtml(block.label)}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="form-grid two tstudent-range-grid ${datasusState.periodMode === 'range' ? 'is-visible' : ''}">
        <div>
          <label for="t-datasus-range-start">Inicio</label>
          <select id="t-datasus-range-start">
            ${options.map(option => `<option value="${utils.escapeHtml(option.key)}"${option.key === datasusState.rangeStart ? ' selected' : ''}>${utils.escapeHtml(option.label)}</option>`).join('')}
          </select>
        </div>
        <div>
          <label for="t-datasus-range-end">Fim</label>
          <select id="t-datasus-range-end">
            ${options.map(option => `<option value="${utils.escapeHtml(option.key)}"${option.key === datasusState.rangeEnd ? ' selected' : ''}>${utils.escapeHtml(option.label)}</option>`).join('')}
          </select>
        </div>
      </div>
    `;
    }

    function attachPeriodEvents() {
      datasusRefs.selectionEl.querySelector('#t-datasus-period-mode')?.addEventListener('change', event => {
        datasusState.periodMode = event.target.value;
        renderDatasusSelection();
        renderDatasusDerived();
        invalidateDatasusResults();
      });

      datasusRefs.selectionEl.querySelector('#t-datasus-single')?.addEventListener('change', event => {
        datasusState.singleTimeKey = event.target.value;
        renderDatasusDerived();
        invalidateDatasusResults();
      });

      datasusRefs.selectionEl.querySelector('#t-datasus-range-start')?.addEventListener('change', event => {
        datasusState.rangeStart = event.target.value;
        renderDatasusDerived();
        invalidateDatasusResults();
      });

      datasusRefs.selectionEl.querySelector('#t-datasus-range-end')?.addEventListener('change', event => {
        datasusState.rangeEnd = event.target.value;
        renderDatasusDerived();
        invalidateDatasusResults();
      });

      datasusRefs.selectionEl.querySelector('#t-datasus-block')?.addEventListener('change', event => {
        datasusState.blockKey = event.target.value;
        renderDatasusDerived();
        invalidateDatasusResults();
      });
    }

    function renderDatasusAnalysis() {
      const sources = confirmedSources();
      if (!sources.length) {
        const hasShared = Boolean(shared?.datasus?.lastSession?.confirmedSources?.length);
        datasusRefs.analysisEl.innerHTML = `
        <div class="status-bar">Confirme pelo menos uma base DATASUS no wizard para escolher o tipo de comparacao.</div>
        ${hasShared ? '<div class="actions-row" style="margin-top:14px;"><button type="button" class="btn-secondary" id="t-datasus-use-shared">Usar ultima sessao DATASUS confirmada</button></div>' : ''}
      `;
        datasusRefs.analysisEl.querySelector('#t-datasus-use-shared')?.addEventListener('click', () => {
          datasusState.sharedSession = clonePlain(shared.datasus.lastSession);
          ensureDatasusDefaults();
          renderDatasusAnalysis();
          renderDatasusSelection();
          renderDatasusDerived();
          invalidateDatasusResults('Ultima sessao DATASUS confirmada carregada neste modulo.');
        });
        return;
      }

      const suggestedPair = findBestNormalizedPair(sources);
      const suggestion = suggestedPair && suggestedPair.sharedCategoryCount >= 2
        ? `Isso parece um cenario pareado: ${suggestedPair.sharedCategoryCount} unidades aparecem em duas bases compativeis.`
        : 'Sem pareamento claro detectado, o fluxo sugere comecar por grupos independentes.';

      datasusRefs.analysisEl.innerHTML = `
      <div class="${suggestedPair ? 'success-box' : 'status-bar'}">${utils.escapeHtml(suggestion)}</div>
      <div class="tstudent-choice-grid" style="margin-top:14px;">
        <button type="button" class="tstudent-choice-card ${datasusState.analysisMode === 'paired' ? 'is-active' : ''}" data-analysis-mode="paired">
          <strong>1. Comparar dois procedimentos</strong>
          <span>Seleciona duas bases compativeis e roda <strong>t pareado</strong>.</span>
        </button>
        <button type="button" class="tstudent-choice-card ${datasusState.analysisMode === 'independent' ? 'is-active' : ''}" data-analysis-mode="independent">
          <strong>2. Comparar dois grupos diferentes</strong>
          <span>Seleciona categorias do mesmo arquivo e roda <strong>t independente (Welch)</strong>.</span>
        </button>
        <button type="button" class="tstudent-choice-card" data-analysis-mode="manual">
          <strong>3. Modo manual</strong>
          <span>Volta para o fluxo original do modulo.</span>
        </button>
      </div>
    `;

      datasusRefs.analysisEl.querySelectorAll('[data-analysis-mode]').forEach(button => {
        button.addEventListener('click', () => {
          const mode = button.dataset.analysisMode;
          if (mode === 'manual') {
            setActiveModePanel('manual');
            return;
          }
          datasusState.analysisMode = mode;
          ensureDatasusDefaults();
          renderDatasusAnalysis();
          renderDatasusSelection();
          renderDatasusDerived();
          invalidateDatasusResults();
        });
      });
    }

    function renderIndependentSelection(source) {
      const categories = getCategoryOptions(source, datasusState.includeTotalBySource[source.id]);
      const assignments = ensureAssignments(source);
      const metricOptions = getMetricOptions(source);
      const countA = Object.values(assignments).filter(value => value === 'A').length;
      const countB = Object.values(assignments).filter(value => value === 'B').length;

      datasusRefs.selectionEl.innerHTML = `
      <div class="${countA && countB ? 'success-box' : 'status-bar'}">${utils.escapeHtml(countA && countB ? 'Isso parece comparacao entre grupos independentes: as categorias foram separadas em grupos distintos.' : 'Selecione quais categorias entrarao no Grupo A e no Grupo B.')}</div>
      <div class="form-grid three" style="margin-top:14px;">
        <div>
          <label for="t-datasus-source">Base normalizada</label>
          <select id="t-datasus-source">
            ${confirmedSources().map(item => `<option value="${utils.escapeHtml(item.id)}"${item.id === source.id ? ' selected' : ''}>${utils.escapeHtml(procedureLabel(item))}</option>`).join('')}
          </select>
        </div>
        <div>
          <label for="t-datasus-metric">Medida</label>
          <select id="t-datasus-metric">
            ${metricOptions.map(option => `<option value="${utils.escapeHtml(option.key)}"${option.key === datasusState.metricBySource[source.id] ? ' selected' : ''}>${utils.escapeHtml(option.label)}</option>`).join('')}
          </select>
        </div>
        <div>
          <label class="tstudent-toggle">
            <input id="t-datasus-show-total" type="checkbox"${datasusState.includeTotalBySource[source.id] ? ' checked' : ''} />
            <span>Incluir Total como opcao avancada</span>
          </label>
        </div>
      </div>
      ${buildPeriodControlsHtml()}
      <div class="tstudent-group-picker" style="margin-top:14px;">
        <div class="tstudent-group-picker-head">
          <div>${utils.escapeHtml(source.normalized.schema.categoryLabel || 'Categoria')}</div>
          <div>Grupo A</div>
          <div>Grupo B</div>
        </div>
        ${categories.map(option => `
          <div class="tstudent-group-row ${option.isTotal ? 'is-total-row' : ''}">
            <div><strong>${utils.escapeHtml(option.label)}</strong></div>
            <label class="tstudent-checkbox-cell">
              <input type="checkbox" data-action="assign-group" data-category-key="${utils.escapeHtml(option.key)}" data-group="A"${assignments[option.key] === 'A' ? ' checked' : ''} />
            </label>
            <label class="tstudent-checkbox-cell">
              <input type="checkbox" data-action="assign-group" data-category-key="${utils.escapeHtml(option.key)}" data-group="B"${assignments[option.key] === 'B' ? ' checked' : ''} />
            </label>
          </div>
        `).join('')}
      </div>
    `;

      datasusRefs.selectionEl.querySelector('#t-datasus-source')?.addEventListener('change', event => {
        datasusState.sourceId = event.target.value;
        ensureDatasusDefaults();
        renderDatasusSelection();
        renderDatasusDerived();
        invalidateDatasusResults();
      });

      datasusRefs.selectionEl.querySelector('#t-datasus-metric')?.addEventListener('change', event => {
        datasusState.metricBySource[source.id] = event.target.value;
        renderDatasusDerived();
        invalidateDatasusResults();
      });

      datasusRefs.selectionEl.querySelector('#t-datasus-show-total')?.addEventListener('change', event => {
        datasusState.includeTotalBySource[source.id] = event.target.checked;
        renderDatasusSelection();
        renderDatasusDerived();
        invalidateDatasusResults();
      });

      datasusRefs.selectionEl.querySelectorAll('[data-action="assign-group"]').forEach(input => {
        input.addEventListener('change', event => {
          const categoryKey = event.target.dataset.categoryKey;
          const group = event.target.dataset.group;
          if (event.target.checked) {
            assignments[categoryKey] = group;
          } else if (assignments[categoryKey] === group) {
            assignments[categoryKey] = null;
          }
          renderDatasusSelection();
          renderDatasusDerived();
          invalidateDatasusResults();
        });
      });

      attachPeriodEvents();
    }

    function renderPairedSelection(leftSource, rightSource) {
      const metricOptionsLeft = getMetricOptions(leftSource);
      const metricOptionsRight = getMetricOptions(rightSource);
      const suggestion = findBestNormalizedPair(confirmedSources());

      datasusRefs.selectionEl.innerHTML = `
      <div class="${suggestion ? 'success-box' : 'status-bar'}">${utils.escapeHtml(suggestion ? `Isso parece um cenario pareado: ${suggestion.sharedCategoryCount} unidades em comum foram detectadas.` : 'Selecione duas bases com unidades em comum para montar a comparacao pareada.')}</div>
      <div class="form-grid two" style="margin-top:14px;">
        <div>
          <label for="t-datasus-left">Procedimento A</label>
          <select id="t-datasus-left">
            ${confirmedSources().map(item => `<option value="${utils.escapeHtml(item.id)}"${item.id === leftSource.id ? ' selected' : ''}>${utils.escapeHtml(procedureLabel(item))}</option>`).join('')}
          </select>
        </div>
        <div>
          <label for="t-datasus-right">Procedimento B</label>
          <select id="t-datasus-right">
            ${confirmedSources().map(item => `<option value="${utils.escapeHtml(item.id)}"${item.id === rightSource.id ? ' selected' : ''}>${utils.escapeHtml(procedureLabel(item))}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="form-grid two" style="margin-top:14px;">
        <div>
          <label for="t-datasus-left-metric">Medida de A</label>
          <select id="t-datasus-left-metric">
            ${metricOptionsLeft.map(option => `<option value="${utils.escapeHtml(option.key)}"${option.key === datasusState.metricBySource[leftSource.id] ? ' selected' : ''}>${utils.escapeHtml(option.label)}</option>`).join('')}
          </select>
        </div>
        <div>
          <label for="t-datasus-right-metric">Medida de B</label>
          <select id="t-datasus-right-metric">
            ${metricOptionsRight.map(option => `<option value="${utils.escapeHtml(option.key)}"${option.key === datasusState.metricBySource[rightSource.id] ? ' selected' : ''}>${utils.escapeHtml(option.label)}</option>`).join('')}
          </select>
        </div>
      </div>
      ${buildPeriodControlsHtml()}
      <div class="small-note" style="margin-top:14px;">A tabela derivada mantera apenas unidades com os dois valores no periodo selecionado.</div>
    `;

      datasusRefs.selectionEl.querySelector('#t-datasus-left')?.addEventListener('change', event => {
        datasusState.leftSourceId = event.target.value;
        ensureDatasusDefaults();
        renderDatasusSelection();
        renderDatasusDerived();
        invalidateDatasusResults();
      });

      datasusRefs.selectionEl.querySelector('#t-datasus-right')?.addEventListener('change', event => {
        datasusState.rightSourceId = event.target.value;
        ensureDatasusDefaults();
        renderDatasusSelection();
        renderDatasusDerived();
        invalidateDatasusResults();
      });

      datasusRefs.selectionEl.querySelector('#t-datasus-left-metric')?.addEventListener('change', event => {
        datasusState.metricBySource[leftSource.id] = event.target.value;
        renderDatasusDerived();
        invalidateDatasusResults();
      });

      datasusRefs.selectionEl.querySelector('#t-datasus-right-metric')?.addEventListener('change', event => {
        datasusState.metricBySource[rightSource.id] = event.target.value;
        renderDatasusDerived();
        invalidateDatasusResults();
      });

      attachPeriodEvents();
    }

    function renderDatasusSelection() {
      ensureDatasusDefaults();

      if (!confirmedSources().length) {
        datasusRefs.selectionEl.innerHTML = '<div class="small-note">Confirme uma base DATASUS primeiro.</div>';
        return;
      }

      if (datasusState.analysisMode === 'paired') {
        const leftSource = getSource(datasusState.leftSourceId);
        const rightSource = getSource(datasusState.rightSourceId);
        if (!leftSource || !rightSource) {
          datasusRefs.selectionEl.innerHTML = '<div class="error-box">Selecione duas bases confirmadas para comparar procedimentos.</div>';
          return;
        }
        renderPairedSelection(leftSource, rightSource);
        return;
      }

      const source = getSource(datasusState.sourceId);
      if (!source) {
        datasusRefs.selectionEl.innerHTML = '<div class="error-box">Selecione uma base confirmada para comparar grupos.</div>';
        return;
      }
      renderIndependentSelection(source);
    }

    function renderDatasusDerived() {
      const derived = deriveCurrentData();
      datasusState.derived = derived;
      datasusRefs.runBtn.disabled = !derived.ok;

      if (!derived.ok) {
        datasusRefs.derivedEl.innerHTML = `
        <div class="error-box">
          <strong>Base derivada ainda invalida.</strong>
          <ul class="datasus-inline-list">
            ${(derived.errors || [derived.primaryError || 'Nao ha dados suficientes para comparacao.']).map(item => `<li>${utils.escapeHtml(item)}</li>`).join('')}
          </ul>
        </div>
      `;
        return;
      }

      if (derived.mode === 'paired') {
        const rows = derived.derivedRows.map(row => [
          row.rowLabel,
          utils.fmtNumber(row.valueA, 3),
          utils.fmtNumber(row.valueB, 3),
          utils.fmtSigned(row.diff, 3),
          row.validTimes.join(', ')
        ]);

        datasusRefs.derivedEl.innerHTML = `
        <div class="success-box">${utils.escapeHtml(derived.explanation)}</div>
        <div class="small-note" style="margin:14px 0 10px;">Diferenca por unidade: cada linha abaixo corresponde a um par usado no teste.</div>
        ${utils.renderPreviewTable(['Unidade', 'Procedimento A', 'Procedimento B', 'Diferenca', 'Periodos usados'], rows)}
      `;
        return;
      }

      const rows = derived.derivedRows.map(row => [
        row.rowLabel,
        row.groupLabel,
        utils.fmtNumber(row.value, 3),
        row.validTimes.join(', ')
      ]);

      datasusRefs.derivedEl.innerHTML = `
      <div class="success-box">${utils.escapeHtml(derived.explanation)}</div>
      <div class="small-note" style="margin:14px 0 10px;">Resumo utilizado: media dos periodos selecionados dentro de cada categoria, mantendo cada categoria como observacao separada.</div>
      ${utils.renderPreviewTable(['Categoria', 'Grupo', 'Valor resumido', 'Periodos usados'], rows)}
    `;
    }

    function runDatasusAnalysis() {
      const derived = deriveCurrentData();
      datasusState.derived = derived;
      renderDatasusDerived();

      if (!derived.ok) {
        datasusRefs.statusEl.className = 'error-box';
        datasusRefs.statusEl.textContent = derived.primaryError || 'Nao ha dados suficientes para comparacao.';
        datasusRefs.metricsEl.innerHTML = '';
        datasusRefs.chartEl.innerHTML = '';
        datasusRefs.resultsEl.innerHTML = '';
        return;
      }

      const result = derived.mode === 'paired'
        ? safePaired(derived.vectors.A, derived.vectors.B, stats)
        : safeWelch(derived.vectors.A, derived.vectors.B, stats);
      const alpha = Number(datasusRefs.alphaEl.value || 0.05);

      datasusRefs.statusEl.className = toneClass(result.p < alpha ? 'success' : 'status');
      datasusRefs.statusEl.textContent = buildGuidedStatusText(result, derived, alpha, utils);
      datasusRefs.metricsEl.innerHTML = buildGuidedExtraMetrics(derived, utils) + buildResultMetricsHtml(result, derived.groupLabels, utils);
      datasusRefs.chartEl.innerHTML = buildResultChartsHtml(result, derived.groupLabels, derived.vectors.A, derived.vectors.B, stats, utils);
      datasusRefs.resultsEl.innerHTML = buildGuidedInterpretation(result, derived, alpha, datasusRefs.contextEl.value || defaultDatasusQuestion, utils);
    }

    function mountWizard() {
      if (isMissingElementRef(datasusRefs.wizardEl)) {
        warnMissingUi('wizard DATASUS', '#t-datasus-wizard', 'A etapa DATASUS nao sera montada nesta renderizacao.');
        return;
      }
      createDatasusWizard({
        root: datasusRefs.wizardEl,
        utils,
        stats,
        shared,
        exampleSources: exampleSourcesFromConfig(config),
        onSessionChange(session) {
          datasusState.session = clonePlain(session);
          datasusState.sharedSession = clonePlain(shared?.datasus?.lastSession || null);
          ensureDatasusDefaults();
          renderDatasusAnalysis();
          renderDatasusSelection();
          renderDatasusDerived();
          invalidateDatasusResults(session.confirmedSources.length ? 'Base DATASUS confirmada e pronta para derivacao.' : 'Confirme uma base DATASUS para prosseguir.');
        }
      });
    }

    safeBindAll(root, '[data-manual-analysis]', 'click', event => {
      setManualAnalysisMode(event.currentTarget.dataset.manualAnalysis);
    }, { label: 'alternancia entre modos do t manual' });

    safeBindAll(root, '[data-manual-source]', 'click', event => {
      setManualSource(event.currentTarget.dataset.manualSource);
    }, { label: 'alternancia entre fontes do modo manual' });

    const pasteZone = root.querySelector('#t-paste-zone');
    if (pasteZone) {
      pasteZone.addEventListener('paste', event => {
        event.preventDefault();
        const rawText = (event.clipboardData || window.clipboardData).getData('text');
        if (!rawText.trim()) return;
        manual.pasteEl.value = rawText;
        readManualPasteInput();

        // Also automatically trigger run if possible
        setTimeout(() => {
          if (manualState.pasteState && manualState.pasteState.status === 'loaded') {
            runManualAnalysis();
          }
        }, 50);
      });
    }
    safeBind(root, '#t-example', 'click', applyManualExample, { label: 'botao usar exemplo', optional: true });
    safeBind(root, '#t-run', 'click', runManualAnalysis, { label: 'botao rodar teste', optional: true });
    safeBind(root, '#t-clear', 'click', clearManual, { label: 'botao limpar', optional: true });

    const handleManualInput = () => {
      manualState.activeSource = 'quick';
      refreshManualPreview();
      invalidateManualResults('Entrada manual atualizada. Revise a base antes de rodar o teste.');
    };
    safeBind(root, '#t-group-a', 'input', handleManualInput, { label: 'campo do Grupo A' });
    safeBind(root, '#t-group-b', 'input', handleManualInput, { label: 'campo do Grupo B' });
    safeBind(root, '#t-units', 'input', handleManualInput, { label: 'campo de unidades', optional: true });
    safeBind(root, '#t-paste-data', 'input', handlePastedTextInput, { label: 'area de dados colados', optional: true });
    safeBind(root, '#t-file', 'change', handleManualFile, { label: 'upload manual', optional: true });

    refreshManualPreview();
    invalidateManualResults('Importe um arquivo, cole uma tabela ou edite os grupos para iniciar.');
  } catch (error) {
    console.error('[t-student] Falha ao renderizar o modulo t de Student.', error);
    root.innerHTML = `
      <div class="module-grid">
        <section class="surface-card">
          <div class="error-box">
            <strong>Nao foi possivel carregar o modulo t de Student agora.</strong><br />
            Recarregue a pagina e, se o problema continuar, use o console para depuracao.
          </div>
        </section>
      </div>
    `;
  }
}
