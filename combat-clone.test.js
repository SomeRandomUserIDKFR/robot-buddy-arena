import assert from "node:assert/strict";
import { Fighter, hit, stepFighter } from "./combat.js";
import { DEFAULT_PROFILE, SIZE } from "./config.js";
import {
  COMBAT_CLONE_COOLDOWN, COMBAT_CLONE_HP_FRAC, COMBAT_CLONE_ID, COMBAT_CLONE_MAX_ACTIVE,
  createCombatClone, isCombatClone, isCombatCloneGear, SHADOW_CLONE_HP_BUDGET, listCombatClones,
  SHADOW_CLONE_COOLDOWN, SHADOW_CLONE_MAX_ACTIVE, SHADOW_CLONE_HP_REGEN,
  SHADOW_CLONE_SHIELD_REGEN_SECONDS, cloneMaxActive,
  SHADOW_CLONE_ID, SPLIT_ID, SPLIT_SWITCH_COOLDOWN, SPLIT_SWITCH_KEY,
  SPLIT_SWITCH_MIN_HP, SPLIT_TWIN_HP,
  tickCombatCloneFighter, tickCombatCloneWorld, tryCombatCloneSpawn, tryDismissShadowClone, trySplitSwitch
} from "./combat-clone.js";
import {
  ADAPTIVE_NANOTECH_ID, applyHpDamage, applyLoadout, DEFAULT_LOADOUT, GEAR_BY_ID,
  hasNanotechChestplate, hasRetractableArmor, MATERIAL_CONSUMER_ID, MODULAR_WEAPON_ID,
  nanotechArmorHp, nanotechArmorMaxHp, nanotechFormPct, selectWeaponSlot, SHIELD_STEAL_ID, effectiveStats,
  beginModularMorph, tickModularWeapon, syncNanotechDisplayedHp, tickNanotech,
  pulseNanotechArmor, setNanotechChanneling, tickRetractableArmor,
  CLONE_NANOTECH_ARMOR_MULT, SHADOW_NANOTECH_ARMOR_MULT,
  CLONE_RETRACTABLE_ARMOR_MULT, SHADOW_RETRACTABLE_ARMOR_MULT
} from "./equipment.js";
import { displayedHp, displayedMaxHp, isRealCombatant } from "./illusionist.js";
import { updateAI, updateAIClone, updateAIDecoy, updateAiCombatClone } from "./ai.js";
import { createFighterIllusion } from "./illusionist.js";
import { createMapProp } from "./maps.js";
import { attackThrowBreakable, THROW_BREAKABLE_ID, tickThrowBreakable } from "./throw-breakable.js";
import { THROWING_SPEAR_ID } from "./tool-secondaries.js";
import {
  awardPowerup, consumeOvercharge, FIRE_RATE_DURATION, REGEN_DURATION,
  REGEN_TOTAL, tickFighterPowerBuffs
} from "./powerups.js";
import { tickSpellbookFighter } from "./spellbook.js";
import { tickTrapperFighter } from "./trapper.js";
import { fighterVisibleToViewer, visibleToSelf, visibleToTeam } from "./vision.js";

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

assert.equal(SHADOW_CLONE_HP_BUDGET, 100);
assert.equal(SHADOW_CLONE_COOLDOWN, 0);
assert.equal(SHADOW_CLONE_MAX_ACTIVE, 10);
assert.equal(SHADOW_CLONE_HP_REGEN, 20);
assert.equal(SHADOW_CLONE_SHIELD_REGEN_SECONDS, 2.5);

for (const scale of [1, .2]) {
  const plain = effectiveStats(DEFAULT_LOADOUT);
  const loadout = { ...DEFAULT_LOADOUT, extensionSecondary: SHADOW_CLONE_ID };
  const owner = applyLoadout(new Fighter({ team: 0 }), loadout, { healthScale: scale });
  assert.equal(effectiveStats(loadout).hp, plain.hp - 100);
  assert.equal(owner.coreMaxHp, (plain.hp - 100) * scale);
  assert.equal(owner.maxHp, owner.coreMaxHp, "owner penalty follows normal health scaling");
}

{
  const { owner, game, a, b } = cloneFixture(SHADOW_CLONE_ID);
  const hp = owner.hp;
  tickCombatCloneWorld(game, 1);
  assert.equal(owner.shadowLink.hpReserve, 10, "fully deployed HP banks at half speed");
  assert.equal(a.hp, 50);
  assert.equal(b.hp, 50, "bank recharge never heals living clones");
  const c = tryCombatCloneSpawn(owner, game, Fighter);
  for (const shadow of [a, b, c]) {
    assert.ok(Math.abs(shadow.hp - 100 / 3) < 1e-10, "spawn discards excess above 100");
    assert.ok(Math.abs(shadow.maxHp - 100 / 3) < 1e-10);
  }
  assert.equal(owner.shadowLink.hpReserve, 0, "spawn consumes the bank, including excess");
  assert.equal(owner.hp, hp, "recharge and spawn do not heal owner");
  tickCombatCloneWorld(game, 10);
  assert.equal(owner.shadowLink.hpReserve, 100, "bank can refill alongside 100 deployed HP");
  assert.ok(Math.abs(a.hp - 100 / 3) < 1e-10);
}

{
  const { owner, game } = cloneFixture(SHADOW_CLONE_ID);
  for (let n = 2; n < 10; n++) assert.ok(tryCombatCloneSpawn(owner, game, Fighter));
  const shadows = listCombatClones(game);
  applyHpDamage(shadows[0], 10, game, { alreadyScaled: true });
  tickCombatCloneWorld(game, .5);
  assert.equal(owner.shadowLink.hpReserve, 10, "lost 10 HP recharges at 20 HP/sec");
  tickCombatCloneWorld(game, 1);
  assert.equal(owner.shadowLink.hpReserve, 20, "remaining deployed 90 HP recharges at 10 HP/sec");
  tickCombatCloneWorld(game, 8);
  assert.equal(owner.shadowLink.hpReserve, 100, "example fully recharges in 9.5 seconds");
  assert.ok(listCombatClones(game).every((shadow) => shadow.hp === 10));
  assert.ok(listCombatClones(game).every((shadow) =>
    Math.abs(shadow.maxHp - 100 / 9) < 1e-10), "death changes capacity, not current HP");
}

{
  const { owner, game, a, b } = cloneFixture(SHADOW_CLONE_ID);
  applyHpDamage(a, 10, game, { alreadyScaled: true });
  tickCombatCloneWorld(game, .75);
  assert.equal(owner.shadowLink.hpReserve, 12.5, "one tick crosses from full-speed to half-speed recharge");
  assert.equal(a.hp, 40);
  assert.equal(b.hp, 50);
  assert.equal(a.shieldMaxDurability, 0, "a shieldless kit creates no shield reserve");
  assert.equal(owner.shadowLink.shieldReserve, 0);
}

