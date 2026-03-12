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

const hpParams = { K_hp: 700, alpha_hp: 0.7, beta_hp: 1.5, ppvCritical: 700, elemsPerDeck: 8, cutoffDistance: 0.3 };
const jrParams = { K_hp: 700, alpha_hp: 0.7, beta_hp: 1.5, rockTensileStrength: 10, rockDensity: 2700,
                   pWaveVelocity: 4500, jointSetAngle: 45, jointCohesion: 0.1, jointFrictionAngle: 30,
                   elemsPerDeck: 8, cutoffDistance: 0.3 };

describe("computeHolmbergPerssonDamage", () => {
    it("returns DI > 1 very close to the charge (< 1m)", () => {
        const di = computeHolmbergPerssonDamage({ x: 0.5, y: 0, z: -6 }, [deck], hpParams);
        expect(di).toBeGreaterThan(1.0);
    });

    it("returns DI < 1 at 20m", () => {
        const di = computeHolmbergPerssonDamage({ x: 20, y: 0, z: 0 }, [deck], hpParams);
        expect(di).toBeLessThan(1.0);
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

describe("computeJointedRockDamage", () => {
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
