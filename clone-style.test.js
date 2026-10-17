import assert from "node:assert/strict";
import { Fighter, stepFighter } from "./combat.js";
import { DEFAULT_PROFILE } from "./config.js";
import {
  applyLoadout, DEFAULT_LOADOUT, equipOwned, GEAR_BY_ID, normalizeLoadout,
  purchaseGear, setCloneBehavior
} from "./equipment.js";
import { createCombatClone, SHADOW_CLONE_ID, SPLIT_ID } from "./combat-clone.js";
import { createFighterIllusion } from "./illusionist.js";
import { AI_SEARCH_MEMORY_SECONDS, updateAI, updateAIImitation } from "./ai.js";
import { migrateProfile } from "./storage.js";
import { ensureCampaignProfile } from "./campaign.js";
import { createPowerCrate } from "./powerups.js";
import {
  CLONE_STYLE_ACTIONS, CLONE_STYLE_MAX_COMBOS, CLONE_STYLE_MAX_CONTEXTS,
  cloneActionChance, cloneStyleNotes, cloneStyleSituation, ensureCloneStyle,
  learnedCloneRow, normalizeCloneBehavior, noteCloneStyleInput, ownerCloneStyle,
  recordCloneStyle
} from "./clone-style.js";

function fixture(extension = "doppel", loadout = {}) {
  const profile = migrateProfile(structuredClone(DEFAULT_PROFILE));
  const owner = applyLoadout(new Fighter({
    x: 400, y: 700, team: 0, human: true, grounded: true, ai: "veteran"
  }), { ...DEFAULT_LOADOUT, ...loadout, extensionSecondary: extension });
  ownerCloneStyle(owner, profile);
  const enemy = new Fighter({ x: 700, y: 700, team: 1, hp: 500, maxHp: 500 });
  const game = {
    fighters: [owner, enemy], effects: [], bullets: [], pings: [], stats: {}, props: [],
    platforms: [{ x: 0, y: 742, w: 3000, h: 30 }], mode: "training", elapsed: 1,
    settings: { gameplay: { optimizeIllusions: true } }
  };
  const sample = (intent = {}, dt = .1) => {
    game.elapsed += dt;
    recordCloneStyle(owner, { mx: 0, ...intent }, dt, game, profile, [enemy]);
  };
  const spawn = () => {
    const clone = ["illusionist", "hologram"].includes(extension)
      ? createFighterIllusion(owner, Fighter) : createCombatClone(owner, Fighter);
    clone.x = owner.x;
    clone.y = owner.y;
    clone.grounded = true;
    clone.aiState.timer = 0;
    game.fighters.push(clone);
    return clone;
  };
  return { owner, enemy, game, profile, sample, spawn };
}

assert.equal(normalizeCloneBehavior(undefined), "imitation");
assert.equal(normalizeCloneBehavior("generic"), "generic");
assert.equal(normalizeCloneBehavior("invalid"), "imitation");

