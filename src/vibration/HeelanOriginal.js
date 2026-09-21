/**
 * HeelanOriginal.js — First-principles Heelan (1953) via Blair & Minchinton (1996)
 *
 * Author: Brent Buffham — blastingapps.com & kirra-design.com
 * License: MIT
 *
 * Borehole pressure derived from explosive density and VOD:
 *   Pb = ρ_e × VOD² / 8
 *
 * Blair & Minchinton (2006) Eq 6 gives ONE constant shared by both waves:
 *
 *   C ∝ 1 / (μ · α),   μ = ρ_rock · Vs²,   α = Vp
 *
 * so the rock enters only through the shear modulus μ. Per sub-element:
 *
 *   scale = P_b · a² · dL / (μ · Vp · R)      (shared by P and SV)
 *   vP    = scale · ω² · sfacp(φ) · att_P
 *   vSV   = scale · ω² · (α/β) · sfacs(φ) · att_S
 *
 * ω is the dominant angular frequency of the radiated pulse,
 * ω = 2π · 0.0597 · b, and it appears SQUARED because far-field velocity is
 * the second time-derivative of the source moment:  v = M̈ / (4π · ρα³ · R).
 *
 * Summed (coherent) then converted to VPPV (mm/s).
 *
 * ⏪ BEFORE 0.3.0 this model differed from the paper in three ways:
 *
 *   1. Two different denominators were used, ρ·Vp² for P and ρ·Vs² for SV:
 *
 *        var scaleP  = (Pb * a*a * dL) / (rho * VP * VP * R);
 *        var scaleSV = (Pb * a*a * dL) / (rho * VS * VS * R);
 *
 *      Eq 6 has one constant for both. Using ρVp² for P under-weighted P by
 *      (Vp/Vs)² ≈ 3 relative to SV.
 *   2. ω = VOD/(2a) drove both the source term and the Q attenuation. At
 *      ≈ 43 500 rad/s for a 115 mm hole at 5 km/s that is an order of magnitude
 *      above B&M's dominant frequency, and it is a Hz-valued quantity used
 *      where rad/s is expected, so exp(−ωR/2QV) erased the far field —
 *      attenuation of 2.4e−5 at 100 m. ω is now the dominant frequency of the
 *      n = 6 pulse, 2π · 0.0597 · b, for both uses.
 *   2b. The old expression was also DIMENSIONALLY WRONG. Pb·a²·dL/(ρVp²R)
 *      carries m², and × ω gives m²/s — not a velocity. The corrected
 *      Pb·a²·dL/(μ·Vp·R) carries m·s, and × ω² gives m/s. One factor of ω
 *      was simply missing.
 *   3. It used heelanF1/heelanF2, which invert P and SV relative to B&M
 *      Eqs 4–5. PPV was non-monotonic in distance as a result — it read
 *      higher at 20 m than at 10 m. Now uses blairSfacp / blairSfacs, with
 *      the α/β factor on SV (Eq 11).
 *
 * ⚠ OPEN — READ BEFORE USING THIS MODEL QUANTITATIVELY. Eq 6's full constant
 *   is w_e·b^(2−n)·P_o / (2π·ρ_e·μ·α). The b^(2−n) bandwidth normalisation
 *   is NOT reproduced here, and ω² stands in for the pulse's exact second
 *   derivative. The form above is dimensionally correct and its ratios and
 *   spatial shape follow the paper, but the ABSOLUTE level is uncalibrated —
 *   it currently reads about 2–3× a fitted site law beyond 20 m.
 *   Use ScaledHeelan or BlairMinchinton for quantitative work.
 *
 *   This also means HeelanOriginal now DIFFERS FROM KIRRA, which kept
 *   ω = VOD/(2a) on the source term and corrected only the Q frequency.
 *   The ω² here follows from the dimensional check above; the two codebases
 *   need reconciling before either is trusted for absolute numbers.
 *
 * Extracted from Kirra's HeelanOriginalModel.js GLSL fragment shader.
 * Reference: Blair & Minchinton (2006), Fragblast-8, Eqs 4–6 and 11.
 */

