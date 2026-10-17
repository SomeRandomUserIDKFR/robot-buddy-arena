import assert from "node:assert/strict";
import { aiHpAtLeast, aiHpBelow, perceivedHp, selectAiTarget } from "./ai-perception.js";
import { updateAI, updateAIClone, updateAIDecoy, updateAIImitation } from "./ai.js";
import { chooseTacticalStrategy } from "./ai-tactics.js";
import { Fighter, stepFighter } from "./combat.js";
import { createCombatClone } from "./combat-clone.js";
import { DEFAULT_PROFILE } from "./config.js";
import { applyLoadout, DEFAULT_LOADOUT } from "./equipment.js";
import {
  applyPhantomDamage, createFighterIllusion, tickPhantomDamage, tryIllusionistPlant
} from "./illusionist.js";

function actor(x, team = 0, extension = "no-extension", scale = 1) {
  return applyLoadout(new Fighter({
    x, y: 700, team, ai: "veteran", grounded: true, aim: team ? Math.PI : 0
  }), { ...DEFAULT_LOADOUT, extensionSecondary: extension, cloneBehavior: "generic" },
  { healthScale: scale });
}

function scene(extension = "no-extension", scale = 1) {
  const profile = structuredClone(DEFAULT_PROFILE);
  const owner = actor(700, 0, "no-extension", scale);
  owner.human = true;
  const bot = actor(900, 1, extension, scale);
  bot.illusionistCd = 99;
  const game = {
    fighters: [owner, bot], mode: "conquest", elapsed: 1, pings: [], thoughts: [],
    effects: [], bullets: [], illusions: [], props: [], powerCrates: [], platforms: [],
    learningLocked: true
  };
  return { owner, bot, game, profile };
}

{
  const viewer = actor(0);
  const real = actor(400, 1);
  const fake = actor(600, 1);
  fake.illusion = true;
  assert.equal(selectAiTarget(viewer, [real]), real);
  fake.x = 200;
  assert.equal(selectAiTarget(viewer, [real, fake]), real,
    "a separate decoy does not erase a continuous visual track");
  fake.x = real.x;
  const rolls = [.01, .99];
  assert.equal(selectAiTarget(viewer, [real, fake], {
    trackingSkill: 0, style: "rusher", random: () => rolls.shift()
  }), fake, "overlap can transfer the track onto a decoy");
  assert.equal(selectAiTarget(viewer, [real, fake], {
    random: () => { throw new Error("standing overlap must not reroll every decision"); }
  }), fake);
  assert.equal(selectAiTarget(viewer, []), null);
  assert.equal(viewer.aiState.visualTrack.positions.size, 0,
    "hidden coordinates and identity continuity are discarded");
  assert.equal(selectAiTarget(viewer, [real, fake], {
    style: "rusher", random: () => .99
  }), fake, "reacquisition does not magically recover the original body");
}

{
  const viewer = actor(0);
  const real = actor(400, 1);
  const fake = actor(700, 1);
  selectAiTarget(viewer, [real]);
  selectAiTarget(viewer, [real, fake]);
  real.x = 700;
  fake.x = 400;
  const rolls = [.01, .99];
  assert.equal(selectAiTarget(viewer, [real, fake], {
    trackingSkill: 0, style: "rusher", random: () => rolls.shift()
  }), fake, "crossings between reaction samples can also confuse identity");
}

{
  const viewer = actor(0);
  const real = actor(400, 1);
  const different = actor(400, 1);
  different.loadout.helmet = "different-visible-helmet";
  selectAiTarget(viewer, [real]);
  assert.equal(selectAiTarget(viewer, [real, different], {
    random: () => { throw new Error("visually different bodies are not lookalikes"); }
  }), real);
}

