/**
 * presplitModels.test.js — every presplit model on one design
 *
 * Author: Brent Buffham — blastingapps.com & kirra-design.com
 *
 * Designs from Hustrulid (2007): the Atlas Kleen Cut road cut (pp23–24) and
 * Sanden's Queenston limestone blocks (pp19–21).
 */

import { describe, it, expect } from "vitest";
import { runPresplitModels, PRESPLIT_MODELS } from "../src/presplit/PresplitModels.js";
import { isothermalWallPressureMPa, idealGasWallPressureMPa, forceBalanceSpacingM, chargeDiameterFromLoadMm } from "../src/presplit/WallPressure.js";
import { konyaEmpiricalPressureMPa, konyaMaxSpacingM } from "../src/presplit/Presplit.js";
import * as api from "../src/index.js";

function near(actual, expected, tol, label) {
    if (!(Math.abs(actual - expected) <= tol)) throw new Error((label || "") + " expected " + expected + " ± " + tol + ", got " + actual);
}
function byId(r, id) { return r.models.find((m) => m.id === id); }

describe("Atlas Kleen Cut road cut — [H07] pp23–24", () => {
    var base = { holeDiamMm: 50.8, chargeDiamMm: 28.7, tensileMPa: 4.1, compressiveMPa: 172 };
    it("Kleen Cut E: the Utah/NIOSH model gives Pw 115 MPa and 1.48 m", () => {
        var r = runPresplitModels(Object.assign({ densityGcc: 0.58, vodMs: 2805 }, base));
        var m = byId(r, "hustrulid-isothermal");
        near(m.wallPressureMPa, 115, 1);
        near(m.maxSpacingM, 1.48, 0.01);
        expect(m.crushes).toBe(false);
    });
    it("Kleen Cut C crushes the wall (321 MPa over C = 172 MPa), as Hustrulid rejects it", () => {
        var r = runPresplitModels(Object.assign({ densityGcc: 0.92, vodMs: 4268 }, base));
        var m = byId(r, "hustrulid-isothermal");
        near(m.wallPressureMPa, 321, 1);
        expect(m.crushes).toBe(true);
        expect(m.notes.join(" ")).toMatch(/crush/);
    });
    it("Konya's empirical model is out of its range here (not PETN cord; decoupling 1.8 < 3)", () => {
        var r = runPresplitModels(Object.assign({ densityGcc: 0.58, vodMs: 2805, youngsModulusGPa: 50 }, base));
        var k = byId(r, "konya-empirical");
        expect(k.applicable).toBe(false);
        expect(k.notes.join(" ")).toMatch(/PETN/);
        expect(k.notes.join(" ")).toMatch(/decoupling/);
    });
});

describe("Queenston limestone, 6 strands of 50 gr/ft cord at 20 in — [H07] pp19–21", () => {
    var d = { holeDiamMm: 1.75 * 25.4, loadGPerM: 63.78, densityGcc: 1.25, vodMs: 6400, petnCord: true,
        tensileMPa: 4.6, compressiveMPa: 60, youngsModulusGPa: 30, spacingM: 20 * 0.0254 };
    var r = runPresplitModels(d);

    it("charge geometry: core 8.06 mm, decoupling 5.5, VR 30.41", () => {
        near(r.design.chargeDiamMm, 8.06, 0.01);
        near(r.design.decouplingRatio, 44.45 / 8.06, 0.01);
        near(r.design.volumeRatio, 30.41, 0.05);
    });
    it("each model is its own function, wired through", () => {
        var p = { holeDiamMm: d.holeDiamMm, chargeDiamMm: r.design.chargeDiamMm, densityGcc: 1.25, vodMs: 6400 };
        near(byId(r, "hustrulid-isothermal").wallPressureMPa, isothermalWallPressureMPa(p), 1e-12);
        near(byId(r, "niagara-ideal-gas").wallPressureMPa, idealGasWallPressureMPa(p), 1e-12);
        near(byId(r, "hustrulid-isothermal").maxSpacingM, forceBalanceSpacingM(d.holeDiamMm, isothermalWallPressureMPa(p), 4.6), 1e-12);
        var Pg = konyaEmpiricalPressureMPa(63.78, d.holeDiamMm);
        near(byId(r, "konya-empirical").wallPressureMPa, Pg, 1e-12);
        near(byId(r, "konya-empirical").maxSpacingM, konyaMaxSpacingM(Pg, 30), 1e-12);
    });
    it("Konya applies here (PETN cord, decoupling > 3)", () => {
        expect(byId(r, "konya-empirical").applicable).toBe(true);
    });
    it("shot 5 split: the Utah/NIOSH web tension 5.03 MPa is over T = 4.6 MPa", () => {
        expect(byId(r, "hustrulid-isothermal").splits).toBe(true);
    });
    it("the summary is the spread of the applicable models' spacings", () => {
        var s = r.models.filter((m) => m.applicable && m.maxSpacingM > 0).map((m) => m.maxSpacingM).sort((a, b) => a - b);
        expect(r.summary.count).toBe(s.length);
        expect(r.summary.minSpacingM).toBe(s[0]);
        expect(r.summary.maxSpacingM).toBe(s[s.length - 1]);
        expect(r.summary.medianSpacingM).toBe(s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2);
    });
});

describe("models out of range leave the summary", () => {
    it("Konya not applicable → not counted", () => {
        var r = runPresplitModels({ holeDiamMm: 76, chargeDiamMm: 32, densityGcc: 1.2, vodMs: 5000, tensileMPa: 5, youngsModulusGPa: 40 });
        expect(byId(r, "konya-empirical").applicable).toBe(false);
        // 4 gas models + Calder + the two Chiappetta rules (76 mm is the 3 in table row)
        expect(r.summary.count).toBe(7);
    });
    it("without T the gas models give no spacing, and say why", () => {
        var r = runPresplitModels({ holeDiamMm: 76, chargeDiamMm: 32, densityGcc: 1.2, vodMs: 5000 });
        expect(byId(r, "sanden-adiabatic").maxSpacingM).toBeNull();
        expect(byId(r, "sanden-adiabatic").notes.join(" ")).toMatch(/tensile/);
        expect(byId(r, "calder-canmet").maxSpacingM).toBeNull();
        // only the empirical Chiappetta rules need no rock strength
        expect(r.summary.count).toBe(2);
        expect(byId(r, "chiappetta-plane").maxSpacingM).toBeGreaterThan(0);
    });
    it("every model carries a citation", () => {
        PRESPLIT_MODELS.forEach((m) => expect(m.citation.length).toBeGreaterThan(20));
    });
});

describe("package root", () => {
    it("exports the presplit models", () => {
        ["runPresplitModels", "isothermalWallPressureMPa", "adiabaticWallPressureMPa", "hinoWallPressureMPa",
         "idealGasWallPressureMPa", "forceBalanceSpacingM", "webTensionMPa", "explosionPressureMPa"].forEach((k) => expect(typeof api[k]).toBe("function"));
        expect(Array.isArray(api.PRESPLIT_MODELS)).toBe(true);
    });
});
