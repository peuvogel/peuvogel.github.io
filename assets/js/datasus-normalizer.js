import {
  cleanDatasusCategoryLabel,
  isMissingToken,
  isTimeLikeToken,
  isTotalLikeToken,
  normalizeDatasusLabel,
  normalizeDatasusToken,
  parseDatasusNumber
} from './datasus-importer.js';

function buildUniqueKey(label, usedKeys) {
  const base = normalizeDatasusToken(label)
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'value';

  let key = base;
  let cursor = 2;
  while (usedKeys.has(key)) {
    key = `${base}_${cursor}`;
    cursor += 1;
  }
  usedKeys.add(key);
  return key;
}

function roleColumns(mapping, role) {
  return (mapping?.columns || []).filter(column => column.role === role);
}

function getPrimaryCategoryColumn(mapping) {
  return (mapping?.columns || []).find(column => column.role === 'primary-category')
    || (mapping?.columns || []).find(column => column.role === 'category')
    || null;
}

function collectCategoryColumns(mapping) {
  return (mapping?.columns || []).filter(column => column.role === 'primary-category' || column.role === 'category');
}

function collectTimeColumns(mapping) {
  return roleColumns(mapping, 'time');
}

function collectMeasureColumns(mapping) {
  return roleColumns(mapping, 'measure');
}

function collectTotalColumns(mapping) {
  return roleColumns(mapping, 'total');
}

function metricOptionList(parsed, mapping) {
  const usedKeys = new Set();
  const formatType = mapping?.formatType || parsed?.diagnosis?.formatType || 'hybrid';
  const timeColumns = collectTimeColumns(mapping);
  const measureColumns = collectMeasureColumns(mapping);
  const options = [];

  if ((formatType === 'wide' || (formatType === 'hybrid' && timeColumns.length >= 2)) && timeColumns.length) {
    const primaryLabel = parsed?.diagnosis?.measureLabels?.[0]
      || parsed?.diagnosis?.metadataLines?.find(Boolean)
      || 'Valor';
    options.push({
      key: buildUniqueKey(primaryLabel, usedKeys),
      label: primaryLabel,
      primary: true
    });
  }

  measureColumns.forEach((column, index) => {
    options.push({
      key: buildUniqueKey(column.header || `Medida ${index + 1}`, usedKeys),
      label: column.header || `Medida ${index + 1}`,
      primary: !options.length && index === 0
    });
  });

  if (!options.length) {
    options.push({
      key: buildUniqueKey('Valor', usedKeys),
      label: 'Valor',
      primary: true
    });
  }

  return options.map((option, index) => ({
    ...option,
    primary: index === 0
  }));
}

function sortTimeValues(values) {
  const unique = [...new Set(values.filter(Boolean))];
  return unique.sort((left, right) => {
    const a = coerceTimeKey(left);
    const b = coerceTimeKey(right);
    if (a.numeric !== null && b.numeric !== null) return a.numeric - b.numeric;
    return String(left).localeCompare(String(right), 'pt-BR');
  });
}

function coerceTimeKey(rawTime) {
  const label = normalizeDatasusLabel(rawTime);
  if (!label) {
    return { label, numeric: null };
  }

  const normalized = normalizeDatasusToken(label);
  if (/^(18|19|20)\d{2}$/.test(normalized)) {
    return { label, numeric: Number(normalized) };
  }

  let match = normalized.match(/^((18|19|20)\d{2})[-/](0?[1-9]|1[0-2])$/);
  if (match) {
    return { label, numeric: Number(match[1]) + ((Number(match[3]) - 1) / 12) };
  }

  match = normalized.match(/^(0?[1-9]|1[0-2])[-/]((18|19|20)\d{2})$/);
  if (match) {
    return { label, numeric: Number(match[2]) + ((Number(match[1]) - 1) / 12) };
  }

  return { label, numeric: null };
}

function categoryLabelForRow(row, categoryColumns, utils) {
  const parts = categoryColumns
    .map(column => cleanDatasusCategoryLabel(row.cleanCells[column.index], utils))
    .filter(Boolean);

  return parts[0] || row.cleanCells.find(Boolean) || `Linha ${row.lineIndex + 1}`;
}

