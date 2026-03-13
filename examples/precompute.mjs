/**
 * precompute.mjs — Pre-calculate all models on a 3D box grid
 *
 * Run: node examples/precompute.mjs
 * Output: examples/precomputed-points.json
 *
 * Generates a regular 3D grid (0.5m spacing, 10m pad around holes)
 * and evaluates each model at every XYZ point — true volumetric output.
 *
 * Blair & Minchinton is computed on a coarse 2D grid (30x30) then
 * baked into the 3D point array via XY interpolation (Z-invariant).
 */

import { readFileSync, writeFileSync } from "fs";
import { createDeckEntry } from "../src/core/DeckEntry.js";
import { createHoleEntry } from "../src/core/HoleEntry.js";
import { PPVModel } from "../src/vibration/PPV.js";
import { PPVDeckModel } from "../src/vibration/PPVDeck.js";
import { ScaledHeelanModel } from "../src/vibration/ScaledHeelan.js";
import { ScaledHeelanBlairModel } from "../src/vibration/ScaledHeelanBlair.js";
import { HeelanOriginalModel } from "../src/vibration/HeelanOriginal.js";
import { BlairMinchintonModel } from "../src/vibration/BlairMinchinton.js";
import { HolmbergPerssonDamageModel } from "../src/damage/HolmbergPerssonDamage.js";
import { JointedRockDamageModel } from "../src/damage/JointedRockDamage.js";
import { BoreholePressureModel } from "../src/pressure/BoreholePressure.js";
import { PowderFactorModel } from "../src/pressure/PowderFactor.js";

// Step 1) Load blast data
var raw = JSON.parse(readFileSync("examples/blast-data.json", "utf8"));

var holeEntries = raw.holes.map(function (h) { return createHoleEntry(h); });
var deckEntries = raw.decks.map(function (d) { return createDeckEntry(d); });

console.log("Loaded " + holeEntries.length + " holes, " + deckEntries.length + " decks");

// Step 2) Compute 3D box bounds — 10m pad around hole extents
var PAD = 10;
var SPACING = 0.5;

var hMinX = 999, hMaxX = -999, hMinY = 999, hMaxY = -999, hMinZ = 999, hMaxZ = -999;
for (var i = 0; i < holeEntries.length; i++) {
    var h = holeEntries[i];
    if (h.collarX < hMinX) hMinX = h.collarX;
    if (h.collarX > hMaxX) hMaxX = h.collarX;
    if (h.toeX < hMinX) hMinX = h.toeX;
    if (h.toeX > hMaxX) hMaxX = h.toeX;
    if (h.collarY < hMinY) hMinY = h.collarY;
    if (h.collarY > hMaxY) hMaxY = h.collarY;
    if (h.toeY < hMinY) hMinY = h.toeY;
    if (h.toeY > hMaxY) hMaxY = h.toeY;
    if (h.collarZ < hMinZ) hMinZ = h.collarZ;
    if (h.collarZ > hMaxZ) hMaxZ = h.collarZ;
    if (h.toeZ < hMinZ) hMinZ = h.toeZ;
    if (h.toeZ > hMaxZ) hMaxZ = h.toeZ;
}

var boxMinX = hMinX - PAD, boxMaxX = hMaxX + PAD;
var boxMinY = hMinY - PAD, boxMaxY = hMaxY + PAD;
var boxMinZ = hMinZ - PAD, boxMaxZ = hMaxZ + PAD;

var nx = Math.ceil((boxMaxX - boxMinX) / SPACING) + 1;
var ny = Math.ceil((boxMaxY - boxMinY) / SPACING) + 1;
var nz = Math.ceil((boxMaxZ - boxMinZ) / SPACING) + 1;
var totalPoints = nx * ny * nz;

console.log("3D Box: X[" + boxMinX.toFixed(1) + ".." + boxMaxX.toFixed(1) + "] Y[" + boxMinY.toFixed(1) + ".." + boxMaxY.toFixed(1) + "] Z[" + boxMinZ.toFixed(1) + ".." + boxMaxZ.toFixed(1) + "]");
console.log("Grid: " + nx + " x " + ny + " x " + nz + " = " + totalPoints + " points at " + SPACING + "m");

