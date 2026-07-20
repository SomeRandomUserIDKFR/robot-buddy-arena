import assert from "node:assert/strict";
import { attack, Fighter, hit, stepBullets } from "./combat.js";
import {
  applyLoadout, DEFAULT_LOADOUT, ensureEquipmentProfile, equipOwned,
  purchaseGear, shieldBlocksAttack, shieldSpeedMultiplier, shieldStats,
  toggleShieldRaise
} from "./equipment.js";
import { DEFAULT_PROFILE } from "./config.js";

const clone = (value) => structuredClone(value);
const withShield = (shieldId) => ({ ...DEFAULT_LOADOUT, shield: shieldId });

function makeGame(fighters) {
  return {
    fighters,
    bullets: [],
    effects: [],
    pings: [],
    elapsed: 0,
    mode: "conquest",
    stats: {},
    lastShotAtPlayer: -99
  };
}

// Catalog bands stay meaningful vs ~500 HP / ~100 DPS weapons.
{
  const light = shieldStats("light-buckler");
  const mid = shieldStats("kinetic-targe");
  const heavy = shieldStats("bastion-bulwark");
  assert.ok(light.durability >= 150 && light.durability <= 200);
  assert.ok(mid.durability >= 280 && mid.durability <= 350);
  assert.ok(heavy.durability >= 450 && heavy.durability <= 550);
  assert.ok(light.blockHalfAngle >= 1.2 && light.blockHalfAngle <= 1.6);
  assert.ok(heavy.brokenSpeed < mid.brokenSpeed);
  assert.ok(mid.brokenSpeed < light.brokenSpeed);
}

// Q-style toggle switches raised state; no-shield and broken cannot raise.
{
  const fighter = applyLoadout(new Fighter({}), withShield("light-buckler"));
  assert.equal(fighter.shieldRaised, false);
  assert.equal(toggleShieldRaise(fighter), true);
  assert.equal(fighter.shieldRaised, true);
  assert.equal(toggleShieldRaise(fighter), true);
  assert.equal(fighter.shieldRaised, false);

  const bare = applyLoadout(new Fighter({}), withShield("no-shield"));
  assert.equal(toggleShieldRaise(bare), false);

  fighter.shieldBroken = true;
  fighter.shieldDurability = 0;
  fighter.shieldRaised = true;
  assert.equal(toggleShieldRaise(fighter), false);
  assert.equal(fighter.shieldRaised, false);
}

// Front-arc blocks; rear hits deal full damage.
{
  const defender = applyLoadout(new Fighter({
    x: 400, y: 400, team: 0, aim: 0
  }), withShield("light-buckler"));
  const attacker = applyLoadout(new Fighter({
    x: 520, y: 400, team: 1, aim: Math.PI
  }), DEFAULT_LOADOUT);
  defender.shieldRaised = true;
  const game = makeGame([defender, attacker]);
  const max = defender.shieldDurability;

  assert.equal(shieldBlocksAttack(defender, Math.PI), true);
  assert.equal(shieldBlocksAttack(defender, 0), false);

  hit(defender, attacker, 40, Math.PI, game);
  assert.equal(defender.hp, defender.maxHp);
  assert.equal(defender.shieldDurability, max - 40);
  assert.ok(game.effects.some((effect) => effect.type === "shield"));

  const hpBefore = defender.hp;
  const durBefore = defender.shieldDurability;
  hit(defender, attacker, 25, 0, game);
  assert.equal(defender.shieldDurability, durBefore);
  assert.equal(defender.hp, hpBefore - 25);
}

// Melee swings also honor the frontal cone.
{
  const target = applyLoadout(new Fighter({
    x: 200, y: 400, team: 0, aim: 0
  }), withShield("kinetic-targe"));
  const swinger = applyLoadout(new Fighter({
    x: 280, y: 400, team: 1, aim: Math.PI
  }), { ...DEFAULT_LOADOUT, weapon: "arc-saber" });
  target.shieldRaised = true;
  const game = makeGame([target, swinger]);
  attack(swinger, game, () => .5);
  assert.equal(target.hp, target.maxHp);
  assert.ok(target.shieldDurability < target.shieldMaxDurability);
}

