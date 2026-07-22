import assert from "node:assert/strict";
import { Fighter, hit } from "./combat.js";
import {
  COMBAT_CLONE_COOLDOWN, COMBAT_CLONE_HP_FRAC, COMBAT_CLONE_ID, COMBAT_CLONE_MAX_ACTIVE,
  createCombatClone, isCombatClone, isCombatCloneGear, tickCombatCloneWorld,
  tryCombatCloneSpawn
} from "./combat-clone.js";
import {
  applyLoadout, DEFAULT_LOADOUT, GEAR_BY_ID
} from "./equipment.js";
import { isRealCombatant } from "./illusionist.js";
import { updateAiCombatClone } from "./ai.js";

assert.equal(GEAR_BY_ID[COMBAT_CLONE_ID].slot, "extensionSecondary");
assert.equal(GEAR_BY_ID[COMBAT_CLONE_ID].combatClone, true);
assert.ok(GEAR_BY_ID[COMBAT_CLONE_ID].price < GEAR_BY_ID.illusionist.price);
assert.equal(COMBAT_CLONE_COOLDOWN, 30);
assert.equal(COMBAT_CLONE_MAX_ACTIVE, 2);
assert.equal(COMBAT_CLONE_HP_FRAC, 0.25);

{
  const owner = applyLoadout(new Fighter({
    x: 400, y: 700, team: 0, aim: 0, name: "YOU", color: "#e7f9ff",
    hp: 500, maxHp: 500
  }), {
    ...DEFAULT_LOADOUT,
    extensionSecondary: COMBAT_CLONE_ID,
    weapon: "pulse-rifle"
  });
  assert.ok(isCombatCloneGear(owner));
  const game = { fighters: [owner], effects: [], bullets: [] };
  const clone = tryCombatCloneSpawn(owner, game, Fighter);
  assert.ok(clone);
  assert.ok(isCombatClone(clone));
  assert.equal(clone.illusion, undefined);
  assert.equal(clone.maxHp, Math.round(500 * 0.25));
  assert.equal(clone.hp, clone.maxHp);
  assert.equal(clone.loadout.weapon, "pulse-rifle");
  assert.equal(clone.loadout.extensionSecondary, "no-extension");
  assert.equal(isRealCombatant(clone), false, "clones do not hold win condition");
  assert.equal(owner.combatCloneCd, COMBAT_CLONE_COOLDOWN);
  assert.equal(game.fighters.includes(clone), true);
}

{
  // Real damage in both directions.
  const owner = applyLoadout(new Fighter({
    x: 100, y: 100, team: 0, name: "YOU", color: "#fff", hp: 500, maxHp: 500
  }), { ...DEFAULT_LOADOUT, extensionSecondary: COMBAT_CLONE_ID });
  const clone = createCombatClone(owner, Fighter);
  const victim = new Fighter({ x: 200, y: 100, team: 1, hp: 500, maxHp: 500 });
  const game = {
    fighters: [owner, clone, victim],
    effects: [],
    bullets: [],
    mode: "conquest",
    stats: {}
  };
  hit(victim, clone, 40, 0, game);
  assert.ok(victim.hp < 500, "clone deals real damage");
  assert.equal(victim.phantomDamage || 0, 0, "not phantom gaslight");
  const before = clone.hp;
  hit(clone, victim, 20, 0, game);
  assert.ok(clone.hp < before, "clone takes real damage");
}

{
  // Max 2 alive; owner death culls clones.
  const owner = applyLoadout(new Fighter({
    x: 100, y: 700, team: 0, name: "YOU", color: "#fff", hp: 400, maxHp: 400
  }), { ...DEFAULT_LOADOUT, extensionSecondary: COMBAT_CLONE_ID });
  const game = { fighters: [owner], effects: [] };
  const a = tryCombatCloneSpawn(owner, game, Fighter);
  owner.combatCloneCd = 0;
  const b = tryCombatCloneSpawn(owner, game, Fighter);
  owner.combatCloneCd = 0;
  const c = tryCombatCloneSpawn(owner, game, Fighter);
  assert.ok(a && b);
  assert.equal(c, null);
  assert.equal(game.fighters.filter((f) => isCombatClone(f)).length, 2);
  owner.dead = true;
  tickCombatCloneWorld(game);
  assert.equal(game.fighters.filter((f) => isCombatClone(f) && !f.dead).length, 0);
}

{
  // AI spawns under pressure.
  const buddy = applyLoadout(new Fighter({
    x: 500, y: 700, team: 0, buddy: true, ai: "balanced",
    grounded: true, aim: 0, hp: 180, name: "Pixel", color: "#42dff5"
  }), {
    ...DEFAULT_LOADOUT,
    extensionSecondary: COMBAT_CLONE_ID,
    weapon: "pulse-rifle"
  });
  const enemy = new Fighter({
    x: 700, y: 700, team: 1, weapon: "saber", grounded: true, hp: 500
  });
  const state = { plan: "idle", desiredAim: null };
  const game = { fighters: [buddy, enemy], effects: [] };
  updateAiCombatClone(buddy, state, game, [enemy], enemy);
  assert.equal(state.plan, "spawning doppel");
  assert.ok(game.fighters.some((f) => isCombatClone(f)));
}

console.log("combat-clone.test.js passed.");
