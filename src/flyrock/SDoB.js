/**
 * SDoB.js — Scaled Depth of Burial (Chiappetta & Treleven 1997; McKenzie 2009)
 *
 * Author: Brent Buffham — blastingapps.com & kirra-design.com
 * License: MIT
 *
 *   SDoB = D / Wt_m^(1/3)          [m/kg^(1/3)]
 *   D    = St + 0.5 · Lcon          (distance to centre of contributing charge)
 *   Lcon = min(Lc, m · ø)           m = 10 for ø ≥ 100 mm, 8 otherwise
 *   Wt_m = mass in the contributing length
 *
 * Two forms:
 *   computeHoleSDoB(...)  — per-hole scalar (design check)
 *   SDoBModel.computeGrid — volumetric: D is the 3D distance from each grid
 *                           point to the charge column segment, IDW-blended
 *                           across nearby holes (Kirra SDoBModel shader).
 *
 * Risk bands (McKenzie): <0.8 very high · 0.8–1.2 high · 1.2–1.8 moderate ·
 * 1.8–2.5 low · >2.5 very low / over-confined.
 */

/**
 * Contributing-diameters multiplier m (Chiappetta).
 * @param {number} holeDiamMm
 * @returns {number} 10 or 8
 */
export function contributingMultiplier(holeDiamMm) {
    return holeDiamMm >= 100 ? 10 : 8;
}

/**
 * Per-hole SDoB from charging geometry.
 *
 * @param {Object} params
 * @param {number} params.holeDiamMm
 * @param {number} params.stemmingLength    - St (m)
 * @param {number} params.chargeLength      - Lc (m)
 * @param {number} [params.explosiveDensity] - kg/L (used when totalMassKg absent)
 * @param {number} [params.totalMassKg]     - explosive mass in the column (kg)
 * @returns {{ sDoB, contributingLength, contributingMass, massPerMetre, depthToCentre }}
 */
export function computeHoleSDoB(params) {
    var p = params || {};
    var dM = (p.holeDiamMm || 0) / 1000;
    var m = contributingMultiplier(p.holeDiamMm || 0);
    var Lc = Math.max(0, p.chargeLength || 0);
    var Lcon = Math.min(Lc, m * dM);
    var W;
    if (p.totalMassKg > 0 && Lc > 0) W = p.totalMassKg / Lc;
    else W = Math.PI * (dM / 2) * (dM / 2) * (p.explosiveDensity || 1.2) * 1000;
    var Wt = W * Lcon;
    var D = (p.stemmingLength || 0) + 0.5 * Lcon;
    var sDoB = Wt > 0 ? D / Math.pow(Wt, 1 / 3) : Infinity;
    return { sDoB: sDoB, contributingLength: Lcon, contributingMass: Wt, massPerMetre: W, depthToCentre: D };
}

/**
 * Risk band label for an SDoB value.
 * @param {number} sDoB
 * @returns {{ key, label, minSDoB, maxSDoB }}
 */
export function sdobRiskBand(sDoB) {
    if (sDoB < 0.8) return { key: "veryHigh", label: "Very high — crater formation likely", minSDoB: 0, maxSDoB: 0.8 };
    if (sDoB < 1.2) return { key: "high", label: "High — review stemming", minSDoB: 0.8, maxSDoB: 1.2 };
    if (sDoB < 1.8) return { key: "moderate", label: "Moderate — normal blast conditions", minSDoB: 1.2, maxSDoB: 1.8 };
    if (sDoB < 2.5) return { key: "low", label: "Low — well confined", minSDoB: 1.8, maxSDoB: 2.5 };
    return { key: "veryLow", label: "Very low — over-confined, may affect fragmentation", minSDoB: 2.5, maxSDoB: Infinity };
}

function _distToSegment(px, py, pz, ax, ay, az, bx, by, bz) {
    var abx = bx - ax, aby = by - ay, abz = bz - az;
    var apx = px - ax, apy = py - ay, apz = pz - az;
    var L2 = abx * abx + aby * aby + abz * abz;
    var t = L2 > 1e-12 ? (apx * abx + apy * aby + apz * abz) / L2 : 0;
    if (t < 0) t = 0; else if (t > 1) t = 1;
    var qx = ax + t * abx - px, qy = ay + t * aby - py, qz = az + t * abz - pz;
    return Math.sqrt(qx * qx + qy * qy + qz * qz);
}

/**
 * Per-hole charge column summaries from DeckEntry list: for each hole index,
 * the shallowest charged top and deepest charged base plus total mass.
 *
 * @param {Array} deckEntries
 * @param {Array} holeEntries
 * @returns {Array<{ holeIndex, topX,topY,topZ, baseX,baseY,baseZ, chargeLen, totalMassKg, holeDiamMm, stemmingLength }>}
 */
