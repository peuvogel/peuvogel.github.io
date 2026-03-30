export function normalizeTabularText(value) {
  return String(value || '')
    .replace(/\uFEFF/g, '')
    .replace(/\u0000/g, '')
    .replace(/\r\n?/g, '\n')
    .normalize('NFC');
}

export function normalizeTabularSpaces(value) {
  return normalizeTabularText(value)
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeHeaderToken(value) {
  return normalizeTabularSpaces(value)
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
        cells.push(normalizeTabularSpaces(current));
        current = '';
      }
      continue;
    }

    current += char;
  }

  cells.push(normalizeTabularSpaces(current));
  return cells;
}

export function detectDelimiter(lines) {
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

export function delimiterFormatLabel(delimiter) {
  if (delimiter === ';') return 'CSV com ponto e virgula';
  if (delimiter === '\t') return 'Tabela tabulada';
  if (delimiter === ',') return 'CSV/TXT';
  return 'texto';
}

export function normalizeNumericSource(raw) {
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

export function parseTabularNumber(raw, stats) {
  const normalized = normalizeNumericSource(raw);
  if (!normalized) return null;

  const direct = Number(normalized);
  if (Number.isFinite(direct)) return direct;

  if (typeof stats?.parseNumber === 'function') {
    return stats.parseNumber(normalized);
  }

  return null;
}

export function rawUsesDecimalComma(raw) {
  return /,\d/.test(String(raw || ''));
}

export function describeIgnoredRowReason(index, notes = []) {
  const first = String(notes[0] || 'linha sem valor numérico utilizável.')
    .trim()
    .replace(/\.$/, '');
  const normalized = first
    ? `${first.charAt(0).toLowerCase()}${first.slice(1)}`
    : 'a linha não trouxe valores numéricos válidos';
  return `A linha ${index} foi ignorada porque ${normalized}.`;
}

export function parseDelimitedRows(text) {
  const lines = normalizeTabularText(text)
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

  const delimiter = detectDelimiter(lines);
  return {
    rows: lines.map(line => splitDelimitedLine(line, delimiter)),
    delimiter,
    formatLabel: delimiterFormatLabel(delimiter)
  };
}

export function matchTabularColumns(headers, aliases, requiredKeys = []) {
  const recognizedColumns = {};
  const duplicates = [];

  headers.forEach((header, index) => {
    const normalized = normalizeHeaderToken(header);
    if (!normalized) return;

    const matchedKey = Object.entries(aliases || {}).find(([, knownAliases]) => (
      (knownAliases || []).some(alias => normalizeHeaderToken(alias) === normalized)
    ))?.[0];

    if (!matchedKey) return;
    if (recognizedColumns[matchedKey]) {
      duplicates.push(`${recognizedColumns[matchedKey].header} / ${normalizeTabularSpaces(header) || `Coluna ${index + 1}`}`);
      return;
    }

    recognizedColumns[matchedKey] = {
      index,
      header: normalizeTabularSpaces(header) || `Coluna ${index + 1}`
    };
  });

  return {
    recognizedColumns,
    duplicates,
    requiredFound: requiredKeys.every(key => Boolean(recognizedColumns[key]))
  };
}

export function buildRecognizedColumnsChips(recognizedColumns, order = []) {
  return order
    .filter(item => recognizedColumns[item.key])
    .map(item => `<span class="small-chip info">${item.label} &larr; ${recognizedColumns[item.key].header}</span>`)
    .join('');
}

function cellLooksLikeHeader(value, stats) {
  const normalized = normalizeTabularSpaces(value);
  if (!normalized) return false;
  if (/[a-z\u00c0-\u024f]/i.test(normalized)) return true;
  if (/[_-]/.test(normalized)) return true;
  return parseTabularNumber(normalized, stats) === null;
}

function cellMatchesExpectedType(raw, key, positionFallback, stats) {
  const normalized = normalizeTabularSpaces(raw);
  if (!normalized) return false;

  const validator = positionFallback?.compatibilityValidators?.[key];
  if (typeof validator === 'function') {
    return Boolean(validator(normalized, stats));
  }

  return parseTabularNumber(normalized, stats) !== null;
}

function buildPositionalRecognizedColumns(headers, positionFallback) {
  const recognizedColumns = {};
  const keysByIndex = positionFallback?.keysByIndex || [];

  for (let index = 0; index < Math.min(headers.length, keysByIndex.length); index += 1) {
    const key = keysByIndex[index];
    if (!key) continue;
    recognizedColumns[key] = {
      index,
      header: normalizeTabularSpaces(headers[index]) || `Coluna ${index + 1}`,
      detection: 'position'
    };
  }

  return recognizedColumns;
}

function rowLooksLikeFallbackHeader(headers, bodyRows, positionFallback, stats) {
  const minColumns = positionFallback?.minColumns || 3;
  const headerCells = headers
    .slice(0, minColumns)
    .map(value => normalizeTabularSpaces(value))
    .filter(Boolean);

  if (headerCells.length < minColumns) return false;

  const requiredKeys = positionFallback?.requiredKeys || [];
  const requiredPositions = requiredKeys
    .map(key => (positionFallback?.keysByIndex || []).indexOf(key))
    .filter(index => index >= 0);

  if (!requiredPositions.length) return false;

  const firstDataRow = bodyRows[0] || [];
  const textualRequiredHeaders = requiredPositions.filter(index => cellLooksLikeHeader(headers[index], stats)).length;
  const textualHeaderCount = headerCells.filter(value => cellLooksLikeHeader(value, stats)).length;
  const firstRowHasCompatibleData = requiredPositions.some(index => {
    const key = positionFallback.keysByIndex[index];
    return cellMatchesExpectedType(firstDataRow[index], key, positionFallback, stats);
  });

  return textualRequiredHeaders === requiredPositions.length
    || (textualHeaderCount >= Math.min(2, headerCells.length) && firstRowHasCompatibleData);
}

function buildFallbackRecognitionDetails(positionFallback) {
  const details = [];

  if (positionFallback?.introText) details.push(positionFallback.introText);
  if (positionFallback?.assumptionText) details.push(positionFallback.assumptionText);
  if (positionFallback?.headerText) details.push(positionFallback.headerText);

  return details;
}

function buildPositionalFallbackCandidate(table, rowIndex, headers, bodyRows, options, stats) {
  const positionFallback = options?.positionFallback;
  if (!positionFallback) return null;
  if (!rowLooksLikeFallbackHeader(headers, bodyRows, positionFallback, stats)) return null;

  const recognizedColumns = buildPositionalRecognizedColumns(headers, positionFallback);
  const requiredKeys = positionFallback.requiredKeys || options?.requiredKeys || [];
  if (!requiredKeys.every(key => Boolean(recognizedColumns[key]))) return null;

  const compatibilityCounts = Object.fromEntries(requiredKeys.map(key => [key, 0]));
  bodyRows.forEach(row => {
    requiredKeys.forEach(key => {
      const index = recognizedColumns[key]?.index;
      if (!Number.isInteger(index)) return;
      if (cellMatchesExpectedType(row[index], key, positionFallback, stats)) {
        compatibilityCounts[key] += 1;
      }
    });
  });

  const minimumCompatibleRows = Math.min(2, Math.max(bodyRows.length, 1));
  if (!requiredKeys.every(key => compatibilityCounts[key] >= minimumCompatibleRows)) {
    return null;
  }

  const compatibilityScore = Object.values(compatibilityCounts).reduce((sum, value) => sum + value, 0);

  return {
    table,
    headers,
    headerRowIndex: rowIndex,
    bodyRows,
    score: (Object.keys(recognizedColumns).length * 100) + (compatibilityScore * 10) - rowIndex,
    numericRows: compatibilityScore,
    recognizedColumns,
    duplicates: [],
    recognitionMode: 'position',
    recognitionDetails: buildFallbackRecognitionDetails(positionFallback)
  };
}

function buildTabularRecognitionError(expectedFormatLabel, positionFallback, availableNames = [], sourceLabel = 'arquivo') {
  const minColumns = positionFallback?.minColumns || 3;
  const isFallbackUsed = !!positionFallback;
  const message = isFallbackUsed
    ? (positionFallback.failureMessage || `O ${sourceLabel} foi lido, mas não conseguimos identificar as colunas automaticamente nem pela posição.`)
    : `O ${sourceLabel} foi lido, mas não encontramos colunas compatíveis com o modelo: ${expectedFormatLabel}.`;

  return {
    message,
    details: [
      `Use o modelo: ${expectedFormatLabel}.`,
      positionFallback ? (positionFallback.minimumColumnsText || `Esperavamos pelo menos ${minColumns} colunas uteis com cabecalho na primeira linha.`) : '',
      positionFallback?.consistencyText || '',
      availableNames.length ? `Abas/blocos lidos: ${availableNames.join(', ')}.` : ''
    ].filter(Boolean)
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
    throw new Error('Este navegador não consegue abrir arquivos XLSX sem suporte a DecompressionStream.');
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
      throw new Error('O arquivo XLSX usa um método de compressão não suportado.');
    }

    entries.set(fileName, contentBytes);
    offset += 46 + fileNameLength + extraLength + commentLength;
  }

  return entries;
}

function decodeEntryText(entries, path) {
  const bytes = entries.get(path);
  if (!bytes) return '';
  return normalizeTabularText(new TextDecoder('utf-8').decode(bytes));
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

        cells.set(index, normalizeTabularSpaces(rawValue));
        maxIndex = Math.max(maxIndex, index);
      });

      return Array.from({ length: maxIndex + 1 }, (_, index) => cells.get(index) || '');
    })
    .filter(row => row.some(cell => normalizeTabularSpaces(cell) !== ''));
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
      name: normalizeTabularSpaces(sheetNode.getAttribute('name')) || 'Planilha',
      rows: sheetText ? parseWorksheetRows(sheetText, sharedStrings) : []
    };
  });
}

