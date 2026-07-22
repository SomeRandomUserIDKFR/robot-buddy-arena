import { MIMIC_BLEND, SIGHT } from "./config.js";
import {
  DIRECTIVES, activeDirectives, addHistory, directiveStatusLine, ensureCoaching,
  recentProposalIntents, rememberProposal, topicPreference
} from "./coaching.js";
import { isPrecisionAimWeapon } from "./equipment.js";
import { clamp, dist } from "./utils.js";

export const MIMIC_INTENSITY_KEYS = ["slight", "quite", "full"];
export const MIMIC_LOCKED_LINE = "I don't know your style well enough yet.";
export const AI_MODE_KEYS = ["flash", "balanced", "thinker", "mimic"];

export const HABIT_DOMAINS = [
  "engagementRange", "rushPrediction", "dodgeTiming", "jetpackUse", "lowHpBehavior",
  "shieldUse"
];
/** Tolerance when judging shield camp vs conserve predictions. */
export const SHIELD_JUDGE_TOLERANCE = .25;
/** Avg hold (s) that maps to a full “camp” hold score in the observation. */
export const SHIELD_HOLD_BASELINE_SEC = 1;
export const CAPABILITY_DOMAINS = ["aim", "dodgeTiming", "fuelManagement", "precisionAim"];

/** Max fractional cut to buddy AI aim-error when holding a marksman/sniper. */
export const PRECISION_AIM_MAX_REDUCTION = .06;

/**
 * Habit readiness bars (evidence reliability, not match-count XP).
 *
 * Default habits (engagementRange, rushPrediction, jetpackUse, lowHpBehavior, shieldUse):
 *   enter ready ≥ READY_ENTER_SAMPLES samples & reliability ≥ READY_ENTER_RELIABILITY
 * Dodge timing is slightly easier so consistent dodgers are not stuck “testing”:
 *   enter ready ≥ DODGE_READY_ENTER_SAMPLES & reliability ≥ DODGE_READY_ENTER_RELIABILITY
 *
 * Hysteresis (all habit domains): once ready (`settled`), stay ready until
 * reliability drops below READY_EXIT_RELIABILITY — stops flicker when a domain
 * hovers near the enter bar (common for saber rushPrediction).
 * shieldUse is only sampled when the player has a shield and raises under pressure;
 * unsampled shieldUse is ignored by readiness (never blocks "I'm ready").
 */
export const READY_ENTER_SAMPLES = 7;
export const READY_ENTER_RELIABILITY = .58;
export const READY_EXIT_RELIABILITY = .45;
export const DODGE_READY_ENTER_SAMPLES = 5;
export const DODGE_READY_ENTER_RELIABILITY = .5;
export const TESTING_MIN_SAMPLES = 3;
export const TESTING_MIN_RELIABILITY = .3;
/** Ignore sparse / accidental dodges so non-dodging matches do not pollute. */
export const DODGE_JUDGE_MIN_DODGES = 3;
export const DODGE_JUDGE_TOLERANCE = .3;

export function emptyEvidence() {
  return { successes: 0, failures: 0, samples: 0, estimate: null, settled: false };
}

export function normalizeEvidence(value) {
  const result = emptyEvidence();
  if (!value || typeof value !== "object") return result;
  result.successes = Math.max(0, Number(value.successes) || 0);
  result.failures = Math.max(0, Number(value.failures) || 0);
  result.samples = result.successes + result.failures;
  result.estimate = value.estimate !== null
    && value.estimate !== ""
    && Number.isFinite(Number(value.estimate))
    ? clamp(Number(value.estimate), 0, 1)
    : null;
  result.settled = !!value.settled;
  return result;
}

function readyThresholds(domain) {
  if (domain === "dodgeTiming") {
    return {
      enterSamples: DODGE_READY_ENTER_SAMPLES,
      enterReliability: DODGE_READY_ENTER_RELIABILITY,
      exitReliability: READY_EXIT_RELIABILITY
    };
  }
  return {
    enterSamples: READY_ENTER_SAMPLES,
    enterReliability: READY_ENTER_RELIABILITY,
    exitReliability: READY_EXIT_RELIABILITY
  };
}

export function ensureLearningProfile(data) {
  if (!data || typeof data !== "object") data = {};
  data.schema = 2;
  if (!data.habits || typeof data.habits !== "object") data.habits = {};
  if (!data.capabilities || typeof data.capabilities !== "object") data.capabilities = {};
  for (const domain of HABIT_DOMAINS) data.habits[domain] = normalizeEvidence(data.habits[domain]);
  for (const domain of CAPABILITY_DOMAINS) {
    data.capabilities[domain] = normalizeEvidence(data.capabilities[domain]);
  }
  return data;
}

