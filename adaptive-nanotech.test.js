import assert from "node:assert/strict";
import { attack, Fighter } from "./combat.js";
import {
  ADAPTIVE_MODE_COOLDOWN, ADAPTIVE_MODE_DEFS, ADAPTIVE_MORPH_DURATION, ADAPTIVE_NANOTECH_ID,
  adaptiveAttackLocked, applyLoadout, beginAdaptiveMorph, cycleAdaptiveMode, DEFAULT_LOADOUT,
  GEAR, GEAR_BY_ID, isAdaptiveNanotechWeapon, isPrecisionAimWeapon, nanotechAmmoBonusOf,
  nanotechCostOf, nanotechFormCostOf, nanotechFormPct, nextAdaptiveMode, tickAdaptiveWeapon,
  tickNanotech, tryFormNanotechWeapon, tryNanotechWeaponAction, weaponAttackLocked, weaponStats
} from "./equipment.js";
import { isBladeFighter, isMeleeFighter, powerupRollWeights } from "./powerups.js";
import { weaponVisual } from "./rendering.js";

const loadout = (weapon = ADAPTIVE_NANOTECH_ID, shield = "no-shield") => ({
  ...DEFAULT_LOADOUT, weapon, shield
});

function finishMorph(fighter) {
  tickAdaptiveWeapon(fighter, ADAPTIVE_MORPH_DURATION + 0.01);
  assert.equal(fighter.adaptiveMorphing, false);
}

// Catalog: ultimate weapon, tagged nanotech + adaptive, 195-bot pool, sword defaults.
{
  const gear = GEAR_BY_ID[ADAPTIVE_NANOTECH_ID];
  assert.ok(gear);
  assert.equal(gear.slot, "weapon");
  assert.equal(gear.baseKind, "saber");
  assert.equal(gear.nanotech, true);
  assert.equal(gear.adaptiveNanotech, true);
  assert.equal(gear.nanobotCost, 195);
  assert.ok(Number.isInteger(gear.price) && gear.price >= 400);
  assert.equal(nanotechCostOf(ADAPTIVE_NANOTECH_ID), 195);
  assert.equal(nanotechFormCostOf(ADAPTIVE_NANOTECH_ID), 100, "catalog default matches sword body");
  assert.equal(nanotechAmmoBonusOf(ADAPTIVE_NANOTECH_ID), 95);
}

// Per-mode combat stats match dedicated counterparts exactly.
{
  assertWeaponStatsMatch(ADAPTIVE_MODE_DEFS.sword.weaponStats, weaponStats("arc-saber"));
  assertWeaponStatsMatch(ADAPTIVE_MODE_DEFS.rifle.weaponStats, weaponStats("pulse-rifle"));
  assertWeaponStatsMatch(ADAPTIVE_MODE_DEFS.sniper.weaponStats, weaponStats("classic-sniper"));
  assert.equal(ADAPTIVE_MODE_DEFS.sword.formCost, 100);
  assert.equal(ADAPTIVE_MODE_DEFS.sword.shotCost, 0);
  assert.equal(ADAPTIVE_MODE_DEFS.rifle.formCost, 150);
  assert.equal(ADAPTIVE_MODE_DEFS.rifle.shotCost, 2);
  assert.equal(ADAPTIVE_MODE_DEFS.sniper.formCost, 175);
  assert.equal(ADAPTIVE_MODE_DEFS.sniper.shotCost, 20);
}

function assertWeaponStatsMatch(a, b) {
  for (const key of Object.keys(b)) {
    assert.deepEqual(a[key], b[key], key);
  }
}

// applyLoadout starts in sword mode, auto-forms, and seeds the 195-bot pool.
{
  const fighter = applyLoadout(new Fighter({}), loadout());
  assert.equal(fighter.adaptiveNanotechWeapon, true);
  assert.equal(fighter.adaptiveMode, "sword");
  assert.equal(fighter.weapon, "saber");
  assert.equal(fighter.nanobotMax, 195);
  assert.equal(fighter.nanotechWeaponCost, 100);
  assert.equal(fighter.nanobotShotCost, 0);
  assert.equal(fighter.nanotechAmmoBonus, 95);
  assert.equal(fighter.nanobotWeapon, 100, "sword body auto-formed");
  assert.equal(fighter.nanobotFree, 95);
  assert.equal(nanotechFormPct(fighter), 1);
  assert.equal(isAdaptiveNanotechWeapon(fighter), true);
  assert.equal(fighter.weaponBaseDamage, weaponStats("arc-saber").baseDamage);
  assert.equal(fighter.weaponRpm, weaponStats("arc-saber").rpm);
  assert.equal(fighter.weaponReach, weaponStats("arc-saber").range);
}

