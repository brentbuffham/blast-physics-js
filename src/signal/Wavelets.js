/**
 * Wavelets.js — Seed wavelet generators for blast vibration synthesis
 *
 * Author: Brent Buffham — blastingapps.com & kirra-design.com
 * License: MIT
 *
 * Analytical source wavelets used by the seed-superposition (signature-hole)
 * method, the forward-array synthesiser and the ripple-tank wave field:
 *
 *   Ricker          r(t) = (1 − 2π²f²t²)·exp(−π²f²t²)          acausal, symmetric
 *   Damped sinusoid s(t) = sin(2πft)·exp(−ξωt)                  causal
 *   Berlage         b(t) = tⁿ·exp(−αt)·cos(2πft + φ)            causal (Aldridge 1990)
 *   Gaussian bell   g(t) = exp(−½(2πft / WIDTH)²)               causal single bump
 *   Two-term P+S    two Berlage/damped wavelets at fP, fS       causal (Anderson 1989; Hinzen 1988)
 *
 * Two API layers:
 *   evalXxx(t, ...)   → instantaneous wavelet value (used per-sample)
 *   generateXxx(opts) → sampled Float32Array seed { samples, sampleRateHz, causal, ... }
 *
 * Extracted from Kirra's SeedWaveformHelper.js, ForwardArraySynthesis.js and
 * RippleTankModel.js (GLSL wavelet functions).
 */

export var SEED_SOURCES = ["ricker", "damped", "berlage", "gaussian", "twoterm", "measured"];

// ────────────────────────────────────────────────────────
// Instantaneous evaluators
// ────────────────────────────────────────────────────────

/**
 * Ricker (Mexican hat) wavelet — symmetric about t = 0.
 * @param {number} t - seconds from wavelet centre
 * @param {number} f - dominant frequency (Hz)
 * @returns {number}
 */
export function evalRicker(t, f) {
    var a = Math.PI * f * t;
    var a2 = a * a;
    return (1 - 2 * a2) * Math.exp(-a2);
}

/**
 * Causal Ricker — zero for τ ≤ 0 (single compression peak + rarefaction dip
 * after arrival). Width ≈ 1.5/f seconds.
 * @param {number} tau - seconds since arrival
 * @param {number} f   - dominant frequency (Hz)
 * @returns {number}
 */
export function evalRickerCausal(tau, f) {
    if (tau <= 0) return 0;
    var pif = Math.PI * f;
    var a2 = pif * pif * tau * tau;
    return (1 - 2 * a2) * Math.exp(-a2);
}

/**
 * Causal Gaussian bell — single smooth positive bump. WIDTH controls how
 * many periods the bell spans (3.0 ≈ 14 ms FWHM at 100 Hz).
 * @param {number} tau
 * @param {number} f
 * @param {number} [width=3.0]
 * @returns {number}
 */
export function evalGaussianBell(tau, f, width) {
    if (tau <= 0) return 0;
    var W = width > 0 ? width : 3.0;
    var x = (2 * Math.PI * f * tau) / W;
    return Math.exp(-0.5 * x * x);
}

/**
 * Causal damped sinusoid: sin(2πfτ)·exp(−α·τ) for τ > 0.
 * @param {number} tau   - seconds since arrival
 * @param {number} f     - carrier frequency (Hz)
 * @param {number} alpha - decay rate (1/s); use ξ·2πf for damping ratio ξ
 * @returns {number}
 */
export function evalDamped(tau, f, alpha) {
    if (tau <= 0) return 0;
    return Math.sin(2 * Math.PI * f * tau) * Math.exp(-alpha * tau);
}

/**
 * Berlage wavelet τⁿ·exp(−ατ)·cos(2πfτ + φ), normalised so the envelope
 * peak (t* = n/α) is 1.
 * @param {number} tau
 * @param {number} f
 * @param {number} alpha
 * @param {number} [n=3]
 * @param {number} [phaseRad=0]
 * @returns {number}
 */
export function evalBerlage(tau, f, alpha, n, phaseRad) {
    if (tau <= 0) return 0;
    var nn = (n != null && n > 0) ? n : 3;
    var a = alpha > 1e-6 ? alpha : 1e-6;
    var tPeak = nn / a;
    var peakEnv = Math.pow(tPeak, nn) * Math.exp(-nn);
    var phi = phaseRad || 0;
    return (Math.pow(tau, nn) * Math.exp(-a * tau) * Math.cos(2 * Math.PI * f * tau + phi)) / Math.max(peakEnv, 1e-12);
}

