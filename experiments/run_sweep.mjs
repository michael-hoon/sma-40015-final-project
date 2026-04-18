/**
 * @fileoverview Headless Node harness for the factorial+OAT sweep.
 *
 * Mirrors the logic of src/analysis/ExperimentRunner.js#runSweep but writes
 * output files directly to disk via fs (no DOM dependency). Used because
 * Chrome throttles multiple concurrent downloads, so the browser version
 * drops 2 of its 3 output files silently.
 *
 * Run with:  node experiments/run_sweep.mjs
 * Outputs:   data/runs.csv, data/manifest.json, data/tick_history.csv
 * Duration:  ~20–30 min on a modern laptop.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

import BatchRunner from '../src/simulation/BatchRunner.js';
import { buildDesignGrid, BASELINE_B_CELL_ID } from '../src/analysis/designGrid.js';
import { flattenResult, rowsToCsv } from '../src/analysis/flattenResult.js';
import { CONFIG } from '../src/config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const DATA_DIR     = path.join(PROJECT_ROOT, 'data');

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
  return lines.join('\n') + '\n';
}

async function main() {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  const sweepId = `sweep_${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const cells   = buildDesignGrid();
  const runner  = new BatchRunner();
  const rows    = [];
  const startedAt = new Date().toISOString();
  let tickHistoryCsv = null;

  const tStart = Date.now();
  console.log(`Starting sweep: ${cells.length} cells × 30 reps = ${cells.length * 30} runs`);
  console.log(`Baseline cell (tick-history capture): ${BASELINE_B_CELL_ID}`);

  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    const captureTickHistory = cell.cellId === BASELINE_B_CELL_ID;
    const tCell = Date.now();

    const reps = await runner.run(
      cell.scenario,
      30,
      null,
      cell.overrides,
      { includeTickHistory: captureTickHistory },
    );

    reps.forEach((summary) => {
      rows.push(flattenResult({
        stats:   summary,
        factors: cell.factors,
        seed:    summary._seed,
        cellId:  cell.cellId,
        sweepId,
      }));
    });

    if (captureTickHistory) {
      tickHistoryCsv = buildTickHistoryCsv(reps);
    }

    const cellSecs = ((Date.now() - tCell) / 1000).toFixed(1);
    const totSecs  = ((Date.now() - tStart) / 1000).toFixed(0);
    console.log(`[${String(i + 1).padStart(3)}/${cells.length}] ${cell.cellId.padEnd(20)} — ${cellSecs}s (total ${totSecs}s)`);
  }

  let gitHash = null;
  try {
    gitHash = execSync('git rev-parse HEAD', { cwd: PROJECT_ROOT }).toString().trim();
  } catch {
    console.warn('git rev-parse failed; gitHash will be null in manifest');
  }

  const manifest = {
    sweepId,
    startedAt,
    finishedAt:   new Date().toISOString(),
    totalCells:   cells.length,
    repsPerCell:  30,
    totalRuns:    rows.length,
    baselineCell: BASELINE_B_CELL_ID,
    baseConfig: {
      TICKS_PER_RUN:         CONFIG.TICKS_PER_RUN,
      WARM_UP_TICKS:         CONFIG.WARM_UP_TICKS,
      RANDOM_SEED_START:     CONFIG.RANDOM_SEED_START,
      NEED_SPAWN_RATE:       CONFIG.NEED_SPAWN_RATE,
      URGENCY_WEIGHT:        CONFIG.URGENCY_WEIGHT,
      HEALTH_DRAIN_PER_TICK: CONFIG.HEALTH_DRAIN_PER_TICK,
      SERVICE_TIME:          CONFIG.SERVICE_TIME,
    },
    gridDefinition: CONFIG.GRID_LAYOUT,
    gitHash,
  };

  fs.writeFileSync(path.join(DATA_DIR, 'runs.csv'), rowsToCsv(rows) + '\n', 'utf8');
  fs.writeFileSync(path.join(DATA_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  if (tickHistoryCsv) {
    fs.writeFileSync(path.join(DATA_DIR, 'tick_history.csv'), tickHistoryCsv, 'utf8');
  } else {
    console.warn('No tick history captured — baseline cell not encountered');
  }

  const totalMin = ((Date.now() - tStart) / 60000).toFixed(1);
  console.log(`\nDone in ${totalMin} min.`);
  console.log(`  data/runs.csv          — ${rows.length} rows`);
  console.log(`  data/manifest.json     — gitHash ${gitHash?.slice(0, 8) ?? 'null'}`);
  console.log(`  data/tick_history.csv  — ${tickHistoryCsv ? tickHistoryCsv.split('\n').length - 1 : 0} rows`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
