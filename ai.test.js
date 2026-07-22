import assert from "node:assert/strict";
import {
  aimTurnRateFor, buddySkill, CRATE_ESCAPE_HOP_RADIUS, debrisNearFighter,
  DODGE_MIMIC_BASELINE, DODGE_PANIC_BASE, DODGE_PANIC_ROOKIE_FLOOR, DODGE_THREAT_HIGH,
  DODGE_THREAT_HIGH_ROOKIE, DODGE_THREAT_MED, dodgeCommitChance, enemyDodgeScale,
  ENEMY_GREEN, evaluateDodgeThreat, evaluateShieldThreat, hasIncomingHostileShot,
  isGreenEnemyAi, mindDodgeScale, pickEscapeCrateHop, pickNearestGrabbable,
  pickNearestVisibleCrate, ROOKIE_BUDDY, SHIELD_MAX_HOLD, shieldHoldDuration,
  shieldLowerCooldown, shieldRaiseAllowed, shieldStyleBias, stepAimSmoothing,
  tickAiShieldHold, updateAI, updateAiIllusionist, updateAiLightCondensation,
  updateAiMaterialConsumer, updateAiReconjurer, updateAiRetractableArmor, updateAiShield,
  updateAiThrowBreakable, updateAiTrapper, updateAiWeaponSlot, wantAiSecondarySlot,
  wantRetractableDeployed
} from "./ai.js";
import { Fighter } from "./combat.js";
import { AI_PRESETS, DEFAULT_PROFILE, SIZE, WORLD } from "./config.js";
import { spawnPropDebris } from "./debris.js";
import {
  applyLoadout, DEFAULT_LOADOUT, ILLUSIONIST_ID, isPrecisionAimWeapon,
  LIGHT_CONDENSATION_ID, MATERIAL_CONSUMER_ID, RECONJURER_BUILDER_ID,
  RETRACTABLE_MORPH_DURATION, selectWeaponSlot, tickRetractableArmor, trainerLoadout,
  TRAPPER_ID
} from "./equipment.js";
import { createLightCondensationProp } from "./light-condensation.js";
import { isIllusionFighter } from "./illusionist.js";
import {
  ensureLearningProfile, PRECISION_AIM_MAX_REDUCTION, precisionAimErrorScale, recordEvidence
} from "./learning.js";
import { createMapRuntime } from "./maps.js";
import { createPowerCrate } from "./powerups.js";
import { THROW_BREAKABLE_ID } from "./throw-breakable.js";
import { angleDiff, dist, lerp, thoughtReason } from "./utils.js";

const clone = (value) => structuredClone(value);

function ready(record) {
  record.successes = 12;
  record.failures = 0;
  record.samples = 12;
  record.estimate = .8;
  record.settled = true;
}

function scenario({ buddyX, enemyX, evidence = false, exhausted = false }) {
  const profile = clone(DEFAULT_PROFILE);
  if (evidence) {
    ready(profile.weapons.gun.habits.jetpackUse);
    ready(profile.weapons.gun.capabilities.fuelManagement);
  }
  const player = new Fighter({
    x: buddyX, y: 1420 - SIZE, human: true, team: 0, weapon: "gun", grounded: true
  });
  const buddy = new Fighter({
    x: buddyX, y: 1420 - SIZE, team: 0, weapon: "gun", buddy: true,
    ai: "balanced", hp: 40, fuel: .9, grounded: true,
    jetLocked: exhausted, jetReleased: !exhausted
  });
  const enemy = new Fighter({
    x: enemyX, y: 1420 - SIZE, team: 1, weapon: "saber", hp: 500, grounded: true
  });
  buddy.aiState.timer = 0;
  const game = {
    mode: "conquest", elapsed: 0, lastShotAtPlayer: -99,
    fighters: [player, buddy, enemy], pings: [], thoughts: []
  };
  return { buddy, enemy, game, profile };
}

function decide(sim, elapsed = 0, dt = 1) {
  sim.game.elapsed = elapsed;
  sim.buddy.aiState.timer = 0;
  return updateAI(sim.buddy, dt, sim.game, sim.profile);
}

// The wall is never treated as a valid "away" direction.
{
  const sim = scenario({
    buddyX: WORLD.w - SIZE - 35,
    enemyX: WORLD.w - SIZE - 155
  });
  const intent = decide(sim);
  assert.equal(intent.mx, -1, "right-edge retreat must turn inward");
  assert.equal(intent.jump, true, "blocked ground escape should jump past the threat");
  assert.match(sim.game.thoughts.join("\n"), /right edge blocked my escape/);
}

{
  const sim = scenario({ buddyX: 35, enemyX: 155 });
  const intent = decide(sim);
  assert.equal(intent.mx, 1, "left-edge retreat must turn inward");
  assert.equal(intent.jump, true, "mirrored blocked escape should jump inward");
  assert.match(sim.game.thoughts.join("\n"), /left edge blocked my escape/);
}

// A retreat direction persists across decision ticks instead of re-solving
// ordinary spacing and flipping left/right.
{
  const sim = scenario({
    buddyX: WORLD.w - SIZE - 35,
    enemyX: WORLD.w - SIZE - 155
  });
  const directions = [
    decide(sim, 0).mx,
    decide(sim, .5).mx,
    decide(sim, 1).mx,
    decide(sim, 1.5).mx
  ];
  assert.deepEqual(directions, [-1, -1, -1, -1]);
  assert.ok(sim.buddy.aiState.escape, "escape plan should remain active");
}

// Smart vertical escape requires both jet-use and fuel-management evidence.
{
  const sim = scenario({ buddyX: 1600, enemyX: 1400, evidence: true });
  const intent = decide(sim);
  assert.equal(intent.jet, true);
  assert.equal(intent.jump, true);
  assert.equal(sim.buddy.aiState.escape.vertical, true);
  assert.match(sim.game.thoughts.join("\n"), /Used a vertical escape/);
}

{
  const untrained = scenario({ buddyX: 1600, enemyX: 1400 });
  assert.equal(decide(untrained).jet, false, "no evidence must not unlock smart flight");
  assert.equal(untrained.buddy.aiState.escape.vertical, false);

  const exhausted = scenario({
    buddyX: 1600, enemyX: 1400, evidence: true, exhausted: true
  });
  assert.equal(decide(exhausted).jet, false, "jet lockout must override learned escape");
  assert.equal(exhausted.buddy.aiState.escape.vertical, false);
}

// Once separation is safe, the persistent escape state releases control.
{
  const sim = scenario({ buddyX: 1600, enemyX: 1500 });
  decide(sim);
  assert.ok(sim.buddy.aiState.escape);
  sim.buddy.x = 2100;
  const intent = decide(sim, .5);
  assert.equal(sim.buddy.aiState.escape, null);
  assert.notEqual(intent.plan, "covering retreat");
  assert.notEqual(intent.plan, "vertical escape");
}

console.log("Retreat planner suite passed.");

// --- Aim smoothing: linear turn rate, no instant snap ---
{
  const rates = ["flash", "balanced", "thinker"].map((id) => AI_PRESETS[id].aimTurnRate);
  assert.ok(rates[0] > rates[1] && rates[1] > rates[2], "Flash > Balanced > Thinker turn rates");
}

{
  const fighter = new Fighter({ aim: 0, ai: "balanced" });
  fighter.aiState.desiredAim = Math.PI; // 180° away
  const rate = AI_PRESETS.balanced.aimTurnRate;
  const dt = 1 / 60;
  const before = fighter.aim;
  const step = stepAimSmoothing(fighter, dt, rate);
  assert.ok(Math.abs(step) > 0, "should move toward target");
  assert.ok(
    Math.abs(angleDiff(fighter.aim, before)) < Math.PI * .9,
    "must not jump ~π in one tick"
  );
  assert.ok(
    Math.abs(Math.abs(step) - rate * dt) < 1e-9,
    "step size equals turnRate * dt on large error"
  );
}

{
  // Time-to-acquire scales with angular distance / turn rate.
  const rate = 5;
  const gaps = [Math.PI / 2, Math.PI];
  const times = gaps.map((gap) => {
    const fighter = new Fighter({ aim: 0 });
    fighter.aiState.desiredAim = gap;
    let t = 0;
    const dt = 1 / 120;
    while (Math.abs(angleDiff(fighter.aiState.desiredAim, fighter.aim)) > 1e-4 && t < 5) {
      stepAimSmoothing(fighter, dt, rate);
      t += dt;
    }
    return t;
  });
  assert.ok(times[1] > times[0] * 1.8, "π acquire takes ~2× as long as π/2");
  assert.ok(Math.abs(times[0] - (Math.PI / 2) / rate) < .03);
  assert.ok(Math.abs(times[1] - Math.PI / rate) < .03);
}

