import assert from "node:assert/strict";
import { updateAI } from "./ai.js";
import {
  ensureBuddyCharacter, selectBuddyCharacter
} from "./buddy-characters.js";
import { Fighter } from "./combat.js";
import {
  ensureFightStyle, fightStyleSpacingBias, getFightStyle, listFightStyles,
  normalizeFightStyle, selectFightStyle
} from "./fight-styles.js";
import { DEFAULT_PROFILE, SIZE } from "./config.js";

const clone = (value) => structuredClone(value);

function styleScenario(fightStyle) {
  const profile = clone(DEFAULT_PROFILE);
  profile.fightStyle = fightStyle;
  const player = new Fighter({
    x: 400, y: 1420 - SIZE, human: true, team: 0, weapon: "gun", grounded: true
  });
  const buddy = new Fighter({
    x: 420, y: 1420 - SIZE, team: 0, weapon: "gun", buddy: true,
    ai: "balanced", hp: 500, fuel: 0.9, grounded: true
  });
  const enemy = new Fighter({
    x: 900, y: 1420 - SIZE, team: 1, weapon: "gun", hp: 500, grounded: true
  });
  buddy.aiState.timer = 0;
  const game = {
    mode: "conquest", elapsed: 0, lastShotAtPlayer: -99,
    fighters: [player, buddy, enemy], pings: [], thoughts: []
  };
  return { buddy, game, profile };
}

{
  assert.equal(normalizeFightStyle("rusher"), "rusher");
  assert.equal(normalizeFightStyle("DEFENDER"), "defender");
  assert.equal(normalizeFightStyle("nope"), "balanced");
  assert.equal(normalizeFightStyle(null), "balanced");
  assert.ok(listFightStyles().length >= 5);
}

{
  const bias = fightStyleSpacingBias("rusher", "gun");
  assert.ok(bias.desiredDelta < 0);
  assert.ok(bias.retreatHpDelta < 0);
  const cover = fightStyleSpacingBias("coverer", "gun");
  assert.ok(cover.desiredDelta > 0);
  assert.ok(cover.coverEager > 0);
  const support = fightStyleSpacingBias("support", "gun");
  assert.ok(support.followPlayer > 0.4);
  assert.ok(support.pingBoost > 0.2);
}

{
  const profile = clone(DEFAULT_PROFILE);
  profile.buddyCharacterId = "nova";
  profile.fightStyle = null;
  ensureFightStyle(profile);
  assert.equal(profile.fightStyle, "rusher");
  assert.equal(getFightStyle(profile).id, "rusher");
}

{
  const profile = clone(DEFAULT_PROFILE);
  profile.buddyCharacterId = null;
  profile.fightStyle = null;
  profile.botName = "";
  const character = ensureBuddyCharacter(profile, () => 0.5);
  assert.ok(character.id);
  ensureFightStyle(profile);
  assert.equal(profile.fightStyle, character.suggestedFightStyle);
}

{
  const profile = clone(DEFAULT_PROFILE);
  profile.buddyCharacterId = "atlas";
  profile.fightStyle = "defender";
  assert.equal(selectBuddyCharacter(profile, "nova"), true);
  assert.equal(profile.fightStyle, "rusher");
}

{
  const profile = clone(DEFAULT_PROFILE);
  profile.buddyCharacterId = "atlas";
  profile.fightStyle = "coverer";
  assert.equal(selectBuddyCharacter(profile, "nova"), true);
  assert.equal(profile.fightStyle, "coverer");
}

{
  const profile = clone(DEFAULT_PROFILE);
  assert.equal(selectFightStyle(profile, "support"), true);
  assert.equal(profile.fightStyle, "support");
  assert.equal(selectFightStyle(profile, "not-real"), true);
  assert.equal(profile.fightStyle, "balanced");
}

{
  const rush = styleScenario("rusher");
  const cover = styleScenario("coverer");
  updateAI(rush.buddy, 1, rush.game, rush.profile);
  updateAI(cover.buddy, 1, cover.game, cover.profile);
  assert.equal(rush.buddy.aiState.fightStyleId, "rusher");
  assert.equal(cover.buddy.aiState.fightStyleId, "coverer");
  assert.ok(cover.buddy.aiState.fightStyleCoverEager > rush.buddy.aiState.fightStyleCoverEager);
  // Rusher should pull farther right (toward foe) than coverer at same spawn.
  assert.ok(
    (rush.buddy.aiState.mx || 0) >= (cover.buddy.aiState.mx || 0),
    "rusher should not hang back more than coverer"
  );
}

console.log("ok: fight-styles");
