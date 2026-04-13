/**
 * @fileoverview Ward grid — cell-type map, BFS pathfinding, and spatial queries.
 * No DOM, no rendering. Pure data structure.
 */
import { WALKABLE_CELLS, CELL_TYPES } from '../config.js';

export default class Grid {
  /**
   * @param {string[][]} layout - 2D array of cell-type symbols (rows × columns).
   *   layout[y][x] is the cell at column x, row y.
   */
  constructor(layout) {
    this.layout = layout;
    this.height = layout.length;
    this.width = layout[0].length;

    // Pre-compute special cell positions for fast look-ups
    this._beds = [];
    this._nurseStations = [];
    this._chargingBays = [];
    this._entrances = [];
    this._scanSpecialCells();
  }

  /** @private */
  _scanSpecialCells() {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const cell = this.layout[y][x];
        if (cell === CELL_TYPES.BED)           this._beds.push({ x, y });
        if (cell === CELL_TYPES.NURSE_STATION) this._nurseStations.push({ x, y });
        if (cell === CELL_TYPES.CHARGING_BAY)  this._chargingBays.push({ x, y });
        if (cell === CELL_TYPES.ENTRANCE)      this._entrances.push({ x, y });
      }
    }
  }

  /**
   * Return the cell-type symbol at position (x, y).
   * @param {number} x
   * @param {number} y
   * @returns {string | null} Cell symbol or null if out of bounds
   */
  getCell(x, y) {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return null;
    return this.layout[y][x];
  }

  /**
   * Returns true if (x, y) is within bounds and walkable.
   * Beds are NOT walkable — agents stop at the corridor cell adjacent to the bed
   * when targeting a patient, but for routing purposes beds block movement.
   * @param {number} x
   * @param {number} y
   * @returns {boolean}
   */
  isWalkable(x, y) {
    const cell = this.getCell(x, y);
    return cell !== null && WALKABLE_CELLS.has(cell);
  }

  /**
   * Compute Manhattan distance between two positions.
   * @param {{x: number, y: number}} a
   * @param {{x: number, y: number}} b
   * @returns {number}
   */
  manhattanDistance(a, b) {
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  }

  /**
   * BFS shortest path from start to goal.
   * Agents can walk on WALKABLE cells. The goal cell itself must be walkable
   * (callers should pass the adjacent corridor cell when targeting a bed patient).
   *
   * @param {{x: number, y: number}} start
   * @param {{x: number, y: number}} goal
   * @returns {{x: number, y: number}[] | null} Ordered list of cells from
   *   start (exclusive) to goal (inclusive), or null if no path exists.
   */
  bfsPath(start, goal) {
    if (start.x === goal.x && start.y === goal.y) return [];

    const key = (x, y) => `${x},${y}`;
    const visited = new Set();
    const parent = new Map();
    const queue = [start];
    visited.add(key(start.x, start.y));

    const directions = [
      { dx: 0, dy: -1 },
      { dx: 0, dy:  1 },
      { dx: -1, dy: 0 },
      { dx:  1, dy: 0 },
    ];

    while (queue.length > 0) {
      const current = queue.shift();

      for (const { dx, dy } of directions) {
        const nx = current.x + dx;
        const ny = current.y + dy;
        const nk = key(nx, ny);

        if (visited.has(nk)) continue;

        const isGoal = nx === goal.x && ny === goal.y;
        // Allow entering the goal even if it's a bed (to reach patient)
        if (!isGoal && !this.isWalkable(nx, ny)) continue;

        visited.add(nk);
        const node = { x: nx, y: ny };
        parent.set(nk, current);
        queue.push(node);

        if (isGoal) {
          // Reconstruct path
          const path = [];
          let cur = node;
          while (!(cur.x === start.x && cur.y === start.y)) {
            path.unshift(cur);
            cur = parent.get(key(cur.x, cur.y));
          }
          return path;
        }
      }
    }

    return null; // no path found
  }

  /**
   * Find the walkable cell adjacent to a bed (or any cell) — the "approach cell".
   * Returns the closest walkable neighbour to the target.
   * @param {{x: number, y: number}} target
   * @returns {{x: number, y: number} | null}
   */
  getApproachCell(target) {
    const directions = [
      { dx: 0, dy: -1 },
      { dx: 0, dy:  1 },
      { dx: -1, dy: 0 },
      { dx:  1, dy: 0 },
    ];
    for (const { dx, dy } of directions) {
      const nx = target.x + dx;
      const ny = target.y + dy;
      if (this.isWalkable(nx, ny)) return { x: nx, y: ny };
    }
    return null;
  }

  /** @returns {{x: number, y: number}[]} All bed positions */
  getBeds() { return this._beds; }

  /** @returns {{x: number, y: number}[]} All nurse station positions */
  getNurseStations() { return this._nurseStations; }

  /** @returns {{x: number, y: number}[]} All charging bay positions */
  getChargingBays() { return this._chargingBays; }

  /** @returns {{x: number, y: number}[]} All entrance positions */
  getEntrances() { return this._entrances; }
}
