/**
 * KuzRam.js — Kuznetsov / Cunningham fragmentation: rock factor, median size,
 * uniformity index and the Rosin-Rammler curve
 *
 * Author: Brent Buffham — blastingapps.com & kirra-design.com
 * License: MIT
 *
 * UNITS: fragment sizes in mm (Kuznetsov's cm is converted inside); burden,
 * spacing, bench height, charge lengths and drilling deviation in m; hole
 * diameter in mm; charge mass in kg per hole; powder factor in kg/m³; RWS is
 * weight strength relative to ANFO = 100.
 *
 *   x50 [cm] = A · K^-0.8 · Q^(1/6) · (115 / RWS)^(19/30)        Cunningham 1983
 *   n = (2.2 − 14 B/d) · √((1 + S/B)/2) · (1 − W/B)
 *       · (|BCL − CCL| / L + 0.1)^0.1 · (L/H)                    Cunningham 1987
 *   P(x) = 1 − exp(−ln2 · (x / x50)^n)                            Rosin-Rammler, median form
 *
 * The exponent 19/30 is Kuznetsov's −0.8 + 1/6 after converting the TNT charge
 * to ANFO strength. Ouchterlony (2005, Eq 11b) prints 19/30, and his Bårarp
 * round 4 worked example (x50 = 44.8 cm) only comes out with 19/30.
 * Cunningham (2005) prints 19/20 in Eqs 1 and 13; that is taken as a misprint.
 *
 * SOURCES
 *  Cunningham, C.V.B. (1983) The Kuz-Ram model for prediction of fragmentation
 *    from blasting. 1st Int. Symp. Rock Fragmentation by Blasting, Luleå, 439–453.
 *  Cunningham, C.V.B. (1987) Fragmentation estimations and the Kuz-Ram model —
 *    four years on. 2nd Int. Symp. Rock Fragmentation by Blasting, Keystone, 475–487.
 *  Cunningham, C.V.B. (2005) The Kuz-Ram fragmentation model — 20 years on.
 *    Brighton Conference Proceedings, EFEE, 201–210.
 *  Ouchterlony, F. (2005) The Swebrec function: linking fragmentation by
 *    blasting and crushing. Mining Technology (Trans. IMM A) 114, A29–A44.
 *  Spathis, A.T. (2004) A correction relating to the analysis of the original
 *    Kuz-Ram model. Fragblast 8(4), 201–205 (form as quoted by Faramarzi et al.
 *    2015, Eqs 3–4, and Ouchterlony 2005, Eq 11b).
 */

import { gammaFunction } from "./Gamma.js";

var EXPONENT_RWS = 19 / 30;

function need(value, name, test) {
    if (typeof value !== "number" || !isFinite(value) || !test(value)) {
        throw new RangeError("fragmentation: " + name + " must be " + (test === positive ? "a positive number" : "a number in range") + ", not " + value);
    }
    return value;
}
function positive(v) { return v > 0; }
function nonNegative(v) { return v >= 0; }

/**
 * Cunningham's rock factor A, in the corrected form of Cunningham (2005) Eqs 4–7:
 * A = 0.06 · (RMD + RDI + HF).
 *
 * The 1987 paper prints 0.06 · (RMD + JF + RDI + HF), which counts jointing twice
 * for jointed rock (JF is also RMD's value there); Cunningham (2005) and
 * Sanchidrián & Ouchterlony (2017) treat that as a printing error.
 *
 *   RMD  rock mass description: 10 powdery / friable, 50 massive, or "jointed"
 *        for vertically jointed rock, which takes RMD = JF = JCF · JPS + JPA
 *   RDI  rock density influence = 25 · SG − 50   (SG in t/m³)
 *   HF   hardness factor = E/3 when E < 50 GPa, else UCS/5   (UCS in MPa)
 *
 * The JPS / JPA ratings are passed in, not looked up: Cunningham (2005) changed
 * the JPA ratings from the 1987 paper, and the two are quoted both ways.
 *
 * @param {Object} p
 * @param {number|"jointed"} p.rmd - 10, 50, or "jointed"
 * @param {number} [p.jps] - joint plane spacing rating (jointed only)
 * @param {number} [p.jpa] - joint plane angle rating (jointed only)
 * @param {number} [p.jcf=1] - joint condition factor: 1 tight, 1.5 relaxed, 2 gouge-filled
 * @param {number} p.density - rock specific gravity, t/m³
 * @param {number} p.youngsModulusGPa
 * @param {number} p.ucsMPa - unconfined compressive strength
 * @returns {number} A
 */
