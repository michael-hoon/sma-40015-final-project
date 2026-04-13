/**
 * @fileoverview Seeded pseudo-random number generator using a Linear Congruential Generator (LCG).
 * Two instances created with the same seed will produce identical sequences,
 * guaranteeing deterministic simulation replications.
 *
 * Parameters (Numerical Recipes / glibc variant):
 *   modulus    m = 2^32
 *   multiplier a = 1664525
 *   increment  c = 1013904223
 */
export default class SeededRandom {
  /**
   * @param {number} seed - Integer seed value. Two instances with the same seed
   *   produce identical output sequences.
   */
  constructor(seed) {
    // Force to unsigned 32-bit integer
    this._state = seed >>> 0;
  }

  /**
   * Advance the LCG one step and return the raw 32-bit state value.
   * @returns {number} Unsigned 32-bit integer
   */
  _next() {
    // LCG: state = (a * state + c) mod 2^32
    this._state = ((Math.imul(1664525, this._state) + 1013904223) >>> 0);
    return this._state;
  }

  /**
   * Return a pseudo-random float in [0, 1).
   * @returns {number}
   */
  random() {
    return this._next() / 4294967296; // divide by 2^32
  }

  /**
   * Return a pseudo-random integer in [min, max] (inclusive on both ends).
   * @param {number} min - Lower bound (integer)
   * @param {number} max - Upper bound (integer)
   * @returns {number}
   */
  randomInt(min, max) {
    return Math.floor(this.random() * (max - min + 1)) + min;
  }

  /**
   * Return a pseudo-random float in [min, max).
   * @param {number} min - Lower bound
   * @param {number} max - Upper bound (exclusive)
   * @returns {number}
   */
  randomFloat(min, max) {
    return this.random() * (max - min) + min;
  }
}
