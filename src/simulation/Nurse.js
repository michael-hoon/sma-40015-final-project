/**
 * @fileoverview Nurse agent. Handles ALL need types including emergencies.
 * Decision: score unclaimed needs by (urgency × wait_ticks / distance), claim highest.
 * Carries up to NURSE_ITEM_CAPACITY items; allocation between medicine and blanket is
 * demand-driven (e.g. 2+0, 1+1, or 0+2). Restocks at the nearest NURSE_STATION when
 * idle with empty slots and no serviceable need available.
 * States: IDLE → MOVING_TO_PATIENT → SERVING → IDLE
 *         IDLE → MOVING_TO_ENTRANCE → MOVING_TO_PATIENT → SERVING → IDLE (visitor_escort only)
 *         IDLE → MOVING_TO_REFILL → REFILLING → IDLE (when inventory has empty slots)
 */
import Agent from './Agent.js';

const STATES = {
  IDLE: 'IDLE',
  MOVING_TO_ENTRANCE: 'MOVING_TO_ENTRANCE',
  MOVING_TO_REFILL: 'MOVING_TO_REFILL',
  REFILLING: 'REFILLING',
  MOVING_TO_PATIENT: 'MOVING_TO_PATIENT',
  SERVING: 'SERVING',
};

export default class Nurse extends Agent {
  /**
   * @param {object} params
   * @param {string|number} params.id
   * @param {{x: number, y: number}} params.position - Starting position (nurse station)
   * @param {import('./Grid.js').default} params.grid
   * @param {import('../config.js').CONFIG} params.config
   * @param {import('./NeedQueue.js').default} params.needQueue
   * @param {import('./SeededRandom.js').default} params.rng
   */
  constructor({ id, position, grid, config, needQueue, rng }) {
    super({ id, position, grid, ticksPerCell: config.MOVEMENT_TICKS_PER_CELL.nurse });
    this.config = config;
    this.needQueue = needQueue;
    this.rng = rng;

    this.state = STATES.IDLE;

    /** @type {object|null} The need currently being handled */
    this.currentNeed = null;
    /** @type {number} Ticks remaining for current service */
    this.serviceTicksRemaining = 0;

    /** @type {number} Tick when service began (for emergency response time stat) */
    this.serviceStartTick = 0;

    /** Medicine vials carried; dynamically allocated on refill based on queue demand */
    this.medicineCount = 1;
    /** Blankets carried; dynamically allocated on refill based on queue demand */
    this.blanketCount = 1;
    /** Ticks remaining in the current refill process */
    this.refillTicksRemaining = 0;
    /** Total ticks for the current refill (used by renderer to show progress) */
    this.totalRefillTicks = 0;
    /** Medicine vials to add when current refill completes */
    this._pendingMedRefill = 0;
    /** Blankets to add when current refill completes */
    this._pendingBlanketRefill = 0;
  }

  /**
   * Decision phase (tick step 3). Only called when IDLE.
   * Scores all unclaimed needs and claims the highest-scoring one.
   * @param {number} currentTick
   */
  decideAndClaim(currentTick) {
    if (this.state !== STATES.IDLE) return;

    const openNeeds = this.needQueue.getOpenNeeds();

    let bestNeed = null;
    let bestScore = -Infinity;

    for (const need of openNeeds) {
      // Skip needs that require items we don't currently carry
      if (need.type === 'medication' && this.medicineCount === 0) continue;
      if (need.type === 'comfort' && this.blanketCount === 0) continue;

      const waitTicks = Math.max(1, currentTick - need.createdAtTick);
      const distance = Math.max(1, this.grid.manhattanDistance(this.position, need.position));
      const score = (need.urgencyWeight * waitTicks) / distance;

      if (score > bestScore) {
        bestScore = score;
        bestNeed = need;
      }
    }

    if (!bestNeed) {
      // No serviceable need — refill if there are empty slots in the inventory
      if (this.medicineCount + this.blanketCount < this.config.NURSE_ITEM_CAPACITY) this._goRefill();
      return;
    }

    const claimed = this.needQueue.claimNeed(bestNeed.id, this.id);
    if (!claimed) return;

    this.currentNeed = bestNeed;

    // For visitor_escort, go to nearest entrance first to "pick up" the visitor
    if (bestNeed.type === 'visitor_escort') {
      const entrances = this.grid.getEntrances();
      if (entrances.length > 0) {
        let nearestEntrance = entrances[0];
        let nearestDist = this.grid.manhattanDistance(this.position, entrances[0]);
        for (const e of entrances) {
          const d = this.grid.manhattanDistance(this.position, e);
          if (d < nearestDist) { nearestDist = d; nearestEntrance = e; }
        }
        const reached = this.setDestination(nearestEntrance);
        if (!reached) {
          this.needQueue.unclaimNeed(bestNeed.id);
          this.currentNeed = null;
          return;
        }
        this.state = STATES.MOVING_TO_ENTRANCE;
        return;
      }
    }

    // Default: go directly to patient (all other need types, or no entrances)
    const reached = this.setDestination(bestNeed.position);
    if (!reached) {
      // Can't reach patient — unclaim and stay IDLE
      this.needQueue.unclaimNeed(bestNeed.id);
      this.currentNeed = null;
      return;
    }

    this.state = STATES.MOVING_TO_PATIENT;
  }

