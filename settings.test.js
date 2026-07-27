import assert from "node:assert/strict";
import { DEFAULT_PROFILE } from "./config.js";
import { Fighter } from "./combat.js";
import { applyHpDamage, applyLoadout, DEFAULT_LOADOUT, healFighter } from "./equipment.js";
import { hit } from "./combat.js";
import {
  CLASSIC_100_HP_SCALE, cloneSettings, ensureSettingsProfile, healthScale,
  hpBelow, normalizeOptimizeIllusions, normalizeSfxEnabled, normalizeUseClassic100Hp,
  optimizeIllusionsEnabled, scaleHealthAmount
} from "./settings.js";

assert.equal(normalizeOptimizeIllusions(undefined), true);
assert.equal(normalizeOptimizeIllusions(true), true);
assert.equal(normalizeOptimizeIllusions(false), false);
assert.equal(normalizeOptimizeIllusions("false"), false);
assert.equal(normalizeOptimizeIllusions(0), false);
assert.equal(normalizeSfxEnabled(undefined), true);
assert.equal(normalizeSfxEnabled(false), false);

assert.equal(normalizeUseClassic100Hp(undefined), false);
assert.equal(normalizeUseClassic100Hp(false), false);
assert.equal(normalizeUseClassic100Hp(true), true);
assert.equal(normalizeUseClassic100Hp("true"), true);
assert.equal(normalizeUseClassic100Hp(1), true);

{
  const profile = structuredClone(DEFAULT_PROFILE);
  delete profile.settings.gameplay;
  ensureSettingsProfile(profile, profile);
  assert.equal(profile.settings.gameplay.optimizeIllusions, true);
  assert.equal(profile.settings.gameplay.sfxEnabled, true);
  assert.ok(optimizeIllusionsEnabled(profile.settings));
  assert.ok(optimizeIllusionsEnabled({ settings: profile.settings }));
  assert.equal(profile.settings.visual.useClassic100Hp, false);
  assert.equal(healthScale(profile.settings), 1);
}

{
  const profile = structuredClone(DEFAULT_PROFILE);
  ensureSettingsProfile(profile, profile);
  profile.settings.gameplay.optimizeIllusions = false;
  profile.settings.gameplay.sfxEnabled = false;
  profile.settings.visual.useClassic100Hp = true;
  const cloned = cloneSettings(profile.settings);
  assert.equal(cloned.gameplay.optimizeIllusions, false);
  assert.equal(cloned.gameplay.sfxEnabled, false);
  assert.equal(optimizeIllusionsEnabled({ settings: cloned }), false);
  assert.equal(cloned.visual.useClassic100Hp, true);
  assert.equal(healthScale(cloned), CLASSIC_100_HP_SCALE);
  assert.equal(scaleHealthAmount(cloned, 500), 100);
}

// applyLoadout scales core pools.
{
  const bot = applyLoadout(new Fighter({}), DEFAULT_LOADOUT, {
    healthScale: CLASSIC_100_HP_SCALE
  });
  assert.equal(bot.healthScale, CLASSIC_100_HP_SCALE);
  assert.equal(bot.maxHp, 100);
  assert.equal(bot.hp, 100);
  assert.equal(bot.coreMaxHp, 100);
}

// Damage + heal respect the scale exactly once.
{
  const bot = applyLoadout(new Fighter({}), DEFAULT_LOADOUT, {
    healthScale: CLASSIC_100_HP_SCALE
  });
  applyHpDamage(bot, 50); // canonical 50 → 10
  assert.ok(Math.abs(bot.hp - 90) < 1e-6);

  healFighter(bot, 25); // canonical 25 → 5
  assert.ok(Math.abs(bot.hp - 95) < 1e-6);
}

// hit() scales before shield and does not double-scale through applyHpDamage.
{
  const target = applyLoadout(new Fighter({ x: 0, y: 0 }), {
    ...DEFAULT_LOADOUT, shield: "no-shield"
  }, { healthScale: CLASSIC_100_HP_SCALE });
  const source = applyLoadout(new Fighter({ x: 200, y: 0 }), DEFAULT_LOADOUT, {
    healthScale: CLASSIC_100_HP_SCALE
  });
  const before = target.hp;
  const game = {
    elapsed: 0,
    mode: "training",
    stats: {},
    effects: [],
    fighters: [source, target],
    pings: [],
    settings: { visual: { useClassic100Hp: true } }
  };
  hit(target, source, 50, Math.PI, game);
  assert.ok(Math.abs(before - target.hp - 10) < 1e-6, `expected -10 HP, got ${before - target.hp}`);
}

// Threshold helper tracks classic scale.
{
  const bot = applyLoadout(new Fighter({}), DEFAULT_LOADOUT, {
    healthScale: CLASSIC_100_HP_SCALE
  });
  bot.hp = 30; // = canonical 150
  assert.equal(hpBelow(bot, 180), true);
  assert.equal(hpBelow(bot, 140), false);
}

console.log("settings.test.js passed.");
