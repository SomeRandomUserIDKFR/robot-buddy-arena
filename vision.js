import { SIGHT, SIZE } from "./config.js";
import { isCombatClone } from "./combat-clone.js";
import { isIllusionFighter } from "./illusionist.js";
import { inLightCondensationReveal } from "./light-condensation.js";
import { sightBlockers } from "./maps.js";
import { optimizeIllusionsEnabled } from "./settings.js";
import { gimmickSightMult } from "./map-gimmicks.js";
import { inSignalTripwireReveal } from "./trapper.js";
import { angleDiff, dist, segmentHitsBox } from "./utils.js";

function cachedSightBlockers(game) {
  if (game?._sightBlockers) return game._sightBlockers;
  const blockers = sightBlockers(game);
  if (game) game._sightBlockers = blockers;
  return blockers;
}

export function inDirectionalSight(observer, target, game = null) {
  const range = (observer.directionalSightRange || 0) * gimmickSightMult(game);
  const halfAngle = observer.sightHalfAngle || 0;
  if (!range || !halfAngle || dist(observer, target) > range) return false;
  const angle = Math.atan2(target.y - observer.y, target.x - observer.x);
  return Math.abs(angleDiff(angle, observer.aim || 0)) <= halfAngle;
}

/** Tiny laser-beam samples shared by a team while the beam is live. */
export function inBeamReveal(game, team, target) {
  const reveals = game?.beamReveals;
  if (!Array.isArray(reveals) || !reveals.length) return false;
  const cx = target.x + SIZE / 2;
  const cy = target.y + SIZE / 2;
  for (const sample of reveals) {
    if (sample.team !== team || !(sample.radius > 0)) continue;
    if (Math.hypot(cx - sample.x, cy - sample.y) <= sample.radius) return true;
  }
  return false;
}

/**
 * Hard LOS against sight-blocking walls / solid props.
 * Forest trunks and desert soft cover do NOT block sight.
 */
export function hasLineOfSight(game, from, to) {
  const x1 = from.x + SIZE / 2;
  const y1 = from.y + SIZE / 2;
  const x2 = to.x + SIZE / 2;
  const y2 = to.y + SIZE / 2;
  const blockers = cachedSightBlockers(game);
  for (const box of blockers) {
    if (segmentHitsBox(x1, y1, x2, y2, box.x, box.y, box.w, box.h)) return false;
  }
  return true;
}

function canSeeTarget(game, observer, target) {
  const sight = (observer.sight || SIGHT) * gimmickSightMult(game);
  const inRange = dist(observer, target) <= sight
    || inDirectionalSight(observer, target, game);
  if (!inRange) return false;
  return hasLineOfSight(game, observer, target);
}

export function visibleToTeam(game, observer, target) {
  // With Optimize illusions: decoys / Doppels must not act as extra team eyes.
  const skipSummons = optimizeIllusionsEnabled(game);
  return game.fighters.some(
    (fighter) => (
      !fighter.dead
      && !(skipSummons && isIllusionFighter(fighter))
      && !(skipSummons && isCombatClone(fighter))
      && fighter.team === observer.team
      && canSeeTarget(game, fighter, target)
    )
  )
    || inBeamReveal(game, observer.team, target)
    || inLightCondensationReveal(game, observer.team, target)
    || inSignalTripwireReveal(game, observer.team, target);
}

export function visibleToSelf(observer, target, game = null) {
  const sight = (observer.sight || SIGHT) * gimmickSightMult(game);
  const inRange = dist(observer, target) <= sight
    || inDirectionalSight(observer, target, game);
  if (!inRange) return false;
  if (!game) return true;
  return hasLineOfSight(game, observer, target);
}

/**
 * Whether the viewer should render `fighter`.
 * - Conquest (and any ally): same-team fighters always see each other — the
 *   player and buddy stay visible with no sight / wall check.
 * - Training / spar: the buddy is on the enemy team, so he only appears when
 *   in team sight + LOS like any other foe.
 */
export function fighterVisibleToViewer(game, viewer, fighter) {
  if (!game || !viewer || !fighter) return false;
  // Shared faction — conquest duo always sees one another.
  if (fighter.team === viewer.team) return true;
  return visibleToTeam(game, viewer, fighter);
}

/** True when `a` and `b` are the conquest player↔buddy pair (same team). */
export function isConquestDuo(game, a, b) {
  if (!game || game.mode !== "conquest" || !a || !b) return false;
  if (a.team !== b.team) return false;
  return !!(a.buddy || b.buddy) && !!(a.human || b.human || a.buddy || b.buddy);
}
