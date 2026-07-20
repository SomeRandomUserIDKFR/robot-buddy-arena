import assert from "node:assert/strict";
import { attack, Fighter } from "./combat.js";
import {
  applyLoadout, beginModularMorph, cycleModularMode, DEFAULT_LOADOUT,
  GEAR_BY_ID, MODULAR_MODE_COOLDOWN, MODULAR_MODE_DEFS, MODULAR_MORPH_DURATION,
  modularAttackLocked, nextModularMode, shieldStats, theoreticalDps, tickModularWeapon,
  weaponStats
} from "./equipment.js";
import { isBladeFighter, isMeleeFighter, powerupRollWeights } from "./powerups.js";
import { weaponVisual } from "./rendering.js";

const loadout = (weapon = "mechanical-modularity", shield = "no-shield") => ({
  ...DEFAULT_LOADOUT, weapon, shield
});

function finishMorph(fighter) {
  tickModularWeapon(fighter, MODULAR_MORPH_DURATION + 0.01);
  assert.equal(fighter.modularMorphing, false);
}

// Catalog: purchasable hybrid with saber default (save-safe baseKind).
{
  const gear = GEAR_BY_ID["mechanical-modularity"];
  assert.ok(gear);
  assert.equal(gear.slot, "weapon");
  assert.equal(gear.baseKind, "saber");
  assert.equal(gear.modular, true);
  assert.ok(Number.isInteger(gear.price) && gear.price > 0);
  assert.match(gear.tradeoff, /E morph|morph/i);
}

// Sword mode matches Arc Saber combat stats / DPS / reach / RPM.
{
  const saber = weaponStats("arc-saber");
  const modular = applyLoadout(new Fighter({}), loadout());
  assert.equal(modular.modularMode, "sword");
  assert.equal(modular.weapon, "saber");
  assert.equal(modular.weaponBaseDamage, saber.baseDamage);
  assert.equal(modular.weaponRpm, saber.rpm);
  assert.equal(modular.weaponReach, saber.range);
  assert.equal(theoreticalDps("mechanical-modularity"), theoreticalDps("arc-saber"));
  assert.equal(modular.moveSpeed, applyLoadout(new Fighter({}), {
    ...DEFAULT_LOADOUT, weapon: "arc-saber"
  }).moveSpeed);
}

// Rifle / shield plate are slightly weaker than dedicated baselines.
{
  const pulse = weaponStats("pulse-rifle");
  const rifleDef = MODULAR_MODE_DEFS.rifle.weaponStats;
  assert.ok(rifleDef.baseDamage < pulse.baseDamage);
  assert.ok(rifleDef.rpm < pulse.rpm);
  assert.ok(rifleDef.range < pulse.range);
  const dpsRatio = (rifleDef.baseDamage * rifleDef.rpm) / (pulse.baseDamage * pulse.rpm);
  assert.ok(dpsRatio >= 0.88 && dpsRatio <= 0.96, `rifle DPS ratio ${dpsRatio}`);

  const buckler = shieldStats("light-buckler");
  const plate = MODULAR_MODE_DEFS.shield.shield;
  assert.ok(plate.durability < buckler.durability);
  assert.ok(plate.blockHalfAngle < buckler.blockHalfAngle);
  assert.ok(plate.raisedSpeed <= buckler.raisedSpeed);
}

// E-cycle order Sword → Shield → Rifle → Sword with morph lockout + cooldown.
{
  const fighter = applyLoadout(new Fighter({ team: 0 }), loadout());
  assert.equal(nextModularMode("sword"), "shield");
  assert.equal(nextModularMode("shield"), "rifle");
  assert.equal(nextModularMode("rifle"), "sword");

  assert.equal(cycleModularMode(fighter), true);
  assert.equal(fighter.modularMorphing, true);
  assert.equal(modularAttackLocked(fighter), true);
  const game = { bullets: [], effects: [], fighters: [fighter], stats: {}, mode: "conquest" };
  fighter.attackCd = 0;
  attack(fighter, game, () => .5);
  assert.equal(game.bullets.length, 0);
  assert.equal(game.effects.filter((e) => e.type === "saber").length, 0);

  // Cannot start another morph mid-transform.
  assert.equal(beginModularMorph(fighter, "rifle"), false);
  finishMorph(fighter);
  assert.equal(fighter.modularMode, "shield");
  assert.ok(fighter.shieldMaxDurability > 0);
  assert.equal(modularAttackLocked(fighter), true);

  // Cooldown blocks immediate re-cycle.
  assert.equal(cycleModularMode(fighter), false);
  fighter.modularModeCd = 0;
  assert.equal(cycleModularMode(fighter), true);
  finishMorph(fighter);
  assert.equal(fighter.modularMode, "rifle");
  assert.equal(fighter.weapon, "gun");
  assert.ok(fighter.weaponBaseDamage < weaponStats("pulse-rifle").baseDamage);

  fighter.modularModeCd = 0;
  assert.equal(cycleModularMode(fighter), true);
  finishMorph(fighter);
  assert.equal(fighter.modularMode, "sword");
  assert.equal(fighter.weapon, "saber");
  assert.ok(fighter.modularModeCd >= MODULAR_MODE_COOLDOWN - 0.001);
}

// Dedicated shield restores after leaving modular plate mode.
{
  const fighter = applyLoadout(
    new Fighter({}),
    loadout("mechanical-modularity", "kinetic-targe")
  );
  const dedicatedMax = fighter.shieldMaxDurability;
  assert.ok(dedicatedMax > 200);
  fighter.modularModeCd = 0;
  beginModularMorph(fighter, "shield");
  finishMorph(fighter);
  assert.ok(fighter.shieldMaxDurability < dedicatedMax);
  fighter.shieldDurability = fighter.shieldMaxDurability * 0.4;
  fighter.modularModeCd = 0;
  beginModularMorph(fighter, "sword");
  finishMorph(fighter);
  assert.equal(fighter.shieldMaxDurability, dedicatedMax);
  assert.ok(Math.abs(fighter.modularPlateDurability / fighter.modularPlateMax - 0.4) < 0.02);
}

// Counter-slash / blade loot: sword only.
{
  const sword = applyLoadout(new Fighter({}), loadout());
  assert.equal(isMeleeFighter(sword), true);
  assert.equal(isBladeFighter(sword), true);
  assert.ok(powerupRollWeights(sword).counterSlash > 0);

  sword.modularModeCd = 0;
  beginModularMorph(sword, "rifle");
  finishMorph(sword);
  assert.equal(isMeleeFighter(sword), false);
  assert.equal(isBladeFighter(sword), false);
  assert.equal(powerupRollWeights(sword).counterSlash, 0);

  sword.modularModeCd = 0;
  beginModularMorph(sword, "shield");
  finishMorph(sword);
  assert.equal(isMeleeFighter(sword), false);
  assert.equal(powerupRollWeights(sword).counterSlash, 0);
}

// Morph visual lerps between mode silhouettes.
{
  const holder = {
    team: 0,
    modularMode: "sword",
    modularMorphing: true,
    modularMorphFrom: "sword",
    modularMorphTo: "rifle",
    modularMorphT: 0.5
  };
  const mid = weaponVisual("mechanical-modularity", holder);
  const sword = MODULAR_MODE_DEFS.sword.visual;
  const rifle = MODULAR_MODE_DEFS.rifle.visual;
  assert.ok(mid.length > Math.min(sword.length, rifle.length));
  assert.ok(mid.length < Math.max(sword.length, rifle.length));
  assert.equal(mid.morphing, true);
}

console.log("Mechanical Modularity suite passed.");
