/**
 * FFT.js — Radix-2 Cooley–Tukey FFT primitives
 *
 * Author: Brent Buffham — blastingapps.com & kirra-design.com
 * License: MIT
 *
 * Minimal, dependency-free FFT used by the frequency-analysis, forward-array,
 * and signature-deconvolution modules. O(N log N); fine for N up to ~2^17
 * (a 130 s pattern at 1 kHz).
 *
 * Extracted from Kirra's FrequencyAnalysisHelper.js / ForwardArraySynthesis.js.
 */

/**
 * Smallest power of two >= n.
 * @param {number} n
 * @returns {number}
 */
export function nextPow2(n) {
    var p = 1;
    while (p < n) p <<= 1;
    return p;
}

/**
 * In-place radix-2 forward FFT.
 * re, im must be Float64Array (or Float32Array) of equal power-of-two length.
 *
 * @param {Float64Array} re - real part (modified in place)
 * @param {Float64Array} im - imaginary part (modified in place)
 */
export function fftInPlace(re, im) {
    var N = re.length;
    if (N !== im.length) throw new Error("fftInPlace: re/im length mismatch");
    if ((N & (N - 1)) !== 0) throw new Error("fftInPlace: length must be a power of two (got " + N + ")");

    // Bit-reverse permutation
    var j = 0;
    for (var i = 1; i < N; i++) {
        var bit = N >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) {
            var tr = re[i]; re[i] = re[j]; re[j] = tr;
            var ti = im[i]; im[i] = im[j]; im[j] = ti;
        }
    }

    // Butterflies
    for (var len = 2; len <= N; len <<= 1) {
        var half = len >> 1;
        var ang = -2 * Math.PI / len;
        var wRe = Math.cos(ang);
        var wIm = Math.sin(ang);
        for (var s = 0; s < N; s += len) {
            var curRe = 1, curIm = 0;
            for (var k = 0; k < half; k++) {
                var aRe = re[s + k], aIm = im[s + k];
                var bRe = re[s + k + half] * curRe - im[s + k + half] * curIm;
                var bIm = re[s + k + half] * curIm + im[s + k + half] * curRe;
                re[s + k]        = aRe + bRe;
                im[s + k]        = aIm + bIm;
                re[s + k + half] = aRe - bRe;
                im[s + k + half] = aIm - bIm;
                var nRe = curRe * wRe - curIm * wIm;
                var nIm = curRe * wIm + curIm * wRe;
                curRe = nRe; curIm = nIm;
            }
        }
    }
}

/**
 * In-place inverse FFT via the conjugate trick:
 *   IFFT(X) = conj(FFT(conj(X))) / N
 *
 * @param {Float64Array} re
 * @param {Float64Array} im
 */
export function ifftInPlace(re, im) {
    var N = re.length;
    for (var i = 0; i < N; i++) im[i] = -im[i];
    fftInPlace(re, im);
    var invN = 1 / N;
    for (var j = 0; j < N; j++) {
        re[j] *= invN;
        im[j] = -im[j] * invN;
    }
}

/**
 * Single-sided amplitude spectrum of a real signal.
 * Zero-pads to the next power of two. Magnitudes are scaled by 2/len so a
 * pure sinusoid of amplitude A reports ≈ A at its frequency bin.
 *
 * @param {ArrayLike<number>} real - time samples
 * @param {number} fs             - sample rate (Hz)
 * @returns {{ mag: Float64Array, df: number, N: number }}
 *   mag[k] is the amplitude at frequency k·df, k = 0..N/2-1
 */
export function fftMagnitude(real, fs) {
    var len = real.length;
    var N = nextPow2(Math.max(2, len));
    var re = new Float64Array(N);
    var im = new Float64Array(N);
    for (var i = 0; i < len; i++) re[i] = real[i];
    fftInPlace(re, im);
    var halfN = N >> 1;
    var mag = new Float64Array(halfN);
    var scale = len > 0 ? 2 / len : 0;
    for (var m = 0; m < halfN; m++) {
        mag[m] = Math.sqrt(re[m] * re[m] + im[m] * im[m]) * scale;
    }
    return { mag: mag, df: fs / N, N: N };
}

/**
 * Peak magnitude inside a frequency band [fmin, fmax] (Hz).
 *
 * @param {ArrayLike<number>} mag - amplitude spectrum
 * @param {number} df             - bin width (Hz)
 * @param {number} fmin
 * @param {number} fmax
 * @returns {{ freq: number, mag: number }}
 */
export function peakInRange(mag, df, fmin, fmax) {
    if (!mag || mag.length === 0 || !(df > 0)) return { freq: 0, mag: 0 };
    var i0 = Math.max(1, Math.floor(fmin / df));
    var i1 = Math.min(mag.length - 1, Math.ceil(fmax / df));
    var mx = 0, mi = i0;
    for (var i = i0; i <= i1; i++) if (mag[i] > mx) { mx = mag[i]; mi = i; }
    return { freq: mi * df, mag: mx };
}

/**
 * Peak |value| in a time series.
 *
 * @param {ArrayLike<number>} arr
 * @param {number} fs - sample rate (Hz), used to convert index → seconds
 * @returns {{ val: number, idx: number, t: number }}
 */
export function peakAbs(arr, fs) {
    var mx = 0, mi = 0;
    for (var i = 0; i < arr.length; i++) {
        var a = Math.abs(arr[i]);
        if (a > mx) { mx = a; mi = i; }
    }
    return { val: mx, idx: mi, t: fs > 0 ? mi / fs : 0 };
}
