/**
 * SurfaceMesh.js — Triangle-mesh helpers for the blast movement simulator
 *
 * Author: Brent Buffham — blastingapps.com & kirra-design.com
 * License: MIT
 *
 * Surfaces are { name, role, pos: Float64Array(np*3), idx: Uint32Array(nt*3), np, nt }
 * as produced by io/KAPReader.js. Roles: voxelblk | shell | shelltopo | reference | other.
 *
 *   surfaceBounds(surfaces)                → { minX … maxZ }
 *   flattenTriangles(surfaces, origin)     → Float32Array of world tris shifted by origin
 *   rasterTop(surfaces, grid)              → highest Z per XY column (Float64Array)
 *   columnThickness(volumes, grid)         → closed-volume thickness + bottom Z per column
 *   calibrationGrid(volumes, pad, cell)    → column grid covering the volumes
 *   surfaceFromHeightfield(...)            → Kirra-style { points, triangles } surface object
 */

/**
 * Bounding box of a set of surfaces.
 * @param {Array} surfaces
 * @returns {{minX,minY,minZ,maxX,maxY,maxZ}|null}
 */
export function surfaceBounds(surfaces) {
    var b = { minX: Infinity, minY: Infinity, minZ: Infinity, maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity };
    var any = false;
    for (var s = 0; s < surfaces.length; s++) {
        var pos = surfaces[s].pos;
        for (var i = 0; i < pos.length; i += 3) {
            any = true;
            var x = pos[i], y = pos[i + 1], z = pos[i + 2];
            if (x < b.minX) b.minX = x; if (x > b.maxX) b.maxX = x;
            if (y < b.minY) b.minY = y; if (y > b.maxY) b.maxY = y;
            if (z < b.minZ) b.minZ = z; if (z > b.maxZ) b.maxZ = z;
        }
    }
    return any ? b : null;
}

/**
 * Flatten indexed surfaces into a triangle soup shifted by an origin.
 * @param {Array} surfaces
 * @param {{x,y,z}} [origin]
 * @returns {Float32Array} 9 floats per triangle
 */
export function flattenTriangles(surfaces, origin) {
    var ox = origin ? origin.x : 0, oy = origin ? origin.y : 0, oz = origin ? origin.z : 0;
    var nt = 0;
    for (var s = 0; s < surfaces.length; s++) nt += surfaces[s].nt;
    var out = new Float32Array(nt * 9);
    var o = 0;
    for (var k = 0; k < surfaces.length; k++) {
        var surf = surfaces[k];
        for (var t = 0; t < surf.nt; t++) {
            for (var v = 0; v < 3; v++) {
                var vi = surf.idx[t * 3 + v] * 3;
                out[o++] = surf.pos[vi] - ox;
                out[o++] = surf.pos[vi + 1] - oy;
                out[o++] = surf.pos[vi + 2] - oz;
            }
        }
    }
    return out;
}

/**
 * Column grid covering the given surfaces plus a pad.
 * @param {Array} surfaces
 * @param {number} [pad=40]
 * @param {number} [cell=2]
 * @returns {{ gx0, gy0, cell, nx, ny }|null}
 */
export function calibrationGrid(surfaces, pad, cell) {
    var b = surfaceBounds(surfaces);
    if (!b) return null;
    pad = pad != null ? pad : 40;
    cell = cell > 0 ? cell : 2;
    return {
        gx0: b.minX - pad, gy0: b.minY - pad, cell: cell,
        nx: Math.ceil((b.maxX - b.minX + 2 * pad) / cell),
        ny: Math.ceil((b.maxY - b.minY + 2 * pad) / cell)
    };
}

/**
 * Rasterise the highest surface Z per column (−1e9 where empty).
 * @param {Array} surfaces
 * @param {{ gx0, gy0, cell, nx, ny }} G
 * @returns {Float64Array} nx*ny
 */
export function rasterTop(surfaces, G) {
    var out = new Float64Array(G.nx * G.ny).fill(-1e9);
    for (var s = 0; s < surfaces.length; s++) {
        var m = surfaces[s];
        for (var t = 0; t < m.nt; t++) {
            var a = m.idx[t * 3] * 3, b = m.idx[t * 3 + 1] * 3, c = m.idx[t * 3 + 2] * 3;
            var ax = m.pos[a], ay = m.pos[a + 1], az = m.pos[a + 2];
            var bx = m.pos[b], by = m.pos[b + 1], bz = m.pos[b + 2];
            var cx = m.pos[c], cy = m.pos[c + 1], cz = m.pos[c + 2];
            var det = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
            if (Math.abs(det) < 1e-12) continue;
            var i0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) - G.gx0) / G.cell));
            var i1 = Math.min(G.nx - 1, Math.floor((Math.max(ax, bx, cx) - G.gx0) / G.cell));
            var j0 = Math.max(0, Math.floor((Math.min(ay, by, cy) - G.gy0) / G.cell));
            var j1 = Math.min(G.ny - 1, Math.floor((Math.max(ay, by, cy) - G.gy0) / G.cell));
            for (var j = j0; j <= j1; j++) for (var i = i0; i <= i1; i++) {
                var px = G.gx0 + (i + 0.5) * G.cell, py = G.gy0 + (j + 0.5) * G.cell;
                var u = ((px - ax) * (cy - ay) - (py - ay) * (cx - ax)) / det;
                var v = ((py - ay) * (bx - ax) - (px - ax) * (by - ay)) / det;
                if (u < -0.001 || v < -0.001 || u + v > 1.001) continue;
                var z = az + u * (bz - az) + v * (cz - az);
                var q = j * G.nx + i;
                if (z > out[q]) out[q] = z;
            }
        }
    }
    return out;
}

