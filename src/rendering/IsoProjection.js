/**
 * @fileoverview Isometric projection utilities — 2:1 ratio.
 * All returned coordinates are relative to the ward container origin.
 * The ward container is positioned by computeWardOffset() to centre the grid.
 */

/** Iso tile width in pixels (diamond left-to-right span). */
export const TILE_W = 40;

/** Iso tile height in pixels (diamond top-to-bottom span). */
export const TILE_H = 20;

/** Visual wall extrusion height in screen pixels. */
export const WALL_H = 16;

/**
 * Convert grid (col, row) to isometric screen (x, y).
 * @param {number} col
 * @param {number} row
 * @returns {{ x: number, y: number }}
 */
export function isoToScreen(col, row) {
  return {
    x: (col - row) * (TILE_W / 2),
    y: (col + row) * (TILE_H / 2),
  };
}

/**
 * Compute the ward container offset so the grid is centred in the canvas,
 * with enough headroom for wall extrusion and health bars.
 * @param {number} gridCols
 * @param {number} gridRows
 * @param {number} canvasW
 * @param {number} canvasH
 * @returns {{ x: number, y: number }}
 */
export function computeWardOffset(gridCols, gridRows, canvasW, canvasH) {
  // Bounding box of the grid in iso space
  const isoW = (gridCols + gridRows - 2) * (TILE_W / 2);
  const isoH = (gridCols + gridRows - 2) * (TILE_H / 2);

  // Extra top-padding: walls extend WALL_H upward, health bars need ~24px above
  const topExtra = WALL_H + 24;

  // The leftmost iso-x is at (col=0, row=gridRows-1): -(gridRows-1)*TILE_W/2
  // Shift by that amount to left-align, then centre horizontally.
  const x = Math.round((canvasW - isoW) / 2 + (gridRows - 1) * (TILE_W / 2));
  const y = Math.round((canvasH - isoH - topExtra) / 2 + topExtra);

  return { x, y };
}
