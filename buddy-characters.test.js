import assert from "node:assert/strict";
import {
  BUDDY_CHARACTERS, ensureBuddyCharacter, getBuddyCharacter, listBuddyCharacters,
  normalizeBuddyCharacterId, personalizeResultLines, pickRandomBuddyCharacter,
  selectBuddyCharacter, voiceBuddyText
} from "./buddy-characters.js";
import { ensureCoaching } from "./coaching.js";
import { DEFAULT_PROFILE } from "./config.js";

const clone = (v) => structuredClone(v);

function seeded(seq) {
  let i = 0;
  return () => {
    const v = seq[i % seq.length];
    i += 1;
    return v;
  };
}

// Roster integrity.
{
  assert.equal(BUDDY_CHARACTERS.length, 8);
  const ids = new Set();
  for (const character of BUDDY_CHARACTERS) {
    assert.ok(character.id);
    assert.ok(character.name);
    assert.ok(character.blurb);
    assert.ok(character.voice.catchphrases.length >= 2);
    assert.equal(ids.has(character.id), false);
    ids.add(character.id);
  }
  assert.deepEqual(listBuddyCharacters().map((c) => c.id), [...ids]);
}

// Random pick is deterministic with injected RNG.
{
  assert.equal(pickRandomBuddyCharacter(() => 0).id, "pixel");
  assert.equal(pickRandomBuddyCharacter(() => 0.99).id, "echo");
}

// ensureBuddyCharacter assigns random when missing; syncs stock names.
{
  const profile = clone(DEFAULT_PROFILE);
  profile.buddyCharacterId = null;
  profile.botName = "Pixel";
  const character = ensureBuddyCharacter(profile, () => 0.5);
  assert.ok(normalizeBuddyCharacterId(profile.buddyCharacterId));
  assert.equal(character.id, profile.buddyCharacterId);
  assert.equal(profile.botName, character.name);

  // Custom nicknames stick on re-ensure.
  profile.botName = "Sparky";
  ensureBuddyCharacter(profile, () => 0);
  assert.equal(profile.botName, "Sparky");
  assert.equal(profile.buddyCharacterId, character.id);
}

// Invalid saved id is replaced.
{
  const profile = clone(DEFAULT_PROFILE);
  profile.buddyCharacterId = "not-a-bot";
  ensureBuddyCharacter(profile, () => 0);
  assert.equal(profile.buddyCharacterId, "pixel");
}

// Selection updates id + stock name.
{
  const profile = clone(DEFAULT_PROFILE);
  ensureBuddyCharacter(profile, () => 0);
  assert.equal(selectBuddyCharacter(profile, "nova"), true);
  assert.equal(profile.buddyCharacterId, "nova");
  assert.equal(profile.botName, "Nova");
  assert.equal(getBuddyCharacter(profile).name, "Nova");

  profile.botName = "Custom";
  assert.equal(selectBuddyCharacter(profile, "atlas"), true);
  assert.equal(profile.botName, "Custom");
}

// Voice pass adds character flavor without wiping body text.
{
  const profile = clone(DEFAULT_PROFILE);
  selectBuddyCharacter(profile, "atlas");
  ensureCoaching(profile);
  const raw = "I stayed available for your engagements.";
  const voiced = voiceBuddyText(profile, raw, profile.coaching);
  assert.ok(voiced.includes("available for your engagements") || voiced.includes("We stayed"));
  assert.ok(!voiced.includes("!"));
}

// Result line personalization keeps reward-looking lines intact.
{
  const profile = clone(DEFAULT_PROFILE);
  selectBuddyCharacter(profile, "rook");
  ensureCoaching(profile);
  const lines = personalizeResultLines(profile, [
    "I got isolated and went down. That was my fault.",
    "+40¢ CYBER EARNED · BALANCE 160¢"
  ]);
  assert.equal(lines[1], "+40¢ CYBER EARNED · BALANCE 160¢");
  assert.ok(lines[0].includes("mistake") || lines[0].includes("isolated") || lines[0].includes("Status"));
}

// Distinct characters produce different catchphrase pools.
{
  const a = getBuddyCharacter("pixel").voice.catchphrases[0];
  const b = getBuddyCharacter("nova").voice.catchphrases[0];
  assert.notEqual(a, b);
}

console.log("buddy-characters.test.js: ok");
