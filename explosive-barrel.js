/**
 * Explosive red barrels — mid-tier blast when a breakable prop is destroyed.
 * Chain reactions are allowed (each barrel detonates once).
 */
import { SIZE } from "./config.js";

export const RED_BARREL_KIND = "redBarrel";

/** Mid-tier blast: matches throw-breakable impact damage. */
export const RED_BARREL_BLAST_DAMAGE = 48;
/** Splash radius in world units. */
export const RED_BARREL_BLAST_RADIUS = 150;
/** Soft edge: center deals full damage, rim deals this fraction. */
export const RED_BARREL_BLAST_FALLOFF = 0.5;
const POWER_CRATE_FALLBACK = 40;

/** Late-bound fighter hitter (wired from combat.js to avoid import cycles). */
let hitFn = null;
/** Late-bound power-crate damager (optional). */
let damagePowerCrateFn = null;

export function bindExplosiveBarrelHitter(fn) {
  hitFn = typeof fn === "function" ? fn : null;
}

export function bindExplosiveBarrelPowerCrateDamager(fn) {
  damagePowerCrateFn = typeof fn === "function" ? fn : null;
}

export function isExplosiveBarrel(prop) {
  if (!prop) return false;
  return prop.kind === RED_BARREL_KIND || prop.explosive === true;
}

function blastFalloff(dist, radius) {
  if (!(radius > 0) || dist >= radius) return 0;
  const t = dist / radius;
  return 1 - t * (1 - RED_BARREL_BLAST_FALLOFF);
}

/**
 * Detonate a destroyed explosive prop. Safe to call once per prop.
 * @param {object} prop
 * @param {object} game
 * @param {number} ix blast center x
 * @param {number} iy blast center y
 * @param {(other: object, amount: number, game: object, x: number, y: number) => void} [damagePropFn]
 */
export function detonateExplosiveBarrel(prop, game, ix, iy, damagePropFn) {
  if (!prop || !game || prop._blastDone) return;
  prop._blastDone = true;

  const cx = Number.isFinite(ix) ? ix : prop.x + (prop.w || 0) / 2;
  const cy = Number.isFinite(iy) ? iy : prop.y + (prop.h || 0) / 2;
  const radius = RED_BARREL_BLAST_RADIUS;
  const baseDamage = RED_BARREL_BLAST_DAMAGE;

  if (Array.isArray(game.effects)) {
    game.effects.push({
      type: "explosion",
      x: cx,
      y: cy,
      life: 0.42,
      radius,
      color: "#ff6a2a"
    });
  }

  const blastSource = {
    totalDamage: 0,
    buddy: false,
    human: false,
    x: cx - SIZE / 2,
    y: cy - SIZE / 2,
    explosiveBarrel: true
  };

  if (typeof hitFn === "function" && Array.isArray(game.fighters)) {
    for (const fighter of game.fighters) {
      if (!fighter || fighter.dead) continue;
      const fx = fighter.x + SIZE / 2;
      const fy = fighter.y + SIZE / 2;
      const d = Math.hypot(fx - cx, fy - cy);
      const mult = blastFalloff(d, radius);
      if (!(mult > 0)) continue;
      const damage = baseDamage * mult;
      const angle = Math.atan2(fy - cy, fx - cx);
      hitFn(fighter, blastSource, damage, angle, game, { fromExplosion: true });
    }
  }

  if (typeof damagePropFn === "function" && Array.isArray(game.props)) {
    for (const other of game.props) {
      if (!other || other === prop || other.destroyed) continue;
      if (!other.breakable) continue;
      const ox = other.x + (other.w || 0) / 2;
      const oy = other.y + (other.h || 0) / 2;
      const d = Math.hypot(ox - cx, oy - cy);
      const mult = blastFalloff(d, radius);
      if (!(mult > 0)) continue;
      damagePropFn(other, baseDamage * mult, game, ox, oy);
    }
  }

  if (typeof damagePowerCrateFn === "function" && Array.isArray(game.powerCrates)) {
    for (const crate of game.powerCrates) {
      if (!crate || crate.destroyed) continue;
      const ox = crate.x + (crate.w || POWER_CRATE_FALLBACK) / 2;
      const oy = crate.y + (crate.h || POWER_CRATE_FALLBACK) / 2;
      const d = Math.hypot(ox - cx, oy - cy);
      const mult = blastFalloff(d, radius);
      if (!(mult > 0)) continue;
      damagePowerCrateFn(crate, baseDamage * mult, blastSource, game, ox, oy);
    }
  }
}