{
  const { owner, game, a, b } = cloneFixture(SHADOW_CLONE_ID);
  applyHpDamage(a, 50, game, { alreadyScaled: true });
  applyHpDamage(b, 50, game, { alreadyScaled: true });
  tickCombatCloneWorld(game);
  assert.equal(owner.shadowLink.hpReserve, 0, "wipe does not reset the bank");
  assert.equal(tryCombatCloneSpawn(owner, game, Fighter), null, "zero HP cannot create a dead clone");
  game.paused = true;
  tickCombatCloneWorld(game, 5);
  assert.equal(owner.shadowLink.hpReserve, 0);
  assert.equal(tryCombatCloneSpawn(owner, game, Fighter), null);
  game.paused = false;
  game.over = true;
  tickCombatCloneWorld(game, 5);
  assert.equal(owner.shadowLink.hpReserve, 0);
  game.over = false;
  tickCombatCloneWorld(game, 4);
  assert.equal(owner.shadowLink.hpReserve, 80);
  tickCombatCloneWorld(game, 1);
  assert.equal(owner.shadowLink.hpReserve, 100, "empty swarm recovers in exactly five seconds");
  const c = tryCombatCloneSpawn(owner, game, Fighter);
  assert.equal(c.hp, 100);
  assert.equal(owner.shadowLink.hpReserve, 0);
  applyHpDamage(c, 100, game, { alreadyScaled: true });
  tickCombatCloneWorld(game, .25);
  const d = tryCombatCloneSpawn(owner, game, Fighter);
  assert.equal(d.hp, 5, "respawn uses only recovered HP, not a fresh full pool");
  assert.equal(d.maxHp, 100, "maximum is the full pool regardless of bank contents");
}

for (const scale of [1, .2]) {
  const { owner, game, a, b } = cloneFixture(SHADOW_CLONE_ID,
    { shield: "light-buckler" }, scale);
  const cap = owner.shieldMaxDurability / 2;
  assert.equal(owner.shadowLink.shieldMax, cap);
  assert.equal(a.shieldMaxDurability, cap / 2);
  assert.equal(b.shieldDurability, cap / 2);
  tickCombatCloneWorld(game, 1.25);
  assert.equal(owner.shadowLink.shieldReserve, cap / 4, "deployed shield refills bank at half speed");
  assert.equal(a.shieldDurability, cap / 2, "shield regeneration is bank-only");
  owner.shadowLink.shieldReserve = 0;
  a.shieldDurability = b.shieldDurability = 0;
  a.shieldBroken = b.shieldBroken = true;
  tickCombatCloneWorld(game, 2);
  assert.ok(Math.abs(owner.shadowLink.shieldReserve - cap * .8) < 1e-10);
  tickCombatCloneWorld(game, .5);
  assert.equal(owner.shadowLink.shieldReserve, cap, "empty shields refill bank in 2.5 seconds");
  assert.equal(a.shieldDurability, 0);
  assert.equal(a.shieldBroken, true, "bank does not repair a living shield");
  const c = tryCombatCloneSpawn(owner, game, Fighter);
  for (const shadow of [a, b, c]) {
    assert.equal(shadow.shieldMaxDurability, cap / 3);
    assert.equal(shadow.shieldDurability, cap / 3);
    assert.equal(shadow.shieldBroken, false, "spawn redistribution repairs positive shields");
  }
  assert.equal(owner.shadowLink.shieldReserve, 0);
  const survivorHp = a.hp;
  const survivorShield = a.shieldDurability;
  assert.equal(tryDismissShadowClone(owner, game), c);
  assert.equal(a.hp, survivorHp);
  assert.equal(a.shieldDurability, survivorShield);
  assert.equal(a.shieldMaxDurability, cap / 2);
  assert.equal(owner.shadowLink.shieldReserve, cap / 3, "dismissed shield is banked");
  tickCombatCloneWorld(game, 100);
  assert.equal(owner.shadowLink.shieldReserve, cap);
  assert.equal(a.shieldDurability, survivorShield);
  assert.equal(tryDismissShadowClone(owner, game), b);
  assert.equal(owner.shadowLink.shieldReserve, cap, "banking cannot exceed capacity");
  const d = tryCombatCloneSpawn(owner, game, Fighter);
  assert.equal(d.shieldDurability, cap / 2, "spawn discards surplus shield");
  assert.equal(a.shieldDurability, cap / 2);
}

{
  const { owner, game, a } = cloneFixture(SHADOW_CLONE_ID,
    { shield: "light-buckler", weapon: MODULAR_WEAPON_ID });
  const cap = Math.max(owner.shieldMaxDurability, owner.modularPlateMax) / 2;
  assert.equal(owner.shadowLink.shieldMax, cap, "one budget based on strongest shield mode");
  const max = a.shieldMaxDurability;
  a.shieldDurability -= 5;
  const before = a.shieldDurability;
  assert.equal(beginModularMorph(a, "shield"), true);
  tickModularWeapon(a, 1);
  assert.equal(a.shieldMaxDurability, max);
  assert.equal(a.shieldDurability, before, "morphing does not restore an unallocated plate");
  a.shieldDurability = 0;
  a.shieldBroken = true;
  tickModularWeapon(a, 1);
  assert.equal(beginModularMorph(a, "rifle"), true);
  tickModularWeapon(a, 1);
  assert.equal(a.shieldMaxDurability, max);
  assert.equal(a.shieldDurability, 0, "dedicated snapshot cannot refund old durability");
  assert.equal(a.shieldBroken, true);
  awardPowerup(a, "shieldPatch", game);
  assert.ok(a.shieldDurability > 0 && a.shieldDurability <= max);
  tickCombatCloneWorld(game, 5);
  tryCombatCloneSpawn(owner, game, Fighter);
  assert.equal(a.shieldMaxDurability, cap / 3);
  assert.equal(a.shieldDurability, cap / 3);
  applyLoadout(owner, { ...DEFAULT_LOADOUT, extensionSecondary: SHADOW_CLONE_ID });
  assert.equal(owner.shadowLink, null, "fresh loadout resets per-match reserves");
  assert.equal(owner.modularPlateMax, 0, "old weapon cannot supply a phantom shield budget");
}

{
  const { owner, enemy, a } = cloneFixture(SHADOW_CLONE_ID);
  owner.phantomDamage = 7;
  for (const viewer of [enemy, { team: 1, shadowCloneGear: true }, { team: 1, illusionist: true }]) {
    assert.equal(displayedHp(a, viewer), displayedHp(owner, viewer));
    assert.equal(displayedMaxHp(a, viewer), displayedMaxHp(owner, viewer),
      "enemy gear does not reveal shadow identity");
  }
  assert.equal(displayedHp(a, owner), 50, "owner sees actual clone HP");
  assert.equal(displayedMaxHp(a, { team: owner.team }), 50, "teammates see actual capacity");
}

