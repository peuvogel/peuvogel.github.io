/**
 * chart-manager.js — Shared Chart.js factory for LACIR modules
 * Provides interactive charts (scatter, timeseries, residual) with
 * built-in PNG export and tooltips.
 */
import {
  Chart,
  ScatterController,
  LineController,
  BarController,
  LinearScale,
  CategoryScale,
  PointElement,
  LineElement,
  BarElement,
  Legend,
  Tooltip,
  Filler
} from 'chart.js';

Chart.register(
  ScatterController,
  LineController,
  BarController,
  LinearScale,
  CategoryScale,
  PointElement,
  LineElement,
  BarElement,
  Legend,
  Tooltip,
  Filler
);

/** Palette matching LACIR dark theme */
const COLORS = {
  primary: '#22c55e',
  primaryLight: 'rgba(34,197,94,0.18)',
  blue: '#3b82f6',
  blueLight: 'rgba(59,130,246,0.15)',
  teal: '#14b8a6',
  tealLight: 'rgba(20,184,166,0.15)',
  warning: '#f59e0b',
  danger: '#ef4444',
  dangerLight: 'rgba(239,68,68,0.18)',
  grid: 'rgba(255,255,255,0.07)',
  tick: 'rgba(255,255,255,0.45)',
  label: 'rgba(255,255,255,0.65)',
  background: '#0f1117'
};

const BASE_OPTS = {
  responsive: true,
  maintainAspectRatio: false,
  animation: { duration: 600, easing: 'easeOutQuart' },
  plugins: {
    legend: {
      labels: {
        color: COLORS.label,
        font: { family: "'Inter', sans-serif", size: 12 },
        boxWidth: 14,
        padding: 16
      }
    },
    tooltip: {
      backgroundColor: 'rgba(15,17,23,0.95)',
      borderColor: 'rgba(34,197,94,0.35)',
      borderWidth: 1,
      titleColor: COLORS.primary,
      bodyColor: '#e5e7eb',
      padding: 12,
      cornerRadius: 8,
      titleFont: { family: "'Inter', sans-serif", weight: '600', size: 12 },
      bodyFont: { family: "'Inter', sans-serif", size: 12 }
    }
  },
  scales: {
    x: {
      ticks: { color: COLORS.tick, font: { size: 11 } },
      grid: { color: COLORS.grid },
      border: { color: 'rgba(255,255,255,0.1)' }
    },
    y: {
      ticks: { color: COLORS.tick, font: { size: 11 } },
      grid: { color: COLORS.grid, drawBorder: false },
      border: { color: 'rgba(255,255,255,0.1)' }
    }
  }
};

/** Keeps a registry of Chart instances to destroy before re-creation */
const registry = new Map();

function destroyChart(id) {
  const existing = registry.get(id);
  if (existing) {
    existing.destroy();
    registry.delete(id);
  }
}

function register(id, instance) {
  registry.set(id, instance);
  return instance;
}

/**
 * Build the chart container HTML and export button.
 * @param {string} canvasId
 * @param {string} title
 * @param {string} subtitle
 * @param {string} exportName
 * @returns {string} HTML string
 */
export function buildChartContainer(canvasId, title, subtitle, exportName) {
  return `
    <article class="chart-card">
      <div class="chart-card-header">
        <div>
          <h4 style="margin:0 0 4px;">${title}</h4>
          ${subtitle ? `<p style="margin:0;opacity:.65;font-size:.85rem;">${subtitle}</p>` : ''}
        </div>
      </div>
      <div class="chart-wrap" style="position:relative;min-height:360px;">
        <canvas id="${canvasId}"></canvas>
      </div>
      <button type="button" class="btn-ghost lacir-export-canvas" data-canvas-id="${canvasId}" data-export="${exportName}" style="position:absolute; bottom:16px; right:16px; display:flex; align-items:center; gap:6px; padding:8px 12px; font-size:0.85rem;">
        <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
        Salvar
      </button>
    </article>
  `;
}

/**
 * Export canvas by id to PNG download.
 */
