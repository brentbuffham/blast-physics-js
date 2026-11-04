/**
 * BlastFragmentation.js — Hole-by-hole fragmentation for a whole blast
 *
 * Author: Brent Buffham — blastingapps.com & kirra-design.com
 * License: MIT
 *
 * Each production hole is predicted with its own burden, spacing, bench height,
 * diameter and charging (predictFragmentation). The blast's curve is the mixture
 * of the hole curves, weighted by the rock each hole breaks:
 *
 *   P_blast(x) = Σ Vᵢ · Pᵢ(x) / Σ Vᵢ,     Vᵢ = Bᵢ · Sᵢ · Hᵢ
 *
 * Inputs are not averaged: the P80 of a mixture is not the mean of the P80s, and
 * a few wide or light holes move the coarse end. The mixing is plain probability
 * (a mass-weighted blend of distributions); Kuz-Ram itself was calibrated on
 * blast-average designs, so a rock factor fitted hole by hole and one fitted to a
 * median design are not interchangeable.
 *
 * Takes parseKAP's output ({ holes, decks }). Per hole:
 *   Q  = Σ explosive deck mass (kg)          L  = Σ explosive deck length (m)
 *   H  = benchHeight, else collar Z − grade Z  B, S = the hole's burden and spacing
 *   d  = holeDiamMm                            RWS = mass-weighted over its products
 *   BCL = length of the bottom deck's product, CCL = the rest (Cunningham's two charges)
 * Holes that cannot be predicted are listed in `skipped` with the reason.
 */

import { predictFragmentation, fitRockFactorWith } from "./Fragmentation.js";

var MODEL_KEYS = ["kuzRam", "kco", "kckum"];

