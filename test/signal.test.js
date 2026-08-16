/**
 * signal.test.js — FFT, wavelets, frequency analysis, seed synthesis, forward array,
 *                  signature deconvolution, detune
 *
 * Author: Brent Buffham — blastingapps.com & kirra-design.com
 */

import { describe, it, expect } from "vitest";
import { nextPow2, fftInPlace, ifftInPlace, fftMagnitude, peakInRange, peakAbs } from "../src/signal/FFT.js";
import { generateRicker, generateBerlage, generateDampedSinusoid, generateTwoTerm, evalRicker, evalRickerCausal, resampleMeasured, coerceSamples, buildSeedBundle } from "../src/signal/Wavelets.js";
import { computeIDI, computeSpectrum, dominantFrequencies, timeWindowHistogram, fireTimesFromDecks, frequencyBand } from "../src/signal/FrequencyAnalysis.js";
import { synthesizeTrace, computeBlairDamageScale, tracePeak, decksFromEntries, sitePPV } from "../src/signal/SeedSynthesis.js";
import { runForwardArraySynthesis, bearingFromTo, normaliseAngle, polarisationAngle } from "../src/signal/ForwardArray.js";
import { extractSignature, pearsonCC } from "../src/signal/SignatureDeconvolution.js";
import { gaoCorrectionFactor, isGaoNearField } from "../src/signal/GaoNearFieldCorrection.js";
import { mulberry32, detuneFireTimes, snapToPalette, constrainEventRate, rollingWindowCounts } from "../src/signal/Detune.js";
import { createDeckEntry } from "../src/core/DeckEntry.js";

describe("FFT", () => {
    it("nextPow2", () => {
        expect(nextPow2(1)).toBe(1);
        expect(nextPow2(5)).toBe(8);
        expect(nextPow2(1024)).toBe(1024);
        expect(nextPow2(1025)).toBe(2048);
    });

    it("impulse → flat spectrum; ifft round-trips", () => {
        const N = 16;
        const re = new Float64Array(N), im = new Float64Array(N);
        re[0] = 1;
        fftInPlace(re, im);
        for (let k = 0; k < N; k++) { expect(re[k]).toBeCloseTo(1, 10); expect(im[k]).toBeCloseTo(0, 10); }
        ifftInPlace(re, im);
        expect(re[0]).toBeCloseTo(1, 10);
        for (let k = 1; k < N; k++) expect(re[k]).toBeCloseTo(0, 10);
    });

    it("rejects non power-of-two lengths", () => {
        expect(() => fftInPlace(new Float64Array(6), new Float64Array(6))).toThrow();
    });

    it("fftMagnitude finds a 50 Hz sinusoid with amplitude ≈ 3", () => {
        const fs = 1000, n = 1024;
        const x = new Float64Array(n);
        for (let i = 0; i < n; i++) x[i] = 3 * Math.sin(2 * Math.PI * 50 * i / fs);
        const sp = fftMagnitude(x, fs);
        const pk = peakInRange(sp.mag, sp.df, 10, 200);
        expect(Math.abs(pk.freq - 50)).toBeLessThan(sp.df * 1.01);
        expect(pk.mag).toBeGreaterThan(2.5);
        expect(pk.mag).toBeLessThan(3.5);
        const pa = peakAbs(x, fs);
        expect(pa.val).toBeCloseTo(3, 1);
    });
});