export function evidenceReliability(record) {
  const value = normalizeEvidence(record);
  // Beta(1,1) posterior. The sample factor keeps tiny perfect runs uncertain.
  const posterior = (value.successes + 1) / (value.samples + 2);
  const certainty = value.samples / (value.samples + 5);
  return posterior * certainty;
}

/**
 * Scale for AI aim-error cone while the buddy holds a marksman/sniper.
 * Returns 1 (no bonus) for other weapons or empty precisionAim evidence.
 * At full reliability: multiply aim error by (1 - PRECISION_AIM_MAX_REDUCTION).
 * Accepts a weapon id string or a fighter object (for Adaptive Nanotech Unit's
 * mode-dependent sniper gimmick).
 */
export function precisionAimErrorScale(learned, weaponIdOrFighter) {
  if (!isPrecisionAimWeapon(weaponIdOrFighter)) return 1;
  const profile = ensureLearningProfile(learned);
  const reliability = evidenceReliability(profile.capabilities.precisionAim);
  return 1 - reliability * PRECISION_AIM_MAX_REDUCTION;
}

function classifyUnsettled(samples, reliability, thresholds) {
  if (samples < TESTING_MIN_SAMPLES || reliability < TESTING_MIN_RELIABILITY) {
    return "not-ready";
  }
  if (samples < thresholds.enterSamples || reliability < thresholds.enterReliability) {
    return "testing";
  }
  return "ready";
}

/**
 * Evidence readiness with hysteresis. Pass `domain` for habit-specific bars
 * (dodgeTiming uses a slightly lower enter threshold). Mutates `record.settled`
 * when the latch engages or clears so status stays stable across matches.
 */
export function evidenceState(record, domain = null) {
  const value = normalizeEvidence(record);
  const thresholds = readyThresholds(domain);
  const reliability = evidenceReliability(value);
  let state;
  if (value.settled) {
    if (reliability < thresholds.exitReliability) {
      value.settled = false;
      state = classifyUnsettled(value.samples, reliability, thresholds);
    } else {
      state = "ready";
    }
  } else {
    state = classifyUnsettled(value.samples, reliability, thresholds);
    if (state === "ready") value.settled = true;
  }
  if (record && typeof record === "object") record.settled = value.settled;
  return state;
}

export function recordEvidence(record, success, observedValue = null, weight = 1) {
  const value = normalizeEvidence(record);
  const amount = clamp(Number(weight) || 1, .25, 2);
  if (success) value.successes += amount;
  else value.failures += amount;
  value.samples = value.successes + value.failures;
  if (Number.isFinite(observedValue)) {
    const observation = clamp(observedValue, 0, 1);
    const rate = Math.min(.35, amount / Math.max(1, value.samples));
    value.estimate = value.estimate === null
      ? observation
      : value.estimate + (observation - value.estimate) * rate;
  }
  Object.assign(record, value);
  return record;
}

function relevantRecords(data) {
  const learned = ensureLearningProfile(data);
  return HABIT_DOMAINS.map((domain) => [domain, learned.habits[domain]])
    .filter(([, record]) => record.samples > 0);
}

export function readiness(data) {
  const records = relevantRecords(data);
  if (!records.length || records.every(([domain, record]) => evidenceState(record, domain) === "not-ready")) {
    return "I'm not ready yet.";
  }
  if (records.length < 2 || records.some(([domain, record]) => evidenceState(record, domain) !== "ready")) {
    return "Am I ready?";
  }
  return "I'm ready.";
}

export function normalizeAiMode(mode) {
  return AI_MODE_KEYS.includes(mode) ? mode : "balanced";
}

export function normalizeMimicIntensity(value) {
  return MIMIC_INTENSITY_KEYS.includes(value) ? value : "quite";
}

/**
 * Mimic unlock from evidence readiness (not XP%):
 * - "I'm not ready yet." → locked
 * - "Am I ready?" → available; Full intensity still locked
 * - "I'm ready." → Full intensity unlocked
 */
export function mimicUnlockLevel(data) {
  const status = readiness(data);
  if (status === "I'm not ready yet.") return "locked";
  if (status === "Am I ready?") return "partial";
  return "full";
}

