/**
 * Voxeliser.js — Fill closed volume meshes (or a hole bounding box) with voxel centres
 *
 * Author: Brent Buffham — blastingapps.com & kirra-design.com
 * License: MIT
 *
 * Column ray-cast fill: volume triangles are binned into an XY grid, a
 * vertical ray is cast per column, and voxels are placed between crossing
 * pairs (even–odd rule). Near-identical crossings on shared edges are
 * cancelled so seams don't produce phantom shells.
 *
 * Ported from the Kirra blast-throw simulator (voxeliseVolumes / generateVoxels).
 */

/**
 * Voxelise closed volume surfaces at resolution res (m).
 *
 * @param {Array}  volumes - surfaces with role 'voxelblk' ({ pos, idx, np, nt })
 * @param {number} res     - voxel edge (m)
 * @returns {{ positions: Float64Array, count: number, bboxMinZ: number, bbox: Object }|null}
 *   positions: world xyz triples
 */
export function voxeliseVolumes(volumes, res) {
    if (!volumes || !volumes.length) return null;
    var nt = 0;
    for (var v = 0; v < volumes.length; v++) nt += volumes[v].nt;
    if (!nt) return null;

    var T = new Float64Array(nt * 9);
    var o = 0;
    var minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (var vi = 0; vi < volumes.length; vi++) {
        var m = volumes[vi];
        for (var t = 0; t < m.nt; t++) {
            for (var k = 0; k < 3; k++) {
                var pi = m.idx[t * 3 + k] * 3;
                var x = m.pos[pi], y = m.pos[pi + 1], z = m.pos[pi + 2];
                T[o++] = x; T[o++] = y; T[o++] = z;
                if (x < minX) minX = x; if (x > maxX) maxX = x;
                if (y < minY) minY = y; if (y > maxY) maxY = y;
                if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
            }
        }
    }

    // XY-bin the triangles
    var cell = Math.max(res, 2);
    var bnx = Math.max(1, Math.ceil((maxX - minX) / cell) + 1);
    var bny = Math.max(1, Math.ceil((maxY - minY) / cell) + 1);
    var nCells = bnx * bny;
    var counts = new Int32Array(nCells + 1);
    var span = function (t) {
        var q = t * 9;
        var x0 = Math.min(T[q], T[q + 3], T[q + 6]), x1 = Math.max(T[q], T[q + 3], T[q + 6]);
        var y0 = Math.min(T[q + 1], T[q + 4], T[q + 7]), y1 = Math.max(T[q + 1], T[q + 4], T[q + 7]);
        return [
            Math.max(0, Math.floor((x0 - minX) / cell)), Math.min(bnx - 1, Math.floor((x1 - minX) / cell)),
            Math.max(0, Math.floor((y0 - minY) / cell)), Math.min(bny - 1, Math.floor((y1 - minY) / cell))
        ];
    };
    for (var t1 = 0; t1 < nt; t1++) { var s1 = span(t1); for (var i = s1[0]; i <= s1[1]; i++) for (var j = s1[2]; j <= s1[3]; j++) counts[j * bnx + i]++; }
    var sum = 0;
    for (var c = 0; c < nCells; c++) { sum += counts[c]; counts[c] = sum; }
    counts[nCells] = sum;
    var tIdx = new Int32Array(sum);
    for (var t2 = 0; t2 < nt; t2++) { var s2 = span(t2); for (var i2 = s2[0]; i2 <= s2[1]; i2++) for (var j2 = s2[2]; j2 <= s2[3]; j2++) { var c3 = j2 * bnx + i2; counts[c3]--; tIdx[counts[c3]] = t2; } }

    // Column ray-cast fill
    var eps = 1e-4;
    var zHits = [];
    var out = [];
    for (var gx = minX + res / 2; gx <= maxX; gx += res) {
        for (var gy = minY + res / 2; gy <= maxY; gy += res) {
            var px = gx + eps, py = gy + eps;
            var ci = Math.floor((px - minX) / cell), cj = Math.floor((py - minY) / cell);
            if (ci < 0 || ci >= bnx || cj < 0 || cj >= bny) continue;
            var c2 = cj * bnx + ci;
            var s0 = counts[c2], sEnd = counts[c2 + 1];
            if (s0 === sEnd) continue;
            zHits.length = 0;
            for (var kk = s0; kk < sEnd; kk++) {
                var q = tIdx[kk] * 9;
                var ax = T[q], ay = T[q + 1], az = T[q + 2];
                var bx = T[q + 3], by = T[q + 4], bz = T[q + 5];
                var cx = T[q + 6], cy = T[q + 7], cz = T[q + 8];
                var d00 = bx - ax, d01 = by - ay, d10 = cx - ax, d11 = cy - ay;
                var det = d00 * d11 - d01 * d10;
                if (Math.abs(det) < 1e-12) continue;
                var lx = px - ax, ly = py - ay;
                var u = (lx * d11 - ly * d10) / det;
                var w = (ly * d00 - lx * d01) / det;
                if (u < 0 || w < 0 || u + w > 1) continue;
                zHits.push(az + u * (bz - az) + w * (cz - az));
            }
            if (zHits.length < 2) continue;
            zHits.sort(function (a, b) { return a - b; });
            var wr = 0;
            for (var h = 0; h < zHits.length; h++) {
                if (wr > 0 && Math.abs(zHits[h] - zHits[wr - 1]) < 1e-6) { wr--; continue; }
                zHits[wr++] = zHits[h];
            }
            for (var p = 0; p + 1 < wr; p += 2) {
                var z0 = zHits[p], z1 = zHits[p + 1];
                for (var zz = z0 + res / 2; zz < z1; zz += res) out.push(gx, gy, zz);
            }
        }
    }
    return { positions: Float64Array.from(out), count: out.length / 3, bboxMinZ: minZ,
             bbox: { minX: minX, minY: minY, minZ: minZ, maxX: maxX, maxY: maxY, maxZ: maxZ } };
}