export function rockFactorA(p) {
    var rmd;
    if (p.rmd === "jointed") {
        var jcf = p.jcf === undefined ? 1 : need(p.jcf, "jcf", positive);
        rmd = jcf * need(p.jps, "jps", nonNegative) + need(p.jpa, "jpa", nonNegative);
    } else {
        rmd = need(p.rmd, "rmd", nonNegative);
    }
    var rdi = 25 * need(p.density, "density", positive) - 50;
    var E = need(p.youngsModulusGPa, "youngsModulusGPa", positive);
    var hf = E < 50 ? E / 3 : need(p.ucsMPa, "ucsMPa", positive) / 5;
    return 0.06 * (rmd + rdi + hf);
}

/**
 * Kuznetsov's size as Cunningham uses it: the median x50.
 * x50 [cm] = A · K^-0.8 · Q^(1/6) · (115 / RWS)^(19/30); returned in mm.
 * @param {Object} p
 * @param {number} p.rockFactor - A
 * @param {number} p.powderFactor - K, kg/m³
 * @param {number} p.chargeMass - Q, kg of explosive per hole
 * @param {number} [p.rws=100] - weight strength relative to ANFO
 * @returns {number} x50, mm
 */
export function kuznetsovX50(p) {
    var A = need(p.rockFactor, "rockFactor", positive);
    var K = need(p.powderFactor, "powderFactor", positive);
    var Q = need(p.chargeMass, "chargeMass", positive);
    var rws = p.rws === undefined ? 100 : need(p.rws, "rws", positive);
    var cm = A * Math.pow(K, -0.8) * Math.pow(Q, 1 / 6) * Math.pow(115 / rws, EXPONENT_RWS);
    return cm * 10;
}

/**
 * Spathis (2004) correction: Kuznetsov's size is a mean, so the Rosin-Rammler
 * median is x50 = x̄ · (ln2)^(1/n) / Γ(1 + 1/n). This returns the factor g(n)
 * (Ouchterlony 2005, Eq 11b). Ouchterlony (2015) notes that Cunningham's 1987
 * rock factor was calibrated to the median, so the correction belongs with
 * Kuznetsov's own A (7, 10, 13) rather than Cunningham's.
 * @param {number} n - uniformity index
 * @returns {number} g(n)
 */
export function spathisMedianFactor(n) {
    need(n, "n", positive);
    return Math.pow(Math.LN2, 1 / n) / gammaFunction(1 + 1 / n);
}

/**
 * Cunningham (1987) uniformity index, as printed in Cunningham (2005) Eq 3 and
 * Ouchterlony (2005) Eq 11c, with B in m and d in mm:
 * n = (2.2 − 14 B/d) · √((1 + S/B)/2) · (1 − W/B) · (|BCL − CCL|/L + 0.1)^0.1 · (L/H).
 * Cunningham (1983) adds that a staggered pattern raises n by 10 %.
 * @param {Object} p
 * @param {number} p.burden - B, m
 * @param {number} p.spacing - S, m
 * @param {number} p.holeDiamMm - d, mm
 * @param {number} p.chargeLength - L, total charge length, m
 * @param {number} p.benchHeight - H, m
 * @param {number} [p.drillDeviation=0] - W, standard deviation of drilling accuracy, m
 * @param {number} [p.bottomChargeLength] - BCL, m (default: the whole charge, one column)
 * @param {number} [p.columnChargeLength] - CCL, m (default 0)
 * @param {boolean} [p.staggered=false] - × 1.1
 * @returns {number} n (may be ≤ 0 for a burden too large for the hole)
 */
export function cunninghamUniformity(p) {
    var B = need(p.burden, "burden", positive);
    var S = need(p.spacing, "spacing", positive);
    var d = need(p.holeDiamMm, "holeDiamMm", positive);
    var L = need(p.chargeLength, "chargeLength", positive);
    var H = need(p.benchHeight, "benchHeight", positive);
    var W = p.drillDeviation === undefined ? 0 : need(p.drillDeviation, "drillDeviation", nonNegative);
    var bcl = p.bottomChargeLength === undefined ? L : need(p.bottomChargeLength, "bottomChargeLength", nonNegative);
    var ccl = p.columnChargeLength === undefined ? 0 : need(p.columnChargeLength, "columnChargeLength", nonNegative);
    var n = (2.2 - 14 * B / d) *
        Math.sqrt((1 + S / B) / 2) *
        (1 - W / B) *
        Math.pow(Math.abs(bcl - ccl) / L + 0.1, 0.1) *
        (L / H);
    return p.staggered ? n * 1.1 : n;
}

//=============================================================
// CUNNINGHAM (2005)
//=============================================================

