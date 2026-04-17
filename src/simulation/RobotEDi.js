/**
 * @fileoverview EDi robot — serves visitor_escort needs.
 * Special behaviour: must travel to ENTRANCE first to "pick up" the visitor,
 * then travel to the patient. Once the visitor is handed off (SERVING complete),
 * the need is fulfilled and EDi is immediately freed.
 *
 * States:
 *   IDLE → MOVING_TO_ENTRANCE → MOVING_TO_PATIENT → SERVING → IDLE
 *   IDLE → MOVING_TO_CHARGER → CHARGING → IDLE (battery low path)
 */
import Agent from './Agent.js';

const STATES = {
  IDLE: 'IDLE',
  MOVING_TO_ENTRANCE: 'MOVING_TO_ENTRANCE',
  MOVING_TO_PATIENT: 'MOVING_TO_PATIENT',
  SERVING: 'SERVING',
  MOVING_TO_CHARGER: 'MOVING_TO_CHARGER',
  CHARGING: 'CHARGING',
};

export const SERVED_TYPES = ['visitor_escort'];

export default class RobotEDi extends Agent {
  /**
   * @param {object} params
   * @param {string|number} params.id
   * @param {{x: number, y: number}} params.position
   * @param {import('./Grid.js').default} params.grid
   * @param {import('../config.js').CONFIG} params.config
   * @param {import('./NeedQueue.js').default} params.needQueue
   * @param {import('./SeededRandom.js').default} params.rng
   */
  constructor({ id, position, grid, config, needQueue, rng }) {
    super({ id, position, grid, ticksPerCell: config.MOVEMENT_TICKS_PER_CELL.edi });
    this.config = config;
    this.needQueue = needQueue;
    this.rng = rng;

    this.state = STATES.IDLE;
    this.battery = config.BATTERY_MAX;
    this.servedTypes = SERVED_TYPES;

    /** @type {object|null} */
    this.currentNeed = null;
    this.serviceTicksRemaining = 0;
    /** @type {{x: number, y: number}|null} */
    this.chargerPosition = null;
  }

  /**
   * Decision phase (tick step 2).
   */
  decideAndClaim() {
    if (this.state !== STATES.IDLE) return;
    if (this.battery < this.config.BATTERY_LOW_THRESHOLD) {
      this._goCharge();
      return;
    }

    const openNeeds = this.needQueue.getOpenNeedsByType(this.servedTypes);
    if (openNeeds.length === 0) return;

    let nearest = null;
    let nearestDist = Infinity;
    for (const need of openNeeds) {
      const dist = this.grid.manhattanDistance(this.position, need.position);
      if (dist < nearestDist) { nearestDist = dist; nearest = need; }
    }

    if (!nearest) return;

    const claimed = this.needQueue.claimNeed(nearest.id, this.id);
    if (!claimed) return;

    this.currentNeed = nearest;

    // Navigate to entrance first
    const entrances = this.grid.getEntrances();
    if (entrances.length === 0) {
      // No entrance defined — skip to moving to patient directly
      const reached = this.setDestination(nearest.position);
      if (!reached) {
        this.needQueue.unclaimNeed(nearest.id);
        this.currentNeed = null;
        return;
      }
      this.state = STATES.MOVING_TO_PATIENT;
      return;
    }

    // Navigate to nearest entrance
    let nearestEntrance = entrances[0];
    let nearestEntranceDist = this.grid.manhattanDistance(this.position, entrances[0]);
    for (const e of entrances) {
      const d = this.grid.manhattanDistance(this.position, e);
      if (d < nearestEntranceDist) { nearestEntranceDist = d; nearestEntrance = e; }
    }

    const reached = this.setDestination(nearestEntrance);
    if (!reached) {
      this.needQueue.unclaimNeed(nearest.id);
      this.currentNeed = null;
      return;
    }

    this.state = STATES.MOVING_TO_ENTRANCE;
  }

  /**
   * Movement phase (tick step 4).
   * @param {number} currentTick
   */
  move(currentTick) {
    switch (this.state) {
      case STATES.MOVING_TO_ENTRANCE: {
        const arrived = this.moveStep();
        if (arrived) {
          // Arrived at entrance — now navigate to patient
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
      case STATES.MOVING_TO_CHARGER: {
        const arrived = this.moveStep();
        if (arrived) this.state = STATES.CHARGING;
        break;
      }
    }
  }

  /** Task execution phase (tick step 5). */
  executeTask() {
    if (this.state === STATES.SERVING) {
      this.serviceTicksRemaining--;
    }
  }

  /**
   * State transitions + battery update (tick step 6).
   * @returns {object|null} Fulfilled need, or null
   */
  transitionState() {
    // Battery drain
    switch (this.state) {
      case STATES.MOVING_TO_ENTRANCE:
      case STATES.MOVING_TO_PATIENT:
      case STATES.MOVING_TO_CHARGER:
        this.battery = Math.max(0, this.battery - this.config.BATTERY_DRAIN_MOVING);
        break;
      case STATES.SERVING:
        this.battery = Math.max(0, this.battery - this.config.BATTERY_DRAIN_SERVING);
        break;
      case STATES.IDLE:
        this.battery = Math.max(0, this.battery - this.config.BATTERY_DRAIN_IDLE);
        break;
      case STATES.CHARGING:
        this.battery = Math.min(this.config.BATTERY_MAX, this.battery + this.config.BATTERY_CHARGE_RATE);
        if (this.battery >= this.config.BATTERY_MAX) {
          this.chargerPosition = null;
          this.state = STATES.IDLE;
        }
        break;
    }

    // Low battery check — covers all active states including ACCOMPANYING
    // (need is already fulfilled during ACCOMPANYING so no unclaim needed then)
    if (
      (this.state === STATES.MOVING_TO_ENTRANCE ||
       this.state === STATES.MOVING_TO_PATIENT ||
       this.state === STATES.SERVING) &&
      this.battery < this.config.BATTERY_LOW_THRESHOLD
    ) {
      if (this.currentNeed) {
        this.needQueue.unclaimNeed(this.currentNeed.id);
        this.currentNeed = null;
      }
      this._goCharge();
      return null;
    }

    // Serving → IDLE (visitor handed off, EDi immediately freed)
    if (this.state === STATES.SERVING && this.serviceTicksRemaining <= 0) {
      const fulfilledNeed = this.currentNeed;
      this.needQueue.fulfillNeed(fulfilledNeed.id);
      this.currentNeed = null;
      this.clearPath();
      this.state = STATES.IDLE;
      return fulfilledNeed;
    }

    return null;
  }

  /** @private */
  _beginServing(currentTick) {
    this.serviceTicksRemaining = 0;
    this.needQueue.markInProgress(this.currentNeed.id, currentTick);
    this.state = STATES.SERVING;
  }

  /** @private */
  _goCharge() {
    const bays = this.grid.getChargingBays();
    if (bays.length === 0) return;

    let nearest = bays[0];
    let nearestDist = this.grid.manhattanDistance(this.position, bays[0]);
    for (const bay of bays) {
      const d = this.grid.manhattanDistance(this.position, bay);
      if (d < nearestDist) { nearestDist = d; nearest = bay; }
    }

    this.chargerPosition = nearest;
    const reached = this.setDestination(nearest);
    if (reached) this.state = STATES.MOVING_TO_CHARGER;
  }

  /** @returns {boolean} */
  isBusy() {
    return this.state !== STATES.IDLE && this.state !== STATES.CHARGING;
  }
}
