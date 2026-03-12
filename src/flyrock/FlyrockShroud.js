/**
 * FlyrockShroud.js — Flyrock shroud heightfield grid and triangle mesh generation
 *
 * Author: Brent Buffham — blastingapps.com & kirra-design.com
 * License: MIT
 *
 * Directly ported from Kirra's flyrockWorker.js (shroud computation logic only).
 * Generates a 3D parabolic dome (Chernigovskii envelope) above each hole's
 * collar position, then triangulates the resulting heightfield.
 *
 * Reference: flyrockWorker.js in Kirra
 */

import { envelopeAltitude } from "./FlyrockTrajectory.js";

var GRAVITY = 9.80665;

/**
 * Check if a triangle normal passes the angle cull test.
 * Discards nearly-vertical triangles (too steep for a flyrock dome).
 *
 * @param {{ x,y,z }} v0
 * @param {{ x,y,z }} v1
 * @param {{ x,y,z }} v2
 * @param {number} cosEndAngle - cos(endAngleDeg)
 * @returns {boolean}
 */
function passesAngleCull(v0, v1, v2, cosEndAngle) {
    var e1x = v1.x - v0.x, e1y = v1.y - v0.y, e1z = v1.z - v0.z;
    var e2x = v2.x - v0.x, e2y = v2.y - v0.y, e2z = v2.z - v0.z;

    var nx = e1y * e2z - e1z * e2y;
    var ny = e1z * e2x - e1x * e2z;
    var nz = e1x * e2y - e1y * e2x;

    var len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (len < 1e-10) return false;

    return Math.abs(nz) / len >= cosEndAngle;
}

/**
 * Generate a flyrock shroud surface from pre-computed hole data.
 *
 * @param {Array}  holeData - Array of { cx, cy, cz, maxDistance, maxVelocity, holeID }
 * @param {Object} params
 * @param {number} [params.iterations=40]       - Grid resolution hint
 * @param {number} [params.endAngleDeg=85]      - Max zenith angle for triangles
 * @param {number} [params.extendBelowCollar=0] - Extend shroud below collar elevation (m)
 * @param {string} [params.algorithm='richardsMoore'] - For surface metadata only
 * @param {number} [params.factorOfSafety=2]
 * @param {number} [params.transparency=0.5]
 * @param {Function} [onProgress]               - Optional (percent, message) callback
 * @returns {Object|null} Surface object, or null if no triangles
 */
