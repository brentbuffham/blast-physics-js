/**
 * InitialVelocity.js — Per-block launch velocities for the blast movement simulator
 *
 * Author: Brent Buffham — blastingapps.com & kirra-design.com
 * License: MIT
 *
 * Two launch models:
 *
 * 1) YANG 3DMuck KINEMATIC LOADING (Yang & Kavetsky 1990; Yang 2020) — default.
 *    Each explosive deck is split into charge elements; a block receives
 *      |ΔV| = Pe · ρe · d² · Δl / (4 · r^b)
 *    from every element of every hole firing within the timing window of the
 *    block's motion time (its dominant hole), summed VECTORIALLY. Direction
 *    emerges from charge geometry: collar rock lifts, mid-bench heaves
 *    radially, toe pulls outward. Between cooperating charges the horizontal
 *    vector sum cancels; that confined momentum is recovered (steer c) and
 *    pointed down the timing gradient (toward relief).
 *
 * 2) ENERGY-PARTITION DEPTH-ZONE model — simpler alternative.
 *      v0 = √(2 · η · E · PF / ρ)   per hole (PF = mass / (B·S·H) kg/bcm)
 *    Direction: timing gradient blended with radial fan-out; depth zones from
 *    the charge column (stemming zone held back and more vertical, sub-grade
 *    flatter).
 *
 * Ported from the Kirra blast-throw simulator (prepareEnergetics /
 * assignThrowVectors, both generations).
 */

export var ELEM_RCUT = 14;      // m — element contribution cutoff
export var PE_SCALE = 0.35;     // Pe=1.0, b=1.5, steer 0.7 → ~17 m/s median on SWELLFACTOR
export var MAX_LAUNCH_SPEED = 45; // m/s hard cap

export var YANG_DEFAULTS = {
    Pe: 1.0,            // explosive strength parameter (scales all velocities)
    bExp: 1.5,          // attenuation exponent (energy decays 1/r^b)
    cSteer: 0.85,       // relief steering + confined-momentum recovery
    timingWindowMs: 40, // charges cooperate within this window of the block's motion time
    fallbackVelocity: 5,// m/s when no charge element reaches the block
    rockDensity: 2650,  // kg/bcm; v ∝ √(2650/ρ)
    jitter: 0.1         // ±10 % random scatter on velocity
};

export var ENERGY_DEFAULTS = {
    energyKJkg: 3000,   // explosive energy (kJ/kg) → E (J/kg)
    efficiency: 0.05,   // η — fraction of energy converted to kinetic
    verticalRatio: 0.35,// vertical/horizontal launch ratio
    fallbackVelocity: 5,
    rockDensity: 2650,
    maxSpeed: 40
};

/**
 * Sim-hole records from HoleEntry + DeckEntry lists.
 * @param {Array} holeEntries
 * @param {Array} deckEntries
 * @param {Object} [opts] - { fireTimeSource: 'deck'|'hole' (default 'deck') }
 * @returns {Array<{ index, id, cx,cy,cz, tx,ty,tz, diameter, fireT, mass, burden, spacing, gradeZ, benchHeight, stemLen, chargeBaseDepth, explDecks }>}
 */
