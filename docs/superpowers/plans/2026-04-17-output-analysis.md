# Output Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the JS simulation to emit a factorial+OAT parameter sweep as CSV, run all four rubric analyses in a Python Jupyter notebook, and generate the final `OUTPUT_ANALYSIS.md` report.

**Architecture:** Hybrid. JS (already headless-capable) runs 3,540 replications across 118 design cells, emitting a single `runs.csv` per sweep plus `tick_history.csv` for one baseline cell. Python notebook reads the CSVs, produces figures and tables, and Claude Code authors the markdown report from those outputs. The live Alpine/Pixi dashboard is untouched except for an extra "Run Full Sweep" button.

**Tech Stack:** ES-module JS (no build tooling), Alpine.js + Pixi.js + Chart.js (existing, unchanged behaviour), Python 3.11+, pandas, numpy, scipy.stats, statsmodels, matplotlib, seaborn, jupyter.

**Spec:** `docs/superpowers/specs/2026-04-17-output-analysis-design.md`

---

## File Structure

| Path | Purpose | Status |
|---|---|---|
| `src/analysis/flattenResult.js` | Flatten nested KPI object + merge factor fields into one flat row | **new** |
| `src/analysis/designGrid.js` | Pure data — enumerate 118 design cells (factorial + OAT) | **new** |
| `src/analysis/ExperimentRunner.js` | Orchestrate sweep: iterate cells, call BatchRunner, emit CSV + manifest | **new** |
| `src/simulation/BatchRunner.js` | Add optional `includeTickHistory` flag; otherwise unchanged | **modify** |
| `src/ui/ExperimentPanel.js` | Add `runFullSweep(comp)` + `exportTickHistory(comp)` exports | **modify** |
| `index.html` | Add "Run Full Sweep" button + Alpine state fields + handler | **modify** |
| `experiments/analysis/requirements.txt` | Pinned Python deps | **new** |
| `experiments/analysis/README.md` | How to run the notebook | **new** |
| `experiments/analysis/output_analysis.ipynb` | Four-section analysis notebook | **new** |
| `experiments/analysis/.gitignore` | Ignore `.venv/`, `__pycache__/` | **new** |
| `experiments/results/` | Raw sweep outputs (gitignored except one canonical sweep) | **new** |
| `experiments/results/.gitignore` | Ignore everything except the canonical sweep dir | **new** |
| `experiments/report/figures/` | Notebook-exported PNGs | **new (populated by notebook)** |
| `experiments/report/tables/` | Notebook-exported markdown tables | **new (populated by notebook)** |
| `experiments/report/OUTPUT_ANALYSIS.md` | Final narrative report | **new (authored by Claude)** |

---

## Phase 1 — JS sweep pipeline (Tasks 1–7)

### Task 1: Create `flattenResult.js` — flatten nested KPI to a single-level object

**Files:**
- Create: `src/analysis/flattenResult.js`

- [ ] **Step 1: Write the module**

```javascript
/**
 * @fileoverview Convert a Scheduler.getStats() result + factor values
 * into a flat object suitable for a single CSV row.
 *
 * Nested fields like meanWaitTime.emergency become `meanWaitTime_emergency`.
 * Count dicts like totalNeedsGenerated become `needsGenerated_emergency`, etc.
 *
 * The resulting row also carries all factor values + seed + cell tag for
 * downstream grouping/analysis.
 */

/**
 * @param {object} params
 * @param {object} params.stats        - Output of Scheduler.getStats()
 * @param {object} params.factors      - { NURSE_COUNT, MEDI_COUNT, BLANKI_COUNT, EDI_COUNT, ... }
 * @param {number} params.seed
 * @param {string} params.cellId       - Stable identifier for this design cell (e.g. "N5_M1_B1_E1")
 * @param {string} params.sweepId      - Identifier for the full sweep run
 * @returns {object} Flat key→number row
 */
export function flattenResult({ stats, factors, seed, cellId, sweepId }) {
  const row = {
    sweepId,
    cellId,
    seed,
    // Primary factors — always present
    NURSE_COUNT:   factors.NURSE_COUNT   ?? 0,
    MEDI_COUNT:    factors.MEDI_COUNT    ?? 0,
    BLANKI_COUNT:  factors.BLANKI_COUNT  ?? 0,
    EDI_COUNT:     factors.EDI_COUNT     ?? 0,
    // Load factors (OAT); present with baseline values if not swept
    needSpawn_emergency:      factors.needSpawn_emergency      ?? null,
    needSpawn_medication:     factors.needSpawn_medication     ?? null,
    needSpawn_comfort:        factors.needSpawn_comfort        ?? null,
    needSpawn_visitor_escort: factors.needSpawn_visitor_escort ?? null,
    // KPIs — flat scalars
    criticalIncidentCount:        stats.criticalIncidentCount,
    meanEmergencyResponseTime:    stats.meanEmergencyResponseTime,
    needsUnfulfilledAtEnd:        stats.needsUnfulfilledAtEnd,
    meanNurseUtilisation:         stats.meanNurseUtilisation,
    meanRobotUtilisation:         stats.meanRobotUtilisation,
    // KPIs — nested, flattened
    meanWaitTime_emergency:       stats.meanWaitTime.emergency,
    meanWaitTime_medication:      stats.meanWaitTime.medication,
    meanWaitTime_comfort:         stats.meanWaitTime.comfort,
    meanWaitTime_visitor_escort:  stats.meanWaitTime.visitor_escort,
    needsGenerated_emergency:       stats.totalNeedsGenerated.emergency,
    needsGenerated_medication:      stats.totalNeedsGenerated.medication,
    needsGenerated_comfort:         stats.totalNeedsGenerated.comfort,
    needsGenerated_visitor_escort:  stats.totalNeedsGenerated.visitor_escort,
    needsFulfilled_emergency:       stats.totalNeedsFulfilled.emergency,
    needsFulfilled_medication:      stats.totalNeedsFulfilled.medication,
    needsFulfilled_comfort:         stats.totalNeedsFulfilled.comfort,
    needsFulfilled_visitor_escort:  stats.totalNeedsFulfilled.visitor_escort,
  };
  return row;
}

/**
 * Build a CSV string from an array of flat rows. Column order is taken
 * from the keys of the first row. Missing values render as empty string.
 * @param {object[]} rows
 * @returns {string}
 */
export function rowsToCsv(rows) {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  const body = rows.map(r =>
    headers.map(h => {
      const v = r[h];
      if (v === null || v === undefined) return '';
      if (typeof v === 'string') return `"${v.replace(/"/g, '""')}"`;
      return Number.isFinite(v) ? v : '';
    }).join(',')
  );
  return [headers.join(','), ...body].join('\n');
}
```

- [ ] **Step 2: Smoke-check in browser console**

Open `index.html` via `python -m http.server 8080`, in DevTools console:

```javascript
const { flattenResult, rowsToCsv } = await import('./src/analysis/flattenResult.js');
const fakeStats = {
  meanWaitTime: { emergency: 5, medication: 3, comfort: 2, visitor_escort: 1 },
  criticalIncidentCount: 0,
  meanEmergencyResponseTime: 4.2,
  totalNeedsGenerated: { emergency: 1, medication: 10, comfort: 2, visitor_escort: 3 },
  totalNeedsFulfilled: { emergency: 1, medication: 10, comfort: 2, visitor_escort: 3 },
  needsUnfulfilledAtEnd: 0,
  meanNurseUtilisation: 0.6,
  meanRobotUtilisation: 0.4,
};
const row = flattenResult({ stats: fakeStats, factors: { NURSE_COUNT: 5, MEDI_COUNT: 1, BLANKI_COUNT: 1, EDI_COUNT: 1 }, seed: 1, cellId: 'N5_M1_B1_E1', sweepId: 'test' });
console.log(row);
console.log(rowsToCsv([row, row]));
```

Expected: row object has 25+ flat keys, CSV output has header line + 2 data lines with 25+ columns.

- [ ] **Step 3: Commit**

```bash
git add src/analysis/flattenResult.js
git commit -m "feat(analysis): add flattenResult + rowsToCsv helpers for sweep export"
```

---

### Task 2: Extend `BatchRunner` with optional tick-history capture

**Files:**
- Modify: `src/simulation/BatchRunner.js`

**Why this task:** The sweep needs per-replication summaries (`getStats()` — already surfaced), AND separately needs the per-tick trajectories for ONE baseline cell so the Python notebook can do Welch's graphical method in §3. A tiny opt-in flag keeps the existing call sites untouched.

- [ ] **Step 1: Modify `BatchRunner.run` signature and loop**

Replace the entire contents of `src/simulation/BatchRunner.js` with:

```javascript
/**
 * @fileoverview Headless batch runner for multi-replication experiments.
 *
 * Runs N replications of a scenario sequentially, yielding after each one
 * so the browser can update the progress bar between replications.
 * No rendering code is imported or used here — pure simulation only.
 */
