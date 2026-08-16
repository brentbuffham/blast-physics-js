/**
 * MonitorCSV.js — Vibration monitor waveform CSV parsers (Instantel, Texcel)
 *
 * Author: Brent Buffham — blastingapps.com & kirra-design.com
 * License: MIT
 *
 * Both return the same record shape so downstream code (seed clipping,
 * signature deconvolution, site-law regression) is vendor-agnostic:
 *
 *   { sampleRateHz, channels: { Tran, Vert, Long }  (Float32Array mm/s), metadata: {…} }
 *
 * Instantel Micromate / Blastware "Export as CSV":
 *   "Key","Value" metadata rows, one "Tran","Vert","Long" header row, then samples.
 * Texcel Twf2CSV (T-Link / GTM):
 *   Sample Time,RADIAL,TRANSVERSE,VERTICAL,MICROPHONE,… with interleaved sidecar
 *   metadata in columns 8+ (Frequency [Hz] gives the sample rate).
 *   RADIAL → Long, TRANSVERSE → Tran, VERTICAL → Vert; microphone dropped.
 *
 * Extracted from Kirra's InstantelParser.js / TexcelParser.js.
 */

function _stripQuotes(s) {
    if (s == null) return "";
    s = String(s).trim();
    if (s.length >= 2 && s[0] === '"' && s[s.length - 1] === '"') return s.slice(1, -1);
    return s;
}

/** Sniff for an Instantel export. */
export function looksLikeInstantelCSV(text) {
    if (!text) return false;
    var head = text.length > 4096 ? text.slice(0, 4096) : text;
    if (/"SampleRate"\s*,\s*"[\d.]+\s*sps"/i.test(head)) return true;
    if (/"Tran"\s*,\s*"Vert"\s*,\s*"Long"/i.test(head)) return true;
    return false;
}

/**
 * Parse an Instantel waveform CSV.
 * @param {string} text
 * @returns {{ sampleRateHz, channels: { Tran, Vert, Long }, metadata }}
 */
export function parseInstantelCSV(text) {
    if (!text) throw new Error("Empty file");
    var lines = text.split(/\r?\n/);
    var metadata = {}, sampleRateHz = 0, dataStart = -1;
    for (var i = 0; i < lines.length; i++) {
        var raw = lines[i];
        if (!raw) continue;
        if (/^"?Tran"?\s*,\s*"?Vert"?\s*,\s*"?Long"?(\s*$|\s*,)/i.test(raw.trim())) { dataStart = i + 1; break; }
        var m = raw.match(/^\s*"([^"]+)"\s*,\s*"?([^"]*)"?\s*$/);
        if (m) {
            metadata[m[1]] = m[2];
            if (m[1] === "SampleRate") { var sr = parseFloat(m[2]); if (sr > 0 && isFinite(sr)) sampleRateHz = sr; }
        }
    }
    if (dataStart < 0) throw new Error("Instantel CSV: could not find \"Tran\",\"Vert\",\"Long\" data header");
    if (!(sampleRateHz > 0)) throw new Error("Instantel CSV: SampleRate not found in header");

    var N = lines.length - dataStart;
    var tran = new Float32Array(N), vert = new Float32Array(N), lng = new Float32Array(N);
    var count = 0;
    for (var k = dataStart; k < lines.length; k++) {
        var line = lines[k].trim();
        if (!line) continue;
        var parts = line.split(",");
        if (parts.length < 3) continue;
        var a = parseFloat(_stripQuotes(parts[0])), b = parseFloat(_stripQuotes(parts[1])), c = parseFloat(_stripQuotes(parts[2]));
        if (!isFinite(a) || !isFinite(b) || !isFinite(c)) continue;
        tran[count] = a; vert[count] = b; lng[count] = c; count++;
    }
    if (count < 2) throw new Error("Instantel CSV: fewer than 2 valid sample rows");
    if (count < N) { tran = tran.slice(0, count); vert = vert.slice(0, count); lng = lng.slice(0, count); }
    return { sampleRateHz: sampleRateHz, channels: { Tran: tran, Vert: vert, Long: lng }, metadata: metadata };
}

/** Sniff for a Texcel Twf2CSV export. */
export function looksLikeTexcelCSV(text) {
    if (!text) return false;
    var head = text.length > 2048 ? text.slice(0, 2048) : text;
    return /^\s*Sample\s+Time\s*,\s*RADIAL\s*,\s*TRANSVERSE\s*,\s*VERTICAL/i.test(head);
}

/**
 * Parse a Texcel waveform CSV.
 * @param {string} text
 * @returns {{ sampleRateHz, channels: { Tran, Vert, Long }, metadata }}
 */
