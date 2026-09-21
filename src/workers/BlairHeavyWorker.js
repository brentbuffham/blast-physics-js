/**
 * BlairHeavyWorker.js — Optimised Blair & Minchinton time-domain PPV worker
 *
 * Author: Brent Buffham — blastingapps.com & kirra-design.com
 * License: MIT
 *
 * Directly ported from Kirra's blairHeavyWorker.js with all optimisations preserved:
 *   1. Per-pixel pre-computation hoists all transcendentals out of time loop
 *   2. Iterative multiply replaces Math.pow in waveform pulse
 *   3. Waveform tail cutoff (skip when p > 4*N)
 *   4. Row-strip support for multi-worker parallelism
 *   5. Squared-magnitude tracking avoids sqrt per time step
 *   6. Pre-combined base arrival (timingS + eldel) per element
 *   7. Typed arrays (Float64Array) for cache-friendly access
 *
 * Message protocol:
 *   Main -> Worker:
 *     { type: 'computeStrip', payload: { deckEntries, holeEntries, gridParams,
 *       modelParams, startRow, endRow, totalCols, totalRows, actualCellX, actualCellY } }
 *
 *   Worker -> Main:
 *     { type: 'progress', completedRows, totalStripRows }
 *     { type: 'stripResult', data: { strip, startRow, endRow, totalCols } }
 *     { type: 'error', message }
 */

/* global self */

var PI = Math.PI;

/**
 * Numeric parameter read that does NOT treat an explicit 0 as "missing".
 * @param {*} v
 * @param {number} dflt
 * @returns {number}
 */
function num(v, dflt) {
    return (v == null || Number.isNaN(Number(v))) ? dflt : Number(v);
}

var VP, VS, vsp, VPinv, VSinv, VPoverVS;
var DT, bandwidth, sb1;
var scalBase, chargeExp;
var pulseDuration, pulseCutoff;
var Nm2, twoN, NNm1;
var cutoff, cutoff2, maxDisplayDist, maxDD2;

var gCount = 0;
var gPosX, gPosY, gPosZ;
var gScalFacM;
var gHDirX, gHDirY, gHDirZ;
var gDip;
var gBaseArrival;

var gDMidX, gDMidY, gDMidZ;
var gDCount = 0;

function initConstants(mp) {
    var poissonRatio = Math.max(0.01, Math.min(0.49, num(mp.poissonRatio, 0.25)));
    VP = num(mp.pWaveVelocity, 6000);
    VS = VP / Math.sqrt(2.0 * (1.0 - poissonRatio) / (1.0 - 2.0 * poissonRatio));
    vsp = (VS * VS) / (VP * VP);
    VPinv = 1.0 / VP;
    VSinv = 1.0 / VS;
    VPoverVS = VP / VS;

    // ⏪ BEFORE 0.3.0 every one of these used `mp.x || default`, so an explicit
    //    0 — a legitimate value for gamma, B, chargeExponent and especially for
    //    switching a term OFF — silently reverted to the default. Physical
    //    quantities use `x == null ? default : x` throughout.
    var K = num(mp.K, 700);
    var gamma = num(mp.gamma, 0.0455);
    var siteB = num(mp.B, 1.5);
    bandwidth = num(mp.bandwidth, 10000);
    var dtFactor = num(mp.dtFactor, 0.125);
    var NSP = num(mp.pulseOrder, 6);

    DT = dtFactor / bandwidth;
    sb1 = siteB - 1.0;
    scalBase = gamma * K;
    chargeExp = num(mp.chargeExponent, 0.7);
    cutoff = num(mp.cutoffDistance, 0.5);
    cutoff2 = cutoff * cutoff;
    maxDisplayDist = num(mp.maxDisplayDistance, 100);
    maxDD2 = maxDisplayDist * maxDisplayDist;

    Nm2 = NSP - 2;
    twoN = 2.0 * NSP;
    NNm1 = NSP * (NSP - 1.0);
    pulseDuration = 4.0 * NSP / bandwidth;
    pulseCutoff = 4.0 * NSP;
}

