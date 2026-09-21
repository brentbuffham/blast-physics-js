/**
 * ScaledHeelanBlair.js — "Blair Lite" Scaled Heelan with Blair radiation patterns
 *
 * Author: Brent Buffham — blastingapps.com & kirra-design.com
 * License: MIT
 *
 * Coherent (linear) element summation with Blair's radiation patterns
 * (sfacp/sfacs), Poisson-derived Vs, and primer-aware element ordering
 * (distance from primer outward, not sequential).
 *
 * Key differences from ScaledHeelan:
 *   - Vs derived from Vp + Poisson's ratio rather than supplied directly
 *   - Near-axial fud=1.2 regularisation
 *   - 20 elements per deck by default rather than 8
 *
 * ⏪ BEFORE 0.3.0 this model differed from the paper in three ways:
 *
 *   1. The α/β = Vp/Vs factor on the SV term (B&M Eq 11) was missing, so S
 *      was under-weighted by a factor of about 1.73 relative to
 *      BlairMinchinton.js, which has always applied it.
 *   2. `chargeExponent: 0.5` was used directly as the mass exponent A, where
 *      the site law gives A = e·B = 0.8 for B = 1.6. See `massExponent`.
 *   3. Elements were RMS-summed, making the result depend on `elemsPerDeck`.
 *      The linear sum telescopes and conserves charge (Blair 2008 p237).
 *
 *   Q attenuation is also off by default — see `qualityFactorP`.
 *
 * Extracted from Kirra's ScaledHeelanNinetyPCTModel.js GLSL fragment shader.
 * Reference: Blair (2015), Fragblast 11; Blair & Minchinton (2006), Fragblast-8;
 *            Blair (2008), IJRMMS 45.
 */

import { blairSfacp, blairSfacs } from "../core/RadiationPattern.js";
import { deriveSWaveVelocity } from "../core/RockMass.js";
import { PULSE_DOMINANT_FREQ_COEFF } from "../core/Constants.js";

/**
 * Compute Blair Lite PPV at an observation point.
 *
 * @param {{ x:number, y:number, z:number }} point - Observation point (m)
 * @param {Array}  deckEntries  - DeckEntry objects
 * @param {Array}  holeEntries  - HoleEntry objects (for hole axis)
 * @param {Object} params
 * @param {number} [params.K=1140]
 * @param {number} [params.B=1.6]
 * @param {number} [params.chargeExponent=0.5] - e, the scaled-distance exponent
 *                 in D/W^e. The mass exponent A is derived as e·B unless
 *                 `massExponent` is given.
 * @param {number} [params.massExponent]       - A, overriding e·B.
 * @param {number} [params.elemsPerDeck=20]
 * @param {number} [params.pWaveVelocity=4500]
 * @param {number} [params.poissonRatio=0.25]
 * @param {number} [params.pWaveWeight=1.0]
 * @param {number} [params.svWaveWeight=1.0]
 * @param {number} [params.cutoffDistance=0.5]
 * @param {number} [params.qualityFactorP=0]   - 0 = OFF (the default, and correct).
 *                 The R^(−(B−1)) in the site law already IS the material
 *                 attenuation (B&M p5); exp(−ωR/2QV) on top double-counts it.
 * @param {number} [params.qualityFactorS=0]   - 0 = OFF. Independent of Qp.
 * @param {number} [params.bandwidth=10000]    - only used when Q is enabled
 * @returns {number} VPPV (mm/s)
 */
export function computeScaledHeelanBlair(point, deckEntries, holeEntries, params) {
    var p = Object.assign({
        K: 1140, B: 1.6, chargeExponent: 0.5,
        elemsPerDeck: 20,
        pWaveVelocity: 4500, poissonRatio: 0.25,
        pWaveWeight: 1.0, svWaveWeight: 1.0,
        cutoffDistance: 0.5,
        qualityFactorP: 0, qualityFactorS: 0,
        bandwidth: 10000
    }, params || {});

    var VS = deriveSWaveVelocity(p.pWaveVelocity, p.poissonRatio);
    var VP = p.pWaveVelocity;
    var vsp = (VS * VS) / (VP * VP);

    var K = p.K, B = p.B;
    // A = e·B (Blair 2008 Eq 14 p241: a·(√W/d)^b ≡ K·W^A·d^(−B), so A = b/2 for e = ½)
    var A = (p.massExponent != null) ? p.massExponent : p.chargeExponent * B;
    var VPoverVS = VP / VS;
    var pW = p.pWaveWeight, sW = p.svWaveWeight;
    var cutoff = p.cutoffDistance;
    var Qp = p.qualityFactorP, Qs = p.qualityFactorS;
    var elemsPerDeck = p.elemsPerDeck;
    var omega = 2.0 * Math.PI * PULSE_DOMINANT_FREQ_COEFF * p.bandwidth;

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

        // Primer element position (fractional index within deck)
        var primerElemPos = dk.primerFraction * elemsPerDeck;

        var sumP = 0.0, sumSV = 0.0;

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

            // Primer-aware Em ordering (Blair 2008)
            var fj = Math.abs((m + 0.5) - primerElemPos) + 1.0;
            var fjwe  = fj * elementMass;
            var fj1we = (fj - 1.0) * elementMass;
            var Em = Math.pow(fjwe, A) - (fj1we > 0 ? Math.pow(fj1we, A) : 0.0);

            var vppvElem = K * Em * Math.pow(R, -B);

            // Blair radiation patterns
            var sfacp = blairSfacp(cosPhi, vsp);
            var sfacs = blairSfacs(sinPhi, cosPhi, sfacp);

            // ⏪ BEFORE 0.3.0 both attenuations were gated on `Qp > 0`, so
            //    Qs = 0 with Qp > 0 gave exp(−∞) = 0 and an S term that vanished.
            var attP = 1.0, attS = 1.0;
            if (Qp > 0) attP = Math.exp(-omega * R / (2.0 * Qp * VP));
            if (Qs > 0) attS = Math.exp(-omega * R / (2.0 * Qs * VS));

            sumP  += vppvElem * sfacp * pW * attP;
            sumSV += VPoverVS * vppvElem * sfacs * sW * attS;  // α/β on SV — B&M Eq 11
        }

        // Attenuate below the toe
        var projOnAxis = ((point.x - collarX) * haX + (point.y - collarY) * haY + (point.z - collarZ) * haZ);
        var belowToe = projOnAxis - holeLen;
        if (belowToe > 0) {
            var decayLen = Math.max(deckLen * 0.15, holeRadius * 4.0);
            var att = Math.exp(-belowToe / decayLen);
            sumP *= att;
            sumSV *= att;
        }

        var vppv = Math.sqrt(sumP * sumP + sumSV * sumSV);
        if (vppv > peakVPPV) peakVPPV = vppv;
    }

    return peakVPPV;
}

export class ScaledHeelanBlairModel {
    constructor(params) {
        this.params = Object.assign({
            K: 1140, B: 1.6, chargeExponent: 0.5,
            elemsPerDeck: 20,
            pWaveVelocity: 4500, poissonRatio: 0.25,
            pWaveWeight: 1.0, svWaveWeight: 1.0,
            cutoffDistance: 0.5,
            qualityFactorP: 0, qualityFactorS: 0,
            bandwidth: 10000
        }, params || {});
    }

    evaluate(point, deckEntries, holeEntries) {
        return computeScaledHeelanBlair(point, deckEntries, holeEntries, this.params);
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
                 cellX: gp.cellX, cellY: gp.cellY, elevation: gp.elevation, unit: "mm/s", model: "ScaledHeelanBlair" };
    }
}