export function simHolesFromEntries(holeEntries, deckEntries, opts) {
    opts = opts || {};
    var useDeck = opts.fireTimeSource !== "hole";
    var holes = [];
    for (var i = 0; i < holeEntries.length; i++) {
        var h = holeEntries[i];
        holes.push({
            index: i, id: String(h.holeID != null ? h.holeID : i), entityName: h.entityName || "",
            cx: h.collarX, cy: h.collarY, cz: h.collarZ, tx: h.toeX, ty: h.toeY, tz: h.toeZ,
            diameter: (h.holeDiamMm > 0 ? h.holeDiamMm : 165) / 1000,
            fireT: (h.holeTime || 0) / 1000,
            mass: h.massPerHole > 0 ? h.massPerHole : 0,
            burden: h.burden > 0 ? h.burden : 0, spacing: h.spacing > 0 ? h.spacing : 0,
            gradeZ: (typeof h.gradeZ === "number") ? h.gradeZ : (h.benchHeight > 0 ? h.collarZ - h.benchHeight : null),
            benchHeight: h.benchHeight > 0 ? h.benchHeight : 0,
            stemLen: 0, chargeBaseDepth: 0, explDecks: null, _deckFire: Infinity, _deckMass: 0
        });
    }
    for (var d = 0; d < (deckEntries || []).length; d++) {
        var dk = deckEntries[d];
        if (!dk || !(dk.mass > 0)) continue;
        var sh = holes[dk.holeIndex];
        if (!sh) continue;
        var dxh = sh.tx - sh.cx, dyh = sh.ty - sh.cy, dzh = sh.tz - sh.cz;
        var len = Math.sqrt(dxh * dxh + dyh * dyh + dzh * dzh) || 1;
        var top = Math.sqrt((dk.topX - sh.cx) ** 2 + (dk.topY - sh.cy) ** 2 + (dk.topZ - sh.cz) ** 2);
        var base = Math.sqrt((dk.baseX - sh.cx) ** 2 + (dk.baseY - sh.cy) ** 2 + (dk.baseZ - sh.cz) ** 2);
        if (!sh.explDecks) sh.explDecks = [];
        sh.explDecks.push({ top: Math.min(top, len), base: Math.min(base, len), rho: (dk.density > 0 ? dk.density : 1.15) * 1000, mass: dk.mass });
        if (sh.stemLen === 0 || top < sh.stemLen) sh.stemLen = top;
        if (base > sh.chargeBaseDepth) sh.chargeBaseDepth = base;
        sh._deckMass += dk.mass;
        var ft = (Number(dk.timingMs) || 0) / 1000;
        if (ft < sh._deckFire) sh._deckFire = ft;
    }
    for (var k = 0; k < holes.length; k++) {
        var s = holes[k];
        if (useDeck && s._deckFire < Infinity) s.fireT = s._deckFire;
        if (!(s.mass > 0) && s._deckMass > 0) s.mass = s._deckMass;
        delete s._deckFire; delete s._deckMass;
    }
    return holes;
}

/**
 * Discretise each hole's explosive decks into charge elements
 * { x, y, z, w } with w = ρe·d²·Δl/4 (element length ≥ 0.3 m), and build a
 * 10 m XY hole bin for fast gathering.
 *
 * @param {Array} holes - sim holes (from simHolesFromEntries)
 * @returns {{ total: number, bin: { mnX, mnY, cell, nx, ny, bins } }}
 */
export function prepareChargeElements(holes) {
    var total = 0;
    for (var hi = 0; hi < holes.length; hi++) {
        var h = holes[hi];
        h.elems = [];
        var hdx = h.tx - h.cx, hdy = h.ty - h.cy, hdz = h.tz - h.cz;
        var len = Math.sqrt(hdx * hdx + hdy * hdy + hdz * hdz);
        if (len < 0.1) continue;
        var ux = hdx / len, uy = hdy / len, uz = hdz / len;
        var d = h.diameter > 0.01 ? h.diameter : 0.165;
        var decks = h.explDecks;
        if (!decks || !decks.length) {
            var top = h.stemLen > 0 ? h.stemLen : Math.min(2.5, len * 0.25);
            decks = [{ top: top, base: len, rho: 1150 }];
        }
        var el = Math.max(d, 0.3);
        for (var di = 0; di < decks.length; di++) {
            var dk = decks[di];
            var t0 = Math.max(0, dk.top), b0 = Math.min(len, dk.base);
            for (var sd = t0 + el / 2; sd < b0; sd += el) {
                h.elems.push({ x: h.cx + ux * sd, y: h.cy + uy * sd, z: h.cz + uz * sd, w: (dk.rho || 1150) * d * d * el / 4 });
                total++;
            }
        }
    }
    var mnX = Infinity, mnY = Infinity, mxX = -Infinity, mxY = -Infinity;
    for (var i = 0; i < holes.length; i++) {
        mnX = Math.min(mnX, holes[i].cx); mxX = Math.max(mxX, holes[i].cx);
        mnY = Math.min(mnY, holes[i].cy); mxY = Math.max(mxY, holes[i].cy);
    }
    var cell = 10;
    var nx = Math.max(1, Math.ceil((mxX - mnX) / cell) + 1);
    var ny = Math.max(1, Math.ceil((mxY - mnY) / cell) + 1);
    var bins = new Array(nx * ny);
    for (var j = 0; j < holes.length; j++) {
        var ci = Math.min(nx - 1, Math.max(0, Math.floor((holes[j].cx - mnX) / cell)));
        var cj = Math.min(ny - 1, Math.max(0, Math.floor((holes[j].cy - mnY) / cell)));
        var c = cj * nx + ci;
        if (!bins[c]) bins[c] = [];
        bins[c].push(j);
    }
    return { total: total, bin: { mnX: mnX, mnY: mnY, cell: cell, nx: nx, ny: ny, bins: bins } };
}

