/**
 * fragmentation.test.js — Kuz-Ram, KCO / Swebrec and KC-KUM against their PUBLISHED sources
 *
 * Author: Brent Buffham — blastingapps.com & kirra-design.com
 *
 * Every expected number comes from a printed table or worked example, a hand
 * calculation shown in the comment, or a closed form — never from a previous run
 * of this library.
 *
 * SOURCES
 *  [O05]  Ouchterlony, F. (2005) The Swebrec function: linking fragmentation by
 *         blasting and crushing. Mining Technology (Trans. IMM A) 114, A29–A44.
 *         Bårarp round 4 KCO worked example, p. A41; Table 1.
 *  [C05]  Cunningham, C.V.B. (2005) The Kuz-Ram fragmentation model — 20 years on.
 *         Brighton Conf. Proc., EFEE, 201–210. Eqs 4–14, Table 1.
 *  [F15]  Faramarzi, F., Ebrahimi Farsangi, M.A. & Mansouri, H. (2015) Prediction of
 *         rock fragmentation using a gamma-based blast fragmentation distribution
 *         model. Fragblast 11, Sydney, 685–692. Eqs 4, 11–15; Table 1; Fig 3 table.
 *  [OSM17] Ouchterlony, Sanchidrián & Moser (2017) RMRE 50, 751–779, Eqs 9a–9b.
 */

import { describe, it, expect } from "vitest";
import { logGamma, gammaFunction, regularizedLowerGamma, gammaCDF } from "../src/fragmentation/Gamma.js";
import { rockFactorA, kuznetsovX50, spathisMedianFactor, cunninghamUniformity, cunningham2005Uniformity,
    cunninghamTimingFactor, cunninghamScatterFactor, rosinRammlerPassing, rosinRammlerSize } from "../src/fragmentation/KuzRam.js";
import { swebrecPassing, swebrecSize, kcoB, swebrecFromPercentiles } from "../src/fragmentation/Swebrec.js";
import { kckumUniformity, kckumParameters, kckumCurve } from "../src/fragmentation/KCKUM.js";
import { predictFragmentation, percentileSizes, columnChargeMass, tabulatedPassing, tabulatedSize,
    fitRockFactor } from "../src/fragmentation/Fragmentation.js";
import { boreholePressureMPa } from "../src/pressure/BoreholePressure.js";
import * as api from "../src/index.js";

function near(actual, expected, tol, label) {
    if (!(Math.abs(actual - expected) <= tol)) {
        throw new Error((label || "") + " expected " + expected + " ± " + tol + ", got " + actual);
    }
}

// [O05] p. A41, Bårarp round 4: φ 51 mm, B 1.8 m, S 2.2 m, H 5.2 m, charge 3.9 m above
// grade, all bottom charge (Lb = Ltot, Lc = 0), SD ≈ 0.25 m; A 13, Q 9.24 kg,
// q 0.55 kg/m³, s_ANFO = 70·4/4.5 %.
var ROUND4 = {
    burden: 1.8, spacing: 2.2, benchHeight: 5.2, holeDiamMm: 51, chargeLength: 3.9,
    drillDeviation: 0.25, chargeMass: 9.24, powderFactor: 0.55, rws: 70 * 4 / 4.5, rockFactor: 13
};

//=============================================================
describe("Gamma functions — closed forms", () => {
    it("Γ(1/2) = √π, Γ(3/2) = √π/2, Γ(5) = 4! = 24", () => {
        near(gammaFunction(0.5), Math.sqrt(Math.PI), 1e-12);
        near(gammaFunction(1.5), Math.sqrt(Math.PI) / 2, 1e-12);
        near(gammaFunction(5), 24, 1e-10);
        near(logGamma(10), Math.log(362880), 1e-10); // 9!
    });

    it("P(1, x) = 1 − e^−x (exponential CDF)", () => {
        [0.1, 1, 3, 8].forEach((x) => near(regularizedLowerGamma(1, x), 1 - Math.exp(-x), 1e-13, "x=" + x));
    });

    it("P(k, x) for integer k = 1 − e^−x Σ_{j<k} x^j/j!, both sides of x = k + 1", () => {
        // P(3, 2) = 1 − e^−2 (1 + 2 + 2) = 1 − 5e^−2 (series branch)
        near(regularizedLowerGamma(3, 2), 1 - 5 * Math.exp(-2), 1e-13);
        // P(2, 10) = 1 − e^−10 (1 + 10) = 1 − 11e^−10 (continued-fraction branch)
        near(regularizedLowerGamma(2, 10), 1 - 11 * Math.exp(-10), 1e-13);
    });

    it("P(1/2, x) = erf(√x): erf(1) = 0.8427007929497149 (A&S table 7.1)", () => {
        near(regularizedLowerGamma(0.5, 1), 0.8427007929497149, 1e-12);
    });

    it("gammaCDF scales x by θ", () => {
        near(gammaCDF(6, 2, 3), regularizedLowerGamma(2, 2), 1e-15);
    });
});

