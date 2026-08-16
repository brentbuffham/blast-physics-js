/**
 * KAPReader.js — Read Kirra .kap project archives into library data structures
 *
 * Author: Brent Buffham — blastingapps.com & kirra-design.com
 * License: MIT
 *
 * A KAP is a ZIP with JSON entries (manifest.json, holes.json, charging.json,
 * products.json, surfaces.json, …) and optional binary geometry sidecars
 * (geometry/*.pos Float64 xyz, geometry/*.idx Uint32 triangles) for large
 * surfaces. This reader is a headless subset of Kirra's KAPParser: it returns
 * only what the physics models need —
 *
 *   holes     HoleEntry[]              (createHoleEntry shape + burden/spacing/gradeZ/holeTimeMs)
 *   decks     DeckEntry[]              (one per explosive deck, positions in world XYZ,
 *                                       timingMs resolved per primer, mass from geometry)
 *   surfaces  [{ id, name, role, pos: Float64Array, idx: Uint32Array, np, nt }]
 *   products  Map<productID, product>
 *   raw       { manifest, holes, charging, products, surfaces }
 *
 * Fire-time resolution mirrors Kirra's DeckFireMsResolver: electronic
 * primers carry an absolute delayMs; shock-tube / electric / cord primers
 * cascade as hole.holeTime + delayMs + lengthFromCollar / deliveryVod.
 *
 * Surface roles (name-based, matching the Kirra throw simulator):
 *   'voxelblk'  VOXEL-BLK* / *PREBLAST*VOLUME*      — the material to be blasted
 *   'shell'     SHELL* / *REMAIN* / *CONFIN* / *MINUS*— trusted confinement geometry
 *   'shelltopo' *PREBLAST*SURFACE* / *TOPO*         — pre-blast topography (fallback collision)
 *   'reference' *POSTBLAST*                          — surveyed post-blast surface
 *   'other'     anything else
 */

import { readZipDirectory, zipExtract, zipExtractJSON } from "./ZipReader.js";
import { createHoleEntry } from "../core/HoleEntry.js";
import { createDeckEntry } from "../core/DeckEntry.js";

var NON_FIRING = { SurfaceConnector: true, SurfaceWire: true, SurfaceCord: true };
var CASCADE = { ShockTube: true, Electric: true, DetonatingCord: true };

/**
 * Classify a surface by name.
 * @param {string} name
 * @returns {'voxelblk'|'shell'|'shelltopo'|'reference'|'other'}
 */
export function surfaceRole(name) {
    var u = (name || "").toUpperCase();
    if (u.startsWith("VOXEL-BLK")) return "voxelblk";
    if (u.startsWith("SHELL") || u.includes("REMAIN") || u.includes("CONFIN") || u.includes("MINUS")) return "shell";
    if (u.includes("POSTBLAST")) return "reference";
    if (u.includes("PREBLAST") && u.includes("VOLUME")) return "voxelblk";
    if (u.includes("PREBLAST") && u.includes("SURFACE")) return "shelltopo";
    if (u.includes("TOPO")) return "shelltopo";
    return "other";
}

/**
 * Resolve the absolute fire time (ms) of one primer.
 * @param {Object} hole   - raw Kirra hole (holeTime)
 * @param {Object} primer - raw Kirra primer (detonator, lengthFromCollar)
 * @returns {{ fireMs: number|null, status: string }}
 */