for (const extension of ["doppel", SHADOW_CLONE_ID, SPLIT_ID, "illusionist", "hologram"]) {
  for (const optimize of [true, false]) {
    for (const movement of [1, -1, 0]) {
      const { enemy, game, profile, sample, spawn } = fixture(extension);
      game.settings.gameplay.optimizeIllusions = optimize;
      for (let i = 0; i < 20; i++) sample({ mx: movement });
      const clone = spawn();
      clone.facing = -1;
      updateAI(clone, .1, game, profile);
      const lastKnown = { ...clone.aiState.lastKnown };
      enemy.x = 5000;
      enemy.y = 100;
      clone.aiState.timer = 0;
      updateAI(clone, .1, game, profile);
      assert.equal(clone.aiState.target, null);
      assert.equal(clone.aiState.mx, movement,
        `${extension}, Optimize ${optimize}: remembered-point search preserves toward/away/still habits`);
      assert.equal(clone.aiState.plan, "searching last sighting (owner habits)");
      assert.equal(clone.aiState.desiredAim, 0, "search aim uses the unchanged last-seen point");
      assert.deepEqual(clone.aiState.lastKnown, lastKnown);
      assert.equal(clone.aiState.attack, false);
      assert.equal(clone.aiState.jump, false, "search cannot invent unlearned jumps");
      assert.equal(clone.aiState.jetHeld, false, "search cannot invent unlearned jet use");
      assert.equal(clone.aiState.dodge, false, "search cannot invent unlearned dodges");
      const x = clone.x;
      clone.x = lastKnown.x - 20;
      updateAI(clone, .1, game, profile);
      assert.equal(clone.aiState.mx, movement, "search does not replace learned movement near the remembered point");
      clone.x = x;
      clone.aiState.timer = 0;
      updateAI(clone, AI_SEARCH_MEMORY_SECONDS, game, profile);
      assert.doesNotMatch(clone.aiState.plan, /searching last sighting/);
      assert.deepEqual(clone.aiState.lastKnown, lastKnown);
      enemy.x = 650;
      enemy.y = 700;
      clone.aiState.timer = 0;
      updateAI(clone, .1, game, profile);
      assert.equal(clone.aiState.target, enemy);
      assert.equal(clone.aiState.lastKnown.x, 650);
      assert.equal(clone.aiState.stale, 0);
    }
  }
}

{
  const { enemy, game, profile, spawn } = fixture();
  const clone = spawn();
  updateAI(clone, .1, game, profile);
  enemy.x = 5000;
  game.powerCrates = [createPowerCrate({ x: clone.x + 100, y: 742 }, "yard", "yard")];
  clone.aiState.timer = 0;
  updateAI(clone, .1, game, profile);
  assert.ok(clone.aiState.lastKnown);
  assert.equal(clone.aiState.target, null);
  assert.equal(clone.aiState.mx, 0, "fresh Normal profiles do not receive automatic search movement");
  assert.equal(clone.aiState.attack, false, "Normal does not inherit automatic Generic crate looting");
}

{
  const { owner, profile, sample } = fixture();
  for (let i = 0; i < 100; i++) sample({ jet: true, jetHeld: true, attack: true, mx: 1 });
  const row = learnedCloneRow(profile.cloneStyle, cloneStyleSituation(owner, []).key);
  assert.ok(Math.abs(profile.cloneStyle.seconds - 10) < 1e-8);
  assert.equal(cloneActionChance(row, "jet"), 1);
  assert.equal(cloneActionChance(row, "attack"), 1);
  assert.equal(cloneActionChance(row, "dodge"), 0, "omission is retained, not replaced by tactical defaults");
  assert.ok(row.opportunities.dodge >= 9.9, "non-use is measured against ready opportunities");
  assert.equal(row.move.toward, row.seconds);
  assert.ok(cloneStyleNotes(profile.cloneStyle).some((note) => note.includes("jet held 100%")));
}

{
  const { owner, profile, sample } = fixture();
  sample({}, .02);
  noteCloneStyleInput(owner, "dodge");
  sample({}, .02);
  sample({}, .02);
  sample({}, .02);
  sample({}, .02);
  const row = Object.values(profile.cloneStyle.contexts)[0];
  assert.equal(row.events.dodge, 1, "a brief raw key press survives batch analysis");
  assert.ok(Math.abs(row.actions.dodge - .02) < 1e-8);
  assert.ok(Math.abs(row.seconds - .1) < 1e-8);
  assert.equal(owner._cloneStyleInputs, null);
  assert.equal(owner._cloneStyleRecorder.frames.length, 0, "raw frames are discarded after analysis");
}

{
  const { owner, enemy, profile, game, sample } = fixture();
  owner.dodgeCd = 10;
  for (let i = 0; i < 10; i++) sample({});
  const row = Object.values(profile.cloneStyle.contexts)[0];
  assert.equal(row.opportunities.dodge || 0, 0, "cooldown is not mistaken for choosing not to dodge");
  assert.equal(row.opportunities.shield || 0, 0, "missing equipment is not a behavioral omission");
  const before = JSON.stringify(profile.cloneStyle);
  game.learningLocked = true;
  sample({ dodge: true, jet: true });
  game.learningLocked = false;
  profile.learningLocked = true;
  sample({ attack: true });
  profile.learningLocked = false;
  game.paused = true;
  sample({ attack: true });
  game.paused = false;
  game.over = true;
  sample({ attack: true });
  assert.equal(JSON.stringify(profile.cloneStyle), before);
  game.over = false;
  const clone = createCombatClone(owner, Fighter);
  recordCloneStyle(clone, { attack: true }, 1, game, profile, [enemy]);
  assert.equal(JSON.stringify(profile.cloneStyle), before, "clones never train their owner's profile");
}

