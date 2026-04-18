/**
 * @fileoverview Central configuration for the CGH Hospital Robot ABM Simulation.
 * All tunable parameters are defined here. Agent classes and simulation logic
 * must read from this config — never hardcode values elsewhere.
 */

/** @type {string[][]} Default 20×15 ward grid layout.
 *  Symbols: '.' = CORRIDOR, 'B' = BED, 'N' = NURSE_STATION,
 *           'C' = CHARGING_BAY, 'E' = ENTRANCE, '#' = WALL
 */
export const DEFAULT_GRID = [
  // 0         1         2
  // 0123456789012345678901234
  ['#','#','#','#','#','#','#','#','#','#','#','#','#','#','#','#','#','#','#','#'],
  ['#', 'B', 'B', '.', 'B', 'B', '#', 'B', 'B', '.', 'B', 'B', '#', 'B', 'B', '.', 'B', 'B', '#', '#'],
  ['#', '.', '.', '.', '.', '.', '#', '.', '.', '.', '.', '.', '#', '.', '.', '.', '.', '.', '#', '#'],
  ['#', 'B', 'B', '.', 'B', 'B', '#', 'B', 'B', '.', 'B', 'B', '#', 'B', 'B', '.', 'B', 'B', '#', '#'],
  ['#', '.', '.', '.', '.', '.', '#', '.', '.', '.', '.', '.', '#', '.', '.', '.', '.', '.', '#', '#'],
  ['#', '#', '#', '.', '#', '#', 'N', '#', '#', '.', '#', '#', 'N', '#', '#', '.', '#', '#', '#', '#'],
  ['#', '.', '.', '.', '.', '.', '.', '.', '.', '.', '.', '.', '.', '.', '.', '.', '.', '.', 'C', '#'],
  ['E', '.', '.', '.', '.', '.', '.', '.', '.', '.', '.', '.', '.', '.', '.', '.', '.', '.', 'C', '#'],
  ['#', '.', '.', '.', '.', '.', '.', '.', '.', '.', '.', '.', '.', '.', '.', '.', '.', '.', 'C', '#'],
  ['#', '#', '#', '.', '#', '#', 'N', '#', '#', '.', '#', '#', 'N', '#', '#', '.', '#', '#', '#', '#'],
  ['#', '.', '.', '.', '.', '.', '#', '.', '.', '.', '.', '.', '#', '.', '.', '.', '.', '.', '#', '#'],
  ['#', 'B', 'B', '.', 'B', 'B', '#', 'B', 'B', '.', 'B', 'B', '#', 'B', 'B', '.', 'B', 'B', '#', '#'],
  ['#', '.', '.', '.', '.', '.', '#', '.', '.', '.', '.', '.', '#', '.', '.', '.', '.', '.', '#', '#'],
  ['#', 'B', 'B', '.', 'B', 'B', '#', 'B', 'B', '.', 'B', 'B', '#', 'B', 'B', '.', 'B', 'B', '#', '#'],
  ['#', '#', '#', '#', '#', '#', '#', '#', '#', '#', '#', '#', '#', '#', '#', '#', '#', '#', '#', '#'],
];

export const CELL_TYPES = {
  CORRIDOR: '.',
  BED: 'B',
  NURSE_STATION: 'N',
  CHARGING_BAY: 'C',
  ENTRANCE: 'E',
  WALL: '#',
};

/** Walkable cell types — agents may traverse these */
export const WALKABLE_CELLS = new Set(['.', 'N', 'C', 'E']);