export function exportCanvas(canvasId, filename = 'grafico-lacirstat.png') {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const a = document.createElement('a');
  a.href = canvas.toDataURL('image/png', 1.0);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// ─── Scatter plot (Correlação — Pearson / manual) ──────────────────────────
/**
 * @param {string} canvasId - <canvas> element id
 * @param {{x:number[], y:number[], labels:string[], headers:string[]}} dataset
 * @param {{coef:number, intercept:number, slope:number, p:number}} pearson
 * @param {boolean[]} outlierFlags
 * @param {object} utils
 */
export function renderScatterChart(canvasId, dataset, pearson, outlierFlags, utils) {
  destroyChart(canvasId);
  const canvas = document.getElementById(canvasId);
  if (!canvas) return null;

  const n = dataset.x.length;
  const minX = Math.min(...dataset.x);
  const maxX = Math.max(...dataset.x);
  const xPad = (maxX - minX || 1) * 0.1;

  // Regression line endpoints
  const rxMin = minX - xPad;
  const rxMax = maxX + xPad;
  const ryMin = pearson.intercept + pearson.slope * rxMin;
  const ryMax = pearson.intercept + pearson.slope * rxMax;

  const points = dataset.x.map((x, i) => ({
    x,
    y: dataset.y[i],
    label: dataset.labels?.[i] || `Ponto ${i + 1}`,
    isOutlier: outlierFlags?.[i] || false
  }));

  const normal = points.filter(p => !p.isOutlier);
  const outliers = points.filter(p => p.isOutlier);

  const chart = new Chart(canvas, {
    type: 'scatter',
    data: {
      datasets: [
        {
          label: 'Linha de regressão',
          data: [{ x: rxMin, y: ryMin }, { x: rxMax, y: ryMax }],
          type: 'line',
          borderColor: COLORS.primary,
          borderWidth: 2.5,
          borderDash: [],
          pointRadius: 0,
          fill: false,
          tension: 0,
          order: 0
        },
        {
          label: dataset.headers?.[0] && dataset.headers?.[1]
            ? `${dataset.headers[0]} × ${dataset.headers[1]}`
            : 'Pontos',
          data: normal.map(p => ({ x: p.x, y: p.y, label: p.label })),
          backgroundColor: COLORS.blueLight,
          borderColor: COLORS.blue,
          borderWidth: 2,
          pointRadius: 6,
          pointHoverRadius: 9,
          order: 1
        },
        outliers.length ? {
          label: 'Possíveis outliers',
          data: outliers.map(p => ({ x: p.x, y: p.y, label: p.label })),
          backgroundColor: COLORS.dangerLight,
          borderColor: COLORS.danger,
          borderWidth: 2,
          pointRadius: 7,
          pointHoverRadius: 10,
          order: 2
        } : null
      ].filter(Boolean)
    },
    options: {
      ...BASE_OPTS,
      plugins: {
        ...BASE_OPTS.plugins,
        tooltip: {
          ...BASE_OPTS.plugins.tooltip,
          callbacks: {
            title: items => '',
            label: item => {
              const raw = item.raw;
              if (raw.label) return `${raw.label}  (${utils.fmtNumber(raw.x, 2)}, ${utils.fmtNumber(raw.y, 2)})`;
              return `(${utils.fmtNumber(raw.x, 2)}, ${utils.fmtNumber(raw.y, 2)})`;
            }
          }
        }
      },
      scales: {
        x: {
          ...BASE_OPTS.scales.x,
          title: {
            display: true,
            text: dataset.headers?.[0] || 'X',
            color: COLORS.label,
            font: { size: 12 }
          }
        },
        y: {
          ...BASE_OPTS.scales.y,
          title: {
            display: true,
            text: dataset.headers?.[1] || 'Y',
            color: COLORS.label,
            font: { size: 12 }
          }
        }
      }
    }
  });

  return register(canvasId, chart);
}

// ─── Rank scatter (Spearman) ────────────────────────────────────────────────
export function renderRankScatterChart(canvasId, dataset, spearman, diagnostics, utils) {
  destroyChart(canvasId);
  const canvas = document.getElementById(canvasId);
  if (!canvas) return null;

  const n = dataset.x.length;
  const highlighted = new Set(
    (diagnostics.topRankRows || []).slice(0, 4).map(r => r.index)
  );

  const rankX = [...dataset.x].map((_, i) => i + 1);
  const sortedByX = [...dataset.x.map((v, i) => ({ x: v, y: dataset.y[i], rx: 0, ry: 0, label: dataset.labels?.[i] || `${i + 1}`, idx: i }))]
    .sort((a, b) => a.x - b.x);
  sortedByX.forEach((p, ri) => { p.rx = ri + 1; });
  const sortedByY = [...sortedByX].sort((a, b) => a.y - b.y);
  sortedByY.forEach((p, ri) => { p.ry = ri + 1; });
  const points = sortedByX;

  const normal = points.filter(p => !highlighted.has(p.idx));
  const high = points.filter(p => highlighted.has(p.idx));

  const chart = new Chart(canvas, {
    type: 'scatter',
    data: {
      datasets: [
        {
          label: 'Ranks (X → Y)',
          data: normal.map(p => ({ x: p.rx, y: p.ry, label: p.label })),
          backgroundColor: COLORS.tealLight,
          borderColor: COLORS.teal,
          borderWidth: 2,
          pointRadius: 6,
          pointHoverRadius: 9
        },
        high.length ? {
          label: 'Maior diferença de ranks',
          data: high.map(p => ({ x: p.rx, y: p.ry, label: p.label })),
          backgroundColor: COLORS.dangerLight,
          borderColor: COLORS.danger,
          borderWidth: 2,
          pointRadius: 8,
          pointHoverRadius: 11
        } : null
      ].filter(Boolean)
    },
    options: {
      ...BASE_OPTS,
      plugins: {
        ...BASE_OPTS.plugins,
        tooltip: {
          ...BASE_OPTS.plugins.tooltip,
          callbacks: {
            title: () => '',
            label: item => {
              const r = item.raw;
              return `${r.label || ''}  posto X: ${r.x}, posto Y: ${r.y}`;
            }
          }
        }
      },
      scales: {
        x: { ...BASE_OPTS.scales.x, title: { display: true, text: `Posto de ${dataset.headers?.[0] || 'X'}`, color: COLORS.label, font: { size: 12 } } },
        y: { ...BASE_OPTS.scales.y, title: { display: true, text: `Posto de ${dataset.headers?.[1] || 'Y'}`, color: COLORS.label, font: { size: 12 } } }
      }
    }
  });

  return register(canvasId, chart);
}

// ─── Timeseries + Trend line (Prais-Winsten) ────────────────────────────────
export function renderTimeseriesChart(canvasId, time, observed, fitted, pointLabels, axisLabels, utils) {
  destroyChart(canvasId);
  const canvas = document.getElementById(canvasId);
  if (!canvas) return null;

  const chart = new Chart(canvas, {
    type: 'line',
    data: {
      labels: pointLabels,
      datasets: [
        {
          label: axisLabels.y || 'Observado',
          data: observed,
          borderColor: COLORS.blue,
          backgroundColor: COLORS.blueLight,
          borderWidth: 3,
          pointRadius: 6,
          pointHoverRadius: 9,
          fill: true,
          tension: 0.2,
          order: 1
        },
        {
          label: 'Tendência ajustada (Prais-Winsten)',
          data: fitted,
          borderColor: COLORS.primary,
          backgroundColor: 'transparent',
          borderWidth: 2.5,
          borderDash: [8, 5],
          pointRadius: 0,
          fill: false,
          tension: 0,
          order: 0
        }
      ]
    },
    options: {
      ...BASE_OPTS,
      plugins: {
        ...BASE_OPTS.plugins,
        tooltip: {
          ...BASE_OPTS.plugins.tooltip,
          mode: 'index',
          intersect: false,
          callbacks: {
            label: item => `${item.dataset.label}: ${utils.fmtNumber(item.parsed.y, 2)}`
          }
        }
      },
      scales: {
        x: {
          ...BASE_OPTS.scales.x,
          title: { display: true, text: axisLabels.x || 'Período', color: COLORS.label, font: { size: 12 } }
        },
        y: {
          ...BASE_OPTS.scales.y,
          title: { display: true, text: axisLabels.y || 'Valor', color: COLORS.label, font: { size: 12 } }
        }
      }
    }
  });

  return register(canvasId, chart);
}

// ─── Residual chart (Prais-Winsten) ─────────────────────────────────────────
export function renderResidualChart(canvasId, time, residuals, pointLabels, axisLabels, utils) {
  destroyChart(canvasId);
  const canvas = document.getElementById(canvasId);
  if (!canvas) return null;

  const colors = residuals.map(r =>
    r > 0 ? COLORS.primary : COLORS.danger
  );

  const chart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: pointLabels,
      datasets: [
        {
          label: 'Resíduo (log10)',
          data: residuals,
          backgroundColor: colors,
          borderColor: colors,
          borderWidth: 1,
          borderRadius: 4
        }
      ]
    },
    options: {
      ...BASE_OPTS,
      plugins: {
        ...BASE_OPTS.plugins,
        tooltip: {
          ...BASE_OPTS.plugins.tooltip,
          callbacks: {
            label: item => `Resíduo: ${utils.fmtNumber(item.parsed.y, 4)}`
          }
        }
      },
      scales: {
        x: { ...BASE_OPTS.scales.x, title: { display: true, text: axisLabels.x || 'Período', color: COLORS.label, font: { size: 12 } } },
        y: {
          ...BASE_OPTS.scales.y,
          title: { display: true, text: 'Resíduo (escala log10)', color: COLORS.label, font: { size: 12 } }
        }
      }
    }
  });

  return register(canvasId, chart);
}

