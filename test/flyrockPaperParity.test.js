/**
 * flyrockPaperParity.test.js — locks the flyrock models to their PUBLISHED sources
 *
 * Author: Brent Buffham — blastingapps.com & kirra-design.com
 *
 * Every expected number here is derived from a printed equation, not from a
 * previous run of this library. A test that snapshots the code's own output
 * cannot catch a transcription error, and transcription errors are exactly what
 * the 0.3.1 bugs were. Ported alongside Kirra's
 * src/__tests__/flyrock-calculator-paper-parity.test.js.
 *
 * SOURCES
 *  [MK22] McKenzie, C.K. (2022) "Flyrock model validation and application",
 *         Rock Fragmentation by Blasting (Fragblast 13), X.G. Wang (ed),
 *         Metallurgical Industry Press, Beijing. ISBN 978-7-5024-9269-4.
 *         Eqs (1),(2),(3) printed p.23; Eqs (4),(5),(6),(7) printed p.24.
 *  [XLS] Richards & Moore workbook (FlyrockZIP.xlsx, sheet "Flyrock Exclusion
 *        Calculator"). Cell refs cited inline.
 *  [R79] Roth, J. (1979) U.S. Bureau of Mines Contract J0387242, pp.5–11.
 */

import { describe, it, expect } from "vitest";
import {
    richardsMoore, lundborg, mckenzie, roth, rothAtLaunchAngle,
    usedInputsFor, MODEL_INPUTS
} from "../src/flyrock/FlyrockTrajectory.js";

const GRAVITY = 9.80665;

// The workbook's own input set, so every R&M expectation below is a cell value.
const SHEET = {
    holeDiamMm: 229,        // E6
    benchHeight: 12,        // E7
    stemmingLength: 3.8,    // E8
    burden: 4.5,            // E10
    subdrill: 1.5,          // E12
    explosiveDensity: 1.15, // E13
    K: 28,                  // E14
    stemEjectAngleDeg: 80,  // E16
    factorOfSafety: 1       // isolate the base distances
};

describe("Richards & Moore — parity with the workbook", () => {
    const r = richardsMoore(SHEET);

    it("mass per metre matches cell E17", () => {
        expect(r.massPerMetre).toBeCloseTo(47.3651, 2);
    });

    it("face burst matches cell E26", () => {
        expect(r.faceBurst).toBeCloseTo(241.21, 0);
    });

    it("cratering matches cell E27", () => {
        expect(r.cratering).toBeCloseTo(374.37, 0);
    });

    it("stem eject matches cell E28", () => {
        expect(r.stemEject).toBeCloseTo(128.04, 0);
    });

    it("max launch velocity matches MAX(E31:E33)", () => {
        expect(r.maxVelocity).toBeCloseTo(60.6021, 2);
    });

    it("K drives range as K squared", () => {
        const lo = richardsMoore({ ...SHEET, K: 14 });
        const hi = richardsMoore({ ...SHEET, K: 28 });
        expect(hi.cratering / lo.cratering).toBeCloseTo(4.0, 6);
    });

    it("FoS scales the clearance but NOT the launch velocity", () => {
        const a = richardsMoore({ ...SHEET, factorOfSafety: 1 });
        const b = richardsMoore({ ...SHEET, factorOfSafety: 2 });
        expect(b.cratering / a.cratering).toBeCloseTo(2.0, 9);
        expect(b.maxVelocity).toBeCloseTo(a.maxVelocity, 9);
    });

    it("DOCUMENTS: cratering always overrides stem eject, in range", () => {
        // stemEject = cratering·sin(2θ) and sin(2θ) ≤ 1, so it never wins max().
        for (const deg of [10, 30, 45, 60, 80, 89]) {
            const x = richardsMoore({ ...SHEET, stemEjectAngleDeg: deg });
            expect(x.stemEject).toBeLessThanOrEqual(x.cratering + 1e-9);
            expect(x.maxDistance).toBeCloseTo(Math.max(x.faceBurst, x.cratering), 9);
        }
    });

    it("DOCUMENTS: stem eject angle cancels out of launch VELOCITY", () => {
        // V_SE = √(cratering·sin2θ·g / sin2θ) = √(cratering·g) = V_CR exactly.
        const a = richardsMoore({ ...SHEET, stemEjectAngleDeg: 30 });
        const b = richardsMoore({ ...SHEET, stemEjectAngleDeg: 85 });
        expect(a.maxVelocity).toBeCloseTo(b.maxVelocity, 9);
    });
});

