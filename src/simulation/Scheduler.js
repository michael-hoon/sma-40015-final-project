/**
 * @fileoverview Tick scheduler. Executes the 8-step tick order from the spec EXACTLY.
 * Works without any DOM or browser APIs — pure ES module logic.
 *
 * Tick order (strict):
 *   1. Need generation (patients)
 *   2. Robot decisions
 *   3. Nurse decisions
 *   4. Movement
 *   5. Task execution
 *   6. State transitions (+ health recovery for fulfilled needs)
 *   7. Health drain
 *   8. Stats collection
 */
import SeededRandom from './SeededRandom.js';
import Grid from './Grid.js';
import NeedQueue from './NeedQueue.js';
import Patient from './Patient.js';
import Nurse from './Nurse.js';
import RobotMEDi from './RobotMEDi.js';
import RobotBLANKi from './RobotBLANKi.js';
import RobotEDi from './RobotEDi.js';
import Stats from './Stats.js';

export default class Scheduler {
  /**
   * @param {object} params
   * @param {import('../config.js').CONFIG} params.config
   * @param {number} params.seed - Random seed for this replication
   * @param {boolean} [params.includeRobots=false] - Scenario B when true
   * @param {boolean} [params.debugMode=false] - Log each tick phase to console
   */
  constructor({ config, seed, includeRobots = false, debugMode = false }) {
    this.config = config;
    this.seed = seed;
    this.includeRobots = includeRobots;
    this.debugMode = debugMode;
    this.currentTick = 0;

    this._rng = new SeededRandom(seed);
    this._grid = new Grid(config.GRID_LAYOUT);
    this._needQueue = new NeedQueue();
    this._stats = new Stats(config);

    this._patients = [];
    this._nurses = [];
    this._robots = [];

    this._initAgents();
  }

  /** @private — spawn agents at their designated grid positions */
  _initAgents() {
    const grid = this._grid;
    const beds = grid.getBeds();
    const nurseStations = grid.getNurseStations();
    const chargingBays = grid.getChargingBays();

    // Spawn patients — one per bed
    beds.forEach((pos, i) => {
      this._patients.push(new Patient({
        id: `patient_${i}`,
        position: pos,
        grid,
        config: this.config,
        needQueue: this._needQueue,
        rng: this._rng,
      }));
    });

    // Spawn nurses — cycle through nurse stations
    for (let i = 0; i < this.config.NURSE_COUNT; i++) {
      const pos = nurseStations.length > 0
        ? nurseStations[i % nurseStations.length]
        : { x: 1, y: 1 };
      this._nurses.push(new Nurse({
        id: `nurse_${i}`,
        position: { ...pos },
        grid,
        config: this.config,
        needQueue: this._needQueue,
        rng: this._rng,
      }));
    }

    if (!this.includeRobots) return;

    // MEDi robots — start at first charging bay
    const bayA = chargingBays[0] ?? { x: 0, y: grid.height - 1 };
    for (let i = 0; i < this.config.MEDI_COUNT; i++) {
      this._robots.push(new RobotMEDi({
        id: `medi_${i}`,
        position: { ...bayA },
        grid,
        config: this.config,
        needQueue: this._needQueue,
        rng: this._rng,
      }));
    }

    // BLANKi robots — start at second charging bay (or first if only one)
    const bayB = chargingBays[1] ?? bayA;
    for (let i = 0; i < this.config.BLANKI_COUNT; i++) {
      this._robots.push(new RobotBLANKi({
        id: `blanki_${i}`,
        position: { ...bayB },
        grid,
        config: this.config,
        needQueue: this._needQueue,
        rng: this._rng,
      }));
    }

    // EDi robots — start at entrance
    const entrances = grid.getEntrances();
    const ediStart = entrances[0] ?? bayA;
    for (let i = 0; i < this.config.EDI_COUNT; i++) {
      this._robots.push(new RobotEDi({
        id: `edi_${i}`,
        position: { ...ediStart },
        grid,
        config: this.config,
        needQueue: this._needQueue,
        rng: this._rng,
      }));
    }
  }

  /** @private */
  _dbg(step, msg) {
    if (this.debugMode) console.log(`[T=${this.currentTick}] Step ${step}: ${msg}`);
  }

