# Changelog

All notable changes to blast-physics-js. The project follows
[Semantic Versioning](https://semver.org/); while it is 0.x, a minor version can
change published numbers. Entries marked **changes numbers** move results you
may already have saved, so read them before comparing old output with new.

## [0.3.3] — 2026-10-18

Packaging and documentation only. No model or API changes.

- Release notes moved out of the README into this CHANGELOG, which now ships in the package.
- README: the web worker example matched an API that never existed
  (`createBlairWorker`); it now shows the real `BLAIR_HEAVY_WORKER_URL` message
  protocol. The Holmberg-Persson section describes the 0.3.2 charge grouping and
  the NIOSH option. Images use absolute URLs so they render on npmjs.com.
- `package.json`: `sideEffects: false`, `engines` (Node 20+), `bugs`, `funding`,
  a `./package.json` export, and tests run before every publish.
- CI runs the test suite on Node 20, 22 and 24.

## [0.3.2] — 2026-10-17

Holmberg-Persson now treats a charge the way the method defines it. **Changes
numbers** for split charge columns and for separate decks that fire together.

### Changed

- **Decks that fire together are one charge.** Holmberg-Persson sums the whole
  charge inside the bracket and raises it to α once. Before, each deck was its
  own sum and the peak deck won, so a column split into two decks read *lower*
  than the same column as one deck. What counts as one charge
  (`src/core/ChargeColumns.js`):
  1. Touching explosive decks are one column. A deck with no primer of its own
     fires with the primed deck it touches (earliest primer in the run).
  2. Decks separated by stemming, air or a gas bag add only when they fire at
     the same time (within 1 ms).
  3. Different fire times stay separate events. Holes never add.

  Split columns now equal the unsplit column, and same-time decks now add.
  Different-time decks and single-deck holes are unchanged. `computeJointedRockDamage`
  uses the same grouping.
- **`parseKAP`**: an unprimed deck inside a primed column takes the column's
  fire time. Otherwise it keeps the hole's first fire time, as before.

### Added

- **NIOSH-modified Holmberg-Persson** (Iverson, Kerkering & Hustrulid 2008), as
  an opt-in: pass `useNioshModified: true`. It uses
  `PPV = K·Q^α / R̄^β`, with R̄ the mass-weighted mean distance to the charge.
  The two forms agree beyond about a third of the charge length; close in,
  NIOSH reads lower (229 mm, 10 m column at 0.5 m: 12,556 vs 36,777 mm/s; both
  700 mm/s at 17.5 m). The default stays the original 1979 integral, which
  follows the charge column's length and angle in 3D.
- `holmbergPerssonChargeSums()` and `holmbergPerssonChargePPV()`, plus the
  charge-column helpers, are exported from the package root.

### Fixed

- The 476 mm/s test case from 0.3.0 was labelled "the NIOSH worked example".
  It is the 1979 integral and is now named that. The NIOSH worked example
  (471 mm/s, R̄ = 2.174 m) has its own test.

## [0.3.1] — 2026-09-21

Flyrock corrections. **Changes numbers.** If you computed a clearance zone with
0.3.0 or earlier, recompute it.


Two transcription errors, both in safety calculations, both ported from Kirra's
corrected `FlyrockCalculator.js`. `test/flyrockPaperParity.test.js` now locks
every model to a printed equation rather than to this library's own output — a
snapshot test cannot catch a transcription error, and that is what these were.

### Lundborg — wrong coefficient AND a spurious unit conversion

```js
// ⏪ BEFORE 0.3.1
var Lmax_feet = 260.0 * Math.pow(holeDiamMm / 25.4, 2/3);
var Lmax_m    = Lmax_feet * 0.3048;
```

Lundborg published the same throw in two equivalent forms, and that they agree
numerically is the proof the result is **already metres**:

```
CRATER  L'max = 260 × ø_in^(2/3)  =  30  × ø_mm^(2/3)    [MK22 Eq.1]
BENCH   L'max =  40 × ø_in^(2/3)  =  4.6 × ø_mm^(2/3)    [MK22 Eq.2]

260 × (229/25.4)^(2/3) = 1126        30 × 229^(2/3) = 1123
```

The old code also used the **crater** coefficient unconditionally, with no
bench/crater choice. For a 229 mm hole it returned 343.3 m — neither published
equation:

| | Range | vs old |
|---|---|---|
| Old code | 343.3 m | — |
| Bench, Eq.(2) — **the new default** | 172.2 m | old was **1.99× too far** |
| Crater, Eq.(1) | 1122.9 m | old was **0.31× — 3.3× too short** |

### McKenzie — the 2/3 power reached SDoB

```js
// ⏪ BEFORE 0.3.1
var Rmax = 9.74 * Math.pow(holeDiamMm / Math.pow(sDoB, 2.167), 2/3);
```

MK22 Eq.(5) is `L'max = 9.74 × SDoB^(−2.167) × ø_mm^(2/3)` — **three separate
factors**. The old grouping pushed the 2/3 onto SDoB too, giving an effective
exponent of −1.4447. The two forms agree only at SDoB ≈ 1, which is why it
survived review:

| SDoB | Old | Correct | Ratio |
|---|---|---|---|
| 0.638 (under-stemmed) | 697.1 m | 963.9 m | **0.72× — 267 m short** |
| 1.037 | 346.0 m | 337.0 m | 1.03× |
| 1.834 (well stemmed) | 151.8 m | 98.0 m | 1.55× |

The under-prediction is at the dangerous end — badly-stemmed holes are the ones
that actually throw. `rockDensity` was also accepted, defaulted, and never read;
it now drives Eq. (6) fragment size.

### Also in this release

- **Roth (1979) added** — `roth()` and `rothAtLaunchAngle()`.
- **`MODEL_INPUTS` / `usedInputsFor`** — so a result records only the inputs
  that moved it.
- **Richards & Moore was already correct** and is unchanged. It matches the
  reference workbook to 0.03 %.

## [0.3.0] — 2026-09-21

First release on npm. Vibration and damage models reconciled with the papers
they cite. **Changes numbers.** If you have results from 0.2.x, read this before
comparing.


Every item here is a place where the code and the published equation disagreed.
The corrected models are ported from **Kirra's shader implementations, which are
the reference** — `src/core/BlairScaledHeelan.js` is a 1:1 port of Kirra's file of
the same name, so the GPU and CPU paths cannot drift. Each source file keeps a
`⏪ BEFORE 0.3.0` block with the old expression.

**Sources.** Blair & Minchinton (2006) Fragblast-8; Blair (2008) IJRMMS 45;
Blair (2010) Fragblast-9; Blair & Armstrong (1999) Fragblast 3;
NIOSH (Iverson, Kerkering & Hustrulid 2008); Onederra & Esen (2004).

| # | Change | Effect on published numbers |
|---|---|---|
| 1 | **Holmberg-Persson sums first, then raises to α once** (`PPV = K·[Σ w·R^(−β/α)]^α`). The old form raised each element to α and RMS-summed, which never converged. | ~34 % higher at 8 elements, and the answer no longer depends on `elemsPerDeck`. Pinned by a worked case (the 1979 integral; see 0.3.2): a 3 m column at 1 kg/m, 2 m away at mid-column height → **476 mm/s**. |
| 2 | **`computeHolmbergPerssonDamage` returns PPV in mm/s**, not `peakPPV / ppvCritical`. `ppvCritical` is no longer a parameter. | Divide by your own threshold to recover the old ratio. `computeGrid` now reports `unit: "mm/s"`. |
| 3 | **All models use the Blair patterns** — `blairPatternP` (Eq 10) and `blairPatternS` (Eq 11, with α/β folded in). `heelanF1`/`heelanF2` put P at zero and |SV| at maximum at φ = π/2, the reverse of the paper. | PPV was non-monotonic in distance — it read higher at 20 m than at 10 m. The old pair is still exported, marked as the pre-2026 pattern; nothing uses it. |
| 4 | **Blair 2008 Eq 22 replaces the one-sided primer approximation.** The front leaves the primer in both directions, so paired elements share one increment until the shorter side runs out. | Telescopes to `M^A` **exactly, for any primer position**, so the result is independent of `elemsPerDeck` to within rounding. `ScaledHeelan` previously ignored `primerFraction` entirely. |
| 5 | **`chargeExponent` is Blair's A and now defaults to 0.8**, matching Kirra. For a square-root site law, Blair 2008 Eq 14 gives A = B/2. | ~3.3× higher for an 80 kg deck. ⚠ **Name collision:** `SiteLaw.js` and `PPV.js` use the same name for the scaled-distance `e`, where 0.5 IS correct. The two are related by A = e·B. Check which you are passing. |
| 6 | **Q attenuation is GONE from both scaled models.** The `R^(−(B−1))` in the site law already IS the material attenuation (B&M p5). `qualityFactorP`/`S` are accepted and ignored. | Higher in the far field. Q still applies to `HeelanOriginal`, which has no site law to carry it. |
| 7 | **Elements sum linearly** over per-element resultants, `Σ sqrt(vP² + vSV²)`, not `sqrt(Σ (vP² + vSV²))`. | Conserves charge (Blair 2008 p237). With item 4, `elemsPerDeck` now moves the answer by < 0.1 % from 4 to 32 elements. |
| 8 | **`HeelanOriginal` rebuilt on B&M Eq 6**: one constant for P and SV, `C = a²·δL·b²·P_b·k6 / (2·μ·Vp)` with μ = ρ·Vs² and k6 = (e/6)⁶/γ6 = 0.189887. Q is evaluated at the pulse's dominant frequency, 2π·0.0597·b, not `VOD/(2a)`. | Very large. The old form used two different denominators, and its ω erased the far field — attenuation of 2.4e−5 at 100 m. It read 26 m/s at 5 m and 0.47 mm/s at 50 m; it now tracks a fitted site law within about 1.4–1.8×. |
| 9 | **Element mass comes from the deck's own `mass`** in `BlairMinchinton` and `BlairHeavyWorker`, not from `ρₑ·π·RAD²·dL` built on the HOLE radius. | A decoupled deck was overweighted by `(holeDiam/chargeDiam)²` — about 2× at the `DECOUPLED` default. |
| 10 | **One named VOD fallback**, `DEFAULT_VOD = 5000`, exported from `core/Constants.js`. | Was 5000, 5279 and 5500 in three different files. |
| 11 | **An explicit `0` is no longer replaced by the default** in `createDeckEntry` or in `BlairHeavyWorker`'s parameter reads. | `Number(x || default)` treated a legitimate zero as missing. |

### Still uncalibrated

B&M p4 is explicit that the unscaled model "can only be used to predict
normalised vibration values", because the true borehole wall load `P_o` is
unknown. `HeelanOriginal` assumes `P_b = ρₑ·VOD²/8`, so its absolute mm/s is
indicative and its SHAPE is the published one. Use `ScaledHeelan`,
`ScaledHeelanBlair` or `BlairMinchinton` when you need calibrated numbers.

## [0.2.0] — 2026-08-16

Not published to npm.

- Kirra analysis suite: ripple tank, FFT / IDI / impulse-train spectrum, seed
  and forward-array synthesis, signature deconvolution, site-law regression,
  receptor PPV, Blair 2011 probability of exceedance, SDoB and SEE, detune.
- Blast movement: KAP import, voxelisation, Yang 3DMuck launch, sphere DEM
  (optional Rapier adapter), displacement vectors, muckpile surface, survey
  calibration.
- Live demos: analysis, throw and ripple tank, driven by a Kirra `.kap`.

## [0.1.0] — 2026-03-12

Not published to npm. Initial library: core deck and hole structures, site-law
and per-deck PPV, Scaled Heelan, Blair Lite, Heelan Original, Blair &
Minchinton with web workers, Holmberg-Persson and Jointed Rock damage,
detonation simulator, flyrock, borehole pressure and powder factor.

[0.3.3]: https://github.com/brentbuffham/blast-physics-js/compare/v0.3.2...v0.3.3
[0.3.2]: https://github.com/brentbuffham/blast-physics-js/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/brentbuffham/blast-physics-js/tree/v0.3.1
[0.3.0]: https://github.com/brentbuffham/blast-physics-js/tree/fa8f216
