/**
 * Shield Steal — secondary weapon.
 * Hold fire for a short-range beam that drains shield durability from the
 * victim and transfers a portion into your own shield pool.
 *
 * Raised plate: 75% transfer, only while the plate faces the beam.
 * Lowered plate: 100% transfer (more vulnerable), no facing check.
 * Broken shields cannot be drained.
 */
import { SIZE } from "./config.js";
import { angleDiff, dist } from "./utils.js";

/** Local copy of frontal shield facing (avoids equipment ↔ shield-steal cycle). */
function shieldFacesBeam(enemy, beamTravelAngle) {
  if (!enemy?.shieldRaised || enemy.shieldBroken) return false;
  if (!(enemy.shieldMaxDurability > 0) || !(enemy.shieldDurability > 0)) return false;
  const half = enemy.shieldBlockHalfAngle || 0;
  if (half <= 0) return false;
  return Math.abs(angleDiff(beamTravelAngle, enemy.aim + Math.PI)) <= half;
}

export const SHIELD_STEAL_ID = "shield-steal";

/** Max beam reach (world units). */
export const SHIELD_STEAL_RANGE = 160;
/** Half-angle of the steal cone (radians). */
export const SHIELD_STEAL_HALF_ANGLE = 0.38;
/** Shield durability drained from the victim per second. */
export const SHIELD_STEAL_DRAIN_PER_SEC = 90;
/** Transfer while the victim's plate is raised and facing the beam. */
export const SHIELD_STEAL_TRANSFER_RAISED = 0.75;
/** Transfer while the victim's shield is lowered (more vulnerable). */
export const SHIELD_STEAL_TRANSFER_LOWERED = 1;
/** Alias used by equipment DPS estimates (raised-plate case). */
export const SHIELD_STEAL_TRANSFER = SHIELD_STEAL_TRANSFER_RAISED;

export function isShieldSteal(fighterOrId) {
  if (typeof fighterOrId === "string") return fighterOrId === SHIELD_STEAL_ID;
  if (fighterOrId?.shieldSteal === true) return true;
  return fighterOrId?.weaponId === SHIELD_STEAL_ID;
}

function beamOrigin(fighter) {
  const aim = Number.isFinite(fighter.aim) ? fighter.aim : 0;
  return {
    x: fighter.x + SIZE / 2 + Math.cos(aim) * 28,
    y: fighter.y + SIZE / 2 + Math.sin(aim) * 28,
    aim
  };
}

function transferRateForVictim(victim) {
  const raised = !!(victim?.shieldRaised && !victim.shieldBroken);
  return raised ? SHIELD_STEAL_TRANSFER_RAISED : SHIELD_STEAL_TRANSFER_LOWERED;
}

/**
 * Closest living enemy in the short cone with a drainable shield pool.
 * Raised plates require facing the beam; lowered plates are always vulnerable.
 */
export function findShieldStealTarget(fighter, game) {
  if (!fighter || !game) return null;
  const { x: ox, y: oy, aim } = beamOrigin(fighter);
  let best = null;
  let bestD = Infinity;
  for (const enemy of game.fighters || []) {
    if (
      !enemy
      || enemy.dead
      || enemy === fighter
      || enemy.team === fighter.team
      || enemy.illusion
      || enemy.combatClone
    ) {
      continue;
    }
    if (enemy.shieldBroken) continue;
    if (!(enemy.shieldMaxDurability > 0) || !(enemy.shieldDurability > 0)) continue;

    const cx = enemy.x + SIZE / 2;
    const cy = enemy.y + SIZE / 2;
    const d = Math.hypot(cx - ox, cy - oy);
    if (d > SHIELD_STEAL_RANGE || d < 8) continue;
    const ang = Math.atan2(cy - oy, cx - ox);
    if (Math.abs(angleDiff(ang, aim)) > SHIELD_STEAL_HALF_ANGLE) continue;
    const raised = !!(enemy.shieldRaised && !enemy.shieldBroken);
    // Raised plates only siphon while facing the beam (same gate as block).
    if (raised && !shieldFacesBeam(enemy, ang)) continue;
    if (d < bestD) {
      bestD = d;
      best = enemy;
    }
  }
  return best;
}