import { blairSfacp, blairSfacs } from "../core/RadiationPattern.js";
import { DEFAULT_VOD, PULSE_DOMINANT_FREQ_COEFF } from "../core/Constants.js";

/**
 * Compute Heelan Original VPPV at an observation point.
 *
 * @param {{ x:number, y:number, z:number }} point - Observation point (m)
 * @param {Array}  deckEntries
 * @param {Array}  holeEntries
 * @param {Object} params
 * @param {number} [params.rockDensity=2700]       - kg/m³
 * @param {number} [params.pWaveVelocity=4500]      - m/s
 * @param {number} [params.sWaveVelocity=2600]      - m/s
 * @param {number} [params.detonationVelocity=5000] - m/s fallback VOD
 * @param {number} [params.elemsPerDeck=8]
 * @param {number} [params.cutoffDistance=0.5]
 * @param {number} [params.bandwidth=10000]        - b, sets the dominant
 *                 frequency ω = 2π · 0.0597 · b used for BOTH the source term
 *                 and Q. Amplitude scales as ω², so this is the single most
 *                 sensitive parameter in this model.
 * @param {number} [params.qualityFactorP=50]      - 0 disables P attenuation.
 *                 Unlike the scaled models, Q belongs here: this model has no
 *                 site law carrying the material attenuation.
 * @param {number} [params.qualityFactorS=30]      - 0 disables S attenuation
 * @returns {number} VPPV (mm/s)
 */