export const CONFIG = {
  // ── Grid ────────────────────────────────────────────────────────────────────
  GRID_WIDTH: 20,
  GRID_HEIGHT: 15,
  GRID_LAYOUT: DEFAULT_GRID,

  // ── Timing ──────────────────────────────────────────────────────────────────
  /** Visual tick speed in milliseconds (rendering only, ignored in headless runs) */
  TICK_DURATION_MS: 200,
  /** Total ticks per simulation run */
  TICKS_PER_RUN: 960,   // 960 ticks × 30s/tick = 8-hour nursing shift
  /** Ticks discarded from statistics during warm-up */
  WARM_UP_TICKS: 50,
  /** Each tick represents this many seconds of real ward time */
  REAL_SECONDS_PER_TICK: 30,

  // ── Staffing ────────────────────────────────────────────────────────────────
  NURSE_COUNT: 4,
  MEDI_COUNT: 2,
  BLANKI_COUNT: 2,
  EDI_COUNT: 2,

  // ── Patient needs — spawn probability per tick (checked independently) ──────
  NEED_SPAWN_RATE: {
    emergency: 0.00015, // 6+ emergencies per 8-hour run on average
    medication: 0.0025, // 2+ medication needs per patient per 8-hour run on average
    comfort: 0.0035, // 3+ comfort needs per patient per 8-hour run on average
    visitor_escort: 0.001, // ~1 visitor escort need per patient per 8-hour run on average
  },

  // ── Need urgency weights (used in nurse scoring formula) ────────────────────
  URGENCY_WEIGHT: {
    emergency: 10,
    medication: 5,
    comfort: 2,
    visitor_escort: 1,
  },

  // ── Health mechanics ────────────────────────────────────────────────────────
  /** Health drain per tick for each active unfulfilled need */
  HEALTH_DRAIN_PER_TICK: {
    emergency: 1.0,
    medication: 0.3,
    comfort: 0.1,
    visitor_escort: 0.05,
  },
  /** Health gained when a need is fulfilled */
  HEALTH_RECOVERY_PER_NEED: 15,
  HEALTH_MAX: 100,
  /** Health reset value after a critical incident (health reaching 0) */
  HEALTH_CRITICAL_RESET: 25,

  // ── Service times [min, max] in ticks ───────────────────────────────────────
  SERVICE_TIME: {
    nurse: {
      emergency:      [20, 40],
      medication:     [6, 10],
      comfort:        [1, 3],
      visitor_escort: [3, 6],
    },
    robot: {
      medication:     [14, 18],   // MEDi
      comfort:        [5, 6],   // BLANKi
      visitor_escort: [6, 10],   // EDi (escort portion only)
    },
  },

  // ── Movement speed (ticks required to traverse one grid cell) ──────────────
  /** Higher value = slower. 1 = one cell per tick, 2 = one cell every two ticks. */
  MOVEMENT_TICKS_PER_CELL: {
    patient: 1,
    nurse:   1,
    medi:    2,
    blanki:  2,
    edi:     2,
  },

  // ── Item capacities ─────────────────────────────────────────────────────────
  /** Nurse carries up to 2 items total; allocation between medicine/blanket is demand-driven on refill */
  NURSE_ITEM_CAPACITY: 2,
  /** MEDi carries this many medicine vials before needing to visit refilling station */
  MEDI_ITEM_CAPACITY: 4,
  /** BLANKi carries this many blankets before needing to visit refilling station */
  BLANKI_ITEM_CAPACITY: 15,

  // ── Refilling station times ──────────────────────────────────────────────────
  /** Ticks required to restock one medicine vial at the refilling station */
  REFILL_TIME_PER_MEDICINE: 4,
  /** Ticks required to restock one blanket at the refilling station */
  REFILL_TIME_PER_BLANKET: 1,

  // ── Robot battery ───────────────────────────────────────────────────────────
  BATTERY_MAX: 80,
  /** Battery drain per tick while the robot is moving */
  BATTERY_DRAIN_MOVING: 0.25,
  /** Battery drain per tick while the robot is serving */
  BATTERY_DRAIN_SERVING: 0.1,
  /** Battery drain per tick while the robot is idle */
  BATTERY_DRAIN_IDLE: 0.1,
  /** Battery level that triggers a move-to-charger transition */
  BATTERY_LOW_THRESHOLD: 20,
  /** Battery gained per tick while charging */
  BATTERY_CHARGE_RATE: 0.5,

  // ── Experiment ──────────────────────────────────────────────────────────────
  REPLICATION_COUNT: 30,
  RANDOM_SEED_START: 1,


  // ── Debug ───────────────────────────────────────────────────────────────────
  /** Set to true to enable console.log output during development */
  DEBUG: false,

  // ── Sprites ─────────────────────────────────────────────────────────────────
  /** PNG paths for agent and grid-cell sprites (64×64 px with transparency). */
  SPRITES: {
    patient:       'assets/sprites/patient.png',
    nurse:         'assets/sprites/nurse.png',
    medi:          'assets/sprites/medi.png',
    blanki:        'assets/sprites/blanki.png',
    edi:           'assets/sprites/edi.png',
    nurse_station: 'assets/sprites/nurse_station.png',
    charging_bay:  'assets/sprites/charging_bay.png',
    entrance:      'assets/sprites/entrance.png',
  },
};
