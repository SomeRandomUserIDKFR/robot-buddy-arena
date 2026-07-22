import assert from "node:assert/strict";
import { attack, Fighter } from "./combat.js";
import {
  applyHpDamage, applyLoadout, applyNanotechSlashBotLoss, beginNanotechWeaponAbsorb,
  canNanotechAttack, DEFAULT_LOADOUT, GEAR_BY_ID, hasNanotechChestplate, nanotechArmorHp,
  nanotechArmorMaxHp, nanotechCostOf, nanotechFormCostOf, nanotechFormPct, nanotechPoolCapacity,
  NANOTECH_ARMOR_BOT_CAP, NANOTECH_ARMOR_PRESS, NANOTECH_BOTS_PER_HP, NANOTECH_CHANNEL_RATE,
  NANOTECH_SLOW_REGEN, PRECISION_AIM_WEAPONS, pulseNanotechArmor, setNanotechChanneling,
  STARTER_GEAR, tickNanotech, tryFormNanotechWeapon, tryNanotechWeaponAction, weaponStats
} from "./equipment.js";

const loadout = (overrides = {}) => ({ ...DEFAULT_LOADOUT, ...overrides });

function assertWeaponStatsMatch(a, b) {
  const sa = weaponStats(a);
  const sb = weaponStats(b);
  for (const key of Object.keys(sb)) {
    assert.deepEqual(sa[key], sb[key], `${a}.${key}`);
  }
}

// Catalog: nanotech weapons match counterparts; tagged with nanotech + cost.
{
  assertWeaponStatsMatch("nanotech-sword", "arc-saber");
  assertWeaponStatsMatch("nanotech-rifle", "pulse-rifle");
  assertWeaponStatsMatch("nanotech-sniper", "classic-sniper");
  for (const id of [
    "nanotech-sword", "nanotech-rifle", "nanotech-sniper",
    "nanotech-chestplate", "nanotech-reserve"
  ]) {
    const gear = GEAR_BY_ID[id];
    assert.equal(gear.nanotech, true);
    assert.ok(gear.nanobotCost > 0);
    assert.equal(nanotechCostOf(id), gear.nanobotCost);
    assert.ok(!STARTER_GEAR.includes(id));
  }
  assert.ok(PRECISION_AIM_WEAPONS.includes("nanotech-sniper"));
  assert.equal(GEAR_BY_ID["nanotech-chestplate"].modifiers.damageTaken, 0.9);
  assert.equal(GEAR_BY_ID["nanotech-reserve"].modifiers.speed, 0.95);
}

// Pool capacity sums equipped nanotech costs.
{
  assert.equal(nanotechPoolCapacity(loadout()), 0);
  assert.equal(
    nanotechPoolCapacity(loadout({ weapon: "nanotech-rifle" })),
    180
  );
  assert.equal(nanotechFormCostOf("nanotech-rifle"), 150);
  assert.equal(nanotechFormCostOf("nanotech-sniper"), 175);
  assert.equal(nanotechFormCostOf("nanotech-sword"), 100);
  assert.equal(
    nanotechPoolCapacity(loadout({
      body: "nanotech-chestplate",
      weapon: "nanotech-sword",
      jetpack: "nanotech-reserve"
    })),
    500 + 100 + 1000
  );
}

// applyLoadout seeds pool and auto-forms the weapon when reserve allows.
{
  const fighter = applyLoadout(new Fighter({}), loadout({
    body: "nanotech-chestplate",
    weapon: "nanotech-sword",
    jetpack: "nanotech-reserve"
  }));
  assert.equal(fighter.nanobotMax, 1600);
  assert.equal(fighter.nanobotWeapon, 100);
  assert.equal(fighter.nanobotFree, 1500);
  assert.equal(fighter.nanobotArmor, 0);
  assert.equal(fighter.nanotechChanneling, false);
  assert.equal(fighter.nanotechWeaponCost, 100);
  assert.equal(nanotechFormPct(fighter), 1);
  assert.equal(fighter.hasNanotechChestplate, true);
  assert.equal(fighter.forceNanotechMorph, true);
  assert.equal(fighter.damageTaken, 0.9);
  assert.equal(fighter.moveSpeed, Math.round(520 * 0.95 * 1.1));
  assert.equal(hasNanotechChestplate(fighter), true);
}

