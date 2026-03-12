/**
 * blairMinchinton.test.js — Tests for BlairMinchinton time-domain model
 *
 * Author: Brent Buffham — blastingapps.com & kirra-design.com
 */

import { describe, it, expect } from "vitest";
import { computeBlairMinchinton } from "../src/vibration/BlairMinchinton.js";
import { blairWaveform, pulseCutoff } from "../src/core/Waveform.js";
import { createDeckEntry } from "../src/core/DeckEntry.js";
import { createHoleEntry } from "../src/core/HoleEntry.js";

// Simple vertical hole + single deck
const hole = createHoleEntry({
    entityName: "Test", holeID: "BM1",
    collarX: 0, collarY: 0, collarZ: 0,
    toeX:    0, toeY:    0, toeZ: -12,
    holeDiamMm: 229
});

const deck = createDeckEntry({
    deckType: "COUPLED",
    topX: 0, topY: 0, topZ: -3,
    baseX: 0, baseY: 0, baseZ: -11,
    mass: 100,
    density: 1.4,
    vod: 5279,
    holeDiamMm: 229,
    timingMs: 0,
    holeIndex: 0,
    primerFraction: 1.0
});

const params = {
    K: 700, B: 1.5, chargeExponent: 0.7, gamma: 0.0455,
    poissonRatio: 0.25, pWaveVelocity: 6000,
    detonationVelocity: 5279, explosiveDensity: 1400,
    bandwidth: 10000, dtFactor: 0.125, pulseOrder: 6,
    elemsPerDeck: 6,
    cutoffDistance: 0.5
};

describe("blairWaveform", () => {
    it("returns 0 for p <= 0", () => {
        expect(blairWaveform(0, 6)).toBe(0);
        expect(blairWaveform(-1, 6)).toBe(0);
    });

    it("is negligible for p > 4*N (pulseCutoff)", () => {
        const N = 6;
        const cutoff = pulseCutoff(N);
        expect(Math.abs(blairWaveform(cutoff * 1.5, N))).toBeLessThan(1e-6);
    });

    it("returns a non-zero value in the active range (0 < p < 4*N)", () => {
        const N = 6;
        expect(Math.abs(blairWaveform(N, N))).toBeGreaterThan(0);
    });
});

describe("computeBlairMinchinton", () => {
    it("returns a positive VPPV at 20m", () => {
        const vppv = computeBlairMinchinton({ x: 20, y: 0, z: 0 }, [deck], [hole], params);
        expect(vppv).toBeGreaterThan(0);
    });

    it("decreases with distance", () => {
        const near = computeBlairMinchinton({ x: 10, y: 0, z: 0 }, [deck], [hole], params);
        const far  = computeBlairMinchinton({ x: 50, y: 0, z: 0 }, [deck], [hole], params);
        expect(near).toBeGreaterThan(far);
    });

    it("returns 0 for empty deck array", () => {
        expect(computeBlairMinchinton({ x: 20, y: 0, z: 0 }, [], [hole], params)).toBe(0);
    });

    it("on-axis (above hole) returns non-zero PPV (Blair sfacp ≠ 0)", () => {
        const vppv = computeBlairMinchinton({ x: 0, y: 0, z: 20 }, [deck], [hole], params);
        expect(vppv).toBeGreaterThan(0);
    });
});
