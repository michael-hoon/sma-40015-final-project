/**
 * Smoke test for Phase 1 simulation engine.
 * Runs headless (no DOM, no Pixi.js) using Node.js with --experimental-vm-modules
 * or simply via: node --input-type=module < test/smoke-test.js
 *
 * Usage:
 *   node test/smoke-test.js
 */
import { CONFIG } from '../src/config.js';
import Scheduler from '../src/simulation/Scheduler.js';

function printSummary(label, summary) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(` ${label}`);
  console.log('='.repeat(60));
  console.log(`  Critical incidents    : ${summary.criticalIncidentCount}`);
  console.log(`  Mean nurse util.      : ${(summary.meanNurseUtilisation * 100).toFixed(1)}%`);
  console.log(`  Mean robot util.      : ${(summary.meanRobotUtilisation * 100).toFixed(1)}%`);
  console.log(`  Mean emergency resp.  : ${summary.meanEmergencyResponseTime.toFixed(2)} ticks`);
  console.log(`  Unfulfilled at end    : ${summary.needsUnfulfilledAtEnd}`);
  console.log(`  Wait times (ticks):`);
  for (const [type, val] of Object.entries(summary.meanWaitTime)) {
    console.log(`    ${type.padEnd(16)}: ${val.toFixed(2)}`);
  }
  console.log(`  Needs generated:`);
  for (const [type, val] of Object.entries(summary.totalNeedsGenerated)) {
    console.log(`    ${type.padEnd(16)}: ${val}`);
  }
  console.log(`  Needs fulfilled:`);
  for (const [type, val] of Object.entries(summary.totalNeedsFulfilled)) {
    console.log(`    ${type.padEnd(16)}: ${val}`);
  }
}

function summaryToString(s) {
  return JSON.stringify({
    criticalIncidentCount: s.criticalIncidentCount,
    meanNurseUtilisation: s.meanNurseUtilisation.toFixed(6),
    meanRobotUtilisation: s.meanRobotUtilisation.toFixed(6),
    meanEmergencyResponseTime: s.meanEmergencyResponseTime.toFixed(6),
    needsUnfulfilledAtEnd: s.needsUnfulfilledAtEnd,
    meanWaitTime: Object.fromEntries(
      Object.entries(s.meanWaitTime).map(([k, v]) => [k, v.toFixed(6)])
    ),
    totalNeedsGenerated: s.totalNeedsGenerated,
    totalNeedsFulfilled: s.totalNeedsFulfilled,
  });
}

const TICKS = 100;

// ── Run 1: Scenario A (nurses only), seed = 1 ─────────────────────────────
const schedA1 = new Scheduler({ config: CONFIG, seed: 1, includeRobots: false });
schedA1.run(TICKS);
const summaryA1 = schedA1.getStats();
printSummary('Scenario A — Nurses Only (seed=1, 100 ticks)', summaryA1);

// ── Run 2: Scenario B (nurses + robots), seed = 1 ─────────────────────────
const schedB1 = new Scheduler({ config: CONFIG, seed: 1, includeRobots: true });
schedB1.run(TICKS);
const summaryB1 = schedB1.getStats();
printSummary('Scenario B — Nurses + Robots (seed=1, 100 ticks)', summaryB1);

// ── Run 3: Determinism check — Scenario A with seed=1 again ───────────────
const schedA2 = new Scheduler({ config: CONFIG, seed: 1, includeRobots: false });
schedA2.run(TICKS);
const summaryA2 = schedA2.getStats();

const strA1 = summaryToString(summaryA1);
const strA2 = summaryToString(summaryA2);

console.log('\n' + '='.repeat(60));
console.log(' Determinism Check');
console.log('='.repeat(60));
if (strA1 === strA2) {
  console.log('  PASS — Both Scenario A runs with seed=1 produced identical KPI output.');
} else {
  console.error('  FAIL — Outputs differ! Simulation is not deterministic.');
  console.error('  Run 1:', strA1);
  console.error('  Run 2:', strA2);
  process.exit(1);
}

console.log('\nSmoke test complete.\n');
