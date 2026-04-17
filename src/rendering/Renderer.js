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
import { computeWardOffset, isoToScreen, TILE_W, TILE_H } from './IsoProjection.js';
import { THEME } from './Theme.js';
import { emitNeedResolved, emitEmergencyPulse, emitCriticalIncident } from './ParticleFX.js';

/** GSAP — loaded from CDN before ES modules execute. */
const gsap = window.gsap;

/** Isometric canvas dimensions */
const ISO_CANVAS_W = 700;
const ISO_CANVAS_H = 420;

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

    // Ward container (iso-centred) and rendering layers
    this._wardContainer        = null;
    this._wardOriginX          = 0;   // stored so _shakeWard can restore exactly
    this._gridLayer            = null;
    this._cellFxLayer          = null;
    this._barLayer             = null;
    this._spriteLayer          = null;
    this._particleLayer        = null;
    this._nurseStationOverlays = [];

    /** @type {{needs:Map,patients:Map}|null} */
    this._prevSnapshot = null;

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
      width:           ISO_CANVAS_W,
      height:          ISO_CANVAS_H,
      backgroundColor: 0xFAFAF9,
      antialias:       true,
      resolution:      window.devicePixelRatio || 1,
      autoDensity:     true,
    });
    this._canvasContainer.appendChild(this._app.canvas);

    // Subtle elevation shadow behind the entire ward
    const _offset = computeWardOffset(
      CONFIG.GRID_WIDTH, CONFIG.GRID_HEIGHT, ISO_CANVAS_W, ISO_CANVAS_H,
    );
    const _shadowY = _offset.y + (CONFIG.GRID_WIDTH + CONFIG.GRID_HEIGHT - 2) * (TILE_H / 2) + 22;
    const _shadow  = new PIXI.Graphics();
    _shadow.ellipse(ISO_CANVAS_W / 2, _shadowY, 290, 12)
      .fill({ color: 0x000000, alpha: 0.05 });
    this._app.stage.addChild(_shadow);

    // Ward container — all iso geometry is relative to this origin
    this._wardContainer = new PIXI.Container();
    this._wardContainer.position.set(_offset.x, _offset.y);
    this._wardOriginX   = _offset.x;
    this._app.stage.addChild(this._wardContainer);

    // Rendering layers inside the ward container (grid → cellFx → bars → sprites → particles)
    this._gridLayer      = new PIXI.Container();
    this._cellFxLayer    = new PIXI.Container(); // bed-claim flash diamonds (under sprites)
    this._barLayer       = new PIXI.Container();
    this._spriteLayer    = new PIXI.Container();
    this._particleLayer  = new PIXI.Container(); // burst/ring effects (top of stack)
    this._wardContainer.addChild(this._gridLayer);
    this._wardContainer.addChild(this._cellFxLayer);
    this._wardContainer.addChild(this._barLayer);
    this._wardContainer.addChild(this._spriteLayer);
    this._wardContainer.addChild(this._particleLayer);

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

    // Clear layers — effect layers need destroy() to avoid orphan GSAP callbacks
    this._gridLayer.removeChildren();
    for (const child of [...this._cellFxLayer.children]) {
      gsap.killTweensOf(child);
      child.destroy();
    }
    this._cellFxLayer.removeChildren();
    this._barLayer.removeChildren();
    this._spriteLayer.removeChildren();
    for (const child of [...this._particleLayer.children]) {
      gsap.killTweensOf(child);
      child.destroy();
    }
    this._particleLayer.removeChildren();

    const grid = this._scheduler._grid;

    this._gridRenderer = new GridRenderer({
      container: this._gridLayer,
      grid,
    });

    this._agentSprites = new AgentSprites({
      container: this._spriteLayer,
    });
    this._agentSprites.initSprites(
      this._scheduler._patients,
      this._scheduler._nurses,
      this._scheduler._robots,
    );

    this._healthBarRenderer = new HealthBarRenderer({
      container: this._barLayer,
    });
    this._healthBarRenderer.initBars(
      this._scheduler._patients,
      this._scheduler._robots,
    );

    this._addNurseStationOverlays(grid);

    this._chartManager?.clear();
    this._lerpT        = 0;
    this._lastTickTime = performance.now();

    // Capture initial snapshot so first tick doesn't false-fire events for
    // all pre-existing needs.
    this._prevSnapshot = this._captureSnapshot();
  }

  /**
   * Add a gently pulsing translucent highlight over each nurse station cell.
   * Overlaid on top of the static GridRenderer draw — barely perceptible,
   * just enough to make the hub feel "alive".
   * @param {import('../simulation/Grid.js').default} grid
   * @private
   */
  _addNurseStationOverlays(grid) {
    // Kill and remove any overlays from the previous run
    for (const g of this._nurseStationOverlays) {
      gsap.killTweensOf(g);
      g.parent?.removeChild(g);
      g.destroy();
    }
    this._nurseStationOverlays = [];

    const hw = TILE_W / 2;
    const hh = TILE_H / 2;

    for (const { x: col, y: row } of grid.getNurseStations()) {
      const { x: cx, y: cy } = isoToScreen(col, row);
      const overlay = new PIXI.Graphics();
      overlay.alpha = 0;
      // Translucent white highlight that pulses over the cell
      overlay.poly([cx, cy - hh, cx + hw, cy, cx, cy + hh, cx - hw, cy])
        .fill({ color: 0xFFFFFF });
      this._gridLayer.addChild(overlay);
      this._nurseStationOverlays.push(overlay);

      gsap.to(overlay, {
        alpha: 0.12,
        duration: 2,
        yoyo: true,
        repeat: -1,
        ease: 'sine.inOut',
        delay: Math.random() * 4,
      });
    }
  }

  // ── Phase 3 FX helpers ───────────────────────────────────────────────────────

  /**
   * Capture a lightweight snapshot of need statuses and patient critical-incident
   * counts for diffing between ticks.
   * @returns {{needs: Map<string,object>, patients: Map<string,object>}}
   * @private
   */
  _captureSnapshot() {
    const sched = this._scheduler;
    if (!sched) return { needs: new Map(), patients: new Map() };

    const needs = new Map();
    for (const n of sched._needQueue.getAll()) {
      needs.set(n.id, {
        status:        n.status,
        type:          n.type,
        patientId:     n.patientId,
        createdAtTick: n.createdAtTick,
      });
    }

    const patients = new Map();
    for (const p of sched._patients) {
      patients.set(p.id, {
        criticalIncidents: p.criticalIncidents,
        health:            p.health,
      });
    }

    return { needs, patients };
  }

  /**
   * Diff two snapshots and return a list of visual events.
   * @param {{needs:Map,patients:Map}} prev
   * @param {{needs:Map,patients:Map}} curr
   * @returns {Array<{kind:string,patientId:string,needType?:string}>}
   * @private
   */
  _detectEvents(prev, curr) {
    const events = [];

    for (const [id, need] of curr.needs) {
      const prevNeed = prev.needs.get(id);
      if (!prevNeed) {
        // Brand-new need — check for emergency
        if (need.type === 'emergency') {
          events.push({ kind: 'emergency_spawned', patientId: need.patientId, needType: need.type });
        }
      } else {
        // Status transition on an existing need
        if (prevNeed.status !== 'fulfilled' && need.status === 'fulfilled') {
          events.push({ kind: 'need_resolved', patientId: need.patientId, needType: need.type });
        }
        if (prevNeed.status === 'open' && need.status === 'claimed') {
          events.push({ kind: 'need_claimed', patientId: need.patientId, needType: need.type });
        }
      }
    }

    for (const [id, patient] of curr.patients) {
      const prevPatient = prev.patients.get(id);
      if (prevPatient && patient.criticalIncidents > prevPatient.criticalIncidents) {
        events.push({ kind: 'critical_incident', patientId: id });
      }
    }

    return events;
  }

  /**
   * Translate detected events into particle / highlight effects.
   * @param {Array<{kind:string,patientId:string,needType?:string}>} events
   * @private
   */
  _dispatchFX(events) {
    const sched = this._scheduler;
    for (const evt of events) {
      const patient = sched._patients.find(p => p.id === evt.patientId);
      if (!patient) continue;
      const { x: sx, y: sy } = isoToScreen(patient.position.x, patient.position.y);

      switch (evt.kind) {
        case 'need_resolved':
          emitNeedResolved(this._particleLayer, sx, sy, evt.needType);
          break;
        case 'emergency_spawned':
          emitEmergencyPulse(this._particleLayer, sx, sy);
          this._shakeWard();
          break;
        case 'critical_incident':
          emitCriticalIncident(this._particleLayer, sx, sy);
          break;
        case 'need_claimed':
          this._flashBed(patient.position.x, patient.position.y);
          break;
        default:
          break;
      }
    }
  }

  /**
   * Brief ward-container horizontal shake on emergency spawn.
   * Deduped via killTweensOf so rapid emergencies don't stack.
   * @private
   */
  _shakeWard() {
    const wc      = this._wardContainer;
    const originX = this._wardOriginX;
    gsap.killTweensOf(wc.position, 'x');
    wc.position.x = originX;
    gsap.to(wc.position, {
      x:        originX + 4,
      duration: 0.04,
      yoyo:     true,
      repeat:   5,
      ease:     'none',
      onComplete: () => { wc.position.x = originX; },
    });
  }

  /**
   * Flash a diamond highlight over a bed cell when a need is claimed.
   * @param {number} col - grid column
   * @param {number} row - grid row
   * @private
   */
  _flashBed(col, row) {
    const { x: cx, y: cy } = isoToScreen(col, row);
    const hw = TILE_W / 2;
    const hh = TILE_H / 2;

    const flash = new PIXI.Graphics();
    flash.poly([cx, cy - hh, cx + hw, cy, cx, cy + hh, cx - hw, cy])
      .fill({ color: 0xFFFFFF });
    flash.alpha = 0;
    this._cellFxLayer.addChild(flash);

    gsap.to(flash, {
      alpha:    0.35,
      duration: 0.1,
      ease:     'power1.in',
      onComplete: () => {
        gsap.to(flash, {
          alpha:    0,
          duration: 0.3,
          ease:     'power1.out',
          onComplete: () => {
            this._cellFxLayer.removeChild(flash);
            flash.destroy();
          },
        });
      },
    });
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

    // Fire GSAP movement tweens for agents that changed position
    this._agentSprites.startTickTweens(
      sched._patients, sched._nurses, sched._robots, this._tickDurationMs,
    );

    // Update charts
    const history  = sched.getTickHistory();
    const snapshot = history[history.length - 1];
    const allNeeds = sched._needQueue.getAll();
    this._chartManager.pushTick(snapshot, allNeeds);

    // Phase 3: diff simulation state and fire particle / highlight effects
    const currSnapshot = this._captureSnapshot();
    if (this._prevSnapshot) {
      this._dispatchFX(this._detectEvents(this._prevSnapshot, currSnapshot));
    }
    this._prevSnapshot = currSnapshot;

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
    gsap.globalTimeline.resume();
    window.dispatchEvent(new CustomEvent('sim-state', { detail: { isRunning: true } }));
  }

  /** Pause the simulation (Pixi render loop continues for smooth display). */
  pause() {
    this._running = false;
    gsap.globalTimeline.pause();
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

    this._agentSprites.startTickTweens(
      this._scheduler._patients,
      this._scheduler._nurses,
      this._scheduler._robots,
      this._tickDurationMs,
    );

    const history  = this._scheduler.getTickHistory();
    const snapshot = history[history.length - 1];
    const allNeeds = this._scheduler._needQueue.getAll();
    this._chartManager.pushTick(snapshot, allNeeds);

    // Phase 3: diff simulation state and fire particle / highlight effects
    const currSnapshot = this._captureSnapshot();
    if (this._prevSnapshot) {
      this._dispatchFX(this._detectEvents(this._prevSnapshot, currSnapshot));
    }
    this._prevSnapshot = currSnapshot;

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
    gsap.globalTimeline.resume(); // ensure timeline is live so new tweens fire immediately
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
