/**
 * SphereDEM.js — Sphere discrete-element engine for blast throw
 *
 * Author: Brent Buffham — blastingapps.com & kirra-design.com
 * License: MIT
 *
 * Blocks are spheres with per-block radii (fragmentation-shaped size scatter),
 * launched at their hole's fire time with the velocity from InitialVelocity.js
 * and integrated with gravity, spatial-hash sphere–sphere contacts (two
 * Jacobi passes, mass-weighted by ρr³), static shell / topo collision and a
 * ground plane. Detached fragments bulk toward the target swell factor over
 * `bulkT` seconds so the pile arrives pre-bulked. Blocks that stay slow in
 * contact for 12 sub-steps come to rest and become immovable, and can be
 * re-activated when hit hard enough by a heavier block.
 *
 * States: 0 INACTIVE (in-situ, unfired) · 1 ACTIVE · 2 REST (settled muck).
 *
 * All positions are LOCAL (world − origin) Float32 for precision.
 * Ported from the Kirra blast-throw simulator (throw_4 sphere DEM).
 */

import { shellCollide } from "./ShellCollider.js";

export var ST_INACTIVE = 0;
export var ST_ACTIVE = 1;
export var ST_REST = 2;

export var SUB_DT = 0.005;   // s — fixed physics sub-step

export var DEM_DEFAULTS = {
    g: 9.81,
    restitution: 0.1,
    friction: 0.5,
    bulkT: 0.6,          // s to reach full swelled size
    maxSwell: 1.4,       // target volumetric swell factor
    sizeVariationPct: 35 // fragment size scatter (0..70)
};

/**
 * Allocate a particle state for N blocks.
 * @param {number} N
 * @returns {Object} typed-array bundle
 */
export function createParticleState(N) {
    var S = {
        N: N,
        px: new Float32Array(N), py: new Float32Array(N), pz: new Float32Array(N),
        vx: new Float32Array(N), vy: new Float32Array(N), vz: new Float32Array(N),
        ox: new Float32Array(N), oy: new Float32Array(N), oz: new Float32Array(N),
        ivx: new Float32Array(N), ivy: new Float32Array(N), ivz: new Float32Array(N),
        at: new Float32Array(N),
        state: new Uint8Array(N), restC: new Uint8Array(N),
        dist: new Float32Array(N),
        rx: new Float32Array(N), ry: new Float32Array(N), rz: new Float32Array(N),
        wx: new Float32Array(N), wy: new Float32Array(N), wz: new Float32Array(N),
        qx: new Float32Array(N * 4),
        contact: new Uint8Array(N),
        nearH: new Int32Array(N), nearD: new Float32Array(N),
        baseRad: new Float32Array(N), rad: new Float32Array(N),
        radius: 0, baseR: 0, groundZ: -10, v0Max: 0
    };
    for (var i = 0; i < N; i++) S.qx[i * 4 + 3] = 1;
    return S;
}

/**
 * Assign per-block base radii with fragmentation-shaped scatter
 * (Rosin–Rammler flavour: many smaller, few up to +15 %).
 * @param {Object} S
 * @param {number} res  - voxel edge (m); nominal radius = 0.47·res
 * @param {number} sizeVariationPct
 * @param {() => number} [rng]
 */
export function assignBlockRadii(S, res, sizeVariationPct, rng) {
    var rand = rng || Math.random;
    var sizeVar = (sizeVariationPct || 0) / 100;
    S.radius = 0.47 * res;
    S.baseR = S.radius;
    for (var i = 0; i < S.N; i++) {
        var u = rand();
        var f = Math.max(0.25, 1 + rand() * 0.15 - sizeVar * Math.pow(u, 1.5));
        S.baseRad[i] = S.baseR * f;
        S.rad[i] = S.baseRad[i];
    }
}

/**
 * Spatial hash for sphere–sphere contacts.
 */
export class SpatialHash {
    /**
     * @param {number} N        - block count
     * @param {number} cellSize - ≥ 2 × max radius
     */
    constructor(N, cellSize) {
        this.cellSize = cellSize;
        this.size = 2 * N;
        this.count = new Int32Array(this.size + 1);
        this.entries = new Int32Array(N);
    }
    key(xi, yi, zi) {
        var h = (xi * 92837111) ^ (yi * 689287499) ^ (zi * 283923481);
        return Math.abs(h) % this.size;
    }
    build(S) {
        var cs = this.cellSize, N = S.N, H = this;
        H.count.fill(0);
        for (var i = 0; i < N; i++) H.count[H.key(Math.floor(S.px[i] / cs), Math.floor(S.py[i] / cs), Math.floor(S.pz[i] / cs))]++;
        var sum = 0;
        for (var c = 0; c < H.size; c++) { sum += H.count[c]; H.count[c] = sum; }
        H.count[H.size] = sum;
        for (var j = 0; j < N; j++) {
            var h = H.key(Math.floor(S.px[j] / cs), Math.floor(S.py[j] / cs), Math.floor(S.pz[j] / cs));
            H.count[h]--;
            H.entries[H.count[h]] = j;
        }
    }
}

