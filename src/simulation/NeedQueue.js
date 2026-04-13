/**
 * @fileoverview Global need registry.
 * Patients post needs here; agents independently scan and claim them.
 * This is the central coordination mechanism for the ABM — not a dispatcher.
 */
export default class NeedQueue {
  constructor() {
    /** @type {Map<number, object>} All needs, keyed by id */
    this._needs = new Map();
    this._nextId = 1;
  }

  /**
   * Post a new need from a patient.
   * @param {{
   *   type: string,
   *   patientId: number,
   *   position: {x: number, y: number},
   *   urgencyWeight: number,
   *   createdAtTick: number
   * }} params
   * @returns {object} The created need object
   */
  postNeed({ type, patientId, position, urgencyWeight, createdAtTick }) {
    const need = {
      id: this._nextId++,
      type,
      patientId,
      position,
      urgencyWeight,
      createdAtTick,
      claimedBy: null,
      status: 'open',
      serviceStartTick: null,
    };
    this._needs.set(need.id, need);
    return need;
  }

  /**
   * Claim a need for an agent. Marks status as 'claimed'.
   * @param {number} needId
   * @param {string|number} agentId
   * @returns {boolean} True if successfully claimed
   */
  claimNeed(needId, agentId) {
    const need = this._needs.get(needId);
    if (!need || need.status !== 'open') return false;
    need.claimedBy = agentId;
    need.status = 'claimed';
    return true;
  }

  /**
   * Release a claimed need back to open status (e.g. robot abandons due to low battery).
   * @param {number} needId
   */
  unclaimNeed(needId) {
    const need = this._needs.get(needId);
    if (need && (need.status === 'claimed' || need.status === 'in_progress')) {
      need.claimedBy = null;
      need.status = 'open';
      need.serviceStartTick = null;
    }
  }

  /**
   * Mark a need as in_progress (agent has arrived and begun service).
   * @param {number} needId
   * @param {number} currentTick
   */
  markInProgress(needId, currentTick) {
    const need = this._needs.get(needId);
    if (need) {
      need.status = 'in_progress';
      need.serviceStartTick = currentTick;
    }
  }

  /**
   * Mark a need as fulfilled and remove it from the active queue.
   * @param {number} needId
   * @returns {object|null} The fulfilled need object (for stats), or null
   */
  fulfillNeed(needId) {
    const need = this._needs.get(needId);
    if (!need) return null;
    need.status = 'fulfilled';
    return need;
  }

  /**
   * Return all needs with status 'open' (unclaimed).
   * @returns {object[]}
   */
  getOpenNeeds() {
    return Array.from(this._needs.values()).filter(n => n.status === 'open');
  }

  /**
   * Return open needs whose type matches one of the provided types.
   * @param {string[]} types
   * @returns {object[]}
   */
  getOpenNeedsByType(types) {
    const typeSet = new Set(types);
    return Array.from(this._needs.values()).filter(
      n => n.status === 'open' && typeSet.has(n.type)
    );
  }

  /**
   * Return all needs regardless of status.
   * @returns {object[]}
   */
  getAll() {
    return Array.from(this._needs.values());
  }

  /**
   * Return all active (open or claimed or in_progress) needs for a patient.
   * @param {number} patientId
   * @returns {object[]}
   */
  getActiveNeedsForPatient(patientId) {
    return Array.from(this._needs.values()).filter(
      n => n.patientId === patientId && n.status !== 'fulfilled'
    );
  }

  /**
   * Check if a patient already has an active need of the given type.
   * @param {number} patientId
   * @param {string} type
   * @returns {boolean}
   */
  hasActiveNeedOfType(patientId, type) {
    return Array.from(this._needs.values()).some(
      n => n.patientId === patientId && n.type === type && n.status !== 'fulfilled'
    );
  }
}
