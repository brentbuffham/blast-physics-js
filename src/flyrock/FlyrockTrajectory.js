/**
 * FlyrockTrajectory.js — Flyrock distance prediction models
 *
 * Author: Brent Buffham — blastingapps.com & kirra-design.com
 * License: MIT
 *
 * Four published algorithms:
 *   1. Richards & Moore (2004) — empirical face burst / cratering / stem eject
 *   2. Lundborg (1974)          — hole diameter alone
 *   3. McKenzie (2009/2022)     — Scaled Depth of Burial alone
 *   4. Roth (1979)              — Gurney charge-to-burden-mass ratio
 *
 * Ported from Kirra's src/tools/flyrock/FlyrockCalculator.js, which is the
 * reference implementation. Keep the two in lockstep.
 *
 * ⚠️ THESE ARE SAFETY CALCULATIONS. Two transcription errors were corrected in
 *    0.3.1 — see the ⏪ BEFORE blocks on `lundborg` and `mckenzie`. Both moved
 *    published exclusion distances by large factors, and the McKenzie one moved
 *    them the WRONG way for badly-stemmed holes. If you computed a clearance
 *    zone with 0.3.0 or earlier, recompute it.
 *
 * Chernigovskii ballistic envelope:
 *   altitude(d) = (V⁴ − g²·d²) / (2·g·V²)
 *
 * References:
 *   Richards & Moore (2004), Proceedings ISEE 30th Annual Conference
 *   Lundborg (1974), via McKenzie (2022) Eqs (1) and (2)
 *   McKenzie, C.K. (2022) "Flyrock model validation and application",
 *     Rock Fragmentation by Blasting (Fragblast 13), X.G. Wang (ed),
 *     Metallurgical Industry Press, Beijing. ISBN 978-7-5024-9269-4.
 *     Eqs (1)–(3) p.23; Eqs (4)–(7) p.24.
 *   Roth, J. (1979) "A Model for the Determination of Flyrock Range as a
 *     Function of Shot Conditions", Management Science Associates for the
 *     U.S. Bureau of Mines, Contract J0387242. Equations pp.5–11.
 *   Chiappetta & Treleven (1997), SDoB concept
 */

var GRAVITY = 9.80665;  // m/s²
var PI = Math.PI;

/**
 * Read a numeric parameter under either this library's name or Kirra's, so
 * code written against either side ports without silent defaults.
 * An explicit 0 is honoured; only null/undefined/NaN fall through.
 */
function num(params, names, dflt) {
    for (var i = 0; i < names.length; i++) {
        var v = params[names[i]];
        if (v != null && !Number.isNaN(Number(v))) return Number(v);
    }
    return dflt;
}

/**
 * Which inputs each published model ACTUALLY consumes.
 *
 * The differences are not opinions:
 *   K            Richards & Moore only. Lundborg is hole diameter alone,
 *                McKenzie is SDoB alone, Roth is the Gurney charge-to-burden
 *                mass ratio. None of those three has a K term.
 *   rockDensity  Roth (it sets the range, L ∝ 1/ρ) and McKenzie (it sets the
 *                fragment size that reaches the rim, Eq.6 — NOT the range).
 *   condition    Lundborg only: bench Eq.(2) or crater Eq.(1), a 6.5× choice.
 *   burden       Richards & Moore and Roth — the only two with a burden term.
 *
 * Use it to ghost a dial that cannot move the answer, and to record only the
 * inputs a result actually used. A McKenzie shroud recording "K: 14" invites
 * exactly the conclusion that K did something to it.
 */
export var MODEL_INPUTS = {
    richardsMoore: { K: true,  rockDensity: false, lundborgCondition: false, burden: true  },
    lundborg:      { K: false, rockDensity: false, lundborgCondition: true,  burden: false },
    mckenzie:      { K: false, rockDensity: true,  lundborgCondition: false, burden: false },
    roth:          { K: false, rockDensity: true,  lundborgCondition: false, burden: true  }
};

