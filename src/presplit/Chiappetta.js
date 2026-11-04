/**
 * Chiappetta.js — Chiappetta's empirical presplit rules: the plane-area charge
 * rule, the field-test table, and the air-deck starting guidelines
 *
 * Author: Brent Buffham — blastingapps.com & kirra-design.com
 * License: MIT
 *
 * Chiappetta (1990) gives three presplit methods. Method I is Sanden's
 * adiabatic wall pressure with the force-balance spacing (already in
 * WallPressure.js as adiabaticWallPressureMPa and forceBalanceSpacingM; his
 * 1.69×10⁻³·ρ·D² psi with D in ft/s is ρD²/8 rounded). The other two, and the
 * air-deck guide, are empirical and are here:
 *
 *   Method II   load per length of column = 0.1 lb/ft² × spacing
 *               (0.1 lb per square foot of presplit plane; holes up to 6¾ in)
 *   Method III  a field-test table of load and spacing by hole diameter
 *   Air deck    spacing 1.7–2.0 × d, stemming 1.0–1.2 × d, burden 1.0 × d
 *               (d in inches gives feet), charge 0.08–0.12 lb/ft² of plane
 *
 * UNITS: hole diameter mm, spacing and lengths m, linear charge kg/m, charge
 * mass kg. The published US values are kept in the tables.
 *
 * SOURCE (key in brentbuffham/blasting-knowledge references.bib)
 *  [chiappetta1990presplit] Chiappetta, R.F. (1990) Presplitting and controlled
 *    blasting techniques. 2nd High-Tech Seminar, Blasting Technology,
 *    Instrumentation and Explosives Applications, Orlando, ISEE, Section 14.
 *    Method II p42, Method III p44, air deck pp48–50 (table from Chiappetta
 *    et al., 2nd FRAGBLAST, Keystone, 1987). Page numbers are the PDF's.
 */

var M_PER_FT = 0.3048;
var MM_PER_IN = 25.4;
var KG_PER_LB = 0.45359237;
/** 1 lb/ft² in kg/m². */
export var LB_PER_FT2_IN_KG_PER_M2 = KG_PER_LB / (M_PER_FT * M_PER_FT);
/** 1 lb/ft in kg/m. */
export var LB_PER_FT_IN_KG_PER_M = KG_PER_LB / M_PER_FT;

function positive(v, name) {
    if (typeof v !== "number" || !isFinite(v) || !(v > 0)) {
        throw new RangeError("presplit: " + name + " must be a positive number, not " + v);
    }
    return v;
}

/** Method II's plane charge, 0.1 lb/ft², in kg/m² (0.488). */
export var CHIAPPETTA_PLANE_CHARGE_KG_M2 = 0.1 * LB_PER_FT2_IN_KG_PER_M2;
/** Method II's largest hole, 6¾ in, in mm. */
export var CHIAPPETTA_PLANE_MAX_HOLE_MM = 6.75 * MM_PER_IN;

/**
 * Chiappetta Method II: linear charge for a spacing, at 0.1 lb per square foot
 * of presplit plane (p42). A 4 ft spacing takes 0.4 lb/ft.
 * @param {number} spacingM
 * @param {number} [planeChargeKgM2=0.488] - charge per area of the presplit plane
 * @returns {number} kg/m
 */
export function chiappettaPlaneLoadKgPerM(spacingM, planeChargeKgM2) {
    var q = planeChargeKgM2 === undefined ? CHIAPPETTA_PLANE_CHARGE_KG_M2 : positive(planeChargeKgM2, "planeChargeKgM2");
    return positive(spacingM, "spacingM") * q;
}

/**
 * Chiappetta Method II inverted: the spacing a linear charge serves at
 * 0.1 lb/ft² of plane.
 * @param {number} loadKgPerM
 * @param {number} [planeChargeKgM2=0.488]
 * @returns {number} m
 */
export function chiappettaPlaneSpacingM(loadKgPerM, planeChargeKgM2) {
    var q = planeChargeKgM2 === undefined ? CHIAPPETTA_PLANE_CHARGE_KG_M2 : positive(planeChargeKgM2, "planeChargeKgM2");
    return positive(loadKgPerM, "loadKgPerM") / q;
}

