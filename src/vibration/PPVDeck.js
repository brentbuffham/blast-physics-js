/**
 * PPVDeck.js — Per-deck Peak Particle Velocity
 *
 * Author: Brent Buffham — blastingapps.com & kirra-design.com
 * License: MIT
 *
 * Evaluates PPV at 3 positions along each deck (top, centre, base),
 * takes max across all decks. Each deck uses its own mass.
 *
 * Formula per evaluation point: PPV = K × (D / Q^e)^(-B)
 * Extracted from Kirra's PPVDeckModel.js GLSL fragment shader.
 */

/**
 * Compute per-deck PPV at an observation point.
 *
 * @param {{ x:number, y:number, z:number }} point - Observation point (m)
 * @param {Array}  deckEntries - Array of DeckEntry objects
 * @param {Object} params      - { K, B, chargeExponent, cutoffDistance }
 * @returns {number} Peak PPV (mm/s)
 */
export function computePPVDeck(point, deckEntries, params) {
    var p = Object.assign({
        K: 1140,
        B: 1.6,
        chargeExponent: 0.5,
        cutoffDistance: 1.0
    }, params || {});

    var peakPPV = 0.0;
    var K = p.K, B = p.B, ce = p.chargeExponent, cutoff = p.cutoffDistance;

    for (var d = 0; d < deckEntries.length; d++) {
        var dk = deckEntries[d];
        if (dk.mass <= 0) continue;

        var topX = dk.topX, topY = dk.topY, topZ = dk.topZ;
        var botX = dk.baseX, botY = dk.baseY, botZ = dk.baseZ;
        var midX = (topX + botX) * 0.5;
        var midY = (topY + botY) * 0.5;
        var midZ = (topZ + botZ) * 0.5;
        var mass = dk.mass;
        var qe = Math.pow(mass, ce);

        // Evaluate at top
        var dx = point.x - topX, dy = point.y - topY, dz = point.z - topZ;
        var dist = Math.max(Math.sqrt(dx * dx + dy * dy + dz * dz), cutoff);
        var ppv = K * Math.pow(dist / qe, -B);
        if (ppv > peakPPV) peakPPV = ppv;

        // Evaluate at midpoint
        dx = point.x - midX; dy = point.y - midY; dz = point.z - midZ;
        dist = Math.max(Math.sqrt(dx * dx + dy * dy + dz * dz), cutoff);
        ppv = K * Math.pow(dist / qe, -B);
        if (ppv > peakPPV) peakPPV = ppv;

        // Evaluate at base
        dx = point.x - botX; dy = point.y - botY; dz = point.z - botZ;
        dist = Math.max(Math.sqrt(dx * dx + dy * dy + dz * dz), cutoff);
        ppv = K * Math.pow(dist / qe, -B);
        if (ppv > peakPPV) peakPPV = ppv;
    }

    return peakPPV;
}

/**
 * PPVDeckModel class — per-deck PPV model.
 */
export class PPVDeckModel {
    constructor(params) {
        this.params = Object.assign({
            K: 1140,
            B: 1.6,
            chargeExponent: 0.5,
            cutoffDistance: 1.0
        }, params || {});
    }

    evaluate(point, deckEntries) {
        return computePPVDeck(point, deckEntries, this.params);
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
        return {
            data: data,
            rows: gp.rows,
            cols: gp.cols,
            minX: gp.minX,
            minY: gp.minY,
            cellX: gp.cellX,
            cellY: gp.cellY,
            elevation: gp.elevation,
            unit: "mm/s",
            model: "PPVDeck"
        };
    }
}
