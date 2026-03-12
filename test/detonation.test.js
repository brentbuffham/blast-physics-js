/**
 * detonation.test.js — Tests for DetonationSimulator and Em computation
 *
 * Author: Brent Buffham — blastingapps.com & kirra-design.com
 */

import { describe, it, expect } from "vitest";
import { simulateDetonation, computeEmValues, processHoleDetonation } from "../src/detonation/DetonationSimulator.js";
import { computeSequentialEm, computePrimerAwareEm } from "../src/detonation/EmComputation.js";

describe("simulateDetonation — single base primer", () => {
    const column = {
        chargeTopDepth: 2,
        chargeBaseDepth: 12,
        totalMass: 80,
        vod: 5000,
        numElements: 10,
        primers: [{ depthAlongColumn: 10, fireTime: 0 }]  // base primer
    };

    it("returns correct number of elements", () => {
        const elems = simulateDetonation(column);
        expect(elems.length).toBe(10);
    });

    it("element nearest primer fires first", () => {
        const elems = simulateDetonation(column);
        // primerDepth = 10 (near base), topmost elem centreDepth ~ 9.5 (near base)
        const sorted = elems.slice().sort((a, b) => a.detTime - b.detTime);
        // Element with centreDepth closest to 10 should fire first
        const primerElem = elems.reduce((prev, curr) =>
            Math.abs(curr.centreDepth - 10) < Math.abs(prev.centreDepth - 10) ? curr : prev
        );
        expect(sorted[0].index).toBe(primerElem.index);
    });

    it("all detTimes are finite", () => {
        const elems = simulateDetonation(column);
        elems.forEach(e => expect(isFinite(e.detTime)).toBe(true));
    });
});

describe("computeEmValues — invariant Σ Em = M^A", () => {
    it("holds for base-primed column, A=0.5", () => {
        const column = {
            chargeTopDepth: 0, chargeBaseDepth: 10,
            totalMass: 100, vod: 5000, numElements: 10,
            primers: [{ depthAlongColumn: 10, fireTime: 0 }]
        };
        const A = 0.5;
        const elems = processHoleDetonation(column, A);
        const sumEm = elems.reduce((s, e) => s + e.Em, 0);
        expect(sumEm).toBeCloseTo(Math.pow(100, A), 4);
    });

    it("holds for mid-column primer, A=0.7", () => {
        const column = {
            chargeTopDepth: 0, chargeBaseDepth: 10,
            totalMass: 50, vod: 5000, numElements: 8,
            primers: [{ depthAlongColumn: 5, fireTime: 0 }]
        };
        const A = 0.7;
        const elems = processHoleDetonation(column, A);
        const sumEm = elems.reduce((s, e) => s + e.Em, 0);
        expect(sumEm).toBeCloseTo(Math.pow(50, A), 4);
    });

    it("holds for two-primer column", () => {
        const column = {
            chargeTopDepth: 0, chargeBaseDepth: 10,
            totalMass: 100, vod: 5000, numElements: 10,
            primers: [
                { depthAlongColumn: 2, fireTime: 0 },
                { depthAlongColumn: 8, fireTime: 0 }
            ]
        };
        const A = 0.5;
        const elems = processHoleDetonation(column, A);
        const sumEm = elems.reduce((s, e) => s + e.Em, 0);
        expect(sumEm).toBeCloseTo(Math.pow(100, A), 4);
    });
});

describe("computeSequentialEm — invariant", () => {
    it("Σ Em = totalMass^A for sequential ordering", () => {
        const em = computeSequentialEm(10, 100, 0.5);
        const sum = Array.from(em).reduce((s, v) => s + v, 0);
        expect(sum).toBeCloseTo(Math.pow(100, 0.5), 6);
    });
});

describe("computePrimerAwareEm — fast shader approximation", () => {
    // Note: computePrimerAwareEm is a fast approximation used in GLSL shaders.
    // It assigns Em by distance from primer (not sorted by time), so Σ Em ≠ M^A exactly.
    // The invariant only holds for the full simulation (processHoleDetonation).

    it("returns positive Em values for all elements", () => {
        const em = computePrimerAwareEm(10, 100, 1.0, 0.5);
        Array.from(em).forEach(v => expect(v).toBeGreaterThan(0));
    });

    it("returns an array of the correct length", () => {
        const em = computePrimerAwareEm(8, 80, 0.5, 0.7);
        expect(em.length).toBe(8);
    });

    it("elements nearest primer have larger Em (power function increment is larger at small cumulative mass)", () => {
        // Base primer (fraction=1.0): nearest element is at m=9 (index 9), fj=1.5
        // Furthest element at m=0, fj=10.5
        // Em = (fj*we)^A - ((fj-1)*we)^A: larger increment at smaller cumulative mass
        const em = computePrimerAwareEm(10, 100, 1.0, 0.5);
        expect(em[9]).toBeGreaterThan(em[0]);  // fj=1.5 for elem 9 > fj=10.5 for elem 0
    });
});
