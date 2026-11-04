/**
 * WallPressure.js — Borehole wall pressure of a decoupled charge, by each
 * published method, and the force-balance presplit spacing
 *
 * Author: Brent Buffham — blastingapps.com & kirra-design.com
 * License: MIT
 *
 * A decoupled charge's gases expand into the air around it before they load the
 * wall, so the wall sees far less than the explosion pressure. The methods
 * differ in how they treat that expansion (Hustrulid 2007 reviews them all):
 *
 *   explosion pressure    Pe = ρe·D²/8                         Hustrulid Eq 31
 *   ideal gas (Niagara)   Pw = Pe·(Ve/Vh)                      Eq 42 (Niagara Power Project)
 *   adiabatic (Sanden)    Pw = Pe·(re·√w / rh)^(2γ), 2γ = 2.4  Eqs 47, 54 (Sanden 1974)
 *   co-volume (Hino)      Pw = Pe·(υe − αe)/(υh − αh),
 *                         α = 0.92·(1 − 1.07·e^(−1.39υ))       Eqs 41, 43 (Hino 1959)
 *   isothermal co-volume  Pw = Pe·ae / a,  a = υ − 1.1·e^(−0.473/υ)
 *   (Utah/NIOSH)          υe = 1/ρe, υ = VR·υe, VR = (1/w)(dh/dc)²   Eqs 55–72 (Hustrulid 2007)
 *
 *   spacing (force balance)  S = dh·(Pw + T)/T                 Eq 30 (Sanden 1974)
 *
 * Ve/Vh = w·(dc/dh)², w = charged length / hole length (1 for a continuous
 * column). Hustrulid argues the expansion is isothermal, so the adiabatic
 * exponent of Sanden (from Bauer's SPHERE tests) is not right for cylinders;
 * all four are kept so they can be compared.
 *
 * UNITS: diameters in mm, density g/cm³, VOD m/s, pressures MPa, specific
 * volumes l/kg (= 1/ρ in g/cm³).
 *
 * SOURCES (keys are brentbuffham/blasting-knowledge references.bib)
 *  [hustrulid2007presplit] Hustrulid, W.A. (2007) A practical, yet technically sound, design procedure
 *    for pre-split blasts. Proc. 33rd ISEE Annual Conference, Nashville, Vol 1, 1–26.
 *  Sanden, B.H. (1974) Queen's University MSc thesis (via Hustrulid 2007).
 *  Hino, K. (1959) (via Hustrulid 2007, Eqs 38–43 and Table 1).
 */

function positive(v, name) {
    if (typeof v !== "number" || !isFinite(v) || !(v > 0)) {
        throw new RangeError("presplit: " + name + " must be a positive number, not " + v);
    }
    return v;
}

function fraction(w) {
    if (w === undefined) return 1;
    if (!(w > 0 && w <= 1)) throw new RangeError("presplit: chargeFraction must be in (0, 1], not " + w);
    return w;
}

/**
 * Explosion pressure Pe = ρe·D²/8 (Hustrulid Eq 31; ρ in kg/m³ and D in km/s give MPa).
 * Half the C-J pressure ρD²/4. It is the wall pressure of a fully coupled charge.
 * @param {number} densityGcc
 * @param {number} vodMs
 * @returns {number} MPa
 */
export function explosionPressureMPa(densityGcc, vodMs) {
    var d = positive(vodMs, "vodMs") / 1000;
    return positive(densityGcc, "densityGcc") * 1000 * d * d / 8;
}

/**
 * Diameter of a continuous charge from its linear charge and density, e.g. the
 * PETN core of detonating cord (Hustrulid p8: π/4·dc²·ρe = load).
 * @param {number} loadGPerM
 * @param {number} densityGcc
 * @returns {number} mm
 */
export function chargeDiameterFromLoadMm(loadGPerM, densityGcc) {
    // g/m = π/4 · d[cm]² · ρ[g/cm³] · 100 cm/m
    var dCm = Math.sqrt(4 * positive(loadGPerM, "loadGPerM") / (Math.PI * positive(densityGcc, "densityGcc") * 100));
    return dCm * 10;
}

/**
 * Hole volume over explosive volume per length of hole:
 * VR = (1/w)·(dh/dc)² (Hustrulid Eqs 67, 72).
 * @param {number} holeDiamMm
 * @param {number} chargeDiamMm
 * @param {number} [chargeFraction=1] - w, charged length / hole length
 * @returns {number}
 */
export function volumeRatio(holeDiamMm, chargeDiamMm, chargeFraction) {
    var r = positive(holeDiamMm, "holeDiamMm") / positive(chargeDiamMm, "chargeDiamMm");
    return r * r / fraction(chargeFraction);
}

/**
 * Hustrulid's co-volume fit α = 1.1·e^(−0.473/υ) (Eq 55; fitted for υ of
 * 0.4 to 1.5 l/kg, the range of commercial explosives).
 * @param {number} specificVolume - υ, l/kg
 * @returns {number} α, l/kg
 */
