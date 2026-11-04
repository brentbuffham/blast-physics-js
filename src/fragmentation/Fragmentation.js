/**
 * Fragmentation.js — Predicted fragment size distributions for a blast design
 * (Kuz-Ram, KCO / Swebrec, KC-KUM), and rock factor A back-fitted to a measured curve
 *
 * Author: Brent Buffham — blastingapps.com & kirra-design.com
 * License: MIT
 *
 * UNITS: fragment sizes in mm, % passing 0–100. Burden, spacing, bench height,
 * charge lengths and drilling deviation in m; hole diameter in mm; charge mass
 * in kg per hole; explosive density in g/cm³; powder factor in kg/m³.
 *
 *   Q   = charge per hole (given, or π/4 · d² · L · ρ)
 *   K   = Q / (B · S · H), or given
 *   x50 = Kuznetsov / Cunningham (KuzRam.js), n = Cunningham 1987 (or 2005)
 *   Kuz-Ram: Rosin-Rammler through x50 with n
 *   KCO:     Swebrec through x50 with xmax and b = 2 ln2 ln(xmax/x50) n
 *   KC-KUM:  gamma pair through the Spathis median with n_f (KCKUM.js)
 *
 * xmax defaults to min(B, S), Ouchterlony's (2005, Eq 11d) "tentative" choice
 * when the in-situ block size is not known; pass xmax for a better one.
 */

import { kuznetsovX50, cunninghamUniformity, cunningham2005Uniformity, cunninghamTimingFactor,
    cunninghamScatterFactor, spathisMedianFactor, rosinRammlerPassing, rosinRammlerSize } from "./KuzRam.js";
import { swebrecPassing, swebrecSize, kcoB } from "./Swebrec.js";
import { kckumUniformity, kckumCurve } from "./KCKUM.js";

export var FRAGMENTATION_MODELS = ["kuz-ram", "kco", "kckum"];
export var DEFAULT_PERCENTS = [10, 20, 50, 80, 90];

function positive(v, name) {
    if (typeof v !== "number" || !isFinite(v) || !(v > 0)) {
        throw new RangeError("fragmentation: " + name + " must be a positive number, not " + v);
    }
    return v;
}

/**
 * Explosive mass in a column: π/4 · d² · L · ρ.
 * @param {number} holeDiamMm
 * @param {number} chargeLength - m
 * @param {number} densityGcc - g/cm³
 * @returns {number} kg
 */
export function columnChargeMass(holeDiamMm, chargeLength, densityGcc) {
    var dM = holeDiamMm / 1000;
    return Math.PI / 4 * dM * dM * chargeLength * densityGcc * 1000;
}

/**
 * Predict the fragment size distribution of a blast design.
 *
 * @param {Object} design
 * @param {number} design.burden - B, m
 * @param {number} design.spacing - S, m
 * @param {number} design.benchHeight - H, m
 * @param {number} design.holeDiamMm - d, mm
 * @param {number} design.chargeLength - L, total explosive length per hole, m
 * @param {number} [design.chargeMass] - Q, kg per hole (else from explosiveDensity)
 * @param {number} [design.explosiveDensity] - g/cm³, used when chargeMass is not given
 * @param {number} [design.powderFactor] - K, kg/m³ (else Q / (B · S · H)); pass it when the
 *   rock volume per hole comes from the real geometry
 * @param {number} [design.rws=100] - weight strength relative to ANFO
 * @param {number} design.rockFactor - A (rockFactorA, Kuznetsov's 7/10/13, or a back-fit)
 * @param {number} [design.drillDeviation=0] - W, m
 * @param {number} [design.bottomChargeLength] - BCL, m (default: one column)
 * @param {number} [design.columnChargeLength] - CCL, m
 * @param {boolean} [design.staggered=false] - Cunningham 1983: n × 1.1
 * @param {Object} [options]
 * @param {number} [options.xmax] - largest fragment for KCO, mm (default min(B, S))
 * @param {boolean} [options.spathis=false] - Spathis median correction on the Kuz-Ram
 *   and KCO x50 (KC-KUM always uses it, as its paper does)
 * @param {Object} [options.cunningham2005] - use Cunningham (2005): { delayMs, pWaveKmS,
 *   scatterSdMs = 0, cA = 1, cn = 1 }. x50 takes A · A_T · C(A); n is the 2005 form.
 * @returns {{chargeMass:number, powderFactor:number, rockFactor:number, effectiveRockFactor:number,
 *   x50:number, n:number,
 *   kuzRam:Object, kco:Object|null, kckum:Object|null, warnings:Array<{code:string, message:string}>}}
 *   Each model is { x50, …parameters, passing(xMm) → %, sizeAt(P) → mm }. A model that
 *   cannot be drawn is null, with the reason in warnings. x50 is Kuznetsov's size (mm) before
 *   any Spathis correction; effectiveRockFactor is the A that entered it (A · A_T · C(A) for 2005).
 * @throws {RangeError} a bad input, or a uniformity index n ≤ 0
 */