/**
 * Per-frame hold-fire tick. Returns steal result or null.
 */
export function tickShieldStealBeam(fighter, game, dt) {
  if (!fighter || fighter.dead || !game) return null;
  if (!isShieldSteal(fighter)) return null;
  // Same raise lockout as other attacks — drop Q to steal.
  if (fighter.shieldRaised && !fighter.shieldBroken) {
    fighter.shieldStealBeamLen = 0;
    fighter.shieldStealTarget = null;
    return null;
  }

  const { x: ox, y: oy, aim } = beamOrigin(fighter);
  const victim = findShieldStealTarget(fighter, game);
  fighter.shieldStealFlash = 0.14;
  fighter.shieldStealTarget = victim || null;

  if (!victim) {
    fighter.shieldStealBeamLen = SHIELD_STEAL_RANGE * 0.55;
    fighter.shieldStealBeamX = ox + Math.cos(aim) * fighter.shieldStealBeamLen;
    fighter.shieldStealBeamY = oy + Math.sin(aim) * fighter.shieldStealBeamLen;
    return null;
  }

  const cx = victim.x + SIZE / 2;
  const cy = victim.y + SIZE / 2;
  const reach = Math.min(SHIELD_STEAL_RANGE, dist(
    { x: ox, y: oy },
    { x: cx, y: cy }
  ));
  fighter.shieldStealBeamLen = reach;
  fighter.shieldStealBeamX = ox + Math.cos(aim) * reach;
  fighter.shieldStealBeamY = oy + Math.sin(aim) * reach;

  const step = Math.max(0, dt || 0);
  const drain = SHIELD_STEAL_DRAIN_PER_SEC * step;
  const taken = Math.min(drain, victim.shieldDurability || 0);
  if (!(taken > 0)) return null;

  // Capture raise state before drain (breaking lowers the plate).
  const transferRate = transferRateForVictim(victim);

  victim.shieldDurability = Math.max(0, (victim.shieldDurability || 0) - taken);
  victim.shieldFlash = Math.max(victim.shieldFlash || 0, 0.1);
  if (victim.shieldDurability <= 0) {
    victim.shieldDurability = 0;
    victim.shieldBroken = true;
    victim.shieldRaised = false;
  }

  const gained = taken * transferRate;
  let applied = 0;
  if ((fighter.shieldMaxDurability || 0) > 0 && gained > 0) {
    const before = fighter.shieldDurability || 0;
    fighter.shieldDurability = Math.min(
      fighter.shieldMaxDurability,
      before + gained
    );
    applied = fighter.shieldDurability - before;
    if (fighter.shieldDurability > 0) fighter.shieldBroken = false;
  }

  if (game.effects && step > 0) {
    // Sparse sparkle so a continuous beam doesn't flood the effect list.
    if (Math.random() < Math.min(1, step * 14)) {
      game.effects.push({
        type: "propHit",
        x: cx,
        y: cy,
        life: 0.08
      });
    }
  }

  return { victim, taken, gained: applied };
}

export function tickShieldStealFighter(fighter, dt) {
  if (!fighter) return;
  if (fighter.shieldStealFlash > 0) {
    fighter.shieldStealFlash = Math.max(0, fighter.shieldStealFlash - (dt || 0));
  }
  if (!(fighter.shieldStealHeld) && fighter.shieldStealFlash <= 0) {
    fighter.shieldStealTarget = null;
    fighter.shieldStealBeamLen = 0;
  }
}

/** Catalog helper — true if gear id is Shield Steal. */
export function isShieldStealGear(gearOrId) {
  if (typeof gearOrId === "string") return gearOrId === SHIELD_STEAL_ID;
  return gearOrId?.id === SHIELD_STEAL_ID || gearOrId?.shieldSteal === true;
}