// Step 3) Build point array
var pointsX = new Float64Array(totalPoints);
var pointsY = new Float64Array(totalPoints);
var pointsZ = new Float64Array(totalPoints);
var idx = 0;
for (var iz = 0; iz < nz; iz++) {
    for (var iy = 0; iy < ny; iy++) {
        for (var ix = 0; ix < nx; ix++) {
            pointsX[idx] = boxMinX + ix * SPACING;
            pointsY[idx] = boxMinY + iy * SPACING;
            pointsZ[idx] = boxMinZ + iz * SPACING;
            idx++;
        }
    }
}

// Step 4) Define models
var siteParams = { K: 1140, B: 1.6, chargeExponent: 0.5, cutoffDistance: 1.0 };
var heelanParams = {
    K: 1140, B: 1.6, chargeExponent: 0.5, elemsPerDeck: 12,
    pWaveVelocity: 4500, poissonRatio: 0.25, cutoffDistance: 0.5,
    qualityFactorP: 50, qualityFactorS: 30
};
var blairParams = {
    K: 700, B: 1.5, chargeExponent: 0.5, elemsPerDeck: 20,
    pWaveVelocity: 4500, poissonRatio: 0.25, cutoffDistance: 0.5,
    qualityFactorP: 50, qualityFactorS: 30,
    bandwidth: 10000
};

var models = [
    { id: "ppv", name: "PPV (Site Law)", unit: "mm/s", needsHoles: false,
      model: new PPVModel(siteParams) },
    { id: "ppvDeck", name: "PPV Per-Deck", unit: "mm/s", needsHoles: false,
      model: new PPVDeckModel(siteParams) },
    { id: "scaledHeelan", name: "Scaled Heelan", unit: "mm/s", needsHoles: true,
      model: new ScaledHeelanModel(heelanParams) },
    { id: "scaledHeelanBlair", name: "Scaled Heelan Blair", unit: "mm/s", needsHoles: true,
      model: new ScaledHeelanBlairModel(heelanParams) },
    { id: "heelanOriginal", name: "Heelan Original", unit: "mm/s", needsHoles: true,
      model: new HeelanOriginalModel(heelanParams) },
    { id: "holmbergPersson", name: "Holmberg-Persson", unit: "DI", needsHoles: false,
      model: new HolmbergPerssonDamageModel({ ppvCritical: 700 }) },
    { id: "jointedRock", name: "Jointed Rock", unit: "ratio", needsHoles: false,
      model: new JointedRockDamageModel() },
    { id: "boreholePressure", name: "Borehole Pressure", unit: "MPa", needsHoles: false,
      model: new BoreholePressureModel() },
    { id: "powderFactor", name: "Powder Factor", unit: "kg/m3", needsHoles: false,
      model: new PowderFactorModel() }
];

// Step 5) Evaluate each 3D model at every point
var results = {
    box: { minX: boxMinX, minY: boxMinY, minZ: boxMinZ, nx: nx, ny: ny, nz: nz, spacing: SPACING },
    totalPoints: totalPoints,
    models: {}
};

for (var mi = 0; mi < models.length; mi++) {
    var m = models[mi];
    console.log("Computing " + m.name + " (" + totalPoints + " pts)...");
    var t0 = performance.now();
    var values = new Float32Array(totalPoints);
    var maxVal = 0;

    for (var pi = 0; pi < totalPoints; pi++) {
        var pt = { x: pointsX[pi], y: pointsY[pi], z: pointsZ[pi] };
        var val;
        if (m.needsHoles) {
            val = m.model.evaluate(pt, deckEntries, holeEntries);
        } else {
            val = m.model.evaluate(pt, deckEntries);
        }
        values[pi] = val;
        if (val > maxVal) maxVal = val;

        if (pi > 0 && pi % 100000 === 0) {
            var pct = ((pi / totalPoints) * 100).toFixed(0);
            var elapsed = ((performance.now() - t0) / 1000).toFixed(1);
            console.log("  " + pct + "% (" + pi + "/" + totalPoints + ") " + elapsed + "s");
        }
    }

    var dt = ((performance.now() - t0) / 1000).toFixed(1);

    var dataArray = new Array(totalPoints);
    for (var di = 0; di < totalPoints; di++) {
        dataArray[di] = Math.round(values[di] * 100) / 100;
    }

    results.models[m.id] = {
        name: m.name, unit: m.unit, max: Math.round(maxVal * 100) / 100,
        computeSec: Number(dt), data: dataArray
    };
    console.log("  Done: " + dt + "s, max=" + maxVal.toFixed(2) + " " + m.unit);
}

