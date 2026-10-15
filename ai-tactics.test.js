import assert from "node:assert/strict";
import { updateAI, updateAIClone } from "./ai.js";
import {
  chooseTacticalStrategy, ensureTacticalMemory, finishTacticalLearning,
  observeSuspiciousProps, PROP_SUSPICION_THRESHOLD, tacticalRandom, tacticalState,
  TACTICAL_STRATEGIES, TACTICAL_TRIAL_SECONDS
} from "./ai-tactics.js";
import { Fighter, hit } from "./combat.js";
import { DEFAULT_PROFILE, SIZE } from "./config.js";
import { tryDisguise, syncDisguisePosition } from "./disguise.js";
import { applyHpDamage, applyLoadout, DEFAULT_LOADOUT, DISGUISE_ID } from "./equipment.js";
import { createMapProp } from "./maps.js";
import { migrateProfile } from "./storage.js";
import { propVisibleToSelf } from "./vision.js";

function fixture(seed = 123, buddy = true, scale = 1) {
  const player = new Fighter({ x: 100, y: 700, team: 0, human: true });
  const fighter = applyLoadout(new Fighter({
    x: 500, y: 700, team: 1, buddy, ai: "balanced", grounded: true, aim: 0
  }), DEFAULT_LOADOUT, { healthScale: scale });
  const enemy = applyLoadout(new Fighter({
    x: 760, y: 700, team: 0, grounded: true, aim: Math.PI
  }), { ...DEFAULT_LOADOUT, extensionSecondary: DISGUISE_ID }, { healthScale: scale });
  const game = {
    seed, elapsed: 0, mode: "conquest", fighters: [player, fighter, enemy],
    props: [], platforms: [{ x: 0, y: 700 + SIZE, w: 3600, h: 80 }],
    bullets: [], effects: [], pings: [], thoughts: [], stats: {}, groundDebris: []
  };
  const profile = structuredClone(DEFAULT_PROFILE);
  return { player, fighter, enemy, game, profile };
}

{
  const a = fixture(123);
  const b = fixture(123);
  const c = fixture(124);
  const samples = ({ fighter, game }) => Array.from({ length: 20 }, () => tacticalRandom(fighter, game));
  const first = samples(a);
  assert.deepEqual(first, samples(b), "same match seed and actor order reproduce tactical randomness");
  assert.notDeepEqual(first, samples(c), "different seeds vary tactical choices");
  const { fighter, enemy, game, profile } = fixture(123);
  const choices = new Set();
  for (let i = 0; i < 150; i++) {
    game.elapsed = i * TACTICAL_TRIAL_SECONDS;
    choices.add(chooseTacticalStrategy(fighter, game, profile, [enemy], enemy));
  }
  assert.equal(choices.size, TACTICAL_STRATEGIES.length, "exploration can try every strategy");
  assert.deepEqual(profile.tacticalMemory.contexts, {}, "idle trials do not teach success");
}

for (const scale of [1, .2]) {
  const { fighter, enemy, game, profile } = fixture(123, true, scale);
  const strategy = chooseTacticalStrategy(fighter, game, profile, [enemy], enemy);
  const trial = tacticalState(fighter, game).trial;
  hit(enemy, fighter, 40, 0, game);
  assert.equal(fighter.tacticalDamageDealt, 40 * scale, "real hits feed outcome evidence");
  game.elapsed = TACTICAL_TRIAL_SECONDS;
  finishTacticalLearning(game, profile);
  const record = profile.tacticalMemory.contexts[trial.context][strategy];
  assert.equal(record.trials, 1);
  assert.ok(record.value > 0, "a useful damage trade reinforces a tried strategy");
  const persisted = migrateProfile(JSON.parse(JSON.stringify(profile)));
  assert.deepEqual(persisted.tacticalMemory, profile.tacticalMemory, "buddy evidence survives save/migration");
  assert.deepEqual(tacticalState(fighter, { seed: 444, fighters: [fighter] }).memory.contexts, {},
    "new match does not retain runtime memory");
}

{
  const { fighter, enemy, game, profile } = fixture();
  const strategy = chooseTacticalStrategy(fighter, game, profile, [enemy], enemy);
  const trial = tacticalState(fighter, game).trial;
  applyHpDamage(fighter, 60, game);
  game.elapsed = TACTICAL_TRIAL_SECONDS;
  finishTacticalLearning(game, profile);
  assert.ok(profile.tacticalMemory.contexts[trial.context][strategy].value < 0,
    "taking damage without benefit discourages the experiment");
}

