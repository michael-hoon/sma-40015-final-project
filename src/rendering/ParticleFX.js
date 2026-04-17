/**
 * @fileoverview Phase 3 — Particle & ring effects triggered by simulation events.
 *
 * All effects are self-cleaning: each function adds its own PIXI objects to
 * `container`, animates them with GSAP, then removes and destroys them in the
 * `onComplete` callback.  No persistent state — safe to call on every tick.
 *
 * Implemented with PIXI.Graphics + GSAP tweens (no extra CDN dependency) so
 * the library stack stays consistent with Phase 2 and avoids @pixi/particle-
 * emitter v5 compatibility uncertainty against Pixi v8.
 */

import { THEME } from './Theme.js';

/** @type {typeof window.gsap} */
const gsap = window.gsap;

// ── Shared burst helper ───────────────────────────────────────────────────────

/**
 * Emit a radial burst of small circles from (x, y) inside `container`.
 * @param {PIXI.Container} container
 * @param {number}  x           - local x inside container
 * @param {number}  y           - local y inside container
 * @param {number}  color       - Pixi hex colour
 * @param {number}  count       - number of particles
 * @param {number}  duration    - seconds to live (randomised ×0.6–1.0)
 * @param {number}  [spread=30] - max outward distance in pixels
 * @param {number}  [gravityY=0]- extra downward drift in pixels
 * @private
 */
function _emitBurst(container, x, y, color, count, duration, spread = 30, gravityY = 0) {
  for (let i = 0; i < count; i++) {
    const angle   = (Math.PI * 2 * i / count) + (Math.random() - 0.5) * 0.9;
    const dist    = spread * (0.5 + Math.random() * 0.5);
    const radius  = 1.5 + Math.random() * 2;
    const life    = duration * (0.6 + Math.random() * 0.4);

    const p = new PIXI.Graphics();
    p.circle(0, 0, radius).fill({ color });
    p.x = x;
    p.y = y;
    container.addChild(p);

    gsap.to(p, {
      x:        x + Math.cos(angle) * dist,
      y:        y + Math.sin(angle) * dist + gravityY,
      alpha:    0,
      duration: life,
      ease:     'power2.out',
      onComplete() {
        container.removeChild(p);
        p.destroy();
      },
    });
  }
}

// ── Public emitters ───────────────────────────────────────────────────────────

/**
 * Small coloured burst when a need transitions to 'fulfilled'.
 * @param {PIXI.Container} container
 * @param {number} x
 * @param {number} y
 * @param {string} needType - 'emergency' | 'medication' | 'comfort' | 'visitor_escort'
 */
export function emitNeedResolved(container, x, y, needType) {
  const color = THEME[needType] ?? 0xAAAAAA;
  _emitBurst(container, x, y, color, 12, 0.55, 28);
}

/**
 * Single expanding ring emanating outward from (x, y) — used for new emergencies.
 * @param {PIXI.Container} container
 * @param {number} x
 * @param {number} y
 */
export function emitEmergencyPulse(container, x, y) {
  const ring  = new PIXI.Graphics();
  container.addChild(ring);

  const proxy = { r: 4, alpha: 0.85, strokeW: 2.5 };

  gsap.to(proxy, {
    r:       80,
    alpha:   0,
    strokeW: 0.4,
    duration: 1.2,
    ease:    'power2.out',
    onUpdate() {
      ring.clear();
      ring.circle(x, y, proxy.r)
        .stroke({ color: THEME.emergency, width: proxy.strokeW, alpha: proxy.alpha });
    },
    onComplete() {
      container.removeChild(ring);
      ring.destroy();
    },
  });
}

/**
 * Harsh red burst when a patient's health hits 0 (critical incident).
 * @param {PIXI.Container} container
 * @param {number} x
 * @param {number} y
 */
export function emitCriticalIncident(container, x, y) {
  _emitBurst(container, x, y, THEME.emergency, 18, 0.75, 38, 6);
}