// Step 6) Blair & Minchinton — compute on coarse 2D grid, bake into 3D via XY interpolation
console.log("Computing Blair & Minchinton (coarse 2D -> 3D bake)...");
var blairModel = new BlairMinchintonModel(blairParams);
var blairRes = 30;
var blairCellX = (boxMaxX - boxMinX) / (blairRes - 1);
var blairCellY = (boxMaxY - boxMinY) / (blairRes - 1);
var blairMidZ = (hMinZ + hMaxZ) / 2;
var blairGP = {
    minX: boxMinX, minY: boxMinY,
    rows: blairRes, cols: blairRes,
    cellX: blairCellX, cellY: blairCellY,
    elevation: blairMidZ
};

var t0blair = performance.now();
var blairGrid;
try {
    blairGrid = blairModel.computeGrid(deckEntries, holeEntries, blairGP);
} catch (e) {
    console.log("  Blair ERROR: " + e.message);
    blairGrid = null;
}

if (blairGrid) {
    var dtBlair2D = ((performance.now() - t0blair) / 1000).toFixed(1);
    console.log("  2D grid done: " + dtBlair2D + "s (" + blairRes + "x" + blairRes + ")");

    // Bake into 3D point array via bilinear XY interpolation
    var blairValues = new Array(totalPoints);
    var blairMax = 0;
    for (var pi = 0; pi < totalPoints; pi++) {
        var px = pointsX[pi], py = pointsY[pi];
        var col = (px - boxMinX) / blairCellX;
        var row = (py - boxMinY) / blairCellY;
        col = Math.max(0, Math.min(col, blairRes - 1));
        row = Math.max(0, Math.min(row, blairRes - 1));
        var c0 = Math.floor(col), c1 = Math.min(c0 + 1, blairRes - 1);
        var r0 = Math.floor(row), r1 = Math.min(r0 + 1, blairRes - 1);
        var fx = col - c0, fy = row - r0;
        var bd = blairGrid.data;
        var v = bd[r0 * blairRes + c0] * (1-fx)*(1-fy)
              + bd[r0 * blairRes + c1] * fx*(1-fy)
              + bd[r1 * blairRes + c0] * (1-fx)*fy
              + bd[r1 * blairRes + c1] * fx*fy;
        blairValues[pi] = Math.round(v * 100) / 100;
        if (v > blairMax) blairMax = v;
    }
    var dtBlairTotal = ((performance.now() - t0blair) / 1000).toFixed(1);
    results.models["blairMinchinton"] = {
        name: "Blair & Minchinton (2D baked)",
        unit: "mm/s",
        max: Math.round(blairMax * 100) / 100,
        computeSec: Number(dtBlairTotal),
        data: blairValues
    };
    console.log("  Baked to 3D: " + dtBlairTotal + "s total, max=" + blairMax.toFixed(2) + " mm/s");
}

// Step 7) Write output
var outPath = "examples/precomputed-points.json";
var jsonStr = JSON.stringify(results);
writeFileSync(outPath, jsonStr);
var sizeMB = (Buffer.byteLength(jsonStr) / 1024 / 1024).toFixed(1);
console.log("\nWrote " + outPath + " (" + sizeMB + " MB)");
console.log("Models: " + Object.keys(results.models).length + ", Points: " + totalPoints);
