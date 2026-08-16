/**
 * ForwardArray.js — Three-component (L/T/V) forward array synthesis at a monitor
 *
 * Author: Brent Buffham — blastingapps.com & kirra-design.com
 * License: MIT
 *
 * Builds synthetic Longitudinal / Transverse / Vertical ground-motion traces
 * at a single receiver by superposing per-source body-wave (P + optional S)
 * contributions plus an optional Love-wave surface packet. Site-law scaling
 * gives each source's PPV; a wavelet stamps the shape at the arrival time.
 *
 * Two wavelet paths:
 *   ANALYTICAL — opts.wavelet = { type, fP, fS }, type ∈ ricker | gauss-sin | minphase
 *   SAMPLED    — opts.seedSpec = { kind, params } (ricker | berlage | damped | twoterm | measured)
 *
 * Projections (monitor frame):
 *   P  : longitudinal along propagation      → L cosφ, T sinφ, V sin(dip)
 *   S  : transverse to propagation (SH+SV)   → L −sinφ, T cosφ, V cos(dip)
 *   Love: horizontal transverse, plan distance, 1/√r spreading, no V
 *
 * Extracted from Kirra's ForwardArraySynthesis.js.
 */

import { evalWavelet, buildSeedBundle } from "./Wavelets.js";
import { fftMagnitude, peakInRange, peakAbs } from "./FFT.js";
import { computeBlairDamageScale } from "./SeedSynthesis.js";
import { gaoCorrectionFactor } from "./GaoNearFieldCorrection.js";

// ----- angle / bearing helpers ------------------------------------------------

/**
 * Compass bearing (rad) from (fromX,fromY) to (toX,toY): 0 = north (+Y), clockwise.
 */
export function bearingFromTo(fromX, fromY, toX, toY) {
    return Math.atan2(toX - fromX, toY - fromY);
}

/** Wrap an angle to (−π, π]. */
export function normaliseAngle(a) {
    while (a > Math.PI) a -= 2 * Math.PI;
    while (a < -Math.PI) a += 2 * Math.PI;
    return a;
}

/**
 * Principal-axis polarisation angle in the L–T plane (rad) — covariance
 * eigen-decomposition (Flinn 1965).
 */
export function polarisationAngle(L, T) {
    var mLL = 0, mTT = 0, mLT = 0;
    for (var i = 0; i < L.length; i++) {
        mLL += L[i] * L[i];
        mTT += T[i] * T[i];
        mLT += L[i] * T[i];
    }
    return 0.5 * Math.atan2(2 * mLT, mLL - mTT);
}

// ----- stamping ---------------------------------------------------------------

function addWavelet(buf, dt, tCenter, amp, f, type, halfW) {
    if (Math.abs(amp) < 1e-9) return;
    var N = buf.length;
    var i0 = Math.max(0, Math.floor((tCenter - halfW) / dt));
    var i1 = Math.min(N - 1, Math.ceil((tCenter + halfW) / dt));
    for (var i = i0; i <= i1; i++) {
        buf[i] += amp * evalWavelet(i * dt - tCenter, f, type);
    }
}

function addSampledWavelet(buf, dt, tCenter, amp, samples, causal) {
    if (Math.abs(amp) < 1e-9) return;
    if (!samples || samples.length === 0) return;
    var N = buf.length, sN = samples.length;
    var centreOffset = causal ? 0 : (sN >> 1);
    var i0 = Math.floor(tCenter / dt) - centreOffset;
    var k0 = 0;
    if (i0 < 0) { k0 = -i0; i0 = 0; }
    var maxK = Math.min(sN, N - i0 + k0);
    for (var k = k0; k < maxK; k++) buf[i0 + (k - k0)] += amp * samples[k];
}

/**
 * Convert DeckEntry objects into forward-array sources
 * [{ id, x, y, z, weight, fireTimeMs, collar }].
 *
 * @param {Array} deckEntries
 * @param {Array} [holeEntries] - for collar positions
 * @returns {Array}
 */
