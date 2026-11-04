/**
 * chiappetta.test.js — Chiappetta (1990) presplit methods against his worked
 * examples and tables
 *
 * Author: Brent Buffham — blastingapps.com & kirra-design.com
 *
 * SOURCE (key in brentbuffham/blasting-knowledge references.bib)
 *  [C90] chiappetta1990presplit — Chiappetta, R.F. (1990) Presplitting and
 *        controlled blasting techniques. 2nd High-Tech Seminar, Orlando, ISEE,
 *        Section 14. Page numbers are the PDF's.
 */

import { describe, it, expect } from "vitest";
import { adiabaticWallPressureMPa, forceBalanceSpacingM } from "../src/presplit/WallPressure.js";
import { mpaToPsi, psiToMpa } from "../src/presplit/Presplit.js";
import { chiappettaPlaneLoadKgPerM, chiappettaPlaneSpacingM, chiappettaFieldRow, chiappettaAirDeckGuide,
    CHIAPPETTA_PLANE_CHARGE_KG_M2, LB_PER_FT_IN_KG_PER_M, LB_PER_FT2_IN_KG_PER_M2 } from "../src/presplit/Chiappetta.js";
import { runPresplitModels } from "../src/presplit/PresplitModels.js";
import * as api from "../src/index.js";

function near(actual, expected, tol, label) {
    if (!(Math.abs(actual - expected) <= tol)) throw new Error((label || "") + " expected " + expected + " ± " + tol + ", got " + actual);
}
var FT = 0.3048, IN = 25.4, LB = 0.45359237;

// Method I: Pb = 1.69×10⁻³·ρ·D²·(√C·rc/rh)^2.4 psi, D in ft/s (pp23–24, 29–30)
// [name, ρ, D ft/s, charge diam in, hole diam in, C, printed Pb psi]
var EXAMPLES = [
    ["Ex 1 coupled (p34)", 1.03, 13000, 6, 6, 1, 294178],
    ["Ex 1 4 in tube (p35)", 1.03, 13000, 4, 6, 1, 111171],
    ["Ex 1 3 in tube", 1.03, 13000, 3, 6, 1, 55736],
    ["Ex 1 2.5 in tube", 1.03, 13000, 2.5, 6, 1, 35984],
    ["Ex 2 continuous (p36)", 1.3, 16000, 1.25, 3, 1, 68796],
    ["Ex 2 decked C = 0.5", 1.3, 16000, 1.25, 3, 0.5, 29945],
    ["Ex 3 coupled (p38)", 1.25, 17000, 3, 3, 1, 610513],
    ["Ex 4 Kleen Cut C (p39)", 0.92, 14000, 1.13, 2, 1, 77418],
    ["Ex 4 Kleen Cut E", 0.58, 9200, 1.13, 2, 1, 21077],
    ["Ex 4 Kleen Cut U", 0.76, 9200, 1.13, 2, 1, 27618]
];
function design(e) { return { holeDiamMm: e[4] * IN, chargeDiamMm: e[3] * IN, densityGcc: e[1], vodMs: e[2] * FT, chargeFraction: e[5] }; }

describe("Method I is Sanden's adiabatic form — [C90] Examples 1–4", () => {
    EXAMPLES.forEach(function (e) {
        it(e[0] + ": " + e[6] + " psi", () => {
            // with his rounded constant 1.69×10⁻³ every printed pressure comes back to the psi
            var Pe = psiToMpa(1.69e-3 * e[1] * e[2] * e[2]);
            near(mpaToPsi(adiabaticWallPressureMPa(Object.assign({ explosionPressureMPa: Pe }, design(e)))), e[6], 1);
            // the library's ρD²/8 is 1.6843×10⁻³ in these units: 0.34 % under his
            near(mpaToPsi(adiabaticWallPressureMPa(design(e))) / e[6], 1.6843 / 1.69, 0.0002);
        });
    });
});

describe("Method I spacing S = 2rh·(Pb + T)/T — [C90]", () => {
    function sIn(dhIn, pb, T) { return forceBalanceSpacingM(dhIn * IN, psiToMpa(pb), psiToMpa(T)) * 1000 / IN; }
    it("Ex 1: 2.5 in tube ≤ 49 in, 3 in tube ≤ 73 in (pp35–36)", () => {
        near(sIn(6, 35984, 5000), 49.18, 0.01);
        near(sIn(6, 55736, 5000), 72.88, 0.01);
    });
    it("Ex 2: 39 in — the paper prints 78 in, using 2rh = 6 for the 3 in hole (p37)", () => {
        near(sIn(3, 29945, 2500), 38.93, 0.01);
        near(sIn(6, 29945, 2500), 77.87, 0.01); // the printed slip, twice the spacing
    });
    it("Ex 4 Kleen Cut C, E, U: 72, 21, 27 in (p39; the ft conversions 1.8′ and 3.0′ printed for 21 and 27 in are slips)", () => {
        near(sIn(2, 77418, 2200), 72.38, 0.01);
        near(sIn(2, 21077, 2200), 21.16, 0.01);
        near(sIn(2, 27618, 2200), 27.11, 0.01);
    });
    it("Ex 3: Pb = C sets the coupling ratio: (C.R.)^2.4 = 50000/610513 → C.R. 0.35, rc 0.53 in (p38)", () => {
        var cr = Math.pow(50000 / 610513, 1 / 2.4);
        near(cr, 0.35, 0.005);
        near(cr * 1.5, 0.53, 0.005);
    });
});