export function mimicIntensityAllowed(intensity, data) {
  const level = mimicUnlockLevel(data);
  const key = normalizeMimicIntensity(intensity);
  if (level === "locked") return false;
  if (key === "full") return level === "full";
  return true;
}

/** Blend weight for how strongly player habits override default AI style. */
export function mimicBlendFactor(intensity, data) {
  const level = mimicUnlockLevel(data);
  if (level === "locked") return 0;
  let key = normalizeMimicIntensity(intensity);
  if (key === "full" && level !== "full") key = "quite";
  return MIMIC_BLEND[key];
}

const DOMAIN_LABELS = {
  engagementRange: "your engagement range",
  rushPrediction: "saber rushes",
  dodgeTiming: "your dodge timing",
  jetpackUse: "your jetpack use",
  lowHpBehavior: "your low-HP behavior",
  shieldUse: "your shield use"
};

export function readinessDetails(data) {
  const learned = ensureLearningProfile(data);
  return HABIT_DOMAINS.map((domain) => {
    const state = evidenceState(learned.habits[domain], domain);
    const label = DOMAIN_LABELS[domain];
    if (state === "ready") return `Ready to anticipate ${label}`;
    if (state === "testing") return `Still testing predictions about ${label}`;
    return `Not enough evidence about ${label}`;
  });
}

// How far the belief sits from a coin flip; a decisive read (either way)
// is more informative than a large pile of ambiguous samples.
function evidenceDecisiveness(record) {
  const value = normalizeEvidence(record);
  return Math.abs((value.successes + 1) / (value.samples + 2) - .5);
}

export function dominantHabit(data) {
  const learned = ensureLearningProfile(data);
  const practiced = HABIT_DOMAINS
    .map((domain) => [domain, learned.habits[domain]])
    .filter(([, record]) => record.samples > 0)
    .sort((a, b) => (b[1].samples - a[1].samples)
      || (evidenceDecisiveness(b[1]) - evidenceDecisiveness(a[1])))[0];
  if (!practiced) return "No judged predictions or counters yet.";
  return readinessDetails(learned)[HABIT_DOMAINS.indexOf(practiced[0])];
}

// Readiness lines for every sampled habit domain, ordered by how much
// evidence backs them. Unsampled domains are omitted so the list matches
// what readiness() actually considers (no hidden blockers).
export function topReadinessDetails(data, count = Infinity) {
  const learned = ensureLearningProfile(data);
  const details = readinessDetails(learned);
  const ranked = HABIT_DOMAINS
    .map((domain, index) => ({ detail: details[index], record: learned.habits[domain] }))
    .filter((entry) => entry.record.samples > 0)
    .sort((a, b) => (b.record.samples - a.record.samples)
      || (evidenceDecisiveness(b.record) - evidenceDecisiveness(a.record)));
  const limit = Number.isFinite(count) ? Math.max(0, count) : ranked.length;
  return ranked.slice(0, limit).map((entry) => entry.detail);
}

function opportunity(game, key, interval = 1.5) {
  game.learningWindows ||= {};
  const last = game.learningWindows[key] ?? -99;
  if (game.elapsed - last < interval) return false;
  game.learningWindows[key] = game.elapsed;
  return true;
}

/** Training writes no habit / capability / coaching practice evidence when locked. */
export function isLearningLocked(profile) {
  return !!profile?.learningLocked;
}

