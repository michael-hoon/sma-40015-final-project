/**
 * @fileoverview Phase 2 — GSAP-powered agent animations.
 *
 * Container hierarchy per agent:
 *   outerCont  (world position — GSAP movement target)
 *     innerCont (cosmetic space — tilt, hum, scale/breathe tweens)
 *       shape        circle | roundedRect | hexagon
 *       label        letter label (non-patients)
 *       needDots     PIXI.Graphics redrawn each frame (patients)
 *       invBar       PIXI.Graphics redrawn each frame (nurse/medi/blanki)
 *
 * GSAP tweens:
 *   Movement  → gsap.to(outer, {x, y, duration, ease:'power2.inOut'})
 *   Tilt      → gsap.to(inner, {rotation, ...}) returns to 0 on arrival
 *   Breathe   → gsap.to(inner.scale, {x/y:1.03, yoyo, repeat:-1}) patients
 *   Hum       → gsap.to(inner, {y:1.5, yoyo, repeat:-1}) robots in IDLE
 *   ChargeRing→ gsap.to(ring, {alpha:0.6, yoyo, repeat:-1}) robots CHARGING
 *   DotBob    → 4 proxy objects {y:0} tweened yoyo, used in drawNeedDots
 */
import { isoToScreen } from './IsoProjection.js';
import { THEME } from './Theme.js';

// ── Agent geometry ────────────────────────────────────────────────────────────
const AGENT_LIFT  = 8;   // px agents float above tile centre
const PATIENT_R   = 10;
const NURSE_SIZE  = 14;
const ROBOT_R     = 9;

const NEED_ORDER = ['emergency', 'medication', 'comfort', 'visitor_escort'];

/** GSAP handle — loaded from CDN before ES modules execute. */
const gsap = window.gsap;

// ── Internal helpers ──────────────────────────────────────────────────────────

function _hexPoints(r) {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i - Math.PI / 6;
    pts.push(r * Math.cos(angle), r * Math.sin(angle));
  }
  return pts;
}

function _refillProgress(agent) {
  if (!agent.totalRefillTicks) return 0;
  return Math.max(0, Math.min(1,
    (agent.totalRefillTicks - agent.refillTicksRemaining) / agent.totalRefillTicks,
  ));
}

function _agentType(id) {
  if (id.startsWith('patient_')) return 'patient';
  if (id.startsWith('nurse_'))   return 'nurse';
  if (id.startsWith('medi_'))    return 'medi';
  if (id.startsWith('blanki_'))  return 'blanki';
  if (id.startsWith('edi_'))     return 'edi';
  return 'nurse';
}

function _isRobot(type) {
  return type === 'medi' || type === 'blanki' || type === 'edi';
}

// ── AgentSprites ──────────────────────────────────────────────────────────────

export default class AgentSprites {
  /**
   * @param {object} params
   * @param {PIXI.Container} params.container
   */
  constructor({ container }) {
    this.container = container;

    /**
     * Sprite records keyed by agent id.
     * @type {Map<string, {
     *   outer: PIXI.Container,
     *   inner: PIXI.Container,
     *   needDots: PIXI.Graphics|null,
     *   invBar: PIXI.Graphics|null,
     *   currPos: {x:number,y:number},
     *   dotBob: Array<{y:number}>|null,
     *   humTween: object|null,
     *   chargeRing: PIXI.Graphics|null,
     *   chargeTween: object|null,
     *   lastState: string|null,
     * }>}
     */
    this._sprites = new Map();
  }

  // ── Public: init / reset ──────────────────────────────────────────────────

  /**
   * Create sprites for all agents. Call once per simulation init / reset.
   * @param {object[]} patients
   * @param {object[]} nurses
   * @param {object[]} robots
   */
  initSprites(patients, nurses, robots) {
    // Tear down old sprites + kill their tweens
    for (const [, s] of this._sprites) {
      _killAllTweens(s);
      this.container.removeChild(s.outer);
      s.outer.destroy({ children: true });
    }
    this._sprites.clear();

    for (const agent of [...patients, ...nurses, ...robots]) {
      this._createSprite(agent);
    }
  }