for (const good of [true, false]) {
  const { fighter, enemy, game, profile } = fixture(789);
  profile.tacticalMemory.contexts["gun:no-extension:duel"] = Object.fromEntries(
    TACTICAL_STRATEGIES.map((strategy) => [strategy, {
      trials: 20, value: strategy === "pressure" ? (good ? 1 : -1) : (good ? -1 : 1)
    }])
  );
  let pressureChoices = 0;
  for (let i = 0; i < 200; i++) {
    game.elapsed = i * TACTICAL_TRIAL_SECONDS;
    if (chooseTacticalStrategy(fighter, game, profile, [enemy], enemy) === "pressure") pressureChoices++;
  }
  assert.ok(good ? pressureChoices > 140 : pressureChoices < 40,
    "learned outcomes measurably change future strategy selection while retaining exploration");
  fighter.weapon = "saber";
  chooseTacticalStrategy(fighter, game, profile, [enemy], enemy);
  assert.match(tacticalState(fighter, game).trial.context, /^saber:/,
    "weapon contexts do not blindly reuse gun strategies");
}

{
  const { fighter, enemy, game, profile } = fixture();
  const state = tacticalState(fighter, game);
  state.trial = {
    context: "gun:no-extension:hurt", strategy: "cautious", started: 0,
    dealt: 0, taken: 0, distance: 260
  };
  fighter.aiState.target = enemy;
  applyHpDamage(fighter, 10, game);
  fighter.x -= 140;
  game.elapsed = TACTICAL_TRIAL_SECONDS;
  finishTacticalLearning(game, profile);
  assert.ok(profile.tacticalMemory.contexts["gun:no-extension:hurt"].cautious.value > 0,
    "an escape that creates separation earns bounded credit");
}

{
  const { fighter, enemy, game, profile } = fixture();
  const strategy = chooseTacticalStrategy(fighter, game, profile, [enemy], enemy);
  const trial = tacticalState(fighter, game).trial;
  hit(fighter, enemy, 1000, Math.PI, game);
  assert.equal(fighter.tacticalDamageTaken, fighter.maxHp, "overkill counts actual HP lost only");
  assert.ok(fighter.dead);
  game.elapsed = .2;
  finishTacticalLearning(game, profile, true);
  assert.ok(profile.tacticalMemory.contexts[trial.context][strategy].value < 0,
    "a quick death still counts as a failed experiment");
}

for (const locked of [true, false]) {
  const { fighter, enemy, game, profile } = fixture(123, false);
  game.learningLocked = locked;
  const strategy = chooseTacticalStrategy(fighter, game, profile, [enemy], enemy);
  const trial = tacticalState(fighter, game).trial;
  hit(enemy, fighter, 40, 0, game);
  game.elapsed = TACTICAL_TRIAL_SECONDS;
  finishTacticalLearning(game, profile);
  assert.deepEqual(profile.tacticalMemory.contexts, {}, "enemy experiments never change buddy memory");
  const memory = tacticalState(fighter, game).memory.contexts;
  assert.equal(!!memory[trial.context]?.[strategy], !locked, "learning lock blocks outcome writes");
  if (!locked) assert.equal(memory[trial.context][strategy].trials, 1);
}

{
  const { fighter, enemy, game, profile } = fixture();
  game.learningLocked = true;
  chooseTacticalStrategy(fighter, game, profile, [enemy], enemy);
  hit(enemy, fighter, 40, 0, game);
  game.elapsed = TACTICAL_TRIAL_SECONDS;
  finishTacticalLearning(game, profile);
  assert.deepEqual(profile.tacticalMemory.contexts, {}, "locked buddy learning does not write evidence");
}

{
  const profile = { tacticalMemory: { contexts: {
    "gun:no-extension:duel": { pressure: { trials: 999, value: 7 }, flank: { trials: 2, value: NaN } },
    unknown: { pressure: { trials: 5, value: 1 } }
  } } };
  ensureTacticalMemory(profile);
  assert.deepEqual(profile.tacticalMemory.contexts, {
    "gun:no-extension:duel": { pressure: { trials: 64, value: 1 } }
  });
}

function movingDisguise() {
  const fixtureState = fixture();
  const { fighter, enemy, game } = fixtureState;
  const prop = createMapProp("crate", enemy.x, enemy.y + SIZE);
  game.props = [prop];
  assert.ok(tryDisguise(enemy, game));
  game.fighters = [fighter, enemy];
  return { ...fixtureState, prop };
}

