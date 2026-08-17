/**
 * analysis-worker.js — off-thread model evaluation for analysis.html
 *
 * Author: Brent Buffham — blastingapps.com & kirra-design.com
 * License: MIT
 *
 * The analysis demo evaluates models live from a KAP rather than from a
 * pre-baked JSON. Cost scales with deck count, so a 531-deck blast makes the
 * Heelan family far too slow to run on the UI thread while a plane is being
 * dragged. Every evaluation therefore runs here, and the main thread discards
 * results whose job id has been superseded.
 *
 * Protocol
 *   in   { type: "data",   decks, holes }
 *   in   { type: "plane",  id, model, axis, pos, col, row }
 *   in   { type: "volume", id, model, x, y, z }
 *   out  { type: "result", id, kind, w, h, max, ms, values }   values transferred
 *
 * `col`/`row`/`x`/`y`/`z` are lattice specs: { start, step, n }.
 */

import {
	PPVModel,
	PPVDeckModel,
	ScaledHeelanModel,
	ScaledHeelanBlairModel,
	HeelanOriginalModel,
	HolmbergPerssonDamageModel,
	JointedRockDamageModel,
	BoreholePressureModel,
	PowderFactorModel,
	SEEModel,
	chargeColumnsFromDecks,
	computeSDoBAtPoint
} from "../src/index.js";

// Step 1) Shared model parameters — same values precompute.mjs uses
var SITE = { K: 1140, B: 1.6, chargeExponent: 0.5, cutoffDistance: 1.0 };
var HEELAN = {
	K: 1140, B: 1.6, chargeExponent: 0.5, elemsPerDeck: 12,
	pWaveVelocity: 4500, poissonRatio: 0.25, cutoffDistance: 0.5,
	qualityFactorP: 50, qualityFactorS: 30
};

// Step 2) Model registry. `cost` is a rough per-deck weight used by the main
// thread to pick a sensible default resolution — not a physical quantity.
var REGISTRY = {
	ppv:               { name: "PPV (Site Law)",      unit: "mm/s",       cost: 1,  build: function () { return new PPVModel(SITE); } },
	ppvDeck:           { name: "PPV Per-Deck",        unit: "mm/s",       cost: 1,  build: function () { return new PPVDeckModel(SITE); } },
	powderFactor:      { name: "Powder Factor",       unit: "kg/m3",      cost: 1,  build: function () { return new PowderFactorModel(); } },
	boreholePressure:  { name: "Borehole Pressure",   unit: "MPa",        cost: 1,  build: function () { return new BoreholePressureModel(); } },
	see:               { name: "Specific Energy",     unit: "GJ/m3",      cost: 1,  build: function () { return new SEEModel(); } },
	sdob:              { name: "Scaled Depth of Burial", unit: "m/kg^1/3", cost: 2, build: buildSDoB },
	holmbergPersson:   { name: "Holmberg-Persson",    unit: "DI",         cost: 3,  build: function () { return new HolmbergPerssonDamageModel({ ppvCritical: 700 }); } },
	jointedRock:       { name: "Jointed Rock",        unit: "ratio",      cost: 3,  build: function () { return new JointedRockDamageModel(); } },
	heelanOriginal:    { name: "Heelan Original",     unit: "mm/s",       cost: 25, build: function () { return new HeelanOriginalModel(HEELAN); } },
	scaledHeelan:      { name: "Scaled Heelan",       unit: "mm/s",       cost: 30, build: function () { return new ScaledHeelanModel(HEELAN); } },
	scaledHeelanBlair: { name: "Scaled Heelan Blair", unit: "mm/s",       cost: 32, build: function () { return new ScaledHeelanBlairModel(HEELAN); } }
};

// Step 2a) SDoB hoists charge-column assembly out of the per-point call.
// SDoBModel.evaluate rebuilds the columns for every point, which is O(decks)
// of pure waste at 531 decks.
function buildSDoB() {
	var cols = chargeColumnsFromDecks(decks, holes);
	var params = { maxDisplayDistance: 50, targetSDoB: 1.5 };
	return { evaluate: function (pt) { return computeSDoBAtPoint(pt, cols, params); } };
}