// Raised shield prevents firing; durability depletes then breaks with speed penalty.
{
  const fighter = applyLoadout(new Fighter({
    x: 100, y: 100, team: 0, aim: 0
  }), withShield("light-buckler"));
  fighter.shieldRaised = true;
  const game = makeGame([fighter]);
  attack(fighter, game, () => .5);
  assert.equal(game.bullets.length, 0);

  const foe = applyLoadout(new Fighter({ x: 200, y: 100, team: 1 }), DEFAULT_LOADOUT);
  game.fighters.push(foe);
  hit(fighter, foe, fighter.shieldDurability + 30, Math.PI, game);
  assert.equal(fighter.shieldDurability, 0);
  assert.equal(fighter.shieldBroken, true);
  assert.equal(fighter.shieldRaised, false);
  assert.equal(fighter.hp, fighter.maxHp - 30);
  assert.equal(shieldSpeedMultiplier(fighter), fighter.shieldBrokenSpeed);
  assert.equal(shieldBlocksAttack(fighter, Math.PI), false);
}

// Durability does not refill mid-match; applyLoadout resets for a new match.
{
  const first = applyLoadout(new Fighter({}), withShield("kinetic-targe"));
  first.shieldDurability = 40;
  assert.equal(first.shieldDurability, 40);
  const next = applyLoadout(first, withShield("kinetic-targe"));
  assert.equal(next.shieldDurability, next.shieldMaxDurability);
  assert.equal(next.shieldBroken, false);
  assert.equal(next.shieldRaised, false);
}

// Shop purchase/equip and migration for missing shield slot.
{
  const profile = clone(DEFAULT_PROFILE);
  ensureEquipmentProfile(profile, profile);
  assert.equal(profile.equipment.player.shield, "no-shield");
  assert.ok(profile.equipment.owned.includes("no-shield"));
  assert.ok(profile.equipment.owned.includes("light-buckler"));

  profile.cyber = 200;
  const bought = purchaseGear(profile, "bastion-bulwark");
  assert.equal(bought.ok, true);
  assert.equal(equipOwned(profile, "player", "shield", "bastion-bulwark"), true);
  assert.equal(profile.equipment.player.shield, "bastion-bulwark");

  globalThis.localStorage = { getItem: () => null, setItem: () => {} };
  const { migrateProfile } = await import("./storage.js");
  const old = {
    botName: "Pixel",
    matches: 1,
    cyber: 50,
    playerWeapon: "gun",
    equipment: {
      owned: ["field-frame", "survey-visor", "pulse-rifle", "vector-pack"],
      player: {
        body: "field-frame", helmet: "survey-visor",
        weapon: "pulse-rifle", jetpack: "vector-pack"
      },
      buddy: {
        body: "field-frame", helmet: "survey-visor",
        weapon: "pulse-rifle", jetpack: "vector-pack"
      },
      buddyMode: "user"
    },
    weapons: clone(DEFAULT_PROFILE.weapons),
    coaching: clone(DEFAULT_PROFILE.coaching)
  };
  const migrated = migrateProfile(old);
  assert.equal(migrated.equipment.player.shield, "no-shield");
  assert.ok(migrated.equipment.owned.includes("no-shield"));
  assert.ok(migrated.equipment.owned.includes("light-buckler"));
}

// Raised speed penalty is lighter than broken weight.
{
  const fighter = applyLoadout(new Fighter({}), withShield("bastion-bulwark"));
  assert.equal(shieldSpeedMultiplier(fighter), 1);
  fighter.shieldRaised = true;
  assert.equal(shieldSpeedMultiplier(fighter), fighter.shieldRaisedSpeed);
  fighter.shieldBroken = true;
  assert.equal(shieldSpeedMultiplier(fighter), fighter.shieldBrokenSpeed);
}

// Frontal bullet travel is blocked when aim faces the incoming shot.
{
  const target = applyLoadout(new Fighter({
    x: 400, y: 400, team: 0, aim: Math.PI
  }), withShield("light-buckler"));
  const shooter = applyLoadout(new Fighter({
    x: 100, y: 400, team: 1
  }), DEFAULT_LOADOUT);
  target.shieldRaised = true;
  const game = makeGame([target, shooter]);
  const before = target.shieldDurability;
  game.bullets.push({
    x: 390, y: 423, px: 350, py: 423,
    vx: 800, vy: 0, owner: shooter, life: 1, traveled: 50,
    damage: 12, dropoff: null
  });
  stepBullets(game, 0.05);
  assert.equal(target.hp, target.maxHp);
  assert.equal(target.shieldDurability, before - 12);
}

console.log("Shield suite passed.");
