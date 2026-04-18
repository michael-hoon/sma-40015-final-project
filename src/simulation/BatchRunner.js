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
   * @param {number}  [count=30]
   * @param {(done: number, total: number) => void} [onProgress]
   * @param {object}  [configOverrides]
   * @param {object}  [opts]
   * @param {boolean} [opts.includeTickHistory=false] - When true, each result also carries a `tickHistory` array
   * @returns {Promise<object[]>} Array of per-replication summary objects. If
   *   `opts.includeTickHistory` is true, each element also has a `tickHistory`
   *   field with the full per-tick snapshot array.
   */
  async run(scenario, count = 30, onProgress, configOverrides = {}, opts = {}) {
    const cfg = Object.assign({}, CONFIG, configOverrides);
    const { includeTickHistory = false } = opts;
    const results = [];

    for (let i = 0; i < count; i++) {
      const seed = cfg.RANDOM_SEED_START + i;

      const sched = new Scheduler({
        config:        cfg,
        seed,
        includeRobots: scenario === 'B',
      });

      sched.run();
      const summary = sched.getStats();
      if (includeTickHistory) {
        summary.tickHistory = sched.getTickHistory();
      }
      summary._seed = seed;
      results.push(summary);

      onProgress?.(i + 1, count);
      await new Promise(resolve => setTimeout(resolve, 0));
    }

    return results;
  }
}