/**
 * Strip the parameters a model does not use, so a saved result's provenance is
 * honest.
 *
 * @param {string} algorithm - richardsMoore | lundborg | mckenzie | roth
 * @param {Object} params    - the full config handed to the model
 * @returns {Object} only the entries that algorithm actually consumed
 */
export function usedInputsFor(algorithm, params) {
    var uses = MODEL_INPUTS[algorithm] || MODEL_INPUTS.richardsMoore;
    var out = {};
    Object.keys(uses).forEach(function (name) {
        if (uses[name] && params && params[name] !== undefined) out[name] = params[name];
    });
    return out;
}

/**
 * Chernigovskii ballistic envelope altitude at horizontal distance d.
 *
 * @param {number} d - Horizontal distance from launch point (m)
 * @param {number} V - Maximum launch velocity (m/s)
 * @returns {number} Maximum altitude above launch elevation (m), or NaN if outside range
 */
export function envelopeAltitude(d, V) {
    var V2 = V * V;
    var numer = V2 * V2 - GRAVITY * GRAVITY * d * d;
    if (numer < 0) return NaN;
    return numer / (2.0 * GRAVITY * V2);
}

/**
 * Richards & Moore (2004) flyrock model.
 *
 *   faceBurst = (K²/g) × (√(W/ℓ) / burden)^2.6
 *   cratering = (K²/g) × (√(W/ℓ) / stemming)^2.6
 *   stemEject = cratering × sin(2θ)
 *
 * ⭐ CRATERING ALWAYS OVERRIDES STEM EJECT, in both range and speed, so the
 *    stem eject angle cannot change any output of this model. Two lines of
 *    algebra:
 *
 *      RANGE  stemEject = cratering·sin(2θ), and sin(2θ) ≤ 1 for every θ,
 *             so stemEject ≤ cratering ALWAYS. It never wins the max().
 *      SPEED  V_SE = √(stemEjectBase·g / sin2θ)
 *                  = √(cratering·sin2θ·g / sin2θ) = √(cratering·g) = V_CR.
 *             The sine divides straight back out.
 *
 *    `stemEjectAngleDeg` stays a parameter because Eq.[7c] is part of the
 *    published model and `stemEject` is reported for completeness — but do not
 *    expose it as a dial, and do not give each mechanism its own launch angle
 *    to "fix" it: the stem-eject shot has the SAME launch speed as cratering
 *    and a STEEPER angle, so its envelope is strictly inside cratering's.
 *
 * @param {Object} params
 * @param {number} params.holeDiamMm       - Hole diameter (mm)
 * @param {number} params.benchHeight      - Bench height H (m)
 * @param {number} params.stemmingLength   - Stemming length St (m)
 * @param {number} params.burden           - Burden B (m)
 * @param {number} params.subdrill         - Subdrill Sd (m)
 * @param {number} params.explosiveDensity - ρ (kg/L)
 * @param {number} [params.K=20]           - Flyrock constant (typical 14–30)
 * @param {number} [params.factorOfSafety=2]
 * @param {number} [params.stemEjectAngleDeg=80] - see the note above
 * @returns {{ faceBurst, cratering, stemEject, maxDistance, maxVelocity, massPerMetre, chargeLength }}
 */
