/**
 * RippleTank.js — Forward wave-field ("ripple tank") visualisation model
 *
 * Author: Brent Buffham — blastingapps.com & kirra-design.com
 * License: MIT
 *
 * At time t (seconds since first fire), every observation point shows the
 * signed scalar ground-motion contribution from every charge that has fired,
 * with P and S wave fronts propagating at cp / cs from each charge centroid.
 * Fronts interfere constructively (bright fringes) or destructively (dark
 * zones) — a coherent, phase-aware view of how blast energy propagates.
 *
 *   amp_i(p)   = K · (D_i / Q_i^n)^(−B)                     (site law)
 *   arrivalP_i = fire_i + D_i / cp,   arrivalS_i = fire_i + D_i / cs
 *   u(p, t)    = Σ_i amp_i · [ w(t − arrivalP_i, fP, αP) + spRatio · w(t − arrivalS_i, fS, αS) ]
 *
 * Wavelets: ricker (physical default) | gaussian | damped | berlage | measured.
 * The visual frequency is decoupled from the seismic frequency: tune fP / fS
 * for ring spacing visible at pattern scale (λ = cp / fP).
 *
 * CPU port of Kirra's RippleTankModel.js GLSL fragment shader.
 */

import { evalRickerCausal, evalGaussianBell, evalDamped, evalBerlage, coerceSamples } from "../signal/Wavelets.js";

export var RIPPLE_WAVELETS = ["ricker", "gaussian", "damped", "berlage", "measured"];

var DEFAULTS = {
    K: 1140, B: 1.6, chargeExponent: 0.5,
    cp: 5000, cs: 2900,
    fP: 100, fS: 60,
    numCrests: 3,           // → α = 3·f/numCrests (envelope ~5% after numCrests cycles)
    decayP: null, decayS: null,
    spRatio: 0.6,
    displayComponent: "combined",   // 'combined' | 'p' | 's'
    waveletType: "ricker",
    cutoffDistance: 1.0,
    measuredSeed: null       // { samples, sampleRateHz } for waveletType 'measured'
};

/**
 * Resolve wavelet parameters (decay rates, measured seed) once per evaluation.
 * @param {Object} params
 * @returns {Object} resolved
 */
export function resolveRippleParams(params) {
    var p = Object.assign({}, DEFAULTS, params || {});
    var numCrests = (p.numCrests != null && isFinite(p.numCrests) && p.numCrests > 0) ? p.numCrests : 3;
    p.alphaP = (p.decayP != null && isFinite(p.decayP) && p.decayP > 0) ? p.decayP : (3.0 * p.fP / numCrests);
    p.alphaS = (p.decayS != null && isFinite(p.decayS) && p.decayS > 0) ? p.decayS : (3.0 * p.fS / numCrests);
    var seed = p.measuredSeed;
    p._seedSamples = null; p._seedRate = 1000;
    if (seed) {
        var s = coerceSamples(seed.samples);
        if (s && s.length) { p._seedSamples = s; p._seedRate = seed.sampleRateHz > 0 ? seed.sampleRateHz : 1000; }
    }
    if (p.waveletType === "measured" && !p._seedSamples) p.waveletType = "ricker";
    return p;
}

function _measured(tau, samples, rate) {
    if (tau <= 0) return 0;
    var idx = tau * rate;
    if (idx >= samples.length - 1) return 0;
    var i0 = Math.floor(idx), f = idx - i0;
    return samples[i0] * (1 - f) + samples[i0 + 1] * f;
}

function _wavelet(tau, f, alpha, p) {
    switch (p.waveletType) {
        case "gaussian": return evalGaussianBell(tau, f);
        case "damped":   return evalDamped(tau, f, alpha);
        case "berlage":  return evalBerlage(tau, f, alpha, 3);
        case "measured": return _measured(tau, p._seedSamples, p._seedRate);
        case "ricker":
        default:         return evalRickerCausal(tau, f);
    }
}

/**
 * Build the compact source list once from DeckEntry objects:
 * [{ x, y, z, Q, fireS }] — deck midpoint, mass, timingMs/1000.
 * @param {Array} deckEntries
 * @returns {Array}
 */
export function rippleSourcesFromDecks(deckEntries) {
    var out = [];
    for (var i = 0; i < (deckEntries || []).length; i++) {
        var d = deckEntries[i];
        if (!d || !(d.mass > 0)) continue;
        out.push({ x: (d.topX + d.baseX) * 0.5, y: (d.topY + d.baseY) * 0.5, z: (d.topZ + d.baseZ) * 0.5,
                   Q: d.mass, fireS: (Number(d.timingMs) || 0) / 1000 });
    }
    return out;
}

/**
 * Signed wave amplitude at a point and time.
 *
 * @param {{x,y,z}} point
 * @param {number}  timeS   - seconds (same clock as source fire times)
 * @param {Array}   sources - from rippleSourcesFromDecks (or DeckEntry array)
 * @param {Object}  [params] - see DEFAULTS; may be pre-resolved via resolveRippleParams
 * @returns {number} mm/s (signed)
 */
