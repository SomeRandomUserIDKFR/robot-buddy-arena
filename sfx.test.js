import assert from "node:assert/strict";
import {
  applySfxSettings, isSfxEnabled, playBreakableDestroySfx, playBreakableHitSfx,
  playImpactSfx, playMeleeSfx, playShotSfx, setJetpackThrusting, setSfxEnabled
} from "./sfx.js";
import { DEFAULT_PROFILE } from "./config.js";
import {
  cloneSettings, ensureSettingsProfile, normalizeSfxEnabled
} from "./settings.js";

assert.equal(normalizeSfxEnabled(undefined), true);
assert.equal(normalizeSfxEnabled(false), false);
assert.equal(normalizeSfxEnabled("false"), false);

{
  const profile = structuredClone(DEFAULT_PROFILE);
  delete profile.settings.gameplay.sfxEnabled;
  ensureSettingsProfile(profile, profile);
  assert.equal(profile.settings.gameplay.sfxEnabled, true);
  const cloned = cloneSettings(profile.settings);
  assert.equal(cloned.gameplay.sfxEnabled, true);
}

// Headless: play helpers must not throw without AudioContext / unlock.
setSfxEnabled(true);
playShotSfx({ hitscan: true });
playShotSfx({ tracer: true });
playShotSfx();
playMeleeSfx();
playImpactSfx();
playImpactSfx({ shield: true });
playBreakableHitSfx();
playBreakableDestroySfx();
playBreakableDestroySfx({ explosive: true });
setJetpackThrusting(true);
setJetpackThrusting(false);

setSfxEnabled(false);
assert.equal(isSfxEnabled(), false);
applySfxSettings({ sfxEnabled: true });
assert.equal(isSfxEnabled(), true);

console.log("sfx.test.js passed.");
