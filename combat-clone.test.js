import assert from "node:assert/strict";
import { Fighter, hit } from "./combat.js";
import {
  COMBAT_CLONE_COOLDOWN, COMBAT_CLONE_HP_FRAC, COMBAT_CLONE_ID, COMBAT_CLONE_MAX_ACTIVE,
  createCombatClone, isCombatClone, isCombatCloneGear, LINKED_CLONE_HP, listCombatClones,
  SHADOW_CLONE_ID, SPLIT_ID, SPLIT_SWITCH_COOLDOWN, SPLIT_SWITCH_KEY,
  tickCombatCloneFighter, tickCombatCloneWorld, tryCombatCloneSpawn, trySplitSwitch
} from "./combat-clone.js";
import {
  applyHpDamage, applyLoadout, DEFAULT_LOADOUT, GEAR_BY_ID, hasNanotechChestplate,
  hasRetractableArmor, syncNanotechDisplayedHp, tickNanotech
} from "./equipment.js";
import { isRealCombatant } from "./illusionist.js";
import { updateAiCombatClone } from "./ai.js";
import { ILLUSIONIST_COOLDOWN } from "./illusionist.js";
import {
  awardPowerup, consumeOvercharge, FIRE_RATE_DURATION, REGEN_DURATION,
  REGEN_TOTAL, tickFighterPowerBuffs
} from "./powerups.js";
import { tickSpellbookFighter } from "./spellbook.js";
import { tickTrapperFighter } from "./trapper.js";

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

function cloneFixture(extension, loadout = {}, scale = 1) {
  const owner = applyLoadout(new Fighter({
    x: 400, y: 700, team: 0, human: true, aim: 0, name: "YOU",
    color: "#e7f9ff", grounded: true
  }), { ...DEFAULT_LOADOUT, ...loadout, extensionSecondary: extension }, { healthScale: scale });
  const enemy = new Fighter({ x: 900, y: 700, team: 1, hp: 500, maxHp: 500 });
  const game = {
    fighters: [owner, enemy], effects: [], bullets: [], pings: [], stats: {},
    mode: "conquest", elapsed: 1
  };
  const a = tryCombatCloneSpawn(owner, game, Fighter);
  owner.combatCloneCd = 0;
  const b = tryCombatCloneSpawn(owner, game, Fighter);
  return { owner, enemy, game, a, b };
}

for (const id of [SHADOW_CLONE_ID, SPLIT_ID]) {
  assert.equal(GEAR_BY_ID[id].slot, "extensionSecondary");
  assert.ok(isCombatCloneGear(id));
  for (const scale of [1, 0.2]) {
    const { owner, enemy, game, a, b } = cloneFixture(id, {}, scale);
    assert.equal(a.hp, 25, "new clones have exactly 25 HP in either health mode");
    assert.equal(a.coreHp, 25);
    assert.equal(a.coreMaxHp, 25);
    assert.equal(a.maxHp, LINKED_CLONE_HP);
    assert.ok(isCombatClone(a));
    assert.equal(isRealCombatant(a), false);
    assert.equal(a.loadout.extensionSecondary, "no-extension");
    assert.equal(tryCombatCloneSpawn(a, game, Fighter), null, "twins cannot nest-spawn");
    assert.equal(owner.combatCloneCd, id === SHADOW_CLONE_ID ? ILLUSIONIST_COOLDOWN : 30);
    owner.combatCloneCd = 0;
    assert.equal(tryCombatCloneSpawn(owner, game, Fighter), null, "max two alive");
    hit(enemy, a, 12, 0, game);
    assert.equal(enemy.hp, 500 - 12 * scale, "full real weapon damage at the match health scale");
    assert.ok(b && !b.dead);
    tickCombatCloneFighter(owner, 60);
    tickCombatCloneWorld(game);
    assert.ok(game.fighters.includes(a), "twins have no duration limit");
  }
}