{
  const { owner, a, game } = cloneFixture(SHADOW_CLONE_ID);
  const actorOwner = applyLoadout(new Fighter({ team: 1 }),
    { ...DEFAULT_LOADOUT, extensionSecondary: COMBAT_CLONE_ID });
  const actor = createCombatClone(actorOwner, Fighter);
  actor.x = 0;
  actor.y = owner.y;
  actor.aiState.timer = 0;
  a.x = owner.x - 50;
  a.y = owner.y - 20;
  game.fighters = [actor, owner, a];
  updateAIClone(actor, .016, game);
  assert.ok(Math.abs(actor.aiState.desiredAim - Math.atan2(-20, a.x)) < 1e-10,
    "enemy summon AI cannot deprioritize an enemy because it is a shadow");
}

{
  const { owner, enemy, game, a, b } = cloneFixture(SHADOW_CLONE_ID,
    { secondaryWeapon: THROW_BREAKABLE_ID });
  applyHpDamage(a, 10, game, { alreadyScaled: true });
  applyHpDamage(b, 20, game, { alreadyScaled: true });
  const ownerHp = owner.hp;
  const spawnCd = owner.combatCloneCd;
  const prop = createMapProp("crate", b.x, b.y + SIZE);
  game.props = [prop];
  selectWeaponSlot(b, "secondaryWeapon");
  assert.equal(attackThrowBreakable(b, game), true);
  assert.equal(b.heldProp, prop);
  const otherOwner = applyLoadout(new Fighter({ team: 1 }),
    { ...DEFAULT_LOADOUT, extensionSecondary: SHADOW_CLONE_ID });
  game.fighters.push(otherOwner);
  const other = tryCombatCloneSpawn(otherOwner, game, Fighter);
  game.paused = true;
  assert.equal(tryDismissShadowClone(owner, game), null);
  game.paused = false;
  game.over = true;
  assert.equal(tryDismissShadowClone(owner, game), null);
  game.over = false;
  assert.equal(tryDismissShadowClone(owner, game), b, "dismiss newest owned living shadow");
  assert.equal(owner.hp, ownerHp, "dismissal does not transfer damage or heal owner");
  assert.equal(owner.combatCloneCd, spawnCd, "dismissal works during cooldown without resetting it");
  assert.equal(a.hp, 40, "dismissal does not redistribute or heal survivors");
  assert.equal(owner.shadowLink.hpReserve, 30, "dismissed HP is banked");
  assert.equal(a.maxHp, 100);
  assert.equal(b.dead, true);
  assert.equal(b.heldProp, null);
  assert.equal(prop.heldBy, null, "held props are released before removal");
  assert.equal(owner.shadowLink.members.has(b), false);
  assert.ok(!game.fighters.includes(b) && game.fighters.includes(other));
  assert.ok(game.fighters.includes(enemy));
  assert.deepEqual(listCombatClones(game), [a, other], "living clone cache updates immediately");
  assert.equal(tryDismissShadowClone(owner, game), a);
  assert.equal(owner.shadowLink.hpReserve, 70, "last dismissal preserves remaining HP");
  assert.equal(owner.hp, ownerHp);
  assert.equal(tryDismissShadowClone(owner, game), null, "empty dismissal is harmless");
  assert.equal(owner.shadowLink.members.size, 1);
}

{
  const { owner, game, a, b } = cloneFixture(SHADOW_CLONE_ID);
  owner.combatCloneCd = 0;
  const c = tryCombatCloneSpawn(owner, game, Fighter);
  const total = a.hp + b.hp + c.hp;
  applyHpDamage(a, 4, game, { alreadyScaled: true });
  const ownerHp = owner.hp;
  assert.equal(tryDismissShadowClone(owner, game), c);
  assert.equal(a.maxHp, 50);
  assert.equal(b.maxHp, 50);
  assert.ok(Math.abs(a.hp - (total / 3 - 4)) < 1e-10);
  assert.ok(Math.abs(b.hp - total / 3) < 1e-10, "survivors keep unequal current HP");
  assert.ok(Math.abs(owner.shadowLink.hpReserve - total / 3) < 1e-10);
  assert.equal(owner.hp, ownerHp);
}

for (const id of [COMBAT_CLONE_ID, SPLIT_ID]) {
  const { owner, game } = cloneFixture(id);
  assert.equal(tryDismissShadowClone(owner, game), null, "other clone Extensions are unchanged");
}

for (const scale of [1, .2]) {
  const owner = applyLoadout(new Fighter({ team: 0, grounded: true }),
    { ...DEFAULT_LOADOUT, extensionSecondary: SHADOW_CLONE_ID }, { healthScale: scale });
  const game = { fighters: [owner], effects: [], elapsed: 0 };
  assert.equal(cloneMaxActive(owner), 10);
  for (let count = 1; count <= 10; count++) {
    assert.ok(tryCombatCloneSpawn(owner, game, Fighter));
    const shadows = listCombatClones(game);
    assert.equal(shadows.length, count);
    for (const shadow of shadows) {
      assert.ok(Math.abs(shadow.hp - 100 / count) < 1e-10);
      assert.ok(Math.abs(shadow.maxHp - 100 / count) < 1e-10);
    }
    assert.equal(owner.combatCloneCd, 0, "consecutive spawns need no cooldown");
  }
  assert.equal(tryCombatCloneSpawn(owner, game, Fighter), null, "ten is the hard cap");
  const shadows = listCombatClones(game);
  const before = owner.hp;
  applyHpDamage(shadows[0], 1000, game, { alreadyScaled: true });
  assert.equal(owner.hp, before - 10);
  assert.ok(shadows[0].dead);
  assert.ok(shadows.slice(1).every((shadow) => shadow.hp === 10), "no sibling feedback");
  tickCombatCloneWorld(game);
  const replacement = tryCombatCloneSpawn(owner, game, Fighter);
  assert.ok(replacement);
  for (const shadow of listCombatClones(game)) {
    assert.equal(shadow.hp, 9, "replacement shares 90 surviving HP without adding health");
    assert.equal(shadow.maxHp, 10);
  }
}

{
  const { owner, game, a, b } = cloneFixture(SHADOW_CLONE_ID);
  applyHpDamage(a, 20, game, { alreadyScaled: true });
  owner.combatCloneCd = 0;
  const c = tryCombatCloneSpawn(owner, game, Fighter);
  for (const shadow of [a, b, c]) {
    assert.ok(Math.abs(shadow.hp - 80 / 3) < 1e-10, "unequal current HP is evenly redistributed");
    assert.ok(Math.abs(shadow.maxHp - 100 / 3) < 1e-10);
  }
  const ownerBefore = owner.hp;
  applyHpDamage(owner, 5, game, { alreadyScaled: true });
  assert.equal(owner.hp, ownerBefore - 5, "direct owner damage applies just once");
  for (const shadow of [a, b, c]) assert.ok(Math.abs(shadow.hp - (80 / 3 - 5)) < 1e-10);
}

