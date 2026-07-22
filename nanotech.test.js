import assert from "node:assert/strict";
import { attack, Fighter } from "./combat.js";
import {
  applyHpDamage, applyLoadout, applyNanotechSlashBotLoss, canNanotechAttack,
  DEFAULT_LOADOUT, GEAR_BY_ID, hasNanotechChestplate, nanotechArmorHp,
  nanotechArmorMaxHp, nanotechCostOf, nanotechFormPct, nanotechPoolCapacity,
  NANOTECH_ARMOR_BOT_CAP, NANOTECH_BOTS_PER_HP, NANOTECH_CHANNEL_RATE,
  NANOTECH_SLOW_REGEN, PRECISION_AIM_WEAPONS, setNanotechChanneling, STARTER_GEAR,
  tickNanotech, tryFormNanotechWeapon, weaponStats
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
    150
  );
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

// Channel moves free→armor without stealing weapon bots; 2 bots = 1 HP.
{
  const fighter = applyLoadout(new Fighter({}), loadout({
    body: "nanotech-chestplate",
    weapon: "nanotech-sword"
  }));
  assert.equal(fighter.nanobotWeapon, 100);
  assert.equal(fighter.nanobotFree, 500);
  assert.equal(setNanotechChanneling(fighter, true), true);
  assert.equal(fighter.nanotechChanneling, true);
  tickNanotech(fighter, 1);
  // After 1s: free was 500, room = max - weapon = 500 → armor gets 500.
  assert.equal(fighter.nanobotArmor, 500);
  assert.equal(fighter.nanobotFree, 0);
  assert.equal(fighter.nanobotWeapon, 100);
  assert.equal(nanotechArmorHp(fighter), Math.floor(
    Math.min(500, NANOTECH_ARMOR_BOT_CAP) / NANOTECH_BOTS_PER_HP
  ));

  // Loan remaining free into armor; HP still caps at 500 bots / 250 HP.
  fighter.nanobotFree = 600;
  fighter.nanobotArmor = 0;
  fighter.nanobotWeapon = 0;
  setNanotechChanneling(fighter, true);
  for (let i = 0; i < 20; i++) tickNanotech(fighter, 1);
  assert.equal(fighter.nanobotArmor, 600);
  assert.equal(fighter.nanobotFree, 0);
  assert.equal(nanotechArmorHp(fighter), Math.floor(NANOTECH_ARMOR_BOT_CAP / 2));
  assert.equal(nanotechArmorMaxHp(fighter), Math.floor(NANOTECH_ARMOR_BOT_CAP / 2));
  setNanotechChanneling(fighter, false);
  assert.equal(fighter.nanotechChanneling, false);
}

// E forms weapon (partial OK); attack needs committed bots; damage scales.
{
  const fighter = applyLoadout(new Fighter({
    x: 100, y: 400, team: 0, aim: 0
  }), loadout({ weapon: "nanotech-rifle", jetpack: "nanotech-reserve" }));
  assert.equal(fighter.nanobotMax, 1150);
  assert.equal(fighter.nanobotWeapon, 150);
  fighter.nanobotWeapon = 0;
  fighter.nanobotFree = 149;
  assert.equal(canNanotechAttack(fighter), false);
  const game = { bullets: [], effects: [], fighters: [fighter] };
  attack(fighter, game);
  assert.equal(game.bullets.length, 0);

  const formed = tryFormNanotechWeapon(fighter);
  assert.equal(formed.ok, true);
  assert.equal(formed.fullyFormed, false);
  assert.equal(fighter.nanobotWeapon, 149);
  assert.equal(fighter.nanobotFree, 0);
  assert.ok(Math.abs(nanotechFormPct(fighter) - 149 / 150) < 1e-9);
  assert.equal(canNanotechAttack(fighter), true);
  attack(fighter, game);
  assert.equal(game.bullets.length, 1);
  assert.ok(Math.abs(game.bullets[0].damage - fighter.weaponBaseDamage * (149 / 150)) < 1e-6);

  // Slow regen fills unused pool capacity; does not pull from armor or weapon.
  fighter.nanobotArmor = 40;
  fighter.nanobotFree = 100;
  fighter.nanobotWeapon = 100;
  const freeBefore = fighter.nanobotFree;
  tickNanotech(fighter, 2);
  assert.ok(fighter.nanobotFree > freeBefore);
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
  // Full form does not bleed.
  fighter.nanobotWeapon = 100;
  fighter.attackCd = 0;
  applyNanotechSlashBotLoss(fighter);
  assert.equal(fighter.nanobotWeapon, 100);
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
  // applyLoadout already synced; re-tick to refresh display after manual bot edits.
  tickNanotech(fighter, 0);
}

