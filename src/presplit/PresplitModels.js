/**
 * PresplitModels.js — Every published presplit method, side by side
 *
 * Author: Brent Buffham — blastingapps.com & kirra-design.com
 * License: MIT
 *
 * One design, every model. Each model gives the borehole wall pressure and the
 * widest spacing it would split, says whether the design is inside the range it
 * was fitted or derived for, and (when a spacing is given) whether that spacing
 * splits. The summary is taken over the models that apply.
 *
 *   konya-empirical      Konya, Konya & Worsey Empirical Model (PETN cord, decoupling > 3)
 *                        against Konya & Konya (2020) required pressure from E
 *   niagara-ideal-gas    Pw = Pe·Ve/Vh (Niagara Power Project, via Hustrulid 2007)
 *   sanden-adiabatic     Pw = Pe·(Ve/Vh)^γ, 2γ = 2.4 (Sanden 1974, via Hustrulid 2007)
 *   hino-covolume        co-volume, Hino's α (Hino 1959, via Hustrulid 2007)
 *   hustrulid-isothermal co-volume, Hustrulid's α (Utah/NIOSH, Hustrulid 2007)
 *   calder-canmet        Pw = N(ρ)·ρD²·(√C·rc/rh)^2.4 (Calder 1977, via Workman & Calder 1991)
 *   chiappetta-plane     0.1 lb/ft² of presplit plane: S = load / 0.488 kg/m² (Chiappetta 1990, II)
 *   chiappetta-field     field-test spacing range for a tabulated hole size (Chiappetta 1990, III)
 *
 * The gas-pressure models (ideal gas to Calder) share Sanden's force-balance spacing S = dh·(Pw + T)/T and are
 * checked against the compressive strength (a wall pressure over C crushes the
 * wall). Konya's model has its own spacing law from Young's modulus. The two
 * Chiappetta rules are empirical and give a spacing without a pressure.
 *
 * Berta (1990) is not here yet: its specific pressure needs the primary source.
 */

import { chiappettaPlaneSpacingM, chiappettaFieldRow, CHIAPPETTA_PLANE_MAX_HOLE_MM } from "./Chiappetta.js";
import { calderWallPressureMPa } from "./WorkmanCalder.js";
import { decouplingRatio, konyaEmpiricalPressureMPa, konyaRequiredPressureMPa, konyaMaxSpacingM } from "./Presplit.js";
import { explosionPressureMPa, chargeDiameterFromLoadMm, volumeRatio, idealGasWallPressureMPa,
    adiabaticWallPressureMPa, hinoWallPressureMPa, isothermalWallPressureMPa, forceBalanceSpacingM,
    webTensionMPa } from "./WallPressure.js";

// key hustrulid2007presplit (brentbuffham/blasting-knowledge references.bib)
var C90 = "Chiappetta, R.F. (1990) Presplitting and controlled blasting techniques. 2nd High-Tech Seminar, Orlando, ISEE, Section 14";
// key workman1991largehole
var WC91 = "Workman, J.L. & Calder, P.N. (1991) A method for calculating the weight of charge to use in large hole pre-splitting for cast blasting operations. 17th ISEE Conf., Vol 2, 97–105";
var H07 = "Hustrulid, W.A. (2007) A practical, yet technically sound, design procedure for pre-split blasts. 33rd ISEE Conf., Vol 1, 1–26";

export var PRESPLIT_MODELS = [
    { id: "konya-empirical", label: "Konya empirical (PETN cord)",
      citation: "Konya, Konya & Worsey, Determination of Presplit Borehole Pressure (ISEE), Eq 5; Konya & Konya (2020), Presplit Design Based on Borehole Pressures (ISEE 2020g), Eqs 5–6" },
    { id: "niagara-ideal-gas", label: "Ideal gas (Niagara)", citation: "Niagara Power Project (Paine, Holmes & Clark 1961), via " + H07 + ", Eq 42" },
    { id: "sanden-adiabatic", label: "Adiabatic (Sanden)", citation: "Sanden (1974), via " + H07 + ", Eqs 47–54; the same form is " + C90 + ", Method I" },
    { id: "hino-covolume", label: "Co-volume (Hino)", citation: "Hino (1959), via " + H07 + ", Eqs 41, 43" },
    { id: "hustrulid-isothermal", label: "Isothermal co-volume (Utah/NIOSH)", citation: H07 + ", Eqs 55–72" },
    { id: "calder-canmet", label: "Adiabatic, density-dependent N (Calder/CANMET)", citation: "Calder (1977) CANMET Pit Slope Manual Ch 7, via " + WC91 + ", pp99–102 and Fig 1" },
    { id: "chiappetta-plane", label: "Plane charge 0.1 lb/ft² (Chiappetta II)", citation: C90 + ", Method II" },
    { id: "chiappetta-field", label: "Field-test table (Chiappetta III)", citation: C90 + ", Method III" }
];