  /**
   * Movement phase (tick step 4). Advance one step toward target patient.
   * @param {number} currentTick
   */
  move(currentTick) {
    switch (this.state) {
      case STATES.MOVING_TO_REFILL: {
        const arrived = this.moveStep();
        if (arrived) {
          // Calculate demand-based allocation at arrival (most current queue snapshot)
          const slotsAvailable = this.config.NURSE_ITEM_CAPACITY
                               - this.medicineCount - this.blanketCount;
          const openNeeds = this.needQueue.getOpenNeeds();
          const medDemand     = openNeeds.filter(n => n.type === 'medication').length;
          const comfortDemand = openNeeds.filter(n => n.type === 'comfort').length;
          const [medRefill, blanketRefill] = this._allocateRefill(slotsAvailable, medDemand, comfortDemand);
          this._pendingMedRefill     = medRefill;
          this._pendingBlanketRefill = blanketRefill;
          const ticks = medRefill     * this.config.REFILL_TIME_PER_MEDICINE
                      + blanketRefill * this.config.REFILL_TIME_PER_BLANKET;
          this.refillTicksRemaining = Math.max(1, ticks);
          this.totalRefillTicks = this.refillTicksRemaining;
          this.clearPath();
          this.state = STATES.REFILLING;
        }
        break;
      }
      case STATES.MOVING_TO_ENTRANCE: {
        const arrived = this.moveStep();
        if (arrived) {
          const reached = this.setDestination(this.currentNeed.position);
          if (!reached) {
            this.needQueue.unclaimNeed(this.currentNeed.id);
            this.currentNeed = null;
            this.state = STATES.IDLE;
          } else {
            this.state = STATES.MOVING_TO_PATIENT;
          }
        }
        break;
      }
      case STATES.MOVING_TO_PATIENT: {
        const arrived = this.moveStep();
        if (arrived) this._beginServing(currentTick);
        break;
      }
    }
  }

  /**
   * Task execution phase (tick step 5). Decrement service or refill timer.
   */
  executeTask() {
    if (this.state === STATES.SERVING) {
      this.serviceTicksRemaining--;
    } else if (this.state === STATES.REFILLING) {
      this.refillTicksRemaining--;
    }
  }

  /**
   * State transition phase (tick step 6). Handle task completion.
   * @returns {object|null} The fulfilled need (for patient health recovery), or null
   */
  transitionState() {
    // Refill completion — apply demand-based allocation
    if (this.state === STATES.REFILLING && this.refillTicksRemaining <= 0) {
      this.medicineCount += this._pendingMedRefill;
      this.blanketCount  += this._pendingBlanketRefill;
      this._pendingMedRefill     = 0;
      this._pendingBlanketRefill = 0;
      this.totalRefillTicks = 0;
      this.state = STATES.IDLE;
      return null;
    }

    if (this.state !== STATES.SERVING) return null;
    if (this.serviceTicksRemaining > 0) return null;

    const fulfilledNeed = this.currentNeed;
    // Consume the carried item for needs that require one
    if (fulfilledNeed.type === 'medication') this.medicineCount--;
    else if (fulfilledNeed.type === 'comfort') this.blanketCount--;
    this.needQueue.fulfillNeed(fulfilledNeed.id);
    this.currentNeed = null;
    this.clearPath();
    this.state = STATES.IDLE;

    return fulfilledNeed;
  }

  /**
   * Calculates how many medicine vials and blankets to restock given available slots and demand.
   * @private
   * @param {number} slots - Empty slots to fill
   * @param {number} medDemand - Count of open medication needs in queue
   * @param {number} comfortDemand - Count of open comfort needs in queue
   * @returns {[number, number]} [medicineToAdd, blanketsToAdd]
   */
  _allocateRefill(slots, medDemand, comfortDemand) {
    if (slots <= 0) return [0, 0];
    const total = medDemand + comfortDemand;
    if (total === 0) {
      // No demand data — split evenly; medicine gets the remainder on odd capacity
      const med = Math.ceil(slots / 2);
      return [med, slots - med];
    }
    if (medDemand === 0) return [0, slots];
    if (comfortDemand === 0) return [slots, 0];
    // Proportional split, clamped to [1, slots-1] so both types get at least 1 when both have demand
    const medSlots = Math.round((medDemand / total) * slots);
    const clamped  = Math.min(slots - 1, Math.max(1, medSlots));
    return [clamped, slots - clamped];
  }

  /** @private */
  _goRefill() {
    const stations = this.grid.getNurseStations();
    if (stations.length === 0) return;

    let nearest = stations[0];
    let nearestDist = this.grid.manhattanDistance(this.position, stations[0]);
    for (const s of stations) {
      const d = this.grid.manhattanDistance(this.position, s);
      if (d < nearestDist) { nearestDist = d; nearest = s; }
    }

    const reached = this.setDestination(nearest);
    if (reached) this.state = STATES.MOVING_TO_REFILL;
  }

  /** @private */
  _beginServing(currentTick) {
    const needType = this.currentNeed.type;
    const [min, max] = this.config.SERVICE_TIME.nurse[needType];
    this.serviceTicksRemaining = this.rng.randomInt(min, max);
    this.serviceStartTick = currentTick;
    this.needQueue.markInProgress(this.currentNeed.id, currentTick);
    this.state = STATES.SERVING;
  }

  /**
   * Returns true if the nurse is busy (not IDLE).
   * @returns {boolean}
   */
  isBusy() {
    return this.state !== STATES.IDLE;
  }
}