// Tap F pulses +100; hold F recalls armor→free at RECALL_RATE; release stops recall.
{
  const fighter = applyLoadout(new Fighter({}), loadout({
    body: "nanotech-chestplate",
    weapon: "nanotech-sword"
  }));
  assert.equal(fighter.nanobotWeapon, 100);
  assert.equal(fighter.nanobotFree, 500);

  const pulse = pulseNanotechArmor(fighter);
  assert.equal(pulse.ok, true);
  assert.equal(pulse.pulled, NANOTECH_ARMOR_PRESS);
  assert.equal(fighter.nanobotArmor, 100);
  assert.equal(fighter.nanobotFree, 400);
  assert.equal(fighter.nanobotWeapon, 100);

  assert.equal(setNanotechChanneling(fighter, true), true);
  tickNanotech(fighter, 1);
  assert.equal(fighter.nanobotArmor, 100 - NANOTECH_CHANNEL_RATE);
  assert.equal(fighter.nanobotFree, 400 + NANOTECH_CHANNEL_RATE);
  assert.equal(fighter.nanobotWeapon, 100);

  setNanotechChanneling(fighter, false);
  const armorAfterRelease = fighter.nanobotArmor;
  const freeAfterRelease = fighter.nanobotFree;
  tickNanotech(fighter, 1);
  assert.equal(fighter.nanobotArmor, armorAfterRelease, "armor sticks when not holding");
  assert.equal(fighter.nanobotFree, freeAfterRelease);
  assert.equal(nanotechArmorHp(fighter), Math.floor(
    Math.min(armorAfterRelease, NANOTECH_ARMOR_BOT_CAP) / NANOTECH_BOTS_PER_HP
  ));

  // Hold can empty armor back into reserve.
  fighter.nanobotArmor = 50;
  fighter.nanobotFree = 0;
  setNanotechChanneling(fighter, true);
  for (let i = 0; i < 5; i++) tickNanotech(fighter, 1);
  assert.equal(fighter.nanobotArmor, 0);
  assert.equal(fighter.nanobotFree, 50);
  assert.equal(nanotechArmorMaxHp(fighter), Math.floor(NANOTECH_ARMOR_BOT_CAP / 2));
}

