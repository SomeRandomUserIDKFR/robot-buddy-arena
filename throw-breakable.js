/**
 * Throw Breakable secondary: grab any map breakable, hold it (still damageable),
 * throw for impact damage + debris. Reconquer rebuilds on a valid floor near impact.
 */
import { GRAVITY, SIZE, WORLD } from "./config.js";
import { resolveStandTarget } from "./debris.js";
import { damageProp, platformsOf, solidProps } from "./maps.js";
import { clamp } from "./utils.js";

export const THROW_BREAKABLE_ID = "throw-breakable";
export const THROW_BREAKABLE_GRAB_RANGE = 100;
export const THROW_BREAKABLE_DAMAGE = 48;
export const THROW_BREAKABLE_SPEED = 980;
export const THROW_BREAKABLE_HOLD_REACH = 34;
/** Cap held silhouette so trees/pillars still read as handheld. */
export const THROW_BREAKABLE_HOLD_MAX = 52;
/** Power crates are only grabbable at or below this fraction of max HP. */
export const THROW_POWER_CRATE_GRAB_HP_FRAC = 0.5;

/**
 * Late-bound damager for power crates (avoids throw-breakable ↔ powerups ↔ equipment cycle).
 * Wired from combat.js once modules load.
 */
let damagePowerCrateFn = null;
export function bindThrowBreakablePowerCrateDamager(fn) {
  damagePowerCrateFn = typeof fn === "function" ? fn : null;
}

export function isThrowBreakable(fighterOrId) {
  if (typeof fighterOrId === "string") return fighterOrId === THROW_BREAKABLE_ID;
  return fighterOrId?.weaponId === THROW_BREAKABLE_ID
    || fighterOrId?.throwBreakable === true;
}

/** Whether Throw Breakable may pick up this prop / metal power crate. */
export function canGrabBreakable(prop) {
  if (!prop || prop.destroyed || !prop.breakable) return false;
  if (prop.heldBy || prop.thrownInFlight) return false;
  if (prop.armorDummy || prop.forgeHidden) return false;
  // Glare nodes are shot, not handheld.
  if (prop.lightCondensation || prop.kind === "lightCondensation") return false;
  if (prop.powerCrate || prop.kind === "powerCrate") {
    const maxHp = Math.max(1, prop.maxHp ?? prop.hp ?? 1);
    return (prop.hp ?? maxHp) <= maxHp * THROW_POWER_CRATE_GRAB_HP_FRAC;
  }
  return true;
}

function realPropCenter(prop) {
  return { x: prop.x + prop.w / 2, y: prop.y + prop.h / 2 };
}

function saveCanopyOffset(prop) {
  if (!prop.canopy) return;
  prop._canopyOx = prop.canopy.x - prop.x;
  prop._canopyOy = prop.canopy.y - prop.y;
}

function syncCanopy(prop) {
  if (!prop.canopy || prop._canopyOx == null) return;
  prop.canopy.x = prop.x + prop._canopyOx;
  prop.canopy.y = prop.y + prop._canopyOy;
}

function holdScaleFor(prop) {
  const fullW = prop._fullW || prop.w;
  const fullH = prop._fullH || prop.h;
  return Math.min(1, THROW_BREAKABLE_HOLD_MAX / Math.max(fullW, fullH, 1));
}

function applyHoldDimensions(prop) {
  const fullW = prop._fullW || prop.w;
  const fullH = prop._fullH || prop.h;
  const scale = holdScaleFor(prop);
  prop.w = Math.max(12, fullW * scale);
  prop.h = Math.max(12, fullH * scale);
}

function restoreFullDimensions(prop) {
  if (prop._fullW) prop.w = prop._fullW;
  if (prop._fullH) prop.h = prop._fullH;
}

/** World point where a held breakable sits (along aim). */
export function heldBreakableAnchor(fighter) {
  const cx = fighter.x + SIZE / 2;
  const cy = fighter.y + SIZE / 2;
  const aim = Number.isFinite(fighter.aim) ? fighter.aim : 0;
  return {
    x: cx + Math.cos(aim) * THROW_BREAKABLE_HOLD_REACH,
    y: cy + Math.sin(aim) * THROW_BREAKABLE_HOLD_REACH
  };
}