/**
 * Per-column solid thickness and bottom Z of closed volume meshes (even–odd
 * crossings along the vertical ray through each column centre).
 * @param {Array} volumes
 * @param {{ gx0, gy0, cell, nx, ny }} G
 * @returns {{ thick: Float64Array, zbot: Float64Array }}
 */
export function columnThickness(volumes, G) {
    var lists = new Array(G.nx * G.ny);
    for (var s = 0; s < volumes.length; s++) {
        var m = volumes[s];
        for (var t = 0; t < m.nt; t++) {
            var a = m.idx[t * 3] * 3, b = m.idx[t * 3 + 1] * 3, c = m.idx[t * 3 + 2] * 3;
            var ax = m.pos[a], ay = m.pos[a + 1], az = m.pos[a + 2];
            var bx = m.pos[b], by = m.pos[b + 1], bz = m.pos[b + 2];
            var cx = m.pos[c], cy = m.pos[c + 1], cz = m.pos[c + 2];
            var det = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
            if (Math.abs(det) < 1e-12) continue;
            var i0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) - G.gx0) / G.cell));
            var i1 = Math.min(G.nx - 1, Math.floor((Math.max(ax, bx, cx) - G.gx0) / G.cell));
            var j0 = Math.max(0, Math.floor((Math.min(ay, by, cy) - G.gy0) / G.cell));
            var j1 = Math.min(G.ny - 1, Math.floor((Math.max(ay, by, cy) - G.gy0) / G.cell));
            for (var j = j0; j <= j1; j++) for (var i = i0; i <= i1; i++) {
                var px = G.gx0 + (i + 0.5) * G.cell + 1e-4, py = G.gy0 + (j + 0.5) * G.cell + 1e-4;
                var u = ((px - ax) * (cy - ay) - (py - ay) * (cx - ax)) / det;
                var v = ((py - ay) * (bx - ax) - (px - ax) * (by - ay)) / det;
                if (u < 0 || v < 0 || u + v > 1) continue;
                var q = j * G.nx + i;
                if (!lists[q]) lists[q] = [];
                lists[q].push(az + u * (bz - az) + v * (cz - az));
            }
        }
    }
    var thick = new Float64Array(G.nx * G.ny), zbot = new Float64Array(G.nx * G.ny).fill(1e9);
    for (var q2 = 0; q2 < G.nx * G.ny; q2++) {
        var L = lists[q2]; if (!L || L.length < 2) continue;
        L.sort(function (x, y) { return x - y; });
        var w = 0;
        for (var k = 0; k < L.length; k++) { if (w > 0 && Math.abs(L[k] - L[w - 1]) < 1e-6) { w--; continue; } L[w++] = L[k]; }
        for (var k2 = 0; k2 + 1 < w; k2 += 2) { thick[q2] += L[k2 + 1] - L[k2]; if (L[k2] < zbot[q2]) zbot[q2] = L[k2]; }
    }
    return { thick: thick, zbot: zbot };
}

/**
 * Build a Kirra-style triangulated surface object from a heightfield.
 * Cells with z <= NODATA are skipped.
 * @param {Float64Array|Float32Array} z  - nx*ny values
 * @param {{ gx0, gy0, cell, nx, ny }} G
 * @param {Object} [opts] - { name, nodata=-1e8, id }
 * @returns {{ id, name, type:'triangulated', points:[{x,y,z}], triangles:[{a,b,c}], pos: Float64Array, idx: Uint32Array, np, nt }|null}
 */
export function surfaceFromHeightfield(z, G, opts) {
    opts = opts || {};
    var nodata = opts.nodata != null ? opts.nodata : -1e8;
    var pointIndex = new Int32Array(G.nx * G.ny).fill(-1);
    var points = [];
    for (var j = 0; j < G.ny; j++) for (var i = 0; i < G.nx; i++) {
        var q = j * G.nx + i;
        if (z[q] <= nodata) continue;
        pointIndex[q] = points.length;
        points.push({ x: G.gx0 + (i + 0.5) * G.cell, y: G.gy0 + (j + 0.5) * G.cell, z: z[q] });
    }
    var tris = [];
    for (var jj = 0; jj < G.ny - 1; jj++) for (var ii = 0; ii < G.nx - 1; ii++) {
        var p00 = pointIndex[jj * G.nx + ii], p10 = pointIndex[jj * G.nx + ii + 1];
        var p01 = pointIndex[(jj + 1) * G.nx + ii], p11 = pointIndex[(jj + 1) * G.nx + ii + 1];
        if (p00 >= 0 && p10 >= 0 && p01 >= 0) tris.push({ a: p00, b: p10, c: p01 });
        if (p10 >= 0 && p11 >= 0 && p01 >= 0) tris.push({ a: p10, b: p11, c: p01 });
    }
    if (!tris.length) return null;
    var pos = new Float64Array(points.length * 3), idx = new Uint32Array(tris.length * 3);
    for (var p = 0; p < points.length; p++) { pos[p * 3] = points[p].x; pos[p * 3 + 1] = points[p].y; pos[p * 3 + 2] = points[p].z; }
    for (var t = 0; t < tris.length; t++) { idx[t * 3] = tris[t].a; idx[t * 3 + 1] = tris[t].b; idx[t * 3 + 2] = tris[t].c; }
    return { id: opts.id || (opts.name || "surface"), name: opts.name || "Heightfield", type: "triangulated",
             points: points, triangles: tris, pos: pos, idx: idx, np: points.length, nt: tris.length, visible: true };
}
