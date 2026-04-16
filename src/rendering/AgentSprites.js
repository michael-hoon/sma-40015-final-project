/**
 * @fileoverview Creates and updates Pixi.js sprites for all agent types.
 * Each agent gets a Container holding a coloured circle + text label.
 * Patient containers additionally show small need-indicator dots.
 * Nurse, MEDi, and BLANKi containers show an inventory bar above the circle.
 *
 * Position interpolation: recordPositions() is called before each sim tick to
 * snapshot the pre-tick position; update(lerpT, ...) then interpolates display
 * position between the previous and current logical positions.
 */

/** Agent fill colours — warm light clinical palette */
const AGENT_FILL = {
  patient: 0xFFFFFF,
  nurse:   0x3F7E5A,
  medi:    0x0D9488,
  blanki:  0xD97706,
  edi:     0x7C3AED,
};

/** Letter label per agent type */
const AGENT_LABEL = {
  patient: '',
  nurse:   'N',
  medi:    'M',
  blanki:  'B',
  edi:     'E',
};

/** Need dot colours — muted clinical palette */
const NEED_COLORS = {
  emergency:      0xEF4444,
  medication:     0x0EA5E9,
  comfort:        0xF59E0B,
  visitor_escort: 0x8B5CF6,
};

/** Inventory bar colours — lighter tints of the item need colours */
const INV_COLORS = {
  medicine: 0x7DD3FC,  // sky-300 (medication)
  blanket:  0xFCD34D,  // amber-300 (comfort)
};

const NEED_ORDER = ['emergency', 'medication', 'comfort', 'visitor_escort'];

/**
 * Compute refill progress fraction (0 = just started, 1 = complete) for an agent
 * that is currently in the REFILLING state.
 * @param {{totalRefillTicks: number, refillTicksRemaining: number}} agent
 * @returns {number} 0–1
 */
function _refillProgress(agent) {
  if (!agent.totalRefillTicks) return 0;
  return Math.max(0, Math.min(1,
    (agent.totalRefillTicks - agent.refillTicksRemaining) / agent.totalRefillTicks,
  ));
}

/**
 * Infer the display type from an agent id string.
 * @param {string} id
 * @returns {string}
 */
function agentType(id) {
  if (id.startsWith('patient_')) return 'patient';
  if (id.startsWith('nurse_'))   return 'nurse';
  if (id.startsWith('medi_'))    return 'medi';
  if (id.startsWith('blanki_'))  return 'blanki';
  if (id.startsWith('edi_'))     return 'edi';
  return 'nurse';
}

export default class AgentSprites {
  /**
   * @param {object} params
   * @param {PIXI.Container} params.container
   * @param {number} params.cellSize
   */
  constructor({ container, cellSize }) {
    this.container = container;
    this.cellSize = cellSize;

    /**
     * Keyed by agent id.
     * @type {Map<string, {container: PIXI.Container, needDots: PIXI.Graphics|null, invBar: PIXI.Graphics|null, prevPos: {x:number,y:number}, currPos: {x:number,y:number}}>}
     */
    this._sprites = new Map();
  }

  /**
   * Create sprites for every agent. Call once per simulation init/reset.
   * @param {object[]} patients
   * @param {object[]} nurses
   * @param {object[]} robots
   */
  initSprites(patients, nurses, robots) {
    // Tear down existing sprites
    for (const [, s] of this._sprites) {
      this.container.removeChild(s.container);
      s.container.destroy({ children: true });
    }
    this._sprites.clear();

    // Patients rendered below nurses/robots
    for (const agent of [...patients, ...nurses, ...robots]) {
      this._createSprite(agent);
    }
  }

