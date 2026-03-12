/**
 * ScaledHeelan.js — Scaled Heelan fast model (Blair & Minchinton 2006)
 *
 * Author: Brent Buffham — blastingapps.com & kirra-design.com
 * License: MIT
 *
 * Incoherent (RMS) energy summation across sub-elements with Heelan F1/F2
 * radiation patterns and Blair (2008) non-linear superposition.
 *
 *   Em = [m·w_e]^A − [(m−1)·w_e]^A
 *   vppvElement = K × Em × R^(−B)
 *   VPPV = sqrt(Σ (vP² + vSV²))  — RMS across elements
 *
 * Extracted from Kirra's ScaledHeelanModel.js GLSL fragment shader.
 * Reference: Blair & Minchinton (2006), Fragblast-8
 */

import { heelanF1, heelanF2 } from "../core/RadiationPattern.js";

/**
 * Compute Scaled Heelan PPV at an observation point.
 *
 * @param {{ x:number, y:number, z:number }} point - Observation point (m)
 * @param {Array}  deckEntries  - DeckEntry objects
 * @param {Array}  holeEntries  - HoleEntry objects (for hole axis)
 * @param {Object} params
 * @param {number} [params.K=1140]
 * @param {number} [params.B=1.6]
 * @param {number} [params.chargeExponent=0.5]
 * @param {number} [params.elemsPerDeck=8]
 * @param {number} [params.pWaveVelocity=4500]
 * @param {number} [params.sWaveVelocity=2600]
 * @param {number} [params.pWaveWeight=1.0]
 * @param {number} [params.svWaveWeight=1.0]
 * @param {number} [params.cutoffDistance=0.5]
 * @param {number} [params.qualityFactorP=50]
 * @param {number} [params.qualityFactorS=30]
 * @returns {number} VPPV (mm/s)
 */
export function computeScaledHeelan(point, deckEntries, holeEntries, params) {
    var p = Object.assign({
        K: 1140, B: 1.6, chargeExponent: 0.5,
        elemsPerDeck: 8,
        pWaveVelocity: 4500, sWaveVelocity: 2600,
        pWaveWeight: 1.0, svWaveWeight: 1.0,
        cutoffDistance: 0.5,
        qualityFactorP: 50, qualityFactorS: 30
    }, params || {});

    var K = p.K, B = p.B, A = p.chargeExponent;
    var VP = p.pWaveVelocity, VS = p.sWaveVelocity;
    var pW = p.pWaveWeight, sW = p.svWaveWeight;
    var cutoff = p.cutoffDistance;
    var Qp = p.qualityFactorP, Qs = p.qualityFactorS;
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
        var effectiveVOD = dk.vod > 0 ? dk.vod : 5500;
        var dL = deckLen / elemsPerDeck;
        var elementMass = dk.mass / elemsPerDeck;

        var sumEnergy = 0.0;
        var omega = (Qp > 0) ? effectiveVOD / (2.0 * holeRadius) : 0;

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

            // Blair non-linear superposition (Blair 2008)
            var mwe  = (m + 1) * elementMass;
            var m1we = m * elementMass;
            var Em = Math.pow(mwe, A) - (m1we > 0 ? Math.pow(m1we, A) : 0.0);

            var vppvElem = K * Em * Math.pow(R, -B);

            var f1 = heelanF1(sinPhi, cosPhi);
            var f2 = heelanF2(sinPhi, cosPhi);

            var attP = 1.0, attS = 1.0;
            if (Qp > 0) {
                attP = Math.exp(-omega * R / (2.0 * Qp * VP));
                attS = Math.exp(-omega * R / (2.0 * Qs * VS));
            }

            var vP  = vppvElem * f1 * pW * attP;
            var vSV = vppvElem * f2 * sW * attS;
            sumEnergy += vP * vP + vSV * vSV;
        }

        // Attenuate below the toe
        var projOnAxis = ((point.x - collarX) * haX + (point.y - collarY) * haY + (point.z - collarZ) * haZ);
        var belowToe = projOnAxis - holeLen;
        if (belowToe > 0) {
            var decayLen = Math.max(deckLen * 0.15, holeRadius * 4.0);
            var att = Math.exp(-belowToe / decayLen);
            sumEnergy *= att * att;
        }

        var vppv = Math.sqrt(sumEnergy);
        if (vppv > peakVPPV) peakVPPV = vppv;
    }

    return peakVPPV;
}

export class ScaledHeelanModel {
    constructor(params) {
        this.params = Object.assign({
            K: 1140, B: 1.6, chargeExponent: 0.5,
            elemsPerDeck: 8,
            pWaveVelocity: 4500, sWaveVelocity: 2600,
            pWaveWeight: 1.0, svWaveWeight: 1.0,
            cutoffDistance: 0.5,
            qualityFactorP: 50, qualityFactorS: 30
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