function extraDimensionsForRow(row, mapping, primaryCategoryColumn) {
  const extras = {};
  (mapping?.columns || []).forEach(column => {
    if (column.index === primaryCategoryColumn?.index) return;
    if (column.role === 'category') {
      extras[column.header || `Coluna ${column.index + 1}`] = row.cleanCells[column.index] || '';
    }
  });
  return extras;
}

function aggregateValuesForRow(row, totalColumns, stats) {
  return totalColumns.reduce((accumulator, column) => {
    accumulator[column.header || `Coluna ${column.index + 1}`] = parseDatasusNumber(row.cleanCells[column.index], stats);
    return accumulator;
  }, {});
}

function buildWideRecords(source, parsed, mapping, utils, stats) {
  const categoryColumns = collectCategoryColumns(mapping);
  const primaryCategoryColumn = getPrimaryCategoryColumn(mapping);
  const timeColumns = collectTimeColumns(mapping);
  const measureColumns = collectMeasureColumns(mapping);
  const totalColumns = collectTotalColumns(mapping);
  const metricOptions = metricOptionList(parsed, mapping);
  const primaryMetric = metricOptions[0];
  const extraMetricColumns = measureColumns.map((column, index) => ({
    column,
    option: metricOptions[index + 1] || null
  })).filter(item => item.option);

  const records = [];

  parsed.bodyRows.forEach((row, rowOffset) => {
    const category = categoryLabelForRow(row, categoryColumns, utils);
    const categoryKey = normalizeDatasusToken(category);
    const extraDimensions = extraDimensionsForRow(row, mapping, primaryCategoryColumn);
    const aggregateValues = aggregateValuesForRow(row, totalColumns, stats);
    const rowIsTotal = isTotalLikeToken(category, utils);

    timeColumns.forEach(timeColumn => {
      const rawTime = parsed.headers[timeColumn.index] || timeColumn.header || `Tempo ${timeColumn.index + 1}`;
      const time = normalizeDatasusLabel(rawTime);
      const value = parseDatasusNumber(row.cleanCells[timeColumn.index], stats);
      const metricValues = {
        [primaryMetric.key]: value
      };

      extraMetricColumns.forEach(item => {
        metricValues[item.option.key] = parseDatasusNumber(row.cleanCells[item.column.index], stats);
      });

      records.push({
        id: `${source.id}-record-${records.length + 1}`,
        sourceId: source.id,
        sourceFile: source.fileName,
        category,
        categoryKey,
        rawCategory: row.cleanCells[primaryCategoryColumn?.index ?? 0] || category,
        time,
        timeKey: normalizeDatasusToken(time),
        rawTime,
        metricValues,
        primaryMetricKey: primaryMetric.key,
        value,
        extraDimensions,
        aggregateValues,
        isTotal: rowIsTotal || Object.values(extraDimensions).some(valueItem => isTotalLikeToken(valueItem, utils)),
        isMissing: value === null,
        rawLineIndex: row.lineIndex,
        rawCells: row.cleanCells
      });
    });
  });

  return {
    records,
    metricOptions
  };
}