for (const extension of ["doppel", SHADOW_CLONE_ID, SPLIT_ID, "illusionist", "hologram"]) {
  for (const optimizeIllusions of [true, false]) {
    const { owner, enemy, game, profile, sample, spawn } = fixture(extension);
    const clone = spawn();
    assert.equal(clone.cloneBehavior, "imitation");
    assert.equal(clone.cloneStyle, owner.cloneStyle, "all summons read one owner profile");
    game.settings.gameplay.optimizeIllusions = optimizeIllusions;
    updateAI(clone, .1, game, profile);
    assert.equal(clone.aiState.attack, false, "no observations means no Generic fallback");
    assert.equal(clone.aiState.dodge, false);
    assert.equal(clone.aiState.jetHeld, false);
    for (let i = 0; i < 20; i++) sample({ attack: true, mx: 1, jetHeld: true });
    clone.aiState.timer = 0;
    updateAIImitation(clone, .1, game, () => .5);
    assert.equal(clone.aiState.attack, true);
    assert.equal(clone.aiState.mx, 1);
    assert.equal(clone.aiState.dodge, false, "no dodge remains no dodge even against a threat");
    assert.equal(clone.aiState.jetHeld, true);
    clone.grounded = false;
    clone.jetLocked = true;
    clone.fuel = 0;
    updateAIImitation(clone, .1, game, () => .5);
    assert.equal(clone.aiState.jetHeld, true, "jetpack overuse survives exhaustion instead of being corrected");
    assert.equal(clone.aiState.jet, true);
    enemy.x = 5000;
    clone.aiState.timer = 0;
    updateAIImitation(clone, .1, game, () => .5);
    assert.equal(clone.aiState.target, null, "learned patterns do not grant hidden enemy knowledge");
    assert.equal(clone.aiState.attack, true, "search retains learned blind firing instead of adding a tactical correction");
    const before = JSON.stringify(profile.cloneStyle);
    recordCloneStyle(clone, clone.aiState, .1, game, profile, []);
    assert.equal(JSON.stringify(profile.cloneStyle), before);
  }
}

{
  const { owner, game, profile, sample, spawn } = fixture("doppel", { shield: "light-buckler" });
  for (let i = 0; i < 20; i++) sample({ attack: true });
  const clone = spawn();
  clone.aiState.timer = 0;
  updateAIImitation(clone, .1, game, () => .01);
  assert.equal(clone.shieldRaised, false, "equipped shield is not used if owner never uses it");
  owner.shieldRaised = true;
  for (let i = 0; i < 100; i++) sample({});
  clone.aiState.timer = 0;
  updateAIImitation(clone, .1, game, () => .01);
  assert.equal(clone.shieldRaised, true, "observed shield use is passed down");
  assert.ok(profile.cloneStyle.seconds > 10);
}

{
  const { owner, game, profile, sample, spawn } = fixture(SHADOW_CLONE_ID, {
    body: "nanotech-chestplate", shield: "retractable-shell", weapon: "nanotech-rifle"
  });
  owner.nanobotArmor = 100;
  owner.retractableDeployed = true;
  for (let i = 0; i < 10; i++) sample({ attack: true });
  const clone = spawn();
  updateAIImitation(clone, .016, game, () => .01);
  assert.equal(clone.nanobotArmor, 100);
  assert.equal(clone.retractableMorphTo, "on");
  for (let i = 0; i < 5; i++) updateAIImitation(clone, .016, game, () => .5);
  assert.equal(clone.nanobotArmor, 100, "armor pulses occur on decisions, not every render frame");
  assert.equal(clone.retractableMax, owner.retractableMax * .1);
  const row = Object.values(profile.cloneStyle.contexts)[0];
  assert.equal(row.events.nano, 1, "holding existing armor is not repeated top-up input");
  owner.nanobotArmor = 200;
  sample({});
  owner.nanobotArmor = 300;
  sample({});
  assert.equal(row.events.nano, 3, "consecutive actual top-ups are separate actions");
  row.events.nano = 0;
  clone.aiState.timer = 0;
  updateAIImitation(clone, .016, game, () => .01);
  assert.equal(clone.nanobotArmor, 100, "existing armor never creates a generic automatic top-up policy");
}

