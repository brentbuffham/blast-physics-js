/**
 * FlyrockWorker.js — Web Worker for flyrock shroud generation
 *
 * Author: Brent Buffham — blastingapps.com & kirra-design.com
 * License: MIT
 *
 * Directly ported from Kirra's flyrockWorker.js.
 *
 * Message protocol:
 *   Main → Worker:
 *     { type: 'generate', payload: { holeData, params } }
 *       holeData: Array of { cx, cy, cz, maxDistance, maxVelocity, holeID }
 *       params:   { iterations, endAngleDeg, transparency, extendBelowCollar, algorithm }
 *
 *   Worker → Main:
 *     { type: 'progress', percent, message }
 *     { type: 'result',   data: <surface object> }
 *     { type: 'error',    message }
 */

/* global self */

var PI = Math.PI;
var GRAVITY = 9.80665;

var ALGO_SHORT_CODES = {
    richardsMoore: "RM",
    lundborg: "LB",
    mckenzie: "MK"
};

function algorithmShortCode(algorithm) {
    return ALGO_SHORT_CODES[algorithm] || algorithm;
}

function generateShroud(holeData, params, sendProgress) {
    if (!holeData || holeData.length === 0) return null;

    var iterations = params.iterations || 40;
    var endAngleDeg = params.endAngleDeg !== undefined ? params.endAngleDeg : 85;
    var transparency = params.transparency !== undefined ? params.transparency : 0.5;
    var extendBelowCollar = params.extendBelowCollar || 0;
    var algorithm = params.algorithm || "richardsMoore";

    sendProgress(5, "Computing grid bounds for " + holeData.length + " holes...");

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

    var maxGridCells = 500;
    if (cols > maxGridCells || rows > maxGridCells) {
        var scaleDown = maxGridCells / Math.max(cols, rows);
        gridSpacing = gridSpacing / scaleDown;
        cols = Math.ceil((gridMaxX - gridMinX) / gridSpacing) + 1;
        rows = Math.ceil((gridMaxY - gridMinY) / gridSpacing) + 1;
    }

    sendProgress(15, "Computing " + cols + "x" + rows + " grid (" + (cols * rows) + " cells)...");

    var gridZ = new Array(rows);
    var gridInside = new Array(rows);
    for (var r = 0; r < rows; r++) {
        gridZ[r] = new Float64Array(cols);
        gridInside[r] = new Uint8Array(cols);
    }

    var totalRows = rows;
    var PROGRESS_EVERY = Math.max(1, Math.floor(rows / 20));

    for (var r = 0; r < rows; r++) {
        if (r % PROGRESS_EVERY === 0) {
            sendProgress(15 + Math.floor((r / totalRows) * 60), "Computing row " + r + " / " + totalRows + "...");
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

    sendProgress(80, "Building triangles...");

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

    var endAngleRad = endAngleDeg * (PI / 180);
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

    sendProgress(95, "Generated " + allTriangles.length + " triangles");

    if (allTriangles.length === 0) return null;

    var timestamp = new Date().toISOString().replace(/[:.]/g, "-").substring(0, 19);
    var algoShort = algorithmShortCode(algorithm);
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
            holesSkipped: params.holesSkipped || 0,
            endAngleDeg: endAngleDeg,
            gridSpacing: gridSpacing,
            gridSize: cols + "x" + rows
        },
        metadata: { createdAt: new Date().toISOString(), algorithm: algorithm }
    };
}

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

self.onmessage = function (e) {
    var msg = e.data;

    function sendProgress(percent, message) {
        self.postMessage({ type: "progress", percent: percent, message: message });
    }

    try {
        if (msg.type === "generate") {
            var result = generateShroud(msg.payload.holeData, msg.payload.params, sendProgress);
            sendProgress(100, "Complete!");
            self.postMessage({ type: "result", data: result });
        } else {
            self.postMessage({ type: "error", message: "Unknown message type: " + msg.type });
        }
    } catch (err) {
        self.postMessage({ type: "error", message: err.message || String(err) });
    }
};