// ─── T-Student distribution chart (boxplot-style via bar + line) ────────────
export function renderTStudentDistChart(canvasId, groupA, groupB, labelA, labelB, utils) {
  destroyChart(canvasId);
  const canvas = document.getElementById(canvasId);
  if (!canvas) return null;

  // Build summary stats
  function stats(arr) {
    const sorted = [...arr].sort((a, b) => a - b);
    const n = sorted.length;
    const mean = arr.reduce((s, v) => s + v, 0) / n;
    const std = Math.sqrt(arr.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(n - 1, 1));
    const q1 = sorted[Math.floor(n * 0.25)];
    const median = sorted[Math.floor(n * 0.5)];
    const q3 = sorted[Math.floor(n * 0.75)];
    const min = sorted[0];
    const max = sorted[n - 1];
    return { mean, std, q1, median, q3, min, max, n };
  }

  const sA = stats(groupA);
  const sB = stats(groupB);

  // Show mean ± 1SD as bars with error bars simulated via dataset
  const chart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: [labelA || 'Grupo A', labelB || 'Grupo B'],
      datasets: [
        {
          label: 'Média',
          data: [sA.mean, sB.mean],
          backgroundColor: [COLORS.blueLight, COLORS.primaryLight],
          borderColor: [COLORS.blue, COLORS.primary],
          borderWidth: 2,
          borderRadius: 8,
          borderSkipped: false
        }
      ]
    },
    options: {
      ...BASE_OPTS,
      plugins: {
        ...BASE_OPTS.plugins,
        tooltip: {
          ...BASE_OPTS.plugins.tooltip,
          callbacks: {
            label: item => {
              const s = item.dataIndex === 0 ? sA : sB;
              return [
                `Média: ${utils.fmtNumber(s.mean, 3)}`,
                `DP: ${utils.fmtNumber(s.std, 3)}`,
                `Mediana: ${utils.fmtNumber(s.median, 3)}`,
                `Q1: ${utils.fmtNumber(s.q1, 3)}  Q3: ${utils.fmtNumber(s.q3, 3)}`,
                `n = ${s.n}`
              ];
            }
          }
        }
      },
      scales: {
        x: { ...BASE_OPTS.scales.x },
        y: {
          ...BASE_OPTS.scales.y,
          title: { display: true, text: 'Valor médio', color: COLORS.label, font: { size: 12 } }
        }
      }
    }
  });

  return register(canvasId, chart);
}

