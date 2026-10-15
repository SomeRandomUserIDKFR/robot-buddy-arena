import assert from "node:assert/strict";
import { attack, Fighter, hit, stepBullets, stepFighter } from "./combat.js";
import {
  applyHpDamage, applyLoadout, DEFAULT_LOADOUT, GEAR_BY_ID, toggleShieldRaise
} from "./equipment.js";
import { SIZE } from "./config.js";
import {
  canDisguiseAs, damageDisguise, DISGUISE_COOLDOWN, DISGUISE_ID, DISGUISE_RANGE,
  DISGUISE_SPEED_MULT, endDisguise, fighterHitbox, findDisguiseProp,
  syncDisguisePosition, tickDisguise, tryDisguise
} from "./disguise.js";
import { createMapProp, damageProp, projectileBlockers, solidProps, sightBlockers } from "./maps.js";
import { canGrabBreakable } from "./throw-breakable.js";
import { updateAI, updateAIClone, updateAiDisguise } from "./ai.js";
import { shopPoolForStage } from "./campaign.js";

function fixture(kind = "crate", scale = 1, weapon = "pulse-rifle") {
  const owner = applyLoadout(new Fighter({
    x: 200, y: 700, team: 0, human: true, name: "YOU", aim: 0, grounded: true
  }), { ...DEFAULT_LOADOUT, weapon, shield: "light-buckler", extensionSecondary: DISGUISE_ID },
  { healthScale: scale });
  const prop = createMapProp(kind, owner.x + 60, owner.y + SIZE);
  prop.hp *= scale;
  prop.maxHp *= scale;
  const enemy = new Fighter({ x: 600, y: 700, team: 1, aim: Math.PI });
  const game = {
    fighters: [owner, enemy], props: [prop], platforms: [{ x: 0, y: 700 + SIZE, w: 3600, h: 180 }],
    effects: [], bullets: [], pings: [], stats: {}, powerCrates: [],
    elapsed: 1, mode: "conquest", healthScale: scale,
    settings: { visual: { useClassic100Hp: scale === .2 } }
  };
  return { owner, enemy, prop, game };
}

assert.equal(GEAR_BY_ID[DISGUISE_ID].slot, "extensionSecondary");
assert.equal(GEAR_BY_ID[DISGUISE_ID].disguise, true);
assert.equal(DISGUISE_RANGE, 100);
assert.equal(DISGUISE_SPEED_MULT, .55);
assert.equal(DISGUISE_COOLDOWN, 5);
assert.ok(shopPoolForStage("c8-apex").includes(DISGUISE_ID));
assert.ok(!shopPoolForStage("c1-shakedown").includes(DISGUISE_ID));

{
  const { owner, prop, game } = fixture();
  assert.equal(findDisguiseProp(owner, game), prop);
  prop.hp = 17;
  assert.equal(tryDisguise(owner, game), prop);
  assert.equal(owner.disguiseProp, prop, "borrow the real object, not a copy");
  assert.equal(prop.hp, 17, "keep remaining HP instead of refreshing the prop");
  assert.equal(game.props.includes(prop), false, "temporarily remove cover from the world");
  assert.equal(projectileBlockers(game).length, 0);
  assert.equal(solidProps(game).length, 0);
  assert.equal(sightBlockers(game).length, 0);
  assert.equal(canGrabBreakable(prop), false, "another fighter cannot grab the disguise");
  owner.x += 300;
  owner.y -= 100;
  assert.equal(tryDisguise(owner, game), prop, "3 toggles the disguise off");
  assert.equal(owner.disguiseProp, null);
  assert.equal(game.props.filter((p) => p === prop).length, 1);
  assert.equal(prop.x + prop.w / 2, owner.x + SIZE / 2);
  assert.equal(prop.y + prop.h, owner.y + SIZE);
  assert.equal(prop.hp, 17);
  assert.equal(prop.solid, true);
  assert.equal(prop.blocksSight, true);
  assert.equal(owner.disguiseCd, 5);
  assert.equal(tryDisguise(owner, game), null);
  tickDisguise(owner, game, 5);
  assert.ok(tryDisguise(owner, game), "cooldown starts on reveal, not activation");
}

{
  const { owner, prop, game } = fixture("tree");
  const canopyOffset = { x: prop.canopy.x - prop.x, y: prop.canopy.y - prop.y };
  tryDisguise(owner, game);
  owner.x += 120;
  syncDisguisePosition(owner);
  assert.equal(prop.canopy.x - prop.x, canopyOffset.x);
  assert.equal(prop.canopy.y - prop.y, canopyOffset.y);
  assert.equal(fighterHitbox(owner).h, prop.h, "wear the full prop, not a robot-size sprite");
  endDisguise(owner, game);
  assert.equal(prop.canopy.x - prop.x, canopyOffset.x, "canopy relocates with the real tree");
}

