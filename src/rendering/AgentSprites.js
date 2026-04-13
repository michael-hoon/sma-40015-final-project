/**
 * @fileoverview Creates and updates Pixi.js sprites for all agent types.
 * Each agent gets a Container holding a coloured circle + text label.
 * Patient containers additionally show small need-indicator dots.
 *
 * Position interpolation: recordPositions() is called before each sim tick to
 * snapshot the pre-tick position; update(lerpT, ...) then interpolates display
 * position between the previous and current logical positions.
 */

/** Agent fill colours (spec §9) */
const AGENT_FILL = {
  patient: 0xffffff,
  nurse:   0x2e7d32,
  medi:    0x1565c0,
  blanki:  0xef6c00,
  edi:     0x7b1fa2,
};

/** Letter label per agent type */
const AGENT_LABEL = {
  patient: '',
  nurse:   'N',
  medi:    'M',
  blanki:  'B',
  edi:     'E',
};

/** Need dot colours (spec §9) */
const NEED_COLORS = {
  emergency:      0xf44336,
  medication:     0x2196f3,
  comfort:        0xff9800,
  visitor_escort: 0x9c27b0,
};

const NEED_ORDER = ['emergency', 'medication', 'comfort', 'visitor_escort'];

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
     * @type {Map<string, {container: PIXI.Container, needDots: PIXI.Graphics|null, prevPos: {x:number,y:number}, currPos: {x:number,y:number}}>}
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
      circle.circle(0, 0, radius).stroke({ color: 0x555555, width: 1.5 });
    }
    cont.addChild(circle);

    // Letter label (non-patients only)
    const labelChar = AGENT_LABEL[type];
    if (labelChar) {
      const label = new PIXI.Text({
        text: labelChar,
        style: {
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

    // Initial position
    const px = agent.position.x * cs + cs / 2;
    const py = agent.position.y * cs + cs / 2;
    cont.position.set(px, py);

    this.container.addChild(cont);
    this._sprites.set(agent.id, {
      container: cont,
      needDots,
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
   * Render interpolated agent positions and refresh patient need dots.
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

  /** Destroy all sprites. */
  destroy() {
    for (const [, s] of this._sprites) {
      this.container.removeChild(s.container);
      s.container.destroy({ children: true });
    }
    this._sprites.clear();
  }
}
