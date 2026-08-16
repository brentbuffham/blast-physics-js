/**
 * ReceptorPPV.js — Receptor-aware per-deck site-law evaluation at a monitor
 *
 * Author: Brent Buffham — blastingapps.com & kirra-design.com
 * License: MIT
 *
 * Evaluates every charged deck against a receiver point and reports:
 *   ppvMax          — peak single-deck PPV (site law, per deck Q and position)
 *   ppvRMS          — quadrature sum of decks arriving within ±coherenceMs of the peak deck
 *   ppvCoherent     — seed-wavelet convolution peak (when a seed is supplied)
 *   dominant deck / hole, contributors above contribPct, dominance strength
 *   outputMode value:
 *     "A" max PPV | "B" dominant hole | "C" compliance ratio (peak/target)
 *     "D" max allowable charge at the dominant deck's distance
 *
 * Distances are clamped so the scaled distance never drops below cutoffSD
 * (Yang & Scovira 2007, default 1.0 m/kg^0.5).
 *
 * Extracted from Kirra's DominantHoleHelper.js (evaluatePixel / binDecksByTime).
 */

import { decksFromEntries } from "../signal/SeedSynthesis.js";

export { decksFromEntries };

/**
 * Group decks into time bins of width binMs (Q-weighted super-charges).
 * binMs <= 0 → each deck is its own bin.
 *
 * @param {Array}  decks - [{ x, y, z, Q, fireMs, holeIndex?, holeID? }]
 * @param {number} binMs
 * @returns {Array<{ binIndex, tCentreMs, Q_total, cx, cy, cz, members }>}
 */
export function binDecksByTime(decks, binMs) {
    var noBinning = (binMs == null || binMs <= 0);
    var width = noBinning ? 1 : binMs;
    var groups = {};
    for (var i = 0; i < decks.length; i++) {
        var dk = decks[i];
        var k = noBinning ? ("d" + i) : Math.floor(dk.fireMs / width);
        if (!groups[k]) groups[k] = { binIndex: i, members: [], qSum: 0, xW: 0, yW: 0, zW: 0 };
        var g = groups[k];
        g.members.push(dk);
        g.qSum += dk.Q; g.xW += dk.x * dk.Q; g.yW += dk.y * dk.Q; g.zW += dk.z * dk.Q;
    }
    var bins = [];
    var keys = Object.keys(groups);
    for (var j = 0; j < keys.length; j++) {
        var gg = groups[keys[j]];
        if (gg.qSum <= 0) continue;
        bins.push({
            binIndex: gg.binIndex,
            tCentreMs: noBinning ? (gg.members[0] ? gg.members[0].fireMs : 0) : (gg.binIndex + 0.5) * width,
            Q_total: gg.qSum, cx: gg.xW / gg.qSum, cy: gg.yW / gg.qSum, cz: gg.zW / gg.qSum,
            members: gg.members
        });
    }
    bins.sort(function (a, b) { return a.binIndex - b.binIndex; });
    return bins;
}

function _rawFloorForCharge(Q, params) {
    var sdMin = params.cutoffSD != null ? params.cutoffSD : 1.0;
    var e = params.chargeExponent != null ? params.chargeExponent : 0.5;
    if (!(sdMin > 0) || !(Q > 0)) return 0;
    return sdMin * Math.pow(Q, e);
}

function _distanceToDeck(px, py, pz, deck, mode, params) {
    var dx = px - deck.x, dy = py - deck.y, raw;
    if (mode === "3D") {
        var dz = (pz != null ? pz : 0) - (deck.z != null ? deck.z : 0);
        raw = Math.sqrt(dx * dx + dy * dy + dz * dz);
    } else {
        raw = Math.sqrt(dx * dx + dy * dy);
    }
    var floor = _rawFloorForCharge(deck.Q, params);
    return raw < floor ? floor : raw;
}

/**
 * Site law for one source.
 * @param {number} d
 * @param {number} Q
 * @param {Object} params - { K, B, chargeExponent }
 * @returns {number}
 */
export function ppvFromCharge(d, Q, params) {
    var e = params.chargeExponent != null ? params.chargeExponent : 0.5;
    var K = params.K != null ? params.K : 1140;
    var B = params.B != null ? params.B : 1.6;
    return K * Math.pow(d / Math.pow(Q, e), -B);
}

