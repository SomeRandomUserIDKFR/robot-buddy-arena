import assert from "node:assert/strict";
import { attack, Fighter, hit } from "./combat.js";
import {
  applyLoadout, DEFAULT_LOADOUT, GEAR_BY_ID, SPELLBOOK_ID
} from "./equipment.js";
import {
  bindSpellbookHitter, canLightningChain, castSpellbook, cycleSpellType,
  FIRE_MANA_COST, ICE_DAMAGE, ICE_MANA_COST, ICE_PIN, ICE_SLOW, ICE_SLOW_MULT,
  iceSlowMult, isIcePinned, isMetalBreakable, isSpellbook, LIGHTNING_MANA_COST,
  LIGHTNING_METAL_MULT, SPELL_TYPES, spellManaCost, spellTypeLabel,
  tickSpellbookFighter, tickSpellbookWorld
} from "./spellbook.js";

assert.equal(GEAR_BY_ID[SPELLBOOK_ID].slot, "weapon");
assert.equal(GEAR_BY_ID[SPELLBOOK_ID].spellbook, true);
assert.equal(GEAR_BY_ID[SPELLBOOK_ID].manaMax, 100);
assert.deepEqual([...SPELL_TYPES], ["ice", "fire", "lightning"]);
assert.equal(spellTypeLabel("ice"), "ICE");
assert.equal(spellManaCost("fire"), FIRE_MANA_COST);
assert.equal(spellManaCost("lightning"), LIGHTNING_MANA_COST);
assert.ok(ICE_MANA_COST > 0);
assert.equal(ICE_PIN, 2);
assert.equal(ICE_SLOW, 5);
assert.equal(ICE_SLOW_MULT, 0.45);
assert.ok(LIGHTNING_METAL_MULT > 1);
assert.equal(canLightningChain({ kind: "pipe", destroyed: false }), true);
assert.equal(canLightningChain({ kind: "bush", destroyed: false }), false);
assert.equal(isMetalBreakable({ kind: "pipe" }), true);
assert.equal(isMetalBreakable({ kind: "crate" }), false);
assert.equal(isMetalBreakable({ kind: "powerCrate", powerCrate: true }), true);

bindSpellbookHitter(hit);

function mageAt(x, y, extras = {}) {
  return applyLoadout(new Fighter({
    x, y, team: 0, aim: 0, hp: 500, maxHp: 500, grounded: true, ...extras
  }), {
    ...DEFAULT_LOADOUT,
    weapon: SPELLBOOK_ID,
    shield: "no-shield"
  });
}

{
  const mage = mageAt(400, 700);
  assert.ok(isSpellbook(mage));
  assert.equal(mage.spellType, "ice");
  assert.equal(mage.manaMax, 100);
  assert.equal(mage.mana, 100);
  assert.equal(cycleSpellType(mage), "fire");
  assert.equal(cycleSpellType(mage), "lightning");
  assert.equal(cycleSpellType(mage), "ice");
}

{
  // Ice spike pierces raised shields (unblockable).
  const mage = mageAt(400, 700);
  mage.spellType = "ice";
  mage.mana = 100;
  const victim = applyLoadout(new Fighter({
    x: 520, y: 700, team: 1, aim: Math.PI, hp: 500, maxHp: 500
  }), {
    ...DEFAULT_LOADOUT,
    shield: "kinetic-targe"
  });
  victim.shieldRaised = true;
  victim.shieldBroken = false;
  victim.shieldDurability = victim.shieldMaxDurability;
  const beforeShield = victim.shieldDurability;
  const beforeHp = victim.hp;
  const game = { fighters: [mage, victim], effects: [], props: [], powerCrates: [] };
  assert.ok(castSpellbook(mage, game));
  assert.ok(victim.hp < beforeHp, "ice damages through shield");
  assert.ok(
    Math.abs((beforeHp - victim.hp) - ICE_DAMAGE * (victim.damageTaken || 1)) < 0.05,
    "ice deals full listed damage"
  );
  assert.equal(victim.shieldDurability, beforeShield, "ice does not chip shield");
  assert.ok(isIcePinned(victim));
  assert.equal(victim.icePinT, ICE_PIN);
  assert.ok(game.effects.some((e) => e.type === "iceSpike"));
}