// R cycle order Sword → Rifle → Sniper → Sword, with morph lockout + cooldown.
{
  const fighter = applyLoadout(new Fighter({ team: 0 }), loadout());
  assert.equal(nextAdaptiveMode("sword"), "rifle");
  assert.equal(nextAdaptiveMode("rifle"), "sniper");
  assert.equal(nextAdaptiveMode("sniper"), "sword");

  assert.equal(cycleAdaptiveMode(fighter), true);
  assert.equal(fighter.adaptiveMorphing, true);
  assert.equal(adaptiveAttackLocked(fighter), true);
  assert.equal(weaponAttackLocked(fighter), true);
  const game = { bullets: [], effects: [], fighters: [fighter], stats: {}, mode: "conquest" };
  fighter.attackCd = 0;
  attack(fighter, game, () => .5);
  assert.equal(game.bullets.length, 0);
  assert.equal(game.effects.filter((e) => e.type === "saber").length, 0);

  // Cannot start another morph mid-transform.
  assert.equal(beginAdaptiveMorph(fighter, "sniper"), false);
  finishMorph(fighter);
  assert.equal(fighter.adaptiveMode, "rifle");
  assert.equal(fighter.weapon, "gun");
  assert.equal(fighter.nanotechWeaponCost, 150);
  assert.equal(fighter.nanobotShotCost, 2);
  assert.equal(fighter.nanotechAmmoBonus, 45);
  assert.equal(fighter.nanobotWeapon, 100, "growing cost: stays partially formed until E");
  assert.equal(fighter.nanobotFree, 95, "no spill when cost grows");
  assert.ok(fighter.adaptiveModeCd >= ADAPTIVE_MODE_COOLDOWN - 0.001);

  // E tops up the rifle body from free reserve (partial form allowed like other nanotech).
  const topUp = tryFormNanotechWeapon(fighter);
  assert.equal(topUp.ok, true);
  assert.equal(fighter.nanobotWeapon, 150);
  assert.equal(fighter.nanobotFree, 45);

  // Cooldown blocks immediate re-cycle.
  assert.equal(cycleAdaptiveMode(fighter), false);
  fighter.adaptiveModeCd = 0;
  assert.equal(cycleAdaptiveMode(fighter), true);
  finishMorph(fighter);
  assert.equal(fighter.adaptiveMode, "sniper");
  assert.equal(fighter.weapon, "gun");
  assert.equal(fighter.nanotechWeaponCost, 175);
  assert.equal(fighter.nanobotShotCost, 20);
  assert.equal(fighter.nanotechAmmoBonus, 20);
  assert.equal(fighter.nanobotWeapon, 150, "still partial — sniper needs 25 more");
  assert.equal(fighter.nanobotFree, 45);
  tryFormNanotechWeapon(fighter);
  assert.equal(fighter.nanobotWeapon, 175);
  assert.equal(fighter.nanobotFree, 20);

  fighter.adaptiveModeCd = 0;
  assert.equal(cycleAdaptiveMode(fighter), true);
  finishMorph(fighter);
  assert.equal(fighter.adaptiveMode, "sword");
  assert.equal(fighter.weapon, "saber");
  assert.equal(fighter.nanotechWeaponCost, 100);
  assert.equal(fighter.nanobotWeapon, 100, "shrinking cost clamps + spills excess");
  assert.equal(fighter.nanobotFree, 95);
}

// Spilling: shrinking form cost spills excess bots back to free reserve.
{
  const fighter = applyLoadout(new Fighter({}), loadout());
  // Sniper body (175) committed while the pool is still full sword-form (100) —
  // simulate a partial/overfilled weapon pool before a morph completes.
  fighter.nanobotWeapon = 175;
  fighter.nanobotFree = 20;
  fighter.adaptiveModeCd = 0;
  fighter.adaptiveMode = "sniper";
  beginAdaptiveMorph(fighter, "sword");
  finishMorph(fighter);
  assert.equal(fighter.nanotechWeaponCost, 100);
  assert.equal(fighter.nanobotWeapon, 100, "clamped to new sword form cost");
  assert.equal(fighter.nanobotFree, 95, "excess 75 bots spilled back to free");
}

