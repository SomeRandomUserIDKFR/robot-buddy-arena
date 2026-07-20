import assert from "node:assert/strict";
import { DEFAULT_PROFILE, SIGHT } from "./config.js";
import {
  coachingReply, confirmDirective, declineTopic, topicPreference
} from "./coaching.js";
import {
  advanceDirectiveTraining, createTrainingProposal, emptyEvidence, ensureLearningProfile,
  evidenceReliability, evidenceState, DODGE_JUDGE_MIN_DODGES, DODGE_READY_ENTER_RELIABILITY,
  DODGE_READY_ENTER_SAMPLES, isLearningLocked, PRECISION_AIM_MAX_REDUCTION, precisionAimErrorScale,
  READY_ENTER_RELIABILITY, READY_ENTER_SAMPLES, READY_EXIT_RELIABILITY,
  readiness, recordEvidence, shieldCampObservation, topReadinessDetails, trackTraining,
  updateLearning
} from "./learning.js";

const clone = (value) => structuredClone(value);

function gameWith(overrides = {}, fighterOverrides = {}) {
  const player = { weapon: "gun", human: true, hp: 500, ...fighterOverrides.player };
  const buddy = {
    buddy: true, fuel: 1, weapon: "gun", weaponId: "pulse-rifle",
    ...fighterOverrides.buddy
  };
  return {
    mode: "training",
    elapsed: 60,
    startedAt: 10,
    pings: [],
    fighters: [player, buddy],
    stats: {
      attacks: 0, attackRangeSum: 0, rangeSum: 0, samples: 0, closing: 0,
      rushOpportunities: 0, rushCounterSuccesses: 0,
      dodges: 0, reactive: 0, jetOpportunities: 0, jetAggro: 0, playerJetTime: 0,
      lowHpOpportunities: 0, lowHpAttack: 0, buddyAttacks: 0, buddyHits: 0,
      buddyDodgeAttempts: 0, buddyDodgeSuccesses: 0, fuelOpportunities: 0,
      fuelSuccesses: 0, buddyRetreat: 0, buddyDamageTaken: 0, buddyClose: 0,
      buddyFar: 0, buddyJet: 0, buddyMoving: 0, pingTargetHits: 0,
      shieldOpportunities: 0, shieldRaisesOnOpp: 0, shieldRaiseCount: 0,
      shieldPressureTime: 0, shieldRaisedUnderPressure: 0, shieldRaisedTime: 0,
      shieldHoldSum: 0, shieldHolds: 0, shieldBlocks: 0, shieldDamageAbsorbed: 0,
      shieldBroke: 0, shieldRaiseOnApproach: 0, shieldRaiseAfterShot: 0,
      shieldRaiseLowHp: 0, shieldMaxDurability: 0,
      ...overrides
    }
  };
}

// Matches themselves are not evidence.
const idleProfile = clone(DEFAULT_PROFILE);
const beforeIdle = JSON.stringify(idleProfile.weapons.gun);
for (let index = 0; index < 10; index++) updateLearning(gameWith(), idleProfile);
assert.equal(JSON.stringify(idleProfile.weapons.gun), beforeIdle);

// Evidence is isolated by domain.
const isolated = clone(DEFAULT_PROFILE);
updateLearning(gameWith({ buddyAttacks: 10, buddyHits: 8 }), isolated);
assert.equal(isolated.weapons.gun.capabilities.aim.samples, 1);
assert.equal(isolated.weapons.gun.habits.rushPrediction.samples, 0);
assert.equal(isolated.weapons.gun.capabilities.fuelManagement.samples, 0);

// Failures block readiness and reduce a previously reliable belief.
// Leaving ready requires a clear reliability drop (hysteresis), not one miss.
const stale = emptyEvidence();
for (let index = 0; index < 10; index++) recordEvidence(stale, true, .8);
assert.equal(evidenceState(stale, "rushPrediction"), "ready");
assert.equal(stale.settled, true);
recordEvidence(stale, false, .1);
assert.equal(evidenceState(stale, "rushPrediction"), "ready", "one miss must not drop settled ready");
for (let index = 0; index < 8; index++) recordEvidence(stale, false, .1);
assert.ok(evidenceReliability(stale) < READY_EXIT_RELIABILITY);
assert.notEqual(evidenceState(stale, "rushPrediction"), "ready");
assert.equal(stale.settled, false);

