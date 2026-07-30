/**
 * First-run tutorial — short guided Training-like spar + bay hints.
 *
 * Profile.tutorial:
 *   completed       full tutorial finished (fight done)
 *   bayHintsSeen    bay highlight dismissed / used
 *   guidedFightDone guided spar finished at least once
 */

export const TUTORIAL_STEPS = Object.freeze([
  Object.freeze({
    id: "move",
    prompt: "TUTORIAL · MOVE — hold A or D"
  }),
  Object.freeze({
    id: "jump",
    prompt: "TUTORIAL · JUMP — W or Space"
  }),
  Object.freeze({
    id: "fire",
    prompt: "TUTORIAL · FIRE — left mouse"
  }),
  Object.freeze({
    id: "dodge",
    prompt: "TUTORIAL · DODGE — press C"
  }),
  Object.freeze({
    id: "finish",
    prompt: "TUTORIAL · FINISH — defeat the spar dummy"
  })
]);

export function ensureTutorialProfile(profile, saved = profile) {
  if (!profile || typeof profile !== "object") return null;
  const raw = saved?.tutorial && typeof saved.tutorial === "object" ? saved.tutorial : {};
  // Veterans with matches already played skip the guided fight soft-lock feel,
  // but still get a one-shot bay tip if they never saw it.
  const veteran = (Number(saved?.matches) || 0) > 0 || (Number(profile.matches) || 0) > 0;
  const guidedDone = !!raw.guidedFightDone || !!raw.completed || veteran;
  const completed = !!raw.completed || guidedDone;
  profile.tutorial = {
    completed,
    bayHintsSeen: !!raw.bayHintsSeen || completed,
    guidedFightDone: guidedDone
  };
  return profile.tutorial;
}

export function shouldShowBayTutorialHint(profile) {
  ensureTutorialProfile(profile);
  return !profile.tutorial.bayHintsSeen;
}

export function shouldRunGuidedFight(profile) {
  ensureTutorialProfile(profile);
  return !profile.tutorial.guidedFightDone;
}

export function dismissBayTutorialHint(profile) {
  ensureTutorialProfile(profile);
  // Skip opts out of the first-run nag. Players can still open Training anytime.
  profile.tutorial.bayHintsSeen = true;
  profile.tutorial.guidedFightDone = true;
  return profile.tutorial;
}

export function completeGuidedFight(profile) {
  ensureTutorialProfile(profile);
  profile.tutorial.guidedFightDone = true;
  profile.tutorial.completed = true;
  profile.tutorial.bayHintsSeen = true;
  return profile.tutorial;
}

export function initTutorialState() {
  return {
    step: 0,
    moved: false,
    jumped: false,
    fired: false,
    dodged: false,
    prompt: TUTORIAL_STEPS[0].prompt,
    done: false
  };
}

/**
 * Advance tutorial steps from input / combat events.
 * `input` shape: { keys, mouse, dodgePressed }
 */
export function tickTutorial(game, input = {}) {
  if (!game?.tutorial || game.tutorial.done || game.over) return game?.tutorial || null;
  const state = game.tutorial;
  const keys = input.keys || {};
  const mouse = input.mouse || {};

  if (keys.KeyA || keys.KeyD || keys.ArrowLeft || keys.ArrowRight) state.moved = true;
  if (keys.KeyW || keys.Space || keys.ArrowUp) state.jumped = true;
  if (mouse.down) state.fired = true;
  if (input.dodgePressed || keys.KeyC) state.dodged = true;

  const checks = [
    () => state.moved,
    () => state.jumped,
    () => state.fired,
    () => state.dodged,
    () => false // finish step clears on match end
  ];

  while (state.step < TUTORIAL_STEPS.length - 1 && checks[state.step]?.()) {
    state.step += 1;
    game.announcement = Math.max(game.announcement || 0, 2.2);
  }

  const step = TUTORIAL_STEPS[state.step] || TUTORIAL_STEPS[TUTORIAL_STEPS.length - 1];
  state.prompt = step.prompt;
  if (game.announcement > 0) {
    // Keep prompt visible while announcement timer runs; HUD reads state.prompt.
  }
  return state;
}

export function tutorialStepPrompt(state) {
  if (!state) return "";
  const step = TUTORIAL_STEPS[state.step] || TUTORIAL_STEPS[0];
  return step.prompt;
}
