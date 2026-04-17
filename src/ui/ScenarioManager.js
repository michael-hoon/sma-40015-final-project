/**
 * @fileoverview Scenario management — translates Alpine component state into
 * Renderer.reset() calls when the user switches scenarios or presses Reset.
 *
 * Keeps scenario-switching logic out of both the Alpine component and the Renderer,
 * giving each a single clear responsibility.
 *
 * Phase 4 addition: mutates CONFIG.NEED_SPAWN_RATE before reset so need-rate
 * sliders in the control panel propagate into the simulation without touching
 * Renderer.js. Renderer._buildSimulation() reads CONFIG at build time, so
 * a mutation immediately before reset() is picked up correctly.
 */
import { CONFIG } from '../config.js';

export default class ScenarioManager {
  constructor() {
    /** @type {'A'|'B'} */
    this._scenario = 'A';
  }

  /** @returns {'A'|'B'} */
  get scenario() { return this._scenario; }

  /**
   * Apply an Alpine component state snapshot as a full simulation reset.
   * Calls window.simRenderer.reset() with a correctly shaped config object.
   *
   * @param {object} settings
   * @param {'A'|'B'} settings.scenario
   * @param {number}  settings.seed
   * @param {number}  settings.nurseCount
   * @param {number}  settings.mediCount
   * @param {number}  settings.blankiCount
   * @param {number}  settings.ediCount
   * @param {number}  settings.tickDurationMs
   * @param {{emergency:number, medication:number, comfort:number, visitor_escort:number}} [settings.needRates]
   */
  apply(settings) {
    this._scenario = settings.scenario;

    // Mutate CONFIG.NEED_SPAWN_RATE so the upcoming reset picks up slider values.
    if (settings.needRates) {
      CONFIG.NEED_SPAWN_RATE.emergency      = settings.needRates.emergency;
      CONFIG.NEED_SPAWN_RATE.medication     = settings.needRates.medication;
      CONFIG.NEED_SPAWN_RATE.comfort        = settings.needRates.comfort;
      CONFIG.NEED_SPAWN_RATE.visitor_escort = settings.needRates.visitor_escort;
    }

    window.simRenderer?.reset({
      includeRobots:  settings.scenario === 'B',
      seed:           Number(settings.seed),
      nurseCount:     settings.nurseCount,
      mediCount:      settings.mediCount,
      blankiCount:    settings.blankiCount,
      ediCount:       settings.ediCount,
      tickDurationMs: settings.tickDurationMs,
    });
  }

  /**
   * Return canonical default parameters for a given scenario.
   * Includes need-rate defaults so Alpine can initialise the sliders.
   *
   * @param {'A'|'B'} scenario
   * @returns {object}
   */
  defaults(scenario) {
    return {
      scenario,
      seed:           CONFIG.RANDOM_SEED_START,
      nurseCount:     CONFIG.NURSE_COUNT,
      mediCount:      CONFIG.MEDI_COUNT,
      blankiCount:    CONFIG.BLANKI_COUNT,
      ediCount:       CONFIG.EDI_COUNT,
      tickDurationMs: CONFIG.TICK_DURATION_MS,
      needRates: {
        emergency:      CONFIG.NEED_SPAWN_RATE.emergency,
        medication:     CONFIG.NEED_SPAWN_RATE.medication,
        comfort:        CONFIG.NEED_SPAWN_RATE.comfort,
        visitor_escort: CONFIG.NEED_SPAWN_RATE.visitor_escort,
      },
    };
  }
}
