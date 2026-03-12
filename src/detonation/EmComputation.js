/**
 * EmComputation.js — Standalone Em value computation
 *
 * Author: Brent Buffham — blastingapps.com & kirra-design.com
 * License: MIT
 *
 * Re-exports computeEmValues from DetonationSimulator for standalone use.
 * Also provides a helper to compute Em values for a simple sequential column.
 */

export { computeEmValues } from "./DetonationSimulator.js";

/**
 * Compute Em values for a simple sequential column (no primer-based simulation).
 *
 * Elements are ordered from index 0 upward (sequential detonation).
 * This is the simplified case used in ScaledHeelan where primer position
 * is handled by the primerFraction parameter, not by full detonation simulation.
 *
 * @param {number} numElements    - Number of elements
 * @param {number} totalMass      - Total mass (kg)
 * @param {number} chargeExponent - A
 * @returns {Float64Array} Em values per element
 */
export function computeSequentialEm(numElements, totalMass, chargeExponent) {
    var elementMass = totalMass / numElements;
    var em = new Float64Array(numElements);
    for (var m = 0; m < numElements; m++) {
        var mwe  = (m + 1) * elementMass;
        var m1we = m * elementMass;
        em[m] = Math.pow(mwe, chargeExponent) - (m > 0 ? Math.pow(m1we, chargeExponent) : 0.0);
    }
    return em;
}

/**
 * Compute Em values for a column with primer-aware ordering.
 *
 * Elements are ordered by distance from the primer outward.
 *
 * @param {number} numElements     - Number of elements
 * @param {number} totalMass       - Total mass (kg)
 * @param {number} primerFraction  - 0.0 = primer at top, 1.0 = primer at base
 * @param {number} chargeExponent  - A
 * @returns {Float64Array} Em values per element (indexed by element position)
 */
export function computePrimerAwareEm(numElements, totalMass, primerFraction, chargeExponent) {
    var elementMass = totalMass / numElements;
    var primerElemPos = primerFraction * numElements;
    var em = new Float64Array(numElements);
    for (var m = 0; m < numElements; m++) {
        var fj = Math.abs((m + 0.5) - primerElemPos) + 1.0;
        var fjwe  = fj * elementMass;
        var fj1we = (fj - 1.0) * elementMass;
        em[m] = Math.pow(fjwe, chargeExponent) - (fj1we > 0 ? Math.pow(fj1we, chargeExponent) : 0.0);
    }
    return em;
}
