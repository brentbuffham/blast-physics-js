/**
 * io.test.js — ZIP reader, KAP reader, monitor CSV parsers
 *
 * Author: Brent Buffham — blastingapps.com & kirra-design.com
 */

import { describe, it, expect } from "vitest";
import { deflateRawSync } from "zlib";
import { readZip, readZipDirectory, zipExtractJSON } from "../src/io/ZipReader.js";
import { parseKAP, parseKAPObjects, surfaceRole, resolvePrimerFireMs, deckMassFromGeometry } from "../src/io/KAPReader.js";
import { parseInstantelCSV, parseTexcelCSV, parseMonitorCSV, looksLikeInstantelCSV, looksLikeTexcelCSV, peakVectorSum } from "../src/io/MonitorCSV.js";

// ── Minimal ZIP writer for tests (stored or deflate, no CRC validation needed by reader) ──
function buildZip(entries) {
    const enc = new TextEncoder();
    const parts = [], central = [];
    let offset = 0;
    for (const e of entries) {
        const nameB = enc.encode(e.name);
        const raw = e.data instanceof Uint8Array ? e.data : enc.encode(e.data);
        const method = e.deflate ? 8 : 0;
        const comp = e.deflate ? new Uint8Array(deflateRawSync(Buffer.from(raw))) : raw;
        const lh = new Uint8Array(30 + nameB.length);
        const dv = new DataView(lh.buffer);
        dv.setUint32(0, 0x04034b50, true); dv.setUint16(8, method, true);
        dv.setUint32(18, comp.length, true); dv.setUint32(22, raw.length, true); dv.setUint16(26, nameB.length, true);
        lh.set(nameB, 30);
        const cd = new Uint8Array(46 + nameB.length);
        const cv = new DataView(cd.buffer);
        cv.setUint32(0, 0x02014b50, true); cv.setUint16(10, method, true);
        cv.setUint32(20, comp.length, true); cv.setUint32(24, raw.length, true); cv.setUint16(28, nameB.length, true);
        cv.setUint32(42, offset, true);
        cd.set(nameB, 46);
        parts.push(lh, comp); central.push(cd);
        offset += lh.length + comp.length;
    }
    const cdSize = central.reduce((s, c) => s + c.length, 0);
    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, entries.length, true); ev.setUint16(10, entries.length, true);
    ev.setUint32(12, cdSize, true); ev.setUint32(16, offset, true);
    const total = offset + cdSize + 22;
    const out = new Uint8Array(total);
    let p = 0;
    for (const b of parts) { out.set(b, p); p += b.length; }
    for (const c of central) { out.set(c, p); p += c.length; }
    out.set(eocd, p);
    return out.buffer;
}