  /**
   * Execute one full tick (all 8 steps in spec order).
   */
  tick() {
    const t = this.currentTick;

    // ── Step 1: Need Generation ───────────────────────────────────────────────
    let newNeedCount = 0;
    for (const patient of this._patients) {
      const prevCount = patient.activeNeeds.length;
      patient.generateNeeds(t);
      const newNeeds = patient.activeNeeds.slice(prevCount);
      for (const need of newNeeds) {
        this._stats.recordNeedGenerated(need.type, t);
        newNeedCount++;
      }
    }
    this._dbg(1, `Need Generation — ${newNeedCount} new need(s) posted`);

    // ── Step 2: Robot Decisions ───────────────────────────────────────────────
    const robotsClaiming = [];
    for (const robot of this._robots) {
      const prevNeed = robot.currentNeed;
      robot.decideAndClaim(t);
      if (robot.currentNeed && robot.currentNeed !== prevNeed) {
        robotsClaiming.push(`${robot.id} claimed ${robot.currentNeed.type}#${robot.currentNeed.id}`);
      }
    }
    this._dbg(2, `Robot Decisions — ${robotsClaiming.length ? robotsClaiming.join(', ') : 'none'}`);

    // ── Step 3: Nurse Decisions ───────────────────────────────────────────────
    const nursesClaiming = [];
    for (const nurse of this._nurses) {
      const prevNeed = nurse.currentNeed;
      nurse.decideAndClaim(t);
      if (nurse.currentNeed && nurse.currentNeed !== prevNeed) {
        nursesClaiming.push(`${nurse.id} claimed ${nurse.currentNeed.type}#${nurse.currentNeed.id}`);
      }
    }
    this._dbg(3, `Nurse Decisions — ${nursesClaiming.length ? nursesClaiming.join(', ') : 'none'}`);

    // ── Step 4: Movement ─────────────────────────────────────────────────────
    const moving = [];
    for (const nurse of this._nurses) {
      const before = `${nurse.position.x},${nurse.position.y}`;
      nurse.move(t);
      if (`${nurse.position.x},${nurse.position.y}` !== before) moving.push(nurse.id);
    }
    for (const robot of this._robots) {
      const before = `${robot.position.x},${robot.position.y}`;
      robot.move(t);
      if (`${robot.position.x},${robot.position.y}` !== before) moving.push(robot.id);
    }
    this._dbg(4, `Movement — ${moving.length ? moving.join(', ') + ' moved' : 'none moved'}`);

    // ── Step 5: Task Execution ────────────────────────────────────────────────
    for (const nurse of this._nurses) nurse.executeTask();
    for (const robot of this._robots) robot.executeTask();
    this._dbg(5, `Task Execution — ${[...this._nurses, ...this._robots].filter(a => a.state === 'SERVING').length} agent(s) serving`);

    // ── Step 6: State Transitions + Health Recovery ───────────────────────────
    const fulfilled = [];
    for (const nurse of this._nurses) {
      const fulfilledNeed = nurse.transitionState();
      if (fulfilledNeed) {
        this._stats.recordNeedFulfilled(fulfilledNeed, t);
        // patientId is the patient's exact id string (e.g. "patient_0")
        const patient = this._patients.find(p => p.id === fulfilledNeed.patientId);
        if (patient) patient.recoverHealth(fulfilledNeed.type);
        fulfilled.push(`${nurse.id}→${fulfilledNeed.type}#${fulfilledNeed.id}`);
      }
    }
    for (const robot of this._robots) {
      const fulfilledNeed = robot.transitionState();
      if (fulfilledNeed) {
        this._stats.recordNeedFulfilled(fulfilledNeed, t);
        const patient = this._patients.find(p => p.id === fulfilledNeed.patientId);
        if (patient) patient.recoverHealth(fulfilledNeed.type);
        fulfilled.push(`${robot.id}→${fulfilledNeed.type}#${fulfilledNeed.id}`);
      }
    }
    this._dbg(6, `State Transitions — ${fulfilled.length ? fulfilled.join(', ') : 'none fulfilled'}`);

    // ── Step 7: Health Drain ──────────────────────────────────────────────────
    let criticalCount = 0;
    for (const patient of this._patients) {
      const hadCritical = patient.drainHealth();
      if (hadCritical) {
        this._stats.recordCriticalIncident(t);
        criticalCount++;
      }
    }
    this._dbg(7, `Health Drain — ${criticalCount} critical incident(s) this tick`);

    // ── Step 8: Stats Collection ──────────────────────────────────────────────
    this._stats.collectTick({
      tick: t,
      needQueue: this._needQueue,
      patients: this._patients,
      nurses: this._nurses,
      robots: this._robots,
    });
    if (this.debugMode) {
      const snap = this._stats.tickHistory[this._stats.tickHistory.length - 1];
      this._dbg(8, `Stats — activeNeeds:${snap.activeNeedCount} nurseUtil:${(snap.nurseUtilisation*100).toFixed(0)}% avgHealth:${snap.averagePatientHealth.toFixed(1)} lowestHealth:${snap.lowestPatientHealth.toFixed(1)}`);
    }

    this.currentTick++;
  }

  /**
   * Run the simulation for the given number of ticks.
   * @param {number} [totalTicks] - Defaults to config.TICKS_PER_RUN
   */
  run(totalTicks) {
    const n = totalTicks ?? this.config.TICKS_PER_RUN;
    for (let i = 0; i < n; i++) {
      this.tick();
    }
  }

  /**
   * Return the per-replication KPI summary.
   * @returns {object}
   */
  getStats() {
    return this._stats.getSummary(this._needQueue);
  }

  /** Expose tick history for charting / debugging */
  getTickHistory() {
    return this._stats.tickHistory;
  }
}
