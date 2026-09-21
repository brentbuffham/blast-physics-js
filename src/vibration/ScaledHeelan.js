/**
 * ScaledHeelan.js — Scaled Heelan fast model (Blair & Minchinton 2006; Blair 2008)
 *
 * Author: Brent Buffham — blastingapps.com & kirra-design.com
 * License: MIT
 *
 * Ported to match Kirra's ScaledHeelanModel.js, which is the reference
 * implementation. Keep the two in lockstep.
 *
 *   Em           = blairIncrement(m, N, primerElem, w_e, A)   (Blair 2008 Eq 22)
 *   vppvElement  = K · Em · R^(−B)
 *   vP           = vppvElement · blairPatternP(φ) · pWeight
 *   vSV          = vppvElement · blairPatternS(φ) · svWeight  (α/β included)
 *   VPPV         = Σ sqrt(vP² + vSV²)                          (linear, per element)
 *
 * ⚠ `chargeExponent` here is Blair's **A**, the exponent on CHARGE MASS — not
 *   the `e` of a scaled distance D/W^e. For a square-root site law
 *   PPV = K·(R/√W)^(−B), Blair 2008 Eq 14 gives **A = B/2**, so 0.8 for the
 *   default B = 1.6. Note that `SiteLaw.js` and `PPV.js` use the SAME NAME for
 *   the scaled-distance `e`, where 0.5 is correct. The two are related by
 *   A = e·B. Check which one you are passing to.
 *
 * ⏪ BEFORE 0.3.0 this model differed from the paper in five ways:
 *
 *   1. It used heelanF1/heelanF2, which put P at zero and |SV| at maximum at
 *      φ = π/2 — the reverse of B&M Eqs 10–11. PPV was non-monotonic in
 *      distance as a result.
 *   2. `chargeExponent` defaulted to 0.5, the scaled-distance value, where A
 *      is 0.8 for B = 1.6. The old default read ~3.3× low.
 *   3. Elements were RMS-summed (`sqrt(Σ (vP² + vSV²))`), which makes the
 *      answer depend on `elemsPerDeck`. The sum is now linear.
 *   4. `Em` counted from the deck TOP and ignored `primerFraction` entirely.
 *   5. Q attenuation was applied on top of the site law, which already carries
 *      the material attenuation in its R^(−(B−1)) (B&M p5). Q is GONE from
 *      this model, as it is from Kirra's.
 *
 * Reference: Blair & Minchinton (2006), Fragblast-8; Blair (2008), IJRMMS 45.
 */

import { blairPatternP, blairPatternS, blairIncrement, blairPrimerElement } from "../core/BlairScaledHeelan.js";

/**
 * Compute Scaled Heelan PPV at an observation point.
 *
 * @param {{ x:number, y:number, z:number }} point - Observation point (m)
 * @param {Array}  deckEntries  - DeckEntry objects
 * @param {Array}  holeEntries  - HoleEntry objects (for hole axis)
 * @param {Object} params
 * @param {number} [params.K=1140]             - site constant
 * @param {number} [params.B=1.6]              - site exponent
 * @param {number} [params.chargeExponent=0.8] - A, the CHARGE MASS exponent.
 *                 A = B/2 for a square-root site law (Blair 2008 Eq 14).
 * @param {number} [params.elemsPerDeck=8]
 * @param {number} [params.pWaveVelocity=4500]
 * @param {number} [params.sWaveVelocity=2600]
 * @param {number} [params.pWaveWeight=1.0]
 * @param {number} [params.svWaveWeight=1.0]
 * @param {number} [params.cutoffDistance=0.5]
 * @returns {number} VPPV (mm/s)
 */