function _waveformPeak(perDeck, params) {
    var seed = params.seedSamples;
    var sampleRateHz = params.seedSampleRateHz;
    if (!seed || !seed.length || !(sampleRateHz > 0)) return 0;
    var Vp = params.vpMps > 0 ? params.vpMps : 5000;
    var pS = params.seedPSamples, sS = params.seedSSamples;
    var Vs = params.vsMps > 0 ? params.vsMps : 0;
    var twoTerm = !!(pS && pS.length && sS && sS.length && Vs > 0);
    var ampP = params.ampP != null ? params.ampP : 1.0;
    var ampS = params.ampS != null ? params.ampS : 0.7;

    var n = perDeck.length;
    var tP = new Float64Array(n), tS = new Float64Array(n), amps = new Float32Array(n);
    var tMin = Infinity, tMax = -Infinity;
    for (var i = 0; i < n; i++) {
        var e = perDeck[i];
        var fire = e.deck.fireMs || 0;
        var tp = fire + (e.d / Vp) * 1000;
        var ts = twoTerm ? fire + (e.d / Vs) * 1000 : tp;
        if (!isFinite(tp) || !isFinite(ts)) continue;
        tP[i] = tp; tS[i] = ts; amps[i] = e.ppv;
        if (tp < tMin) tMin = tp;
        if (ts > tMax) tMax = ts;
    }
    if (!isFinite(tMin)) return 0;

    var seedN = twoTerm ? Math.max(pS.length, sS.length) : seed.length;
    var durationMs = (tMax - tMin) + (seedN / sampleRateHz) * 1000;
    var N = Math.max(2, Math.ceil(durationMs * sampleRateHz / 1000));
    if (N > 1 << 16) N = 1 << 16;
    var buf = new Float32Array(N);

    for (var k = 0; k < n; k++) {
        var amp = amps[k];
        if (!isFinite(amp) || amp === 0) continue;
        if (twoTerm) {
            _stamp(buf, N, pS, Math.round((tP[k] - tMin) * sampleRateHz / 1000), amp * ampP);
            _stamp(buf, N, sS, Math.round((tS[k] - tMin) * sampleRateHz / 1000), amp * ampS);
        } else {
            var centreIdx = Math.round((tP[k] - tMin) * sampleRateHz / 1000);
            _stamp(buf, N, seed, centreIdx - (seed.length >> 1), amp);
        }
    }
    var peak = 0;
    for (var m = 0; m < N; m++) { var a = buf[m]; if (a < 0) a = -a; if (a > peak) peak = a; }
    return peak;
}

function _stamp(buf, N, samples, startIdx, amp) {
    var sLo = 0, sHi = samples.length, bLo = startIdx, bHi = startIdx + samples.length;
    if (bLo < 0) { sLo = -bLo; bLo = 0; }
    if (bHi > N) { sHi -= (bHi - N); bHi = N; }
    for (var s = sLo, b = bLo; s < sHi; s++, b++) buf[b] += amp * samples[s];
}

/**
 * Evaluate a receiver point against a deck list.
 *
 * @param {{x,y,z}} point
 * @param {Array}   decks  - [{ x, y, z, Q, fireMs, holeIndex?, holeID?, deckIndex? }]
 * @param {Object}  [params]
 * @param {number}  [params.K=1140]
 * @param {number}  [params.B=1.6]
 * @param {number}  [params.chargeExponent=0.5]
 * @param {number}  [params.cutoffSD=1.0]      - m/kg^e
 * @param {string}  [params.distanceMode='2D'] - '2D' | '3D'
 * @param {string}  [params.outputMode='A']    - 'A' | 'B' | 'C' | 'D'
 * @param {number}  [params.targetPPV=10]      - mm/s (modes C, D)
 * @param {boolean} [params.superposeRMS=false]
 * @param {number}  [params.coherenceMs=8]
 * @param {boolean} [params.useArrivalTime=true] - gate by fireMs + D/Vp
 * @param {number}  [params.vpMps=5000]
 * @param {number}  [params.vsMps]
 * @param {number}  [params.contribPct=20]
 * @param {Float32Array} [params.seedSamples]      - enables coherent-seed peak (with superposeRMS + useArrivalTime)
 * @param {number}  [params.seedSampleRateHz]
 * @param {Float32Array} [params.seedPSamples]     - two-term P wavelet
 * @param {Float32Array} [params.seedSSamples]     - two-term S wavelet
 * @param {number}  [params.ampP=1] @param {number} [params.ampS=0.7]
 * @returns {{ value, ppvMax, ppvRMS, ppvCoherent, rmsDeckCount, dominantDeck, dominantHoleIndex,
 *             dominantHoleID, dominantDistance, contribs, dominanceStrength }}
 */
