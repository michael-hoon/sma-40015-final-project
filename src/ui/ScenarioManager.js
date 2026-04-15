/**
 * @fileoverview Scenario management — translates Alpine component state into
 * Renderer.reset() calls when the user switches scenarios or presses Reset.
 *
 * Keeps scenario-switching logic out of both the Alpine component and the Renderer,
 * giving each a single clear responsibility.
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
   * @param {object} settings - subset of the Alpine component's reactive data
   * @param {'A'|'B'} settings.scenario
   * @param {number}  settings.seed
   * @param {number}  settings.nurseCount
   * @param {number}  settings.mediCount
   * @param {number}  settings.blankiCount
   * @param {number}  settings.ediCount
   * @param {number}  settings.tickDurationMs
   */
  apply(settings) {
    this._scenario = settings.scenario;
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
   * Useful for "load defaults" buttons or test resets.
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
    };
  }
}
