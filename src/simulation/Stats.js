/**
 * @fileoverview KPI collection. Gathers per-tick metrics and aggregates
 * per-replication summary statistics at end of run.
 */
export default class Stats {
  /**
   * @param {import('../config.js').CONFIG} config
   */
  constructor(config) {
    this.config = config;
    this._warmUpTicks = config.WARM_UP_TICKS;

    /** @type {object[]} Per-tick snapshot objects */
    this.tickHistory = [];

    // Accumulators (only count post-warm-up ticks)
    this._criticalIncidents = 0;
    this._totalNeedsGenerated = { emergency: 0, medication: 0, comfort: 0, visitor_escort: 0 };
    this._totalNeedsFulfilled = { emergency: 0, medication: 0, comfort: 0, visitor_escort: 0 };

    // Wait-time samples: list of wait durations (in ticks) per type
    this._waitTimeSamples = { emergency: [], medication: [], comfort: [], visitor_escort: [] };

    // Emergency response time samples (creation → nurse arrival)
    this._emergencyResponseTimes = [];

    // Nurse/robot utilisation per tick (post-warm-up)
    this._nurseUtilisationSamples = [];
    this._robotUtilisationSamples = [];
  }

  /**
   * Record a critical incident (health hit 0) for a patient.
   * @param {number} currentTick
   */
  recordCriticalIncident(currentTick) {
    if (currentTick >= this._warmUpTicks) {
      this._criticalIncidents++;
    }
  }

  /**
   * Record that a need was generated.
   * @param {string} type
   * @param {number} currentTick
   */
  recordNeedGenerated(type, currentTick) {
    if (currentTick >= this._warmUpTicks) {
      this._totalNeedsGenerated[type] = (this._totalNeedsGenerated[type] ?? 0) + 1;
    }
  }

  /**
   * Record that a need was fulfilled. Computes wait time.
   * @param {object} need - The fulfilled need object
   * @param {number} currentTick
   */
  recordNeedFulfilled(need, currentTick) {
    if (currentTick < this._warmUpTicks) return;

    this._totalNeedsFulfilled[need.type] = (this._totalNeedsFulfilled[need.type] ?? 0) + 1;

    const serviceStart = need.serviceStartTick ?? currentTick;
    const waitTime = serviceStart - need.createdAtTick;
    if (waitTime >= 0) {
      this._waitTimeSamples[need.type]?.push(waitTime);
    }

    if (need.type === 'emergency' && need.serviceStartTick !== null) {
      this._emergencyResponseTimes.push(serviceStart - need.createdAtTick);
    }
  }

  /**
   * Collect per-tick KPI snapshot.
   * @param {object} params
   * @param {number} params.tick
   * @param {import('./NeedQueue.js').default} params.needQueue
   * @param {import('./Patient.js').default[]} params.patients
   * @param {import('./Nurse.js').default[]} params.nurses
   * @param {Agent[]} params.robots - All robot instances
   */
  collectTick({ tick, needQueue, patients, nurses, robots }) {
    const allNeeds = needQueue.getAll();
    const activeNeedCount = allNeeds.filter(
      n => n.status === 'open' || n.status === 'claimed' || n.status === 'in_progress'
    ).length;

    const busyNurses = nurses.filter(n => n.isBusy()).length;
    const nurseUtilisation = nurses.length > 0 ? busyNurses / nurses.length : 0;

    const busyRobots = robots.filter(r => r.isBusy()).length;
    const robotUtilisation = robots.length > 0 ? busyRobots / robots.length : 0;

    const healthValues = patients.map(p => p.health);
    const averagePatientHealth = healthValues.length > 0
      ? healthValues.reduce((a, b) => a + b, 0) / healthValues.length
      : 0;
    const lowestPatientHealth = healthValues.length > 0
      ? Math.min(...healthValues)
      : 0;

    const snapshot = {
      tick,
      activeNeedCount,
      nurseUtilisation,
      robotUtilisation,
      averagePatientHealth,
      lowestPatientHealth,
    };

    this.tickHistory.push(snapshot);

    if (tick >= this._warmUpTicks) {
      this._nurseUtilisationSamples.push(nurseUtilisation);
      this._robotUtilisationSamples.push(robotUtilisation);
    }
  }

  /**
   * Compute and return the per-replication summary KPIs.
   * @param {import('./NeedQueue.js').default} needQueue - Final state of queue (for unfulfilled count)
   * @returns {object}
   */
  getSummary(needQueue) {
    const mean = arr => arr.length === 0 ? 0 : arr.reduce((a, b) => a + b, 0) / arr.length;

    const meanWaitTime = {};
    for (const type of ['emergency', 'medication', 'comfort', 'visitor_escort']) {
      meanWaitTime[type] = mean(this._waitTimeSamples[type] ?? []);
    }

    const allNeeds = needQueue.getAll();
    const needsUnfulfilledAtEnd = allNeeds.filter(
      n => n.status === 'open' || n.status === 'claimed' || n.status === 'in_progress'
    ).length;

    return {
      meanWaitTime,
      criticalIncidentCount: this._criticalIncidents,
      meanEmergencyResponseTime: mean(this._emergencyResponseTimes),
      totalNeedsGenerated: { ...this._totalNeedsGenerated },
      totalNeedsFulfilled: { ...this._totalNeedsFulfilled },
      needsUnfulfilledAtEnd,
      meanNurseUtilisation: mean(this._nurseUtilisationSamples),
      meanRobotUtilisation: mean(this._robotUtilisationSamples),
    };
  }
}
