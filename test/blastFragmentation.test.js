/**
 * blastFragmentation.test.js — hole-by-hole prediction from a KAP, mixed by rock volume
 *
 * Author: Brent Buffham — blastingapps.com & kirra-design.com
 *
 * Expected values are hand calculations (shown), the mixture's definition
 * P = Σ V·P / Σ V with each hole's curve from predictFragmentation fed a design
 * typed in by hand (not read through the KAP path under test), or closed forms.
 * Coordinates at UTM scale.
 */

import { describe, it, expect } from "vitest";
import { parseKAPObjects } from "../src/io/KAPReader.js";
import { predictFragmentation } from "../src/fragmentation/Fragmentation.js";
import { predictBlastFragmentation, fitBlastRockFactor, holeFragmentationDesign } from "../src/fragmentation/BlastFragmentation.js";

function near(actual, expected, tol, label) {
    if (!(Math.abs(actual - expected) <= tol)) throw new Error((label || "") + " expected " + expected + " ± " + tol + ", got " + actual);
}

var E0 = 478000, N0 = 6970000, Z0 = 400;
var ANFO = { productID: "p-anfo", name: "ANFO", productCategory: "BulkExplosive", density: 0.8 };
var EMUL = { productID: "p-emul", name: "Emulsion", productCategory: "BulkExplosive", density: 1.2 };
var STEM = { productID: "p-stem", name: "Stemming", productCategory: "NonExplosive", density: 2.0 };

// A vertical hole: collar at (E0 + i·4, N0), bench 10 m + 1 m subdrill
function hole(id, extra) {
    var i = Number(id);
    return Object.assign({
        entityType: "hole", entityName: "B1", holeID: String(id), holeType: "Production",
        startXLocation: E0 + i * 4, startYLocation: N0, startZLocation: Z0,
        endXLocation: E0 + i * 4, endYLocation: N0, endZLocation: Z0 - 11,
        holeDiameter: 89, benchHeight: 10, subdrillAmount: 1, burden: 3, spacing: 3.5, holeTime: i * 25
    }, extra || {});
}
function charge(id, decks) {
    return ["B1:::" + id, { holeID: String(id), entityName: "B1", holeDiameterMm: 89, decks: decks, primers: [] }];
}
var STANDARD = [
    { deckID: "s", deckType: "INERT", topDepth: 0, baseDepth: 3, product: STEM },
    { deckID: "c", deckType: "COUPLED", topDepth: 3, baseDepth: 11, product: ANFO }
];

function kapOf(holes, charging) {
    return parseKAPObjects({ holes: holes, charging: charging });
}

// hand: π/4 · 0.089² · 8 m · 800 kg/m³ = 39.8152 kg
var Q_STANDARD = Math.PI / 4 * 0.089 * 0.089 * 8 * 800;
var DESIGN_STANDARD = { burden: 3, spacing: 3.5, benchHeight: 10, holeDiamMm: 89, chargeLength: 8, chargeMass: Q_STANDARD, rws: 100, rockFactor: 7 };

describe("holeFragmentationDesign — one hole from the KAP", () => {
    it("charge, length and bench from the decks and hole: Q = π/4·0.089²·8·800, L 8, H 10", () => {
        var kap = kapOf([hole(1)], [charge(1, STANDARD)]);
        var d = holeFragmentationDesign(kap.holes[0], kap.decks, { rockFactor: 7 }).design;
        near(d.chargeMass, Q_STANDARD, 1e-9);
        near(d.chargeLength, 8, 1e-9);
        expect(d.benchHeight).toBe(10);
        expect(d.rws).toBe(100);
        near(d.bottomChargeLength, 8, 1e-9); // one product: all bottom, Cunningham's single column
        near(d.columnChargeLength, 0, 1e-9);
    });

    it("bench height from collar Z − grade Z when benchHeight is missing", () => {
        var kap = kapOf([hole(1, { benchHeight: 0, gradeZLocation: Z0 - 9.5 })], [charge(1, STANDARD)]);
        expect(holeFragmentationDesign(kap.holes[0], kap.decks, { rockFactor: 7 }).design.benchHeight).toBeCloseTo(9.5, 9);
    });

    it("two products: RWS by mass, bottom charge = the bottom deck's product", () => {
        // emulsion 8–11 m (3 m, 1.2), ANFO 3–8 m (5 m, 0.8); RWS 120 and 100
        var kap = kapOf([hole(1)], [charge(1, [
            { deckID: "s", deckType: "INERT", topDepth: 0, baseDepth: 3, product: STEM },
            { deckID: "a", deckType: "COUPLED", topDepth: 3, baseDepth: 8, product: ANFO },
            { deckID: "e", deckType: "COUPLED", topDepth: 8, baseDepth: 11, product: EMUL }
        ])]);
        var d = holeFragmentationDesign(kap.holes[0], kap.decks, { rockFactor: 7, rwsByProduct: { Emulsion: 120 } }).design;
        var area = Math.PI / 4 * 0.089 * 0.089;
        var mE = area * 3 * 1200, mA = area * 5 * 800;
        near(d.chargeMass, mE + mA, 1e-9);
        near(d.rws, (mE * 120 + mA * 100) / (mE + mA), 1e-9);
        near(d.bottomChargeLength, 3, 1e-9);
        near(d.columnChargeLength, 5, 1e-9);
    });
});