// E forms the gun body; shots withdraw ammo from free reserve; E absorbs guns too.
{
  const fighter = applyLoadout(new Fighter({
    x: 100, y: 400, team: 0, aim: 0
  }), loadout({ weapon: "nanotech-rifle", jetpack: "nanotech-reserve" }));
  assert.equal(fighter.nanobotMax, 1180);
  assert.equal(fighter.nanotechWeaponCost, 150, "gun body form/absorb cost");
  assert.equal(fighter.nanobotWeapon, 150, "150 bots are the gun body");
  assert.equal(fighter.nanobotFree, 1030, "+30 pool bots stay free for ammo");
  assert.equal(fighter.nanobotShotCost, 2);
  const game = { bullets: [], effects: [], fighters: [fighter] };
  attack(fighter, game);
  assert.equal(game.bullets.length, 1);
  assert.equal(fighter.nanobotWeapon, 150, "gun body unchanged by shots");
  assert.equal(fighter.nanobotFree, 1028, "ammo pulled from free reserve");

  fighter.nanobotFree = 1;
  fighter.attackCd = 0;
  assert.equal(canNanotechAttack(fighter), false, "need 2 free bots to fire");
  attack(fighter, game);
  assert.equal(game.bullets.length, 1);
  assert.equal(fighter.nanobotWeapon, 150);

  fighter.nanobotWeapon = 0;
  fighter.nanobotFree = 100;
  assert.equal(canNanotechAttack(fighter), false, "need formed gun");

  fighter.nanobotWeapon = 100;
  fighter.nanobotFree = 20;
  assert.equal(canNanotechAttack(fighter), true);
  fighter.attackCd = 0;
  attack(fighter, game);
  assert.equal(game.bullets.length, 2);
  assert.equal(fighter.nanobotWeapon, 100);
  assert.equal(fighter.nanobotFree, 18);

  const sniper = applyLoadout(new Fighter({
    x: 100, y: 400, team: 0, aim: 0
  }), loadout({ weapon: "nanotech-sniper", jetpack: "nanotech-reserve" }));
  assert.equal(sniper.nanobotShotCost, 20);
  assert.equal(sniper.nanotechWeaponCost, 175);
  assert.equal(sniper.nanobotWeapon, 175);
  assert.equal(sniper.nanobotFree, 1000 + 20, "+20 pool bots for one sniper shot");
  const freeBefore = sniper.nanobotFree;
  const sniperGame = { bullets: [], effects: [], fighters: [sniper] };
  attack(sniper, sniperGame);
  assert.equal(sniperGame.bullets.length, 1);
  assert.equal(sniper.nanobotWeapon, 175, "sniper body intact");
  assert.equal(sniper.nanobotFree, freeBefore - 20);

  // E absorbs only the gun body (175), not the whole pool contribution.
  const absorb = tryNanotechWeaponAction(sniper);
  assert.equal(absorb.ok, true);
  assert.equal(absorb.absorbing, true);
  for (let i = 0; i < 30; i++) tickNanotech(sniper, 0.05);
  assert.equal(sniper.nanobotWeapon, 0);
  assert.equal(sniper.nanotechWeaponAbsorbing, false);
  assert.ok(sniper.nanobotFree >= freeBefore - 20 + 175);

  // Slow regen fills unused pool capacity; does not pull from armor or weapon.
  fighter.nanobotArmor = 40;
  fighter.nanobotFree = 100;
  fighter.nanobotWeapon = 100;
  const regenBefore = fighter.nanobotFree;
  tickNanotech(fighter, 2);
  assert.ok(fighter.nanobotFree > regenBefore);
  assert.equal(fighter.nanobotArmor, 40);
  assert.equal(fighter.nanobotWeapon, 100);
}

// Incomplete sword slash bleeds 2% of full bot cost.
{
  const fighter = applyLoadout(new Fighter({
    x: 100, y: 400, team: 0, aim: 0
  }), loadout({ weapon: "nanotech-sword" }));
  fighter.nanobotWeapon = 50;
  fighter.nanobotFree = 0;
  assert.equal(nanotechFormPct(fighter), 0.5);
  const foe = new Fighter({ x: 150, y: 400, team: 1 });
  const game = { bullets: [], effects: [], fighters: [fighter, foe] };
  attack(fighter, game);
  assert.equal(fighter.nanobotWeapon, 48);
  fighter.nanobotWeapon = 100;
  fighter.attackCd = 0;
  applyNanotechSlashBotLoss(fighter);
  assert.equal(fighter.nanobotWeapon, 100);
}

