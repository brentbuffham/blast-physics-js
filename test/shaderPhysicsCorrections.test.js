/**
 * shaderPhysicsCorrections.test.js — pins for the 0.3.0 physics corrections
 *
 * Author: Brent Buffham — blastingapps.com & kirra-design.com
 *
 * Every test here corresponds to a place where the pre-0.3.0 code and the
 * published paper disagreed. See "Breaking changes in 0.3.0" in README.md and
 * the ⏪ BEFORE blocks in each source file.
 */

import { describe, it, expect } from "vitest";
import { computeScaledHeelan } from "../src/vibration/ScaledHeelan.js";
import { computeScaledHeelanBlair } from "../src/vibration/ScaledHeelanBlair.js";
import { computeHeelanOriginal } from "../src/vibration/HeelanOriginal.js";
import { blairSfacp, blairSfacs, heelanF1, heelanF2 } from "../src/core/RadiationPattern.js";
import { createDeckEntry } from "../src/core/DeckEntry.js";
import { createHoleEntry } from "../src/core/HoleEntry.js";
import { DEFAULT_VOD } from "../src/core/Constants.js";

const DEG = Math.PI / 180;

const hole = createHoleEntry({
    entityName: "Test", holeID: "H1",
    collarX: 0, collarY: 0, collarZ: 0,
    toeX: 0, toeY: 0, toeZ: -12,
    holeDiamMm: 115
});

const deck = createDeckEntry({
    deckType: "COUPLED",
    topX: 0, topY: 0, topZ: -4,
    baseX: 0, baseY: 0, baseZ: -11,
    mass: 80, density: 1.2, vod: 5000,
    holeDiamMm: 115, timingMs: 0, holeIndex: 0,
    primerFraction: 1.0
});

// ---------------------------------------------------------------- §2 patterns

describe("§2 radiation patterns — only P propagates at φ = 90°", () => {
    const vsp = 1 / 3;  // (Vs/Vp)² for ν = 0.25

    it("blairSfacp is at its maximum and blairSfacs vanishes at φ = 90°", () => {
        const sinPhi = Math.sin(90 * DEG), cosPhi = Math.cos(90 * DEG);
        const sfacp = blairSfacp(cosPhi, vsp);
        expect(sfacp).toBeCloseTo(1.0, 8);
        expect(blairSfacs(sinPhi, cosPhi, sfacp)).toBeCloseTo(0, 8);
    });

    it("the pre-2026 heelanF1/F2 have it exactly the wrong way round", () => {
        // Retained for API compatibility only — this test documents WHY no
        // model uses them, so nobody reinstates them by accident.
        const sinPhi = Math.sin(90 * DEG), cosPhi = Math.cos(90 * DEG);
        expect(heelanF1(sinPhi, cosPhi)).toBeCloseTo(0, 8);   // P zero  — wrong
        expect(heelanF2(sinPhi, cosPhi)).toBeCloseTo(-1, 8);  // SV max  — wrong
    });

    it("ScaledHeelan PPV now falls monotonically with distance", () => {
        // ⏪ BEFORE 0.3.0 heelanF1 zeroed P broadside to the hole, so PPV read
        //    HIGHER at 20 m than at 10 m.
        const r = [5, 10, 20, 40, 80].map(
            d => computeScaledHeelan({ x: d, y: 0, z: 0 }, [deck], [hole], {})
        );
        for (let i = 1; i < r.length; i++) expect(r[i]).toBeLessThan(r[i - 1]);
    });

    it("HeelanOriginal PPV now falls monotonically with distance", () => {
        const r = [5, 10, 20, 50, 100].map(
            d => computeHeelanOriginal({ x: d, y: 0, z: 0 }, [deck], [hole], {})
        );
        for (let i = 1; i < r.length; i++) expect(r[i]).toBeLessThan(r[i - 1]);
    });
});

describe("§2 the α/β = Vp/Vs factor on SV (B&M Eq 11)", () => {
    it("ScaledHeelanBlair applies it — doubling svWaveWeight changes the answer", () => {
        const base = computeScaledHeelanBlair({ x: 8, y: 0, z: -20 }, [deck], [hole], {});
        const noSV = computeScaledHeelanBlair({ x: 8, y: 0, z: -20 }, [deck], [hole], { svWaveWeight: 0 });
        expect(base).not.toBeCloseTo(noSV, 3);
    });

    it("the two scaled models agree within 15% on the same geometry", () => {
        // They differ only in how Vs is obtained and in elemsPerDeck; before
        // 0.3.0 ScaledHeelanBlair under-weighted S by Vp/Vs ≈ 1.73.
        const a = computeScaledHeelan({ x: 20, y: 0, z: 0 }, [deck], [hole], { elemsPerDeck: 20 });
        const b = computeScaledHeelanBlair({ x: 20, y: 0, z: 0 }, [deck], [hole], { elemsPerDeck: 20 });
        expect(Math.abs(a - b) / a).toBeLessThan(0.15);
    });
});

