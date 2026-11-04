/**
 * Presplit.js — Presplit borehole pressures and spacing (Konya), detonation
 * pressure, and shock transmission across a decoupling gap
 *
 * Author: Brent Buffham — blastingapps.com & kirra-design.com
 * License: MIT
 *
 * UNITS (library side): hole and charge diameters in mm, spacing in m, linear
 * charge in g/m, pressure in MPa, Young's modulus in GPa, density in g/cm³,
 * VOD in m/s. Konya's equations are published in US units (psi, ft, inches,
 * grains per foot); they are evaluated in those units inside and converted.
 *
 * HOW A PRESPLIT WORKS (Konya & Konya 2020; Kutter & Fairhurst, "The roles of
 * stress wave and gas pressure in presplitting")
 *   The shock from a decoupled charge barely reaches the rock: crossing
 *   explosive → air → rock passes ~0.00001 % of it (shockTransmission). The
 *   split is made by the quasi-static GAS pressure in the hole, which sets up a
 *   hoop (tangential) tension between neighbouring holes. So a presplit is
 *   designed from the borehole gas pressure, compared against the pressure the
 *   rock needs at that spacing.
 *
 *   delivered   Pg = (105.6·EL − 5488) / dh²                  psi, EL gr/ft, dh in
 *               (Konya, Konya & Worsey, Empirical Model, Eq 5; PETN, decoupling > 3)
 *   required    P  = 2.8×10⁷ · (S / K)²                        psi, S ft
 *               K  = (40579 / E)^0.625                         E in GPa
 *               (Konya & Konya 2020, Eqs 5–6; advised for S ≥ 0.61 m)
 *   max spacing S  = K · √(Pg / 2.8×10⁷)                        (where they meet)
 *
 * SOURCES
 *  Konya, A., Konya, C. & Worsey, P. Determination of Presplit Borehole
 *    Pressure. ISEE. Eqs 1, 3–5, 8.
 *  Konya, A. & Konya, C. (2020) Presplit Design Based on Borehole Pressures.
 *    ISEE 2020g. Eqs 1–6.
 *  Cooper, P. (1996) Explosives Engineering. VCH. (C-J pressure ρD²/4.)
 */

var PSI_PER_MPA = 1 / 0.006894757293168;
var FT_PER_M = 1 / 0.3048;
var IN_PER_MM = 1 / 25.4;
var GRAINS_PER_GRAM = 1 / 0.06479891;
var KONYA_C = 2.8e7;      // psi, Eq 5 (2020)
var KONYA_E_REF = 40579;  // Eq 6 (2020)

function positive(v, name) {
    if (typeof v !== "number" || !isFinite(v) || !(v > 0)) {
        throw new RangeError("presplit: " + name + " must be a positive number, not " + v);
    }
    return v;
}

/** MPa → psi. */
export function mpaToPsi(mpa) { return mpa * PSI_PER_MPA; }
/** psi → MPa. */
export function psiToMpa(psi) { return psi / PSI_PER_MPA; }

/**
 * Linear charge in grains per foot (the unit of Konya's equations) from g/m.
 * 1 g/m = 0.3048 / 0.06479891 gr/ft = 4.7038 gr/ft.
 * @param {number} gPerM
 * @returns {number} gr/ft
 */
export function gramsPerMetreToGrainsPerFoot(gPerM) {
    return gPerM * GRAINS_PER_GRAM * 0.3048;
}

/**
 * Decoupling ratio: hole diameter over charge diameter.
 * @param {number} holeDiamMm
 * @param {number} chargeDiamMm
 * @returns {number}
 */
export function decouplingRatio(holeDiamMm, chargeDiamMm) {
    return positive(holeDiamMm, "holeDiamMm") / positive(chargeDiamMm, "chargeDiamMm");
}

/**
 * Chapman-Jouguet (detonation) pressure, the simplified form P = ρ·D²/4
 * (Cooper 1996; Konya & Konya 2020 Eq 3). ρ in g/cm³ and D in km/s give GPa.
 * @param {number} densityGcc
 * @param {number} vodMs
 * @returns {number} MPa
 */
export function detonationPressureMPa(densityGcc, vodMs) {
    var d = positive(vodMs, "vodMs") / 1000;
    return positive(densityGcc, "densityGcc") * d * d / 4 * 1000;
}

/**
 * Acoustic impedance Z = ρ · V.
 * @param {number} densityKgM3
 * @param {number} velocityMs - sound speed, or VOD for an explosive
 * @returns {number} kg/(m²·s)
 */
export function acousticImpedance(densityKgM3, velocityMs) {
    return densityKgM3 * velocityMs;
}

