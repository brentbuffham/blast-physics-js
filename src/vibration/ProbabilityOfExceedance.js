/**
 * ProbabilityOfExceedance.js — P(V > V_β) per Blair (2011)
 *
 * Author: Brent Buffham — blastingapps.com & kirra-design.com
 * License: MIT
 *
 * Blair, D.P. (2011). "A probabilistic analysis of vibration based on measured
 * data and charge weight scaling", EFEE 6th World Conference, Lisbon, pp 319–337.
 *
 * Site law in log space (Eq 2, 3, 7):  log₁₀(V_P) = log₁₀(a) − b·log₁₀(d/W^n)
 * Z-score (Eq 16b):                    z_β = [log₁₀(V_β) − log₁₀(a) + b·log₁₀(d/W^n)] / σ
 * Polynomial Φ (Eq 18, 19a, 19b), Abramowitz & Stegun coefficients:
 *   z ≥ 0:  P = 1 / [2·(1 + c1z + c2z² + c3z³ + c4z⁴)⁴]
 *   z < 0:  P = 1 − 1 / [2·(1 − c1z + c2z² − c3z³ + c4z⁴)⁴]   (even powers KEEP + sign)
 *
 * ⚠ Two circulated secondary sources are wrong: Kearney's note puts the
 * polynomial as a multiplier (P > 1), and the "Exceedance Checks" XLSX flips
 * the sign of c2 on the negative branch. This file implements Blair's forms
 * and is verified against Table 1 in the tests.
 *
 * Extracted from Kirra's ProbabilityOfExceedanceHelper.js.
 */

/** Abramowitz & Stegun coefficients (Blair 2011 Eq 18). */
export var POE_C = Object.freeze([0.196854, 0.115194, 0.000344, 0.019527]);

/** Default site-law regression residual σ (log₁₀) — Blair's lumped-data global. */
export var DEFAULT_SITE_SIGMA = 0.22;

/**
 * Blair Eq 16b — signed number of σ that V_β sits from V_P in log₁₀ space.
 * @param {Object} p - { Vbeta, a, b, sigma, scaledDistance }
 * @returns {number|null}
 */
export function zbScore(p) {
    if (!p) return null;
    var Vb = +p.Vbeta, a = +p.a, b = +p.b, s = +p.sigma, sd = +p.scaledDistance;
    if (!(s > 0)) return null;
    if (!(Vb > 0) || !(a > 0) || !(sd > 0)) return null;
    if (!isFinite(b)) return null;
    return (Math.log10(Vb) - Math.log10(a) + b * Math.log10(sd)) / s;
}

/**
 * Blair Eqs 19a/19b — polynomial approximation of P(V > V_β).
 * @param {number|null} z
 * @returns {number|null} probability in [0,1]
 */
export function probabilityOfExceedance(z) {
    if (z == null || !isFinite(z)) return null;
    var c1 = POE_C[0], c2 = POE_C[1], c3 = POE_C[2], c4 = POE_C[3];
    var z2 = z * z, z3 = z2 * z, z4 = z3 * z;
    if (z >= 0) {
        var posPoly = 1 + c1 * z + c2 * z2 + c3 * z3 + c4 * z4;
        return 1 / (2 * Math.pow(posPoly, 4));
    }
    var negPoly = 1 - c1 * z + c2 * z2 - c3 * z3 + c4 * z4;
    return 1 - 1 / (2 * Math.pow(negPoly, 4));
}

/**
 * PoE from a predicted PPV (any source — site law, forward array, measured).
 *   z = (log₁₀ V_β − log₁₀ V_pred) / σ
 * @param {number} Vpredicted - mm/s
 * @param {number} Vbeta      - limit (mm/s)
 * @param {number} [sigma=0.22]
 * @returns {{ z: number, P: number } | null}
 */
export function poeFromPrediction(Vpredicted, Vbeta, sigma) {
    var s = +sigma > 0 ? +sigma : DEFAULT_SITE_SIGMA;
    if (!(+Vpredicted > 0) || !(+Vbeta > 0)) return null;
    var z = (Math.log10(+Vbeta) - Math.log10(+Vpredicted)) / s;
    return { z: z, P: probabilityOfExceedance(z) };
}

/**
 * PoE for a single (charge → monitor) pair.
 * @param {Object} mon - { K, B, chargeExponent=0.5, targetPPV, siteSigma=0.22 }
 * @param {number} distance     - m
 * @param {number} chargeMassKg - kg
 * @returns {{ z, P, scaledDistance } | null}
 */
export function holePoeAtMonitor(mon, distance, chargeMassKg) {
    if (!mon) return null;
    var e = +mon.chargeExponent > 0 ? +mon.chargeExponent : 0.5;
    if (!(distance > 0) || !(chargeMassKg > 0)) return null;
    var sd = distance / Math.pow(chargeMassKg, e);
    var z = zbScore({ Vbeta: mon.targetPPV, a: mon.K, b: mon.B, sigma: +mon.siteSigma > 0 ? +mon.siteSigma : DEFAULT_SITE_SIGMA, scaledDistance: sd });
    if (z == null) return null;
    return { z: z, P: probabilityOfExceedance(z), scaledDistance: sd };
}

/**
 * Inverse standard-normal CDF (Acklam's rational approximation, |rel err| < 1.15e-9).
 * @param {number} p - (0,1)
 * @returns {number} z with Φ(z) = p (±Infinity at bounds)
 */
export function normalQuantile(p) {
    if (!(p > 0)) return -Infinity;
    if (!(p < 1)) return Infinity;
    var a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
    var b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
    var c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
    var d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
    var plow = 0.02425, phigh = 1 - plow, q, r;
    if (p < plow) {
        q = Math.sqrt(-2 * Math.log(p));
        return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
            ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    }
    if (p <= phigh) {
        q = p - 0.5; r = q * q;
        return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
            (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
    }
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
        ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
}

/**
 * Effective design target for a required probability of exceedance:
 *   targetEffective = V_β · 10^(σ · Φ⁻¹(poe))
 * poe = 0.5 reproduces the mean design; poe < 0.5 applies a σ-scaled buffer.
 *
 * @param {number} Vbeta
 * @param {number} poe   - desired probability (0,1)
 * @param {number} [sigma=0.22]
 * @returns {number} mm/s
 */
export function effectiveTargetForPoE(Vbeta, poe, sigma) {
    var s = +sigma > 0 ? +sigma : DEFAULT_SITE_SIGMA;
    return Vbeta * Math.pow(10, s * normalQuantile(poe));
}

/** Log-scale 5-band legend for PoE. */
export var POE_BANDS = [
    { key: "safe",    label: "Safe",    maxP: 0.01, colour: "#3b82f6" },
    { key: "good",    label: "Good",    maxP: 0.05, colour: "#22c55e" },
    { key: "caution", label: "Caution", maxP: 0.10, colour: "#eab308" },
    { key: "warning", label: "Warning", maxP: 0.25, colour: "rgb(230,120,0)" },
    { key: "danger",  label: "Danger",  maxP: 1.0,  colour: "#ef4444" }
];

/**
 * Band descriptor for a probability.
 * @param {number} P
 * @returns {Object}
 */
export function poeBand(P) {
    for (var i = 0; i < POE_BANDS.length; i++) if (P < POE_BANDS[i].maxP) return POE_BANDS[i];
    return POE_BANDS[POE_BANDS.length - 1];
}