// E absorbs a formed sword back into free reserve with a drain animation.
{
  const {
    NANOTECH_SWORD_ABSORB_DURATION, nanotechSwordHidden, nanotechSwordVisibility
  } = await import("./equipment.js");
  assert.ok(NANOTECH_SWORD_ABSORB_DURATION > 0.25);

  const fighter = applyLoadout(new Fighter({}), loadout({
    body: "nanotech-chestplate",
    weapon: "nanotech-sword"
  }));
  assert.equal(fighter.nanobotWeapon, 100);
  assert.equal(fighter.nanobotFree, 500);
  assert.equal(nanotechSwordHidden(fighter), false);

  const absorb = tryNanotechWeaponAction(fighter);
  assert.equal(absorb.ok, true);
  assert.equal(absorb.absorbing, true);
  assert.equal(fighter.nanotechWeaponAbsorbing, true);

  const freeStart = fighter.nanobotFree;
  for (let i = 0; i < 30; i++) tickNanotech(fighter, 0.05);
  assert.equal(fighter.nanotechWeaponAbsorbing, false);
  assert.equal(fighter.nanobotWeapon, 0);
  assert.equal(fighter.nanobotFree, freeStart + 100);
  assert.equal(nanotechSwordHidden(fighter), true);
  assert.ok(nanotechSwordVisibility(fighter) <= 0.02);

  // E forms again from reserve.
  const reform = tryNanotechWeaponAction(fighter);
  assert.equal(reform.ok, true);
  assert.equal(reform.fullyFormed, true);
  assert.equal(fighter.nanobotWeapon, 100);
  for (let i = 0; i < 20; i++) tickNanotech(fighter, 0.05);
  assert.equal(nanotechSwordHidden(fighter), false);

  // Incomplete + free → top up instead of absorb.
  fighter.nanobotWeapon = 40;
  fighter.nanobotFree = 80;
  const top = tryNanotechWeaponAction(fighter);
  assert.equal(top.ok, true);
  assert.equal(fighter.nanobotWeapon, 100);
  assert.equal(fighter.nanobotFree, 20);

  const blocked = beginNanotechWeaponAbsorb(fighter);
  assert.equal(blocked.ok, true);
}

// Nano armor absorbs damage before core (2 bots per HP).
{
  const fighter = applyLoadout(new Fighter({}), loadout({
    body: "nanotech-chestplate",
    weapon: "pulse-rifle"
  }));
  fighter.nanobotFree = 100;
  fighter.nanobotArmor = 100;
  syncDisplay(fighter);
  const coreBefore = fighter.coreHp;
  applyHpDamage(fighter, 20);
  assert.equal(fighter.nanobotArmor, 60);
  assert.equal(fighter.coreHp, coreBefore);
  applyHpDamage(fighter, 40);
  assert.equal(fighter.nanobotArmor, 0);
  assert.equal(fighter.coreHp, coreBefore - 10);
}

function syncDisplay(fighter) {
  tickNanotech(fighter, 0);
}

// setNanotechChanneling / pulse only work with chestplate.
{
  const plain = applyLoadout(new Fighter({}), loadout());
  assert.equal(setNanotechChanneling(plain, true), false);
  assert.equal(pulseNanotechArmor(plain).ok, false);

  const chest = applyLoadout(new Fighter({}), loadout({ body: "nanotech-chestplate" }));
  assert.equal(setNanotechChanneling(chest, true), true);
  assert.equal(setNanotechChanneling(chest, false), true);
  assert.equal(chest.nanotechChanneling, false);
}

// Armor spawn is a quick Mark-85 snap; channeling does not steal weapon bots.
{
  const {
    NANOTECH_ARMOR_SPAWN_DURATION, NANOTECH_SWORD_DISSOLVE_DURATION, nanotechSwordHidden
  } = await import("./equipment.js");
  assert.ok(NANOTECH_ARMOR_SPAWN_DURATION > 0 && NANOTECH_ARMOR_SPAWN_DURATION <= 0.3);
  assert.ok(NANOTECH_SWORD_DISSOLVE_DURATION > 0 && NANOTECH_SWORD_DISSOLVE_DURATION <= 0.25);

  const fighter = applyLoadout(new Fighter({}), loadout({
    body: "nanotech-chestplate",
    weapon: "nanotech-sword"
  }));
  assert.equal(pulseNanotechArmor(fighter).ok, true);
  assert.equal(fighter.nanotechArmorSpawning, true);
  setNanotechChanneling(fighter, true);
  for (let i = 0; i < 30; i++) tickNanotech(fighter, 0.05);
  assert.equal(fighter.nanobotWeapon, 100);
  assert.equal(nanotechSwordHidden(fighter), false, "formed sword survives channel");
}

// Channel / regen rates.
{
  assert.equal(NANOTECH_SLOW_REGEN, 55);
  assert.equal(NANOTECH_CHANNEL_RATE, 50);
  assert.equal(NANOTECH_ARMOR_PRESS, 100);
  assert.equal(NANOTECH_BOTS_PER_HP, 2);
}

console.log("nanotech.test.js: ok");
