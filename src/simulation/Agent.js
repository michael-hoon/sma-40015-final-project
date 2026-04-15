/**
 * @fileoverview Base agent class. Handles position, state, and grid movement
 * (one step per tick along a pre-computed BFS path).
 * No rendering, no DOM.
 */
export default class Agent {
  /**
   * @param {object} params
   * @param {string|number} params.id - Unique agent identifier
   * @param {{x: number, y: number}} params.position - Starting grid position
   * @param {import('./Grid.js').default} params.grid
   */
  constructor({ id, position, grid }) {
    this.id = id;
    this.position = { ...position };
    this.grid = grid;

    /** @type {string} Current FSM state label */
    this.state = 'IDLE';

    /** @type {{x: number, y: number}[] | null} Remaining steps to target */
    this._path = null;

    /** @type {{x: number, y: number} | null} Current movement destination */
    this.target = null;
  }

  /**
   * Compute and store a BFS path from current position to goal.
   * Agents targeting a bed cell navigate to an adjacent walkable approach cell.
   * @param {{x: number, y: number}} goal
   * @returns {boolean} False if no path could be found
   */
  setDestination(goal) {
    // If goal is a bed (non-walkable), navigate to the adjacent approach cell
    let navGoal = goal;
    if (!this.grid.isWalkable(goal.x, goal.y)) {
      const approach = this.grid.getApproachCell(goal);
      if (!approach) return false;
      navGoal = approach;
    }

    const path = this.grid.bfsPath(this.position, navGoal);
    if (path === null) return false;
    this._path = path;
    this.target = goal;
    return true;
  }

  /**
   * Advance one step along the current path (called once per tick during movement phase).
   * @returns {boolean} True if the agent reached the destination this tick
   */
  moveStep() {
    if (!this._path || this._path.length === 0) return true; // already at destination
    const next = this._path.shift();
    this.position = { ...next };
    return this._path.length === 0;
  }

  /**
   * Returns true if the agent has no more path steps remaining.
   * @returns {boolean}
   */
  hasReachedTarget() {
    return !this._path || this._path.length === 0;
  }

  /**
   * Clear current path and target.
   */
  clearPath() {
    this._path = null;
    this.target = null;
  }
}