function positionHeldProp(fighter, prop) {
  const anchor = heldBreakableAnchor(fighter);
  applyHoldDimensions(prop);
  prop.x = anchor.x - prop.w / 2;
  prop.y = anchor.y - prop.h / 2;
  syncCanopy(prop);
}

export function dropHeldBreakable(fighter, game = null) {
  const prop = fighter?.heldProp;
  if (!prop) return null;
  fighter.heldProp = null;
  prop.heldBy = null;
  prop.thrownInFlight = false;
  restoreFullDimensions(prop);
  if (!prop.destroyed) {
    prop.solid = prop.baseSolid ?? prop._heldSolid ?? false;
    prop.blocksProjectiles = prop.baseBlocksProjectiles ?? prop._heldBlocksProjectiles ?? true;
    prop.blocksSight = prop.baseBlocksSight ?? prop._heldBlocksSight ?? false;
    if (fighter) {
      const aim = Number.isFinite(fighter.aim) ? fighter.aim : 0;
      const cx = fighter.x + SIZE / 2 + Math.cos(aim) * 40;
      const cy = fighter.y + SIZE / 2 + Math.sin(aim) * 20;
      prop.x = clamp(cx - prop.w / 2, 0, WORLD.w - prop.w);
      prop.y = clamp(cy - prop.h / 2, 0, WORLD.h - prop.h);
      syncCanopy(prop);
    }
  }
  if (game?.effects && !prop.destroyed) {
    game.effects.push({
      type: "propHit",
      x: prop.x + prop.w / 2,
      y: prop.y + prop.h / 2,
      life: 0.1
    });
  }
  return prop;
}

/**
 * Grab nearest intact breakable map prop (or ≤50% HP power crate) in range.
 * @returns {boolean}
 */
export function tryGrabBreakable(fighter, game) {
  if (!fighter || fighter.dead || !game) return false;
  if (fighter.heldProp && !fighter.heldProp.destroyed) return false;
  fighter.heldProp = null;

  const cx = fighter.x + SIZE / 2;
  const cy = fighter.y + SIZE / 2;
  let best = null;
  let bestD = THROW_BREAKABLE_GRAB_RANGE;
  const candidates = [
    ...(game.props || []),
    ...(game.powerCrates || [])
  ];
  for (const prop of candidates) {
    if (!canGrabBreakable(prop)) continue;
    const pc = realPropCenter(prop);
    const d = Math.hypot(pc.x - cx, pc.y - cy);
    if (d <= bestD) {
      best = prop;
      bestD = d;
    }
  }
  if (!best) return false;

  saveCanopyOffset(best);
  best._fullW = best.w;
  best._fullH = best.h;
  best._heldSolid = best.solid;
  best._heldBlocksProjectiles = best.blocksProjectiles;
  best._heldBlocksSight = best.blocksSight;
  best.solid = false;
  best.blocksProjectiles = true;
  best.blocksSight = false;
  best.heldBy = fighter;
  best.thrownInFlight = false;
  fighter.heldProp = best;
  positionHeldProp(fighter, best);
  if (game.effects) {
    game.effects.push({
      type: "propHit",
      x: best.x + best.w / 2,
      y: best.y + best.h / 2,
      life: 0.12
    });
  }
  return true;
}

/**
 * Shatter a prop at a world point and leave debris for reconquer-at-hit.
 * Snaps the prop slot onto a valid stand surface (same checks as armor dummies)
 * near the impact so rebuild doesn't float mid-air.
 * @param {*} attacker fighter credited for power-crate loot on kill
 */