const holesJSON = [
    { entityName: "B1", entityType: "hole", holeID: "1", startXLocation: 100, startYLocation: 200, startZLocation: 50, endXLocation: 100, endYLocation: 200, endZLocation: 38,
      gradeZLocation: 40, benchHeight: 10, subdrillLength: 2, holeDiameter: 115, holeTime: 100, burden: 3, spacing: 3.5, massPerHole: 90 },
    { entityName: "B1", entityType: "hole", holeID: "2", startXLocation: 103.5, startYLocation: 200, startZLocation: 50, endXLocation: 103.5, endYLocation: 200, endZLocation: 38,
      gradeZLocation: 40, benchHeight: 10, subdrillLength: 2, holeDiameter: 115, holeTime: 125, burden: 3, spacing: 3.5, massPerHole: 90 },
    { entityName: "B1", entityType: "hole", holeID: "3", visible: false, startXLocation: 107, startYLocation: 200, startZLocation: 50, endXLocation: 107, endYLocation: 200, endZLocation: 38, holeTime: 150 }
];
const explosive = { productID: "p-anfo", name: "ANFO", productCategory: "BulkExplosive", density: 0.85 };
const stemming = { productID: "p-stem", name: "STEM", productCategory: "NonExplosive", density: 2 };
const chargingJSON = [
    ["B1:::1", { holeID: "1", entityName: "B1", holeDiameterMm: 115, decks: [
        { deckID: "d1s", deckType: "INERT", topDepth: 0, baseDepth: 3, product: stemming },
        { deckID: "d1c", deckType: "COUPLED", topDepth: 3, baseDepth: 12, product: explosive } ],
      primers: [ { primerID: "pr1", deckID: "d1c", lengthFromCollar: 11, detonator: { initiatorType: "ShockTube", delayMs: 500, deliveryVodMs: 2000 } } ] }],
    ["B1:::2", { holeID: "2", entityName: "B1", holeDiameterMm: 115, decks: [
        { deckID: "d2c", deckType: "COUPLED", topDepth: 3, baseDepth: 12, product: explosive } ],
      primers: [ { primerID: "pr2", deckID: "d2c", lengthFromCollar: 11, detonator: { initiatorType: "Electronic", delayMs: 642 } } ] }]
];
const productsJSON = [["k1", Object.assign({ vodMs: 4200 }, explosive)]];
const surfacesJSON = [
    { id: "s1", name: "PREBLAST_VOLUME", points: [{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, { x: 0, y: 10, z: 0 }], triangles: [{ a: 0, b: 1, c: 2 }] },
    { id: "s2", name: "POSTBLAST_MUCK", triangles: [{ vertices: [{ x: 0, y: 0, z: 1 }, { x: 10, y: 0, z: 1 }, { x: 0, y: 10, z: 1 }] }] },
    { id: "s3", name: "BIG_TOPO", geometryBin: { pos: "geometry/big.pos", idx: "geometry/big.idx", np: 3, nt: 1 } }
];

describe("ZipReader", () => {
    it("reads stored and deflated entries", async () => {
        const buf = buildZip([{ name: "a.json", data: JSON.stringify({ hi: 1 }) }, { name: "b.txt", data: "hello world ".repeat(50), deflate: true }]);
        const zip = readZip(buf);
        expect(zip.names).toEqual(["a.json", "b.txt"]);
        expect(await zip.json("a.json")).toEqual({ hi: 1 });
        expect((await zip.text("b.txt")).startsWith("hello world")).toBe(true);
        expect(await zip.bytes("missing")).toBeNull();
        expect(await zipExtractJSON(readZipDirectory(buf), "a.json")).toEqual({ hi: 1 });
    });

    it("throws on non-zip", () => {
        expect(() => readZipDirectory(new ArrayBuffer(10))).toThrow();
    });
});

describe("KAPReader", () => {
    it("surfaceRole classifies names", () => {
        expect(surfaceRole("PREBLAST_VOLUME")).toBe("voxelblk");
        expect(surfaceRole("VOXEL-BLK-1")).toBe("voxelblk");
        expect(surfaceRole("SHELL")).toBe("shell");
        expect(surfaceRole("bench minus volume")).toBe("shell");
        expect(surfaceRole("PREBLAST_SURFACE")).toBe("shelltopo");
        expect(surfaceRole("221225_Topo")).toBe("shelltopo");
        expect(surfaceRole("POSTBLAST_MUCKPILE")).toBe("reference");
        expect(surfaceRole("SCHEDULE_VOLUME")).toBe("other");
    });

    it("resolves primer fire times (cascade vs electronic vs surface)", () => {
        const hole = { holeTime: 100 };
        expect(resolvePrimerFireMs(hole, { lengthFromCollar: 10, detonator: { initiatorType: "ShockTube", delayMs: 500, deliveryVodMs: 2000 } }).fireMs).toBeCloseTo(605, 9);
        expect(resolvePrimerFireMs(hole, { detonator: { initiatorType: "Electronic", delayMs: 0 } })).toEqual({ fireMs: 0, status: "ok" });
        expect(resolvePrimerFireMs(hole, { detonator: { initiatorType: "Electronic", delayMs: null } }).status).toBe("unresolved-electronic");
        expect(resolvePrimerFireMs(hole, { detonator: { initiatorType: "SurfaceConnector", delayMs: 17 } }).status).toBe("non-firing");
    });

    it("deck mass from geometry", () => {
        const m = deckMassFromGeometry({ deckType: "COUPLED", topDepth: 3, baseDepth: 12 }, 115, 0.85);
        expect(m).toBeCloseTo(Math.PI * 0.0575 * 0.0575 * 9 * 850, 6);
        const dm = deckMassFromGeometry({ deckType: "DECOUPLED", topDepth: 0, baseDepth: 2, product: { diameterMm: 50, lengthMm: 400 }, packageCount: 5 }, 115, 1.15);
        expect(dm).toBeCloseTo(5 * Math.PI * 0.025 * 0.025 * 0.4 * 1150, 6);
    });

    it("parseKAPObjects builds holes, decks (mass, timing, primer fraction) and surfaces", () => {
        const kap = parseKAPObjects({ holes: holesJSON, charging: chargingJSON, products: productsJSON, surfaces: surfacesJSON.slice(0, 2) });
        expect(kap.holes.length).toBe(2);                     // hidden hole skipped
        expect(kap.decks.length).toBe(2);
        const d1 = kap.decks[0];
        expect(d1.holeIndex).toBe(0);
        expect(d1.topZ).toBeCloseTo(47, 6);
        expect(d1.baseZ).toBeCloseTo(38, 6);
        expect(d1.mass).toBeCloseTo(Math.PI * 0.0575 * 0.0575 * 9 * 850, 6);
        expect(d1.vod).toBe(4200);
        expect(d1.timingMs).toBeCloseTo(100 + 500 + 5.5, 6);  // cascade
        expect(d1.primerFraction).toBeCloseTo((11 - 3) / 9, 6);
        expect(kap.decks[1].timingMs).toBe(642);             // electronic absolute
        expect(kap.holes[0].firstFireMs).toBeCloseTo(605.5, 6);
        expect(kap.holes[0].burden).toBe(3);
        expect(kap.holes[0].gradeZ).toBe(40);
        expect(kap.surfaces.length).toBe(2);
        expect(kap.surfaces[0].role).toBe("voxelblk");
        expect(kap.surfaces[1].role).toBe("reference");
        expect(kap.surfaces[1].nt).toBe(1);
        expect(kap.products.get("p-anfo").vodMs).toBe(4200);
        const withHidden = parseKAPObjects({ holes: holesJSON, charging: [] }, { includeHidden: true });
        expect(withHidden.holes.length).toBe(3);
    });

    it("parseKAP reads a ZIP with binary geometry sidecars", async () => {
        const pos = new Float64Array([0, 0, 5, 20, 0, 5, 0, 20, 5]);
        const idx = new Uint32Array([0, 1, 2]);
        const buf = buildZip([
            { name: "manifest.json", data: JSON.stringify({ kapVersion: "1.0.0" }) },
            { name: "holes.json", data: JSON.stringify(holesJSON), deflate: true },
            { name: "charging.json", data: JSON.stringify(chargingJSON), deflate: true },
            { name: "products.json", data: JSON.stringify(productsJSON) },
            { name: "surfaces.json", data: JSON.stringify(surfacesJSON) },
            { name: "geometry/big.pos", data: new Uint8Array(pos.buffer), deflate: true },
            { name: "geometry/big.idx", data: new Uint8Array(idx.buffer) }
        ]);
        const kap = await parseKAP(buf);
        expect(kap.raw.manifest.kapVersion).toBe("1.0.0");
        expect(kap.holes.length).toBe(2);
        expect(kap.decks.length).toBe(2);
        expect(kap.surfaces.length).toBe(3);
        const big = kap.surfaces.find(s => s.name === "BIG_TOPO");
        expect(big.role).toBe("shelltopo");
        expect(big.np).toBe(3);
        expect(Array.from(big.pos)).toEqual(Array.from(pos));
        // Uint8Array input path + legacy flat JSON path
        const kap2 = await parseKAP(new Uint8Array(buf));
        expect(kap2.holes.length).toBe(2);
        const flat = await parseKAP(new TextEncoder().encode(JSON.stringify({ holes: holesJSON, surfaces: [{ name: "PREBLAST_SURFACE", vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], faces: [[0, 1, 2]] }] })).buffer);
        expect(flat.holes.length).toBe(2);
        expect(flat.surfaces[0].role).toBe("shelltopo");
    });
});