/**
 * Chiappetta Method III, "based on actual field testing" (p44), as printed:
 * hole diameter (in), explosive (lb/ft), spacing range (in).
 */
export var CHIAPPETTA_FIELD_TABLE = [
    { holeDiamIn: 1.5, loadLbPerFt: 0.08, spacingIn: [12, 18] },
    { holeDiamIn: 1.75, loadLbPerFt: 0.11, spacingIn: [12, 18] },
    { holeDiamIn: 2.0, loadLbPerFt: 0.17, spacingIn: [18, 24] },
    { holeDiamIn: 2.5, loadLbPerFt: 0.23, spacingIn: [24, 33] },
    { holeDiamIn: 3.0, loadLbPerFt: 0.34, spacingIn: [24, 36] },
    { holeDiamIn: 3.5, loadLbPerFt: 0.50, spacingIn: [24, 36] },
    { holeDiamIn: 4.0, loadLbPerFt: 0.60, spacingIn: [36, 48] },
    { holeDiamIn: 5.0, loadLbPerFt: 0.90, spacingIn: [36, 60] },
    { holeDiamIn: 6.0, loadLbPerFt: 1.30, spacingIn: [48, 72] },
    { holeDiamIn: 8.0, loadLbPerFt: 2.00, spacingIn: [60, 84] }
];

/**
 * The Method III row for a hole diameter, in SI. Only a tabulated diameter
 * (within the tolerance) has a row: the table is field results, so it is not
 * interpolated.
 * @param {number} holeDiamMm
 * @param {number} [tolerance=0.05] - relative match to a tabulated diameter
 * @returns {{holeDiamIn:number, holeDiamMm:number, loadKgPerM:number,
 *   spacingM:number[]}|null}
 */
export function chiappettaFieldRow(holeDiamMm, tolerance) {
    var dIn = positive(holeDiamMm, "holeDiamMm") / MM_PER_IN;
    var tol = tolerance === undefined ? 0.05 : tolerance;
    var best = null, bestErr = Infinity;
    CHIAPPETTA_FIELD_TABLE.forEach(function (r) {
        var e = Math.abs(dIn / r.holeDiamIn - 1);
        if (e < bestErr) { bestErr = e; best = r; }
    });
    if (!(bestErr <= tol)) return null;
    return {
        holeDiamIn: best.holeDiamIn,
        holeDiamMm: best.holeDiamIn * MM_PER_IN,
        loadKgPerM: best.loadLbPerFt * LB_PER_FT_IN_KG_PER_M,
        spacingM: [best.spacingIn[0] * MM_PER_IN / 1000, best.spacingIn[1] * MM_PER_IN / 1000]
    };
}

/**
 * Chiappetta's air-deck presplit starting guidelines (pp48–49): a short
 * bottom charge under a long air deck. Every length is a multiple of the hole
 * diameter in inches, read in feet. The charge per hole is 0.08–0.12 lb per
 * square foot of plane over the mean spacing and the hole depth, as in his
 * 9 in example. A starting point to tune on site.
 * @param {number} holeDiamMm
 * @param {number} holeDepthM
 * @returns {{spacingM:number[], stemmingM:number[], burdenM:number,
 *   chargeKg:number[], meanSpacingM:number}}
 *   burdenM is the distance from the presplit line to the last production row.
 */
export function chiappettaAirDeckGuide(holeDiamMm, holeDepthM) {
    var dIn = positive(holeDiamMm, "holeDiamMm") / MM_PER_IN;
    var H = positive(holeDepthM, "holeDepthM");
    var s = [1.7 * dIn * M_PER_FT, 2.0 * dIn * M_PER_FT];
    var mean = (s[0] + s[1]) / 2;
    var area = mean * H;
    return {
        spacingM: s,
        stemmingM: [1.0 * dIn * M_PER_FT, 1.2 * dIn * M_PER_FT],
        burdenM: 1.0 * dIn * M_PER_FT,
        meanSpacingM: mean,
        chargeKg: [0.08 * LB_PER_FT2_IN_KG_PER_M2 * area, 0.12 * LB_PER_FT2_IN_KG_PER_M2 * area]
    };
}
