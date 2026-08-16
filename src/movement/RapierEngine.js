/**
 * RapierEngine.js — Optional Rapier3D rigid-body transport engine
 *
 * Author: Brent Buffham — blastingapps.com & kirra-design.com
 * License: MIT
 *
 * Division of labour (Yang 2020): 3DMuck is a LAUNCH model — charge elements
 * give each block its initial velocity (InitialVelocity.js). Rapier replaces
 * the sphere-DEM transport with convex-hull rigid bodies so swell EMERGES
 * from packing rather than being prescribed.
 *
 * Rapier is NOT a dependency of this library. Inject an initialised module:
 *
 *   import RAPIER from '@dimforge/rapier3d-compat';
 *   await RAPIER.init();
 *   const sim = new BlastMovementSimulator({ engine: new RapierEngine(RAPIER, { shape: 'cube' }) });
 *
 * In calibration on the SWELLFACTOR dataset the sphere DEM reproduced the
 * surveyed muckpile shape better than Rapier hulls; treat this engine as
 * experimental. Keep block counts near 5k with 3–4 m blocks.
 */

import { ST_INACTIVE, ST_ACTIVE, ST_REST } from "./SphereDEM.js";

export var RAPIER_DT = 1 / 120;

/**
 * Unit convex-hull point sets (scaled per block).
 * @param {string} shape - 'cube' | 'dodec' | 'para'
 * @param {number} [shear=0.6] - parallelepiped shear along X with height
 * @returns {number[][]}
 */
export function hullPoints(shape, shear) {
    var pts = [];
    if (shape === "dodec") {
        var p = (1 + Math.sqrt(5)) / 2, iv = 1 / p;
        [-1, 1].forEach(function (a) { [-1, 1].forEach(function (b) { [-1, 1].forEach(function (c) { pts.push([a, b, c]); }); }); });
        [-1, 1].forEach(function (s1) { [-1, 1].forEach(function (s2) {
            pts.push([0, s1 * iv, s2 * p]); pts.push([s1 * iv, s2 * p, 0]); pts.push([s1 * p, 0, s2 * iv]);
        }); });
    } else if (shape === "para") {
        var sh = shear != null ? shear : 0.6;
        [-1, 1].forEach(function (a) { [-1, 1].forEach(function (b) { [-1, 1].forEach(function (c) { pts.push([a + c * sh, b, c]); }); }); });
    } else {
        [-1, 1].forEach(function (a) { [-1, 1].forEach(function (b) { [-1, 1].forEach(function (c) { pts.push([a, b, c]); }); }); });
    }
    var n = Math.sqrt(3);
    return pts.map(function (v) { return [v[0] / n, v[1] / n, v[2] / n]; });
}

export class RapierEngine {
    /**
     * @param {Object} RAPIER - initialised @dimforge/rapier3d(-compat) module
     * @param {Object} [opts] - { shape='cube'|'sphere'|'dodec'|'para', shear=0.6, rockDensity=2650, linearDamping=0.05, angularDamping=0.15, groundHalfExtent=400 }
     */
    constructor(RAPIER, opts) {
        if (!RAPIER) throw new Error("RapierEngine: RAPIER module required");
        this.RAPIER = RAPIER;
        this.opts = Object.assign({ shape: "cube", shear: 0.6, rockDensity: 2650, linearDamping: 0.05, angularDamping: 0.15, groundHalfExtent: 400 }, opts || {});
        this.world = null; this.bodies = null; this.ready = false;
        this.accum = 0;
        this.emergentSwell = true;   // tells the simulator not to prescribe bulking
        this.rng = Math.random;
    }

    /** Build the world from the simulator's current state. */
    build(sim) {
        this.dispose();
        var R = this.RAPIER, S = sim.S;
        if (!S || !S.N) return false;
        var P = sim.dem;
        var world = new R.World({ x: 0, y: 0, z: -P.g });
        world.integrationParameters.dt = RAPIER_DT;

        var gBody = world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(0, 0, S.groundZ - 1));
        world.createCollider(R.ColliderDesc.cuboid(this.opts.groundHalfExtent, this.opts.groundHalfExtent, 1).setFriction(P.friction).setRestitution(P.restitution), gBody);

