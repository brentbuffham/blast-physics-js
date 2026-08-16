/**
 * vibrationExtras.test.js — Site law regression/inverse, Blair 2011 PoE, receptor PPV,
 *                           ripple tank, SDoB, SEE, ballistics
 *
 * Author: Brent Buffham — blastingapps.com & kirra-design.com
 */

import { describe, it, expect } from "vitest";
import { fitSiteLaw, scaledDistance, maxAllowableCharge, distanceForPPV, sitePPV, distance3D } from "../src/vibration/SiteLaw.js";
import { zbScore, probabilityOfExceedance, poeFromPrediction, holePoeAtMonitor, normalQuantile, effectiveTargetForPoE, poeBand, POE_C } from "../src/vibration/ProbabilityOfExceedance.js";
import { evaluateReceptor, evaluateMonitors, binDecksByTime } from "../src/vibration/ReceptorPPV.js";
import { RippleTankModel, rippleAmplitude, rippleWaveFronts, rippleSourcesFromDecks } from "../src/vibration/RippleTank.js";
import { computeHoleSDoB, sdobRiskBand, SDoBModel, chargeColumnsFromDecks } from "../src/flyrock/SDoB.js";
import { specificExplosiveEnergy, computeSEE, SEEModel } from "../src/pressure/SEE.js";
import { ballisticRange, ballisticApex, ballisticFlightTime, optimalLaunchAngle, velocityForRange, sampleTrajectory, sphereDragConstant } from "../src/flyrock/Ballistics.js";
import { generateRicker } from "../src/signal/Wavelets.js";
import { createDeckEntry } from "../src/core/DeckEntry.js";
import { createHoleEntry } from "../src/core/HoleEntry.js";

describe("SiteLaw", () => {
    it("scaledDistance and sitePPV are consistent", () => {
        expect(scaledDistance(100, 25)).toBeCloseTo(20, 9);
        expect(scaledDistance(0, 25)).toBeNaN();
        expect(sitePPV(200, 100, { K: 1140, B: 1.6, cutoffSD: 0 })).toBeCloseTo(1140 * Math.pow(20, -1.6), 6);
        expect(distance3D([0, 0, 0], [3, 4, 0])).toBe(5);
    });

    it("fitSiteLaw recovers K and B from synthetic data", () => {
        const K = 900, B = 1.55, e = 0.5;
        const obs = [];
        for (let i = 1; i <= 12; i++) {
            const D = 40 * i, Q = 20 + i * 5;
            obs.push({ D, Q, VPPV: K * Math.pow(D / Math.pow(Q, e), -B) });
        }
        const fit = fitSiteLaw(obs, { axis: "VPPV", chargeExponent: e });
        expect(fit.n).toBe(12);
        expect(fit.K50).toBeCloseTo(K, 3);
        expect(fit.B).toBeCloseTo(B, 6);
        expect(fit.RSQ).toBeCloseTo(1, 6);
        expect(fit.K95).toBeGreaterThanOrEqual(fit.K50);
        expect(fitSiteLaw(obs.slice(0, 2))).toBeNull();
    });

    it("maxAllowableCharge / distanceForPPV invert the site law", () => {
        const p = { K: 1140, B: 1.6, chargeExponent: 0.5 };
        const Q = maxAllowableCharge(200, 10, p);
        expect(sitePPV(200, Q, Object.assign({ cutoffSD: 0 }, p))).toBeCloseTo(10, 6);
        expect(distanceForPPV(Q, 10, p)).toBeCloseTo(200, 6);
        expect(maxAllowableCharge(200, 0, p)).toBe(0);
    });
});

