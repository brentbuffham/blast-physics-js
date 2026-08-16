/**
 * Displacement.js — Results extraction for the blast movement simulator
 *
 * Author: Brent Buffham — blastingapps.com & kirra-design.com
 * License: MIT
 *
 *   displacementVectors(S, origin)      — per-block in-situ → final vectors (world coords)
 *   centreOfMassShift(S)                — volume-weighted horizontal CoM shift (m, bearing)
 *   swellPrescribed(S) / swellEmergent(S) — achieved bulk swell factors
 *   muckpileHeightfield(S, origin, cell)— settled pile top-of-block raster + surface object
 *   surveyTargets(surfaces)             — swell + CoM throw from PREBLAST_VOLUME / SHELL / POSTBLAST meshes
 *
 * Ported from the Kirra blast-throw simulator (STEP 20 back-calculation).
 */

import { ST_INACTIVE } from "./SphereDEM.js";
import { calibrationGrid, rasterTop, columnThickness, surfaceFromHeightfield } from "./SurfaceMesh.js";

/**
 * Per-block displacement vectors in world coordinates.
 * @param {Object} S      - particle state
 * @param {{x,y,z}} origin
 * @param {Object} [opts] - { firedOnly=true }
 * @returns {{ count, index: Int32Array, x0,y0,z0, x1,y1,z1, dx,dy,dz, dist }} Float64Arrays
 */
export function displacementVectors(S, origin, opts) {
    opts = opts || {};
    var firedOnly = opts.firedOnly !== false;
    var idx = [];
    for (var i = 0; i < S.N; i++) if (!firedOnly || S.state[i] !== ST_INACTIVE) idx.push(i);
    var n = idx.length;
    var out = {
        count: n, index: Int32Array.from(idx),
        x0: new Float64Array(n), y0: new Float64Array(n), z0: new Float64Array(n),
        x1: new Float64Array(n), y1: new Float64Array(n), z1: new Float64Array(n),
        dx: new Float64Array(n), dy: new Float64Array(n), dz: new Float64Array(n),
        dist: new Float64Array(n)
    };
    for (var k = 0; k < n; k++) {
        var i2 = idx[k];
        out.x0[k] = S.ox[i2] + origin.x; out.y0[k] = S.oy[i2] + origin.y; out.z0[k] = S.oz[i2] + origin.z;
        out.x1[k] = S.px[i2] + origin.x; out.y1[k] = S.py[i2] + origin.y; out.z1[k] = S.pz[i2] + origin.z;
        out.dx[k] = S.px[i2] - S.ox[i2]; out.dy[k] = S.py[i2] - S.oy[i2]; out.dz[k] = S.pz[i2] - S.oz[i2];
        out.dist[k] = Math.sqrt(out.dx[k] * out.dx[k] + out.dy[k] * out.dy[k] + out.dz[k] * out.dz[k]);
    }
    return out;
}

/**
 * Volume-weighted (∝ r³) horizontal centre-of-mass shift of fired blocks.
 * @param {Object} S
 * @returns {{ D: number, dx: number, dy: number, bearing: number, count: number }} bearing: 0=N clockwise
 */
