/**
 * SignatureDeconvolution.js — Spectral-division extraction of the single-hole signature
 *
 * Author: Brent Buffham — blastingapps.com & kirra-design.com
 * License: MIT
 *
 * Li & Silva-Castro (2017), "Spectral Division Deconvolution of Blast
 * Vibration Signals for Signature Estimation", ISEE 2017.
 *
 *   y(t) = Σ_i a_i · g(t − t_i) = d(t) ∗ g(t)      →     G(f) = Y(f) / D(f)
 *
 * y = production seismogram, g = unknown signature, d = impulse comb at the
 * per-deck fire times with amplitudes a_i (paper: 1; here optionally √Q).
 *
 * Regularisation: white Gaussian noise added to d(t) at SNR = snrDb (paper 60 dB)
 * so D(f) has no exact zeros; brick-wall low-pass on G(f) at cutoffHz (paper 30 Hz).
 * Reconstruction CC re-convolves g with d and compares against y.
 *
 * Extracted from Kirra's SignatureDeconvolution.js.
 */

import { fftInPlace, ifftInPlace, nextPow2 } from "./FFT.js";
import { mulberry32 } from "./Detune.js";

/**
 * Pearson cross-correlation over min(a.length, b.length, n) samples.
 * @param {ArrayLike<number>} a
 * @param {ArrayLike<number>} b
 * @param {number} [n]
 * @returns {number}
 */
export function pearsonCC(a, b, n) {
    var len = Math.min((n != null) ? n : a.length, b.length);
    if (len < 2) return 0;
    var meanA = 0, meanB = 0;
    for (var i = 0; i < len; i++) { meanA += a[i]; meanB += b[i]; }
    meanA /= len; meanB /= len;
    var num = 0, denA = 0, denB = 0;
    for (var j = 0; j < len; j++) {
        var da = a[j] - meanA, db = b[j] - meanB;
        num += da * db; denA += da * da; denB += db * db;
    }
    if (denA <= 0 || denB <= 0) return 0;
    return num / Math.sqrt(denA * denB);
}

function _gaussian(rng) {
    var u1, u2;
    do { u1 = rng(); } while (u1 < 1e-12);
    u2 = rng();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/**
 * Extract the single-hole signature from a production blast seismogram.
 *
 * @param {Object} opts
 * @param {Float32Array|number[]} opts.trace  - production seismogram samples
 * @param {number}   opts.sampleRateHz
 * @param {number[]} opts.fireTimesMs         - fire times in ms (t=0 = trace start)
 * @param {number[]} [opts.ampCoeffs]         - per-deck amplitude (√Q); default 1
 * @param {number}   [opts.cutoffHz=30]
 * @param {number}   [opts.snrDb=60]
 * @param {number}   [opts.outputDurationMs=1500]
 * @param {number}   [opts.tailMs=1000]
 * @param {number|null} [opts.prngSeed]       - reproducible noise
 * @returns {{ samples: Float32Array, sampleRateHz, ccReconstruction, fftSize, cutoffHz }}
 */
export function extractSignature(opts) {
    opts = opts || {};
    var trace = opts.trace;
    var SR = +opts.sampleRateHz;
    var fireTimesMs = Array.isArray(opts.fireTimesMs) ? opts.fireTimesMs : [];
    var ampCoeffs = Array.isArray(opts.ampCoeffs) ? opts.ampCoeffs : null;
    var cutoffHz = +opts.cutoffHz > 0 ? +opts.cutoffHz : 30;
    var snrDb = +opts.snrDb > 0 ? +opts.snrDb : 60;
    var outputDurationMs = +opts.outputDurationMs > 0 ? +opts.outputDurationMs : 1500;
    var tailMs = (opts.tailMs != null && +opts.tailMs >= 0) ? +opts.tailMs : 1000;
    var rng = opts.prngSeed != null ? mulberry32(+opts.prngSeed) : Math.random;

    if (!trace || !trace.length) throw new Error("extractSignature: trace is empty");
    if (!(SR > 0)) throw new Error("extractSignature: sampleRateHz must be > 0");
    if (!fireTimesMs.length) throw new Error("extractSignature: at least one fire time required");

    var nyq = SR / 2;
    if (cutoffHz > nyq) cutoffHz = nyq;

    var traceN = trace.length;
    var lastFireMs = -Infinity;
    for (var i = 0; i < fireTimesMs.length; i++) if (fireTimesMs[i] > lastFireMs) lastFireMs = fireTimesMs[i];
    var lastFireSamp = Math.ceil(Math.max(0, lastFireMs) * SR / 1000);
    var tailSamp = Math.ceil(tailMs * SR / 1000);
    var N = nextPow2(Math.max(traceN, lastFireSamp + tailSamp));

    var y_re = new Float64Array(N), y_im = new Float64Array(N);
    for (var k = 0; k < traceN; k++) y_re[k] = trace[k];

    var d_re = new Float64Array(N), d_im = new Float64Array(N);
    var combPeak = 0;
    for (var f = 0; f < fireTimesMs.length; f++) {
        var ms = fireTimesMs[f];
        if (!isFinite(ms)) continue;
        var idx = Math.round(ms * SR / 1000);
        if (idx < 0 || idx >= N) continue;
        var amp = (ampCoeffs && ampCoeffs[f] > 0) ? ampCoeffs[f] : 1.0;
        d_re[idx] += amp;
        var v = Math.abs(d_re[idx]);
        if (v > combPeak) combPeak = v;
    }
    if (!(combPeak > 0)) throw new Error("extractSignature: no fire times fell inside the trace window");

    var noiseRMS = combPeak / Math.pow(10, snrDb / 20);
    if (noiseRMS > 0) for (var n = 0; n < N; n++) d_re[n] += noiseRMS * _gaussian(rng);

    fftInPlace(y_re, y_im);
    fftInPlace(d_re, d_im);

    var df = SR / N, halfN = N >> 1;
    var g_re = new Float64Array(N), g_im = new Float64Array(N);
    for (var b = 0; b < N; b++) {
        var binFreq = (b <= halfN) ? b * df : (N - b) * df;
        if (binFreq > cutoffHz) continue;
        var yr = y_re[b], yi = y_im[b], dr = d_re[b], di = d_im[b];
        var denom = dr * dr + di * di;
        if (denom < 1e-30) continue;
        g_re[b] = (yr * dr + yi * di) / denom;
        g_im[b] = (yi * dr - yr * di) / denom;
    }

    var yh_re = new Float64Array(N), yh_im = new Float64Array(N);
    for (var b2 = 0; b2 < N; b2++) {
        yh_re[b2] = g_re[b2] * d_re[b2] - g_im[b2] * d_im[b2];
        yh_im[b2] = g_re[b2] * d_im[b2] + g_im[b2] * d_re[b2];
    }
    ifftInPlace(yh_re, yh_im);
    ifftInPlace(g_re, g_im);

    var outN = Math.min(N, Math.round(outputDurationMs * SR / 1000));
    var samples = new Float32Array(outN);
    for (var s = 0; s < outN; s++) samples[s] = g_re[s];

    return {
        samples: samples,
        sampleRateHz: SR,
        ccReconstruction: pearsonCC(trace, yh_re, traceN),
        fftSize: N,
        cutoffHz: cutoffHz
    };
}
