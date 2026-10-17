import assert from "node:assert/strict";
import { updateAiIllusionist } from "./ai.js";
import { selectAiTarget } from "./ai-perception.js";
import { attack, Fighter, hit, stepBullets, stepFighter } from "./combat.js";
import { DEFAULT_PROFILE, SIZE } from "./config.js";
import {
  applyActiveWeaponGear, applyHpDamage, applyLoadout, DEFAULT_LOADOUT, GEAR_BY_ID,
  selectWeaponSlot, tickMaterialConsumerVacuum
} from "./equipment.js";
import {
  fadeHologram, HOLOGRAM_COOLDOWN, HOLOGRAM_FADE_SECONDS, HOLOGRAM_ID,
  HOLOGRAM_LIFE, HOLOGRAM_MAX_ACTIVE, hologramOpacity
} from "./hologram.js";
import {
  applyPhantomDamage, createFighterIllusion, displayedHp, displayedMaxHp, hasIllusionTruthSight,
  isDecoyProjector, isRealCombatant, registerIllusionFighterHit,
  tickIllusionistFighter, tickIllusionistWorld, tryIllusionistPlant
} from "./illusionist.js";
import { castSpellbook } from "./spellbook.js";
import { createMapProp } from "./maps.js";
import { tickShieldStealBeam } from "./shield-steal.js";
import { stepThrownBreakables, tickThrowBreakable } from "./throw-breakable.js";
import {
  attackToolSecondary, createToolPickup, takeToolPickup, tickToolProjectiles,
  TOOL_DEFS
} from "./tool-secondaries.js";

function fixture(weapon = "pulse-rifle", behavior = "generic") {
  const owner = applyLoadout(new Fighter({
    x: 400, y: 700, team: 0, aim: 0, grounded: true, name: "YOU", human: true
  }), { ...DEFAULT_LOADOUT, extensionSecondary: HOLOGRAM_ID, weapon, cloneBehavior: behavior });
  const enemy = applyLoadout(new Fighter({
    x: 650, y: 700, team: 1, aim: Math.PI, grounded: true
  }), DEFAULT_LOADOUT);
  const game = {
    fighters: [owner, enemy], effects: [], bullets: [], illusions: [], props: [],
    powerCrates: [], platforms: [], pings: [], stats: {}, thoughts: [],
    mode: "conquest", elapsed: 1, learningLocked: true
  };
  return { owner, enemy, game, profile: structuredClone(DEFAULT_PROFILE) };
}

assert.equal(GEAR_BY_ID[HOLOGRAM_ID].price, 100);
assert.equal(GEAR_BY_ID[HOLOGRAM_ID].slot, "extensionSecondary");
assert.equal(GEAR_BY_ID[HOLOGRAM_ID].hologram, true);
assert.equal(HOLOGRAM_COOLDOWN, 2.5);
assert.equal(HOLOGRAM_MAX_ACTIVE, 2);
assert.equal(HOLOGRAM_LIFE, 15);
assert.equal(HOLOGRAM_FADE_SECONDS, .35);

{
  const { owner, enemy, game } = fixture();
  enemy.aiState.target = owner;
  enemy.aiState.lastKnown = { x: owner.x, y: owner.y };
  owner.illusionistType = "prop";
  const first = tryIllusionistPlant(owner, game, Fighter);
  assert.ok(first?.hologram);
  assert.equal(first.illusionLife, 15);
  assert.equal(first.illusionHitsLeft, 1);
  assert.equal(first.cloneBehavior, "generic");
  assert.deepEqual(first.loadout, owner.loadout);
  assert.equal(hasIllusionTruthSight(owner), false);
  assert.equal(isDecoyProjector(first), false);
  assert.equal(isRealCombatant(first), false);
  assert.equal(tryIllusionistPlant(first, game, Fighter), null, "no nested projectors");
  assert.equal(game.effects.length, 0, "no smoke or identification effects");
  assert.equal(enemy.aiState.target, owner, "no automatic smoke track reset");
  assert.ok(enemy.aiState.lastKnown);
  assert.equal(tryIllusionistPlant(owner, game, Fighter), null);
  tickIllusionistFighter(owner, 2.49, game);
  assert.equal(tryIllusionistPlant(owner, game, Fighter), null);
  tickIllusionistFighter(owner, .01, game);
  assert.ok(tryIllusionistPlant(owner, game, Fighter));
  tickIllusionistFighter(owner, 2.5, game);
  assert.equal(tryIllusionistPlant(owner, game, Fighter), null, "exact two-active cap");
}

