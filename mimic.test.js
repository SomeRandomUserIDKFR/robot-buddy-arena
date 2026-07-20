import assert from "node:assert/strict";
import {
  MIMIC_TEAM_SAFETY, mimicPreferredRange, shieldStyleBias, updateAI
} from "./ai.js";
import { Fighter } from "./combat.js";
import { AI_PRESETS, DEFAULT_PROFILE, MIMIC_BLEND, SIGHT, SIZE } from "./config.js";
import { applyLoadout, DEFAULT_LOADOUT } from "./equipment.js";
import {
  ensureLearningProfile, evidenceReliability, mimicBlendFactor, mimicIntensityAllowed,
  mimicUnlockLevel, MIMIC_LOCKED_LINE, readiness, recordEvidence
} from "./learning.js";
import { migrateProfile } from "./storage.js";

const clone = (value) => structuredClone(value);

function ready(record, estimate = .8) {
  record.successes = 12;
  record.failures = 0;
  record.samples = 12;
  record.estimate = estimate;
  record.settled = true;
}

function partialReady(profile) {
  const learned = ensureLearningProfile(profile.weapons.gun);
  // One ready domain + one testing → overall "Am I ready?"
  ready(learned.habits.engagementRange, .7);
  for (let i = 0; i < 4; i++) recordEvidence(learned.habits.rushPrediction, true, .4);
  return learned;
}

function fullyReady(profile) {
  const learned = ensureLearningProfile(profile.weapons.gun);
  for (const domain of Object.keys(learned.habits)) {
    ready(learned.habits[domain], domain === "engagementRange" ? .75 : .55);
  }
  return learned;
}

// --- Unlock gates ---
{
  const locked = clone(DEFAULT_PROFILE);
  assert.equal(readiness(locked.weapons.gun), "I'm not ready yet.");
  assert.equal(mimicUnlockLevel(locked.weapons.gun), "locked");
  assert.equal(mimicIntensityAllowed("slight", locked.weapons.gun), false);
  assert.equal(mimicBlendFactor("full", locked.weapons.gun), 0);
}

{
  const partial = clone(DEFAULT_PROFILE);
  const learned = partialReady(partial);
  assert.equal(readiness(learned), "Am I ready?");
  assert.equal(mimicUnlockLevel(learned), "partial");
  assert.equal(mimicIntensityAllowed("slight", learned), true);
  assert.equal(mimicIntensityAllowed("quite", learned), true);
  assert.equal(mimicIntensityAllowed("full", learned), false);
  assert.equal(mimicBlendFactor("slight", learned), MIMIC_BLEND.slight);
  assert.equal(mimicBlendFactor("quite", learned), MIMIC_BLEND.quite);
  // Full requested while only partial → clamp to Quite blend.
  assert.equal(mimicBlendFactor("full", learned), MIMIC_BLEND.quite);
}

{
  const full = clone(DEFAULT_PROFILE);
  const learned = fullyReady(full);
  assert.equal(readiness(learned), "I'm ready.");
  assert.equal(mimicUnlockLevel(learned), "full");
  assert.equal(mimicIntensityAllowed("full", learned), true);
  assert.equal(mimicBlendFactor("full", learned), MIMIC_BLEND.full);
  assert.equal(MIMIC_LOCKED_LINE.includes("style"), true);
}

console.log("Mimic unlock suite passed.");

// --- Intensity moves preferred range toward player estimate ---
{
  const profile = clone(DEFAULT_PROFILE);
  const learned = fullyReady(profile);
  // Close-range player habit (~0.25 * SIGHT ≈ 205).
  ready(learned.habits.engagementRange, .25);
  ready(learned.habits.rushPrediction, .05);
  const fighter = new Fighter({ weapon: "gun", buddy: true, ai: "mimic" });
  const base = 400;
  const slight = mimicPreferredRange(
    fighter, learned, mimicBlendFactor("slight", learned), base
  );
  const full = mimicPreferredRange(
    fighter, learned, mimicBlendFactor("full", learned), base
  );
  const playerRange = .25 * SIGHT;
  assert.ok(slight < base, "Slight should pull range toward player");
  assert.ok(full < slight, "Full should pull closer to player than Slight");
  assert.ok(
    Math.abs(full - playerRange) < Math.abs(slight - playerRange),
    "Full preferred range is nearer the player estimate"
  );
}

{
  // Flash / Balanced / Thinker motors unchanged; Mimic matches Balanced.
  assert.deepEqual(
    { ...AI_PRESETS.mimic },
    { ...AI_PRESETS.balanced },
    "Mimic reuses Balanced motor constraints"
  );
  assert.notEqual(AI_PRESETS.flash.reaction, AI_PRESETS.thinker.reaction);
}

console.log("Mimic blend suite passed.");