export function trackTraining(game, dt) {
  if (game.mode !== "training") return;
  const player = game.fighters[0];
  const buddy = game.fighters[1];
  if (player.dead || buddy.dead) return;
  const distance = dist(player, buddy);
  const stats = game.stats;
  // Range preference is only sampled while the fight is actually joined
  // (buddy within sight), so long spawn approaches never skew the average.
  if (distance <= SIGHT) {
    stats.rangeSum += distance * dt;
    stats.samples += dt;
  }

  const closing = Math.sign(buddy.x - player.x) * player.vx > 100;
  if (closing) stats.closing += dt;
  // A "rush" requires sustained commitment, not one frame of approach speed.
  game.closingStreak = closing ? (game.closingStreak || 0) + dt : 0;
  if (player.thrusting) {
    stats.playerJetTime += dt;
    if (distance < 400 || closing) stats.jetAggro += dt;
    else stats.jetEscape += dt;
  }
  if (player.hp < 180) stats.lowHpTime += dt;

  const buddyClosing = Math.sign(player.x - buddy.x) * buddy.vx;
  if (buddyClosing > 80) stats.buddyClosing += dt;
  if (buddyClosing < -80) stats.buddyRetreat += dt;
  if (distance < 260) stats.buddyClose += dt;
  if (distance > 430) stats.buddyFar += dt;
  if (Math.abs(buddy.vx) > 100) stats.buddyMoving += dt;
  if (buddy.thrusting) stats.buddyJet += dt;

  // Opportunities only exist around meaningful actions; idle time creates none.
  // Merely walking toward the buddy (which every match requires) is not a
  // rush: the player must keep closing for over half a second and actually
  // end up inside close range before it counts.
  if (game.closingStreak > .6 && distance < 360 && opportunity(game, "rush")) {
    stats.rushOpportunities++;
  }
  if (player.thrusting && opportunity(game, "jet")) stats.jetOpportunities++;
  if (player.hp < 180 && opportunity(game, "lowHp", 2)) stats.lowHpOpportunities++;

  // Shield habits only accrue when the player actually has a usable shield.
  // Unsampled shieldUse never participates in readiness (same as other domains).
  const hasShield = (player.shieldMaxDurability || 0) > 0 && !player.shieldBroken;
  if (hasShield) {
    const buddyClosingHard = buddyClosing > 80;
    const underPressure = distance < 420 || buddyClosingHard;
    if (underPressure) {
      stats.shieldPressureTime += dt;
      if (player.shieldRaised) stats.shieldRaisedUnderPressure += dt;
    }
    if (player.shieldRaised) {
      stats.shieldRaisedTime += dt;
      game.shieldRaiseStreak = (game.shieldRaiseStreak || 0) + dt;
    } else if ((game.shieldRaiseStreak || 0) > .05) {
      stats.shieldHoldSum += game.shieldRaiseStreak;
      stats.shieldHolds++;
      game.shieldRaiseStreak = 0;
    } else {
      game.shieldRaiseStreak = 0;
    }

    if (underPressure && opportunity(game, "shield", 1.2)) {
      stats.shieldOpportunities++;
      if (player.shieldRaised) stats.shieldRaisesOnOpp++;
    }

    if (player.shieldRaised && !game.playerWasShieldRaised) {
      stats.shieldRaiseCount++;
      if (underPressure || buddyClosingHard) stats.shieldRaiseOnApproach++;
      if (game.elapsed - (game.lastPlayerAttackAt || -99) < .45) {
        stats.shieldRaiseAfterShot++;
      }
      if (player.hp < 180) stats.shieldRaiseLowHp++;
    }
    game.playerWasShieldRaised = !!player.shieldRaised;
  } else {
    game.playerWasShieldRaised = false;
    game.shieldRaiseStreak = 0;
  }
}

/** 0 = pop-block / conserve, 1 = camp / burn. Used by updateLearning + tests. */
export function shieldCampObservation(stats) {
  const pressure = Math.max(.01, stats.shieldPressureTime || 0);
  const raiseFrac = clamp((stats.shieldRaisedUnderPressure || 0) / pressure, 0, 1);
  const holds = stats.shieldHolds || 0;
  const avgHold = holds > 0 ? (stats.shieldHoldSum || 0) / holds : 0;
  const holdNorm = clamp(avgHold / SHIELD_HOLD_BASELINE_SEC, 0, 1);
  const absorbed = stats.shieldDamageAbsorbed || 0;
  const maxPool = Math.max(1, stats.shieldMaxDurability || absorbed || 1);
  let burn = clamp(absorbed / maxPool, 0, 1);
  if (stats.shieldBroke) burn = Math.max(burn, .85);
  return clamp(raiseFrac * .5 + holdNorm * .35 + burn * .15, 0, 1);
}

function judge(record, observed, tolerance) {
  const prediction = record.estimate;
  // First real observation seeds the belief; there is nothing to score yet.
  if (prediction === null) {
    recordEvidence(record, true, observed);
    return;
  }
  const success = Math.abs(prediction - observed) <= tolerance;
  recordEvidence(record, success, observed);
}

