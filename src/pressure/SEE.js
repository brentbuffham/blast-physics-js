/**
 * SEE.js — Specific Explosive Energy
 *
 * Author: Brent Buffham — blastingapps.com & kirra-design.com
 * License: MIT
 *
 *   SEE = ½ · ρ_e · VOD²     (J/m³ → GJ/m³)
 *
 * ANFO (ρ 0.85 kg/L, VOD 4500) ≈ 8.6 GJ/m³; emulsion (1.2 kg/L, 5600) ≈ 18.9 GJ/m³.
 * Per-deck values are IDW-blended in plan to give a smooth energy-distribution map.
 *
 * Extracted from Kirra's SEEModel.js (hidden analytics shader).
 */

/**
 * SEE for one explosive.
 * @param {number} densityKgL - kg/L (g/cc)
 * @param {number} vod        - m/s
 * @returns {number} GJ/m³
 */
export function specificExplosiveEnergy(densityKgL, vod) {
    if (!(densityKgL > 0) || !(vod > 0)) return 0;
    return 0.5 * (densityKgL * 1000) * vod * vod / 1e9;
}

/**
 * IDW-blended SEE at a point from charged decks.
 * @param {{x,y,z}} point
 * @param {Array} deckEntries
 * @param {Object} [params] - { maxDisplayDistance=50, fallbackDensity=1.2, fallbackVOD=5000 }
 * @returns {number} GJ/m³ (NaN when no deck in range)
 */
export function computeSEE(point, deckEntries, params) {
    var p = Object.assign({ maxDisplayDistance: 50, fallbackDensity: 1.2, fallbackVOD: 5000 }, params || {});
    var wSum = 0, wTot = 0;
    for (var i = 0; i < deckEntries.length; i++) {
        var d = deckEntries[i];
        if (!d || !(d.mass > 0)) continue;
        var cx = (d.topX + d.baseX) * 0.5, cy = (d.topY + d.baseY) * 0.5, cz = (d.topZ + d.baseZ) * 0.5;
        var dx = point.x - cx, dy = point.y - cy, dz = point.z - cz;
        var dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist > p.maxDisplayDistance) continue;
        var see = specificExplosiveEnergy(d.density > 0 ? d.density : p.fallbackDensity, d.vod > 0 ? d.vod : p.fallbackVOD);
        var w = 1 / Math.max(dist * dist, 0.01);
        wSum += see * w; wTot += w;
    }
    return wTot > 0 ? wSum / wTot : NaN;
}

export class SEEModel {
    constructor(params) {
        this.params = Object.assign({ maxDisplayDistance: 50, fallbackDensity: 1.2, fallbackVOD: 5000 }, params || {});
        this.unit = "GJ/m3";
        this.name = "SEE";
    }
    evaluate(point, deckEntries) { return computeSEE(point, deckEntries, this.params); }
    computeGrid(deckEntries, gridParams) {
        var gp = gridParams;
        var data = new Float32Array(gp.rows * gp.cols);
        for (var r = 0; r < gp.rows; r++) {
            for (var c = 0; c < gp.cols; c++) {
                data[r * gp.cols + c] = this.evaluate({ x: gp.minX + c * gp.cellX, y: gp.minY + r * gp.cellY, z: gp.elevation }, deckEntries);
            }
        }
        return { data: data, rows: gp.rows, cols: gp.cols, minX: gp.minX, minY: gp.minY,
                 cellX: gp.cellX, cellY: gp.cellY, elevation: gp.elevation, unit: this.unit, model: this.name };
    }
}