{
  const { owner, enemy, game, profile } = fixture();
  const hologram = tryIllusionistPlant(owner, game, Fighter);
  owner.hp -= 50;
  owner.phantomDamage = 40;
  const truth = { illusionist: true };
  for (const viewer of [null, owner, enemy, truth]) {
    assert.equal(displayedHp(hologram, viewer), displayedHp(owner, viewer));
    assert.equal(displayedMaxHp(hologram, viewer), displayedMaxHp(owner, viewer));
  }
  const x = hologram.x;
  hologram.aiState.attack = true;
  assert.equal(registerIllusionFighterHit(hologram, game), true);
  assert.equal(hologram.dead, true, "stops simulation immediately on the first hit");
  assert.equal(hologramOpacity(hologram), 1);
  assert.equal(registerIllusionFighterHit(hologram, game), false, "repeat hits cannot restart the fade");
  stepFighter(hologram, .1, game, profile);
  assert.equal(hologram.x, x);
  assert.equal(game.bullets.length, 0);
  tickIllusionistWorld(game, .0875);
  assert.ok(Math.abs(hologramOpacity(hologram) - .84375) < 1e-12, "smoothstep, not linear fading");
  tickIllusionistWorld(game, .0875);
  assert.ok(Math.abs(hologramOpacity(hologram) - .5) < 1e-12);
  assert.ok(game.fighters.includes(hologram));
  tickIllusionistWorld(game, .175);
  assert.equal(hologramOpacity(hologram), 0);
  assert.equal(game.fighters.includes(hologram), false);
  assert.equal(game.effects.length, 0, "no break smoke or hit flash effects");
}

{
  const { owner, game, profile } = fixture();
  const hologram = tryIllusionistPlant(owner, game, Fighter);
  hologram.illusionLife = .01;
  hologram.aiState.attack = true;
  stepFighter(hologram, .02, game, profile);
  assert.ok(hologram.dead, "lifetime expiration also stops acting before the next attack");
  assert.equal(game.bullets.length, 0);
}

for (const illusionShot of [false, true]) {
  const { owner, enemy, game } = fixture();
  const hologram = createFighterIllusion(owner, Fighter);
  hologram.x = 470;
  owner.x = 560;
  enemy.illusion = illusionShot;
  const bullet = {
    x: 440, y: hologram.y + SIZE / 2, vx: 1000, vy: 0,
    owner: enemy, life: 2, traveled: 0, damage: 20
  };
  game.fighters = [hologram, enemy];
  game.bullets.push(bullet);
  stepBullets(game, .08);
  assert.ok(hologram.dead);
  assert.equal(game.bullets.includes(bullet), true, "incoming round continues");
  assert.equal(bullet.ghost, undefined, "incoming round stays visible");
  assert.equal(bullet.x, 520);
  game.fighters.push(owner);
  const before = owner.hp;
  stepBullets(game, .08);
  if (illusionShot) {
    assert.equal(owner.hp, before);
    assert.ok(owner.phantomDamage > 0, "ordinary illusion projectile still works behind the Hologram");
  } else assert.ok(owner.hp < before, "real projectile can hit the owner behind the Hologram");
}

