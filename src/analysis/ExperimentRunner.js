/**
 * @fileoverview Factorial + OAT sweep orchestrator.
 *
 * runSweep() iterates every cell in buildDesignGrid(), runs 30 replications
 * via BatchRunner, flattens each replication into a CSV row, and — when the
 * sweep finishes — triggers downloads of `runs.csv` and `manifest.json`.
 *
 * For the baseline-B cell (F_N5_M1_B1_E1) it additionally captures the
 * per-tick history for all 30 reps and downloads `tick_history.csv` so the
 * Python notebook can perform Welch's graphical method.
 */
import BatchRunner from '../simulation/BatchRunner.js';
import { buildDesignGrid, BASELINE_B_CELL_ID } from './designGrid.js';
import { flattenResult, rowsToCsv } from './flattenResult.js';
import { CONFIG } from '../config.js';

/**
 * Trigger a browser download of a text blob.
 * @param {string} filename
 * @param {string} content
 * @param {string} mime
 */
function downloadTextFile(filename, content, mime = 'text/csv;charset=utf-8;') {
  const blob = new Blob([content], { type: mime });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Build a tick-history CSV: one row per (rep, tick), columns are the
 * KPI snapshot fields plus `rep` and `seed`.
 * @param {object[]} reps - BatchRunner result with tickHistory included
 * @returns {string}
 */
function buildTickHistoryCsv(reps) {
  const headers = ['rep', 'seed', 'tick', 'activeNeedCount', 'nurseUtilisation',
                   'robotUtilisation', 'averagePatientHealth', 'lowestPatientHealth'];
  const lines = [headers.join(',')];
  reps.forEach((rep, repIdx) => {
    for (const snap of rep.tickHistory) {
      lines.push([
        repIdx,
        rep._seed,
        snap.tick,
        snap.activeNeedCount,
        snap.nurseUtilisation.toFixed(6),
        snap.robotUtilisation.toFixed(6),
        snap.averagePatientHealth.toFixed(6),
        snap.lowestPatientHealth.toFixed(6),
      ].join(','));
    }
  });
  return lines.join('\n');
}

/**
 * Run the full 118-cell × 30-rep sweep.
 *
 * @param {object} params
 * @param {(msg: {cell: number, totalCells: number, rep: number, cellId: string}) => void} [params.onProgress]
 * @param {string} [params.sweepId] - Override auto-generated sweep ID
 * @param {number} [params.repsPerCell=30] - For smoke tests, allow reducing
 * @returns {Promise<{rows: object[], manifest: object}>}
 */
export async function runSweep({ onProgress, sweepId, repsPerCell = 30 } = {}) {
  const id = sweepId ?? `sweep_${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const cells = buildDesignGrid();
  const runner = new BatchRunner();

  const rows = [];
  let tickHistoryCsv = null;
  const startedAt = new Date().toISOString();

  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    const captureTickHistory = cell.cellId === BASELINE_B_CELL_ID;

    const reps = await runner.run(
      cell.scenario,
      repsPerCell,
      (done) => onProgress?.({ cell: i + 1, totalCells: cells.length, rep: done, cellId: cell.cellId }),
      cell.overrides,
      { includeTickHistory: captureTickHistory },
    );

    reps.forEach((summary) => {
      rows.push(flattenResult({
        stats:   summary,
        factors: cell.factors,
        seed:    summary._seed,
        cellId:  cell.cellId,
        sweepId: id,
      }));
    });

    if (captureTickHistory) {
      tickHistoryCsv = buildTickHistoryCsv(reps);
    }
  }

  const manifest = {
    sweepId:      id,
    startedAt,
    finishedAt:   new Date().toISOString(),
    totalCells:   cells.length,
    repsPerCell,
    totalRuns:    rows.length,
    baselineCell: BASELINE_B_CELL_ID,
    baseConfig: {
      TICKS_PER_RUN:     CONFIG.TICKS_PER_RUN,
      WARM_UP_TICKS:     CONFIG.WARM_UP_TICKS,
      RANDOM_SEED_START: CONFIG.RANDOM_SEED_START,
      NEED_SPAWN_RATE:   CONFIG.NEED_SPAWN_RATE,
      URGENCY_WEIGHT:    CONFIG.URGENCY_WEIGHT,
      HEALTH_DRAIN_PER_TICK: CONFIG.HEALTH_DRAIN_PER_TICK,
      SERVICE_TIME:      CONFIG.SERVICE_TIME,
    },
    gridDefinition: CONFIG.GRID_LAYOUT,
    gitHash: null, // filled client-side; see README for injection
  };

  downloadTextFile(`runs_${id}.csv`, rowsToCsv(rows));
  downloadTextFile(`manifest_${id}.json`, JSON.stringify(manifest, null, 2), 'application/json');
  if (tickHistoryCsv) {
    downloadTextFile(`tick_history_${id}.csv`, tickHistoryCsv);
  }

  return { rows, manifest };
}