export function sourcesFromDecks(deckEntries, holeEntries) {
    var out = [];
    for (var i = 0; i < (deckEntries || []).length; i++) {
        var d = deckEntries[i];
        if (!d || !(d.mass > 0)) continue;
        var h = holeEntries ? holeEntries[d.holeIndex] : null;
        out.push({
            id: h ? h.holeID + ":" + i : String(i),
            x: (d.topX + d.baseX) * 0.5, y: (d.topY + d.baseY) * 0.5, z: (d.topZ + d.baseZ) * 0.5,
            weight: d.mass, fireTimeMs: Number(d.timingMs) || 0,
            collar: h ? { x: h.collarX, y: h.collarY, z: h.collarZ } : null
        });
    }
    return out;
}

function _emptyResult(fs, dur) {
    var N = Math.floor(dur * fs);
    var emptyFFT = { mag: new Float64Array(0), df: 0, N: 0 };
    return {
        L: new Float64Array(N), T: new Float64Array(N), V: new Float64Array(N),
        dt: 1 / fs, tShift: 0, fs: fs, LBearingRad: 0, LDipRad: 0,
        fftL: emptyFFT, fftT: emptyFFT, fftV: emptyFFT,
        stats: {
            LPeak: 0, LPeakTimeS: 0, TPeak: 0, TPeakTimeS: 0, VPeak: 0, VPeakTimeS: 0,
            peakVectorSum: 0, peakVectorSumTimeS: 0, LFpeak: 0, TFpeak: 0, VFpeak: 0,
            polarisationDeg: 0, geometricBearingDeg: 0, apparentMinusGeometricDeg: 0,
            contributorCount: 0, closest: null, seedKind: null, superposition: "linear", dominantHolePPV: 0
        }
    };
}

/**
 * Run a forward array synthesis at a single monitor.
 *
 * @param {Object} opts
 * @param {Array}  opts.holes            - sources [{ id, x, y, z, weight(kg), fireTimeMs, collar? }]
 * @param {{x,y,z}} opts.monitor
 * @param {number} [opts.LBearingRad]    - L-axis bearing (0 = N, CW); default auto-aim at source centroid
 * @param {number} [opts.LDipRad=0]
 * @param {Object} [opts.physics]        - { cp=2340, cs=2200, K=1839, B=1.49, E=0.5, inclS=true, spRatio=0.6 }
 * @param {Object} [opts.love]           - { include=false, factor=0.3, freqHz=2, vMps=800 }
 * @param {Object} [opts.wavelet]        - { type='ricker', fP=30, fS=18 } (analytical path)
 * @param {Object} [opts.seedSpec]       - { kind, params } (sampled path, overrides wavelet)
 * @param {number} [opts.fs=2048]        - sample rate (Hz)
 * @param {number} [opts.durationS=6]
 * @param {boolean} [opts.skipFFT=false]
 * @param {number} [opts.cutoffSD=0]     - Yang–Scovira scaled-distance floor (m/kg^E); 0 = off
 * @param {string} [opts.sourcePosition='centroid'] - 'centroid' | 'collar'
 * @param {string} [opts.superposition='linear'] - 'linear' | 'blairMinchinton'
 * @param {number} [opts.eta=2]
 * @param {number} [opts.meanSpacingM=4]
 * @param {boolean} [opts.gaoCorrectionEnabled=false]
 * @returns {{ L, T, V, dt, tShift, fs, LBearingRad, LDipRad, fftL, fftT, fftV, stats }}
 */
