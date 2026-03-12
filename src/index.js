/**
 * blast-physics-js — Public API
 *
 * Author: Brent Buffham — blastingapps.com & kirra-design.com
 * License: MIT
 *
 * Zero-dependency blast engineering physics library.
 * Runs in browser (ES modules) and Node.js (CommonJS via Vite CJS build).
 */

// Core data structures
export { createRockMass, deriveSWaveVelocity, RockMass, DEFAULT_ROCK_MASS } from "./core/RockMass.js";
export { createHoleEntry, holeLength, holeAxisVector } from "./core/HoleEntry.js";
export { createDeckEntry, deckLength, deckMidpoint, isCharged, DECK_TYPES } from "./core/DeckEntry.js";
export { heelanF1, heelanF2, blairSfacp, blairSfacs, blairPatterns, heelanPatterns } from "./core/RadiationPattern.js";
export { blairWaveform, pulseCutoff, pulseDuration } from "./core/Waveform.js";

// Vibration models
export { computePPV, computePointPPV, PPVModel } from "./vibration/PPV.js";
export { computePPVDeck, PPVDeckModel } from "./vibration/PPVDeck.js";
export { computeScaledHeelan, ScaledHeelanModel } from "./vibration/ScaledHeelan.js";
export { computeScaledHeelanBlair, ScaledHeelanBlairModel } from "./vibration/ScaledHeelanBlair.js";
export { computeHeelanOriginal, HeelanOriginalModel } from "./vibration/HeelanOriginal.js";
export { computeBlairMinchinton, BlairMinchintonModel } from "./vibration/BlairMinchinton.js";

// Damage models
export { computeHolmbergPerssonDamage, HolmbergPerssonDamageModel } from "./damage/HolmbergPerssonDamage.js";
export { computeJointedRockDamage, JointedRockDamageModel } from "./damage/JointedRockDamage.js";

// Pressure models
export { computeBoreholePressure, BoreholePressureModel } from "./pressure/BoreholePressure.js";
export { computePowderFactor, PowderFactorModel } from "./pressure/PowderFactor.js";

// Detonation
export { simulateDetonation, computeEmValues, processHoleDetonation } from "./detonation/DetonationSimulator.js";
export { computeSequentialEm, computePrimerAwareEm } from "./detonation/EmComputation.js";

// Flyrock
export { richardsMoore, lundborg, mckenzie, envelopeAltitude } from "./flyrock/FlyrockTrajectory.js";
export { generateFlyrockShroud } from "./flyrock/FlyrockShroud.js";
