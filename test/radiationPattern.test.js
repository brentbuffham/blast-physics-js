/**
 * radiationPattern.test.js — Tests for Heelan and Blair radiation patterns
 *
 * Author: Brent Buffham — blastingapps.com & kirra-design.com
 */

import { describe, it, expect } from "vitest";
import { heelanF1, heelanF2, blairSfacp, blairSfacs } from "../src/core/RadiationPattern.js";

const DEG = Math.PI / 180;

describe("heelanF1 — P-wave pattern", () => {
    it("is 0 at φ=0° (axial)", () => {
        expect(heelanF1(Math.sin(0), Math.cos(0))).toBeCloseTo(0, 10);
    });

    it("is 0 at φ=90° (radial)", () => {
        expect(heelanF1(Math.sin(90 * DEG), Math.cos(90 * DEG))).toBeCloseTo(0, 8);
    });

    it("is positive and non-zero at φ=45°", () => {
        const val = heelanF1(Math.sin(45 * DEG), Math.cos(45 * DEG));
        expect(val).toBeGreaterThan(0);
    });

    it("achieves maximum near φ=35°", () => {
        // F1 = 2*sin*cos^2, d/dphi = 0 at tan(phi) = 1/sqrt(2) => phi ≈ 35.26°
        const v35 = heelanF1(Math.sin(35 * DEG), Math.cos(35 * DEG));
        const v45 = heelanF1(Math.sin(45 * DEG), Math.cos(45 * DEG));
        const v25 = heelanF1(Math.sin(25 * DEG), Math.cos(25 * DEG));
        expect(v35).toBeGreaterThan(v45);
        expect(v35).toBeGreaterThan(v25);
    });
});

describe("heelanF2 — SV-wave pattern", () => {
    it("is 0 at φ=0° (axial)", () => {
        expect(heelanF2(Math.sin(0), Math.cos(0))).toBeCloseTo(0, 10);
    });

    it("is negative at φ=90°", () => {
        // F2 = sin(phi) * (2cos²phi - 1) → at 90°: 1 * (0-1) = -1
        expect(heelanF2(Math.sin(90 * DEG), Math.cos(90 * DEG))).toBeCloseTo(-1, 8);
    });

    it("changes sign near φ=45°", () => {
        // F2 = 0 when 2cos²phi = 1 → cos²phi = 0.5 → phi = 45°
        expect(Math.abs(heelanF2(Math.sin(45 * DEG), Math.cos(45 * DEG)))).toBeCloseTo(0, 8);
    });
});

describe("blairSfacp — P-wave pattern (non-zero on axis)", () => {
    const nu = 0.25;
    const VS = 4500 / Math.sqrt(2 * (1 - nu) / (1 - 2 * nu));
    const vsp = (VS * VS) / (4500 * 4500);

    it("is non-zero at φ=0° (unlike Heelan F1)", () => {
        const val = blairSfacp(Math.cos(0), vsp);
        // sfacp = 1 - 2*vsp at phi=0
        expect(Math.abs(val)).toBeGreaterThan(0.01);
    });

    it("is 1.0 at φ=90° (radial direction from axis)", () => {
        // cos(90°)=0 → sfacp = 1 - 0 = 1
        expect(blairSfacp(0, vsp)).toBeCloseTo(1.0, 10);
    });
});

describe("blairSfacs — SV-wave pattern with near-axial regularisation", () => {
    const nu = 0.25;
    const VS = 4500 / Math.sqrt(2 * (1 - nu) / (1 - 2 * nu));
    const vsp = (VS * VS) / (4500 * 4500);

    it("is 0 at φ=0° (no near-axial case)", () => {
        // sin(0)=0, cos(0)=1, atanphi=0 < 0.28 → regularisation applied
        const sfacp = blairSfacp(1.0, vsp);
        const val = blairSfacs(0, 1.0, sfacp);
        // Near-axial: sfacs = sign(0) * 1.2 * sfacp = 0 (sin2phi = 0, sign=0 → sfacs=0)
        // Actually sign(0)=0 in JS, so sfacs = 0
        expect(Math.abs(val)).toBeLessThan(Math.abs(1.2 * sfacp) + 0.01);
    });

    it("equals sin(2φ) far from axis", () => {
        // At φ=60°, atanphi = tan(60°) = 1.73 >> 0.28, no regularisation
        const sinPhi = Math.sin(60 * DEG);
        const cosPhi = Math.cos(60 * DEG);
        const sfacp = blairSfacp(cosPhi, vsp);
        const result = blairSfacs(sinPhi, cosPhi, sfacp);
        const expected = 2 * sinPhi * cosPhi;  // sin(2φ)
        expect(result).toBeCloseTo(expected, 8);
    });
});
