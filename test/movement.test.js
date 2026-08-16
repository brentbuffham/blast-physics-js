/**
 * movement.test.js — Voxeliser, shell collider, throw directions, launch velocities,
 *                    sphere DEM, simulator orchestration and results
 *
 * Author: Brent Buffham — blastingapps.com & kirra-design.com
 */

import { describe, it, expect } from "vitest";
import { voxeliseVolumes, voxeliseVolumesBudget, voxeliseHoleBBox } from "../src/movement/Voxeliser.js";
import { buildShellBin, shellCollide, lidExclusionKeys, occKey } from "../src/movement/ShellCollider.js";
import { computeThrowDirections, estimateSpacing } from "../src/movement/ThrowDirections.js";
import { simHolesFromEntries, prepareChargeElements, nearestHole, assignYangVelocities, assignEnergyPartitionVelocities } from "../src/movement/InitialVelocity.js";
import { createParticleState, assignBlockRadii, SpatialHash, physicsStep, resetParticleState, ST_INACTIVE, ST_ACTIVE, ST_REST } from "../src/movement/SphereDEM.js";
import { BlastMovementSimulator } from "../src/movement/BlastMovementSimulator.js";
import { surfaceBounds, flattenTriangles, rasterTop, columnThickness, calibrationGrid, surfaceFromHeightfield } from "../src/movement/SurfaceMesh.js";
import { displacementVectors, centreOfMassShift, swellPrescribed, swellEmergent, muckpileHeightfield, surveyTargets } from "../src/movement/Displacement.js";
import { hullPoints } from "../src/movement/RapierEngine.js";
import { createHoleEntry } from "../src/core/HoleEntry.js";
import { createDeckEntry } from "../src/core/DeckEntry.js";
import { mulberry32 } from "../src/signal/Detune.js";

// ── Synthetic geometry helpers ────────────────────────────────────────────
function boxSurface(name, x0, x1, y0, y1, z0, z1) {
    const P = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
    const F = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]];
    const pos = new Float64Array(P.flat()), idx = new Uint32Array(F.flat());
    return { id: name, name, role: name.includes("VOLUME") ? "voxelblk" : "other", pos, idx, np: 8, nt: 12 };
}
function planeSurface(name, role, x0, x1, y0, y1, z) {
    const pos = new Float64Array([x0, y0, z, x1, y0, z, x1, y1, z, x0, y1, z]);
    const idx = new Uint32Array([0, 1, 2, 0, 2, 3]);
    return { id: name, name, role, pos, idx, np: 4, nt: 2 };
}
// Bench: block 0..24 x 0..12 x z 0..10 sits on a floor at z=0; free face at y=0 (south).
// Rows at y = 3, 7, 11 firing 0 / 42 / 84 ms → throw toward −Y.
function benchPattern() {
    const holes = [], decks = [];
    let hi = 0;
    for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 4; c++) {
            const x = 3 + c * 6, y = 3 + r * 4;
            holes.push(createHoleEntry({ entityName: "T", holeID: String(hi + 1), collarX: x, collarY: y, collarZ: 10, toeX: x, toeY: y, toeZ: -1, holeDiamMm: 165, benchHeight: 10, subdrillLength: 1, holeTime: r * 42 }));
            holes[hi].burden = 4; holes[hi].spacing = 6; holes[hi].gradeZ = 0; holes[hi].massPerHole = 200;
            decks.push(createDeckEntry({ deckType: "COUPLED", topX: x, topY: y, topZ: 7, baseX: x, baseY: y, baseZ: -1, mass: 200, density: 1.2, vod: 5000, holeDiamMm: 165, timingMs: r * 42 + 500, holeIndex: hi }));
            hi++;
        }
    }
    const surfaces = [
        boxSurface("PREBLAST_VOLUME", 0, 24, 0, 12, 0, 10),
        planeSurface("SHELL", "shell", -60, 100, -120, 60, 0)   // remaining floor as trusted confinement
    ];
    return { holes, decks, surfaces };
}