/**
 * Gaussian-windowed cosine (σ = 1.5/f), symmetric about t = 0.
 * @param {number} t
 * @param {number} f
 * @returns {number}
 */
export function evalGaussSin(t, f) {
    var sigma = 1.5 / f;
    return Math.cos(2 * Math.PI * f * t) * Math.exp(-(t * t) / (2 * sigma * sigma));
}

/**
 * Minimum-phase-ish causal wavelet: sin(ωt)·exp(−πft) for t ≥ 0.
 * @param {number} t
 * @param {number} f
 * @returns {number}
 */
export function evalMinPhase(t, f) {
    if (t < 0) return 0;
    var omega = 2 * Math.PI * f;
    return Math.sin(omega * t) * Math.exp(-Math.PI * f * t);
}

/**
 * Dispatcher for the analytical (per-sample) wavelet families.
 *
 * @param {number} t     - seconds relative to the wavelet anchor
 * @param {number} f     - frequency (Hz)
 * @param {string} type  - 'ricker' | 'gauss-sin' | 'minphase' | 'ricker-causal' | 'gaussian' | 'damped' | 'berlage'
 * @param {number} [alpha] - decay rate for damped/berlage (default 3f/3 crests)
 * @returns {number}
 */
export function evalWavelet(t, f, type, alpha) {
    var a = (alpha != null && alpha > 0) ? alpha : f;   // 3·f/numCrests with numCrests=3
    switch (type) {
        case "gauss-sin":      return evalGaussSin(t, f);
        case "minphase":       return evalMinPhase(t, f);
        case "ricker-causal":  return evalRickerCausal(t, f);
        case "gaussian":       return evalGaussianBell(t, f);
        case "damped":         return evalDamped(t, f, a);
        case "berlage":        return evalBerlage(t, f, a);
        case "ricker":
        default:               return evalRicker(t, f);
    }
}

// ────────────────────────────────────────────────────────
// Sampled seed generators
// ────────────────────────────────────────────────────────

/**
 * Sampled Ricker wavelet centred at N/2 (acausal). Optional post-multiplied
 * damping envelope exp(−ξωt) for t > 0.
 *
 * @param {Object} [opts]
 * @param {number} [opts.fDomHz=30]
 * @param {number} [opts.durationMs=200]
 * @param {number} [opts.sampleRateHz=1000]
 * @param {number} [opts.damping=0]  - ξ, 0..1
 * @returns {{ samples: Float32Array, durationMs, sampleRateHz, source: 'ricker', causal: false }}
 */
export function generateRicker(opts) {
    opts = opts || {};
    var fDom = opts.fDomHz > 0 ? opts.fDomHz : 30;
    var durationMs = opts.durationMs > 0 ? opts.durationMs : 200;
    var sampleRateHz = opts.sampleRateHz > 0 ? opts.sampleRateHz : 1000;
    var damping = (opts.damping != null && opts.damping >= 0) ? opts.damping : 0;

    var N = Math.max(2, Math.round(durationMs * sampleRateHz / 1000));
    var samples = new Float32Array(N);
    var centreIdx = N / 2;
    var piF2 = Math.PI * fDom * Math.PI * fDom;
    var omega = 2 * Math.PI * fDom;
    for (var i = 0; i < N; i++) {
        var tSec = (i - centreIdx) / sampleRateHz;
        var t2 = tSec * tSec;
        var v = (1 - 2 * piF2 * t2) * Math.exp(-piF2 * t2);
        if (damping > 0 && tSec > 0) v *= Math.exp(-damping * omega * tSec);
        samples[i] = v;
    }
    return { samples: samples, durationMs: durationMs, sampleRateHz: sampleRateHz, source: "ricker", causal: false };
}

/**
 * Sampled causal damped sinusoid, peak-normalised to 1.
 *
 * @param {Object} [opts]
 * @param {number} [opts.fDomHz=30]
 * @param {number} [opts.durationMs=200]
 * @param {number} [opts.sampleRateHz=1000]
 * @param {number} [opts.damping=0.10] - ξ ∈ [0,1]
 * @returns {{ samples, durationMs, sampleRateHz, source: 'damped', causal: true }}
 */
