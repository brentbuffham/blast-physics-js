/**
 * HolmbergPerssonDamage.js — Holmberg-Persson near-field PPV
 *
 * Author: Brent Buffham — blastingapps.com & kirra-design.com
 * License: MIT
 *
 * Integrates the charge column as sub-elements, sums the geometric term, and
 * raises the sum to α ONCE — the published form:
 *
 *   PPV = K · [ q · ∫ dx / R^(β/α) ]^α   →   K · [ Σ w_i · R_i^(−β/α) ]^α
 *
 * References: NIOSH (Iverson, Kerkering & Hustrulid 2008) Eqs 5–6;
 *             Onederra & Esen (2004) Eq 1; Holmberg & Persson (1979).
 *
 * ONE CHARGE (0.3.2): the sum runs over every deck of one hole that fires at the
 * same time (core/ChargeColumns.js) — a column split into two decks sums as one
 * column. ⏪ BEFORE 0.3.2 each deck was its own sum and the peak deck won, so a
 * split column read LOWER than the same column stored as one deck. Charges at
 * different fire times, and different holes, still never add.
 *
 * ⏪ BEFORE 0.3.0 this raised each element to α and RMS-summed the results:
 *
 *     var ppvElem = K * Math.pow(elementCharge, alpha) * Math.pow(R, -beta);
 *     sumPPVsq += ppvElem * ppvElem;      // ... then sqrt
 *
 * That form never converges — the answer keeps falling as `elemsPerDeck`
 * rises (about 34 % low at 8 elements, 56 % low at 64). The published form
 * converges by 8 elements. This function also returned
 * `peakPPV / ppvCritical` as a unitless "damage index"; no paper defines that
 * ratio, so it now returns PPV in mm/s and `ppvCritical` is a threshold the
 * caller compares against.
 *
 * Extracted from Kirra's NonLinearDamageModel.js GLSL fragment shader.
 */

import { SAME_FIRE_MS } from "../core/ChargeColumns.js";

/**
 * The geometric sum Σ w_i · R_i^(−β/α) for each CHARGE at a point: the decks of one
 * hole that fire at the same time share one sum.
 *
 * @param {{ x:number, y:number, z:number }} point
 * @param {Array} deckEntries - DeckEntry objects (holeIndex and timingMs are used)
 * @param {{alpha_hp:number, beta_hp:number, elemsPerDeck:number, cutoffDistance:number}} p
 * @returns {number[]} one sum per charge
 */
export function holmbergPerssonChargeSums(point, deckEntries, p) {
    var betaOverAlpha = p.beta_hp / p.alpha_hp;
    var cutoff = p.cutoffDistance;
    var elemsPerDeck = p.elemsPerDeck;
    var groups = [];   // [{ hole, time, sum }]

    for (var d = 0; d < deckEntries.length; d++) {
        var dk = deckEntries[d];
        if (!(dk.mass > 0)) continue;

        var topX = dk.topX, topY = dk.topY, topZ = dk.topZ;
        var axX = dk.baseX - topX, axY = dk.baseY - topY, axZ = dk.baseZ - topZ;
        var deckLen = Math.sqrt(axX * axX + axY * axY + axZ * axZ);
        if (deckLen < 0.001) continue;
        var dirX = axX / deckLen, dirY = axY / deckLen, dirZ = axZ / deckLen;

        var hole = dk.holeIndex || 0, time = dk.timingMs || 0, g = null;
        for (var k = 0; k < groups.length; k++) {
            if (groups[k].hole === hole && Math.abs(groups[k].time - time) <= SAME_FIRE_MS) { g = groups[k]; break; }
        }
        if (!g) { g = { hole: hole, time: time, sum: 0 }; groups.push(g); }

        var dL = deckLen / elemsPerDeck;
        var elementCharge = (dk.mass / deckLen) * dL;  // kg

        // Σ w_i · R_i^(−β/α) — the integral, accumulated linearly
        for (var m = 0; m < elemsPerDeck; m++) {
            var elemOffset = (m + 0.5) * dL;
            var dx = point.x - (topX + dirX * elemOffset);
            var dy = point.y - (topY + dirY * elemOffset);
            var dz = point.z - (topZ + dirZ * elemOffset);
            var R = Math.max(Math.sqrt(dx * dx + dy * dy + dz * dz), cutoff);
            g.sum += elementCharge * Math.pow(R, -betaOverAlpha);
        }
    }
    return groups.map(function (gr) { return gr.sum; });
}

/**
 * Compute Holmberg-Persson PPV at an observation point.
 *
 * @param {{ x:number, y:number, z:number }} point - Observation point (m)
 * @param {Array}  deckEntries
 * @param {Object} params
 * @param {number} [params.K_hp=700]
 * @param {number} [params.alpha_hp=0.7]      - α, the charge exponent
 * @param {number} [params.beta_hp=1.5]       - β, the distance exponent
 * @param {number} [params.elemsPerDeck=8]    - converged by 8; 64 gives the same answer
 * @param {number} [params.cutoffDistance=0.3]
 * @returns {number} Peak PPV over all charges (mm/s)
 */
export function computeHolmbergPerssonDamage(point, deckEntries, params) {
    var p = Object.assign({
        K_hp: 700, alpha_hp: 0.7, beta_hp: 1.5,
        elemsPerDeck: 8,
        cutoffDistance: 0.3
    }, params || {});

    var peakPPV = 0.0;
    var sums = holmbergPerssonChargeSums(point, deckEntries, p);
    for (var i = 0; i < sums.length; i++) {
        // ... raised to α once, per charge
        var ppv = p.K_hp * Math.pow(sums[i], p.alpha_hp);
        if (ppv > peakPPV) peakPPV = ppv;
    }
    return peakPPV;
}

export class HolmbergPerssonDamageModel {
    constructor(params) {
        this.params = Object.assign({
            K_hp: 700, alpha_hp: 0.7, beta_hp: 1.5,
            elemsPerDeck: 8, cutoffDistance: 0.3
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
                 cellX: gp.cellX, cellY: gp.cellY, elevation: gp.elevation,
                 unit: "mm/s", model: "HolmbergPersson" };
    }
}