// ─── T-Student difference chart (Mean Difference + IC95%) ──────────────────
export function renderTStudentDiffChart(canvasId, result, labels, utils) {
  destroyChart(canvasId);
  const canvas = document.getElementById(canvasId);
  if (!canvas) return null;

  const diff = result.diff;
  const low = result.ci[0];
  const high = result.ci[1];

  const chart = new Chart(canvas, {
    type: 'scatter',
    data: {
      datasets: [
        {
          label: 'Diferença entre médias (IC95%)',
          data: [{ x: diff, y: 0 }],
          backgroundColor: COLORS.primary,
          borderColor: COLORS.primary,
          pointRadius: 8,
          pointHoverRadius: 10,
          showLine: false
        },
        {
          label: 'Intervalo de Confiança',
          data: [{ x: low, y: 0 }, { x: high, y: 0 }],
          borderColor: COLORS.primary,
          borderWidth: 2,
          pointRadius: 4,
          showLine: true,
          fill: false
        }
      ]
    },
    options: {
      ...BASE_OPTS,
      indexAxis: 'y',
      plugins: {
        ...BASE_OPTS.plugins,
        tooltip: {
          ...BASE_OPTS.plugins.tooltip,
          callbacks: {
            title: () => 'Estimativa de Efeito',
            label: item => {
              if (item.datasetIndex === 0) return `Diferença: ${utils.fmtSigned(diff, 3)}`;
              return `IC95%: [${utils.fmtNumber(low, 3)}, ${utils.fmtNumber(high, 3)}]`;
            }
          }
        }
      },
      scales: {
        x: {
          ...BASE_OPTS.scales.x,
          title: { display: true, text: 'Diferença das Médias', color: COLORS.label }
        },
        y: {
          display: false,
          min: -1,
          max: 1
        }
      }
    }
  });

  return register(canvasId, chart);
}

// ─── Global export handler ──────────────────────────────────────────────────
/**
 * Attach a global click delegate for .lacir-export-canvas buttons.
 * Call once during app bootstrap.
 */
export function initCanvasExportDelegate() {
  document.addEventListener('click', e => {
    const btn = e.target.closest('.lacir-export-canvas');
    if (!btn) return;
    const canvasId = btn.dataset.canvasId;
    const filename = btn.dataset.export || 'grafico-lacirstat.png';
    exportCanvas(canvasId, filename);
  });
}
