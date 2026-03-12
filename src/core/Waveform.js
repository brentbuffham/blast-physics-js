/**
 * Waveform.js — Blair pulse shape and iterative evaluation
 *
 * Author: Brent Buffham — blastingapps.com & kirra-design.com
 * License: MIT
 *
 * Reference: Blair & Minchinton (1996/2006)
 *
 * Pulse shape:
 *   w(p) = (p^N − 2N·p^(N−1) + N(N−1)·p^(N−2)) · exp(−p)
 *   where p = bandwidth × (t − t_arrival)
 *
 * Pulse duration ≈ 4N / bandwidth (negligible beyond pulseCutoff = 4N)
 */

/**
 * Evaluate the Blair waveform pulse at a single p value.
 * Uses iterative multiply (avoids Math.pow for integer powers).
 *
 * @param {number} p   - Normalised time (bandwidth × elapsed)
 * @param {number} N   - Pulse order (integer ≥ 2)
 * @returns {number}   w(p) — signed velocity amplitude
 */
export function blairWaveform(p, N) {
    if (p <= 0) return 0.0;
    // iterative multiply for p^(N-2)
    var pn2 = 1.0;
    for (var i = 0; i < N - 2; i++) pn2 *= p;
    var pn1 = pn2 * p;
    var pn  = pn1 * p;
    return (pn - 2.0 * N * pn1 + N * (N - 1.0) * pn2) * Math.exp(-p);
}

/**
 * Return the pulse cutoff (p beyond which exp(-p) is negligible).
 * @param {number} N - Pulse order
 * @returns {number}
 */
export function pulseCutoff(N) {
    return 4.0 * N;
}

/**
 * Return approximate pulse duration (seconds).
 * @param {number} N         - Pulse order
 * @param {number} bandwidth - Frequency bandwidth (Hz)
 * @returns {number} duration in seconds
 */
export function pulseDuration(N, bandwidth) {
    return 4.0 * N / bandwidth;
}
