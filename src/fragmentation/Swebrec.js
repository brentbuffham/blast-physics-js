/**
 * Swebrec.js — The Swebrec size distribution and the KCO link to Kuz-Ram
 *
 * Author: Brent Buffham — blastingapps.com & kirra-design.com
 * License: MIT
 *
 *   P(x) = 1 / (1 + [ln(xmax/x) / ln(xmax/x50)]^b),  0 < x < xmax   Ouchterlony 2005, Eq 2
 *   b = 2 · ln2 · ln(xmax/x50) · n                                  Ouchterlony 2005, Eq 11c (KCO)
 *
 * The KCO link makes the Swebrec curve's slope at x50 equal the Rosin-Rammler
 * slope with Cunningham's n (Ouchterlony 2005, Eq 3). Same form as las-laz-js's
 * sizeDistribution Swebrec fit, so a fitted (x50, xmax, b) and a predicted one
 * draw the same way.
 *
 * Sizes in any one unit (mm across this library); P in %.
 *
 * SOURCES
 *  Ouchterlony, F. (2005) The Swebrec function: linking fragmentation by
 *    blasting and crushing. Mining Technology (Trans. IMM A) 114, A29–A44.
 *  Ouchterlony, F., Sanchidrián, J.A. & Moser, P. (2017) Percentile fragment
 *    size predictions for blasted rock and the fragmentation-energy fan.
 *    Rock Mech. Rock Eng. 50, 751–779, Eqs 9a–9b.
 */

/**
 * Swebrec % passing.
 * @param {number} x
 * @param {number} x50
 * @param {number} xmax - largest fragment, > x50
 * @param {number} b
 * @returns {number} % passing (0 at x ≤ 0, 100 at x ≥ xmax)
 */
export function swebrecPassing(x, x50, xmax, b) {
    if (!(x > 0)) return 0;
    if (x >= xmax) return 100;
    return 100 / (1 + Math.pow(Math.log(xmax / x) / Math.log(xmax / x50), b));
}

/**
 * Size at a % passing (inverse of swebrecPassing).
 * @param {number} P - % passing
 * @param {number} x50
 * @param {number} xmax
 * @param {number} b
 * @returns {number} size (0 at P ≤ 0, xmax at P ≥ 100)
 */
export function swebrecSize(P, x50, xmax, b) {
    if (!(P > 0)) return 0;
    if (P >= 100) return xmax;
    return xmax / Math.exp(Math.log(xmax / x50) * Math.pow(100 / P - 1, 1 / b));
}

/**
 * KCO undulation exponent from Cunningham's n: b = 2 · ln2 · ln(xmax/x50) · n.
 * @param {number} x50
 * @param {number} xmax - > x50
 * @param {number} n
 * @returns {number} b
 */
export function kcoB(x50, xmax, n) {
    if (!(xmax > x50) || !(x50 > 0)) throw new RangeError("fragmentation: xmax (" + xmax + ") must be larger than x50 (" + x50 + ")");
    return 2 * Math.LN2 * Math.log(xmax / x50) * n;
}

/**
 * Swebrec through three percentiles (Ouchterlony, Sanchidrián & Moser 2017,
 * Eqs 9a–9b, after Ouchterlony & Paley 2013):
 *   b = ln4 / ln[ln(x50/x20) / ln(x80/x50)]
 *   1 / ln(xmax/x50) = 1 / ln(x80/x50) − 1 / ln(x50/x20)
 * @param {number} x20
 * @param {number} x50
 * @param {number} x80
 * @returns {{x50:number, xmax:number, b:number}|null} null when the three sizes
 *   are not those of a Swebrec curve (the upper tail must be shorter than the lower)
 */
export function swebrecFromPercentiles(x20, x50, x80) {
    if (!(x20 > 0 && x50 > x20 && x80 > x50)) return null;
    var lo = Math.log(x50 / x20), hi = Math.log(x80 / x50);
    var inv = 1 / hi - 1 / lo;
    if (!(inv > 0)) return null;
    var b = Math.log(4) / Math.log(lo / hi);
    return { x50: x50, xmax: x50 * Math.exp(1 / inv), b: b };
}
