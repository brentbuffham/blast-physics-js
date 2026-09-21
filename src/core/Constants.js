/**
 * Constants.js — Shared physical defaults and fallbacks
 *
 * Author: Brent Buffham — blastingapps.com & kirra-design.com
 * License: MIT
 *
 * One named home for values that were previously hard-coded, and differently,
 * in several models. Prefer a real measured value on the DeckEntry; these are
 * only used when the caller supplies nothing.
 */

/**
 * Fallback velocity of detonation (m/s) when a deck carries none.
 *
 * ⏪ BEFORE 0.3.0 this was three different numbers: 5000 (DeckEntry.js),
 * 5279 (BlairMinchinton.js) and 5500 (ScaledHeelan.js, ScaledHeelanBlair.js).
 * 5000 m/s is a reasonable bulk emulsion / heavy ANFO figure and is now used
 * everywhere. Pass an explicit `vod` on the deck for anything quantitative.
 */
export const DEFAULT_VOD = 5000;

/** Fallback explosive density (kg/m³) when a deck carries none. */
export const DEFAULT_EXPLOSIVE_DENSITY = 1200;

/** Fallback borehole diameter (mm) when a deck carries none. */
export const DEFAULT_HOLE_DIAM_MM = 115;

/**
 * Dominant-frequency coefficient of the Blair & Minchinton n = 6 pulse.
 * Dominant frequency f = PULSE_DOMINANT_FREQ_COEFF · b, for bandwidth b.
 * Angular frequency ω = 2π · f.
 */
export const PULSE_DOMINANT_FREQ_COEFF = 0.0597;

/**
 * 1 / max of the n = 6 pulse — Blair & Minchinton (2006) Eq 9.
 * Normalises the pulse to unit peak so that K carries the site calibration.
 */
export const PULSE_PEAK_NORM = 0.0455;

/**
 * Critical PPV thresholds (mm/s) for comparison against a computed PPV.
 * These are reference values, not model parameters.
 *
 *   NIOSH (Iverson, Kerkering & Hustrulid 2008) p29: 700–1000 mm/s for the
 *   onset of new cracking in Swedish igneous rock.
 *   Persson (1994), via Onederra & Esen (2004) Eq 11: PPVcrit = T·Vp/E,
 *   which spans roughly 848–1819 mm/s for competent rock.
 */
export const PPV_CRITICAL_NIOSH_LOW = 700;
export const PPV_CRITICAL_NIOSH_HIGH = 1000;