/**
 * Nearest hole (by distance to the hole axis segment) for a world point,
 * using a coarse XY bin. Returns [holeIndex, distance].
 * @param {Array} holes
 * @param {Object} hb  - hole bin (from buildHoleBin)
 * @param {number} wx @param {number} wy @param {number} wz
 * @returns {[number, number]}
 */
export function nearestHole(holes, hb, wx, wy, wz) {
    var ci = Math.min(hb.nx - 1, Math.max(0, Math.floor((wx - hb.mnX) / hb.cell)));
    var cj = Math.min(hb.ny - 1, Math.max(0, Math.floor((wy - hb.mnY) / hb.cell)));
    var best = -1, bestD = Infinity;
    for (var ring = 0; ring <= 3; ring++) {
        for (var dj = -ring; dj <= ring; dj++) {
            for (var di = -ring; di <= ring; di++) {
                if (Math.max(Math.abs(di), Math.abs(dj)) !== ring) continue;
                var ii = ci + di, jj = cj + dj;
                if (ii < 0 || ii >= hb.nx || jj < 0 || jj >= hb.ny) continue;
                var bin = hb.bins[jj * hb.nx + ii];
                if (!bin) continue;
                for (var b = 0; b < bin.length; b++) {
                    var h = holes[bin[b]];
                    var dx = h.tx - h.cx, dy = h.ty - h.cy, dz = h.tz - h.cz;
                    var L2 = dx * dx + dy * dy + dz * dz;
                    var t = L2 > 1e-6 ? ((wx - h.cx) * dx + (wy - h.cy) * dy + (wz - h.cz) * dz) / L2 : 0;
                    t = Math.max(0, Math.min(1, t));
                    var qx = h.cx + t * dx, qy = h.cy + t * dy, qz = h.cz + t * dz;
                    var d = Math.sqrt((wx - qx) * (wx - qx) + (wy - qy) * (wy - qy) + (wz - qz) * (wz - qz));
                    if (d < bestD) { bestD = d; best = bin[b]; }
                }
            }
        }
        if (best >= 0 && bestD < ring * hb.cell) break;
    }
    if (best < 0) {
        for (var k = 0; k < holes.length; k++) {
            var hh = holes[k];
            var dd = Math.sqrt((wx - hh.cx) * (wx - hh.cx) + (wy - hh.cy) * (wy - hh.cy));
            if (dd < bestD) { bestD = dd; best = k; }
        }
    }
    return [best, bestD];
}

/**
 * Yang 3DMuck kinematic launch velocities.
 *
 * @param {Object} S      - particle state: N, ox,oy,oz (local in-situ), nearH, ivx,ivy,ivz, at
 * @param {{x,y,z}} origin- local-frame origin (world = local + origin)
 * @param {Array}  holes  - sim holes with elems + thDirX/thDirY + fireT
 * @param {Object} hb     - hole bin (from prepareChargeElements)
 * @param {Object} [params] - YANG_DEFAULTS overrides
 * @param {() => number} [rng=Math.random]
 * @returns {number} v0Max (m/s)
 */