export async function readWorkbookTablesFromFile(file, utils) {
  const fileName = normalizeTabularSpaces(file?.name || 'arquivo');
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

export function findBestTabularCandidate(tables, options, stats) {
  const {
    aliases = {},
    requiredKeys = [],
    numericKeys = [],
    positionFallback = null
  } = options || {};

  const aliasCandidates = (tables || []).map(table => {
    const rows = (table.rows || []).filter(row => row.some(cell => normalizeTabularSpaces(cell) !== ''));

    for (let rowIndex = 0; rowIndex < Math.min(rows.length, 20); rowIndex += 1) {
      const headers = rows[rowIndex].map(value => normalizeTabularSpaces(value));
      const headerMatch = matchTabularColumns(headers, aliases, requiredKeys);
      if (!headerMatch.requiredFound) continue;

      const bodyRows = rows
        .slice(rowIndex + 1)
        .filter(row => row.some(cell => normalizeTabularSpaces(cell) !== ''));

      const numericRows = bodyRows.filter(row => (
        numericKeys.some(key => {
          const columnIndex = headerMatch.recognizedColumns[key]?.index;
          return Number.isInteger(columnIndex) && parseTabularNumber(row[columnIndex], stats) !== null;
        })
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

  if (!positionFallback) return null;

  const positionalCandidates = (tables || []).map(table => {
    const rows = (table.rows || []).filter(row => row.some(cell => normalizeTabularSpaces(cell) !== ''));

    for (let rowIndex = 0; rowIndex < Math.min(rows.length, 20); rowIndex += 1) {
      const headers = rows[rowIndex].map(value => normalizeTabularSpaces(value));
      const bodyRows = rows
        .slice(rowIndex + 1)
        .filter(row => row.some(cell => normalizeTabularSpaces(cell) !== ''));

      const candidate = buildPositionalFallbackCandidate(table, rowIndex, headers, bodyRows, {
        aliases,
        requiredKeys,
        numericKeys,
        positionFallback
      }, stats);
      if (candidate) return candidate;
    }

    return null;
  }).filter(Boolean);

  if (!positionalCandidates.length) return null;
  positionalCandidates.sort((left, right) => right.score - left.score);
  return positionalCandidates[0];
}

function analyzeNumericFormatting(bodyRows, recognizedColumns, numericKeys, stats) {
  const indexes = (numericKeys || [])
    .map(key => recognizedColumns?.[key]?.index)
    .filter(Number.isInteger);

  let decimalCommaDetected = false;
  let numericCellCount = 0;

  (bodyRows || []).forEach(row => {
    indexes.forEach(index => {
      const raw = row?.[index] || '';
      if (parseTabularNumber(raw, stats) === null) return;
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

function buildLoadedTabularState(candidate, extra, numericKeys, stats) {
  const formatting = analyzeNumericFormatting(candidate.bodyRows, candidate.recognizedColumns, numericKeys, stats);

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

export async function readTabularFileState(file, utils, stats, options = {}) {
  const {
    aliases = {},
    requiredKeys = [],
    numericKeys = [],
    expectedFormatLabel = '',
    positionFallback = null
  } = options;
  const fileName = normalizeTabularSpaces(file?.name || 'arquivo');

  try {
    const workbook = await readWorkbookTablesFromFile(file, utils);
    const candidate = findBestTabularCandidate(workbook.tables, {
      aliases,
      requiredKeys,
      numericKeys,
      positionFallback
    }, stats);
    const availableNames = workbook.tables.map(table => table.name).filter(Boolean);

    if (!candidate) {
      const errorInfo = buildTabularRecognitionError(expectedFormatLabel, positionFallback, availableNames, 'arquivo');
      return {
        status: 'error',
        fileName,
        message: errorInfo.message,
        details: errorInfo.details
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
    }, numericKeys, stats);
  } catch (error) {
    return {
      status: 'error',
      fileName,
      message: error?.message || 'Nao foi possivel ler o arquivo enviado.',
      details: [`Use o modelo: ${expectedFormatLabel}.`]
    };
  }
}

export function readTabularPasteState(text, stats, options = {}) {
  const {
    aliases = {},
    requiredKeys = [],
    numericKeys = [],
    expectedFormatLabel = '',
    positionFallback = null
  } = options;
  const parsed = parseDelimitedRows(text);
  const candidate = findBestTabularCandidate([{
    name: 'Conteudo colado',
    rows: parsed.rows,
    delimiter: parsed.delimiter,
    formatLabel: parsed.formatLabel
  }], {
    aliases,
    requiredKeys,
    numericKeys,
    positionFallback
  }, stats);

  if (!candidate) {
    const errorInfo = buildTabularRecognitionError(expectedFormatLabel, positionFallback, [], 'conteudo colado');
    return {
      status: 'error',
      fileName: 'dados-colados',
      message: errorInfo.message,
      details: [
        ...errorInfo.details,
        'Cole a tabela com cabecalho no formato esperado ou use um arquivo CSV/XLSX/TXT compativel.'
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
  }, numericKeys, stats);
}