//=============================================================
describe("Kuznetsov x50 — [O05] Bårarp round 4 worked example", () => {
    it("A 13, K 0.55, Q 9.24, s_ANFO 62.2 % → x50 = 44.8 cm", () => {
        // [O05] p. A41 prints 44.8 cm. With (115/RWS)^(19/20) — the exponent Cunningham
        // (2005) prints — the same inputs give 54.5 cm.
        var x50 = kuznetsovX50({ rockFactor: 13, powderFactor: 0.55, chargeMass: 9.24, rws: 70 * 4 / 4.5 });
        near(x50, 448, 0.5, "x50 mm");
    });

    it("RWS defaults to ANFO (100): x50 scales with A and K^-0.8", () => {
        // hand: 1 · 1^-0.8 · 1^(1/6) · 1.15^(19/30) cm = 1.0926 cm
        near(kuznetsovX50({ rockFactor: 1, powderFactor: 1, chargeMass: 1 }), 10 * Math.pow(1.15, 19 / 30), 1e-12);
        var a = kuznetsovX50({ rockFactor: 7, powderFactor: 0.5, chargeMass: 100 });
        var b = kuznetsovX50({ rockFactor: 7, powderFactor: 1.0, chargeMass: 100 });
        near(a / b, Math.pow(2, 0.8), 1e-12, "K halved → × 2^0.8");
    });
});

describe("Cunningham (1987) uniformity index", () => {
    it("[O05] round 4 → n = 1.17 (B in m, d in mm)", () => {
        // hand: (2.2 − 14·1.8/51)·√((1 + 2.2/1.8)/2)·(1 − 0.25/1.8)·(1 + 0.1)^0.1·(3.9/5.2)
        //     = 1.70588 · 1.05409 · 0.86111 · 1.00958 · 0.75 = 1.1724
        near(cunninghamUniformity(ROUND4), 1.17, 0.005);
    });

    it("bottom / column charge term: equal decks give (0 + 0.1)^0.1", () => {
        var one = cunninghamUniformity(ROUND4);
        var split = cunninghamUniformity(Object.assign({}, ROUND4, { bottomChargeLength: 1.95, columnChargeLength: 1.95 }));
        near(split / one, Math.pow(0.1, 0.1) / Math.pow(1.1, 0.1), 1e-12);
    });

    it("staggered pattern raises n by 10 % (Cunningham 1983)", () => {
        near(cunninghamUniformity(Object.assign({ staggered: true }, ROUND4)) / cunninghamUniformity(ROUND4), 1.1, 1e-12);
    });

    it("a burden too large for the hole gives n ≤ 0, and predictFragmentation refuses it", () => {
        // hand: 2.2 − 14·10/51 = −0.545
        expect(cunninghamUniformity(Object.assign({}, ROUND4, { burden: 10, spacing: 10 }))).toBeLessThan(0);
        expect(() => predictFragmentation(Object.assign({}, ROUND4, { burden: 10, spacing: 10 }))).toThrow(RangeError);
    });
});

describe("Rock factor A — [C05] Eqs 4–7", () => {
    it("powdery rock: 0.06·(10 + (25·2.7 − 50) + 30/3) = 0.06·37.5 = 2.25", () => {
        near(rockFactorA({ rmd: 10, density: 2.7, youngsModulusGPa: 30, ucsMPa: 100 }), 2.25, 1e-12);
    });

    it("jointed rock: RMD = JF = 1.5·20 + 30 = 60; E ≥ 50 → HF = 150/5; 0.06·(60 + 15 + 30) = 6.3", () => {
        near(rockFactorA({ rmd: "jointed", jps: 20, jpa: 30, jcf: 1.5, density: 2.6, youngsModulusGPa: 60, ucsMPa: 150 }), 6.3, 1e-12);
    });
});