// One practiced area progresses independently.
const focused = clone(DEFAULT_PROFILE);
const learned = ensureLearningProfile(focused.weapons.gun);
assert.equal(evidenceState(learned.habits.rushPrediction, "rushPrediction"), "not-ready");
for (let index = 0; index < 3; index++) recordEvidence(learned.habits.rushPrediction, true, .8);
assert.equal(evidenceState(learned.habits.rushPrediction, "rushPrediction"), "testing");
for (let index = 0; index < 7; index++) recordEvidence(learned.habits.rushPrediction, true, .8);
assert.equal(evidenceState(learned.habits.rushPrediction, "rushPrediction"), "ready");
assert.equal(evidenceState(learned.habits.jetpackUse, "jetpackUse"), "not-ready");
assert.equal(learned.capabilities.aim.samples, 0);
assert.equal(readiness(learned), "Am I ready?");

function fillReady(record, estimate = .8) {
  record.successes = 12;
  record.failures = 0;
  record.samples = 12;
  record.estimate = estimate;
  record.settled = true;
}

// ≥2 sampled habits, every sampled domain ready → I'm ready.
// Unsampled domains (dodgeTiming / lowHpBehavior) do not block.
{
  const threeReady = clone(DEFAULT_PROFILE);
  const learned = ensureLearningProfile(threeReady.weapons.gun);
  fillReady(learned.habits.engagementRange, .7);
  fillReady(learned.habits.jetpackUse, .6);
  fillReady(learned.habits.rushPrediction, .5);
  assert.equal(readiness(learned), "I'm ready.");
  assert.equal(learned.habits.dodgeTiming.samples, 0);
  assert.equal(learned.habits.lowHpBehavior.samples, 0);
  assert.equal(learned.habits.shieldUse.samples, 0);
}

// Two ready + one testing sampled domain → Am I ready?
// Post-match list must include the testing line (not hide it behind a top-3 cut).
{
  const mixed = clone(DEFAULT_PROFILE);
  const learned = ensureLearningProfile(mixed.weapons.gun);
  fillReady(learned.habits.engagementRange, .7);
  fillReady(learned.habits.jetpackUse, .6);
  for (let index = 0; index < 4; index++) {
    recordEvidence(learned.habits.dodgeTiming, true, .5);
  }
  assert.equal(evidenceState(learned.habits.dodgeTiming, "dodgeTiming"), "testing");
  assert.equal(readiness(learned), "Am I ready?");
  const lines = topReadinessDetails(learned);
  assert.equal(lines.length, 3);
  assert.ok(lines.some((line) => line.includes("Still testing") && line.includes("dodge")));
  assert.ok(lines.some((line) => line.includes("Ready to anticipate") && line.includes("engagement")));
  assert.ok(!lines.some((line) => line.includes("low-HP")), "unsampled domains stay off the list");
}

// Failed counter attempts prevent overall readiness.
const failed = clone(DEFAULT_PROFILE);
for (let index = 0; index < 10; index++) {
  updateLearning(gameWith({ rushOpportunities: 1, rushCounterSuccesses: 0 }), failed);
}
assert.equal(evidenceState(failed.weapons.gun.habits.rushPrediction, "rushPrediction"), "not-ready");
assert.equal(readiness(failed.weapons.gun), "I'm not ready yet.");

// Coaching advances only on relevant, successful judged outcomes.
const coached = clone(DEFAULT_PROFILE);
const directive = confirmDirective(coached, "dodgeMore", "gun");
directive.confirmedAt = 1;
for (let index = 0; index < 10; index++) {
  advanceDirectiveTraining(gameWith({ attacks: 5 }), coached);
}
assert.equal(directive.successes + directive.failures, 0);
for (let index = 0; index < 10; index++) {
  advanceDirectiveTraining(
    gameWith({ buddyDodgeAttempts: 1, buddyDodgeSuccesses: 1 }),
    coached
  );
}
assert.equal(directive.status, "practiced");

// A long-range playstyle must never be described as close-range/rushing.
const longRangeStats = {
  attacks: 14, attackRangeSum: 14 * 620,
  samples: 45, rangeSum: 45 * 600,
  rushOpportunities: 0
};
const longRangeProfile = clone(DEFAULT_PROFILE);
const longProposal = createTrainingProposal(gameWith(longRangeStats), longRangeProfile);
assert.ok(longProposal);
assert.equal(longProposal.intent, "keepDistance");
assert.doesNotMatch(longProposal.observation, /close[- ]?range|rush/i);
updateLearning(gameWith(longRangeStats), longRangeProfile);
assert.ok(
  longRangeProfile.weapons.gun.habits.engagementRange.estimate > SIGHT * .6 / SIGHT,
  "long-range play should learn a high engagement-range estimate"
);