for (const weapon of ["pulse-rifle", "laser", "arc-saber"]) {
  const { owner, enemy, game } = fixture(weapon);
  const hologram = createFighterIllusion(owner, Fighter);
  hologram.x = 500;
  enemy.x = 550;
  const other = createFighterIllusion(enemy, Fighter);
  other.x = enemy.x;
  const prop = {
    x: 550, y: 700, w: 60, h: 60, hp: 100, maxHp: 100,
    solid: true, blocksProjectiles: true, breakable: true, kind: "crate"
  };
  game.props.push(prop);
  game.powerCrates.push({ ...prop, powerCrate: true });
  game.illusions.push({
    illusionObject: true, x: 550, y: 700, w: 60, h: 60, life: 10, owner: enemy
  });
  game.fighters.push(hologram, other);
  const before = enemy.hp;
  attack(hologram, game, () => .5);
  stepBullets(game, .08);
  assert.equal(enemy.hp, before, `${weapon}: no real damage`);
  assert.equal(enemy.phantomDamage || 0, 0, `${weapon}: no phantom damage`);
  assert.equal(enemy.hitFlash, 0);
  assert.equal(enemy.vx, 0);
  assert.equal(other.dead, false, "cosmetic attacks cannot pop decoys");
  assert.equal(prop.hp, 100);
  assert.equal(prop.illusionFakeHp, undefined);
  assert.equal(game.powerCrates[0].hp, 100);
  assert.equal(game.illusions[0].destroyed, undefined);
  assert.equal((game.beamReveals || []).length, 0);
  assert.ok(game.effects.length > 0, "attacks retain visible effects");
  if (weapon === "pulse-rifle") assert.equal(game.bullets.length, 1, "outgoing shot passes through cover and fighters");
}

for (const behind of [false, true]) {
  const { owner, enemy, game } = fixture();
  const hologram = createFighterIllusion(owner, Fighter);
  owner.x = 560;
  hologram.x = behind ? 620 : 470;
  enemy.x = 800;
  game.fighters = [owner, hologram, enemy];
  game.bullets.push({
    x: 440, y: 700 + SIZE / 2, vx: 1000, vy: 0,
    owner: enemy, life: 2, traveled: 0, damage: 20
  });
  const before = owner.hp;
  stepBullets(game, .28);
  assert.ok(owner.hp < before);
  assert.equal(hologram.dead, !behind,
    "only Holograms before the real impact fade, regardless of fighter-array order");
}

for (const spell of ["ice", "fire", "lightning"]) {
  const { owner, enemy, game } = fixture("spellbook");
  const hologram = createFighterIllusion(owner, Fighter);
  enemy.x = hologram.x + 70;
  const prop = {
    x: enemy.x, y: enemy.y, w: 50, h: 50, hp: 100, maxHp: 100,
    kind: "crate", solid: true, breakable: true
  };
  game.props.push(prop);
  game.fighters.push(hologram);
  hologram.spellType = spell;
  const before = enemy.hp;
  assert.equal(castSpellbook(hologram, game), true);
  assert.equal(enemy.hp, before);
  assert.equal(enemy.spellPinT || 0, 0);
  assert.equal(enemy.spellSlowT || 0, 0);
  assert.equal(enemy.phantomDamage || 0, 0);
  assert.equal(prop.hp, 100);
  assert.equal(prop.burning, undefined);
  assert.ok(game.effects.length > 0);
}

for (const tool of Object.keys(TOOL_DEFS)) {
  const { owner, enemy, game } = fixture();
  const hologram = createFighterIllusion(owner, Fighter);
  hologram.heldToolPickup = { toolId: tool, uses: 3, maxUses: 3 };
  enemy.x = hologram.x + 60;
  game.fighters.push(hologram);
  const before = enemy.hp;
  assert.equal(attackToolSecondary(hologram, game), true);
  for (let i = 0; i < 40; i++) tickToolProjectiles(game, .1);
  assert.equal(enemy.hp, before, `${tool}: no damage`);
  assert.equal(enemy.trapLockT || 0, 0, `${tool}: no snare`);
  assert.equal(enemy.hookDrag ?? null, null, `${tool}: no dragging`);
  assert.equal(hologram.hookReel ?? null, null, `${tool}: no real latch`);
  assert.equal(game.toolPickups?.length || 0, 0, `${tool}: no real loot`);
}