{
  const { owner, enemy, game, a, b } = cloneFixture(SHADOW_CLONE_ID);
  const startHp = owner.hp;
  hit(a, enemy, 10, 0, game);
  assert.equal(a.hp, 15);
  assert.equal(b.hp, 15);
  assert.equal(owner.hp, startHp - 10, "one share, no recursive amplification");
  hit(owner, enemy, 5, 0, game);
  assert.equal(a.hp, 10);
  assert.equal(b.hp, 10);
  assert.equal(owner.hp, startHp - 15, "owner damage shares back to shadows");
  hit(a, enemy, 100, 0, game);
  assert.equal(owner.hp, startHp - 25, "only actual lost HP shares, not overkill");
  assert.ok(a.dead && b.dead);
  tickCombatCloneWorld(game);
  assert.equal(game.fighters.filter(isCombatClone).length, 0);
  assert.equal(owner.shadowLink.members.size, 1);
  assert.ok(owner.shadowLink.members.has(owner));
  owner.combatCloneCd = 0;
  assert.ok(tryCombatCloneSpawn(owner, game, Fighter), "dead shadows free a slot");
}

{
  const { owner, enemy, game, a, b } = cloneFixture(SHADOW_CLONE_ID, { shield: "light-buckler" });
  const startHp = owner.hp;
  a.shieldRaised = true;
  a.aim = Math.PI;
  hit(a, enemy, 10, 0, game);
  assert.equal(owner.hp, startHp, "blocked shield damage is not shared");
  assert.equal(a.hp, 25);
  a.shieldRaised = false;
  a.iframe = .2;
  hit(a, enemy, 10, 0, game);
  assert.equal(owner.hp, startHp, "dodged hits are not shared");
  a.iframe = 0;
  owner.damageTaken = .5;
  hit(a, enemy, 10, 0, game);
  assert.equal(owner.hp, startHp - 10, "linked damage is not mitigated a second time");
  assert.equal(b.hp, 15);
}

{
  const { owner, game, a, b } = cloneFixture(SHADOW_CLONE_ID);
  applyHpDamage(b, 4, game, { alreadyScaled: true });
  assert.equal(owner.hp, owner.maxHp - 4, "hazards and direct HP damagers also share");
  assert.equal(a.hp, 21);
  awardPowerup(a, "fireRate", game);
  assert.equal(owner.powerBuffs, a.powerBuffs);
  assert.equal(owner.powerBuffs, b.powerBuffs);
  for (const f of [owner, a, b]) tickFighterPowerBuffs(f, 1);
  assert.equal(owner.powerBuffs.fireRate.remaining, FIRE_RATE_DURATION - 1,
    "one shared countdown, not one decrement per clone");
  awardPowerup(b, "overcharge", game);
  const charges = owner.powerBuffs.overcharge.charges;
  consumeOvercharge(a);
  if (charges > 1) assert.equal(owner.powerBuffs.overcharge.charges, charges - 1);
  else assert.equal(owner.powerBuffs.overcharge, undefined);
  awardPowerup(b, "heal", game);
  assert.equal(owner.hp, owner.maxHp);
  assert.equal(a.hp, 25);
  assert.equal(b.hp, 25);
  owner.combatCloneCd = 0;
  a.dead = true;
  b.trapLockT = 3;
  tickCombatCloneWorld(game);
  const c = tryCombatCloneSpawn(owner, game, Fighter);
  assert.equal(c.powerBuffs.fireRate.remaining, FIRE_RATE_DURATION - 1,
    "new shadows inherit the current buff, not a refreshed duration");
  assert.equal(c.trapLockT, 3, "new shadows inherit active debuffs");
}

{
  const { owner, game, a, b } = cloneFixture(SHADOW_CLONE_ID);
  applyHpDamage(owner, 10, game, { alreadyScaled: true });
  awardPowerup(b, "regen", game);
  const ownerBefore = owner.hp;
  for (const f of [owner, a, b]) tickFighterPowerBuffs(f, 1);
  assert.ok(Math.abs(owner.hp - ownerBefore - REGEN_TOTAL / REGEN_DURATION) < 1e-6);
  assert.ok(Math.abs(a.hp - 15 - REGEN_TOTAL / REGEN_DURATION) < 1e-6);
  assert.equal(owner.powerBuffs.regen.remaining, REGEN_DURATION - 1);
  a.trapLockT = 5;
  a.trapLockKind = "bolas";
  b.signalRevealT = 4;
  b.signalRevealTeam = 1;
  a.icePinT = 2;
  for (const f of [owner, a, b]) {
    tickTrapperFighter(f, .5);
    tickSpellbookFighter(f, .5);
  }
  assert.equal(owner.trapLockT, 4.5);
  assert.equal(b.trapLockT, 4.5);
  assert.equal(owner.trapLockKind, "bolas");
  assert.equal(owner.signalRevealT, 3.5);
  assert.equal(owner.signalRevealTeam, 1);
  assert.equal(owner.icePinT, 1.5);
  assert.equal(b.icePinT, 1.5);
  tickSpellbookFighter(owner, 1.5);
  assert.equal(a.icePinT, 0);
  assert.ok(a.iceSlowT > 0, "pin-to-slow transition is shared");
  tickTrapperFighter(owner, 5);
  assert.equal(a.trapLockT, 0);
  assert.equal(a.trapLockKind, null);
  assert.equal(a.signalRevealTeam, null);
}

