/**
 * @fileoverview Renders the static ward grid as coloured rectangles via Pixi.js Graphics.
 * Drawn once on construction; call redraw() if the layout changes.
 * Depends on PIXI being available as a global (loaded via CDN).
 */

/** Hex fill colours per cell-type symbol (spec colour palette §9) */
const CELL_COLORS = {
  '.': 0xf0f0f0,  // CORRIDOR — light grey
  '#': 0x4a4a4a,  // WALL — dark grey
  'B': 0xe8e8e8,  // BED — slightly darker grey (patients rendered on top)
  'N': 0xc8e6c9,  // NURSE_STATION — light green
  'C': 0xfff9c4,  // CHARGING_BAY — light yellow
  'E': 0xbbdefb,  // ENTRANCE — light blue
};

export default class GridRenderer {
  /**
   * @param {object} params
   * @param {PIXI.Container} params.container
   * @param {import('../simulation/Grid.js').default} params.grid
   * @param {number} params.cellSize - Pixels per grid cell
   */
  constructor({ container, grid, cellSize }) {
    this.container = container;
    this.grid = grid;
    this.cellSize = cellSize;

    this._bg = new PIXI.Graphics();
    container.addChild(this._bg);
    this._draw();
  }

  /** @private */
  _draw() {
    const g = this._bg;
    const cs = this.cellSize;
    g.clear();

    for (let y = 0; y < this.grid.height; y++) {
      for (let x = 0; x < this.grid.width; x++) {
        const cell = this.grid.layout[y][x];
        const color = CELL_COLORS[cell] ?? 0x888888;
        const px = x * cs;
        const py = y * cs;

        // Filled cell
        g.rect(px, py, cs, cs).fill({ color });
        // Subtle grid line
        g.rect(px, py, cs, cs).stroke({ color: 0xbbbbbb, width: 0.5, alpha: 0.5 });
      }
    }
  }

  /** Redraw all cells — call if the grid layout changes at runtime. */
  redraw() {
    this._draw();
  }
}
