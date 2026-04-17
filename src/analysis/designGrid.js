/**
 * @fileoverview Enumerate the parameter-sweep design grid.
 *
 * Factorial (108 cells): NURSE_COUNT × MEDI × BLANKI × EDI
 *   3 × 4 × 3 × 3 = 108
 * OAT supplement (10 cells): 5 levels of need_spawn.medication,
 *                            5 levels of need_spawn.emergency,
 *                            robots fixed at (1,1,1), nurses at 5.
 * Total: 118 cells.
 *
 * Each cell is a plain object with:
 *   - cellId {string}     stable short identifier
 *   - scenario {'A'|'B'}  matches BatchRunner param
 *   - factors {object}    factor values (used for CSV rows)
 *   - overrides {object}  configOverrides to hand to BatchRunner
 *   - block {'factorial'|'oat_medication'|'oat_emergency'}
 */
import { CONFIG } from '../config.js';

const NURSE_LEVELS  = [3, 5, 7];
const MEDI_LEVELS   = [0, 1, 2, 3];
const BLANKI_LEVELS = [0, 1, 2];
const EDI_LEVELS    = [0, 1, 2];

const OAT_FACTORS   = [0.5, 0.75, 1.0, 1.5, 2.0];

const BASELINE_NURSE = 5;
const BASELINE_MEDI  = 1;
const BASELINE_BLANKI = 1;
const BASELINE_EDI   = 1;

/**
 * @returns {object[]} all design cells in deterministic order
 */
export function buildDesignGrid() {
  const cells = [];

  // ── Factorial block ─────────────────────────────────────────────────────
  for (const n of NURSE_LEVELS) {
    for (const m of MEDI_LEVELS) {
      for (const b of BLANKI_LEVELS) {
        for (const e of EDI_LEVELS) {
          const hasRobots = (m + b + e) > 0;
          cells.push({
            cellId: `F_N${n}_M${m}_B${b}_E${e}`,
            scenario: hasRobots ? 'B' : 'A',
            factors: {
              NURSE_COUNT:  n,
              MEDI_COUNT:   m,
              BLANKI_COUNT: b,
              EDI_COUNT:    e,
              needSpawn_emergency:      CONFIG.NEED_SPAWN_RATE.emergency,
              needSpawn_medication:     CONFIG.NEED_SPAWN_RATE.medication,
              needSpawn_comfort:        CONFIG.NEED_SPAWN_RATE.comfort,
              needSpawn_visitor_escort: CONFIG.NEED_SPAWN_RATE.visitor_escort,
            },
            overrides: {
              NURSE_COUNT:  n,
              MEDI_COUNT:   m,
              BLANKI_COUNT: b,
              EDI_COUNT:    e,
            },
            block: 'factorial',
          });
        }
      }
    }
  }

  // ── OAT medication rate ──────────────────────────────────────────────────
  for (const mult of OAT_FACTORS) {
    const rate = CONFIG.NEED_SPAWN_RATE.medication * mult;
    cells.push({
      cellId: `OATmed_${mult.toFixed(2)}`,
      scenario: 'B',
      factors: {
        NURSE_COUNT:  BASELINE_NURSE,
        MEDI_COUNT:   BASELINE_MEDI,
        BLANKI_COUNT: BASELINE_BLANKI,
        EDI_COUNT:    BASELINE_EDI,
        needSpawn_emergency:      CONFIG.NEED_SPAWN_RATE.emergency,
        needSpawn_medication:     rate,
        needSpawn_comfort:        CONFIG.NEED_SPAWN_RATE.comfort,
        needSpawn_visitor_escort: CONFIG.NEED_SPAWN_RATE.visitor_escort,
      },
      overrides: {
        NURSE_COUNT:  BASELINE_NURSE,
        MEDI_COUNT:   BASELINE_MEDI,
        BLANKI_COUNT: BASELINE_BLANKI,
        EDI_COUNT:    BASELINE_EDI,
        NEED_SPAWN_RATE: {
          ...CONFIG.NEED_SPAWN_RATE,
          medication: rate,
        },
      },
      block: 'oat_medication',
    });
  }

  // ── OAT emergency rate ───────────────────────────────────────────────────
  for (const mult of OAT_FACTORS) {
    const rate = CONFIG.NEED_SPAWN_RATE.emergency * mult;
    cells.push({
      cellId: `OATemg_${mult.toFixed(2)}`,
      scenario: 'B',
      factors: {
        NURSE_COUNT:  BASELINE_NURSE,
        MEDI_COUNT:   BASELINE_MEDI,
        BLANKI_COUNT: BASELINE_BLANKI,
        EDI_COUNT:    BASELINE_EDI,
        needSpawn_emergency:      rate,
        needSpawn_medication:     CONFIG.NEED_SPAWN_RATE.medication,
        needSpawn_comfort:        CONFIG.NEED_SPAWN_RATE.comfort,
        needSpawn_visitor_escort: CONFIG.NEED_SPAWN_RATE.visitor_escort,
      },
      overrides: {
        NURSE_COUNT:  BASELINE_NURSE,
        MEDI_COUNT:   BASELINE_MEDI,
        BLANKI_COUNT: BASELINE_BLANKI,
        EDI_COUNT:    BASELINE_EDI,
        NEED_SPAWN_RATE: {
          ...CONFIG.NEED_SPAWN_RATE,
          emergency: rate,
        },
      },
      block: 'oat_emergency',
    });
  }

  return cells;
}

/** The canonical baseline-B cell — the one whose tick history we export. */
export const BASELINE_B_CELL_ID = `F_N${BASELINE_NURSE}_M${BASELINE_MEDI}_B${BASELINE_BLANKI}_E${BASELINE_EDI}`;