export function parseTexcelCSV(text) {
    if (!text) throw new Error("Empty file");
    var lines = text.split(/\r?\n/);
    if (lines.length < 4) throw new Error("Texcel CSV: too few rows");
    var headerLower = (lines[0] || "").toLowerCase();
    if (headerLower.indexOf("sample time") < 0 || headerLower.indexOf("radial") < 0 ||
        headerLower.indexOf("transverse") < 0 || headerLower.indexOf("vertical") < 0) {
        throw new Error("Texcel CSV: header missing 'Sample Time,RADIAL,TRANSVERSE,VERTICAL'");
    }
    var dataStart = 2, metadata = {};
    var N = lines.length - dataStart;
    var radial = new Float32Array(N), transverse = new Float32Array(N), vertical = new Float32Array(N), times = new Float64Array(N);
    var count = 0;
    for (var i = dataStart; i < lines.length; i++) {
        var line = lines[i];
        if (!line || !line.trim()) continue;
        var parts = line.split(",");
        if (parts.length < 5) continue;
        if (parts.length >= 10) {
            var rawKey = (parts[8] || "").trim(), rawVal = (parts[9] || "").trim();
            if (rawKey && rawVal) {
                if (rawKey.charAt(rawKey.length - 1) === ":") rawKey = rawKey.slice(0, -1).trim();
                if (rawKey && !metadata[rawKey]) metadata[rawKey] = rawVal;
                if (parts.length >= 12) {
                    var rawKey2 = (parts[10] || "").trim(), rawVal2 = (parts[11] || "").trim();
                    if (rawKey2 && rawVal2) {
                        if (rawKey2.charAt(rawKey2.length - 1) === ":") rawKey2 = rawKey2.slice(0, -1).trim();
                        if (rawKey2 && !metadata[rawKey2]) metadata[rawKey2] = rawVal2;
                    }
                }
            }
        }
        var t = parseFloat(parts[0]), rR = parseFloat(parts[1]), rT = parseFloat(parts[2]), rV = parseFloat(parts[3]);
        if (!isFinite(t) || !isFinite(rR) || !isFinite(rT) || !isFinite(rV)) continue;
        times[count] = t; radial[count] = rR; transverse[count] = rT; vertical[count] = rV; count++;
    }
    if (count < 2) throw new Error("Texcel CSV: fewer than 2 valid sample rows");
    var sampleRateHz = 0;
    if (metadata["Frequency [Hz]"]) { var fr = parseFloat(metadata["Frequency [Hz]"]); if (fr > 0 && isFinite(fr)) sampleRateHz = fr; }
    if (!(sampleRateHz > 0) && count >= 2) { var dt = times[1] - times[0]; if (dt > 0 && isFinite(dt)) sampleRateHz = Math.round(1 / dt); }
    if (!(sampleRateHz > 0)) throw new Error("Texcel CSV: could not determine sample rate");
    if (count < N) { radial = radial.slice(0, count); transverse = transverse.slice(0, count); vertical = vertical.slice(0, count); }
    return { sampleRateHz: sampleRateHz, channels: { Tran: transverse, Vert: vertical, Long: radial }, metadata: metadata };
}

/**
 * Auto-detect and parse a monitor CSV.
 * @param {string} text
 * @returns {{ vendor: 'instantel'|'texcel', sampleRateHz, channels, metadata }}
 */
export function parseMonitorCSV(text) {
    if (looksLikeInstantelCSV(text)) return Object.assign({ vendor: "instantel" }, parseInstantelCSV(text));
    if (looksLikeTexcelCSV(text)) return Object.assign({ vendor: "texcel" }, parseTexcelCSV(text));
    throw new Error("parseMonitorCSV: unrecognised format (expected Instantel or Texcel export)");
}

/**
 * Peak vector sum √(T²+V²+L²) over a 3-channel record.
 * @param {{ Tran, Vert, Long }} channels
 * @returns {{ pvs: number, idx: number, tran: number, vert: number, long: number }}
 */
export function peakVectorSum(channels) {
    var T = channels.Tran, V = channels.Vert, L = channels.Long;
    var n = Math.min(T.length, V.length, L.length);
    var best = 0, bi = 0, pt = 0, pv = 0, pl = 0;
    for (var i = 0; i < n; i++) {
        var m = T[i] * T[i] + V[i] * V[i] + L[i] * L[i];
        if (m > best) { best = m; bi = i; }
        pt = Math.max(pt, Math.abs(T[i])); pv = Math.max(pv, Math.abs(V[i])); pl = Math.max(pl, Math.abs(L[i]));
    }
    return { pvs: Math.sqrt(best), idx: bi, tran: pt, vert: pv, long: pl };
}