function buildLongRecords(source, parsed, mapping, utils, stats) {
  const categoryColumns = collectCategoryColumns(mapping);
  const primaryCategoryColumn = getPrimaryCategoryColumn(mapping);
  const timeColumns = collectTimeColumns(mapping);
  const measureColumns = collectMeasureColumns(mapping);
  const totalColumns = collectTotalColumns(mapping);
  const metricOptions = metricOptionList(parsed, mapping);
  const metricColumns = measureColumns.length
    ? measureColumns.map((column, index) => ({
        column,
        option: metricOptions[index] || metricOptions[0]
      }))
    : [{
        column: null,
        option: metricOptions[0]
      }];

  const records = parsed.bodyRows.map((row, rowOffset) => {
    const category = categoryLabelForRow(row, categoryColumns, utils);
    const categoryKey = normalizeDatasusToken(category);
    const rawTime = timeColumns[0] ? row.cleanCells[timeColumns[0].index] : '';
    const time = normalizeDatasusLabel(rawTime);
    const metricValues = {};

    metricColumns.forEach(item => {
      if (!item.column) {
        metricValues[item.option.key] = parseDatasusNumber(row.cleanCells.find(cell => parseDatasusNumber(cell, stats) !== null), stats);
        return;
      }
      metricValues[item.option.key] = parseDatasusNumber(row.cleanCells[item.column.index], stats);
    });

    const primaryMetricKey = metricOptions[0].key;
    const value = metricValues[primaryMetricKey] ?? null;

    return {
      id: `${source.id}-record-${rowOffset + 1}`,
      sourceId: source.id,
      sourceFile: source.fileName,
      category,
      categoryKey,
      rawCategory: row.cleanCells[primaryCategoryColumn?.index ?? 0] || category,
      time,
      timeKey: normalizeDatasusToken(time),
      rawTime,
      metricValues,
      primaryMetricKey,
      value,
      extraDimensions: extraDimensionsForRow(row, mapping, primaryCategoryColumn),
      aggregateValues: aggregateValuesForRow(row, totalColumns, stats),
      isTotal: isTotalLikeToken(category, utils),
      isMissing: Object.values(metricValues).every(metricValue => metricValue === null),
      rawLineIndex: row.lineIndex,
      rawCells: row.cleanCells
    };
  });

  return {
    records,
    metricOptions
  };
}

function buildSchema(parsed, mapping, metricOptions, records) {
  const primaryCategoryColumn = getPrimaryCategoryColumn(mapping);
  const timeColumns = collectTimeColumns(mapping);
  const categories = [...new Map(records.map(record => [record.categoryKey, record.category])).values()];
  const times = sortTimeValues(records.map(record => record.time));

  return {
    formatType: mapping?.formatType || parsed?.diagnosis?.formatType || 'hybrid',
    categoryLabel: primaryCategoryColumn?.header || parsed?.diagnosis?.primaryCategoryLabel || 'Categoria',
    timeLabel: timeColumns[0]?.header || (times.length ? 'Tempo' : ''),
    hasTime: Boolean(times.length),
    metricOptions,
    primaryMetricKey: metricOptions[0]?.key || 'value',
    categories,
    times,
    hasTotalRecords: records.some(record => record.isTotal)
  };
}

function buildSummary(records, schema) {
  const validCount = records.filter(record => {
    const value = record.metricValues[schema.primaryMetricKey];
    return value !== null && Number.isFinite(value);
  }).length;

  return {
    recordCount: records.length,
    validRecordCount: validCount,
    missingRecordCount: records.length - validCount,
    categoryCount: schema.categories.length,
    timeCount: schema.times.length
  };
}

export function normalizeDatasusSource(source, utils, stats) {
  if (!source?.parsed || !source?.mapping) {
    return {
      ok: false,
      errors: ['Nao ha base mapeada para normalizar.'],
      records: [],
      schema: {
        metricOptions: [],
        primaryMetricKey: 'value',
        categories: [],
        times: []
      },
      summary: {
        recordCount: 0,
        validRecordCount: 0,
        missingRecordCount: 0,
        categoryCount: 0,
        timeCount: 0
      }
    };
  }

  const parsed = source.parsed;
  const mapping = source.mapping;
  const timeColumns = collectTimeColumns(mapping);
  const useWideStrategy = mapping.formatType === 'wide' || (mapping.formatType === 'hybrid' && timeColumns.length >= 2);
  const normalized = useWideStrategy
    ? buildWideRecords(source, parsed, mapping, utils, stats)
    : buildLongRecords(source, parsed, mapping, utils, stats);
  const schema = buildSchema(parsed, mapping, normalized.metricOptions, normalized.records);
  const summary = buildSummary(normalized.records, schema);
  const errors = [];

  if (!schema.categories.length) {
    errors.push('Nenhuma categoria principal foi identificada na base normalizada.');
  }

  if (!schema.metricOptions.length) {
    errors.push('Nenhuma medida quantitativa foi identificada na base normalizada.');
  }

  return {
    ok: errors.length === 0,
    errors,
    records: normalized.records,
    schema,
    summary,
    previewRows: normalized.records.slice(0, 20).map(record => ({
      category: record.category,
      time: record.time,
      value: record.metricValues[schema.primaryMetricKey],
      isTotal: record.isTotal,
      extraDimensions: record.extraDimensions
    }))
  };
}