describe("MonitorCSV", () => {
    const instantel = '"EventType","Full Waveform"\n"SampleRate","2048 sps"\n"Units","mm/s"\n"Tran","Vert","Long"\n"0.1","0.2","0.3"\n"-0.4","0.5","0.6"\n"0.7","-0.8","0.9"\n';
    const texcel = "Sample Time,RADIAL,TRANSVERSE,VERTICAL,MICROPHONE,,,,,\n[s],[mm/s],[mm/s],[mm/s],[Pa],,,,,\n0.000,1,2,3,0,,,,Frequency [Hz],1000,,,\n0.001,4,5,6,0,,,,Monitor:,7917,Calibrated:,28/05/2025\n0.002,7,8,9,0,,,,,\n";

    it("parses Instantel", () => {
        expect(looksLikeInstantelCSV(instantel)).toBe(true);
        const r = parseInstantelCSV(instantel);
        expect(r.sampleRateHz).toBe(2048);
        expect(Array.from(r.channels.Tran)).toEqual([0.1, -0.4, 0.7].map(v => Math.fround(v)));
        expect(r.metadata.Units).toBe("mm/s");
    });

    it("parses Texcel with channel remap and sidecar metadata", () => {
        expect(looksLikeTexcelCSV(texcel)).toBe(true);
        const r = parseTexcelCSV(texcel);
        expect(r.sampleRateHz).toBe(1000);
        expect(Array.from(r.channels.Long)).toEqual([1, 4, 7]);   // RADIAL → Long
        expect(Array.from(r.channels.Tran)).toEqual([2, 5, 8]);
        expect(Array.from(r.channels.Vert)).toEqual([3, 6, 9]);
        expect(r.metadata.Monitor).toBe("7917");
        expect(r.metadata.Calibrated).toBe("28/05/2025");
    });

    it("auto-detects and computes peak vector sum", () => {
        const r = parseMonitorCSV(texcel);
        expect(r.vendor).toBe("texcel");
        const pvs = peakVectorSum(r.channels);
        expect(pvs.pvs).toBeCloseTo(Math.sqrt(7 * 7 + 8 * 8 + 9 * 9), 6);
        expect(pvs.idx).toBe(2);
        expect(() => parseMonitorCSV("nothing,here")).toThrow();
    });
});
