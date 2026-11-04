/**
 * Berta.js — Berta's presplit spacing from the explosive's specific pressure,
 * and the empirical rules and table he gives beside it
 *
 * Author: Brent Buffham — blastingapps.com & kirra-design.com
 * License: MIT
 *
 * Berta (1990) balances the quasi-static gas pressure against the rock's
 * tensile resistance (formula III.1):
 *
 *   (Øc/Øf)² · (Lc/L) · Δc · Ps · Øf/(S − Øf) = σtr
 *
 *   S = Øf/(K·σtr) · Ps·Δc·(Lc/L)·(Øc/Øf)² + Øf
 *
 *   Øc, Øf  charge and hole diameter       Lc, L  charge and hole length
 *   Δc      explosive specific gravity       Ps     explosive specific pressure, MPa
 *   σtr     rock tensile resistance, "adjusted for adequate safety coefficient", MPa
 *   K       "release" coefficient for closely spaced cord holes in ornamental
 *           stone (notch effect), about 0.5; 1 otherwise (p402)
 *
 * The wall pressure Ps·Δc·(Lc/L)·(Øc/Øf)² is the ideal-gas expansion of the
 * gases into the hole (the Niagara form) with Ps·Δc in place of ρD²/8, and
 * the spacing is the same force balance as Sanden's. Ps·Δc is far lower than
 * ρD²/8: for Gelatina 1 (Ps 1007 MPa, Δ 1.45) it is 1460 MPa.
 *
 * Ps is a property of the explosive (Berta §2.4, p20); the caller supplies it.
 *
 * Beside it Berta gives the US empirical rules, citing Konya, Britton &
 * Lukovic (1984): S ≤ 10·Øf (III.2) and q = 0.815·S² kg/m, S in m (III.3);
 * with S = 10·Øf that is Konya's d²/28 lb/ft to 1 %. And Du Pont's table of
 * operational parameters (Table III.4).
 *
 * UNITS: diameters mm, lengths and spacing m, pressure MPa, linear charge kg/m.
 *
 * SOURCE (key in brentbuffham/blasting-knowledge references.bib)
 *  [berta1990explosives] Berta, G. (1990) Explosives: An Engineering Tool.
 *    Italesplosivi, Milano. §3.2 Presplitting pp96–107 (formula III.1 p103,
 *    rearranged p104; III.2, III.3 and Table III.4 p102); ornamental stone
 *    p402. Book page numbers.
 */

function positive(v, name) {
    if (typeof v !== "number" || !isFinite(v) || !(v > 0)) {
        throw new RangeError("presplit: " + name + " must be a positive number, not " + v);
    }
    return v;
}

/**
 * Berta's quasi-static wall pressure Ps·Δc·(Lc/L)·(Øc/Øf)².
 * @param {{holeDiamMm:number, chargeDiamMm:number, densityGcc:number,
 *   specificPressureMPa:number, chargeFraction?:number}} p - chargeFraction is Lc/L
 * @returns {number} MPa
 */
export function bertaWallPressureMPa(p) {
    var w = p.chargeFraction === undefined ? 1 : p.chargeFraction;
    if (!(w > 0 && w <= 1)) throw new RangeError("presplit: chargeFraction must be in (0, 1], not " + w);
    var r = positive(p.chargeDiamMm, "chargeDiamMm") / positive(p.holeDiamMm, "holeDiamMm");
    return positive(p.specificPressureMPa, "specificPressureMPa") * positive(p.densityGcc, "densityGcc") * w * r * r;
}

/**
 * Berta's spacing S = Øf·Pw/(K·σtr) + Øf (formula III.1 rearranged, p104).
 * With K = 1 it is the force balance dh·(Pw + T)/T.
 * @param {number} holeDiamMm
 * @param {number} wallPressureMPa - bertaWallPressureMPa
 * @param {number} tensileMPa - σtr, with whatever safety factor is wanted
 * @param {number} [releaseCoefficient=1] - K; about 0.5 for ornamental-stone cord holes
 * @returns {number} m
 */
export function bertaSpacingM(holeDiamMm, wallPressureMPa, tensileMPa, releaseCoefficient) {
    var K = releaseCoefficient === undefined ? 1 : positive(releaseCoefficient, "releaseCoefficient");
    var dh = positive(holeDiamMm, "holeDiamMm") / 1000;
    return dh * wallPressureMPa / (K * positive(tensileMPa, "tensileMPa")) + dh;
}

/**
 * US empirical spacing limit S ≤ 10·Øf (Berta III.2, after Konya, Britton &
 * Lukovic 1984).
 * @param {number} holeDiamMm
 * @returns {number} m
 */
export function presplitTenDiameterSpacingM(holeDiamMm) {
    return 10 * positive(holeDiamMm, "holeDiamMm") / 1000;
}

/**
 * US empirical linear charge q = 0.815·S² kg/m, S in m (Berta III.3, after
 * Konya, Britton & Lukovic 1984). With S = 10·Øf it is Konya's d²/28 lb/ft.
 * @param {number} spacingM
 * @returns {number} kg/m
 */
export function presplitLoadFromSpacingKgPerM(spacingM) {
    var s = positive(spacingM, "spacingM");
    return 0.815 * s * s;
}

/**
 * The spacing a linear charge serves by q = 0.815·S² (III.3 inverted).
 * @param {number} loadKgPerM
 * @returns {number} m
 */
export function presplitSpacingFromLoadM(loadKgPerM) {
    return Math.sqrt(positive(loadKgPerM, "loadKgPerM") / 0.815);
}

/**
 * Du Pont's operational parameters of presplitting shots, as Berta prints them
 * (Table III.4, p102): hole diameter range (mm), loading density (kg/m),
 * spacing (m).
 */
export var DUPONT_PRESPLIT_TABLE = [
    { holeDiamMm: [38, 44], loadKgPerM: [0.12, 0.38], spacingM: [0.30, 0.45] },
    { holeDiamMm: [51, 64], loadKgPerM: [0.12, 0.38], spacingM: [0.45, 0.60] },
    { holeDiamMm: [76, 89], loadKgPerM: [0.20, 0.75], spacingM: [0.45, 0.90] },
    { holeDiamMm: [102, 102], loadKgPerM: [0.38, 1.12], spacingM: [0.60, 1.20] }
];

/**
 * The Du Pont row for a hole diameter (within 2 mm of a printed range), or null.
 * @param {number} holeDiamMm
 * @returns {{holeDiamMm:number[], loadKgPerM:number[], spacingM:number[]}|null}
 */
export function dupontPresplitRow(holeDiamMm) {
    var d = positive(holeDiamMm, "holeDiamMm");
    for (var i = 0; i < DUPONT_PRESPLIT_TABLE.length; i++) {
        var r = DUPONT_PRESPLIT_TABLE[i];
        if (d >= r.holeDiamMm[0] - 2 && d <= r.holeDiamMm[1] + 2) return r;
    }
    return null;
}