export function generateDampedSinusoid(opts) {
    opts = opts || {};
    var fDom = opts.fDomHz > 0 ? opts.fDomHz : 30;
    var durationMs = opts.durationMs > 0 ? opts.durationMs : 200;
    var sampleRateHz = opts.sampleRateHz > 0 ? opts.sampleRateHz : 1000;
    var damping = (opts.damping != null && opts.damping >= 0) ? opts.damping : 0.10;

    var N = Math.max(2, Math.round(durationMs * sampleRateHz / 1000));
    var samples = new Float32Array(N);
    var omega = 2 * Math.PI * fDom;
    var decay = damping * omega;
    var peak = 0;
    for (var i = 0; i < N; i++) {
        var tSec = i / sampleRateHz;
        var v = Math.sin(omega * tSec) * Math.exp(-decay * tSec);
        samples[i] = v;
        var av = v < 0 ? -v : v;
        if (av > peak) peak = av;
    }
    if (peak > 0) for (var j = 0; j < N; j++) samples[j] /= peak;
    return { samples: samples, durationMs: durationMs, sampleRateHz: sampleRateHz, source: "damped", causal: true };
}

/**
 * Sampled causal Berlage wavelet, peak-normalised to 1.
 *
 * @param {Object} [opts]
 * @param {number} [opts.fDomHz=30]
 * @param {number} [opts.durationMs=200]
 * @param {number} [opts.sampleRateHz=1000]
 * @param {number} [opts.damping=0.10]  - ξ → α = ξ·ω (never fully flat)
 * @param {number} [opts.n=2]           - shape exponent
 * @param {number} [opts.phaseRad=0]
 * @returns {{ samples, durationMs, sampleRateHz, source: 'berlage', causal: true }}
 */
export function generateBerlage(opts) {
    opts = opts || {};
    var fDom = opts.fDomHz > 0 ? opts.fDomHz : 30;
    var durationMs = opts.durationMs > 0 ? opts.durationMs : 200;
    var sampleRateHz = opts.sampleRateHz > 0 ? opts.sampleRateHz : 1000;
    var damping = (opts.damping != null && opts.damping >= 0) ? opts.damping : 0.10;
    var n = opts.n != null ? opts.n : 2;
    var phi = opts.phaseRad != null ? opts.phaseRad : 0;

    var N = Math.max(2, Math.round(durationMs * sampleRateHz / 1000));
    var samples = new Float32Array(N);
    var omega = 2 * Math.PI * fDom;
    var alpha = damping > 0 ? damping * omega : omega * 0.08;
    var peak = 0;
    for (var i = 0; i < N; i++) {
        var tSec = i / sampleRateHz;
        var v = Math.pow(tSec, n) * Math.exp(-alpha * tSec) * Math.cos(omega * tSec + phi);
        samples[i] = v;
        var av = v < 0 ? -v : v;
        if (av > peak) peak = av;
    }
    if (peak > 0) for (var j = 0; j < N; j++) samples[j] /= peak;
    return { samples: samples, durationMs: durationMs, sampleRateHz: sampleRateHz, source: "berlage", causal: true };
}

/**
 * Sampled causal Gaussian bell (single positive bump), peak = 1.
 *
 * @param {Object} [opts]
 * @param {number} [opts.fDomHz=30]
 * @param {number} [opts.durationMs=200]
 * @param {number} [opts.sampleRateHz=1000]
 * @param {number} [opts.width=3.0]
 * @returns {{ samples, durationMs, sampleRateHz, source: 'gaussian', causal: true }}
 */
export function generateGaussianBell(opts) {
    opts = opts || {};
    var fDom = opts.fDomHz > 0 ? opts.fDomHz : 30;
    var durationMs = opts.durationMs > 0 ? opts.durationMs : 200;
    var sampleRateHz = opts.sampleRateHz > 0 ? opts.sampleRateHz : 1000;
    var N = Math.max(2, Math.round(durationMs * sampleRateHz / 1000));
    var samples = new Float32Array(N);
    for (var i = 0; i < N; i++) samples[i] = evalGaussianBell(i / sampleRateHz + 1e-9, fDom, opts.width);
    return { samples: samples, durationMs: durationMs, sampleRateHz: sampleRateHz, source: "gaussian", causal: true };
}

/**
 * Two-term (P + S) seismic source — two causal wavelets with distinct
 * frequency, damping and amplitude. Returns both components plus a combined
 * preview array (P + S stacked at the same origin).
 *
 * @param {Object} [opts]
 * @param {number} [opts.fP_Hz=30]
 * @param {number} [opts.xiP=0.10]
 * @param {number} [opts.ampP=1.0]
 * @param {number} [opts.fS_Hz=18]
 * @param {number} [opts.xiS=0.15]
 * @param {number} [opts.ampS=0.7]
 * @param {number} [opts.durationMs=300]
 * @param {number} [opts.sampleRateHz=1000]
 * @param {string} [opts.shape='berlage'] - 'berlage' | 'damped'
 * @returns {{ samples, pSamples, sSamples, ampP, ampS, fP_Hz, fS_Hz, xiP, xiS, shape,
 *             durationMs, sampleRateHz, source: 'twoterm', causal: true, twoTerm: true }}
 */