export function richardsMoore(params) {
    var p = params || {};
    var holeDiamMm = num(p, ["holeDiamMm", "holeDiameterMm"], 115);
    var benchHeight = num(p, ["benchHeight"], 12);
    var stemming = num(p, ["stemmingLength"], 2);
    var burden = num(p, ["burden"], 3.6);
    var subdrill = num(p, ["subdrill"], 1);
    var density = num(p, ["explosiveDensity", "inholeDensity"], 1.2);
    var K = num(p, ["K"], 20);
    var fos = num(p, ["factorOfSafety"], 2);
    var stemAngleDeg = num(p, ["stemEjectAngleDeg"], 80);

    var chargeLength = benchHeight + subdrill - stemming;
    var radiusM = (holeDiamMm / 2) / 1000;
    var W = PI * radiusM * radiusM * density * 1000;  // kg/m
    var K2g = (K * K) / GRAVITY;
    var sqrtW = Math.sqrt(W);

    // Base distances (FoS = 1)
    var thetaRad = stemAngleDeg * PI / 180;
    var FB_base = K2g * Math.pow(sqrtW / burden, 2.6);
    var CR_base = K2g * Math.pow(sqrtW / stemming, 2.6);
    var SE_base = CR_base * Math.sin(2 * thetaRad);

    // Clearance distances (FoS-scaled)
    var FB = FB_base * fos;
    var CR = CR_base * fos;
    var SE = SE_base * fos;

    // Launch velocities from BASE distances — FoS scales the exclusion zone,
    // not the physics, so it must not be counted twice.
    var sin2Theta = Math.sin(2 * thetaRad);
    var V_fb = Math.sqrt(FB_base * GRAVITY);
    var V_cr = Math.sqrt(CR_base * GRAVITY);        // sin(2×45°) = 1
    var V_se = sin2Theta > 0 ? Math.sqrt(SE_base * GRAVITY / sin2Theta) : 0;

    return {
        faceBurst: FB,
        cratering: CR,
        stemEject: SE,
        maxDistance: Math.max(FB, CR, SE),
        maxVelocity: Math.max(V_fb, V_cr, V_se),
        massPerMetre: W,
        chargeLength: chargeLength
    };
}

/**
 * Lundborg (1974) maximum flyrock throw, from hole diameter alone.
 *
 * ⚠️ THE UNITS ARE METRES, NOT FEET. Lundborg published the same throw in two
 * equivalent forms, and the fact that they agree numerically is the proof:
 *
 *   CRATER blasting  L'max = 260 × ø_in^(2/3)  =  30  × ø_mm^(2/3)   [Eq.1]
 *   BENCH  blasting  L'max =  40 × ø_in^(2/3)  =  4.6 × ø_mm^(2/3)   [Eq.2]
 *
 * 260 × (229/25.4)^(2/3) = 1126 and 30 × 229^(2/3) = 1123 — the same number,
 * so the "260" form is ALREADY metres. The mm forms are used below precisely
 * so the foot/metre trap cannot recur.
 *
 * ⭐ DEFAULT IS BENCH, and that is deliberate. Crater is the confined,
 * fully-buried single-charge case (misfire assessment); bench is a normal
 * production blast with a free face. Running Eq.(1) on a bench pattern is not
 * "being conservative" — it is the WRONG equation by a factor of 6.5.
 * Conservatism belongs in the Factor of Safety, where it is visible and
 * adjustable. Pass `lundborgCondition: "crater"` explicitly for a fully
 * confined charge.
 *
 * ⏪ BEFORE 0.3.1 this read the 260 coefficient as FEET and multiplied by
 *    0.3048, and offered no bench/crater choice:
 *
 *      var Lmax_feet = 260.0 * Math.pow(holeDiamMm / 25.4, 2/3);
 *      var Lmax_m    = Lmax_feet * 0.3048;
 *
 *    For a 229 mm hole that returned 343.3 m — which is neither published
 *    equation. It is 1.99× the correct BENCH throw (172.2 m) and 0.31× the
 *    correct CRATER throw (1122.9 m).
 *
 * @param {Object} params
 * @param {number} params.holeDiamMm - Hole diameter (mm)
 * @param {number} [params.factorOfSafety=2]
 * @param {string} [params.lundborgCondition="bench"] - "bench" | "crater"
 * @returns {{ rangeMax, baseRange, clearanceDistance, maxDistance, condition, maxVelocity }}
 */
export function lundborg(params) {
    var p = params || {};
    var holeDiamMm = num(p, ["holeDiamMm", "holeDiameterMm"], 115);
    var fos = num(p, ["factorOfSafety"], 2);
    var condition = p.lundborgCondition === "crater" ? "crater" : "bench";

    // mm-form coefficients — see the unit warning above.
    var coefficient = condition === "bench" ? 4.6 : 30;

    var rangeMax = coefficient * Math.pow(holeDiamMm, 2.0 / 3.0);
    var clearance = rangeMax * fos;

    return {
        rangeMax: rangeMax,
        baseRange: rangeMax,
        clearanceDistance: clearance,
        maxDistance: clearance,
        condition: condition,
        maxVelocity: Math.sqrt(rangeMax * GRAVITY)
    };
}

