/**
 * BlairScaledHeelan.js — shared Blair & Minchinton / Blair 2008 primitives
 *
 * Author: Brent Buffham — blastingapps.com & kirra-design.com
 * License: MIT
 *
 * Ported 1:1 from Kirra's src/shaders/analytics/models/BlairScaledHeelan.js,
 * which is the reference implementation. Kirra keeps the GLSL and the JS in
 * one file so the shader and the CPU path cannot drift; this is the JS half.
 * Keep the two in lockstep — if you change a formula here, change it there.
 *
 * References: Blair & Minchinton (2006) Fragblast-8 Eqs 10–11;
 *             Blair (2008) IJRMMS 45 Eq 22.
 */

/**
 * Blair & Minchinton 2006 Eq 10 — P radiation factor, φ from the hole axis.
 *
 * Non-zero on axis, and at its maximum broadside (φ = π/2) where the paper has
 * only P-waves propagating.
 *
 * @param {number} cosPhi    - cos of the angle from the hole axis
 * @param {number} vsOverVp  - Vs/Vp (NOT its square — it is squared here)
 * @returns {number}
 */
export function blairPatternP(cosPhi, vsOverVp) {
    return 1 - 2 * vsOverVp * vsOverVp * cosPhi * cosPhi;
}

/**
 * Blair & Minchinton 2006 Eq 11 — SV radiation factor.
 *
 * The α/β = Vp/Vs factor is INCLUDED here, so callers must not apply it again.
 * Vanishes broadside (sin 2φ = 0 at φ = π/2), as Eq 11 requires.
 *
 * @param {number} sinPhi
 * @param {number} cosPhi
 * @param {number} vsOverVp  - Vs/Vp
 * @returns {number}
 */
export function blairPatternS(sinPhi, cosPhi, vsOverVp) {
    return (1 / vsOverVp) * 2 * sinPhi * cosPhi;
}

function powA(x, A) { return x > 0 ? Math.pow(x, A) : 0; }

/**
 * Blair 2008 Eq 22 — the charge-weight increment for one sub-element.
 *
 * The detonation front leaves the primer in BOTH directions. While both sides
 * are still burning, element pairs at the same distance d share one increment,
 * hence the symmetric ½·[(2d+1)^A − (2d−1)^A] branch. Once the shorter side
 * runs out (d > sMin) only one side is advancing, and the increment reverts to
 * the one-sided [(c+1)^A − c^A] form.
 *
 * Summed over a deck this telescopes to M^A exactly, for ANY primer position —
 * which is the property that makes the result independent of `elemsPerDeck`.
 *
 * ⏪ blast-physics-js 0.3.0 shipped a one-sided approximation,
 *    fj = |(m + ½) − primerElemPos| + 1, which over-counted a mid-column
 *    primer by 9–13 % and under-counted an end-primed deck by about 3 %.
 *    Kirra implements the real Eq 22; this is that implementation.
 *
 * @param {number} m - element index, 0 = deck top
 * @param {number} N - elements in the deck
 * @param {number} p - primer element index (see blairPrimerElement)
 * @param {number} w - element mass (kg)
 * @param {number} A - charge exponent
 * @returns {number}
 */
export function blairIncrement(m, N, p, w, A) {
    var d = Math.abs(m - p);
    var sMin = Math.min(p, N - 1 - p);
    if (d === 0) return powA(w, A);
    if (d <= sMin) return 0.5 * (powA((2 * d + 1) * w, A) - powA((2 * d - 1) * w, A));
    var c = d + sMin;
    return powA((c + 1) * w, A) - powA(c * w, A);
}

/**
 * Primer element index from a primer fraction (0 = deck top, 1 = deck base).
 *
 * @param {number} primerFrac
 * @param {number} N - elements in the deck
 * @returns {number} integer index in [0, N−1]
 */
export function blairPrimerElement(primerFrac, N) {
    var p = Math.floor(primerFrac * N);
    return Math.max(0, Math.min(N - 1, p));
}
