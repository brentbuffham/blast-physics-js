/**
 * RadiationPattern.js — Heelan and Blair radiation pattern functions
 *
 * Author: Brent Buffham — blastingapps.com & kirra-design.com
 * License: MIT
 *
 * References:
 *   Heelan (1953): F1, F2 patterns
 *   Blair & Minchinton (1996/2006): sfacp, sfacs patterns
 *   Blair (2015): near-axial regularisation (fud = 1.2)
 */

/**
 * Heelan P-wave radiation pattern.
 *   F1(φ) = sin(2φ)·cos(φ) = 2·sinφ·cos²φ
 *
 * φ = 0 (axial) → F1 = 0
 * φ = π/4       → F1 = max
 * φ = π/2 (radial) → F1 = 0
 *
 * @param {number} sinPhi - sin of angle φ from hole axis
 * @param {number} cosPhi - cos of angle φ from hole axis
 * @returns {number}
 */
export function heelanF1(sinPhi, cosPhi) {
    return 2.0 * sinPhi * cosPhi * cosPhi;
}

/**
 * Heelan SV-wave radiation pattern.
 *   F2(φ) = sin(φ)·cos(2φ) = sinφ·(2cos²φ − 1)
 *
 * @param {number} sinPhi
 * @param {number} cosPhi
 * @returns {number}
 */
export function heelanF2(sinPhi, cosPhi) {
    return sinPhi * (2.0 * cosPhi * cosPhi - 1.0);
}

/**
 * Blair P-wave radiation pattern.
 *   sfacp = 1 − 2·(Vs/Vp)²·cos²φ
 *
 * Non-zero on axis (unlike Heelan F1).
 *
 * @param {number} cosPhi
 * @param {number} vsp   - (Vs/Vp)²
 * @returns {number}
 */
export function blairSfacp(cosPhi, vsp) {
    return 1.0 - 2.0 * vsp * cosPhi * cosPhi;
}

/**
 * Blair SV-wave radiation pattern with near-axial regularisation.
 *   sfacs = sin(2φ)  with fud=1.2 correction when |tan(φ)| < 0.28
 *
 * Near-axial regularisation (Blair 2015):
 *   when |tan(φ)| < 0.28 and |sfacs| < 1.2·sfacp, set sfacs = sign(sfacs)·1.2·sfacp
 *
 * @param {number} sinPhi
 * @param {number} cosPhi
 * @param {number} sfacp  - P-wave pattern value (for regularisation)
 * @returns {number}
 */
export function blairSfacs(sinPhi, cosPhi, sfacp) {
    var sin2phi = 2.0 * sinPhi * cosPhi;
    var atanphi = Math.abs(sinPhi / Math.max(Math.abs(cosPhi), 1e-10));
    if (atanphi < 0.28) {
        var sgn = sin2phi >= 0 ? 1.0 : -1.0;
        if (Math.abs(sin2phi) < 1.2 * sfacp) {
            return sgn * 1.2 * sfacp;
        }
    }
    return sin2phi;
}

/**
 * Compute both Blair patterns from a unit direction vector and Vs/Vp ratio.
 *
 * @param {Object} toObs  - Unit vector from element to observation point {x,y,z}
 * @param {Object} hAxis  - Unit hole axis vector (collar→toe) {x,y,z}
 * @param {number} vsp    - (Vs/Vp)²
 * @returns {{ sfacp: number, sfacs: number, sinPhi: number, cosPhi: number }}
 */
export function blairPatterns(toObs, hAxis, vsp) {
    var cosPhi = toObs.x * hAxis.x + toObs.y * hAxis.y + toObs.z * hAxis.z;
    cosPhi = Math.max(-1.0, Math.min(1.0, cosPhi));
    var sinPhi = Math.sqrt(Math.max(0.0, 1.0 - cosPhi * cosPhi));
    var sfacp = blairSfacp(cosPhi, vsp);
    var sfacs = blairSfacs(sinPhi, cosPhi, sfacp);
    return { sfacp: sfacp, sfacs: sfacs, sinPhi: sinPhi, cosPhi: cosPhi };
}

/**
 * Compute both Heelan patterns from a unit direction vector.
 *
 * @param {Object} toObs  - Unit vector from element to observation point {x,y,z}
 * @param {Object} hAxis  - Unit hole axis vector (collar→toe) {x,y,z}
 * @returns {{ f1: number, f2: number, sinPhi: number, cosPhi: number }}
 */
export function heelanPatterns(toObs, hAxis) {
    var cosPhi = toObs.x * hAxis.x + toObs.y * hAxis.y + toObs.z * hAxis.z;
    cosPhi = Math.max(-1.0, Math.min(1.0, cosPhi));
    var sinPhi = Math.sqrt(Math.max(0.0, 1.0 - cosPhi * cosPhi));
    return { f1: heelanF1(sinPhi, cosPhi), f2: heelanF2(sinPhi, cosPhi), sinPhi: sinPhi, cosPhi: cosPhi };
}
