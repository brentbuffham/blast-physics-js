/**
 * FrequencyAnalysis.js — Frequency-domain analysis of blast firing patterns
 *
 * Author: Brent Buffham — blastingapps.com & kirra-design.com
 * License: MIT
 *
 * Inputs are fire-time lists (ms) — hole-level or deck-level — with optional
 * charge-mass weights.
 *
 *   computeIDI(fireTimes, binMs)          → inter-detonation intervals + histogram
 *   computeSpectrum(fireTimes, opts)      → FFT of the impulse train
 *   dominantFrequencies(idi, k)           → top-K interval frequencies (1000/Δt)
 *   fireTimesFromDecks(deckEntries)       → { times, weights } from DeckEntry list
 *   frequencyBand(hz)                     → structural-resonance band label
 *
 * Extracted from Kirra's FrequencyAnalysisHelper.js.
 */

import { nextPow2, fftInPlace } from "./FFT.js";

/**
 * Structural resonance bands used to colour IDI stems and spectrum bins.
 * Δt bands: green < 25 ms (> 40 Hz), amber 25–67 ms (15–40 Hz),
 * warm amber 67–200 ms (5–15 Hz residential), red > 200 ms (< 5 Hz).
 */
export var FREQUENCY_BANDS = [
    { key: "low",         label: "Low freq (<5 Hz)",     minHz: 0,  maxHz: 5,        colour: "#e05a5a" },
    { key: "residential", label: "Residential (5–15 Hz)", minHz: 5,  maxHz: 15,       colour: "#e6a23c" },
    { key: "commercial",  label: "Commercial (15–40 Hz)", minHz: 15, maxHz: 40,       colour: "#f0c674" },
    { key: "safe",        label: "Safe zone (>40 Hz)",    minHz: 40, maxHz: Infinity, colour: "#5cb85c" }
];

/**
 * Band label for a frequency in Hz.
 * @param {number} hz
 * @returns {Object} band descriptor from FREQUENCY_BANDS
 */
export function frequencyBand(hz) {
    for (var i = 0; i < FREQUENCY_BANDS.length; i++) {
        var b = FREQUENCY_BANDS[i];
        if (hz >= b.minHz && hz < b.maxHz) return b;
    }
    return FREQUENCY_BANDS[FREQUENCY_BANDS.length - 1];
}

/**
 * Collect fire times (ms) and mass weights (kg) from DeckEntry objects.
 * Uses deck.timingMs (total detonation time = surface + downhole).
 *
 * @param {Array} deckEntries
 * @param {Object} [opts]
 * @param {boolean} [opts.chargedOnly=true] - skip decks with mass <= 0
 * @returns {{ times: number[], weights: number[] }} times sorted ascending, weights parallel
 */
export function fireTimesFromDecks(deckEntries, opts) {
    opts = opts || {};
    var chargedOnly = opts.chargedOnly !== false;
    var pairs = [];
    for (var i = 0; i < (deckEntries || []).length; i++) {
        var d = deckEntries[i];
        if (!d) continue;
        if (chargedOnly && !(d.mass > 0)) continue;
        var t = Number(d.timingMs);
        if (!isFinite(t)) continue;
        pairs.push([t, d.mass > 0 ? d.mass : 0]);
    }
    pairs.sort(function (a, b) { return a[0] - b[0]; });
    var times = new Array(pairs.length), weights = new Array(pairs.length);
    for (var k = 0; k < pairs.length; k++) { times[k] = pairs[k][0]; weights[k] = pairs[k][1]; }
    return { times: times, weights: weights };
}

/**
 * Inter-Detonation Interval analysis.
 *
 * @param {number[]} fireTimes - fire times in ms (any order)
 * @param {number}   [binMs=1] - histogram bin width (ms). Bins are CENTRED on
 *                               integer multiples of binMs so an exact N-ms
 *                               delay lands in bin N cleanly.
 * @returns {{ intervals: number[], fireTimesSorted: number[], intervalAtTime: number[],
 *             binCenters: number[], counts: number[], freqCenters: number[],
 *             maxInterval: number, medianMs: number, meanMs: number }}
 */