export function computeScaledHeelan(point, deckEntries, holeEntries, params) {
    var p = Object.assign({
        K: 1140, B: 1.6, chargeExponent: 0.8,
        elemsPerDeck: 8,
        pWaveVelocity: 4500, sWaveVelocity: 2600,
        pWaveWeight: 1.0, svWaveWeight: 1.0,
        cutoffDistance: 0.5
    }, params || {});

    var K = p.K, B = p.B, A = p.chargeExponent;
    var VP = p.pWaveVelocity, VS = p.sWaveVelocity;
    var vsOverVp = VS / Math.max(VP, 1.0);
    var pW = p.pWaveWeight, sW = p.svWaveWeight;
    var cutoff = p.cutoffDistance;
    var elemsPerDeck = p.elemsPerDeck;

    var peakVPPV = 0.0;

    for (var d = 0; d < deckEntries.length; d++) {
        var dk = deckEntries[d];
        if (dk.mass <= 0) continue;

        var topX = dk.topX, topY = dk.topY, topZ = dk.topZ;
        var botX = dk.baseX, botY = dk.baseY, botZ = dk.baseZ;
        var axX = botX - topX, axY = botY - topY, axZ = botZ - topZ;
        var deckLen = Math.sqrt(axX * axX + axY * axY + axZ * axZ);
        if (deckLen < 0.001) continue;
        var dirX = axX / deckLen, dirY = axY / deckLen, dirZ = axZ / deckLen;

        // Hole axis from holeEntries
        var hole = holeEntries[dk.holeIndex];
        if (!hole) continue;
        var hvX = hole.toeX - hole.collarX;
        var hvY = hole.toeY - hole.collarY;
        var hvZ = hole.toeZ - hole.collarZ;
        var hLen = Math.sqrt(hvX * hvX + hvY * hvY + hvZ * hvZ);
        if (hLen < 0.001) continue;
        var haX = hvX / hLen, haY = hvY / hLen, haZ = hvZ / hLen;
        var holeLen = hLen;
        var collarX = hole.collarX, collarY = hole.collarY, collarZ = hole.collarZ;

        var holeRadius = dk.holeDiamMm * 0.0005;
        var dL = deckLen / elemsPerDeck;
        var elementMass = dk.mass / elemsPerDeck;
        var primerElem = blairPrimerElement(dk.primerFraction, elemsPerDeck);

        var sumPeak = 0.0;

        for (var m = 0; m < elemsPerDeck; m++) {
            var elemOffset = (m + 0.5) * dL;
            var eX = topX + dirX * elemOffset;
            var eY = topY + dirY * elemOffset;
            var eZ = topZ + dirZ * elemOffset;

            var toX = point.x - eX, toY = point.y - eY, toZ = point.z - eZ;
            var d2 = toX * toX + toY * toY + toZ * toZ;
            var R = Math.max(Math.sqrt(d2), cutoff);
            var invR = 1.0 / R;

            var cosPhi = (toX * haX + toY * haY + toZ * haZ) * invR;
            cosPhi = Math.max(-1.0, Math.min(1.0, cosPhi));
            var sinPhi = Math.sqrt(Math.max(0.0, 1.0 - cosPhi * cosPhi));

            // Blair 2008 Eq 22 element weight, then PPV_element = K·Em·R^−B
            var Em = blairIncrement(m, elemsPerDeck, primerElem, elementMass, A);
            var vppvElement = K * Em * Math.pow(R, -B);

            // B&M 2006 Eqs 10–11 radiation. No Q: the site law's R^−(B−1)
            // already IS the material attenuation (B&M p5).
            var vP  = vppvElement * blairPatternP(cosPhi, vsOverVp) * pW;
            var vSV = vppvElement * blairPatternS(sinPhi, cosPhi, vsOverVp) * sW;

            sumPeak += Math.sqrt(vP * vP + vSV * vSV);
        }

        // Attenuate below the toe
        var projOnAxis = ((point.x - collarX) * haX + (point.y - collarY) * haY + (point.z - collarZ) * haZ);
        var belowToe = projOnAxis - holeLen;
        if (belowToe > 0) {
            var decayLen = Math.max(deckLen * 0.15, holeRadius * 4.0);
            sumPeak *= Math.exp(-belowToe / decayLen);
        }

        if (sumPeak > peakVPPV) peakVPPV = sumPeak;
    }

    return peakVPPV;
}

export class ScaledHeelanModel {
    constructor(params) {
        this.params = Object.assign({
            K: 1140, B: 1.6, chargeExponent: 0.8,
            elemsPerDeck: 8,
            pWaveVelocity: 4500, sWaveVelocity: 2600,
            pWaveWeight: 1.0, svWaveWeight: 1.0,
            cutoffDistance: 0.5
        }, params || {});
    }

    evaluate(point, deckEntries, holeEntries) {
        return computeScaledHeelan(point, deckEntries, holeEntries, this.params);
    }

    computeGrid(deckEntries, holeEntries, gridParams) {
        var gp = gridParams;
        var data = new Float32Array(gp.rows * gp.cols);
        for (var r = 0; r < gp.rows; r++) {
            for (var c = 0; c < gp.cols; c++) {
                var x = gp.minX + c * gp.cellX;
                var y = gp.minY + r * gp.cellY;
                data[r * gp.cols + c] = this.evaluate({ x: x, y: y, z: gp.elevation }, deckEntries, holeEntries);
            }
        }
        return { data: data, rows: gp.rows, cols: gp.cols, minX: gp.minX, minY: gp.minY,
                 cellX: gp.cellX, cellY: gp.cellY, elevation: gp.elevation, unit: "mm/s", model: "ScaledHeelan" };
    }
}
