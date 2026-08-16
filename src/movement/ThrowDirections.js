/**
 * ThrowDirections.js — Timing-gradient throw directions per hole
 *
 * Author: Brent Buffham — blastingapps.com & kirra-design.com
 * License: MIT
 *
 * For each hole, least-squares fit fireT = a + gx·x + gy·y over neighbours
 * within a radius (2.6 × median nearest-neighbour spacing). The throw
 * direction is −∇t: from late-firing toward early-firing ground — i.e. toward
 * the relief that has already fired. Flat timing → zero vector (callers fall
 * back to radial-from-hole).
 *
 * Ported from the Kirra blast-throw simulator (computeThrowDirections).
 */

/**
 * Median-ish nearest-neighbour spacing (mean of nearest distances over the
 * first 100 holes).
 * @param {Array<{cx:number, cy:number}>} holes
 * @returns {number} metres (5 when undeterminable)
 */
export function estimateSpacing(holes) {
    var n = holes.length;
    var minD2Sum = 0, cnt = 0;
    for (var i = 0; i < Math.min(n, 100); i++) {
        var best = Infinity;
        for (var j = 0; j < n; j++) {
            if (i === j) continue;
            var dx = holes[i].cx - holes[j].cx, dy = holes[i].cy - holes[j].cy;
            var d2 = dx * dx + dy * dy;
            if (d2 < best) best = d2;
        }
        if (best < Infinity) { minD2Sum += Math.sqrt(best); cnt++; }
    }
    return cnt ? minD2Sum / cnt : 5;
}

/**
 * Compute per-hole unit throw directions from the timing gradient.
 *
 * @param {Array<{cx:number, cy:number, fireT:number}>} holes - fireT in seconds (or ms — consistent units)
 * @param {Object} [opts]
 * @param {number} [opts.radiusFactor=2.6] - neighbour radius = factor × spacing
 * @param {number} [opts.radius]           - explicit neighbour radius (m), overrides factor
 * @returns {Array<{ thDirX: number, thDirY: number, gx: number, gy: number, neighbours: number }>}
 *   Also writes thDirX/thDirY onto each hole object.
 */
export function computeThrowDirections(holes, opts) {
    opts = opts || {};
    var n = holes.length;
    var out = new Array(n);
    if (!n) return out;
    var R = opts.radius > 0 ? opts.radius : (opts.radiusFactor > 0 ? opts.radiusFactor : 2.6) * estimateSpacing(holes);
    var R2 = R * R;
    for (var i = 0; i < n; i++) {
        var hi = holes[i];
        var sxx = 0, sxy = 0, syy = 0, sxt = 0, syt = 0, m = 0;
        for (var j = 0; j < n; j++) {
            var dx = holes[j].cx - hi.cx, dy = holes[j].cy - hi.cy;
            var d2 = dx * dx + dy * dy;
            if (d2 > R2) continue;
            var dt = holes[j].fireT - hi.fireT;
            sxx += dx * dx; sxy += dx * dy; syy += dy * dy;
            sxt += dx * dt; syt += dy * dt;
            m++;
        }
        var gx = 0, gy = 0;
        var det = sxx * syy - sxy * sxy;
        if (m >= 3 && Math.abs(det) > 1e-9) {
            gx = (syy * sxt - sxy * syt) / det;
            gy = (sxx * syt - sxy * sxt) / det;
        }
        var gm = Math.sqrt(gx * gx + gy * gy);
        var tx = 0, ty = 0;
        if (gm > 1e-7) { tx = -gx / gm; ty = -gy / gm; }
        hi.thDirX = tx; hi.thDirY = ty;
        out[i] = { thDirX: tx, thDirY: ty, gx: gx, gy: gy, neighbours: m };
    }
    return out;
}