describe("Voxeliser", () => {
    it("fills a 24×12×10 box at 2 m → 12×6×5 = 360 voxels, all inside", () => {
        const box = boxSurface("PREBLAST_VOLUME", 0, 24, 0, 12, 0, 10);
        const r = voxeliseVolumes([box], 2);
        expect(r.count).toBe(360);
        for (let i = 0; i < r.count; i++) {
            expect(r.positions[i * 3]).toBeGreaterThan(0); expect(r.positions[i * 3]).toBeLessThan(24);
            expect(r.positions[i * 3 + 2]).toBeGreaterThan(0); expect(r.positions[i * 3 + 2]).toBeLessThan(10);
        }
        expect(r.bboxMinZ).toBe(0);
    });

    it("budget coarsens resolution to respect maxVoxels", () => {
        const box = boxSurface("PREBLAST_VOLUME", 0, 24, 0, 12, 0, 10);
        const r = voxeliseVolumesBudget([box], 1, 100);
        expect(r.count).toBeLessThanOrEqual(100);
        expect(r.res).toBeGreaterThan(1);
    });

    it("hole bbox fallback produces a lattice", () => {
        const { holes } = benchPattern();
        const r = voxeliseHoleBBox(holes, 3, { maxVoxels: 500 });
        expect(r.count).toBeGreaterThan(0);
        expect(r.count).toBeLessThanOrEqual(500);
    });

    it("returns null for no volumes", () => {
        expect(voxeliseVolumes([], 2)).toBeNull();
    });
});

describe("ShellCollider", () => {
    it("bins triangles and pushes a penetrating sphere back above a floor", () => {
        const floor = planeSurface("SHELL", "shell", -10, 10, -10, 10, 0);
        const flat = flattenTriangles([floor]);
        const SB = buildShellBin(flat, null);
        expect(SB.ready).toBe(true);
        expect(SB.nt).toBe(2);
        // Point (5,−5) lies inside the first triangle only (below the quad diagonal)
        const S = { px: new Float32Array([5]), py: new Float32Array([-5]), pz: new Float32Array([0.5]), vx: new Float32Array([1]), vy: new Float32Array([0]), vz: new Float32Array([-3]) };
        const hit = shellCollide(SB, S, 0, 0.1, 0.5, 1.0);
        expect(hit).toBe(true);
        expect(S.pz[0]).toBeCloseTo(1.0, 5);
        expect(S.vz[0]).toBeGreaterThan(0);              // bounced with restitution
        expect(S.vx[0]).toBeLessThan(1);                 // friction damped tangential
    });

    it("lid exclusion strips triangles over the voxel footprint", () => {
        // 4 m lid: triangle centroids fall in the 2 m columns adjacent to the voxel column
        const lid = planeSurface("TOPO", "shelltopo", -2, 2, -2, 2, 5);
        const flat = flattenTriangles([lid]);
        const keys = lidExclusionKeys(new Float64Array([0, 0, 1]), 1);
        expect(keys.has(occKey(0, 0))).toBe(true);
        const SB = buildShellBin(flat, keys);
        expect(SB.excluded).toBe(2);
        expect(SB.ready).toBe(false);
    });
});

describe("ThrowDirections", () => {
    it("points from late-firing toward early-firing ground (−Y here)", () => {
        const { holes, decks } = benchPattern();
        const sim = simHolesFromEntries(holes, decks);
        expect(estimateSpacing(sim)).toBeCloseTo(4, 6);      // rows 4 m apart are the nearest neighbours
        computeThrowDirections(sim);
        for (const h of sim) {
            expect(h.thDirY).toBeLessThan(-0.99);
            expect(Math.abs(h.thDirX)).toBeLessThan(0.05);
        }
    });

    it("flat timing gives zero vectors", () => {
        const holes = [{ cx: 0, cy: 0, fireT: 0 }, { cx: 5, cy: 0, fireT: 0 }, { cx: 0, cy: 5, fireT: 0 }, { cx: 5, cy: 5, fireT: 0 }];
        computeThrowDirections(holes);
        holes.forEach(h => { expect(h.thDirX).toBe(0); expect(h.thDirY).toBe(0); });
    });
});

