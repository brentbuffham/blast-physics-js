/**
 * workmanCalder.test.js — Calder's (CANMET) borehole pressure and Workman &
 * Calder's large-hole bottom charge, against their Tables 1–4
 *
 * Author: Brent Buffham — blastingapps.com & kirra-design.com
 *
 * SOURCE (key in brentbuffham/blasting-knowledge references.bib)
 *  [WC91] workman1991largehole — Workman, J.L. & Calder, P.N. (1991) A method
 *         for calculating the weight of charge to use in large hole
 *         pre-splitting for cast blasting operations. 17th ISEE Conf., Vol 2,
 *         97–105. Tables 1–4 on PDF p8, Figure 1 on PDF p9.
 */

import { describe, it, expect } from "vitest";
import { calderNFactor, calderCoupledPressureMPa, calderWallPressureMPa, calderChargeDiameterMm,
    calderBottomChargeKg, CALDER_N_POINTS } from "../src/presplit/WorkmanCalder.js";
import { forceBalanceSpacingM, adiabaticWallPressureMPa } from "../src/presplit/WallPressure.js";
import { psiToMpa, mpaToPsi } from "../src/presplit/Presplit.js";
import { runPresplitModels } from "../src/presplit/PresplitModels.js";
import * as api from "../src/index.js";

function near(actual, expected, tol, label) {
    if (!(Math.abs(actual - expected) <= tol)) throw new Error((label || "") + " expected " + expected + " ± " + tol + ", got " + actual);
}
var FT = 0.3048, IN = 25.4, LB = 0.45359237;
var HOLES = [6.25, 9.875, 10.625, 12.25];
// Table 1 (15 000 psi, 80 ft holes, 10 ft unloaded): printed charge diameter (in) and lb/ft
var T1 = {
    ANFO: { rho: 0.85, D: 14000, dc: [1.6, 2.5, 2.75, 3.2], lbft: [0.74, 1.81, 2.20, 2.96] },
    HANFO: { rho: 1.26, D: 16000, dc: [1.4, 2.2, 2.4, 2.75], lbft: [0.84, 2.08, 2.47, 3.24] }
};

describe("Calder's N — [WC91] Figure 1", () => {
    it("returns the plotted points", () => {
        CALDER_N_POINTS.forEach((p) => near(calderNFactor(p[0]), p[1] * 1e-3, 1e-15));
    });
    it("is linear between them and only covers 0.8–2.0 g/cm³", () => {
        near(calderNFactor(0.9), (2.53 + 2.09) / 2 * 1e-3, 1e-15);
        expect(() => calderNFactor(0.7)).toThrow(RangeError);
        expect(() => calderNFactor(2.1)).toThrow(RangeError);
    });
    it("Pb = N·ρ·D² psi with D in ft/s", () => {
        near(mpaToPsi(calderCoupledPressureMPa(1.0, 14000 * FT)), 2.09e-3 * 14000 * 14000, 1e-6);
    });
    it("decoupled: Pb·(√C·rc/rh)^2.4 — the adiabatic form with N in place of 1/8", () => {
        var p = { holeDiamMm: 250, chargeDiamMm: 60, densityGcc: 1.0, vodMs: 4000, chargeFraction: 0.5 };
        near(calderWallPressureMPa(p), adiabaticWallPressureMPa(Object.assign({ explosionPressureMPa: calderCoupledPressureMPa(1.0, 4000) }, p)), 1e-9);
    });
});

describe("Table 1: charge for 15 000 psi — [WC91]", () => {
    Object.keys(T1).forEach(function (k) {
        var e = T1[k];
        it(k + ": the printed charge per foot is π/4·Dc²·ρ of the printed diameter", () => {
            e.dc.forEach(function (dc, i) {
                // 1 in³ of 1 g/cm³ is 0.0361273 lb
                // to the printed 2 decimals, except ANFO 2.75 in: 2.189 printed as 2.20
                near(Math.PI / 4 * dc * dc * 12 * e.rho * 0.0361273, e.lbft[i], 0.012, k + " " + HOLES[i]);
            });
        });
        it(k + ": the method's charge diameters are within 3 % of the printed ones", () => {
            // the printed diameters are rounded: their ratio to the hole should be one
            // constant per explosive but runs 0.253–0.261 (ANFO), 0.223–0.226 (HANFO)
            e.dc.forEach(function (dc, i) {
                var calc = calderChargeDiameterMm({ holeDiamMm: HOLES[i] * IN, densityGcc: e.rho, vodMs: e.D * FT, targetPressureMPa: psiToMpa(15000) }) / IN;
                near(calc / dc, 1, 0.03, k + " " + HOLES[i]);
            });
        });
    });
});