export function hustrulidCovolume(specificVolume) {
    return 1.1 * Math.exp(-0.473 / positive(specificVolume, "specificVolume"));
}

/**
 * Hino's co-volume fit α = 0.92·(1 − 1.07·e^(−1.39υ)) (Hustrulid Eq 43).
 * @param {number} specificVolume - υ, l/kg
 * @returns {number} α, l/kg
 */
export function hinoCovolume(specificVolume) {
    return 0.92 * (1 - 1.07 * Math.exp(-1.39 * positive(specificVolume, "specificVolume")));
}

function common(p) {
    var Pe = p.explosionPressureMPa !== undefined ? positive(p.explosionPressureMPa, "explosionPressureMPa")
        : explosionPressureMPa(p.densityGcc, p.vodMs);
    return { Pe: Pe, VR: volumeRatio(p.holeDiamMm, p.chargeDiamMm, p.chargeFraction) };
}

/**
 * Ideal-gas wall pressure Pw = Pe·Ve/Vh (Niagara Power Project; Hustrulid Eq 42).
 * @param {{holeDiamMm:number, chargeDiamMm:number, densityGcc?:number, vodMs?:number,
 *   explosionPressureMPa?:number, chargeFraction?:number}} p
 * @returns {number} MPa
 */
export function idealGasWallPressureMPa(p) {
    var c = common(p);
    return c.Pe / c.VR;
}

/**
 * Adiabatic wall pressure Pw = Pe·(Ve/Vh)^γ = Pe·(re·√w / rh)^(2γ) (Sanden 1974;
 * Hustrulid Eqs 46–54). Sanden took 2γ = 2.4.
 * @param {Object} p - as idealGasWallPressureMPa, plus exponent2Gamma (default 2.4)
 * @returns {number} MPa
 */
export function adiabaticWallPressureMPa(p) {
    var c = common(p);
    var twoGamma = p.exponent2Gamma === undefined ? 2.4 : positive(p.exponent2Gamma, "exponent2Gamma");
    return c.Pe * Math.pow(1 / c.VR, twoGamma / 2);
}

/**
 * Co-volume wall pressure with Hino's α (Hustrulid Eqs 41 and 43):
 * Pw = Pe·(υe − αe)/(υh − αh), υe = 1/ρe, υh = VR·υe.
 * @param {Object} p - as idealGasWallPressureMPa; densityGcc is required (it sets υe)
 * @returns {number} MPa
 */
export function hinoWallPressureMPa(p) {
    var c = common(p);
    var ve = 1 / positive(p.densityGcc, "densityGcc");
    var vh = c.VR * ve;
    return c.Pe * (ve - hinoCovolume(ve)) / (vh - hinoCovolume(vh));
}

/**
 * Isothermal co-volume wall pressure, the Utah/NIOSH method (Hustrulid 2007,
 * Eqs 59–72): Ko = Pe·ae, Pw = Ko/a, a = υ − 1.1·e^(−0.473/υ), υ = VR·υe.
 * @param {Object} p - as idealGasWallPressureMPa; densityGcc is required
 * @returns {number} MPa
 */
export function isothermalWallPressureMPa(p) {
    var c = common(p);
    var ve = 1 / positive(p.densityGcc, "densityGcc");
    var v = c.VR * ve;
    return c.Pe * (ve - hustrulidCovolume(ve)) / (v - hustrulidCovolume(v));
}

/**
 * Force-balance presplit spacing S = dh·(Pw + T)/T (Sanden 1974; Hustrulid Eq 30).
 * With Pw = C (the compressive strength, the highest wall pressure that does
 * not crush) it is Eq 30a, S = dh·(C/T + 1).
 * @param {number} holeDiamMm
 * @param {number} wallPressureMPa
 * @param {number} tensileMPa - rock tensile strength T
 * @returns {number} m
 */
export function forceBalanceSpacingM(holeDiamMm, wallPressureMPa, tensileMPa) {
    var T = positive(tensileMPa, "tensileMPa");
    return positive(holeDiamMm, "holeDiamMm") / 1000 * (wallPressureMPa + T) / T;
}

/**
 * The tension a wall pressure puts across the web at a spacing (Eq 30 solved
 * for T): T = Pw / (S/dh − 1). Compare with the rock's tensile strength: the
 * web splits when this is the larger.
 * @param {number} holeDiamMm
 * @param {number} wallPressureMPa
 * @param {number} spacingM
 * @returns {number} MPa
 */
export function webTensionMPa(holeDiamMm, wallPressureMPa, spacingM) {
    var ratio = positive(spacingM, "spacingM") * 1000 / positive(holeDiamMm, "holeDiamMm");
    if (!(ratio > 1)) return Infinity;
    return wallPressureMPa / (ratio - 1);
}