for (const id of [SHADOW_CLONE_ID, SPLIT_ID]) {
  const { owner, game, a } = cloneFixture(id, {
    body: "nanotech-chestplate", shield: "retractable-shell", weapon: "nanotech-rifle"
  });
  assert.equal(hasRetractableArmor(a), false);
  assert.equal(hasNanotechChestplate(a), false);
  tickNanotech(a, 1);
  assert.equal(a.hp, 25, "nanotech ticks must not restore owner-sized HP");
  owner.dead = true;
  tickCombatCloneWorld(game);
  assert.equal(game.fighters.filter(isCombatClone).length, 0, "all twins die with owner");
}

assert.equal(SPLIT_SWITCH_KEY, "KeyH");
assert.equal(SPLIT_SWITCH_COOLDOWN, 3);

{
  const { owner, enemy, game, a } = cloneFixture(SHADOW_CLONE_ID);
  owner.hp = owner.coreHp = 5;
  hit(a, enemy, 10, 0, game);
  assert.ok(owner.dead, "shared damage can kill the owner immediately");
  tickCombatCloneWorld(game);
  assert.equal(game.fighters.filter(isCombatClone).length, 0);
}

{
  const { owner, game, a } = cloneFixture(SPLIT_ID, { body: "retractable-armor" });
  owner.retractableDeployed = true;
  owner.retractableHp = 50;
  owner.coreHp = 10;
  syncNanotechDisplayedHp(owner);
  const before = owner.hp;
  trySplitSwitch(owner, game);
  assert.equal(owner.hp, before, "armor above the minimum must not secretly heal core HP");
  assert.equal(owner.coreHp, 10);
  assert.equal(a.hp, 25);
}

{
  const { owner, game, a, b } = cloneFixture(SPLIT_ID);
  owner.hp = owner.coreHp = 10;
  owner.fuel = .2;
  a.fuel = .8;
  owner.iceSlowT = 3;
  a.trapLockT = 2;
  a.trapLockKind = "bear";
  owner.powerBuffs = { speedSurge: { remaining: 5, duration: 10, mult: 1.2 } };
  a.powerBuffs = { fireRate: { remaining: 6, duration: 15 } };
  owner.attackCd = .7;
  owner.shieldDurability = 12;
  const spawnCd = owner.combatCloneCd;
  const oldX = owner.x;
  const aX = a.x;
  b.x = 1100;
  assert.equal(trySplitSwitch(owner, game), a);
  assert.equal(owner.hp, 25, "controlled HP is really raised to 25");
  assert.equal(owner.maxHp, 500, "controlled body retains normal stats");
  assert.equal(a.hp, 10, "left body retains pre-switch HP below 25");
  assert.equal(a.coreHp, 10);
  assert.equal(owner.x, aX);
  assert.equal(a.x, oldX);
  assert.equal(owner.fuel, .8);
  assert.equal(a.fuel, .2);
  assert.equal(owner.trapLockT, 2);
  assert.equal(a.iceSlowT, 3);
  assert.ok(owner.powerBuffs.fireRate && a.powerBuffs.speedSurge,
    "effects stay on physical bodies, not shared between Split twins");
  assert.equal(owner.attackCd, .7, "switching does not reset attack cooldown");
  assert.equal(owner.shieldDurability, 12, "switching does not refill shields");
  assert.equal(owner.combatCloneCd, spawnCd, "spawn cooldown follows the player");
  assert.equal(game.fighters[0], owner);
  assert.equal(owner.human, true);
  assert.equal(a.human, false);
  assert.equal(trySplitSwitch(owner, game), null, "switch cooldown blocks rapid cycling");
  tickCombatCloneFighter(owner, 3);
  assert.equal(trySplitSwitch(owner, game), b, "cycle reaches the second twin");
  assert.equal(owner.x, 1100);
  assert.equal(b.hp, 25);
  assert.equal(owner.hp, 25);
  tickCombatCloneFighter(owner, 3);
  assert.equal(trySplitSwitch(owner, game), a);
  assert.equal(owner.x, oldX, "cycle eventually returns to the original location");
}