describe("Lundborg — MK22 Eq.(1) and Eq.(2), in METRES", () => {
    it("crater throw matches Eq.(1), 30 x d_mm^(2/3)", () => {
        const r = lundborg({ holeDiamMm: 229, factorOfSafety: 1, lundborgCondition: "crater" });
        expect(r.rangeMax).toBeCloseTo(30 * Math.pow(229, 2 / 3), 6);
        expect(r.rangeMax).toBeCloseTo(1122.9, 0);
    });

    it("bench throw matches Eq.(2), 4.6 x d_mm^(2/3)", () => {
        const r = lundborg({ holeDiamMm: 229, factorOfSafety: 1, lundborgCondition: "bench" });
        expect(r.rangeMax).toBeCloseTo(4.6 * Math.pow(229, 2 / 3), 6);
        expect(r.rangeMax).toBeCloseTo(172.2, 0);
    });

    it("the inch and mm forms of Eq.(1) agree — proving the result is METRES", () => {
        // This identity is the whole reason the old ×0.3048 was wrong.
        const inchForm = 260 * Math.pow(229 / 25.4, 2 / 3);
        const mmForm = 30 * Math.pow(229, 2 / 3);
        expect(inchForm / mmForm).toBeCloseTo(1.0, 2);

        const r = lundborg({ holeDiamMm: 229, factorOfSafety: 1, lundborgCondition: "crater" });
        expect(r.rangeMax / inchForm).toBeCloseTo(1.0, 2);
    });

    it("REGRESSION: no feet-to-metres conversion is applied", () => {
        // The pre-0.3.1 code did 260·d_in^(2/3)·0.3048 = 343.3 m for 229 mm.
        const r = lundborg({ holeDiamMm: 229, factorOfSafety: 1, lundborgCondition: "crater" });
        expect(r.rangeMax).not.toBeCloseTo(343.3, 0);
        const b = lundborg({ holeDiamMm: 229, factorOfSafety: 1 });
        expect(b.rangeMax).not.toBeCloseTo(343.3, 0);
    });

    it("crater is 6.5x bench, per the published coefficients", () => {
        const c = lundborg({ holeDiamMm: 165, factorOfSafety: 1, lundborgCondition: "crater" });
        const b = lundborg({ holeDiamMm: 165, factorOfSafety: 1, lundborgCondition: "bench" });
        expect(c.rangeMax / b.rangeMax).toBeCloseTo(30 / 4.6, 6);
    });

    it("⭐ defaults to BENCH", () => {
        // Crater is 6.5× further and is the WRONG equation for a pattern with a
        // free face. Conservatism belongs in the FoS.
        expect(lundborg({ holeDiamMm: 165 }).condition).toBe("bench");
        expect(lundborg({ holeDiamMm: 165, lundborgCondition: "crater" }).condition).toBe("crater");
    });

    it("scales as diameter^(2/3)", () => {
        const a = lundborg({ holeDiamMm: 100, factorOfSafety: 1 });
        const b = lundborg({ holeDiamMm: 800, factorOfSafety: 1 });
        expect(b.rangeMax / a.rangeMax).toBeCloseTo(Math.pow(8, 2 / 3), 6);
    });
});

