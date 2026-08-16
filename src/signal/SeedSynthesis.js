/**
 * SeedSynthesis.js — Seed-waveform (signature-hole) superposition
 *
 * Author: Brent Buffham — blastingapps.com & kirra-design.com
 * License: MIT
 *
 * Builds a pseudo ground-vibration trace by superposing a chosen seed
 * wavelet (analytical or measured) at each deck's fire time, scaled by an
 * amplitude model. Classic linear-superposition method (Anderson 1989;
 * Hinzen 1988) with an optional Blair (2008) non-linear damage attenuation.
 *
 *   V(t) = Σ_n amp_n · s(t − t_n − D_n/V)
 *
 * Amplitude modes:
 *   "uniform" — amp = 1
 *   "sqrtQ"   — amp = √Q_n
 *   "siteLaw" — amp = K·(D_n/Q_n^e)^(−B) with Yang & Scovira near-field clamp
 *
 * Extracted from Kirra's SeedWaveformHelper.js.
 */

import { resampleMeasured } from "./Wavelets.js";

export var AMPLITUDE_MODES = ["uniform", "sqrtQ", "siteLaw"];

/**
 * 3D or 2D distance between two {x,y,z} points.
 * @param {{x,y,z}} a
 * @param {{x,y,z}} b
 * @param {string} mode - "2D" | "3D"
 * @returns {number}
 */