{
  // After pin melts, slow applies (same tick also decays slow by dt).
  const victim = new Fighter({ x: 0, y: 0, team: 1, hp: 100, maxHp: 100 });
  victim.icePinT = 0.05;
  tickSpellbookFighter(victim, 0.06);
  assert.equal(isIcePinned(victim), false);
  assert.ok(victim.iceSlowT > ICE_SLOW - 0.1);
  assert.equal(iceSlowMult(victim), ICE_SLOW_MULT);
}

{
  // Fire ignites nearby breakables and spreads.
  const mage = mageAt(400, 700);
  mage.spellType = "fire";
  mage.mana = 100;
  const propA = {
    x: 450, y: 680, w: 40, h: 40, kind: "crate", breakable: true, hp: 80, maxHp: 80
  };
  const propB = {
    x: 520, y: 680, w: 40, h: 40, kind: "crate", breakable: true, hp: 80, maxHp: 80
  };
  const game = {
    fighters: [mage],
    effects: [],
    props: [propA, propB],
    powerCrates: [],
    spellFires: []
  };
  assert.ok(castSpellbook(mage, game));
  assert.ok(propA.spellBurning || (game.spellFires || []).some((f) => f.prop === propA));
  // Force spread tick.
  const fire = (game.spellFires || []).find((f) => f.prop === propA);
  assert.ok(fire);
  fire.spreadCd = 0;
  fire.life = 3;
  tickSpellbookWorld(game, 0.02);
  assert.ok(
    propB.spellBurning || (game.spellFires || []).some((f) => f.prop === propB),
    "fire spreads to nearby breakable"
  );
}

{
  // Lightning hits metal harder than wood.
  const mage = mageAt(400, 700);
  mage.spellType = "lightning";
  mage.mana = 100;
  const wood = {
    x: 520, y: 680, w: 36, h: 36, kind: "crate", breakable: true, hp: 200, maxHp: 200
  };
  const metal = {
    x: 520, y: 680, w: 36, h: 36, kind: "pipe", breakable: true, hp: 200, maxHp: 200
  };
  const gameWood = {
    fighters: [mage], effects: [], props: [wood], powerCrates: [], spellFires: []
  };
  castSpellbook(mage, gameWood);
  const woodDmg = 200 - wood.hp;
  mage.mana = 100;
  mage.attackCd = 0;
  const gameMetal = {
    fighters: [mage], effects: [], props: [metal], powerCrates: [], spellFires: []
  };
  castSpellbook(mage, gameMetal);
  const metalDmg = 200 - metal.hp;
  assert.ok(woodDmg > 0);
  assert.ok(metalDmg > woodDmg);
  assert.ok(Math.abs(metalDmg / woodDmg - LIGHTNING_METAL_MULT) < 0.05);
}

{
  // Out of mana blocks cast; regen restores.
  const mage = mageAt(400, 700);
  mage.mana = ICE_MANA_COST - 1;
  const game = { fighters: [mage], effects: [], props: [], powerCrates: [] };
  assert.equal(castSpellbook(mage, game), false);
  tickSpellbookFighter(mage, 2);
  assert.ok(mage.mana >= ICE_MANA_COST);
  assert.ok(castSpellbook(mage, game));
}

{
  // attack() routes through spellbook.
  const mage = mageAt(400, 700);
  mage.spellType = "ice";
  mage.mana = 100;
  mage.attackCd = 0;
  const game = { fighters: [mage], effects: [], props: [], powerCrates: [], mode: "free" };
  attack(mage, game);
  assert.ok(mage.mana < 100);
  assert.ok(mage.attackCd > 0);
}

console.log("spellbook.test.js: ok");