export function resolvePrimerFireMs(hole, primer) {
    if (!hole || !primer || !primer.detonator) return { fireMs: null, status: "invalid-input" };
    var det = primer.detonator;
    var initiator = det.initiatorType;
    if (initiator && NON_FIRING[initiator]) return { fireMs: null, status: "non-firing" };
    if (initiator === "Electronic") {
        var b3 = det.delayMs;
        if (b3 != null && isFinite(b3)) return { fireMs: Number(b3), status: "ok" };
        return { fireMs: null, status: "unresolved-electronic" };
    }
    if (!initiator || CASCADE[initiator]) {
        var a4 = hole.holeTime != null ? Number(hole.holeTime) : 0;
        var b3c = det.delayMs != null ? Number(det.delayMs) : 0;
        var b2 = det.deliveryVodMs != null ? Number(det.deliveryVodMs) : 0;
        var b8 = primer.lengthFromCollar != null ? Number(primer.lengthFromCollar) : 0;
        var burn = b2 > 0 ? (b8 / b2) * 1000 : 0;
        return { fireMs: a4 + b3c + burn, status: "ok" };
    }
    return { fireMs: null, status: "invalid-input" };
}

function _isExplosiveCategory(cat) {
    return /explosive/i.test(cat || "") && !/^non/i.test(cat || "");
}

/**
 * Deck mass from geometry — COUPLED uses the hole diameter, DECOUPLED the
 * product diameter (discrete packages when lengthMm/packageCount known).
 * @param {Object} deck - raw Kirra deck
 * @param {number} holeDiamMm
 * @param {number} densityKgL
 * @returns {number} kg
 */
export function deckMassFromGeometry(deck, holeDiamMm, densityKgL) {
    var len = Math.abs((deck.baseDepth || 0) - (deck.topDepth || 0));
    var prod = deck.product || {};
    if (deck.deckType === "DECOUPLED" && prod.diameterMm > 0) {
        var count = deck.totalPackageCount || deck.packageCount || 0;
        var rM = (prod.diameterMm / 1000) / 2;
        if (count > 0 && prod.lengthMm > 0) {
            return count * Math.PI * rM * rM * (prod.lengthMm / 1000) * densityKgL * 1000;
        }
        return Math.PI * rM * rM * len * densityKgL * 1000;
    }
    var r = (holeDiamMm / 1000) / 2;
    return Math.PI * r * r * len * densityKgL * 1000;
}

/**
 * Parse a KAP archive (or a legacy flat JSON export).
 *
 * @param {ArrayBuffer|Uint8Array|Blob|{arrayBuffer():Promise<ArrayBuffer>}} source
 * @param {Object} [options]
 * @param {Function} [options.inflateRaw]     - custom inflater (see ZipReader)
 * @param {boolean}  [options.loadSurfaces=true]
 * @param {boolean}  [options.includeHidden=false] - include holes with visible === false
 * @param {number}   [options.fallbackDensity=1.15] - kg/L when a product has no density
 * @param {number}   [options.fallbackVOD=5000]     - m/s when no product VOD
 * @returns {Promise<{ holes: Array, decks: Array, surfaces: Array, products: Map, raw: Object }>}
 */
export async function parseKAP(source, options) {
    var opts = Object.assign({ loadSurfaces: true, includeHidden: false, fallbackDensity: 1.15, fallbackVOD: 5000 }, options || {});
    var buffer;
    if (source instanceof ArrayBuffer) buffer = source;
    else if (ArrayBuffer.isView(source)) buffer = source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
    else if (source && typeof source.arrayBuffer === "function") buffer = await source.arrayBuffer();
    else throw new Error("parseKAP: unsupported source");

    var head = new Uint8Array(buffer, 0, 2);
    if (!(head[0] === 0x50 && head[1] === 0x4b)) {
        var data = JSON.parse(new TextDecoder().decode(buffer));
        return parseKAPObjects(data, opts);
    }

    var zip = readZipDirectory(buffer);
    var zo = { inflateRaw: opts.inflateRaw };
    var manifest = await zipExtractJSON(zip, "manifest.json", zo);
    var holesRaw = await zipExtractJSON(zip, "holes.json", zo) || [];
    var chargingRaw = await zipExtractJSON(zip, "charging.json", zo);
    var productsRaw = await zipExtractJSON(zip, "products.json", zo);
    var surfacesRaw = opts.loadSurfaces ? (await zipExtractJSON(zip, "surfaces.json", zo) || []) : [];

    // Binary geometry sidecars are resolved here (they need the zip)
    var surfList = Array.isArray(surfacesRaw) ? surfacesRaw : Object.values(surfacesRaw || {});
    var geomBins = {};
    for (var si = 0; si < surfList.length; si++) {
        var s = surfList[si];
        if (s && s.geometryBin && s.geometryBin.pos && s.geometryBin.idx) {
            var gb = s.geometryBin;
            var posU8 = await zipExtract(zip, gb.pos, zo);
            var idxU8 = await zipExtract(zip, gb.idx, zo);
            if (posU8 && idxU8) {
                geomBins[s.id || s.name || String(si)] = {
                    pos: new Float64Array(posU8.buffer.slice(posU8.byteOffset, posU8.byteOffset + gb.np * 24)),
                    idx: new Uint32Array(idxU8.buffer.slice(idxU8.byteOffset, idxU8.byteOffset + gb.nt * 12)),
                    np: gb.np, nt: gb.nt
                };
            }
        }
    }
    return parseKAPObjects({ manifest: manifest, holes: holesRaw, charging: chargingRaw, products: productsRaw, surfaces: surfList, geometryBins: geomBins }, opts);
}

