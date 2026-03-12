/**
 * DeckEntry.js — Deck-within-hole data validation and factory
 *
 * Author: Brent Buffham — blastingapps.com & kirra-design.com
 * License: MIT
 *
 * A DeckEntry represents one explosive (or inert) deck within a blast hole.
 * Extracted from prepareDeckDataTexture() in Kirra's PowderFactorModel.js.
 *
 * Critical diameter distinction:
 *   COUPLED   — chargeDiamMm = holeDiamMm (explosive fills the bore)
 *   DECOUPLED — chargeDiamMm = product physical diameter (air gap present)
 */

export const DECK_TYPES = ["COUPLED", "DECOUPLED", "INERT", "SPACER"];

/**
 * Create a validated DeckEntry object.
 *
 * @param {Object} params
 * @param {string}  [params.deckType='COUPLED'] - 'COUPLED'|'DECOUPLED'|'INERT'|'SPACER'
 * @param {number}  params.topX                 - Charge top easting (m)
 * @param {number}  params.topY                 - Charge top northing (m)
 * @param {number}  params.topZ                 - Charge top elevation (m)
 * @param {number}  params.baseX                - Charge base easting (m)
 * @param {number}  params.baseY                - Charge base northing (m)
 * @param {number}  params.baseZ                - Charge base elevation (m)
 * @param {number}  [params.mass=0]             - Explosive mass (kg)
 * @param {number}  [params.density=1.2]        - Explosive density (kg/L = g/cc)
 * @param {number}  [params.vod=5000]           - Velocity of detonation (m/s)
 * @param {string}  [params.productName='']     - Product name
 * @param {number}  [params.holeDiamMm=115]     - Borehole diameter (mm)
 * @param {number}  [params.chargeDiamMm]       - Charge diameter (mm); defaults to holeDiamMm for COUPLED
 * @param {number}  [params.timingMs=0]         - Total detonation time: surface + downhole delay (ms)
 * @param {number}  [params.holeIndex=0]        - Index into HoleEntry array
 * @param {number}  [params.primerFraction=1.0] - 0.0=primer at deck top, 1.0=primer at deck base
 * @returns {Object} Validated DeckEntry
 */
export function createDeckEntry(params) {
    if (!params) throw new Error("DeckEntry: params required");
    var requiredCoords = ["topX", "topY", "topZ", "baseX", "baseY", "baseZ"];
    for (var i = 0; i < requiredCoords.length; i++) {
        if (params[requiredCoords[i]] === undefined || params[requiredCoords[i]] === null) {
            throw new Error("DeckEntry: missing required field " + requiredCoords[i]);
        }
    }
    var deckType    = params.deckType    || "COUPLED";
    var holeDiamMm  = Number(params.holeDiamMm  || 115);
    var chargeDiamMm;
    if (params.chargeDiamMm !== undefined && params.chargeDiamMm !== null) {
        chargeDiamMm = Number(params.chargeDiamMm);
    } else {
        chargeDiamMm = (deckType === "DECOUPLED") ? holeDiamMm * 0.7 : holeDiamMm;
    }
    return {
        deckType:       deckType,
        topX:           Number(params.topX),
        topY:           Number(params.topY),
        topZ:           Number(params.topZ),
        baseX:          Number(params.baseX),
        baseY:          Number(params.baseY),
        baseZ:          Number(params.baseZ),
        mass:           Number(params.mass       || 0),
        density:        Number(params.density    || 1.2),
        vod:            Number(params.vod        || 5000),
        productName:    params.productName       || "",
        holeDiamMm:     holeDiamMm,
        chargeDiamMm:   chargeDiamMm,
        timingMs:       Number(params.timingMs   || 0),
        holeIndex:      Number(params.holeIndex  || 0),
        primerFraction: Number(params.primerFraction !== undefined ? params.primerFraction : 1.0)
    };
}

/**
 * Compute deck length (top-to-base distance, metres).
 * @param {Object} deck - DeckEntry
 * @returns {number}
 */
export function deckLength(deck) {
    var dx = deck.baseX - deck.topX;
    var dy = deck.baseY - deck.topY;
    var dz = deck.baseZ - deck.topZ;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Compute deck midpoint.
 * @param {Object} deck - DeckEntry
 * @returns {{ x: number, y: number, z: number }}
 */
export function deckMidpoint(deck) {
    return {
        x: (deck.topX + deck.baseX) * 0.5,
        y: (deck.topY + deck.baseY) * 0.5,
        z: (deck.topZ + deck.baseZ) * 0.5
    };
}

/**
 * Return true when the deck contains explosive (COUPLED or DECOUPLED with mass > 0).
 * @param {Object} deck
 * @returns {boolean}
 */
export function isCharged(deck) {
    return (deck.deckType === "COUPLED" || deck.deckType === "DECOUPLED") && deck.mass > 0;
}