// E still forms/absorbs the active body like other nanotech gear; ammo withdraws from free.
{
  const fighter = applyLoadout(new Fighter({
    x: 100, y: 400, team: 0, aim: 0
  }), loadout());
  fighter.adaptiveModeCd = 0;
  beginAdaptiveMorph(fighter, "rifle");
  finishMorph(fighter);
  tryFormNanotechWeapon(fighter);
  assert.equal(fighter.nanobotWeapon, 150);
  assert.equal(fighter.nanobotFree, 45);

  const game = { bullets: [], effects: [], fighters: [fighter] };
  fighter.attackCd = 0;
  attack(fighter, game);
  assert.equal(game.bullets.length, 1);
  assert.equal(fighter.nanobotWeapon, 150, "gun body unchanged by shots");
  assert.equal(fighter.nanobotFree, 43, "2 bots/shot pulled from free reserve");

  const absorb = tryNanotechWeaponAction(fighter);
  assert.equal(absorb.ok, true);
  assert.equal(absorb.absorbing, true);
  for (let i = 0; i < 30; i++) tickNanotech(fighter, 0.05);
  assert.equal(fighter.nanobotWeapon, 0);
  assert.ok(fighter.nanobotFree + 1e-6 >= 43 + 150);

  const reform = tryNanotechWeaponAction(fighter);
  assert.equal(reform.ok, true);
  assert.equal(reform.fullyFormed, true);
  assert.equal(fighter.nanobotWeapon, 150);
}

// Precision aim gimmick only while the active body is sniper mode.
{
  const fighter = applyLoadout(new Fighter({}), loadout());
  assert.equal(isPrecisionAimWeapon(fighter), false, "sword body");
  fighter.adaptiveModeCd = 0;
  beginAdaptiveMorph(fighter, "rifle");
  finishMorph(fighter);
  assert.equal(isPrecisionAimWeapon(fighter), false, "rifle body");
  fighter.adaptiveModeCd = 0;
  beginAdaptiveMorph(fighter, "sniper");
  finishMorph(fighter);
  assert.equal(isPrecisionAimWeapon(fighter), true, "sniper body");
  // Still resolves by id/gear for non-fighter callers.
  assert.equal(isPrecisionAimWeapon(ADAPTIVE_NANOTECH_ID), false);
}

// Counter-slash / blade loot / melee detection: sword body only, not mid-morph.
{
  const sword = applyLoadout(new Fighter({}), loadout());
  assert.equal(isMeleeFighter(sword), true);
  assert.equal(isBladeFighter(sword), true);
  assert.ok(powerupRollWeights(sword).counterSlash > 0);

  sword.adaptiveModeCd = 0;
  beginAdaptiveMorph(sword, "rifle");
  assert.equal(isMeleeFighter(sword), false, "morphing away from sword");
  finishMorph(sword);
  assert.equal(isMeleeFighter(sword), false);
  assert.equal(isBladeFighter(sword), false);
  assert.equal(powerupRollWeights(sword).counterSlash, 0);
}

// Morph visual lerps between mode silhouettes (reuses nanotech sword/rifle/sniper palette).
{
  const holder = {
    team: 0,
    adaptiveMode: "sword",
    adaptiveMorphing: true,
    adaptiveMorphFrom: "sword",
    adaptiveMorphTo: "rifle",
    adaptiveMorphT: 0.5
  };
  const mid = weaponVisual(ADAPTIVE_NANOTECH_ID, holder);
  const sword = ADAPTIVE_MODE_DEFS.sword.visual;
  const rifle = ADAPTIVE_MODE_DEFS.rifle.visual;
  assert.ok(mid.length > Math.min(sword.length, rifle.length));
  assert.ok(mid.length < Math.max(sword.length, rifle.length));
  assert.equal(mid.morphing, true);
}

// Shop row: catalog stays near the front of the weapon list, near other nanotech gear.
{
  const weapons = GEAR.filter((item) => item.slot === "weapon");
  assert.ok(weapons.some((item) => item.id === ADAPTIVE_NANOTECH_ID));
}

console.log("Adaptive Nanotech Unit suite passed.");