{
  const { fighter, enemy, game, prop } = movingDisguise();
  assert.equal(observeSuspiciousProps(fighter, game), null, "stationary disguise is not magically detected");
  game.elapsed = .4;
  enemy.x += 20;
  syncDisguisePosition(enemy);
  assert.equal(observeSuspiciousProps(fighter, game), null, "one movement is tentative");
  game.elapsed = .8;
  enemy.x += 20;
  syncDisguisePosition(enemy);
  const probe = observeSuspiciousProps(fighter, game);
  assert.ok(probe?.suspectedProp);
  assert.notEqual(probe, enemy, "deduction targets a visual point, not hidden fighter identity");
  assert.equal(probe.x + SIZE / 2, prop.x + prop.w / 2);
  assert.ok(tacticalState(fighter, game).observations.get(prop).confidence >= PROP_SUSPICION_THRESHOLD);
  game.elapsed = 3;
  assert.equal(observeSuspiciousProps(fighter, game), null, "stopping eventually loses suspicion");
}

{
  const { fighter, enemy, game } = movingDisguise();
  observeSuspiciousProps(fighter, game);
  game.platforms.push({ x: 620, y: 400, w: 50, h: 330, blocksSight: true });
  game._sightBlockers = null;
  for (let i = 1; i <= 4; i++) {
    game.elapsed = i * .4;
    enemy.x += 20;
    syncDisguisePosition(enemy);
    assert.equal(observeSuspiciousProps(fighter, game), null, "motion behind walls cannot create evidence");
  }

  {
    const { fighter, enemy, game } = movingDisguise();
    observeSuspiciousProps(fighter, game);
    game.elapsed = .4;
    enemy.x += 20;
    syncDisguisePosition(enemy);
    observeSuspiciousProps(fighter, game);
    game.platforms.push({ x: 620, y: 400, w: 50, h: 330, blocksSight: true });
    game._sightBlockers = null;
    game.elapsed = .8;
    enemy.x += 20;
    syncDisguisePosition(enemy);
    observeSuspiciousProps(fighter, game);
    game.platforms.pop();
    game._sightBlockers = null;
    game.elapsed = 1.2;
    enemy.x += 20;
    syncDisguisePosition(enemy);
    assert.equal(observeSuspiciousProps(fighter, game), null,
      "even a short visibility gap breaks the motion-evidence chain");
  }
  game.platforms.pop();
  game._sightBlockers = null;
  game.elapsed = 2;
  assert.equal(observeSuspiciousProps(fighter, game), null, "reappearance is not proof of unseen motion");
}

{
  const { fighter, game } = fixture();
  const prop = createMapProp("crate", 760, 700 + SIZE);
  game.props = [prop];
  assert.ok(propVisibleToSelf(fighter, prop, game), "a cover prop does not occlude its own visible body");
  observeSuspiciousProps(fighter, game);
  for (let i = 1; i <= 2; i++) {
    game.elapsed = i * .4;
    prop.x += 20;
    const probe = observeSuspiciousProps(fighter, game);
    if (i === 2) assert.ok(probe?.suspectedProp,
      "ordinary moving props can cause suspicion too; there is no hidden-identity oracle");
  }
  // A newly observed relocated prop cannot be tracked through an unseen interval.
  game.elapsed = 3;
  assert.equal(observeSuspiciousProps(fighter, game), null);
}

{
  const movement = (strategy) => {
    const { fighter, enemy, game, profile } = fixture(88, false);
    game.fighters = [fighter, enemy];
    enemy.x = fighter.x + 520;
    const state = tacticalState(fighter, game);
    state.trial = {
      context: "gun:no-extension:duel", strategy, started: 0,
      dealt: 0, taken: 0, distance: 520
    };
    fighter.aiState.timer = 0;
    updateAI(fighter, .05, game, profile);
    assert.equal(fighter.aiState.tacticalStrategy, strategy);
    return fighter.aiState.mx;
  };
  assert.equal(movement("pressure"), 1, "pressure actually closes distance");
  assert.equal(movement("cautious"), -1, "caution actually opens distance in the same situation");
}

for (const summon of [false, true]) {
  const { fighter, enemy, game, profile } = movingDisguise();
  fighter.buddy = false;
  if (summon) fighter.combatClone = true;
  for (let i = 0; i <= 2; i++) {
    game.elapsed = i * .4;
    if (i) enemy.x += 20;
    syncDisguisePosition(enemy);
    fighter.aiState.timer = 0;
    if (summon) updateAIClone(fighter, .05, game);
    else updateAI(fighter, .05, game, profile);
  }
  assert.equal(fighter.aiState.plan, "investigating moving prop");
  assert.equal(fighter.aiState.attack, true, "regular and summon AI can test a suspicious moving prop");
  assert.deepEqual(profile.tacticalMemory.contexts, {}, "suspicion alone is not a successful strategy trial");
}

console.log("Seeded tactical learning and observable disguise suspicion suite passed.");