/**
 * Voxelise closed volumes, auto-coarsening the resolution so the count stays
 * within maxVoxels.
 * @param {Array}  volumes
 * @param {number} res
 * @param {number} maxVoxels
 * @returns {{ positions, count, bboxMinZ, bbox, res }|null}
 */
export function voxeliseVolumesBudget(volumes, res, maxVoxels) {
    var result = voxeliseVolumes(volumes, res);
    var vres = res;
    if (result && maxVoxels > 0 && result.count > maxVoxels) {
        var factor = Math.cbrt(result.count / maxVoxels) * 1.03;
        vres = res * factor;
        result = voxeliseVolumes(volumes, vres);
        // Guard: still over budget after one pass (thin volumes) — coarsen again
        var guard = 0;
        while (result && result.count > maxVoxels && guard++ < 4) {
            vres *= Math.cbrt(result.count / maxVoxels) * 1.03;
            result = voxeliseVolumes(volumes, vres);
        }
    }
    if (result) result.res = vres;
    return result;
}

/**
 * Fallback fill: a regular lattice inside the padded hole bounding box.
 * @param {Array}  holes  - HoleEntry[] (collar/toe)
 * @param {number} res
 * @param {Object} [opts] - { pad=5, padZ=0.5, maxVoxels }
 * @returns {{ positions: Float64Array, count, bboxMinZ, bbox, res }}
 */
export function voxeliseHoleBBox(holes, res, opts) {
    opts = opts || {};
    var pad = opts.pad != null ? opts.pad : 5, padZ = opts.padZ != null ? opts.padZ : 0.5;
    var maxVox = opts.maxVoxels > 0 ? opts.maxVoxels : Infinity;
    var xn = Infinity, xx = -Infinity, yn = Infinity, yx = -Infinity, zn = Infinity, zx = -Infinity;
    for (var i = 0; i < holes.length; i++) {
        var h = holes[i];
        xn = Math.min(xn, h.collarX, h.toeX); xx = Math.max(xx, h.collarX, h.toeX);
        yn = Math.min(yn, h.collarY, h.toeY); yx = Math.max(yx, h.collarY, h.toeY);
        zn = Math.min(zn, h.collarZ, h.toeZ); zx = Math.max(zx, h.collarZ, h.toeZ);
    }
    xn -= pad; xx += pad; yn -= pad; yx += pad; zn -= padZ; zx += padZ;
    var out = [];
    outer:
    for (var x = xn; x <= xx; x += res)
        for (var y = yn; y <= yx; y += res)
            for (var z = zn; z <= zx; z += res) {
                if (out.length / 3 >= maxVox) break outer;
                out.push(x, y, z);
            }
    return { positions: Float64Array.from(out), count: out.length / 3, bboxMinZ: zn, res: res,
             bbox: { minX: xn, minY: yn, minZ: zn, maxX: xx, maxY: yx, maxZ: zx } };
}
