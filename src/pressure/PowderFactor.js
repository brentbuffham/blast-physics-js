/**
 * PowderFactor.js — Volumetric Powder Factor
 *
 * Author: Brent Buffham — blastingapps.com & kirra-design.com
 * License: MIT
 *
 * PF = deckMass / capsule_volume
 * where capsule_volume = (4/3)π × R³  (spherical influence volume)
 * and R = distance from observation point to nearest point on deck segment.
 *
 * Extracted from Kirra's PowderFactorModel.js GLSL fragment shader.
 */

/**
 * Distance from point P to nearest point on segment A–B.
 */
function distToSegment(P, A, B) {
    var abX = B.x - A.x, abY = B.y - A.y, abZ = B.z - A.z;
    var lenSq = abX * abX + abY * abY + abZ * abZ;
    if (lenSq < 0.0001) {
        var dx = P.x - A.x, dy = P.y - A.y, dz = P.z - A.z;
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
    var t = ((P.x - A.x) * abX + (P.y - A.y) * abY + (P.z - A.z) * abZ) / lenSq;
    t = Math.max(0.0, Math.min(1.0, t));
    var cx = A.x + t * abX - P.x;
    var cy = A.y + t * abY - P.y;
    var cz = A.z + t * abZ - P.z;
    return Math.sqrt(cx * cx + cy * cy + cz * cz);
}

/**
 * Compute volumetric powder factor at an observation point.
 *
 * @param {{ x:number, y:number, z:number }} point - Observation point (m)
 * @param {Array}  deckEntries
 * @param {Object} params
 * @param {number} [params.cutoffDistance=0.3]
 * @returns {number} Peak powder factor (kg/m³)
 */
export function computePowderFactor(point, deckEntries, params) {
    var p = Object.assign({ cutoffDistance: 0.3 }, params || {});
    var cutoff = p.cutoffDistance;
    var peakPF = 0.0;

    for (var i = 0; i < deckEntries.length; i++) {
        var dk = deckEntries[i];
        if (dk.mass <= 0) continue;

        var top = { x: dk.topX, y: dk.topY, z: dk.topZ };
        var bot = { x: dk.baseX, y: dk.baseY, z: dk.baseZ };
        var R = Math.max(distToSegment(point, top, bot), cutoff);

        // Capsule volume: (4/3)π R³
        var capsuleVol = 4.18879 * R * R * R;
        var deckPF = dk.mass / capsuleVol;
        if (deckPF > peakPF) peakPF = deckPF;
    }

    return peakPF;
}

export class PowderFactorModel {
    constructor(params) {
        this.params = Object.assign({ cutoffDistance: 0.3 }, params || {});
    }

    evaluate(point, deckEntries) {
        return computePowderFactor(point, deckEntries, this.params);
    }

    computeGrid(deckEntries, gridParams) {
        var gp = gridParams;
        var data = new Float32Array(gp.rows * gp.cols);
        for (var r = 0; r < gp.rows; r++) {
            for (var c = 0; c < gp.cols; c++) {
                var x = gp.minX + c * gp.cellX;
                var y = gp.minY + r * gp.cellY;
                data[r * gp.cols + c] = this.evaluate({ x: x, y: y, z: gp.elevation }, deckEntries);
            }
        }
        return { data: data, rows: gp.rows, cols: gp.cols, minX: gp.minX, minY: gp.minY,
                 cellX: gp.cellX, cellY: gp.cellY, elevation: gp.elevation, unit: "kg/m³", model: "PowderFactor" };
    }
}
