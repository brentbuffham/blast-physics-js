/**
 * HolmbergPerssonDamage.js — Holmberg-Persson near-field damage index
 *
 * Author: Brent Buffham — blastingapps.com & kirra-design.com
 * License: MIT
 *
 * Integrates PPV contributions along each charged deck using sub-elements.
 * RMS sum of sub-element contributions gives per-deck PPV.
 * Damage index = peak PPV / PPV_critical
 *
 *   PPV_i = K × (q·dL)^α / R^β
 *   PPV_deck = sqrt(Σ PPV_i²)
 *   DI = PPV_deck / PPV_critical
 *
 * Extracted from Kirra's NonLinearDamageModel.js GLSL fragment shader.
 * Reference: Holmberg & Persson (1979)
 */

/**
 * Compute Holmberg-Persson damage index at an observation point.
 *
 * @param {{ x:number, y:number, z:number }} point - Observation point (m)
 * @param {Array}  deckEntries
 * @param {Object} params
 * @param {number} [params.K_hp=700]
 * @param {number} [params.alpha_hp=0.7]
 * @param {number} [params.beta_hp=1.5]
 * @param {number} [params.ppvCritical=700]     - mm/s threshold for crack initiation
 * @param {number} [params.elemsPerDeck=8]
 * @param {number} [params.cutoffDistance=0.3]
 * @returns {number} Damage index (0 = no damage, 1 = critical, >1 = severe)
 */
export function computeHolmbergPerssonDamage(point, deckEntries, params) {
    var p = Object.assign({
        K_hp: 700, alpha_hp: 0.7, beta_hp: 1.5,
        ppvCritical: 700,
        elemsPerDeck: 8,
        cutoffDistance: 0.3
    }, params || {});

    var K = p.K_hp, alpha = p.alpha_hp, beta = p.beta_hp;
    var cutoff = p.cutoffDistance;
    var elemsPerDeck = p.elemsPerDeck;

    var peakPPV = 0.0;

    for (var d = 0; d < deckEntries.length; d++) {
        var dk = deckEntries[d];
        if (dk.mass <= 0) continue;

        var topX = dk.topX, topY = dk.topY, topZ = dk.topZ;
        var botX = dk.baseX, botY = dk.baseY, botZ = dk.baseZ;
        var axX = botX - topX, axY = botY - topY, axZ = botZ - topZ;
        var deckLen = Math.sqrt(axX * axX + axY * axY + axZ * axZ);
        if (deckLen < 0.001) continue;
        var dirX = axX / deckLen, dirY = axY / deckLen, dirZ = axZ / deckLen;

        var dL = deckLen / elemsPerDeck;
        var linearDensity = dk.mass / deckLen;
        var elementCharge = linearDensity * dL;  // kg

        var sumPPVsq = 0.0;
        for (var m = 0; m < elemsPerDeck; m++) {
            var elemOffset = (m + 0.5) * dL;
            var eX = topX + dirX * elemOffset;
            var eY = topY + dirY * elemOffset;
            var eZ = topZ + dirZ * elemOffset;
            var dx = point.x - eX, dy = point.y - eY, dz = point.z - eZ;
            var R = Math.max(Math.sqrt(dx * dx + dy * dy + dz * dz), cutoff);
            var ppvElem = K * Math.pow(elementCharge, alpha) * Math.pow(R, -beta);
            sumPPVsq += ppvElem * ppvElem;
        }

        var deckPPV = Math.sqrt(sumPPVsq);
        if (deckPPV > peakPPV) peakPPV = deckPPV;
    }

    return peakPPV / Math.max(p.ppvCritical, 0.001);
}

export class HolmbergPerssonDamageModel {
    constructor(params) {
        this.params = Object.assign({
            K_hp: 700, alpha_hp: 0.7, beta_hp: 1.5,
            ppvCritical: 700, elemsPerDeck: 8, cutoffDistance: 0.3
        }, params || {});
    }

    evaluate(point, deckEntries) {
        return computeHolmbergPerssonDamage(point, deckEntries, this.params);
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
                 cellX: gp.cellX, cellY: gp.cellY, elevation: gp.elevation, unit: "DI", model: "HolmbergPersson" };
    }
}