/**
 * Build library structures from already-decoded KAP JSON objects.
 * @param {Object} data - { manifest?, holes, charging?, products?, surfaces?, geometryBins? }
 * @param {Object} [opts]
 * @returns {{ holes, decks, surfaces, products, raw }}
 */
export function parseKAPObjects(data, opts) {
    opts = Object.assign({ includeHidden: false, fallbackDensity: 1.15, fallbackVOD: 5000 }, opts || {});
    var holesRaw = Array.isArray(data.holes) ? data.holes : Object.values(data.holes || {});

    // Products map: [[key, product], …] or object or array of products
    var products = new Map();
    var pr = data.products;
    if (Array.isArray(pr)) {
        for (var i = 0; i < pr.length; i++) {
            var it = pr[i];
            if (Array.isArray(it) && it.length >= 2 && it[1]) { products.set(String(it[0]), it[1]); if (it[1].productID) products.set(String(it[1].productID), it[1]); }
            else if (it && it.productID) products.set(String(it.productID), it);
        }
    } else if (pr && typeof pr === "object") {
        Object.keys(pr).forEach(function (k) { products.set(k, pr[k]); if (pr[k] && pr[k].productID) products.set(String(pr[k].productID), pr[k]); });
    }

    // Charging map keyed entityName:::holeID (and holeID fallback)
    var chMap = new Map();
    var ch = data.charging;
    if (Array.isArray(ch)) {
        for (var ci = 0; ci < ch.length; ci++) {
            var pair = ch[ci];
            if (Array.isArray(pair) && pair.length >= 2 && pair[1]) chMap.set(String(pair[0]), pair[1]);
            else if (pair && pair.holeID != null) chMap.set((pair.entityName || "") + ":::" + pair.holeID, pair);
        }
    } else if (ch && typeof ch === "object") {
        Object.keys(ch).forEach(function (k) { chMap.set(k, ch[k]); });
    }

    var holes = [], decks = [];
    for (var hi = 0; hi < holesRaw.length; hi++) {
        var h = holesRaw[hi];
        if (!h) continue;
        if (h.entityType && h.entityType !== "hole") continue;
        if (!opts.includeHidden && h.visible === false) continue;
        var holeTime = (typeof h.holeTime === "number") ? h.holeTime : (typeof h.timingDelayMilliseconds === "number" ? h.timingDelayMilliseconds : 0);
        var rec = chMap.get((h.entityName || "") + ":::" + h.holeID) || chMap.get(String(h.holeID));
        var diamMm = (rec && rec.holeDiameterMm > 0) ? rec.holeDiameterMm : (h.holeDiameter != null ? +h.holeDiameter : 165);

        var entry = createHoleEntry({
            entityName: h.entityName || "", holeID: String(h.holeID != null ? h.holeID : hi),
            collarX: +h.startXLocation, collarY: +h.startYLocation, collarZ: +h.startZLocation,
            toeX: +h.endXLocation, toeY: +h.endYLocation, toeZ: +h.endZLocation,
            holeDiamMm: diamMm, holeType: h.holeType || "Production",
            benchHeight: +(h.benchHeight || 0), subdrillLength: +(h.subdrillLength || h.subdrillAmount || 0),
            holeTime: holeTime
        });
        entry.burden = +(h.burden || 0);
        entry.spacing = +(h.spacing || 0);
        entry.gradeZ = (typeof h.gradeZLocation === "number") ? +h.gradeZLocation : null;
        entry.massPerHole = +(h.massPerHole || 0);
        entry.rowID = h.rowID != null ? h.rowID : null;
        var holeIndex = holes.length;
        holes.push(entry);

        if (!rec || !Array.isArray(rec.decks)) continue;
        var dx = entry.toeX - entry.collarX, dy = entry.toeY - entry.collarY, dz = entry.toeZ - entry.collarZ;
        var len = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (len < 1e-6) continue;
        var ux = dx / len, uy = dy / len, uz = dz / len;

        // Primer fire times per deck
        var primersByDeck = {};
        var earliestHole = Infinity;
        for (var pi = 0; pi < (rec.primers || []).length; pi++) {
            var pm = rec.primers[pi];
            if (!pm) continue;
            var r = resolvePrimerFireMs(h, pm);
            if (r.status !== "ok" || r.fireMs == null) continue;
            var key = pm.deckID || "_";
            if (!primersByDeck[key]) primersByDeck[key] = [];
            primersByDeck[key].push({ fireMs: r.fireMs, lengthFromCollar: +(pm.lengthFromCollar || 0) });
            if (r.fireMs < earliestHole) earliestHole = r.fireMs;
        }
        entry.firstFireMs = earliestHole < Infinity ? earliestHole : holeTime;

        for (var di = 0; di < rec.decks.length; di++) {
            var dk = rec.decks[di];
            if (!dk) continue;
            var cat = (dk.product && dk.product.productCategory) || "";
            if (!_isExplosiveCategory(cat)) continue;
            if (dk.deckType !== "COUPLED" && dk.deckType !== "DECOUPLED") continue;
            var top = Math.max(0, +dk.topDepth || 0), base = Math.min(len, +dk.baseDepth || 0);
            if (!(base > top)) continue;
            var prodId = dk.product && dk.product.productID;
            var prodFull = prodId ? products.get(String(prodId)) : null;
            var density = (dk.product && dk.product.density > 0) ? dk.product.density
                        : (prodFull && prodFull.density > 0 ? prodFull.density : opts.fallbackDensity);
            var vod = (prodFull && prodFull.vodMs > 0) ? prodFull.vodMs
                    : (dk.product && dk.product.vodMs > 0 ? dk.product.vodMs : opts.fallbackVOD);
            var mass = deckMassFromGeometry(dk, diamMm, density);
            var prims = primersByDeck[dk.deckID] || [];
            var timingMs = holeTime, primerFrac = 1.0;
            if (prims.length) {
                var best = prims[0];
                for (var pk = 1; pk < prims.length; pk++) if (prims[pk].fireMs < best.fireMs) best = prims[pk];
                timingMs = best.fireMs;
                primerFrac = Math.max(0, Math.min(1, (best.lengthFromCollar - top) / (base - top)));
            } else if (earliestHole < Infinity) {
                timingMs = earliestHole;
            }
            decks.push(createDeckEntry({
                deckType: dk.deckType,
                topX: entry.collarX + ux * top, topY: entry.collarY + uy * top, topZ: entry.collarZ + uz * top,
                baseX: entry.collarX + ux * base, baseY: entry.collarY + uy * base, baseZ: entry.collarZ + uz * base,
                mass: mass, density: density, vod: vod,
                productName: (dk.product && dk.product.name) || "",
                holeDiamMm: diamMm,
                chargeDiamMm: dk.deckType === "DECOUPLED" && dk.product && dk.product.diameterMm > 0 ? dk.product.diameterMm : diamMm,
                timingMs: timingMs, holeIndex: holeIndex, primerFraction: primerFrac
            }));
        }
    }

    // Surfaces
    var surfaces = [];
    var surfList = Array.isArray(data.surfaces) ? data.surfaces : Object.values(data.surfaces || {});
    var bins = data.geometryBins || {};
    for (var si = 0; si < surfList.length; si++) {
        var s = surfList[si];
        if (!s) continue;
        var name = s.name || s.id || ("Surface " + si);
        var geom = bins[s.id || s.name || String(si)] || inlineSurfaceGeometry(s);
        if (!geom) continue;
        surfaces.push({ id: s.id || name, name: name, role: surfaceRole(name), pos: geom.pos, idx: geom.idx, np: geom.np, nt: geom.nt });
    }

    return {
        holes: holes, decks: decks, surfaces: surfaces, products: products,
        raw: { manifest: data.manifest || null, holes: holesRaw, charging: data.charging || null, products: data.products || null, surfaces: surfList }
    };
}