{
  const { owner, enemy, game, a, b } = cloneFixture(SPLIT_ID);
  hit(a, enemy, 10, 0, game);
  assert.equal(owner.hp, 500, "Split does not share damage");
  assert.equal(b.hp, 25);
  awardPowerup(a, "fireRate", game);
  assert.equal(owner.powerBuffs.fireRate, undefined, "Split does not share buffs");
  tickFighterPowerBuffs(a, 1);
  assert.equal(a.powerBuffs.fireRate.remaining, FIRE_RATE_DURATION - 1);
  a.trapLockT = 2;
  tickTrapperFighter(a, 1);
  assert.equal(a.trapLockT, 1, "uncontrolled Split debuffs expire normally");
  a.dead = true;
  assert.equal(trySplitSwitch(owner, game), b, "dead bodies are skipped");
  assert.equal(owner.hp, 500, "switching above 25 does not heal");
  assert.equal(b.hp, 25);
  owner.splitSwitchCd = 0;
  game.paused = true;
  assert.equal(trySplitSwitch(owner, game), null);
  game.paused = false;
  game.over = true;
  assert.equal(trySplitSwitch(owner, game), null);
  game.over = false;
  b.dead = true;
  assert.equal(trySplitSwitch(owner, game), null, "no living bodies means no switch");
}

for (const id of [SHADOW_CLONE_ID, SPLIT_ID]) {
  const { owner, game } = cloneFixture(id);
  owner.combatCloneCd = 0;
  game.paused = true;
  assert.equal(tryCombatCloneSpawn(owner, game, Fighter), null);
  game.paused = false;
  game.over = true;
  assert.equal(tryCombatCloneSpawn(owner, game, Fighter), null);
}

for (const id of [SHADOW_CLONE_ID, SPLIT_ID]) {
  const { owner, enemy, game } = cloneFixture(id);
  game.fighters = [owner, enemy];
  tickCombatCloneWorld(game);
  owner.human = false;
  owner.buddy = true;
  owner.hp = owner.coreHp = 100;
  owner.combatCloneCd = 0;
  const state = owner.aiState;
  updateAiCombatClone(owner, state, game, [enemy], enemy);
  assert.equal(state.plan, id === SHADOW_CLONE_ID ? "spawning shadow clone" : "spawning split");
  assert.ok(game.fighters.some(isCombatClone));
  if (id === SPLIT_ID) {
    owner.hp = owner.coreHp = 10;
    updateAiCombatClone(owner, state, game, [enemy], enemy);
    assert.equal(state.plan, "switching split");
    assert.equal(owner.hp, 25);
  }
}

for (const id of [COMBAT_CLONE_ID, SHADOW_CLONE_ID, SPLIT_ID]) {
  const { owner, game } = cloneFixture(id);
  game.fighters = [owner];
  tickCombatCloneWorld(game);
  owner.combatCloneCd = 0;
  updateAiCombatClone(owner, owner.aiState, game, [], null);
  assert.equal(listCombatClones(game).length, id === SPLIT_ID ? 1 : 0,
    "only Split builds its persistent team without combat pressure");
  if (id === SPLIT_ID) {
    owner.combatCloneCd = 0;
    updateAiCombatClone(owner, owner.aiState, game, [], null);
    assert.equal(listCombatClones(game).length, 2);
    owner.combatCloneCd = 0;
    updateAiCombatClone(owner, owner.aiState, game, [], null);
    assert.equal(listCombatClones(game).length, 2, "Split respects its team cap");
  }
}

console.log("combat-clone.test.js passed: Doppel, Shadow Clone, and Split.");