  // ── Public: per-tick calls ────────────────────────────────────────────────

  /**
   * Snapshot logical positions BEFORE a tick advances.
   * @param {object[]} patients
   * @param {object[]} nurses
   * @param {object[]} robots
   */
  recordPositions(patients, nurses, robots) {
    for (const agent of [...patients, ...nurses, ...robots]) {
      const s = this._sprites.get(agent.id);
      if (s) s.currPos = { ...agent.position };
    }
  }

  /**
   * Fire GSAP movement tweens AFTER the tick has advanced agent positions.
   * Also updates idle/charging state animations when state changes.
   * @param {object[]} patients
   * @param {object[]} nurses
   * @param {object[]} robots
   * @param {number} tickDurationMs
   */
  startTickTweens(patients, nurses, robots, tickDurationMs) {
    const dur  = tickDurationMs / 1000;

    for (const agent of [...patients, ...nurses, ...robots]) {
      const s = this._sprites.get(agent.id);
      if (!s) continue;

      const type   = _agentType(agent.id);
      const newPos = agent.position;
      const oldPos = s.currPos; // set by recordPositions (pre-tick)
      const moved  = newPos.x !== oldPos.x || newPos.y !== oldPos.y;

      const { x: toX, y: toY } = isoToScreen(newPos.x, newPos.y);
      const targetX = toX;
      const targetY = toY - AGENT_LIFT;

      if (moved) {
        const ease = (type === 'nurse' || type === 'patient') ? 'power2.inOut' : 'power1.inOut';

        // Kill any in-flight movement tween then start new one
        gsap.killTweensOf(s.outer, 'x,y');
        gsap.to(s.outer, { x: targetX, y: targetY, duration: dur, ease });

        // Directional tilt — 3° toward screen-movement direction, return on finish
        const { x: fromX } = isoToScreen(oldPos.x, oldPos.y);
        const dx = targetX - fromX;
        if (dx !== 0) {
          const tiltRad = dx > 0 ? 0.052 : -0.052; // ±3°
          gsap.killTweensOf(s.inner, 'rotation');
          gsap.to(s.inner, {
            rotation: tiltRad,
            duration: dur * 0.35,
            ease: 'power1.in',
            onComplete: () => {
              gsap.to(s.inner, { rotation: 0, duration: dur * 0.45, ease: 'power1.out' });
            },
          });
        }

        // Pause idle hum during movement (will restart if still IDLE after tick)
        if (s.humTween) this._stopHum(s);
      } else {
        // Ensure exact pixel position (guards against float drift)
        s.outer.x = targetX;
        s.outer.y = targetY;
      }

      // Update state-based animations on state change
      if (agent.state !== s.lastState) {
        s.lastState = agent.state;
        this._onStateChange(s, agent, type);
      }

      // Always update currPos to post-tick position
      s.currPos = { ...newPos };
    }
  }

