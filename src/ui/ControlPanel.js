/**
 * @fileoverview Control panel initialisation.
 *
 * Loaded dynamically from the Alpine simControl() component's init() method.
 * Responsibilities:
 *   1. Create and initialise the Pixi.js Renderer (async)
 *   2. Create the ScenarioManager and expose it on window
 *   3. Register sim-tick / sim-state CustomEvent listeners that push data
 *      into Alpine's reactive proxy so the UI updates automatically
 *
 * Nothing in this file touches the DOM directly except passing canvas
 * element references to the Renderer.
 */
import Renderer        from '../rendering/Renderer.js';
import ScenarioManager from './ScenarioManager.js';

/**
 * Wire up the simulation to the Alpine control panel component.
 * Called once from simControl.init() with the component's `this` context.
 *
 * @param {object} comp - Alpine reactive data proxy (simControl's `this`)
 */
export async function initControlPanel(comp) {
  // ── Renderer ─────────────────────────────────────────────────────────────
  const renderer = new Renderer({
    canvasContainer: document.getElementById('canvas-container'),
    healthCanvas:    document.getElementById('health-chart'),
    needsCanvas:     document.getElementById('needs-chart'),
  });
  await renderer.init();
  window.simRenderer    = renderer;

  // ── Scenario manager ──────────────────────────────────────────────────────
  const mgr = new ScenarioManager();
  window.simScenarioMgr = mgr;

  // ── Event forwarding: simulation → Alpine reactive state ──────────────────
  //
  // The Renderer dispatches CustomEvents on window after each tick.
  // We forward the payload into the Alpine proxy here, keeping the Renderer
  // completely unaware of Alpine.
  window.addEventListener('sim-tick', ({ detail: d }) => {
    comp.currentTick       = d.tick;
    comp.criticalIncidents = d.criticalIncidents;
    comp.nurseUtil         = d.nurseUtilisation;
    comp.robotUtil         = d.robotUtilisation;
    comp.avgHealth         = d.avgHealth;
    comp.lowestHealth      = d.lowestHealth;
    comp.activeNeeds       = { ...d.activeNeeds };
  });

  // Sync the isRunning flag when the simulation auto-pauses (e.g. run complete)
  window.addEventListener('sim-state', ({ detail: d }) => {
    comp.isRunning = d.isRunning;
  });

  // Signal to Alpine that the renderer is ready — unlocks all controls
  comp.rendererReady = true;
}