export function predictFragmentation(design, options) {
    var o = options || {};
    var B = positive(design.burden, "burden");
    var S = positive(design.spacing, "spacing");
    var H = positive(design.benchHeight, "benchHeight");
    var d = positive(design.holeDiamMm, "holeDiamMm");
    var L = positive(design.chargeLength, "chargeLength");
    var A = positive(design.rockFactor, "rockFactor");
    var Q = design.chargeMass !== undefined ? positive(design.chargeMass, "chargeMass")
        : columnChargeMass(d, L, positive(design.explosiveDensity, "explosiveDensity (or chargeMass)"));
    var K = design.powderFactor !== undefined ? positive(design.powderFactor, "powderFactor") : Q / (B * S * H);
    var warnings = [];

    // Step 1) Uniformity n and the rock factor that enters x50
    var n, Aeff = A;
    var c05 = o.cunningham2005;
    if (c05) {
        var ns = c05.scatterSdMs ? cunninghamScatterFactor(c05.scatterSdMs, positive(c05.delayMs, "cunningham2005.delayMs")) : undefined;
        n = cunningham2005Uniformity(Object.assign({}, design, { rockFactor: A, scatterFactor: ns, cn: c05.cn }));
        Aeff = A * cunninghamTimingFactor(positive(c05.delayMs, "cunningham2005.delayMs"), B, positive(c05.pWaveKmS, "cunningham2005.pWaveKmS")) * (c05.cA === undefined ? 1 : positive(c05.cA, "cunningham2005.cA"));
    } else {
        n = cunninghamUniformity(design);
    }
    if (!(n > 0)) {
        throw new RangeError("fragmentation: the uniformity index n is " + n + " — a " + B + " m burden is too large for a " + d + " mm hole in Cunningham's equation");
    }

    // Step 2) Kuznetsov size
    var x50 = kuznetsovX50({ rockFactor: Aeff, powderFactor: K, chargeMass: Q, rws: design.rws });
    var median = o.spathis ? x50 * spathisMedianFactor(n) : x50;

    var kuzRam = {
        x50: median, n: n,
        passing: function (x) { return rosinRammlerPassing(x, median, n); },
        sizeAt: function (P) { return rosinRammlerSize(P, median, n); }
    };

    // Step 3) KCO
    var xmax = o.xmax !== undefined ? positive(o.xmax, "xmax") : Math.min(B, S) * 1000;
    var kco = null;
    if (xmax > median) {
        var b = kcoB(median, xmax, n);
        kco = {
            x50: median, xmax: xmax, b: b, n: n,
            passing: function (x) { return swebrecPassing(x, median, xmax, b); },
            sizeAt: function (P) { return swebrecSize(P, median, xmax, b); }
        };
    } else {
        warnings.push({ code: "XMAX_BELOW_X50", message: "KCO: xmax " + xmax.toFixed(0) + " mm is not above x50 " + median.toFixed(0) + " mm" });
    }

    // Step 4) KC-KUM (Spathis median, n_f)
    var nf = kckumUniformity(design);
    var kckum = null;
    if (nf > 0) {
        kckum = kckumCurve(x50 * spathisMedianFactor(n), nf, S / B);
        kckum.n = n;
    } else {
        warnings.push({ code: "NF_NOT_POSITIVE", message: "KC-KUM: n_f is " + nf });
    }

    return {
        chargeMass: Q, powderFactor: K, rockFactor: A, effectiveRockFactor: Aeff, x50: x50, n: n,
        kuzRam: kuzRam, kco: kco, kckum: kckum, warnings: warnings
    };
}

/**
 * Sizes at chosen % passing for a model from predictFragmentation (or anything with sizeAt).
 * @param {{sizeAt:function(number): number}} curve
 * @param {number[]} [percents=[10, 20, 50, 80, 90]]
 * @returns {Object<string, number>} { 10: mm, 20: mm, … }
 */
export function percentileSizes(curve, percents) {
    var out = {};
    (percents || DEFAULT_PERCENTS).forEach(function (P) { out[P] = curve.sizeAt(P); });
    return out;
}

//=============================================================
// TABULATED CURVES (measured sieve / image data, blends)
//=============================================================

/**
 * Sizes spaced evenly in log between two limits.
 * @param {number} [minMm=0.1]
 * @param {number} [maxMm=2000]
 * @param {number} [count=200]
 * @returns {number[]}
 */
export function logSizeGrid(minMm, maxMm, count) {
    var lo = Math.log(minMm || 0.1), hi = Math.log(maxMm || 2000), m = count || 200;
    var out = [];
    for (var i = 0; i < m; i++) out.push(Math.exp(lo + (hi - lo) * i / (m - 1)));
    return out;
}