export function computeHeelanOriginal(point, deckEntries, holeEntries, params) {
    var p = Object.assign({
        rockDensity: 2700,
        pWaveVelocity: 4500, sWaveVelocity: 2600,
        detonationVelocity: DEFAULT_VOD,
        elemsPerDeck: 8,
        cutoffDistance: 0.5,
        bandwidth: 10000,
        qualityFactorP: 50, qualityFactorS: 30
    }, params || {});

    var VP = p.pWaveVelocity, VS = p.sWaveVelocity;
    var rho = p.rockDensity;
    var vsp = (VS * VS) / (VP * VP);
    var VPoverVS = VP / VS;
    var mu = rho * VS * VS;              // shear modulus — B&M Eq 6
    var cutoff = p.cutoffDistance;
    var Qp = p.qualityFactorP, Qs = p.qualityFactorS;
    var elemsPerDeck = p.elemsPerDeck;
    // Dominant angular frequency of the n = 6 pulse (rad/s). Drives both the
    // source second-derivative (ω²) and the Q attenuation.
    var omega = 2.0 * Math.PI * PULSE_DOMINANT_FREQ_COEFF * p.bandwidth;
    var omega2 = omega * omega;

    var peakVPPV = 0.0;

    for (var d = 0; d < deckEntries.length; d++) {
        var dk = deckEntries[d];
        if (dk.mass <= 0) continue;

        var topX = dk.topX, topY = dk.topY, topZ = dk.topZ;
        var botX = dk.baseX, botY = dk.baseY, botZ = dk.baseZ;
        var axX = botX - topX, axY = botY - topY, axZ = botZ - topZ;
        var deckLen = Math.sqrt(axX * axX + axY * axY + axZ * axZ);
        if (deckLen < 0.001) continue;
        var dirX = axX / deckLen, dirY = axY / deckLen, dirZ = axZ / deckLen;

        var hole = holeEntries[dk.holeIndex];
        if (!hole) continue;
        var hvX = hole.toeX - hole.collarX;
        var hvY = hole.toeY - hole.collarY;
        var hvZ = hole.toeZ - hole.collarZ;
        var hLen = Math.sqrt(hvX * hvX + hvY * hvY + hvZ * hvZ);
        if (hLen < 0.001) continue;
        var haX = hvX / hLen, haY = hvY / hLen, haZ = hvZ / hLen;
        var holeLen = hLen;
        var collarX = hole.collarX, collarY = hole.collarY, collarZ = hole.collarZ;

        var holeRadius = dk.holeDiamMm * 0.0005;
        var effectiveVOD = dk.vod > 0 ? dk.vod : p.detonationVelocity;
        var rho_e = dk.density > 0 ? dk.density * 1000.0 : 1200.0;  // kg/L → kg/m³

        // Borehole wall pressure (Pa)
        var Pb = rho_e * effectiveVOD * effectiveVOD * 0.125;

        var dL = deckLen / elemsPerDeck;

        var sumVr = 0.0, sumVz = 0.0;

        for (var m = 0; m < elemsPerDeck; m++) {
            var elemOffset = (m + 0.5) * dL;
            var eX = topX + dirX * elemOffset;
            var eY = topY + dirY * elemOffset;
            var eZ = topZ + dirZ * elemOffset;

            var toX = point.x - eX, toY = point.y - eY, toZ = point.z - eZ;
            var R = Math.max(Math.sqrt(toX * toX + toY * toY + toZ * toZ), cutoff);
            var invR = 1.0 / R;

            var cosPhi = (toX * haX + toY * haY + toZ * haZ) * invR;
            cosPhi = Math.max(-1.0, Math.min(1.0, cosPhi));
            var sinPhi = Math.sqrt(Math.max(0.0, 1.0 - cosPhi * cosPhi));

            var sfacp = blairSfacp(cosPhi, vsp);
            var sfacs = blairSfacs(sinPhi, cosPhi, sfacp);

            // ONE constant for both waves — the rock enters only through μ.
            var scale = (Pb * holeRadius * holeRadius * dL) / (mu * VP * R);

            var attP = 1.0, attS = 1.0;
            if (Qp > 0) attP = Math.exp(-omega * R / (2.0 * Qp * VP));
            if (Qs > 0) attS = Math.exp(-omega * R / (2.0 * Qs * VS));

            var vP  = scale * omega2 * sfacp * attP;
            var vSV = scale * omega2 * VPoverVS * sfacs * attS;   // α/β — Eq 11

            sumVr += vP * sinPhi + vSV * cosPhi;
            sumVz += vP * cosPhi - vSV * sinPhi;
        }

        // Attenuate below the toe
        var projOnAxis = ((point.x - collarX) * haX + (point.y - collarY) * haY + (point.z - collarZ) * haZ);
        var belowToe = projOnAxis - holeLen;
        if (belowToe > 0) {
            var decayLen = Math.max(deckLen * 0.15, holeRadius * 4.0);
            var att = Math.exp(-belowToe / decayLen);
            sumVr *= att;
            sumVz *= att;
        }

        var vppv = Math.sqrt(sumVr * sumVr + sumVz * sumVz) * 1000.0; // m/s → mm/s
        if (vppv > peakVPPV) peakVPPV = vppv;
    }

    return peakVPPV;
}

export class HeelanOriginalModel {
    constructor(params) {
        this.params = Object.assign({
            rockDensity: 2700,
            pWaveVelocity: 4500, sWaveVelocity: 2600,
            detonationVelocity: DEFAULT_VOD,
            elemsPerDeck: 8,
            cutoffDistance: 0.5,
            bandwidth: 10000,
            qualityFactorP: 50, qualityFactorS: 30
        }, params || {});
    }

    evaluate(point, deckEntries, holeEntries) {
        return computeHeelanOriginal(point, deckEntries, holeEntries, this.params);
    }

    computeGrid(deckEntries, holeEntries, gridParams) {
        var gp = gridParams;
        var data = new Float32Array(gp.rows * gp.cols);
        for (var r = 0; r < gp.rows; r++) {
            for (var c = 0; c < gp.cols; c++) {
                var x = gp.minX + c * gp.cellX;
                var y = gp.minY + r * gp.cellY;
                data[r * gp.cols + c] = this.evaluate({ x: x, y: y, z: gp.elevation }, deckEntries, holeEntries);
            }
        }
        return { data: data, rows: gp.rows, cols: gp.cols, minX: gp.minX, minY: gp.minY,
                 cellX: gp.cellX, cellY: gp.cellY, elevation: gp.elevation, unit: "mm/s", model: "HeelanOriginal" };
    }
}