export function generateFlyrockShroud(holeData, params, onProgress) {
    var progress = onProgress || function () {};
    if (!holeData || holeData.length === 0) return null;

    var iterations = params.iterations || 40;
    var endAngleDeg = params.endAngleDeg !== undefined ? params.endAngleDeg : 85;
    var extendBelowCollar = params.extendBelowCollar || 0;
    var algorithm = params.algorithm || "richardsMoore";
    var transparency = params.transparency !== undefined ? params.transparency : 0.5;

    progress(5, "Computing grid bounds for " + holeData.length + " holes...");

    // Compute grid bounding box
    var overallMaxDist = 0;
    var gridMinX = Infinity, gridMaxX = -Infinity;
    var gridMinY = Infinity, gridMaxY = -Infinity;

    for (var i = 0; i < holeData.length; i++) {
        var hd = holeData[i];
        var padding = hd.maxDistance;
        if (extendBelowCollar > 0) {
            var V2 = hd.maxVelocity * hd.maxVelocity;
            var extRadius = (hd.maxVelocity / GRAVITY) * Math.sqrt(V2 + 2 * GRAVITY * extendBelowCollar);
            if (extRadius > padding) padding = extRadius;
        }
        if (padding > overallMaxDist) overallMaxDist = padding;
        if (hd.cx - padding < gridMinX) gridMinX = hd.cx - padding;
        if (hd.cx + padding > gridMaxX) gridMaxX = hd.cx + padding;
        if (hd.cy - padding < gridMinY) gridMinY = hd.cy - padding;
        if (hd.cy + padding > gridMaxY) gridMaxY = hd.cy + padding;
    }

    var gridSpacing = overallMaxDist / (iterations / 2);
    if (gridSpacing <= 0) gridSpacing = 1;

    var cols = Math.ceil((gridMaxX - gridMinX) / gridSpacing) + 1;
    var rows = Math.ceil((gridMaxY - gridMinY) / gridSpacing) + 1;

    // Safety cap
    var maxGridCells = 500;
    if (cols > maxGridCells || rows > maxGridCells) {
        var scaleDown = maxGridCells / Math.max(cols, rows);
        gridSpacing = gridSpacing / scaleDown;
        cols = Math.ceil((gridMaxX - gridMinX) / gridSpacing) + 1;
        rows = Math.ceil((gridMaxY - gridMinY) / gridSpacing) + 1;
    }

    progress(15, "Computing " + cols + "x" + rows + " grid...");

    // Compute grid Z values
    var gridZ = [];
    var gridInside = [];
    for (var r = 0; r < rows; r++) {
        gridZ.push(new Float64Array(cols));
        gridInside.push(new Uint8Array(cols));
    }

    var PROGRESS_EVERY = Math.max(1, Math.floor(rows / 20));

    for (var r = 0; r < rows; r++) {
        if (r % PROGRESS_EVERY === 0) {
            progress(15 + Math.floor((r / rows) * 60), "Row " + r + " / " + rows + "...");
        }

        var gy = gridMinY + r * gridSpacing;
        for (var c = 0; c < cols; c++) {
            var gx = gridMinX + c * gridSpacing;
            var bestAbsZ = -Infinity;
            var pointInside = false;

            for (var hi = 0; hi < holeData.length; hi++) {
                var hd = holeData[hi];
                var dx = gx - hd.cx;
                var dy = gy - hd.cy;
                var dist = Math.sqrt(dx * dx + dy * dy);

                var hV2 = hd.maxVelocity * hd.maxVelocity;
                var alt = (hV2 * hV2 - GRAVITY * GRAVITY * dist * dist) / (2 * GRAVITY * hV2);
                var minAlt = extendBelowCollar > 0 ? -extendBelowCollar : 0;

                if (alt >= minAlt) {
                    var absZ = hd.cz + alt;
                    if (absZ > bestAbsZ) bestAbsZ = absZ;
                    pointInside = true;
                }
            }

            gridZ[r][c] = pointInside ? bestAbsZ : 0;
            gridInside[r][c] = pointInside ? 1 : 0;
        }
    }

    progress(80, "Building triangles...");

    var allTriangles = [];
    var allPoints = [];
    var pointMap = {};

    function getOrCreatePoint(row, col) {
        var key = row + "," + col;
        if (pointMap[key] !== undefined) return pointMap[key];
        var px = gridMinX + col * gridSpacing;
        var py = gridMinY + row * gridSpacing;
        var pz = gridZ[row][col];
        var idx = allPoints.length;
        allPoints.push({ x: px, y: py, z: pz });
        pointMap[key] = idx;
        return idx;
    }

    var endAngleRad = endAngleDeg * (Math.PI / 180);
    var cosEndAngle = Math.cos(endAngleRad);

    for (var r = 0; r < rows - 1; r++) {
        for (var c = 0; c < cols - 1; c++) {
            var in00 = gridInside[r][c];
            var in10 = gridInside[r + 1][c];
            var in01 = gridInside[r][c + 1];
            var in11 = gridInside[r + 1][c + 1];

            if (in00 && in10 && in01) {
                var i0 = getOrCreatePoint(r, c);
                var i1 = getOrCreatePoint(r + 1, c);
                var i2 = getOrCreatePoint(r, c + 1);
                if (passesAngleCull(allPoints[i0], allPoints[i1], allPoints[i2], cosEndAngle)) {
                    allTriangles.push({ vertices: [allPoints[i0], allPoints[i1], allPoints[i2]] });
                }
            }

            if (in10 && in11 && in01) {
                var j0 = getOrCreatePoint(r + 1, c);
                var j1 = getOrCreatePoint(r + 1, c + 1);
                var j2 = getOrCreatePoint(r, c + 1);
                if (passesAngleCull(allPoints[j0], allPoints[j1], allPoints[j2], cosEndAngle)) {
                    allTriangles.push({ vertices: [allPoints[j0], allPoints[j1], allPoints[j2]] });
                }
            }
        }
    }

    progress(95, "Generated " + allTriangles.length + " triangles");

    if (allTriangles.length === 0) return null;

    var timestamp = new Date().toISOString().replace(/[:.]/g, "-").substring(0, 19);
    var algoShort = { richardsMoore: "RM", lundborg: "LB", mckenzie: "MK" }[algorithm] || algorithm;
    var fos = params.factorOfSafety || 2;

    return {
        id: "flyrock_shroud_" + timestamp,
        name: "Flyrock Shroud (" + algoShort + "-FoS" + fos + ")",
        type: "triangulated",
        points: allPoints,
        triangles: allTriangles,
        visible: true,
        transparency: transparency,
        isFlyrockShroud: true,
        flyrockParams: {
            algorithm: algorithm,
            K: params.K,
            factorOfSafety: params.factorOfSafety,
            stemEjectAngleDeg: params.stemEjectAngleDeg,
            holeCount: holeData.length,
            endAngleDeg: endAngleDeg,
            gridSpacing: gridSpacing,
            gridSize: cols + "x" + rows
        },
        metadata: { createdAt: new Date().toISOString(), algorithm: algorithm }
    };
}