/**
 * McKenzie (2009/2022) flyrock model — SDoB-based.
 *
 *   D    = St + 0.5 × contributingLen     [surface to centre of contributing charge]
 *   SDoB = D / Wt_m^(1/3)                 [Chiappetta & Treleven 1997]  Eq.(4)
 *   Kv   = 0.0728 × SDoB^(−3.251)         [McKenzie 2009 Eq.5]
 *
 * ⚠️ BRACKETS. McKenzie 2022 Eq.(5), printed p.24, is:
 *
 *     L'max = 9.74 × SDoB^(−2.167) × ø_mm^(2/3)
 *
 * The −2.167 applies to SDoB ALONE and the 2/3 to ø_mm ALONE. Keep the three
 * factors separate.
 *
 * Rock density enters ONLY through Eq.(6), the fragment size that achieves
 * L'max — not the range. McKenzie 2022 p.22 is explicit that density "does not
 * affect maximum projection distance".
 *
 *     x'f_mm = 3 × SDoB^(−2.167) × (2600/ρ_rock) × ø_mm^(2/3)      Eq.(6)
 *
 * ⏪ BEFORE 0.3.1 the range was written as one grouped power:
 *
 *      var Rmax = 9.74 * Math.pow(holeDiamMm / Math.pow(sDoB, 2.167), 2/3);
 *
 *    which pushes the 2/3 onto SDoB as well, giving an effective exponent of
 *    −1.4447 instead of −2.167. Measured against the correct form:
 *
 *      SDoB 0.638 (under-stemmed)   697.1 m vs 963.9 m   0.72×  ← UNDER-predicts
 *      SDoB 1.037                   346.0 m vs 337.0 m   1.03×
 *      SDoB 1.834 (well stemmed)    151.8 m vs  98.0 m   1.55×
 *
 *    The two forms agree only at SDoB ≈ 1, which is why it survived review.
 *    The under-prediction is at the dangerous end: badly-stemmed holes are the
 *    ones that actually throw, and the old code cut 267 m off that clearance.
 *    `rockDensity` was also accepted, defaulted and never read.
 *
 * Contributing charge: the top m hole-diameters of the explosive column,
 * m = 10 for ø ≥ 100 mm, 8 for smaller holes.
 *
 * @param {Object} params
 * @param {number} params.holeDiamMm       - Hole diameter (mm)
 * @param {number} params.stemmingLength   - St (m)
 * @param {number} params.chargeLength     - Lc (m)
 * @param {number} params.explosiveDensity - ρ (kg/L)
 * @param {number} [params.rockDensity=2600] - kg/m³ — Eq.(6) fragment size only
 * @param {number} [params.factorOfSafety=2]
 * @returns {{ sDoB, sdob, kv, rangeMax, baseRange, clearanceDistance, maxDistance,
 *             maxVelocity, fragmentSizeMm, contributingMass, massPerMetre }}
 */
