/**
 * @fileoverview BLANKi robot — serves comfort needs only.
 * Carries up to BLANKI_ITEM_CAPACITY blankets; must visit the refilling station
 * (nearest NURSE_STATION cell) to restock when inventory reaches 0.
 * States: IDLE → MOVING_TO_PATIENT → SERVING → IDLE
 *         IDLE → MOVING_TO_REFILL → REFILLING → IDLE (when blanket inventory = 0)
 *         IDLE → MOVING_TO_CHARGER → CHARGING → IDLE
 *
 * Battery mechanics: drains while moving/serving/idle; triggers charger trip when low.
 */
import Agent from './Agent.js';

const STATES = {
  IDLE: 'IDLE',
  MOVING_TO_REFILL: 'MOVING_TO_REFILL',
  REFILLING: 'REFILLING',
  MOVING_TO_PATIENT: 'MOVING_TO_PATIENT',
  SERVING: 'SERVING',
  MOVING_TO_CHARGER: 'MOVING_TO_CHARGER',
  CHARGING: 'CHARGING',
};

export const SERVED_TYPES = ['comfort'];

export default class RobotBLANKi extends Agent {
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
    super({ id, position, grid });
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
    /** Number of blankets currently carried */
    this.blanketCount = config.BLANKI_ITEM_CAPACITY;
    /** Ticks remaining in the current refill process */
    this.refillTicksRemaining = 0;
    /** Total ticks for the current refill (used by renderer to show progress) */
    this.totalRefillTicks = 0;
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

    // Go restock if inventory is depleted
    if (this.blanketCount === 0) {
      this._goRefill();
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
    const reached = this.setDestination(nearest.position);
    if (!reached) {
      this.needQueue.unclaimNeed(nearest.id);
      this.currentNeed = null;
      return;
    }

    this.state = STATES.MOVING_TO_PATIENT;
  }

  /**
   * Movement phase (tick step 4).
   * @param {number} currentTick
   */
  move(currentTick) {
    switch (this.state) {
      case STATES.MOVING_TO_REFILL: {
        const arrived = this.moveStep();
        if (arrived) {
          // Begin timed refill — inventory restored only when REFILLING completes
          const ticks = this.config.BLANKI_ITEM_CAPACITY * this.config.REFILL_TIME_PER_BLANKET;
          this.refillTicksRemaining = Math.max(1, ticks);
          this.totalRefillTicks = this.refillTicksRemaining;
          this.clearPath();
          this.state = STATES.REFILLING;
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
    } else if (this.state === STATES.REFILLING) {
      this.refillTicksRemaining--;
    }
  }

  /**
   * State transitions + battery update (tick step 6).
   * @returns {object|null} Fulfilled need, or null
   */
  transitionState() {
    switch (this.state) {
      case STATES.MOVING_TO_REFILL:
      case STATES.MOVING_TO_PATIENT:
      case STATES.MOVING_TO_CHARGER:
        this.battery = Math.max(0, this.battery - this.config.BATTERY_DRAIN_MOVING);
        break;
      case STATES.REFILLING:
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

    // Low battery check — abandon current task (currentNeed is null during refill/refilling)
    if (
      (this.state === STATES.MOVING_TO_REFILL ||
       this.state === STATES.REFILLING ||
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

    // Refill completion — restore full inventory
    if (this.state === STATES.REFILLING && this.refillTicksRemaining <= 0) {
      this.blanketCount = this.config.BLANKI_ITEM_CAPACITY;
      this.totalRefillTicks = 0;
      this.state = STATES.IDLE;
      return null;
    }

    // Task completion — consume one blanket
    if (this.state === STATES.SERVING && this.serviceTicksRemaining <= 0) {
      const fulfilledNeed = this.currentNeed;
      this.blanketCount--;
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
    const [min, max] = this.config.SERVICE_TIME.robot[this.currentNeed.type];
    this.serviceTicksRemaining = this.rng.randomInt(min, max);
    this.needQueue.markInProgress(this.currentNeed.id, currentTick);
    this.state = STATES.SERVING;
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