function _dist(a, b, mode) {
    var dx = (a.x || 0) - (b.x || 0);
    var dy = (a.y || 0) - (b.y || 0);
    if (mode === "3D") {
        var dz = (a.z || 0) - (b.z || 0);
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
    return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Site law PPV = K·(D/Q^e)^(−B), with D clamped so the scaled distance
 * never drops below cutoffSD (Yang & Scovira 2007: don't use below 1 m/kg^0.5).
 *
 * @param {number} D - distance (m)
 * @param {number} Q - charge (kg)
 * @param {Object} params - { K, B, chargeExponent, cutoffSD }
 * @returns {number} mm/s
 */
export function sitePPV(D, Q, params) {
    params = params || {};
    var K = params.K != null ? params.K : 1140;
    var B = params.B != null ? params.B : 1.6;
    var e = params.chargeExponent != null ? params.chargeExponent : 0.5;
    var sdMin = params.cutoffSD != null ? params.cutoffSD : 1.0;
    if (!(Q > 0)) return 0;
    var floor = sdMin * Math.pow(Q, e);
    var Dc = D < floor ? floor : D;
    return K * Math.pow(Dc / Math.pow(Q, e), -B);
}

/**
 * Convert DeckEntry objects to the deck list consumed by synthesizeTrace /
 * receptor evaluators: [{ x, y, z, Q, fireMs, holeIndex, deckIndex }].
 * Position is the deck midpoint; Q is deck mass; fireMs is deck.timingMs.
 *
 * @param {Array} deckEntries
 * @returns {Array}
 */
export function decksFromEntries(deckEntries) {
    var out = [];
    for (var i = 0; i < (deckEntries || []).length; i++) {
        var d = deckEntries[i];
        if (!d || !(d.mass > 0)) continue;
        out.push({
            x: (d.topX + d.baseX) * 0.5,
            y: (d.topY + d.baseY) * 0.5,
            z: (d.topZ + d.baseZ) * 0.5,
            Q: d.mass,
            fireMs: Number(d.timingMs) || 0,
            holeIndex: d.holeIndex,
            deckIndex: i
        });
    }
    return out;
}

/**
 * Per-deck Blair & Minchinton damage attenuation scale (Blair 2008 IJRMMS
 * Eq. 16 / 21):
 *
 *   D_damage_n = 1 + η · Σ_(j fired before n) (Q_j / Q̄) · (s_P / h_nj)³
 *   scale[n]   = 1 / D_damage_n
 *
 * Distances are plan-view (2D). Contributions where (s_P/h)³ < 1e-4
 * (≈ 20× spacing) are truncated for speed.
 *
 * @param {Array}  decks - [{ x, y, Q, fireMs }]
 * @param {Object} [opts]
 * @param {number} [opts.eta=2]          - damage constant
 * @param {number} [opts.meanSpacingM=4] - s_P
 * @returns {Array<number>|null} scale array aligned with decks (undefined for unusable decks)
 */
export function computeBlairDamageScale(decks, opts) {
    opts = opts || {};
    var eta = (opts.eta != null && opts.eta >= 0) ? opts.eta : 2;
    var sP = (opts.meanSpacingM != null && opts.meanSpacingM > 0) ? opts.meanSpacingM : 4;

    var idxByFire = [];
    var sumQ = 0, nQ = 0;
    for (var i = 0; i < decks.length; i++) {
        var dk = decks[i];
        if (!dk || dk.fireMs == null || !isFinite(dk.fireMs) || !(dk.Q > 0)) continue;
        idxByFire.push(i);
        sumQ += dk.Q; nQ++;
    }
    if (nQ === 0) return null;
    idxByFire.sort(function (a, b) {
        var ta = decks[a].fireMs, tb = decks[b].fireMs;
        if (ta !== tb) return ta - tb;
        return a - b;
    });
    var Qbar = sumQ / nQ;
    var TRUNC = 1e-4;
    var scale = new Array(decks.length);
    for (var k = 0; k < idxByFire.length; k++) {
        var iN = idxByFire[k];
        var dn = decks[iN];
        var sumDam = 0;
        for (var j = 0; j < k; j++) {
            var djk = decks[idxByFire[j]];
            var dx = djk.x - dn.x, dy = djk.y - dn.y;
            var h = Math.sqrt(dx * dx + dy * dy);
            if (h <= 0) continue;
            var ratio = sP / h;
            var ratio3 = ratio * ratio * ratio;
            if (ratio3 < TRUNC) continue;
            sumDam += (djk.Q / Qbar) * ratio3;
        }
        var Ddam = 1 + eta * sumDam;
        scale[iN] = (Ddam > 0) ? (1 / Ddam) : 1;
    }
    return scale;
}

/**
 * Synthesize a superposition trace from a deck list and a seed wavelet.
 *
 * @param {Object} opts
 * @param {Array}  opts.decks          - [{ x, y, z, Q, fireMs }] (see decksFromEntries)
 * @param {Object} opts.seed           - { samples, sampleRateHz, causal?, twoTerm?, pSamples?, sSamples?, ampP?, ampS? }
 * @param {number} [opts.sampleRateHz] - output rate (default seed.sampleRateHz)
 * @param {{x,y,z}|null} [opts.monitor] - receiver; null ⇒ no distance scaling
 * @param {Object} [opts.params]       - { amplitudeMode, distanceMode, K, B, chargeExponent, cutoffSD, vpMps, vsMps }
 * @param {number} [opts.tailMs]       - quiet tail after last fire (default seed duration / 2)
 * @param {string} [opts.superposition='linear'] - 'linear' | 'blairMinchinton'
 * @param {number} [opts.eta=2]
 * @param {number} [opts.meanSpacingM=4]
 * @param {number} [opts.defaultDistanceM=500] - virtual receiver distance for siteLaw with no monitor
 * @returns {{ t: Float64Array, v: Float32Array, tMinMs, tMaxMs, sampleRateHz, deckCount, superposition,
 *             usedDefaults, defaultDistanceM, defaultSiteLaw }}
 */
export function synthesizeTrace(opts) {
    opts = opts || {};
    var decks = Array.isArray(opts.decks) ? opts.decks : [];
    var seed = opts.seed;
    var emptyResult = { t: new Float64Array(0), v: new Float32Array(0), tMinMs: 0, tMaxMs: 0, sampleRateHz: 0, deckCount: 0 };
    if (!seed || !seed.samples || seed.samples.length === 0 || decks.length === 0) return emptyResult;

    var sampleRateHz = opts.sampleRateHz > 0 ? opts.sampleRateHz : seed.sampleRateHz;
    var seedSamples = (seed.sampleRateHz !== sampleRateHz)
        ? resampleMeasured(seed.samples, seed.sampleRateHz, sampleRateHz) : seed.samples;
    var seedDurationMs = (seedSamples.length / sampleRateHz) * 1000;

    var pSamples = null, sSamples = null, ampP = 1, ampS = 1;
    var isTwoTerm = !!seed.twoTerm && !!seed.pSamples && !!seed.sSamples;
    if (isTwoTerm) {
        pSamples = (seed.sampleRateHz !== sampleRateHz) ? resampleMeasured(seed.pSamples, seed.sampleRateHz, sampleRateHz) : seed.pSamples;
        sSamples = (seed.sampleRateHz !== sampleRateHz) ? resampleMeasured(seed.sSamples, seed.sampleRateHz, sampleRateHz) : seed.sSamples;
        ampP = seed.ampP != null ? seed.ampP : 1;
        ampS = seed.ampS != null ? seed.ampS : 1;
    }

    var params = opts.params || {};
    var ampMode = params.amplitudeMode || "uniform";
    var distMode = params.distanceMode || "2D";
    var monitor = opts.monitor || null;
    var tailMs = opts.tailMs != null ? opts.tailMs : seedDurationMs / 2;
    var canSplit = isTwoTerm && monitor != null;
    var VpMps = (params.vpMps > 0) ? params.vpMps : 5000;
    var VsMps = (params.vsMps > 0) ? params.vsMps : 2900;

    var tMin = Infinity, tMax = -Infinity;
    for (var i = 0; i < decks.length; i++) {
        var dk = decks[i];
        if (dk.fireMs == null || !isFinite(dk.fireMs)) continue;
        if (dk.fireMs < tMin) tMin = dk.fireMs;
        if (dk.fireMs > tMax) tMax = dk.fireMs;
    }
    if (!isFinite(tMin)) return Object.assign({}, emptyResult, { sampleRateHz: sampleRateHz });

    var isCausal = !!seed.causal;
    var halfSeedMs = seedDurationMs / 2;
    var leadMs = isCausal ? 0 : halfSeedMs;
    var extraTailMs = 0;
    if (canSplit) {
        var maxSDelayMs = 0;
        for (var mi = 0; mi < decks.length; mi++) {
            var dkm = decks[mi];
            if (!dkm || dkm.fireMs == null) continue;
            var Dm = _dist(monitor, dkm, distMode);
            var sDelay = VsMps > 0 ? (Dm / VsMps) * 1000 : 0;
            if (sDelay > maxSDelayMs) maxSDelayMs = sDelay;
        }
        extraTailMs = maxSDelayMs;
    }
    var windowStartMs = tMin - leadMs;
    var windowEndMs = tMax + seedDurationMs + tailMs + extraTailMs;
    var durationMs = windowEndMs - windowStartMs;
    var N = Math.max(2, Math.ceil(durationMs * sampleRateHz / 1000));
    if (N > 1 << 19) N = 1 << 19;

    var v = new Float32Array(N);
    var deckCount = 0;

    var superpositionMode = opts.superposition === "blairMinchinton" ? "blairMinchinton" : "linear";
    var damageScale = (superpositionMode === "blairMinchinton") ? computeBlairDamageScale(decks, opts) : null;

    var defaultDistanceM = (opts.defaultDistanceM != null && opts.defaultDistanceM > 0) ? opts.defaultDistanceM : 500;
    var siteLawParams = params;
    var usedDefaults = false;
    if (ampMode === "siteLaw" && !monitor) {
        usedDefaults = true;
        siteLawParams = {
            K: params.K != null ? params.K : 1140,
            B: params.B != null ? params.B : 1.6,
            chargeExponent: params.chargeExponent != null ? params.chargeExponent : 0.5,
            cutoffSD: params.cutoffSD
        };
    }

    for (var d = 0; d < decks.length; d++) {
        var deck = decks[d];
        if (deck.fireMs == null || !isFinite(deck.fireMs) || !(deck.Q > 0)) continue;

        var amp;
        var Ddeck = (monitor != null) ? _dist(monitor, deck, distMode) : defaultDistanceM;
        if (ampMode === "sqrtQ") amp = Math.sqrt(deck.Q);
        else if (ampMode === "siteLaw") amp = sitePPV(Ddeck, deck.Q, siteLawParams);
        else amp = 1;
        if (!isFinite(amp) || amp === 0) continue;
        if (damageScale && damageScale[d] != null && isFinite(damageScale[d])) amp *= damageScale[d];

        if (canSplit) {
            var tArrP = deck.fireMs + (Ddeck / VpMps) * 1000;
            var tArrS = deck.fireMs + (Ddeck / VsMps) * 1000;
            var pStart = Math.round((tArrP - windowStartMs) * sampleRateHz / 1000);
            var sStart = Math.round((tArrS - windowStartMs) * sampleRateHz / 1000);
            var ap = amp * ampP, as = amp * ampS;
            for (var sp = 0, ip = pStart; sp < pSamples.length; sp++, ip++) {
                if (ip < 0 || ip >= N) continue;
                v[ip] += ap * pSamples[sp];
            }
            for (var ss = 0, is = sStart; ss < sSamples.length; ss++, is++) {
                if (is < 0 || is >= N) continue;
                v[is] += as * sSamples[ss];
            }
            deckCount++;
            continue;
        }

        var centreMs = deck.fireMs - windowStartMs;
        var centreIdx = Math.round(centreMs * sampleRateHz / 1000);
        var startIdx = isCausal ? centreIdx : (centreIdx - (seedSamples.length >> 1));
        for (var s = 0; s < seedSamples.length; s++) {
            var idx = startIdx + s;
            if (idx < 0 || idx >= N) continue;
            v[idx] += amp * seedSamples[s];
        }
        deckCount++;
    }

    var t = new Float64Array(N);
    for (var k = 0; k < N; k++) t[k] = windowStartMs + (k / sampleRateHz) * 1000;

    return {
        t: t, v: v, tMinMs: windowStartMs, tMaxMs: windowEndMs,
        sampleRateHz: sampleRateHz, deckCount: deckCount,
        superposition: superpositionMode,
        usedDefaults: usedDefaults,
        defaultDistanceM: usedDefaults ? defaultDistanceM : null,
        defaultSiteLaw: usedDefaults ? { K: siteLawParams.K, B: siteLawParams.B, chargeExponent: siteLawParams.chargeExponent } : null
    };
}

/**
 * Peak absolute amplitude and its time.
 * @param {{ t: Float64Array, v: Float32Array }} trace
 * @returns {{ peak: number, tPeakMs: number }}
 */
export function tracePeak(trace) {
    if (!trace || !trace.v || trace.v.length === 0) return { peak: 0, tPeakMs: 0 };
    var peak = 0, peakIdx = 0;
    for (var i = 0; i < trace.v.length; i++) {
        var a = trace.v[i]; if (a < 0) a = -a;
        if (a > peak) { peak = a; peakIdx = i; }
    }
    return { peak: peak, tPeakMs: trace.t ? trace.t[peakIdx] : peakIdx };
}