function median(xs) {
    var s = xs.slice().sort(function (a, b) { return a - b; });
    var m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Run every presplit model on one design.
 *
 * @param {Object} d
 * @param {number} d.holeDiamMm
 * @param {number} [d.chargeDiamMm] - charge (or cord core) diameter; else from loadGPerM and densityGcc
 * @param {number} [d.loadGPerM] - linear charge; else from chargeDiamMm and densityGcc
 * @param {number} d.densityGcc - explosive density
 * @param {number} d.vodMs
 * @param {number} [d.chargeFraction=1] - charged length / hole length (air decks)
 * @param {boolean} [d.petnCord=false] - the charge is PETN detonating cord (Konya's empirical domain)
 * @param {number} [d.tensileMPa] - rock tensile strength T (gas-expansion models' spacing)
 * @param {number} [d.compressiveMPa] - rock compressive strength C (crushing check)
 * @param {number} [d.youngsModulusGPa] - rock E (Konya)
 * @param {number} [d.spacingM] - a spacing to judge
 * @param {number} [d.exponent2Gamma=2.4] - Sanden's 2γ
 * @returns {{design:Object, models:Array<Object>, summary:Object}}
 *   models[i]: { id, label, citation, wallPressureMPa, maxSpacingM, applicable, notes: string[],
 *   crushes: boolean|null, splits: boolean|null }. summary: { count, minSpacingM, medianSpacingM,
 *   maxSpacingM, splitsVotes } over the applicable models with a spacing.
 */
export function runPresplitModels(d) {
    var rho = d.densityGcc;
    var dc = d.chargeDiamMm !== undefined ? d.chargeDiamMm : chargeDiameterFromLoadMm(d.loadGPerM, rho);
    var load = d.loadGPerM !== undefined ? d.loadGPerM : Math.PI / 4 * Math.pow(dc / 10, 2) * rho * 100;
    var w = d.chargeFraction === undefined ? 1 : d.chargeFraction;
    var decoupling = decouplingRatio(d.holeDiamMm, dc);
    var Pe = explosionPressureMPa(rho, d.vodMs);
    var VR = volumeRatio(d.holeDiamMm, dc, w);
    var p = { holeDiamMm: d.holeDiamMm, chargeDiamMm: dc, densityGcc: rho, vodMs: d.vodMs, chargeFraction: w, exponent2Gamma: d.exponent2Gamma };
    var T = d.tensileMPa, C = d.compressiveMPa, E = d.youngsModulusGPa;

    function gasModel(meta, Pw, extraNotes) {
        var notes = (extraNotes || []).slice();
        var applicable = true;
        if (!(T > 0)) { notes.push("needs the rock tensile strength for a spacing"); }
        var crushes = C > 0 ? Pw > C : null;
        if (crushes) notes.push("wall pressure " + Pw.toFixed(0) + " MPa is over the compressive strength " + C + " MPa: the wall would crush");
        var maxS = T > 0 ? forceBalanceSpacingM(d.holeDiamMm, Pw, T) : null;
        var splits = d.spacingM > 0 && T > 0 ? webTensionMPa(d.holeDiamMm, Pw, d.spacingM) >= T : null;
        return Object.assign({}, meta, { wallPressureMPa: Pw, maxSpacingM: maxS, applicable: applicable, notes: notes, crushes: crushes, splits: splits });
    }

    var models = [];
    // Konya
    var kNotes = [], kApplicable = true;
    if (!d.petnCord) { kApplicable = false; kNotes.push("fitted to PETN detonating cord only"); }
    if (!(decoupling > 3)) { kApplicable = false; kNotes.push("needs a decoupling ratio over 3 (here " + decoupling.toFixed(1) + ")"); }
    if (w < 1) kNotes.push("fitted to continuous cord; the charge fraction is not in the model");
    var Pg = konyaEmpiricalPressureMPa(load, d.holeDiamMm);
    if (!(Pg > 0)) { kApplicable = false; kNotes.push("load below the fitted range (pressure ≤ 0)"); }
    if (!(E > 0)) kNotes.push("needs Young's modulus for a spacing");
    if (d.spacingM > 0 && d.spacingM < 0.61) kNotes.push("the required-pressure law is advised for spacings of 0.61 m and over");
    models.push(Object.assign({}, PRESPLIT_MODELS[0], {
        wallPressureMPa: Pg,
        maxSpacingM: E > 0 && Pg > 0 ? konyaMaxSpacingM(Pg, E) : null,
        applicable: kApplicable, notes: kNotes,
        crushes: C > 0 ? Pg > C : null,
        splits: d.spacingM > 0 && E > 0 && Pg > 0 ? Pg >= konyaRequiredPressureMPa(d.spacingM, E) : null
    }));

    var veNote = rho < 1 / 1.5 || rho > 1 / 0.4 ? ["explosive density outside the co-volume fit (0.67–2.5 g/cm³)"] : [];
    models.push(gasModel(PRESPLIT_MODELS[1], idealGasWallPressureMPa(p), ["ideal gas: overestimates at small volume ratios (Hustrulid 2007)"]));
    models.push(gasModel(PRESPLIT_MODELS[2], adiabaticWallPressureMPa(p), ["Hustrulid (2007) finds the adiabatic 2γ = 2.4 (from sphere tests) not right for cylindrical charges"]));
    models.push(gasModel(PRESPLIT_MODELS[3], hinoWallPressureMPa(p), veNote));
    models.push(gasModel(PRESPLIT_MODELS[4], isothermalWallPressureMPa(p), veNote));

    // Calder (CANMET): N is plotted for 0.8–2.0 g/cm³ only
    if (rho >= 0.8 && rho <= 2.0) {
        models.push(gasModel(PRESPLIT_MODELS[5], calderWallPressureMPa(p), []));
    } else {
        models.push(Object.assign({}, PRESPLIT_MODELS[5], { wallPressureMPa: null, maxSpacingM: null, applicable: false,
            notes: ["Calder's N is plotted for explosive densities 0.8 to 2.0 g/cm³ only (here " + rho + ")"], crushes: null, splits: null }));
    }

    // Chiappetta II: the hole's average linear charge over the plane rule
    var avgLoadKgPerM = load / 1000 * w;
    var plNotes = ["empirical: charge per area of presplit plane, no rock properties"];
    var plApplicable = d.holeDiamMm <= CHIAPPETTA_PLANE_MAX_HOLE_MM + 1e-9;
    if (!plApplicable) plNotes.push("given for holes up to 6¾ in (171 mm)");
    var plS = chiappettaPlaneSpacingM(avgLoadKgPerM);
    models.push(Object.assign({}, PRESPLIT_MODELS[6], { wallPressureMPa: null, maxSpacingM: plS, applicable: plApplicable,
        notes: plNotes, crushes: null, splits: d.spacingM > 0 ? d.spacingM <= plS : null }));

    // Chiappetta III: tabulated hole sizes only
    var row = chiappettaFieldRow(d.holeDiamMm);
    var fNotes = ["empirical field results by hole size; the charge and rock are not in it"];
    if (row) fNotes.push("table row " + row.holeDiamIn + " in: " + (row.loadKgPerM * 1000).toFixed(0) + " g/m, spacing "
        + row.spacingM[0].toFixed(2) + "–" + row.spacingM[1].toFixed(2) + " m");
    else fNotes.push("hole size not in the table (1.5–8 in, tabulated sizes only)");
    models.push(Object.assign({}, PRESPLIT_MODELS[7], { wallPressureMPa: null, maxSpacingM: row ? row.spacingM[1] : null,
        minSpacingM: row ? row.spacingM[0] : null, applicable: !!row, notes: fNotes, crushes: null,
        splits: row && d.spacingM > 0 ? d.spacingM <= row.spacingM[1] : null }));

    var spacings = [], votes = { yes: 0, no: 0 };
    models.forEach(function (m) {
        if (!m.applicable) return;
        if (m.maxSpacingM > 0) spacings.push(m.maxSpacingM);
        if (m.splits === true) votes.yes++;
        if (m.splits === false) votes.no++;
    });
    return {
        design: { holeDiamMm: d.holeDiamMm, chargeDiamMm: dc, loadGPerM: load, decouplingRatio: decoupling,
            volumeRatio: VR, explosionPressureMPa: Pe, chargeFraction: w },
        models: models,
        summary: {
            count: spacings.length,
            minSpacingM: spacings.length ? Math.min.apply(null, spacings) : null,
            medianSpacingM: spacings.length ? median(spacings) : null,
            maxSpacingM: spacings.length ? Math.max.apply(null, spacings) : null,
            splitsVotes: votes
        }
    };
}