describe("Wavelets", () => {
    it("Ricker: peak 1 at centre, zero mean-ish, symmetric", () => {
        expect(evalRicker(0, 30)).toBe(1);
        expect(evalRicker(0.01, 30)).toBeCloseTo(evalRicker(-0.01, 30), 12);
        expect(evalRickerCausal(-0.001, 30)).toBe(0);
        const r = generateRicker({ fDomHz: 30, durationMs: 200, sampleRateHz: 1000 });
        expect(r.samples.length).toBe(200);
        expect(r.causal).toBe(false);
        expect(r.samples[100]).toBeCloseTo(1, 6);
    });

    it("causal seeds start at zero and are peak-normalised", () => {
        for (const gen of [generateBerlage, generateDampedSinusoid]) {
            const s = gen({ fDomHz: 30, durationMs: 300, sampleRateHz: 1000, damping: 0.1 });
            expect(s.causal).toBe(true);
            expect(Math.abs(s.samples[0])).toBeLessThan(1e-6);
            let mx = 0; for (const v of s.samples) mx = Math.max(mx, Math.abs(v));
            expect(mx).toBeCloseTo(1, 6);
        }
    });

    it("two-term carries P and S components", () => {
        const tt = generateTwoTerm({ fP_Hz: 30, fS_Hz: 18, ampS: 0.7 });
        expect(tt.twoTerm).toBe(true);
        expect(tt.pSamples.length).toBe(tt.sSamples.length);
        expect(tt.samples[10]).toBeCloseTo(tt.pSamples[10] + 0.7 * tt.sSamples[10], 6);
    });

    it("resample halves the sample count at half rate; coerce handles JSON objects", () => {
        const s = new Float32Array([0, 1, 2, 3, 4, 5, 6, 7]);
        expect(resampleMeasured(s, 1000, 500).length).toBe(4);
        expect(coerceSamples({ "0": 1, "1": 2, "2": 3 })).toEqual(new Float32Array([1, 2, 3]));
        expect(coerceSamples([])).toBeNull();
    });

    it("buildSeedBundle returns null for unknown kinds and a bundle for twoterm", () => {
        expect(buildSeedBundle({ kind: "nope" }, 1000)).toBeNull();
        const b = buildSeedBundle({ kind: "twoterm", params: {} }, 1000, 2);
        expect(b.kind).toBe("twoterm");
        expect(b.pSamples.length).toBeGreaterThan(0);
        expect(b.causalBody).toBe(true);
    });
});

describe("FrequencyAnalysis", () => {
    const times = [0, 8, 16, 24, 32, 40, 48, 56, 64, 72];

    it("computeIDI: 8 ms delays give median 8 and one dominant bin", () => {
        const idi = computeIDI(times, 1);
        expect(idi.medianMs).toBe(8);
        expect(idi.meanMs).toBe(8);
        expect(idi.intervals.length).toBe(9);
        const dom = dominantFrequencies(idi, 1);
        expect(dom[0].intervalMs).toBe(8);
        expect(dom[0].freqHz).toBeCloseTo(125, 6);
    });

    it("computeSpectrum: 8 ms comb peaks at 125 Hz", () => {
        const sp = computeSpectrum(times, { sampleRateHz: 1000, tailMs: 500, maxHz: 300 });
        expect(sp.peaks.length).toBeGreaterThan(0);
        expect(Math.abs(sp.peaks[0].freq - 125)).toBeLessThan(2);
    });

    it("timeWindowHistogram bins events with offset edge bin", () => {
        const h = timeWindowHistogram([2, 9, 10, 17, 25], 8, { offsetMs: 4 });
        expect(h.counts[0]).toBe(1);   // edge bin [−∞, 4)
        expect(h.counts[1]).toBe(2);   // [4, 12)
        expect(h.maxSum).toBe(2);
    });

    it("fireTimesFromDecks sorts and weights", () => {
        const decks = [
            createDeckEntry({ topX: 0, topY: 0, topZ: 0, baseX: 0, baseY: 0, baseZ: -5, mass: 50, timingMs: 25 }),
            createDeckEntry({ topX: 0, topY: 0, topZ: 0, baseX: 0, baseY: 0, baseZ: -5, mass: 80, timingMs: 0 })
        ];
        const ft = fireTimesFromDecks(decks);
        expect(ft.times).toEqual([0, 25]);
        expect(ft.weights).toEqual([80, 50]);
    });

    it("frequencyBand classifies", () => {
        expect(frequencyBand(3).key).toBe("low");
        expect(frequencyBand(10).key).toBe("residential");
        expect(frequencyBand(30).key).toBe("commercial");
        expect(frequencyBand(125).key).toBe("safe");
    });
});