describe("Method II: 0.1 lb per square foot of presplit plane — [C90] p42", () => {
    it("0.1 lb/ft² = 0.488 kg/m²", () => near(CHIAPPETTA_PLANE_CHARGE_KG_M2, 0.48824, 0.00001));
    it("a 4 ft spacing takes 0.40 lb/ft, and back", () => {
        near(chiappettaPlaneLoadKgPerM(4 * FT) / LB_PER_FT_IN_KG_PER_M, 0.40, 1e-12);
        near(chiappettaPlaneSpacingM(0.4 * LB_PER_FT_IN_KG_PER_M) / FT, 4, 1e-12);
    });
});

describe("Method III field table — [C90] p44", () => {
    it("3 in row: 0.34 lb/ft, 24–36 in", () => {
        var r = chiappettaFieldRow(3 * IN);
        expect(r.holeDiamIn).toBe(3);
        near(r.loadKgPerM / LB_PER_FT_IN_KG_PER_M, 0.34, 1e-12);
        near(r.spacingM[0], 24 * IN / 1000, 1e-12);
        near(r.spacingM[1], 36 * IN / 1000, 1e-12);
    });
    it("76 mm is the 3 in row; 4.5 in is not tabulated and is not interpolated", () => {
        expect(chiappettaFieldRow(76).holeDiamIn).toBe(3);
        expect(chiappettaFieldRow(4.5 * IN)).toBeNull();
        expect(chiappettaFieldRow(8 * IN).spacingM[1]).toBeCloseTo(84 * IN / 1000, 12);
    });
});

describe("air-deck starting guidelines — [C90] pp48–50", () => {
    it("9 in hole, 50 ft: spacing 15.3–18.0 ft, stemming 9–10.8 ft, burden 9 ft (p48)", () => {
        var g = chiappettaAirDeckGuide(9 * IN, 50 * FT);
        near(g.spacingM[0] / FT, 15.3, 1e-9);
        near(g.spacingM[1] / FT, 18.0, 1e-9);
        near(g.stemmingM[0] / FT, 9.0, 1e-9);
        near(g.stemmingM[1] / FT, 10.8, 1e-9);
        near(g.burdenM / FT, 9, 1e-9);
    });
    it("charge 0.08–0.12 lb/ft² over mean spacing × depth: 67–100 lb (the paper rounds the mean 16.65 ft to 17, giving 68–102)", () => {
        var g = chiappettaAirDeckGuide(9 * IN, 50 * FT);
        near(g.meanSpacingM / FT, 16.65, 1e-9);
        near(g.chargeKg[0] / LB, 0.08 * 16.65 * 50, 1e-9);
        near(g.chargeKg[1] / LB, 0.12 * 16.65 * 50, 1e-9);
        near(0.08 * 17 * 50, 68, 1e-9);
        near(0.12 * 17 * 50, 102, 1e-9);
    });
    it("the p50 table is the 2.0·d spacing at 0.10 lb/ft²: 4 in → 8 ft, 40 lb; 15 in → 30 ft, 150 lb", () => {
        [[4, 8, 40], [9, 18, 90], [15, 30, 150]].forEach(function (r) {
            var g = chiappettaAirDeckGuide(r[0] * IN, 50 * FT);
            near(g.spacingM[1] / FT, r[1], 1e-9);
            near(0.10 * LB_PER_FT2_IN_KG_PER_M2 * g.spacingM[1] * 50 * FT / LB, r[2], 1e-9);
        });
    });
});

describe("in runPresplitModels", () => {
    it("Kleen Cut E in a 2 in hole: the plane rule and the 2 in table row both apply", () => {
        var r = runPresplitModels({ holeDiamMm: 2 * IN, chargeDiamMm: 1.13 * IN, densityGcc: 0.58, vodMs: 9200 * FT,
            tensileMPa: psiToMpa(2200), spacingM: 0.5 });
        var pl = r.models.find((m) => m.id === "chiappetta-plane");
        var fr = r.models.find((m) => m.id === "chiappetta-field");
        expect(pl.applicable).toBe(true);
        near(pl.maxSpacingM, r.design.loadGPerM / 1000 / CHIAPPETTA_PLANE_CHARGE_KG_M2, 1e-12);
        expect(fr.applicable).toBe(true);
        near(fr.maxSpacingM, 24 * IN / 1000, 1e-12);
        expect(fr.splits).toBe(true);
        var ad = r.models.find((m) => m.id === "sanden-adiabatic");
        expect(ad.citation).toMatch(/Chiappetta/);
    });
    it("the plane rule takes the hole's average charge: half the column loaded, half the spacing", () => {
        var d = { holeDiamMm: 76, chargeDiamMm: 25, densityGcc: 1.2, vodMs: 5000 };
        var full = runPresplitModels(d).models.find((m) => m.id === "chiappetta-plane").maxSpacingM;
        var half = runPresplitModels(Object.assign({ chargeFraction: 0.5 }, d)).models.find((m) => m.id === "chiappetta-plane").maxSpacingM;
        near(half, full / 2, 1e-12);
    });
    it("the plane rule is out of range over 6¾ in", () => {
        var r = runPresplitModels({ holeDiamMm: 200, chargeDiamMm: 50, densityGcc: 1.2, vodMs: 5000 });
        expect(r.models.find((m) => m.id === "chiappetta-plane").applicable).toBe(false);
    });
    it("the package root exports the Chiappetta rules", () => {
        ["chiappettaPlaneLoadKgPerM", "chiappettaPlaneSpacingM", "chiappettaFieldRow", "chiappettaAirDeckGuide"]
            .forEach((k) => expect(typeof api[k]).toBe("function"));
        expect(Array.isArray(api.CHIAPPETTA_FIELD_TABLE)).toBe(true);
    });
});
