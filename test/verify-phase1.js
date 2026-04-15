/**
 * Phase 1 Verification Test Suite
 * Checks all 8 correctness requirements without any DOM/browser APIs.
 * Run: node test/verify-phase1.js
 */
import { CONFIG } from '../src/config.js';
import Scheduler from '../src/simulation/Scheduler.js';
import Grid from '../src/simulation/Grid.js';
import NeedQueue from '../src/simulation/NeedQueue.js';
import SeededRandom from '../src/simulation/SeededRandom.js';
import Patient from '../src/simulation/Patient.js';
import Nurse from '../src/simulation/Nurse.js';
import RobotMEDi from '../src/simulation/RobotMEDi.js';
import RobotBLANKi from '../src/simulation/RobotBLANKi.js';
import RobotEDi from '../src/simulation/RobotEDi.js';

// ── Test harness ─────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, message) {
  if (condition) {
    console.log(`    ✓ ${message}`);
    passed++;
  } else {
    console.error(`    ✗ FAIL: ${message}`);
    failed++;
    failures.push(message);
  }
}

function section(title) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(` ${title}`);
  console.log('─'.repeat(60));
}

/** Minimal shared components for unit tests */
function makeMinimalEnv(seed = 42) {
  const grid = new Grid(CONFIG.GRID_LAYOUT);
  const needQueue = new NeedQueue();
  const rng = new SeededRandom(seed);
  // First walkable corridor cell (approach to first bed)
  const idlePos = { x: 1, y: 2 };
  return { grid, needQueue, rng, idlePos };
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 1: Determinism — two runs with same seed produce byte-identical KPIs
// ─────────────────────────────────────────────────────────────────────────────
section('Test 1 — Determinism (same seed → identical KPIs)');

function kpiKey(s) {
  return JSON.stringify({
    critical: s.criticalIncidentCount,
    nurseUtil: s.meanNurseUtilisation.toFixed(8),
    robotUtil: s.meanRobotUtilisation.toFixed(8),
    emergency: s.meanEmergencyResponseTime.toFixed(8),
    unfulfilled: s.needsUnfulfilledAtEnd,
    waitEmergency: s.meanWaitTime.emergency.toFixed(8),
    waitMed: s.meanWaitTime.medication.toFixed(8),
    waitComfort: s.meanWaitTime.comfort.toFixed(8),
    waitEscort: s.meanWaitTime.visitor_escort.toFixed(8),
    genE: s.totalNeedsGenerated.emergency,
    genM: s.totalNeedsGenerated.medication,
    genC: s.totalNeedsGenerated.comfort,
    genV: s.totalNeedsGenerated.visitor_escort,
  });
}

// Scenario A seed=7
const a7r1 = new Scheduler({ config: CONFIG, seed: 7, includeRobots: false });
a7r1.run(200);
const a7r2 = new Scheduler({ config: CONFIG, seed: 7, includeRobots: false });
a7r2.run(200);
assert(kpiKey(a7r1.getStats()) === kpiKey(a7r2.getStats()),
  'Scenario A seed=7: two 200-tick runs produce identical KPIs');

// Scenario B seed=13
const b13r1 = new Scheduler({ config: CONFIG, seed: 13, includeRobots: true });
b13r1.run(200);
const b13r2 = new Scheduler({ config: CONFIG, seed: 13, includeRobots: true });
b13r2.run(200);
assert(kpiKey(b13r1.getStats()) === kpiKey(b13r2.getStats()),
  'Scenario B seed=13: two 200-tick runs produce identical KPIs');

// Different seeds must differ (sanity check that RNG is actually working)
const a1 = new Scheduler({ config: CONFIG, seed: 1, includeRobots: false });
a1.run(200);
const a2 = new Scheduler({ config: CONFIG, seed: 2, includeRobots: false });
a2.run(200);
assert(kpiKey(a1.getStats()) !== kpiKey(a2.getStats()),
  'Different seeds produce different outputs (RNG is not constant)');

// ─────────────────────────────────────────────────────────────────────────────
// Test 2: Tick execution order — debug log shows steps 1–8 in strict order
// ─────────────────────────────────────────────────────────────────────────────
section('Test 2 — Tick execution order (debug log)');

{
  // Capture log output by monkey-patching console.log
  const logLines = [];
  const origLog = console.log;
  console.log = (...args) => logLines.push(args.join(' '));

  const sched = new Scheduler({ config: CONFIG, seed: 1, includeRobots: true, debugMode: true });
  sched.tick(); // run exactly 1 tick

  console.log = origLog;

  // Expect exactly 8 step-labelled lines per tick
  const stepLines = logLines.filter(l => l.match(/\[T=0\] Step \d:/));
  assert(stepLines.length === 8, `Exactly 8 step lines logged for 1 tick (got ${stepLines.length})`);

  // Verify they appear in order 1 through 8
  const stepNums = stepLines.map(l => parseInt(l.match(/Step (\d):/)[1]));
  const inOrder = stepNums.every((n, i) => n === i + 1);
  assert(inOrder, `Step numbers appear in order 1–8: ${stepNums.join(',')}`);

  // Print the actual log for visual inspection
  origLog('\n  [debug output for 1 tick]:');
  stepLines.forEach(l => origLog('  ' + l));
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 3: Nurses never claim a need already claimed by another agent
// ─────────────────────────────────────────────────────────────────────────────
section('Test 3 — No double-claiming across nurses');

{
  const { grid, needQueue, rng, idlePos } = makeMinimalEnv(1);

  // Post exactly one open need
  const openNeed = needQueue.postNeed({
    type: 'medication',
    patientId: 'patient_0',
    position: { x: 1, y: 1 },
    urgencyWeight: 5,
    createdAtTick: 0,
  });

  // Two nurses at the same position
  const n0 = new Nurse({ id: 'nurse_0', position: { ...idlePos }, grid, config: CONFIG, needQueue, rng });
  const n1 = new Nurse({ id: 'nurse_1', position: { ...idlePos }, grid, config: CONFIG, needQueue, rng });

  n0.decideAndClaim(1);
  n1.decideAndClaim(1);

  const claimCount = [n0, n1].filter(n => n.currentNeed !== null).length;
  assert(claimCount === 1, `Exactly 1 of 2 nurses claimed the single open need (got ${claimCount})`);

  const needStatus = openNeed.status;
  assert(needStatus === 'claimed', `Need status is 'claimed' after one nurse claimed it (got '${needStatus}')`);
}

// Nurse cannot claim a need already claimed by a robot
{
  const { grid, needQueue, rng, idlePos } = makeMinimalEnv(2);

  const robotNeed = needQueue.postNeed({
    type: 'medication',
    patientId: 'patient_0',
    position: { x: 1, y: 1 },
    urgencyWeight: 5,
    createdAtTick: 0,
  });

  const robot = new RobotMEDi({ id: 'medi_0', position: { ...idlePos }, grid, config: CONFIG, needQueue, rng });
  const nurse = new Nurse({ id: 'nurse_0', position: { ...idlePos }, grid, config: CONFIG, needQueue, rng });

  robot.decideAndClaim(); // Robot claims it first (step 2 order)
  nurse.decideAndClaim(1);

  assert(robot.currentNeed !== null, 'Robot claimed the medication need');
  assert(nurse.currentNeed === null, 'Nurse did NOT claim the already-robot-claimed need');
  assert(robotNeed.claimedBy === 'medi_0', `Need is claimed by robot (claimedBy='${robotNeed.claimedBy}')`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 4: Robots never claim emergency needs
// ─────────────────────────────────────────────────────────────────────────────
section('Test 4 — Robots never claim emergency needs');

{
  const { grid, needQueue, rng, idlePos } = makeMinimalEnv(3);

  const emergNeed = needQueue.postNeed({
    type: 'emergency',
    patientId: 'patient_0',
    position: { x: 1, y: 1 },
    urgencyWeight: 10,
    createdAtTick: 0,
  });

  const medi   = new RobotMEDi  ({ id: 'medi_0',   position: { ...idlePos }, grid, config: CONFIG, needQueue, rng });
  const blanki = new RobotBLANKi({ id: 'blanki_0', position: { ...idlePos }, grid, config: CONFIG, needQueue, rng });
  const edi    = new RobotEDi   ({ id: 'edi_0',    position: { ...idlePos }, grid, config: CONFIG, needQueue, rng });

  medi.decideAndClaim();
  blanki.decideAndClaim();
  edi.decideAndClaim();

  assert(emergNeed.status === 'open',
    "Emergency need remains 'open' after all three robot types attempt to claim");
  assert(medi.currentNeed === null,   'MEDi did not claim emergency need');
  assert(blanki.currentNeed === null, 'BLANKi did not claim emergency need');
  assert(edi.currentNeed === null,    'EDi did not claim emergency need');

  // A nurse CAN claim the emergency
  const nurse = new Nurse({ id: 'nurse_0', position: { ...idlePos }, grid, config: CONFIG, needQueue, rng });
  nurse.decideAndClaim(1);
  assert(nurse.currentNeed !== null && nurse.currentNeed.type === 'emergency',
    'Nurse successfully claimed the emergency need');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 5: EDi goes to ENTRANCE before going to patient
// ─────────────────────────────────────────────────────────────────────────────
section('Test 5 — EDi goes to ENTRANCE before MOVING_TO_PATIENT');

{
  const { grid, needQueue, rng } = makeMinimalEnv(4);
  const entrances = grid.getEntrances();
  assert(entrances.length > 0, `Grid has at least one ENTRANCE cell (found ${entrances.length})`);

  // Place EDi far from the entrance (middle of the ward)
  const ediStart = { x: 9, y: 7 };
  const edi = new RobotEDi({ id: 'edi_0', position: { ...ediStart }, grid, config: CONFIG, needQueue, rng });

  const escortNeed = needQueue.postNeed({
    type: 'visitor_escort',
    patientId: 'patient_0',
    position: { x: 1, y: 1 },
    urgencyWeight: 1,
    createdAtTick: 0,
  });

  edi.decideAndClaim();

  assert(edi.currentNeed !== null, 'EDi claimed the visitor_escort need');
  assert(edi.state === 'MOVING_TO_ENTRANCE',
    `EDi state is MOVING_TO_ENTRANCE immediately after claiming (got '${edi.state}')`);
  assert(edi.state !== 'MOVING_TO_PATIENT',
    'EDi state is NOT MOVING_TO_PATIENT right after claiming (must go to ENTRANCE first)');

  // Simulate movement until EDi reaches the entrance, then verify it switches to MOVING_TO_PATIENT
  let reachedEntrance = false;
  let switchedToPatient = false;
  for (let i = 0; i < 50; i++) {
    edi.move(i + 1);
    if (edi.state === 'MOVING_TO_PATIENT') {
      switchedToPatient = true;
      reachedEntrance = true;
      break;
    }
  }
  assert(reachedEntrance, 'EDi reached ENTRANCE within 50 movement ticks');
  assert(switchedToPatient, 'EDi transitioned to MOVING_TO_PATIENT after reaching ENTRANCE');
}

// Full simulation check — when EDi first enters MOVING_TO_PATIENT its position must
// be at an entrance cell (proving it passed through the entrance, possibly within the same tick).
// This is robust to the case where EDi starts at the entrance and transitions
// MOVING_TO_ENTRANCE → MOVING_TO_PATIENT within a single tick.
{
  const sched = new Scheduler({ config: CONFIG, seed: 5, includeRobots: true });
  const edis = sched._robots.filter(r => r.constructor.name === 'RobotEDi');
  const entranceCells = sched._grid.getEntrances();
  const isEntrance = pos => entranceCells.some(e => e.x === pos.x && e.y === pos.y);

  let escortSeen = false;
  let skippedEntrance = false; // true only if EDi entered MOVING_TO_PATIENT NOT from an entrance cell

  for (let i = 0; i < 200; i++) {
    const prevStates = edis.map(e => e.state);
    sched.tick();
    for (let j = 0; j < edis.length; j++) {
      const prev = prevStates[j];
      const curr = edis[j].state;
      // Detect the tick when EDi first enters MOVING_TO_PATIENT
      if (prev !== 'MOVING_TO_PATIENT' && curr === 'MOVING_TO_PATIENT') {
        // At this moment EDi must be positioned at an entrance cell
        if (!isEntrance(edis[j].position)) {
          skippedEntrance = true;
        }
        escortSeen = true;
      }
    }
  }
  assert(!skippedEntrance,
    'When EDi first enters MOVING_TO_PATIENT its position is always at an ENTRANCE cell');
  // Only assert escortSeen if visitor_escort needs were generated
  const summary = sched.getStats();
  if (summary.totalNeedsGenerated.visitor_escort > 0) {
    assert(escortSeen, 'At least one EDi entered MOVING_TO_PATIENT during 200-tick run');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 6: Robots go to charger when battery < 20, unclaiming current need
// ─────────────────────────────────────────────────────────────────────────────
section('Test 6 — Battery threshold: go to charger and unclaim need');

// 6a: IDLE robot with low battery calls _goCharge in decideAndClaim
{
  const { grid, needQueue, rng, idlePos } = makeMinimalEnv(5);
  const robot = new RobotMEDi({ id: 'medi_0', position: { ...idlePos }, grid, config: CONFIG, needQueue, rng });

  // Post a medication need so there's something to claim
  needQueue.postNeed({ type: 'medication', patientId: 'patient_0', position: { x: 1, y: 1 }, urgencyWeight: 5, createdAtTick: 0 });

  // Force battery below threshold
  robot.battery = 15;
  robot.decideAndClaim();

  assert(robot.state === 'MOVING_TO_CHARGER',
    `IDLE robot with battery=15 transitions to MOVING_TO_CHARGER (got '${robot.state}')`);
  assert(robot.currentNeed === null,
    'Robot with low battery did not claim any need');
}

// 6b: Robot with sufficient battery claims a need and begins moving;
//     when battery drops below threshold during transitionState it unclaims and heads to charger
{
  const { grid, needQueue, rng, idlePos } = makeMinimalEnv(6);
  const robot = new RobotMEDi({ id: 'medi_0', position: { ...idlePos }, grid, config: CONFIG, needQueue, rng });

  const need = needQueue.postNeed({ type: 'medication', patientId: 'patient_0', position: { x: 1, y: 1 }, urgencyWeight: 5, createdAtTick: 0 });

  // Battery just above threshold
  robot.battery = 21;
  robot.decideAndClaim();
  assert(robot.currentNeed !== null, 'Robot with battery=21 (above threshold) claimed a need');
  assert(robot.state === 'MOVING_TO_PATIENT', 'Robot is MOVING_TO_PATIENT after claiming');

  const claimedNeedId = robot.currentNeed.id;

  // Force battery to just under threshold, then call transitionState (step 6)
  robot.battery = 19;
  robot.transitionState();

  assert(robot.state === 'MOVING_TO_CHARGER',
    `Robot with battery=19 after transitionState is MOVING_TO_CHARGER (got '${robot.state}')`);
  assert(robot.currentNeed === null,
    'Robot unclaimed its need when battery dropped below threshold');
  assert(needQueue.getAll().find(n => n.id === claimedNeedId)?.status === 'open',
    "Abandoned need returned to 'open' status in NeedQueue");
}

// 6c: Battery threshold is exactly 20 — triggers charger (< 20 is threshold; test boundary)
{
  const { grid, needQueue, rng, idlePos } = makeMinimalEnv(7);
  const robot = new RobotMEDi({ id: 'medi_0', position: { ...idlePos }, grid, config: CONFIG, needQueue, rng });
  needQueue.postNeed({ type: 'medication', patientId: 'patient_0', position: { x: 1, y: 1 }, urgencyWeight: 5, createdAtTick: 0 });

  robot.battery = 20; // exactly at threshold — should NOT trigger (threshold means < 20)
  robot.decideAndClaim();
  assert(robot.state !== 'MOVING_TO_CHARGER',
    `Robot with battery exactly at threshold (20) does NOT go to charger (state='${robot.state}')`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 7: Health drain does NOT apply on the same tick a need is fulfilled
// ─────────────────────────────────────────────────────────────────────────────
section('Test 7 — Fulfilled need causes no health drain on same tick');

{
  const { grid, needQueue, rng } = makeMinimalEnv(8);
  const bedPos = { x: 1, y: 1 };

  const patient = new Patient({
    id: 'patient_0',
    position: bedPos,
    grid,
    config: CONFIG,
    needQueue,
    rng,
  });

  // Manually post one medication need
  const need = needQueue.postNeed({
    type: 'medication',
    patientId: 'patient_0',
    position: bedPos,
    urgencyWeight: 5,
    createdAtTick: 0,
  });
  patient.activeNeeds.push(need);

  const healthBefore = patient.health; // should be 100

  // Simulate step 6: fulfill the need and call recoverHealth (as Scheduler does)
  needQueue.fulfillNeed(need.id);
  patient.recoverHealth('medication');

  const healthAfterRecovery = patient.health;
  assert(healthAfterRecovery === Math.min(CONFIG.HEALTH_MAX, healthBefore + CONFIG.HEALTH_RECOVERY_PER_NEED),
    `Health increased by HEALTH_RECOVERY_PER_NEED after fulfillment (${healthBefore}→${healthAfterRecovery})`);

  // Simulate step 7: drainHealth — the fulfilled need must NOT drain
  const criticalOccurred = patient.drainHealth();
  const healthAfterDrain = patient.health;

  assert(healthAfterDrain === healthAfterRecovery,
    `Health unchanged by drainHealth after fulfillment (before=${healthAfterRecovery}, after=${healthAfterDrain})`);
  assert(!criticalOccurred,
    'No critical incident occurred (health stayed above 0)');
  assert(patient.activeNeeds.length === 0,
    `Fulfilled need removed from activeNeeds (count=${patient.activeNeeds.length})`);
}

// Multiple simultaneous needs — only unfulfilled ones drain
{
  const { grid, needQueue, rng } = makeMinimalEnv(9);
  const bedPos = { x: 1, y: 1 };

  const patient = new Patient({ id: 'patient_0', position: bedPos, grid, config: CONFIG, needQueue, rng });
  patient.health = 80;

  const medNeed = needQueue.postNeed({ type: 'medication', patientId: 'patient_0', position: bedPos, urgencyWeight: 5, createdAtTick: 0 });
  const comfortNeed = needQueue.postNeed({ type: 'comfort', patientId: 'patient_0', position: bedPos, urgencyWeight: 2, createdAtTick: 0 });
  patient.activeNeeds.push(medNeed, comfortNeed);

  // Fulfill only the medication need in step 6
  needQueue.fulfillNeed(medNeed.id);
  patient.recoverHealth('medication');

  const healthAfterRecovery = patient.health; // 80 + 5 = 85 (capped at 100)
  assert(healthAfterRecovery === 85, `Health after recovery: expected 85, got ${healthAfterRecovery}`);

  // Step 7 — only comfort need (0.3/tick) should drain, not medication
  patient.drainHealth();
  const expected = 85 - CONFIG.HEALTH_DRAIN_PER_TICK.comfort;
  assert(
    Math.abs(patient.health - expected) < 0.001,
    `After drain: only comfort need drains (expected ${expected.toFixed(3)}, got ${patient.health.toFixed(3)})`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 8: Patient health never exceeds 100 or goes below 0
// ─────────────────────────────────────────────────────────────────────────────
section('Test 8 — Health bounds: always in [0, 100]');

{
  // Run full 500-tick scenario A, collect all per-tick health readings
  const sched = new Scheduler({ config: CONFIG, seed: 99, includeRobots: false });
  sched.run(500);

  const history = sched.getTickHistory();
  const maxHealth = Math.max(...history.map(s => s.averagePatientHealth));
  const minHealth = Math.min(...history.map(s => s.lowestPatientHealth));

  assert(maxHealth <= 100,
    `averagePatientHealth never exceeds 100 (max observed = ${maxHealth.toFixed(3)})`);
  assert(minHealth >= 0,
    `lowestPatientHealth never goes below 0 (min observed = ${minHealth.toFixed(3)})`);

  // Also check individual patient health directly after run
  let anyAbove100 = false;
  let anyBelow0   = false;
  for (const patient of sched._patients) {
    if (patient.health > 100) anyAbove100 = true;
    if (patient.health < 0)   anyBelow0   = true;
  }
  assert(!anyAbove100, 'No individual patient.health > 100 at end of 500-tick run');
  assert(!anyBelow0,   'No individual patient.health < 0 at end of 500-tick run');
}

{
  // Stress test: scenario B (robots) 500 ticks with aggressive seed
  const sched = new Scheduler({ config: CONFIG, seed: 42, includeRobots: true });
  sched.run(500);

  const history = sched.getTickHistory();
  let violationTick = null;
  for (const snap of history) {
    if (snap.lowestPatientHealth < 0 || snap.averagePatientHealth > 100) {
      violationTick = snap.tick;
      break;
    }
  }
  assert(violationTick === null,
    `Scenario B: no health-bounds violation in 500-tick history (first violation tick = ${violationTick})`);
}

// Edge case: patient with many simultaneous needs accumulating drain
{
  const { grid, needQueue, rng } = makeMinimalEnv(10);
  const bedPos = { x: 1, y: 1 };
  const patient = new Patient({ id: 'patient_0', position: bedPos, grid, config: CONFIG, needQueue, rng });
  patient.health = 1; // start near 0

  // Post all 4 need types simultaneously
  for (const type of ['emergency', 'medication', 'comfort', 'visitor_escort']) {
    const n = needQueue.postNeed({ type, patientId: 'patient_0', position: bedPos, urgencyWeight: CONFIG.URGENCY_WEIGHT[type], createdAtTick: 0 });
    patient.activeNeeds.push(n);
  }

  const hadCritical = patient.drainHealth();
  assert(patient.health >= 0,
    `Health is >= 0 after critical incident (health=${patient.health.toFixed(2)}, hadCritical=${hadCritical})`);
  assert(patient.health <= 100,
    `Health is <= 100 after critical reset (health=${patient.health.toFixed(2)})`);
  assert(hadCritical, 'Critical incident correctly detected when health reaches 0');
  assert(patient.health === CONFIG.HEALTH_CRITICAL_RESET,
    `Health reset to HEALTH_CRITICAL_RESET=${CONFIG.HEALTH_CRITICAL_RESET} (got ${patient.health})`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${'═'.repeat(60)}`);
console.log(` Results: ${passed} passed, ${failed} failed`);
if (failures.length > 0) {
  console.error('\nFailed checks:');
  failures.forEach(f => console.error(`  ✗ ${f}`));
  process.exit(1);
} else {
  console.log(' All checks passed.');
}
console.log('═'.repeat(60) + '\n');