{
  const { owner, enemy, game } = cloneFixture(SHADOW_CLONE_ID);
  owner.combatCloneCd = 0;
  for (let count = 3; count <= 10; count++) {
    updateAiCombatClone(owner, owner.aiState, game, [enemy], enemy);
    assert.equal(listCombatClones(game).length, count, "AI fills the ten-shadow cap");
    assert.equal(owner.combatCloneCd, 0);
  }
  updateAiCombatClone(owner, owner.aiState, game, [enemy], enemy);
  assert.equal(listCombatClones(game).length, 10);
}

for (const id of [SHADOW_CLONE_ID, SPLIT_ID]) {
  assert.equal(GEAR_BY_ID[id].slot, "extensionSecondary");
  assert.ok(isCombatCloneGear(id));
  for (const scale of [1, 0.2]) {
    const { owner, enemy, game, a, b } = cloneFixture(id, {}, scale);
    const expectedHp = id === SPLIT_ID ? SPLIT_TWIN_HP : SHADOW_CLONE_HP_BUDGET / 2;
    assert.equal(a.hp, expectedHp, "new clones have their fixed HP in either health mode");
    assert.equal(a.coreHp, expectedHp);
    assert.equal(a.coreMaxHp, expectedHp);
    assert.equal(a.maxHp, expectedHp);
    assert.ok(isCombatClone(a));
    assert.equal(isRealCombatant(a), false);
    assert.equal(a.loadout.extensionSecondary, "no-extension");
    assert.equal(tryCombatCloneSpawn(a, game, Fighter), null, "twins cannot nest-spawn");
    assert.equal(owner.combatCloneCd, id === SHADOW_CLONE_ID ? SHADOW_CLONE_COOLDOWN : 30);
    owner.combatCloneCd = 0;
    if (id === SPLIT_ID) assert.equal(tryCombatCloneSpawn(owner, game, Fighter), null, "max two Split twins");
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
  assert.equal(a.hp, 40);
  assert.equal(b.hp, 50, "clone hits do not damage siblings");
  assert.equal(owner.hp, startHp - 10, "one share, no recursive amplification");
  hit(owner, enemy, 5, 0, game);
  assert.equal(a.hp, 35);
  assert.equal(b.hp, 45);
  assert.equal(owner.hp, startHp - 15, "owner damage shares back to shadows");
  hit(a, enemy, 100, 0, game);
  assert.equal(owner.hp, startHp - 50, "only actual lost HP transfers, not overkill");
  assert.ok(a.dead && !b.dead);
  tickCombatCloneWorld(game);
  assert.equal(game.fighters.filter(isCombatClone).length, 1);
  assert.equal(b.maxHp, 100, "death increases surviving capacity");
  assert.equal(b.hp, 45, "death does not heal the survivor");
  assert.equal(owner.shadowLink.members.size, 2);
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
  assert.equal(a.hp, 50);
  a.shieldRaised = false;
  a.iframe = .2;
  hit(a, enemy, 10, 0, game);
  assert.equal(owner.hp, startHp, "dodged hits are not shared");
  a.iframe = 0;
  owner.damageTaken = .5;
  hit(a, enemy, 10, 0, game);
  assert.equal(owner.hp, startHp - 10, "linked damage is not mitigated a second time");
  assert.equal(b.hp, 50, "transferred damage never bounces from the owner");
}

{
  const { owner, game, a, b } = cloneFixture(SHADOW_CLONE_ID);
  applyHpDamage(b, 4, game, { alreadyScaled: true });
  assert.equal(owner.hp, owner.maxHp - 4, "hazards and direct HP damagers also share");
  assert.equal(a.hp, 50);
  awardPowerup(a, "fireRate", game);
  assert.notEqual(owner.powerBuffs, a.powerBuffs);
  assert.notEqual(a.powerBuffs, b.powerBuffs);
  for (const f of [owner, a, b]) tickFighterPowerBuffs(f, 1);
  assert.equal(a.powerBuffs.fireRate.remaining, FIRE_RATE_DURATION - 1);
  assert.equal(owner.powerBuffs.fireRate, undefined);
  assert.equal(b.powerBuffs.fireRate, undefined);
  awardPowerup(b, "overcharge", game);
  const charges = b.powerBuffs.overcharge.charges;
  consumeOvercharge(a);
  assert.equal(b.powerBuffs.overcharge.charges, charges, "Overcharge charges are independent");
  awardPowerup(b, "heal", game);
  assert.equal(owner.hp, owner.maxHp - 4, "clone healing does not heal owner");
  assert.equal(a.hp, 50);
  assert.equal(b.hp, 50);
  owner.combatCloneCd = 0;
  a.dead = true;
  b.trapLockT = 3;
  tickCombatCloneWorld(game);
  const c = tryCombatCloneSpawn(owner, game, Fighter);
  assert.equal(c.powerBuffs.fireRate, undefined, "new shadows do not inherit buffs");
  assert.equal(c.trapLockT || 0, 0, "new shadows do not inherit debuffs");
  assert.equal(b.trapLockT, 3);
  assert.equal(b.hp, 25, "spawning divides surviving current HP");
  assert.equal(c.hp, 25);
  assert.equal(c.maxHp, 50);
}

{
  const { owner, game, a, b } = cloneFixture(SHADOW_CLONE_ID);
  applyHpDamage(owner, 10, game, { alreadyScaled: true });
  awardPowerup(b, "regen", game);
  const ownerBefore = owner.hp;
  for (const f of [owner, a, b]) tickFighterPowerBuffs(f, 1);
  assert.equal(owner.hp, ownerBefore);
  assert.equal(a.hp, 40);
  assert.ok(Math.abs(b.hp - 40 - REGEN_TOTAL / REGEN_DURATION) < 1e-6);
  assert.equal(b.powerBuffs.regen.remaining, REGEN_DURATION - 1);
  a.trapLockT = 5;
  a.trapLockKind = "bolas";
  b.signalRevealT = 4;
  b.signalRevealTeam = 1;
  a.icePinT = 2;
  for (const f of [owner, a, b]) {
    tickTrapperFighter(f, .5);
    tickSpellbookFighter(f, .5);
  }
  assert.equal(a.trapLockT, 4.5);
  assert.equal(owner.trapLockT || 0, 0);
  assert.equal(b.trapLockT || 0, 0);
  assert.equal(a.trapLockKind, "bolas");
  assert.equal(b.signalRevealT, 3.5);
  assert.equal(b.signalRevealTeam, 1);
  assert.equal(a.icePinT, 1.5);
  assert.equal(owner.icePinT || 0, 0);
  assert.equal(b.icePinT || 0, 0);
  tickSpellbookFighter(a, 1.5);
  assert.equal(a.icePinT, 0);
  assert.ok(a.iceSlowT > 0, "pin-to-slow transition ticks independently");
  tickTrapperFighter(a, 5);
  tickTrapperFighter(b, 5);
  assert.equal(a.trapLockT, 0);
  assert.equal(a.trapLockKind, null);
  assert.equal(b.signalRevealTeam, null);
}

for (const id of [SHADOW_CLONE_ID, SPLIT_ID]) {
  const { owner, game, a } = cloneFixture(id, {
    body: "nanotech-chestplate", shield: "retractable-shell", weapon: "nanotech-rifle"
  });
  assert.equal(hasRetractableArmor(a), true);
  assert.equal(hasNanotechChestplate(a), true);
  tickNanotech(a, 1);
  assert.equal(a.hp, id === SPLIT_ID ? SPLIT_TWIN_HP : SHADOW_CLONE_HP_BUDGET / 2,
    "nanotech ticks must not restore owner-sized HP");
  owner.dead = true;
  tickCombatCloneWorld(game);
  assert.equal(game.fighters.filter(isCombatClone).length, 0, "all twins die with owner");
}

assert.equal(SPLIT_SWITCH_KEY, "KeyH");
assert.equal(SPLIT_SWITCH_COOLDOWN, 3);
assert.equal(SPLIT_TWIN_HP, 250);
assert.equal(SPLIT_SWITCH_MIN_HP, 100);

for (const scale of [1, .2]) {
  for (const hp of [10, 60, 99, 100, ...(scale === 1 ? [150, 200, 249, 250, 251, 500] : [])]) {
    const { owner, game, a } = cloneFixture(SPLIT_ID, {}, scale);
    owner.hp = owner.coreHp = hp;
    trySplitSwitch(owner, game);
    assert.equal(owner.hp, Math.max(100, hp), "switching has an absolute 100-HP floor");
    assert.equal(a.hp, Math.min(250, hp), "abandoned HP is preserved up to the 250-HP cap");
    assert.equal(a.maxHp, 250);
    assert.equal(owner.maxHp, 500 * scale, "normal controlled stats are retained");
  }
}

{
  const { owner, game, a } = cloneFixture(SPLIT_ID, { body: "retractable-armor" });
  owner.retractableDeployed = true;
  owner.retractableHp = 50;
  owner.coreHp = 10;
  syncNanotechDisplayedHp(owner);
  trySplitSwitch(owner, game);
  assert.equal(owner.hp, 100, "armor counts toward the switching minimum");
  assert.equal(owner.coreHp, 50, "only the missing 40 HP is added to core health");
  assert.equal(a.hp, 60, "the abandoned body keeps total pre-switch HP");
}

for (const hp of [99, 100, 150, 249, 250]) {
  const { owner, enemy, game, a } = cloneFixture(SPLIT_ID);
  owner.hp = owner.coreHp = hp;
  updateAiCombatClone(owner, owner.aiState, game, [enemy], enemy);
  assert.equal(owner.splitSwitchCd > 0, hp < 100, "AI switches below 100, not at the floor");
  assert.equal(owner.hp, Math.max(100, hp));
  assert.equal(a.hp, hp < 100 ? 99 : 250);
}

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
  owner.coreHp = 70;
  syncNanotechDisplayedHp(owner);
  const before = owner.hp;
  trySplitSwitch(owner, game);
  assert.equal(owner.hp, before, "armor above the minimum must not secretly heal core HP");
  assert.equal(owner.coreHp, 70);
  assert.equal(a.hp, 120);
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
  assert.equal(owner.hp, 100, "controlled HP is really raised to 100");
  assert.equal(owner.maxHp, 500, "controlled body retains normal stats");
  assert.equal(a.hp, 10, "left body retains pre-switch HP below 100");
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
  assert.equal(b.hp, 100);
  assert.equal(owner.hp, 100);
  tickCombatCloneFighter(owner, 3);
  assert.equal(trySplitSwitch(owner, game), a);
  assert.equal(owner.x, oldX, "cycle eventually returns to the original location");
}

