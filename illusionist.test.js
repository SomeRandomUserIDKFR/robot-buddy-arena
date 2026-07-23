import assert from "node:assert/strict";
import { Fighter, hit, stepBullets } from "./combat.js";
import {
  applyLoadout, DEFAULT_LOADOUT, GEAR_BY_ID, ILLUSIONIST_ID
} from "./equipment.js";
import {
  applyPhantomDamage, createFighterIllusion, cycleIllusionistType, displayedHp,
  hasIllusionTruthSight, ILLUSION_BREAK_LIFE, ILLUSION_FIGHTER_HITS,
  ILLUSION_PHANTOM_DAMAGE, isIllusionFighter, isIllusionist, isRealCombatant,
  refreshIllusionCaches, registerIllusionFighterHit, registerIllusionObjectHit,
  tryIllusionistPlant
} from "./illusionist.js";
import { updateAIDecoy } from "./ai.js";

assert.equal(GEAR_BY_ID[ILLUSIONIST_ID].slot, "extensionSecondary");
assert.equal(GEAR_BY_ID[ILLUSIONIST_ID].illusionist, true);
assert.ok(GEAR_BY_ID[ILLUSIONIST_ID].price > 200, "most expensive extension");
assert.equal(ILLUSION_FIGHTER_HITS, 10);
assert.equal(ILLUSION_PHANTOM_DAMAGE, 40);

{
  const fighter = applyLoadout(new Fighter({
    x: 400, y: 700, team: 0, aim: 0, name: "YOU", color: "#e7f9ff"
  }), {
    ...DEFAULT_LOADOUT,
    extensionSecondary: ILLUSIONIST_ID,
    weapon: "pulse-rifle"
  });
  assert.ok(isIllusionist(fighter));
  assert.equal(fighter.illusionistType, "fighter");
  assert.equal(cycleIllusionistType(fighter), "prop");
  assert.equal(cycleIllusionistType(fighter), "platform");
  assert.equal(cycleIllusionistType(fighter), "fighter");
}

{
  const owner = applyLoadout(new Fighter({
    x: 400, y: 700, team: 0, aim: 0, name: "YOU", color: "#abc", hp: 400, maxHp: 500
  }), {
    ...DEFAULT_LOADOUT,
    extensionSecondary: ILLUSIONIST_ID,
    weapon: "pulse-rifle",
    shield: "kinetic-targe"
  });
  const game = { fighters: [owner], illusions: [], effects: [], bullets: [] };
  const decoy = tryIllusionistPlant(owner, game, Fighter);
  assert.ok(decoy);
  assert.ok(isIllusionFighter(decoy));
  assert.equal(decoy.loadout.weapon, owner.loadout.weapon);
  assert.equal(decoy.loadout.shield, owner.loadout.shield);
  assert.equal(decoy.illusionHitsLeft, ILLUSION_FIGHTER_HITS);
  assert.ok(decoy.illusionFakeMaxHp > 0);
  assert.ok(decoy.illusionFakeHp > 0);
  assert.equal(isRealCombatant(decoy), false);
  assert.equal(game.fighters.includes(decoy), true);
}

{
  // Phantom gaslight does not change real HP.
  const victim = new Fighter({ x: 0, y: 0, hp: 400, maxHp: 500, team: 1 });
  const before = victim.hp;
  applyPhantomDamage(victim, 10);
  assert.equal(victim.hp, before);
  assert.ok(victim.phantomDamage >= ILLUSION_PHANTOM_DAMAGE);
  assert.equal(displayedHp(victim), before - victim.phantomDamage);
  // Illusionist truth sight sees real HP through the gaslight.
  const seer = applyLoadout(new Fighter({
    x: 0, y: 0, team: 0, name: "YOU", color: "#fff"
  }), { ...DEFAULT_LOADOUT, extensionSecondary: ILLUSIONIST_ID });
  assert.ok(hasIllusionTruthSight(seer));
  assert.equal(displayedHp(victim, seer), before);
}

{
  // Illusion source hit → phantom only.
  const decoy = createFighterIllusion(
    applyLoadout(new Fighter({
      x: 100, y: 100, team: 0, name: "YOU", color: "#fff", hp: 500, maxHp: 500
    }), { ...DEFAULT_LOADOUT, extensionSecondary: ILLUSIONIST_ID }),
    Fighter
  );
  const victim = new Fighter({ x: 200, y: 100, team: 1, hp: 500, maxHp: 500 });
  const game = { fighters: [decoy, victim], effects: [], bullets: [], mode: "conquest", stats: {} };
  hit(victim, decoy, 12, 0, game);
  assert.equal(victim.hp, 500);
  assert.ok(victim.phantomDamage >= ILLUSION_PHANTOM_DAMAGE);
}