{
  const { owner, profile, sample, spawn, game } = fixture();
  for (let n = 0; n < 5; n++) {
    sample({ dodge: true }, .1);
    sample({}, .2);
    sample({ attack: true }, .1);
    sample({}, 3);
  }
  const combo = profile.cloneStyle.combos.find((entry) => entry.from === "dodge" && entry.to === "attack");
  assert.ok(combo && combo.count === 5);
  assert.equal(combo.delay, "quick");
  assert.ok(!Object.hasOwn(combo, "milliseconds"), "exact input timings are never persisted");
  assert.ok(cloneStyleNotes(profile.cloneStyle).some((note) => note.includes("dodge then attack")));
  const clone = spawn();
  const row = Object.values(profile.cloneStyle.contexts)[0];
  row.events.dodge = 5;
  row.opportunities.dodge = .01;
  // A learned follow-up remains available, but is not independently selected on this decision.
  row.actions.attack = .01;
  row.opportunities.attack = 100;
  clone.aiState.timer = 0;
  updateAIImitation(clone, .1, game, () => .5);
  assert.equal(clone.aiState.dodge, true);
  assert.ok(clone.aiState.imitationCombo);
  const firstDelay = clone.aiState.imitationCombo.at - game.elapsed;
  assert.ok(firstDelay >= .12 && firstDelay <= .35);
  assert.equal(clone.aiState.attack, false);
  game.elapsed = clone.aiState.imitationCombo.at;
  updateAIImitation(clone, 0, game, () => .5);
  assert.equal(clone.aiState.attack, true, "the learned follow-up fires when its varied delay expires");
  clone.aiState.imitationActions = null;
  clone.aiState.imitationPrevious = {};
  clone.aiState.imitationCombo = null;
  updateAIImitation(clone, .1, game, () => .8);
  assert.ok(clone.aiState.imitationCombo);
  assert.notEqual(clone.aiState.imitationCombo.at - game.elapsed, firstDelay,
    "sequence timing is regenerated, never copied exactly");
}

{
  const { profile, owner, sample } = fixture();
  sample({ attack: true, jetHeld: true }, 1);
  const restored = migrateProfile(JSON.parse(JSON.stringify(profile)));
  assert.deepEqual(restored.cloneStyle, profile.cloneStyle, "style survives save migration across fights");
  const npc = applyLoadout(new Fighter({ team: 1 }), DEFAULT_LOADOUT);
  const npcStyle = ownerCloneStyle(npc, profile);
  assert.notEqual(npcStyle, owner.cloneStyle, "enemy/buddy owners never borrow the player's style");
  assert.equal(npcStyle.seconds, 0);
  const malformed = { cloneStyle: { version: 1, seconds: Infinity, contexts: { invalid: {} }, combos: [{ from: "bad" }] } };
  const clean = ensureCloneStyle(malformed);
  assert.equal(clean.seconds, 0);
  assert.deepEqual(clean.contexts, {});
  assert.deepEqual(clean.combos, []);
  const huge = { cloneStyle: { version: 1, contexts: {}, combos: [] } };
  for (const weapon of ["gun", "saber"]) for (const range of ["near", "mid", "far", "none"])
    for (const health of ["hurt", "healthy"]) for (const threat of ["threat", "calm"])
      for (const height of ["air", "ground"]) {
        huge.cloneStyle.contexts[`${weapon}|${range}|${health}|${threat}|${height}`] =
          { seconds: 1, actions: { jet: 1e10 }, opportunities: { jet: 1e10 } };
      }
  const key = Object.keys(huge.cloneStyle.contexts)[0];
  huge.cloneStyle.combos = Array.from({ length: 1000 }, () => ({
    context: key, from: "dodge", to: "attack", delay: "short", count: 1, starts: 1
  }));
  assert.ok(Object.keys(ensureCloneStyle(huge).contexts).length <= CLONE_STYLE_MAX_CONTEXTS);
  assert.ok(huge.cloneStyle.combos.length <= CLONE_STYLE_MAX_COMBOS);
}