for (const scale of [1, .2]) {
  const { owner, enemy, prop, game } = fixture("crate", scale);
  tryDisguise(owner, game);
  const playerHp = owner.hp;
  const propHp = prop.hp;
  hit(owner, enemy, 10, 0, game);
  assert.equal(owner.hp, playerHp);
  assert.equal(prop.hp, propHp - 10 * scale, "prop damage uses the existing health scale once");
  applyHpDamage(owner, 2 * scale, game, { alreadyScaled: true });
  assert.ok(Math.abs(prop.hp - (propHp - 12 * scale)) < 1e-6);
  owner.x += 400;
  hit(owner, enemy, 1000, 0, game);
  assert.equal(owner.hp, playerHp, "non-explosive disguise breaks absorb the final hit, no overflow");
  assert.equal(owner.disguiseProp, null);
  assert.equal(prop.destroyed, true);
  assert.equal(prop.hp, 0);
  assert.equal(prop.x + prop.w / 2, owner.x + SIZE / 2);
  assert.equal(game.props.filter((p) => p === prop).length, 1);
  assert.ok(game.groundDebris?.length > 0, "normal real debris is created");
  const debrisEffect = game.effects.find((e) => e.type === "debris");
  assert.equal(debrisEffect.x, prop.x + prop.w / 2);
  assert.equal(debrisEffect.y, prop.y + prop.h / 2);
  assert.equal(owner.disguiseCd, 5);
}

{
  const { owner, prop, game } = fixture();
  prop.braced = true;
  prop.braceHp = prop.braceMaxHp = 20;
  prop.braceMaterial = "metal";
  tryDisguise(owner, game);
  damageDisguise(owner, 10, game);
  assert.equal(prop.braceHp, 10);
  assert.equal(prop.hp, prop.maxHp, "existing bracing absorbs before the prop core");
  endDisguise(owner, game);
  assert.equal(prop.braceHp, 10, "revealing doesn't reset bracing durability");
}

{
  const { owner, prop, game } = fixture();
  tryDisguise(owner, game);
  owner.x += 80;
  damageProp(prop, 1000, game);
  assert.equal(owner.disguiseProp, null, "fire and direct prop damage also reveal on break");
  assert.ok(prop.destroyed);
  assert.equal(prop.x + prop.w / 2, owner.x + SIZE / 2);
  const debris = game.effects.find((effect) => effect.type === "debris");
  assert.equal(debris.x, prop.x + prop.w / 2, "direct damage breaks at the current location too");
  assert.equal(debris.y, prop.y + prop.h / 2);
}

{
  const { owner, prop, game } = fixture("redBarrel");
  tryDisguise(owner, game);
  owner.x += 200;
  damageDisguise(owner, 1000, game);
  assert.equal(owner.disguiseProp, null);
  assert.ok(prop.destroyed && prop._blastDone, "explosive props keep their normal destruction behavior");
  assert.ok(owner.hp < owner.maxHp, "the barrel explosion can hurt the revealed robot");
  assert.equal(game.effects.find((e) => e.type === "explosion").x, prop.x + prop.w / 2);
}

for (const weapon of ["pulse-rifle", "arc-saber", "laser"]) {
  const { owner, prop, game } = fixture("crate", 1, weapon);
  tryDisguise(owner, game);
  owner.x += 200;
  attack(owner, game, () => .5);
  assert.equal(owner.disguiseProp, null, `${weapon} reveals before attacking`);
  assert.equal(prop.destroyed, false);
  assert.equal(prop.x + prop.w / 2, owner.x + SIZE / 2);
}

{
  const { owner, prop, game } = fixture();
  tryDisguise(owner, game);
  owner.x += 200;
  assert.ok(toggleShieldRaise(owner));
  assert.equal(owner.disguiseProp, null);
  assert.equal(owner.shieldRaised, true);
  assert.equal(prop.x + prop.w / 2, owner.x + SIZE / 2);
}

{
  const { owner, prop, game } = fixture("tree");
  tryDisguise(owner, game);
  const box = fighterHitbox(owner);
  game.bullets.push({
    x: box.x - 30, y: box.y + 20, vx: 500, vy: 0,
    owner: game.fighters[1], life: 1, traveled: 0, damage: 10
  });
  stepBullets(game, .1);
  assert.equal(prop.hp, prop.maxHp - 10, "bullets hit the prop above the normal robot hitbox");
  assert.equal(owner.hp, owner.maxHp);
}

{
  const { owner, prop, game } = fixture("tree");
  tryDisguise(owner, game);
  const box = fighterHitbox(owner);
  const laser = applyLoadout(new Fighter({
    x: box.x - 100, y: box.y + 20 - SIZE / 2, team: 1, aim: 0
  }), { ...DEFAULT_LOADOUT, weapon: "laser" });
  game.fighters.push(laser);
  attack(laser, game);
  assert.ok(prop.hp < prop.maxHp, "hitscan also hits the full disguise");
}