describe("Probability of Exceedance (Blair 2011)", () => {
    it("coefficients are Blair Eq 18", () => {
        expect(POE_C).toEqual([0.196854, 0.115194, 0.000344, 0.019527]);
    });

    it("§4 explicit values z=0, 1, −1", () => {
        expect(probabilityOfExceedance(0)).toBeCloseTo(0.5, 6);
        expect(probabilityOfExceedance(1)).toBeCloseTo(0.1589, 3);
        expect(probabilityOfExceedance(-1)).toBeCloseTo(0.8411, 3);
    });

    it("Table 1 worked examples", () => {
        const rows = [
            { a: 696.6, b: 1.445, s: 0.220, sd: 25, Vb: 5,   z: -0.564, P: 0.714 },
            { a: 696.6, b: 1.445, s: 0.220, sd: 25, Vb: 10,  z: 0.805,  P: 0.211 },
            { a: 76.03, b: 0.756, s: 0.166, sd: 5,  Vb: 25,  z: 0.273,  P: 0.392 },
            { a: 5954,  b: 2.137, s: 0.197, sd: 3.5, Vb: 570, z: 0.730, P: 0.233 }
        ];
        for (const r of rows) {
            const z = zbScore({ Vbeta: r.Vb, a: r.a, b: r.b, sigma: r.s, scaledDistance: r.sd });
            expect(z).toBeCloseTo(r.z, 2);
            expect(probabilityOfExceedance(z)).toBeCloseTo(r.P, 2);
        }
    });

    it("negative branch keeps + sign on even powers (XLSX bug canary) and never exceeds 1", () => {
        for (let z = -3; z <= 3; z += 0.25) {
            const P = probabilityOfExceedance(z);
            expect(P).toBeGreaterThanOrEqual(0);
            expect(P).toBeLessThanOrEqual(1);
        }
        // Symmetry: P(z) + P(−z) = 1
        expect(probabilityOfExceedance(0.8) + probabilityOfExceedance(-0.8)).toBeCloseTo(1, 6);
    });

    it("poeFromPrediction ≡ zbScore path; holePoeAtMonitor wraps", () => {
        const a = 696.6, b = 1.445, s = 0.22, sd = 25, Vb = 10;
        const Vp = a * Math.pow(sd, -b);
        const viaPred = poeFromPrediction(Vp, Vb, s);
        const z = zbScore({ Vbeta: Vb, a, b, sigma: s, scaledDistance: sd });
        expect(viaPred.z).toBeCloseTo(z, 9);
        const h = holePoeAtMonitor({ K: a, B: b, chargeExponent: 0.5, targetPPV: Vb, siteSigma: s }, 250, 100);
        expect(h.scaledDistance).toBeCloseTo(25, 9);
        expect(h.P).toBeCloseTo(0.211, 2);
        expect(poeBand(h.P).key).toBe("warning");
    });

    it("normalQuantile inverts the polynomial Φ; effective target shrinks for low PoE", () => {
        expect(normalQuantile(0.5)).toBeCloseTo(0, 9);
        expect(normalQuantile(0.975)).toBeCloseTo(1.95996, 4);
        expect(normalQuantile(0.01)).toBeCloseTo(-2.32635, 4);
        const t = effectiveTargetForPoE(115, 0.01, 0.22);
        expect(t).toBeLessThan(115);
        expect(effectiveTargetForPoE(115, 0.5, 0.22)).toBeCloseTo(115, 9);
    });
});

