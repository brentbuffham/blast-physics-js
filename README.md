<p align="center">
  <img src="docs/icons/blastingapps-icon.png" alt="Blasting Apps" width="80" height="80" />
  &nbsp;&nbsp;&nbsp;
  <img src="docs/icons/kirra-icon.png" alt="Kirra" width="80" height="80" />
</p>

<h1 align="center">blast-physics-js</h1>

<p align="center">
  <strong>A JavaScript blast physics engine for the mining industry.</strong><br/>
  Vibration prediction · Damage modelling · Detonation simulation · Flyrock analysis · Blast movement
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
| **Damage** | Holmberg-Persson, Jointed Rock | Damage index |
| **Pressure** | Borehole Pressure, Powder Factor | MPa, kg/m³ |
| **Detonation** | Multi-primer front propagation, Em computation | ms, kg^A |
| **Flyrock** | Richards & Moore, Lundborg, McKenzie (SDoB) | metres, m/s |
| **Movement** | Voxel-based blast throw with Rapier3D WASM physics | displacement vectors |

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

## Blast Movement (Phase 5)

Physics-based blast throw prediction — an open-source approach to the problem solved by Orica's OREPro 3D Predict.

**Concept**: The vibration models provide the energy field (initial conditions). A WASM physics engine (Rapier3D) simulates the dynamics — voxelised rock mass with gravity, friction, collisions, and muckpile formation.

**Workflow**:
1. Import pre-blast surfaces from Kirra CAP file (blast block, pit shell, floor, free face)
2. Voxelise rock mass within surface bounds (~48k voxels for a typical bench)
3. Compute per-voxel initial velocities from PPV field + timing sequence
4. Simulate forward with Rapier3D WASM rigid body dynamics
5. Extract displacement vectors and predicted post-blast surface

**Outputs**: Displacement vectors (equivalent to OREPro 3D's SmartVectors™) for block model transformation, and predicted post-blast muckpile topography.

## Package Structure

```
blast-physics-js/
  src/
    index.js
    core/
      ChargeColumn.js          DeckEntry.js            RadiationPattern.js
      Waveform.js              RockMass.js
    vibration/
      PPV.js                   PPVDeck.js              ScaledHeelan.js
      ScaledHeelanBlair.js     HeelanOriginal.js       BlairMinchinton.js
    damage/
      HolmbergPerssonDamage.js JointedRockDamage.js
    pressure/
      BoreholePressure.js      PowderFactor.js
    detonation/
      DetonationSimulator.js   EmComputation.js
    flyrock/
      FlyrockTrajectory.js     FlyrockShroud.js
    movement/
      VoxelGrid.js             InitialVelocityField.js
      BlastMovementSimulator.js DisplacementField.js    PostBlastSurface.js
    workers/
      BlairHeavyWorker.js      FlyrockWorker.js
  test/
  dist/
```

## Implementation Roadmap

| Phase | Version | Scope |
|-------|---------|-------|
| **1** | v0.1.0 | Core data structures + PPV site law + PPV per-deck |
| **2** | v0.2.0 | Scaled Heelan + Blair Lite + Holmberg-Persson + Jointed Rock damage |
| **3** | v0.3.0 | Blair & Minchinton time-domain + Web Workers + Heelan Original |
| **4** | v1.0.0 | Detonation simulator + flyrock (R&M, Lundborg, McKenzie) + pressure + powder factor |
| **5** | v2.0.0 | Blast movement: voxelisation, Rapier3D physics, displacement vectors, post-blast surface |

## References

- Blair, D.P. & Minchinton, A. (1996). *On the damage zone surrounding a single blasthole*. Fragblast-5, Montreal.
- Blair, D.P. & Minchinton, A. (2006). *Near-field blast vibration models*. Fragblast-8, Santiago.
- Blair, D.P. (2008). *Non-linear superposition models of blast vibration*. Int. J. Rock Mech. Min. Sci. 45, 235–247.
- Blair, D.P. (2015). *Wall control blasting*. Fragblast 11, Sydney.
- Heelan, P.A. (1953). *Radiation from a cylindrical source of finite length*. Geophysics 18, 685–696.
- Holmberg, R. & Persson, P.A. (1979). *Design of tunnel perimeter blasthole patterns to prevent rock damage*. Tunnelling '79, London.
- Chiappetta, R.F. & Treleven, J.P. (1997). *Scaled Depth of Burial concept for flyrock risk assessment*.
- Richards, A.B. & Moore, A.J. (2004). *Flyrock control — by chance or design*. Proc. 30th ISEE Conf.
- McKenzie, C. (2009/2022). *Flyrock range and fragment size prediction / validation*.

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