  /** @private */
  _createSprite(agent) {
    const type = agentType(agent.id);
    const cs = this.cellSize;
    const isPatient = type === 'patient';
    const radius = isPatient ? cs * 0.36 : cs * 0.30;

    const cont = new PIXI.Container();

    // Circle body
    const circle = new PIXI.Graphics();
    circle.circle(0, 0, radius).fill({ color: AGENT_FILL[type] });
    if (isPatient) {
      circle.circle(0, 0, radius).stroke({ color: 0xD6D3D1, width: 1.5 });
    } else {
      // Subtle white outer stroke for contrast on light background
      circle.circle(0, 0, radius).stroke({ color: 0xFFFFFF, width: 1, alpha: 0.9 });
    }
    cont.addChild(circle);

    // Letter label (non-patients only)
    const labelChar = AGENT_LABEL[type];
    if (labelChar) {
      const label = new PIXI.Text({
        text: labelChar,
        style: {
          fontFamily: 'Plus Jakarta Sans, system-ui, sans-serif',
          fontSize: Math.max(8, Math.floor(cs * 0.38)),
          fontWeight: 'bold',
          fill: '#ffffff',
          align: 'center',
        },
      });
      label.anchor.set(0.5, 0.5);
      cont.addChild(label);
    }

    // Need indicator dots container (patients only)
    let needDots = null;
    if (isPatient) {
      needDots = new PIXI.Graphics();
      cont.addChild(needDots);
    }

    // Inventory bar (nurse, medi, blanki only)
    let invBar = null;
    if (type === 'nurse' || type === 'medi' || type === 'blanki') {
      invBar = new PIXI.Graphics();
      cont.addChild(invBar);
    }

    // Initial position
    const px = agent.position.x * cs + cs / 2;
    const py = agent.position.y * cs + cs / 2;
    cont.position.set(px, py);

    this.container.addChild(cont);
    this._sprites.set(agent.id, {
      container: cont,
      needDots,
      invBar,
      prevPos: { ...agent.position },
      currPos: { ...agent.position },
    });
  }

  /**
   * Snapshot current logical positions before a tick runs.
   * Must be called once per tick, before the tick advances the simulation.
   * @param {object[]} patients
   * @param {object[]} nurses
   * @param {object[]} robots
   */
  recordPositions(patients, nurses, robots) {
    for (const agent of [...patients, ...nurses, ...robots]) {
      const s = this._sprites.get(agent.id);
      if (!s) continue;
      s.prevPos = { ...s.currPos };
      s.currPos = { ...agent.position };
    }
  }

  /**
   * Render interpolated agent positions and refresh patient need dots + agent inventory.
   * @param {number} lerpT - 0–1 progress through the current tick interval
   * @param {object[]} patients
   * @param {object[]} nurses
   * @param {object[]} robots
   * @param {object[]} allNeeds - result of NeedQueue.getAll()
   */
  update(lerpT, patients, nurses, robots, allNeeds) {
    const cs = this.cellSize;
    const t = Math.max(0, Math.min(1, lerpT));

    // Build active-needs-by-patient map
    /** @type {Map<string, object[]>} */
    const needsByPatient = new Map();
    for (const need of allNeeds) {
      if (need.status === 'fulfilled') continue;
      if (!needsByPatient.has(need.patientId)) needsByPatient.set(need.patientId, []);
      needsByPatient.get(need.patientId).push(need);
    }

    // Interpolate all agent positions
    for (const [, s] of this._sprites) {
      const px = (s.prevPos.x + (s.currPos.x - s.prevPos.x) * t) * cs + cs / 2;
      const py = (s.prevPos.y + (s.currPos.y - s.prevPos.y) * t) * cs + cs / 2;
      s.container.position.set(px, py);
    }

    // Update patient need dots
    for (const patient of patients) {
      const s = this._sprites.get(patient.id);
      if (!s || !s.needDots) continue;
      const needs = needsByPatient.get(patient.id) ?? [];
      this._drawNeedDots(s.needDots, needs, cs);
    }

    // Update inventory bars for nurses and robots
    for (const nurse of nurses) {
      const s = this._sprites.get(nurse.id);
      if (!s || !s.invBar) continue;
      this._drawNurseInventory(s.invBar, nurse, cs);  // nurse object passed directly
    }
    for (const robot of robots) {
      const s = this._sprites.get(robot.id);
      if (!s || !s.invBar) continue;
      const type = agentType(robot.id);
      if (type === 'medi') {
        const frac = robot.state === 'REFILLING'
          ? _refillProgress(robot)
          : robot.medicineCount / robot.config.MEDI_ITEM_CAPACITY;
        this._drawFillBar(s.invBar, frac, INV_COLORS.medicine, robot.state === 'REFILLING', cs);
      } else if (type === 'blanki') {
        const frac = robot.state === 'REFILLING'
          ? _refillProgress(robot)
          : robot.blanketCount / robot.config.BLANKI_ITEM_CAPACITY;
        this._drawFillBar(s.invBar, frac, INV_COLORS.blanket, robot.state === 'REFILLING', cs);
      }
    }
  }