var decks = [];
var holes = [];
var cache = {};

// Step 2b) Colour scaling uses a high percentile, not the peak. Every one of
// these fields is singular at the charge — powder factor hits ~2100 kg/m3 a
// few centimetres off a deck while the bench sits near 1 — so scaling to the
// maximum drives the entire visible field into the bottom colour bin.
function percentile(values, q) {
	var pos = [];
	for (var i = 0; i < values.length; i++) {
		var v = values[i];
		if (isFinite(v) && v > 0) pos.push(v);
	}
	if (!pos.length) return 0;
	pos.sort(function (a, b) { return a - b; });
	return pos[Math.min(pos.length - 1, Math.floor(q * (pos.length - 1)))];
}

function modelFor(id) {
	if (!cache[id]) cache[id] = REGISTRY[id].build();
	return cache[id];
}

// Step 3) Message handling
self.onmessage = function (ev) {
	var msg = ev.data;

	if (msg.type === "data") {
		decks = msg.decks || [];
		holes = msg.holes || [];
		cache = {};
		self.postMessage({ type: "ready", decks: decks.length, holes: holes.length });
		return;
	}

	if (msg.type === "plane") { runPlane(msg); return; }
	if (msg.type === "volume") { runVolume(msg); return; }
};

// Step 4) Evaluate one orthogonal slice.
// `axis` names the constant axis; col/row are the two in-plane lattices.
function runPlane(msg) {
	var m = modelFor(msg.model);
	var col = msg.col, row = msg.row;
	var values = new Float32Array(col.n * row.n);
	var pt = { x: 0, y: 0, z: 0 };
	var max = 0;
	var t0 = performance.now();

	for (var r = 0; r < row.n; r++) {
		var rv = row.start + r * row.step;
		for (var c = 0; c < col.n; c++) {
			var cv = col.start + c * col.step;
			if (msg.axis === "z") { pt.x = cv; pt.y = rv; pt.z = msg.pos; }
			else if (msg.axis === "y") { pt.x = cv; pt.z = rv; pt.y = msg.pos; }
			else { pt.y = cv; pt.z = rv; pt.x = msg.pos; }

			var v = m.evaluate(pt, decks, holes);
			values[r * col.n + c] = v;
			if (v > max) max = v;
		}
	}

	var p98 = percentile(values, 0.98);

	self.postMessage({
		type: "result", id: msg.id, kind: "plane", key: msg.key,
		w: col.n, h: row.n, max: max, p98: p98, ms: performance.now() - t0, values: values
	}, [values.buffer]);
}

// Step 5) Evaluate the full box for the optional point cloud.
function runVolume(msg) {
	var m = modelFor(msg.model);
	var X = msg.x, Y = msg.y, Z = msg.z;
	var total = X.n * Y.n * Z.n;
	var values = new Float32Array(total);
	var pt = { x: 0, y: 0, z: 0 };
	var max = 0;
	var i = 0;
	var t0 = performance.now();

	for (var iz = 0; iz < Z.n; iz++) {
		pt.z = Z.start + iz * Z.step;
		for (var iy = 0; iy < Y.n; iy++) {
			pt.y = Y.start + iy * Y.step;
			for (var ix = 0; ix < X.n; ix++) {
				pt.x = X.start + ix * X.step;
				var v = m.evaluate(pt, decks, holes);
				values[i++] = v;
				if (v > max) max = v;
			}
		}
	}

	var p98v = percentile(values, 0.98);

	self.postMessage({
		type: "result", id: msg.id, kind: "volume",
		w: X.n, h: Y.n, d: Z.n, max: max, p98: p98v, ms: performance.now() - t0, values: values
	}, [values.buffer]);
}

// Step 6) Expose the registry so the UI builds its model list from one source
self.postMessage({
	type: "registry",
	models: Object.keys(REGISTRY).map(function (k) {
		return { id: k, name: REGISTRY[k].name, unit: REGISTRY[k].unit, cost: REGISTRY[k].cost };
	})
});