describe("Cunningham (2005) terms — [C05] Table 1 published ranges", () => {
    var base = { burden: 3, spacing: 3, holeDiamMm: 165, chargeLength: 10, benchHeight: 10, rockFactor: 6 };
    var n0 = cunningham2005Uniformity(base);
    function ratio(change) { return cunningham2005Uniformity(Object.assign({}, base, change)) / n0; }

    it("S/B 0.7 → 0.92, S/B 1.5 → 1.12", () => {
        near(ratio({ spacing: 2.1 }), 0.92, 0.005);
        near(ratio({ spacing: 4.5 }), 1.12, 0.005);
    });
    it("L/H 0.2 → 0.62", () => { near(ratio({ chargeLength: 2 }), 0.62, 0.005); });
    it("W/B 0.5 → 0.5", () => { near(ratio({ drillDeviation: 1.5 }), 0.5, 1e-12); });
    it("A 21 → 1.45 (the table's 1.45 for (21/6)^0.3 = 1.456)", () => { near(ratio({ rockFactor: 21 }), 1.45, 0.01); });
    it("n_s: R_s 0 → 1.21, R_s 1.6 → 0.87 (R_s = 6σ/T)", () => {
        near(cunninghamScatterFactor(0, 25), 1.21, 0.005);
        near(cunninghamScatterFactor(1.6 * 25 / 6, 25), 0.87, 0.005);
    });
    it("A_T [C05] Eq 9: T_max = 15.6·4/5.2 = 12 ms; r 0 → 2.1, r 1 → 1.05 (9a), r 2 → 1.0 (9b)", () => {
        near(cunninghamTimingFactor(0, 4, 5.2), 2.1, 1e-12);
        near(cunninghamTimingFactor(12, 4, 5.2), 0.66 - 0.13 - 1.58 + 2.1, 1e-12);
        near(cunninghamTimingFactor(24, 4, 5.2), 1.0, 1e-12);
    });
});

describe("Spathis median factor g(n) = (ln2)^(1/n) / Γ(1 + 1/n)", () => {
    it("n = 1: ln2 / Γ(2) = ln2; n = 2: √ln2 / Γ(3/2) = √ln2 / (√π/2)", () => {
        near(spathisMedianFactor(1), Math.LN2, 1e-12);
        near(spathisMedianFactor(2), Math.sqrt(Math.LN2) / (Math.sqrt(Math.PI) / 2), 1e-12);
    });
});

//=============================================================
describe("Rosin-Rammler — [F15] Eq 4 and Table 1", () => {
    // [F15] Table 1: characteristic size xc and X50 = xc · 0.693^(1/n), metres
    var TABLE1 = [
        ["J-1", 0.434, 0.333, 1.38], ["J-2", 0.216, 0.168, 1.47], ["J-3", 0.226, 0.179, 1.59], ["J-4", 0.282, 0.225, 1.62],
        ["J-5", 0.303, 0.230, 1.32], ["J-6", 0.322, 0.256, 1.61], ["J-7", 0.302, 0.240, 1.61], ["J-8", 0.204, 0.163, 1.64],
        ["G-1", 0.200, 0.158, 1.56], ["G-2", 0.201, 0.156, 1.45], ["G-3", 0.204, 0.161, 1.55], ["G-4", 0.287, 0.230, 1.64],
        ["G-5", 0.192, 0.151, 1.55], ["G-6", 0.205, 0.164, 1.62], ["G-7", 0.161, 0.129, 1.64], ["G-8", 0.153, 0.124, 1.76],
        ["G-9", 0.255, 0.199, 1.48], ["G-10", 0.113, 0.088, 1.51], ["G-11", 0.115, 0.091, 1.52], ["G-12", 0.098, 0.076, 1.49]
    ];
    it("the size at 1 − e^−1 (63.2 %) passing is xc, for all 20 blasts", () => {
        var P63 = 100 * (1 - Math.exp(-1));
        TABLE1.forEach((r) => {
            // ± 1.5 mm: X50 and xc are both printed to 1 mm
            near(rosinRammlerSize(P63, r[2] * 1000, r[3]), r[1] * 1000, 1.5, r[0]);
        });
    });
    it("50 % at x50; passing and size are inverses", () => {
        near(rosinRammlerPassing(300, 300, 1.4), 50, 1e-12);
        near(rosinRammlerPassing(rosinRammlerSize(80, 300, 1.4), 300, 1.4), 80, 1e-10);
    });
});