export function mckenzie(params) {
    var p = params || {};
    var holeDiamMm = num(p, ["holeDiamMm", "holeDiameterMm"], 115);
    var stemming = num(p, ["stemmingLength"], 2);
    var chargeLen = num(p, ["chargeLength"], 10);
    var density = num(p, ["explosiveDensity", "inholeDensity"], 1.2);
    var rockDensity = num(p, ["rockDensity"], 2600);
    var fos = num(p, ["factorOfSafety"], 2);

    var holeDiamM = holeDiamMm / 1000;
    var radiusM = holeDiamM / 2;

    // Contributing charge: top m hole-diameters of the column
    var mFactor = holeDiamMm >= 100 ? 10 : 8;
    var Lcon = Math.min(chargeLen, mFactor * holeDiamM);

    var W = PI * radiusM * radiusM * density * 1000;  // kg/m
    var Wt_m = W * Lcon;

    // Eq.(4) — Chiappetta SDoB
    var D = stemming + 0.5 * Lcon;
    var sDoB = Wt_m > 0 ? D / Math.pow(Wt_m, 1.0 / 3.0) : 999;

    var kv = sDoB > 0 ? 0.0728 * Math.pow(sDoB, -3.251) : 0;

    // Eq.(5) — THREE SEPARATE FACTORS. See the bracket warning above.
    var diameterTerm = Math.pow(holeDiamMm, 2.0 / 3.0);
    var sdobTerm = Math.pow(sDoB, -2.167);
    var rangeMax = sDoB > 0 ? 9.74 * sdobTerm * diameterTerm : 0;

    // Eq.(6) — fragment size that achieves rangeMax. Reported only; it does
    // NOT scale the clearance, because Eq.(5) carries no density term.
    var fragmentSizeMm = (sDoB > 0 && rockDensity > 0)
        ? 3 * sdobTerm * (2600 / rockDensity) * diameterTerm
        : 0;

    var clearance = rangeMax * fos;

    return {
        sDoB: sDoB,
        sdob: sDoB,
        kv: kv,
        rangeMax: rangeMax,
        baseRange: rangeMax,
        clearanceDistance: clearance,
        maxDistance: clearance,
        maxVelocity: rangeMax > 0 ? Math.sqrt(rangeMax * GRAVITY) : 0,
        fragmentSizeMm: fragmentSizeMm,
        contributingMass: Wt_m,
        massPerMetre: W
    };
}

/**
 * Roth (1979) — Gurney-based flyrock range from a vertical face.
 *
 * ⭐ THE ONLY MODEL HERE IN WHICH ROCK DENSITY CHANGES THE RANGE. Richards &
 * Moore state outright that their trajectory theory "ignores factors such as
 * rock dimension and shape, density, air resistance and wind"; Lundborg and
 * McKenzie have no density term in their range equations. Roth derives the
 * launch velocity from the Gurney equation, where the propelled MASS is the
 * burden rock — so density is structural, not a correction bolted on after.
 *
 *   c/m  = (W/ℓ) / (ρ_m · b² · tan(α/2))                       Eq.(7)
 *   v₀   = 0.44 · D · √(c/m)          ANFO                     Eq.(9)
 *   v₀   = (D/3) · √(c/m)             most other explosives    Eq.(10)
 *   L_m  = v₀²/g                      max range, θ = 45°       Eq.(2)
 *   L′_m = (L_m/2)(√(1 + 4h/L_m) + 1) launched h above ground  Eq.(3)
 *   h_m  = v₀² sin²θ / (2g)           apex at launch angle θ   Eq.(5)
 *
 * c/m is dimensionless: (kg/m) ÷ [(kg/m³)·m²] = 1. So v₀ scales as 1/√ρ_m and
 * RANGE SCALES AS 1/ρ_m — doubling rock density halves the throw.
 *
 * ⚠️ `burden` is the MINIMUM burden from any explosive-loaded part of a
 * FRONT-ROW hole to the free face, not the row-to-row burden used for powder
 * factors. Roth is explicit (p.11); using the larger row burden under-predicts
 * the throw.
 *
 * ⚠️ Roth and McKenzie genuinely disagree about air drag. Roth (p.5): "the
 * effects of air friction are quite small for typical flyrock sizes and
 * velocities", so he uses vacuum ballistics with the optimum at 45°.
 * McKenzie's model is built ON drag, with the optimum falling to roughly
 * 33–40°. Both are offered; neither is silently blended into the other.
 *
 * @param {Object} params
 * @param {number} params.massPerMetre - W/ℓ, explosive per metre of hole (kg/m)
 * @param {number} params.burden       - minimum burden to the free face (m)
 * @param {number} [params.rockDensity=2600] - ρ_m (kg/m³)
 * @param {number} params.detonationVelocityMs - D (m/s), from the charged product
 * @param {boolean} [params.explosiveIsANFO=false] - true selects Eq.(9), else Eq.(10)
 * @param {number} [params.breakoutAngleDeg=90]    - α (Roth Table 1: 90–120)
 * @param {number} [params.launchHeight=0]         - h above receiving ground (m)
 * @param {number} [params.factorOfSafety=2]
 * @returns {{ cOverM, v0, rangeMax, rangeFromHeight, clearance, clearanceDistance,
 *             maxDistance, apexHeight, maxVelocity }}
 */