export function chargeColumnsFromDecks(deckEntries, holeEntries) {
    var byHole = {};
    for (var i = 0; i < (deckEntries || []).length; i++) {
        var d = deckEntries[i];
        if (!d || !(d.mass > 0)) continue;
        var h = holeEntries ? holeEntries[d.holeIndex] : null;
        var col = byHole[d.holeIndex];
        // Depth of deck top along hole from collar
        var depthTop = h ? Math.sqrt((d.topX - h.collarX) ** 2 + (d.topY - h.collarY) ** 2 + (d.topZ - h.collarZ) ** 2) : 0;
        var depthBase = h ? Math.sqrt((d.baseX - h.collarX) ** 2 + (d.baseY - h.collarY) ** 2 + (d.baseZ - h.collarZ) ** 2) : 0;
        if (!col) {
            col = byHole[d.holeIndex] = {
                holeIndex: d.holeIndex, topX: d.topX, topY: d.topY, topZ: d.topZ, baseX: d.baseX, baseY: d.baseY, baseZ: d.baseZ,
                depthTop: depthTop, depthBase: depthBase, totalMassKg: 0, holeDiamMm: d.holeDiamMm
            };
        }
        if (depthTop < col.depthTop) { col.depthTop = depthTop; col.topX = d.topX; col.topY = d.topY; col.topZ = d.topZ; }
        if (depthBase > col.depthBase) { col.depthBase = depthBase; col.baseX = d.baseX; col.baseY = d.baseY; col.baseZ = d.baseZ; }
        col.totalMassKg += d.mass;
    }
    var out = [];
    for (var k in byHole) {
        var c = byHole[k];
        c.chargeLen = Math.max(0, c.depthBase - c.depthTop);
        c.stemmingLength = c.depthTop;
        out.push(c);
    }
    return out;
}

/**
 * Volumetric SDoB at a point: nearest-distance-to-column form, IDW blended
 * across holes within maxDisplayDistance.
 *
 * @param {{x,y,z}} point
 * @param {Array} columns - from chargeColumnsFromDecks
 * @param {Object} [params] - { maxDisplayDistance=50 }
 * @returns {number} SDoB (NaN when no hole within range)
 */
export function computeSDoBAtPoint(point, columns, params) {
    var p = Object.assign({ maxDisplayDistance: 50 }, params || {});
    var wSum = 0, wTot = 0;
    for (var i = 0; i < columns.length; i++) {
        var c = columns[i];
        if (!(c.chargeLen > 0)) continue;
        var D = _distToSegment(point.x, point.y, point.z, c.topX, c.topY, c.topZ, c.baseX, c.baseY, c.baseZ);
        if (D > p.maxDisplayDistance) continue;
        var dM = c.holeDiamMm / 1000;
        var Lcon = Math.min(c.chargeLen, contributingMultiplier(c.holeDiamMm) * dM);
        var Wt = (c.totalMassKg / c.chargeLen) * Lcon;
        if (!(Wt > 0)) continue;
        var sdob = D / Math.pow(Wt, 1 / 3);
        var w = 1 / Math.max(D * D, 0.01);
        wSum += sdob * w; wTot += w;
    }
    return wTot > 0 ? wSum / wTot : NaN;
}

/**
 * SDoBModel — grid wrapper matching the other GridResult-producing models.
 */
export class SDoBModel {
    constructor(params) {
        this.params = Object.assign({ maxDisplayDistance: 50, targetSDoB: 1.5 }, params || {});
        this.unit = "m/kg^(1/3)";
        this.name = "SDoB";
    }

    evaluate(point, deckEntries, holeEntries) {
        return computeSDoBAtPoint(point, chargeColumnsFromDecks(deckEntries, holeEntries), this.params);
    }

    /**
     * @param {Array} deckEntries
     * @param {Array} holeEntries
     * @param {Object} gridParams - { minX, minY, rows, cols, cellX, cellY, elevation }
     * @returns {{ data: Float32Array, rows, cols, minX, minY, cellX, cellY, elevation, unit, model }}
     *   NaN where no hole is within maxDisplayDistance.
     */
    computeGrid(deckEntries, holeEntries, gridParams) {
        var gp = gridParams;
        var cols = chargeColumnsFromDecks(deckEntries, holeEntries);
        var data = new Float32Array(gp.rows * gp.cols);
        var pt = { x: 0, y: 0, z: gp.elevation };
        for (var r = 0; r < gp.rows; r++) {
            for (var c = 0; c < gp.cols; c++) {
                pt.x = gp.minX + c * gp.cellX; pt.y = gp.minY + r * gp.cellY;
                data[r * gp.cols + c] = computeSDoBAtPoint(pt, cols, this.params);
            }
        }
        return { data: data, rows: gp.rows, cols: gp.cols, minX: gp.minX, minY: gp.minY,
                 cellX: gp.cellX, cellY: gp.cellY, elevation: gp.elevation, unit: this.unit, model: this.name };
    }
}
