/**
 * @fileoverview Control panel initialisation.
 *
 * Loaded dynamically from the Alpine simControl() component's init() method.
 * Responsibilities:
 *   1. Create and initialise the Pixi.js Renderer (async)
 *   2. Create the ScenarioManager and expose it on window
 *   3. Register sim-tick / sim-state CustomEvent listeners that push data
 *      into Alpine's reactive proxy so the UI updates automatically
 *   4. Build three sparkline Chart.js instances for KPI watermarks and push
 *      rolling data on each tick
 *
 * Nothing in this file touches the DOM directly except passing canvas
 * element references to the Renderer/ChartManager.
 *
 * Phase 4 addition: computes avgWaitSec by peeking at the live NeedQueue on
 * each tick (observer-only — no simulation state mutations).
 */
import Renderer        from '../rendering/Renderer.js';
import ChartManager    from '../rendering/ChartManager.js';
import ScenarioManager from './ScenarioManager.js';
import { CONFIG }      from '../config.js';

const SPARK_MAX = 80; // rolling window for sparkline charts

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
  window.simRenderer = renderer;

  // ── Scenario manager ──────────────────────────────────────────────────────
  const mgr = new ScenarioManager();
  window.simScenarioMgr = mgr;

  // ── Sparkline charts ──────────────────────────────────────────────────────
  // Built on separate canvas elements inside the KPI cards. These are purely
  // visual watermarks; they don't affect simulation state.
  const sparkWait   = ChartManager.buildSparkline(
    document.getElementById('spark-wait'),   '#E3B96B');
  const sparkHealth = ChartManager.buildSparkline(
    document.getElementById('spark-health'), '#5F9B7C');
  const sparkCrit   = ChartManager.buildSparkline(
    document.getElementById('spark-crit'),   '#EF4444');

  /** @param {Chart} chart @param {number} value */
  function pushSparkline(chart, value) {
    chart.data.labels.push('');
    chart.data.datasets[0].data.push(value);
    if (chart.data.labels.length > SPARK_MAX) {
      chart.data.labels.shift();
      chart.data.datasets[0].data.shift();
    }
    chart.update('none');
  }

  function clearSparklines() {
    for (const c of [sparkWait, sparkHealth, sparkCrit]) {
      c.data.labels = [];
      c.data.datasets[0].data = [];
      c.update('none');
    }
  }

  // ── Event forwarding: simulation → Alpine reactive state ──────────────────
  window.addEventListener('sim-tick', ({ detail: d }) => {
    comp.currentTick       = d.tick;
    comp.criticalIncidents = d.criticalIncidents;
    comp.nurseUtil         = d.nurseUtilisation;
    comp.robotUtil         = d.robotUtilisation;
    comp.avgHealth         = d.avgHealth;
    comp.lowestHealth      = d.lowestHealth;
    comp.activeNeeds       = { ...d.activeNeeds };

    // Compute average wait time from unfulfilled needs (observer-only)
    const needs = window.simRenderer?._scheduler?._needQueue?.getAll?.() ?? [];
    const open  = needs.filter(n => n.status !== 'fulfilled');
    const avgTicks = open.length
      ? open.reduce((s, n) => s + (d.tick - n.createdAtTick), 0) / open.length
      : 0;
    // REAL_SECONDS_PER_TICK (30 s) gives simulated time, not wall-clock rendering time
    comp.avgWaitSec = +(avgTicks * CONFIG.REAL_SECONDS_PER_TICK).toFixed(1);

    // Push to sparklines
    pushSparkline(sparkWait,   comp.avgWaitSec);
    pushSparkline(sparkHealth, comp.avgHealth);
    pushSparkline(sparkCrit,   comp.criticalIncidents);
  });

  // Sync the isRunning flag when the simulation auto-pauses
  window.addEventListener('sim-state', ({ detail: d }) => {
    comp.isRunning = d.isRunning;
  });

  // On manual reset (triggered by doReset in Alpine), clear sparklines
  window.addEventListener('sim-reset', () => {
    clearSparklines();
    comp.avgWaitSec = 0;
  });

  // Signal to Alpine that the renderer is ready — unlocks all controls
  comp.rendererReady = true;
}