export function computeIDI(fireTimes, binMs) {
    binMs = (binMs && binMs > 0) ? binMs : 1;
    var result = {
        intervals: [], fireTimesSorted: [], intervalAtTime: [],
        binCenters: [], counts: [], freqCenters: [],
        maxInterval: 0, medianMs: 0, meanMs: 0
    };
    if (!Array.isArray(fireTimes) || fireTimes.length < 2) return result;

    var sorted = fireTimes.slice().sort(function (a, b) { return a - b; });
    result.fireTimesSorted = sorted;
    var intervalAtTime = new Array(sorted.length);
    intervalAtTime[0] = NaN;

    var intervals = [];
    var maxInt = 0, sum = 0;
    for (var i = 1; i < sorted.length; i++) {
        var dt = sorted[i] - sorted[i - 1];
        if (!isFinite(dt) || dt < 0) { intervalAtTime[i] = NaN; continue; }
        intervals.push(dt);
        intervalAtTime[i] = dt;
        sum += dt;
        if (dt > maxInt) maxInt = dt;
    }
    result.intervalAtTime = intervalAtTime;
    if (intervals.length === 0) return result;

    var numBins = Math.max(1, Math.round(maxInt / binMs) + 1);
    if (numBins > 10000) numBins = 10000;
    var counts = new Array(numBins).fill(0);
    for (var j = 0; j < intervals.length; j++) {
        var idx = Math.round(intervals[j] / binMs);
        if (idx >= 0 && idx < numBins) counts[idx]++;
    }
    var binCenters = new Array(numBins), freqCenters = new Array(numBins);
    for (var b = 0; b < numBins; b++) {
        var c = b * binMs;
        binCenters[b] = c;
        freqCenters[b] = c > 0 ? (1000 / c) : Infinity;
    }

    var sortedIntervals = intervals.slice().sort(function (a, b) { return a - b; });
    var n = sortedIntervals.length;
    var medianMs = (n % 2 === 1) ? sortedIntervals[(n - 1) >> 1]
                                 : 0.5 * (sortedIntervals[n / 2 - 1] + sortedIntervals[n / 2]);

    result.intervals = intervals;
    result.binCenters = binCenters;
    result.counts = counts;
    result.freqCenters = freqCenters;
    result.maxInterval = maxInt;
    result.medianMs = medianMs;
    result.meanMs = sum / intervals.length;
    return result;
}

/**
 * FFT of an impulse train built from fire times.
 *
 * @param {number[]} fireTimes - ms
 * @param {Object}   [opts]
 * @param {number}   [opts.sampleRateHz=1000]
 * @param {number[]} [opts.weights]  - impulse amplitudes parallel to fireTimes (e.g. kg)
 * @param {number}   [opts.tailMs=500] - zero-pad after last fire time
 * @param {number}   [opts.maxHz]     - clip returned spectrum (default Nyquist)
 * @param {number}   [opts.numPeaks=3]
 * @returns {{ freqs: number[], mag: number[], peaks: Array<{freq, mag}>, N: number, sampleRateHz: number }}
 */