  /**
   * Refresh need dots and inventory bars. Called every animation frame.
   * Position is now managed by GSAP — no lerp here.
   * @param {number} _lerpT - unused (kept for API compatibility)
   * @param {object[]} patients
   * @param {object[]} nurses
   * @param {object[]} robots
   * @param {object[]} allNeeds - NeedQueue.getAll()
   */
  update(_lerpT, patients, nurses, robots, allNeeds) {
    // Build per-patient active-need map
    /** @type {Map<string, object[]>} */
    const needsByPatient = new Map();
    for (const need of allNeeds) {
      if (need.status === 'fulfilled') continue;
      if (!needsByPatient.has(need.patientId)) needsByPatient.set(need.patientId, []);
      needsByPatient.get(need.patientId).push(need);
    }

    // Refresh patient need dots
    for (const patient of patients) {
      const s = this._sprites.get(patient.id);
      if (!s || !s.needDots) continue;
      this._drawNeedDots(s.needDots, needsByPatient.get(patient.id) ?? [], s.dotBob);
    }

    // Refresh nurse inventory bars
    for (const nurse of nurses) {
      const s = this._sprites.get(nurse.id);
      if (!s || !s.invBar) continue;
      this._drawNurseInventory(s.invBar, nurse);
    }

    // Refresh robot inventory bars
    for (const robot of robots) {
      const s = this._sprites.get(robot.id);
      if (!s || !s.invBar) continue;
      const type = _agentType(robot.id);
      if (type === 'medi') {
        const frac = robot.state === 'REFILLING'
          ? _refillProgress(robot)
          : robot.medicineCount / robot.config.MEDI_ITEM_CAPACITY;
        this._drawFillBar(s.invBar, frac, THEME.medicine, robot.state === 'REFILLING', ROBOT_R);
      } else if (type === 'blanki') {
        const frac = robot.state === 'REFILLING'
          ? _refillProgress(robot)
          : robot.blanketCount / robot.config.BLANKI_ITEM_CAPACITY;
        this._drawFillBar(s.invBar, frac, THEME.blanket, robot.state === 'REFILLING', ROBOT_R);
      }
    }
  }

  /** Destroy all sprites and kill all tweens. */
  destroy() {
    for (const [, s] of this._sprites) {
      _killAllTweens(s);
      this.container.removeChild(s.outer);
      s.outer.destroy({ children: true });
    }
    this._sprites.clear();
  }

  // ── Private: sprite creation ──────────────────────────────────────────────

  /** @private */
  _createSprite(agent) {
    const type      = _agentType(agent.id);
    const isPatient = type === 'patient';

    // Outer container: GSAP moves this
    const outer = new PIXI.Container();
    // Inner container: tilt / hum / breathe tweens on this
    const inner = new PIXI.Container();
    outer.addChild(inner);

    // ── Main shape ────────────────────────────────────────────────────────
    const shape = new PIXI.Graphics();
    if (isPatient) {
      shape.circle(0, 0, PATIENT_R)
        .fill({ color: THEME.patient })
        .stroke({ color: THEME.patientStroke, width: 1.5 });
    } else if (type === 'nurse') {
      const hs = NURSE_SIZE / 2;
      shape.roundRect(-hs, -hs, NURSE_SIZE, NURSE_SIZE, 3)
        .fill({ color: THEME.nurse })
        .stroke({ color: THEME.agentStroke, width: 2, alpha: 0.9 });
    } else {
      const agentColor = THEME[type] ?? THEME.medi;
      shape.poly(_hexPoints(ROBOT_R))
        .fill({ color: agentColor })
        .stroke({ color: THEME.agentStroke, width: 2, alpha: 0.9 });
    }
    inner.addChild(shape);

    // ── Letter label (non-patients) ───────────────────────────────────────
    if (!isPatient) {
      const LABELS = { nurse: 'N', medi: 'M', blanki: 'B', edi: 'E' };
      const label = new PIXI.Text({
        text: LABELS[type] ?? '?',
        style: {
          fontFamily: 'Plus Jakarta Sans, system-ui, sans-serif',
          fontSize:   9,
          fontWeight: 'bold',
          fill:       '#ffffff',
          align:      'center',
        },
      });
      label.anchor.set(0.5, 0.5);
      inner.addChild(label);
    }

    // ── Need dots (patients only) ─────────────────────────────────────────
    let needDots = null;
    let dotBob   = null;
    if (isPatient) {
      needDots = new PIXI.Graphics();
      inner.addChild(needDots);

      // Create 4 GSAP proxy objects — one per need type in NEED_ORDER.
      // Tweens run indefinitely with phase offsets so dots don't bob in sync.
      dotBob = NEED_ORDER.map((_, i) => {
        const proxy = { y: 0 };
        gsap.to(proxy, {
          y: -2,
          duration: 0.6,
          yoyo: true,
          repeat: -1,
          ease: 'sine.inOut',
          delay: i * 0.3,
        });
        return proxy;
      });
    }

    // ── Inventory bar (nurse, medi, blanki) ───────────────────────────────
    let invBar = null;
    if (type === 'nurse' || type === 'medi' || type === 'blanki') {
      invBar = new PIXI.Graphics();
      inner.addChild(invBar);
    }

    // ── Initial screen position ───────────────────────────────────────────
    const { x: ix, y: iy } = isoToScreen(agent.position.x, agent.position.y);
    outer.x = ix;
    outer.y = iy - AGENT_LIFT;

    // ── Idle breathing for patients ───────────────────────────────────────
    if (isPatient) {
      gsap.to(inner.scale, {
        x: 1.03,
        y: 1.03,
        duration: 2.5,
        yoyo: true,
        repeat: -1,
        ease: 'sine.inOut',
        delay: Math.random() * 2.5,
      });
    }

    this.container.addChild(outer);
    this._sprites.set(agent.id, {
      outer,
      inner,
      needDots,
      invBar,
      currPos:     { ...agent.position },
      dotBob,
      humTween:    null,
      chargeRing:  null,
      chargeTween: null,
      lastState:   agent.state ?? null,
    });
  }