export function getMetricOptions(source) {
  return source?.normalized?.schema?.metricOptions || [];
}

export function getPrimaryMetricKey(source) {
  return source?.normalized?.schema?.primaryMetricKey || getMetricOptions(source)[0]?.key || 'value';
}

export function getMetricLabel(source, metricKey) {
  return getMetricOptions(source).find(option => option.key === metricKey)?.label || metricKey || 'Valor';
}

export function getCategoryOptions(source, includeTotal = false) {
  const seen = new Map();
  (source?.normalized?.records || []).forEach(record => {
    if (!includeTotal && record.isTotal) return;
    if (!seen.has(record.categoryKey)) {
      seen.set(record.categoryKey, {
        key: record.categoryKey,
        label: record.category,
        isTotal: record.isTotal
      });
    }
  });
  return [...seen.values()].sort((left, right) => left.label.localeCompare(right.label, 'pt-BR'));
}

export function getTimeOptions(source) {
  return sortTimeValues((source?.normalized?.records || []).map(record => record.time))
    .map(value => ({
      key: normalizeDatasusToken(value),
      label: value
    }))
    .filter(option => option.label);
}

function isRecordSelected(record, { categoryKeys, timeKeys, includeTotal }) {
  if (!includeTotal && record.isTotal) return false;
  if (categoryKeys?.length && !categoryKeys.includes(record.categoryKey)) return false;
  if (timeKeys?.length && !timeKeys.includes(record.timeKey)) return false;
  return true;
}

export function filterSourceRecords(source, {
  metricKey = getPrimaryMetricKey(source),
  categoryKeys = [],
  timeKeys = [],
  includeTotal = false
} = {}) {
  return (source?.normalized?.records || [])
    .filter(record => isRecordSelected(record, { categoryKeys, timeKeys, includeTotal }))
    .map(record => ({
      ...record,
      metricValue: record.metricValues[metricKey] ?? null
    }));
}

function summarizePerCategory(source, {
  metricKey = getPrimaryMetricKey(source),
  categoryKeys = [],
  timeKeys = [],
  includeTotal = false,
  stats
}) {
  const buckets = new Map();
  filterSourceRecords(source, { metricKey, categoryKeys, timeKeys, includeTotal }).forEach(record => {
    if (record.metricValue === null || !Number.isFinite(record.metricValue)) return;
    const key = record.categoryKey || record.category;
    if (!buckets.has(key)) {
      buckets.set(key, {
        rowKey: key,
        rowLabel: record.category,
        values: [],
        validTimes: new Set(),
        rawCount: 0
      });
    }
    const bucket = buckets.get(key);
    bucket.values.push(record.metricValue);
    if (record.time) bucket.validTimes.add(record.time);
    bucket.rawCount += 1;
  });

  return [...buckets.values()].map(bucket => ({
    rowKey: bucket.rowKey,
    rowLabel: bucket.rowLabel,
    value: stats.mean(bucket.values),
    rawCount: bucket.rawCount,
    validTimes: sortTimeValues([...bucket.validTimes])
  }));
}

function periodLabelFromKeys(source, timeKeys) {
  const options = getTimeOptions(source);
  if (!timeKeys?.length) {
    if (!options.length) return 'sem recorte temporal';
    if (options.length === 1) return options[0].label;
    return `${options[0].label} a ${options[options.length - 1].label}`;
  }

  const labels = options.filter(option => timeKeys.includes(option.key)).map(option => option.label);
  if (!labels.length) return 'sem período válido';
  if (labels.length === 1) return labels[0];
  return `${labels[0]} a ${labels[labels.length - 1]}`;
}

