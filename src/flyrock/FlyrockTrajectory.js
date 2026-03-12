/**
 * FlyrockTrajectory.js — Flyrock distance prediction models
 *
 * Author: Brent Buffham — blastingapps.com & kirra-design.com
 * License: MIT
 *
 * Three algorithms: Richards & Moore (2004), Lundborg (1975/1981), McKenzie (2009/2022)
 *
 * Chernigovskii ballistic envelope formula:
 *   altitude(d) = (V⁴ − g²×d²) / (2×g×V²)
 *
 * References:
 *   Richards & Moore (2004), Proceedings ISEE 30th Annual Conference
 *   Lundborg et al. (1975), Engineering and Mining Journal
 *   McKenzie (2009), Fragblast 11
 *   Chiappetta & Treleven (1997), SDoB concept
 */

var GRAVITY = 9.80665;  // m/s²

/**
 * Chernigovskii ballistic envelope altitude at horizontal distance d.
 *
 * @param {number} d - Horizontal distance from launch point (m)
 * @param {number} V - Maximum launch velocity (m/s)
 * @returns {number} Maximum altitude above launch elevation (m), or NaN if outside range
 */
export function envelopeAltitude(d, V) {
    var V2 = V * V;
    var num = V2 * V2 - GRAVITY * GRAVITY * d * d;
    if (num < 0) return NaN;
    return num / (2.0 * GRAVITY * V2);
}

/**
 * Richards & Moore (2004) flyrock model.
 *
 * @param {Object} params
 * @param {number} params.holeDiamMm      - Hole diameter (mm)
 * @param {number} params.benchHeight     - Bench height H (m)
 * @param {number} params.stemmingLength  - Stemming length St (m)
 * @param {number} params.burden          - Burden B (m)
 * @param {number} params.subdrill        - Subdrill Sd (m)
 * @param {number} params.explosiveDensity - ρ (kg/L)
 * @param {number} [params.K=20]          - Flyrock constant (typical 14–30)
 * @param {number} [params.factorOfSafety=2]
 * @param {number} [params.stemEjectAngleDeg=80] - Stem eject angle from horizontal (degrees)
 * @returns {{ faceBurst, cratering, stemEject, maxDistance, maxVelocity }}
 */
export function richardsMoore(params) {
    var p = Object.assign({ K: 20, factorOfSafety: 2, stemEjectAngleDeg: 80 }, params);
    var g = GRAVITY;
    var holeDiamM = p.holeDiamMm / 1000.0;
    var r = holeDiamM / 2.0;
    var W = Math.PI * r * r * p.explosiveDensity * 1000.0;  // kg/m
    var K = p.K;
    var K2g = (K * K) / g;
    var sqrtW = Math.sqrt(W);

    // Base distances (FoS = 1)
    var FB_base = K2g * Math.pow(sqrtW / p.burden, 2.6);
    var CR_base = K2g * Math.pow(sqrtW / p.stemmingLength, 2.6);
    var thetaRad = p.stemEjectAngleDeg * Math.PI / 180.0;
    var SE_base = CR_base * Math.sin(2.0 * thetaRad);

    // Clearance distances (FoS-scaled)
    var fos = p.factorOfSafety;
    var FB = FB_base * fos;
    var CR = CR_base * fos;
    var SE = SE_base * fos;
    var maxDistance = Math.max(FB, CR, SE);

    // Launch velocities (from base distances — no double-counting FoS)
    var V_fb = Math.sqrt(FB_base * g);
    var V_cr = Math.sqrt(CR_base * g / Math.sin(2.0 * Math.PI / 4.0));
    var V_se = Math.sqrt(SE_base * g / Math.sin(2.0 * thetaRad));
    var maxVelocity = Math.max(V_fb, V_cr, V_se);

    return { faceBurst: FB, cratering: CR, stemEject: SE, maxDistance: maxDistance, maxVelocity: maxVelocity };
}

/**
 * Lundborg (1975/1981) flyrock model — diameter-based upper bound.
 *
 * Lmax (feet) = 260 × d^(2/3)  where d is in inches
 *
 * @param {Object} params
 * @param {number} params.holeDiamMm     - Hole diameter (mm)
 * @param {number} [params.factorOfSafety=2]
 * @returns {{ maxDistance, clearanceDistance, maxVelocity }}
 */
export function lundborg(params) {
    var p = Object.assign({ factorOfSafety: 2 }, params);
    var d_inches = p.holeDiamMm / 25.4;
    var Lmax_feet = 260.0 * Math.pow(d_inches, 2.0 / 3.0);
    var Lmax_m = Lmax_feet * 0.3048;
    var clearance = Lmax_m * p.factorOfSafety;
    var maxVelocity = Math.sqrt(Lmax_m * GRAVITY);  // from base range
    return { maxDistance: clearance, clearanceDistance: clearance, baseRange: Lmax_m, maxVelocity: maxVelocity };
}

/**
 * McKenzie (2009/2022) flyrock model — SDoB-based.
 *
 * @param {Object} params
 * @param {number} params.holeDiamMm       - Hole diameter (mm)
 * @param {number} params.stemmingLength   - St (m)
 * @param {number} params.chargeLength     - Lc (m)
 * @param {number} params.explosiveDensity - ρ (kg/L)
 * @param {number} [params.rockDensity=2600] - kg/m³
 * @param {number} [params.factorOfSafety=2]
 * @returns {{ sDoB, kv, maxDistance, clearanceDistance, maxVelocity }}
 */
export function mckenzie(params) {
    var p = Object.assign({ rockDensity: 2600, factorOfSafety: 2 }, params);
    var holeDiamM = p.holeDiamMm / 1000.0;
    var r = holeDiamM / 2.0;

    // Contributing charge length (capped at 10 or 8 hole diameters)
    var m_factor = p.holeDiamMm >= 100 ? 10 : 8;
    var Lcon = Math.min(p.chargeLength, m_factor * holeDiamM);

    // Mass per metre and contributing mass
    var W = Math.PI * r * r * p.explosiveDensity * 1000.0;  // kg/m
    var Wt_m = W * Lcon;

    // SDoB: distance to centre of contributing charge
    var D = p.stemmingLength + 0.5 * Lcon;
    var sDoB = D / Math.pow(Wt_m, 1.0 / 3.0);

    // Velocity coefficient (McKenzie 2009 Eq.5)
    var kv = 0.0728 * Math.pow(sDoB, -3.251);

    // Maximum range (McKenzie 2022 Eq.5)
    var Rmax = 9.74 * Math.pow(p.holeDiamMm / Math.pow(sDoB, 2.167), 2.0 / 3.0);

    var clearance = Rmax * p.factorOfSafety;
    var maxVelocity = Math.sqrt(Rmax * GRAVITY);  // from base range

    return { sDoB: sDoB, kv: kv, maxDistance: clearance, clearanceDistance: clearance, baseRange: Rmax, maxVelocity: maxVelocity };
}
