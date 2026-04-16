/**
 * @fileoverview Renders health bars above patients and battery bars below robots.
 * Each bar is a small Graphics object redrawn each frame at the agent's
 * interpolated position.
 */

export default class HealthBarRenderer {
  /**
   * @param {object} params
   * @param {PIXI.Container} params.container
   * @param {number} params.cellSize
   */
  constructor({ container, cellSize }) {
    this.container = container;
    this.cellSize = cellSize;

    /** @type {Map<string, PIXI.Graphics>} One Graphics per tracked agent */
    this._bars = new Map();

    /**
     * Positions tracked independently (does not share state with AgentSprites).
     * @type {Map<string, {prevPos: {x:number,y:number}, currPos: {x:number,y:number}}>}
     */
    this._positions = new Map();
  }

  /**
   * Create bar Graphics for every patient and robot. Call once per sim init/reset.
   * @param {object[]} patients
   * @param {object[]} robots
   */
  initBars(patients, robots) {
    for (const [, g] of this._bars) {
      this.container.removeChild(g);
      g.destroy();
    }
    this._bars.clear();
    this._positions.clear();

    for (const agent of [...patients, ...robots]) {
      const g = new PIXI.Graphics();
      this.container.addChild(g);
      this._bars.set(agent.id, g);
      this._positions.set(agent.id, {
        prevPos: { ...agent.position },
        currPos: { ...agent.position },
      });
    }
  }

  /**
   * Snapshot positions before a tick advances the simulation.
   * @param {object[]} patients
   * @param {object[]} robots
   */
  recordPositions(patients, robots) {
    for (const agent of [...patients, ...robots]) {
      const pos = this._positions.get(agent.id);
      if (!pos) continue;
      pos.prevPos = { ...pos.currPos };
      pos.currPos = { ...agent.position };
    }
  }

  /**
   * Redraw all bars at interpolated positions.
   * @param {number} lerpT - 0–1 progress through current tick interval
   * @param {object[]} patients
   * @param {object[]} robots
   */
  update(lerpT, patients, robots) {
    const cs = this.cellSize;
    const t = Math.max(0, Math.min(1, lerpT));
    const barW = cs * 0.78;
    const barH = Math.max(2, cs * 0.10);

    for (const patient of patients) {
      const g = this._bars.get(patient.id);
      const pos = this._positions.get(patient.id);
      if (!g || !pos) continue;

      const px = (pos.prevPos.x + (pos.currPos.x - pos.prevPos.x) * t) * cs + cs / 2;
      const py = (pos.prevPos.y + (pos.currPos.y - pos.prevPos.y) * t) * cs + cs / 2;
      const frac = Math.max(0, Math.min(1, patient.health / 100));
      const color = frac > 0.66 ? 0x3F7E5A : frac > 0.33 ? 0xF59E0B : 0xEF4444;

      this._drawBar(g, px, py - cs * 0.50, barW, barH, frac, color);
    }

    for (const robot of robots) {
      const g = this._bars.get(robot.id);
      const pos = this._positions.get(robot.id);
      if (!g || !pos) continue;

      const px = (pos.prevPos.x + (pos.currPos.x - pos.prevPos.x) * t) * cs + cs / 2;
      const py = (pos.prevPos.y + (pos.currPos.y - pos.prevPos.y) * t) * cs + cs / 2;
      const frac = Math.max(0, Math.min(1, (robot.battery ?? 100) / 100));
      const color = frac > 0.4 ? 0x3F7E5A : frac > 0.2 ? 0xF59E0B : 0xEF4444;

      this._drawBar(g, px, py + cs * 0.44, barW, barH, frac, color);
    }
  }

  /** @private */
  _drawBar(g, cx, cy, barW, barH, frac, fillColor) {
    g.clear();
    const x = cx - barW / 2;
    const y = cy - barH / 2;

    // Light background track
    g.rect(x, y, barW, barH).fill({ color: 0xE7E5E4, alpha: 0.9 });

    // Coloured fill
    if (frac > 0) {
      g.rect(x, y, barW * frac, barH).fill({ color: fillColor });
    }
  }

  /** Destroy all bar graphics. */
  destroy() {
    for (const [, g] of this._bars) {
      this.container.removeChild(g);
      g.destroy();
    }
    this._bars.clear();
    this._positions.clear();
  }
}