/**
 * Fraction of a shock passed from one medium into the next:
 * I = 4·Z1·Z2 / (Z1 + Z2)²  (Konya & Konya 2020, Eq 2). Chain the stages
 * (explosive → air → rock) by multiplying.
 * @param {number} z1 - impedance of the medium the shock leaves
 * @param {number} z2 - impedance of the medium it enters
 * @returns {number} 0 … 1
 */
export function shockTransmission(z1, z2) {
    positive(z1, "z1"); positive(z2, "z2");
    return 4 * z1 * z2 / ((z1 + z2) * (z1 + z2));
}

/**
 * Konya presplit factor K = (40579 / E)^0.625, E in GPa (Konya & Konya 2020, Eq 6).
 * Stiffer rock has a smaller K and needs more pressure at a given spacing.
 * @param {number} youngsModulusGPa
 * @returns {number} K
 */
export function konyaPresplitFactor(youngsModulusGPa) {
    return Math.pow(KONYA_E_REF / positive(youngsModulusGPa, "youngsModulusGPa"), 0.625);
}

/**
 * Borehole pressure needed to split rock at a spacing:
 * P [psi] = 2.8×10⁷ · (S [ft] / K)²  (Konya & Konya 2020, Eq 5). The authors
 * advise it for spacings of 0.61 m (2 ft) and over; it overestimates closer in,
 * most of all in weak rock.
 * @param {number} spacingM
 * @param {number} youngsModulusGPa
 * @returns {number} MPa
 */
export function konyaRequiredPressureMPa(spacingM, youngsModulusGPa) {
    var sFt = positive(spacingM, "spacingM") * FT_PER_M;
    var K = konyaPresplitFactor(youngsModulusGPa);
    return psiToMpa(KONYA_C * (sFt / K) * (sFt / K));
}

/**
 * The widest spacing a borehole pressure can split (inverse of
 * konyaRequiredPressureMPa): S [ft] = K · √(P [psi] / 2.8×10⁷).
 * @param {number} pressureMPa
 * @param {number} youngsModulusGPa
 * @returns {number} m (0 for no pressure)
 */
export function konyaMaxSpacingM(pressureMPa, youngsModulusGPa) {
    if (!(pressureMPa > 0)) return 0;
    var K = konyaPresplitFactor(youngsModulusGPa);
    return K * Math.sqrt(mpaToPsi(pressureMPa) / KONYA_C) / FT_PER_M;
}

/**
 * Gas pressure in a decoupled hole from detonating cord — Konya, Konya & Worsey's
 * Empirical Model, Eq 5: Pg [psi] = (105.6 · EL [gr/ft] − 5488) / dh [in]².
 * Fitted to PETN charges in a borehole simulator (average error ±8.8 %); valid
 * for PETN at decoupling ratios over 3. At dh = 2 in it is their Eq 1,
 * P = 26.4·EL − 1372 (Konya & Konya 2020, Eq 4).
 * @param {number} loadGPerM - linear charge, g/m
 * @param {number} holeDiamMm
 * @returns {number} MPa (can be ≤ 0 for very light loads: below the fitted range)
 */
export function konyaEmpiricalPressureMPa(loadGPerM, holeDiamMm) {
    var el = gramsPerMetreToGrainsPerFoot(positive(loadGPerM, "loadGPerM"));
    var dIn = positive(holeDiamMm, "holeDiamMm") * IN_PER_MM;
    return psiToMpa((105.6 * el - 5488) / (dIn * dIn));
}

/**
 * Konya, Konya & Worsey's Detonation Pressure Model, Eq 8, for explosives other
 * than PETN at large decoupling: Pg [psi] = 2.91 · EL [gr/ft] · P_T [psi] /
 * (ρ [g/cm³] · dh [in]²), with P_T the explosive's gas pressure from the Taylor
 * equation of state (their Eq 7), which the caller supplies.
 * @param {number} loadGPerM
 * @param {number} holeDiamMm
 * @param {number} densityGcc
 * @param {number} taylorPressureMPa - P_T
 * @returns {number} MPa
 */
export function konyaDetonationModelPressureMPa(loadGPerM, holeDiamMm, densityGcc, taylorPressureMPa) {
    var el = gramsPerMetreToGrainsPerFoot(positive(loadGPerM, "loadGPerM"));
    var dIn = positive(holeDiamMm, "holeDiamMm") * IN_PER_MM;
    var pt = mpaToPsi(positive(taylorPressureMPa, "taylorPressureMPa"));
    return psiToMpa(2.91 * el * pt / (positive(densityGcc, "densityGcc") * dIn * dIn));
}