for (const tool of ["spear", "sticky", "bolas"]) {
  const { owner, enemy, game } = fixture();
  const hologram = createFighterIllusion(owner, Fighter);
  game.fighters = [hologram];
  const projectile = {
    kind: tool, owner: enemy, team: 1,
    x: hologram.x + SIZE / 2, y: hologram.y + SIZE / 2,
    vx: 10, vy: 0, life: 1, fuse: 1, damage: 30
  };
  game.toolProjectiles = [projectile];
  tickToolProjectiles(game, .001);
  assert.ok(hologram.dead, `${tool}: first hit fades Hologram`);
  assert.equal(game.toolProjectiles.includes(projectile), true, `${tool}: projectile passes through`);
  assert.equal(projectile.stuck || false, false);
}

{
  const { owner, enemy, game } = fixture();
  owner.loadout.secondaryWeapon = "throw-breakable";
  selectWeaponSlot(owner, "secondaryWeapon");
  const hologram = createFighterIllusion(owner, Fighter);
  assert.equal(hologram.weaponId, owner.weaponId, "spawn copies the weapon currently in hand");
  assert.equal(hologram.activeWeaponSlot, "secondaryWeapon");
  const prop = createMapProp("crate", hologram.x + 50, hologram.y + SIZE);
  const before = structuredClone(prop);
  game.props.push(prop);
  game.fighters.push(hologram);
  hologram.attackCd = 0;
  attack(hologram, game);
  assert.ok(hologram.heldProp);
  assert.notEqual(hologram.heldProp, prop);
  assert.equal(hologram.heldProp.illusionSourceProp, null);
  assert.equal(hologram.heldProp.blocksProjectiles, false, "fake held cover cannot protect the owner");
  assert.deepEqual(prop, before, "cosmetic grab never moves or ghosts real cover");
  hologram.attackCd = 0;
  attack(hologram, game);
  assert.equal(game.thrownBreakables.length, 1);
  const hp = enemy.hp;
  for (let i = 0; i < 25; i++) {
    stepThrownBreakables(game, .1, () => assert.fail("cosmetic throw must never hit"));
  }
  assert.deepEqual(prop, before);
  assert.equal(enemy.hp, hp);
  assert.equal(enemy.phantomDamage || 0, 0);
  owner.heldProp = prop;
  const holding = createFighterIllusion(owner, Fighter);
  assert.ok(holding.heldProp);
  assert.notEqual(holding.heldProp, prop);
  fadeHologram(holding);
  tickThrowBreakable(holding, game, .1);
  assert.ok(holding.heldProp, "held cosmetics remain renderable through the body's fade");
}

{
  const { owner, enemy, game } = fixture();
  const hologram = createFighterIllusion(owner, Fighter);
  applyActiveWeaponGear(hologram, "shield-steal");
  enemy.x = hologram.x + 100;
  enemy.shieldMaxDurability = enemy.shieldDurability = 200;
  enemy.shieldRaised = false;
  game.fighters.push(hologram);
  const before = enemy.shieldDurability;
  tickShieldStealBeam(hologram, game, 1);
  assert.equal(hologram.shieldStealTarget, enemy, "retains the ordinary beam visual");
  assert.equal(enemy.shieldDurability, before);
  assert.equal(enemy.shieldFlash, 0);
  assert.equal(applyPhantomDamage(enemy, 50, game, hologram), 0);
  assert.equal(enemy.phantomDamage || 0, 0);
}