export function findBestNormalizedPair(sources) {
  if (!Array.isArray(sources) || sources.length < 2) return null;

  let best = null;
  for (let leftIndex = 0; leftIndex < sources.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < sources.length; rightIndex += 1) {
      const leftSource = sources[leftIndex];
      const rightSource = sources[rightIndex];
      const leftCategories = new Set(getCategoryOptions(leftSource, false).map(option => option.key));
      const rightCategories = new Set(getCategoryOptions(rightSource, false).map(option => option.key));
      const sharedCategories = [...leftCategories].filter(key => rightCategories.has(key));
      const leftTimes = new Set(getTimeOptions(leftSource).map(option => option.key));
      const rightTimes = new Set(getTimeOptions(rightSource).map(option => option.key));
      const sharedTimes = [...leftTimes].filter(key => rightTimes.has(key));
      const score = (sharedCategories.length * 3) + sharedTimes.length;

      if (!best || score > best.score) {
        best = {
          leftId: leftSource.id,
          rightId: rightSource.id,
          sharedCategoryCount: sharedCategories.length,
          sharedTimeCount: sharedTimes.length,
          sharedCategories,
          sharedTimes,
          score
        };
      }
    }
  }

  return best;
}

export function deriveIndependentTTest({
  source,
  metricKey = getPrimaryMetricKey(source),
  groupAKeys = [],
  groupBKeys = [],
  timeKeys = [],
  includeTotal = false,
  stats
}) {
  const rowsA = summarizePerCategory(source, {
    metricKey,
    categoryKeys: groupAKeys,
    timeKeys,
    includeTotal,
    stats
  }).map(row => ({
    ...row,
    groupKey: 'A',
    groupLabel: 'Grupo A'
  }));
  const rowsB = summarizePerCategory(source, {
    metricKey,
    categoryKeys: groupBKeys,
    timeKeys,
    includeTotal,
    stats
  }).map(row => ({
    ...row,
    groupKey: 'B',
    groupLabel: 'Grupo B'
  }));

  const derivedRows = [...rowsA, ...rowsB];
  const vectors = {
    A: rowsA.map(row => row.value),
    B: rowsB.map(row => row.value)
  };
  const errors = [];

  if (groupAKeys.length < 2 || vectors.A.length < 2) {
    errors.push('Selecione pelo menos 2 observacoes validas em cada grupo.');
  }
  if (groupBKeys.length < 2 || vectors.B.length < 2) {
    errors.push('Selecione pelo menos 2 observacoes validas em cada grupo.');
  }
  if (!derivedRows.length) {
    errors.push('Nao ha dados suficientes para comparacao.');
  }

  return {
    ok: errors.length === 0,
    mode: 'independent',
    errors,
    primaryError: errors[0] || '',
    metricKey,
    metricLabel: getMetricLabel(source, metricKey),
    periodLabel: periodLabelFromKeys(source, timeKeys),
    selectedTimes: getTimeOptions(source).filter(option => timeKeys.includes(option.key)).map(option => option.label),
    groupLabels: ['Grupo A', 'Grupo B'],
    groupAItems: rowsA.map(row => row.rowLabel),
    groupBItems: rowsB.map(row => row.rowLabel),
    derivedRows,
    vectors,
    selectionCounts: { A: groupAKeys.length, B: groupBKeys.length },
    validCounts: { A: vectors.A.length, B: vectors.B.length },
    explanation: 'Comparacao entre grupos independentes definidos pelo usuario.'
  };
}