export function updateLearning(game, profile) {
  if (game.mode !== "training") return [];
  if (isLearningLocked(profile)) return [];
  const stats = game.stats;
  const player = game.fighters[0];
  const learned = ensureLearningProfile(profile.weapons[player.weapon]);
  const changed = [];

  // Range preference reflects where the player chose to spend the fight, not
  // just where attacks landed (a melee buddy forces every exchange close, so
  // attack-only sampling would misread any playstyle as close-range).
  if (stats.attacks > 0 && (stats.samples || 0) >= 6) {
    const timeRange = stats.rangeSum / stats.samples;
    const attackRange = stats.attackRangeSum / stats.attacks;
    judge(
      learned.habits.engagementRange,
      clamp((timeRange * .65 + attackRange * .35) / SIGHT, 0, 1),
      .18
    );
    changed.push("engagementRange");
  }
  if (stats.rushOpportunities > 0) {
    const outcome = stats.rushCounterSuccesses / stats.rushOpportunities;
    recordEvidence(learned.habits.rushPrediction, outcome >= .5, clamp(stats.closing / Math.max(.01, game.elapsed), 0, 1));
    changed.push("rushPrediction");
  }
  // Meaningful dodge volume only — a stray dodge in a non-dodge match must
  // not drag the timing estimate around.
  if (stats.dodges >= DODGE_JUDGE_MIN_DODGES) {
    judge(learned.habits.dodgeTiming, stats.reactive / stats.dodges, DODGE_JUDGE_TOLERANCE);
    changed.push("dodgeTiming");
  }
  if (stats.jetOpportunities > 0) {
    judge(learned.habits.jetpackUse, stats.jetAggro / Math.max(.01, stats.playerJetTime), .25);
    changed.push("jetpackUse");
  }
  if (stats.lowHpOpportunities > 0) {
    judge(
      learned.habits.lowHpBehavior,
      clamp(stats.lowHpAttack / stats.lowHpOpportunities, 0, 1),
      .25
    );
    changed.push("lowHpBehavior");
  }
  // Flush an in-progress raise so hold duration is not lost at match end.
  if ((game.shieldRaiseStreak || 0) > .05) {
    stats.shieldHoldSum = (stats.shieldHoldSum || 0) + game.shieldRaiseStreak;
    stats.shieldHolds = (stats.shieldHolds || 0) + 1;
    game.shieldRaiseStreak = 0;
  }
  if ((stats.shieldOpportunities || 0) > 0) {
    if (player.shieldMaxDurability > 0) {
      stats.shieldMaxDurability = player.shieldMaxDurability;
    }
    judge(learned.habits.shieldUse, shieldCampObservation(stats), SHIELD_JUDGE_TOLERANCE);
    changed.push("shieldUse");
  }

  if (stats.buddyAttacks > 0) {
    const aimOk = stats.buddyHits / stats.buddyAttacks >= .35;
    recordEvidence(learned.capabilities.aim, aimOk);
    // Precision gimmick: only Training matches where the buddy fought with a
    // marksman/sniper accrue this domain. Pulse/carbine practice never does.
    const buddy = game.fighters.find((fighter) => fighter.buddy) || game.fighters[1];
    if (buddy && isPrecisionAimWeapon(buddy)) {
      recordEvidence(learned.capabilities.precisionAim, aimOk);
      changed.push("precisionAim");
    }
  }
  if (stats.buddyDodgeAttempts > 0) {
    recordEvidence(
      learned.capabilities.dodgeTiming,
      stats.buddyDodgeSuccesses / stats.buddyDodgeAttempts >= .5
    );
  }
  if (stats.fuelOpportunities > 0) {
    recordEvidence(
      learned.capabilities.fuelManagement,
      stats.fuelSuccesses / stats.fuelOpportunities >= .5
    );
  }
  return changed;
}

function directiveOutcome(game, intent) {
  const stats = game.stats;
  const attempts = {
    rush: stats.rushOpportunities,
    safer: stats.buddyRetreat > 0 ? 1 : 0,
    stayClose: stats.rushOpportunities,
    keepDistance: stats.attacks,
    saveFuel: stats.fuelOpportunities,
    useJetpack: stats.jetOpportunities,
    dodgeMore: stats.buddyDodgeAttempts,
    flankScout: stats.attacks,
    focusTargets: game.pings.length
  }[intent] || 0;
  const success = {
    rush: stats.rushCounterSuccesses > 0,
    safer: stats.buddyRetreat > 1 && stats.buddyDamageTaken < 100,
    stayClose: stats.buddyClose > 1,
    keepDistance: stats.buddyFar > 1 && stats.buddyHits > 0,
    saveFuel: stats.fuelSuccesses > 0,
    useJetpack: stats.buddyJet > 1 && stats.buddyHits > 0,
    dodgeMore: stats.buddyDodgeSuccesses > 0,
    flankScout: stats.buddyMoving > 2 && stats.buddyHits > 0,
    focusTargets: stats.pingTargetHits > 0
  }[intent] || false;
  return { attempts, success };
}