/**
 * Inline surface geometry → { pos, idx, np, nt }. Handles indexed
 * (points[] + triangles[{a,b,c}]), soup (triangles[{vertices:[…]}]) and
 * legacy vertices/faces arrays.
 * @param {Object} s
 * @returns {Object|null}
 */
export function inlineSurfaceGeometry(s) {
    if (s.vertices && s.faces && s.vertices.length && s.faces.length) {
        var npL = s.vertices.length, ntL = s.faces.length;
        var posL = new Float64Array(npL * 3), idxL = new Uint32Array(ntL * 3);
        for (var i0 = 0; i0 < npL; i0++) { posL[i0 * 3] = s.vertices[i0][0]; posL[i0 * 3 + 1] = s.vertices[i0][1]; posL[i0 * 3 + 2] = s.vertices[i0][2]; }
        for (var t0 = 0; t0 < ntL; t0++) { idxL[t0 * 3] = s.faces[t0][0]; idxL[t0 * 3 + 1] = s.faces[t0][1]; idxL[t0 * 3 + 2] = s.faces[t0][2]; }
        return { pos: posL, idx: idxL, np: npL, nt: ntL };
    }
    var tris = s.triangles;
    if (!tris || !tris.length) return null;
    if (s.points && s.points.length && tris[0] && tris[0].a !== undefined) {
        var np1 = s.points.length, nt1 = tris.length;
        var pos1 = new Float64Array(np1 * 3), idx1 = new Uint32Array(nt1 * 3);
        for (var i = 0; i < np1; i++) { var p = s.points[i]; pos1[i * 3] = +p.x; pos1[i * 3 + 1] = +p.y; pos1[i * 3 + 2] = +p.z; }
        for (var t = 0; t < nt1; t++) { var tr = tris[t]; idx1[t * 3] = tr.a; idx1[t * 3 + 1] = tr.b; idx1[t * 3 + 2] = tr.c; }
        return { pos: pos1, idx: idx1, np: np1, nt: nt1 };
    }
    if (tris[0] && tris[0].vertices) {
        var nt2 = tris.length, np2 = nt2 * 3;
        var pos2 = new Float64Array(np2 * 3), idx2 = new Uint32Array(nt2 * 3);
        var vi = 0;
        for (var t2 = 0; t2 < nt2; t2++) {
            var vv = tris[t2].vertices;
            if (!vv || vv.length < 3) return null;
            for (var k = 0; k < 3; k++) { pos2[vi * 3] = +vv[k].x; pos2[vi * 3 + 1] = +vv[k].y; pos2[vi * 3 + 2] = +vv[k].z; idx2[t2 * 3 + k] = vi; vi++; }
        }
        return { pos: pos2, idx: idx2, np: np2, nt: nt2 };
    }
    return null;
}