describe("SeedSynthesis", () => {
    const decks = [
        { x: 0, y: 0, z: 0, Q: 100, fireMs: 0 },
        { x: 5, y: 0, z: 0, Q: 100, fireMs: 25 },
        { x: 10, y: 0, z: 0, Q: 100, fireMs: 50 }
    ];

    it("linear superposition of a Ricker: peak equals single-seed peak when spaced (uniform amp)", () => {
        const seed = generateRicker({ fDomHz: 60, durationMs: 100, sampleRateHz: 1000 });
        const tr = synthesizeTrace({ decks, seed, params: { amplitudeMode: "uniform" } });
        expect(tr.deckCount).toBe(3);
        const pk = tracePeak(tr);
        expect(pk.peak).toBeCloseTo(1, 2);
        expect(tr.t[0]).toBeLessThan(0);          // half-seed lead for acausal seed
    });

    it("site-law amplitude with a monitor decays with distance", () => {
        const seed = generateBerlage({ fDomHz: 30 });
        const near = synthesizeTrace({ decks, seed, monitor: { x: 0, y: 50, z: 0 }, params: { amplitudeMode: "siteLaw", K: 1140, B: 1.6 } });
        const far  = synthesizeTrace({ decks, seed, monitor: { x: 0, y: 500, z: 0 }, params: { amplitudeMode: "siteLaw", K: 1140, B: 1.6 } });
        expect(tracePeak(near).peak).toBeGreaterThan(tracePeak(far).peak);
        expect(sitePPV(100, 100, { K: 1140, B: 1.6 })).toBeCloseTo(1140 * Math.pow(10, -1.6), 6);
    });

    it("Blair damage scale is 1 for the first-firing deck and <1 for later ones", () => {
        const sc = computeBlairDamageScale(decks, { eta: 2, meanSpacingM: 4 });
        expect(sc[0]).toBe(1);
        expect(sc[1]).toBeLessThan(1);
        expect(sc[2]).toBeLessThan(sc[1]);
    });

    it("blairMinchinton superposition never exceeds linear peak", () => {
        const seed = generateRicker({ fDomHz: 60 });
        const lin = synthesizeTrace({ decks, seed, params: { amplitudeMode: "sqrtQ" }, superposition: "linear" });
        const bm = synthesizeTrace({ decks, seed, params: { amplitudeMode: "sqrtQ" }, superposition: "blairMinchinton" });
        expect(tracePeak(bm).peak).toBeLessThanOrEqual(tracePeak(lin).peak + 1e-9);
    });

    it("decksFromEntries maps DeckEntry midpoints", () => {
        const d = createDeckEntry({ topX: 0, topY: 0, topZ: 0, baseX: 0, baseY: 0, baseZ: -10, mass: 40, timingMs: 17, holeIndex: 3 });
        const list = decksFromEntries([d]);
        expect(list[0]).toMatchObject({ x: 0, y: 0, z: -5, Q: 40, fireMs: 17, holeIndex: 3 });
    });
});

describe("ForwardArray", () => {
    const holes = [
        { id: "a", x: 0, y: 0, z: 0, weight: 100, fireTimeMs: 0 },
        { id: "b", x: 5, y: 0, z: 0, weight: 100, fireTimeMs: 17 },
        { id: "c", x: 10, y: 0, z: 0, weight: 100, fireTimeMs: 34 }
    ];

    it("bearing/angle helpers", () => {
        expect(bearingFromTo(0, 0, 0, 10)).toBeCloseTo(0, 9);            // north
        expect(bearingFromTo(0, 0, 10, 0)).toBeCloseTo(Math.PI / 2, 9);  // east
        expect(normaliseAngle(3 * Math.PI)).toBeCloseTo(Math.PI, 9);
        const L = [1, -1, 1, -1], T = [0, 0, 0, 0];
        expect(polarisationAngle(L, T)).toBeCloseTo(0, 9);
    });

    it("produces traces with a positive PVS and expected geometry stats", () => {
        const r = runForwardArraySynthesis({ holes, monitor: { x: 0, y: 200, z: 0 }, fs: 1024, durationS: 2 });
        expect(r.L.length).toBe(2048);
        expect(r.stats.peakVectorSum).toBeGreaterThan(0);
        expect(r.stats.contributorCount).toBe(3);
        expect(r.stats.closest.id).toBe("a");
        expect(r.stats.dominantHolePPV).toBeGreaterThan(0);
        // Monitor due north of a line of holes: L is aligned along y so |L| dominates T
        expect(r.stats.LPeak).toBeGreaterThan(r.stats.TPeak);
    });

    it("sampled seed path (twoterm) and Love wave run; skipFFT empties FFTs", () => {
        const r = runForwardArraySynthesis({ holes, monitor: { x: 100, y: 100, z: 0 }, fs: 1024, durationS: 2,
            seedSpec: { kind: "twoterm", params: {} }, love: { include: true }, skipFFT: true, gaoCorrectionEnabled: true });
        expect(r.stats.seedKind).toBe("twoterm");
        expect(r.fftL.N).toBe(0);
        expect(r.stats.peakVectorSum).toBeGreaterThan(0);
    });

    it("empty hole list returns zeroed result", () => {
        const r = runForwardArraySynthesis({ holes: [], monitor: { x: 0, y: 0, z: 0 } });
        expect(r.stats.peakVectorSum).toBe(0);
        expect(r.stats.contributorCount).toBe(0);
    });
});