export function advanceDirectiveTraining(game, profile) {
  if (isLearningLocked(profile)) return [];
  const player = game.fighters[0];
  const lines = [];
  for (const directive of activeDirectives(profile, player.weapon)) {
    if ((directive.confirmedAt || 0) > game.startedAt) continue;
    const outcome = directiveOutcome(game, directive.intent);
    if (!outcome.attempts) continue;
    directive.successes = Math.max(0, Number(directive.successes) || 0) + (outcome.success ? 1 : 0);
    directive.failures = Math.max(0, Number(directive.failures) || 0) + (outcome.success ? 0 : 1);
    directive.evidence = evidenceReliability(directive);
    directive.observations = Array.isArray(directive.observations) ? directive.observations : [];
    directive.observations.push({ at: Date.now(), success: outcome.success });
    directive.observations = directive.observations.slice(-8);
    directive.status = evidenceState(directive, directive.domain || null) === "ready"
      ? "practiced"
      : "needs-practice";
    lines.push(directiveStatusLine(directive));
  }
  return lines;
}

// Each candidate needs real, skewed evidence before the buddy will claim it
// saw a habit. Scores are comparable (0..1) so the most distinctive pattern
// wins on data, not on if-chain ordering. Every evidence domain that this
// match actually produced data for can surface here: range (close/long/mid),
// rush commitment, dodge timing, jetpack height use, retreat/escape, low-HP
// behavior, fuel usage, and target marking.
function proposalCandidates(game) {
  const stats = game.stats;
  const fightTime = stats.samples || 0;
  const avgRange = fightTime > 0 ? stats.rangeSum / fightTime : null;
  const elapsed = Math.max(1, game.elapsed || 0);
  const candidates = [];
  const enoughFight = fightTime >= 8 && avgRange !== null;

  if (enoughFight && stats.rushOpportunities >= 2 && avgRange < SIGHT * .38) {
    candidates.push({
      intent: "stayClose",
      domain: "engagementRange",
      score: clamp(stats.rushOpportunities / 5, 0, 1) * .5
        + clamp((SIGHT * .38 - avgRange) / (SIGHT * .38), 0, 1) * .5,
      line: "You kept committing to close-range attacks. I could practice supporting those rushes.",
      note: "how often you fought up close"
    });
  }
  if (enoughFight && stats.attacks >= 4 && !stats.rushOpportunities && avgRange > SIGHT * .55) {
    candidates.push({
      intent: "keepDistance",
      domain: "engagementRange",
      score: clamp((avgRange - SIGHT * .55) / (SIGHT * .45), 0, 1) * .5
        + clamp(stats.attacks / 12, 0, 1) * .5,
      line: "You held your distance and fought from long range. I could practice keeping range and covering you.",
      note: "how you held long range"
    });
  }
  if (enoughFight && stats.attacks >= 6 && avgRange >= SIGHT * .38 && avgRange <= SIGHT * .55) {
    candidates.push({
      intent: "flankScout",
      domain: "engagementRange",
      score: clamp(stats.attacks / 14, 0, 1) * .7
        + clamp(fightTime / 30, 0, 1) * .3,
      line: "You traded a lot of fire at mid range. I could practice flanking to open a second angle for you.",
      note: "your mid-range trading"
    });
  }
  if (stats.rushOpportunities >= 3 && stats.closing >= elapsed * .2) {
    candidates.push({
      intent: "rush",
      domain: "rushPrediction",
      score: clamp(stats.rushOpportunities / 6, 0, 1) * .5
        + clamp(stats.closing / elapsed / .5, 0, 1) * .5,
      line: "You committed to sustained pushes instead of poking. I could practice engaging alongside you sooner.",
      note: "your rush commitment"
    });
  }
  if (stats.dodges >= 3) {
    candidates.push({
      intent: "dodgeMore",
      domain: "dodgeTiming",
      score: clamp(stats.dodges / 8, 0, 1) * .6
        + clamp(stats.reactive / Math.max(1, stats.dodges), 0, 1) * .4,
      line: "You dodged repeatedly under fire. I could practice matching that defensive timing.",
      note: "your dodge timing"
    });
  }
  // Height only counts as a habit when the jetpack was actually used inside
  // engagements; traversal or escape burns must not read as "height play".
  if (
    stats.jetOpportunities >= 3 && stats.playerJetTime >= 2
    && stats.jetAggro > (stats.jetEscape || 0)
  ) {
    candidates.push({
      intent: "useJetpack",
      domain: "jetpackUse",
      score: clamp(stats.jetAggro / Math.max(.01, stats.playerJetTime), 0, 1) * .5
        + clamp(stats.jetOpportunities / 10, 0, 1) * .5,
      line: "You used height during engagements. I could practice joining those attacks.",
      note: "your use of height"
    });
  }
  if (
    stats.playerJetTime >= 2 && (stats.jetEscape || 0) >= 1.5
    && stats.jetEscape > stats.jetAggro * 1.25
  ) {
    candidates.push({
      intent: "safer",
      domain: "jetpackUse",
      score: clamp(stats.jetEscape / Math.max(.01, stats.playerJetTime), 0, 1) * .6
        + clamp(stats.jetEscape / 5, 0, 1) * .4,
      line: "You mostly used the jetpack to break away from pressure. I could practice covering your retreats.",
      note: "how you disengaged"
    });
  }
  if (stats.playerJetTime >= elapsed * .3 && elapsed >= 20) {
    candidates.push({
      intent: "saveFuel",
      domain: "jetpackUse",
      score: clamp(stats.playerJetTime / elapsed, 0, 1),
      line: "You kept the jetpack burning most of the fight. I could practice conserving fuel so one of us always has mobility.",
      note: "your fuel usage"
    });
  }
  if (stats.lowHpOpportunities >= 2) {
    const aggression = clamp(stats.lowHpAttack / stats.lowHpOpportunities, 0, 1);
    const volume = clamp(stats.lowHpOpportunities / 5, 0, 1);
    if (aggression >= .6) {
      candidates.push({
        intent: "stayClose",
        domain: "lowHpBehavior",
        score: volume * .5 + aggression * .5,
        line: "Even at low health you kept fighting. I could practice staying close to shield those moments.",
        note: "how you fight when hurt"
      });
    } else if (aggression <= .4) {
      candidates.push({
        intent: "safer",
        domain: "lowHpBehavior",
        score: volume * .5 + (1 - aggression) * .5,
        line: "When your health dropped you disengaged. I could practice retreating with you and covering the escape.",
        note: "how you play when hurt"
      });
    }
  }
  if (stats.pingTargetHits >= 2) {
    candidates.push({
      intent: "focusTargets",
      domain: null,
      score: clamp(stats.pingTargetHits / 6, 0, 1),
      line: "You marked targets and we converted those pings. I could practice prioritizing your marks.",
      note: "your target marking"
    });
  }
  if ((stats.shieldOpportunities || 0) >= 3 && (stats.shieldPressureTime || 0) >= 2) {
    const camp = shieldCampObservation(stats);
    const volume = clamp(stats.shieldOpportunities / 8, 0, 1);
    if (camp >= .58) {
      candidates.push({
        intent: "safer",
        domain: "shieldUse",
        score: volume * .45 + camp * .55,
        line: "You kept the shield up under pressure. I could practice covering with longer, more frequent raises.",
        note: "how you camped the shield"
      });
    } else if (camp <= .38) {
      candidates.push({
        intent: "safer",
        domain: "shieldUse",
        score: volume * .45 + (1 - camp) * .55,
        line: "You mostly pop-blocked and conserved shield durability. I could practice shorter, thriftier raises.",
        note: "how you conserved the shield"
      });
    }
  }

  // One entry per intent: keep whichever reading has the stronger evidence.
  const byIntent = new Map();
  for (const candidate of candidates) {
    const existing = byIntent.get(candidate.intent);
    if (!existing || candidate.score > existing.score) byIntent.set(candidate.intent, candidate);
  }
  return [...byIntent.values()].sort((a, b) => b.score - a.score);
}