for (const spell of ["ice", "fire", "lightning"]) {
  const { owner, enemy, game } = fixture();
  const hologram = createFighterIllusion(owner, Fighter);
  applyLoadout(enemy, { ...DEFAULT_LOADOUT, weapon: "spellbook" });
  enemy.aim = 0;
  hologram.x = enemy.x + 70;
  enemy.spellType = spell;
  game.fighters = [enemy, hologram];
  castSpellbook(enemy, game);
  assert.ok(hologram.dead, `${spell}: incoming spells start the same one-hit fade`);
  assert.equal(hologram.hologramFadeLeft, .35);
}

{
  const { owner, enemy, game } = fixture();
  const hologram = createFighterIllusion(owner, Fighter);
  const prop = createMapProp("crate", hologram.x, hologram.y + SIZE);
  const thrown = {
    prop, owner: enemy, x: hologram.x + SIZE / 2, y: hologram.y + SIZE / 2,
    vx: 10, vy: 0, life: 2, damage: 48
  };
  game.fighters.push(hologram);
  game.thrownBreakables = [thrown];
  stepThrownBreakables(game, .001, hit);
  assert.ok(hologram.dead, "incoming thrown cover hits the projection");
  assert.equal(game.thrownBreakables.includes(thrown), true, "thrown cover continues visibly");
  assert.equal(prop.destroyed, false);
  assert.equal(prop.illusionGhosted, undefined);
}

{
  const { owner, enemy, game } = fixture();
  const hologram = createFighterIllusion(owner, Fighter);
  hologram.x = 470;
  owner.x = 560;
  enemy.x = 350;
  enemy.aim = 0;
  applyActiveWeaponGear(enemy, "laser");
  enemy.attackCd = 0;
  game.fighters = [owner, hologram, enemy];
  const before = owner.hp;
  attack(enemy, game);
  assert.ok(hologram.dead, "hitscan fades Hologram while continuing to the real impact");
  assert.ok(owner.hp < before);
}

{
  const { owner, enemy, game } = fixture();
  const hologram = createFighterIllusion(owner, Fighter);
  enemy.illusionist = true;
  assert.equal(selectAiTarget(enemy, [owner, hologram], {
    style: "rusher", random: () => .99
  }), hologram, "truth sight cannot filter or automatically identify Holograms");
  enemy.aiState.target = owner;
  hologram.x = owner.x;
  const rolls = [.01, .99];
  assert.equal(selectAiTarget(enemy, [owner, hologram], {
    style: "rusher", trackingSkill: 0, random: () => rolls.shift()
  }), hologram, "truth sight still loses visual identity at a crossing");
  const before = enemy.hp;
  hit(enemy, hologram, 50, 0, game);
  assert.equal(enemy.hp, before);
  assert.equal(enemy.phantomDamage || 0, 0);
  assert.equal(applyHpDamage(hologram, 1, game), 0);
  assert.ok(hologram.dead, "direct area/hazard damage also fades without entering real HP logic");
}

{
  const { owner, enemy, game } = fixture();
  owner.human = false;
  updateAiIllusionist(owner, owner.aiState, game, [enemy], enemy);
  assert.ok(game.fighters.some((fighter) => fighter.hologram), "NPC owners use fighter-only projection");
  const hologram = game.fighters.find((fighter) => fighter.hologram);
  applyActiveWeaponGear(hologram, "material-consumer-nanotech");
  hologram.nanobotFree = 0;
  const debris = { x: hologram.x, y: hologram.y, life: 10 };
  game.groundDebris = [debris];
  assert.equal(tickMaterialConsumerVacuum(hologram, game, .1), 0);
  assert.deepEqual(game.groundDebris, [debris], "cannot consume real debris");
  const pickup = createToolPickup("throwing-spear", hologram.x, hologram.y);
  game.toolPickups = [pickup];
  assert.equal(takeToolPickup(hologram, game, pickup), null);
  assert.deepEqual(game.toolPickups, [pickup], "cannot take real pickups");
  fadeHologram(hologram);
}

console.log("hologram.test.js passed: balance, lifecycle, truth sight, passthrough, cosmetic weapons and isolation.");