        if (sim.shellFlat && sim.shellFlat.length >= 9) {
            var nt = sim.shellFlat.length / 9;
            var verts = new Float32Array(sim.shellFlat);
            var idx = new Uint32Array(nt * 3);
            for (var i = 0; i < nt * 3; i++) idx[i] = i;
            try {
                var sBody = world.createRigidBody(R.RigidBodyDesc.fixed());
                world.createCollider(R.ColliderDesc.trimesh(verts, idx).setFriction(P.friction).setRestitution(P.restitution), sBody);
            } catch (e) { /* ground plane only */ }
        }

        var shape = this.opts.shape;
        var basePts = shape === "sphere" ? null : hullPoints(shape, this.opts.shear);
        var rho = this.opts.rockDensity;
        var bodies = new Array(S.N);
        for (var b = 0; b < S.N; b++) {
            var body = world.createRigidBody(
                R.RigidBodyDesc.dynamic().setTranslation(S.px[b], S.py[b], S.pz[b])
                    .setLinearDamping(this.opts.linearDamping).setAngularDamping(this.opts.angularDamping).setCcdEnabled(false));
            var cd;
            var r = S.baseRad[b];
            if (shape === "sphere") cd = R.ColliderDesc.ball(r);
            else {
                var arr = new Float32Array(basePts.length * 3);
                for (var k = 0; k < basePts.length; k++) { arr[k * 3] = basePts[k][0] * r * 1.7; arr[k * 3 + 1] = basePts[k][1] * r * 1.7; arr[k * 3 + 2] = basePts[k][2] * r * 1.7; }
                cd = R.ColliderDesc.convexHull(arr) || R.ColliderDesc.ball(r);
            }
            world.createCollider(cd.setFriction(P.friction).setRestitution(P.restitution).setDensity(rho / 1000), body);
            body.sleep();
            bodies[b] = body;
        }
        this.world = world; this.bodies = bodies; this.ready = true; this.accum = 0;
        return true;
    }

    reset(sim) { this.accum = 0; if (sim && sim.S && sim.S.N) this.build(sim); }

    dispose() {
        if (this.world) { try { this.world.free(); } catch (e) { /* ignore */ } }
        this.world = null; this.bodies = null; this.ready = false;
    }

    /**
     * Advance by dt (accumulates to RAPIER_DT steps), waking blocks whose hole
     * has fired and reading transforms back into the particle state.
     */
    step(sim, dt) {
        var S = sim.S;
        if (!this.ready) return { active: 0, resting: 0 };
        this.accum += dt;
        var stepped = 0;
        while (this.accum >= RAPIER_DT - 1e-12 && stepped < 8) {
            for (var i = 0; i < S.N; i++) {
                if (S.state[i] === ST_INACTIVE && sim.time >= S.at[i]) {
                    S.state[i] = ST_ACTIVE;
                    var b = this.bodies[i];
                    b.wakeUp();
                    b.setLinvel({ x: S.ivx[i], y: S.ivy[i], z: S.ivz[i] }, true);
                    var sp = Math.hypot(S.ivx[i], S.ivy[i], S.ivz[i]) / S.baseRad[i] * 0.25;
                    b.setAngvel({ x: (this.rng() - 0.5) * sp, y: (this.rng() - 0.5) * sp, z: (this.rng() - 0.5) * sp }, true);
                }
            }
            this.world.step();
            this.accum -= RAPIER_DT;
            stepped++;
        }
        var activeN = 0, restN = 0;
        for (var k = 0; k < S.N; k++) {
            if (S.state[k] === ST_INACTIVE) continue;
            var body = this.bodies[k];
            var t = body.translation(), q = body.rotation();
            S.px[k] = t.x; S.py[k] = t.y; S.pz[k] = t.z;
            S.qx[k * 4] = q.x; S.qx[k * 4 + 1] = q.y; S.qx[k * 4 + 2] = q.z; S.qx[k * 4 + 3] = q.w;
            if (body.isSleeping()) { S.state[k] = ST_REST; restN++; }
            else {
                activeN++;
                var v = body.linvel();
                S.vx[k] = v.x; S.vy[k] = v.y; S.vz[k] = v.z;
            }
            var dx = S.px[k] - S.ox[k], dy = S.py[k] - S.oy[k], dz = S.pz[k] - S.oz[k];
            S.dist[k] = Math.sqrt(dx * dx + dy * dy + dz * dz);
        }
        return { active: activeN, resting: restN };
    }
}
