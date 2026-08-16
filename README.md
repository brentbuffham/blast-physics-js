<p align="center">
  <img src="docs/icons/blastingapps-icon.png" alt="Blasting Apps" width="80" height="80" />
  &nbsp;&nbsp;&nbsp;
  <img src="docs/icons/kirra-icon.png" alt="Kirra" width="80" height="80" />
</p>

<h1 align="center">blast-physics-js</h1>

<p align="center">
  <strong>A JavaScript blast physics engine for the mining industry.</strong><br/>
  Vibration prediction · Frequency analysis · Ripple tank · Damage modelling · Detonation simulation · Flyrock analysis · Blast movement (muckpile)
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/blast-physics-js"><img src="https://img.shields.io/npm/v/blast-physics-js?color=cc0000&style=flat-square" alt="npm version" /></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="MIT License" /></a>
  <a href="https://blastingapps.com"><img src="https://img.shields.io/badge/blastingapps.com-black?style=flat-square" alt="blastingapps.com" /></a>
  <a href="https://kirra-design.com"><img src="https://img.shields.io/badge/kirra--design.com-cc0000?style=flat-square" alt="kirra-design.com" /></a>
</p>

---

## What is this?

**blast-physics-js** is a free, open-source npm library that provides blast engineering models for the mining industry, implemented in pure JavaScript with zero rendering dependencies.