export function runForwardArraySynthesis(opts) {
    var holes = opts.holes || [];
    var m = opts.monitor || { x: 0, y: 0, z: 0 };
    var phys = opts.physics || {};
    var love = opts.love || {};
    var wave = opts.wavelet || {};
    var fs = +opts.fs > 0 ? +opts.fs : 2048;
    var dur = +opts.durationS > 0 ? +opts.durationS : 6;
    var skipFFT = !!opts.skipFFT;
    var cutoffSD = +opts.cutoffSD > 0 ? +opts.cutoffSD : 0;
    var srcMode = opts.sourcePosition === "collar" ? "collar" : "centroid";
    var superpositionMode = (opts.superposition === "blairMinchinton") ? "blairMinchinton" : "linear";
    var blairEta = (opts.eta != null && +opts.eta >= 0) ? +opts.eta : 2;
    var blairSP = (opts.meanSpacingM != null && +opts.meanSpacingM > 0) ? +opts.meanSpacingM : 4;
    var gaoOn = !!opts.gaoCorrectionEnabled;

    var cp = +phys.cp > 0 ? +phys.cp : 2340;
    var cs = +phys.cs > 0 ? +phys.cs : 2200;
    var K = +phys.K > 0 ? +phys.K : 1839;
    var B = +phys.B > 0 ? +phys.B : 1.49;
    var E = +phys.E ? +phys.E : 0.5;
    var inclS = phys.inclS !== false;
    var spRatio = +phys.spRatio > 0 ? +phys.spRatio : 0.6;

    var inclLove = !!love.include;
    var loveFactor = +love.factor > 0 ? +love.factor : 0.3;
    var fLove = +love.freqHz > 0 ? +love.freqHz : 2.0;
    var vLove = +love.vMps > 0 ? +love.vMps : 800;

    var wType = wave.type || "ricker";
    var fP = +wave.fP > 0 ? +wave.fP : 30;
    var fS = +wave.fS > 0 ? +wave.fS : 18;
    var wHalfP = 3 / fP, wHalfS = 3 / fS, wHalfLove = 3 / fLove;

    var sampledSeed = buildSeedBundle(opts.seedSpec, fs, fLove);

    var valid = [];
    for (var i = 0; i < holes.length; i++) {
        var h = holes[i];
        if (!h) continue;
        if (h.x == null || isNaN(h.x)) continue;
        if (h.y == null || isNaN(h.y)) continue;
        if (h.fireTimeMs == null || isNaN(h.fireTimeMs)) continue;
        valid.push(h);
    }
    if (valid.length === 0) return _emptyResult(fs, dur);

    var sources = new Array(valid.length);
    for (var iv = 0; iv < valid.length; iv++) {
        var hv = valid[iv];
        var sx = hv.x, sy = hv.y, sz = hv.z != null ? hv.z : 0;
        if (srcMode === "collar" && hv.collar) { sx = hv.collar.x; sy = hv.collar.y; sz = hv.collar.z; }
        var w = (hv.weight != null && !isNaN(hv.weight) && hv.weight > 0) ? hv.weight : 1.0;
        sources[iv] = { id: hv.id, sx: sx, sy: sy, sz: sz, cx: hv.x, cy: hv.y, cz: hv.z != null ? hv.z : 0, weight: w, fireTimeMs: +hv.fireTimeMs };
    }

    var Lb;
    if (opts.LBearingRad == null || isNaN(opts.LBearingRad)) {
        var ccx = 0, ccy = 0;
        for (var ic = 0; ic < sources.length; ic++) { ccx += sources[ic].cx; ccy += sources[ic].cy; }
        ccx /= sources.length; ccy /= sources.length;
        Lb = bearingFromTo(m.x, m.y, ccx, ccy);
    } else {
        Lb = opts.LBearingRad;
    }
    var Ld = (opts.LDipRad != null && !isNaN(opts.LDipRad)) ? opts.LDipRad : 0;

    var tMinS = Infinity;
    for (var im0 = 0; im0 < sources.length; im0++) {
        var tms = sources[im0].fireTimeMs / 1000;
        if (tms < tMinS) tMinS = tms;
    }
    var tShift = tMinS - 0.1;
    var dt = 1 / fs;
    var N = Math.floor(dur * fs);
    var L = new Float64Array(N), T = new Float64Array(N), V = new Float64Array(N);

    var closest = { distance3D: Infinity, distancePlan: Infinity, id: null };
    var contributorCount = 0;
    var dominantHolePPV = 0;

    var blairScale = null;
    if (superpositionMode === "blairMinchinton") {
        var blairDecks = new Array(sources.length);
        for (var ib = 0; ib < sources.length; ib++) {
            var sb = sources[ib];
            blairDecks[ib] = { x: sb.cx, y: sb.cy, Q: sb.weight, fireMs: sb.fireTimeMs };
        }
        blairScale = computeBlairDamageScale(blairDecks, { eta: blairEta, meanSpacingM: blairSP });
    }

    for (var s = 0; s < sources.length; s++) {
        var src = sources[s];
        var dx = src.sx - m.x, dy = src.sy - m.y, dz = src.sz - m.z;
        var dPlan = Math.sqrt(dx * dx + dy * dy);
        var d3 = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d3 <= 0) continue;
        if (d3 < closest.distance3D) closest = { distance3D: d3, distancePlan: dPlan, id: src.id };

        var scaledD = d3 / Math.pow(Math.max(src.weight, 0.001), E);
        if (cutoffSD > 0 && scaledD < cutoffSD) scaledD = cutoffSD;
        var ppv = K * Math.pow(scaledD, -B);
        if (ppv > dominantHolePPV) dominantHolePPV = ppv;
        if (blairScale) {
            var scl = blairScale[s];
            if (scl != null && isFinite(scl) && scl >= 0) ppv = ppv * scl;
        }

        var brgFromMon = bearingFromTo(m.x, m.y, src.cx, src.cy);
        var dipFromMon = Math.atan2(dz, dPlan);
        var angDiffH = normaliseAngle(brgFromMon - Lb);
        var cosDip = Math.cos(dipFromMon), sinDip = Math.sin(dipFromMon);

        var LprojP = ppv * (cosDip * Math.cos(angDiffH) * Math.cos(Ld) + sinDip * Math.sin(Ld));
        var TprojP = ppv * cosDip * Math.sin(angDiffH);
        var VprojP = ppv * sinDip;

        var LprojS = 0, TprojS = 0, VprojS = 0;
        if (inclS) {
            var ppvS = ppv * spRatio;
            LprojS = ppvS * (-cosDip * Math.sin(angDiffH));
            TprojS = ppvS * (cosDip * Math.cos(angDiffH));
            VprojS = ppvS * cosDip;
        }

        var tFire = src.fireTimeMs / 1000 - tShift;
        var tP = tFire + d3 / cp;
        var tS = tFire + d3 / cs;
        if (gaoOn && sampledSeed && sampledSeed.kind === "twoterm") {
            tS = tP + gaoCorrectionFactor(d3) * (d3 / cs - d3 / cp);
        }

        if (sampledSeed) {
            addSampledWavelet(L, dt, tP, LprojP * sampledSeed.ampP, sampledSeed.pSamples, sampledSeed.causalBody);
            addSampledWavelet(T, dt, tP, TprojP * sampledSeed.ampP, sampledSeed.pSamples, sampledSeed.causalBody);
            addSampledWavelet(V, dt, tP, VprojP * sampledSeed.ampP, sampledSeed.pSamples, sampledSeed.causalBody);
            if (inclS) {
                addSampledWavelet(L, dt, tS, LprojS * sampledSeed.ampS, sampledSeed.sSamples, sampledSeed.causalBody);
                addSampledWavelet(T, dt, tS, TprojS * sampledSeed.ampS, sampledSeed.sSamples, sampledSeed.causalBody);
                addSampledWavelet(V, dt, tS, VprojS * sampledSeed.ampS, sampledSeed.sSamples, sampledSeed.causalBody);
            }
        } else {
            addWavelet(L, dt, tP, LprojP, fP, wType, wHalfP);
            addWavelet(T, dt, tP, TprojP, fP, wType, wHalfP);
            addWavelet(V, dt, tP, VprojP, fP, wType, wHalfP);
            if (inclS) {
                addWavelet(L, dt, tS, LprojS, fS, wType, wHalfS);
                addWavelet(T, dt, tS, TprojS, fS, wType, wHalfS);
                addWavelet(V, dt, tS, VprojS, fS, wType, wHalfS);
            }
        }

        if (inclLove && dPlan > 0.01) {
            var scaledDPlan = dPlan / Math.pow(Math.max(src.weight, 0.001), E);
            if (cutoffSD > 0 && scaledDPlan < cutoffSD) scaledDPlan = cutoffSD;
            var lovePPV = K * Math.pow(scaledDPlan, -B) * loveFactor;
            var brgTrans = brgFromMon + Math.PI / 2;
            var angDiffLove = normaliseAngle(brgTrans - Lb);
            var LprojLove = lovePPV * Math.cos(angDiffLove);
            var TprojLove = lovePPV * Math.sin(angDiffLove);
            var tLove = tFire + dPlan / vLove;
            if (sampledSeed) {
                addSampledWavelet(L, dt, tLove, LprojLove * sampledSeed.ampLove, sampledSeed.loveSamples, sampledSeed.causalLove);
                addSampledWavelet(T, dt, tLove, TprojLove * sampledSeed.ampLove, sampledSeed.loveSamples, sampledSeed.causalLove);
            } else {
                addWavelet(L, dt, tLove, LprojLove, fLove, wType, wHalfLove);
                addWavelet(T, dt, tLove, TprojLove, fLove, wType, wHalfLove);
            }
        }
        contributorCount++;
    }

    var emptyFFT = { mag: new Float64Array(0), df: 0, N: 0 };
    var fftL = skipFFT ? emptyFFT : fftMagnitude(L, fs);
    var fftT = skipFFT ? emptyFFT : fftMagnitude(T, fs);
    var fftV = skipFFT ? emptyFFT : fftMagnitude(V, fs);

    var Lp = peakAbs(L, fs), Tp = peakAbs(T, fs), Vp = peakAbs(V, fs);

    var pvsPeak = 0, pvsIdx = 0;
    for (var ip = 0; ip < L.length; ip++) {
        var magS = Math.sqrt(L[ip] * L[ip] + T[ip] * T[ip] + V[ip] * V[ip]);
        if (magS > pvsPeak) { pvsPeak = magS; pvsIdx = ip; }
    }
    var pvsTimeS = fs > 0 ? pvsIdx / fs : 0;

    var fLpk = skipFFT ? { freq: 0, mag: 0 } : peakInRange(fftL.mag, fftL.df, 1, 100);
    var fTpk = skipFFT ? { freq: 0, mag: 0 } : peakInRange(fftT.mag, fftT.df, 1, 100);
    var fVpk = skipFFT ? { freq: 0, mag: 0 } : peakInRange(fftV.mag, fftV.df, 1, 100);

    var polAng = polarisationAngle(L, T);
    var ccx2 = 0, ccy2 = 0;
    for (var ig = 0; ig < sources.length; ig++) { ccx2 += sources[ig].sx; ccy2 += sources[ig].sy; }
    ccx2 /= sources.length; ccy2 /= sources.length;
    var geomBrg = bearingFromTo(m.x, m.y, ccx2, ccy2);
    var apparentBrg = normaliseAngle(Lb + polAng);
    var rotDiff = normaliseAngle(apparentBrg - geomBrg);

    return {
        L: L, T: T, V: V, dt: dt, tShift: tShift, fs: fs,
        LBearingRad: Lb, LDipRad: Ld,
        fftL: fftL, fftT: fftT, fftV: fftV,
        stats: {
            LPeak: Lp.val, LPeakTimeS: Lp.t,
            TPeak: Tp.val, TPeakTimeS: Tp.t,
            VPeak: Vp.val, VPeakTimeS: Vp.t,
            peakVectorSum: pvsPeak, peakVectorSumTimeS: pvsTimeS,
            LFpeak: fLpk.freq, TFpeak: fTpk.freq, VFpeak: fVpk.freq,
            polarisationDeg: polAng * 180 / Math.PI,
            geometricBearingDeg: normaliseAngle(geomBrg) * 180 / Math.PI,
            apparentMinusGeometricDeg: rotDiff * 180 / Math.PI,
            contributorCount: contributorCount,
            closest: closest.id != null ? closest : null,
            seedKind: sampledSeed ? sampledSeed.kind : null,
            superposition: superpositionMode,
            dominantHolePPV: dominantHolePPV
        }
    };
}

/**
 * Peak vector sum from a forward-array synthesis at every monitor in a list.
 * Convenience wrapper for Voronoi / grid painting.
 *
 * @param {Array} sources  - see runForwardArraySynthesis opts.holes
 * @param {Array<{x,y,z}>} monitors
 * @param {Object} opts    - forwarded to runForwardArraySynthesis (skipFFT forced on)
 * @returns {Float64Array} PVS per monitor (mm/s)
 */
export function forwardArrayPVSAtPoints(sources, monitors, opts) {
    var out = new Float64Array(monitors.length);
    var o = Object.assign({}, opts || {}, { holes: sources, skipFFT: true });
    for (var i = 0; i < monitors.length; i++) {
        o.monitor = monitors[i];
        out[i] = runForwardArraySynthesis(o).stats.peakVectorSum;
    }
    return out;
}
