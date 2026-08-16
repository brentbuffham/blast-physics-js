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

// Vibration — site law, receptor evaluation, probability of exceedance, ripple tank
export { sitePPV, scaledDistance, distance3D, maxAllowableCharge, distanceForPPV, fitSiteLaw } from "./vibration/SiteLaw.js";
export { evaluateReceptor, evaluateMonitors, binDecksByTime, ppvFromCharge } from "./vibration/ReceptorPPV.js";
export { POE_C, DEFAULT_SITE_SIGMA, POE_BANDS, zbScore, probabilityOfExceedance, poeFromPrediction, holePoeAtMonitor, normalQuantile, effectiveTargetForPoE, poeBand } from "./vibration/ProbabilityOfExceedance.js";
export { RippleTankModel, rippleAmplitude, rippleWaveFronts, rippleSourcesFromDecks, resolveRippleParams, RIPPLE_WAVELETS } from "./vibration/RippleTank.js";

// Signal — FFT, wavelets, frequency analysis, seed synthesis, forward array, deconvolution, detune
export { nextPow2, fftInPlace, ifftInPlace, fftMagnitude, peakInRange, peakAbs } from "./signal/FFT.js";
export { SEED_SOURCES, evalRicker, evalRickerCausal, evalGaussianBell, evalDamped, evalBerlage, evalGaussSin, evalMinPhase, evalWavelet,
         generateRicker, generateDampedSinusoid, generateBerlage, generateGaussianBell, generateTwoTerm, resampleMeasured, coerceSamples, buildSeedBundle } from "./signal/Wavelets.js";
export { FREQUENCY_BANDS, frequencyBand, fireTimesFromDecks, computeIDI, computeSpectrum, dominantFrequencies, timeWindowHistogram } from "./signal/FrequencyAnalysis.js";
export { AMPLITUDE_MODES, decksFromEntries, computeBlairDamageScale, synthesizeTrace, tracePeak } from "./signal/SeedSynthesis.js";
export { runForwardArraySynthesis, forwardArrayPVSAtPoints, sourcesFromDecks, bearingFromTo, normaliseAngle, polarisationAngle } from "./signal/ForwardArray.js";
export { extractSignature, pearsonCC } from "./signal/SignatureDeconvolution.js";
export { gaoCorrectionFactor, isGaoNearField, gaoCorrectedSArrival, GAO_NEAR_FIELD_THRESHOLD_M } from "./signal/GaoNearFieldCorrection.js";
export { DETUNE_MODES, mulberry32, dither, roundTimingMs, detuneFireTimes, snapToPalette, rollingWindowCounts, constrainEventRate } from "./signal/Detune.js";

// Damage models
export { computeHolmbergPerssonDamage, HolmbergPerssonDamageModel } from "./damage/HolmbergPerssonDamage.js";
export { computeJointedRockDamage, JointedRockDamageModel } from "./damage/JointedRockDamage.js";

// Pressure / energy models
export { computeBoreholePressure, BoreholePressureModel } from "./pressure/BoreholePressure.js";
export { computePowderFactor, PowderFactorModel } from "./pressure/PowderFactor.js";
export { specificExplosiveEnergy, computeSEE, SEEModel } from "./pressure/SEE.js";

// Detonation
export { simulateDetonation, computeEmValues, processHoleDetonation } from "./detonation/DetonationSimulator.js";
export { computeSequentialEm, computePrimerAwareEm } from "./detonation/EmComputation.js";

// Flyrock
export { richardsMoore, lundborg, mckenzie, envelopeAltitude } from "./flyrock/FlyrockTrajectory.js";
export { generateFlyrockShroud } from "./flyrock/FlyrockShroud.js";
export { computeHoleSDoB, contributingMultiplier, sdobRiskBand, chargeColumnsFromDecks, computeSDoBAtPoint, SDoBModel } from "./flyrock/SDoB.js";
export { ballisticRange, ballisticApex, ballisticFlightTime, optimalLaunchAngle, velocityForRange, sampleTrajectory, sphereDragConstant } from "./flyrock/Ballistics.js";

// Blast movement (voxel throw / muckpile)
export { BlastMovementSimulator, SIM_DEFAULTS } from "./movement/BlastMovementSimulator.js";
export { createParticleState, assignBlockRadii, SpatialHash, solveParticleCollisions, physicsStep, resetParticleState, SUB_DT, DEM_DEFAULTS, ST_INACTIVE, ST_ACTIVE, ST_REST } from "./movement/SphereDEM.js";
export { simHolesFromEntries, prepareChargeElements, nearestHole, assignYangVelocities, assignEnergyPartitionVelocities, YANG_DEFAULTS, ENERGY_DEFAULTS, ELEM_RCUT, PE_SCALE, MAX_LAUNCH_SPEED } from "./movement/InitialVelocity.js";
export { computeThrowDirections, estimateSpacing } from "./movement/ThrowDirections.js";
export { voxeliseVolumes, voxeliseVolumesBudget, voxeliseHoleBBox } from "./movement/Voxeliser.js";
export { buildShellBin, shellCollide, lidExclusionKeys, occKey, OCC_CELL } from "./movement/ShellCollider.js";
export { surfaceBounds, flattenTriangles, calibrationGrid, rasterTop, columnThickness, surfaceFromHeightfield } from "./movement/SurfaceMesh.js";
export { displacementVectors, centreOfMassShift, swellPrescribed, swellEmergent, muckpileHeightfield, surveyTargets } from "./movement/Displacement.js";
export { RapierEngine, hullPoints, RAPIER_DT } from "./movement/RapierEngine.js";

// IO — KAP archives, ZIP, monitor waveform CSVs
export { parseKAP, parseKAPObjects, surfaceRole, resolvePrimerFireMs, deckMassFromGeometry, inlineSurfaceGeometry } from "./io/KAPReader.js";
export { readZip, readZipDirectory, zipExtract, zipExtractText, zipExtractJSON, inflateRawDefault } from "./io/ZipReader.js";
export { parseMonitorCSV, parseInstantelCSV, parseTexcelCSV, looksLikeInstantelCSV, looksLikeTexcelCSV, peakVectorSum } from "./io/MonitorCSV.js";
