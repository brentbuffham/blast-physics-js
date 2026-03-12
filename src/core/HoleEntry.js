/**
 * HoleEntry.js — Blast hole geometry validation and factory
 *
 * Author: Brent Buffham — blastingapps.com & kirra-design.com
 * License: MIT
 *
 * Coordinate system: X=Easting, Y=Northing, Z=Elevation (right-handed, Z-up).
 * Angles: 0° = vertical hole, 90° = horizontal. Bearing: 0° = North, clockwise.
 */

/**
 * Create a validated HoleEntry object.
 *
 * @param {Object} params
 * @param {string}  [params.entityName='']       - Blast pattern name
 * @param {string}  [params.holeID='']           - Unique hole identifier
 * @param {number}  params.collarX               - Collar easting (m)
 * @param {number}  params.collarY               - Collar northing (m)
 * @param {number}  params.collarZ               - Collar elevation (m)
 * @param {number}  params.toeX                  - Toe easting (m)
 * @param {number}  params.toeY                  - Toe northing (m)
 * @param {number}  params.toeZ                  - Toe elevation (m)
 * @param {number}  [params.holeDiamMm=115]      - Borehole diameter (mm)
 * @param {string}  [params.holeType='Production'] - Hole type
 * @param {number}  [params.benchHeight=0]       - Collar Z to grade Z (m)
 * @param {number}  [params.subdrillLength=0]    - Grade to toe along hole (m)
 * @param {number}  [params.holeTime=0]          - Surface initiation time (ms)
 * @returns {Object} Validated HoleEntry
 */
export function createHoleEntry(params) {
    if (!params) throw new Error("HoleEntry: params required");
    var requiredCoords = ["collarX", "collarY", "collarZ", "toeX", "toeY", "toeZ"];
    for (var i = 0; i < requiredCoords.length; i++) {
        if (params[requiredCoords[i]] === undefined || params[requiredCoords[i]] === null) {
            throw new Error("HoleEntry: missing required field " + requiredCoords[i]);
        }
    }
    return {
        entityName:      params.entityName  || "",
        holeID:          params.holeID      || "",
        collarX:         Number(params.collarX),
        collarY:         Number(params.collarY),
        collarZ:         Number(params.collarZ),
        toeX:            Number(params.toeX),
        toeY:            Number(params.toeY),
        toeZ:            Number(params.toeZ),
        holeDiamMm:      Number(params.holeDiamMm   || 115),
        holeType:        params.holeType             || "Production",
        benchHeight:     Number(params.benchHeight   || 0),
        subdrillLength:  Number(params.subdrillLength || 0),
        holeTime:        Number(params.holeTime       || 0)
    };
}

/**
 * Compute hole length (collar-to-toe distance, metres).
 * @param {Object} hole - HoleEntry
 * @returns {number}
 */
export function holeLength(hole) {
    var dx = hole.toeX - hole.collarX;
    var dy = hole.toeY - hole.collarY;
    var dz = hole.toeZ - hole.collarZ;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Compute unit hole axis vector (collar → toe).
 * @param {Object} hole - HoleEntry
 * @returns {{ x: number, y: number, z: number }}
 */
export function holeAxisVector(hole) {
    var len = holeLength(hole);
    if (len < 1e-6) return { x: 0, y: 0, z: -1 };
    return {
        x: (hole.toeX - hole.collarX) / len,
        y: (hole.toeY - hole.collarY) / len,
        z: (hole.toeZ - hole.collarZ) / len
    };
}