{
  let rookieLosses = 0;
  let trainedLosses = 0;
  let aggressiveNear = 0;
  let defensiveNear = 0;
  for (let i = 0; i < 1000; i++) {
    for (const skill of [0, 1]) {
      const viewer = actor(0);
      const real = actor(400, 1);
      const fake = actor(400, 1);
      selectAiTarget(viewer, [real]);
      const rolls = [(i + .5) / 1000, .99];
      const target = selectAiTarget(viewer, [real, fake], {
        trackingSkill: skill, style: "rusher", random: () => rolls.shift()
      });
      if (target === fake) {
        if (skill) trainedLosses++;
        else rookieLosses++;
      }
    }
    for (const style of ["rusher", "defender"]) {
      const viewer = actor(0);
      const far = actor(500, 1);
      const near = actor(50, 1);
      near.illusion = true;
      const target = selectAiTarget(viewer, [far, near], {
        style, random: () => (i + .5) / 1000
      });
      if (target === near) {
        if (style === "rusher") aggressiveNear++;
        else defensiveNear++;
      }
    }
  }
  assert.equal(rookieLosses, 850);
  assert.equal(trainedLosses, 200, "training improves tracking without granting perfect immunity");
  assert.equal(aggressiveNear, 500, "aggressive acquisition is uniform among lookalikes");
  assert.ok(defensiveNear > 650 && defensiveNear < 900,
    "defensive acquisition favors proximity but is not deterministic");
}

{
  const viewer = actor(0);
  const a = actor(400, 1);
  const b = actor(400, 1);
  b.illusion = true;
  const choose = () => {
    viewer.aiState.target = null;
    return selectAiTarget(viewer, [a, b], { style: "rusher", random: () => .8 });
  };
  assert.equal(choose(), b);
  a.illusion = true;
  b.illusion = false;
  assert.equal(choose(), b, "hidden real/illusion flags cannot influence ordinary targeting");
  viewer.illusionist = true;
  assert.equal(choose(), b, "truth sight may distinguish an outlined illusion");
  b.illusion = true;
  assert.equal(choose(), null, "truth sight does not mistake an all-decoy group for real threats");
}

for (const scale of [1, .2]) {
  const { owner, bot, game, profile } = scene("no-extension", scale);
  const actualHp = bot.hp;
  applyPhantomDamage(bot, actualHp - 50 * scale, game, owner);
  assert.equal(perceivedHp(bot), 50 * scale);
  assert.ok(aiHpBelow(bot, 180));
  assert.equal(aiHpAtLeast(bot, 180), false);
  const state = updateAI(bot, 1, game, profile);
  assert.ok(state.escape, "fake low health triggers a real escape decision");
  assert.equal(bot.hp, actualHp);
  assert.equal(bot.dead, false);
  assert.equal(bot.tacticalDamageTaken || 0, 0, "phantom hits do not become real damage evidence");
  tickPhantomDamage(bot, 20);
  assert.equal(perceivedHp(bot), actualHp, "perception recovers as phantom damage decays");
  const truth = scene("illusionist", scale);
  applyPhantomDamage(truth.bot, truth.bot.hp - 50 * scale, truth.game, truth.owner);
  assert.equal(perceivedHp(truth.bot), truth.bot.hp);
  assert.equal(aiHpBelow(truth.bot, 180), false);
  assert.equal(updateAI(truth.bot, 1, truth.game, truth.profile).escape || null, null);
}

{
  const { owner, bot, game, profile } = scene();
  applyPhantomDamage(bot, 450, game, owner);
  chooseTacticalStrategy(bot, game, profile, [owner], owner);
  assert.match(bot.tacticalState.trial.context, /:hurt$/,
    "tactical context uses perceived health, not secret actual health");
  assert.equal(perceivedHp(bot, owner), 50);
  owner.illusionist = true;
  assert.equal(perceivedHp(bot, owner), bot.hp, "truth sight also reads others' real health");
}

{
  const { owner, bot, game, profile } = scene();
  owner.x = 400;
  bot.x = 900;
  const other = actor(500, 0);
  other.loadout.helmet = "different-visible-helmet";
  other.hp = owner.hp;
  game.fighters.push(other);
  applyPhantomDamage(owner, 450, game, bot);
  updateAI(bot, 1, game, profile);
  assert.equal(bot.aiState.target, owner,
    "apparent low enemy health affects finishing-target priority");
}

for (const optimize of [true, false]) {
  for (const type of ["doppel", "illusionist", "imitation"]) {
    const { owner, bot, game, profile } = scene();
    owner.x = 500;
    const decoyOwner = actor(700, 0, "illusionist");
    const fake = createFighterIllusion(decoyOwner, Fighter);
    fake.x = 700;
    fake.y = owner.y;
    const summonOwner = actor(100, 1, type === "illusionist" ? "illusionist" : "doppel");
    const summon = type === "illusionist"
      ? createFighterIllusion(summonOwner, Fighter) : createCombatClone(summonOwner, Fighter);
    summon.x = 100;
    summon.y = owner.y;
    summon.aim = 0;
    summon.aiState.target = owner;
    summon.illusionistCd = 99;
    if (type === "imitation") summon.cloneBehavior = "imitation";
    game.settings = { gameplay: { optimizeIllusions: optimize } };
    game.fighters = [owner, summon, fake, bot];
    const update = () => {
      summon.aiState.timer = 0;
      if (type === "imitation") return updateAIImitation(summon, 1, game, () => .01);
      return optimize ? (type === "illusionist" ? updateAIDecoy : updateAIClone)(summon, 1, game)
        : updateAI(summon, 1, game, profile);
    };
    update();
    assert.equal(summon.aiState.target, owner,
      `${type}, Optimize ${optimize}: separated lookalikes preserve an observed target`);
  }
}

