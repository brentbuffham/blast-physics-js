/**
 * GaoNearFieldCorrection.js — Near-field P–S arrival-time correction
 *
 * Author: Brent Buffham — blastingapps.com & kirra-design.com
 * License: MIT
 *
 * Gao Q D, Lu W B, Hu Y G, Chen M, Yan P (2015), "Comparison of the
 * Generation of Shear Wave with Different Simulation Approaches", Fragblast 11,
 * Sydney, pp. 79–87.
 *
 * Heelan (1953) predicts the S-wave arrives Δt = R·(1/Vs − 1/Vp) after P.
 * Gao's SPH-FEM runs show damage-zone discontinuities slow the S leg in the
 * near field. Table 4 (basalt, Vp 4685, Vs ≈ 2680 m/s):
 *
 *   R (m)  Δt_theory  Δt_SPH-FEM  ratio
 *   5      0.80       0.92        1.150
 *   10     1.60       1.45        0.906
 *   25     3.99       4.20        1.053
 *   35     5.59       5.90        1.055
 *   45     7.19       7.30        1.015
 *   55     8.78       9.00        1.025
 *
 * Outside [5, 55] m the ratio is clamped to the nearest endpoint.
 *
 * Extracted from Kirra's GaoNearFieldCorrection.js.
 */

var GAO_TABLE = [
    { R: 5,  ratio: 1.150 },
    { R: 10, ratio: 0.906 },
    { R: 25, ratio: 1.053 },
    { R: 35, ratio: 1.055 },
    { R: 45, ratio: 1.015 },
    { R: 55, ratio: 1.025 }
];

export var GAO_NEAR_FIELD_THRESHOLD_M = 25;

/**
 * Multiplier on the theoretical Heelan Δt (piecewise-linear over Table 4).
 * @param {number} R - source-to-monitor distance (m)
 * @returns {number} ≈ 1 far field, up to 1.15 near field
 */
export function gaoCorrectionFactor(R) {
    if (!isFinite(R) || R <= 0) return 1.0;
    if (R <= GAO_TABLE[0].R) return GAO_TABLE[0].ratio;
    var last = GAO_TABLE[GAO_TABLE.length - 1];
    if (R >= last.R) return last.ratio;
    for (var i = 0; i < GAO_TABLE.length - 1; i++) {
        var a = GAO_TABLE[i], b = GAO_TABLE[i + 1];
        if (R >= a.R && R <= b.R) {
            var t = (R - a.R) / (b.R - a.R);
            return a.ratio + t * (b.ratio - a.ratio);
        }
    }
    return 1.0;
}

/**
 * Whether the monitor sits inside Gao's near-field band (< 25 m).
 * @param {number} R
 * @returns {boolean}
 */
export function isGaoNearField(R) {
    return isFinite(R) && R > 0 && R < GAO_NEAR_FIELD_THRESHOLD_M;
}

/**
 * Corrected S arrival time given P arrival, distance and velocities.
 * @param {number} tP  - P arrival time (s)
 * @param {number} R   - distance (m)
 * @param {number} cp  - P velocity (m/s)
 * @param {number} cs  - S velocity (m/s)
 * @returns {number} tS (s)
 */
export function gaoCorrectedSArrival(tP, R, cp, cs) {
    return tP + gaoCorrectionFactor(R) * (R / cs - R / cp);
}
