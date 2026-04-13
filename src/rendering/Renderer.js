/**
 * @fileoverview Main rendering controller.
 *
 * Creates the Pixi.js application, drives the animation loop (throttled by
 * TICK_DURATION_MS), and delegates drawing to GridRenderer, AgentSprites,
 * HealthBarRenderer, and ChartManager.
 *
 * The Renderer only *observes* the Scheduler — it never modifies simulation state
 * except by calling scheduler.tick() to advance one step.
 */
import { CONFIG } from '../config.js';
import Scheduler from '../simulation/Scheduler.js';
import GridRenderer from './GridRenderer.js';
import AgentSprites from './AgentSprites.js';
import HealthBarRenderer from './HealthBarRenderer.js';
import ChartManager from './ChartManager.js';

/** Pixels per grid cell */
const CELL_SIZE = 32;

export default class Renderer {
  /**
   * @param {object} params
   * @param {HTMLElement} params.canvasContainer - DOM element for the Pixi canvas
   * @param {HTMLCanvasElement} params.healthCanvas - for the health line chart
   * @param {HTMLCanvasElement} params.needsCanvas  - for the needs bar chart
   */
  constructor({ canvasContainer, healthCanvas, needsCanvas }) {
    this._canvasContainer = canvasContainer;
    this._healthCanvas    = healthCanvas;
    this._needsCanvas     = needsCanvas;

    /** @type {PIXI.Application|null} */
    this._app = null;
    /** @type {Scheduler|null} */
    this._scheduler = null;

    this._gridRenderer      = null;
    this._agentSprites      = null;
    this._healthBarRenderer = null;
    this._chartManager      = null;

    // Layers (Pixi containers)
    this._gridLayer   = null;
    this._barLayer    = null;
    this._spriteLayer = null;

    this._running        = false;
    this._tickDurationMs = CONFIG.TICK_DURATION_MS;
    this._lastTickTime   = 0;
    this._lerpT          = 0;

    // Scenario settings (mutable by reset())
    this._sceneSettings = {
      includeRobots: false,
      seed:          42,
      nurseCount:    CONFIG.NURSE_COUNT,
      mediCount:     CONFIG.MEDI_COUNT,
      blankiCount:   CONFIG.BLANKI_COUNT,
      ediCount:      CONFIG.EDI_COUNT,
    };
  }