function dist(ax, ay, az, bx, by, bz) {
    var dx = bx - ax, dy = by - ay, dz = bz - az;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function rwsOf(deck, o) {
    if (o.rwsByProduct && deck.productName && o.rwsByProduct[deck.productName] > 0) return o.rwsByProduct[deck.productName];
    return o.rws > 0 ? o.rws : 100;
}

/**
 * The design of one hole for predictFragmentation, or the reason it has none.
 * @param {Object} hole - HoleEntry from parseKAP (burden, spacing, benchHeight, gradeZ, holeDiamMm)
 * @param {Object[]} decks - that hole's explosive DeckEntry list
 * @param {Object} o - predictBlastFragmentation options
 * @returns {{design:Object}|{reason:string}}
 */
export function holeFragmentationDesign(hole, decks, o) {
    if (!(hole.burden > 0) || !(hole.spacing > 0)) return { reason: "no burden or spacing on the hole" };
    var H = hole.benchHeight > 0 ? hole.benchHeight
        : (hole.gradeZ != null && isFinite(hole.gradeZ) ? hole.collarZ - hole.gradeZ : 0);
    if (!(H > 0)) return { reason: "no bench height (benchHeight or grade Z)" };
    if (!(hole.holeDiamMm > 0)) return { reason: "no hole diameter" };

    var Q = 0, L = 0, qRws = 0, bottom = null, bottomDepth = -Infinity;
    var lengthByProduct = {};
    for (var i = 0; i < decks.length; i++) {
        var dk = decks[i];
        var len = dist(dk.topX, dk.topY, dk.topZ, dk.baseX, dk.baseY, dk.baseZ);
        if (!(dk.mass > 0) || !(len > 0)) continue;
        Q += dk.mass;
        L += len;
        qRws += dk.mass * rwsOf(dk, o);
        var name = dk.productName || "";
        lengthByProduct[name] = (lengthByProduct[name] || 0) + len;
        var depth = dist(hole.collarX, hole.collarY, hole.collarZ, dk.baseX, dk.baseY, dk.baseZ);
        if (depth > bottomDepth) { bottomDepth = depth; bottom = name; }
    }
    if (!(Q > 0)) return { reason: "no explosive decks" };

    var A = typeof o.rockFactor === "function" ? o.rockFactor(hole) : o.rockFactor;
    if (!(A > 0)) return { reason: "no rock factor for the hole" };
    var bcl = lengthByProduct[bottom];
    return {
        design: {
            burden: hole.burden, spacing: hole.spacing, benchHeight: H, holeDiamMm: hole.holeDiamMm,
            chargeLength: L, chargeMass: Q, rws: qRws / Q, rockFactor: A,
            drillDeviation: o.drillDeviation || 0, staggered: !!o.staggered,
            bottomChargeLength: bcl, columnChargeLength: L - bcl
        }
    };
}

// Size where a mixture reaches P %: the mixture's percentile lies between its parts'
function mixtureSize(parts, weights, total, P, passing) {
    if (!(P > 0)) return 0;
    var lo = Infinity, hi = 0;
    for (var i = 0; i < parts.length; i++) {
        var s = parts[i].sizeAt(Math.min(P, 99.999999));
        if (s < lo) lo = s;
        if (s > hi) hi = s;
    }
    if (!(hi > lo)) return lo;
    var a = Math.log(lo), b = Math.log(hi);
    for (var it = 0; it < 200 && b - a > 1e-13; it++) {
        var m = 0.5 * (a + b);
        if (passing(Math.exp(m)) < P) a = m; else b = m;
    }
    return Math.exp(0.5 * (a + b));
}

function mixture(entries, key) {
    var parts = [], weights = [], total = 0;
    entries.forEach(function (e) {
        if (e.result[key]) { parts.push(e.result[key]); weights.push(e.volume); total += e.volume; }
    });
    if (!parts.length) return null;
    function passing(x) {
        var s = 0;
        for (var i = 0; i < parts.length; i++) s += weights[i] * parts[i].passing(x);
        return s / total;
    }
    return {
        holes: parts.length,
        passing: passing,
        sizeAt: function (P) { return mixtureSize(parts, weights, total, P, passing); }
    };
}

/**
 * Predict a blast hole by hole and mix the curves by rock volume.
 *
 * @param {{holes:Object[], decks:Object[]}} kap - parseKAP / parseKAPObjects output
 * @param {Object} options
 * @param {number|function(Object): number} options.rockFactor - A for every hole, or per hole
 * @param {number} [options.rws=100] - weight strength when a product is not in rwsByProduct
 * @param {Object<string, number>} [options.rwsByProduct] - RWS by deck productName
 * @param {number} [options.drillDeviation=0] - W, m
 * @param {boolean} [options.staggered=false]
 * @param {string[]} [options.holeTypes=["Production"]] - hole types to predict (case-insensitive)
 * @param {number} [options.xmax] - mm, every hole (default min(B, S) per hole)
 * @param {boolean} [options.spathis=false]
 * @returns {{holes:Array<{holeID:string, entityName:string, volume:number, design:Object, result:Object}>,
 *   skipped:Array<{holeID:string, entityName:string, reason:string}>,
 *   kuzRam:Object|null, kco:Object|null, kckum:Object|null,
 *   volume:number, chargeMass:number, powderFactor:number}}
 *   Each blast model is { holes, passing(mm) → %, sizeAt(%) → mm }, mixing the holes that
 *   have that model; null when none has.
 */
export function predictBlastFragmentation(kap, options) {
    var o = options || {};
    if (!(typeof o.rockFactor === "function" || o.rockFactor > 0)) {
        throw new RangeError("fragmentation: rockFactor must be a positive number or a function of the hole");
    }
    var types = (o.holeTypes || ["Production"]).map(function (t) { return String(t).toLowerCase(); });
    var decksByHole = {};
    (kap.decks || []).forEach(function (d) { (decksByHole[d.holeIndex] = decksByHole[d.holeIndex] || []).push(d); });

    var used = [], skipped = [], volume = 0, mass = 0;
    (kap.holes || []).forEach(function (hole, index) {
        var id = { holeID: hole.holeID, entityName: hole.entityName };
        if (types.indexOf(String(hole.holeType || "Production").toLowerCase()) < 0) {
            skipped.push(Object.assign(id, { reason: "hole type " + hole.holeType }));
            return;
        }
        var d = holeFragmentationDesign(hole, decksByHole[index] || [], o);
        if (!d.design) { skipped.push(Object.assign(id, { reason: d.reason })); return; }
        var result;
        try {
            result = predictFragmentation(d.design, { xmax: o.xmax, spathis: o.spathis });
        } catch (err) {
            skipped.push(Object.assign(id, { reason: err.message }));
            return;
        }
        var v = d.design.burden * d.design.spacing * d.design.benchHeight;
        volume += v;
        mass += d.design.chargeMass;
        used.push(Object.assign(id, { volume: v, design: d.design, result: result }));
    });

    var out = { holes: used, skipped: skipped, volume: volume, chargeMass: mass, powderFactor: volume > 0 ? mass / volume : 0 };
    MODEL_KEYS.forEach(function (k) { out[k] = mixture(used, k); });
    return out;
}

/**
 * The one rock factor A for a whole blast that best fits a measured curve,
 * predicting hole by hole (least squares in % passing at the measured sizes).
 * @param {{sizes:number[], passing:number[]}} measured - mm, %
 * @param {{holes:Object[], decks:Object[]}} kap - parseKAP output
 * @param {Object} [options] - as predictBlastFragmentation (rockFactor ignored), plus
 *   model: "kco" (default), "kuz-ram" or "kckum"
 * @returns {{rockFactor:number, rmse:number, model:string, x50:number}}
 */
export function fitBlastRockFactor(measured, kap, options) {
    var o = options || {};
    return fitRockFactorWith(measured, o.model, function (A) {
        return predictBlastFragmentation(kap, Object.assign({}, o, { rockFactor: A }));
    });
}