describe("McKenzie — MK22 Eqs (4),(5),(6)", () => {
    const INPUTS = {
        holeDiamMm: 229,
        stemmingLength: 3.8,
        chargeLength: 9.7,
        explosiveDensity: 1.15,
        rockDensity: 2600,
        factorOfSafety: 1
    };

    it("SDoB matches Eq.(4) and workbook cell E23", () => {
        expect(mckenzie(INPUTS).sDoB).toBeCloseTo(1.0369, 3);
    });

    it("range matches Eq.(5) with the exponents kept SEPARATE", () => {
        const r = mckenzie(INPUTS);
        const expected = 9.74 * Math.pow(r.sDoB, -2.167) * Math.pow(229, 2 / 3);
        expect(r.rangeMax).toBeCloseTo(expected, 6);
    });

    it("REGRESSION: the 2/3 power must NOT reach SDoB", () => {
        // The old grouping was 9.74·(d/SDoB^2.167)^(2/3), i.e. SDoB^−1.4447.
        // Checked away from SDoB = 1, where the two forms coincide.
        const r = mckenzie({ ...INPUTS, stemmingLength: 7.6 });
        const wrong = 9.74 * Math.pow(229 / Math.pow(r.sDoB, 2.167), 2 / 3);
        expect(r.sDoB).toBeGreaterThan(1.4);      // guard: really off 1.0
        expect(r.rangeMax).not.toBeCloseTo(wrong, 0);
        expect(r.rangeMax).toBeLessThan(wrong);   // old code over-predicted here
    });

    it("REGRESSION: under-stemmed holes are no longer UNDER-predicted", () => {
        // SDoB below 1 is the dangerous end — these are the holes that throw.
        const r = mckenzie({ ...INPUTS, stemmingLength: 1.9 });
        const wrong = 9.74 * Math.pow(229 / Math.pow(r.sDoB, 2.167), 2 / 3);
        expect(r.sDoB).toBeLessThan(0.8);
        expect(r.rangeMax).toBeGreaterThan(wrong);          // the old value was short
        expect(r.rangeMax / wrong).toBeGreaterThan(1.3);    // by ~38%
    });

    it("Kv matches McKenzie 2009 Eq.(5)", () => {
        const r = mckenzie(INPUTS);
        expect(r.kv).toBeCloseTo(0.0728 * Math.pow(r.sDoB, -3.251), 9);
    });

    it("fragment size matches Eq.(6), and carries the density term", () => {
        const r = mckenzie(INPUTS);
        const expected = 3 * Math.pow(r.sDoB, -2.167) * (2600 / 2600) * Math.pow(229, 2 / 3);
        expect(r.fragmentSizeMm).toBeCloseTo(expected, 6);

        // Eq.(6) goes as 1/ρ: lighter rock, bigger fragment reaches the rim.
        const light = mckenzie({ ...INPUTS, rockDensity: 1300 });
        expect(light.fragmentSizeMm / r.fragmentSizeMm).toBeCloseTo(2.0, 6);
    });

    it("⭐ rock density does NOT change the RANGE (MK22 p.22)", () => {
        // "...density (which does not affect maximum projection distance)".
        // It must still be a live dial via Eq.(6) — see the test above.
        const a = mckenzie({ ...INPUTS, rockDensity: 2600 });
        const b = mckenzie({ ...INPUTS, rockDensity: 1300 });
        expect(a.rangeMax).toBeCloseTo(b.rangeMax, 9);
    });

    it("contributing charge caps at 10 diameters for >= 100 mm holes", () => {
        const r = mckenzie({ ...INPUTS, chargeLength: 50 });
        expect(r.contributingMass / r.massPerMetre).toBeCloseTo(10 * 0.229, 9);
        const small = mckenzie({ ...INPUTS, holeDiamMm: 89, chargeLength: 50 });
        expect(small.contributingMass / small.massPerMetre).toBeCloseTo(8 * 0.089, 9);
    });
});