export function generateTwoTerm(opts) {
    opts = opts || {};
    var sampleRateHz = opts.sampleRateHz > 0 ? opts.sampleRateHz : 1000;
    var durationMs = opts.durationMs > 0 ? opts.durationMs : 300;
    var fP = opts.fP_Hz > 0 ? opts.fP_Hz : 30;
    var fS = opts.fS_Hz > 0 ? opts.fS_Hz : 18;
    var xiP = (opts.xiP != null && opts.xiP >= 0) ? opts.xiP : 0.10;
    var xiS = (opts.xiS != null && opts.xiS >= 0) ? opts.xiS : 0.15;
    var ampP = opts.ampP != null ? opts.ampP : 1.0;
    var ampS = opts.ampS != null ? opts.ampS : 0.7;
    var shape = opts.shape === "damped" ? "damped" : "berlage";
    var gen = (shape === "damped") ? generateDampedSinusoid : generateBerlage;
    var pSeed = gen({ fDomHz: fP, durationMs: durationMs, sampleRateHz: sampleRateHz, damping: xiP });
    var sSeed = gen({ fDomHz: fS, durationMs: durationMs, sampleRateHz: sampleRateHz, damping: xiS });
    var N = Math.min(pSeed.samples.length, sSeed.samples.length);
    var combined = new Float32Array(N);
    for (var i = 0; i < N; i++) combined[i] = ampP * pSeed.samples[i] + ampS * sSeed.samples[i];
    return {
        samples: combined, pSamples: pSeed.samples, sSamples: sSeed.samples,
        ampP: ampP, ampS: ampS, fP_Hz: fP, fS_Hz: fS, xiP: xiP, xiS: xiS, shape: shape,
        durationMs: durationMs, sampleRateHz: sampleRateHz, source: "twoterm", causal: true, twoTerm: true
    };
}

/**
 * Linear-interpolation resample of a seed trace to a target rate.
 *
 * @param {ArrayLike<number>} samples
 * @param {number} inRate  - Hz
 * @param {number} outRate - Hz
 * @returns {Float32Array}
 */
export function resampleMeasured(samples, inRate, outRate) {
    if (!samples || samples.length === 0) return new Float32Array(0);
    if (inRate === outRate) return samples instanceof Float32Array ? samples : new Float32Array(samples);
    var ratio = inRate / outRate;
    var outN = Math.max(1, Math.round(samples.length / ratio));
    var out = new Float32Array(outN);
    for (var i = 0; i < outN; i++) {
        var src = i * ratio;
        var lo = Math.floor(src);
        var hi = Math.min(samples.length - 1, lo + 1);
        var frac = src - lo;
        out[i] = samples[lo] * (1 - frac) + samples[hi] * frac;
    }
    return out;
}

/**
 * Coerce an arbitrarily-shaped sample buffer into a Float32Array. Handles
 * typed arrays, plain arrays and JSON-round-tripped objects with numeric
 * string keys ({"0": v0, "1": v1, ...}).
 *
 * @param {*} src
 * @returns {Float32Array|null}
 */
export function coerceSamples(src) {
    if (!src) return null;
    if (src instanceof Float32Array) return src;
    if (ArrayBuffer.isView(src)) return new Float32Array(src);
    if (Array.isArray(src)) return src.length > 0 ? new Float32Array(src) : null;
    var keys = Object.keys(src);
    if (keys.length === 0) return null;
    var numKeys = [];
    for (var i = 0; i < keys.length; i++) {
        var n = parseInt(keys[i], 10);
        if (!isNaN(n) && String(n) === keys[i]) numKeys.push(n);
    }
    if (numKeys.length === 0) return null;
    numKeys.sort(function (a, b) { return a - b; });
    var out = new Float32Array(numKeys.length);
    for (var j = 0; j < numKeys.length; j++) out[j] = +src[String(numKeys[j])];
    return out;
}

/**
 * Build a seed bundle { pSamples, sSamples, loveSamples, ampP, ampS, ampLove,
 * causalBody, causalLove, sampleRateHz, kind } from a seedSpec, ready for the
 * forward-array synthesiser.
 *
 * @param {{ kind: string, params?: Object }} seedSpec
 * @param {number} fs        - synthesis sample rate (Hz)
 * @param {number} [fLoveHz=2]
 * @returns {Object|null}
 */
