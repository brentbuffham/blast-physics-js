/**
 * JointedRockDamage.js — Combined intact rock fracture + Mohr-Coulomb joint failure
 *
 * Author: Brent Buffham — blastingapps.com & kirra-design.com
 * License: MIT
 *
 * 1. Compute PPV via Holmberg-Persson integration along each deck
 * 2. Convert PPV to dynamic stress: σ_d = ρ_rock × Vp × PPV (unit conversion included)
 * 3. Intact rock fracture ratio: FR_rock = σ_d / σ_t
 * 4. Mohr-Coulomb joint failure: FR_joint = τ / (c + μ × σ_n)
 * 5. Output = max(FR_rock, FR_joint)   (values > 1 indicate failure)
 *
 * Extracted from Kirra's JointedRockDamageModel.js GLSL fragment shader.
 */

/**
 * Compute jointed rock damage ratio at an observation point.
 *
 * @param {{ x:number, y:number, z:number }} point
 * @param {Array}  deckEntries
 * @param {Object} params
 * @param {number} [params.K_hp=700]
 * @param {number} [params.alpha_hp=0.7]
 * @param {number} [params.beta_hp=1.5]
 * @param {number} [params.rockTensileStrength=10]   - MPa
 * @param {number} [params.rockDensity=2700]          - kg/m³
 * @param {number} [params.pWaveVelocity=4500]        - m/s
 * @param {number} [params.jointSetAngle=45]          - degrees
 * @param {number} [params.jointCohesion=0.1]         - MPa
 * @param {number} [params.jointFrictionAngle=30]     - degrees
 * @param {number} [params.elemsPerDeck=8]
 * @param {number} [params.cutoffDistance=0.3]
 * @returns {number} Damage ratio (>1 = failure)
 */
export function computeJointedRockDamage(point, deckEntries, params) {
    var p = Object.assign({
        K_hp: 700, alpha_hp: 0.7, beta_hp: 1.5,
        rockTensileStrength: 10,
        rockDensity: 2700, pWaveVelocity: 4500,
        jointSetAngle: 45, jointCohesion: 0.1, jointFrictionAngle: 30,
        elemsPerDeck: 8, cutoffDistance: 0.3
    }, params || {});

    var K = p.K_hp, alpha = p.alpha_hp, beta = p.beta_hp;
    var cutoff = p.cutoffDistance;
    var elemsPerDeck = p.elemsPerDeck;

    var jointAngleRad = p.jointSetAngle * Math.PI / 180.0;
    var frictionCoeff = Math.tan(p.jointFrictionAngle * Math.PI / 180.0);

    var peakDamageRatio = 0.0;

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
        var q = linearDensity * dL;

        var sumPPV2 = 0.0;
        for (var m = 0; m < elemsPerDeck; m++) {
            var elemOffset = (m + 0.5) * dL;
            var eX = topX + dirX * elemOffset;
            var eY = topY + dirY * elemOffset;
            var eZ = topZ + dirZ * elemOffset;
            var dx = point.x - eX, dy = point.y - eY, dz = point.z - eZ;
            var R = Math.max(Math.sqrt(dx * dx + dy * dy + dz * dz), cutoff);
            var ppv_i = K * Math.pow(q, alpha) / Math.pow(R, beta);
            sumPPV2 += ppv_i * ppv_i;
        }

        var ppv = Math.sqrt(sumPPV2);  // mm/s

        // Convert PPV (mm/s) to dynamic stress (MPa)
        // σ_d = ρ × Vp × PPV × 1e-3 / 1e6 = ρ × Vp × PPV × 1e-9
        var sigma_d = p.rockDensity * p.pWaveVelocity * ppv * 1e-9;

        // Intact rock fracture ratio
        var FR_rock = sigma_d / Math.max(p.rockTensileStrength, 0.001);

        // Joint Mohr-Coulomb failure
        var cosTheta = Math.cos(jointAngleRad);
        var sinTheta = Math.sin(jointAngleRad);
        var sigma_n = sigma_d * cosTheta * cosTheta;
        var tau = sigma_d * sinTheta * cosTheta;
        var denominator = p.jointCohesion + frictionCoeff * sigma_n;
        var FR_joint = denominator > 0.001 ? tau / denominator : 0.0;

        var damageRatio = Math.max(FR_rock, FR_joint);
        if (damageRatio > peakDamageRatio) peakDamageRatio = damageRatio;
    }

    return peakDamageRatio;
}

export class JointedRockDamageModel {
    constructor(params) {
        this.params = Object.assign({
            K_hp: 700, alpha_hp: 0.7, beta_hp: 1.5,
            rockTensileStrength: 10,
            rockDensity: 2700, pWaveVelocity: 4500,
            jointSetAngle: 45, jointCohesion: 0.1, jointFrictionAngle: 30,
            elemsPerDeck: 8, cutoffDistance: 0.3
        }, params || {});
    }

    evaluate(point, deckEntries) {
        return computeJointedRockDamage(point, deckEntries, this.params);
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
                 cellX: gp.cellX, cellY: gp.cellY, elevation: gp.elevation, unit: "damage ratio", model: "JointedRock" };
    }
}