{
  const { owner, bot, game, profile } = scene();
  game.learningLocked = false;
  owner.cloneStyle = null;
  owner.intent = { mx: 0, attack: false, jetHeld: false };
  applyPhantomDamage(owner, 450, game, bot);
  stepFighter(owner, .1, game, profile, {}, () => owner.intent);
  assert.ok(Object.keys(profile.cloneStyle.contexts).some((key) => key.includes("|hurt|")),
    "live owner recording uses the same apparent health context");
}

{
  const { bot, game } = scene();
  const caster = actor(700, 0, "illusionist");
  caster.human = true;
  const truth = actor(1000, 1, "illusionist");
  const ally = actor(500, 0);
  const unrelated = actor(1100, 1);
  const hidden = actor(3000, 2);
  hidden.sight = 20;
  const human = actor(1000, 1);
  human.human = true;
  const dead = actor(1000, 1);
  dead.dead = true;
  game.fighters = [caster, bot, truth, ally, unrelated, hidden, human, dead];
  for (const observer of game.fighters.slice(1)) {
    observer.aiState.target = caster;
    observer.aiState.lastKnown = { x: caster.x, y: caster.y };
    observer.aiState.visualTrack = { positions: new Map([[caster, { x: caster.x, y: caster.y }]]) };
    observer.aiState.attack = true;
    observer.aiState.timer = 2;
  }
  unrelated.aiState.target = ally;
  const hp = caster.hp;
  const iframe = caster.iframe;
  const decoy = tryIllusionistPlant(caster, game, Fighter);
  assert.ok(decoy);
  assert.equal(bot.aiState.target, null, "fighter spawn smoke immediately breaks a caster track");
  assert.equal(bot.aiState.lastKnown, null, "old target memory cannot restore the original identity");
  assert.equal(bot.aiState.visualTrack, null);
  assert.equal(bot.aiState.attack, false, "no stale auto-fire lock survives the smoke");
  assert.equal(bot.aiState.timer, 0, "the next decision reacquires instead of following a stale lock");
  for (const observer of [truth, ally, hidden, human, dead]) {
    assert.equal(observer.aiState.target, caster, "unaffected observers retain their state");
    assert.equal(observer.aiState.timer, 2);
  }
  assert.equal(unrelated.aiState.target, ally, "unrelated targets are not reset");
  assert.equal(caster.hp, hp);
  assert.equal(caster.iframe, iframe, "smoke does not grant invulnerability");
  assert.equal(selectAiTarget(bot, [caster, decoy], {
    trackingSkill: 1, style: "rusher", random: () => .99
  }), decoy, "even trained tracking must reacquire after smoke instead of retaining caster identity");
}

for (const type of ["prop", "platform", "cooldown", "invalid-constructor", "active-cap"]) {
  const { bot, game } = scene();
  const caster = actor(700, 0, "illusionist");
  game.fighters = [caster, bot];
  bot.aiState.target = caster;
  bot.aiState.timer = 2;
  if (type === "prop" || type === "platform") caster.illusionistType = type;
  if (type === "cooldown") caster.illusionistCd = 1;
  if (type === "active-cap") game.illusions = [{ owner: caster, life: 1 }, { owner: caster, life: 1 }];
  const result = tryIllusionistPlant(caster, game, type === "invalid-constructor" ? null : Fighter);
  assert.equal(!!result, type === "prop" || type === "platform");
  assert.equal(game.effects.some((effect) => effect.type === "illusionSpawnSmoke"), false,
    `${type} casts do not create fighter spawn smoke`);
  assert.equal(bot.aiState.target, caster);
  assert.equal(bot.aiState.timer, 2, `${type} casts do not break a target lock`);
}

console.log("ai-perception.test.js passed: visual tracking, spawn smoke, and phantom health decisions.");