{
  // updateAI must not snap aim to the target angle on the decision tick.
  const profile = clone(DEFAULT_PROFILE);
  const player = new Fighter({ x: 1000, y: 700, human: true, team: 0 });
  const buddy = new Fighter({
    x: 1000, y: 700, team: 0, buddy: true, ai: "balanced", aim: 0, grounded: true
  });
  // Directly above → desired aim near -π/2, far from current aim 0.
  const enemy = new Fighter({ x: 1000, y: 200, team: 1, grounded: true });
  buddy.aiState.timer = 0;
  const game = {
    mode: "conquest", elapsed: 0, lastShotAtPlayer: -99,
    fighters: [player, buddy, enemy], pings: [], thoughts: []
  };
  updateAI(buddy, 1 / 60, game, profile);
  assert.ok(buddy.aiState.desiredAim != null, "decision stores desiredAim");
  const moved = Math.abs(angleDiff(buddy.aim, 0));
  const desiredGap = Math.abs(angleDiff(buddy.aiState.desiredAim, 0));
  assert.ok(desiredGap > .8, "target should require a meaningful turn");
  assert.ok(moved < desiredGap * .5, "one tick must not close most of a large aim gap");
  assert.ok(
    moved <= AI_PRESETS.balanced.aimTurnRate * (1 / 60) + 1e-6,
    "per-tick aim motion is capped by turn rate"
  );
}

{
  // Untrained buddies turn slower than enemy trainers on the same mind preset.
  const profile = clone(DEFAULT_PROFILE);
  const learned = profile.weapons.gun;
  const buddy = new Fighter({ buddy: true, ai: "flash" });
  const enemy = new Fighter({ buddy: false, ai: "flash" });
  const buddyRate = aimTurnRateFor(buddy, AI_PRESETS.flash, learned);
  const enemyRate = aimTurnRateFor(enemy, AI_PRESETS.flash, learned);
  assert.ok(buddyRate < enemyRate * .35, "rookie buddy is clumsier than trainer flash");
  assert.ok(
    Math.abs(buddyRate - AI_PRESETS.flash.aimTurnRate * ROOKIE_BUDDY.turnRateScale) < 1e-6
  );
  assert.equal(enemyRate, AI_PRESETS.flash.aimTurnRate);
}

{
  // Empty profile: high aim error, slow decisions, mind-flavored but not trained.
  const learned = clone(DEFAULT_PROFILE).weapons.gun;
  const flash = buddySkill(AI_PRESETS.flash, learned, "flash");
  const thinker = buddySkill(AI_PRESETS.thinker, learned, "thinker");
  const balanced = buddySkill(AI_PRESETS.balanced, learned, "balanced");
  const veteran = AI_PRESETS.veteran;

  assert.ok(flash.aim >= ROOKIE_BUDDY.aim - 1e-9, "empty Flash keeps rookie aim scatter");
  assert.ok(flash.aim > veteran.aim * 4, "untrained aim far worse than enemy veteran");
  assert.ok(flash.reaction > AI_PRESETS.flash.reaction * 3, "untrained Flash is not near-human tempo");
  assert.ok(flash.reaction < thinker.reaction, "Flash rookie still snappier than Thinker rookie");
  assert.ok(balanced.reaction > AI_PRESETS.balanced.reaction * 2);
  assert.equal(flash.prediction, 0);
  assert.ok(flash.fuelCare <= .06);

  ready(learned.capabilities.aim);
  ready(learned.capabilities.dodgeTiming);
  const trainedFlash = buddySkill(AI_PRESETS.flash, learned, "flash");
  assert.ok(trainedFlash.aim < flash.aim * .55, "trained buddy tightens aim vs empty");
  assert.ok(trainedFlash.reaction < flash.reaction * .55, "trained buddy decides faster");
  assert.ok(
    trainedFlash.reaction < AI_PRESETS.flash.reaction * 2.5,
    "trained Flash approaches mind ceiling"
  );
}

console.log("Aim smoothing suite passed.");

// --- Precision-aim gimmick: tiny marksman/sniper cone trim only ---
{
  assert.ok(isPrecisionAimWeapon("marksman-rifle"));
  assert.ok(isPrecisionAimWeapon("strong-sniper"));
  assert.equal(isPrecisionAimWeapon("pulse-rifle"), false);

  const profile = clone(DEFAULT_PROFILE);
  const learned = ensureLearningProfile(profile.weapons.gun);
  for (let index = 0; index < 24; index++) recordEvidence(learned.capabilities.precisionAim, true);

  const flash = AI_PRESETS.flash;
  const thinker = AI_PRESETS.thinker;
  const flashBuddy = new Fighter({
    buddy: true, ai: "flash", weaponId: "classic-sniper", weapon: "gun"
  });
  const thinkerBuddy = new Fighter({
    buddy: true, ai: "thinker", weaponId: "classic-sniper", weapon: "gun"
  });
  const trainer = new Fighter({
    buddy: false, ai: "flash", weaponId: "classic-sniper", weapon: "gun"
  });

  const flashScale = precisionAimErrorScale(learned, flashBuddy.weaponId);
  const thinkerScale = precisionAimErrorScale(learned, thinkerBuddy.weaponId);
  assert.equal(flashScale, thinkerScale);
  assert.ok(1 - flashScale <= PRECISION_AIM_MAX_REDUCTION);
  assert.ok(flash.aim * flashScale > thinker.aim * .5, "must not erase mind-mode aim gaps");
  assert.ok(flash.aim * flashScale > flash.aim * .9, "bonus is a slight edge, not near-perfect aim");

  // Enemy trainers keep raw presets (no buddy precision scale applied in AI).
  assert.equal(trainer.buddy, false);
  const buddyRate = aimTurnRateFor(flashBuddy, flash, learned);
  const enemyRate = aimTurnRateFor(trainer, flash, learned);
  assert.ok(buddyRate <= enemyRate, "precision gimmick must not boost turn rates past trainers");
  assert.equal(enemyRate, flash.aimTurnRate);
}

console.log("Precision aim suite passed.");

// --- Tactical shield AI: short holds, durability gates, front-arc threats ---
{
  assert.equal(shieldRaiseAllowed(1, 0), false);
  assert.equal(shieldRaiseAllowed(1, 1), true);
  assert.equal(shieldRaiseAllowed(.4, 1), false, "mid durability ignores mild pressure");
  assert.equal(shieldRaiseAllowed(.4, 2), true);
  assert.equal(shieldRaiseAllowed(.2, 1), false);
  assert.equal(shieldRaiseAllowed(.2, 2), true);
  assert.equal(shieldRaiseAllowed(.08, 2), false, "critical durability skips non-clutch");
  assert.equal(shieldRaiseAllowed(.08, 3), true);
}

{
  const flash = shieldHoldDuration("flash", 1, 2);
  const thinker = shieldHoldDuration("thinker", 1, 2);
  const low = shieldHoldDuration("balanced", .2, 2);
  assert.ok(flash >= .35 && flash <= .9);
  assert.ok(thinker > flash, "Thinker holds a bit longer than Flash");
  assert.ok(low < shieldHoldDuration("balanced", 1, 2));
}

{
  const defender = applyLoadout(new Fighter({
    x: 800, y: 700, team: 0, aim: 0, hp: 500, maxHp: 500
  }), { ...DEFAULT_LOADOUT, shield: "kinetic-targe" });
  const gunner = new Fighter({
    x: 1100, y: 700, team: 1, weapon: "gun", vx: 0, grounded: true
  });
  const game = { fighters: [defender, gunner], bullets: [], elapsed: 0 };
  const mild = evaluateShieldThreat(defender, gunner, game, [gunner]);
  assert.ok(mild.severity <= 1, "stationary mid-range gunner is not a clutch threat");
  assert.ok(mild.severity === 0 || mild.severity === 1);

  gunner.x = 920;
  gunner.vx = -200;
  const closing = evaluateShieldThreat(defender, gunner, game, [gunner]);
  assert.ok(closing.severity >= 1);

  const rear = new Fighter({
    x: 500, y: 700, team: 1, weapon: "saber", vx: 200
  });
  defender.aim = 0;
  const behind = evaluateShieldThreat(defender, rear, game, [rear]);
  assert.equal(behind.severity, 0, "rear threats are outside the front arc");

  const saber = new Fighter({
    x: 860, y: 700, team: 1, weapon: "saber", vx: -80
  });
  const melee = evaluateShieldThreat(defender, saber, game, [saber]);
  assert.ok(melee.severity >= 2);
}