describe("InitialVelocity", () => {
    it("simHolesFromEntries: deck fire time and stemming from decks", () => {
        const { holes, decks } = benchPattern();
        const sim = simHolesFromEntries(holes, decks);
        expect(sim[0].fireT).toBeCloseTo(0.5, 9);          // deck timing 500 ms
        expect(sim[4].fireT).toBeCloseTo(0.542, 9);
        expect(sim[0].stemLen).toBeCloseTo(3, 6);
        expect(sim[0].explDecks.length).toBe(1);
        const simHole = simHolesFromEntries(holes, decks, { fireTimeSource: "hole" });
        expect(simHole[4].fireT).toBeCloseTo(0.042, 9);
    });

    it("prepareChargeElements discretises decks; nearestHole finds the closest axis", () => {
        const { holes, decks } = benchPattern();
        const sim = simHolesFromEntries(holes, decks);
        const prep = prepareChargeElements(sim);
        // 8 m deck at 0.3 m elements (≥ hole diameter): 27 elements per hole × 12 holes
        expect(sim[0].elems.length).toBe(27);
        expect(prep.total).toBe(12 * 27);
        expect(sim[0].elems[0].w).toBeCloseTo(1200 * 0.165 * 0.165 * 0.3 / 4, 6);
        const nh = nearestHole(sim, prep.bin, 3.2, 3.1, 5);
        expect(nh[0]).toBe(0);
        expect(nh[1]).toBeCloseTo(Math.hypot(0.2, 0.1), 6);
    });

    it("Yang velocities: near-face blocks launch toward −Y with sane magnitudes; energy model too", () => {
        const { holes, decks } = benchPattern();
        const sim = simHolesFromEntries(holes, decks);
        computeThrowDirections(sim);
        const prep = prepareChargeElements(sim);
        const S = createParticleState(3);
        const origin = { x: 0, y: 0, z: 0 };
        // Blocks in front of row 1 (y=1), mid-bench, and above stemming
        const pts = [[3, 1, 4], [9, 1, 4], [3, 3, 9]];
        for (let i = 0; i < 3; i++) {
            S.ox[i] = pts[i][0]; S.oy[i] = pts[i][1]; S.oz[i] = pts[i][2];
            const nh = nearestHole(sim, prep.bin, pts[i][0], pts[i][1], pts[i][2]);
            S.nearH[i] = nh[0]; S.nearD[i] = nh[1];
        }
        const v0 = assignYangVelocities(S, origin, sim, prep.bin, {}, mulberry32(1));
        expect(v0).toBeGreaterThan(1);
        expect(v0).toBeLessThanOrEqual(45);
        expect(S.ivy[0]).toBeLessThan(0);                  // toward the free face
        expect(S.at[0]).toBeCloseTo(0.5, 9);
        expect(S.ivz[2]).toBeGreaterThan(0);               // collar block lifts
        const S2 = createParticleState(3);
        S2.ox.set(S.ox); S2.oy.set(S.oy); S2.oz.set(S.oz); S2.nearH.set(S.nearH); S2.nearD.set(S.nearD);
        const v0e = assignEnergyPartitionVelocities(S2, origin, sim, {}, mulberry32(1));
        expect(v0e).toBeGreaterThan(0);
        expect(S2.ivy[0]).toBeLessThan(0);
    });
});