describe("Swebrec and KCO — [O05]", () => {
    it("KCO b for round 4: x50 44.8 cm, xmax ≈ 2.0 m, n 1.17 → b = 2.431", () => {
        var x50 = kuznetsovX50({ rockFactor: 13, powderFactor: 0.55, chargeMass: 9.24, rws: 70 * 4 / 4.5 });
        near(kcoB(x50, 2000, cunninghamUniformity(ROUND4)), 2.431, 0.001);
    });

    it("KCO b matches the Rosin-Rammler slope at x50 ([O05] Eq 3)", () => {
        var x50 = 400, xmax = 1500, n = 1.3, b = kcoB(x50, xmax, n), h = 1e-6;
        var sRR = (rosinRammlerPassing(x50 * Math.exp(h), x50, n) - rosinRammlerPassing(x50 * Math.exp(-h), x50, n)) / (2 * h);
        var sSW = (swebrecPassing(x50 * Math.exp(h), x50, xmax, b) - swebrecPassing(x50 * Math.exp(-h), x50, xmax, b)) / (2 * h);
        near(sSW, sRR, 1e-5);
    });

    it("hand values: 50 % at x50, 100 % at xmax, 1/(1 + 2^b) where ln(xmax/x) = 2 ln(xmax/x50)", () => {
        // Table 1 round 4 fit: x50 459, xmax 1497, b 2.238
        near(swebrecPassing(459, 459, 1497, 2.238), 50, 1e-12);
        expect(swebrecPassing(1497, 459, 1497, 2.238)).toBe(100);
        var x = 1497 / Math.pow(1497 / 459, 2);
        near(swebrecPassing(x, 459, 1497, 2.238), 100 / (1 + Math.pow(2, 2.238)), 1e-12);
        near(swebrecSize(100 / (1 + Math.pow(2, 2.238)), 459, 1497, 2.238), x, 1e-9);
    });

    it("[OSM17] Eqs 9a–9b recover (xmax, b) from x20, x50, x80 for each [O05] Table 1 fit", () => {
        // [O05] Table 1: x50 / xmax / b for the seven Bårarp rounds
        [[468, 1090, 1.778], [629, 2011, 2.735], [529, 2346, 3.189], [459, 1497, 2.238],
         [414, 1517, 2.398], [422, 2076, 2.651], [511, 1509, 2.261]].forEach((r) => {
            var fit = swebrecFromPercentiles(swebrecSize(20, r[0], r[1], r[2]), r[0], swebrecSize(80, r[0], r[1], r[2]));
            near(fit.xmax, r[1], 1e-6);
            near(fit.b, r[2], 1e-9);
        });
        expect(swebrecFromPercentiles(100, 200, 500)).toBeNull(); // upper tail longer: not Swebrec
    });
});