export function evaluateReceptor(point, decks, params) {
    var p = Object.assign({
        K: 1140, B: 1.6, chargeExponent: 0.5, cutoffSD: 1.0,
        distanceMode: "2D", outputMode: "A", targetPPV: 10,
        superposeRMS: false, coherenceMs: 8, useArrivalTime: true, vpMps: 5000, contribPct: 20
    }, params || {});
    var empty = { value: null, ppvMax: 0, ppvRMS: 0, ppvCoherent: null, rmsDeckCount: 0,
                  dominantDeck: null, dominantHoleIndex: -1, dominantHoleID: null, dominantDistance: 0,
                  contribs: [], dominanceStrength: 0 };
    if (!decks || !decks.length) return empty;

    var perDeck = [];
    var peakIdx = 0, peak = -Infinity;
    for (var i = 0; i < decks.length; i++) {
        var dk = decks[i];
        if (!dk || !(dk.Q > 0)) continue;
        var d = _distanceToDeck(point.x, point.y, point.z, dk, p.distanceMode, p);
        var ppv = ppvFromCharge(d, dk.Q, p);
        if (ppv > peak) { peak = ppv; peakIdx = perDeck.length; }
        perDeck.push({ deck: dk, ppv: ppv, d: d });
    }
    if (perDeck.length === 0) return empty;

    var dom = perDeck[peakIdx];

    var rms = peak, rmsDeckCount = 1;
    if (p.superposeRMS) {
        var Vp = p.vpMps > 0 ? p.vpMps : 5000;
        var tPeakFire = dom.deck.fireMs || 0;
        var tPeakRef = p.useArrivalTime !== false ? (tPeakFire + (dom.d / Vp) * 1000) : tPeakFire;
        var sumSq = 0; rmsDeckCount = 0;
        for (var r = 0; r < perDeck.length; r++) {
            var tFireR = perDeck[r].deck.fireMs || 0;
            var tr = p.useArrivalTime !== false ? (tFireR + (perDeck[r].d / Vp) * 1000) : tFireR;
            if (Math.abs(tr - tPeakRef) <= p.coherenceMs) { sumSq += perDeck[r].ppv * perDeck[r].ppv; rmsDeckCount++; }
        }
        rms = Math.sqrt(sumSq);
    }

    var contribs = [];
    var threshold = p.contribPct / 100;
    for (var c = 0; c < perDeck.length; c++) {
        if (c === peakIdx) continue;
        if (perDeck[c].ppv >= threshold * peak) {
            contribs.push({ deck: perDeck[c].deck, ppv: perDeck[c].ppv, d: perDeck[c].d, pct: peak > 0 ? (perDeck[c].ppv / peak) * 100 : 0 });
        }
    }
    contribs.sort(function (a, b) { return b.ppv - a.ppv; });
    var sumContribs = 0;
    for (var ci = 0; ci < contribs.length; ci++) sumContribs += contribs[ci].ppv;
    var dominanceStrength = peak > 0 ? peak / (peak + sumContribs) : 0;

    var ppvCoherent = null;
    if (p.superposeRMS && p.useArrivalTime !== false && p.seedSamples && p.seedSamples.length > 0 && p.seedSampleRateHz > 0) {
        ppvCoherent = _waveformPeak(perDeck, p);
    }

    var value;
    var target = p.targetPPV;
    switch (p.outputMode) {
        case "B": value = dom.deck.holeID != null ? dom.deck.holeID : dom.deck.holeIndex; break;
        case "C": value = target > 0 ? peak / target : null; break;
        case "D":
            if (!(target > 0)) { value = null; break; }
            var SDt = Math.pow(p.K / target, 1 / p.B);
            value = Math.pow(dom.d / SDt, 1 / p.chargeExponent);
            break;
        case "A":
        default:
            if (!p.superposeRMS) value = peak;
            else if (ppvCoherent != null) value = ppvCoherent;
            else value = rms;
    }

    return {
        value: value, ppvMax: peak, ppvRMS: rms, ppvCoherent: ppvCoherent, rmsDeckCount: rmsDeckCount,
        dominantDeck: dom.deck, dominantHoleIndex: dom.deck.holeIndex != null ? dom.deck.holeIndex : -1,
        dominantHoleID: dom.deck.holeID != null ? dom.deck.holeID : null, dominantDistance: dom.d,
        contribs: contribs, dominanceStrength: dominanceStrength
    };
}

/**
 * Evaluate a list of monitors and return one report row per monitor.
 * @param {Array<{ name?, x, y, z }>} monitors
 * @param {Array} decks
 * @param {Object} params
 * @returns {Array<Object>}
 */
export function evaluateMonitors(monitors, decks, params) {
    var rows = [];
    for (var i = 0; i < monitors.length; i++) {
        var m = monitors[i];
        var r = evaluateReceptor(m, decks, params);
        rows.push({
            monitor: m.name != null ? m.name : String(i),
            value: r.value, ppvMax: r.ppvMax, ppvRMS: r.ppvRMS, ppvCoherent: r.ppvCoherent,
            dominantHoleIndex: r.dominantHoleIndex, dominantHoleID: r.dominantHoleID,
            dominantDistance: r.dominantDistance, rmsDeckCount: r.rmsDeckCount,
            contribs: r.contribs.map(function (c) { return { holeIndex: c.deck.holeIndex, holeID: c.deck.holeID, pct: c.pct }; })
        });
    }
    return rows;
}