// Priority = evidence strength, plus unresolved learning value (domains the
// buddy has not settled yet teach more), plus player interest (topics they
// already coach), minus rotation pressure on recently proposed topics.
function prioritizeCandidates(candidates, learned, profile, weapon) {
  const recent = recentProposalIntents(profile, weapon);
  const coached = new Set(activeDirectives(profile, weapon).map((item) => item.intent));
  return candidates.map((candidate) => {
    const record = candidate.domain ? learned.habits[candidate.domain] : null;
    const state = record ? evidenceState(record, candidate.domain) : "not-ready";
    let priority = candidate.score;
    priority += state === "not-ready" ? .15 : state === "testing" ? .08 : 0;
    if (coached.has(candidate.intent)) priority += .1;
    const lastIndex = recent.lastIndexOf(candidate.intent);
    if (lastIndex >= 0) {
      const back = recent.length - 1 - lastIndex;
      priority -= back === 0 ? .3 : back === 1 ? .15 : .05;
    }
    const pref = topicPreference(profile, weapon, candidate.intent);
    const declined = !!(pref && pref.declined);
    const estimate = record?.estimate ?? null;
    // A declined topic may only resurface when the observed habit moved far
    // from where it was when the player said no; each extra denial raises
    // the bar further.
    const changeNeeded = .25 + .1 * ((pref?.declines || 1) - 1);
    const changed = declined
      && pref.estimateAtDecline !== null && estimate !== null
      && Math.abs(estimate - pref.estimateAtDecline) >= changeNeeded;
    return { ...candidate, priority, estimate, declined, changed };
  }).sort((a, b) => b.priority - a.priority);
}