  // ── Private: state-change animations ─────────────────────────────────────

  /**
   * Called when an agent's state string changes.
   * @private
   */
  _onStateChange(s, agent, type) {
    if (!_isRobot(type)) return;

    const st = agent.state;

    // ── Idle hum ─────────────────────────────────────────────────────────
    if (st === 'IDLE') {
      this._startHum(s);
    } else {
      this._stopHum(s);
    }

    // ── Charging ring ─────────────────────────────────────────────────────
    if (st === 'CHARGING') {
      this._startChargeRing(s, type);
    } else {
      this._stopChargeRing(s);
    }
  }

  /** @private */
  _startHum(s) {
    if (s.humTween) return;
    s.inner.y = 0;
    s.humTween = gsap.to(s.inner, {
      y: 1.5,
      duration: 0.9,
      yoyo: true,
      repeat: -1,
      ease: 'sine.inOut',
      delay: Math.random() * 0.9,
    });
  }

  /** @private */
  _stopHum(s) {
    if (!s.humTween) return;
    s.humTween.kill();
    s.humTween = null;
    gsap.to(s.inner, { y: 0, duration: 0.12, ease: 'power1.out' });
  }

  /** @private */
  _startChargeRing(s, type) {
    if (s.chargeRing) return; // already present

    const ring = new PIXI.Graphics();
    const ringR = (type === 'medi' || type === 'blanki') ? ROBOT_R + 5 : ROBOT_R + 5;
    ring.circle(0, 0, ringR).fill({ color: THEME.chargingTop, alpha: 0 });
    ring.circle(0, 0, ringR).stroke({ color: THEME.chargingRight, width: 1.5, alpha: 0.6 });
    ring.alpha = 0.2;
    // Insert below the shape so it renders behind the agent
    s.inner.addChildAt(ring, 0);

    s.chargeRing  = ring;
    s.chargeTween = gsap.to(ring, {
      alpha: 0.65,
      duration: 1.5,
      yoyo: true,
      repeat: -1,
      ease: 'sine.inOut',
    });
  }

  /** @private */
  _stopChargeRing(s) {
    if (!s.chargeRing) return;
    if (s.chargeTween) { s.chargeTween.kill(); s.chargeTween = null; }
    s.inner.removeChild(s.chargeRing);
    s.chargeRing.destroy();
    s.chargeRing = null;
  }

  // ── Private: per-frame redraw helpers ────────────────────────────────────

