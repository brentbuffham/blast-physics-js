/**
 * damage.test.js — Tests for damage models
 *
 * Author: Brent Buffham — blastingapps.com & kirra-design.com
 */

import { describe, it, expect } from "vitest";
import { computeHolmbergPerssonDamage } from "../src/damage/HolmbergPerssonDamage.js";
import { computeJointedRockDamage } from "../src/damage/JointedRockDamage.js";
import { createDeckEntry } from "../src/core/DeckEntry.js";

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

const hpParams = { K_hp: 700, alpha_hp: 0.7, beta_hp: 1.5, elemsPerDeck: 8, cutoffDistance: 0.3 };
const PPV_CRITICAL = 700;  // mm/s — a threshold the CALLER compares against
const jrParams = { K_hp: 700, alpha_hp: 0.7, beta_hp: 1.5, rockTensileStrength: 10, rockDensity: 2700,
                   pWaveVelocity: 4500, jointSetAngle: 45, jointCohesion: 0.1, jointFrictionAngle: 30,
                   elemsPerDeck: 8, cutoffDistance: 0.3 };

describe("computeHolmbergPerssonDamage — returns PPV in mm/s", () => {
    it("exceeds the critical PPV very close to the charge (< 1m)", () => {
        const ppv = computeHolmbergPerssonDamage({ x: 0.5, y: 0, z: -6 }, [deck], hpParams);
        expect(ppv).toBeGreaterThan(PPV_CRITICAL);
    });

    it("is below the critical PPV at 20m", () => {
        const ppv = computeHolmbergPerssonDamage({ x: 20, y: 0, z: 0 }, [deck], hpParams);
        expect(ppv).toBeLessThan(PPV_CRITICAL);
        expect(ppv).toBeGreaterThan(0);
    });

    it("returns 0 for empty deck array", () => {
        expect(computeHolmbergPerssonDamage({ x: 5, y: 0, z: 0 }, [], hpParams)).toBe(0);
    });

    it("decreases monotonically with distance", () => {
        const d5  = computeHolmbergPerssonDamage({ x: 5,  y: 0, z: 0 }, [deck], hpParams);
        const d10 = computeHolmbergPerssonDamage({ x: 10, y: 0, z: 0 }, [deck], hpParams);
        const d20 = computeHolmbergPerssonDamage({ x: 20, y: 0, z: 0 }, [deck], hpParams);
        expect(d5).toBeGreaterThan(d10);
        expect(d10).toBeGreaterThan(d20);
    });
});

/**
 * The published Holmberg-Persson form sums the geometric term and raises it to
 * α ONCE. The pre-0.3.0 form raised each element to α and RMS-summed, which
 * never converged — these tests are the whole point of that change.
 *
 * Worked example: NIOSH (Iverson, Kerkering & Hustrulid 2008) Eqs 5–6 — a 3 m
 * column at 1 kg/m, receiver 2 m away at mid-column height, K 700, α 0.7,
 * β 1.5 → 476 mm/s.
 */
describe("Holmberg-Persson — published form (NIOSH worked example)", () => {
    const column = createDeckEntry({
        deckType: "COUPLED",
        topX: 0, topY: 0, topZ: 0,
        baseX: 0, baseY: 0, baseZ: -3,
        mass: 3,                      // 3 m at 1 kg/m
        holeDiamMm: 115, holeIndex: 0
    });
    // Receiver 2 m away, level with the middle of the column.
    const at = { x: 2, y: 0, z: -1.5 };
    const P = { K_hp: 700, alpha_hp: 0.7, beta_hp: 1.5, cutoffDistance: 0.01 };

    it("gives 476 mm/s", () => {
        const ppv = computeHolmbergPerssonDamage(at, [column], { ...P, elemsPerDeck: 8 });
        expect(Math.abs(ppv - 476) / 476).toBeLessThan(0.005);
    });

    it("converges: 8 and 64 elements agree to better than 1%", () => {
        const e8  = computeHolmbergPerssonDamage(at, [column], { ...P, elemsPerDeck: 8 });
        const e64 = computeHolmbergPerssonDamage(at, [column], { ...P, elemsPerDeck: 64 });
        expect(Math.abs(e64 - e8) / e8).toBeLessThan(0.01);
    });

    it("still converges at 256 elements", () => {
        const e64  = computeHolmbergPerssonDamage(at, [column], { ...P, elemsPerDeck: 64 });
        const e256 = computeHolmbergPerssonDamage(at, [column], { ...P, elemsPerDeck: 256 });
        expect(Math.abs(e256 - e64) / e64).toBeLessThan(0.005);
    });
});

describe("computeJointedRockDamage", () => {
    it("uses the same converging PPV integration as Holmberg-Persson", () => {
        const e8  = computeJointedRockDamage({ x: 5, y: 0, z: -6 }, [deck], { ...jrParams, elemsPerDeck: 8 });
        const e64 = computeJointedRockDamage({ x: 5, y: 0, z: -6 }, [deck], { ...jrParams, elemsPerDeck: 64 });
        expect(Math.abs(e64 - e8) / e8).toBeLessThan(0.02);
    });

    it("returns a positive damage ratio near the charge", () => {
        const dr = computeJointedRockDamage({ x: 2, y: 0, z: -6 }, [deck], jrParams);
        expect(dr).toBeGreaterThan(0);
    });

    it("returns lower ratio further away", () => {
        const near = computeJointedRockDamage({ x: 2,  y: 0, z: -6 }, [deck], jrParams);
        const far  = computeJointedRockDamage({ x: 20, y: 0, z: -6 }, [deck], jrParams);
        expect(near).toBeGreaterThan(far);
    });

    it("returns 0 for empty deck array", () => {
        expect(computeJointedRockDamage({ x: 5, y: 0, z: 0 }, [], jrParams)).toBe(0);
    });
});
