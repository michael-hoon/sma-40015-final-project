/**
 * @fileoverview Renders the static ward grid as coloured rectangles via Pixi.js Graphics,
 * with PNG sprite overlays on functional cells (bed, nurse station, charging bay, entrance).
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

/** Map grid cell symbols to SPRITES config keys */
const CELL_SPRITE_KEY = {
  'B': 'bed',
  'N': 'nurse_station',
  'C': 'charging_bay',
  'E': 'entrance',
};

export default class GridRenderer {
  /**
   * @param {object} params
   * @param {PIXI.Container} params.container
   * @param {import('../simulation/Grid.js').default} params.grid
   * @param {number} params.cellSize - Pixels per grid cell
   * @param {Record<string, PIXI.Texture>} [params.textures] - preloaded sprite textures keyed by SPRITES config key
   */
  constructor({ container, grid, cellSize, textures }) {
    this.container = container;
    this.grid = grid;
    this.cellSize = cellSize;
    this._textures = textures ?? {};

    this._bg = new PIXI.Graphics();
    container.addChild(this._bg);

    /** @type {PIXI.Container} child container so redraw() can destroy overlays cleanly */
    this._overlayContainer = new PIXI.Container();
    container.addChild(this._overlayContainer);

    this._draw();
  }

  /** @private */
  _draw() {
    const g = this._bg;
    const cs = this.cellSize;
    g.clear();

    // Destroy previous overlays
    this._overlayContainer.removeChildren().forEach(c => c.destroy({ children: true }));

    for (let y = 0; y < this.grid.height; y++) {
      for (let x = 0; x < this.grid.width; x++) {
        const cell = this.grid.layout[y][x];
        const color = CELL_COLORS[cell] ?? 0xD6D3D1;
        const px = x * cs;
        const py = y * cs;

        // Colored background
        g.rect(px, py, cs, cs).fill({ color });
        // Subtle grid line
        g.rect(px, py, cs, cs).stroke({ color: 0xE7E5E4, width: 0.5, alpha: 0.6 });

        // PNG overlay for functional cells
        const spriteKey = CELL_SPRITE_KEY[cell];
        if (spriteKey && this._textures[spriteKey]) {
          const s = new PIXI.Sprite(this._textures[spriteKey]);
          const size = cs * 0.9;
          s.width  = size;
          s.height = size;
          s.anchor.set(0.5);
          s.position.set(px + cs / 2, py + cs / 2);
          this._overlayContainer.addChild(s);
        }
      }
    }
  }

  /** Redraw all cells — call if the grid layout changes at runtime. */
  redraw() {
    this._draw();
  }
}
