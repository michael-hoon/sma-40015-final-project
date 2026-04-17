/**
 * @fileoverview Renders the ward grid in isometric view.
 *
 * Cells are z-sorted by (col + row) — painter's algorithm — so front cells
 * draw on top of back cells. Walls are extruded with two visible side faces
 * (lighter left, darker right). Beds get a raised mattress + pillow overlay.
 *
 * Drawn once to a single static Graphics object; call redraw() if the layout
 * changes at runtime.
 */
import { isoToScreen, TILE_W, TILE_H, WALL_H } from './IsoProjection.js';
import { THEME } from './Theme.js';

export default class GridRenderer {
  /**
   * @param {object} params
   * @param {PIXI.Container} params.container
   * @param {import('../simulation/Grid.js').default} params.grid
   */
  constructor({ container, grid }) {
    this.container = container;
    this.grid      = grid;

    this._g = new PIXI.Graphics();
    container.addChild(this._g);
    this._draw();
  }

  /** @private — full redraw (called once on construction; rarely after that). */
  _draw() {
    const g = this._g;
    g.clear();

    const W = this.grid.width;
    const H = this.grid.height;

    // Collect cells and sort by (col + row) — back-to-front.
    // At equal depth, walls are drawn last so they cover adjacent floors.
    const cells = [];
    for (let row = 0; row < H; row++) {
      for (let col = 0; col < W; col++) {
        cells.push({ col, row, type: this.grid.layout[row][col] });
      }
    }
    cells.sort((a, b) => {
      const d = (a.col + a.row) - (b.col + b.row);
      if (d !== 0) return d;
      // Same depth: walls drawn after floors
      return (a.type === '#' ? 1 : 0) - (b.type === '#' ? 1 : 0);
    });

    for (const { col, row, type } of cells) {
      const { x: cx, y: cy } = isoToScreen(col, row);
      if (type === '#') {
        this._drawWall(g, cx, cy);
      } else {
        this._drawFloor(g, cx, cy, type, col, row);
        if (type === 'B') this._drawBedOverlay(g, cx, cy);
      }
    }
  }

  /**
   * Draw a regular floor/special diamond tile.
   * @private
   */
  _drawFloor(g, cx, cy, type, col, row) {
    const hw = TILE_W / 2, hh = TILE_H / 2;
    const isAlt = (col + row) % 2 === 1;

    let topColor;
    switch (type) {
      case 'N': topColor = THEME.nurseStTop;  break;
      case 'C': topColor = THEME.chargingTop; break;
      case 'E': topColor = THEME.entranceTop; break;
      case 'B': topColor = THEME.bedTop;      break;
      default:  topColor = isAlt ? THEME.floorAlt : THEME.floor; break;
    }

    g.poly([cx, cy - hh, cx + hw, cy, cx, cy + hh, cx - hw, cy])
      .fill({ color: topColor });
  }

  /**
   * Draw a wall block: left face (lighter) + right face (darker) + top diamond.
   * @private
   */
  _drawWall(g, cx, cy) {
    const hw = TILE_W / 2, hh = TILE_H / 2;

    // Left face — faces SW (lighter, toward ambient light source)
    g.poly([
      cx - hw, cy,
      cx,      cy + hh,
      cx,      cy + hh - WALL_H,
      cx - hw, cy      - WALL_H,
    ]).fill({ color: THEME.wallLeft });

    // Right face — faces SE (darker, in shadow)
    g.poly([
      cx,      cy + hh,
      cx + hw, cy,
      cx + hw, cy      - WALL_H,
      cx,      cy + hh - WALL_H,
    ]).fill({ color: THEME.wallRight });

    // Top diamond (raised by WALL_H)
    g.poly([
      cx,      cy - hh - WALL_H,
      cx + hw, cy      - WALL_H,
      cx,      cy + hh - WALL_H,
      cx - hw, cy      - WALL_H,
    ]).fill({ color: THEME.wallTop });
  }

  /**
   * Draw mattress and pillow overlays on a bed tile.
   * @private
   */
  _drawBedOverlay(g, cx, cy) {
    const hw = TILE_W / 2, hh = TILE_H / 2;
    const lift   = 4;         // how many px the mattress floats above the tile
    const inset  = 0.72;      // mattress is 72 % of tile size

    const mhw = hw * inset;
    const mhh = hh * inset;

    // Mattress — inset diamond, raised
    g.poly([
      cx,       cy - mhh - lift,
      cx + mhw, cy      - lift,
      cx,       cy + mhh - lift,
      cx - mhw, cy      - lift,
    ]).fill({ color: THEME.mattressTop });

    // Pillow — small diamond at the head end (top quarter of mattress)
    const phw = hw * 0.30;
    const phh = hh * 0.26;
    const pcy = cy - mhh * 0.50 - lift;

    g.poly([
      cx,       pcy - phh,
      cx + phw, pcy,
      cx,       pcy + phh,
      cx - phw, pcy,
    ]).fill({ color: THEME.bedPillow });
  }

  /** Redraw all cells. Call if the grid layout changes at runtime. */
  redraw() { this._draw(); }
}