{
  // Mild pressure: do not stay permanently raised across many decision ticks.
  const profile = clone(DEFAULT_PROFILE);
  const player = new Fighter({
    x: 400, y: 700, human: true, team: 0, weapon: "gun", grounded: true
  });
  const buddy = applyLoadout(new Fighter({
    x: 800, y: 700, team: 0, weapon: "gun", buddy: true, ai: "balanced",
    hp: 280, maxHp: 500, grounded: true, aim: 0
  }), { ...DEFAULT_LOADOUT, shield: "kinetic-targe" });
  const enemy = new Fighter({
    x: 1180, y: 700, team: 1, weapon: "gun", hp: 500, grounded: true, vx: 0
  });
  buddy.aiState.timer = 0;
  const game = {
    mode: "conquest", elapsed: 0, lastShotAtPlayer: -99,
    fighters: [player, buddy, enemy], pings: [], thoughts: [], bullets: []
  };

  let raisedTicks = 0;
  const samples = 24;
  for (let i = 0; i < samples; i++) {
    game.elapsed = i * .35;
    buddy.aiState.timer = 0;
    updateAI(buddy, .35, game, profile);
    if (buddy.shieldRaised) raisedTicks++;
  }
  assert.ok(
    raisedTicks < samples * .45,
    `mild pressure must not keep shield up most of the time (raised ${raisedTicks}/${samples})`
  );
}

{
  // Max hold expires even between decision ticks.
  const profile = clone(DEFAULT_PROFILE);
  const player = new Fighter({
    x: 400, y: 700, human: true, team: 0, grounded: true
  });
  const buddy = applyLoadout(new Fighter({
    x: 800, y: 700, team: 0, buddy: true, ai: "flash", weapon: "gun",
    hp: 500, maxHp: 500, grounded: true, aim: 0
  }), { ...DEFAULT_LOADOUT, shield: "light-buckler" });
  const enemy = new Fighter({
    x: 900, y: 700, team: 1, weapon: "saber", hp: 500, grounded: true, vx: -120
  });
  const game = {
    mode: "conquest", elapsed: 0, lastShotAtPlayer: -99,
    fighters: [player, buddy, enemy], pings: [], thoughts: [], bullets: []
  };
  buddy.aiState.timer = 0;
  updateAI(buddy, .05, game, profile);
  assert.equal(buddy.shieldRaised, true, "imminent saber should raise briefly");
  const holdUntil = buddy.aiState.shieldHoldUntil;
  assert.ok(holdUntil > 0 && holdUntil <= .9);

  buddy.aiState.timer = 1;
  game.elapsed = holdUntil + .01;
  tickAiShieldHold(buddy, buddy.aiState, game);
  assert.equal(buddy.shieldRaised, false, "shield lowers after max hold");
}

{
  // Low durability: mild/closing gun pressure ignored; clutch saber still allowed.
  const fighter = applyLoadout(new Fighter({
    x: 800, y: 700, team: 0, aim: 0, hp: 500, maxHp: 500, ai: "balanced"
  }), { ...DEFAULT_LOADOUT, shield: "kinetic-targe" });
  fighter.shieldDurability = fighter.shieldMaxDurability * .2;
  const state = fighter.aiState;
  const gunner = new Fighter({
    x: 980, y: 700, team: 1, weapon: "gun", vx: -180
  });
  const game = { fighters: [fighter, gunner], bullets: [], elapsed: 1 };
  updateAiShield(fighter, state, game, [gunner], gunner, "balanced");
  assert.equal(fighter.shieldRaised, false, "low durability skips mild/danger-light gun pressure");

  const saber = new Fighter({
    x: 880, y: 700, team: 1, weapon: "saber", vx: -100
  });
  game.fighters = [fighter, saber];
  game.elapsed = 2;
  state.shieldCooldownUntil = 0;
  updateAiShield(fighter, state, game, [saber], saber, "balanced");
  assert.equal(fighter.shieldRaised, true, "clutch/danger saber may still raise at ~20% shield");

  // Very low: only clutch (severity 3).
  fighter.shieldRaised = false;
  fighter.shieldDurability = fighter.shieldMaxDurability * .08;
  state.shieldHoldUntil = 0;
  state.shieldCooldownUntil = 0;
  game.elapsed = 3;
  updateAiShield(fighter, state, game, [saber], saber, "balanced");
  const info = evaluateShieldThreat(fighter, saber, game, [saber]);
  if (info.severity < 3) {
    assert.equal(fighter.shieldRaised, false, "sub-clutch ignored at critical durability");
  } else {
    assert.equal(fighter.shieldRaised, true);
  }

  // Force severity-2 at critical durability via unit gate.
  assert.equal(shieldRaiseAllowed(.08, 2), false);
  assert.equal(shieldRaiseAllowed(.08, 3), true);
}

{
  // Style bias: camp raises more freely / holds longer; conserve is thriftier.
  // Safety rails still apply (never permanent, durability floors for clutch).
  assert.equal(shieldStyleBias(null, .9, 1), 0);
  assert.equal(shieldStyleBias(.9, .1, 1), 0, "low reliability stays on baseline");
  const campBias = shieldStyleBias(.9, .8, .85);
  const conserveBias = shieldStyleBias(.15, .8, .85);
  assert.ok(campBias > .4);
  assert.ok(conserveBias < -.4);

  assert.equal(shieldRaiseAllowed(1, 1, -0.8), false, "strong conserve skips mild at full");
  assert.equal(shieldRaiseAllowed(.42, 1, 0.8), true, "camp may raise mild at mid-high dura");
  assert.equal(shieldRaiseAllowed(.42, 1, 0), false, "baseline still skips mild at mid dura");

  const baseHold = shieldHoldDuration("balanced", 1, 2, 0);
  const campHold = shieldHoldDuration("balanced", 1, 2, .9);
  const conserveHold = shieldHoldDuration("balanced", 1, 2, -.9);
  assert.ok(campHold > baseHold);
  assert.ok(conserveHold < baseHold);
  assert.ok(campHold <= SHIELD_MAX_HOLD);
  assert.ok(conserveHold >= .35);

  // No evidence → same as baseline short holds under mild pressure.
  const profile = clone(DEFAULT_PROFILE);
  const player = new Fighter({
    x: 400, y: 700, human: true, team: 0, weapon: "gun", grounded: true
  });
  const buddy = applyLoadout(new Fighter({
    x: 800, y: 700, team: 0, weapon: "gun", buddy: true, ai: "balanced",
    hp: 280, maxHp: 500, grounded: true, aim: 0
  }), { ...DEFAULT_LOADOUT, shield: "kinetic-targe" });
  const enemy = new Fighter({
    x: 1180, y: 700, team: 1, weapon: "gun", hp: 500, grounded: true, vx: 0
  });
  buddy.aiState.timer = 0;
  const game = {
    mode: "conquest", elapsed: 0, lastShotAtPlayer: -99,
    fighters: [player, buddy, enemy], pings: [], thoughts: [], bullets: []
  };
  updateAI(buddy, .05, game, profile);
  assert.equal(buddy.aiState.shieldStyleBias || 0, 0);

  // High camp evidence → longer holds, still capped.
  ready(profile.weapons.gun.habits.shieldUse);
  profile.weapons.gun.habits.shieldUse.estimate = .92;
  buddy.shieldRaised = false;
  buddy.aiState.shieldHoldUntil = 0;
  buddy.aiState.shieldCooldownUntil = 0;
  buddy.aiState.timer = 0;
  game.elapsed = 2;
  const saber = new Fighter({
    x: 900, y: 700, team: 1, weapon: "saber", hp: 500, grounded: true, vx: -120
  });
  game.fighters = [player, buddy, saber];
  updateAI(buddy, .05, game, profile);
  assert.ok(buddy.aiState.shieldStyleBias > .3);
  assert.equal(buddy.shieldRaised, true);
  const campUntil = buddy.aiState.shieldHoldUntil - game.elapsed;
  assert.ok(campUntil <= SHIELD_MAX_HOLD);
  assert.ok(campUntil >= shieldHoldDuration("balanced", 1, 2, 0) - .05);

  // Enemy trainers ignore player shield evidence.
  const trainer = applyLoadout(new Fighter({
    x: 800, y: 700, team: 1, weapon: "gun", buddy: false, ai: "veteran",
    hp: 500, maxHp: 500, grounded: true, aim: 0
  }), { ...DEFAULT_LOADOUT, shield: "light-buckler" });
  const foe = new Fighter({
    x: 900, y: 700, team: 0, weapon: "saber", vx: -100, grounded: true
  });
  const tGame = {
    mode: "conquest", elapsed: 0, fighters: [foe, trainer], bullets: [], pings: []
  };
  trainer.aiState.timer = 0;
  updateAI(trainer, .05, tGame, profile);
  assert.equal(trainer.aiState.shieldStyleBias || 0, 0);
}

