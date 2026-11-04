/**
 * WorkmanCalder.js — Calder's (CANMET) presplit borehole pressure, and Workman
 * & Calder's bottom charge for large-hole presplits
 *
 * Author: Brent Buffham — blastingapps.com & kirra-design.com
 * License: MIT
 *
 * The CANMET Pit Slope Manual method (Calder 1977), as Workman & Calder (1991)
 * give it:
 *
 *   coupled       Pb = N·ρ·D²                     psi, ρ g/cm³, D ft/s
 *                 N = K·(W/D) from their Figure 1 against density (×10⁻³)
 *   decoupled     Pb,dc = Pb·(C.R.)^2.4,  C.R. = √C · rc/rh
 *   charge        set Pb,dc to the target (the rock's compressive strength, or
 *                 10 000–15 000 psi for large holes), solve C.R. for rc, then
 *                 Wc = π/4·Dc²·h·ρ, h = hole depth − the unloaded collar
 *                 (often 10 ft). The weight goes in the bottom of the hole.
 *   spacing       S = 2rh·(Pb + T)/T  (forceBalanceSpacingM)
 *
 * N falls with density: 2.53×10⁻³ at 0.8 g/cm³, 1.07×10⁻³ at 2.0. Chiappetta's
 * constant 1.69×10⁻³ (ρD²/8) is Calder's N near 1.3 g/cm³, so for ANFO
 * Calder's pressure is about 40 % higher.
 *
 * UNITS: diameters mm, lengths m, density g/cm³, VOD m/s, pressure MPa, mass kg.
 *
 * SOURCE (key in brentbuffham/blasting-knowledge references.bib)
 *  [workman1991largehole] Workman, J.L. & Calder, P.N. (1991) A method for
 *    calculating the weight of charge to use in large hole pre-splitting for
 *    cast blasting operations. 17th ISEE Conference, Vol 2, 97–105.
 *    Equations pp99–102, Tables 1–4 p104, Figure 1 p105 (PDF pages 3–9).
 *  Calder, P. (1977) Pit Slope Manual, Chapter 7: Perimeter Blasting. CANMET
 *    Report 77-14 (the source they follow).
 */

import { psiToMpa } from "./Presplit.js";

var FT_PER_M = 1 / 0.3048;

function positive(v, name) {
    if (typeof v !== "number" || !isFinite(v) || !(v > 0)) {
        throw new RangeError("presplit: " + name + " must be a positive number, not " + v);
    }
    return v;
}

/**
 * Workman & Calder Figure 1, the plotted points: specific gravity → N (×10⁻³).
 * Read off the figure (±0.01×10⁻³); the curve is drawn through these points.
 */
export var CALDER_N_POINTS = [
    [0.8, 2.53], [1.0, 2.09], [1.2, 1.79], [1.4, 1.56], [1.6, 1.37], [1.8, 1.20], [2.0, 1.07]
];

/**
 * Calder's density factor N for Pb = N·ρ·D² (psi, ρ g/cm³, D ft/s), linear
 * between the plotted points of Workman & Calder Figure 1. The figure covers
 * 0.8 to 2.0 g/cm³ only.
 * @param {number} densityGcc
 * @returns {number} N
 */
export function calderNFactor(densityGcc) {
    var r = positive(densityGcc, "densityGcc");
    var P = CALDER_N_POINTS;
    if (r < P[0][0] - 1e-9 || r > P[P.length - 1][0] + 1e-9) {
        throw new RangeError("presplit: Calder's N is plotted for densities 0.8 to 2.0 g/cm³, not " + r);
    }
    for (var i = 1; i < P.length; i++) {
        if (r <= P[i][0] + 1e-12) {
            var t = (r - P[i - 1][0]) / (P[i][0] - P[i - 1][0]);
            return (P[i - 1][1] + t * (P[i][1] - P[i - 1][1])) * 1e-3;
        }
    }
    return P[P.length - 1][1] * 1e-3;
}

/**
 * Calder's coupled borehole pressure Pb = N·ρ·D².
 * @param {number} densityGcc
 * @param {number} vodMs
 * @returns {number} MPa
 */
export function calderCoupledPressureMPa(densityGcc, vodMs) {
    var dFt = positive(vodMs, "vodMs") * FT_PER_M;
    return psiToMpa(calderNFactor(densityGcc) * densityGcc * dFt * dFt);
}

/**
 * Calder's decoupled borehole pressure Pb·(√C·rc/rh)^2.4.
 * @param {{holeDiamMm:number, chargeDiamMm:number, densityGcc:number, vodMs:number,
 *   chargeFraction?:number}} p - chargeFraction is C, the part of the column loaded
 * @returns {number} MPa
 */
export function calderWallPressureMPa(p) {
    var C = p.chargeFraction === undefined ? 1 : p.chargeFraction;
    if (!(C > 0 && C <= 1)) throw new RangeError("presplit: chargeFraction must be in (0, 1], not " + C);
    var cr = Math.sqrt(C) * positive(p.chargeDiamMm, "chargeDiamMm") / positive(p.holeDiamMm, "holeDiamMm");
    return calderCoupledPressureMPa(p.densityGcc, p.vodMs) * Math.pow(cr, 2.4);
}

/**
 * The distributed charge diameter that gives a target decoupled pressure
 * (C.R. = (Ptarget/Pb)^(1/2.4), rc = C.R.·rh/√C).
 * @param {{holeDiamMm:number, densityGcc:number, vodMs:number,
 *   targetPressureMPa:number, chargeFraction?:number}} p
 * @returns {number} mm (can exceed the hole: then even full coupling is short of the target)
 */
export function calderChargeDiameterMm(p) {
    var C = p.chargeFraction === undefined ? 1 : p.chargeFraction;
    var cr = Math.pow(positive(p.targetPressureMPa, "targetPressureMPa") / calderCoupledPressureMPa(p.densityGcc, p.vodMs), 1 / 2.4);
    return cr * positive(p.holeDiamMm, "holeDiamMm") / Math.sqrt(C);
}

/**
 * Workman & Calder's bottom charge for a large-hole presplit: the weight of the
 * distributed decoupled charge that would give the target pressure over the
 * loadable length, placed instead as one charge in the bottom of the hole.
 * Their experience: up to about 90 kg (200 lb) does little damage; over about
 * 135 kg (300 lb) expect problems, and split the charge into two decks.
 * @param {{holeDiamMm:number, holeDepthM:number, densityGcc:number, vodMs:number,
 *   targetPressureMPa:number, unloadedTopM?:number}} p - unloadedTopM defaults to 10 ft
 * @returns {{chargeDiamMm:number, loadKgPerM:number, loadedLengthM:number, chargeKg:number}}
 */
export function calderBottomChargeKg(p) {
    var top = p.unloadedTopM === undefined ? 10 / FT_PER_M : p.unloadedTopM;
    var h = positive(p.holeDepthM, "holeDepthM") - top;
    if (!(h > 0)) throw new RangeError("presplit: the hole is no deeper than its unloaded collar");
    var dc = calderChargeDiameterMm(p);
    var load = Math.PI / 4 * Math.pow(dc / 1000, 2) * p.densityGcc * 1000;
    return { chargeDiamMm: dc, loadKgPerM: load, loadedLengthM: h, chargeKg: load * h };
}