// ------------------------------------------------------------- §3 A = e·B

describe("§3 the mass exponent A is derived as e·B, not taken as e", () => {
    // Blair 2008 Eq 14 p241: a·(√W/d)^b ≡ K·W^A·d^(−B), so A = e·B.
    // ⏪ BEFORE 0.3.0 `chargeExponent: 0.5` was used directly as A, which is
    //    the scaled-distance exponent, not the mass exponent. The two mean
    //    different things and only one of them is 0.5.
    const at = { x: 30, y: 0, z: 0 };

    it("default e = 0.5, B = 1.6 behaves as A = 0.8", () => {
        const implicit = computeScaledHeelan(at, [deck], [hole], {});
        const explicitA = computeScaledHeelan(at, [deck], [hole], { massExponent: 0.8 });
        expect(implicit).toBeCloseTo(explicitA, 6);
    });

    it("it is NOT the old A = 0.5 behaviour", () => {
        const now = computeScaledHeelan(at, [deck], [hole], {});
        const old = computeScaledHeelan(at, [deck], [hole], { massExponent: 0.5 });
        expect(now / old).toBeGreaterThan(2);   // ~3.3× for an 80 kg deck
    });

    it("generalises to a cube-root site law", () => {
        const cube = computeScaledHeelan(at, [deck], [hole], { chargeExponent: 1 / 3 });
        const explicitA = computeScaledHeelan(at, [deck], [hole], { massExponent: 1.6 / 3 });
        expect(cube).toBeCloseTo(explicitA, 6);
    });

    it("massExponent overrides the derivation for an expert caller", () => {
        const v = computeScaledHeelanBlair(at, [deck], [hole], { massExponent: 0.7, chargeExponent: 0.5 });
        const w = computeScaledHeelanBlair(at, [deck], [hole], { massExponent: 0.7, chargeExponent: 0.9 });
        expect(v).toBeCloseTo(w, 6);
    });
});

// ------------------------------------------------------------------- §4 Q

describe("§4 Q attenuation is off by default on the SCALED models", () => {
    // The R^(−(B−1)) in the site law already IS the material attenuation
    // (B&M p5); exp(−ωR/2QV) on top double-counts it.
    const at = { x: 60, y: 0, z: 0 };

    it("ScaledHeelan ignores Q unless asked", () => {
        const dflt = computeScaledHeelan(at, [deck], [hole], {});
        const off = computeScaledHeelan(at, [deck], [hole], { qualityFactorP: 0, qualityFactorS: 0 });
        expect(dflt).toBeCloseTo(off, 6);
    });

    it("ScaledHeelanBlair ignores Q unless asked", () => {
        const dflt = computeScaledHeelanBlair(at, [deck], [hole], {});
        const off = computeScaledHeelanBlair(at, [deck], [hole], { qualityFactorP: 0, qualityFactorS: 0 });
        expect(dflt).toBeCloseTo(off, 6);
    });

    it("Qs = 0 with Qp > 0 no longer annihilates the S term", () => {
        // ⏪ BEFORE 0.3.0 both were gated on `Qp > 0`, so Qs = 0 gave
        //    exp(−∞) = 0 and S vanished entirely.
        const both = computeScaledHeelan(at, [deck], [hole], { qualityFactorP: 50, qualityFactorS: 30 });
        const sOff = computeScaledHeelan(at, [deck], [hole], { qualityFactorP: 50, qualityFactorS: 0 });
        // With Qs = 0 the S term is UNattenuated, so the result must be larger.
        expect(sOff).toBeGreaterThan(both);
    });

    it("Q still attenuates when explicitly enabled", () => {
        const off = computeScaledHeelan(at, [deck], [hole], {});
        const on = computeScaledHeelan(at, [deck], [hole], { qualityFactorP: 50, qualityFactorS: 30 });
        expect(on).toBeLessThan(off);
    });
});