// --- Shield knobs: modest raise vs prior short-hold band, still capped ---
{
  // Documented previous baseline holds (pre-bump).
  const PREV = { flash: .42, balanced: .58, thinker: .78 };
  const PREV_CD_FULL = .6;
  const PREV_CD_LOW = .85;

  for (const mind of ["flash", "balanced", "thinker"]) {
    const hold = shieldHoldDuration(mind, 1, 2, 0);
    assert.ok(hold > PREV[mind], `${mind} hold should exceed prior ${PREV[mind]}`);
    assert.ok(hold <= SHIELD_MAX_HOLD, `${mind} hold stays under max rail`);
  }
  assert.ok(shieldLowerCooldown(1, 0) < PREV_CD_FULL, "full-dura cooldown shorter than prior");
  assert.ok(shieldLowerCooldown(.4, 0) < PREV_CD_LOW, "low-dura cooldown shorter than prior");
  assert.ok(shieldLowerCooldown(1, 0) >= .28);
  assert.equal(shieldRaiseAllowed(1, 0), false);
  assert.equal(shieldRaiseAllowed(.08, 2), false, "critical durability gate preserved");
}

console.log("Shield AI suite passed.");

// --- Dodge: empty profile is rare/clumsy; trained recovers; trainers stay strong ---
{
  assert.ok(mindDodgeScale("flash") > mindDodgeScale("balanced"));
  assert.ok(mindDodgeScale("thinker") < mindDodgeScale("balanced"));

  const baseline = dodgeCommitChance({
    aiId: "balanced",
    isBuddy: true,
    isMimic: false,
    dodgeSkill: 0,
    playerDodgeKnowledge: 0,
    dodgeEstimate: null,
    threatSeverity: 0
  });
  assert.ok(
    baseline <= DODGE_PANIC_ROOKIE_FLOOR * 1.35,
    `untrained idle dodge stays rare (got ${baseline})`
  );
  assert.ok(baseline < DODGE_PANIC_BASE * .5, "empty profile is below the old usable panic floor");

  const underFire = dodgeCommitChance({
    aiId: "balanced",
    isBuddy: true,
    dodgeSkill: 0,
    threatSeverity: 2
  });
  assert.ok(
    underFire <= DODGE_THREAT_HIGH_ROOKIE * 1.1,
    `untrained under-fire dodge stays rare (got ${underFire})`
  );
  assert.ok(underFire < DODGE_THREAT_HIGH * .35, "empty buddy far below trained threat commit");

  const trainedFire = dodgeCommitChance({
    aiId: "balanced",
    isBuddy: true,
    dodgeSkill: .9,
    threatSeverity: 2
  });
  assert.ok(trainedFire >= DODGE_THREAT_HIGH * .85, "trained buddy recovers strong under-fire dodge");
  assert.ok(trainedFire > underFire * 3, "trained buddy dodges far more than empty");

  const veteranThreat = dodgeCommitChance({
    aiId: "veteran",
    isBuddy: false,
    dodgeSkill: 0,
    threatSeverity: 2
  });
  assert.ok(
    veteranThreat >= DODGE_THREAT_HIGH * .95,
    "enemy veteran keeps full threat dodge without player evidence"
  );
  assert.ok(veteranThreat > underFire * 3, "enemy veteran out-dodges empty buddy");

  const mimicThin = dodgeCommitChance({
    aiId: "mimic",
    isBuddy: true,
    isMimic: true,
    mimicBlend: .85,
    playerDodgeKnowledge: 0,
    dodgeEstimate: null,
    dodgeSkill: 0,
    threatSeverity: 1
  });
  assert.ok(
    mimicThin < DODGE_THREAT_MED * .55,
    "Mimic with thin dodge evidence is not semi-pro"
  );
  assert.ok(mimicThin >= DODGE_MIMIC_BASELINE * .35, "thin Mimic still has a soft floor");

  const mimicHigh = dodgeCommitChance({
    aiId: "mimic",
    isBuddy: true,
    isMimic: true,
    mimicBlend: .85,
    playerDodgeKnowledge: .9,
    dodgeEstimate: .9,
    dodgeSkill: .7,
    threatSeverity: 1
  });
  assert.ok(mimicHigh > mimicThin, "Mimic with high dodgeTiming evidence dodges more");

  const flashThreat = dodgeCommitChance({
    aiId: "flash", isBuddy: true, dodgeSkill: 0, threatSeverity: 2
  });
  const thinkerThreat = dodgeCommitChance({
    aiId: "thinker", isBuddy: true, dodgeSkill: 0, threatSeverity: 2
  });
  assert.ok(flashThreat > thinkerThreat, "Flash is twitchier than Thinker under the same threat");

  // Conquest Rookie/recruit dodge below Veteran/Elite full threat band.
  assert.equal(isGreenEnemyAi("rookie"), true);
  assert.equal(isGreenEnemyAi("recruit"), true);
  assert.equal(isGreenEnemyAi("veteran"), false);
  assert.ok(enemyDodgeScale("recruit") < enemyDodgeScale("rookie"));
  assert.ok(enemyDodgeScale("rookie") < enemyDodgeScale("veteran"));

  const rookieThreat = dodgeCommitChance({
    aiId: "rookie", isBuddy: false, dodgeSkill: .9, threatSeverity: 2
  });
  const recruitThreat = dodgeCommitChance({
    aiId: "recruit", isBuddy: false, dodgeSkill: .9, threatSeverity: 2
  });
  const eliteThreat = dodgeCommitChance({
    aiId: "elite", isBuddy: false, dodgeSkill: 0, threatSeverity: 2
  });
  assert.ok(
    rookieThreat < veteranThreat * .45,
    `Rookie enemy dodge well below Veteran (got ${rookieThreat} vs ${veteranThreat})`
  );
  assert.ok(recruitThreat < rookieThreat, "Rookie-tier follower dodges less than trainer");
  assert.ok(eliteThreat >= DODGE_THREAT_HIGH * .95, "Elite keeps full threat dodge");
  assert.ok(rookieThreat < eliteThreat * .45, "Rookie dodge well below Elite");
  // Player dodge evidence must not inflate green enemy commits.
  assert.ok(
    rookieThreat <= DODGE_THREAT_HIGH * enemyDodgeScale("rookie") * mindDodgeScale("rookie") * 1.05,
    "green enemy dodge ignores player training evidence"
  );
}

// --- Conquest enemy tiers: Rookie weaker than Veteran/Elite and mid-trained buddy ---
{
  const rookie = AI_PRESETS.rookie;
  const recruit = AI_PRESETS.recruit;
  const veteran = AI_PRESETS.veteran;
  const elite = AI_PRESETS.elite;

  // Higher aim/reaction = worse. Order: recruit < rookie < veteran < elite.
  assert.ok(rookie.aim > veteran.aim * 4, "Rookie aim scatter far worse than Veteran");
  assert.ok(rookie.aim > elite.aim * 8, "Rookie aim scatter far worse than Elite");
  assert.ok(rookie.reaction > veteran.reaction * 2, "Rookie reacts much slower than Veteran");
  assert.ok(rookie.reaction > elite.reaction * 3, "Rookie reacts much slower than Elite");
  assert.ok(rookie.aimTurnRate < veteran.aimTurnRate * .4, "Rookie turns slower than Veteran");
  assert.ok(rookie.fuelCare < veteran.fuelCare * .4, "Rookie wastes fuel vs Veteran");
  assert.ok(rookie.prediction < veteran.prediction * .2, "Rookie barely leads shots");

  assert.ok(recruit.aim > rookie.aim, "Follower recruit scatters worse than Rookie trainer");
  assert.ok(recruit.reaction > rookie.reaction, "Follower recruit slower than Rookie trainer");
  assert.ok(recruit.aimTurnRate < rookie.aimTurnRate, "Follower turns slower than trainer");
  assert.ok(ENEMY_GREEN.recruitFireHesitation > ENEMY_GREEN.fireHesitation);
  assert.ok(ENEMY_GREEN.recruitOvercommit > ENEMY_GREEN.overcommit);

  // Mid-trained balanced buddy (~0.5 reliability) still outshoots / out-reacts Rookie.
  const midAim = lerp(ROOKIE_BUDDY.aim, AI_PRESETS.balanced.aim, .5);
  const midReaction = lerp(
    ROOKIE_BUDDY.reaction * ROOKIE_BUDDY.reactionMindScale.balanced,
    AI_PRESETS.balanced.reaction,
    .5
  );
  assert.ok(rookie.aim > midAim, "Rookie enemy aim worse than mid-trained balanced buddy");
  assert.ok(rookie.reaction > midReaction, "Rookie enemy slower than mid-trained balanced buddy");

  // Fresh player buddy nerf stays intact (empty profile still near ROOKIE_BUDDY).
  const empty = buddySkill(AI_PRESETS.balanced, clone(DEFAULT_PROFILE).weapons.gun, "balanced");
  assert.ok(empty.aim >= ROOKIE_BUDDY.aim - 1e-9, "empty buddy aim floor unchanged");
  assert.ok(empty.aim > rookie.aim, "untrained buddy still clumsier than Rookie enemy");
  assert.ok(empty.reaction > rookie.reaction * .9, "untrained buddy still hesitant vs Rookie enemy");
}

console.log("Conquest Rookie tier suite passed.");