export function assignYangVelocities(S, origin, holes, hb, params, rng) {
    var p = Object.assign({}, YANG_DEFAULTS, params || {});
    var rand = rng || Math.random;
    var N = S.N;
    if (!holes.length || !N || !hb) return 0;
    var rhoScale = Math.sqrt(2650 / Math.max(1000, p.rockDensity));
    var Pe = p.Pe * PE_SCALE * rhoScale;
    var bExp = p.bExp, cSteer = p.cSteer;
    var Tw = p.timingWindowMs / 1000;
    var fallbackV = p.fallbackVelocity;
    var rcut2 = ELEM_RCUT * ELEM_RCUT;
    var jit = p.jitter;
    var vMax = 0;

    for (var i = 0; i < N; i++) {
        var hi = S.nearH[i];
        if (hi < 0) continue;
        var hd = holes[hi];
        var tb = hd.fireT;
        var wx = S.ox[i] + origin.x, wy = S.oy[i] + origin.y, wz = S.oz[i] + origin.z;

        var vx = 0, vy = 0, vz = 0, hPot = 0;
        var ci = Math.min(hb.nx - 1, Math.max(0, Math.floor((wx - hb.mnX) / hb.cell)));
        var cj = Math.min(hb.ny - 1, Math.max(0, Math.floor((wy - hb.mnY) / hb.cell)));
        for (var dj = -2; dj <= 2; dj++) {
            for (var di = -2; di <= 2; di++) {
                var ii = ci + di, jj = cj + dj;
                if (ii < 0 || ii >= hb.nx || jj < 0 || jj >= hb.ny) continue;
                var bin = hb.bins[jj * hb.nx + ii];
                if (!bin) continue;
                for (var b = 0; b < bin.length; b++) {
                    var hj = holes[bin[b]];
                    if (Math.abs(hj.fireT - tb) > Tw) continue;
                    var pdx = wx - hj.cx, pdy = wy - hj.cy;
                    if (pdx * pdx + pdy * pdy > rcut2 * 1.4) continue;
                    var elems = hj.elems;
                    if (!elems) continue;
                    for (var e = 0; e < elems.length; e++) {
                        var el = elems[e];
                        var ex = wx - el.x, ey = wy - el.y, ez = wz - el.z;
                        var r2 = ex * ex + ey * ey + ez * ez;
                        if (r2 > rcut2) continue;
                        var r = Math.sqrt(r2);
                        if (r < 0.3) r = 0.3;
                        var m = Pe * el.w / Math.pow(r, bExp + 1);
                        vx += m * ex; vy += m * ey; vz += m * ez;
                        hPot += m * Math.sqrt(ex * ex + ey * ey);
                    }
                }
            }
        }

        if (vx === 0 && vy === 0 && vz === 0) {
            var rdx = wx - hd.cx, rdy = wy - hd.cy;
            var rL = Math.sqrt(rdx * rdx + rdy * rdy) || 1;
            vx = rdx / rL * fallbackV; vy = rdy / rL * fallbackV; vz = fallbackV * 0.25;
        } else if (hd.thDirX !== 0 || hd.thDirY !== 0) {
            var hLen = Math.sqrt(vx * vx + vy * vy);
            var hMag = hLen + cSteer * 0.6 * Math.max(0, hPot - hLen);
            var steerW = Math.min(cSteer, 1);
            var ix, iy;
            if (hLen > 0.01) { ix = vx / hLen; iy = vy / hLen; }
            else { ix = hd.thDirX; iy = hd.thDirY; }
            var bx = (1 - steerW) * ix + steerW * hd.thDirX;
            var by = (1 - steerW) * iy + steerW * hd.thDirY;
            var bl = Math.sqrt(bx * bx + by * by) || 1;
            vx = hMag * bx / bl; vy = hMag * by / bl;
        }

        var j = 1 - jit + rand() * 2 * jit;
        vx *= j; vy *= j; vz *= (1 - jit + rand() * 2 * jit);
        var sp = Math.sqrt(vx * vx + vy * vy + vz * vz);
        if (sp > MAX_LAUNCH_SPEED) { var f = MAX_LAUNCH_SPEED / sp; vx *= f; vy *= f; vz *= f; sp = MAX_LAUNCH_SPEED; }

        S.ivx[i] = vx; S.ivy[i] = vy; S.ivz[i] = vz;
        S.at[i] = hd.fireT;
        if (sp > vMax) vMax = sp;
    }
    return vMax || fallbackV;
}

