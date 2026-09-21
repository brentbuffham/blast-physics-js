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
 * @returns {number} Peak PPV over all decks (mm/s)
 */
export function computeHolmbergPerssonDamage(point, deckEntries, params) {
    var p = Object.assign({
        K_hp: 700, alpha_hp: 0.7, beta_hp: 1.5,
        elemsPerDeck: 8,
        cutoffDistance: 0.3
    }, params || {});

    var K = p.K_hp, alpha = p.alpha_hp, beta = p.beta_hp;
    var cutoff = p.cutoffDistance;
    var elemsPerDeck = p.elemsPerDeck;
    var betaOverAlpha = beta / alpha;

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

        // Σ w_i · R_i^(−β/α) — the integral, accumulated linearly
        var sumGeom = 0.0;
        for (var m = 0; m < elemsPerDeck; m++) {
            var elemOffset = (m + 0.5) * dL;
            var eX = topX + dirX * elemOffset;
            var eY = topY + dirY * elemOffset;
            var eZ = topZ + dirZ * elemOffset;
            var dx = point.x - eX, dy = point.y - eY, dz = point.z - eZ;
            var R = Math.max(Math.sqrt(dx * dx + dy * dy + dz * dz), cutoff);
            sumGeom += elementCharge * Math.pow(R, -betaOverAlpha);
        }

        // ... raised to α once, per deck
        var deckPPV = K * Math.pow(sumGeom, alpha);
        if (deckPPV > peakPPV) peakPPV = deckPPV;
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