It is the physics companion to [Kirra](https://github.com/brentbuffham/Kirra) — extracting the analytical models from Kirra's GPU shader pipeline into a standalone, testable, composable library that any mining engineer or software developer can use.

```
npm install blast-physics-js
```

## Features

- **Zero rendering dependencies** — no Three.js, no WebGL, no DOM. Pure computational library.
- **Isomorphic** — runs identically in browser (ES modules) and Node.js (CommonJS).
- **SI units** throughout — metres, kilograms, seconds, Pascals, m/s.
- **Typed array output** — all grid computations return `Float32Array` / `Float64Array` for direct GPU upload.
- **Model fidelity hierarchy** — simple site-law PPV through to full Blair & Minchinton time-domain waveform superposition.
- **Per-deck architecture** — multi-deck holes, air gaps, COUPLED/DECOUPLED charges, and per-product VOD/density are first-class concepts.

## Models

| Domain | Models | Output |
|--------|--------|--------|
| **Vibration** | PPV, PPV Per-Deck, Scaled Heelan, Blair Lite, Heelan Original, Blair & Minchinton | mm/s |
| **Site law** | Regression (K50/K90/K95, B, σ), inverse (max allowable charge / distance), receptor evaluation (peak, coherence-window RMS, compliance, dominant hole), Blair 2011 Probability of Exceedance | mm/s, kg, P |
| **Ripple tank** | Coherent forward wave field — P and S fronts from every charge, Ricker / Gaussian / damped / Berlage / measured wavelets | signed mm/s |
| **Signal** | FFT, IDI, impulse-train spectrum, time-window (MIC) histogram, seed-wavelet superposition (linear + Blair non-linear), 3-component forward-array synthesis with Love waves, spectral-division signature deconvolution, detune / constrain | Hz, mm/s |
| **Damage** | Holmberg-Persson, Jointed Rock | Damage index |
| **Pressure / energy** | Borehole Pressure, Powder Factor, Specific Explosive Energy | MPa, kg/m³, GJ/m³ |
| **Detonation** | Multi-primer front propagation, Em computation | ms, kg^A |
| **Flyrock** | Richards & Moore, Lundborg, McKenzie (SDoB), volumetric SDoB grid, ballistics (range / apex / flight time / drag) | metres, m/s |
| **Movement** | Voxel blast throw: Yang 3DMuck kinematic launch + sphere DEM transport (optional Rapier3D adapter), survey calibration | displacement vectors, swell, muckpile surface |
| **IO** | Kirra `.kap` archives (holes, charging, primers, surfaces), Instantel / Texcel monitor CSVs | HoleEntry / DeckEntry / surfaces |

## Demos

```bash
npm run dev
```

Opens http://localhost:5175 with three pages:

| Page | What it shows |
|------|---------------|
| `index.html` | Pre-computed volumetric vibration / damage / pressure point clouds with slice planes |
| `throw.html` | **Blast throw / muckpile simulator** — loads `examples/SWELLFACTOR.kap` (531 holes, PREBLAST_VOLUME, SHELL, POSTBLAST_MUCKPILE), voxelises the blast volume, launches blocks with Yang 3DMuck kinematics, runs the sphere DEM, and back-calculates Pe from the surveyed muckpile. Drop any Kirra `.kap` on it. |
| `ripple.html` | **Ripple tank** wave field with wave-front rings, IDI stems, impulse-train FFT and a click-to-place monitor with L/T/V forward-array synthesis and PoE readout |

The throw demo defaults are the calibrated "throw_4" settings (1.5 m voxels, Pe 1.0, b 1.5, relief steer 0.85, 40 ms window, restitution 0.1, friction 0.5, swell 1.4, 35 % size scatter).

## Quick Start

### Single-point PPV

```javascript
import { computePPV } from 'blast-physics-js';

const ppv = computePPV(
  { x: 100, y: 200, z: 0 },       // observation point (m)
  deckEntries,                      // array of DeckEntry objects
  { K: 1140, B: 1.6, e: 0.5 }     // site constants
);
// Returns: number (mm/s)
```

### Grid computation

```javascript
import { computeScaledHeelan } from 'blast-physics-js';

const grid = computeScaledHeelan(
  deckEntries,
  holeEntries,
  { minX: 0, minY: 0, maxX: 200, maxY: 200, cellSize: 1.0, elevation: 0 },
  { K: 1140, B: 1.6, chargeExponent: 0.5, elemsPerDeck: 12 }
);
// Returns: GridResult { data: Float32Array, rows, cols, minX, minY, cellX, cellY, unit, model }
```

### Low-level model API

```javascript
import { ScaledHeelanModel } from 'blast-physics-js';

const model = new ScaledHeelanModel({
  K: 1140, B: 1.6, chargeExponent: 0.5,
  elemsPerDeck: 20, pWaveVelocity: 4500, poissonRatio: 0.25
});

const ppv = model.evaluate(point, deckEntries, holeEntries);
const result = model.computeGrid(deckEntries, holeEntries, gridParams);
```

### Read a Kirra KAP and run the blast throw simulator

```javascript
import { parseKAP, BlastMovementSimulator } from 'blast-physics-js';

const kap = await parseKAP(await file.arrayBuffer());   // { holes, decks, surfaces, products, raw }
const sim = new BlastMovementSimulator({ voxelRes: 1.5, maxVoxels: 30000, Pe: 1.0, maxSwell: 1.4 });
sim.load(kap);                 // throw directions, charge elements, confinement geometry
sim.generateVoxels();          // voxelise PREBLAST_VOLUME / VOXEL-BLK*, nearest hole, launch velocities
sim.run();                     // fixed 5 ms sub-steps until every fired block rests
const r = sim.results();       // vectors, comShift, swell, heightfield.surface (Kirra-style triangulated surface)

const cal = await sim.calibrate();   // secant-fit Pe to the surveyed POSTBLAST CoM throw
```

### Ripple tank, frequency analysis, receptor PPV

```javascript
import { RippleTankModel, fireTimesFromDecks, computeIDI, computeSpectrum,
         evaluateReceptor, decksFromEntries, poeFromPrediction } from 'blast-physics-js';

const ripple = new RippleTankModel({ K: 1140, B: 1.6, cp: 5000, cs: 2900, fP: 100, fS: 60 });
const field = ripple.computeGrid(deckEntries, { minX, minY, rows, cols, cellX, cellY, elevation }, 0.25 /* s */);

const { times, weights } = fireTimesFromDecks(deckEntries);
const idi = computeIDI(times, 1);                                   // Δt histogram, median, dominant intervals
const spec = computeSpectrum(times, { weights, maxHz: 200 });       // impulse-train FFT + peaks

const rx = evaluateReceptor(monitor, decksFromEntries(deckEntries), { superposeRMS: true, coherenceMs: 8, outputMode: 'A' });
const poe = poeFromPrediction(rx.value, 25 /* mm/s limit */, 0.22 /* site σ */);   // Blair 2011
```

### Web Worker (Blair time-domain)

```javascript
import { createBlairWorker } from 'blast-physics-js/workers';

const worker = createBlairWorker();
const strip = await worker.compute({
  deckEntries, holeEntries,
  gridParams: { minX, minY, elevation },
  modelParams: { K: 700, B: 1.5, bandwidth: 10000 },
  startRow: 0, endRow: 100
});
// strip: Float32Array
```

## Data Structures

### HoleEntry

Blast hole geometry and properties. Aligned to [Kirra's Blast Hole Management](https://github.com/brentbuffham/Kirra/wiki/Blast-Hole-Management).

```javascript
{
  entityName,                     // Blast pattern name
  holeID,                         // Unique hole identifier
  collarX, collarY, collarZ,     // Collar position (m)
  toeX, toeY, toeZ,              // Toe position (m)
  holeDiamMm,                     // Borehole diameter (mm)
  holeType,                       // 'Production', 'Presplit', 'Buffer', etc.
  benchHeight,                    // Collar Z to grade Z (m)
  subdrillLength,                 // Grade to toe along hole (m)
  holeTime,                       // Surface initiation time (ms)
}
```

### DeckEntry

One deck within a blast hole. Aligned to [Kirra's Charging System](https://github.com/brentbuffham/Kirra/wiki/Charging-System) with four typed deck categories.

```javascript
{
  deckType,                        // 'COUPLED' | 'DECOUPLED' | 'INERT' | 'SPACER'
  topX, topY, topZ,               // Charge top position (m)
  baseX, baseY, baseZ,            // Charge base position (m)
  mass,                            // Explosive mass (kg, 0 for INERT/SPACER)
  density,                         // Explosive density (kg/L)
  vod,                             // Velocity of detonation (m/s)
  holeDiamMm,                      // Borehole diameter (mm) — from parent hole
  chargeDiamMm,                    // Effective charge diameter (mm):
                                   //   COUPLED:   = holeDiamMm (full contact)
                                   //   DECOUPLED: = product diameter (air gap)
  timingMs,                        // Total detonation time (ms)
  holeIndex,                       // Index into HoleEntry array
  primerFraction,                  // 0.0 = top, 1.0 = base
}
```

> **Why two diameters?** COUPLED explosives fill the borehole — charge diameter equals hole diameter. DECOUPLED (packaged) explosives have an air gap — the charge diameter is the product's physical diameter, which is smaller. Pressure models need the borehole wall radius; mass calculations need the charge diameter. Both are carried per-deck.

### From a Kirra KAP

`parseKAP()` returns `{ holes, decks, surfaces, products, raw }`. Holes carry the extra Kirra fields `burden`, `spacing`, `gradeZ`, `massPerHole`, `rowID` and `firstFireMs` (earliest primer-resolved fire time). Deck `timingMs` is the primer's absolute fire time — electronic `delayMs`, or `holeTime + delayMs + lengthFromCollar / deliveryVod` for shock-tube / electric / cord cascades — and `primerFraction` locates the primer along the deck. Surfaces are `{ id, name, role, pos: Float64Array, idx: Uint32Array, np, nt }` in world coordinates.

Monitor waveforms: `parseMonitorCSV(text)` reads Instantel Blastware / Micromate and Texcel Twf2CSV exports into `{ sampleRateHz, channels: { Tran, Vert, Long }, metadata }`.

## Vibration Model Hierarchy

The library provides five vibration models with increasing fidelity and computational cost:

### 1. PPV — Simple Site Law
```
PPV = K × (D / Q^e)^(-B)
```
Point-source evaluation at charge centroid. O(n) per point. Real-time.

### 2. PPV Per-Deck
Same physics, but evaluates at top/centre/base of each deck individually. Multi-deck holes show separate influence zones.

### 3. Scaled Heelan — Blair Non-Linear Superposition (RMS)
Blair & Minchinton (2006). Each deck subdivided into M elements with non-linear charge superposition:
```
Em = [m × w_e]^A − [(m−1) × w_e]^A
PPV_element = K × Em × R^(−B) × F(φ)
```
Heelan radiation patterns F₁(φ), F₂(φ). Viscoelastic attenuation via Qp, Qs. GPU-friendly (no time loop).

### 4. Blair Lite — Improved Radiation Patterns
Same RMS energy summation but with Blair's Vs/Vp-dependent radiation patterns:
```
sfacp = 1 − 2(Vs/Vp)² cos²φ     // P-wave: non-zero on axis
sfacs = sin(2φ)                    // SV-wave with fud=1.2 regularisation
```
Primer-aware element ordering. Vs derived from Vp + Poisson's ratio.

### 5. Blair & Minchinton — Full Time-Domain
Coherent waveform superposition with P-wave and SV-wave arrival times:
```
w(p) = (p^N − 2N·p^(N−1) + N(N−1)·p^(N−2)) × exp(−p)
```
Captures constructive/destructive interference. O(n × M × T) per point. Web Worker parallelism for grid computation.

## Damage Models

**Holmberg-Persson**: Near-field damage index via sub-element integration. DI = peakPPV / PPV_critical.

**Jointed Rock**: Combined intact rock fracture (σ_d / σ_t) and Mohr-Coulomb joint failure (τ / (c + μσ_n)).

## Flyrock Models

Three algorithms with increasing conservatism:

| Model | Inputs | Basis |
|-------|--------|-------|
| **Richards & Moore** (2004) | Burden, stemming, explosive density, K | Face burst + cratering + stem eject |
| **McKenzie** (2009/2022) | SDoB, hole diameter, stemming, density | Chiappetta Scaled Depth of Burial |
| **Lundborg** (1975/1981) | Hole diameter only | Empirical upper-bound envelope |

3D shroud generation using the Chernigovskii ballistic envelope.

## Site Law, Receptors and Probability of Exceedance

- **`fitSiteLaw`** — log-log least squares of `PPV = K·(D/Q^e)^−B` on monitoring observations → K50 / K90 / K95, B, R², residual σ, outlier flags.
- **`maxAllowableCharge` / `distanceForPPV`** — inverse site law for charge design and clearance.
- **`evaluateReceptor`** — every charged deck against a monitor: peak single-deck PPV, coherence-window RMS (±8 ms, gated by P-wave arrival), coherent seed-wavelet peak, dominant hole, contributors, compliance ratio and max allowable charge. Near-field clamp at SD = 1.0 m/kg^0.5 (Yang & Scovira 2007).
- **`probabilityOfExceedance`** — Blair (2011) `P(V > V_β)` from the log₁₀ z-score with the correct Abramowitz & Stegun polynomial forms (verified against Blair Table 1 in the tests; the circulated Kearney and XLSX restatements are wrong). `normalQuantile` / `effectiveTargetForPoE` give the inverse (design to 1 % PoE).

## Ripple Tank

Coherent, phase-aware forward wave field: at time *t* every point sums the P and S contributions of every charge that has fired, with site-law amplitude and a causal wavelet at the arrival time. Fronts interfere constructively and destructively — the educational complement to the incoherent RMS heatmaps.

```
u(p,t) = Σ_i K·(D_i/Q_i^n)^−B · [ w(t − fire_i − D_i/cp, fP) + spRatio · w(t − fire_i − D_i/cs, fS) ]
```

Wavelets: causal Ricker (physical default), Gaussian bell, damped sinusoid, Berlage, or a measured geophone seed. `RippleTankModel.computeGrid` / `timeSeries` / `rippleWaveFronts`.

## Signal Toolkit

| Module | Contents |
|--------|----------|
| `signal/FFT.js` | radix-2 FFT / IFFT, single-sided magnitude, band peaks |
| `signal/Wavelets.js` | Ricker, causal Ricker, Gaussian bell, damped sinusoid, Berlage, two-term P+S, measured resampling, seed bundles |
| `signal/FrequencyAnalysis.js` | inter-detonation intervals, impulse-train spectrum, dominant frequencies, MIC time-window histogram, structural-resonance bands |
| `signal/SeedSynthesis.js` | signature-hole superposition (uniform / √Q / site-law amplitude, two-term P/S arrivals, Blair 2008 non-linear damage attenuation) |
| `signal/ForwardArray.js` | L / T / V synthesis at a monitor with P, S and Love waves, polarisation, peak vector sum, Gao 2015 near-field S correction |
| `signal/SignatureDeconvolution.js` | Li & Silva-Castro (2017) spectral-division extraction of the single-hole signature |
| `signal/Detune.js` | reproducible timing dither (uniform / triangular / positive), nonel palette snap, rolling-window event-rate constraint |

## Blast Movement (Phase 5 — implemented)

Physics-based blast throw / muckpile prediction — an open-source approach to the problem solved by Orica's OREPro 3D Predict. Ported from the Kirra blast-throw simulator (throw_4 generation).

**Pipeline** (`BlastMovementSimulator`):
1. `parseKAP` — holes, charging (mass per deck from geometry, primer-resolved fire times), and surfaces by role: `PREBLAST_VOLUME` / `VOXEL-BLK*` (material to blast), `SHELL` / `*REMAIN*` / `*MINUS*` (trusted confinement), `PREBLAST_SURFACE` / `*TOPO*` (fallback collision with lid/face exclusion), `POSTBLAST*` (survey reference)
2. Voxelise the blast volume by column ray-casting (auto-coarsened to the block budget); fragmentation-shaped block size scatter
3. **Kinematic loading — Yang 3DMuck** (Yang & Kavetsky 1990; Yang 2020): every explosive deck is split into charge elements; a block receives `|ΔV| = Pe·ρe·d²·Δl / (4·r^b)` from each element of every hole firing within the timing window of its dominant hole, summed vectorially. Confined momentum cancelled between cooperating charges is recovered and steered down the timing gradient (least-squares fit of fire time over neighbours → direction of relief). An energy-partition depth-zone model (`v0 = √(2ηE·PF/ρ)`) is available as an alternative.
4. **Sphere DEM transport**: fixed 5 ms sub-steps, gravity, spatial-hash sphere contacts (mass ∝ ρr³), static shell collision, ground plane, in-flight bulking to the target swell factor, rest detection with re-activation on impact
5. Results: displacement vectors (in-situ → final, world coordinates), volume-weighted centre-of-mass shift and bearing, achieved swell (prescribed and emergent), and a triangulated muckpile heightfield surface
6. **Calibration**: `surveyTargets` rasterises PREBLAST_VOLUME / SHELL / POSTBLAST onto 2 m columns (swell = muck volume ÷ in-situ, CoM throw); `calibrate()` secant-fits Pe with three coarse headless runs. On SWELLFACTOR.kap: survey swell 1.43×, throw 34 m @ 130° → fitted Pe ≈ 1.5

`RapierEngine` (`@dimforge/rapier3d-compat`, injected, not a dependency) swaps the transport for convex-hull rigid bodies with emergent swell. In calibration the sphere DEM reproduced the surveyed muckpile shape better, so it is the default.

**Outputs**: Displacement vectors (equivalent to OREPro 3D's SmartVectors™) for block model transformation, and predicted post-blast muckpile topography.

## Package Structure

```
blast-physics-js/
  src/
    index.js
    core/
      DeckEntry.js             HoleEntry.js            RadiationPattern.js
      Waveform.js              RockMass.js
    vibration/
      PPV.js                   PPVDeck.js              ScaledHeelan.js
      ScaledHeelanBlair.js     HeelanOriginal.js       BlairMinchinton.js
      SiteLaw.js               ReceptorPPV.js          ProbabilityOfExceedance.js
      RippleTank.js
    signal/
      FFT.js                   Wavelets.js             FrequencyAnalysis.js
      SeedSynthesis.js         ForwardArray.js         SignatureDeconvolution.js
      GaoNearFieldCorrection.js Detune.js
    damage/
      HolmbergPerssonDamage.js JointedRockDamage.js
    pressure/
      BoreholePressure.js      PowderFactor.js         SEE.js
    detonation/
      DetonationSimulator.js   EmComputation.js
    flyrock/
      FlyrockTrajectory.js     FlyrockShroud.js        SDoB.js
      Ballistics.js
    movement/
      BlastMovementSimulator.js Voxeliser.js           InitialVelocity.js
      ThrowDirections.js       SphereDEM.js            ShellCollider.js
      SurfaceMesh.js           Displacement.js         RapierEngine.js
    io/
      KAPReader.js             ZipReader.js            MonitorCSV.js
    workers/
      BlairHeavyWorker.js      FlyrockWorker.js
  examples/
    index.html  throw.html  ripple.html  SWELLFACTOR.kap
  test/
  dist/
```

## Implementation Roadmap

| Phase | Scope | Status |
|-------|-------|--------|
| **1** | Core data structures + PPV site law + PPV per-deck | ✅ Complete |
| **2** | Scaled Heelan + Blair Lite + Holmberg-Persson + Jointed Rock damage | ✅ Complete |
| **3** | Blair & Minchinton time-domain + Web Workers + Heelan Original | ✅ Complete |
| **4** | Detonation simulator + flyrock (R&M, Lundborg, McKenzie) + pressure + powder factor | ✅ Complete |
| **5** | Blast movement: KAP import, voxelisation, Yang 3DMuck launch, sphere DEM (+ optional Rapier), displacement vectors, muckpile surface, survey calibration | ✅ Complete (v0.2.0) |
| **6** | Kirra analysis suite: ripple tank, FFT / IDI / spectrum, seed & forward-array synthesis, signature deconvolution, site-law regression, receptor PPV, Blair 2011 PoE, SDoB / SEE, detune | ✅ Complete (v0.2.0) |

## References

- Blair, D.P. & Minchinton, A. (1996). *On the damage zone surrounding a single blasthole*. Fragblast-5, Montreal.
- Blair, D.P. & Minchinton, A. (2006). *Near-field blast vibration models*. Fragblast-8, Santiago.
- Blair, D.P. (2008). *Non-linear superposition models of blast vibration*. Int. J. Rock Mech. Min. Sci. 45, 235–247.
- Blair, D.P. (2011). *A probabilistic analysis of vibration based on measured data and charge weight scaling*. EFEE 6th World Conf., Lisbon, 319–337.
- Blair, D.P. (2015). *Wall control blasting*. Fragblast 11, Sydney.
- Heelan, P.A. (1953). *Radiation from a cylindrical source of finite length*. Geophysics 18, 685–696.
- Holmberg, R. & Persson, P.A. (1979). *Design of tunnel perimeter blasthole patterns to prevent rock damage*. Tunnelling '79, London.
- Yang, R. & Scovira, D.S. (2007). *A model for near-field blast vibration based on signal broadening and amplitude attenuation*. EXPLO 2007, Wollongong.
- Yang, R. & Kavetsky, A. (1990). *A three-dimensional model of muckpile formation and grade boundary movement in open pit blasting*. Int. J. Min. Geol. Eng. 8, 13–34; Yang, R. (2020) 3DMuck.
- Anderson, D.A. (1989) / Hinzen, K.-G. (1988). Signature-hole linear superposition of blast vibration.
- Aldridge, D.F. (1990). *The Berlage wavelet*. Geophysics 55, 1508–1511.
- Li & Silva-Castro (2017). *Spectral division deconvolution of blast vibration signals for signature estimation*. ISEE 43rd Conf.
- Gao, Q.D., Lu, W.B., Hu, Y.G., Chen, M. & Yan, P. (2015). *Comparison of the generation of shear wave with different simulation approaches*. Fragblast 11, Sydney, 79–87.
- Chiappetta, R.F. & Treleven, J.P. (1997). *Scaled Depth of Burial concept for flyrock risk assessment*.
- Richards, A.B. & Moore, A.J. (2004). *Flyrock control — by chance or design*. Proc. 30th ISEE Conf.
- McKenzie, C. (2009/2022). *Flyrock range and fragment size prediction / validation*.
- Siskind, D.E. et al. (1980). *Structure response and damage produced by ground vibration from surface mine blasting*. USBM RI 8507.

## Related Projects

- [Kirra](https://github.com/brentbuffham/Kirra) — Web-based blasting pattern design application for mining and construction
- [trimesh-boolean](https://www.npmjs.com/package/trimesh-boolean) — Open-mesh boolean operations for Three.js

## Author

**Brent Buffham**
- [blastingapps.com](https://blastingapps.com)
- [kirra-design.com](https://kirra-design.com)
- [Buy Me a Coffee](https://buymeacoffee.com/brentbuffham)

## License

MIT © Brent Buffham 2026
