import { SIZE } from "./config.js";
import { clamp, dist } from "./utils.js";
import { propVisibleToSelf } from "./vision.js";
import { perceivedHp } from "./ai-perception.js";

export const TACTICAL_STRATEGIES = Object.freeze(["balanced", "pressure", "cautious", "flank"]);
export const TACTICAL_TRIAL_SECONDS = 4;
export const TACTICAL_EXPLORATION = .18;
export const PROP_SUSPICION_THRESHOLD = .75;

function emptyMemory() {
  return { contexts: {} };
}

export function ensureTacticalMemory(profile) {
  const saved = profile.tacticalMemory;
  const memory = emptyMemory();
  for (const [key, records] of Object.entries(saved?.contexts || {}).slice(0, 64)) {
    if (!/^(gun|saber):[a-z-]+:(hurt|outnumbered|duel)$/.test(key)) continue;
    memory.contexts[key] = {};
    for (const strategy of TACTICAL_STRATEGIES) {
      const record = records?.[strategy];
      if (!record || !Number.isFinite(record.trials) || !Number.isFinite(record.value)) continue;
      memory.contexts[key][strategy] = {
        trials: clamp(Math.floor(record.trials), 0, 64),
        value: clamp(record.value, -1, 1)
      };
    }
  }
  profile.tacticalMemory = memory;
  return memory;
}