describe("SphereDEM", () => {
    it("a launched block falls under gravity, hits the ground plane and comes to rest", () => {
        const S = createParticleState(1);
        assignBlockRadii(S, 1, 0, mulberry32(3));
        S.ox[0] = 0; S.oy[0] = 0; S.oz[0] = 5; S.px[0] = 0; S.py[0] = 0; S.pz[0] = 5;
        S.ivx[0] = 2; S.ivy[0] = 0; S.ivz[0] = 0; S.at[0] = 0; S.groundZ = 0;
        const H = new SpatialHash(1, 1.5);
        const P = { g: 9.81, restitution: 0.1, friction: 0.5, bulkT: 0.6, maxSwell: 1.4, swellCapLin: Math.cbrt(1.4) };
        let t = 0, r = { active: 0, resting: 0 };
        for (let k = 0; k < 2000; k++) { t += 0.005; r = physicsStep(S, H, null, 0.005, t, P, mulberry32(k)); if (r.active === 0 && t > 0.5) break; }
        expect(S.state[0]).toBe(ST_REST);
        expect(S.pz[0]).toBeCloseTo(S.rad[0], 1);
        expect(S.px[0]).toBeGreaterThan(0.5);
        expect(S.rad[0]).toBeCloseTo(S.baseRad[0] * Math.cbrt(1.4), 3);  // fully bulked
        resetParticleState(S);
        expect(S.state[0]).toBe(ST_INACTIVE);
        expect(S.pz[0]).toBe(5);
        expect(S.rad[0]).toBe(S.baseRad[0]);
    });

    it("two overlapping active spheres separate", () => {
        const S = createParticleState(2);
        assignBlockRadii(S, 1, 0, mulberry32(5));
        S.px[0] = 0; S.px[1] = 0.3; S.pz[0] = S.pz[1] = 10; S.state[0] = S.state[1] = ST_ACTIVE;
        S.at[0] = S.at[1] = -1; S.groundZ = -100;
        const H = new SpatialHash(2, 1.5);
        physicsStep(S, H, null, 0.005, 0, { g: 0, restitution: 0.1, friction: 0.5, bulking: false }, mulberry32(1));
        expect(S.px[1] - S.px[0]).toBeGreaterThan(0.3);
    });
});

describe("BlastMovementSimulator", () => {
    it("runs the synthetic bench to a settled pile thrown toward the free face with swell near target", () => {
        const data = benchPattern();
        const sim = new BlastMovementSimulator({ voxelRes: 2, maxVoxels: 2000, seed: 42, maxSwell: 1.4 });
        sim.load(data);
        expect(sim.shellTrusted).toBe(true);
        const N = sim.generateVoxels();
        expect(N).toBe(360);
        expect(sim.S.v0Max).toBeGreaterThan(0);
        const r = sim.run({ maxTime: 20 });
        expect(r.steps).toBeGreaterThan(100);
        const res = sim.results();
        expect(res.blockCount).toBe(360);
        expect(res.comShift.dy).toBeLessThan(-1);          // moved toward −Y (free face)
        expect(res.comShift.bearing).toBeGreaterThan(120); // roughly south
        expect(res.comShift.bearing).toBeLessThan(240);
        expect(res.swell).toBeGreaterThan(1.2);
        expect(res.swell).toBeLessThan(1.5);
        expect(res.vectors.count).toBe(360);
        expect(res.heightfield.surface).not.toBeNull();
        expect(res.heightfield.surface.nt).toBeGreaterThan(0);
        // No block below the floor (shell + ground plane hold)
        for (let i = 0; i < sim.S.N; i++) expect(sim.S.pz[i] + sim.origin.z).toBeGreaterThan(-sim.S.rad[i] - 0.05);
        // fired blocks are resting or the run timed out
        const restFrac = res.stats.resting / N;
        expect(restFrac).toBeGreaterThan(0.5);
    });

    it("reset restores in-situ; energy model runs; async run works", async () => {
        const data = benchPattern();
        const sim = new BlastMovementSimulator({ voxelRes: 3, maxVoxels: 500, seed: 1, velocityModel: "energy" });
        sim.load(data); sim.generateVoxels();
        const px0 = Array.from(sim.S.px);
        const r = await sim.runAsync({ maxTime: 8, chunkSteps: 200 });
        expect(r.steps).toBeGreaterThan(0);
        expect(sim.time).toBeGreaterThan(0);
        sim.reset();
        expect(sim.time).toBe(0);
        expect(Array.from(sim.S.px)).toEqual(px0);
    });

    it("bbox fallback when no volume mesh; step() before load is safe", () => {
        const data = benchPattern();
        const sim = new BlastMovementSimulator({ voxelRes: 3, maxVoxels: 300, seed: 2 });
        expect(sim.step().active).toBe(0);
        sim.load({ holes: data.holes, decks: data.decks, surfaces: [] });
        const N = sim.generateVoxels();
        expect(N).toBeGreaterThan(0);
        expect(N).toBeLessThanOrEqual(300);
    });
});

