/**
 * wallPressure.test.js — decoupled-charge wall pressure and presplit spacing,
 * against the worked examples in Hustrulid (2007)
 *
 * Author: Brent Buffham — blastingapps.com & kirra-design.com
 *
 * SOURCES (keys are brentbuffham/blasting-knowledge references.bib)
 *  [H07] hustrulid2007presplit — Hustrulid, W.A. (2007) A practical, yet technically sound, design
 *        procedure for pre-split blasts. Proc. 33rd ISEE Annual Conference,
 *        Nashville, Vol 1, 1–26. Page numbers are the PDF's.
 */

import { describe, it, expect } from "vitest";
import { explosionPressureMPa, chargeDiameterFromLoadMm, volumeRatio, hustrulidCovolume, hinoCovolume,
    idealGasWallPressureMPa, adiabaticWallPressureMPa, hinoWallPressureMPa, isothermalWallPressureMPa,
    forceBalanceSpacingM, webTensionMPa } from "../src/presplit/WallPressure.js";
import { gramsPerMetreToGrainsPerFoot } from "../src/presplit/Presplit.js";

function near(actual, expected, tol, label) {
    if (!(Math.abs(actual - expected) <= tol)) throw new Error((label || "") + " expected " + expected + " ± " + tol + ", got " + actual);
}

describe("explosion pressure Pe = ρD²/8 — [H07] Eq 31", () => {
    it("ANFO 800 kg/m³ at 4530 m/s → 2052 MPa (p8)", () => near(explosionPressureMPa(0.8, 4530), 2052, 0.5));
    it("PETN 1400 kg/m³ at 7036 m/s → 8660 MPa (p9, printed to 3 figures)", () => near(explosionPressureMPa(1.4, 7036), 8660, 5));
    it("NG 1600 kg/m³ at 7800 m/s → 12168 MPa = 121.68 kbar (p17)", () => near(explosionPressureMPa(1.6, 7800), 12168, 0.5));
});

describe("detonating-cord core — [H07] p8 and p19", () => {
    it("50 gr/ft = 10.63 g/m; at 1.4 g/cm³ the core is 0.3109 cm", () => {
        var gPerM = 50 / gramsPerMetreToGrainsPerFoot(1);
        near(gPerM, 10.63, 0.005);
        near(chargeDiameterFromLoadMm(10.63, 1.4), 3.109, 0.001);
    });
    it("bundles of 4, 5 and 6 strands at 1.25 g/cm³ → 0.658, 0.736, 0.806 cm", () => {
        near(chargeDiameterFromLoadMm(42.52, 1.25), 6.58, 0.005);
        near(chargeDiameterFromLoadMm(53.15, 1.25), 7.36, 0.005);
        near(chargeDiameterFromLoadMm(63.78, 1.25), 8.06, 0.005);
    });
});

describe("co-volume fits", () => {
    it("Hino Eq 43 reproduces his Table 1 (p12): α(1) = 0.675, α(2) = 0.859, α(0.5) = 0.429", () => {
        near(hinoCovolume(1), 0.675, 0.0005);
        near(hinoCovolume(2), 0.859, 0.0005);
        near(hinoCovolume(0.5), 0.429, 0.001);
    });
    it("Hustrulid Eq 55: a_e = υe − α for NG (υe 0.625) = 0.1089 (p17)", () => {
        near(0.625 - hustrulidCovolume(0.625), 0.1089, 0.0001);
    });
});

describe("Hino's worked example — [H07] p12", () => {
    it("υe = 1, VR = 2: co-volume Pw = 0.28 Pe; ideal gas Pw = Pe/VR", () => {
        // Hino's own numbers: (1 − 0.675)/(2 − 0.859) = 0.285. A 42 mm hole and a charge
        // giving VR = 2 exactly (42/√2 mm), ρ = 1 g/cm³.
        var p = { holeDiamMm: 42, chargeDiamMm: 42 / Math.SQRT2, densityGcc: 1, explosionPressureMPa: 1000 };
        near(hinoWallPressureMPa(p) / 1000, (1 - 0.675) / (2 - 0.859), 0.001);
        near(idealGasWallPressureMPa(p), 500, 1e-9);
    });
});

