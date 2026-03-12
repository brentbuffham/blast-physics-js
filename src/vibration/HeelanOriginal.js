/**
 * HeelanOriginal.js — First-principles Heelan (1953) via Blair & Minchinton (1996)
 *
 * Author: Brent Buffham — blastingapps.com & kirra-design.com
 * License: MIT
 *
 * Borehole pressure derived from explosive density and VOD:
 *   Pb = ρ_e × VOD² / 8
 *
 * Per sub-element velocity components (P and SV waves):
 *   vP  = scaleP  × F1(φ) × ω × att_P
 *   vSV = scaleSV × F2(φ) × ω × att_S
 *
 * Summed (coherent) then converted to VPPV (mm/s).
 * Extracted from Kirra's HeelanOriginalModel.js GLSL fragment shader.
 * Reference: Blair & Minchinton (1996), Fragblast-5
 */

import { heelanF1, heelanF2 } from "../core/RadiationPattern.js";

/**
 * Compute Heelan Original VPPV at an observation point.
 *
 * @param {{ x:number, y:number, z:number }} point - Observation point (m)
 * @param {Array}  deckEntries
 * @param {Array}  holeEntries
 * @param {Object} params
 * @param {number} [params.rockDensity=2700]       - kg/m³
 * @param {number} [params.pWaveVelocity=4500]      - m/s
 * @param {number} [params.sWaveVelocity=2600]      - m/s
 * @param {number} [params.detonationVelocity=5500] - m/s fallback VOD
 * @param {number} [params.elemsPerDeck=8]
 * @param {number} [params.cutoffDistance=0.5]
 * @param {number} [params.qualityFactorP=50]
 * @param {number} [params.qualityFactorS=30]
 * @returns {number} VPPV (mm/s)
 */
export function computeHeelanOriginal(point, deckEntries, holeEntries, params) {
    var p = Object.assign({
        rockDensity: 2700,
        pWaveVelocity: 4500, sWaveVelocity: 2600,
        detonationVelocity: 5500,
        elemsPerDeck: 8,
        cutoffDistance: 0.5,
        qualityFactorP: 50, qualityFactorS: 30
    }, params || {});

    var VP = p.pWaveVelocity, VS = p.sWaveVelocity;
    var rho = p.rockDensity;
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
        var effectiveVOD = dk.vod > 0 ? dk.vod : p.detonationVelocity;
        var rho_e = dk.density > 0 ? dk.density * 1000.0 : 1200.0;  // kg/L → kg/m³

        // Borehole wall pressure (Pa)
        var Pb = rho_e * effectiveVOD * effectiveVOD * 0.125;

        var dL = deckLen / elemsPerDeck;
        var omega = effectiveVOD / (2.0 * holeRadius);

        var sumVr = 0.0, sumVz = 0.0;

        for (var m = 0; m < elemsPerDeck; m++) {
            var elemOffset = (m + 0.5) * dL;
            var eX = topX + dirX * elemOffset;
            var eY = topY + dirY * elemOffset;
            var eZ = topZ + dirZ * elemOffset;

            var toX = point.x - eX, toY = point.y - eY, toZ = point.z - eZ;
            var R = Math.max(Math.sqrt(toX * toX + toY * toY + toZ * toZ), cutoff);
            var invR = 1.0 / R;

            var cosPhi = (toX * haX + toY * haY + toZ * haZ) * invR;
            cosPhi = Math.max(-1.0, Math.min(1.0, cosPhi));
            var sinPhi = Math.sqrt(Math.max(0.0, 1.0 - cosPhi * cosPhi));

            var f1 = heelanF1(sinPhi, cosPhi);
            var f2 = heelanF2(sinPhi, cosPhi);

            var scaleP  = (Pb * holeRadius * holeRadius * dL) / (rho * VP * VP * R);
            var scaleSV = (Pb * holeRadius * holeRadius * dL) / (rho * VS * VS * R);

            var attP = 1.0, attS = 1.0;
            if (Qp > 0) attP = Math.exp(-omega * R / (2.0 * Qp * VP));
            if (Qs > 0) attS = Math.exp(-omega * R / (2.0 * Qs * VS));

            var vP  = scaleP  * f1 * omega * attP;
            var vSV = scaleSV * f2 * omega * attS;

            sumVr += vP * sinPhi + vSV * cosPhi;
            sumVz += vP * cosPhi - vSV * sinPhi;
        }

        // Attenuate below the toe
        var projOnAxis = ((point.x - collarX) * haX + (point.y - collarY) * haY + (point.z - collarZ) * haZ);
        var belowToe = projOnAxis - holeLen;
        if (belowToe > 0) {
            var decayLen = Math.max(deckLen * 0.15, holeRadius * 4.0);
            var att = Math.exp(-belowToe / decayLen);
            sumVr *= att;
            sumVz *= att;
        }

        var vppv = Math.sqrt(sumVr * sumVr + sumVz * sumVz) * 1000.0; // m/s → mm/s
        if (vppv > peakVPPV) peakVPPV = vppv;
    }

    return peakVPPV;
}

export class HeelanOriginalModel {
    constructor(params) {
        this.params = Object.assign({
            rockDensity: 2700,
            pWaveVelocity: 4500, sWaveVelocity: 2600,
            detonationVelocity: 5500,
            elemsPerDeck: 8,
            cutoffDistance: 0.5,
            qualityFactorP: 50, qualityFactorS: 30
        }, params || {});
    }

    evaluate(point, deckEntries, holeEntries) {
        return computeHeelanOriginal(point, deckEntries, holeEntries, this.params);
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
                 cellX: gp.cellX, cellY: gp.cellY, elevation: gp.elevation, unit: "mm/s", model: "HeelanOriginal" };
    }
}
