/**
 * SiteLaw.js — Scaled-distance site law: regression, inverse (allowable charge)
 *
 * Author: Brent Buffham — blastingapps.com & kirra-design.com
 * License: MIT
 *
 *   PPV = K · (D / Q^e)^(−B)
 *
 *   fitSiteLaw(observations, opts)      — log-log least squares → K50/K90/K95, B, R², σ
 *   scaledDistance(D, Q, e)             — D / Q^e
 *   sitePPV(D, Q, params)               — with Yang & Scovira near-field clamp
 *   maxAllowableCharge(D, targetPPV, p) — inverse: largest Q for PPV ≤ target
 *   distanceForPPV(Q, targetPPV, p)     — inverse: distance at which PPV = target
 *
 * References: Siskind (1980) USBM RI 8507; Dowding (1985); Yang & Scovira
 * (2007) EXPLO — do not apply the site law below SD = 1.0 m/kg^0.5.
 *
 * Extracted from Kirra's SiteLawRegression.js and DominantHoleHelper.js.
 */

export { sitePPV } from "../signal/SeedSynthesis.js";

/**
 * 3D Euclidean distance between two [x,y,z] arrays or {x,y,z} objects.
 */
export function distance3D(a, b) {
    if (!a || !b) return NaN;
    var ax = a.x != null ? a.x : a[0], ay = a.y != null ? a.y : a[1], az = a.z != null ? a.z : (a[2] || 0);
    var bx = b.x != null ? b.x : b[0], by = b.y != null ? b.y : b[1], bz = b.z != null ? b.z : (b[2] || 0);
    var dx = ax - bx, dy = ay - by, dz = (az || 0) - (bz || 0);
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Scaled distance D / Q^e. Default e = 0.5 (square-root scaling).
 * @param {number} D - m
 * @param {number} Q - kg
 * @param {number} [chargeExponent=0.5]
 * @returns {number} m/kg^e (NaN when inputs invalid)
 */
export function scaledDistance(D, Q, chargeExponent) {
    var e = (chargeExponent != null && chargeExponent > 0) ? chargeExponent : 0.5;
    if (!(D > 0) || !(Q > 0)) return NaN;
    return D / Math.pow(Q, e);
}

/**
 * Largest charge Q (kg) such that PPV(D, Q) ≤ targetPPV.
 *   SD_target = (K / target)^(1/B);  Q = (D / SD_target)^(1/e)
 *
 * @param {number} D          - distance (m)
 * @param {number} targetPPV  - mm/s
 * @param {Object} [params]   - { K=1140, B=1.6, chargeExponent=0.5 }
 * @returns {number} kg (0 when target/inputs invalid)
 */
export function maxAllowableCharge(D, targetPPV, params) {
    params = params || {};
    var K = params.K != null ? params.K : 1140;
    var B = params.B != null ? params.B : 1.6;
    var e = params.chargeExponent != null ? params.chargeExponent : 0.5;
    if (!(D > 0) || !(targetPPV > 0) || !(K > 0) || !(B > 0) || !(e > 0)) return 0;
    var SDt = Math.pow(K / targetPPV, 1 / B);
    return Math.pow(D / SDt, 1 / e);
}

/**
 * Distance (m) at which a charge Q produces exactly targetPPV.
 * @param {number} Q
 * @param {number} targetPPV
 * @param {Object} [params]
 * @returns {number}
 */
export function distanceForPPV(Q, targetPPV, params) {
    params = params || {};
    var K = params.K != null ? params.K : 1140;
    var B = params.B != null ? params.B : 1.6;
    var e = params.chargeExponent != null ? params.chargeExponent : 0.5;
    if (!(Q > 0) || !(targetPPV > 0)) return 0;
    return Math.pow(K / targetPPV, 1 / B) * Math.pow(Q, e);
}

/**
 * Fit PPV = K·SD^(−B) by least squares on log10(PPV) vs log10(SD).
 *
 * @param {Array<Object>} observations - [{ D, Q, Tran?, Vert?, Long?, VPPV?, PVS? }]
 * @param {Object} [opts]
 * @param {string} [opts.axis='VPPV']       - 'Tran' | 'Vert' | 'Long' | 'VPPV' | 'PVS'
 * @param {number} [opts.chargeExponent=0.5]
 * @returns {Object|null} { n, K50, K90, K95, B, RSQ, stderrLog, slope, intercept, points, axis, chargeExponent }
 *   points[i] = { sd, ppv, logSD, logPPV, residualLog, isOutlier, obs }
 */
export function fitSiteLaw(observations, opts) {
    opts = opts || {};
    var axis = opts.axis || "VPPV";
    var e = (opts.chargeExponent != null && opts.chargeExponent > 0) ? opts.chargeExponent : 0.5;
    if (!Array.isArray(observations) || observations.length === 0) return null;

    var points = [];
    for (var i = 0; i < observations.length; i++) {
        var o = observations[i];
        var sd = scaledDistance(o.D, o.Q, e);
        var ppv;
        if (axis === "VPPV") {
            if (o.VPPV != null && o.VPPV > 0) ppv = o.VPPV; else continue;
        } else if (axis === "PVS") {
            if (o.PVS != null && o.PVS > 0) ppv = o.PVS;
            else if (o.Tran != null && o.Vert != null && o.Long != null) ppv = Math.sqrt(o.Tran * o.Tran + o.Vert * o.Vert + o.Long * o.Long);
            else continue;
        } else {
            ppv = o[axis];
        }
        if (!(sd > 0 && ppv > 0 && isFinite(sd) && isFinite(ppv))) continue;
        points.push({ sd: sd, ppv: ppv, logSD: Math.log10(sd), logPPV: Math.log10(ppv), obs: o });
    }
    var n = points.length;
    if (n < 3) return null;

    var sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (var j = 0; j < n; j++) {
        sx += points[j].logSD; sy += points[j].logPPV;
        sxx += points[j].logSD * points[j].logSD;
        sxy += points[j].logSD * points[j].logPPV;
    }
    var denom = n * sxx - sx * sx;
    if (!(denom > 0)) return null;
    var slope = (n * sxy - sx * sy) / denom;
    var intercept = (sy - slope * sx) / n;
    var K50 = Math.pow(10, intercept);
    var B = -slope;

    var meanY = sy / n, ssRes = 0, ssTot = 0;
    for (var k = 0; k < n; k++) {
        var yhat = intercept + slope * points[k].logSD;
        var res = points[k].logPPV - yhat;
        points[k].residualLog = res;
        ssRes += res * res;
        ssTot += (points[k].logPPV - meanY) * (points[k].logPPV - meanY);
    }
    var RSQ = (ssTot > 0) ? (1 - ssRes / ssTot) : 0;
    var stderrLog = (n > 2) ? Math.sqrt(ssRes / (n - 2)) : 0;
    for (var m = 0; m < n; m++) points[m].isOutlier = Math.abs(points[m].residualLog) > 2 * stderrLog;

    var K90 = K50 * Math.pow(10, 1.282 * stderrLog);
    var K95 = K50 * Math.pow(10, 1.645 * stderrLog);
    return {
        n: n, K50: K50, K90: K90, K95: K95, B: B, RSQ: RSQ,
        stderrLog: stderrLog, slope: slope, intercept: intercept,
        points: points, axis: axis, chargeExponent: e
    };
}