export function computeSpectrum(fireTimes, opts) {
    opts = opts || {};
    var sampleRateHz = opts.sampleRateHz || 1000;
    var tailMs = opts.tailMs != null ? opts.tailMs : 500;
    var maxHz = opts.maxHz != null ? opts.maxHz : sampleRateHz / 2;
    var weights = Array.isArray(opts.weights) ? opts.weights : null;
    var numPeaks = opts.numPeaks != null ? opts.numPeaks : 3;

    var empty = { freqs: [], mag: [], peaks: [], N: 0, sampleRateHz: sampleRateHz };
    if (!Array.isArray(fireTimes) || fireTimes.length === 0) return empty;

    var tMin = fireTimes[0], tMax = fireTimes[0];
    for (var i = 1; i < fireTimes.length; i++) {
        if (fireTimes[i] < tMin) tMin = fireTimes[i];
        if (fireTimes[i] > tMax) tMax = fireTimes[i];
    }
    var durationMs = (tMax - tMin) + tailMs;
    if (durationMs <= 0) return empty;

    var N = nextPow2(Math.ceil(durationMs * sampleRateHz / 1000));
    if (N > 1 << 17) N = 1 << 17;

    var re = new Float64Array(N), im = new Float64Array(N);
    for (var k = 0; k < fireTimes.length; k++) {
        var idx = Math.round((fireTimes[k] - tMin) * sampleRateHz / 1000);
        if (idx < 0 || idx >= N) continue;
        var amp = 1;
        if (weights && weights[k] > 0) amp = weights[k];
        re[idx] += amp;
    }
    fftInPlace(re, im);

    var halfN = N >> 1;
    var freqs = new Array(halfN), mag = new Array(halfN);
    for (var f = 0; f < halfN; f++) {
        freqs[f] = f * sampleRateHz / N;
        mag[f] = Math.sqrt(re[f] * re[f] + im[f] * im[f]);
    }
    if (maxHz < sampleRateHz / 2) {
        var cutIdx = Math.min(halfN, Math.ceil(maxHz * N / sampleRateHz) + 1);
        freqs = freqs.slice(0, cutIdx);
        mag = mag.slice(0, cutIdx);
    }

    var peaks = [];
    for (var pi = 2; pi < mag.length - 1; pi++) {
        if (mag[pi] > mag[pi - 1] && mag[pi] > mag[pi + 1]) peaks.push({ freq: freqs[pi], mag: mag[pi] });
    }
    peaks.sort(function (a, b) { return b.mag - a.mag; });
    peaks = peaks.slice(0, numPeaks);

    return { freqs: freqs, mag: mag, peaks: peaks, N: N, sampleRateHz: sampleRateHz };
}

/**
 * Top-K dominant interval frequencies from an IDI result (f = 1000 / mode Δt).
 *
 * @param {Object} idi - return of computeIDI
 * @param {number} [k=5]
 * @returns {Array<{ intervalMs: number, freqHz: number, count: number }>}
 */
export function dominantFrequencies(idi, k) {
    if (!idi || !idi.counts || idi.counts.length === 0) return [];
    k = k || 5;
    var ranked = idi.counts.map(function (c, i) {
        return { intervalMs: idi.binCenters[i], freqHz: idi.freqCenters[i], count: c };
    });
    ranked = ranked.filter(function (r) { return r.count > 0 && r.intervalMs > 0; });
    ranked.sort(function (a, b) { return b.count - a.count; });
    return ranked.slice(0, k);
}

/**
 * Time-window (MIC bin) histogram of fire events — the "Time Window" chart.
 * Bins are [offset + k·W, offset + (k+1)·W); an edge bin [min, offset) captures
 * anything before the first full bin.
 *
 * @param {number[]} fireTimes - ms
 * @param {number}   windowMs  - bin width (default 8)
 * @param {Object}   [opts]
 * @param {number}   [opts.offsetMs=0]
 * @param {number[]} [opts.weights] - per-event weight (kg); default 1 (count)
 * @returns {{ binStartMs: number[], counts: number[], sums: number[], maxSum: number, windowMs: number }}
 */
export function timeWindowHistogram(fireTimes, windowMs, opts) {
    opts = opts || {};
    var W = windowMs > 0 ? windowMs : 8;
    var offset = opts.offsetMs || 0;
    var weights = Array.isArray(opts.weights) ? opts.weights : null;
    var out = { binStartMs: [], counts: [], sums: [], maxSum: 0, windowMs: W };
    if (!Array.isArray(fireTimes) || fireTimes.length === 0) return out;
    var tMax = -Infinity;
    for (var i = 0; i < fireTimes.length; i++) if (fireTimes[i] > tMax) tMax = fireTimes[i];
    var nBins = Math.floor((tMax - offset) / W) + 2;
    if (nBins > 100000) nBins = 100000;
    var counts = new Array(nBins).fill(0), sums = new Array(nBins).fill(0), starts = new Array(nBins);
    starts[0] = -Infinity;   // edge bin
    for (var b = 1; b < nBins; b++) starts[b] = offset + (b - 1) * W;
    for (var k = 0; k < fireTimes.length; k++) {
        var t = fireTimes[k];
        var idx = t < offset ? 0 : Math.floor((t - offset) / W) + 1;
        if (idx >= nBins) idx = nBins - 1;
        counts[idx]++;
        sums[idx] += weights ? (weights[k] || 0) : 1;
        if (sums[idx] > out.maxSum) out.maxSum = sums[idx];
    }
    out.binStartMs = starts; out.counts = counts; out.sums = sums;
    return out;
}