describe("Utah/NIOSH isothermal method — [H07] Table 2 (p18), NG", () => {
    // Technique 1 column: Ko = Pe·ae = nRT = 12717 atm (p17), υe = 1/1.6 = 0.625. Every value is
    // reproduced. (The Technique 2 column is a little off its own method at Vh/Ve 8 and 16 —
    // 3.34 and 1.49 printed against 3.31 and 1.48 — and its 121.28 at Vh/Ve 1 is the text's 121.68.)
    var ae = 0.625 - hustrulidCovolume(0.625);
    var PeMPa = 12717 / ae * 0.101325; // atm → MPa
    var cols = [[2, 25.96], [4, 8.10], [8, 3.22], [16, 1.44], [32, 0.68], [64, 0.33], [128, 0.16], [256, 0.08]];
    cols.forEach(function (c) {
        it("Vh/Ve = " + c[0] + " → " + c[1] + " kbar", () => {
            var p = { holeDiamMm: 100, chargeDiamMm: 100 / Math.sqrt(c[0]), densityGcc: 1.6, explosionPressureMPa: PeMPa };
            near(isothermalWallPressureMPa(p) / 100, c[1], 0.011);
        });
    });
    it("Technique 2 (Pe = ρD²/8 = 121.68 kbar) at Vh/Ve 2, 4, 32, 64 → 26.68, 8.34, 0.70, 0.34", () => {
        [[2, 26.68], [4, 8.34], [32, 0.70], [64, 0.34]].forEach(function (c) {
            var p = { holeDiamMm: 100, chargeDiamMm: 100 / Math.sqrt(c[0]), densityGcc: 1.6, vodMs: 7800 };
            near(isothermalWallPressureMPa(p) / 100, c[1], 0.011, "VR " + c[0]);
        });
    });
});

describe("Sanden's Queenston limestone shots, re-analysed — [H07] pp19–21", () => {
    // 1.75 in hole; 50 gr/ft cord at 6400 m/s, PETN 1.25 g/cm³ → Pe 6400 MPa
    var dh = 1.75 * 25.4;
    var shots = { 4: 42.52, 5: 53.15, 6: 63.78 };
    var Pw = {};
    Object.keys(shots).forEach(function (n) {
        Pw[n] = isothermalWallPressureMPa({ holeDiamMm: dh, chargeDiamMm: chargeDiameterFromLoadMm(shots[n], 1.25), densityGcc: 1.25, vodMs: 6400 });
    });
    it("wall pressures 34.52, 43.27, 52.45 MPa for 4, 5, 6 strands", () => {
        near(Pw[4], 34.52, 0.05);
        // the paper's own steps give 43.48 and 52.57 for 5 and 6 strands (its VR 36.47 and
        // 30.41 included); the printed 43.27 and 52.45 are 0.5 % and 0.2 % arithmetic slips
        near(Pw[5], 43.27, 0.25);
        near(Pw[6], 52.45, 0.15);
    });
    it("web tension T = Pw/(S/dh − 1): 2.60, 3.26, 4.56, 5.71, 5.03 MPa for shots 1–5", () => {
        var inch = 0.0254;
        near(webTensionMPa(dh, Pw[4], 25 * inch), 2.60, 0.02, "shot 1");
        near(webTensionMPa(dh, Pw[5], 25 * inch), 3.26, 0.03, "shot 2"); // 5-strand Pw slip above
        near(webTensionMPa(dh, Pw[4], 15 * inch), 4.56, 0.02, "shot 3");
        near(webTensionMPa(dh, Pw[5], 15 * inch), 5.71, 0.04, "shot 4");
        near(webTensionMPa(dh, Pw[6], 20 * inch), 5.03, 0.02, "shot 5");
    });
});

