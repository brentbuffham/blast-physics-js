/**
 * One CHARGE = the decks of one hole that fire together (0.3.2).
 *
 *   1. Touching explosive decks are one column; an unprimed deck fires with it.
 *   2. Separated decks add only when they fire at the same time.
 *   3. Different fire times, and different holes, never add.
 */
import { describe, it, expect } from "vitest";
import { inheritColumnFireTimes, sameFireTime, SAME_FIRE_MS } from "../src/core/ChargeColumns.js";
import { computeHolmbergPerssonDamage } from "../src/damage/HolmbergPerssonDamage.js";
import { computeJointedRockDamage } from "../src/damage/JointedRockDamage.js";
import { createDeckEntry } from "../src/core/DeckEntry.js";

var Q = 1150 * Math.PI * 0.229 * 0.229 / 4;   // 229 mm, 1.15 g/cc → kg/m
function seg(top, base, hole, t, x) {
    var xo = x || 0;
    return createDeckEntry({
        topX: xo, topY: 0, topZ: -top, baseX: xo, baseY: 0, baseZ: -base,
        mass: Q * (base - top), holeIndex: hole, timingMs: t
    });
}
var P = { x: 3, y: 0, z: -8 };
var HP = { K_hp: 700, alpha_hp: 0.7, beta_hp: 1.5, elemsPerDeck: 32, cutoffDistance: 0.3 };

describe("inheritColumnFireTimes", () => {
    it("a split column: the unprimed deck fires with the primed deck it touches", () => {
        const e = [{ top: 3.2, base: 10.6, timingMs: 525, primed: true }, { top: 10.6, base: 12, timingMs: 0, primed: false }];
        inheritColumnFireTimes(e);
        expect(e[1].timingMs).toBe(525);
    });

    it("the first primer to fire starts the column; a primed deck keeps its own time", () => {
        const e = [
            { top: 3, base: 6, timingMs: 0, primed: false },
            { top: 6, base: 9, timingMs: 542, primed: true },
            { top: 9, base: 12, timingMs: 517, primed: true }
        ];
        inheritColumnFireTimes(e);
        expect(e.map((x) => x.timingMs)).toEqual([517, 542, 517]);
    });

    it("decks separated by stemming are not one column", () => {
        const e = [{ top: 3, base: 6, timingMs: 500, primed: true }, { top: 8, base: 12, timingMs: 99, primed: false }];
        inheritColumnFireTimes(e);
        expect(e[1].timingMs).toBe(99);
    });

    it("same fire time means within SAME_FIRE_MS", () => {
        expect(sameFireTime(500, 500 + SAME_FIRE_MS / 2)).toBe(true);
        expect(sameFireTime(500, 517)).toBe(false);
    });
});

describe("Holmberg-Persson — one charge per hole and fire time", () => {
    it("a column split in two gives the same PPV as one deck", () => {
        const whole = computeHolmbergPerssonDamage(P, [seg(3.2, 12, 0, 525)], HP);
        const split = computeHolmbergPerssonDamage(P, [seg(3.2, 10.6, 0, 525), seg(10.6, 12, 0, 525)], HP);
        expect(split).toBeCloseTo(whole, -1);
    });

    it("separated decks at the same time add; at different times they don't", () => {
        const a = seg(2, 5, 0, 0), b = seg(7, 12, 0, 0), bLate = seg(7, 12, 0, 25);
        const together = computeHolmbergPerssonDamage(P, [a, b], HP);
        const apart = computeHolmbergPerssonDamage(P, [a, bLate], HP);
        expect(together).toBeGreaterThan(apart);
        expect(apart).toBeCloseTo(Math.max(
            computeHolmbergPerssonDamage(P, [a], HP), computeHolmbergPerssonDamage(P, [bLate], HP)), 6);
    });

    it("two holes never add, even firing together", () => {
        const a = seg(3, 12, 0, 0), b = seg(3, 12, 1, 0, 6);
        expect(computeHolmbergPerssonDamage(P, [a, b], HP)).toBeCloseTo(Math.max(
            computeHolmbergPerssonDamage(P, [a], HP), computeHolmbergPerssonDamage(P, [b], HP)), 6);
    });

    it("Jointed Rock uses the same charges: a split column = one deck", () => {
        const whole = computeJointedRockDamage(P, [seg(3.2, 12, 0, 525)], HP);
        const split = computeJointedRockDamage(P, [seg(3.2, 10.6, 0, 525), seg(10.6, 12, 0, 525)], HP);
        expect(Math.abs(split - whole) / whole).toBeLessThan(1e-3);   // NIOSH R̄ samples element midpoints
    });
});