/**
 * One Jacobi pass of sphere–sphere collision resolution.
 * @param {Object} S
 * @param {SpatialHash} H
 * @param {number} rest
 * @param {number} fric
 */
export function solveParticleCollisions(S, H, rest, fric) {
    var cs = H.cellSize, N = S.N;
    var tfAA = 1 - fric * 0.02;
    var tfAS = 1 - fric * 0.04;
    var rad = S.rad;
    for (var i = 0; i < N; i++) {
        if (S.state[i] !== ST_ACTIVE) continue;
        var cxi = Math.floor(S.px[i] / cs), cyi = Math.floor(S.py[i] / cs), czi = Math.floor(S.pz[i] / cs);
        for (var dx = -1; dx <= 1; dx++) for (var dy = -1; dy <= 1; dy++) for (var dz = -1; dz <= 1; dz++) {
            var h = H.key(cxi + dx, cyi + dy, czi + dz);
            var start = H.count[h], end = H.count[h + 1];
            for (var k = start; k < end; k++) {
                var j = H.entries[k];
                if (j === i) continue;
                var st_j = S.state[j];
                if (st_j === ST_ACTIVE && j < i) continue;
                var ddx = S.px[j] - S.px[i], ddy = S.py[j] - S.py[i], ddz = S.pz[j] - S.pz[i];
                var d2 = ddx * ddx + ddy * ddy + ddz * ddz;
                var minDist = rad[i] + rad[j];
                if (d2 >= minDist * minDist || d2 < 1e-9) continue;
                var d = Math.sqrt(d2);
                var inv = 1 / d;
                ddx *= inv; ddy *= inv; ddz *= inv;
                var overlap = minDist - d;
                if (st_j !== ST_ACTIVE) {
                    // Static: in-situ rock or settled muck — immovable
                    S.px[i] -= ddx * overlap; S.py[i] -= ddy * overlap; S.pz[i] -= ddz * overlap;
                    var vn = S.vx[i] * ddx + S.vy[i] * ddy + S.vz[i] * ddz;
                    if (vn > 0) {
                        S.vx[i] -= (1 + rest) * vn * ddx; S.vy[i] -= (1 + rest) * vn * ddy; S.vz[i] -= (1 + rest) * vn * ddz;
                        if (st_j === ST_REST && vn * (rad[i] * rad[i] * rad[i]) / (rad[j] * rad[j] * rad[j]) > 1.2) {
                            S.state[j] = ST_ACTIVE; S.restC[j] = 0;
                            S.vx[j] += vn * 0.4 * ddx; S.vy[j] += vn * 0.4 * ddy; S.vz[j] += vn * 0.4 * ddz;
                        }
                    }
                    S.vx[i] *= tfAS; S.vy[i] *= tfAS;
                    S.contact[i] = 1;
                } else {
                    // Mass-weighted response: m ∝ ρr³
                    var mi = rad[i] * rad[i] * rad[i], mj = rad[j] * rad[j] * rad[j];
                    var wi = mj / (mi + mj), wj = 1 - wi;
                    S.px[i] -= ddx * overlap * wi; S.py[i] -= ddy * overlap * wi; S.pz[i] -= ddz * overlap * wi;
                    S.px[j] += ddx * overlap * wj; S.py[j] += ddy * overlap * wj; S.pz[j] += ddz * overlap * wj;
                    var rvx = S.vx[j] - S.vx[i], rvy = S.vy[j] - S.vy[i], rvz = S.vz[j] - S.vz[i];
                    var vrel = rvx * ddx + rvy * ddy + rvz * ddz;
                    if (vrel < 0) {
                        var imp = -(1 + rest) * vrel;
                        S.vx[i] -= imp * wi * ddx; S.vy[i] -= imp * wi * ddy; S.vz[i] -= imp * wi * ddz;
                        S.vx[j] += imp * wj * ddx; S.vy[j] += imp * wj * ddy; S.vz[j] += imp * wj * ddz;
                        S.vx[i] *= tfAA; S.vy[i] *= tfAA; S.vx[j] *= tfAA; S.vy[j] *= tfAA;
                    }
                }
            }
        }
    }
}

/**
 * Advance the DEM by dt seconds.
 *
 * @param {Object} S       - particle state
 * @param {SpatialHash} H
 * @param {Object|null} SB - shell collider (buildShellBin) or null
 * @param {number} dt
 * @param {number} time    - simulation clock AFTER this step (s) — blocks with at <= time launch
 * @param {Object} P       - { g, restitution, friction, bulkT, swellCapLin, bulking: bool }
 * @param {() => number} [rng]
 * @returns {{ active: number, resting: number }}
 */
