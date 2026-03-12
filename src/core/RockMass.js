/**
 * RockMass.js — Rock mass properties with S-wave derivation
 *
 * Author: Brent Buffham — blastingapps.com & kirra-design.com
 * License: MIT
 */

/**
 * Default rock mass parameters.
 */
export const DEFAULT_ROCK_MASS = {
    density: 2700,          // kg/m³
    pWaveVelocity: 4500,    // m/s
    poissonRatio: 0.25      // dimensionless
};

/**
 * Derive S-wave velocity from P-wave velocity and Poisson's ratio.
 *
 * Formula: Vs = Vp / sqrt(2(1-ν)/(1-2ν))
 *
 * @param {number} vp - P-wave velocity (m/s)
 * @param {number} nu - Poisson's ratio (0.0 – 0.49)
 * @returns {number} S-wave velocity (m/s)
 */
export function deriveSWaveVelocity(vp, nu) {
    var clampedNu = Math.max(0.01, Math.min(0.49, nu));
    return vp / Math.sqrt(2.0 * (1.0 - clampedNu) / (1.0 - 2.0 * clampedNu));
}

/**
 * Create a validated rock mass object with Vs derived if not supplied.
 *
 * @param {Object} params
 * @param {number} [params.density=2700] - kg/m³
 * @param {number} [params.pWaveVelocity=4500] - m/s
 * @param {number} [params.poissonRatio=0.25]
 * @param {number} [params.sWaveVelocity] - m/s (overrides derivation when supplied)
 * @returns {Object} Rock mass object with sWaveVelocity populated
 */
export function createRockMass(params) {
    var p = Object.assign({}, DEFAULT_ROCK_MASS, params || {});
    if (!p.sWaveVelocity || p.sWaveVelocity <= 0) {
        p.sWaveVelocity = deriveSWaveVelocity(p.pWaveVelocity, p.poissonRatio);
    }
    return p;
}

export class RockMass {
    constructor(params) {
        Object.assign(this, createRockMass(params));
    }

    /** (Vs/Vp)² — used in Blair radiation pattern */
    get vsp() {
        return (this.sWaveVelocity * this.sWaveVelocity) /
               (this.pWaveVelocity * this.pWaveVelocity);
    }
}