//=============================================================
describe("KC-KUM — [F15] Eqs 11–16 and the Fig 3 table", () => {
    // [F15] Fig 3 table: size (m), fine-to-central Eq, central-to-coarse Eq, KC-KUM
    var FIG3 = [
        [0.01, 11.4, 3.1, 11.4], [0.02, 16.6, 6.9, 16.6], [0.03, 20.6, 10.9, 20.6], [0.04, 24.0, 14.9, 24.0],
        [0.05, 27.0, 18.9, 27.0], [0.06, 29.7, 22.8, 29.7], [0.07, 32.2, 26.5, 32.2], [0.08, 34.4, 30.2, 34.4],
        [0.09, 36.5, 33.7, 36.5], [0.1, 38.5, 37.0, 38.5], [0.11, 40.4, 40.3, 40.4], [0.12, 42.1, 43.4, 43.4],
        [0.14, 45.4, 49.2, 49.2], [0.17, 49.7, 56.9, 56.9], [0.18, 51.0, 59.2, 59.2], [0.2, 53.5, 63.5, 63.5],
        [0.3, 63.6, 79.3, 79.3], [0.4, 71.0, 88.4, 88.4], [0.5, 76.6, 93.5, 93.5], [0.6, 81.0, 96.4, 96.4],
        [0.7, 84.5, 98.0, 98.0], [0.8, 90, 98.9, 98.9], [0.9, 94.3, 99.4, 99.4], [1, 98.5, 99.7, 99.7]
    ];
    // The figure's inputs are not printed. n_f 1.84 and S/B 1.2 are blast G-2 of Table 1;
    // X50 = 0.1584 m is the one value chosen (G-2 prints 0.156 m). With those, both
    // equations give every value below to the table's 0.1 rounding.
    var NF = 1.84, SB = 1.2, X50 = 0.1584;
    var laws = kckumParameters(X50, NF, SB);

    it("fine-to-central: k = n_f^X50/2, θ = 4·X50 (Eqs 12–13), 0.01 … 0.7 m", () => {
        // the fines column above 0.7 m (90, 94.3, 98.5) is not the equation's: KC-KUM uses
        // the coarse equation there
        FIG3.filter((r) => r[0] <= 0.7).forEach((r) => near(100 * gammaCDF(r[0], laws.fine.k, laws.fine.theta), r[1], 0.06, "fine " + r[0]));
    });

    it("central-to-coarse: k = n_f^0.3, θ = (S·X50/B)^1.1 (Eqs 14–15), 0.01 … 1 m", () => {
        FIG3.forEach((r) => near(100 * gammaCDF(r[0], laws.coarse.k, laws.coarse.theta), r[2], 0.06, "coarse " + r[0]));
    });

    it("the KC-KUM column: fines below the 40 % join, coarse above", () => {
        var curve = kckumCurve(X50 * 1000, NF, SB);
        FIG3.forEach((r) => {
            // 0.11 m sits on the join: the table takes the fines value (40.4), the curve the
            // coarse one (40.3), since the fines equation has passed 40 % there
            var expected = r[0] === 0.11 ? r[2] : r[3];
            near(curve.passing(r[0] * 1000), expected, 0.06, "KC-KUM " + r[0]);
        });
    });

    it("sizeAt inverts passing on both sides of the join", () => {
        var curve = kckumCurve(158.4, NF, SB);
        [10, 25, 40, 41, 60, 80, 95].forEach((P) => near(curve.passing(curve.sizeAt(P)), P, 1e-6, "P" + P));
    });

    it("n_f (Eq 11): the 0.5 power on (1 + S/B)/2 removed", () => {
        // hand: (2.2 − 14·4/165)·((1 + 4.8/4)/2)·(1 − 0.2/4)·(12/14) = 1.86061·1.1·0.95·0.85714 = 1.66653
        var p = { burden: 4, spacing: 4.8, holeDiamMm: 165, drillDeviation: 0.2, chargeLength: 12, benchHeight: 14 };
        near(kckumUniformity(p), (2.2 - 14 * 4 / 165) * 1.1 * 0.95 * (12 / 14), 1e-12);
    });
});