export function physicsStep(S, H, SB, dt, time, P, rng) {
    var rand = rng || Math.random;
    var g = P.g, rest = P.restitution, fric = P.friction;
    var N = S.N, gz = S.groundZ;
    var bulking = P.bulking !== false;
    var swellCapLin = P.swellCapLin > 0 ? P.swellCapLin : Math.cbrt(P.maxSwell || 1.4);
    var bulkT = P.bulkT > 0 ? P.bulkT : 0.6;

    for (var i = 0; i < N; i++) {
        if (S.state[i] === ST_INACTIVE && time >= S.at[i]) {
            S.state[i] = ST_ACTIVE;
            S.vx[i] = S.ivx[i]; S.vy[i] = S.ivy[i]; S.vz[i] = S.ivz[i];
            var sp = Math.sqrt(S.vx[i] * S.vx[i] + S.vy[i] * S.vy[i] + S.vz[i] * S.vz[i]) / S.rad[i] * 0.4;
            S.wx[i] = (rand() - 0.5) * sp; S.wy[i] = (rand() - 0.5) * sp; S.wz[i] = (rand() - 0.5) * sp;
        }
        if (S.state[i] !== ST_ACTIVE) continue;
        S.vz[i] -= g * dt;
        S.px[i] += S.vx[i] * dt; S.py[i] += S.vy[i] * dt; S.pz[i] += S.vz[i] * dt;
        S.rx[i] += S.wx[i] * dt; S.ry[i] += S.wy[i] * dt; S.rz[i] += S.wz[i] * dt;
        if (bulking) {
            var capR = S.baseRad[i] * swellCapLin;
            if (S.rad[i] < capR) S.rad[i] = Math.min(capR, S.rad[i] + (capR - S.baseRad[i]) * dt / bulkT);
        }
    }

    S.contact.fill(0);
    H.build(S);
    solveParticleCollisions(S, H, rest, fric);
    solveParticleCollisions(S, H, rest, fric);

    var activeN = 0, restN = 0;
    for (var k = 0; k < N; k++) {
        var st = S.state[k];
        if (st === ST_REST) { restN++; continue; }
        if (st !== ST_ACTIVE) continue;
        activeN++;
        var ri = S.rad[k];
        var contact = S.contact[k] !== 0;
        if (SB && shellCollide(SB, S, k, rest, fric, ri)) contact = true;
        if (S.pz[k] < gz + ri) {
            S.pz[k] = gz + ri;
            if (S.vz[k] < 0) S.vz[k] *= -rest;
            var tf = 1 - fric * 0.25;
            S.vx[k] *= tf; S.vy[k] *= tf;
            contact = true;
        }
        if (contact) { S.contact[k] = 1; S.wx[k] *= 0.85; S.wy[k] *= 0.85; S.wz[k] *= 0.85; }
        var spd2 = S.vx[k] * S.vx[k] + S.vy[k] * S.vy[k] + S.vz[k] * S.vz[k];
        var fullyBulked = !bulking || S.rad[k] >= S.baseRad[k] * swellCapLin * 0.95;
        if (contact && spd2 < 0.04 && fullyBulked) {
            S.restC[k]++;
            if (S.restC[k] > 12) {
                S.state[k] = ST_REST;
                S.vx[k] = 0; S.vy[k] = 0; S.vz[k] = 0; S.wx[k] = 0; S.wy[k] = 0; S.wz[k] = 0;
            }
        } else if (S.restC[k] > 0 && spd2 > 0.09) {
            S.restC[k] = 0;
        }
        var ddx = S.px[k] - S.ox[k], ddy = S.py[k] - S.oy[k], ddz = S.pz[k] - S.oz[k];
        S.dist[k] = Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz);
    }
    return { active: activeN, resting: restN };
}

/**
 * Reset a state to in-situ (positions, velocities, radii, flags).
 * @param {Object} S
 */
export function resetParticleState(S) {
    var N = S.N;
    for (var i = 0; i < N; i++) {
        S.px[i] = S.ox[i]; S.py[i] = S.oy[i]; S.pz[i] = S.oz[i];
        S.vx[i] = 0; S.vy[i] = 0; S.vz[i] = 0;
        S.rx[i] = 0; S.ry[i] = 0; S.rz[i] = 0;
        S.wx[i] = 0; S.wy[i] = 0; S.wz[i] = 0;
        S.state[i] = ST_INACTIVE; S.restC[i] = 0; S.dist[i] = 0; S.contact[i] = 0;
        S.qx[i * 4] = 0; S.qx[i * 4 + 1] = 0; S.qx[i * 4 + 2] = 0; S.qx[i * 4 + 3] = 1;
    }
    S.rad.set(S.baseRad);
}