export function derivePairedTTest({
  leftSource,
  rightSource,
  leftMetricKey = getPrimaryMetricKey(leftSource),
  rightMetricKey = getPrimaryMetricKey(rightSource),
  timeKeys = [],
  includeTotal = false,
  stats
}) {
  const leftRows = summarizePerCategory(leftSource, {
    metricKey: leftMetricKey,
    categoryKeys: [],
    timeKeys,
    includeTotal,
    stats
  });
  const rightRows = summarizePerCategory(rightSource, {
    metricKey: rightMetricKey,
    categoryKeys: [],
    timeKeys,
    includeTotal,
    stats
  });
  const rightMap = new Map(rightRows.map(row => [row.rowKey, row]));
  const derivedRows = [];
  const omittedRows = [];

  leftRows.forEach(leftRow => {
    const rightRow = rightMap.get(leftRow.rowKey);
    if (!rightRow) {
      omittedRows.push({
        rowLabel: leftRow.rowLabel,
        reason: 'Sem correspondente no segundo procedimento.'
      });
      return;
    }

    derivedRows.push({
      rowKey: leftRow.rowKey,
      rowLabel: leftRow.rowLabel,
      valueA: leftRow.value,
      valueB: rightRow.value,
      diff: leftRow.value - rightRow.value,
      validTimes: sortTimeValues([...leftRow.validTimes, ...rightRow.validTimes])
    });
  });

  const vectors = {
    A: derivedRows.map(row => row.valueA),
    B: derivedRows.map(row => row.valueB)
  };
  const errors = [];

  if (derivedRows.length < 2) {
    errors.push('Nao ha dados suficientes para comparacao pareada.');
  }

  return {
    ok: errors.length === 0,
    mode: 'paired',
    errors,
    primaryError: errors[0] || '',
    metricLabels: [getMetricLabel(leftSource, leftMetricKey), getMetricLabel(rightSource, rightMetricKey)],
    groupLabels: [leftSource.fileName, rightSource.fileName],
    periodLabel: periodLabelFromKeys(leftSource, timeKeys),
    selectedTimes: getTimeOptions(leftSource).filter(option => timeKeys.includes(option.key)).map(option => option.label),
    derivedRows,
    omittedRows,
    vectors,
    validCounts: { pairs: derivedRows.length },
    selectionCounts: { A: leftRows.length, B: rightRows.length },
    explanation: 'Comparacao pareada: cada unidade contribui com dois valores.'
  };
}

function sameSourceCorrelation({
  source,
  xMetricKey,
  yMetricKey,
  categoryKeys = [],
  timeKeys = [],
  includeTotal = false
}) {
  const pairs = filterSourceRecords(source, {
    metricKey: xMetricKey,
    categoryKeys,
    timeKeys,
    includeTotal
  }).filter(record => {
    const x = record.metricValues[xMetricKey];
    const y = record.metricValues[yMetricKey];
    return Number.isFinite(x) && Number.isFinite(y);
  }).map(record => ({
    label: record.time ? `${record.category} | ${record.time}` : record.category,
    x: record.metricValues[xMetricKey],
    y: record.metricValues[yMetricKey],
    category: record.category,
    time: record.time
  }));

  return pairs;
}

function summarizeForAlignment(source, metricKey, {
  categoryKeys = [],
  timeKeys = [],
  includeTotal = false,
  stats
}) {
  const buckets = new Map();
  filterSourceRecords(source, { metricKey, categoryKeys, timeKeys, includeTotal }).forEach(record => {
    if (!Number.isFinite(record.metricValue)) return;
    const key = record.time ? `${record.categoryKey}|${record.timeKey}` : record.categoryKey;
    if (!buckets.has(key)) {
      buckets.set(key, {
        key,
        label: record.time ? `${record.category} | ${record.time}` : record.category,
        values: [],
        category: record.category,
        time: record.time
      });
    }
    buckets.get(key).values.push(record.metricValue);
  });

  return new Map([...buckets.entries()].map(([key, bucket]) => [key, {
    ...bucket,
    value: stats.mean(bucket.values)
  }]));
}

export function deriveCorrelationPairs({
  xSource,
  ySource,
  xMetricKey = getPrimaryMetricKey(xSource),
  yMetricKey = getPrimaryMetricKey(ySource),
  categoryKeys = [],
  timeKeys = [],
  includeTotal = false,
  stats
}) {
  const sameSource = xSource?.id === ySource?.id;
  const pairs = sameSource
    ? sameSourceCorrelation({
        source: xSource,
        xMetricKey,
        yMetricKey,
        categoryKeys,
        timeKeys,
        includeTotal
      })
    : (() => {
        const leftMap = summarizeForAlignment(xSource, xMetricKey, {
          categoryKeys,
          timeKeys,
          includeTotal,
          stats
        });
        const rightMap = summarizeForAlignment(ySource, yMetricKey, {
          categoryKeys,
          timeKeys,
          includeTotal,
          stats
        });

        return [...leftMap.entries()].reduce((accumulator, [key, leftRow]) => {
          const rightRow = rightMap.get(key);
          if (!rightRow) return accumulator;
          accumulator.push({
            label: leftRow.label,
            x: leftRow.value,
            y: rightRow.value,
            category: leftRow.category,
            time: leftRow.time
          });
          return accumulator;
        }, []);
      })();

  const errors = [];
    if (pairs.length < 3) {
      errors.push('Selecione pelo menos 3 pares válidos para calcular correlação.');
    }

  return {
    ok: errors.length === 0,
    errors,
    primaryError: errors[0] || '',
    pairs,
    xLabel: sameSource
      ? getMetricLabel(xSource, xMetricKey)
      : `${xSource?.fileName || 'Fonte X'} - ${getMetricLabel(xSource, xMetricKey)}`,
    yLabel: sameSource
      ? getMetricLabel(ySource, yMetricKey)
      : `${ySource?.fileName || 'Fonte Y'} - ${getMetricLabel(ySource, yMetricKey)}`
  };
}