function preComputeElements(deckEntries, holeEntries, mp, displayTimeMs) {
    var fallbackVOD = num(mp.detonationVelocity, 5000);   // DEFAULT_VOD
    var fallbackExpDensity = num(mp.explosiveDensity, 1200);  // unused since 0.3.0
    var elemsPerDeck = num(mp.elemsPerDeck, 12);

    var tPosX = [], tPosY = [], tPosZ = [];
    var tScalFacM = [];
    var tHDirX = [], tHDirY = [], tHDirZ = [];
    var tDip = [];
    var tBaseArrival = [];
    var tDMidX = [], tDMidY = [], tDMidZ = [];

    for (var d = 0; d < deckEntries.length; d++) {
        var dk = deckEntries[d];
        if (dk.mass <= 0) continue;
        if (displayTimeMs >= 0 && dk.timingMs > displayTimeMs) continue;

        var axX = dk.baseX - dk.topX;
        var axY = dk.baseY - dk.topY;
        var axZ = dk.baseZ - dk.topZ;
        var deckLen = Math.sqrt(axX * axX + axY * axY + axZ * axZ);
        if (deckLen < 0.001) continue;

        var dkVOD = dk.vod > 0 ? dk.vod : fallbackVOD;
        var dL = deckLen / elemsPerDeck;
        var primerDepth = dk.primerFraction * deckLen;
        var primerElemPos = dk.primerFraction * elemsPerDeck;
        var dirX = axX / deckLen, dirY = axY / deckLen, dirZ = axZ / deckLen;
        var timingS = dk.timingMs / 1000.0;

        tDMidX.push((dk.topX + dk.baseX) * 0.5);
        tDMidY.push((dk.topY + dk.baseY) * 0.5);
        tDMidZ.push((dk.topZ + dk.baseZ) * 0.5);

        var holeIdx = dk.holeIndex;
        var hole = holeEntries[holeIdx];
        if (!hole) continue;
        var hvX = hole.toeX - hole.collarX;
        var hvY = hole.toeY - hole.collarY;
        var hvZ = hole.toeZ - hole.collarZ;
        var holeLen = Math.sqrt(hvX * hvX + hvY * hvY + hvZ * hvZ);
        if (holeLen < 0.001) continue;
        var hdX = hvX / holeLen, hdY = hvY / holeLen, hdZ = hvZ / holeLen;
        var sinDipFV = hvZ / holeLen;
        var dip = 1.5707963 + Math.asin(Math.max(-1, Math.min(1, sinDipFV)));

        // Element mass from the DECK's own mass.
        // ⏪ BEFORE 0.3.0: rhoE * PI * RAD * RAD * dL, built from the HOLE radius,
        //    ignoring both dk.mass and dk.chargeDiamMm — a decoupled deck was
        //    overweighted. Mirrors the same fix in BlairMinchinton.js.
        var fmelt = dk.mass / elemsPerDeck;

        for (var m = 0; m < elemsPerDeck; m++) {
            var elemCenter = m + 0.5;
            var distFromPrimerElems = Math.abs(elemCenter - primerElemPos);

            var fj = distFromPrimerElems + 1.0;
            var fmw = fj * fmelt;
            var fmwPrev = (fj - 1.0) * fmelt;
            var sfm = scalBase * (Math.pow(fmw, chargeExp) - Math.pow(Math.max(fmwPrev, 1e-20), chargeExp));

            var elemDepth = elemCenter * dL;
            tPosX.push(dk.topX + dirX * elemDepth);
            tPosY.push(dk.topY + dirY * elemDepth);
            tPosZ.push(dk.topZ + dirZ * elemDepth);
            tScalFacM.push(sfm);
            tHDirX.push(hdX);
            tHDirY.push(hdY);
            tHDirZ.push(hdZ);
            tDip.push(dip);

            var distFromPrimerM = Math.abs(elemDepth - primerDepth);
            tBaseArrival.push(timingS + distFromPrimerM / dkVOD);
        }
    }

    gCount = tPosX.length;
    gPosX = new Float64Array(tPosX);
    gPosY = new Float64Array(tPosY);
    gPosZ = new Float64Array(tPosZ);
    gScalFacM = new Float64Array(tScalFacM);
    gHDirX = new Float64Array(tHDirX);
    gHDirY = new Float64Array(tHDirY);
    gHDirZ = new Float64Array(tHDirZ);
    gDip = new Float64Array(tDip);
    gBaseArrival = new Float64Array(tBaseArrival);
    gDMidX = new Float64Array(tDMidX);
    gDMidY = new Float64Array(tDMidY);
    gDMidZ = new Float64Array(tDMidZ);
    gDCount = tDMidX.length;
}

