/**
 * @fileoverview Nurse agent. Handles ALL need types including emergencies.
 * Decision: score unclaimed needs by (urgency × wait_ticks / distance), claim highest.
 * States: IDLE → MOVING_TO_PATIENT → SERVING → IDLE
 */
import Agent from './Agent.js';

const STATES = {
  IDLE: 'IDLE',
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
    super({ id, position, grid });
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
  }

  /**
   * Decision phase (tick step 3). Only called when IDLE.
   * Scores all unclaimed needs and claims the highest-scoring one.
   * @param {number} currentTick
   */
  decideAndClaim(currentTick) {
    if (this.state !== STATES.IDLE) return;

    const openNeeds = this.needQueue.getOpenNeeds();
    if (openNeeds.length === 0) return;

    let bestNeed = null;
    let bestScore = -Infinity;

    for (const need of openNeeds) {
      const waitTicks = Math.max(1, currentTick - need.createdAtTick);
      const distance = Math.max(1, this.grid.manhattanDistance(this.position, need.position));
      const score = (need.urgencyWeight * waitTicks) / distance;

      if (score > bestScore) {
        bestScore = score;
        bestNeed = need;
      }
    }

    if (!bestNeed) return;

    const claimed = this.needQueue.claimNeed(bestNeed.id, this.id);
    if (!claimed) return;

    this.currentNeed = bestNeed;
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
    if (this.state !== STATES.MOVING_TO_PATIENT) return;

    const arrived = this.moveStep();
    if (arrived) {
      this._beginServing(currentTick);
    }
  }

  /**
   * Task execution phase (tick step 5). Decrement service timer.
   */
  executeTask() {
    if (this.state !== STATES.SERVING) return;
    this.serviceTicksRemaining--;
  }

  /**
   * State transition phase (tick step 6). Handle task completion.
   * @returns {object|null} The fulfilled need (for patient health recovery), or null
   */
  transitionState() {
    if (this.state !== STATES.SERVING) return null;
    if (this.serviceTicksRemaining > 0) return null;

    const fulfilledNeed = this.currentNeed;
    this.needQueue.fulfillNeed(fulfilledNeed.id);
    this.currentNeed = null;
    this.clearPath();
    this.state = STATES.IDLE;

    return fulfilledNeed;
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