export function rippleAmplitude(point, timeS, sources, params) {
    var p = params && params._resolved ? params : Object.assign(resolveRippleParams(params), { _resolved: true });
    var src = (sources.length && sources[0].fireS === undefined) ? rippleSourcesFromDecks(sources) : sources;
    var u = 0;
    var comp = p.displayComponent;
    for (var i = 0; i < src.length; i++) {
        var s = src[i];
        var dx = point.x - s.x, dy = point.y - s.y, dz = point.z - s.z;
        var dist = Math.max(Math.sqrt(dx * dx + dy * dy + dz * dz), p.cutoffDistance);
        var arrivalP = s.fireS + dist / p.cp;
        var arrivalS = s.fireS + dist / p.cs;
        var tauP = timeS - arrivalP;
        var tauS = timeS - arrivalS;
        if (tauP <= 0 && tauS <= 0) continue;
        var amp = p.K * Math.pow(dist / Math.pow(s.Q, p.chargeExponent), -p.B);
        if (p.waveletType === "measured") {
            u += amp * _measured(tauP, p._seedSamples, p._seedRate);
            continue;
        }
        var uP = _wavelet(tauP, p.fP, p.alphaP, p);
        var uS = p.spRatio * _wavelet(tauS, p.fS, p.alphaS, p);
        if (comp === "p") u += amp * uP;
        else if (comp === "s") u += amp * uS;
        else u += amp * (uP + uS);
    }
    return u;
}

/**
 * Wave-front ring radii for every source at time t — for overlay drawing.
 * @param {number} timeS
 * @param {Array}  sources
 * @param {Object} [params]
 * @returns {Array<{ x, y, z, rP, rS, fired }>}
 */
export function rippleWaveFronts(timeS, sources, params) {
    var p = resolveRippleParams(params);
    var src = (sources.length && sources[0].fireS === undefined) ? rippleSourcesFromDecks(sources) : sources;
    var out = [];
    for (var i = 0; i < src.length; i++) {
        var s = src[i];
        var dt = timeS - s.fireS;
        out.push({ x: s.x, y: s.y, z: s.z, fired: dt > 0, rP: dt > 0 ? dt * p.cp : 0, rS: dt > 0 ? dt * p.cs : 0 });
    }
    return out;
}

/**
 * RippleTankModel — grid / time-series wrapper.
 */
export class RippleTankModel {
    /**
     * @param {Object} params - see module DEFAULTS
     */
    constructor(params) {
        this.params = Object.assign({}, DEFAULTS, params || {});
        this.unit = "mm/s";
        this.name = "RippleTank";
    }

    /** Resolved parameter bundle (cached per params object). */
    _resolved() {
        return Object.assign(resolveRippleParams(this.params), { _resolved: true });
    }

    /**
     * Amplitude at a point and time.
     * @param {{x,y,z}} point
     * @param {Array} deckEntries
     * @param {number} timeS
     * @returns {number}
     */
    evaluate(point, deckEntries, timeS) {
        return rippleAmplitude(point, timeS, rippleSourcesFromDecks(deckEntries), this._resolved());
    }

    /**
     * Wave field on a horizontal grid at time t.
     * @param {Array}  deckEntries
     * @param {Object} gridParams - { minX, minY, rows, cols, cellX, cellY, elevation }
     * @param {number} timeS
     * @returns {{ data: Float32Array, rows, cols, minX, minY, cellX, cellY, elevation, timeS, unit, model, min, max }}
     */
    computeGrid(deckEntries, gridParams, timeS) {
        var gp = gridParams;
        var src = rippleSourcesFromDecks(deckEntries);
        var p = this._resolved();
        var data = new Float32Array(gp.rows * gp.cols);
        var mn = Infinity, mx = -Infinity;
        var pt = { x: 0, y: 0, z: gp.elevation };
        for (var r = 0; r < gp.rows; r++) {
            for (var c = 0; c < gp.cols; c++) {
                pt.x = gp.minX + c * gp.cellX;
                pt.y = gp.minY + r * gp.cellY;
                var v = rippleAmplitude(pt, timeS, src, p);
                data[r * gp.cols + c] = v;
                if (v < mn) mn = v; if (v > mx) mx = v;
            }
        }
        return { data: data, rows: gp.rows, cols: gp.cols, minX: gp.minX, minY: gp.minY,
                 cellX: gp.cellX, cellY: gp.cellY, elevation: gp.elevation, timeS: timeS,
                 unit: "mm/s", model: "RippleTank", min: mn === Infinity ? 0 : mn, max: mx === -Infinity ? 0 : mx };
    }

    /**
     * Time series at a fixed point (a synthetic geophone trace).
     * @param {{x,y,z}} point
     * @param {Array}  deckEntries
     * @param {number} t0 - s
     * @param {number} t1 - s
     * @param {number} dt - s
     * @returns {{ t: Float64Array, v: Float32Array }}
     */
    timeSeries(point, deckEntries, t0, t1, dt) {
        var src = rippleSourcesFromDecks(deckEntries);
        var p = this._resolved();
        var n = Math.max(1, Math.floor((t1 - t0) / dt) + 1);
        var t = new Float64Array(n), v = new Float32Array(n);
        for (var i = 0; i < n; i++) {
            t[i] = t0 + i * dt;
            v[i] = rippleAmplitude(point, t[i], src, p);
        }
        return { t: t, v: v };
    }
}
