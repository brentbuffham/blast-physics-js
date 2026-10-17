/**
 * ChargeColumns.js — which explosive decks in a hole act as ONE charge
 *
 * Author: Brent Buffham — blastingapps.com & kirra-design.com
 * License: MIT
 *
 * Holmberg-Persson sums the whole charge inside the bracket and raises it to α
 * once, so what counts as "the charge" matters:
 *
 *   1. TOUCHING explosive decks are one column. Detonation runs straight through
 *      a split, so a deck with no primer of its own fires when the primed deck it
 *      touches fires (the earliest primer in the run).
 *   2. Decks separated by stemming, air or a gas bag are separate charges, added
 *      together only when they fire at the same time (within SAME_FIRE_MS).
 *   3. Different fire times stay separate events; the peak is the larger.
 *      Different holes are never added (the model is per hole).
 *
 * Mirrors Kirra's ChargeColumns.js (Kirra 1.1.32.391).
 */

/** Decks closer than this (m) along the hole touch. */
export var COLUMN_JOIN_M = 0.01;

/** Fire times this close (ms) are the same instant. */
export var SAME_FIRE_MS = 1.0;

/** True when two fire times are the same instant. */
export function sameFireTime(a, b) {
    return Math.abs((+a || 0) - (+b || 0)) <= SAME_FIRE_MS;
}

/**
 * Give each unprimed explosive deck the fire time of the column it belongs to.
 * Mutates and returns `entries`.
 *
 * @param {Array<{top:number, base:number, timingMs:number, primed:boolean}>} entries
 *   the EXPLOSIVE decks of one hole (depths from the collar; any order)
 * @returns {Array} entries
 */
export function inheritColumnFireTimes(entries) {
    if (!entries || entries.length < 2) return entries;
    var order = entries.slice().sort(function (a, b) { return a.top - b.top; });
    var run = [order[0]];
    var flush = function () {
        var primedTimes = run.filter(function (e) { return e.primed; }).map(function (e) { return e.timingMs; });
        if (primedTimes.length && primedTimes.length < run.length) {
            var t = Math.min.apply(null, primedTimes);   // the first primer to fire starts the column
            run.forEach(function (e) { if (!e.primed) e.timingMs = t; });
        }
    };
    for (var i = 1; i < order.length; i++) {
        if (order[i].top - run[run.length - 1].base <= COLUMN_JOIN_M) {
            run.push(order[i]);
        } else {
            flush();
            run = [order[i]];
        }
    }
    flush();
    return entries;
}