{
  const defender = new Fighter({
    x: 800, y: 700, team: 0, weapon: "gun", buddy: true, ai: "balanced",
    hp: 500, aim: 0, grounded: true
  });
  const shooter = new Fighter({
    x: 1100, y: 700, team: 1, weapon: "gun", aim: Math.PI, grounded: true
  });
  const game = {
    mode: "training", elapsed: 1, lastShotAtPlayer: -99,
    fighters: [defender, shooter],
    bullets: [{
      owner: shooter, x: 980, y: 700 + SIZE / 2, vx: -900, vy: 0
    }]
  };
  assert.equal(hasIncomingHostileShot(defender, game, { requireFacing: false }), true);
  const info = evaluateDodgeThreat(defender, shooter, game, [shooter]);
  assert.equal(info.severity, 2);
  assert.equal(info.incoming, true);

  const saber = new Fighter({
    x: 880, y: 700, team: 1, weapon: "saber", aim: Math.PI, grounded: true
  });
  const meleeGame = {
    mode: "training", elapsed: 1, lastShotAtPlayer: -99,
    fighters: [defender, saber], bullets: []
  };
  const melee = evaluateDodgeThreat(defender, saber, meleeGame, [saber]);
  assert.equal(melee.severity, 2, "close saber counts as high dodge threat");
}

{
  // Conquest escape must not starve dodges when a bolt is incoming
  // (uses trained dodge capability — empty profiles intentionally dodge rarely).
  const profile = clone(DEFAULT_PROFILE);
  ready(profile.weapons.gun.capabilities.dodgeTiming);
  const player = new Fighter({
    x: 700, y: 700, human: true, team: 0, weapon: "gun", grounded: true, hp: 500
  });
  const buddy = new Fighter({
    x: 800, y: 700, team: 0, weapon: "gun", buddy: true, ai: "balanced",
    hp: 40, grounded: true, dodgeCd: 0, iframe: 0, aim: 0
  });
  const enemy = new Fighter({
    x: 1100, y: 700, team: 1, weapon: "gun", hp: 500, grounded: true, aim: Math.PI
  });
  buddy.aiState.timer = 0;
  const game = {
    mode: "conquest", elapsed: 2, lastShotAtPlayer: 1.9,
    fighters: [player, buddy, enemy], pings: [], thoughts: [],
    bullets: [{
      owner: enemy, x: 960, y: 700 + SIZE / 2, vx: -900, vy: 0
    }]
  };

  let dodgeTicks = 0;
  const samples = 80;
  for (let i = 0; i < samples; i++) {
    buddy.dodgeCd = 0;
    buddy.iframe = 0;
    buddy.aiState.timer = 0;
    buddy.aiState.escape = null;
    const intent = updateAI(buddy, .05, game, profile);
    if (intent.dodge) dodgeTicks++;
  }
  assert.ok(
    dodgeTicks >= 20,
    `Conquest buddy should dodge under incoming fire (got ${dodgeTicks}/${samples})`
  );
  assert.ok(buddy.aiState.escape, "low-HP Conquest buddy still enters escape");
}

{
  // Respect dodge cooldown / i-frames.
  const profile = clone(DEFAULT_PROFILE);
  const player = new Fighter({
    x: 700, y: 700, human: true, team: 0, weapon: "gun", grounded: true
  });
  const buddy = new Fighter({
    x: 800, y: 700, team: 0, weapon: "gun", buddy: true, ai: "flash",
    hp: 500, grounded: true, dodgeCd: .8, iframe: 0, aim: 0
  });
  const enemy = new Fighter({
    x: 950, y: 700, team: 1, weapon: "saber", hp: 500, grounded: true, aim: Math.PI
  });
  buddy.aiState.timer = 0;
  const game = {
    mode: "training", elapsed: 1, lastShotAtPlayer: -99,
    fighters: [player, buddy, enemy], bullets: [], pings: []
  };
  assert.equal(updateAI(buddy, .05, game, profile).dodge, false, "dodgeCd blocks commit");
  buddy.dodgeCd = 0;
  buddy.iframe = .1;
  buddy.aiState.timer = 0;
  assert.equal(updateAI(buddy, .05, game, profile).dodge, false, "i-frames block commit");
}

console.log("Dodge AI suite passed.");

// --- Power-crate AI: search loot, retreat hops, combat priority ---
{
  const crate = createPowerCrate({ x: 1100, y: 1420 }, "yard", "industrial", "search");
  assert.equal(pickNearestVisibleCrate({
    powerCrates: [crate],
    fighters: [{ x: 1000, y: 1420 - SIZE, team: 0, sight: 820, dead: false }],
    platforms: [],
    props: [],
    beamReveals: []
  }, { x: 1000, y: 1420 - SIZE, team: 0, sight: 820 }), crate);

  const profile = clone(DEFAULT_PROFILE);
  // Steady trigger so search-loot assertions aren't flaky from rookie hesitation.
  ready(profile.weapons.gun.capabilities.aim);
  const player = new Fighter({
    x: 1000, y: 1420 - SIZE, human: true, team: 0, weapon: "gun", grounded: true
  });
  const buddy = new Fighter({
    x: 1000, y: 1420 - SIZE, team: 0, weapon: "gun", buddy: true,
    ai: "balanced", hp: 400, grounded: true, sight: 820
  });
  buddy.aiState.timer = 0;
  buddy.aiState.lastKnown = null;
  buddy.aiState.stale = 99;
  const game = {
    mode: "training", elapsed: 0, lastShotAtPlayer: -99,
    fighters: [player, buddy],
    pings: [], thoughts: [], powerCrates: [crate],
    platforms: [], props: [], beamReveals: []
  };
  const intent = updateAI(buddy, .05, game, profile);
  assert.equal(intent.plan, "looting power crate");
  assert.equal(intent.mx, 1, "searching AI should close on the visible crate");
  assert.equal(intent.attack, true, "crate in gun reach should be attacked");
}

{
  const profile = clone(DEFAULT_PROFILE);
  const player = new Fighter({
    x: 1600, y: 1420 - SIZE, human: true, team: 0, weapon: "gun", grounded: true
  });
  const buddy = new Fighter({
    x: 1600, y: 1420 - SIZE, team: 0, weapon: "gun", buddy: true,
    ai: "balanced", hp: 40, grounded: true, sight: 820, fuel: .9
  });
  // Threat is last-known only (enemy not visible) so self-defense does not block hops.
  buddy.aiState.lastKnown = {
    x: 1400, y: 1420 - SIZE, vx: 0, vy: 0, weapon: "saber"
  };
  buddy.aiState.stale = 1;
  buddy.aiState.timer = 0;
  const hopCrate = createPowerCrate({ x: 1780, y: 1420 }, "yard", "industrial", "hop");
  const game = {
    mode: "conquest", elapsed: 0, lastShotAtPlayer: -99,
    fighters: [player, buddy],
    pings: [], thoughts: [], powerCrates: [hopCrate],
    platforms: [], props: [], beamReveals: []
  };
  assert.ok(
    pickEscapeCrateHop(buddy, game, { direction: 1, targetX: 2020 }),
    "helper should see the ahead crate within hop radius"
  );
  assert.ok(dist(buddy, hopCrate) <= CRATE_ESCAPE_HOP_RADIUS);
  const intent = updateAI(buddy, .05, game, profile);
  assert.ok(buddy.aiState.escape, "low-HP AI should enter escape");
  assert.equal(intent.plan, "retreat crate hop");
  assert.equal(intent.mx, 1, "retreat hop should bias toward the crate along escape");
  assert.equal(intent.attack, true);
}

{
  const profile = clone(DEFAULT_PROFILE);
  ready(profile.weapons.gun.capabilities.aim);
  const player = new Fighter({
    x: 900, y: 1420 - SIZE, human: true, team: 0, weapon: "gun", grounded: true
  });
  const buddy = new Fighter({
    x: 1000, y: 1420 - SIZE, team: 0, weapon: "gun", buddy: true,
    ai: "balanced", hp: 400, grounded: true, sight: 820
  });
  const enemy = new Fighter({
    x: 1180, y: 1420 - SIZE, team: 1, weapon: "gun", hp: 500, grounded: true
  });
  const crate = createPowerCrate({ x: 900, y: 1420 }, "yard", "industrial", "bait");
  buddy.aiState.timer = 0;
  const game = {
    mode: "training", elapsed: 0, lastShotAtPlayer: -99,
    fighters: [player, buddy, enemy],
    pings: [], thoughts: [], powerCrates: [crate],
    platforms: [], props: [], beamReveals: []
  };
  const intent = updateAI(buddy, .05, game, profile);
  assert.notEqual(intent.plan, "looting power crate");
  assert.notEqual(intent.plan, "retreat crate hop");
  assert.ok(
    intent.plan === "closing safely" || intent.plan === "pressing target",
    `visible enemy must keep combat plan (got ${intent.plan})`
  );
  assert.equal(intent.mx, 1, "should close on the visible enemy, not the crate behind");
}