{
  // Real bullet passes through decoy; decoy loses a hit.
  const owner = applyLoadout(new Fighter({
    x: 100, y: 700, team: 0, name: "YOU", color: "#fff", hp: 500, maxHp: 500
  }), { ...DEFAULT_LOADOUT, extensionSecondary: ILLUSIONIST_ID });
  const decoy = createFighterIllusion(owner, Fighter);
  decoy.x = 400;
  decoy.y = 700;
  const shooter = new Fighter({
    x: 200, y: 700, team: 1, name: "E", color: "#f00", hp: 500, maxHp: 500
  });
  shooter.weaponDamage = 1;
  const game = {
    fighters: [owner, decoy, shooter],
    illusions: [],
    effects: [],
    bullets: [{
      x: 390, y: 723, px: 350, py: 723,
      vx: 800, vy: 0, owner: shooter, life: 1, traveled: 0, damage: 20
    }],
    platforms: []
  };
  const hitsBefore = decoy.illusionHitsLeft;
  const fakeBefore = decoy.illusionFakeHp;
  stepBullets(game, 1 / 60);
  assert.equal(decoy.illusionHitsLeft, hitsBefore - 1);
  assert.ok(decoy.illusionFakeHp < fakeBefore, "fake HP pool chips on hit");
  assert.equal(game.bullets.length, 1, "real bullet continues through decoy");
  assert.equal(game.bullets[0].ghost, true, "bullet ghosts (invisible) after illusion hit");
}

{
  // 10 hits fade the decoy into a swirling smoke break.
  const owner = applyLoadout(new Fighter({
    x: 0, y: 0, team: 0, name: "YOU", color: "#fff", hp: 500, maxHp: 500
  }), { ...DEFAULT_LOADOUT, extensionSecondary: ILLUSIONIST_ID });
  const decoy = createFighterIllusion(owner, Fighter);
  const game = { effects: [] };
  for (let i = 0; i < ILLUSION_FIGHTER_HITS; i++) {
    registerIllusionFighterHit(decoy, game);
  }
  assert.equal(decoy.dead, true);
  assert.ok(game.effects.some((e) => e.type === "illusionBreak"));
  const swirl = game.effects.find((e) => e.type === "illusionBreak");
  assert.ok(swirl.life >= ILLUSION_BREAK_LIFE - 0.001);
  assert.ok(swirl.radius > 0);
}

{
  // Prop/platform break also spawns the smoke swirl.
  const game = { effects: [] };
  const ill = {
    illusionObject: true,
    illusionType: "prop",
    x: 100,
    y: 200,
    w: 44,
    h: 44,
    destroyed: false,
    life: 10
  };
  assert.ok(registerIllusionObjectHit(ill, game));
  assert.equal(ill.destroyed, true);
  assert.ok(game.effects.some((e) => e.type === "illusionBreak"));
  // Second hit is a no-op (already broken).
  const n = game.effects.length;
  assert.equal(registerIllusionObjectHit(ill, game), false);
  assert.equal(game.effects.length, n);
}

{
  // Prop illusion plant.
  const owner = applyLoadout(new Fighter({
    x: 300, y: 600, team: 0, aim: 0
  }), { ...DEFAULT_LOADOUT, extensionSecondary: ILLUSIONIST_ID });
  owner.illusionistType = "prop";
  const game = { fighters: [owner], illusions: [], effects: [] };
  const prop = tryIllusionistPlant(owner, game, Fighter);
  assert.ok(prop.illusionObject);
  assert.equal(prop.illusionType, "prop");
  assert.equal(prop.blocksSight, false);
  assert.equal(prop.solid, false);
}

{
  // Frame caches + light decoy AI still fight / can nest-plant.
  const owner = applyLoadout(new Fighter({
    x: 100, y: 700, team: 0, name: "YOU", color: "#fff", hp: 500, maxHp: 500,
    aim: 0, grounded: true
  }), {
    ...DEFAULT_LOADOUT,
    extensionSecondary: ILLUSIONIST_ID,
    weapon: "pulse-rifle"
  });
  const decoy = createFighterIllusion(owner, Fighter);
  decoy.x = 400;
  decoy.y = 700;
  decoy.illusionistCd = 0;
  decoy.illusionistType = "prop";
  const enemy = new Fighter({
    x: 550, y: 700, team: 1, hp: 500, maxHp: 500, grounded: true
  });
  const game = {
    fighters: [owner, decoy, enemy],
    illusions: [],
    effects: [],
    bullets: [],
    pings: []
  };
  refreshIllusionCaches(game);
  assert.equal(game._livingIllusionFighters.length, 1);
  const state = updateAIDecoy(decoy, 1, game);
  assert.ok(state.plan === "illusion pressing" || state.plan?.includes("illusion"));
  assert.ok(state.attack || state.desiredAim != null);
}

console.log("illusionist.test.js passed.");