describe("Roth (1979) — Gurney model", () => {
    const BASE = {
        massPerMetre: 47.3651,
        burden: 4.5,
        rockDensity: 2600,
        detonationVelocityMs: 5000,
        factorOfSafety: 1
    };

    it("c/m matches Eq.(7) and is dimensionless", () => {
        const r = roth(BASE);
        // tan(45°) = 1 at the default α = 90°
        expect(r.cOverM).toBeCloseTo(47.3651 / (2600 * 4.5 * 4.5 * 1), 9);
    });

    it("v0 uses Eq.(10) by default and Eq.(9) for ANFO", () => {
        const other = roth(BASE);
        const anfo = roth({ ...BASE, explosiveIsANFO: true });
        expect(other.v0).toBeCloseTo((5000 / 3) * Math.sqrt(other.cOverM), 6);
        expect(anfo.v0).toBeCloseTo(0.44 * 5000 * Math.sqrt(anfo.cOverM), 6);
        expect(anfo.v0 / other.v0).toBeCloseTo(0.44 * 3, 6);
    });

    it("range is v0^2/g — Eq.(2), the 45 degree optimum", () => {
        const r = roth(BASE);
        expect(r.rangeMax).toBeCloseTo((r.v0 * r.v0) / GRAVITY, 9);
    });

    it("⭐ range scales as 1/rockDensity — the only model where it does", () => {
        const a = roth({ ...BASE, rockDensity: 2600 });
        const b = roth({ ...BASE, rockDensity: 5200 });
        expect(a.rangeMax / b.rangeMax).toBeCloseTo(2.0, 6);
    });

    it("range scales as 1/burden^2", () => {
        const a = roth({ ...BASE, burden: 4 });
        const b = roth({ ...BASE, burden: 8 });
        expect(a.rangeMax / b.rangeMax).toBeCloseTo(4.0, 6);
    });

    it("launch height only ever adds reach — Eq.(3)", () => {
        const flat = roth(BASE);
        const high = roth({ ...BASE, launchHeight: 12 });
        expect(high.rangeFromHeight).toBeGreaterThan(flat.rangeMax);
        const L = flat.rangeMax;
        expect(high.rangeFromHeight).toBeCloseTo((L / 2) * (Math.sqrt(1 + (4 * 12) / L) + 1), 6);
    });

    it("apex of the 45 degree shot is v0^2/4g, half the all-angle envelope", () => {
        const r = roth(BASE);
        expect(r.apexHeight).toBeCloseTo((r.v0 * r.v0) / (4 * GRAVITY), 9);
    });

    it("returns zeros rather than NaN on degenerate input", () => {
        for (const bad of [{ burden: 0 }, { massPerMetre: 0 }, { detonationVelocityMs: 0 }]) {
            const r = roth({ ...BASE, ...bad });
            expect(r.rangeMax).toBe(0);
            expect(Number.isNaN(r.v0)).toBe(false);
        }
    });

    it("a silly breakout angle cannot divide by zero", () => {
        for (const a of [0, 180, 360]) {
            const r = roth({ ...BASE, breakoutAngleDeg: a });
            expect(Number.isFinite(r.rangeMax)).toBe(true);
            expect(r.rangeMax).toBeGreaterThan(0);
        }
    });

    it("rothAtLaunchAngle peaks in range at 45 and in height at 90", () => {
        const v0 = 60;
        const r45 = rothAtLaunchAngle(v0, 45);
        for (const d of [20, 35, 55, 70]) {
            expect(rothAtLaunchAngle(v0, d).range).toBeLessThan(r45.range + 1e-9);
        }
        let prev = -1;
        for (const d of [10, 30, 50, 70, 90]) {
            const h = rothAtLaunchAngle(v0, d).apexHeight;
            expect(h).toBeGreaterThan(prev);
            prev = h;
        }
        expect(rothAtLaunchAngle(v0, 90).apexHeight).toBeCloseTo((v0 * v0) / (2 * GRAVITY), 9);
    });
});

describe("MODEL_INPUTS — no dial that cannot move the answer", () => {
    it("records only the inputs a model actually consumed", () => {
        const cfg = { K: 14, rockDensity: 2600, lundborgCondition: "crater", burden: 4.5 };
        expect(usedInputsFor("mckenzie", cfg)).toEqual({ rockDensity: 2600 });
        expect(usedInputsFor("lundborg", cfg)).toEqual({ lundborgCondition: "crater" });
        expect(usedInputsFor("richardsMoore", cfg)).toEqual({ K: 14, burden: 4.5 });
        expect(usedInputsFor("roth", cfg)).toEqual({ rockDensity: 2600, burden: 4.5 });
    });

    it("K belongs to Richards & Moore alone — proved by running the models", () => {
        expect(MODEL_INPUTS.mckenzie.K).toBe(false);
        expect(MODEL_INPUTS.lundborg.K).toBe(false);
        expect(MODEL_INPUTS.roth.K).toBe(false);

        const mk = { holeDiamMm: 229, stemmingLength: 3.8, chargeLength: 9.7, explosiveDensity: 1.15 };
        expect(mckenzie({ ...mk, K: 14 }).rangeMax).toBeCloseTo(mckenzie({ ...mk, K: 30 }).rangeMax, 9);
        expect(lundborg({ holeDiamMm: 229, K: 14 }).rangeMax)
            .toBeCloseTo(lundborg({ holeDiamMm: 229, K: 30 }).rangeMax, 9);
    });

    it("a free face cannot move Lundborg or McKenzie", () => {
        const mk = { holeDiamMm: 229, stemmingLength: 3.8, chargeLength: 9.7, explosiveDensity: 1.15 };
        expect(mckenzie({ ...mk, burden: 2 }).rangeMax).toBeCloseTo(mckenzie({ ...mk, burden: 9 }).rangeMax, 9);
    });
});
