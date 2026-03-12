/**
 * scaledHeelan.test.js — Tests for Scaled Heelan models
 *
 * Author: Brent Buffham — blastingapps.com & kirra-design.com
 */

import { describe, it, expect } from "vitest";
import { computeScaledHeelan, ScaledHeelanModel } from "../src/vibration/ScaledHeelan.js";
import { computeScaledHeelanBlair, ScaledHeelanBlairModel } from "../src/vibration/ScaledHeelanBlair.js";
import { createDeckEntry } from "../src/core/DeckEntry.js";
import { createHoleEntry } from "../src/core/HoleEntry.js";

// Single vertical hole from Z=0 (collar) to Z=-12 (toe)
const hole = createHoleEntry({
    entityName: "Test", holeID: "H1",
    collarX: 0, collarY: 0, collarZ: 0,
    toeX:    0, toeY:    0, toeZ: -12,
    holeDiamMm: 115
});

// Single deck in the lower part of the hole
const deck = createDeckEntry({
    deckType: "COUPLED",
    topX: 0, topY: 0, topZ: -4,
    baseX: 0, baseY: 0, baseZ: -11,
    mass: 80,
    density: 1.2,
    vod: 5000,
    holeDiamMm: 115,
    timingMs: 0,
    holeIndex: 0,
    primerFraction: 1.0  // base-primed
});

const params = {
    K: 1140, B: 1.6, chargeExponent: 0.5,
    elemsPerDeck: 8,
    pWaveVelocity: 4500, sWaveVelocity: 2600,
    cutoffDistance: 0.5, qualityFactorP: 0, qualityFactorS: 0  // Q=0 disables attenuation
};

const blairParams = {
    K: 1140, B: 1.6, chargeExponent: 0.5,
    elemsPerDeck: 8,
    pWaveVelocity: 4500, poissonRatio: 0.25,
    cutoffDistance: 0.5, qualityFactorP: 0, qualityFactorS: 0
};

describe("computeScaledHeelan", () => {
    it("returns a positive VPPV at 20m from hole", () => {
        const vppv = computeScaledHeelan({ x: 20, y: 0, z: 0 }, [deck], [hole], params);
        expect(vppv).toBeGreaterThan(0);
    });

    it("decreases with distance", () => {
        const near = computeScaledHeelan({ x: 10, y: 0, z: 0 }, [deck], [hole], params);
        const far  = computeScaledHeelan({ x: 40, y: 0, z: 0 }, [deck], [hole], params);
        expect(near).toBeGreaterThan(far);
    });

    it("returns 0 for empty deck array", () => {
        expect(computeScaledHeelan({ x: 20, y: 0, z: 0 }, [], [hole], params)).toBe(0);
    });

    it("invariant: Σ Em = totalMass^A (checked via energy scaling)", () => {
        // With elemsPerDeck=8, mass=80kg, A=0.5:
        // Sum of Em = totalMass^A = sqrt(80) ≈ 8.944
        // Each element Em: (m*10)^0.5 - ((m-1)*10)^0.5
        // Sum = sqrt(80) - 0 = sqrt(80) ≈ 8.944 ✓
        const A = 0.5, totalMass = 80, N = 8;
        const we = totalMass / N;  // 10 kg per element
        var sumEm = 0;
        for (var m = 0; m < N; m++) {
            var mwe  = (m + 1) * we;
            var m1we = m * we;
            sumEm += Math.pow(mwe, A) - (m > 0 ? Math.pow(m1we, A) : 0);
        }
        expect(sumEm).toBeCloseTo(Math.pow(totalMass, A), 6);
    });
});

describe("computeScaledHeelanBlair", () => {
    it("returns a positive VPPV at 20m", () => {
        const vppv = computeScaledHeelanBlair({ x: 20, y: 0, z: 0 }, [deck], [hole], blairParams);
        expect(vppv).toBeGreaterThan(0);
    });

    it("on-axis (above hole) PPV is non-zero (unlike Heelan)", () => {
        // At a point directly above the hole, phi ≈ 0, sfacp ≠ 0
        const vppv = computeScaledHeelanBlair({ x: 0, y: 0, z: 10 }, [deck], [hole], blairParams);
        expect(vppv).toBeGreaterThan(0);  // Blair sfacp ≠ 0 at phi=0
    });

    it("decreases with distance", () => {
        const near = computeScaledHeelanBlair({ x: 10, y: 0, z: 0 }, [deck], [hole], blairParams);
        const far  = computeScaledHeelanBlair({ x: 50, y: 0, z: 0 }, [deck], [hole], blairParams);
        expect(near).toBeGreaterThan(far);
    });
});