export function centreOfMassShift(S) {
    var sx = 0, sy = 0, sw = 0, n = 0;
    for (var i = 0; i < S.N; i++) {
        if (S.state[i] === ST_INACTIVE) continue;
        var w = S.baseRad[i] * S.baseRad[i] * S.baseRad[i];
        sx += w * (S.px[i] - S.ox[i]); sy += w * (S.py[i] - S.oy[i]); sw += w; n++;
    }
    var dx = sw > 0 ? sx / sw : 0, dy = sw > 0 ? sy / sw : 0;
    return { D: Math.hypot(dx, dy), dx: dx, dy: dy, bearing: (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360, count: n };
}

/**
 * Prescribed swell actually reached: Σ rad³ / Σ baseRad³ over fired blocks.
 * @param {Object} S
 * @returns {number}
 */
export function swellPrescribed(S) {
    var vSum = 0, vBase = 0;
    for (var i = 0; i < S.N; i++) {
        if (S.state[i] === ST_INACTIVE) continue;
        vSum += S.rad[i] * S.rad[i] * S.rad[i];
        vBase += S.baseRad[i] * S.baseRad[i] * S.baseRad[i];
    }
    return vBase > 0 ? vSum / vBase : 1;
}

/**
 * Emergent swell: settled bulk volume (occupied 2 m columns × height span)
 * vs packed in-situ volume of fired blocks.
 * @param {Object} S
 * @param {number} [cell=2]
 * @returns {number|null}
 */
export function swellEmergent(S, cell) {
    if (!S.N) return null;
    cell = cell > 0 ? cell : 2.0;
    var occ = new Map();
    var insituV = 0;
    for (var i = 0; i < S.N; i++) {
        if (S.state[i] === ST_INACTIVE) continue;
        var r = S.baseRad[i];
        insituV += (4 / 3) * Math.PI * r * r * r * 0.68;
        var k = Math.floor(S.px[i] / cell) + "|" + Math.floor(S.py[i] / cell);
        var e = occ.get(k);
        if (!e) occ.set(k, { lo: S.pz[i], hi: S.pz[i] });
        else { if (S.pz[i] < e.lo) e.lo = S.pz[i]; if (S.pz[i] > e.hi) e.hi = S.pz[i]; }
    }
    var bulkV = 0;
    occ.forEach(function (e) { bulkV += (e.hi - e.lo + 2 * S.baseR) * cell * cell; });
    return insituV > 0 ? bulkV / insituV : null;
}

/**
 * Raster of the settled pile: highest block top per column (world coords).
 * @param {Object} S
 * @param {{x,y,z}} origin
 * @param {number} [cell=2]
 * @param {Object} [opts] - { pad=10, name='POSTBLAST_SIM', firedOnly=true }
 * @returns {{ grid: {gx0,gy0,cell,nx,ny}, z: Float64Array, surface: Object|null }}
 */
export function muckpileHeightfield(S, origin, cell, opts) {
    opts = opts || {};
    cell = cell > 0 ? cell : 2;
    var pad = opts.pad != null ? opts.pad : 10;
    var firedOnly = opts.firedOnly !== false;
    var mnX = Infinity, mnY = Infinity, mxX = -Infinity, mxY = -Infinity;
    for (var i = 0; i < S.N; i++) {
        if (firedOnly && S.state[i] === ST_INACTIVE) continue;
        var x = S.px[i] + origin.x, y = S.py[i] + origin.y;
        if (x < mnX) mnX = x; if (x > mxX) mxX = x; if (y < mnY) mnY = y; if (y > mxY) mxY = y;
    }
    if (mnX === Infinity) return { grid: null, z: new Float64Array(0), surface: null };
    var G = { gx0: mnX - pad, gy0: mnY - pad, cell: cell, nx: Math.ceil((mxX - mnX + 2 * pad) / cell) + 1, ny: Math.ceil((mxY - mnY + 2 * pad) / cell) + 1 };
    var z = new Float64Array(G.nx * G.ny).fill(-1e9);
    for (var k = 0; k < S.N; k++) {
        if (firedOnly && S.state[k] === ST_INACTIVE) continue;
        var wx = S.px[k] + origin.x, wy = S.py[k] + origin.y, top = S.pz[k] + origin.z + S.rad[k];
        var ci = Math.floor((wx - G.gx0) / cell), cj = Math.floor((wy - G.gy0) / cell);
        if (ci < 0 || ci >= G.nx || cj < 0 || cj >= G.ny) continue;
        var q = cj * G.nx + ci;
        if (top > z[q]) z[q] = top;
    }
    var surface = surfaceFromHeightfield(z, G, { name: opts.name || "POSTBLAST_SIM", nodata: -1e8 });
    return { grid: G, z: z, surface: surface };
}

/**
 * Survey targets for calibration: swell and CoM throw from meshes.
 * Needs volumes (role 'voxelblk'), a base (role 'shell' or 'shelltopo') and a
 * reference (role 'reference' — the surveyed post-blast muckpile).
 *
 * @param {Array} surfaces
 * @param {Object} [opts] - { pad=40, cell=2, minDepth=0.3 }
 * @returns {{ swell, insituVol, muckVol, D, dx, dy, bearing }|{ err: string }}
 */
export function surveyTargets(surfaces, opts) {
    opts = opts || {};
    var refs = surfaces.filter(function (x) { return x.role === "reference"; });
    var vols = surfaces.filter(function (x) { return x.role === "voxelblk"; });
    var bases = surfaces.filter(function (x) { return x.role === "shell" || x.role === "shelltopo"; });
    if (!refs.length) return { err: "No POSTBLAST reference surface." };
    if (!vols.length) return { err: "No blast volume surface (PREBLAST_VOLUME / VOXEL-BLK*)." };
    var G = calibrationGrid(vols, opts.pad != null ? opts.pad : 40, opts.cell > 0 ? opts.cell : 2);
    var zPost = rasterTop(refs, G);
    var zPre = bases.length ? rasterTop(bases, G) : null;
    var VC = columnThickness(vols, G);
    var minDepth = opts.minDepth != null ? opts.minDepth : 0.3;
    var insitu = 0, muck = 0, vX = 0, vY = 0, mX = 0, mY = 0;
    for (var j = 0; j < G.ny; j++) for (var i = 0; i < G.nx; i++) {
        var q = j * G.nx + i;
        var x = G.gx0 + (i + 0.5) * G.cell, y = G.gy0 + (j + 0.5) * G.cell;
        if (VC.thick[q] > 0) { insitu += VC.thick[q]; vX += VC.thick[q] * x; vY += VC.thick[q] * y; }
        if (zPost[q] > -1e8) {
            var base = VC.thick[q] > 0 ? VC.zbot[q] : (zPre && zPre[q] > -1e8 ? zPre[q] : null);
            if (base !== null) {
                var d = zPost[q] - base;
                if (d > minDepth) { muck += d; mX += d * x; mY += d * y; }
            }
        }
    }
    if (insitu <= 0 || muck <= 0) return { err: "Column rasterisation found no overlap." };
    var dx = mX / muck - vX / insitu, dy = mY / muck - vY / insitu;
    var A = G.cell * G.cell;
    return { swell: muck / insitu, insituVol: insitu * A, muckVol: muck * A, D: Math.hypot(dx, dy), dx: dx, dy: dy,
             bearing: (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360, grid: G };
}
