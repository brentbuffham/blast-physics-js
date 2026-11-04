/**
 * Gamma.js — The gamma function and the regularised lower incomplete gamma
 *
 * Author: Brent Buffham — blastingapps.com & kirra-design.com
 * License: MIT
 *
 *   Γ(z)      Lanczos approximation (g = 7, 9 terms), reflection below 0.5
 *   P(k, x)   γ(k, x) / Γ(k): series for x < k + 1, Lentz continued fraction above
 *             (Numerical Recipes §6.2). P is the gamma distribution's CDF at x/θ.
 *
 * Used by the Spathis median correction (Γ(1 + 1/n)) and the KC-KUM curve.
 */

var LANCZOS = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7
];
var EPS = 1e-15;
var TINY = 1e-300;
var MAX_ITER = 500;

/**
 * ln Γ(z) for z > 0.
 * @param {number} z
 * @returns {number}
 */
export function logGamma(z) {
    if (!(z > 0)) return NaN;
    if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z);
    z -= 1;
    var a = LANCZOS[0];
    var t = z + 7.5;
    for (var i = 1; i < 9; i++) a += LANCZOS[i] / (z + i);
    return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a);
}

/**
 * Γ(z) for z > 0.
 * @param {number} z
 * @returns {number}
 */
export function gammaFunction(z) {
    return Math.exp(logGamma(z));
}

/**
 * Regularised lower incomplete gamma P(k, x) = γ(k, x) / Γ(k), k > 0, x ≥ 0.
 * @param {number} k - shape
 * @param {number} x
 * @returns {number} 0 … 1
 */
export function regularizedLowerGamma(k, x) {
    if (!(k > 0) || isNaN(x)) return NaN;
    if (x <= 0) return 0;
    if (x === Infinity) return 1;
    var front = Math.exp(-x + k * Math.log(x) - logGamma(k));
    if (x < k + 1) {
        // Series: γ(k,x) = e^-x x^k Σ x^j / (k (k+1) … (k+j))
        var ap = k, sum = 1 / k, del = sum;
        for (var n = 0; n < MAX_ITER; n++) {
            ap += 1;
            del *= x / ap;
            sum += del;
            if (Math.abs(del) < Math.abs(sum) * EPS) break;
        }
        return Math.min(1, front * sum);
    }
    // Continued fraction for Q = 1 - P (modified Lentz)
    var b = x + 1 - k, c = 1 / TINY, d = 1 / b, h = d;
    for (var i = 1; i < MAX_ITER; i++) {
        var an = -i * (i - k);
        b += 2;
        d = an * d + b;
        if (Math.abs(d) < TINY) d = TINY;
        c = b + an / c;
        if (Math.abs(c) < TINY) c = TINY;
        d = 1 / d;
        var step = d * c;
        h *= step;
        if (Math.abs(step - 1) < EPS) break;
    }
    return Math.max(0, 1 - front * h);
}

/**
 * Gamma distribution CDF with shape k and scale θ.
 * @param {number} x
 * @param {number} k
 * @param {number} theta
 * @returns {number} 0 … 1
 */
export function gammaCDF(x, k, theta) {
    if (!(theta > 0)) return NaN;
    return regularizedLowerGamma(k, x / theta);
}
