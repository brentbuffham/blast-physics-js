/**
 * DetonationSimulator.js — Multi-primer front propagation with collision detection
 *
 * Author: Brent Buffham — blastingapps.com & kirra-design.com
 * License: MIT
 *
 * Directly ported from Kirra's DetonationSimulator.js (already pure JS).
 * Uses Blair (2008) non-linear Em computation with multi-primer support.
 *
 * Reference: Blair (2008), "Non-linear superposition models of blast vibration",
 *            Int J Rock Mech Min Sci 45, 235–247
 */

/**
 * Create charge elements for a column.
 *
 * @param {number} chargeLength - Length of charge column (m)
 * @param {number} totalMass    - Total explosive mass (kg)
 * @param {number} numElements  - Number of discretisation elements (M)
 * @returns {Array} Array of element objects
 */
function createElements(chargeLength, totalMass, numElements) {
    var dL = chargeLength / numElements;
    var elementMass = totalMass / numElements;
    var elements = [];
    for (var i = 0; i < numElements; i++) {
        var centreDepth = chargeLength - (i + 0.5) * dL;
        elements.push({
            index: i,
            centreDepth: centreDepth,
            mass: elementMass,
            detTime: Infinity,
            Em: 0
        });
    }
    return elements;
}

/**
 * Check if a detonation front from a primer is blocked by collision
 * with an adjacent primer's opposing front.
 *
 * @param {number} elemDepth      - Depth of element along charge column
 * @param {Object} primer         - The primer generating this front
 * @param {Array}  sortedPrimers  - All primers sorted by depth
 * @param {number} primerIndex    - Index of primer in sortedPrimers
 * @param {number} vod            - Velocity of detonation (m/s)
 * @returns {boolean} True if front is blocked
 */
function isFrontBlocked(elemDepth, primer, sortedPrimers, primerIndex, vod) {
    // Check collision with the primer above (smaller depth)
    if (elemDepth < primer.depthAlongColumn && primerIndex > 0) {
        var other = sortedPrimers[primerIndex - 1];
        var collisionDepth = (other.depthAlongColumn + primer.depthAlongColumn) / 2
            + vod * (primer.fireTime - other.fireTime) / 2000;
        if (elemDepth < collisionDepth) return true;
    }

    // Check collision with the primer below (larger depth)
    if (elemDepth > primer.depthAlongColumn && primerIndex < sortedPrimers.length - 1) {
        var other2 = sortedPrimers[primerIndex + 1];
        var collisionDepth2 = (primer.depthAlongColumn + other2.depthAlongColumn) / 2
            + vod * (other2.fireTime - primer.fireTime) / 2000;
        if (elemDepth > collisionDepth2) return true;
    }

    return false;
}

/**
 * Simulate detonation front propagation for a charge column with one or more primers.
 *
 * @param {Object} column
 * @param {number} column.chargeTopDepth   - Distance from collar to top of charge (m)
 * @param {number} column.chargeBaseDepth  - Distance from collar to bottom of charge (m)
 * @param {number} column.totalMass        - Total explosive mass (kg)
 * @param {number} column.vod              - Velocity of detonation (m/s)
 * @param {number} column.numElements      - Number of discretisation elements (M)
 * @param {Array}  column.primers          - Array of {depthAlongColumn, fireTime} objects
 * @returns {Array} Array of element objects with detTime populated
 */
export function simulateDetonation(column) {
    var chargeLength = column.chargeBaseDepth - column.chargeTopDepth;
    if (chargeLength <= 0 || column.totalMass <= 0) return [];

    var elements = createElements(chargeLength, column.totalMass, column.numElements);

    var primers = column.primers;
    if (!primers || primers.length === 0) {
        primers = [{ depthAlongColumn: chargeLength, fireTime: 0 }];
    }

    var sortedPrimers = primers.slice().sort(function (a, b) {
        return a.depthAlongColumn - b.depthAlongColumn;
    });

    for (var ei = 0; ei < elements.length; ei++) {
        var elem = elements[ei];
        var minTime = Infinity;

        for (var pi = 0; pi < sortedPrimers.length; pi++) {
            var primer = sortedPrimers[pi];
            var dist = Math.abs(elem.centreDepth - primer.depthAlongColumn);
            var arrivalTime = primer.fireTime + (dist / column.vod) * 1000; // ms

            if (!isFrontBlocked(elem.centreDepth, primer, sortedPrimers, pi, column.vod)) {
                if (arrivalTime < minTime) minTime = arrivalTime;
            }
        }

        elem.detTime = minTime;
    }

    return elements;
}

/**
 * Compute Em (non-linear superposition equivalent mass) values.
 * Uses Blair (2008) generalised cumulative mass approach.
 * Invariant: Σ Em = totalMass^A
 *
 * @param {Array}  elements       - Array of element objects with detTime and mass
 * @param {number} chargeExponent - Exponent A (typically 0.5 to 0.8)
 * @returns {Array} Same elements array with Em values populated
 */
export function computeEmValues(elements, chargeExponent) {
    if (!elements || elements.length === 0) return elements;

    var sorted = elements.slice().sort(function (a, b) {
        return a.detTime - b.detTime;
    });

    var tol = 0.01; // ms tolerance for simultaneous detonation
    var groups = [];
    var currentGroup = [sorted[0]];

    for (var i = 1; i < sorted.length; i++) {
        if (Math.abs(sorted[i].detTime - currentGroup[0].detTime) < tol) {
            currentGroup.push(sorted[i]);
        } else {
            groups.push(currentGroup);
            currentGroup = [sorted[i]];
        }
    }
    groups.push(currentGroup);

    var cumulativeMass = 0;
    for (var gi = 0; gi < groups.length; gi++) {
        var group = groups[gi];
        var groupMass = 0;
        for (var j = 0; j < group.length; j++) groupMass += group[j].mass;

        var prevMass = cumulativeMass;
        cumulativeMass += groupMass;

        var groupEm = Math.pow(cumulativeMass, chargeExponent)
            - (prevMass > 0 ? Math.pow(prevMass, chargeExponent) : 0);

        var emPerElement = groupEm / group.length;
        for (var j = 0; j < group.length; j++) {
            group[j].Em = emPerElement;
        }
    }

    return elements;
}

/**
 * Full pipeline: simulate detonation and compute Em values.
 *
 * @param {Object} column         - Charge column info (see simulateDetonation)
 * @param {number} chargeExponent - Blair charge exponent A
 * @returns {Array} Array of element objects with detTime and Em
 */
export function processHoleDetonation(column, chargeExponent) {
    var elements = simulateDetonation(column);
    computeEmValues(elements, chargeExponent);
    return elements;
}
