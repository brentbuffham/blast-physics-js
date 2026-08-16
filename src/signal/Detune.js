/**
 * Detune.js — Timing dither ("detune") and event-rate constraint for firing patterns
 *
 * Author: Brent Buffham — blastingapps.com & kirra-design.com
 * License: MIT
 *
 * A small random offset applied to detonator timings spreads frequency-domain
 * energy and reduces tonal peaks that couple into structural resonance.
 * Pure functions on fire-time arrays — persisting the result to a design is
 * the caller's job.
 *
 *   mulberry32(seed)               → deterministic PRNG
 *   dither(rng, magnitudeMs, mode) → single Δt sample
 *   detuneFireTimes(times, opts)   → new times + per-event Δt + summary
 *   snapToPalette(times, palette)  → nonel-style snap to product delays
 *   constrainEventRate(times, opts)→ push events out of over-full rolling windows
 *
 * Extracted from Kirra's DetuneHelper.js (pure parts only).
 */

export var DETUNE_MODES = ["uniform", "triangular", "positive"];

/**
 * Mulberry32 — small, fast, deterministic PRNG.
 * @param {number} seed
 * @returns {() => number} uniform [0,1)
 */
export function mulberry32(seed) {
    var t = seed >>> 0;
    return function () {
        t = (t + 0x6D2B79F5) >>> 0;
        var x = t;
        x = Math.imul(x ^ (x >>> 15), x | 1);
        x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
        return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Draw one dither sample.
 * @param {() => number} rng
 * @param {number} mag  - magnitude N (ms)
 * @param {string} mode - 'uniform' [−N,+N] | 'triangular' (sum of two halves) | 'positive' [0,+N]
 * @returns {number} Δt in ms
 */
export function dither(rng, mag, mode) {
    if (mode === "triangular") return ((rng() + rng()) - 1) * mag;
    if (mode === "positive") return rng() * mag;
    return (rng() * 2 - 1) * mag;
}

/**
 * Round a millisecond value to `decimals` places (0 = integer ms).
 * @param {number} ms
 * @param {number} [decimals=0]
 * @returns {number}
 */
export function roundTimingMs(ms, decimals) {
    var d = decimals != null ? Math.max(0, Math.min(2, decimals | 0)) : 0;
    var f = Math.pow(10, d);
    return Math.round(ms * f) / f;
}

/**
 * Apply a reproducible dither to an array of fire times.
 *
 * @param {number[]} fireTimesMs
 * @param {Object}   [opts]
 * @param {number}   [opts.magnitudeMs=2]
 * @param {string}   [opts.mode='uniform']
 * @param {number}   [opts.seed=42]
 * @param {number}   [opts.decimals=0]
 * @param {number}   [opts.minMs]  - clamp results at/above this (e.g. 0)
 * @returns {{ times: number[], deltas: number[], summary: { count, meanAbsMs, maxAbsMs, magnitudeMs, mode, seed } }}
 */
export function detuneFireTimes(fireTimesMs, opts) {
    opts = opts || {};
    var mag = opts.magnitudeMs != null ? +opts.magnitudeMs : 2;
    var mode = DETUNE_MODES.indexOf(opts.mode) >= 0 ? opts.mode : "uniform";
    var seed = opts.seed != null ? +opts.seed : 42;
    var rng = mulberry32(seed);
    var times = new Array(fireTimesMs.length), deltas = new Array(fireTimesMs.length);
    var sumAbs = 0, maxAbs = 0;
    for (var i = 0; i < fireTimesMs.length; i++) {
        var d = dither(rng, mag, mode);
        var t = roundTimingMs(fireTimesMs[i] + d, opts.decimals);
        if (opts.minMs != null && t < opts.minMs) t = opts.minMs;
        var real = t - fireTimesMs[i];
        times[i] = t; deltas[i] = real;
        var a = Math.abs(real);
        sumAbs += a; if (a > maxAbs) maxAbs = a;
    }
    return {
        times: times, deltas: deltas,
        summary: { count: times.length, meanAbsMs: times.length ? sumAbs / times.length : 0, maxAbsMs: maxAbs, magnitudeMs: mag, mode: mode, seed: seed }
    };
}

/**
 * Snap inter-event delays to a discrete palette (nonel surface-connector
 * products, e.g. [9, 17, 25, 42, 67, 109]). Each delay moves to the nearest
 * palette value no more than `maxStep` palette positions away.
 *
 * @param {number[]} delaysMs - tie delays (not absolute times)
 * @param {number[]} paletteMs
 * @param {Object} [opts]
 * @param {number} [opts.maxStep=1]
 * @param {number} [opts.seed=42] - when jitter=true, randomly pick ±1 neighbour
 * @param {boolean} [opts.jitter=false]
 * @returns {number[]}
 */
export function snapToPalette(delaysMs, paletteMs, opts) {
    opts = opts || {};
    var pal = (paletteMs || []).slice().sort(function (a, b) { return a - b; });
    if (!pal.length) return delaysMs.slice();
    var maxStep = opts.maxStep != null ? Math.max(0, opts.maxStep | 0) : 1;
    var rng = mulberry32(opts.seed != null ? +opts.seed : 42);
    var out = new Array(delaysMs.length);
    for (var i = 0; i < delaysMs.length; i++) {
        var d = delaysMs[i];
        var best = 0, bestErr = Infinity;
        for (var p = 0; p < pal.length; p++) {
            var err = Math.abs(pal[p] - d);
            if (err < bestErr) { bestErr = err; best = p; }
        }
        var idx = best;
        if (opts.jitter && maxStep > 0) {
            var step = Math.round((rng() * 2 - 1) * maxStep);
            idx = Math.max(0, Math.min(pal.length - 1, best + step));
        }
        out[i] = pal[idx];
    }
    return out;
}

/**
 * Count events inside a rolling window at each event.
 * @param {number[]} sortedTimes - ascending ms
 * @param {number} windowMs
 * @returns {Int32Array} count of events in [t_i − W, t_i]
 */
export function rollingWindowCounts(sortedTimes, windowMs) {
    var n = sortedTimes.length;
    var out = new Int32Array(n);
    var lo = 0;
    for (var i = 0; i < n; i++) {
        while (lo < i && sortedTimes[i] - sortedTimes[lo] > windowMs) lo++;
        out[i] = i - lo + 1;
    }
    return out;
}

/**
 * Event-rate constraint: greedily delay events so no rolling window of width
 * windowMs contains more than maxEvents, moving each event by at most maxMoveMs.
 *
 * @param {number[]} fireTimesMs
 * @param {Object} opts
 * @param {number} opts.windowMs
 * @param {number} opts.maxEvents
 * @param {number} [opts.maxMoveMs=Infinity]
 * @param {number} [opts.decimals=0]
 * @returns {{ times: number[], moved: number, violationsBefore: number, violationsAfter: number }}
 */
export function constrainEventRate(fireTimesMs, opts) {
    opts = opts || {};
    var W = opts.windowMs > 0 ? opts.windowMs : 8;
    var maxN = opts.maxEvents > 0 ? opts.maxEvents : 1;
    var maxMove = opts.maxMoveMs != null ? opts.maxMoveMs : Infinity;

    var order = fireTimesMs.map(function (t, i) { return { t: t, i: i }; }).sort(function (a, b) { return a.t - b.t; });
    var before = rollingWindowCounts(order.map(function (o) { return o.t; }), W);
    var violationsBefore = 0;
    for (var v = 0; v < before.length; v++) if (before[v] > maxN) violationsBefore++;

    var placed = [];
    var moved = 0;
    for (var k = 0; k < order.length; k++) {
        var t = order[k].t;
        var orig = t;
        // Ensure at most maxN events in (t − W, t]: if the (maxN)th most recent
        // placed event is within W, push t just past its window.
        while (placed.length >= maxN) {
            var ref = placed[placed.length - maxN];
            if (t - ref <= W) {
                var cand = roundTimingMs(ref + W + Math.pow(10, -(opts.decimals || 0)), opts.decimals);
                if (cand - orig > maxMove) break;
                t = cand;
            } else break;
        }
        if (t !== orig) moved++;
        placed.push(t);
    }
    var times = new Array(fireTimesMs.length);
    for (var m = 0; m < order.length; m++) times[order[m].i] = placed[m];
    var after = rollingWindowCounts(placed, W);
    var violationsAfter = 0;
    for (var a = 0; a < after.length; a++) if (after[a] > maxN) violationsAfter++;
    return { times: times, moved: moved, violationsBefore: violationsBefore, violationsAfter: violationsAfter };
}
