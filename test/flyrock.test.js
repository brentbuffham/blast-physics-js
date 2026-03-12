/**
 * flyrock.test.js — Tests for flyrock models and shroud
 *
 * Author: Brent Buffham — blastingapps.com & kirra-design.com
 */

import { describe, it, expect } from "vitest";
import { richardsMoore, lundborg, mckenzie, envelopeAltitude } from "../src/flyrock/FlyrockTrajectory.js";
import { generateFlyrockShroud } from "../src/flyrock/FlyrockShroud.js";

describe("richardsMoore", () => {
    const params = {
        holeDiamMm: 115,
        benchHeight: 12,
        stemmingLength: 2,
        burden: 3.6,
        subdrill: 1,
        explosiveDensity: 1.2,
        K: 20,
        factorOfSafety: 2,
        stemEjectAngleDeg: 80
    };

    it("returns finite positive distances", () => {
        const r = richardsMoore(params);
        expect(r.maxDistance).toBeGreaterThan(0);
        expect(r.faceBurst).toBeGreaterThan(0);
        expect(r.cratering).toBeGreaterThan(0);
        expect(r.stemEject).toBeGreaterThan(0);
    });

    it("FoS=2 gives exactly 2x base distances", () => {
        const r1 = richardsMoore(Object.assign({}, params, { factorOfSafety: 1 }));
        const r2 = richardsMoore(Object.assign({}, params, { factorOfSafety: 2 }));
        expect(r2.faceBurst).toBeCloseTo(r1.faceBurst * 2, 4);
        expect(r2.cratering).toBeCloseTo(r1.cratering * 2, 4);
    });

    it("matches example: 115mm, H=12m, K=20, FoS=2 — CR around 330m", () => {
        const r = richardsMoore(params);
        // Example in wiki: CR ≈ 331.6m
        expect(r.cratering).toBeGreaterThan(200);
        expect(r.cratering).toBeLessThan(500);
    });
});

describe("lundborg", () => {
    it("returns positive clearance for 115mm hole", () => {
        const r = lundborg({ holeDiamMm: 115, factorOfSafety: 2 });
        expect(r.clearanceDistance).toBeGreaterThan(0);
        // Wiki example: ~434m for FoS=2
        expect(r.clearanceDistance).toBeGreaterThan(300);
        expect(r.clearanceDistance).toBeLessThan(600);
    });

    it("larger diameter → larger range", () => {
        const r115 = lundborg({ holeDiamMm: 115, factorOfSafety: 1 });
        const r200 = lundborg({ holeDiamMm: 200, factorOfSafety: 1 });
        expect(r200.maxDistance).toBeGreaterThan(r115.maxDistance);
    });
});

describe("mckenzie", () => {
    const params = {
        holeDiamMm: 115,
        stemmingLength: 2,
        chargeLength: 10,
        explosiveDensity: 1.2,
        rockDensity: 2600,
        factorOfSafety: 2
    };

    it("returns positive range and SDoB", () => {
        const r = mckenzie(params);
        expect(r.sDoB).toBeGreaterThan(0);
        expect(r.maxDistance).toBeGreaterThan(0);
        // Wiki example: SDoB ≈ 1.059, Rmax ≈ 212m, clearance ≈ 424m
        expect(r.sDoB).toBeGreaterThan(0.5);
        expect(r.sDoB).toBeLessThan(3.0);
        expect(r.baseRange).toBeGreaterThan(100);
        expect(r.baseRange).toBeLessThan(400);
    });
});

describe("envelopeAltitude", () => {
    it("returns V²/(2g) at d=0", () => {
        const V = 40, g = 9.80665;
        expect(envelopeAltitude(0, V)).toBeCloseTo(V * V / (2 * g), 4);
    });

    it("returns 0 at d = V²/g (range limit)", () => {
        const V = 40, g = 9.80665;
        expect(envelopeAltitude(V * V / g, V)).toBeCloseTo(0, 4);
    });

    it("returns NaN beyond the range limit", () => {
        const V = 40, g = 9.80665;
        expect(envelopeAltitude(V * V / g * 1.1, V)).toBeNaN();
    });
});

describe("generateFlyrockShroud", () => {
    it("returns null for empty hole data", () => {
        expect(generateFlyrockShroud([], {}, () => {})).toBeNull();
    });

    it("generates triangles for a single hole", () => {
        const holeData = [{
            cx: 0, cy: 0, cz: 0,
            maxDistance: 200,
            maxVelocity: 40,
            holeID: "H1"
        }];
        const result = generateFlyrockShroud(holeData, { iterations: 10, factorOfSafety: 2 }, () => {});
        expect(result).not.toBeNull();
        expect(result.triangles.length).toBeGreaterThan(0);
        expect(result.points.length).toBeGreaterThan(0);
    });
});