  /**
   * Initialise Pixi.js asynchronously. Must be awaited before any other call.
   */
  async init() {
    this._app = new PIXI.Application();
    await this._app.init({
      width:           CONFIG.GRID_WIDTH  * CELL_SIZE,
      height:          CONFIG.GRID_HEIGHT * CELL_SIZE,
      backgroundColor: 0xfafafa,
      antialias:       true,
      resolution:      window.devicePixelRatio || 1,
      autoDensity:     true,
    });
    this._canvasContainer.appendChild(this._app.canvas);

    // Rendering layers — order determines draw order (grid → bars → sprites)
    this._gridLayer   = new PIXI.Container();
    this._barLayer    = new PIXI.Container();
    this._spriteLayer = new PIXI.Container();
    this._app.stage.addChild(this._gridLayer);
    this._app.stage.addChild(this._barLayer);
    this._app.stage.addChild(this._spriteLayer);

    this._chartManager = new ChartManager({
      healthCanvas: this._healthCanvas,
      needsCanvas:  this._needsCanvas,
    });

    this._buildSimulation();

    // Start Pixi render loop
    this._app.ticker.add(() => this._onFrame());
    this._lastTickTime = performance.now();
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  /** @private — build/rebuild Scheduler and all rendering objects */
  _buildSimulation() {
    const s = this._sceneSettings;
    const cfg = Object.assign({}, CONFIG, {
      NURSE_COUNT:      s.nurseCount,
      MEDI_COUNT:       s.mediCount,
      BLANKI_COUNT:     s.blankiCount,
      EDI_COUNT:        s.ediCount,
      TICK_DURATION_MS: this._tickDurationMs,
    });

    this._scheduler = new Scheduler({
      config:        cfg,
      seed:          s.seed,
      includeRobots: s.includeRobots,
    });

    // Clear layers
    this._gridLayer.removeChildren();
    this._barLayer.removeChildren();
    this._spriteLayer.removeChildren();

    const grid = this._scheduler._grid;

    this._gridRenderer = new GridRenderer({
      container: this._gridLayer,
      grid,
      cellSize: CELL_SIZE,
    });

    this._agentSprites = new AgentSprites({
      container: this._spriteLayer,
      cellSize:  CELL_SIZE,
    });
    this._agentSprites.initSprites(
      this._scheduler._patients,
      this._scheduler._nurses,
      this._scheduler._robots,
    );

    this._healthBarRenderer = new HealthBarRenderer({
      container: this._barLayer,
      cellSize:  CELL_SIZE,
    });
    this._healthBarRenderer.initBars(
      this._scheduler._patients,
      this._scheduler._robots,
    );

    this._chartManager?.clear();
    this._lerpT        = 0;
    this._lastTickTime = performance.now();
  }

  /** @private — called every animation frame by Pixi Ticker */
  _onFrame() {
    if (!this._scheduler) return;

    const now     = performance.now();
    const elapsed = now - this._lastTickTime;

    if (this._running && elapsed >= this._tickDurationMs) {
      this._doTick();
      this._lastTickTime = now;
      this._lerpT        = 0;
    } else if (this._running) {
      this._lerpT = elapsed / this._tickDurationMs;
    }

    this._render(this._lerpT);
  }

  /** @private — advance simulation by exactly one tick */
  _doTick() {
    const sched = this._scheduler;
    if (sched.currentTick >= CONFIG.TICKS_PER_RUN) {
      this.pause();
      return;
    }

    // Snapshot positions before advancing so lerp starts from the right place
    this._agentSprites.recordPositions(
      sched._patients, sched._nurses, sched._robots,
    );
    this._healthBarRenderer.recordPositions(sched._patients, sched._robots);

    sched.tick();

    // Update charts
    const history  = sched.getTickHistory();
    const snapshot = history[history.length - 1];
    const allNeeds = sched._needQueue.getAll();
    this._chartManager.pushTick(snapshot, allNeeds);

    this._dispatchTickEvent(snapshot, allNeeds);
  }

  /** @private — draw the current interpolated state */
  _render(lerpT) {
    const sched = this._scheduler;
    if (!sched) return;

    const allNeeds = sched._needQueue.getAll();

    this._agentSprites.update(
      lerpT,
      sched._patients,
      sched._nurses,
      sched._robots,
      allNeeds,
    );

    this._healthBarRenderer.update(lerpT, sched._patients, sched._robots);
  }

  /** @private — fire a 'sim-tick' CustomEvent for Alpine.js to consume */
  _dispatchTickEvent(snapshot, allNeeds) {
    const sched  = this._scheduler;
    const active = allNeeds.filter(n => n.status !== 'fulfilled');

    window.dispatchEvent(new CustomEvent('sim-tick', {
      detail: {
        tick:              sched.currentTick,
        criticalIncidents: sched._stats._criticalIncidents,
        nurseUtilisation:  snapshot.nurseUtilisation,
        robotUtilisation:  snapshot.robotUtilisation,
        avgHealth:         snapshot.averagePatientHealth,
        lowestHealth:      snapshot.lowestPatientHealth,
        activeNeeds: {
          emergency:      active.filter(n => n.type === 'emergency').length,
          medication:     active.filter(n => n.type === 'medication').length,
          comfort:        active.filter(n => n.type === 'comfort').length,
          visitor_escort: active.filter(n => n.type === 'visitor_escort').length,
        },
      },
    }));
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  /** Start/resume the simulation tick loop. */
  resume() {
    this._running      = true;
    this._lastTickTime = performance.now();
    window.dispatchEvent(new CustomEvent('sim-state', { detail: { isRunning: true } }));
  }

  /** Pause the simulation (Pixi render loop continues for smooth display). */
  pause() {
    this._running = false;
    window.dispatchEvent(new CustomEvent('sim-state', { detail: { isRunning: false } }));
  }

  /** Advance exactly one tick regardless of running state. */
  step() {
    if (!this._scheduler) return;
    if (this._scheduler.currentTick >= CONFIG.TICKS_PER_RUN) return;

    this._agentSprites.recordPositions(
      this._scheduler._patients,
      this._scheduler._nurses,
      this._scheduler._robots,
    );
    this._healthBarRenderer.recordPositions(
      this._scheduler._patients,
      this._scheduler._robots,
    );

    this._scheduler.tick();

    const history  = this._scheduler.getTickHistory();
    const snapshot = history[history.length - 1];
    const allNeeds = this._scheduler._needQueue.getAll();
    this._chartManager.pushTick(snapshot, allNeeds);
    this._dispatchTickEvent(snapshot, allNeeds);

    this._lerpT = 1;
    this._render(1);
  }

  /**
   * Rebuild the simulation with new settings.
   * @param {object} [settings]
   * @param {boolean} [settings.includeRobots]
   * @param {number}  [settings.seed]
   * @param {number}  [settings.nurseCount]
   * @param {number}  [settings.mediCount]
   * @param {number}  [settings.blankiCount]
   * @param {number}  [settings.ediCount]
   * @param {number}  [settings.tickDurationMs]
   */
  reset(settings = {}) {
    this._running = false;
    if (settings.tickDurationMs !== undefined) {
      this._tickDurationMs = settings.tickDurationMs;
    }
    Object.assign(this._sceneSettings, settings);
    this._buildSimulation();
    window.dispatchEvent(new CustomEvent('sim-state', { detail: { isRunning: false } }));
    // Emit a blank tick event so Alpine.js resets its counters
    this._dispatchTickEvent(
      { nurseUtilisation: 0, robotUtilisation: 0, averagePatientHealth: 100, lowestPatientHealth: 100 },
      [],
    );
  }

  /**
   * Change tick speed without rebuilding the simulation.
   * @param {number} ms - Milliseconds per tick
   */
  setSpeed(ms) {
    this._tickDurationMs = Math.max(50, ms);
  }

  /** @returns {boolean} */
  get isRunning() { return this._running; }
}
