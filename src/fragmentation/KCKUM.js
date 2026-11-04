/**
 * KCKUM.js — The KC-KUM gamma-based fragmentation curve (Faramarzi et al. 2015)
 *
 * Author: Brent Buffham — blastingapps.com & kirra-design.com
 * License: MIT
 *
 * KC-KUM (Kuznetsov–Cunningham–Kerman University Model) joins two gamma
 * distribution CDFs at 40 % passing:
 *
 *   n_f = (2.2 − 14 B/D) · ((1 + S/B)/2) · (1 − W/B) · (L/H)          Eq 11
 *   fines to central (≤ 40 %):  k = n_f^X50 / 2,  θ = 4 · X50          Eqs 12–13
 *   central to coarse (≥ 40 %): k = n_f^0.3,      θ = (S · X50 / B)^1.1  Eqs 14–15
 *   P(x) = γ(k, x/θ) / Γ(k)                                             Eq 9
 *
 * n_f is Cunningham's n with the 0.5 power on (1 + S/B)/2 removed, and without
 * the bottom / column charge term. X50 is in METRES in Eqs 12–15 (it appears as
 * an exponent, so the unit matters), and it is Kuznetsov's size corrected to a
 * median after Spathis (2004), Eqs 3–4: X50 = x̄ · 0.693^(1/n) / Γ(1 + 1/n) with
 * Cunningham's n.
 *
 * Checked against the paper's Fig 3 table: with n_f = 1.84 and S/B = 1.2 (blast
 * G-2 of Table 1) and X50 = 0.1584 m, both equations give every printed value
 * from 0.01 m to 0.7 m to the table's rounding (test/fragmentation.test.js).
 *
 * The join: sizes at P ≤ 40 % come from the fines equation and sizes at P ≥ 40 %
 * from the coarse one (the paper's "passing sizes for X ≤ 40 per cent and
 * X ≥ 40 per cent"): the fines curve up to the size where it reaches 40 %, the
 * coarse curve above it. Where the coarse curve is still under 40 % there, the
 * curve holds 40 % until it gets there; where it is already over, the curve
 * steps up. The paper's Fig 3 table switches one row later (0.11 m: 40.4 from
 * the fines column, against the coarse column's 40.3 here).
 *
 * SOURCE
 *  Faramarzi, F., Ebrahimi Farsangi, M.A. & Mansouri, H. (2015) Prediction of
 *    rock fragmentation using a gamma-based blast fragmentation distribution
 *    model. 11th Int. Symp. Rock Fragmentation by Blasting (Fragblast 11),
 *    Sydney, AusIMM, 685–692.
 */

import { regularizedLowerGamma } from "./Gamma.js";

var GRAFT = 40;

/**
 * KC-KUM modified uniformity index n_f (Eq 11). B, S, W, L, H in m; D in mm.
 * @param {Object} p
 * @param {number} p.burden
 * @param {number} p.spacing
 * @param {number} p.holeDiamMm
 * @param {number} p.chargeLength
 * @param {number} p.benchHeight
 * @param {number} [p.drillDeviation=0]
 * @returns {number} n_f
 */
export function kckumUniformity(p) {
    var B = p.burden, S = p.spacing, W = p.drillDeviation || 0;
    return (2.2 - 14 * B / p.holeDiamMm) * ((1 + S / B) / 2) * (1 - W / B) * (p.chargeLength / p.benchHeight);
}

/**
 * The two gamma laws of a KC-KUM curve.
 * @param {number} x50M - median, METRES
 * @param {number} nf
 * @param {number} spacingOverBurden - S/B
 * @returns {{fine:{k:number, theta:number}, coarse:{k:number, theta:number}}} θ in metres
 */
export function kckumParameters(x50M, nf, spacingOverBurden) {
    return {
        fine: { k: Math.pow(nf, x50M) / 2, theta: 4 * x50M },
        coarse: { k: Math.pow(nf, 0.3), theta: Math.pow(spacingOverBurden * x50M, 1.1) }
    };
}

function cdf(law, xM) {
    return 100 * regularizedLowerGamma(law.k, xM / law.theta);
}

// Size (m) where a gamma law reaches P %: bisection on the monotone CDF
function inverse(law, P) {
    var lo = 0, hi = law.theta;
    while (cdf(law, hi) < P) hi *= 2;
    for (var i = 0; i < 200 && hi - lo > hi * 1e-14; i++) {
        var mid = 0.5 * (lo + hi);
        if (cdf(law, mid) < P) lo = mid; else hi = mid;
    }
    return 0.5 * (lo + hi);
}

/**
 * A KC-KUM curve. Sizes in mm in and out.
 * @param {number} x50Mm - median (Spathis-corrected Kuznetsov size), mm
 * @param {number} nf
 * @param {number} spacingOverBurden
 * @returns {{x50:number, nf:number, fine:Object, coarse:Object,
 *   passing:function(number): number, sizeAt:function(number): number}}
 */
export function kckumCurve(x50Mm, nf, spacingOverBurden) {
    if (!(x50Mm > 0) || !(nf > 0) || !(spacingOverBurden > 0)) {
        throw new RangeError("fragmentation: KC-KUM needs x50, n_f and S/B above 0 (got " + x50Mm + ", " + nf + ", " + spacingOverBurden + ")");
    }
    var laws = kckumParameters(x50Mm / 1000, nf, spacingOverBurden);
    var fineEnd = inverse(laws.fine, GRAFT); // m
    return {
        x50: x50Mm,
        nf: nf,
        fine: laws.fine,
        coarse: laws.coarse,
        passing: function (xMm) {
            if (!(xMm > 0)) return 0;
            var f = cdf(laws.fine, xMm / 1000);
            if (f <= GRAFT) return f;
            return Math.max(GRAFT, cdf(laws.coarse, xMm / 1000));
        },
        // the inverse of passing(): above 40 % no smaller than where the fines part ends
        sizeAt: function (P) {
            if (!(P > 0)) return 0;
            if (P >= 100) return Infinity;
            if (P <= GRAFT) return 1000 * inverse(laws.fine, P);
            return 1000 * Math.max(fineEnd, inverse(laws.coarse, P));
        }
    };
}
