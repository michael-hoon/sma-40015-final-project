/**
 * @fileoverview Billboard health bars above patients and battery bars below robots.
 *
 * Bars are screen-aligned (not isometrically skewed). Each bar is a small
 * Graphics object redrawn each frame at the agent's interpolated iso position.
 * The bars are positioned using isoToScreen() and offset in screen space.
 *
 * Phase 3 addition: when a patient's health fraction drops below 0.33 the bar
 * gains a GSAP scale-yoyo pulse.  The Graphics origin is now at the bar's
 * screen-space centre so that scaling looks correct.
 */
import { isoToScreen } from './IsoProjection.js';
import { THEME } from './Theme.js';

/** @type {typeof window.gsap} */
const gsap = window.gsap;

const AGENT_LIFT = 8;   // matches AgentSprites — agents float this many px above tile
const PATIENT_R  = 10;  // patient circle radius (for bar placement)
const ROBOT_R    = 9;   // robot hexagon radius

const BAR_W = 20;
const BAR_H = 3;

/** Fraction threshold below which the health bar pulses. */
const CRIT_FRAC = 0.33;

export default class HealthBarRenderer {
  /**
   * @param {object} params
   * @param {PIXI.Container} params.container
   */
  constructor({ container }) {
    this.container  = container;

    /** @type {Map<string, PIXI.Graphics>} */
    this._bars      = new Map();

    /** @type {Map<string, {prevPos:{x:number,y:number}, currPos:{x:number,y:number}}>} */
    this._positions = new Map();

    /**
     * GSAP tween handles for pulsing bars, keyed by patient id.
     * @type {Map<string, object>}
     */
    this._pulseTweens = new Map();

    /**
     * Set of patient ids whose bar is currently pulsing.
     * @type {Set<string>}
     */
    this._pulsing = new Set();
  }

  /**
   * Create bar graphics for every patient and robot.
   * Call once per simulation init / reset.
   * @param {object[]} patients
   * @param {object[]} robots
   */
  initBars(patients, robots) {
    // Kill pulse tweens from any previous run
    for (const tween of this._pulseTweens.values()) tween.kill();
    this._pulseTweens.clear();
    this._pulsing.clear();

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
   * Redraw all bars at interpolated iso positions.
   * @param {number} lerpT - 0–1 progress through current tick interval
   * @param {object[]} patients
   * @param {object[]} robots
   */
  update(lerpT, patients, robots) {
    const t = Math.max(0, Math.min(1, lerpT));

    for (const patient of patients) {
      const g   = this._bars.get(patient.id);
      const pos = this._positions.get(patient.id);
      if (!g || !pos) continue;

      const col = pos.prevPos.x + (pos.currPos.x - pos.prevPos.x) * t;
      const row = pos.prevPos.y + (pos.currPos.y - pos.prevPos.y) * t;
      const { x: px, y: py } = isoToScreen(col, row);

      // Position bar Graphics at its centre in screen space
      const barCy = py - AGENT_LIFT - PATIENT_R - 5;
      g.position.set(px, barCy);

      const frac  = Math.max(0, Math.min(1, patient.health / 100));
      const color = frac > 0.66 ? THEME.healthOk
                  : frac > 0.33 ? THEME.healthWarn
                  :               THEME.healthCrit;

      this._drawBar(g, frac, color);
      this._managePulse(patient.id, g, frac);
    }

    for (const robot of robots) {
      const g   = this._bars.get(robot.id);
      const pos = this._positions.get(robot.id);
      if (!g || !pos) continue;

      const col = pos.prevPos.x + (pos.currPos.x - pos.prevPos.x) * t;
      const row = pos.prevPos.y + (pos.currPos.y - pos.prevPos.y) * t;
      const { x: px, y: py } = isoToScreen(col, row);

      // Battery bar placed below the robot hexagon
      const barCy = py - AGENT_LIFT + ROBOT_R + 6;
      g.position.set(px, barCy);

      const frac  = Math.max(0, Math.min(1, (robot.battery ?? 100) / 100));
      const color = frac > 0.4 ? THEME.healthOk
                  : frac > 0.2 ? THEME.healthWarn
                  :              THEME.healthCrit;

      this._drawBar(g, frac, color);
      // Robot battery bars intentionally not pulsed (patients only)
    }
  }

  /**
   * Draw a single rounded-cap bar centred at the Graphics object's own origin.
   * Caller must set g.position before calling.
   * @param {PIXI.Graphics} g
   * @param {number} frac       - 0–1 fill fraction
   * @param {number} fillColor
   * @private
   */
  _drawBar(g, frac, fillColor) {
    g.clear();
    const x = -BAR_W / 2;
    const y = -BAR_H / 2;

    // Background track
    g.roundRect(x, y, BAR_W, BAR_H, BAR_H / 2).fill({ color: THEME.barTrack, alpha: 0.8 });

    // Coloured fill
    if (frac > 0) {
      g.roundRect(x, y, BAR_W * frac, BAR_H, BAR_H / 2).fill({ color: fillColor });
    }
  }

  /**
   * Start or stop the scale-pulse tween on a patient's health bar.
   * @param {string}         id   - patient id
   * @param {PIXI.Graphics}  g
   * @param {number}         frac - current health fraction
   * @private
   */
  _managePulse(id, g, frac) {
    const isPulsing = this._pulsing.has(id);

    if (frac < CRIT_FRAC && !isPulsing) {
      // Start pulsing
      const tween = gsap.to(g.scale, {
        x: 1.15,
        y: 1.5,
        duration: 0.4,
        yoyo:     true,
        repeat:   -1,
        ease:     'sine.inOut',
      });
      this._pulseTweens.set(id, tween);
      this._pulsing.add(id);
    } else if (frac >= CRIT_FRAC && isPulsing) {
      // Stop pulsing and snap scale back to 1
      const tween = this._pulseTweens.get(id);
      if (tween) { tween.kill(); this._pulseTweens.delete(id); }
      g.scale.set(1, 1);
      this._pulsing.delete(id);
    }
  }

  /** Destroy all bar graphics and kill any pulse tweens. */
  destroy() {
    for (const tween of this._pulseTweens.values()) tween.kill();
    this._pulseTweens.clear();
    this._pulsing.clear();

    for (const [, g] of this._bars) {
      this.container.removeChild(g);
      g.destroy();
    }
    this._bars.clear();
    this._positions.clear();
  }
}