export function roth(params) {
    var p = params || {};
    var massPerMetre = num(p, ["massPerMetre"], 0);
    var burden = num(p, ["burden"], 0);
    var rockDensity = num(p, ["rockDensity"], 2600);
    var D = num(p, ["detonationVelocityMs", "detonationVelocity"], 0);
    var isANFO = !!p.explosiveIsANFO;
    var alphaDeg = num(p, ["breakoutAngleDeg"], 90);
    var launchHeight = num(p, ["launchHeight"], 0);
    var fos = num(p, ["factorOfSafety"], 2);

    // tan(α/2). Roth assumes α ≈ 90°, giving 1. Guard the degenerate ends so a
    // silly α can never divide by zero or flip the sign of c/m.
    var tanHalfAlpha = Math.tan((alphaDeg / 2) * (PI / 180));
    if (!isFinite(tanHalfAlpha) || tanHalfAlpha <= 0) tanHalfAlpha = 1;

    var denom = rockDensity * burden * burden * tanHalfAlpha;
    if (denom <= 0 || massPerMetre <= 0 || D <= 0) {
        return { cOverM: 0, v0: 0, rangeMax: 0, rangeFromHeight: 0, clearance: 0,
                 clearanceDistance: 0, maxDistance: 0, apexHeight: 0, maxVelocity: 0 };
    }

    var cOverM = massPerMetre / denom;                      // Eq.(7), dimensionless
    var gurney = isANFO ? 0.44 * D : D / 3;                 // Eq.(9) / Eq.(10)
    var v0 = gurney * Math.sqrt(cOverM);
    var rangeMax = (v0 * v0) / GRAVITY;                     // Eq.(2), θ = 45°

    // Eq.(3) — extra reach when the collar sits above the receiving ground.
    var rangeFromHeight = rangeMax;
    if (launchHeight > 0 && rangeMax > 0) {
        rangeFromHeight = (rangeMax / 2) * (Math.sqrt(1 + (4 * launchHeight) / rangeMax) + 1);
    }

    // Eq.(5) — apex of a single 45° trajectory. NOT the all-angle envelope
    // apex, which is v₀²/2g; the 45° shot peaks at only half that.
    var apexHeight = (v0 * v0) / (4 * GRAVITY);
    var clearance = rangeFromHeight * fos;

    return {
        cOverM: cOverM,
        v0: v0,
        rangeMax: rangeMax,
        rangeFromHeight: rangeFromHeight,
        clearance: clearance,
        clearanceDistance: clearance,
        maxDistance: clearance,
        apexHeight: apexHeight,
        maxVelocity: v0
    };
}

/**
 * Roth Eq.(1) and Eq.(5) — range and apex for an EXPLICIT launch angle.
 *
 * Kept separate from `roth()` because a shroud built as the all-angle envelope
 * cancels the launch angle by construction. These are what an angle-shaped
 * dome needs, and they are why a steeper ejection throws higher and shorter:
 *
 *   L   = v₀² sin(2θ) / g      maximised at θ = 45°
 *   h_m = v₀² sin²θ / (2g)     rises monotonically to θ = 90°
 *
 * @param {number} v0 - launch velocity (m/s)
 * @param {number} launchAngleDeg - θ from horizontal
 * @returns {{ range: number, apexHeight: number }}
 */
export function rothAtLaunchAngle(v0, launchAngleDeg) {
    var th = (launchAngleDeg || 45) * (PI / 180);
    var v2 = v0 * v0;
    return {
        range: (v2 * Math.sin(2 * th)) / GRAVITY,
        apexHeight: (v2 * Math.pow(Math.sin(th), 2)) / (2 * GRAVITY)
    };
}