import { CONFIG } from '../config.js';
import Scheduler  from './Scheduler.js';

export default class BatchRunner {
  /**
   * Run N headless replications of a scenario.
   *
   * Seeds are assigned sequentially starting at CONFIG.RANDOM_SEED_START
   * so results match the spec's experiment design (seeds 1–30).
   *
   * @param {'A'|'B'} scenario - 'A' = nurses only, 'B' = nurses + robots
   * @param {number}  [count=30]
   * @param {(done: number, total: number) => void} [onProgress]
   * @param {object}  [configOverrides]
   * @param {object}  [opts]
   * @param {boolean} [opts.includeTickHistory=false] - When true, each result also carries a `tickHistory` array
   * @returns {Promise<object[]>} Array of per-replication summary objects. If
   *   `opts.includeTickHistory` is true, each element also has a `tickHistory`
   *   field with the full per-tick snapshot array.
   */
  async run(scenario, count = 30, onProgress, configOverrides = {}, opts = {}) {
    const cfg = Object.assign({}, CONFIG, configOverrides);
    const { includeTickHistory = false } = opts;
    const results = [];

    for (let i = 0; i < count; i++) {
      const seed = cfg.RANDOM_SEED_START + i;

      const sched = new Scheduler({
        config:        cfg,
        seed,
        includeRobots: scenario === 'B',
      });

      sched.run();
      const summary = sched.getStats();
      if (includeTickHistory) {
        summary.tickHistory = sched.getTickHistory();
      }
      summary._seed = seed;
      results.push(summary);

      onProgress?.(i + 1, count);
      await new Promise(resolve => setTimeout(resolve, 0));
    }

    return results;
  }
}
```

Changes from current file:
- Added `opts = {}` param with `includeTickHistory` flag.
- Each `summary` object now carries a private `_seed` field and optionally `tickHistory`. No existing caller breaks because they ignore unknown fields.

- [ ] **Step 2: Verify existing A/B experiment still works**

Start `python -m http.server 8080`, open http://localhost:8080, click "Run Experiment" as before. Verify:
- Progress bar counts from 0 → 60.
- Results table populates.
- "Download CSV" button still produces a working CSV.

Expected: no regression.

- [ ] **Step 3: Smoke-check tick history in console**

```javascript
const BatchRunner = (await import('./src/simulation/BatchRunner.js')).default;
const runner = new BatchRunner();
const r = await runner.run('B', 2, null, {}, { includeTickHistory: true });
console.log(r[0].tickHistory.length, 'ticks');
console.log(r[0].tickHistory[0]);
console.log(r[0]._seed);
```

Expected: `960 ticks`, first tick snapshot has `{tick, activeNeedCount, nurseUtilisation, robotUtilisation, averagePatientHealth, lowestPatientHealth}`, seed prints as `1`.

- [ ] **Step 4: Commit**

```bash
git add src/simulation/BatchRunner.js
git commit -m "feat(sim): BatchRunner can optionally include tickHistory and seed in results"
```

---

### Task 3: Create `designGrid.js` — enumerate the 118 design cells

**Files:**
- Create: `src/analysis/designGrid.js`

- [ ] **Step 1: Write the module**

```javascript
/**
 * @fileoverview Enumerate the parameter-sweep design grid.
 *
 * Factorial (108 cells): NURSE_COUNT × MEDI × BLANKI × EDI
 *   3 × 4 × 3 × 3 = 108
 * OAT supplement (10 cells): 5 levels of need_spawn.medication,
 *                            5 levels of need_spawn.emergency,
 *                            robots fixed at (1,1,1), nurses at 5.
 * Total: 118 cells.
 *
 * Each cell is a plain object with:
 *   - cellId {string}     stable short identifier
 *   - scenario {'A'|'B'}  matches BatchRunner param
 *   - factors {object}    factor values (used for CSV rows)
 *   - overrides {object}  configOverrides to hand to BatchRunner
 *   - block {'factorial'|'oat_medication'|'oat_emergency'}
 */
import { CONFIG } from '../config.js';

const NURSE_LEVELS  = [3, 5, 7];
const MEDI_LEVELS   = [0, 1, 2, 3];
const BLANKI_LEVELS = [0, 1, 2];
const EDI_LEVELS    = [0, 1, 2];

const OAT_FACTORS   = [0.5, 0.75, 1.0, 1.5, 2.0];

const BASELINE_NURSE = 5;
const BASELINE_MEDI  = 1;
const BASELINE_BLANKI = 1;
const BASELINE_EDI   = 1;

/**
 * @returns {object[]} all design cells in deterministic order
 */
export function buildDesignGrid() {
  const cells = [];

  // ── Factorial block ─────────────────────────────────────────────────────
  for (const n of NURSE_LEVELS) {
    for (const m of MEDI_LEVELS) {
      for (const b of BLANKI_LEVELS) {
        for (const e of EDI_LEVELS) {
          const hasRobots = (m + b + e) > 0;
          cells.push({
            cellId: `F_N${n}_M${m}_B${b}_E${e}`,
            scenario: hasRobots ? 'B' : 'A',
            factors: {
              NURSE_COUNT:  n,
              MEDI_COUNT:   m,
              BLANKI_COUNT: b,
              EDI_COUNT:    e,
              needSpawn_emergency:      CONFIG.NEED_SPAWN_RATE.emergency,
              needSpawn_medication:     CONFIG.NEED_SPAWN_RATE.medication,
              needSpawn_comfort:        CONFIG.NEED_SPAWN_RATE.comfort,
              needSpawn_visitor_escort: CONFIG.NEED_SPAWN_RATE.visitor_escort,
            },
            overrides: {
              NURSE_COUNT:  n,
              MEDI_COUNT:   m,
              BLANKI_COUNT: b,
              EDI_COUNT:    e,
            },
            block: 'factorial',
          });
        }
      }
    }
  }

  // ── OAT medication rate ──────────────────────────────────────────────────
  for (const mult of OAT_FACTORS) {
    const rate = CONFIG.NEED_SPAWN_RATE.medication * mult;
    cells.push({
      cellId: `OATmed_${mult.toFixed(2)}`,
      scenario: 'B',
      factors: {
        NURSE_COUNT:  BASELINE_NURSE,
        MEDI_COUNT:   BASELINE_MEDI,
        BLANKI_COUNT: BASELINE_BLANKI,
        EDI_COUNT:    BASELINE_EDI,
        needSpawn_emergency:      CONFIG.NEED_SPAWN_RATE.emergency,
        needSpawn_medication:     rate,
        needSpawn_comfort:        CONFIG.NEED_SPAWN_RATE.comfort,
        needSpawn_visitor_escort: CONFIG.NEED_SPAWN_RATE.visitor_escort,
      },
      overrides: {
        NURSE_COUNT:  BASELINE_NURSE,
        MEDI_COUNT:   BASELINE_MEDI,
        BLANKI_COUNT: BASELINE_BLANKI,
        EDI_COUNT:    BASELINE_EDI,
        NEED_SPAWN_RATE: {
          ...CONFIG.NEED_SPAWN_RATE,
          medication: rate,
        },
      },
      block: 'oat_medication',
    });
  }

  // ── OAT emergency rate ───────────────────────────────────────────────────
  for (const mult of OAT_FACTORS) {
    const rate = CONFIG.NEED_SPAWN_RATE.emergency * mult;
    cells.push({
      cellId: `OATemg_${mult.toFixed(2)}`,
      scenario: 'B',
      factors: {
        NURSE_COUNT:  BASELINE_NURSE,
        MEDI_COUNT:   BASELINE_MEDI,
        BLANKI_COUNT: BASELINE_BLANKI,
        EDI_COUNT:    BASELINE_EDI,
        needSpawn_emergency:      rate,
        needSpawn_medication:     CONFIG.NEED_SPAWN_RATE.medication,
        needSpawn_comfort:        CONFIG.NEED_SPAWN_RATE.comfort,
        needSpawn_visitor_escort: CONFIG.NEED_SPAWN_RATE.visitor_escort,
      },
      overrides: {
        NURSE_COUNT:  BASELINE_NURSE,
        MEDI_COUNT:   BASELINE_MEDI,
        BLANKI_COUNT: BASELINE_BLANKI,
        EDI_COUNT:    BASELINE_EDI,
        NEED_SPAWN_RATE: {
          ...CONFIG.NEED_SPAWN_RATE,
          emergency: rate,
        },
      },
      block: 'oat_emergency',
    });
  }

  return cells;
}