function seedHash(value) {
  let hash = 2166136261;
  for (const char of String(value)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return hash >>> 0;
}

export function tacticalState(fighter, game) {
  if (fighter.tacticalState?.game === game) return fighter.tacticalState;
  const index = game._nextTacticalActor || 0;
  game._nextTacticalActor = index + 1;
  const state = {
    game, randomState: seedHash(`${game.seed ?? game.id ?? 0}:${index}:${fighter.team}`),
    memory: emptyMemory(), trial: null, observations: new Map(), preference: {}
  };
  fighter.tacticalState = state;
  for (const strategy of TACTICAL_STRATEGIES) state.preference[strategy] = tacticalRandom(fighter, game) * .14;
  return state;
}

export function tacticalRandom(fighter, game) {
  const state = fighter.tacticalState?.game === game
    ? fighter.tacticalState : tacticalState(fighter, game);
  state.randomState = (state.randomState + 0x6d2b79f5) >>> 0;
  let value = state.randomState;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
}

function memoryFor(fighter, game, profile) {
  const state = tacticalState(fighter, game);
  if (fighter.buddy && !fighter.combatClone && !fighter.illusion && profile) {
    if (!profile.tacticalMemory?.contexts) ensureTacticalMemory(profile);
    return profile.tacticalMemory;
  }
  return state.memory;
}

export function recordTacticalDamage(target, source, amount) {
  if (!(amount > 0) || !Number.isFinite(amount)) return;
  target.tacticalDamageTaken = (target.tacticalDamageTaken || 0) + amount;
  const attacker = source?.cloneOwner || source;
  if (attacker && attacker !== target && attacker.team !== target.team && !source.illusion) {
    attacker.tacticalDamageDealt = (attacker.tacticalDamageDealt || 0) + amount;
  }
}

function finishTrial(fighter, game, profile, target, force = false) {
  const state = tacticalState(fighter, game);
  const trial = state.trial;
  if (!trial || (!force && (game.elapsed || 0) - trial.started < TACTICAL_TRIAL_SECONDS)) return;
  state.trial = null;
  if (game.learningLocked || ((game.elapsed || 0) - trial.started < 1 && !fighter.dead)) return;
  const dealt = Math.max(0, (fighter.tacticalDamageDealt || 0) - trial.dealt);
  const taken = Math.max(0, (fighter.tacticalDamageTaken || 0) - trial.taken);
  const scale = fighter.healthScale || 1;
  const escaped = trial.strategy === "cautious" && taken > 0 && target
    && dist(fighter, target) - trial.distance >= 100;
  if (!dealt && !taken && !fighter.dead) return;
  const reward = clamp((dealt - taken * 1.15) / (100 * scale)
    + (escaped ? .35 : 0) - (fighter.dead ? .75 : 0), -1, 1);
  const memory = memoryFor(fighter, game, profile);
  const context = memory.contexts[trial.context] ||= {};
  const record = context[trial.strategy] ||= { trials: 0, value: 0 };
  record.trials = Math.min(64, record.trials + 1);
  record.value += (reward - record.value) / Math.min(16, record.trials);
}

export function chooseTacticalStrategy(fighter, game, profile, visible, target) {
  const state = tacticalState(fighter, game);
  const liveTarget = target && visible.includes(target) && !target.suspectedProp;
  if (!liveTarget) {
    finishTrial(fighter, game, profile, null, true);
    return "balanced";
  }
  const situation = perceivedHp(fighter) < fighter.maxHp * .35 ? "hurt"
    : visible.length > 1 ? "outnumbered" : "duel";
  const contextKey = `${fighter.weapon}:${fighter.loadout?.extensionSecondary || "no-extension"}:${situation}`;
  if (state.trial && state.trial.context !== contextKey) finishTrial(fighter, game, profile, target, true);
  finishTrial(fighter, game, profile, target);
  if (state.trial) return state.trial.strategy;
  const records = memoryFor(fighter, game, profile).contexts[contextKey] || {};
  const exploring = tacticalRandom(fighter, game) < TACTICAL_EXPLORATION;
  const strategy = exploring
    ? TACTICAL_STRATEGIES[Math.floor(tacticalRandom(fighter, game) * TACTICAL_STRATEGIES.length)]
    : TACTICAL_STRATEGIES.reduce((best, candidate) => {
      const score = (key) => (records[key]?.value || 0) * .65
        + .16 / Math.sqrt(1 + (records[key]?.trials || 0)) + state.preference[key];
      return score(candidate) > score(best) ? candidate : best;
    });
  state.trial = {
    context: contextKey, strategy, started: game.elapsed || 0,
    dealt: fighter.tacticalDamageDealt || 0, taken: fighter.tacticalDamageTaken || 0,
    distance: dist(fighter, target)
  };
  return strategy;
}

export function finishTacticalLearning(game, profile, onlyDead = false) {
  for (const fighter of game.fighters || []) {
    if ((!onlyDead || fighter.dead) && fighter.tacticalState?.game === game) {
      finishTrial(fighter, game, profile, fighter.aiState?.target, true);
    }
  }
}

export function observeSuspiciousProps(fighter, game) {
  const state = tacticalState(fighter, game);
  const now = game.elapsed || 0;
  const props = new Set(game.props || []);
  // These are visual prop bodies, not identified enemy fighters.
  for (const actor of game.fighters || []) {
    if (actor.disguiseProp && actor !== fighter && actor.team !== fighter.team) props.add(actor.disguiseProp);
  }
  let suspicious = null;
  let bestDistance = Infinity;
  for (const prop of props) {
    if (prop.destroyed || prop.heldBy || prop.thrownInFlight || !prop.w || !prop.h) continue;
    if (!propVisibleToSelf(fighter, prop, game)) {
      const prior = state.observations.get(prop);
      if (prior) prior.visible = false;
      continue;
    }
    const x = prop.x + prop.w / 2;
    const y = prop.y + prop.h / 2;
    const prior = state.observations.get(prop);
    const dt = prior ? now - prior.time : 0;
    let confidence = prior?.visible && dt <= 1.5 ? Math.max(0, prior.confidence - dt * .2) : 0;
    if (prior?.visible && dt > 0 && dt <= 1.5 && Math.abs(x - prior.x) >= 6
      && Math.abs(x - prior.x) / dt >= 25) confidence = Math.min(1, confidence + .45);
    state.observations.set(prop, { x, y, time: now, confidence, visible: true });
    if (confidence < PROP_SUSPICION_THRESHOLD) continue;
    const probe = {
      x: x - SIZE / 2, y: y - SIZE / 2, vx: 0, vy: 0,
      hp: 500, weapon: "gun", grounded: true, suspectedProp: true
    };
    const distance = dist(fighter, probe);
    if (distance < bestDistance) {
      suspicious = probe;
      bestDistance = distance;
    }
  }
  for (const [prop, observation] of state.observations) {
    if (!props.has(prop) || now - observation.time > 2) state.observations.delete(prop);
  }
  return suspicious;
}