console.log("Power-crate AI suite passed.");

// --- Retractable armor AI: plates on in fights, fold when safe ---
{
  const armored = applyLoadout(new Fighter({
    x: 800, y: 700, team: 0, aim: 0, ai: "veteran", grounded: true
  }), { ...DEFAULT_LOADOUT, body: "retractable-armor" });
  assert.ok(armored.retractableMax > 0);
  assert.equal(armored.retractableDeployed, false);

  const saber = new Fighter({
    x: 860, y: 700, team: 1, weapon: "saber", vx: -80, grounded: true
  });
  const game = {
    fighters: [armored, saber], bullets: [], elapsed: 1, pings: [], thoughts: []
  };
  const state = armored.aiState;
  state.retractableCooldownUntil = 0;

  assert.equal(
    wantRetractableDeployed(armored, state, game, [saber], saber),
    true,
    "visible foe should want plates out"
  );
  updateAiRetractableArmor(armored, state, game, [saber], saber, "veteran");
  assert.equal(armored.retractableMorphing, true);
  assert.equal(armored.retractableMorphTo, "on");
  tickRetractableArmor(armored, RETRACTABLE_MORPH_DURATION + 0.01);
  assert.equal(armored.retractableDeployed, true);

  // Mid-range gunfight at full HP still deploys (was the shy-policy bug).
  const gunner = new Fighter({
    x: 1200, y: 700, team: 1, weapon: "gun", grounded: true, vx: 0
  });
  assert.equal(
    wantRetractableDeployed(armored, state, game, [gunner], gunner),
    true,
    "any visible gunfight should keep plates available"
  );

  // Safe / no threat: fold for speed after cooldown + min hold.
  game.elapsed = 5;
  state.retractableCooldownUntil = 0;
  state.retractableHoldUntil = 0;
  assert.equal(
    wantRetractableDeployed(armored, state, game, [], null),
    false,
    "quiet field should prefer folded plates"
  );
  updateAiRetractableArmor(armored, state, game, [], null, "veteran");
  assert.equal(armored.retractableMorphTo, "off");

  // Empty pool cannot deploy.
  tickRetractableArmor(armored, RETRACTABLE_MORPH_DURATION + 0.01);
  armored.retractableHp = 0;
  armored.retractableDeployed = false;
  armored.retractableMorphing = false;
  state.retractableCooldownUntil = 0;
  game.elapsed = 7;
  assert.equal(wantRetractableDeployed(armored, state, game, [saber], saber), false);
  updateAiRetractableArmor(armored, state, game, [saber], saber, "veteran");
  assert.equal(armored.retractableMorphing, false);
  assert.equal(armored.retractableDeployed, false);
}

{
  // Escape without hard pressure → fold for mobility.
  const armored = applyLoadout(new Fighter({
    x: 800, y: 700, team: 1, aim: Math.PI, ai: "veteran", grounded: true
  }), { ...DEFAULT_LOADOUT, body: "retractable-armor" });
  armored.retractableDeployed = true;
  armored.retractableMorphing = false;
  armored.coreHp = armored.coreMaxHp;
  armored.retractableHp = armored.retractableMax;
  const foe = new Fighter({
    x: 1400, y: 700, team: 0, weapon: "gun", grounded: true, vx: 0
  });
  const game = {
    fighters: [foe, armored], bullets: [], elapsed: 2, pings: [], thoughts: []
  };
  const state = armored.aiState;
  state.escape = {
    direction: -1, targetX: 200, until: 99, threatWeapon: "gun", vertical: false
  };
  state.retractableCooldownUntil = 0;
  state.retractableHoldUntil = 0;
  assert.equal(
    wantRetractableDeployed(armored, state, game, [foe], foe),
    false,
    "escape should fold plates when not hard-pressed"
  );
  updateAiRetractableArmor(armored, state, game, [foe], foe, "veteran");
  assert.equal(armored.retractableMorphTo, "off");
}

{
  // Player buddy with retractable armor deploys on sight — not gated on shield evidence.
  const profile = clone(DEFAULT_PROFILE);
  const player = new Fighter({
    x: 400, y: 700, human: true, team: 0, weapon: "gun", grounded: true
  });
  const buddy = applyLoadout(new Fighter({
    x: 800, y: 700, team: 0, weapon: "gun", buddy: true, ai: "balanced",
    grounded: true, aim: 0, sight: 820
  }), { ...DEFAULT_LOADOUT, body: "retractable-armor" });
  const enemy = new Fighter({
    x: 1180, y: 700, team: 1, weapon: "gun", hp: 500, grounded: true, vx: 0
  });
  buddy.aiState.timer = 0;
  buddy.aiState.retractableCooldownUntil = 0;
  const game = {
    mode: "conquest", elapsed: 1, lastShotAtPlayer: -99,
    fighters: [player, buddy, enemy], pings: [], thoughts: [], bullets: []
  };
  updateAI(buddy, .05, game, profile);
  assert.ok(
    buddy.retractableMorphing || buddy.retractableDeployed,
    "buddy should deploy retractable armor when a foe is visible"
  );
  assert.equal(buddy.retractableMorphTo, "on");
}

{
  // End-to-end: veteran enemy with retractable armor deploys via updateAI under melee.
  const profile = clone(DEFAULT_PROFILE);
  const buddy = new Fighter({
    x: 500, y: 700, team: 0, weapon: "gun", buddy: true, ai: "balanced", grounded: true
  });
  const enemy = applyLoadout(new Fighter({
    x: 800, y: 700, team: 1, weapon: "gun", ai: "veteran",
    grounded: true, aim: Math.PI, sight: 820
  }), { ...DEFAULT_LOADOUT, body: "retractable-armor" });
  const rusher = new Fighter({
    x: 860, y: 700, team: 0, weapon: "saber", grounded: true, vx: 40, human: true
  });
  enemy.aiState.timer = 0;
  enemy.aiState.retractableCooldownUntil = 0;
  const game = {
    mode: "conquest", elapsed: 1, lastShotAtPlayer: -99,
    fighters: [rusher, buddy, enemy], pings: [], thoughts: [], bullets: []
  };
  updateAI(enemy, .05, game, profile);
  assert.ok(
    enemy.retractableMorphing || enemy.retractableDeployed,
    "veteran AI should start deploying retractable armor under saber pressure"
  );
}

console.log("Retractable armor AI suite passed.");

// --- Material Consumer / Throw Breakable / Reconjurer AI ---
{
  assert.match(thoughtReason("debris beam"), /scrap ammo/i);
  assert.match(thoughtReason("vacuuming scrap"), /pool was full/i);
  assert.match(thoughtReason("throwing breakable"), /missile/i);
  assert.match(thoughtReason("reconjuring debris"), /rebuilt/i);
  assert.match(thoughtReason("conjuring cover"), /buy space/i);
}

{
  const buddy = applyLoadout(new Fighter({
    x: 400, y: 700, team: 0, buddy: true, ai: "balanced", grounded: true
  }), {
    ...DEFAULT_LOADOUT,
    secondaryWeapon: MATERIAL_CONSUMER_ID,
    body: "nanotech-chestplate"
  });
  const game = {
    groundDebris: [
      { x: 420, y: 720, sourceId: "ai-mc-a", despawnMode: null, color: "#888" }
    ],
    props: [], powerCrates: [], fighters: [buddy], elapsed: 1
  };
  assert.equal(debrisNearFighter(game, buddy), true);
  assert.equal(
    wantAiSecondarySlot(buddy, game, [], null),
    "secondaryWeapon",
    "MC wants draw when debris is in vacuum range"
  );
}

{
  // End-to-end: buddy swaps onto Material Consumer near debris.
  const profile = clone(DEFAULT_PROFILE);
  const player = new Fighter({
    x: 200, y: 700, human: true, team: 0, grounded: true
  });
  const buddy = applyLoadout(new Fighter({
    x: 800, y: 700, team: 0, buddy: true, ai: "balanced",
    grounded: true, aim: 0, sight: 820, hp: 400
  }), {
    ...DEFAULT_LOADOUT,
    secondaryWeapon: MATERIAL_CONSUMER_ID,
    body: "nanotech-chestplate"
  });
  const enemy = new Fighter({
    x: 1600, y: 700, team: 1, weapon: "gun", hp: 500, grounded: true
  });
  buddy.aiState.timer = 0;
  buddy.aiState.weaponSwapUntil = 0;
  const game = {
    mode: "conquest", elapsed: 1, lastShotAtPlayer: -99,
    fighters: [player, buddy, enemy], pings: [], thoughts: [], bullets: [],
    groundDebris: [
      { x: 810, y: 720, sourceId: "ai-mc-swap", despawnMode: null, color: "#888" }
    ],
    props: [], powerCrates: []
  };
  updateAI(buddy, .05, game, profile);
  assert.equal(buddy.weaponId, MATERIAL_CONSUMER_ID, "AI draws Material Consumer near debris");
  assert.ok(buddy.materialConsumer);
}