function computeStrip(startRow, endRow, totalCols, minX, minY, fallbackZ, cellX, cellY, zStrip) {
    var stripRows = endRow - startRow;
    var strip = new Float32Array(stripRows * totalCols);

    var ppTP = new Float64Array(gCount);
    var ppTS = new Float64Array(gCount);
    var ppVfP = new Float64Array(gCount);
    var ppVfS = new Float64Array(gCount);
    var ppSinAD = new Float64Array(gCount);
    var ppCosAD = new Float64Array(gCount);

    var PROGRESS_EVERY = Math.max(1, Math.floor(stripRows / 100));

    for (var r = startRow; r < endRow; r++) {
        var localR = r - startRow;
        if (localR % PROGRESS_EVERY === 0) {
            self.postMessage({ type: "progress", completedRows: localR, totalStripRows: stripRows });
        }

        var wy = minY + r * cellY;

        for (var c = 0; c < totalCols; c++) {
            var wx = minX + c * cellX;
            var wz;
            if (zStrip) {
                wz = zStrip[localR * totalCols + c];
                if (wz !== wz) continue;
            } else {
                wz = fallbackZ;
            }

            var anyClose = false;
            for (var di = 0; di < gDCount; di++) {
                var ddx = wx - gDMidX[di], ddy = wy - gDMidY[di], ddz = wz - gDMidZ[di];
                if (ddx * ddx + ddy * ddy + ddz * ddz < maxDD2) { anyClose = true; break; }
            }
            if (!anyClose) continue;

            var ppCount = 0;
            var tMin = 1e10, tMax = -1e10;

            for (var e = 0; e < gCount; e++) {
                var toX = wx - gPosX[e], toY = wy - gPosY[e], toZ = wz - gPosZ[e];
                var d2 = toX * toX + toY * toY + toZ * toZ;
                if (d2 > maxDD2) continue;
                var dist = Math.sqrt(d2);
                if (dist < cutoff) dist = cutoff;

                var invDist = 1.0 / dist;
                var cosTheta = (gHDirX[e] * toX + gHDirY[e] * toY + gHDirZ[e] * toZ) * invDist;
                if (cosTheta > 1.0) cosTheta = 1.0;
                if (cosTheta < -1.0) cosTheta = -1.0;
                var theta = Math.acos(cosTheta);
                var sinTheta = Math.sin(theta);

                // Inlined blairSfacp / blairSfacs (see core/RadiationPattern.js).
                // Kept inline so this file stays a dependency-free worker script;
                // it must be changed in lockstep with RadiationPattern.js.
                var cosphi2 = cosTheta * cosTheta;
                var sfacp = 1.0 - 2.0 * vsp * cosphi2;
                var sfacs = 2.0 * sinTheta * cosTheta;

                var atanphi = Math.abs(sinTheta / Math.max(Math.abs(cosTheta), 1e-10));
                if (atanphi < 0.28) {
                    var sgn = sfacs >= 0 ? 1 : -1;
                    if (Math.abs(sfacs) < 1.2 * sfacp) sfacs = sgn * 1.2 * sfacp;
                }

                var hscalFac = gScalFacM[e] * Math.pow(dist, -sb1);
                ppVfP[ppCount] = hscalFac * sfacp * invDist;
                ppVfS[ppCount] = VPoverVS * hscalFac * sfacs * invDist;

                ppTP[ppCount] = gBaseArrival[e] + dist * VPinv;
                ppTS[ppCount] = gBaseArrival[e] + dist * VSinv;

                var angleDiff = theta - gDip[e];
                ppSinAD[ppCount] = Math.sin(angleDiff);
                ppCosAD[ppCount] = Math.cos(angleDiff);

                if (ppTP[ppCount] < tMin) tMin = ppTP[ppCount];
                if (ppTS[ppCount] + pulseDuration > tMax) tMax = ppTS[ppCount] + pulseDuration;

                ppCount++;
            }

            if (ppCount === 0 || tMin >= tMax || tMin > 1e9) continue;

            tMin -= DT;
            tMax += DT;
            var numSteps = Math.ceil((tMax - tMin) / DT);
            var peakVPPV2 = 0.0;

            for (var q = 0; q < numSteps; q++) {
                var t = tMin + q * DT;
                var sumVr = 0.0, sumVz = 0.0;

                for (var a = 0; a < ppCount; a++) {
                    if (t > ppTP[a]) {
                        var p_val = bandwidth * (t - ppTP[a]);
                        if (p_val < pulseCutoff) {
                            var pn2 = 1.0;
                            for (var ii = 0; ii < Nm2; ii++) pn2 *= p_val;
                            var pn1 = pn2 * p_val;
                            var pn = pn1 * p_val;
                            var w = (pn - twoN * pn1 + NNm1 * pn2) * Math.exp(-p_val);
                            var vr = w * ppVfP[a];
                            sumVr += ppSinAD[a] * vr;
                            sumVz -= ppCosAD[a] * vr;
                        }
                    }
                    if (t > ppTS[a]) {
                        var p2 = bandwidth * (t - ppTS[a]);
                        if (p2 < pulseCutoff) {
                            var pn2s = 1.0;
                            for (var jj = 0; jj < Nm2; jj++) pn2s *= p2;
                            var pn1s = pn2s * p2;
                            var pns = pn1s * p2;
                            var w2 = (pns - twoN * pn1s + NNm1 * pn2s) * Math.exp(-p2);
                            var vs = w2 * ppVfS[a];
                            sumVr += ppCosAD[a] * vs;
                            sumVz += ppSinAD[a] * vs;
                        }
                    }
                }

                var vppv2 = sumVr * sumVr + sumVz * sumVz;
                if (vppv2 > peakVPPV2) peakVPPV2 = vppv2;
            }

            strip[localR * totalCols + c] = Math.sqrt(peakVPPV2);
        }
    }

    self.postMessage({ type: "progress", completedRows: stripRows, totalStripRows: stripRows });
    return strip;
}

self.onmessage = function (e) {
    var msg = e.data;
    try {
        if (msg.type === "computeStrip") {
            var p = msg.payload;

            initConstants(p.modelParams);
            preComputeElements(p.deckEntries, p.holeEntries, p.modelParams, p.gridParams.displayTimeMs);

            var zStrip = p.zStrip || null;

            var strip = computeStrip(
                p.startRow, p.endRow,
                p.totalCols,
                p.gridParams.minX, p.gridParams.minY, p.gridParams.elevation,
                p.actualCellX, p.actualCellY,
                zStrip
            );

            self.postMessage({
                type: "stripResult",
                data: {
                    strip: strip,
                    startRow: p.startRow,
                    endRow: p.endRow,
                    totalCols: p.totalCols
                }
            }, [strip.buffer]);

        } else {
            self.postMessage({ type: "error", message: "Unknown message type: " + msg.type });
        }
    } catch (err) {
        self.postMessage({ type: "error", message: err.message || String(err) });
    }
};