describe("SurfaceMesh / Displacement", () => {
    it("rasterTop, columnThickness and calibrationGrid on a box", () => {
        const box = boxSurface("PREBLAST_VOLUME", 0, 24, 0, 12, 0, 10);
        expect(surfaceBounds([box])).toEqual({ minX: 0, minY: 0, minZ: 0, maxX: 24, maxY: 12, maxZ: 10 });
        const G = calibrationGrid([box], 4, 2);
        const top = rasterTop([box], G);
        const vc = columnThickness([box], G);
        let volume = 0, topInside = 0;
        for (let q = 0; q < G.nx * G.ny; q++) { volume += vc.thick[q] * 4; if (top[q] > 9.99) topInside++; }
        expect(volume).toBeCloseTo(24 * 12 * 10, -1);
        expect(topInside).toBe(12 * 6);
        const hf = surfaceFromHeightfield(top, G, { name: "T" });
        expect(hf.nt).toBeGreaterThan(0);
    });

    it("surveyTargets recovers swell and CoM shift from synthetic pre/post surfaces", () => {
        // In-situ box 0..24 × 0..12 × 0..10 ; muck: box shifted −Y by 6 m and 14 m tall on the floor
        const vol = boxSurface("PREBLAST_VOLUME", 0, 24, 0, 12, 0, 10);
        const floor = planeSurface("SHELL", "shell", -40, 60, -40, 40, 0);
        const post = planeSurface("POSTBLAST", "reference", 0, 24, -6, 6, 14);
        const t = surveyTargets([vol, floor, post]);
        expect(t.err).toBeUndefined();
        expect(t.swell).toBeCloseTo(1.4, 1);
        expect(t.dy).toBeCloseTo(-6, 0);
        expect(Math.abs(t.dx)).toBeLessThan(0.5);
        expect(t.bearing).toBeCloseTo(180, 0);
        expect(surveyTargets([vol]).err).toBeTruthy();
    });

    it("displacement / swell / heightfield helpers on a tiny state", () => {
        const S = createParticleState(2);
        assignBlockRadii(S, 2, 0, mulberry32(9));
        S.ox[0] = 0; S.oy[0] = 0; S.oz[0] = 0; S.px[0] = 3; S.py[0] = 4; S.pz[0] = 0; S.state[0] = ST_REST;
        S.ox[1] = 5; S.oy[1] = 5; S.oz[1] = 0; S.px[1] = 5; S.py[1] = 5; S.pz[1] = 0; S.state[1] = ST_INACTIVE;
        const v = displacementVectors(S, { x: 100, y: 200, z: 300 });
        expect(v.count).toBe(1);
        expect(v.dist[0]).toBeCloseTo(5, 6);
        expect(v.x1[0]).toBe(103);
        const c = centreOfMassShift(S);
        expect(c.D).toBeCloseTo(5, 6);
        expect(swellPrescribed(S)).toBe(1);
        expect(swellEmergent(S)).toBeGreaterThan(0);
        const hf = muckpileHeightfield(S, { x: 0, y: 0, z: 0 }, 2, { firedOnly: false });
        expect(hf.grid.nx).toBeGreaterThan(0);
        expect(hullPoints("dodec").length).toBe(20);
        expect(hullPoints("cube").length).toBe(8);
    });
});
