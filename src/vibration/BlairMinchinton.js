/**
 * BlairMinchinton.js — Full time-domain waveform superposition (Blair & Minchinton 1996/2006)
 *
 * Author: Brent Buffham — blastingapps.com & kirra-design.com
 * License: MIT
 *
 * Synthesises actual P-wave and SV-wave waveforms at each observation point,
 * superposes coherently across all elements/decks, and extracts the true peak
 * vector particle velocity including constructive/destructive interference.
 *
 * Unlike ScaledHeelan (incoherent RMS), this model:
 *   - Performs time-domain waveform synthesis with P/S arrival times
 *   - Uses Blair's Vs/Vp radiation patterns (sfacp/sfacs)
 *   - Uses near-axial regularisation (fud=1.2)
 *   - Primer location controls VOD delay and Em ordering
 *   - Properly rotates (velrad, velphi) into fixed (vr, vz) frame
 *
 * Extracted from Kirra's BlairMinchintonModel.js GLSL fragment shader.
 * References: Blair & Minchinton (1996/2006), Blair (2008)
 */

import { deriveSWaveVelocity } from "../core/RockMass.js";
import { blairSfacp, blairSfacs } from "../core/RadiationPattern.js";
import { blairWaveform, pulseCutoff, pulseDuration as calcPulseDuration } from "../core/Waveform.js";

/**
 * Compute Blair & Minchinton time-domain VPPV at an observation point.
 *
 * @param {{ x:number, y:number, z:number }} point - Observation point (m)
 * @param {Array}  deckEntries
 * @param {Array}  holeEntries
 * @param {Object} params
 * @param {number} [params.K=700]
 * @param {number} [params.B=1.5]
 * @param {number} [params.chargeExponent=0.7]
 * @param {number} [params.gamma=0.0455]
 * @param {number} [params.poissonRatio=0.25]
 * @param {number} [params.pWaveVelocity=6000]
 * @param {number} [params.detonationVelocity=5279] - fallback VOD
 * @param {number} [params.explosiveDensity=1400]   - fallback kg/m³
 * @param {number} [params.bandwidth=10000]
 * @param {number} [params.dtFactor=0.125]
 * @param {number} [params.pulseOrder=6]            - N
 * @param {number} [params.elemsPerDeck=12]
 * @param {number} [params.cutoffDistance=0.5]
 * @returns {number} VPPV (mm/s, in units matching K/gamma calibration)
 */