{
  // Full pool + debris → hold V (ejectVacuum).
  const buddy = applyLoadout(new Fighter({
    x: 500, y: 700, team: 0, buddy: true, ai: "balanced", grounded: true
  }), {
    ...DEFAULT_LOADOUT,
    secondaryWeapon: MATERIAL_CONSUMER_ID,
    body: "nanotech-chestplate"
  });
  selectWeaponSlot(buddy, "secondaryWeapon");
  buddy.nanobotFree = buddy.nanobotMax;
  buddy.nanobotArmor = 0;
  buddy.nanobotWeapon = 0;
  const enemy = new Fighter({
    x: 900, y: 700, team: 1, weapon: "gun", grounded: true
  });
  const state = {
    chuck: false, ejectVacuum: false, attack: false, plan: "idle", desiredAim: null
  };
  const game = {
    elapsed: 1,
    groundDebris: [
      { x: 510, y: 710, sourceId: "ai-mc-v", despawnMode: null, color: "#888" }
    ],
    fighters: [buddy, enemy]
  };
  updateAiMaterialConsumer(buddy, state, game, [enemy], enemy);
  assert.equal(state.ejectVacuum, true, "full pool near debris holds V");
  assert.equal(state.plan, "vacuuming scrap");
}

{
  // Scrap ammo + mid-range foe → debris beam (chuck).
  const buddy = applyLoadout(new Fighter({
    x: 500, y: 700, team: 0, buddy: true, ai: "balanced", grounded: true, aim: 0
  }), {
    ...DEFAULT_LOADOUT,
    secondaryWeapon: MATERIAL_CONSUMER_ID,
    body: "nanotech-chestplate"
  });
  selectWeaponSlot(buddy, "secondaryWeapon");
  buddy.materialEjectionTank = [{ bots: 0, ejection: true, color: "#888", w: 8, h: 8 }];
  const enemy = new Fighter({
    x: 820, y: 700, team: 1, weapon: "gun", grounded: true
  });
  const state = {
    chuck: false, ejectVacuum: false, attack: true, plan: "idle", desiredAim: null
  };
  updateAiMaterialConsumer(buddy, state, { elapsed: 1 }, [enemy], enemy);
  assert.equal(state.chuck, true, "AI beams when scrap ammo and foe are mid-range");
  assert.equal(state.attack, false, "stand-off beam suppresses saber swing");
  assert.equal(state.plan, "debris beam");
  assert.ok(state.desiredAim != null);
}

{
  // Throw Breakable: draw + grab a prop already in reach (no LOS needed).
  const profile = clone(DEFAULT_PROFILE);
  const crate = {
    x: 780, y: 700, w: 48, h: 48, kind: "crate", breakable: true,
    destroyed: false, hp: 40, maxHp: 40, solid: true
  };
  const player = new Fighter({
    x: 200, y: 700, human: true, team: 0, grounded: true
  });
  const buddy = applyLoadout(new Fighter({
    x: 800, y: 700, team: 0, buddy: true, ai: "balanced",
    grounded: true, aim: 0, sight: 820, hp: 400
  }), {
    ...DEFAULT_LOADOUT,
    secondaryWeapon: THROW_BREAKABLE_ID
  });
  const enemy = new Fighter({
    x: 1400, y: 700, team: 1, weapon: "gun", hp: 500, grounded: true
  });
  buddy.aiState.timer = 0;
  buddy.aiState.weaponSwapUntil = 0;
  const game = {
    mode: "conquest", elapsed: 1, lastShotAtPlayer: -99,
    fighters: [player, buddy, enemy], pings: [], thoughts: [], bullets: [],
    props: [crate], platforms: [{ x: 0, y: 760, w: 2000, h: 40 }],
    powerCrates: [], groundDebris: []
  };
  assert.ok(pickNearestGrabbable(game, buddy));
  updateAI(buddy, .05, game, profile);
  assert.equal(buddy.weaponId, THROW_BREAKABLE_ID, "AI draws Throw Breakable near cover");
  assert.ok(
    buddy.aiState.plan === "grabbing breakable"
      || buddy.aiState.plan === "approaching breakable"
      || buddy.heldProp,
    `expected grab plan, got ${buddy.aiState.plan}`
  );
  assert.equal(buddy.aiState.attack, true, "AI clicks to grab when in range");
}

{
  // Holding a prop → throw at foe.
  const buddy = applyLoadout(new Fighter({
    x: 500, y: 700, team: 0, buddy: true, ai: "balanced", grounded: true, aim: 0
  }), {
    ...DEFAULT_LOADOUT,
    secondaryWeapon: THROW_BREAKABLE_ID
  });
  selectWeaponSlot(buddy, "secondaryWeapon");
  const prop = {
    x: 520, y: 700, w: 40, h: 40, breakable: true, destroyed: false, hp: 40, maxHp: 40
  };
  buddy.heldProp = prop;
  prop.heldBy = buddy;
  const enemy = new Fighter({
    x: 900, y: 700, team: 1, weapon: "gun", grounded: true
  });
  const state = {
    attack: false, plan: "idle", desiredAim: null, mx: 0,
    chuck: false, ejectVacuum: false
  };
  updateAiThrowBreakable(buddy, state, { elapsed: 1, props: [prop] }, [enemy], enemy);
  assert.equal(state.attack, true, "held prop → throw click");
  assert.equal(state.plan, "throwing breakable");
}

{
  // Reconjurer: rebuild nearby debris via updateAI.
  const yard = createMapRuntime("yard");
  const crate = yard.props.find((p) => p.kind === "crate");
  assert.ok(crate);
  crate.destroyed = true;
  crate.solid = false;
  crate.hp = 0;
  crate.groundDebrisDropped = false;
  const profile = clone(DEFAULT_PROFILE);
  const player = new Fighter({
    x: 100, y: crate.y, human: true, team: 0, grounded: true
  });
  const buddy = applyLoadout(new Fighter({
    x: crate.x - 10, y: crate.y, team: 0, buddy: true, ai: "balanced",
    grounded: true, aim: 0, sight: 820, hp: 400
  }), {
    ...DEFAULT_LOADOUT,
    extensionSecondary: RECONJURER_BUILDER_ID
  });
  const enemy = new Fighter({
    x: 1800, y: crate.y, team: 1, weapon: "gun", hp: 500, grounded: true
  });
  buddy.aiState.timer = 0;
  const game = {
    mode: "conquest", elapsed: 1, lastShotAtPlayer: -99,
    fighters: [player, buddy, enemy], pings: [], thoughts: [], bullets: [],
    props: yard.props, platforms: yard.platforms, powerCrates: [],
    groundDebris: [], effects: [], reconquerQueue: [], forgeCasts: [],
    mapId: "yard", theme: "industrial"
  };
  spawnPropDebris(game, crate, crate.x + crate.w / 2, crate.y + crate.h / 2);
  assert.ok(game.groundDebris.length > 0);
  updateAI(buddy, .05, game, profile);
  assert.equal(crate.destroyed, false, "AI Reconjurer rebuilds nearby debris");
  assert.equal(buddy.aiState.plan, "reconjuring debris");
  assert.ok(buddy.reconjurerCd > 0);
}

{
  // Reconjurer: no debris + pressure → paid conjure.
  const buddy = applyLoadout(new Fighter({
    x: 400, y: 600, team: 0, buddy: true, ai: "balanced",
    grounded: true, hp: 180
  }), {
    ...DEFAULT_LOADOUT,
    extensionSecondary: RECONJURER_BUILDER_ID,
    body: "nanotech-chestplate"
  });
  buddy.nanobotFree = 40;
  const enemy = new Fighter({
    x: 520, y: 600, team: 1, weapon: "saber", grounded: true
  });
  const state = { plan: "idle", chuck: false, ejectVacuum: false };
  const game = {
    elapsed: 1,
    props: [],
    powerCrates: [],
    platforms: [{ x: 0, y: 700, w: 1200, h: 40 }],
    groundDebris: [],
    effects: [],
    mapId: "yard",
    theme: "industrial"
  };
  updateAiReconjurer(buddy, state, game, [enemy], enemy);
  assert.equal(state.plan, "conjuring cover");
  assert.ok(
    game.props.length + (game.powerCrates?.length || 0) >= 1,
    "pressured Reconjurer conjures a breakable or metal crate"
  );
  assert.ok(buddy.reconjurerCd > 0);
}

{
  // Weapon-slot helper stays on primary when MC has no ammo and no debris.
  const buddy = applyLoadout(new Fighter({
    x: 400, y: 700, team: 0, buddy: true, grounded: true, hp: 400
  }), {
    ...DEFAULT_LOADOUT,
    secondaryWeapon: MATERIAL_CONSUMER_ID,
    body: "nanotech-chestplate"
  });
  const enemy = new Fighter({
    x: 700, y: 700, team: 1, weapon: "gun", grounded: true
  });
  assert.equal(
    wantAiSecondarySlot(buddy, { groundDebris: [] }, [enemy], enemy),
    "weapon"
  );
  const state = { weaponSwapUntil: 0 };
  updateAiWeaponSlot(buddy, state, { elapsed: 1, groundDebris: [] }, [enemy], enemy);
  assert.equal(buddy.activeWeaponSlot, "weapon");
}