export function shatterBreakableAt(prop, game, impactX, impactY, attacker = null) {
  if (!prop || !game) return false;
  restoreFullDimensions(prop);
  prop.thrownInFlight = false;
  prop.heldBy = null;
  prop.solid = false;
  prop.blocksProjectiles = false;
  prop.blocksSight = false;

  // Same floor-pick as armor dummies: vote scraps (none here) else first
  // surface at/below the impact so rebuild never floats between platforms.
  const { targetX, targetY } = resolveStandTarget(
    game,
    [],
    impactX,
    impactY,
    prop.w,
    prop.h,
    { excludeProp: prop }
  );
  prop.x = targetX - prop.w / 2;
  prop.y = targetY - prop.h / 2;
  syncCanopy(prop);

  if (prop.powerCrate || prop.kind === "powerCrate") {
    if (prop.destroyed || prop.hp <= 0) {
      prop.destroyed = false;
      prop.hp = 1;
      prop.groundDebrisDropped = false;
    }
    const amount = Math.max(1, prop.hp || prop.maxHp || 1);
    if (!damagePowerCrateFn) return false;
    return damagePowerCrateFn(prop, amount, attacker, game, impactX, impactY);
  }

  // Ensure destroy path runs even if already low HP.
  if (prop.destroyed || prop.hp <= 0) {
    prop.destroyed = false;
    prop.hp = 1;
    prop.groundDebrisDropped = false;
  }
  prop.hp = 0;
  // Hit FX stay at the true impact; jigsaw/reconquer use the snapped prop slot.
  return damageProp(prop, 1, game, impactX, impactY);
}

export function throwHeldBreakable(fighter, game) {
  const prop = fighter?.heldProp;
  if (!prop || prop.destroyed || !game) return false;

  const aim = Number.isFinite(fighter.aim) ? fighter.aim : 0;
  const anchor = heldBreakableAnchor(fighter);
  fighter.heldProp = null;
  prop.heldBy = null;
  prop.thrownInFlight = true;
  prop.solid = false;
  prop.blocksProjectiles = false;
  prop.blocksSight = false;
  restoreFullDimensions(prop);
  prop.x = anchor.x - prop.w / 2;
  prop.y = anchor.y - prop.h / 2;
  syncCanopy(prop);

  game.thrownBreakables ||= [];
  game.thrownBreakables.push({
    prop,
    owner: fighter,
    x: anchor.x,
    y: anchor.y,
    vx: Math.cos(aim) * THROW_BREAKABLE_SPEED,
    vy: Math.sin(aim) * THROW_BREAKABLE_SPEED * 0.92 - 80,
    life: 2.4,
    damage: THROW_BREAKABLE_DAMAGE,
    spin: (Math.random() - 0.5) * 10
  });
  if (game.effects) {
    game.effects.push({
      type: "muzzle",
      x: anchor.x,
      y: anchor.y,
      life: 0.08,
      angle: aim,
      report: false
    });
  }
  return true;
}

/** Per-frame: keep held prop on the hand; drop if destroyed / weapon swapped. */
export function tickThrowBreakable(fighter, game, dt) {
  if (!fighter) return;
  if (fighter.dead) {
    dropHeldBreakable(fighter, game);
    return;
  }
  if (fighter.heldProp && (fighter.heldProp.destroyed || fighter.heldProp.hp <= 0)) {
    fighter.heldProp.heldBy = null;
    fighter.heldProp = null;
  }
  if (!isThrowBreakable(fighter)) {
    if (fighter.heldProp) dropHeldBreakable(fighter, game);
    return;
  }
  const prop = fighter.heldProp;
  if (!prop || prop.destroyed) {
    fighter.heldProp = null;
    return;
  }
  positionHeldProp(fighter, prop);
  if (prop.hitFlash > 0) prop.hitFlash = Math.max(0, prop.hitFlash - (dt || 0));
}