/**
 * % passing at a size on a tabulated curve, interpolated linearly in log size
 * (sieve curves are drawn on a log size axis). Clamped to the end points.
 * @param {number[]} sizes - ascending, > 0
 * @param {number[]} passing - %, non-decreasing
 * @param {number} x
 * @returns {number}
 */
export function tabulatedPassing(sizes, passing, x) {
    var last = sizes.length - 1;
    if (!(x > sizes[0])) return passing[0];
    if (x >= sizes[last]) return passing[last];
    var i = 0;
    while (sizes[i + 1] < x) i++;
    var t = Math.log(x / sizes[i]) / Math.log(sizes[i + 1] / sizes[i]);
    return passing[i] + t * (passing[i + 1] - passing[i]);
}

/**
 * Size at a % passing on a tabulated curve, interpolated linearly in log size.
 * @param {number[]} sizes - ascending, > 0
 * @param {number[]} passing - %, non-decreasing
 * @param {number} P
 * @returns {number} the first size reaching P; the end sizes outside the curve
 */
export function tabulatedSize(sizes, passing, P) {
    var last = sizes.length - 1;
    if (P <= passing[0]) return sizes[0];
    if (P > passing[last]) return sizes[last];
    var i = 0;
    while (passing[i + 1] < P) i++;
    var span = passing[i + 1] - passing[i];
    var t = span > 0 ? (P - passing[i]) / span : 0;
    return sizes[i] * Math.pow(sizes[i + 1] / sizes[i], t);
}

//=============================================================
// BACK-FIT OF THE ROCK FACTOR
//=============================================================

/**
 * The rock factor A that best fits a measured curve: least squares in % passing
 * at the measured sizes, golden-section search on ln A (0.01 … 1000). A only
 * scales x50, so this is the site calibration Ouchterlony (2015) recommends.
 * @param {{sizes:number[], passing:number[]}} measured - mm, %
 * @param {Object} design - as predictFragmentation (rockFactor ignored)
 * @param {Object} [options] - as predictFragmentation, plus model: "kco" (default),
 *   "kuz-ram" or "kckum"
 * @returns {{rockFactor:number, rmse:number, model:string, x50:number}}
 */
export function fitRockFactor(measured, design, options) {
    var o = options || {};
    return fitRockFactorWith(measured, o.model, function (A) {
        return predictFragmentation(Object.assign({}, design, { rockFactor: A }), o);
    });
}

/**
 * The fitting core: least squares in % passing at the measured sizes over ln A
 * (0.01 … 1000, golden section). predict(A) returns an object with the model
 * curves (kuzRam / kco / kckum), as predictFragmentation and predictBlastFragmentation do.
 * @param {{sizes:number[], passing:number[]}} measured
 * @param {string} [model="kco"]
 * @param {function(number): Object} predict
 * @returns {{rockFactor:number, rmse:number, model:string, x50:number}} x50: the fitted
 *   curve's 50 % size
 */
export function fitRockFactorWith(measured, model, predict) {
    model = model || "kco";
    if (FRAGMENTATION_MODELS.indexOf(model) < 0) throw new RangeError("fragmentation: model must be one of " + FRAGMENTATION_MODELS.join(", ") + ", not " + model);
    var xs = measured && measured.sizes, ps = measured && measured.passing;
    if (!xs || !ps || xs.length !== ps.length || xs.length < 1) throw new RangeError("fragmentation: measured needs sizes and passing of the same length");
    var key = model === "kuz-ram" ? "kuzRam" : model;

    function rmseAt(lnA) {
        var curve = predict(Math.exp(lnA))[key];
        if (!curve) return Infinity;
        var e = 0;
        for (var i = 0; i < xs.length; i++) { var dv = curve.passing(xs[i]) - ps[i]; e += dv * dv; }
        return Math.sqrt(e / xs.length);
    }

    var lo = Math.log(0.01), hi = Math.log(1000), g = (Math.sqrt(5) - 1) / 2;
    var a = hi - g * (hi - lo), b = lo + g * (hi - lo);
    var fa = rmseAt(a), fb = rmseAt(b);
    for (var it = 0; it < 120 && hi - lo > 1e-9; it++) {
        if (fa <= fb) { hi = b; b = a; fb = fa; a = hi - g * (hi - lo); fa = rmseAt(a); }
        else { lo = a; a = b; fa = fb; b = lo + g * (hi - lo); fb = rmseAt(b); }
    }
    var A = Math.exp(0.5 * (lo + hi));
    var curve = predict(A)[key];
    return { rockFactor: A, rmse: rmseAt(Math.log(A)), model: model, x50: curve ? curve.sizeAt(50) : NaN };
}