/**
 * Cunningham (2005) Eqs 8–9: the timing factor A_T that multiplies A.
 * T_max = 15.6 · B / Cx (ms); with r = T / T_max,
 *   r ≤ 1: A_T = 0.66 r³ − 0.13 r² − 1.58 r + 2.1
 *   r > 1: A_T = 0.9 + 0.1 (r − 1)
 * As printed, the two pieces do not meet at r = 1 (1.05 against 0.9).
 * @param {number} delayMs - T, inter-hole delay
 * @param {number} burden - B, m
 * @param {number} pWaveKmS - Cx, rock P-wave velocity, km/s
 * @returns {number} A_T
 */
export function cunninghamTimingFactor(delayMs, burden, pWaveKmS) {
    var tMax = 15.6 * need(burden, "burden", positive) / need(pWaveKmS, "pWaveKmS", positive);
    var r = need(delayMs, "delayMs", nonNegative) / tMax;
    if (r <= 1) return 0.66 * r * r * r - 0.13 * r * r - 1.58 * r + 2.1;
    return 0.9 + 0.1 * (r - 1);
}

/**
 * Cunningham (2005) Eqs 10–11: delay scatter factor n_s = 0.206 + (1 − R_s/4)^0.8,
 * with R_s = 6 σ_t / T_x (scatter range over nominal delay).
 * @param {number} scatterSdMs - σ_t, standard deviation of the delay, ms
 * @param {number} delayMs - T_x, nominal delay, ms
 * @returns {number} n_s
 */
export function cunninghamScatterFactor(scatterSdMs, delayMs) {
    var Rs = 6 * need(scatterSdMs, "scatterSdMs", nonNegative) / need(delayMs, "delayMs", positive);
    return 0.206 + Math.pow(1 - Rs / 4, 0.8);
}

/**
 * Cunningham (2005) Eq 14 uniformity index, with the rock term (A/6)^0.3 of
 * Eq 12 that Eq 14 leaves out (a typographical error per Sanchidrián &
 * Ouchterlony 2017, whose Eq 9 includes it):
 * n = n_s · √(2 − 30 B/d) · √((1 + S/B)/2) · (1 − W/B) · (L/H)^0.3 · (A/6)^0.3 · C(n).
 * The bottom / column charge term of 1987 is gone; L is the charge length that
 * affects fragmentation.
 * @param {Object} p - as cunninghamUniformity, plus:
 * @param {number} p.rockFactor - A
 * @param {number} [p.scatterFactor] - n_s (cunninghamScatterFactor); default 0.206 + 1 (no scatter)
 * @param {number} [p.cn=1] - site correction C(n)
 * @returns {number} n
 */
export function cunningham2005Uniformity(p) {
    var B = need(p.burden, "burden", positive);
    var S = need(p.spacing, "spacing", positive);
    var d = need(p.holeDiamMm, "holeDiamMm", positive);
    var L = need(p.chargeLength, "chargeLength", positive);
    var H = need(p.benchHeight, "benchHeight", positive);
    var W = p.drillDeviation === undefined ? 0 : need(p.drillDeviation, "drillDeviation", nonNegative);
    var A = need(p.rockFactor, "rockFactor", positive);
    var ns = p.scatterFactor === undefined ? 1.206 : need(p.scatterFactor, "scatterFactor", positive);
    var cn = p.cn === undefined ? 1 : need(p.cn, "cn", positive);
    var inner = 2 - 30 * B / d;
    if (!(inner > 0)) return NaN;
    return ns * Math.sqrt(inner) * Math.sqrt((1 + S / B) / 2) * (1 - W / B) *
        Math.pow(L / H, 0.3) * Math.pow(A / 6, 0.3) * cn;
}

//=============================================================
// ROSIN-RAMMLER (median form)
//=============================================================

/**
 * Rosin-Rammler % passing in the median form Kuz-Ram uses:
 * P = 100 · (1 − exp(−ln2 · (x / x50)^n)).
 * @param {number} x - size
 * @param {number} x50 - median, same units as x
 * @param {number} n
 * @returns {number} % passing
 */
export function rosinRammlerPassing(x, x50, n) {
    if (!(x > 0)) return 0;
    return 100 * (1 - Math.exp(-Math.LN2 * Math.pow(x / x50, n)));
}

/**
 * Size at a % passing for the median-form Rosin-Rammler (inverse of rosinRammlerPassing).
 * @param {number} P - % passing, 0 … 100
 * @param {number} x50
 * @param {number} n
 * @returns {number} size, x50's units (0 at P ≤ 0, Infinity at P ≥ 100)
 */
export function rosinRammlerSize(P, x50, n) {
    if (!(P > 0)) return 0;
    if (P >= 100) return Infinity;
    return x50 * Math.pow(-Math.log(1 - P / 100) / Math.LN2, 1 / n);
}