//=============================================================
describe("predictFragmentation", () => {
    it("[O05] round 4 end to end: x50 44.8 cm, n 1.17, KCO b 2.431 with xmax 2.0 m", () => {
        var r = predictFragmentation(ROUND4, { xmax: 2000 });
        near(r.x50, 448, 0.5);
        near(r.n, 1.17, 0.005);
        near(r.kco.b, 2.431, 0.001);
        near(r.kco.passing(r.x50), 50, 1e-9);
        near(r.kuzRam.passing(r.x50), 50, 1e-9);
        expect(r.warnings).toEqual([]);
    });

    it("powder factor and charge mass from the column when not given", () => {
        // hand: π/4 · 0.089² · 8 · 0.8 · 1000 = 39.815 kg; K = 39.815 / (3 · 3.5 · 10) = 0.37919
        var design = { burden: 3, spacing: 3.5, benchHeight: 10, holeDiamMm: 89, chargeLength: 8, explosiveDensity: 0.8, rockFactor: 7 };
        var r = predictFragmentation(design);
        near(r.chargeMass, Math.PI / 4 * 0.089 * 0.089 * 8 * 800, 1e-9);
        near(columnChargeMass(89, 8, 0.8), r.chargeMass, 1e-12);
        near(r.powderFactor, r.chargeMass / 105, 1e-12);
        near(r.kco.xmax, 3000, 1e-9); // min(B, S)
    });

    it("KC-KUM takes the Spathis median; Kuz-Ram and KCO only with spathis: true", () => {
        var r = predictFragmentation(ROUND4, { xmax: 2000 });
        var g = spathisMedianFactor(r.n);
        near(r.kckum.x50, r.x50 * g, 1e-9);
        near(r.kuzRam.x50, r.x50, 1e-12);
        near(predictFragmentation(ROUND4, { xmax: 2000, spathis: true }).kuzRam.x50, r.x50 * g, 1e-9);
    });

    it("Cunningham 2005: x50 takes A·A_T·C(A); n is the 2005 form", () => {
        // T_max = 15.6·1.8/5.2 = 5.4 ms; T = 2.7 ms → r = 0.5:
        // A_T = 0.66/8 − 0.13/4 − 1.58/2 + 2.1 = 1.36
        var c05 = { delayMs: 2.7, pWaveKmS: 5.2, cA: 1.2 };
        var r = predictFragmentation(ROUND4, { xmax: 2000, cunningham2005: c05 });
        near(r.effectiveRockFactor, 13 * 1.36 * 1.2, 1e-9);
        near(r.x50, 448.3 * 1.36 * 1.2, 0.9);
        near(r.n, cunningham2005Uniformity(Object.assign({}, ROUND4)), 1e-12);
    });

    it("an xmax not above x50 leaves KCO out, with a warning", () => {
        var r = predictFragmentation(ROUND4, { xmax: 300 });
        expect(r.kco).toBeNull();
        expect(r.warnings[0].code).toBe("XMAX_BELOW_X50");
    });

    it("percentileSizes reads each model's sizeAt", () => {
        var r = predictFragmentation(ROUND4, { xmax: 2000 });
        var p = percentileSizes(r.kco);
        near(p[50], r.x50, 1e-9);
        near(r.kco.passing(p[80]), 80, 1e-9);
    });
});

describe("Back-fit of the rock factor", () => {
    var design = { burden: 3, spacing: 3.5, benchHeight: 10, holeDiamMm: 89, chargeLength: 8, explosiveDensity: 0.8, rockFactor: 1 };
    var sizes = [20, 50, 100, 200, 400, 700, 1000, 1500];
    ["kco", "kuz-ram", "kckum"].forEach((model) => {
        it(model + ": a curve drawn with A = 9 gives back A = 9", () => {
            var truth = predictFragmentation(Object.assign({}, design, { rockFactor: 9 }));
            var curve = truth[model === "kuz-ram" ? "kuzRam" : model];
            var fit = fitRockFactor({ sizes: sizes, passing: sizes.map(curve.passing) }, design, { model: model });
            near(fit.rockFactor, 9, 1e-4);
            near(fit.rmse, 0, 1e-4);
        });
    });
    it("an unknown model is refused", () => {
        expect(() => fitRockFactor({ sizes: [1], passing: [1] }, design, { model: "czm" })).toThrow(RangeError);
    });
});

describe("Tabulated curves — linear in log size", () => {
    it("halfway in log size is halfway in passing: (10, 20 %)–(100, 60 %) at √1000 → 40 %", () => {
        near(tabulatedPassing([10, 100], [20, 60], Math.sqrt(1000)), 40, 1e-12);
        near(tabulatedSize([10, 100], [20, 60], 40), Math.sqrt(1000), 1e-9);
        expect(tabulatedPassing([10, 100], [20, 60], 5)).toBe(20);
        expect(tabulatedSize([10, 100], [20, 60], 99)).toBe(100);
    });
});

describe("Borehole pressure", () => {
    it("Pb = ρ·VOD²/8: ANFO 0.8 g/cm³ at 3500 m/s → 800·3500²/8 Pa = 1225 MPa", () => {
        near(boreholePressureMPa(0.8, 3500), 1225, 1e-9);
    });
});

describe("package root", () => {
    it("exports the fragmentation API", () => {
        ["rockFactorA", "kuznetsovX50", "cunninghamUniformity", "swebrecPassing", "kcoB", "kckumCurve",
         "predictFragmentation", "fitRockFactor", "boreholePressureMPa", "regularizedLowerGamma"].forEach((k) => {
            expect(typeof api[k]).toBe("function");
        });
    });
});
