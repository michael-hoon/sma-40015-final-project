/**
 * @fileoverview Experiment orchestration for the batch comparison panel.
 *
 * Exports:
 *   runExperiment(comp)  — async; drives BatchRunner for both scenarios,
 *                          computes statistics, populates Alpine comp state
 *   exportCSV(comp)      — creates and triggers download of results CSV
 */
import BatchRunner from '../simulation/BatchRunner.js';
import { descriptive, welchTest, sigStars } from '../analysis/Statistics.js';

/** KPI definitions — key path into sched.getStats() result */
const KPI_DEFS = [
  { key: 'criticalIncidentCount',        label: 'Critical Incidents',       unit: '',     scale: 1   },
  { key: 'meanEmergencyResponseTime',    label: 'Emergency Response Time',  unit: 'ticks', scale: 1  },
  { key: 'meanWaitTime.emergency',       label: 'Emergency Wait Time',      unit: 'ticks', scale: 1  },
  { key: 'meanWaitTime.medication',      label: 'Medication Wait Time',     unit: 'ticks', scale: 1  },
  { key: 'meanWaitTime.comfort',         label: 'Comfort Wait Time',        unit: 'ticks', scale: 1  },
  { key: 'needsUnfulfilledAtEnd',        label: 'Unfulfilled Needs at End', unit: '',     scale: 1   },
  { key: 'meanNurseUtilisation',         label: 'Nurse Utilisation',        unit: '%',    scale: 100 },
  { key: 'meanRobotUtilisation',         label: 'Robot Utilisation',        unit: '%',    scale: 100 },
];

/**
 * Extract a (possibly nested) value from a KPI result object.
 * @param {object} rep - Single replication summary
 * @param {string} key - Dot-separated path (e.g. "meanWaitTime.emergency")
 * @returns {number}
 */
function pluck(rep, key) {
  if (!key.includes('.')) return rep[key] ?? 0;
  const [k1, k2] = key.split('.');
  return (rep[k1]?.[k2]) ?? 0;
}

/**
 * Run the full 30×A + 30×B batch experiment and populate Alpine component state.
 *
 * Updated comp fields:
 *   expRunning {boolean}, expDone {boolean}, expProgress {number 0-60},
 *   expTotal {number}, expStatus {string}, expResults {object[]|null}
 *
 * @param {object} comp - Alpine reactive data proxy (simControl's `this`)
 * @returns {Promise<void>}
 */
export async function runExperiment(comp) {
  comp.expRunning  = true;
  comp.expDone     = false;
  comp.expProgress = 0;
  comp.expTotal    = 60;
  comp.expResults  = null;
  comp.expStatus   = 'Running Scenario A…';

  const runner = new BatchRunner();

  // ── Scenario A (Nurses Only) ────────────────────────────────────────────────
  const rawA = await runner.run('A', 30, (done) => {
    comp.expProgress = done;
    comp.expStatus   = `Scenario A — ${done} / 30 replications`;
  });

  comp.expStatus = 'Running Scenario B…';

  // ── Scenario B (Nurses + Robots) ────────────────────────────────────────────
  const rawB = await runner.run('B', 30, (done) => {
    comp.expProgress = 30 + done;
    comp.expStatus   = `Scenario B — ${done} / 30 replications`;
  });

  // ── Statistics ───────────────────────────────────────────────────────────────
  comp.expResults = KPI_DEFS.map(kpi => {
    const aVals = rawA.map(r => pluck(r, kpi.key) * kpi.scale);
    const bVals = rawB.map(r => pluck(r, kpi.key) * kpi.scale);

    const dA   = descriptive(aVals);
    const dB   = descriptive(bVals);
    const test = welchTest(aVals, bVals);

    return {
      label:  kpi.label,
      unit:   kpi.unit,
      dA,
      dB,
      test,
      stars:  sigStars(test.p),
    };
  });

  // Keep raw for CSV export
  comp._expRawA = rawA;
  comp._expRawB = rawB;

  comp.expRunning = false;
  comp.expDone    = true;
  comp.expStatus  = 'Complete — 30 replications × 2 scenarios';
}

/**
 * Build and trigger download of a CSV summarising the experiment results.
 *
 * Columns: KPI, Unit, A_Mean, A_Std, A_CI_Low, A_CI_High,
 *          B_Mean, B_Std, B_CI_Low, B_CI_High, t, df, p, Significant
 *
 * @param {object} comp - Alpine reactive data proxy
 */
export function exportCSV(comp) {
  const results = comp.expResults;
  if (!results?.length) return;

  const fmt = (v, dp = 4) => isFinite(v) ? v.toFixed(dp) : '0';

  const header = [
    'KPI', 'Unit',
    'A_Mean', 'A_Std', 'A_CI_Low', 'A_CI_High',
    'B_Mean', 'B_Std', 'B_CI_Low', 'B_CI_High',
    't_stat', 'df', 'p_value', 'Significant',
  ].join(',');

  const rows = results.map(r => [
    `"${r.label}"`,
    r.unit,
    fmt(r.dA.mean), fmt(r.dA.std), fmt(r.dA.ciLow), fmt(r.dA.ciHigh),
    fmt(r.dB.mean), fmt(r.dB.std), fmt(r.dB.ciLow), fmt(r.dB.ciHigh),
    fmt(r.test.t), fmt(r.test.df, 2), fmt(r.test.p), r.test.significant ? 'YES' : 'NO',
  ].join(','));

  const csv  = [header, ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = 'cgh_abm_experiment_results.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
