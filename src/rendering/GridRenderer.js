/**
 * @fileoverview Renders the static ward grid as coloured rectangles via Pixi.js Graphics.
 * Drawn once on construction; call redraw() if the layout changes.
 * Depends on PIXI being available as a global (loaded via CDN).
 */

/** Hex fill colours per cell-type symbol — warm light clinical palette */
const CELL_COLORS = {
  '.': 0xF5F5F4,  // CORRIDOR — warm stone-100
  '#': 0xA8A29E,  // WALL — stone-400
  'B': 0xFFFFFF,  // BED — white (patients rendered on top)
  'N': 0xD1FAE5,  // NURSE_STATION — emerald-100 mint
  'C': 0xFEF9C3,  // CHARGING_BAY — yellow-100 cream
  'E': 0xDBEAFE,  // ENTRANCE — blue-100 sky
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
        const color = CELL_COLORS[cell] ?? 0xD6D3D1;
        const px = x * cs;
        const py = y * cs;

        // Filled cell
        g.rect(px, py, cs, cs).fill({ color });
        // Subtle grid line
        g.rect(px, py, cs, cs).stroke({ color: 0xE7E5E4, width: 0.5, alpha: 0.6 });
      }
    }
  }

  /** Redraw all cells — call if the grid layout changes at runtime. */
  redraw() {
    this._draw();
  }
}