/** The canonical baseline-B cell — the one whose tick history we export. */
export const BASELINE_B_CELL_ID = `F_N${BASELINE_NURSE}_M${BASELINE_MEDI}_B${BASELINE_BLANKI}_E${BASELINE_EDI}`;
```

- [ ] **Step 2: Smoke-check cell count in console**

```javascript
const { buildDesignGrid, BASELINE_B_CELL_ID } = await import('./src/analysis/designGrid.js');
const cells = buildDesignGrid();
console.log('Total cells:', cells.length);                  // expect 118
console.log('Factorial:', cells.filter(c => c.block === 'factorial').length); // expect 108
console.log('OAT med:', cells.filter(c => c.block === 'oat_medication').length); // expect 5
console.log('OAT emg:', cells.filter(c => c.block === 'oat_emergency').length);  // expect 5
console.log('Baseline cell:', BASELINE_B_CELL_ID);          // expect F_N5_M1_B1_E1
console.log('First cell:', cells[0]);
```

Expected: `118, 108, 5, 5, F_N5_M1_B1_E1`, first cell has `F_N3_M0_B0_E0` with `scenario: 'A'`.

- [ ] **Step 3: Commit**

```bash
git add src/analysis/designGrid.js
git commit -m "feat(analysis): enumerate 118-cell factorial + OAT design grid"
```

---

### Task 4: Create `ExperimentRunner.js` — sweep orchestrator

**Files:**
- Create: `src/analysis/ExperimentRunner.js`

- [ ] **Step 1: Write the module**

```javascript
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
```

- [ ] **Step 2: Commit**

```bash
git add src/analysis/ExperimentRunner.js
git commit -m "feat(analysis): ExperimentRunner.runSweep drives 118-cell factorial+OAT sweep"
```

---

### Task 5: Wire "Run Full Sweep" button into UI

**Files:**
- Modify: `src/ui/ExperimentPanel.js`
- Modify: `index.html`

- [ ] **Step 1: Add `runFullSweep` export to `ExperimentPanel.js`**

Append the following to the end of `src/ui/ExperimentPanel.js` (keep existing `runExperiment` and `exportCSV` intact):

```javascript
/**
 * Drive the full 118-cell × 30-rep sweep from the UI.
 *
 * Updates Alpine state fields:
 *   sweepRunning {boolean}
 *   sweepDone {boolean}
 *   sweepCell {number}   — 1-indexed
 *   sweepTotalCells {number}
 *   sweepRep {number}    — 1-indexed within current cell
 *   sweepCellId {string}
 *   sweepStatus {string}
 *
 * @param {object} comp - Alpine reactive data proxy
 * @param {object} [opts]
 * @param {number} [opts.repsPerCell=30]
 * @returns {Promise<void>}
 */
export async function runFullSweep(comp, { repsPerCell = 30 } = {}) {
  const { runSweep } = await import('../analysis/ExperimentRunner.js');

  comp.sweepRunning    = true;
  comp.sweepDone       = false;
  comp.sweepCell       = 0;
  comp.sweepTotalCells = 0;
  comp.sweepRep        = 0;
  comp.sweepCellId     = '';
  comp.sweepStatus     = 'Starting sweep…';

  try {
    await runSweep({
      repsPerCell,
      onProgress: ({ cell, totalCells, rep, cellId }) => {
        comp.sweepCell       = cell;
        comp.sweepTotalCells = totalCells;
        comp.sweepRep        = rep;
        comp.sweepCellId     = cellId;
        comp.sweepStatus     = `Cell ${cell}/${totalCells} (${cellId}) — rep ${rep}/${repsPerCell}`;
      },
    });
    comp.sweepStatus = `Sweep complete — ${comp.sweepTotalCells} cells × ${repsPerCell} reps downloaded.`;
    comp.sweepDone   = true;
  } finally {
    comp.sweepRunning = false;
  }
}
```

- [ ] **Step 2: Add Alpine state + handler in `index.html`**

In `index.html`, find the block at lines ~938–947 (the `expRunning`/`expDone`/`_expRawA` declarations) and add these sibling fields below `_expRawB: null,`:

```javascript
        /* Full-sweep state */
        sweepRunning:    false,
        sweepDone:       false,
        sweepCell:       0,
        sweepTotalCells: 0,
        sweepRep:        0,
        sweepCellId:     '',
        sweepStatus:     '',
```

Find the block at lines ~977–990 (the `openExperiment`/`startExperiment`/`downloadCSV` methods) and add a sibling method below `downloadCSV`:

```javascript
        async startFullSweep() {
          if (this.sweepRunning) return;
          const { runFullSweep } = await import('./src/ui/ExperimentPanel.js');
          await runFullSweep(this);
        },
```

- [ ] **Step 3: Add the button to the experiment card in `index.html`**

Find the experiment card at lines ~1240–1249. Replace those lines with:

```html
      <div class="card">
        <div class="card-hdr">Experiment</div>
        <p style="font-size:11.5px;color:var(--text-lo);line-height:1.6;margin-bottom:12px">
          Run 30 replications of each scenario (seeds 1–30) and compare KPIs with Welch's t-test.
        </p>
        <button
          class="btn-exp"
          :disabled="!rendererReady || sweepRunning"
          @click="openExperiment()"
        >⚗ Run Experiment</button>

        <p style="font-size:11.5px;color:var(--text-lo);line-height:1.6;margin:16px 0 12px 0">
          Full factorial+OAT sweep — 118 cells × 30 reps = 3,540 runs. Emits <code>runs.csv</code>, <code>manifest.json</code>, <code>tick_history.csv</code>.
        </p>
        <button
          class="btn-exp"
          :disabled="!rendererReady || expRunning || sweepRunning"
          @click="startFullSweep()"
        >🧪 Run Full Sweep</button>

        <template x-if="sweepRunning || sweepDone">
          <div style="margin-top:10px;font-size:11.5px;color:var(--text-mid);line-height:1.5">
            <div x-text="sweepStatus"></div>
            <div x-show="sweepTotalCells > 0" style="margin-top:4px;height:4px;background:var(--surface-sunk);border-radius:2px;overflow:hidden">
              <div :style="'height:100%;background:var(--accent);width:' + (sweepTotalCells ? (100 * sweepCell / sweepTotalCells) : 0) + '%'"></div>
            </div>
          </div>
        </template>
      </div>