describe("predictBlastFragmentation", () => {
    it("one hole: the blast curve is that hole's predictFragmentation curve", () => {
        var blast = predictBlastFragmentation(kapOf([hole(1)], [charge(1, STANDARD)]), { rockFactor: 7 });
        var single = predictFragmentation(DESIGN_STANDARD);
        [50, 200, 600].forEach((x) => near(blast.kco.passing(x), single.kco.passing(x), 1e-9, "x " + x));
        near(blast.kco.sizeAt(80), single.kco.sizeAt(80), 1e-6);
        near(blast.kuzRam.sizeAt(50), single.kuzRam.x50, 1e-6);
    });

    it("identical holes mix to the same curve", () => {
        var kap = kapOf([hole(1), hole(2), hole(3)], [charge(1, STANDARD), charge(2, STANDARD), charge(3, STANDARD)]);
        var single = predictFragmentation(DESIGN_STANDARD);
        var blast = predictBlastFragmentation(kap, { rockFactor: 7 });
        expect(blast.kco.holes).toBe(3);
        near(blast.kckum.sizeAt(80), single.kckum.sizeAt(80), 1e-6);
    });

    it("two patterns: P = (V1·P1 + V2·P2)/(V1 + V2), V = B·S·H", () => {
        var kap = kapOf([hole(1), hole(2, { burden: 3.5, spacing: 4 })], [charge(1, STANDARD), charge(2, STANDARD)]);
        var blast = predictBlastFragmentation(kap, { rockFactor: 7 });
        var p1 = predictFragmentation(DESIGN_STANDARD);
        var p2 = predictFragmentation(Object.assign({}, DESIGN_STANDARD, { burden: 3.5, spacing: 4 }));
        var v1 = 3 * 3.5 * 10, v2 = 3.5 * 4 * 10; // 105 and 140 m³
        ["kuzRam", "kco", "kckum"].forEach((k) => {
            [30, 150, 400, 900].forEach((x) => {
                near(blast[k].passing(x), (v1 * p1[k].passing(x) + v2 * p2[k].passing(x)) / (v1 + v2), 1e-9, k + " " + x);
            });
            [10, 50, 80, 90].forEach((P) => near(blast[k].passing(blast[k].sizeAt(P)), P, 1e-6, k + " P" + P));
        });
        near(blast.volume, 245, 1e-9);
        near(blast.chargeMass, 2 * Q_STANDARD, 1e-9);
        near(blast.powderFactor, 2 * Q_STANDARD / 245, 1e-12);
    });

    it("a blast P80 is not the mean of the hole P80s", () => {
        var kap = kapOf([hole(1), hole(2, { burden: 4.5, spacing: 5.5 })], [charge(1, STANDARD), charge(2, STANDARD)]);
        var blast = predictBlastFragmentation(kap, { rockFactor: 7 });
        var a = blast.holes[0].result.kco.sizeAt(80), b = blast.holes[1].result.kco.sizeAt(80);
        var p80 = blast.kco.sizeAt(80);
        expect(p80).toBeGreaterThan(Math.min(a, b));
        expect(p80).toBeLessThan(Math.max(a, b));
        expect(Math.abs(p80 - (a + b) / 2)).toBeGreaterThan(1);
    });

    it("holes it cannot predict are listed with the reason, not dropped quietly", () => {
        var kap = kapOf([
            hole(1),
            hole(2, { holeType: "Buffer" }),
            hole(3, { burden: 0 }),
            hole(4),
            hole(5, { burden: 10, spacing: 10, holeDiameter: 51 })
        ], [charge(1, STANDARD), charge(2, STANDARD), charge(3, STANDARD), charge(5, STANDARD).map((x, i) => i ? Object.assign({}, x, { holeDiameterMm: 51 }) : x)]);
        var blast = predictBlastFragmentation(kap, { rockFactor: 7 });
        expect(blast.holes.map((h) => h.holeID)).toEqual(["1"]);
        var why = Object.fromEntries(blast.skipped.map((s) => [s.holeID, s.reason]));
        expect(why["2"]).toMatch(/hole type Buffer/);
        expect(why["3"]).toMatch(/burden/);
        expect(why["4"]).toMatch(/no explosive/);
        expect(why["5"]).toMatch(/uniformity index n/); // 2.2 − 14·10/51 < 0
    });

    it("holeTypes widens the set", () => {
        var kap = kapOf([hole(1), hole(2, { holeType: "Buffer" })], [charge(1, STANDARD), charge(2, STANDARD)]);
        expect(predictBlastFragmentation(kap, { rockFactor: 7, holeTypes: ["production", "buffer"] }).holes.length).toBe(2);
    });

    it("rock factor per hole", () => {
        var kap = kapOf([hole(1), hole(2)], [charge(1, STANDARD), charge(2, STANDARD)]);
        var blast = predictBlastFragmentation(kap, { rockFactor: (h) => (h.holeID === "1" ? 6 : 9) });
        near(blast.holes[1].result.x50 / blast.holes[0].result.x50, 9 / 6, 1e-12); // x50 ∝ A
    });

    it("a missing rock factor is refused", () => {
        expect(() => predictBlastFragmentation(kapOf([hole(1)], [charge(1, STANDARD)]), {})).toThrow(RangeError);
    });
});

describe("fitBlastRockFactor", () => {
    it("a blast curve drawn with A = 9 gives back A = 9", () => {
        var kap = kapOf([hole(1), hole(2, { burden: 3.5, spacing: 4 })], [charge(1, STANDARD), charge(2, STANDARD)]);
        var truth = predictBlastFragmentation(kap, { rockFactor: 9 }).kco;
        var sizes = [20, 50, 100, 200, 400, 700, 1000];
        var fit = fitBlastRockFactor({ sizes: sizes, passing: sizes.map(truth.passing) }, kap, { model: "kco" });
        near(fit.rockFactor, 9, 1e-4);
        near(fit.x50, truth.sizeAt(50), 0.01);
    });
});