describe("§6 Q on HeelanOriginal no longer erases the far field", () => {
    it("100 m survives with Q on", () => {
        // ⏪ BEFORE 0.3.0 ω = VOD/(2a) gave attenuation of 2.4e−5 at 100 m.
        const on = computeHeelanOriginal({ x: 100, y: 0, z: 0 }, [deck], [hole], {});
        const off = computeHeelanOriginal({ x: 100, y: 0, z: 0 }, [deck], [hole],
            { qualityFactorP: 0, qualityFactorS: 0 });
        expect(on / off).toBeGreaterThan(0.2);
        expect(on / off).toBeLessThan(1.0);
    });

    it("sits within an order of magnitude of a fitted site law beyond 20 m", () => {
        // Uncalibrated first-principles model — see the ⚠ OPEN note in the
        // source. This pins the order of magnitude, nothing finer.
        for (const R of [20, 50, 100]) {
            const v = computeHeelanOriginal({ x: R, y: 0, z: 0 }, [deck], [hole], {});
            const siteLaw = 1140 * Math.pow(Math.sqrt(80) / R, 1.6);
            expect(v / siteLaw).toBeGreaterThan(0.5);
            expect(v / siteLaw).toBeLessThan(10);
        }
    });
});

// ----------------------------------------------- §5 linear sum + primer order

describe("§5 element summation is linear and counted from the primer", () => {
    it("ScaledHeelan converges in elemsPerDeck", () => {
        // ⏪ BEFORE 0.3.0 the RMS sum made this fall without limit as the
        //    element count rose.
        const at = { x: 20, y: 0, z: 0 };
        const e64 = computeScaledHeelan(at, [deck], [hole], { elemsPerDeck: 64 });
        const e256 = computeScaledHeelan(at, [deck], [hole], { elemsPerDeck: 256 });
        expect(Math.abs(e256 - e64) / e64).toBeLessThan(0.02);
    });

    it("ScaledHeelan now responds to primerFraction at all", () => {
        // ⏪ BEFORE 0.3.0 this model ignored primerFraction entirely — Em
        //    always counted from the deck top.
        const base = createDeckEntry({ ...deckSpec(), primerFraction: 1.0 });
        const top = createDeckEntry({ ...deckSpec(), primerFraction: 0.0 });
        const mid = createDeckEntry({ ...deckSpec(), primerFraction: 0.5 });
        const at = { x: 6, y: 0, z: -7 };
        const vBase = computeScaledHeelan(at, [base], [hole], {});
        const vTop = computeScaledHeelan(at, [top], [hole], {});
        const vMid = computeScaledHeelan(at, [mid], [hole], {});
        expect(vBase).not.toBeCloseTo(vMid, 2);
        expect(vTop).not.toBeCloseTo(vMid, 2);
    });

    it("a mid-column primer reads HIGH against Blair 2008 Eq 22 — known residual", () => {
        // The one-sided fj = |(m+½) − primerElemPos| + 1 over-counts a
        // mid-column primer by roughly 9–13% depending on A. Kept deliberately
        // to match Kirra and Blair's own Python; recorded here rather than
        // silently differing. See "Known residual" in README.md.
        const A = 0.8, N = 20, we = 1 / N;
        let sum = 0;
        for (let m = 0; m < N; m++) {
            const fj = Math.abs(m + 0.5 - 0.5 * N) + 1;
            sum += Math.pow(fj * we, A) - (fj - 1 > 0 ? Math.pow((fj - 1) * we, A) : 0);
        }
        expect(sum).toBeGreaterThan(1.05);   // vs M^A = 1
        expect(sum).toBeLessThan(1.15);
    });
});

// --------------------------------------------------------- §7 smaller items

describe("§7 deck fields", () => {
    it("an explicit 0 is not replaced by the default", () => {
        // ⏪ BEFORE 0.3.0: Number(params.x || default) — a legitimate 0 became
        //    the default.
        const d = createDeckEntry({
            topX: 0, topY: 0, topZ: 0, baseX: 0, baseY: 0, baseZ: -5,
            timingMs: 0, primerFraction: 0, mass: 0
        });
        expect(d.timingMs).toBe(0);
        expect(d.primerFraction).toBe(0);
        expect(d.mass).toBe(0);
    });

    it("omitted fields still fall back to the named defaults", () => {
        const d = createDeckEntry({ topX: 0, topY: 0, topZ: 0, baseX: 0, baseY: 0, baseZ: -5 });
        expect(d.vod).toBe(DEFAULT_VOD);
        expect(d.primerFraction).toBe(1.0);
    });

    it("there is one VOD fallback, and it is DEFAULT_VOD", () => {
        expect(DEFAULT_VOD).toBe(5000);
    });
});

function deckSpec() {
    return {
        deckType: "COUPLED",
        topX: 0, topY: 0, topZ: -4,
        baseX: 0, baseY: 0, baseZ: -11,
        mass: 80, density: 1.2, vod: 5000,
        holeDiamMm: 115, timingMs: 0, holeIndex: 0
    };
}
