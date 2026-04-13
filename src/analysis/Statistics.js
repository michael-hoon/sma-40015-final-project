/**
 * @fileoverview Statistical analysis utilities for batch experiment results.
 *
 * Exports:
 *   descriptive(arr)   — mean, sample std dev, 95% CI
 *   welchTest(a, b)    — Welch's t-test with exact p-value via incomplete beta
 *
 * All functions are pure (no side effects, no imports).
 * The incomplete-beta / gamma-ln implementations follow Numerical Recipes §6.1–6.4.
 */

// ── Internal numerics ─────────────────────────────────────────────────────────

/**
 * Natural log of the Gamma function — Lanczos approximation.
 * Accurate to ~15 significant figures for x > 0.
 * @param {number} x
 * @returns {number}
 */
function lgamma(x) {
  if (x < 0.5) {
    // Reflection formula: Γ(x)·Γ(1-x) = π / sin(πx)
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma(1 - x);
  }
  // Lanczos g=7 coefficients
  const c = [
     0.99999999999980993,
   676.5203681218851,
  -1259.1392167224028,
   771.32342877765313,
  -176.61502916214059,
    12.507343278686905,
    -0.13857109526572012,
     9.9843695780195716e-6,
     1.5056327351493116e-7,
  ];
  x -= 1;
  let a = c[0];
  const t = x + 7.5; // g + 0.5
  for (let i = 1; i < 9; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

/**
 * Continued-fraction expansion used by the incomplete beta function.
 * @private
 */
function _betacf(x, a, b) {
  const MAXIT = 200;
  const EPS   = 3e-7;
  const FPMIN = 1e-30;

  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;

  let c = 1, d = 1 - qab * x / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;

  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;

    // Even step
    let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;

    // Odd step
    aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;

    if (Math.abs(del - 1) <= EPS) break;
  }
  return h;
}

/**
 * Regularised incomplete beta function I_x(a, b).
 * @param {number} x - Evaluation point in [0, 1]
 * @param {number} a
 * @param {number} b
 * @returns {number} Value in [0, 1]
 */
function ibeta(x, a, b) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const lbeta = lgamma(a + b) - lgamma(a) - lgamma(b);
  const bt    = Math.exp(lbeta + a * Math.log(x) + b * Math.log(1 - x));
  if (x < (a + 1) / (a + b + 2)) return bt * _betacf(x, a, b) / a;
  return 1 - bt * _betacf(1 - x, b, a) / b;
}

/**
 * Two-tailed p-value for t-distribution with given degrees of freedom.
 * Uses the identity: p = I_{df/(df+t²)}(df/2, 1/2)
 * @param {number} t  - t-statistic (absolute value used)
 * @param {number} df - Degrees of freedom
 * @returns {number} p-value in (0, 1]
 */
function tDist2P(t, df) {
  return ibeta(df / (df + t * t), df / 2, 0.5);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Compute descriptive statistics and 95% confidence interval for a sample.
 *
 * CI uses the t-distribution (df = n-1). For n ≥ 30 this is near-identical
 * to the normal approximation but remains correct for smaller samples.
 *
 * @param {number[]} arr - Observed values (one per replication)
 * @returns {{n:number, mean:number, std:number, ciLow:number, ciHigh:number}}
 */
export function descriptive(arr) {
  const n = arr.length;
  if (n === 0) return { n: 0, mean: 0, std: 0, ciLow: 0, ciHigh: 0 };

  const m = arr.reduce((s, x) => s + x, 0) / n;
  if (n === 1) return { n: 1, mean: m, std: 0, ciLow: m, ciHigh: m };

  const s  = Math.sqrt(arr.reduce((acc, x) => acc + (x - m) ** 2, 0) / (n - 1));
  const se = s / Math.sqrt(n);

  // t critical value at α/2 = 0.025 for df = n-1
  // Cornish-Fisher approximation — error < 0.001 for df ≥ 5
  const z     = 1.959964;
  const df    = n - 1;
  const tCrit = z
    + (z ** 3 + z) / (4 * df)
    + (5 * z ** 5 + 16 * z ** 3 + 3 * z) / (96 * df ** 2);

  return { n, mean: m, std: s, ciLow: m - tCrit * se, ciHigh: m + tCrit * se };
}

/**
 * Welch's two-sample t-test (unequal variances assumed).
 *
 * @param {number[]} a - Sample from Scenario A
 * @param {number[]} b - Sample from Scenario B
 * @returns {{t:number, df:number, p:number, significant:boolean}}
 */
export function welchTest(a, b) {
  const na = a.length, nb = b.length;
  if (na < 2 || nb < 2) return { t: 0, df: 0, p: 1, significant: false };

  const ma = a.reduce((s, x) => s + x, 0) / na;
  const mb = b.reduce((s, x) => s + x, 0) / nb;

  const va = a.reduce((s, x) => s + (x - ma) ** 2, 0) / (na - 1); // sample variance
  const vb = b.reduce((s, x) => s + (x - mb) ** 2, 0) / (nb - 1);

  const se2 = va / na + vb / nb;
  if (se2 === 0) {
    // Both samples are constant — p=1 if means match, p=0 if they differ
    return { t: 0, df: na + nb - 2, p: ma === mb ? 1 : 0, significant: ma !== mb };
  }

  const t  = (ma - mb) / Math.sqrt(se2);

  // Welch-Satterthwaite degrees of freedom
  const df = (se2 ** 2) /
    ((va / na) ** 2 / (na - 1) + (vb / nb) ** 2 / (nb - 1));

  const p  = tDist2P(Math.abs(t), df);

  return { t, df, p, significant: p < 0.05 };
}

/**
 * Significance stars for a p-value (APA-style).
 * @param {number} p
 * @returns {string}
 */
export function sigStars(p) {
  if (p < 0.001) return '***';
  if (p < 0.01)  return '**';
  if (p < 0.05)  return '*';
  if (p < 0.10)  return '†';
  return '';
}
