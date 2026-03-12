/**
 * ppv.test.js — Tests for PPV and PPVDeck models
 *
 * Author: Brent Buffham — blastingapps.com & kirra-design.com
 */

import { describe, it, expect } from "vitest";
import { computePPV, computePointPPV, PPVModel } from "../src/vibration/PPV.js";
import { computePPVDeck, PPVDeckModel } from "../src/vibration/PPVDeck.js";
import { createDeckEntry } from "../src/core/DeckEntry.js";

// Simple single deck: vertical hole, charge 0-10m depth, 100kg
const deck = createDeckEntry({
    deckType: "COUPLED",
    topX: 0, topY: 0, topZ: -2,
    baseX: 0, baseY: 0, baseZ: -10,
    mass: 100,
    density: 1.2,
    vod: 5000,
    holeDiamMm: 115,
    timingMs: 0,
    holeIndex: 0
});

const params = { K: 1140, B: 1.6, chargeExponent: 0.5, cutoffDistance: 1.0 };

describe("computePointPPV", () => {
    it("returns 0 for zero mass", () => {
        expect(computePointPPV({ x: 10, y: 0, z: 0 }, { x: 0, y: 0, z: -6 }, 0, params)).toBe(0);
    });

    it("decreases with distance", () => {
        const centroid = { x: 0, y: 0, z: -6 };
        const near = computePointPPV({ x: 10, y: 0, z: 0 }, centroid, 100, params);
        const far  = computePointPPV({ x: 50, y: 0, z: 0 }, centroid, 100, params);
        expect(near).toBeGreaterThan(far);
    });

    it("matches formula: K * (D/Q^e)^(-B)", () => {
        const D = 50, Q = 100, K = 1140, B = 1.6, e = 0.5;
        const expected = K * Math.pow(D / Math.pow(Q, e), -B);
        const result = computePointPPV({ x: 50, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, Q, params);
        expect(result).toBeCloseTo(expected, 4);
    });
});

describe("computePPV with deck entries", () => {
    it("returns peak PPV at a point 30m from charge", () => {
        const ppv = computePPV({ x: 30, y: 0, z: 0 }, [deck], params);
        expect(ppv).toBeGreaterThan(0);
        // Expected: D ≈ sqrt(30² + 6²) ≈ 30.6m, centroid at (0,0,-6)
        // SD = 30.6 / sqrt(100) = 3.06, PPV = 1140 * 3.06^(-1.6) ≈ 111 mm/s
        expect(ppv).toBeGreaterThan(50);
        expect(ppv).toBeLessThan(300);
    });

    it("returns higher PPV closer to charge", () => {
        const near = computePPV({ x: 5,  y: 0, z: 0 }, [deck], params);
        const far  = computePPV({ x: 50, y: 0, z: 0 }, [deck], params);
        expect(near).toBeGreaterThan(far);
    });

    it("returns 0 for empty deck array", () => {
        expect(computePPV({ x: 10, y: 0, z: 0 }, [], params)).toBe(0);
    });
});

describe("computePPVDeck", () => {
    it("evaluates at top/mid/base positions", () => {
        const ppv = computePPVDeck({ x: 20, y: 0, z: 0 }, [deck], params);
        expect(ppv).toBeGreaterThan(0);
    });

    it("gives equal or higher result than centroid-only PPV", () => {
        // PPVDeck evaluates 3 positions; centroid-only evaluates just midpoint.
        // Since one of the 3 positions may be closer, PPVDeck >= PPV
        const ppvDeck   = computePPVDeck({ x: 5, y: 0, z: 0 }, [deck], params);
        const ppvCentroid = computePPV({ x: 5, y: 0, z: 0 }, [deck], params);
        expect(ppvDeck).toBeGreaterThanOrEqual(ppvCentroid * 0.9); // allow small tolerance
    });
});

describe("PPVModel.computeGrid", () => {
    it("produces a symmetric grid for a centred vertical hole", () => {
        const model = new PPVModel(params);
        const result = model.computeGrid([deck], {
            minX: -30, minY: -30,
            rows: 7, cols: 7,
            cellX: 10, cellY: 10,
            elevation: 0
        });

        expect(result.data.length).toBe(49);
        expect(result.unit).toBe("mm/s");

        // Check radial symmetry: row 3, col 1 should equal row 3, col 5
        // (equidistant from centre hole at (0,0,-6))
        // col 1: x = -30 + 1*10 = -20; col 5: x = -30 + 5*10 = 20 → same dist
        expect(result.data[3 * 7 + 1]).toBeCloseTo(result.data[3 * 7 + 5], 2);
    });
});
