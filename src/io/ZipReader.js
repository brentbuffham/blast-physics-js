/**
 * ZipReader.js — Minimal dependency-free ZIP reader (stored + deflate)
 *
 * Author: Brent Buffham — blastingapps.com & kirra-design.com
 * License: MIT
 *
 * Reads the central directory of a ZIP archive and extracts entries.
 * DEFLATE entries are inflated with the platform DecompressionStream
 * ('deflate-raw') — available in modern browsers and Node ≥ 18. An
 * alternative inflater can be injected for other runtimes:
 *
 *   readZip(buffer, { inflateRaw: async (u8) => Uint8Array })
 *
 * ZIP64 archives are not supported (KAP files are well under 4 GB).
 */

/**
 * Parse the central directory.
 * @param {ArrayBuffer} buffer
 * @returns {{ dv: DataView, u8: Uint8Array, entries: Map<string, {method, compSize, uncompSize, lho}> }}
 */
export function readZipDirectory(buffer) {
    var dv = new DataView(buffer);
    var u8 = new Uint8Array(buffer);
    var eocd = -1;
    var scanStart = Math.max(0, buffer.byteLength - 65558);
    for (var i = buffer.byteLength - 22; i >= scanStart; i--) {
        if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error("ZipReader: not a ZIP archive (no end-of-central-directory record)");
    var total = dv.getUint16(eocd + 10, true);
    var cdOffset = dv.getUint32(eocd + 16, true);

    var entries = new Map();
    var p = cdOffset;
    var td = new TextDecoder();
    for (var n = 0; n < total; n++) {
        if (dv.getUint32(p, true) !== 0x02014b50) throw new Error("ZipReader: bad central directory entry");
        var method = dv.getUint16(p + 10, true);
        var compSize = dv.getUint32(p + 20, true);
        var uncompSize = dv.getUint32(p + 24, true);
        var nameLen = dv.getUint16(p + 28, true);
        var extraLen = dv.getUint16(p + 30, true);
        var commentLen = dv.getUint16(p + 32, true);
        var lho = dv.getUint32(p + 42, true);
        var name = td.decode(u8.subarray(p + 46, p + 46 + nameLen));
        entries.set(name, { method: method, compSize: compSize, uncompSize: uncompSize, lho: lho });
        p += 46 + nameLen + extraLen + commentLen;
    }
    return { dv: dv, u8: u8, entries: entries };
}

/**
 * Default raw-deflate inflater using DecompressionStream.
 * @param {Uint8Array} comp
 * @returns {Promise<Uint8Array>}
 */
export async function inflateRawDefault(comp) {
    if (typeof DecompressionStream === "undefined") {
        throw new Error("ZipReader: DecompressionStream unavailable — pass options.inflateRaw");
    }
    var ds = new DecompressionStream("deflate-raw");
    var stream = new Blob([comp]).stream().pipeThrough(ds);
    var buf = await new Response(stream).arrayBuffer();
    return new Uint8Array(buf);
}

/**
 * Extract one entry as bytes.
 * @param {Object} zip  - from readZipDirectory
 * @param {string} name - entry path
 * @param {Object} [options] - { inflateRaw }
 * @returns {Promise<Uint8Array|null>} null when the entry does not exist
 */
export async function zipExtract(zip, name, options) {
    var e = zip.entries.get(name);
    if (!e) return null;
    var dv = zip.dv;
    if (dv.getUint32(e.lho, true) !== 0x04034b50) throw new Error("ZipReader: bad local header for " + name);
    var nameLen = dv.getUint16(e.lho + 26, true);
    var extraLen = dv.getUint16(e.lho + 28, true);
    var start = e.lho + 30 + nameLen + extraLen;
    var comp = zip.u8.subarray(start, start + e.compSize);
    if (e.method === 0) return new Uint8Array(comp);
    if (e.method === 8) {
        var inflate = (options && options.inflateRaw) || inflateRawDefault;
        return await inflate(comp);
    }
    throw new Error("ZipReader: unsupported compression method " + e.method + " for " + name);
}

/**
 * Extract one entry as UTF-8 text.
 * @returns {Promise<string|null>}
 */
export async function zipExtractText(zip, name, options) {
    var u8 = await zipExtract(zip, name, options);
    if (!u8) return null;
    return new TextDecoder().decode(u8);
}

/**
 * Extract one entry as parsed JSON.
 * @returns {Promise<*|null>}
 */
export async function zipExtractJSON(zip, name, options) {
    var text = await zipExtractText(zip, name, options);
    if (text == null) return null;
    return JSON.parse(text);
}

/**
 * Convenience: read a ZIP and expose entry list + extract helpers.
 * @param {ArrayBuffer} buffer
 * @param {Object} [options] - { inflateRaw }
 * @returns {{ names: string[], has(name), bytes(name), text(name), json(name) }}
 */
export function readZip(buffer, options) {
    var zip = readZipDirectory(buffer);
    return {
        names: Array.from(zip.entries.keys()),
        has: function (name) { return zip.entries.has(name); },
        bytes: function (name) { return zipExtract(zip, name, options); },
        text: function (name) { return zipExtractText(zip, name, options); },
        json: function (name) { return zipExtractJSON(zip, name, options); }
    };
}
