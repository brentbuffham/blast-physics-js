/**
 * Ballistics.js — Point-mass flyrock trajectories and launch-velocity estimates
 *
 * Author: Brent Buffham — blastingapps.com & kirra-design.com
 * License: MIT
 *
 * Complements FlyrockTrajectory.js (empirical range models) with the
 * kinematics needed to draw arcs, time flight, and convert between range,
 * angle and velocity:
 *
 *   range(V, θ, Δh)      — flat-ground and elevation-difference range
 *   apex(V, θ)           — maximum height
 *   flightTime(V, θ, Δh)
 *   optimalAngle(V, Δh)  — angle giving max range for a landing Δh below launch
 *   trajectory(V, θ, …)  — sampled arc, optional quadratic air drag (Euler substeps)
 *   velocityForRange(R, θ)
 *   sphereDragConstant(d, ρr, Cd, ρair)
 *
 * The launch velocities themselves come from FlyrockTrajectory.js
 * (Richards & Moore, Lundborg, McKenzie: V₀ = √(R_base · g)).
 */

var GRAVITY = 9.80665;

/**
 * Horizontal range for launch speed V at angle θ (from horizontal), landing
 * Δh metres BELOW the launch point (negative Δh = landing above).
 * @param {number} V     - m/s
 * @param {number} thetaDeg
 * @param {number} [dropM=0]
 * @param {number} [g]
 * @returns {number} m
 */
export function ballisticRange(V, thetaDeg, dropM, g) {
    g = g || GRAVITY;
    var th = thetaDeg * Math.PI / 180;
    var vx = V * Math.cos(th), vy = V * Math.sin(th);
    var h = dropM || 0;
    var disc = vy * vy + 2 * g * h;
    if (disc < 0) return NaN;
    var t = (vy + Math.sqrt(disc)) / g;
    return vx * t;
}

/**
 * Maximum height above launch point.
 * @param {number} V
 * @param {number} thetaDeg
 * @param {number} [g]
 * @returns {number} m
 */
export function ballisticApex(V, thetaDeg, g) {
    g = g || GRAVITY;
    var vy = V * Math.sin(thetaDeg * Math.PI / 180);
    return vy * vy / (2 * g);
}

/**
 * Time of flight to a landing Δh below launch.
 * @param {number} V
 * @param {number} thetaDeg
 * @param {number} [dropM=0]
 * @param {number} [g]
 * @returns {number} s
 */
export function ballisticFlightTime(V, thetaDeg, dropM, g) {
    g = g || GRAVITY;
    var vy = V * Math.sin(thetaDeg * Math.PI / 180);
    var disc = vy * vy + 2 * g * (dropM || 0);
    if (disc < 0) return NaN;
    return (vy + Math.sqrt(disc)) / g;
}

/**
 * Launch angle giving maximum range onto a plane Δh below launch:
 *   θ* = atan( V / sqrt(V² + 2·g·Δh) )   (45° on flat ground)
 * @param {number} V
 * @param {number} [dropM=0]
 * @param {number} [g]
 * @returns {number} degrees
 */
export function optimalLaunchAngle(V, dropM, g) {
    g = g || GRAVITY;
    var s = V * V + 2 * g * (dropM || 0);
    if (s <= 0) return 45;
    return Math.atan(V / Math.sqrt(s)) * 180 / Math.PI;
}

/**
 * Speed required to reach range R at angle θ on flat ground: V = sqrt(R·g / sin 2θ).
 * @param {number} R
 * @param {number} [thetaDeg=45]
 * @param {number} [g]
 * @returns {number} m/s
 */
export function velocityForRange(R, thetaDeg, g) {
    g = g || GRAVITY;
    var th = (thetaDeg != null ? thetaDeg : 45) * Math.PI / 180;
    var s = Math.sin(2 * th);
    if (s <= 1e-9 || !(R > 0)) return NaN;
    return Math.sqrt(R * g / s);
}

/**
 * Sample a trajectory in the vertical plane, optionally with quadratic drag.
 * Drag deceleration a = −k·|v|·v, k = 0.5·ρ_air·Cd·A / m. For a sphere of
 * diameter d and rock density ρr:  k = 0.75·ρ_air·Cd / (ρr·d).
 *
 * @param {Object} opts
 * @param {number} opts.V          - launch speed (m/s)
 * @param {number} opts.thetaDeg   - launch angle from horizontal
 * @param {number} [opts.z0=0]     - launch elevation
 * @param {number} [opts.groundZ=0]- landing elevation (stops when z <= groundZ after apex)
 * @param {number} [opts.dt=0.02]  - s
 * @param {number} [opts.maxT=60]
 * @param {number} [opts.dragK=0]  - 1/m; 0 = vacuum
 * @param {number} [opts.g]
 * @returns {{ x: Float64Array, z: Float64Array, t: Float64Array, range, apex, flightTime, impactSpeed }}
 */
export function sampleTrajectory(opts) {
    var V = opts.V, th = opts.thetaDeg * Math.PI / 180;
    var g = opts.g || GRAVITY;
    var dt = opts.dt > 0 ? opts.dt : 0.02;
    var maxT = opts.maxT > 0 ? opts.maxT : 60;
    var k = opts.dragK > 0 ? opts.dragK : 0;
    var z0 = opts.z0 || 0, gz = opts.groundZ != null ? opts.groundZ : 0;
    var xs = [0], zs = [z0], ts = [0];
    var x = 0, z = z0, vx = V * Math.cos(th), vz = V * Math.sin(th), t = 0;
    var apex = z0;
    while (t < maxT) {
        var sp = Math.sqrt(vx * vx + vz * vz);
        var ax = -k * sp * vx, az = -g - k * sp * vz;
        vx += ax * dt; vz += az * dt;
        x += vx * dt; z += vz * dt; t += dt;
        if (z > apex) apex = z;
        xs.push(x); zs.push(z); ts.push(t);
        if (z <= gz && vz < 0) break;
    }
    // Interpolate exact landing on the last segment
    var n = xs.length;
    if (n >= 2 && zs[n - 1] < gz) {
        var f = (zs[n - 2] - gz) / (zs[n - 2] - zs[n - 1]);
        xs[n - 1] = xs[n - 2] + f * (xs[n - 1] - xs[n - 2]);
        ts[n - 1] = ts[n - 2] + f * (ts[n - 1] - ts[n - 2]);
        zs[n - 1] = gz;
    }
    return {
        x: Float64Array.from(xs), z: Float64Array.from(zs), t: Float64Array.from(ts),
        range: xs[n - 1], apex: apex - z0, flightTime: ts[n - 1], impactSpeed: Math.sqrt(vx * vx + vz * vz)
    };
}

/**
 * Quadratic drag constant k (1/m) for a spherical fragment.
 * @param {number} fragmentDiamM
 * @param {number} [rockDensity=2600] kg/m³
 * @param {number} [Cd=0.47]
 * @param {number} [airDensity=1.225]
 * @returns {number}
 */
export function sphereDragConstant(fragmentDiamM, rockDensity, Cd, airDensity) {
    var rho = rockDensity || 2600, cd = Cd || 0.47, ra = airDensity || 1.225;
    if (!(fragmentDiamM > 0)) return 0;
    return 0.75 * ra * cd / (rho * fragmentDiamM);
}