{
  const { owner, game } = fixture();
  const intent = () => ({ mx: 1, jump: false, jet: false, attack: false, dodge: false });
  tryDisguise(owner, game);
  for (let i = 0; i < 120; i++) stepFighter(owner, 1 / 60, game, {}, {}, intent);
  assert.ok(Math.abs(owner.vx - owner.moveSpeed * DISGUISE_SPEED_MULT) < .01,
    "walking reaches exactly the 55% speed cap");
  assert.ok(owner.disguiseProp, "movement and time alone do not reveal");
  assert.equal(owner.disguiseProp.x + owner.disguiseProp.w / 2, owner.x + SIZE / 2);
}

{
  const { owner, game } = fixture("crate", 1, "shield-steal");
  tryDisguise(owner, game);
  stepFighter(owner, .01, game, {}, {}, () => ({
    mx: 0, jump: false, jet: false, attack: true, dodge: false
  }));
  assert.equal(owner.disguiseProp, null, "continuous weapon use reveals too");
}

{
  const { owner, prop, game } = fixture();
  for (const field of ["destroyed", "heldBy", "thrownInFlight", "illusionObject",
    "illusionGhosted", "powerCrate", "armorDummy", "forgeHidden",
    "lightCondensation", "reconjurerCreated"]) {
    const candidate = { ...prop, [field]: true };
    assert.equal(canDisguiseAs(candidate), false, `${field} is ineligible`);
  }
  prop.x = owner.x + SIZE / 2 + DISGUISE_RANGE;
  assert.equal(findDisguiseProp(owner, game), prop, "100-unit boundary is eligible");
  prop.x += .01;
  assert.equal(findDisguiseProp(owner, game), null);
  prop.x = owner.x;
  owner.shieldRaised = true;
  assert.equal(tryDisguise(owner, game), null);
  owner.shieldRaised = false;
  game.paused = true;
  assert.equal(tryDisguise(owner, game), null);
  game.paused = false;
  game.over = true;
  assert.equal(tryDisguise(owner, game), null);
  game.over = false;
  tryDisguise(owner, game);
  owner.dead = true;
  tickDisguise(owner, game, .1);
  assert.equal(owner.disguiseProp, null);
  assert.ok(game.props.includes(prop), "death never loses a borrowed prop");
}

{
  const { owner, enemy, game } = fixture();
  tryDisguise(owner, game);
  enemy.combatClone = true;
  enemy.aiState.timer = 0;
  const state = updateAIClone(enemy, .1, game);
  assert.equal(state.attack, false, "summon AI doesn't identify a disguised enemy");
  assert.equal(state.plan, "doppel idle");
  enemy.combatClone = false;
  enemy.ai = "rookie";
  enemy.aiState.timer = 0;
  updateAI(enemy, .1, game, { weapons: { gun: {}, saber: {} }, coaching: {} });
  assert.notEqual(enemy.aiState.target, owner, "regular AI also cannot identify a disguised fighter");
  assert.equal(enemy.aiState.attack, false);
}

{
  const { owner, enemy, game } = fixture();
  owner.human = false;
  const state = owner.aiState;
  state.attack = false;
  updateAiDisguise(owner, state, game, [], null);
  assert.ok(owner.disguiseProp);
  assert.equal(state.plan, "borrowing cover");
  state.attack = true;
  updateAiDisguise(owner, state, game, [], null);
  assert.equal(state.attack, false);
  enemy.x = owner.x + 100;
  updateAiDisguise(owner, state, game, [enemy], enemy);
  assert.equal(owner.disguiseProp, null, "AI reveals to fight a close visible foe");
}

for (const scale of [1, .2]) {
  const { owner, enemy, game } = fixture("crate", scale);
  owner.hp = owner.coreHp = 100 * scale;
  owner.shieldRaised = true;
  enemy.x = owner.x + 100;
  const state = owner.aiState;
  state.attack = state.chuck = true;
  updateAiDisguise(owner, state, game, [enemy], enemy);
  assert.ok(owner.disguiseProp, "wounded AI prioritizes disguise over attacks and shield use");
  assert.equal(owner.shieldRaised, false);
  assert.equal(state.attack, false);
  assert.equal(state.chuck, false);
  assert.equal(state.plan, "hiding wounded");
  state.attack = state.chuck = true;
  updateAiDisguise(owner, state, game, [enemy], enemy);
  assert.ok(owner.disguiseProp, "wounded AI stays hidden even near a visible foe");
  assert.equal(state.attack, false);
  owner.hp = owner.coreHp = 180 * scale;
  updateAiDisguise(owner, state, game, [enemy], enemy);
  assert.equal(owner.disguiseProp, null, "healthy AI reveals for close combat");
}

{
  const { owner, enemy, game } = fixture();
  owner.hp = owner.coreHp = 100;
  owner.shieldRaised = true;
  game.props = [];
  updateAiDisguise(owner, owner.aiState, game, [enemy], enemy);
  assert.equal(owner.shieldRaised, true, "no available disguise must not drop defensive shielding");
}

console.log("disguise.test.js passed.");