describe("ReceptorPPV", () => {
    const decks = [
        { x: 0, y: 0, z: 0, Q: 100, fireMs: 0, holeIndex: 0, holeID: "A" },
        { x: 6, y: 0, z: 0, fireMs: 4, Q: 100, holeIndex: 1, holeID: "B" },
        { x: 12, y: 0, z: 0, fireMs: 200, Q: 100, holeIndex: 2, holeID: "C" }
    ];

    it("mode A peak picks the closest deck; RMS window sums the two near-simultaneous decks", () => {
        const pt = { x: -100, y: 0, z: 0 };
        const a = evaluateReceptor(pt, decks, { outputMode: "A" });
        expect(a.dominantHoleID).toBe("A");
        expect(a.value).toBeCloseTo(a.ppvMax, 9);
        const rms = evaluateReceptor(pt, decks, { outputMode: "A", superposeRMS: true, coherenceMs: 8, useArrivalTime: false });
        expect(rms.rmsDeckCount).toBe(2);
        expect(rms.ppvRMS).toBeGreaterThan(rms.ppvMax);
        expect(rms.ppvRMS).toBeLessThan(rms.ppvMax * Math.SQRT2 + 1e-9);
    });

    it("mode C compliance ratio and mode D max allowable charge", () => {
        const pt = { x: -100, y: 0, z: 0 };
        const c = evaluateReceptor(pt, decks, { outputMode: "C", targetPPV: 10 });
        expect(c.value).toBeCloseTo(c.ppvMax / 10, 9);
        const d = evaluateReceptor(pt, decks, { outputMode: "D", targetPPV: 10, K: 1140, B: 1.6 });
        const SDt = Math.pow(1140 / 10, 1 / 1.6);
        expect(d.value).toBeCloseTo(Math.pow(100 / SDt, 2), 6);
    });

    it("coherent seed path returns a peak when a seed is provided", () => {
        const seed = generateRicker({ fDomHz: 40, durationMs: 100, sampleRateHz: 1000 });
        const r = evaluateReceptor({ x: -100, y: 0, z: 0 }, decks, { superposeRMS: true, useArrivalTime: true, seedSamples: seed.samples, seedSampleRateHz: 1000 });
        expect(r.ppvCoherent).toBeGreaterThan(0);
        expect(r.value).toBe(r.ppvCoherent);
    });

    it("cutoffSD clamps the near field; binDecksByTime groups; evaluateMonitors reports rows", () => {
        const near = evaluateReceptor({ x: 0.1, y: 0, z: 0 }, decks, { cutoffSD: 1.0 });
        expect(near.dominantDistance).toBeCloseTo(10, 6);   // 1.0 × 100^0.5
        const bins = binDecksByTime(decks, 8);
        expect(bins.length).toBe(2);
        expect(bins[0].Q_total).toBe(200);
        const rows = evaluateMonitors([{ name: "M1", x: -100, y: 0, z: 0 }], decks, {});
        expect(rows[0].monitor).toBe("M1");
        expect(rows[0].dominantHoleID).toBe("A");
    });

    it("empty deck list returns null value", () => {
        expect(evaluateReceptor({ x: 0, y: 0, z: 0 }, [], {}).value).toBeNull();
    });
});

describe("RippleTank", () => {
    const deck = createDeckEntry({ topX: 0, topY: 0, topZ: -3, baseX: 0, baseY: 0, baseZ: -13, mass: 100, timingMs: 0 });
    const model = new RippleTankModel({ cp: 5000, cs: 2900, fP: 100, fS: 60, K: 1140, B: 1.6 });

    it("is causal: zero before the P arrival, non-zero shortly after", () => {
        const pt = { x: 100, y: 0, z: -8 };       // 100 m from the deck centroid
        expect(model.evaluate(pt, [deck], 0.01)).toBe(0);            // P arrives at 0.02 s
        const after = model.evaluate(pt, [deck], 0.02 + 0.004);
        expect(after).not.toBe(0);
    });

    it("P-only equals combined before the S arrival", () => {
        const pt = { x: 100, y: 0, z: -8 };
        const t = 0.02 + 0.003;
        const pOnly = rippleAmplitude(pt, t, rippleSourcesFromDecks([deck]), { displayComponent: "p" });
        const comb = rippleAmplitude(pt, t, rippleSourcesFromDecks([deck]), { displayComponent: "combined" });
        expect(pOnly).toBeCloseTo(comb, 9);
    });

    it("computeGrid returns the GridResult shape and wave fronts grow at cp/cs", () => {
        const g = model.computeGrid([deck], { minX: -50, minY: -50, rows: 11, cols: 11, cellX: 10, cellY: 10, elevation: -8 }, 0.01);
        expect(g.data.length).toBe(121);
        expect(g.model).toBe("RippleTank");
        const wf = rippleWaveFronts(0.01, [deck], { cp: 5000, cs: 2900 });
        expect(wf[0].rP).toBeCloseTo(50, 6);
        expect(wf[0].rS).toBeCloseTo(29, 6);
    });

    it("measured wavelet falls back to ricker without a seed; timeSeries has expected length", () => {
        const m2 = new RippleTankModel({ waveletType: "measured" });
        const ts = m2.timeSeries({ x: 60, y: 0, z: -8 }, [deck], 0, 0.1, 0.001);
        expect(ts.t.length).toBe(101);
        expect(ts.v.length).toBe(101);
    });
});