describe("SignatureDeconvolution", () => {
    it("recovers a known signature from a synthetic production seismogram (CC > 0.9)", () => {
        const SR = 1000;
        const sig = generateBerlage({ fDomHz: 20, durationMs: 300, sampleRateHz: SR, damping: 0.15 }).samples;
        const fires = [100, 125, 150, 175, 200, 250, 300, 350];
        const N = 2000;
        const y = new Float32Array(N);
        for (const f of fires) { const s0 = Math.round(f * SR / 1000); for (let k = 0; k < sig.length && s0 + k < N; k++) y[s0 + k] += sig[k]; }
        const res = extractSignature({ trace: y, sampleRateHz: SR, fireTimesMs: fires, cutoffHz: 60, prngSeed: 7, outputDurationMs: 300 });
        expect(res.ccReconstruction).toBeGreaterThan(0.9);
        const cc = pearsonCC(res.samples, sig, 300);
        expect(cc).toBeGreaterThan(0.9);
    });

    it("throws on empty inputs", () => {
        expect(() => extractSignature({ trace: [], sampleRateHz: 1000, fireTimesMs: [0] })).toThrow();
        expect(() => extractSignature({ trace: [1, 2, 3], sampleRateHz: 1000, fireTimesMs: [] })).toThrow();
    });
});

describe("Gao near-field correction", () => {
    it("interpolates Table 4 and clamps", () => {
        expect(gaoCorrectionFactor(5)).toBeCloseTo(1.15, 6);
        expect(gaoCorrectionFactor(1)).toBeCloseTo(1.15, 6);
        expect(gaoCorrectionFactor(100)).toBeCloseTo(1.025, 6);
        expect(gaoCorrectionFactor(7.5)).toBeCloseTo((1.15 + 0.906) / 2, 6);
        expect(isGaoNearField(10)).toBe(true);
        expect(isGaoNearField(30)).toBe(false);
    });
});

describe("Detune", () => {
    it("mulberry32 is deterministic and in [0,1)", () => {
        const a = mulberry32(42), b = mulberry32(42);
        for (let i = 0; i < 20; i++) { const v = a(); expect(v).toBe(b()); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1); }
    });

    it("detuneFireTimes stays within magnitude and is reproducible", () => {
        const times = [0, 8, 16, 24, 32];
        const r1 = detuneFireTimes(times, { magnitudeMs: 3, seed: 1, decimals: 0 });
        const r2 = detuneFireTimes(times, { magnitudeMs: 3, seed: 1, decimals: 0 });
        expect(r1.times).toEqual(r2.times);
        expect(r1.summary.maxAbsMs).toBeLessThanOrEqual(3);
        const pos = detuneFireTimes(times, { magnitudeMs: 3, seed: 1, mode: "positive" });
        pos.deltas.forEach(d => expect(d).toBeGreaterThanOrEqual(0));
    });

    it("snapToPalette picks nearest palette value", () => {
        expect(snapToPalette([10, 40, 100], [9, 17, 25, 42, 67, 109])).toEqual([9, 42, 109]);
    });

    it("constrainEventRate removes rolling-window violations", () => {
        const times = [0, 1, 2, 3, 4, 20, 21, 22];
        expect(rollingWindowCounts(times, 8)[4]).toBe(5);
        const r = constrainEventRate(times, { windowMs: 8, maxEvents: 2 });
        expect(r.violationsBefore).toBeGreaterThan(0);
        expect(r.violationsAfter).toBe(0);
        expect(r.times.length).toBe(times.length);
    });
});