/**
 * Energy-partition depth-zone launch velocities (alternative model).
 *
 * @param {Object} S       - particle state: N, ox,oy,oz, nearH, nearD, ivx,ivy,ivz, at
 * @param {{x,y,z}} origin
 * @param {Array}  holes   - sim holes (mass, burden, spacing, benchHeight, gradeZ, stemLen, thDir)
 * @param {Object} [params] - ENERGY_DEFAULTS overrides
 * @param {() => number} [rng]
 * @returns {number} v0Max
 */
export function assignEnergyPartitionVelocities(S, origin, holes, params, rng) {
    var p = Object.assign({}, ENERGY_DEFAULTS, params || {});
    var rand = rng || Math.random;
    var N = S.N;
    if (!holes.length || !N) return 0;
    var eJ = p.energyKJkg * 1000;
    var medS = 0, cnt = 0;
    for (var h0 = 0; h0 < holes.length; h0++) if (holes[h0].spacing > 0) { medS += holes[h0].spacing; cnt++; }
    medS = cnt ? medS / cnt : 5;

    var v0Max = 0;
    for (var hi = 0; hi < holes.length; hi++) {
        var h = holes[hi];
        var B = h.burden > 0 ? h.burden : medS;
        var Sp = h.spacing > 0 ? h.spacing : medS;
        var BH = h.benchHeight > 0 ? h.benchHeight : (h.gradeZ != null ? Math.max(1, h.cz - h.gradeZ) : 10);
        if (h.mass > 0) {
            var pf = h.mass / (B * Sp * BH);
            h.v0 = Math.min(p.maxSpeed, Math.sqrt(2 * p.efficiency * eJ * pf / p.rockDensity));
            h.pf = pf;
        } else { h.v0 = p.fallbackVelocity; h.pf = 0; }
        h.chargeTopZ = (h.stemLen > 0) ? h.cz - h.stemLen : null;
        h.spacingEff = Sp;
        if (h.v0 > v0Max) v0Max = h.v0;
    }

    for (var i = 0; i < N; i++) {
        var idx = S.nearH[i];
        if (idx < 0) continue;
        var hh = holes[idx];
        var wx = S.ox[i] + origin.x, wy = S.oy[i] + origin.y, wz = S.oz[i] + origin.z;
        var rdx = wx - hh.cx, rdy = wy - hh.cy;
        var rL = Math.sqrt(rdx * rdx + rdy * rdy);
        if (rL > 0.01) { rdx /= rL; rdy /= rL; } else { rdx = 1; rdy = 0; }
        var dX, dY;
        if (hh.thDirX !== 0 || hh.thDirY !== 0) {
            dX = hh.thDirX * 0.8 + rdx * 0.2; dY = hh.thDirY * 0.8 + rdy * 0.2;
            var dL = Math.sqrt(dX * dX + dY * dY) || 1; dX /= dL; dY /= dL;
        } else { dX = rdx; dY = rdy; }
        var f = 1 - 0.3 * Math.min(S.nearD[i] / hh.spacingEff, 1);
        var vertR = p.verticalRatio;
        if (hh.chargeTopZ != null && wz > hh.chargeTopZ) { f *= 0.55; vertR = Math.max(vertR, 0.5); }
        else if (hh.gradeZ != null && wz < hh.gradeZ) { f *= 0.5; vertR = vertR * 0.5; }
        var vm = hh.v0 * f;
        S.ivx[i] = dX * vm * (0.9 + rand() * 0.2);
        S.ivy[i] = dY * vm * (0.9 + rand() * 0.2);
        S.ivz[i] = vm * vertR * (0.6 + rand() * 0.8);
        S.at[i] = hh.fireT;
    }
    return v0Max || p.fallbackVelocity;
}