describe("SDoB / SEE", () => {
    it("McKenzie wiki example: 115 mm, St 2 m, Lc 10 m, 1.2 kg/L → SDoB ≈ 1.059", () => {
        const r = computeHoleSDoB({ holeDiamMm: 115, stemmingLength: 2, chargeLength: 10, explosiveDensity: 1.2 });
        expect(r.contributingLength).toBeCloseTo(1.15, 6);
        expect(r.contributingMass).toBeCloseTo(14.34, 1);
        expect(r.sDoB).toBeCloseTo(1.059, 2);
        expect(sdobRiskBand(r.sDoB).key).toBe("high");
        expect(sdobRiskBand(0.5).key).toBe("veryHigh");
        expect(sdobRiskBand(3).key).toBe("veryLow");
    });

    it("SDoBModel grid: directly above the collar D ≈ stemming; far away NaN", () => {
        const hole = createHoleEntry({ collarX: 0, collarY: 0, collarZ: 0, toeX: 0, toeY: 0, toeZ: -12, holeDiamMm: 115 });
        const deck = createDeckEntry({ topX: 0, topY: 0, topZ: -2, baseX: 0, baseY: 0, baseZ: -12, mass: 124.7, holeDiamMm: 115, holeIndex: 0 });
        const cols = chargeColumnsFromDecks([deck], [hole]);
        expect(cols[0].stemmingLength).toBeCloseTo(2, 6);
        const m = new SDoBModel({ maxDisplayDistance: 50 });
        const atCollar = m.evaluate({ x: 0, y: 0, z: 0 }, [deck], [hole]);
        // D = 2 m to charge top; Wt = 12.47 kg/m × 1.15 m = 14.34 kg → SDoB = 2/2.43 = 0.82
        expect(atCollar).toBeCloseTo(2 / Math.pow(14.34, 1 / 3), 1);
        expect(m.evaluate({ x: 500, y: 0, z: 0 }, [deck], [hole])).toBeNaN();
        const g = m.computeGrid([deck], [hole], { minX: -10, minY: -10, rows: 5, cols: 5, cellX: 5, cellY: 5, elevation: 0 });
        expect(g.data.length).toBe(25);
    });

    it("SEE: ANFO ≈ 8.6 GJ/m³, emulsion ≈ 18.8 GJ/m³", () => {
        expect(specificExplosiveEnergy(0.85, 4500)).toBeCloseTo(8.6, 1);
        expect(specificExplosiveEnergy(1.2, 5600)).toBeCloseTo(18.8, 1);
        const deck = createDeckEntry({ topX: 0, topY: 0, topZ: -2, baseX: 0, baseY: 0, baseZ: -12, mass: 100, density: 1.2, vod: 5600 });
        expect(computeSEE({ x: 5, y: 0, z: -7 }, [deck])).toBeCloseTo(18.8, 1);
        const g = new SEEModel().computeGrid([deck], { minX: -10, minY: -10, rows: 3, cols: 3, cellX: 10, cellY: 10, elevation: -7 });
        expect(g.data.length).toBe(9);
    });
});

describe("Ballistics", () => {
    it("flat-ground range at 45° = V²/g and apex = V²/(4g)", () => {
        const V = 30, g = 9.80665;
        expect(ballisticRange(V, 45)).toBeCloseTo(V * V / g, 6);
        expect(ballisticApex(V, 90)).toBeCloseTo(V * V / (2 * g), 6);
        expect(ballisticApex(V, 45)).toBeCloseTo(V * V / (4 * g), 6);
        expect(ballisticFlightTime(V, 90)).toBeCloseTo(2 * V / g, 6);
        expect(optimalLaunchAngle(V, 0)).toBeCloseTo(45, 6);
        expect(optimalLaunchAngle(V, 20)).toBeLessThan(45);
        expect(velocityForRange(V * V / g, 45)).toBeCloseTo(V, 6);
    });

    it("sampled trajectory in vacuum matches the analytic range; drag shortens it", () => {
        const vac = sampleTrajectory({ V: 30, thetaDeg: 40, dt: 0.001 });
        expect(vac.range).toBeCloseTo(ballisticRange(30, 40), 0);
        const k = sphereDragConstant(0.1);
        expect(k).toBeGreaterThan(0);
        const drag = sampleTrajectory({ V: 30, thetaDeg: 40, dt: 0.001, dragK: k });
        expect(drag.range).toBeLessThan(vac.range);
    });
});