export function computeBlairMinchinton(point, deckEntries, holeEntries, params) {
    var p = Object.assign({
        K: 700, B: 1.5, chargeExponent: 0.7, gamma: 0.0455,
        poissonRatio: 0.25, pWaveVelocity: 6000,
        detonationVelocity: 5279, explosiveDensity: 1400,
        bandwidth: 10000, dtFactor: 0.125, pulseOrder: 6,
        elemsPerDeck: 12,
        cutoffDistance: 0.5
    }, params || {});

    var VP = p.pWaveVelocity;
    var VS = deriveSWaveVelocity(VP, p.poissonRatio);
    var vsp = (VS * VS) / (VP * VP);
    var VPoverVS = VP / VS;
    var VPinv = 1.0 / VP;
    var VSinv = 1.0 / VS;

    var N = p.pulseOrder;
    var DT = p.dtFactor / p.bandwidth;
    var sb1 = p.B - 1.0;
    var scalBase = p.gamma * p.K;
    var A = p.chargeExponent;
    var cutoff = p.cutoffDistance;
    var elemsPerDeck = p.elemsPerDeck;
    var pCutoff = pulseCutoff(N);
    var pDuration = calcPulseDuration(N, p.bandwidth);

    // Pass 1: compute time window [tMin, tMax] across all elements
    var tMin = 1e10, tMax = -1e10;

    for (var d = 0; d < deckEntries.length; d++) {
        var dk = deckEntries[d];
        if (dk.mass <= 0) continue;

        var topX = dk.topX, topY = dk.topY, topZ = dk.topZ;
        var botX = dk.baseX, botY = dk.baseY, botZ = dk.baseZ;
        var axX = botX - topX, axY = botY - topY, axZ = botZ - topZ;
        var deckLen = Math.sqrt(axX * axX + axY * axY + axZ * axZ);
        if (deckLen < 0.001) continue;
        var dirX = axX / deckLen, dirY = axY / deckLen, dirZ = axZ / deckLen;

        var deckVOD = dk.vod > 0 ? dk.vod : p.detonationVelocity;
        var dL = deckLen / elemsPerDeck;
        var timingS = dk.timingMs / 1000.0;
        var primerDepthInDeck = dk.primerFraction * deckLen;

        // Sample boundary elements for time bounds
        for (var m = 0; m < elemsPerDeck; m++) {
            if (m > 0 && m < elemsPerDeck - 1 && m !== Math.floor(elemsPerDeck / 2)) continue;
            var elemDepth = (m + 0.5) * dL;
            var eX = topX + dirX * elemDepth;
            var eY = topY + dirY * elemDepth;
            var eZ = topZ + dirZ * elemDepth;
            var toX = point.x - eX, toY = point.y - eY, toZ = point.z - eZ;
            var dist = Math.max(Math.sqrt(toX * toX + toY * toY + toZ * toZ), cutoff);
            var eldel = Math.abs(elemDepth - primerDepthInDeck) / deckVOD;
            var tpArr = timingS + eldel + dist * VPinv;
            var tsArr = timingS + eldel + dist * VSinv;
            if (tpArr < tMin) tMin = tpArr;
            if (tsArr + pDuration > tMax) tMax = tsArr + pDuration;
        }
    }

    if (tMin >= tMax || tMin > 1e9) return 0.0;

    tMin -= DT;
    tMax += DT;
    var numSteps = Math.ceil((tMax - tMin) / DT);

    // Pass 2: time-domain waveform synthesis
    var peakVPPV2 = 0.0;

    for (var q = 0; q < numSteps; q++) {
        var t = tMin + q * DT;
        var sumVr = 0.0, sumVz = 0.0;

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

            // Dip angle: π/2 + asin(dz/L)
            var dip = Math.PI / 2 + Math.asin(Math.max(-1, Math.min(1, hvZ / hLen)));

            var holeDiamMm = dk.holeDiamMm || 229;
            var RAD = holeDiamMm / 2000.0;
            var deckVOD = dk.vod > 0 ? dk.vod : p.detonationVelocity;
            var timingS = dk.timingMs / 1000.0;
            var rho_e = dk.density > 0 ? dk.density * 1000.0 : p.explosiveDensity;
            var dL = deckLen / elemsPerDeck;
            var fmelt = rho_e * Math.PI * RAD * RAD * dL;  // element mass (kg)

            var primerDepthInDeck = dk.primerFraction * deckLen;
            var primerElemPos = dk.primerFraction * elemsPerDeck;

            for (var m = 0; m < elemsPerDeck; m++) {
                var elemCenter = m + 0.5;
                var distFromPrimerElems = Math.abs(elemCenter - primerElemPos);
                var fj = distFromPrimerElems + 1.0;
                var fmw = fj * fmelt;
                var fmwPrev = (fj - 1.0) * fmelt;
                var scalFacM = scalBase * (Math.pow(fmw, A) - Math.pow(Math.max(fmwPrev, 1e-20), A));

                var elemDepth = elemCenter * dL;
                var eX = topX + dirX * elemDepth;
                var eY = topY + dirY * elemDepth;
                var eZ = topZ + dirZ * elemDepth;

                var toX = point.x - eX, toY = point.y - eY, toZ = point.z - eZ;
                var d2 = toX * toX + toY * toY + toZ * toZ;
                var dist = Math.max(Math.sqrt(d2), cutoff);
                var invDist = 1.0 / dist;

                var cosTheta = (haX * toX + haY * toY + haZ * toZ) * invDist;
                cosTheta = Math.max(-1.0, Math.min(1.0, cosTheta));
                var theta = Math.acos(cosTheta);
                var sinTheta = Math.sin(theta);

                // Blair radiation patterns
                var sfacp = blairSfacp(cosTheta, vsp);
                var sfacs = blairSfacs(sinTheta, cosTheta, sfacp);

                var hscalFac = scalFacM * Math.pow(dist, -sb1);
                var vfacp = hscalFac * sfacp * invDist;
                var vfacs = VPoverVS * hscalFac * sfacs * invDist;

                var eldel = Math.abs(elemDepth - primerDepthInDeck) / deckVOD;
                var tp = timingS + eldel + dist * VPinv;
                var ts = timingS + eldel + dist * VSinv;

                var angleDiff = theta - dip;
                var sinAD = Math.sin(angleDiff);
                var cosAD = Math.cos(angleDiff);

                // P-wave contribution
                if (t > tp) {
                    var p_val = p.bandwidth * (t - tp);
                    if (p_val < pCutoff) {
                        var w = blairWaveform(p_val, N);
                        var velrad = w * vfacp;
                        sumVr += sinAD * velrad;
                        sumVz -= cosAD * velrad;
                    }
                }

                // S-wave contribution
                if (t > ts) {
                    var p2 = p.bandwidth * (t - ts);
                    if (p2 < pCutoff) {
                        var w2 = blairWaveform(p2, N);
                        var velphi = w2 * vfacs;
                        sumVr += cosAD * velphi;
                        sumVz += sinAD * velphi;
                    }
                }
            }
        }

        var vppv2 = sumVr * sumVr + sumVz * sumVz;
        if (vppv2 > peakVPPV2) peakVPPV2 = vppv2;
    }

    return Math.sqrt(peakVPPV2);
}

export class BlairMinchintonModel {
    constructor(params) {
        this.params = Object.assign({
            K: 700, B: 1.5, chargeExponent: 0.7, gamma: 0.0455,
            poissonRatio: 0.25, pWaveVelocity: 6000,
            detonationVelocity: 5279, explosiveDensity: 1400,
            bandwidth: 10000, dtFactor: 0.125, pulseOrder: 6,
            elemsPerDeck: 12,
            cutoffDistance: 0.5
        }, params || {});
    }

    evaluate(point, deckEntries, holeEntries) {
        return computeBlairMinchinton(point, deckEntries, holeEntries, this.params);
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
                 cellX: gp.cellX, cellY: gp.cellY, elevation: gp.elevation, unit: "mm/s", model: "BlairMinchinton" };
    }
}
