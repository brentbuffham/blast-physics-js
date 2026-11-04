/**
 * berta.test.js — Berta (1990) presplit spacing, against his worked example,
 * and the US empirical rules and Du Pont table he prints
 *
 * Author: Brent Buffham — blastingapps.com & kirra-design.com
 *
 * SOURCE (key in brentbuffham/blasting-knowledge references.bib)
 *  [B90] berta1990explosives — Berta, G. (1990) Explosives: An Engineering
 *        Tool. Italesplosivi, Milano. Book page numbers.
 */

import { describe, it, expect } from "vitest";
import { bertaWallPressureMPa, bertaSpacingM, presplitTenDiameterSpacingM, presplitLoadFromSpacingKgPerM,
    presplitSpacingFromLoadM, DUPONT_PRESPLIT_TABLE, dupontPresplitRow } from "../src/presplit/Berta.js";
import { forceBalanceSpacingM, webTensionMPa, idealGasWallPressureMPa } from "../src/presplit/WallPressure.js";
import { runPresplitModels } from "../src/presplit/PresplitModels.js";
import * as api from "../src/index.js";

function near(actual, expected, tol, label) {
    if (!(Math.abs(actual - expected) <= tol)) throw new Error((label || "") + " expected " + expected + " ± " + tol + ", got " + actual);
}

// Gelatina 1: Ps 1007 MPa, Δc 1.45; 64 mm holes at S = 10·Øf = 0.64 m (p103)
var GEL = { holeDiamMm: 64, densityGcc: 1.45, specificPressureMPa: 1007 };

describe("Berta's worked example — [B90] pp103–104", () => {
    it("q = 0.815·0.64² = 0.33 kg/m; at 1450 kg/m³ that is a 17 mm charge", () => {
        near(presplitTenDiameterSpacingM(64), 0.64, 1e-12);
        near(presplitLoadFromSpacingKgPerM(0.64), 0.33, 0.005);
        near(Math.sqrt(0.33 * 4 / (Math.PI * 1450)) * 1000, 17, 0.05);
    });
    it("17 mm continuous: quasi-static stress Ttr = 11.5 MPa", () => {
        var Pw = bertaWallPressureMPa(Object.assign({ chargeDiamMm: 17 }, GEL));
        near(webTensionMPa(64, Pw, 0.64), 11.5, 0.06);
    });
    it("25 mm cartridges over (17/25)² = 0.46 of the hole: the same 11.5 MPa (p104 prints the denominator 0.640 − 0.640 for 0.640 − 0.064)", () => {
        var w = Math.pow(17 / 25, 2);
        near(w, 0.46, 0.005);
        var Pw = bertaWallPressureMPa(Object.assign({ chargeDiamMm: 25, chargeFraction: w }, GEL));
        near(webTensionMPa(64, Pw, 0.64), 11.5, 0.06);
        near(Pw, bertaWallPressureMPa(Object.assign({ chargeDiamMm: 17 }, GEL)), 1e-9);
    });
    it("rearranged III.1: S = Øf·Pw/σtr + Øf gives back 0.64 m at σtr = 11.45 MPa", () => {
        var Pw = bertaWallPressureMPa(Object.assign({ chargeDiamMm: 17 }, GEL));
        var T = webTensionMPa(64, Pw, 0.64);
        near(bertaSpacingM(64, Pw, T), 0.64, 1e-12);
        near(bertaSpacingM(64, Pw, T), forceBalanceSpacingM(64, Pw, T), 1e-12);
    });
    it("the release coefficient K (ornamental stone, about 0.5, p402) divides the tensile term", () => {
        var Pw = 50;
        near(bertaSpacingM(32, Pw, 10, 0.5) - 0.032, 2 * (bertaSpacingM(32, Pw, 10) - 0.032), 1e-12);
    });
    it("Berta's wall pressure is the ideal-gas expansion with Ps·Δc in place of ρD²/8", () => {
        var p = Object.assign({ chargeDiamMm: 25, chargeFraction: 0.5 }, GEL);
        near(bertaWallPressureMPa(p), idealGasWallPressureMPa(Object.assign({ explosionPressureMPa: 1007 * 1.45 }, p)), 1e-9);
    });
});

describe("US empirical rules and the Du Pont table — [B90] p102", () => {
    it("formula III.3 column of the comparison table: 0.07–0.17, 0.17–0.29, 0.17–0.66, 0.29–1.17 kg/m", () => {
        [[0.30, 0.07], [0.45, 0.17], [0.60, 0.29], [0.90, 0.66], [1.20, 1.17]].forEach(function (r) {
            near(presplitLoadFromSpacingKgPerM(r[0]), r[1], 0.005, "S " + r[0]);
        });
        near(presplitSpacingFromLoadM(presplitLoadFromSpacingKgPerM(0.8)), 0.8, 1e-12);
    });
    it("with S = 10·Øf, q = 0.815·S² is Konya's d²/28 lb/ft to about 1 %", () => {
        var d = 0.0762; // 3 in
        var konya = Math.pow(d / 0.0254, 2) / 28 * 0.45359237 / 0.3048;
        near(presplitLoadFromSpacingKgPerM(10 * d) / konya, 81.5 / 82.38, 0.0005);
    });
    it("Du Pont rows as printed, looked up by hole size", () => {
        expect(DUPONT_PRESPLIT_TABLE.length).toBe(4);
        expect(dupontPresplitRow(57).spacingM).toEqual([0.45, 0.60]);
        expect(dupontPresplitRow(102).loadKgPerM).toEqual([0.38, 1.12]);
        expect(dupontPresplitRow(70)).toBeNull();
    });
});

describe("in runPresplitModels", () => {
    var d = { holeDiamMm: 64, chargeDiamMm: 17, densityGcc: 1.45, vodMs: 6000, tensileMPa: 11.45, spacingM: 0.64, specificPressureMPa: 1007 };
    it("berta is a gas model with the force-balance spacing", () => {
        var m = runPresplitModels(d).models.find((x) => x.id === "berta");
        expect(m.applicable).toBe(true);
        near(m.maxSpacingM, 0.64, 0.005);
    });
    it("without the specific pressure it is not applicable, and says why", () => {
        var m = runPresplitModels(Object.assign({}, d, { specificPressureMPa: undefined })).models.find((x) => x.id === "berta");
        expect(m.applicable).toBe(false);
        expect(m.notes.join(" ")).toMatch(/specific pressure/);
    });
    it("us-empirical: the charge's spacing, capped at 10 hole diameters", () => {
        var r = runPresplitModels(d);
        var m = r.models.find((x) => x.id === "us-empirical");
        var q = r.design.loadGPerM / 1000;
        near(m.maxSpacingM, Math.min(Math.sqrt(q / 0.815), 0.64), 1e-12);
        var big = runPresplitModels(Object.assign({}, d, { chargeDiamMm: 40 })).models.find((x) => x.id === "us-empirical");
        near(big.maxSpacingM, 0.64, 1e-12);
    });
    it("dupont-table applies to 64 mm (the 51–64 row)", () => {
        var m = runPresplitModels(d).models.find((x) => x.id === "dupont-table");
        expect(m.applicable).toBe(true);
        near(m.maxSpacingM, 0.60, 1e-12);
        expect(m.splits).toBe(false);
    });
    it("the package root exports the Berta functions", () => {
        ["bertaWallPressureMPa", "bertaSpacingM", "presplitTenDiameterSpacingM", "presplitLoadFromSpacingKgPerM",
         "presplitSpacingFromLoadM", "dupontPresplitRow"].forEach((k) => expect(typeof api[k]).toBe("function"));
    });
});