console.log("Secondary / extension AI suite passed.");

// --- Light Condensation AI ---
{
  assert.match(thoughtReason("condensing light"), /glare|reveal|blind/i);
  assert.match(thoughtReason("breaking glare"), /light node|vision/i);
}

{
  // Hunt last-known: plant a glare spot along the lane.
  const profile = clone(DEFAULT_PROFILE);
  const player = new Fighter({
    x: 100, y: 700, human: true, team: 0, grounded: true
  });
  const buddy = applyLoadout(new Fighter({
    x: 500, y: 700, team: 0, buddy: true, ai: "balanced",
    grounded: true, aim: 0, sight: 820, hp: 400
  }), {
    ...DEFAULT_LOADOUT,
    extensionSecondary: LIGHT_CONDENSATION_ID
  });
  // Far enemy outside sight so AI hunts last-known after a prior spot.
  const enemy = new Fighter({
    x: 1800, y: 700, team: 1, weapon: "gun", hp: 500, grounded: true
  });
  buddy.aiState.timer = 0;
  buddy.aiState.lastKnown = { x: enemy.x, y: enemy.y, vx: 0, vy: 0, weapon: "gun" };
  buddy.aiState.stale = 1;
  const game = {
    mode: "conquest", elapsed: 1, lastShotAtPlayer: -99,
    fighters: [player, buddy, enemy], pings: [], thoughts: [], bullets: [],
    props: [], platforms: [{ x: 0, y: 760, w: 2400, h: 40 }], effects: []
  };
  updateAI(buddy, .05, game, profile);
  assert.ok(
    game.props.some((p) => p.lightCondensation),
    "AI plants Light Condensation while hunting last-known"
  );
  assert.ok(
    buddy.aiState.plan === "condensing light"
      || buddy.lightCondensationCd > 0
  );
}

{
  // Enemy glare in range → break it.
  const buddy = applyLoadout(new Fighter({
    x: 400, y: 700, team: 0, buddy: true, ai: "balanced",
    grounded: true, aim: 0, hp: 400
  }), DEFAULT_LOADOUT);
  const glare = createLightCondensationProp(700, 720, { team: 1 });
  const state = {
    attack: false, plan: "idle", desiredAim: null, chuck: false, ejectVacuum: false
  };
  updateAiLightCondensation(
    buddy,
    state,
    { props: [glare], fighters: [buddy] },
    [],
    null
  );
  assert.equal(state.plan, "breaking glare");
  assert.equal(state.attack, true);
}

{
  // Pressure + equipped → plant glare as lane blind/scout.
  const buddy = applyLoadout(new Fighter({
    x: 500, y: 700, team: 0, buddy: true, ai: "balanced",
    grounded: true, aim: 0, hp: 180
  }), {
    ...DEFAULT_LOADOUT,
    extensionSecondary: LIGHT_CONDENSATION_ID
  });
  const enemy = new Fighter({
    x: 720, y: 700, team: 1, weapon: "saber", grounded: true
  });
  const state = { plan: "idle", attack: false, desiredAim: null };
  const game = { props: [], effects: [], fighters: [buddy, enemy] };
  updateAiLightCondensation(buddy, state, game, [enemy], enemy);
  assert.equal(state.plan, "condensing light");
  assert.equal(game.props.length, 1);
  assert.ok(buddy.lightCondensationCd > 0);
}

console.log("Light Condensation AI suite passed.");

// --- Trapper AI ---
{
  assert.match(thoughtReason("setting bear trap"), /mobility|pin/i);
  assert.match(thoughtReason("laying fake platform"), /false ledge|landing/i);
}

{
  // Grounded foe → bear trap.
  const buddy = applyLoadout(new Fighter({
    x: 500, y: 700, team: 0, buddy: true, ai: "balanced",
    grounded: true, aim: 0, hp: 400
  }), {
    ...DEFAULT_LOADOUT,
    extensionSecondary: TRAPPER_ID
  });
  const enemy = new Fighter({
    x: 720, y: 700, team: 1, weapon: "gun", grounded: true, hp: 500
  });
  const state = { plan: "idle", desiredAim: null, attack: false };
  const game = { traps: [], effects: [], fighters: [buddy, enemy] };
  updateAiTrapper(buddy, state, game, [enemy], enemy);
  assert.equal(state.plan, "setting bear trap");
  assert.equal(game.traps.length, 1);
  assert.equal(game.traps[0].trapType, "bear");
}

{
  // Airborne / above foe → fake platform.
  const buddy = applyLoadout(new Fighter({
    x: 500, y: 700, team: 0, buddy: true, ai: "balanced",
    grounded: true, aim: -0.8, hp: 400
  }), {
    ...DEFAULT_LOADOUT,
    extensionSecondary: TRAPPER_ID
  });
  buddy.trapperType = "bear";
  const enemy = new Fighter({
    x: 620, y: 520, team: 1, weapon: "gun", grounded: false, hp: 500, vy: 100
  });
  const state = { plan: "idle", desiredAim: null };
  const game = { traps: [], effects: [], fighters: [buddy, enemy] };
  updateAiTrapper(buddy, state, game, [enemy], enemy);
  assert.equal(state.plan, "laying fake platform");
  assert.equal(game.traps[0].trapType, "fakePlatform");
}

{
  // End-to-end updateAI plants a trap when equipped.
  const profile = clone(DEFAULT_PROFILE);
  const player = new Fighter({
    x: 100, y: 700, human: true, team: 0, grounded: true
  });
  const buddy = applyLoadout(new Fighter({
    x: 500, y: 700, team: 0, buddy: true, ai: "balanced",
    grounded: true, aim: 0, sight: 820, hp: 180
  }), {
    ...DEFAULT_LOADOUT,
    extensionSecondary: TRAPPER_ID
  });
  const enemy = new Fighter({
    x: 700, y: 700, team: 1, weapon: "saber", hp: 500, grounded: true
  });
  buddy.aiState.timer = 0;
  const game = {
    mode: "conquest", elapsed: 1, lastShotAtPlayer: -99,
    fighters: [player, buddy, enemy], pings: [], thoughts: [], bullets: [],
    traps: [], props: [], platforms: [{ x: 0, y: 760, w: 2000, h: 40 }], effects: []
  };
  updateAI(buddy, .05, game, profile);
  assert.ok(game.traps.length >= 1, "pressured Trapper AI plants a trap");
  assert.ok(buddy.trapperCd > 0);
}

console.log("Trapper AI suite passed.");

// --- Illusionist AI ---
{
  assert.match(thoughtReason("casting fighter illusion"), /decoy|focus/i);
  assert.match(thoughtReason("casting platform illusion"), /false ledge|landing/i);
}

{
  // Pressured → fighter decoy with cloned kit.
  const buddy = applyLoadout(new Fighter({
    x: 500, y: 700, team: 0, buddy: true, ai: "balanced",
    grounded: true, aim: 0, hp: 180, name: "Pixel", color: "#42dff5"
  }), {
    ...DEFAULT_LOADOUT,
    extensionSecondary: ILLUSIONIST_ID,
    weapon: "pulse-rifle"
  });
  const enemy = new Fighter({
    x: 700, y: 700, team: 1, weapon: "saber", grounded: true, hp: 500
  });
  const state = { plan: "idle", desiredAim: null };
  const game = { fighters: [buddy, enemy], illusions: [], effects: [] };
  updateAiIllusionist(buddy, state, game, [enemy], enemy);
  assert.equal(state.plan, "casting fighter illusion");
  const decoy = game.fighters.find((f) => isIllusionFighter(f));
  assert.ok(decoy);
  assert.equal(decoy.loadout.weapon, "pulse-rifle");
}

{
  // Airborne foe → platform illusion.
  const buddy = applyLoadout(new Fighter({
    x: 500, y: 700, team: 0, buddy: true, ai: "balanced",
    grounded: true, aim: -0.5, hp: 400
  }), {
    ...DEFAULT_LOADOUT,
    extensionSecondary: ILLUSIONIST_ID
  });
  const enemy = new Fighter({
    x: 620, y: 500, team: 1, weapon: "gun", grounded: false, hp: 500
  });
  const state = { plan: "idle", desiredAim: null };
  const game = { fighters: [buddy, enemy], illusions: [], effects: [] };
  updateAiIllusionist(buddy, state, game, [enemy], enemy);
  assert.equal(state.plan, "casting platform illusion");
  assert.equal(game.illusions[0].illusionType, "platform");
}

console.log("Illusionist AI suite passed.");