// --- updateAI stores mimicDesired; non-mimic minds leave it null ---
{
  const profile = clone(DEFAULT_PROFILE);
  fullyReady(profile);
  ready(profile.weapons.gun.habits.engagementRange, .2);
  profile.mimicIntensity = "full";
  const player = new Fighter({
    x: 1000, y: 1420 - SIZE, human: true, team: 0, weapon: "gun", grounded: true
  });
  const buddy = new Fighter({
    x: 1200, y: 1420 - SIZE, team: 0, weapon: "gun", buddy: true,
    ai: "mimic", grounded: true
  });
  const enemy = new Fighter({
    x: 1600, y: 1420 - SIZE, team: 1, weapon: "gun", grounded: true
  });
  buddy.aiState.timer = 0;
  const game = {
    mode: "conquest", elapsed: 0, lastShotAtPlayer: -99,
    fighters: [player, buddy, enemy], pings: [], thoughts: []
  };
  updateAI(buddy, 1 / 60, game, profile);
  assert.ok(buddy.aiState.mimicBlend > .8);
  assert.ok(buddy.aiState.mimicDesired != null);
  assert.ok(buddy.aiState.mimicDesired < 400);

  buddy.ai = "balanced";
  buddy.aiState.timer = 0;
  updateAI(buddy, 1 / 60, game, profile);
  assert.equal(buddy.aiState.mimicDesired, null);
  assert.equal(buddy.aiState.mimicBlend, 0);
}

assert.ok(MIMIC_TEAM_SAFETY > .2 && MIMIC_TEAM_SAFETY < .4);

// Mimic intensity scales shield style bias (Slight < Full).
{
  const profile = clone(DEFAULT_PROFILE);
  const learned = fullyReady(profile);
  ready(learned.habits.shieldUse, .9);
  const rel = evidenceReliability(learned.habits.shieldUse);
  const slight = shieldStyleBias(.9, rel, mimicBlendFactor("slight", learned));
  const full = shieldStyleBias(.9, rel, mimicBlendFactor("full", learned));
  assert.ok(full > slight, "Full Mimic copies shield camping harder than Slight");

  profile.mimicIntensity = "full";
  const player = new Fighter({
    x: 400, y: 700, human: true, team: 0, weapon: "gun", grounded: true
  });
  const buddy = applyLoadout(new Fighter({
    x: 800, y: 700, team: 0, weapon: "gun", buddy: true, ai: "mimic",
    hp: 500, maxHp: 500, grounded: true, aim: 0
  }), { ...DEFAULT_LOADOUT, shield: "kinetic-targe" });
  const enemy = new Fighter({
    x: 900, y: 700, team: 1, weapon: "saber", grounded: true, vx: -100
  });
  buddy.aiState.timer = 0;
  const game = {
    mode: "conquest", elapsed: 0, lastShotAtPlayer: -99,
    fighters: [player, buddy, enemy], pings: [], thoughts: [], bullets: []
  };
  updateAI(buddy, .05, game, profile);
  assert.ok(buddy.aiState.shieldStyleBias > .4, "Full Mimic applies camp shield bias");

  profile.mimicIntensity = "slight";
  buddy.shieldRaised = false;
  buddy.aiState.shieldHoldUntil = 0;
  buddy.aiState.shieldCooldownUntil = 0;
  buddy.aiState.timer = 0;
  game.elapsed = 2;
  updateAI(buddy, .05, game, profile);
  assert.ok(
    buddy.aiState.shieldStyleBias > 0
    && buddy.aiState.shieldStyleBias < .45,
    "Slight Mimic applies a lighter shield bias"
  );
}

console.log("Mimic AI suite passed.");

// --- Persistence migration ---
{
  const migrated = migrateProfile({
    botName: "Ada",
    aiMode: "mimic",
    mimicIntensity: "full",
    weapons: DEFAULT_PROFILE.weapons
  });
  // Unready profile cannot keep Mimic / Full.
  assert.equal(migrated.aiMode, "balanced");
  assert.equal(migrated.mimicIntensity, "quite");
}

{
  const saved = clone(DEFAULT_PROFILE);
  fullyReady(saved);
  saved.aiMode = "mimic";
  saved.mimicIntensity = "full";
  const migrated = migrateProfile(saved);
  assert.equal(migrated.aiMode, "mimic");
  assert.equal(migrated.mimicIntensity, "full");
}

{
  const partial = clone(DEFAULT_PROFILE);
  partialReady(partial);
  partial.aiMode = "mimic";
  partial.mimicIntensity = "full";
  const migrated = migrateProfile(partial);
  assert.equal(migrated.aiMode, "mimic");
  assert.equal(migrated.mimicIntensity, "quite");
}

console.log("Mimic persistence suite passed.");
