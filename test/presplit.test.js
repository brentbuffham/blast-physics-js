/**
 * presplit.test.js — presplit pressures and spacing against the PUBLISHED sources
 *
 * Author: Brent Buffham — blastingapps.com & kirra-design.com
 *
 * Expected values are printed numbers from the papers, hand calculations shown in
 * the comments, or identities between the papers' equations.
 *
 * SOURCES
 *  [KK20]  Konya, A. & Konya, C. (2020) Presplit Design Based on Borehole Pressures.
 *          ISEE 2020g. Eqs 1–6; worked shock-transmission numbers pp. 5–6.
 *  [KKW]   Konya, A., Konya, C. & Worsey, P. Determination of Presplit Borehole
 *          Pressure. ISEE. Eqs 1 and 5.
 */

import { describe, it, expect } from "vitest";
import { mpaToPsi, psiToMpa, gramsPerMetreToGrainsPerFoot, decouplingRatio, detonationPressureMPa,
    acousticImpedance, shockTransmission, konyaPresplitFactor, konyaRequiredPressureMPa, konyaMaxSpacingM,
    konyaEmpiricalPressureMPa, konyaDetonationModelPressureMPa } from "../src/presplit/Presplit.js";
import * as api from "../src/index.js";

function near(actual, expected, tol, label) {
    if (!(Math.abs(actual - expected) <= tol)) throw new Error((label || "") + " expected " + expected + " ± " + tol + ", got " + actual);
}

describe("unit conversions", () => {
    it("1 g/m = 0.3048 / 0.06479891 gr/ft = 4.7038 gr/ft; 1 psi = 6.894757 kPa", () => {
        near(gramsPerMetreToGrainsPerFoot(1), 0.3048 / 0.06479891, 1e-12);
        near(gramsPerMetreToGrainsPerFoot(150), 705.6, 0.1); // [KK20] p5: 150 g/m ≈ 700 gr/ft
        near(psiToMpa(1), 0.006894757293168, 1e-15);
        near(mpaToPsi(psiToMpa(12345)), 12345, 1e-9);
    });
    it("decoupling ratio = hole / charge", () => {
        expect(decouplingRatio(76, 22)).toBeCloseTo(76 / 22, 12);
    });
});

describe("Detonation pressure and shock transmission — [KK20] pp. 5–6", () => {
    it("P_CJ = ρD²/4: PETN cord 1.5 g/cm³ at 6.5 km/s → 15.8 GPa", () => {
        near(detonationPressureMPa(1.5, 6500), 15800, 50);
    });

    it("impedance of the cord: 1500 kg/m³ × 6500 m/s = 9,750,000", () => {
        expect(acousticImpedance(1500, 6500)).toBe(9750000);
    });

    it("transmission 4·Z1·Z2/(Z1+Z2)²: explosive → air 0.0003, air → granite 0.00009, cord → air 0.00016", () => {
        // [KK20] impedances: presplit powder 6,250,000, air 400, granite 16,200,000.
        // The paper rounds each stage to one figure before multiplying.
        near(shockTransmission(6250000, 400), 0.0003, 0.00005, "powder → air");
        near(shockTransmission(400, 16200000), 0.00009, 0.00001, "air → granite");
        near(shockTransmission(9750000, 400), 0.00016, 0.000005, "cord → air");
    });

    it("transmission is symmetric and 1 between equal impedances", () => {
        expect(shockTransmission(400, 16200000)).toBeCloseTo(shockTransmission(16200000, 400), 15);
        expect(shockTransmission(5e6, 5e6)).toBe(1);
    });
});

describe("Konya required pressure and spacing — [KK20] Eqs 5–6", () => {
    it("K = (40579/E)^0.625", () => {
        near(konyaPresplitFactor(40579), 1, 1e-12);
        near(konyaPresplitFactor(50), Math.pow(40579 / 50, 0.625), 1e-12);
    });

    it("P = 2.8e7·(S/K)² psi with S in ft: E 50 GPa at 2 ft → 25,856 psi", () => {
        // hand: K = 811.58^0.625 = e^(0.625·6.69899) = 65.816; (2/65.816)² = 9.2342e-4;
        // × 2.8e7 = 25,856 psi = 178.27 MPa
        var K = Math.pow(40579 / 50, 0.625);
        near(konyaRequiredPressureMPa(0.6096, 50), psiToMpa(2.8e7 * (2 / K) * (2 / K)), 1e-9);
        near(mpaToPsi(konyaRequiredPressureMPa(0.6096, 50)), 25856, 2);
    });

    it("required pressure goes as S²: twice the spacing needs four times the pressure", () => {
        near(konyaRequiredPressureMPa(1.2, 30) / konyaRequiredPressureMPa(0.6, 30), 4, 1e-12);
    });

    it("max spacing inverts the required pressure", () => {
        near(konyaMaxSpacingM(konyaRequiredPressureMPa(0.9, 25), 25), 0.9, 1e-12);
        expect(konyaMaxSpacingM(0, 25)).toBe(0);
    });
});

describe("Konya delivered pressure — [KKW] Empirical Model", () => {
    it("Eq 5 at a 2-inch hole is [KK20] Eq 4: (105.6·EL − 5488)/4 = 26.4·EL − 1372", () => {
        [300, 500, 700].forEach((el) => {
            var gPerM = el / gramsPerMetreToGrainsPerFoot(1);
            near(mpaToPsi(konyaEmpiricalPressureMPa(gPerM, 50.8)), 26.4 * el - 1372, 1e-6, el + " gr/ft");
        });
    });

    it("[KKW] Fig 3: 500 gr/ft in a 2-inch hole ≈ 11,800 psi; pressure falls as 1/dh²", () => {
        // hand: (105.6·500 − 5488)/2² = 47,312/4 = 11,828 psi
        var gPerM = 500 / gramsPerMetreToGrainsPerFoot(1);
        near(mpaToPsi(konyaEmpiricalPressureMPa(gPerM, 50.8)), 11828, 1e-6);
        near(konyaEmpiricalPressureMPa(gPerM, 50.8) / konyaEmpiricalPressureMPa(gPerM, 101.6), 4, 1e-12);
    });

    it("Detonation Pressure Model, Eq 8: 2.91·EL·P_T/(ρ·dh²)", () => {
        // hand: EL 500 gr/ft, P_T 100,000 psi, ρ 1.5, dh 3 in → 2.91·500·1e5/(1.5·9) = 10,777,778 psi
        var gPerM = 500 / gramsPerMetreToGrainsPerFoot(1);
        near(mpaToPsi(konyaDetonationModelPressureMPa(gPerM, 76.2, 1.5, psiToMpa(100000))), 2.91 * 500 * 1e5 / (1.5 * 9), 1e-3);
    });
});

describe("package root", () => {
    it("exports the presplit API", () => {
        ["detonationPressureMPa", "shockTransmission", "konyaPresplitFactor", "konyaRequiredPressureMPa",
         "konyaMaxSpacingM", "konyaEmpiricalPressureMPa", "decouplingRatio"].forEach((k) => expect(typeof api[k]).toBe("function"));
    });
});