// Sparse data: the buddy admits uncertainty instead of claiming a habit.
const sparseProfile = clone(DEFAULT_PROFILE);
const sparseProposal = createTrainingProposal(
  gameWith({ attacks: 1, attackRangeSum: 150, samples: 3, rangeSum: 3 * 200 }),
  sparseProfile
);
assert.ok(sparseProposal);
assert.equal(sparseProposal.intent, null);
assert.match(sparseProposal.observation, /not seen a clear pattern/i);
assert.doesNotMatch(sparseProposal.observation, /close[- ]?range|rush/i);
assert.equal(sparseProfile.coaching.proposal, null);
updateLearning(gameWith({ attacks: 1, attackRangeSum: 150, samples: 3, rangeSum: 600 }), sparseProfile);
assert.equal(sparseProfile.weapons.gun.habits.engagementRange.samples, 0);

// Genuine sustained rushing is still recognized, but the buddy rotates to the
// next-most-distinctive habit instead of repeating itself every match.
const rushyProfile = clone(DEFAULT_PROFILE);
const rushyStats = () => ({
  attacks: 10, attackRangeSum: 10 * 120,
  samples: 40, rangeSum: 40 * 170,
  rushOpportunities: 5, dodges: 6, reactive: 4
});
const firstProposal = createTrainingProposal(gameWith(rushyStats()), rushyProfile);
assert.equal(firstProposal.intent, "stayClose");
assert.match(firstProposal.observation, /close-range/);
const secondProposal = createTrainingProposal(gameWith(rushyStats()), rushyProfile);
assert.notEqual(secondProposal.intent, firstProposal.intent);

// Walking across the arena toward the buddy is not a rush opportunity, and
// distance is only sampled once the buddy is actually in sight.
function simulateApproach(playerX, playerVx, buddyX, seconds) {
  const sim = gameWith();
  sim.elapsed = 0;
  const player = {
    x: playerX, y: 0, vx: playerVx, weapon: "gun", human: true,
    hp: 500, dead: false, thrusting: false
  };
  const buddy = { x: buddyX, y: 0, vx: 0, buddy: true, dead: false, thrusting: false };
  sim.fighters = [player, buddy];
  const dt = 1 / 60;
  for (let t = 0; t < seconds; t += dt) {
    sim.elapsed = t;
    trackTraining(sim, dt);
    player.x += player.vx * dt;
  }
  return sim;
}
const farApproach = simulateApproach(300, 200, 1400, 3);
assert.equal(farApproach.stats.rushOpportunities, 0);
assert.ok(farApproach.stats.samples < 2, "spawn approach beyond sight should not be sampled");
const committedRush = simulateApproach(600, 250, 900, 1);
assert.ok(committedRush.stats.rushOpportunities >= 1, "sustained closing into close range counts");

// Height (jetpack) must not dominate consecutive reviews when another domain
// has comparable evidence: the buddy alternates topics instead of fixating.
const jetDodgeStats = () => ({
  jetOpportunities: 8, playerJetTime: 6, jetAggro: 4, jetEscape: 1,
  dodges: 6, reactive: 4, samples: 12, rangeSum: 12 * 350
});
const rotationProfile = clone(DEFAULT_PROFILE);
const rotationFirst = createTrainingProposal(gameWith(jetDodgeStats()), rotationProfile);
assert.equal(rotationFirst.intent, "useJetpack");
const rotationSecond = createTrainingProposal(gameWith(jetDodgeStats()), rotationProfile);
assert.equal(rotationSecond.intent, "dodgeMore",
  "an equally supported domain must take over after a height review");
const intents = [rotationFirst.intent, rotationSecond.intent];
for (let index = 0; index < 4; index++) {
  intents.push(createTrainingProposal(gameWith(jetDodgeStats()), rotationProfile).intent);
}
assert.ok(
  intents.filter((intent) => intent === "useJetpack").length <= Math.ceil(intents.length / 2),
  `height must not dominate the review rotation: ${intents.join(", ")}`
);