  /**
   * Draw need indicator dots above the patient circle.
   * @param {PIXI.Graphics} g
   * @param {object[]} needs
   * @param {Array<{y:number}>|null} dotBob  GSAP proxy array (one per NEED_ORDER entry)
   * @private
   */
  _drawNeedDots(g, needs, dotBob) {
    g.clear();
    const toShow = NEED_ORDER.filter(t => needs.some(n => n.type === t));
    if (toShow.length === 0) return;

    const dotR    = 3;
    const spacing = dotR * 2.8;
    const totalW  = (toShow.length - 1) * spacing;
    const startX  = -totalW / 2;
    const baseY   = -(PATIENT_R + 8); // above the patient circle

    toShow.forEach((type, i) => {
      const need      = needs.find(n => n.type === type);
      const isClaimed = need.status === 'claimed' || need.status === 'in_progress';
      const color     = THEME[type] ?? 0xAAAAAA;
      const cx        = startX + i * spacing;

      // Bob offset from the proxy whose index matches NEED_ORDER
      const bobY = dotBob ? (dotBob[NEED_ORDER.indexOf(type)]?.y ?? 0) : 0;
      const cy   = baseY + bobY;

      g.circle(cx, cy, dotR).fill({ color, alpha: isClaimed ? 0.45 : 1.0 });
      if (!isClaimed) {
        g.circle(cx, cy, dotR + 1).stroke({ color, width: 1, alpha: 0.7 });
      }
    });
  }

  /** @private */
  _drawNurseInventory(g, nurse) {
    g.clear();
    const capacity = nurse.config?.NURSE_ITEM_CAPACITY ?? 2;
    const barW = 20, barH = 3, gap = 3;
    const totalW = barW * capacity + gap * (capacity - 1);
    const barY   = -(NURSE_SIZE / 2) - 10;
    const startX = -totalW / 2;

    if (nurse.state === 'REFILLING') {
      const frac = _refillProgress(nurse);
      g.roundRect(startX, barY - barH / 2, totalW, barH, barH / 2)
        .fill({ color: THEME.invTrack, alpha: 0.9 });
      if (frac > 0) {
        g.roundRect(startX, barY - barH / 2, totalW * frac, barH, barH / 2)
          .fill({ color: THEME.invRefill });
      }
      return;
    }

    const items = [];
    for (let i = 0; i < nurse.medicineCount; i++) items.push(THEME.medicine);
    for (let i = 0; i < nurse.blanketCount;  i++) items.push(THEME.blanket);
    while (items.length < capacity) items.push(null);

    items.forEach((color, i) => {
      const x = startX + i * (barW + gap);
      g.roundRect(x, barY - barH / 2, barW, barH, barH / 2)
        .fill({ color: THEME.invTrack, alpha: 0.9 });
      if (color !== null) {
        g.roundRect(x, barY - barH / 2, barW, barH, barH / 2).fill({ color });
      }
    });
  }

  /** @private */
  _drawFillBar(g, frac, fillColor, isRefilling, shapeRadius) {
    g.clear();
    const barW = 20, barH = 3;
    const barY = -(shapeRadius + 10);
    const f    = Math.max(0, Math.min(1, frac));

    g.roundRect(-barW / 2, barY - barH / 2, barW, barH, barH / 2)
      .fill({ color: THEME.invTrack, alpha: 0.9 });
    if (f > 0) {
      const color = isRefilling ? THEME.invRefill : fillColor;
      g.roundRect(-barW / 2, barY - barH / 2, barW * f, barH, barH / 2).fill({ color });
    }
  }
}

// ── Module-level helper ───────────────────────────────────────────────────────

/**
 * Kill all GSAP tweens associated with a sprite record.
 * @param {object} s - sprite record
 */
function _killAllTweens(s) {
  gsap.killTweensOf(s.outer);
  gsap.killTweensOf(s.inner);
  gsap.killTweensOf(s.inner.scale);
  if (s.dotBob) s.dotBob.forEach(p => gsap.killTweensOf(p));
  if (s.humTween)    { s.humTween.kill();    }
  if (s.chargeTween) { s.chargeTween.kill(); }
  if (s.chargeRing)  { gsap.killTweensOf(s.chargeRing); }
}