describe("Tables 2 and 3: weight = charge per foot × (depth − 10 ft) — [WC91]", () => {
    it("ANFO 9⅞ in: 126.7, 144.8, 162.9 … 235.3 lb for 80 … 140 ft", () => {
        [126.7, 144.8, 162.9, 181.0, 199.1, 217.2, 235.3].forEach(function (w, j) {
            near(1.81 * (80 + 10 * j - 10), w, 0.051);
        });
    });
    it("HANFO 10⅝ in: 172.9 lb at 80 ft (Table 1 prints 168; the unrounded charge gives 167)", () => {
        near(2.47 * 70, 172.9, 0.001);
        var b = calderBottomChargeKg({ holeDiamMm: 10.625 * IN, holeDepthM: 80 * FT, densityGcc: 1.26, vodMs: 16000 * FT, targetPressureMPa: psiToMpa(15000) });
        near(b.loadedLengthM / FT, 70, 1e-9);
        near(b.chargeKg / LB, 167.2, 0.5);
    });
    it("calderBottomChargeKg: load × loaded length, default collar 10 ft", () => {
        var b = calderBottomChargeKg({ holeDiamMm: 9.875 * IN, holeDepthM: 120 * FT, densityGcc: 0.85, vodMs: 14000 * FT, targetPressureMPa: psiToMpa(15000) });
        near(b.chargeKg, b.loadKgPerM * 110 * FT, 1e-9);
        near(b.loadKgPerM, Math.PI / 4 * Math.pow(b.chargeDiamMm / 1000, 2) * 850, 1e-12);
        near(b.chargeKg / LB, 199.1, 199.1 * 0.01); // Table 2, 120 ft
        expect(() => calderBottomChargeKg({ holeDiamMm: 250, holeDepthM: 3, densityGcc: 0.85, vodMs: 4000, targetPressureMPa: 100 })).toThrow(RangeError);
    });
});

describe("Table 4: spacing S = 2rh·(Pb + T)/T, ft — [WC91]", () => {
    var T4 = [[6.5, 8.7, 6.0, 11.4, 7.8], [7.875, 10.5, 7.2, 13.8, 9.4], [9.875, 13.2, 9.1, 17.3, 11.8],
        [10.625, 14.2, 9.7, 18.6, 12.7], [12.25, 16.3, 11.2, 21.4, 14.6]];
    var COLS = [[15000, 1000], [15000, 1500], [20000, 1000], [20000, 1500]];
    T4.forEach(function (row) {
        it(row[0] + " in hole", () => {
            COLS.forEach(function (c, j) {
                var S = forceBalanceSpacingM(row[0] * IN, psiToMpa(c[0]), psiToMpa(c[1])) / FT;
                near(S, row[j + 1], 0.051, c.join("/"));
            });
        });
    });
});

describe("in runPresplitModels", () => {
    it("calder-canmet is a gas model with the force-balance spacing", () => {
        var d = { holeDiamMm: 250, chargeDiamMm: 64, densityGcc: 0.85, vodMs: 14000 * FT, tensileMPa: 7, compressiveMPa: 100 };
        var m = runPresplitModels(d).models.find((x) => x.id === "calder-canmet");
        expect(m.applicable).toBe(true);
        near(m.wallPressureMPa, calderWallPressureMPa(d), 1e-12);
        near(m.maxSpacingM, forceBalanceSpacingM(250, m.wallPressureMPa, 7), 1e-12);
    });
    it("outside 0.8–2.0 g/cm³ it is not applicable, and says why", () => {
        var m = runPresplitModels({ holeDiamMm: 76, chargeDiamMm: 25, densityGcc: 0.58, vodMs: 2805, tensileMPa: 4 })
            .models.find((x) => x.id === "calder-canmet");
        expect(m.applicable).toBe(false);
        expect(m.notes.join(" ")).toMatch(/0\.8 to 2\.0/);
    });
    it("the package root exports the Calder functions", () => {
        ["calderNFactor", "calderCoupledPressureMPa", "calderWallPressureMPa", "calderChargeDiameterMm", "calderBottomChargeKg"]
            .forEach((k) => expect(typeof api[k]).toBe("function"));
    });
});
