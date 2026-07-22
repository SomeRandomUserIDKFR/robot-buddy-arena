import { SIGHT, SIZE } from "./config.js";
import { inLightCondensationReveal } from "./light-condensation.js";
import { sightBlockers } from "./maps.js";
import { angleDiff, dist, segmentHitsBox } from "./utils.js";

export function inDirectionalSight(observer, target) {
  const range = observer.directionalSightRange || 0;
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
  const blockers = sightBlockers(game);
  for (const box of blockers) {
    if (segmentHitsBox(x1, y1, x2, y2, box.x, box.y, box.w, box.h)) return false;
  }
  return true;
}

function canSeeTarget(game, observer, target) {
  const inRange = dist(observer, target) <= (observer.sight || SIGHT)
    || inDirectionalSight(observer, target);
  if (!inRange) return false;
  return hasLineOfSight(game, observer, target);
}

export function visibleToTeam(game, observer, target) {
  return game.fighters.some(
    (fighter) => (
      !fighter.dead && fighter.team === observer.team
      && canSeeTarget(game, fighter, target)
    )
  )
    || inBeamReveal(game, observer.team, target)
    || inLightCondensationReveal(game, observer.team, target);
}

export function visibleToSelf(observer, target, game = null) {
  const inRange = dist(observer, target) <= (observer.sight || SIGHT)
    || inDirectionalSight(observer, target);
  if (!inRange) return false;
  if (!game) return true;
  return hasLineOfSight(game, observer, target);
}