// Denying the height lesson persists a structured preference, makes it lowest
// priority afterwards, and selects another supported factor instead.
const denialProfile = clone(DEFAULT_PROFILE);
recordEvidence(denialProfile.weapons.gun.habits.jetpackUse, true, .7);
const evidenceBefore = JSON.stringify(denialProfile.weapons.gun.habits.jetpackUse);
const heightProposal = createTrainingProposal(gameWith(jetDodgeStats()), denialProfile);
assert.equal(heightProposal.intent, "useJetpack");
const denialResponse = coachingReply(denialProfile, "no, don't learn that", "gun");
assert.match(denialResponse.reply, /won't prioritize that lesson in future reviews/i);
const pref = topicPreference(denialProfile, "gun", "useJetpack");
assert.ok(pref?.declined, "denial must persist a structured topic preference");
assert.equal(pref.declines, 1);
assert.ok(pref.lastDeclinedAt > 0);
// Rejection never erases evidence or readiness records.
assert.equal(JSON.stringify(denialProfile.weapons.gun.habits.jetpackUse), evidenceBefore);
for (let index = 0; index < 3; index++) {
  const next = createTrainingProposal(gameWith(jetDodgeStats()), denialProfile);
  assert.equal(next.intent, "dodgeMore",
    "a declined topic must stay lowest priority while alternatives exist");
}

// If the only supported topic was declined and its evidence has not changed,
// the buddy gives an honest general review instead of re-proposing it.
const jetOnlyStats = () => ({
  jetOpportunities: 8, playerJetTime: 6, jetAggro: 4, jetEscape: 1
});
const stuckProfile = clone(DEFAULT_PROFILE);
declineTopic(stuckProfile, "gun", "useJetpack", .5);
const stuckReview = createTrainingProposal(gameWith(jetOnlyStats()), stuckProfile);
assert.equal(stuckReview.intent, null);
assert.match(stuckReview.observation, /asked me to set aside/i);
assert.equal(stuckProfile.coaching.proposal, null);

// A substantial evidence change can resurface a declined topic, framed gently
// as a changed observation; repeated denials raise that bar.
const changedProfile = clone(DEFAULT_PROFILE);
declineTopic(changedProfile, "gun", "useJetpack", .1);
changedProfile.weapons.gun.habits.jetpackUse.estimate = .6;
changedProfile.weapons.gun.habits.jetpackUse.samples = 4;
const changedReview = createTrainingProposal(gameWith(jetOnlyStats()), changedProfile);
assert.equal(changedReview.intent, "useJetpack");
assert.match(changedReview.observation, /asked me to set this aside.*changed/i);
const twiceDeclined = clone(DEFAULT_PROFILE);
declineTopic(twiceDeclined, "gun", "useJetpack", .3);
declineTopic(twiceDeclined, "gun", "useJetpack", .3);
assert.equal(topicPreference(twiceDeclined, "gun", "useJetpack").declines, 2);
twiceDeclined.weapons.gun.habits.jetpackUse.estimate = .6;
twiceDeclined.weapons.gun.habits.jetpackUse.samples = 4;
const suppressedReview = createTrainingProposal(gameWith(jetOnlyStats()), twiceDeclined);
assert.equal(suppressedReview.intent, null,
  "repeated denials must require a larger evidence change to resurface");

// Explicit later approval (typed directive + yes) clears the suppression.
const revivedProfile = clone(DEFAULT_PROFILE);
declineTopic(revivedProfile, "gun", "useJetpack", .5);
coachingReply(revivedProfile, "use the jetpack to get above them", "gun");
coachingReply(revivedProfile, "yes", "gun");
assert.equal(topicPreference(revivedProfile, "gun", "useJetpack"), null,
  "typed approval must restore normal priority");
const revivedReview = createTrainingProposal(gameWith(jetOnlyStats()), revivedProfile);
assert.equal(revivedReview.intent, "useJetpack");

// The typed "revisit" command also clears the suppression.
const revisitProfile = clone(DEFAULT_PROFILE);
declineTopic(revisitProfile, "gun", "useJetpack", .5);
const revisitResponse = coachingReply(revisitProfile, "revisit the height lesson", "gun");
assert.match(revisitResponse.reply, /back to normal priority/i);
assert.equal(topicPreference(revisitProfile, "gun", "useJetpack"), null);

// Combat coaching like "don't rush" is a directive, never a lesson denial: it
// must not suppress any topic or discard the open proposal.
const combatProfile = clone(DEFAULT_PROFILE);
createTrainingProposal(gameWith(jetDodgeStats()), combatProfile);
assert.ok(combatProfile.coaching.proposal);
coachingReply(combatProfile, "dont rush", "gun");
assert.equal(topicPreference(combatProfile, "gun", "rush"), null);
assert.equal(topicPreference(combatProfile, "gun", "safer"), null);
assert.equal(topicPreference(combatProfile, "gun", "useJetpack"), null);
assert.ok(combatProfile.coaching.proposal, "coaching chat must not consume the proposal");

// Legacy duration/counter fields are preserved only as raw context, never competence.
globalThis.localStorage = { getItem: () => null, setItem: () => {} };
const { migrateProfile } = await import("./storage.js");
const migrated = migrateProfile({
  matches: 99,
  weapons: {
    gun: { seconds: 9999, counter: 1, range: 700, rush: .9 },
    saber: { seconds: 500, counter: .8 }
  },
  coaching: { history: [{ role: "player", text: "hello" }], directives: [] }
});
assert.equal(readiness(migrated.weapons.gun), "I'm not ready yet.");
assert.equal(migrated.weapons.gun.habits.rushPrediction.samples, 0);
assert.equal(migrated.weapons.gun.legacyHabits.range, 700);
assert.equal(migrated.coaching.history.length, 1);
assert.equal(migrated.learningLocked, false);
assert.deepEqual(migrated.coaching.topicPrefs, {});
assert.deepEqual(migrated.coaching.recentProposals, {});

const lockedMigrated = migrateProfile({ learningLocked: true, matches: 1 });
assert.equal(lockedMigrated.learningLocked, true);
assert.equal(isLearningLocked(lockedMigrated), true);

// Saved topic preferences survive migration; junk is dropped and caps hold.
const prefMigrated = migrateProfile({
  coaching: {
    directives: [],
    history: [],
    topicPrefs: {
      gun: {
        useJetpack: { declined: true, declines: 500, lastDeclinedAt: 5, estimateAtDecline: 7 },
        bogusIntent: { declined: true, declines: 1 }
      }
    },
    recentProposals: { gun: ["useJetpack", "bogusIntent", "dodgeMore"] }
  }
});
const migratedPref = prefMigrated.coaching.topicPrefs.gun.useJetpack;
assert.ok(migratedPref.declined);
assert.ok(migratedPref.declines <= 9, "decline count must be capped");
assert.equal(migratedPref.estimateAtDecline, 1, "estimates clamp into 0..1");
assert.equal(prefMigrated.coaching.topicPrefs.gun.bogusIntent, undefined);
assert.deepEqual(prefMigrated.coaching.recentProposals.gun, ["useJetpack", "dodgeMore"]);

// Precision-aim gimmick: pulse/carbine practice never earns the domain;
// marksman/sniper Training does, and the error cut stays tiny.
{
  const pulseOnly = clone(DEFAULT_PROFILE);
  const changedPulse = updateLearning(
    gameWith({ buddyAttacks: 10, buddyHits: 8 }),
    pulseOnly
  );
  assert.equal(pulseOnly.weapons.gun.capabilities.aim.samples, 1);
  assert.equal(pulseOnly.weapons.gun.capabilities.precisionAim.samples, 0);
  assert.ok(!changedPulse.includes("precisionAim"));
  assert.equal(precisionAimErrorScale(pulseOnly.weapons.gun, "pulse-rifle"), 1);
  assert.equal(precisionAimErrorScale(pulseOnly.weapons.gun, "marksman-rifle"), 1);

  const carbine = clone(DEFAULT_PROFILE);
  updateLearning(
    gameWith(
      { buddyAttacks: 10, buddyHits: 9 },
      { buddy: { weaponId: "burst-carbine" } }
    ),
    carbine
  );
  assert.equal(carbine.weapons.gun.capabilities.precisionAim.samples, 0);

  const marksman = clone(DEFAULT_PROFILE);
  const changedMarksman = updateLearning(
    gameWith(
      { buddyAttacks: 10, buddyHits: 8 },
      { buddy: { weaponId: "marksman-rifle" } }
    ),
    marksman
  );
  assert.ok(changedMarksman.includes("precisionAim"));
  assert.equal(marksman.weapons.gun.capabilities.precisionAim.samples, 1);
  assert.equal(marksman.weapons.gun.capabilities.aim.samples, 1);

  const sniper = ensureLearningProfile(clone(DEFAULT_PROFILE).weapons.gun);
  for (let index = 0; index < 20; index++) {
    recordEvidence(sniper.capabilities.precisionAim, true);
  }
  const scale = precisionAimErrorScale(sniper, "classic-sniper");
  assert.ok(scale < 1, "sniper evidence must trim aim error a little");
  assert.ok(
    scale >= 1 - PRECISION_AIM_MAX_REDUCTION - 1e-9,
    "reduction must never exceed the small cap"
  );
  assert.ok(
    1 - scale <= PRECISION_AIM_MAX_REDUCTION,
    `max cut is ${PRECISION_AIM_MAX_REDUCTION * 100}%`
  );
  assert.ok(1 - scale >= .03, "full evidence should land in the 3–8% band");
  assert.equal(precisionAimErrorScale(sniper, "pulse-rifle"), 1, "bonus only while holding marksman/sniper");
  assert.equal(precisionAimErrorScale(sniper, "burst-carbine"), 1);
  const reliability = evidenceReliability(sniper.capabilities.precisionAim);
  assert.ok(
    Math.abs(scale - (1 - reliability * PRECISION_AIM_MAX_REDUCTION)) < 1e-12
  );
}

// Documented dodge bar: consistent reactive dodging reaches ready with a
// moderate set (≥ DODGE_READY_ENTER_SAMPLES, reliability ≥ DODGE_READY_ENTER_RELIABILITY),
// without needing the stricter default rush/range bar.
{
  assert.ok(DODGE_READY_ENTER_SAMPLES < READY_ENTER_SAMPLES);
  assert.ok(DODGE_READY_ENTER_RELIABILITY < READY_ENTER_RELIABILITY);
  const dodgeProfile = clone(DEFAULT_PROFILE);
  const consistent = { dodges: 5, reactive: 3 }; // reactive ratio 0.6
  for (let index = 0; index < 7; index++) {
    updateLearning(gameWith(consistent), dodgeProfile);
  }
  const dodge = dodgeProfile.weapons.gun.habits.dodgeTiming;
  assert.ok(dodge.samples >= DODGE_READY_ENTER_SAMPLES);
  assert.ok(evidenceReliability(dodge) >= DODGE_READY_ENTER_RELIABILITY);
  assert.equal(evidenceState(dodge, "dodgeTiming"), "ready");
  assert.equal(dodge.settled, true);
  // Same sample count must still be only "testing" under the default habit bar.
  const asRush = { ...dodge, settled: false };
  assert.equal(evidenceState(asRush, "rushPrediction"), "testing");
}

// Sparse / accidental dodges must not pollute dodgeTiming.
{
  const sparseDodge = clone(DEFAULT_PROFILE);
  updateLearning(gameWith({ dodges: 1, reactive: 1 }), sparseDodge);
  updateLearning(gameWith({ dodges: DODGE_JUDGE_MIN_DODGES - 1, reactive: 1 }), sparseDodge);
  assert.equal(sparseDodge.weapons.gun.habits.dodgeTiming.samples, 0);
  assert.equal(sparseDodge.weapons.gun.habits.dodgeTiming.estimate, null);
}

// Borderline rush reliability must not flip testing↔ready every match.
{
  const rush = emptyEvidence();
  // Just-enter ready under the default bar (~9 perfect samples → ~0.584).
  for (let index = 0; index < 9; index++) recordEvidence(rush, true, .5);
  assert.ok(evidenceReliability(rush) >= READY_ENTER_RELIABILITY);
  assert.equal(evidenceState(rush, "rushPrediction"), "ready");
  // One counter-fail drops reliability below enter but above exit → stay ready.
  recordEvidence(rush, false, .1);
  assert.ok(evidenceReliability(rush) < READY_ENTER_RELIABILITY);
  assert.ok(evidenceReliability(rush) >= READY_EXIT_RELIABILITY);
  assert.equal(evidenceState(rush, "rushPrediction"), "ready");
  recordEvidence(rush, true, .5);
  assert.equal(evidenceState(rush, "rushPrediction"), "ready");
  recordEvidence(rush, false, .1);
  assert.equal(evidenceState(rush, "rushPrediction"), "ready",
    "alternating miss/hit near the enter bar must not oscillate");
}

// Leaving ready requires a clear reliability drop below the exit bar.
{
  const latch = emptyEvidence();
  for (let index = 0; index < 10; index++) recordEvidence(latch, true, .7);
  assert.equal(evidenceState(latch, "engagementRange"), "ready");
  let drops = 0;
  while (evidenceState(latch, "engagementRange") === "ready" && drops < 20) {
    recordEvidence(latch, false, .2);
    drops++;
  }
  assert.ok(drops >= 3, "must take sustained contrary evidence to leave ready");
  assert.ok(evidenceReliability(latch) < READY_EXIT_RELIABILITY);
  assert.notEqual(evidenceState(latch, "engagementRange"), "ready");
}

// Learning Lock: Training still runs stats, but profile learning writes are gated.
{
  assert.equal(DEFAULT_PROFILE.learningLocked, false);
  const richStats = {
    attacks: 12, attackRangeSum: 12 * 200,
    samples: 40, rangeSum: 40 * 220,
    rushOpportunities: 4, rushCounterSuccesses: 3,
    dodges: DODGE_JUDGE_MIN_DODGES + 1, reactive: 3,
    jetOpportunities: 3, jetAggro: 2, playerJetTime: 3,
    lowHpOpportunities: 2, lowHpAttack: 1,
    buddyAttacks: 10, buddyHits: 8,
    buddyDodgeAttempts: 2, buddyDodgeSuccesses: 2,
    fuelOpportunities: 1, fuelSuccesses: 1
  };

  const locked = clone(DEFAULT_PROFILE);
  locked.learningLocked = true;
  const directive = confirmDirective(locked, "dodgeMore", "gun");
  directive.confirmedAt = 1;
  const beforeWeapons = JSON.stringify(locked.weapons);
  const beforeDirective = JSON.stringify({
    successes: directive.successes, failures: directive.failures,
    evidence: directive.evidence, status: directive.status
  });
  const beforeReady = readiness(locked.weapons.gun);

  assert.deepEqual(updateLearning(gameWith(richStats), locked), []);
  assert.deepEqual(advanceDirectiveTraining(gameWith({
    buddyDodgeAttempts: 2, buddyDodgeSuccesses: 2
  }), locked), []);
  const sparNote = createTrainingProposal(gameWith(richStats), locked);
  assert.ok(sparNote?.spar);
  assert.match(sparNote.observation, /spar only/i);
  assert.equal(locked.coaching.proposal, null);
  assert.equal(JSON.stringify(locked.weapons), beforeWeapons);
  assert.equal(JSON.stringify({
    successes: directive.successes, failures: directive.failures,
    evidence: directive.evidence, status: directive.status
  }), beforeDirective);
  assert.equal(readiness(locked.weapons.gun), beforeReady);
}

// Unlocked Training still learns habits, capabilities, and coaching practice.
{
  const open = clone(DEFAULT_PROFILE);
  assert.equal(isLearningLocked(open), false);
  const directive = confirmDirective(open, "dodgeMore", "gun");
  directive.confirmedAt = 1;
  updateLearning(gameWith({
    attacks: 12, attackRangeSum: 12 * 200,
    samples: 40, rangeSum: 40 * 220,
    rushOpportunities: 3, rushCounterSuccesses: 2,
    buddyAttacks: 8, buddyHits: 5
  }), open);
  assert.ok(open.weapons.gun.habits.engagementRange.samples > 0);
  assert.ok(open.weapons.gun.habits.rushPrediction.samples > 0);
  assert.ok(open.weapons.gun.capabilities.aim.samples > 0);
  advanceDirectiveTraining(gameWith({
    buddyDodgeAttempts: 1, buddyDodgeSuccesses: 1
  }), open);
  assert.equal(directive.successes + directive.failures, 1);
  const proposal = createTrainingProposal(gameWith({
    attacks: 14, attackRangeSum: 14 * 620,
    samples: 45, rangeSum: 45 * 600,
    rushOpportunities: 0
  }), open);
  assert.ok(proposal);
  assert.equal(proposal.spar, undefined);
  assert.equal(proposal.intent, "keepDistance");
}

// Hysteresis applies to other habit domains the same way (jetpack / low-HP / shield).
{
  for (const domain of ["jetpackUse", "lowHpBehavior", "shieldUse"]) {
    const record = emptyEvidence();
    for (let index = 0; index < 9; index++) recordEvidence(record, true, .55);
    assert.equal(evidenceState(record, domain), "ready");
    recordEvidence(record, false, .1);
    assert.equal(evidenceState(record, domain), "ready",
      `${domain} must keep ready across a single borderline miss`);
  }
}

// --- shieldUse habit: camp vs conserve, readiness ignore, learning lock ---
{
  const campObs = shieldCampObservation({
    shieldPressureTime: 10,
    shieldRaisedUnderPressure: 8,
    shieldHoldSum: 4.5,
    shieldHolds: 3,
    shieldDamageAbsorbed: 200,
    shieldMaxDurability: 320,
    shieldBroke: 1
  });
  const conserveObs = shieldCampObservation({
    shieldPressureTime: 10,
    shieldRaisedUnderPressure: 1.2,
    shieldHoldSum: .6,
    shieldHolds: 4,
    shieldDamageAbsorbed: 20,
    shieldMaxDurability: 320,
    shieldBroke: 0
  });
  assert.ok(campObs > .55, `camp observation should be high (got ${campObs})`);
  assert.ok(conserveObs < .4, `conserve observation should be low (got ${conserveObs})`);

  const campProfile = clone(DEFAULT_PROFILE);
  const campChanged = updateLearning(gameWith({
    shieldOpportunities: 5,
    shieldPressureTime: 10,
    shieldRaisedUnderPressure: 8,
    shieldHoldSum: 4.5,
    shieldHolds: 3,
    shieldDamageAbsorbed: 250,
    shieldMaxDurability: 320,
    shieldBroke: 1
  }, { player: { weapon: "gun", shieldMaxDurability: 320 } }), campProfile);
  assert.ok(campChanged.includes("shieldUse"));
  assert.ok(campProfile.weapons.gun.habits.shieldUse.samples > 0);
  assert.ok(campProfile.weapons.gun.habits.shieldUse.estimate > .55);

  const conserveProfile = clone(DEFAULT_PROFILE);
  updateLearning(gameWith({
    shieldOpportunities: 5,
    shieldPressureTime: 10,
    shieldRaisedUnderPressure: 1,
    shieldHoldSum: .5,
    shieldHolds: 5,
    shieldDamageAbsorbed: 15,
    shieldMaxDurability: 320,
    shieldBroke: 0
  }, { player: { weapon: "gun", shieldMaxDurability: 320 } }), conserveProfile);
  assert.ok(conserveProfile.weapons.gun.habits.shieldUse.estimate < .4);

  // No shield opportunities → no shieldUse samples (unsampled).
  const noShield = clone(DEFAULT_PROFILE);
  updateLearning(gameWith({ attacks: 8, attackRangeSum: 8 * 300, samples: 20, rangeSum: 20 * 400 }), noShield);
  assert.equal(noShield.weapons.gun.habits.shieldUse.samples, 0);

  // Unsampled shieldUse does not block I'm ready.
  const readySansShield = clone(DEFAULT_PROFILE);
  const learnedSans = ensureLearningProfile(readySansShield.weapons.gun);
  fillReady(learnedSans.habits.engagementRange, .7);
  fillReady(learnedSans.habits.jetpackUse, .6);
  assert.equal(learnedSans.habits.shieldUse.samples, 0);
  assert.equal(readiness(learnedSans), "I'm ready.");
  const details = topReadinessDetails(learnedSans);
  assert.ok(!details.some((line) => /shield/i.test(line)));

  // Sampled but not ready shieldUse does participate.
  for (let i = 0; i < 3; i++) recordEvidence(learnedSans.habits.shieldUse, true, .7);
  assert.equal(readiness(learnedSans), "Am I ready?");
  assert.ok(topReadinessDetails(learnedSans).some((line) => /shield/i.test(line)));

  // Learning lock skips shield writes.
  const lockedShield = clone(DEFAULT_PROFILE);
  lockedShield.learningLocked = true;
  const before = JSON.stringify(lockedShield.weapons.gun.habits.shieldUse);
  assert.deepEqual(updateLearning(gameWith({
    shieldOpportunities: 6,
    shieldPressureTime: 8,
    shieldRaisedUnderPressure: 6,
    shieldHoldSum: 3,
    shieldHolds: 2,
    shieldMaxDurability: 175
  }, { player: { weapon: "gun", shieldMaxDurability: 175 } }), lockedShield), []);
  assert.equal(JSON.stringify(lockedShield.weapons.gun.habits.shieldUse), before);
}

// trackTraining only samples shield when the player has a shield and raises under pressure.
{
  const game = gameWith({}, {
    player: {
      weapon: "gun", human: true, hp: 500, x: 400, y: 700, vx: 0,
      shieldMaxDurability: 175, shieldDurability: 175, shieldRaised: true, shieldBroken: false
    },
    buddy: { buddy: true, x: 700, y: 700, vx: -120, weapon: "gun" }
  });
  game.fighters[0].x = 400;
  game.fighters[1].x = 700;
  game.fighters[1].vx = -150;
  game.elapsed = 5;
  for (let i = 0; i < 20; i++) {
    game.elapsed += .2;
    trackTraining(game, .2);
  }
  assert.ok(game.stats.shieldPressureTime > 0);
  assert.ok(game.stats.shieldRaisedUnderPressure > 0);
  assert.ok(game.stats.shieldOpportunities >= 1);

  const bare = gameWith({}, {
    player: {
      weapon: "gun", human: true, hp: 500, x: 400, y: 700, vx: 0,
      shieldMaxDurability: 0, shieldRaised: false
    },
    buddy: { buddy: true, x: 700, y: 700, vx: -150, weapon: "gun" }
  });
  bare.elapsed = 5;
  for (let i = 0; i < 20; i++) {
    bare.elapsed += .2;
    trackTraining(bare, .2);
  }
  assert.equal(bare.stats.shieldOpportunities, 0);
  assert.equal(bare.stats.shieldPressureTime, 0);
}

console.log("Evidence learning suite passed.");
