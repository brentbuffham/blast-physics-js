/**
 * BoreholePressure.js — Borehole wall pressure with geometric attenuation
 *
 * Author: Brent Buffham — blastingapps.com & kirra-design.com
 * License: MIT
 *
 * Pb = ρ_e × VOD² / 8   (borehole wall pressure, Pa → MPa)
 * P(R) = Pb × (a / R)^α  (attenuation with distance)
 *
 * Uses segment distance for smooth contours (no discrete element halos).
 * Extracted from Kirra's PressureModel.js GLSL fragment shader.
 */

/**
 * Distance from point P to nearest point on segment A–B.
 * @param {{ x,y,z }} P
 * @param {{ x,y,z }} A
 * @param {{ x,y,z }} B
 * @returns {number} distance (m)
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
 * Compute peak borehole pressure at an observation point.
 *
 * @param {{ x:number, y:number, z:number }} point - Observation point (m)
 * @param {Array}  deckEntries
 * @param {Object} params
 * @param {number} [params.attenuationExponent=2.0]
 * @param {number} [params.fallbackDensity=1.2]   - kg/L
 * @param {number} [params.fallbackVOD=5000]       - m/s
 * @param {number} [params.cutoffDistance=0.3]
 * @returns {number} Peak pressure (MPa)
 */
export function computeBoreholePressure(point, deckEntries, params) {
    var p = Object.assign({
        attenuationExponent: 2.0,
        fallbackDensity: 1.2,
        fallbackVOD: 5000,
        cutoffDistance: 0.3
    }, params || {});

    var alpha = p.attenuationExponent;
    var cutoff = p.cutoffDistance;
    var peakPressure = 0.0;

    for (var i = 0; i < deckEntries.length; i++) {
        var dk = deckEntries[i];
        if (dk.mass <= 0) continue;

        var holeRadius = dk.holeDiamMm * 0.0005;  // mm → m radius
        var effectiveVOD = dk.vod > 0 ? dk.vod : p.fallbackVOD;
        var rho_e = dk.density > 0 ? dk.density * 1000.0 : p.fallbackDensity * 1000.0;  // kg/L → kg/m³

        // Pb = ρ_e × VOD² / 8 (Pa → MPa)
        var Pb_MPa = rho_e * effectiveVOD * effectiveVOD * 0.125 / 1e6;

        var top = { x: dk.topX, y: dk.topY, z: dk.topZ };
        var bot = { x: dk.baseX, y: dk.baseY, z: dk.baseZ };
        var R = Math.max(distToSegment(point, top, bot), cutoff);

        var P_deck = Pb_MPa * Math.pow(holeRadius / R, alpha);
        if (P_deck > peakPressure) peakPressure = P_deck;
    }

    return peakPressure;
}

export class BoreholePressureModel {
    constructor(params) {
        this.params = Object.assign({
            attenuationExponent: 2.0, fallbackDensity: 1.2, fallbackVOD: 5000, cutoffDistance: 0.3
        }, params || {});
    }

    evaluate(point, deckEntries) {
        return computeBoreholePressure(point, deckEntries, this.params);
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
                 cellX: gp.cellX, cellY: gp.cellY, elevation: gp.elevation, unit: "MPa", model: "BoreholePressure" };
    }
}