  /** @private */
  _drawNeedDots(g, needs, cs) {
    g.clear();
    const toShow = NEED_ORDER.filter(t => needs.some(n => n.type === t));
    if (toShow.length === 0) return;

    const dotR = Math.max(2, cs * 0.11);
    const spacing = dotR * 2.6;
    const totalW = (toShow.length - 1) * spacing;
    const startX = -totalW / 2;
    const offsetY = cs * 0.50; // below the circle centre

    toShow.forEach((type, i) => {
      const need = needs.find(n => n.type === type);
      const isClaimed = need.status === 'claimed' || need.status === 'in_progress';
      const color = NEED_COLORS[type];
      const cx = startX + i * spacing;

      // Solid dot (dimmed if claimed/in-progress)
      g.circle(cx, offsetY, dotR).fill({ color, alpha: isClaimed ? 0.45 : 1.0 });

      // Pulsing ring for unclaimed needs (static thicker outline)
      if (!isClaimed) {
        g.circle(cx, offsetY, dotR + 1.5).stroke({ color, width: 1.2, alpha: 0.9 });
      }
    });
  }

  /**
   * Draw pip squares above a nurse circle showing carried items.
   * Number of pips = NURSE_ITEM_CAPACITY; pips are coloured by item type
   * (blue = medicine, orange = blanket) reflecting the actual dynamic inventory.
   * During REFILLING, shows a neutral progress bar instead of pips.
   * @private
   */
  _drawNurseInventory(g, nurse, cs) {
    g.clear();
    const capacity = nurse.config?.NURSE_ITEM_CAPACITY ?? 2;
    const pipW = Math.max(4, cs * 0.26);
    const pipH = Math.max(2, cs * 0.10);
    const gap  = Math.max(1, cs * 0.04);
    const totalW = pipW * capacity + gap * (capacity - 1);
    const barY   = -(cs * 0.50) - pipH / 2;
    const startX = -totalW / 2;

    if (nurse.state === 'REFILLING') {
      // Neutral progress bar — allocation type is determined at arrival
      const frac = _refillProgress(nurse);
      g.rect(startX, barY, totalW, pipH).fill({ color: 0xE7E5E4, alpha: 0.9 });
      if (frac > 0) {
        g.rect(startX, barY, totalW * frac, pipH).fill({ color: 0xA8A29E });
      }
      return;
    }

    // Build ordered item list: medicines first, then blankets, then empty slots
    const items = [];
    for (let i = 0; i < nurse.medicineCount; i++) items.push(INV_COLORS.medicine);
    for (let i = 0; i < nurse.blanketCount; i++) items.push(INV_COLORS.blanket);
    while (items.length < capacity) items.push(null);

    items.forEach((color, i) => {
      const x = startX + i * (pipW + gap);
      g.rect(x, barY, pipW, pipH).fill({ color: 0xE7E5E4, alpha: 0.9 });
      if (color !== null) {
        g.rect(x, barY, pipW, pipH).fill({ color });
      }
    });
  }

  /**
   * Draw a horizontal fill bar above a robot circle showing inventory level.
   * During refilling, the bar fills from left to right showing restock progress.
   * @param {PIXI.Graphics} g
   * @param {number} frac - 0–1 fill fraction
   * @param {number} fillColor - bar fill colour
   * @param {boolean} isRefilling - true when agent is in REFILLING state
   * @param {number} cs - cell size
   * @private
   */
  _drawFillBar(g, frac, fillColor, isRefilling, cs) {
    g.clear();
    const barW = cs * 0.78;
    const barH = Math.max(2, cs * 0.10);
    const barY = -(cs * 0.50) - barH / 2;  // centred at top of cell
    const f = Math.max(0, Math.min(1, frac));

    // Light background track
    g.rect(-barW / 2, barY, barW, barH).fill({ color: 0xE7E5E4, alpha: 0.9 });

    if (f > 0) {
      // Use a muted stone tint during refilling to signal "loading"
      const color = isRefilling ? 0xA8A29E : fillColor;
      g.rect(-barW / 2, barY, barW * f, barH).fill({ color });
    }
  }

  /** Destroy all sprites. */
  destroy() {
    for (const [, s] of this._sprites) {
      this.container.removeChild(s.container);
      s.container.destroy({ children: true });
    }
    this._sprites.clear();
  }
}