export function createTrainingProposal(game, profile) {
  const coaching = ensureCoaching(profile);
  if (isLearningLocked(profile)) {
    coaching.pending = null;
    coaching.proposal = null;
    const observation = "That was a spar only — I fought you, but I did not update what I know or my practice evidence. Ask me anything, or coach a goal for later Training.";
    addHistory(profile, "buddy", observation);
    return { intent: null, observation, spar: true };
  }

  const stats = game.stats;
  const player = game.fighters[0];
  const weapon = player.weapon;
  const sawAnything = stats.attacks || stats.rushOpportunities || stats.dodges
    || stats.jetOpportunities || stats.shieldOpportunities
    || (stats.samples || 0) >= 2;
  if (!sawAnything) return null;

  const learned = ensureLearningProfile(profile.weapons[weapon]);
  const candidates = proposalCandidates(game);
  if (!candidates.length) {
    // Honest uncertainty beats a canned claim when the evidence is thin.
    const observation = "I have not seen a clear pattern in how you fight yet. I will keep watching before proposing a lesson.";
    coaching.pending = null;
    coaching.proposal = null;
    addHistory(profile, "buddy", observation);
    return { intent: null, observation };
  }

  const scored = prioritizeCandidates(candidates, learned, profile, weapon);
  const eligible = scored.filter((candidate) => !candidate.declined);
  // Declined topics are lowest priority: they surface only when nothing else
  // is supported AND the evidence moved substantially since the denial.
  const resurfacing = scored.filter((candidate) => candidate.declined && candidate.changed);

  let chosen = eligible[0] || null;
  let gentle = false;
  if (!chosen && resurfacing.length) {
    chosen = resurfacing[0];
    gentle = true;
  }
  if (!chosen) {
    // Everything supported this match is a lesson the player declined, and
    // none of it changed. Give a general review instead of nagging.
    const observation = "I watched closely, but the clearest patterns this match are lessons you asked me to set aside, and none of them changed. I will keep looking for something new — say \"review priorities\" if you want to revisit one.";
    coaching.pending = null;
    coaching.proposal = null;
    addHistory(profile, "buddy", observation);
    return { intent: null, observation };
  }

  const recent = recentProposalIntents(profile, weapon);
  const repeated = eligible.length > 1 && chosen.intent === recent[recent.length - 1];
  const lead = gentle
    ? `I know you asked me to set this aside, but my read has changed since then: ${chosen.line}`
    : chosen.line;
  const repeatNote = repeated
    ? " I know I brought this up last time, but the evidence for it was even stronger this match."
    : "";
  // Mention up to two other well-supported, non-declined factors so the
  // review reflects the whole match rather than a single habit.
  const alsoNotable = eligible
    .filter((candidate) => candidate !== chosen && candidate.score >= .45)
    .slice(0, 2);
  const alsoText = alsoNotable.length
    ? ` I also noticed ${alsoNotable.map((candidate) => candidate.note).join(" and ")}.`
    : "";

  const observation = `${lead}${repeatNote}${alsoText} Should I?`;
  coaching.pending = null;
  coaching.proposal = {
    intent: chosen.intent,
    weapon,
    domain: chosen.domain || null,
    estimate: chosen.estimate ?? null,
    observation,
    createdAt: Date.now()
  };
  rememberProposal(profile, weapon, chosen.intent);
  addHistory(profile, "buddy", observation, { proposal: chosen.intent });
  return { intent: chosen.intent, observation, label: DIRECTIVES[chosen.intent].label };
}