describe("Atlas Kleen Cut road cut, SI — [H07] pp23–24", () => {
    // 50.8 mm holes, 28.7 mm cartridges; granite C 172 MPa, T 4.1 MPa
    function pw(D, rho) { return isothermalWallPressureMPa({ holeDiamMm: 50.8, chargeDiamMm: 28.7, densityGcc: rho, vodMs: D }); }
    it("Kleen Cut C: Pe 2095 MPa, Pw 321 MPa (rejected: over C = 172)", () => {
        near(explosionPressureMPa(0.92, 4268), 2095, 0.5);
        near(pw(4268, 0.92), 321, 1);
    });
    it("Kleen Cut E and U: Pw 115 and 130 MPa", () => {
        near(pw(2805, 0.58), 115, 1);
        near(pw(2805, 0.76), 130, 1);
    });
    it("spacing S = dh·(Pw + T)/T: 1.48 m (E); U is 1.66 m", () => {
        near(forceBalanceSpacingM(50.8, 115, 4.1), 1.48, 0.005);
        // the SI example prints "162 mm = 1.62 m" for U, but 50.8·(130 + 4.1)/4.1 = 1661.5 mm;
        // the same example in English units (p22) gives 2·(18960 + 600)/600 = 65 in = 1.65 m
        near(forceBalanceSpacingM(50.8, 130, 4.1), 1.6615, 0.001);
        near(forceBalanceSpacingM(2 * 25.4, 18960 * 0.006894757, 600 * 0.006894757) / 0.0254, 65.2, 0.05);
    });
});

describe("Atlas Kleen Cut by Sanden's adiabatic form — CDOT 2018, pp30–31", () => {
    // petr2018cdotperimeter — Petr, Lozano & Nieczkoski (2018) Rock Excavation Best Management Practice Phase I,
    // Colorado School of Mines for CDOT, Report CDOT-2018-07: Pe = ρD²/8, Pw = Pe·(de/dh)^2.4,
    // S = dh·(Pw + T)/T. Same case as Hustrulid's isothermal example above.
    function pw(D, rho) { return adiabaticWallPressureMPa({ holeDiamMm: 50.8, chargeDiamMm: 28.7, densityGcc: rho, vodMs: D }); }
    it("Kleen Cut C, E, U: Pe 2095, 570, 747 → Pw 532, 145, 190 MPa", () => {
        near(explosionPressureMPa(0.58, 2805), 570, 0.5);
        near(explosionPressureMPa(0.76, 2805), 747, 0.5);
        near(pw(4268, 0.92), 532, 1);
        near(pw(2805, 0.58), 145, 1);
        near(pw(2805, 0.76), 190, 1);
    });
    it("Kleen Cut E spacing 1.85 m (Hustrulid's isothermal method: 1.48 m on the same case)", () => {
        near(forceBalanceSpacingM(50.8, pw(2805, 0.58), 4.1), 1.85, 0.005);
    });
});

describe("the methods relative to one another", () => {
    var p = { holeDiamMm: 76, chargeDiamMm: 22, densityGcc: 1.2, vodMs: 5000 };
    it("adiabatic with 2γ = 2 is the ideal gas", () => {
        near(adiabaticWallPressureMPa(Object.assign({ exponent2Gamma: 2 }, p)), idealGasWallPressureMPa(p), 1e-9);
    });
    it("Sanden's 2γ = 2.4 is (Ve/Vh)^1.2 of Pe", () => {
        var VR = volumeRatio(76, 22);
        near(adiabaticWallPressureMPa(p), explosionPressureMPa(1.2, 5000) * Math.pow(1 / VR, 1.2), 1e-9);
    });
    it("an air-decked column (w < 1) takes the volume ratio up by 1/w ([H07] Eq 72)", () => {
        near(volumeRatio(76, 22, 0.5), 2 * volumeRatio(76, 22), 1e-12);
        expect(() => volumeRatio(76, 22, 0)).toThrow(RangeError);
    });
    it("Eq 30a: with Pw = C the spacing is dh·(C/T + 1)", () => {
        near(forceBalanceSpacingM(50.8, 172, 4.1), 0.0508 * (172 / 4.1 + 1), 1e-12);
    });
});
