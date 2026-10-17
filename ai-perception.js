import { AI_PRESETS, SIZE } from "./config.js";
import { displayedHp, hasIllusionTruthSight, isHologram, isIllusionFighter } from "./illusionist.js";
import { scaleHealthAmount } from "./settings.js";
import { clamp, dist } from "./utils.js";

export function perceivedHp(subject, viewer = subject) {
  return displayedHp(subject, viewer);
}

export function aiHpBelow(subject, threshold, viewer = subject) {
  return perceivedHp(subject, viewer) < scaleHealthAmount(subject, threshold);
}

export function aiHpAtLeast(subject, threshold, viewer = subject) {
  return perceivedHp(subject, viewer) >= scaleHealthAmount(subject, threshold);
}

function sameAppearance(a, b) {
  return a.team === b.team && a.weaponId === b.weaponId
    && ["body", "helmet", "weapon", "jetpack", "shield"].every((slot) =>
      a.loadout?.[slot] === b.loadout?.[slot]);
}

function overlaps(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y) < SIZE * .9;
}

function crossed(a, b, positions) {
  if (overlaps(a, b)) return true;
  const beforeA = positions?.get(a);
  const beforeB = positions?.get(b);
  if (!beforeA || !beforeB) return false;
  const x = beforeA.x - beforeB.x;
  const y = beforeA.y - beforeB.y;
  const dx = a.x - b.x - x;
  const dy = a.y - b.y - y;
  const length = dx * dx + dy * dy;
  const t = length ? clamp(-(x * dx + y * dy) / length, 0, 1) : 0;
  return Math.hypot(x + dx * t, y + dy * t) < SIZE * .9;
}

function distancePreference(fighter, style) {
  if (style === "rusher" || fighter.survivalSwarm || fighter.bossAggression > 0) return 0;
  if (["defender", "coverer", "support"].includes(style)) return .65;
  const care = (AI_PRESETS[fighter.ai] || AI_PRESETS.balanced).fuelCare;
  return care <= .25 ? 0 : care >= .74 ? .65 : .35;
}

function pickLookalike(fighter, candidates, style, random) {
  const preference = distancePreference(fighter, style);
  const proximity = candidates.map((candidate) => 1 / Math.max(SIZE, dist(fighter, candidate)));
  const total = proximity.reduce((sum, value) => sum + value, 0);
  let roll = random();
  for (let i = 0; i < candidates.length; i++) {
    roll -= (1 - preference) / candidates.length + preference * proximity[i] / total;
    if (roll < 0) return candidates[i];
  }
  return candidates[candidates.length - 1];
}

/**
 * Track observed bodies, not real/decoy identities. Only truth sight may inspect
 * the illusion flag. Crossing lookalikes can break a previously continuous track.
 */
export function selectAiTarget(fighter, visible, {
  score = (candidate) => dist(fighter, candidate), trackingSkill,
  style, random = Math.random
} = {}) {
  const state = fighter.aiState;
  const truth = hasIllusionTruthSight(fighter);
  const candidates = truth
    ? visible.filter((candidate) => !isIllusionFighter(candidate) || isHologram(candidate)) : visible;
  let target = candidates.reduce((best, candidate) =>
    !best || score(candidate) < score(best) ? candidate : best, null);
  if (target && (!truth || isHologram(target)
    || candidates.some((candidate) => isHologram(candidate) && sameAppearance(candidate, target)))) {
    const lookalikes = candidates.filter((candidate) => sameAppearance(candidate, target));
    const tracked = lookalikes.includes(state.target) ? state.target : null;
    if (tracked) {
      target = tracked;
      const prior = state.visualTrack;
      const ambiguous = lookalikes.filter((candidate) => candidate !== tracked
        && crossed(tracked, candidate, prior?.positions)
        && !(prior?.overlapGroup.has(tracked) && prior.overlapGroup.has(candidate)));
      if (ambiguous.length) {
        const preset = AI_PRESETS[fighter.ai] || AI_PRESETS.balanced;
        const skill = clamp(trackingSkill ?? (1 - preset.aim / .75), 0, 1);
        if (random() < .85 - .65 * skill) {
          target = pickLookalike(fighter, [tracked, ...ambiguous], style, random);
        }
      }
    } else if (lookalikes.length > 1) {
      target = pickLookalike(fighter, lookalikes, style, random);
    }
  }
  state.visualTrack = {
    positions: new Map(visible.map((candidate) => [candidate, { x: candidate.x, y: candidate.y }])),
    overlapGroup: new Set(target ? candidates.filter((candidate) =>
      sameAppearance(candidate, target) && (candidate === target || overlaps(candidate, target))) : [])
  };
  state.target = target;
  return target;
}
