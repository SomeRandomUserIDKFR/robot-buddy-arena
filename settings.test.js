import assert from "node:assert/strict";
import { DEFAULT_PROFILE } from "./config.js";
import {
  cloneSettings, ensureSettingsProfile, normalizeOptimizeIllusions,
  optimizeIllusionsEnabled
} from "./settings.js";

assert.equal(normalizeOptimizeIllusions(undefined), true);
assert.equal(normalizeOptimizeIllusions(true), true);
assert.equal(normalizeOptimizeIllusions(false), false);
assert.equal(normalizeOptimizeIllusions("false"), false);
assert.equal(normalizeOptimizeIllusions(0), false);

{
  const profile = structuredClone(DEFAULT_PROFILE);
  delete profile.settings.gameplay;
  ensureSettingsProfile(profile, profile);
  assert.equal(profile.settings.gameplay.optimizeIllusions, true);
  assert.ok(optimizeIllusionsEnabled(profile.settings));
  assert.ok(optimizeIllusionsEnabled({ settings: profile.settings }));
}

{
  const profile = structuredClone(DEFAULT_PROFILE);
  ensureSettingsProfile(profile, profile);
  profile.settings.gameplay.optimizeIllusions = false;
  const cloned = cloneSettings(profile.settings);
  assert.equal(cloned.gameplay.optimizeIllusions, false);
  assert.equal(optimizeIllusionsEnabled({ settings: cloned }), false);
}

console.log("settings.test.js passed.");
