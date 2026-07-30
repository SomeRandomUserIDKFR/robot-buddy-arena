import assert from "node:assert/strict";
import { DEFAULT_PROFILE } from "./config.js";
import {
  completeGuidedFight, dismissBayTutorialHint, ensureTutorialProfile,
  initTutorialState, shouldRunGuidedFight, shouldShowBayTutorialHint,
  tickTutorial, TUTORIAL_STEPS
} from "./tutorial.js";

const clone = (value) => structuredClone(value);

{
  const profile = clone(DEFAULT_PROFILE);
  profile.matches = 0;
  ensureTutorialProfile(profile);
  assert.equal(shouldRunGuidedFight(profile), true);
  assert.equal(shouldShowBayTutorialHint(profile), true);
}

{
  const profile = clone(DEFAULT_PROFILE);
  profile.matches = 3;
  ensureTutorialProfile(profile);
  assert.equal(shouldRunGuidedFight(profile), false);
  assert.equal(profile.tutorial.completed, true);
}

{
  const profile = clone(DEFAULT_PROFILE);
  profile.matches = 0;
  ensureTutorialProfile(profile);
  dismissBayTutorialHint(profile);
  assert.equal(shouldShowBayTutorialHint(profile), false);
  assert.equal(shouldRunGuidedFight(profile), false);
}

{
  const profile = clone(DEFAULT_PROFILE);
  profile.matches = 0;
  ensureTutorialProfile(profile);
  completeGuidedFight(profile);
  assert.equal(shouldRunGuidedFight(profile), false);
  assert.equal(profile.tutorial.completed, true);
  assert.equal(shouldShowBayTutorialHint(profile), false);
}

{
  assert.ok(TUTORIAL_STEPS.length >= 5);
  const game = {
    over: false,
    announcement: 2,
    tutorial: initTutorialState()
  };
  assert.equal(game.tutorial.step, 0);
  tickTutorial(game, { keys: { KeyD: true }, mouse: {} });
  assert.equal(game.tutorial.step, 1);
  tickTutorial(game, { keys: { Space: true }, mouse: {} });
  assert.equal(game.tutorial.step, 2);
  tickTutorial(game, { keys: {}, mouse: { down: true } });
  assert.equal(game.tutorial.step, 3);
  tickTutorial(game, { keys: {}, mouse: {}, dodgePressed: true });
  assert.equal(game.tutorial.step, 4);
  assert.match(game.tutorial.prompt, /FINISH/i);
}

console.log("ok: tutorial");
