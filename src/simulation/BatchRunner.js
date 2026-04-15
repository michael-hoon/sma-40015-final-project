/**
 * @fileoverview Headless batch runner for multi-replication experiments.
 *
 * Runs N replications of a scenario sequentially, yielding after each one
 * so the browser can update the progress bar between replications.
 * No rendering code is imported or used here — pure simulation only.
 */
import { CONFIG } from '../config.js';
import Scheduler  from './Scheduler.js';

export default class BatchRunner {
  /**
   * Run N headless replications of a scenario.
   *
   * Seeds are assigned sequentially starting at CONFIG.RANDOM_SEED_START
   * so results match the spec's experiment design (seeds 1–30).
   *
   * @param {'A'|'B'} scenario - 'A' = nurses only, 'B' = nurses + robots
   * @param {number}  [count=30] - Number of replications
   * @param {(done: number, total: number) => void} [onProgress]
   * @param {object}  [configOverrides] - Optional CONFIG field overrides
   * @returns {Promise<object[]>} Array of per-replication KPI summary objects
   */
  async run(scenario, count = 30, onProgress, configOverrides = {}) {
    const cfg = Object.assign({}, CONFIG, configOverrides);
    const results = [];

    for (let i = 0; i < count; i++) {
      const seed = cfg.RANDOM_SEED_START + i;

      const sched = new Scheduler({
        config:        cfg,
        seed,
        includeRobots: scenario === 'B',
      });

      // Run the full simulation length (TICKS_PER_RUN ticks, WARM_UP_TICKS discarded internally)
      sched.run();
      results.push(sched.getStats());

      onProgress?.(i + 1, count);

      // Yield to the event loop — lets Alpine update the progress bar
      await new Promise(resolve => setTimeout(resolve, 0));
    }

    return results;
  }
}