export function derivePraisSeries({
  source,
  metricKey = getPrimaryMetricKey(source),
  categoryKey = '',
  includeTotal = false,
  stats
}) {
  const buckets = new Map();
  filterSourceRecords(source, {
    metricKey,
    categoryKeys: categoryKey ? [categoryKey] : [],
    timeKeys: [],
    includeTotal
  }).forEach(record => {
    if (!record.time || !Number.isFinite(record.metricValue)) return;
    const key = record.timeKey || normalizeDatasusToken(record.time);
    if (!buckets.has(key)) {
      const timeInfo = coerceTimeKey(record.time);
      buckets.set(key, {
        timeLabel: record.time,
        timeNumeric: timeInfo.numeric,
        values: []
      });
    }
    buckets.get(key).values.push(record.metricValue);
  });

  const ordered = [...buckets.values()]
    .map((bucket, index) => ({
      timeLabel: bucket.timeLabel,
      timeNumeric: bucket.timeNumeric,
      value: stats.mean(bucket.values),
      order: index + 1
    }))
    .sort((left, right) => {
      if (left.timeNumeric !== null && right.timeNumeric !== null) {
        return left.timeNumeric - right.timeNumeric;
      }
      return left.timeLabel.localeCompare(right.timeLabel, 'pt-BR');
    })
    .map((item, index) => ({
      ...item,
      time: item.timeNumeric !== null ? item.timeNumeric : index + 1
    }));

  const errors = [];
  if (ordered.length < 5) {
    errors.push('Selecione pelo menos 5 pontos temporais válidos.');
  }

  return {
    ok: errors.length === 0,
    errors,
    primaryError: errors[0] || '',
    rows: ordered,
    metricLabel: getMetricLabel(source, metricKey),
    categoryLabel: getCategoryOptions(source, true).find(option => option.key === categoryKey)?.label || ''
  };
}

export function suggestTestsForSources(sources) {
  if (!Array.isArray(sources) || !sources.length) return [];

  const suggestions = [];
  const bestPair = findBestNormalizedPair(sources);
  if (bestPair && bestPair.sharedCategoryCount >= 2) {
    suggestions.push('Duas bases com unidades em comum foram detectadas; isso favorece t pareado.');
  }

  sources.forEach(source => {
    const metricCount = getMetricOptions(source).length;
    const categoryCount = getCategoryOptions(source, false).length;
    const timeCount = getTimeOptions(source).length;

    if (source.mapping.columns.filter(c => c.role === 'measure').length >= 2) {
      suggestions.push(`A base ${source.fileName} possui pelo menos duas variáveis quantitativas; correlação é uma boa candidata.`);
    }
    if (categoryCount === 2) {
      suggestions.push(`A base ${source.fileName} possui duas categorias principais; t de Student pode ser apropriado.`);
    }
    if (categoryCount >= 3) {
      suggestions.push(`A base ${source.fileName} possui 3 ou mais grupos; ANOVA pode ser considerada como próximo passo.`);
    }
    if (timeCount >= 5) {
      suggestions.push(`A base ${source.fileName} possui serie temporal suficiente para Prais-Winsten.`);
    }
  });

  return [...new Set(suggestions)];
}