function rectsOverlap(ax, ay, aw, ah, bx, by, bw, bh) {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

/**
 * Integrate in-flight thrown breakables.
 * @param {(target, owner, damage, angle, game) => void} onFighterHit
 */
export function stepThrownBreakables(game, dt, onFighterHit = null) {
  const list = game?.thrownBreakables;
  if (!list?.length) return;
  const keep = [];
  for (const thrown of list) {
    if (!thrown || thrown.life <= 0) continue;
    const prop = thrown.prop;
    if (!prop || prop.destroyed) continue;

    thrown.life -= dt;
    thrown.vy += GRAVITY * 0.55 * dt;
    const ox = thrown.x;
    const oy = thrown.y;
    thrown.x += thrown.vx * dt;
    thrown.y += thrown.vy * dt;

    const hw = prop.w * 0.5;
    const hh = prop.h * 0.5;
    prop.x = thrown.x - hw;
    prop.y = thrown.y - hh;
    syncCanopy(prop);

    const finish = (ix, iy, enemy = null) => {
      if (enemy && typeof onFighterHit === "function") {
        onFighterHit(enemy, thrown.owner, thrown.damage, Math.atan2(thrown.vy, thrown.vx), game);
      }
      shatterBreakableAt(prop, game, ix, iy, thrown.owner);
      thrown.life = 0;
    };

    let impacted = false;
    for (const enemy of game.fighters || []) {
      if (enemy.dead || enemy === thrown.owner) continue;
      if (enemy.team === thrown.owner?.team) continue;
      if (rectsOverlap(prop.x, prop.y, prop.w, prop.h, enemy.x, enemy.y, SIZE, SIZE)) {
        finish(thrown.x, thrown.y, enemy);
        impacted = true;
        break;
      }
    }
    if (impacted) continue;

    const solidTargets = [
      ...(game.props || []),
      ...(game.powerCrates || [])
    ];
    for (const other of solidTargets) {
      if (other === prop || other.destroyed || !other.breakable) continue;
      if (other.heldBy || other.thrownInFlight || other.forgeHidden) continue;
      if (!other.solid && !other.blocksProjectiles) continue;
      if (rectsOverlap(prop.x, prop.y, prop.w, prop.h, other.x, other.y, other.w, other.h)) {
        if (other.powerCrate || other.kind === "powerCrate") {
          if (damagePowerCrateFn) {
            damagePowerCrateFn(
              other, thrown.damage * 0.45, thrown.owner, game, thrown.x, thrown.y
            );
          }
        } else {
          damageProp(other, thrown.damage * 0.45, game, thrown.x, thrown.y);
        }
        finish(thrown.x, thrown.y, null);
        impacted = true;
        break;
      }
    }
    if (impacted) continue;

    const surfaces = [
      ...platformsOf(game),
      ...solidProps(game).filter((p) => p !== prop)
    ];
    for (const plat of surfaces) {
      const wasAbove = oy + hh <= plat.y + 4;
      const crosses = thrown.y + hh >= plat.y
        && thrown.y + hh <= plat.y + Math.max(24, Math.abs(thrown.vy) * dt + 12);
      if (
        wasAbove && crosses && thrown.vy >= 0
        && thrown.x + hw > plat.x
        && thrown.x - hw < plat.x + plat.w
      ) {
        finish(thrown.x, plat.y, null);
        impacted = true;
        break;
      }
    }
    if (impacted) continue;

    if (
      thrown.life <= 0
      || thrown.x < -80 || thrown.x > WORLD.w + 80
      || thrown.y > WORLD.h + 80
    ) {
      finish(
        clamp(thrown.x, 8, WORLD.w - 8),
        clamp(thrown.y, 8, WORLD.h - 8),
        null
      );
      continue;
    }

    keep.push(thrown);
  }
  game.thrownBreakables = keep;
}

/** Attack handler: grab if empty, throw if holding. */
export function attackThrowBreakable(fighter, game) {
  if (!isThrowBreakable(fighter) || !fighter || fighter.dead) return false;
  const rpm = Math.max(30, fighter.weaponRpm || 90);
  fighter.attackCd = 60 / rpm;
  if (fighter.heldProp && !fighter.heldProp.destroyed) {
    throwHeldBreakable(fighter, game);
  } else {
    tryGrabBreakable(fighter, game);
  }
  return true;
}