```

- [ ] **Step 4: Commit**

```bash
git add src/ui/ExperimentPanel.js index.html
git commit -m "feat(ui): add Run Full Sweep button + Alpine bindings"
```

---

### Task 6: Tiny sweep smoke test (2 cells × 3 reps)

**Files:** none modified — manual verification task.

**Purpose:** Prove the end-to-end pipeline works on a small budget before committing to a 30-minute full sweep.

- [ ] **Step 1: Temporarily restrict the grid + reps**

In a browser console (not a file edit), run:

```javascript
const { runSweep } = await import('./src/analysis/ExperimentRunner.js');
const { buildDesignGrid } = await import('./src/analysis/designGrid.js');
// Override the grid to just 2 cells: pure A (no robots) and baseline B
const full = buildDesignGrid();
const tiny = [full[0], full.find(c => c.cellId === 'F_N5_M1_B1_E1')];
console.log('Using cells:', tiny.map(c => c.cellId));
```

Confirm `['F_N3_M0_B0_E0', 'F_N5_M1_B1_E1']`.

- [ ] **Step 2: Invoke sweep with `repsPerCell: 3`**

Since `runSweep` internally calls `buildDesignGrid`, the simplest path is to temporarily edit `designGrid.js` to return only `tiny`, OR invoke `runSweep({ repsPerCell: 3 })` against the full grid and cancel early. **Cleaner:** add a scratch console block:

```javascript
// Scratch: run the tiny cells directly via BatchRunner + flattenResult without editing files
const BatchRunner = (await import('./src/simulation/BatchRunner.js')).default;
const { flattenResult, rowsToCsv } = await import('./src/analysis/flattenResult.js');
const runner = new BatchRunner();
const rows = [];
for (const cell of tiny) {
  const reps = await runner.run(cell.scenario, 3, null, cell.overrides,
                                 { includeTickHistory: cell.cellId === 'F_N5_M1_B1_E1' });
  reps.forEach(s => rows.push(flattenResult({
    stats: s, factors: cell.factors, seed: s._seed,
    cellId: cell.cellId, sweepId: 'smoke',
  })));
}
console.log('Rows:', rows.length);         // expect 6
console.table(rows);
console.log(rowsToCsv(rows).split('\n').slice(0, 3));
```

- [ ] **Step 3: Verify row schema**

Expected console output:
- `Rows: 6`
- Table shows 6 rows with columns: `sweepId, cellId, seed, NURSE_COUNT, MEDI_COUNT, ..., meanWaitTime_emergency, ...`
- Cell `F_N3_M0_B0_E0` rows all have `MEDI_COUNT=0, BLANKI_COUNT=0, EDI_COUNT=0` and `meanRobotUtilisation=0`.
- Cell `F_N5_M1_B1_E1` rows have the baseline robot counts.
- Seeds 1, 2, 3 appear twice (once per cell) — confirming CRN across cells.

If any of the above fails, fix before proceeding.

- [ ] **Step 4: Verify determinism**

Re-run the entire Step 2 block again. The numeric KPI values for the same `(cellId, seed)` pair must match bit-for-bit. This is a regression check on the seeded PRNG.

- [ ] **Step 5: No commit** (nothing was written)

---

### Task 7: Execute the full sweep and save outputs

**Files:** none modified — execution task. Outputs land in browser Downloads folder.

- [ ] **Step 1: Ensure any prior sim is reset**

Click the Reset button in the UI. Close the Experiment modal if open.

- [ ] **Step 2: Trigger full sweep**

Click "🧪 Run Full Sweep". The progress bar should fill from 0 to 118 cells over roughly 20–30 minutes. **Do not close the tab.**

- [ ] **Step 3: Verify downloads**

When the sweep ends, three files should appear in your Downloads folder:
- `runs_sweep_2026-04-17T....csv` (~ 3,540 rows)
- `manifest_sweep_2026-04-17T....json`
- `tick_history_sweep_2026-04-17T....csv` (30 reps × 960 ticks = 28,800 rows)

- [ ] **Step 4: Move into repo and record git hash**

```bash
cd /home/micha/sutd/sma-40015-final-project
mkdir -p experiments/results/canonical
SWEEP_ID=$(ls ~/Downloads/runs_sweep_*.csv | tail -1 | sed -E 's/.*runs_(sweep_[^.]+)\.csv/\1/')
mv ~/Downloads/runs_${SWEEP_ID}.csv experiments/results/canonical/runs.csv
mv ~/Downloads/manifest_${SWEEP_ID}.json experiments/results/canonical/manifest.json
mv ~/Downloads/tick_history_${SWEEP_ID}.csv experiments/results/canonical/tick_history.csv

# Inject current git hash into manifest
GITHASH=$(git rev-parse HEAD)
python3 -c "
import json
m = json.load(open('experiments/results/canonical/manifest.json'))
m['gitHash'] = '$GITHASH'
json.dump(m, open('experiments/results/canonical/manifest.json','w'), indent=2)
"
```

- [ ] **Step 5: Add gitignore and commit the canonical sweep**

Create `experiments/results/.gitignore`:

```
*
!.gitignore
!canonical/
```

Create `experiments/results/canonical/.gitignore`:

```
# The canonical sweep is checked in. Future sweeps go into sibling dirs and are ignored.
```

Verify row count:

```bash
wc -l experiments/results/canonical/runs.csv         # expect 3541 (header + 3540 rows)
wc -l experiments/results/canonical/tick_history.csv # expect 28801
```

Commit:

```bash
git add experiments/results/.gitignore experiments/results/canonical/
git commit -m "data: canonical 118×30 sweep results + tick history"
```

---

## Phase 2 — Python analysis notebook (Tasks 8–14)

### Task 8: Python environment

**Files:**
- Create: `experiments/analysis/requirements.txt`
- Create: `experiments/analysis/.gitignore`
- Create: `experiments/analysis/README.md`

- [ ] **Step 1: Create `requirements.txt`**

```
pandas==2.2.2
numpy==1.26.4
scipy==1.13.1
statsmodels==0.14.2
matplotlib==3.9.0
seaborn==0.13.2
jupyter==1.0.0
notebook==7.2.1
tabulate==0.9.0
```

- [ ] **Step 2: Create `.gitignore`**

```
.venv/
__pycache__/
.ipynb_checkpoints/
```

- [ ] **Step 3: Create `README.md`**

```markdown
# Output Analysis Notebook

## Setup