for (const id of ["doppel", SHADOW_CLONE_ID, SPLIT_ID, "illusionist", "hologram"]) {
  const profile = migrateProfile(structuredClone(DEFAULT_PROFILE));
  profile.cyber = 10000;
  assert.equal(setCloneBehavior(profile, "player", "generic"), false, "variants require the base Extension");
  const before = profile.cyber;
  assert.equal(purchaseGear(profile, id).ok, true);
  assert.equal(profile.cyber, before - GEAR_BY_ID[id].price);
  assert.equal(equipOwned(profile, "player", "extensionSecondary", id), true);
  const purchased = profile.cyber;
  assert.equal(setCloneBehavior(profile, "player", "generic"), true);
  assert.equal(profile.cyber, purchased, "Generic is included, not another purchase");
  assert.equal(profile.equipment.player.cloneBehavior, "generic");
  assert.equal(setCloneBehavior(profile, "player", "imitation"), true);
  assert.equal(setCloneBehavior(profile, "player", "invalid"), false);
  assert.equal(normalizeLoadout({ extensionSecondary: id, cloneBehavior: "generic" }, profile.equipment.owned).cloneBehavior, "generic");
  profile.equipment.player.cloneBehavior = "generic";
  assert.equal(migrateProfile(JSON.parse(JSON.stringify(profile))).equipment.player.cloneBehavior, "generic");
  const old = JSON.parse(JSON.stringify(profile));
  delete old.equipment.player.cloneBehavior;
  assert.equal(migrateProfile(old).equipment.player.cloneBehavior, "imitation", "existing owners get both variants with Normal selected");
  ensureCampaignProfile(profile);
  profile.campaign.player.extensionSecondary = id;
  assert.equal(setCloneBehavior(profile, "player", "generic", true), true);
  assert.equal(migrateProfile(JSON.parse(JSON.stringify(profile))).campaign.player.cloneBehavior, "generic");
  profile.equipment.buddy.extensionSecondary = id;
  profile.equipment.buddyMode = "choice";
  assert.equal(setCloneBehavior(profile, "buddy", "generic"), false, "buddy autonomy remains locked");
}

{
  const { owner, game, profile } = fixture();
  owner.loadout.cloneBehavior = "generic";
  const clone = createCombatClone(owner, Fighter);
  assert.equal(clone.cloneBehavior, "generic");
  clone.x = owner.x;
  clone.y = owner.y;
  clone.aiState.timer = 0;
  game.fighters.push(clone);
  updateAI(clone, .1, game, profile);
  assert.equal(clone.aiState.attack, true, "Generic retains old tactics without learning evidence");
}

{
  const { owner, enemy, game, profile } = fixture();
  owner.grounded = false;
  game.platforms = [];
  for (let i = 0; i < 12; i++) {
    game.elapsed += .016;
    stepFighter(owner, .016, game, profile, {}, () => ({
      mx: 1, jump: false, jet: true, jetHeld: true, attack: true, dodge: false
    }));
  }
  assert.ok(profile.cloneStyle.seconds > .1, "live combat records raw intent automatically");
  assert.ok(Object.values(profile.cloneStyle.contexts).some((row) => row.actions.jet > 0));
  assert.ok(game.bullets.some((bullet) => bullet.owner === owner));
  assert.ok(enemy.hp > 0);
}

console.log("clone-style.test.js passed: owner input learning, imitation, Generic variants, and persistence.");