export function buildSeedBundle(seedSpec, fs, fLoveHz) {
    if (!seedSpec || !seedSpec.kind) return null;
    var params = seedSpec.params || {};
    var sampleRateHz = +fs > 0 ? +fs : 2048;
    var durationMs = +params.durationMs > 0 ? +params.durationMs : 300;
    var damping = (params.damping != null && +params.damping >= 0) ? +params.damping : 0.10;
    var fLove = +fLoveHz > 0 ? +fLoveHz : 2.0;

    switch (seedSpec.kind) {
        case "ricker": {
            var fDom = +params.fDomHz > 0 ? +params.fDomHz : 30;
            return {
                pSamples: generateRicker({ fDomHz: fDom, durationMs: durationMs, sampleRateHz: sampleRateHz }).samples,
                sSamples: generateRicker({ fDomHz: fDom, durationMs: durationMs, sampleRateHz: sampleRateHz }).samples,
                loveSamples: generateRicker({ fDomHz: fLove, durationMs: durationMs, sampleRateHz: sampleRateHz }).samples,
                ampP: 1.0, ampS: 1.0, ampLove: 1.0, sampleRateHz: sampleRateHz,
                causalBody: false, causalLove: false, kind: "ricker"
            };
        }
        case "berlage": {
            var fB = +params.fDomHz > 0 ? +params.fDomHz : 30;
            return {
                pSamples: generateBerlage({ fDomHz: fB, durationMs: durationMs, sampleRateHz: sampleRateHz, damping: damping }).samples,
                sSamples: generateBerlage({ fDomHz: fB, durationMs: durationMs, sampleRateHz: sampleRateHz, damping: damping }).samples,
                loveSamples: generateBerlage({ fDomHz: fLove, durationMs: durationMs, sampleRateHz: sampleRateHz, damping: damping }).samples,
                ampP: 1.0, ampS: 1.0, ampLove: 1.0, sampleRateHz: sampleRateHz,
                causalBody: true, causalLove: true, kind: "berlage"
            };
        }
        case "damped": {
            var fD = +params.fDomHz > 0 ? +params.fDomHz : 30;
            return {
                pSamples: generateDampedSinusoid({ fDomHz: fD, durationMs: durationMs, sampleRateHz: sampleRateHz, damping: damping }).samples,
                sSamples: generateDampedSinusoid({ fDomHz: fD, durationMs: durationMs, sampleRateHz: sampleRateHz, damping: damping }).samples,
                loveSamples: generateDampedSinusoid({ fDomHz: fLove, durationMs: durationMs, sampleRateHz: sampleRateHz, damping: damping }).samples,
                ampP: 1.0, ampS: 1.0, ampLove: 1.0, sampleRateHz: sampleRateHz,
                causalBody: true, causalLove: true, kind: "damped"
            };
        }
        case "twoterm": {
            var tt = generateTwoTerm({
                fP_Hz: +params.fP_Hz > 0 ? +params.fP_Hz : 30,
                fS_Hz: +params.fS_Hz > 0 ? +params.fS_Hz : 18,
                xiP: params.xiP != null ? +params.xiP : 0.10,
                xiS: params.xiS != null ? +params.xiS : 0.15,
                ampP: params.ampP != null ? +params.ampP : 1.0,
                ampS: params.ampS != null ? +params.ampS : 0.7,
                durationMs: durationMs, sampleRateHz: sampleRateHz,
                shape: params.shape === "damped" ? "damped" : "berlage"
            });
            var loveSeed = generateBerlage({ fDomHz: fLove, durationMs: durationMs, sampleRateHz: sampleRateHz, damping: 0.10 });
            return {
                pSamples: tt.pSamples, sSamples: tt.sSamples, loveSamples: loveSeed.samples,
                ampP: tt.ampP, ampS: tt.ampS, ampLove: 1.0, sampleRateHz: sampleRateHz,
                causalBody: true, causalLove: true, kind: "twoterm"
            };
        }
        case "measured": {
            var src = coerceSamples(params.samples);
            if (!src || !(+params.sampleRateHz > 0)) return null;
            var inRate = +params.sampleRateHz;
            var samples = inRate !== sampleRateHz ? resampleMeasured(src, inRate, sampleRateHz) : src;
            return {
                pSamples: samples, sSamples: samples, loveSamples: samples,
                ampP: 1.0, ampS: 1.0, ampLove: 1.0, sampleRateHz: sampleRateHz,
                causalBody: true, causalLove: true, kind: "measured"
            };
        }
        default:
            return null;
    }
}