```bash
cd experiments/analysis
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Run

```bash
jupyter notebook output_analysis.ipynb
```

Then execute all cells top-to-bottom. Outputs are written to:
- `../report/figures/*.png`
- `../report/tables/*.md`

## Inputs

Reads from `../results/canonical/`:
- `runs.csv` — 3,540 per-replication rows
- `manifest.json` — sweep metadata
- `tick_history.csv` — 28,800 per-tick rows for the baseline-B cell
```

- [ ] **Step 4: Verify environment**

```bash
cd experiments/analysis
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python -c "import pandas, numpy, scipy.stats, statsmodels.api, matplotlib, seaborn, tabulate; print('ok')"
```

Expected: `ok`.

- [ ] **Step 5: Commit**

```bash
git add experiments/analysis/requirements.txt experiments/analysis/.gitignore experiments/analysis/README.md
git commit -m "chore(analysis): Python env for output-analysis notebook"
```

---

### Task 9: Notebook scaffolding + data loader

**Files:**
- Create: `experiments/analysis/output_analysis.ipynb`

**Guidance:** Build the notebook as a plain `.py` script first (easier to review in PRs), then convert to `.ipynb` via `jupytext` or by pasting cells. Below, each block is one notebook cell; cells are separated by `# %%` markers.

- [ ] **Step 1: Create the notebook with the scaffold**

Either use `jupytext --set-formats ipynb,py:percent output_analysis.py` and then sync, OR open a blank notebook in Jupyter and paste each cell below in order.

**Cell 1 — Imports and paths (Markdown + Code):**

```markdown
# Output Analysis: CGH Hospital Robot ABM

This notebook produces the four rubric sections:

1. Types of analysis
2. Sensitivity analysis
3. Steady-state vs non-steady-state
4. Accuracy of the sample mean

Figures → `../report/figures/`, tables → `../report/tables/`.
```

```python
import json
from pathlib import Path
import numpy as np
import pandas as pd
import scipy.stats as stats
import statsmodels.formula.api as smf
import matplotlib.pyplot as plt
import seaborn as sns
from tabulate import tabulate

ROOT     = Path('..').resolve()
RESULTS  = ROOT / 'results' / 'canonical'
FIG_DIR  = ROOT / 'report' / 'figures'
TAB_DIR  = ROOT / 'report' / 'tables'
FIG_DIR.mkdir(parents=True, exist_ok=True)
TAB_DIR.mkdir(parents=True, exist_ok=True)

sns.set_theme(style='whitegrid', context='paper', palette='muted')
plt.rcParams['figure.dpi']    = 110
plt.rcParams['savefig.dpi']   = 300
plt.rcParams['savefig.bbox']  = 'tight'

PRIMARY_KPIS = [
    'criticalIncidentCount',
    'meanEmergencyResponseTime',
    'meanWaitTime_emergency',
    'meanWaitTime_medication',
    'meanNurseUtilisation',
]

KPI_LABELS = {
    'criticalIncidentCount':       'Critical Incidents (count)',
    'meanEmergencyResponseTime':   'Emergency Response Time (ticks)',
    'meanWaitTime_emergency':      'Emergency Wait Time (ticks)',
    'meanWaitTime_medication':     'Medication Wait Time (ticks)',
    'meanNurseUtilisation':        'Nurse Utilisation (fraction)',
}
```

**Cell 2 — Load data:**

```python
runs     = pd.read_csv(RESULTS / 'runs.csv')
manifest = json.loads((RESULTS / 'manifest.json').read_text())
ticks    = pd.read_csv(RESULTS / 'tick_history.csv')

print(f"runs.csv         — {len(runs):,} rows, {runs.shape[1]} columns")
print(f"tick_history.csv — {len(ticks):,} rows")
print(f"sweepId          — {manifest['sweepId']}")
print(f"gitHash          — {manifest['gitHash']}")
print(f"totalCells       — {manifest['totalCells']}")
print(f"repsPerCell      — {manifest['repsPerCell']}")

# Sanity: expected 3540 rows, 118 cells
assert len(runs) == manifest['totalCells'] * manifest['repsPerCell'], \
    f"runs.csv row count mismatch"
assert runs['cellId'].nunique() == manifest['totalCells']
```

**Cell 3 — Derived columns + baseline tags:**

```python
runs['block'] = runs['cellId'].str.split('_').str[0].map({
    'F':       'factorial',
    'OATmed':  'oat_medication',
    'OATemg':  'oat_emergency',
})

# Baseline-A cell: nurses only at baseline nurse count, no robots
BASELINE_A_CELL = 'F_N5_M0_B0_E0'
BASELINE_B_CELL = 'F_N5_M1_B1_E1'

runs['is_baseline_A'] = runs['cellId'] == BASELINE_A_CELL
runs['is_baseline_B'] = runs['cellId'] == BASELINE_B_CELL

# Factorial subset for sensitivity analysis
fact = runs[runs['block'] == 'factorial'].copy()
assert fact['cellId'].nunique() == 108

print("Baseline A rows:", runs['is_baseline_A'].sum())
print("Baseline B rows:", runs['is_baseline_B'].sum())
print("Factorial rows:",  len(fact))
```

- [ ] **Step 2: Run these three cells and fix any import/path errors**

Expected output:
```
runs.csv         — 3,540 rows, ~27 columns
tick_history.csv — 28,800 rows
sweepId          — sweep_...
totalCells       — 118
repsPerCell      — 30
Baseline A rows: 30
Baseline B rows: 30
Factorial rows: 3240
```

- [ ] **Step 3: Commit**

```bash
git add experiments/analysis/output_analysis.ipynb
git commit -m "feat(notebook): scaffold + data loader"
```

---

### Task 10: Notebook §1 — Types of analysis

**Files:**
- Modify: `experiments/analysis/output_analysis.ipynb`

- [ ] **Step 1: Append §1 section marker (Markdown cell)**

```markdown
## §1 — Types of Analysis

We demonstrate three analysis types the model supports:

1. **Descriptive** — marginal distributions of KPIs in the baseline-A and baseline-B cells.
2. **Comparative** — paired t-test, effect size, bootstrap CI, and Holm-Bonferroni-corrected summary of A-vs-B at the baseline staffing level.
3. **Factorial / interaction** — deferred to §2.
```

- [ ] **Step 2: Descriptive distributions cell**

```python
base_A = runs[runs['is_baseline_A']].copy()
base_B = runs[runs['is_baseline_B']].copy()
assert len(base_A) == 30 and len(base_B) == 30

desc_rows = []
for kpi in PRIMARY_KPIS:
    for label, df in [('A (nurses only)', base_A), ('B (nurses + robots)', base_B)]:
        s = df[kpi]
        desc_rows.append({
            'KPI':    KPI_LABELS[kpi],
            'Scenario': label,
            'n':      len(s),
            'mean':   s.mean(),
            'std':    s.std(ddof=1),
            'min':    s.min(),
            'max':    s.max(),
            'median': s.median(),
        })
desc_df = pd.DataFrame(desc_rows)
print(tabulate(desc_df, headers='keys', tablefmt='github', floatfmt='.3f'))
(TAB_DIR / '01_descriptive.md').write_text(
    tabulate(desc_df, headers='keys', tablefmt='github', floatfmt='.3f')
)
```

- [ ] **Step 3: Boxplot + CDF figure**

```python
fig, axes = plt.subplots(2, len(PRIMARY_KPIS), figsize=(4 * len(PRIMARY_KPIS), 6),
                         constrained_layout=True)
for i, kpi in enumerate(PRIMARY_KPIS):
    ax_box = axes[0, i]
    ax_cdf = axes[1, i]
    for label, df, colour in [
        ('A', base_A, '#3F7E5A'),
        ('B', base_B, '#0D9488'),
    ]:
        vals = np.sort(df[kpi].values)
        cdf  = np.arange(1, len(vals) + 1) / len(vals)
        ax_cdf.plot(vals, cdf, label=label, color=colour, lw=2)
    sns.boxplot(
        data=pd.concat([
            base_A.assign(scenario='A'),
            base_B.assign(scenario='B'),
        ]),
        x='scenario', y=kpi, ax=ax_box, palette=['#3F7E5A', '#0D9488'],
    )
    ax_box.set_title(KPI_LABELS[kpi], fontsize=10)
    ax_box.set_xlabel('')
    ax_cdf.set_xlabel(KPI_LABELS[kpi], fontsize=9)
    ax_cdf.set_ylabel('CDF')
    ax_cdf.legend(loc='lower right', fontsize=8)
plt.suptitle('§1 — Per-scenario KPI distributions (baseline staffing)', fontsize=12)
plt.savefig(FIG_DIR / '01_descriptive_boxplot_cdf.png')
plt.show()
```

- [ ] **Step 4: Paired t-test + bootstrap + effect size**

```python
def paired_analysis(a_vals, b_vals, n_boot=10000, rng_seed=2026):
    """Paired t, Cohen's d_z, and bootstrap CI of the mean difference."""
    d = a_vals - b_vals
    t_stat, p_val = stats.ttest_rel(a_vals, b_vals)
    dz = d.mean() / d.std(ddof=1) if d.std(ddof=1) > 0 else 0.0
    rng = np.random.default_rng(rng_seed)
    idx = rng.integers(0, len(d), size=(n_boot, len(d)))
    boot_means = d.values[idx].mean(axis=1)
    ci = np.quantile(boot_means, [0.025, 0.975])
    return {
        'mean_diff':    d.mean(),
        't':            t_stat,
        'p':            p_val,
        'cohen_dz':     dz,
        'boot_ci_low':  ci[0],
        'boot_ci_high': ci[1],
    }

# Sort both by seed so the per-seed pairing is exact
base_A = base_A.sort_values('seed').reset_index(drop=True)
base_B = base_B.sort_values('seed').reset_index(drop=True)
assert (base_A['seed'].values == base_B['seed'].values).all()

pair_rows = []
for kpi in PRIMARY_KPIS:
    r = paired_analysis(base_A[kpi], base_B[kpi])
    pair_rows.append({
        'KPI':          KPI_LABELS[kpi],
        'mean_A':       base_A[kpi].mean(),
        'mean_B':       base_B[kpi].mean(),
        'mean_diff':    r['mean_diff'],
        'paired_t':     r['t'],
        'p_raw':        r['p'],
        'cohen_dz':     r['cohen_dz'],
        'boot95_low':   r['boot_ci_low'],
        'boot95_high':  r['boot_ci_high'],
    })
pair_df = pd.DataFrame(pair_rows)

# Holm-Bonferroni correction on raw p-values
ps = pair_df['p_raw'].values
order = np.argsort(ps)
m = len(ps)
adj = np.zeros_like(ps)
prev = 0.0
for rank, i in enumerate(order):
    adj[i] = max(prev, min(1.0, (m - rank) * ps[i]))
    prev = adj[i]
pair_df['p_holm'] = adj
pair_df['sig_holm'] = np.where(pair_df['p_holm'] < 0.05, '✓', '')

print(tabulate(pair_df, headers='keys', tablefmt='github', floatfmt='.4f'))
(TAB_DIR / '01_paired_comparison.md').write_text(
    tabulate(pair_df, headers='keys', tablefmt='github', floatfmt='.4f')
)
```

- [ ] **Step 5: Zero-inflation check for critical incidents**

```python
zero_frac_A = (base_A['criticalIncidentCount'] == 0).mean()
zero_frac_B = (base_B['criticalIncidentCount'] == 0).mean()
print(f"Zero-inflation in A: {zero_frac_A:.0%}")
print(f"Zero-inflation in B: {zero_frac_B:.0%}")

if max(zero_frac_A, zero_frac_B) > 0.5:
    u_stat, p_u = stats.mannwhitneyu(
        base_A['criticalIncidentCount'], base_B['criticalIncidentCount'],
        alternative='two-sided',
    )
    print(f"Mann-Whitney U on criticalIncidentCount: U={u_stat:.1f}, p={p_u:.4f}")
    with open(TAB_DIR / '01_critical_nonparametric.md', 'w') as f:
        f.write(f"Mann-Whitney U test (critical incidents)\n\n")
        f.write(f"- Zero-inflation A: {zero_frac_A:.0%}, B: {zero_frac_B:.0%}\n")
        f.write(f"- U = {u_stat:.1f}\n")
        f.write(f"- p = {p_u:.4f}\n")
```

- [ ] **Step 6: Run all §1 cells, verify outputs**

Expected: four table rows per KPI, figure `01_descriptive_boxplot_cdf.png` created with 2 rows × 5 columns of panels, paired-t table shows effect direction.

- [ ] **Step 7: Commit**

```bash
git add experiments/analysis/output_analysis.ipynb experiments/report/
git commit -m "feat(notebook): §1 types of analysis — descriptive + paired comparison"
```

---

### Task 11: Notebook §2 — Sensitivity analysis

**Files:**
- Modify: `experiments/analysis/output_analysis.ipynb`

- [ ] **Step 1: Section marker**

```markdown
## §2 — Sensitivity Analysis

We use the 108-cell factorial to separate main effects and the two 5-level OAT sweeps to probe load-response curves. The centrepiece is the nurse × MEDi interaction heatmap, which directly answers the generalisability question.
```

- [ ] **Step 2: Standardised main-effects linear model → tornado plot**

```python
factors_for_model = ['NURSE_COUNT', 'MEDI_COUNT', 'BLANKI_COUNT', 'EDI_COUNT']
effects_rows = []
for kpi in PRIMARY_KPIS:
    # Fit OLS with centred, unit-variance factors so coefficients are directly comparable
    X = fact[factors_for_model].copy()
    X = (X - X.mean()) / X.std(ddof=0)
    y = fact[kpi]
    df_fit = X.assign(y=y.values)
    model = smf.ols(f"y ~ NURSE_COUNT + MEDI_COUNT + BLANKI_COUNT + EDI_COUNT", data=df_fit).fit()
    for factor in factors_for_model:
        effects_rows.append({
            'KPI':       KPI_LABELS[kpi],
            'Factor':    factor,
            'Std_Coef':  model.params[factor],
            'p':         model.pvalues[factor],
            'CI_low':    model.conf_int().loc[factor, 0],
            'CI_high':   model.conf_int().loc[factor, 1],
        })
effects_df = pd.DataFrame(effects_rows)

# Tornado: one subplot per KPI, horizontal bars ordered by |coef|
fig, axes = plt.subplots(1, len(PRIMARY_KPIS), figsize=(4 * len(PRIMARY_KPIS), 3.5),
                         constrained_layout=True, sharey=True)
for ax, kpi in zip(axes, PRIMARY_KPIS):
    sub = effects_df[effects_df['KPI'] == KPI_LABELS[kpi]].copy()
    sub = sub.reindex(sub['Std_Coef'].abs().sort_values(ascending=True).index)
    colours = np.where(sub['Std_Coef'] < 0, '#0D9488', '#D97706')
    ax.barh(sub['Factor'], sub['Std_Coef'], color=colours,
            xerr=[sub['Std_Coef'] - sub['CI_low'], sub['CI_high'] - sub['Std_Coef']],
            capsize=3)
    ax.axvline(0, color='k', lw=0.8)
    ax.set_title(KPI_LABELS[kpi], fontsize=10)
    ax.set_xlabel('Standardised coef.', fontsize=9)
plt.suptitle('§2 — Standardised main-effects tornado (factorial data)', fontsize=12)
plt.savefig(FIG_DIR / '02_tornado_main_effects.png')
plt.show()

(TAB_DIR / '02_main_effects.md').write_text(
    tabulate(effects_df, headers='keys', tablefmt='github', floatfmt='.4f')
)
```

- [ ] **Step 3: Nurse × MEDi interaction heatmap (BLANKi=EDi=1)**

```python
slice_df = fact[(fact['BLANKI_COUNT'] == 1) & (fact['EDI_COUNT'] == 1)].copy()
assert slice_df['cellId'].nunique() == len(NURSE_LEVELS := [3, 5, 7]) * 4

fig, axes = plt.subplots(1, 2, figsize=(12, 4.5), constrained_layout=True)
for ax, kpi, cmap in [
    (axes[0], 'meanEmergencyResponseTime', 'mako_r'),
    (axes[1], 'criticalIncidentCount',      'rocket_r'),
]:
    pivot = slice_df.groupby(['NURSE_COUNT', 'MEDI_COUNT'])[kpi].mean().unstack('MEDI_COUNT')
    sns.heatmap(pivot, annot=True, fmt='.2f', cmap=cmap, ax=ax,
                cbar_kws={'label': KPI_LABELS.get(kpi, kpi)})
    ax.set_title(f'{KPI_LABELS[kpi]}\n(BLANKi=1, EDi=1)', fontsize=10)
    ax.set_xlabel('MEDi count')
    ax.set_ylabel('Nurse count')
plt.suptitle('§2 — Nurse × MEDi interaction', fontsize=12)
plt.savefig(FIG_DIR / '02_interaction_heatmap.png')
plt.show()
```

- [ ] **Step 4: Facet plot — wait times across robot fleet sizes**

```python
melted = fact.melt(
    id_vars=['NURSE_COUNT', 'MEDI_COUNT', 'BLANKI_COUNT', 'EDI_COUNT'],
    value_vars=['meanWaitTime_emergency', 'meanWaitTime_medication'],
    var_name='KPI', value_name='value',
)
melted['fleet_total'] = melted['MEDI_COUNT'] + melted['BLANKI_COUNT'] + melted['EDI_COUNT']

g = sns.catplot(
    data=melted, kind='box',
    x='fleet_total', y='value', col='NURSE_COUNT', row='KPI',
    sharey=False, height=3, aspect=1.3, palette='mako_r',
)
g.set_titles('Nurses={col_name} · {row_name}')
g.set_axis_labels('Total robot fleet size', 'Wait time (ticks)')
plt.savefig(FIG_DIR / '02_waittime_vs_fleet.png', bbox_inches='tight', dpi=300)
plt.show()
```

- [ ] **Step 5: OAT curves**

```python
oat = runs[runs['block'].isin(['oat_medication', 'oat_emergency'])].copy()

fig, axes = plt.subplots(2, len(PRIMARY_KPIS), figsize=(4 * len(PRIMARY_KPIS), 6),
                         constrained_layout=True, sharex='row')
for r, block in enumerate(['oat_medication', 'oat_emergency']):
    sub = oat[oat['block'] == block]
    rate_col = 'needSpawn_medication' if block == 'oat_medication' else 'needSpawn_emergency'
    for c, kpi in enumerate(PRIMARY_KPIS):
        ax = axes[r, c]
        agg = sub.groupby(rate_col)[kpi].agg(['mean', 'std', 'count']).reset_index()
        agg['sem'] = agg['std'] / np.sqrt(agg['count'])
        ax.errorbar(agg[rate_col], agg['mean'], yerr=1.96 * agg['sem'],
                    fmt='-o', color='#0D9488', capsize=3)
        ax.set_title(KPI_LABELS[kpi], fontsize=9)
        ax.set_xlabel(rate_col, fontsize=8)
        if c == 0:
            ax.set_ylabel(f'{"Medication" if block == "oat_medication" else "Emergency"} sweep')
plt.suptitle('§2 — OAT sensitivity curves (95% CI)', fontsize=12)
plt.savefig(FIG_DIR / '02_oat_curves.png')
plt.show()
```

- [ ] **Step 6: Run all §2 cells**

Expected: four figures (`02_tornado_main_effects.png`, `02_interaction_heatmap.png`, `02_waittime_vs_fleet.png`, `02_oat_curves.png`) + one table (`02_main_effects.md`).

- [ ] **Step 7: Commit**

```bash
git add experiments/analysis/output_analysis.ipynb experiments/report/
git commit -m "feat(notebook): §2 sensitivity — tornado + interaction heatmap + OAT curves"
```

---

### Task 12: Notebook §3 — Steady-state vs non-steady-state

**Files:**
- Modify: `experiments/analysis/output_analysis.ipynb`

- [ ] **Step 1: Section marker + framing**

```markdown
## §3 — Steady-State vs Non-Steady-State

The ward-shift simulation is a **terminating** simulation: one 8-hour shift with defined start and end. There is no long-run steady state — real wards have discrete shift handovers and diurnal arrival patterns. Therefore:

- **Methodology:** method of independent replications (which `BatchRunner` implements), not batch-means / initial-transient deletion on an infinite-horizon run.
- **Warm-up:** still useful to discard initial-empty-ward transient. We verify the 50-tick choice empirically with Welch's graphical method.
```

- [ ] **Step 2: Welch's graphical method — cumulative mean across replications**

```python
# Average across replications at each tick, then moving-window smooth
avg_by_tick = ticks.groupby('tick').agg({
    'averagePatientHealth': 'mean',
    'activeNeedCount':      'mean',
    'nurseUtilisation':     'mean',
}).reset_index()

def welch_smooth(series, window):
    return series.rolling(window, min_periods=1, center=True).mean()

WINDOW = 25
avg_by_tick['health_w']   = welch_smooth(avg_by_tick['averagePatientHealth'], WINDOW)
avg_by_tick['needs_w']    = welch_smooth(avg_by_tick['activeNeedCount'],      WINDOW)
avg_by_tick['nurseutil_w']= welch_smooth(avg_by_tick['nurseUtilisation'],     WINDOW)

fig, axes = plt.subplots(3, 1, figsize=(10, 8), constrained_layout=True, sharex=True)
for ax, col, raw, label in [
    (axes[0], 'health_w',    'averagePatientHealth', 'Avg patient health'),
    (axes[1], 'needs_w',     'activeNeedCount',      'Active needs'),
    (axes[2], 'nurseutil_w', 'nurseUtilisation',     'Nurse utilisation'),
]:
    ax.plot(avg_by_tick['tick'], avg_by_tick[raw], alpha=0.2, color='#57534E', label='Raw mean')
    ax.plot(avg_by_tick['tick'], avg_by_tick[col], lw=2, color='#0D9488',
            label=f'Welch-smoothed (window={WINDOW})')
    ax.axvline(50, color='#EF4444', lw=1.2, ls='--', label='Current warm-up (tick 50)')
    ax.set_ylabel(label, fontsize=10)
    ax.legend(loc='best', fontsize=8)
axes[-1].set_xlabel('Tick')
plt.suptitle("§3 — Welch's graphical method on baseline-B tick history\n(averaged across 30 replications)", fontsize=12)
plt.savefig(FIG_DIR / '03_welch_graphical.png')
plt.show()
```

- [ ] **Step 3: Quantify warm-up transient**

```python
# Define "transient ends" as the tick at which the smoothed series first enters
# a 5% band around its post-tick-200 mean.
def first_in_band(ticks_arr, values, ref_start=200, band=0.05):
    ref = values[ticks_arr >= ref_start].mean()
    lo, hi = ref * (1 - band), ref * (1 + band)
    within = (values >= lo) & (values <= hi)
    for t, ok in zip(ticks_arr, within):
        if ok:
            return t
    return np.nan

warmup_rows = []
for raw_col, label in [
    ('averagePatientHealth', 'Avg patient health'),
    ('activeNeedCount',      'Active needs'),
    ('nurseUtilisation',     'Nurse utilisation'),
]:
    smoothed = welch_smooth(avg_by_tick[raw_col], WINDOW).values
    entry = first_in_band(avg_by_tick['tick'].values, smoothed)
    warmup_rows.append({'KPI': label, 'Transient ends at tick': entry})
warmup_df = pd.DataFrame(warmup_rows)
print(tabulate(warmup_df, headers='keys', tablefmt='github'))
(TAB_DIR / '03_warmup.md').write_text(tabulate(warmup_df, headers='keys', tablefmt='github'))

recommended = int(np.nanmax(warmup_df['Transient ends at tick']))
current     = 50
print(f"Recommended warm-up: {recommended} ticks")
print(f"Current setting:     {current} ticks")
print("→ 50 ticks is", "ADEQUATE" if recommended <= current else "POSSIBLY TOO SHORT")
```

- [ ] **Step 4: Run both cells**

Expected: figure `03_welch_graphical.png` shows three stacked panels with the dashed red line at tick 50; table reports the first-in-band tick for each KPI; final print declares ADEQUATE or POSSIBLY TOO SHORT.

- [ ] **Step 5: Commit**

```bash
git add experiments/analysis/output_analysis.ipynb experiments/report/
git commit -m "feat(notebook): §3 steady-state discussion with Welch's graphical method"
```

---

### Task 13: Notebook §4 — Accuracy of the sample mean

**Files:**
- Modify: `experiments/analysis/output_analysis.ipynb`

- [ ] **Step 1: Section marker**

```markdown
## §4 — Accuracy of the Sample Mean

For each primary KPI at baseline-B we report mean, SD, 95% CI (t-distribution), half-width, and relative precision. We compute the required replication count `n*` for ±10% absolute precision and plot CI half-width convergence.
```

- [ ] **Step 2: Precision table**

```python
from math import ceil

def ci_t(sample, alpha=0.05):
    n  = len(sample)
    m  = sample.mean()
    s  = sample.std(ddof=1)
    se = s / np.sqrt(n)
    t_crit = stats.t.ppf(1 - alpha / 2, n - 1)
    h = t_crit * se
    return m, s, h, (m - h), (m + h), n, t_crit

rows = []
for kpi in PRIMARY_KPIS:
    sample = base_B[kpi].values
    m, s, h, lo, hi, n, t_crit = ci_t(sample)
    delta = 0.10 * abs(m) if m != 0 else 1.0
    n_req = ceil((t_crit * s / delta) ** 2) if m != 0 else np.nan
    rows.append({
        'KPI':            KPI_LABELS[kpi],
        'n':              n,
        'mean':           m,
        'std':            s,
        'CI95_low':       lo,
        'CI95_high':      hi,
        'half_width':     h,
        'rel_precision':  h / abs(m) if m != 0 else np.nan,
        'n_required_10pct': n_req,
        'adequate':       'YES' if n >= n_req else 'NO',
    })
accuracy_df = pd.DataFrame(rows)
print(tabulate(accuracy_df, headers='keys', tablefmt='github', floatfmt='.4f'))
(TAB_DIR / '04_accuracy.md').write_text(
    tabulate(accuracy_df, headers='keys', tablefmt='github', floatfmt='.4f')
)
```

- [ ] **Step 3: Running-mean convergence plot**

```python
fig, axes = plt.subplots(1, len(PRIMARY_KPIS), figsize=(4 * len(PRIMARY_KPIS), 3.5),
                         constrained_layout=True)
for ax, kpi in zip(axes, PRIMARY_KPIS):
    # Sort by seed so the running mean is deterministic and reproducible
    vals = base_B.sort_values('seed')[kpi].values
    running_mean = np.cumsum(vals) / np.arange(1, len(vals) + 1)
    running_std  = np.array([
        vals[:i+1].std(ddof=1) if i > 0 else 0.0 for i in range(len(vals))
    ])
    n_arr = np.arange(1, len(vals) + 1)
    with np.errstate(divide='ignore', invalid='ignore'):
        t_crit = stats.t.ppf(0.975, np.maximum(n_arr - 1, 1))
        half_w = t_crit * running_std / np.sqrt(n_arr)
    ax.plot(n_arr, running_mean, color='#0D9488', lw=2, label='Running mean')
    ax.fill_between(n_arr, running_mean - half_w, running_mean + half_w,
                    alpha=0.25, color='#0D9488', label='95% CI')
    ax.set_title(KPI_LABELS[kpi], fontsize=10)
    ax.set_xlabel('Number of replications')
    ax.set_ylabel('Mean')
    ax.legend(fontsize=8)
plt.suptitle('§4 — Running mean ± 95% CI vs replication count (baseline-B)', fontsize=12)
plt.savefig(FIG_DIR / '04_running_mean.png')
plt.show()
```

- [ ] **Step 4: Normality check for CI validity**

```python
norm_rows = []
for kpi in PRIMARY_KPIS:
    w, p = stats.shapiro(base_B[kpi])
    norm_rows.append({
        'KPI':        KPI_LABELS[kpi],
        'Shapiro_W':  w,
        'p':          p,
        'normal_05':  'YES' if p > 0.05 else 'NO',
    })
normality_df = pd.DataFrame(norm_rows)
print(tabulate(normality_df, headers='keys', tablefmt='github', floatfmt='.4f'))
(TAB_DIR / '04_normality.md').write_text(
    tabulate(normality_df, headers='keys', tablefmt='github', floatfmt='.4f')
)
```

- [ ] **Step 5: Run all §4 cells, verify outputs**

Expected: figure `04_running_mean.png` with 5 panels (one per KPI) showing convergence, tables `04_accuracy.md` + `04_normality.md` with entries for each KPI, `adequate` column is YES or NO per KPI.

- [ ] **Step 6: Commit**

```bash
git add experiments/analysis/output_analysis.ipynb experiments/report/
git commit -m "feat(notebook): §4 accuracy of the sample mean — precision table + convergence"
```

---

### Task 14: End-to-end notebook run — all figures and tables produced

**Files:** none modified — verification task.

- [ ] **Step 1: Restart kernel and run all cells**

In Jupyter: Kernel → Restart & Run All. Confirm no cell raises.

- [ ] **Step 2: Confirm all artifacts exist**

```bash
ls experiments/report/figures/ | sort
ls experiments/report/tables/ | sort
```

Expected figures (exactly this list):
```
01_descriptive_boxplot_cdf.png
02_interaction_heatmap.png
02_oat_curves.png
02_tornado_main_effects.png
02_waittime_vs_fleet.png
03_welch_graphical.png
04_running_mean.png
```

Expected tables:
```
01_descriptive.md
01_paired_comparison.md
02_main_effects.md
03_warmup.md
04_accuracy.md
04_normality.md
```
(plus optionally `01_critical_nonparametric.md` if zero-inflation was high.)

- [ ] **Step 3: Commit all report artifacts**

```bash
git add experiments/report/
git commit -m "data(report): regenerate all figures and tables from end-to-end notebook run"
```

---

## Phase 3 — Report generation (Task 15)

### Task 15: Claude authors `OUTPUT_ANALYSIS.md` from notebook outputs

**Files:**
- Create: `experiments/report/OUTPUT_ANALYSIS.md`

**Approach:** this is not a coding task. Invoke Claude Code with the context below and have it synthesise the narrative report from the figures and tables produced by the notebook.

- [ ] **Step 1: Assemble the context bundle**

Verify the following files exist (all produced by Task 14):

- `experiments/report/figures/*.png` — 7 figures
- `experiments/report/tables/*.md` — 5–6 markdown tables
- `experiments/results/canonical/manifest.json` — run metadata

- [ ] **Step 2: Invoke Claude with this prompt**

Paste into a fresh Claude Code session:

> Read every file in `experiments/report/figures/` and `experiments/report/tables/` and `experiments/results/canonical/manifest.json`. Read the project's `CLAUDE.md` and `docs/SIMULATION_SPEC.md` for framing.
>
> Author `experiments/report/OUTPUT_ANALYSIS.md` with this structure:
>
> 1. **Executive summary** (1 paragraph) — headline finding on whether CGH robots are useful for other hospitals.
> 2. **Simulation design recap** (0.5 page) — the two scenarios, the 118-cell sweep, 30 replications, 960-tick shift, the five primary KPIs.
> 3. **§1 — Types of analysis** — descriptive table, paired-comparison table, discussion of the effect of pairing + Holm correction. Reference `01_descriptive_boxplot_cdf.png` and the §1 tables.
> 4. **§2 — Sensitivity analysis** — tornado interpretation, interaction-heatmap interpretation, OAT-curve discussion. Centrepiece narrative: which hospitals benefit most. Reference all four §2 figures.
> 5. **§3 — Steady-state vs non-steady-state** — argue for the terminating-simulation framing; report whether 50-tick warm-up is empirically adequate. Reference `03_welch_graphical.png` and `03_warmup.md`.
> 6. **§4 — Accuracy of the sample mean** — report precision for each KPI, required-n results, normality caveats. Reference `04_running_mean.png` and `04_accuracy.md`.
> 7. **Generalisability to other hospitals** — one-page synthesis. Use the nurse × MEDi interaction heatmap to classify target hospitals by staffing and load and state which robot types are worth deploying in each regime. Draw a concrete, falsifiable conclusion.
> 8. **Limitations** — 5–7 bullets (single ward layout, single shift pattern, no diurnal variation, synthetic need rates, etc.).
>
> Constraints:
> - Cite figures as `![Figure N. Caption](figures/filename.png)` with numbered captions.
> - Embed tables by reading the corresponding `.md` file and pasting contents.
> - Every numeric claim must trace back to a table or figure. No invented numbers.
> - Use British English (SMA course convention).
> - Report should read as ~8–12 pages of markdown.

- [ ] **Step 3: Review the generated report**

Read `OUTPUT_ANALYSIS.md` end-to-end. Confirm:
- All four rubric sections present.
- Generalisability chapter draws a concrete conclusion, not a hedge.
- Every figure is referenced.
- No placeholder text like "TBD" or "[result]".

Edit by hand if sections are thin.

- [ ] **Step 4: Commit**

```bash
git add experiments/report/OUTPUT_ANALYSIS.md
git commit -m "docs(report): narrative output analysis report, all four rubric sections"
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task(s) |
|---|---|
| JS changes — `BatchRunner.js` | Task 2 |
| JS changes — `ExperimentRunner.js` (new) | Tasks 3, 4 |
| JS changes — `ExperimentPanel.js` | Task 5 |
| JS changes — `Statistics.js` unchanged | (no-op — verified by inspection) |
| Experimental Design — factorial | Task 3 |
| Experimental Design — OAT | Task 3 |
| Experimental Design — CRN | Task 3 (seed pattern) + Task 6 Step 3 (verified manually) |
| Execution + outputs | Task 7 |
| Notebook §1 Types of analysis | Task 10 |
| Notebook §2 Sensitivity analysis | Task 11 |
| Notebook §3 Steady-state | Task 12 |
| Notebook §4 Sample-mean accuracy | Task 13 |
| Primary KPI set emphasis | Tasks 10–13 (all use `PRIMARY_KPIS`) |
| Report generation | Task 15 |
| Reproducibility (seeds, manifest, git hash) | Tasks 3, 4, 7 |
| Verification end-to-end | Tasks 6, 7, 14 |

All spec items covered.

**Placeholder scan:** No "TBD"/"TODO". All code blocks are complete. All file paths are exact. All expected outputs are concrete.

**Type consistency:** `flattenResult` outputs the exact columns consumed in the notebook (`NURSE_COUNT`, `MEDI_COUNT`, `meanWaitTime_emergency`, …). `buildDesignGrid` cell IDs (`F_N5_M1_B1_E1`) match what the notebook uses as `BASELINE_B_CELL`. `PRIMARY_KPIS` list is identical across all notebook sections.