{
  const { owner, enemy, game, a, b } = cloneFixture(SPLIT_ID);
  hit(a, enemy, 10, 0, game);
  assert.equal(a.hp, 240);
  assert.equal(owner.hp, 500, "Split does not share damage");
  assert.equal(b.hp, 250);
  awardPowerup(a, "fireRate", game);
  assert.equal(owner.powerBuffs.fireRate, undefined, "Split does not share buffs");
  tickFighterPowerBuffs(a, 1);
  assert.equal(a.powerBuffs.fireRate.remaining, FIRE_RATE_DURATION - 1);
  a.trapLockT = 2;
  tickTrapperFighter(a, 1);
  assert.equal(a.trapLockT, 1, "uncontrolled Split debuffs expire normally");
  a.dead = true;
  assert.equal(trySplitSwitch(owner, game), b, "dead bodies are skipped");
  assert.equal(owner.hp, 500, "switching above 100 does not heal");
  assert.equal(b.hp, 250);
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
    assert.equal(owner.hp, 100);
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

function gearCloneFixture(id, loadout = {}) {
  const fixture = cloneFixture(id, { shield: "no-shield", ...loadout });
  const { a, enemy, game } = fixture;
  a.ai = "veteran";
  a.aim = 0;
  a.aiState.timer = 0;
  enemy.x = a.x + 250;
  enemy.y = a.y;
  enemy.aim = 0;
  game.elapsed = 1;
  game.props = [];
  game.platforms = [];
  game.groundDebris = [];
  game.settings = { gameplay: { optimizeIllusions: true } };
  return fixture;
}

for (const id of [COMBAT_CLONE_ID, SHADOW_CLONE_ID, SPLIT_ID]) {
  {
    const { a, enemy, game } = gearCloneFixture(id, { shield: "light-buckler" });
    enemy.weapon = "saber";
    enemy.x = a.x + 80;
    enemy.aim = Math.PI;
    const state = updateAI(a, .05, game, structuredClone(DEFAULT_PROFILE));
    assert.equal(a.shieldRaised, true, `${id} raises its shield against close melee`);
    assert.equal(state.attack, false);
    const expires = state.shieldHoldUntil;
    a.aiState.timer = 10;
    game.elapsed = expires + .01;
    updateAIClone(a, .05, game);
    assert.equal(a.shieldRaised, false, "clone shields expire between decision ticks");
  }
  {
    const { a, game } = gearCloneFixture(id, { weapon: "nanotech-rifle" });
    const startingHp = a.hp;
    a.nanobotWeapon = 0;
    a.nanobotFree = a.nanobotMax;
    updateAIClone(a, .05, game);
    assert.equal(nanotechFormPct(a), 1, `${id} reforms its nanotech weapon`);
    stepFighter(a, .05, game, structuredClone(DEFAULT_PROFILE), {}, null);
    assert.ok(game.bullets.some((bullet) => bullet.owner === a), "formed clone gun actually fires");
    assert.equal(a.hp, startingHp, "weapon nanotech cannot silently restore owner-sized health");
    assert.equal(a.loadout.extensionSecondary, "no-extension");
  }
  for (const [weapon, distance, expectedMode] of [
    [MODULAR_WEAPON_ID, 450, "rifle"],
    [ADAPTIVE_NANOTECH_ID, 600, "sniper"],
    [ADAPTIVE_NANOTECH_ID, 250, "rifle"]
  ]) {
    const { a, enemy, game } = gearCloneFixture(id, { weapon });
    enemy.x = a.x + distance;
    updateAIClone(a, .05, game);
    assert.equal(weapon === MODULAR_WEAPON_ID ? a.modularMorphTo : a.adaptiveMorphTo,
      expectedMode, `${id} chooses a weapon body appropriate to range`);
    assert.equal(a.aiState.attack, false, "clone does not attack while morphing");
  }
  {
    const { a, enemy, game } = gearCloneFixture(id, { secondaryWeapon: SHIELD_STEAL_ID });
    enemy.shieldMaxDurability = enemy.shieldDurability = 175;
    enemy.x = a.x + 100;
    updateAIClone(a, .05, game);
    assert.equal(a.activeWeaponSlot, "secondaryWeapon");
    assert.equal(a.aiState.plan, "stealing shield");
    assert.equal(a.aiState.attack, true);
  }
  {
    const { a, game } = gearCloneFixture(id, { secondaryWeapon: MATERIAL_CONSUMER_ID });
    a.materialEjectionTank = [{ sourceId: "scrap-test", bots: 1 }];
    updateAIClone(a, .05, game);
    assert.equal(a.activeWeaponSlot, "secondaryWeapon");
    assert.equal(a.aiState.chuck, true, "real clones use the scrap beam");
    assert.equal(a.aiState.plan, "debris beam");
  }
  {
    const { a, game } = gearCloneFixture(id, { secondaryWeapon: THROW_BREAKABLE_ID });
    const prop = createMapProp("crate", a.x + 50, a.y + SIZE);
    game.props = [prop];
    updateAIClone(a, .05, game);
    assert.equal(a.activeWeaponSlot, "secondaryWeapon");
    assert.equal(a.aiState.plan, "grabbing breakable");
    assert.equal(attackThrowBreakable(a, game), true);
    assert.equal(a.heldProp, prop);
    const heldX = prop.x;
    a.x += 80;
    tickThrowBreakable(a, game, .05);
    assert.equal(prop.x, heldX + 80, "held real props follow the exact clone movement");
    a.attackCd = 0;
    a.aiState.timer = 0;
    updateAIClone(a, .05, game);
    assert.equal(a.aiState.plan, "throwing breakable");
    assert.equal(attackThrowBreakable(a, game), true);
    assert.ok(game.thrownBreakables.length > 0);
  }
  {
    const { a, game } = gearCloneFixture(id, { secondaryWeapon: THROWING_SPEAR_ID });
    selectWeaponSlot(a, "secondaryWeapon");
    a.toolCd = 2;
    stepFighter(a, .05, game, structuredClone(DEFAULT_PROFILE), {}, null);
    assert.equal(a.toolCd, 1.95, "real-clone tool cooldowns tick normally");
  }
}

assert.equal(CLONE_NANOTECH_ARMOR_MULT, .1);
assert.equal(SHADOW_NANOTECH_ARMOR_MULT, .05);
assert.equal(CLONE_RETRACTABLE_ARMOR_MULT, .85);
assert.equal(SHADOW_RETRACTABLE_ARMOR_MULT, .1);

for (const id of [COMBAT_CLONE_ID, SHADOW_CLONE_ID, SPLIT_ID]) {
  const nanoMult = id === SHADOW_CLONE_ID ? .05 : .1;
  const retractMult = id === SHADOW_CLONE_ID ? .1 : .85;
  for (const scale of [1, .2]) {
    for (const optimizeIllusions of [true, false]) {
      const { owner, enemy, game, a } = cloneFixture(id, {
        body: "nanotech-chestplate", shield: "retractable-shell", weapon: "nanotech-rifle"
      }, scale);
      a.ai = "veteran";
      a.aiState.timer = 0;
      enemy.weapon = "saber";
      enemy.x = a.x + 70;
      enemy.y = a.y;
      enemy.aim = Math.PI;
      game.settings = { gameplay: { optimizeIllusions } };
      const coreHp = a.coreHp;
      assert.ok(hasNanotechChestplate(a) && hasRetractableArmor(a));
      assert.equal(a.retractableMax, owner.retractableMax * retractMult);
      assert.equal(nanotechArmorMaxHp(a), nanotechArmorMaxHp(owner) * nanoMult);
      updateAI(a, .05, game, structuredClone(DEFAULT_PROFILE));
      assert.equal(a.nanobotArmor, 100, `${id} loans bots into armor with either AI mode`);
      assert.equal(a.retractableMorphTo, "on", `${id} can deploy shell alongside nanotech`);
      tickNanotech(a, .05);
      tickRetractableArmor(a, .5);
      assert.equal(a.retractableDeployed, true);
      assert.ok(Math.abs(nanotechArmorHp(a) - 50 * scale * nanoMult) < 1e-10);
      assert.equal(a.coreHp, coreHp, "deploying armor never restores owner-sized core HP");
      assert.ok(Math.abs(a.hp - coreHp - a.retractableMax - nanotechArmorHp(a)) < 1e-10);
      assert.equal(nanotechFormPct(a), 1, "armor penalties do not weaken weapon formation");
      game.elapsed += 1;
      a.aiState.timer = 0;
      updateAI(a, .05, game, structuredClone(DEFAULT_PROFILE));
      assert.equal(a.nanobotArmor, 200, "clones can top up armor during sustained combat");
    }

    {
      const { owner, a, game } = cloneFixture(id, { body: "nanotech-chestplate" }, scale);
      const coreHp = a.coreHp;
      const ownerHp = owner.hp;
      const expectedArmor = 250 * scale * nanoMult;
      assert.equal(pulseNanotechArmor(a, 500).pulled, 500);
      assert.equal(nanotechArmorHp(a), expectedArmor);
      applyHpDamage(a, expectedArmor / 5, game, { alreadyScaled: true });
      assert.ok(Math.abs(a.nanobotArmor - 400) < 1e-10, "damage consumes proportionally more weakened armor bots");
      assert.equal(a.coreHp, coreHp, "armor absorbs damage before core HP");
      assert.ok(Math.abs(a.hp - coreHp - expectedArmor * .8) < 1e-10);
      applyHpDamage(a, nanotechArmorHp(a) + 7 * scale, game, { alreadyScaled: true });
      assert.ok(a.nanobotArmor < 1e-10);
      assert.ok(Math.abs(a.coreHp - coreHp + 7 * scale) < 1e-10);
      if (id === SHADOW_CLONE_ID) {
        assert.ok(Math.abs(owner.hp - ownerHp + expectedArmor + 7 * scale) < 1e-10,
          "shadow armor damage transfers only its actual HP loss to owner");
      } else {
        assert.equal(owner.hp, ownerHp);
      }
    }

    {
      const { a } = cloneFixture(id, { body: "nanotech-chestplate" }, scale);
      pulseNanotechArmor(a, 500);
      const coreHp = a.coreHp;
      const free = a.nanobotFree;
      assert.equal(setNanotechChanneling(a, true), true);
      tickNanotech(a, 1);
      assert.equal(a.nanobotArmor, 450);
      assert.equal(a.nanobotFree, free + 50, "recall returns actual bots, not HP-scaled amounts");
      assert.ok(Math.abs(nanotechArmorHp(a) - 225 * scale * nanoMult) < 1e-10);
      assert.equal(a.coreHp, coreHp);
    }

    for (const armor of [{ body: "retractable-armor" }, { shield: "retractable-shell" }]) {
      const { owner, a, game } = cloneFixture(id, armor, scale);
      const expectedArmor = owner.retractableMax * retractMult;
      const coreHp = a.coreHp;
      a.retractableDeployed = true;
      syncNanotechDisplayedHp(a);
      assert.equal(a.retractableMax, expectedArmor);
      assert.equal(a.hp, coreHp + expectedArmor);
      applyHpDamage(a, expectedArmor + 3 * scale, game, { alreadyScaled: true });
      assert.equal(a.retractableHp, 0);
      assert.ok(Math.abs(a.coreHp - coreHp + 3 * scale) < 1e-10);
      tickRetractableArmor(a, .5);
      assert.equal(a.retractableDeployed, false, "empty armor folds normally");
      assert.equal(a.hp, a.coreHp);
    }
  }
}

{
  const { owner, a, b, game } = cloneFixture(SHADOW_CLONE_ID, { body: "nanotech-chestplate" });
  applyHpDamage(a, 10, game, { alreadyScaled: true });
  pulseNanotechArmor(b, 500);
  tickCombatCloneWorld(game, .75);
  assert.equal(owner.shadowLink.hpReserve, 12.5, "armor does not count as deployed base-pool HP");
  assert.equal(b.hp, 62.5);
  owner.shadowLink.hpReserve = 0;
  assert.equal(tryDismissShadowClone(owner, game), b);
  assert.equal(owner.shadowLink.hpReserve, 50, "dismissal cannot bank armor as base HP");
  const c = tryCombatCloneSpawn(owner, game, Fighter);
  assert.equal(a.coreHp, 45);
  assert.equal(c.coreHp, 45);
}

{
  const { owner, a, b, game } = cloneFixture(SHADOW_CLONE_ID, { body: "retractable-armor" });
  applyHpDamage(a, 20, game, { alreadyScaled: true });
  a.retractableDeployed = b.retractableDeployed = true;
  syncNanotechDisplayedHp(a);
  syncNanotechDisplayedHp(b);
  const armorHp = a.retractableHp;
  const c = tryCombatCloneSpawn(owner, game, Fighter);
  for (const shadow of [a, b, c]) {
    assert.ok(Math.abs(shadow.coreHp - 80 / 3) < 1e-10, "spawn redistributes core HP, never armor");
    assert.ok(Math.abs(shadow.coreMaxHp - 100 / 3) < 1e-10);
  }
  assert.equal(a.retractableHp, armorHp, "spawn preserves surviving armor allocations");
}

{
  const { owner, a, game } = cloneFixture(SPLIT_ID, { body: "retractable-armor" });
  a.retractableDeployed = true;
  a.retractableHp = 10;
  syncNanotechDisplayedHp(a);
  owner.coreHp = 80;
  syncNanotechDisplayedHp(owner);
  trySplitSwitch(owner, game);
  assert.equal(a.coreHp, 80);
  assert.equal(a.hp, 90, "Split immediately synchronizes the abandoned body's existing armor");
  assert.equal(a.retractableHp, 10, "switching does not refill clone armor");
}

for (const optimizeIllusions of [true, false]) {
  const { a, game } = gearCloneFixture(SPLIT_ID, { weapon: "nanotech-rifle" });
  game.settings.gameplay.optimizeIllusions = optimizeIllusions;
  a.nanobotWeapon = 0;
  a.nanobotFree = a.nanobotMax;
  updateAI(a, .05, game, structuredClone(DEFAULT_PROFILE));
  assert.equal(nanotechFormPct(a), 1, "both optimized and full clone brains can form weapons");
  assert.equal(a.hp, 250);
}

{
  const { owner, enemy, game } = gearCloneFixture(COMBAT_CLONE_ID, {
    shield: "light-buckler", weapon: "nanotech-rifle"
  });
  const decoy = createFighterIllusion(owner, Fighter);
  game.fighters = [owner, decoy, enemy];
  enemy.x = decoy.x + 80;
  enemy.y = decoy.y;
  enemy.weapon = "saber";
  enemy.aim = Math.PI;
  decoy.ai = "veteran";
  decoy.aiState.timer = 0;
  decoy.nanobotWeapon = 0;
  updateAIDecoy(decoy, .05, game);
  assert.equal(decoy.shieldRaised, false, "Illusionist decoys keep their old equipment behavior");
  assert.equal(decoy.nanobotWeapon, 0, "decoys do not gain the new nanotech policy");
}

{
  const { owner, enemy, game } = gearCloneFixture(COMBAT_CLONE_ID, {
    body: "nanotech-chestplate", shield: "retractable-shell", weapon: "nanotech-rifle"
  });
  const decoy = createFighterIllusion(owner, Fighter);
  game.fighters = [owner, decoy, enemy];
  enemy.x = decoy.x + 70;
  enemy.y = decoy.y;
  decoy.aiState.timer = 0;
  updateAIDecoy(decoy, .05, game);
  assert.equal(decoy.nanobotArmor, 0, "Illusionist decoys do not learn armor deployment");
  assert.equal(decoy.retractableMorphing, false);
  assert.equal(nanotechArmorMaxHp(decoy), nanotechArmorMaxHp(owner),
    "real-clone nanotech penalties do not alter decoys or owners");
  assert.equal(decoy.retractableMax, owner.retractableMax,
    "real-clone retractable penalties do not alter decoys or owners");
}

function summonSightFixture(id, optimizeIllusions) {
  const owner = applyLoadout(new Fighter({
    x: 0, y: 700, team: 0, human: true, ai: "veteran"
  }), { ...DEFAULT_LOADOUT, extensionSecondary: id });
  const summon = id === "illusionist" ? createFighterIllusion(owner, Fighter)
    : createCombatClone(owner, Fighter);
  assert.equal(summon.sight, owner.sight, "summons inherit equipped sight range");
  assert.equal(summon.directionalSightRange, owner.directionalSightRange);
  owner.sight = 100;
  owner.directionalSightRange = 0;
  summon.x = 1400;
  summon.y = 700;
  summon.sight = 200;
  summon.directionalSightRange = 0;
  summon.ai = "veteran";
  summon.aiState.timer = 0;
  summon.illusionist = false;
  const enemy = new Fighter({ x: 1600, y: 700, team: 1, hp: 500, maxHp: 500 });
  const game = {
    fighters: [owner, summon, enemy], props: [], platforms: [], effects: [], bullets: [],
    pings: [], groundDebris: [], stats: {}, elapsed: 1, mode: "conquest",
    settings: { gameplay: { optimizeIllusions } }
  };
  return { owner, summon, enemy, game };
}

for (const id of [COMBAT_CLONE_ID, SHADOW_CLONE_ID, SPLIT_ID, "illusionist"]) {
  for (const optimizeIllusions of [true, false]) {
    {
      const { owner, summon, enemy, game } = summonSightFixture(id, optimizeIllusions);
      assert.equal(visibleToSelf(owner, enemy, game), false);
      assert.equal(visibleToSelf(summon, enemy, game), true, "normal sight includes its exact boundary");
      assert.equal(visibleToTeam(game, owner, enemy), true, `${id} shares sight with either optimization mode`);
      assert.equal(fighterVisibleToViewer(game, owner, enemy), true, "summon sight reveals enemies to player");
      updateAI(summon, .05, game, structuredClone(DEFAULT_PROFILE));
      assert.equal(summon.aiState.target, enemy, "summon acquires a visible enemy");
      assert.equal(summon.aiState.attack, true);
      enemy.x += .01;
      assert.equal(visibleToSelf(summon, enemy, game), false);
      assert.equal(visibleToTeam(game, owner, enemy), false);
      assert.equal(fighterVisibleToViewer(game, owner, enemy), false, "outside all eyes remains hidden");
      const lastKnown = summon.aiState.lastKnown ? { ...summon.aiState.lastKnown } : null;
      enemy.x = 2500;
      enemy.y = 300;
      summon.aiState.timer = 0;
      updateAI(summon, .05, game, structuredClone(DEFAULT_PROFILE));
      assert.equal(summon.aiState.attack, false);
      if (lastKnown) {
        assert.deepEqual(summon.aiState.lastKnown, lastKnown,
          "last-seen memory cannot follow a hidden enemy's new position");
      } else {
        assert.equal(summon.aiState.target, null);
        assert.equal(summon.aiState.mx, 0, "light summons do not chase unseen coordinates");
      }
    }
    {
      const { owner, summon, enemy, game } = summonSightFixture(id, optimizeIllusions);
      enemy.x += 1;
      updateAI(summon, .05, game, structuredClone(DEFAULT_PROFILE));
      assert.equal(summon.aiState.target, null, "never-observed out-of-range fighters cannot become targets");
      assert.equal(summon.aiState.attack, false);
      assert.equal(visibleToTeam(game, owner, enemy), false);
    }
    {
      const { owner, summon, enemy, game } = summonSightFixture(id, optimizeIllusions);
      game.props.push({
        x: 1500, y: 600, w: 40, h: 250, hp: 100, blocksSight: true, solid: true
      });
      assert.equal(visibleToSelf(summon, enemy, game), false);
      assert.equal(visibleToTeam(game, owner, enemy), false, "walls block summon-shared vision");
      updateAI(summon, .05, game, structuredClone(DEFAULT_PROFILE));
      assert.equal(summon.aiState.target, null, "summons cannot acquire enemies through walls");
      assert.equal(summon.aiState.attack, false);
    }
    {
      const { summon, enemy, game } = summonSightFixture(id, optimizeIllusions);
      const hidden = new Fighter({ x: 1460, y: 850, team: 1 });
      game.fighters.push(hidden);
      game.props.push({
        x: 1430, y: 780, w: 50, h: 50, hp: 100, blocksSight: true, solid: true
      });
      assert.equal(visibleToTeam(game, summon, hidden), false);
      assert.equal(visibleToTeam(game, summon, enemy), true);
      updateAI(summon, .05, game, structuredClone(DEFAULT_PROFILE));
      assert.equal(summon.aiState.target, enemy, "closer hidden enemies cannot distract target selection");
    }
    {
      const { owner, summon, enemy, game } = summonSightFixture(id, optimizeIllusions);
      summon.sight = 100;
      summon.directionalSightRange = 500;
      summon.sightHalfAngle = .1;
      summon.aim = 0;
      enemy.x = summon.x + 500;
      assert.equal(visibleToTeam(game, owner, enemy), true, "summons share equipped directional sight");
      enemy.x += .01;
      assert.equal(visibleToTeam(game, owner, enemy), false);
      enemy.x = summon.x - 400;
      assert.equal(visibleToTeam(game, owner, enemy), false, "rear foes outside normal sight stay hidden");
      enemy.x = summon.x + 400;
      enemy.y += 200;
      assert.equal(visibleToTeam(game, owner, enemy), false, "sight cones are not omnidirectional");
      enemy.y = summon.y;
      game.gimmick = { sightMult: .5 };
      assert.equal(visibleToTeam(game, owner, enemy), false, "map sight penalties also affect summons");
      enemy.x = summon.x + 200;
      assert.equal(visibleToTeam(game, owner, enemy), true);
      summon.dead = true;
      assert.equal(visibleToTeam(game, owner, enemy), false, "dead summons provide no team sight");
    }
    {
      const { owner, summon, enemy, game } = summonSightFixture(id, optimizeIllusions);
      const teammate = new Fighter({ x: 1900, y: 700, team: owner.team, sight: 100 });
      teammate.directionalSightRange = 0;
      game.fighters.push(teammate);
      enemy.x = 1950;
      assert.equal(visibleToSelf(summon, enemy, game), false);
      assert.equal(visibleToTeam(game, summon, enemy), true);
      updateAI(summon, .05, game, structuredClone(DEFAULT_PROFILE));
      assert.equal(summon.aiState.target, enemy, "summons can use teammate sightings just like players");
      teammate.dead = true;
      assert.equal(visibleToTeam(game, summon, enemy), false);
    }
  }
}

console.log("combat-clone.test.js passed: real clones, armor AI, and sight-limited summons.");