// setNanotechChanneling only works with chestplate.
{
  const plain = applyLoadout(new Fighter({}), loadout());
  assert.equal(setNanotechChanneling(plain, true), false);
  assert.equal(plain.nanotechChanneling, false);

  const chest = applyLoadout(new Fighter({}), loadout({ body: "nanotech-chestplate" }));
  assert.equal(setNanotechChanneling(chest, true), true);
  assert.equal(setNanotechChanneling(chest, false), true);
  assert.equal(chest.nanotechChanneling, false);
}

// Armor spawn is a quick Mark-85 snap; sword visibility tracks committed weapon bots.
{
  const {
    NANOTECH_ARMOR_SPAWN_DURATION, NANOTECH_SWORD_DISSOLVE_DURATION,
    NANOTECH_RECALL_RATE, nanotechSwordHidden, nanotechSwordVisibility
  } = await import("./equipment.js");
  assert.ok(NANOTECH_ARMOR_SPAWN_DURATION > 0 && NANOTECH_ARMOR_SPAWN_DURATION <= 0.3);
  assert.ok(NANOTECH_SWORD_DISSOLVE_DURATION > 0 && NANOTECH_SWORD_DISSOLVE_DURATION <= 0.25);
  assert.ok(NANOTECH_RECALL_RATE >= NANOTECH_CHANNEL_RATE);

  const fighter = applyLoadout(new Fighter({}), loadout({
    body: "nanotech-chestplate",
    weapon: "nanotech-sword"
  }));
  assert.equal(nanotechSwordHidden(fighter), false);
  assert.equal(fighter.nanobotWeapon, 100);
  assert.equal(fighter.nanobotFree, 500);
  assert.equal(setNanotechChanneling(fighter, true), true);
  assert.equal(fighter.nanotechArmorSpawning, true);

  // Channeling can drain free to 0 without dissolving the formed sword.
  for (let i = 0; i < 30; i++) tickNanotech(fighter, 0.05);
  assert.ok(fighter.nanobotArmor > 0);
  assert.equal(fighter.nanobotFree, 0);
  assert.equal(fighter.nanobotWeapon, 100);
  assert.equal(nanotechSwordHidden(fighter), false, "formed sword survives channel");

  // Dump weapon bots → dissolve; E reforms from recalled free.
  fighter.nanobotWeapon = 0;
  for (let i = 0; i < 20; i++) tickNanotech(fighter, 0.05);
  assert.equal(nanotechSwordHidden(fighter), true, "sword gone when weapon bots = 0");

  setNanotechChanneling(fighter, false);
  for (let i = 0; i < 40; i++) tickNanotech(fighter, 0.05);
  assert.equal(fighter.nanobotArmor, 0, "armor returns to reserve");
  assert.ok(fighter.nanobotFree >= 100);
  const reform = tryFormNanotechWeapon(fighter);
  assert.equal(reform.ok, true);
  assert.equal(reform.fullyFormed, true);
  for (let i = 0; i < 20; i++) tickNanotech(fighter, 0.05);
  assert.equal(nanotechSwordHidden(fighter), false, "E reforms sword from free");
  assert.ok(nanotechSwordVisibility(fighter) > 0.9);

  const rifle = applyLoadout(new Fighter({}), loadout({
    body: "nanotech-chestplate",
    weapon: "nanotech-rifle"
  }));
  setNanotechChanneling(rifle, true);
  tickNanotech(rifle, 0.1);
  assert.equal(nanotechSwordHidden(rifle), false, "rifle stays visible");
}

// Channel / regen rates are snappy.
{
  assert.equal(NANOTECH_SLOW_REGEN, 55);
  assert.equal(NANOTECH_CHANNEL_RATE, 520);
  assert.equal(NANOTECH_BOTS_PER_HP, 2);
}

console.log("nanotech.test.js: ok");
