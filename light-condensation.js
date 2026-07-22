/**
 * Light Condensation — extension secondary (key 3).
 * Plants a tiny neon glare square: reveals allies' fog in a large radius,
 * blocks LOS on a mid-size box (larger than the sprite). Break to end both.
 */
import { SIZE, WORLD } from "./config.js";
import { GEAR_BY_ID } from "./equipment.js";
import { clamp } from "./utils.js";

export const LIGHT_CONDENSATION_ID = "light-condensation";

/** Seconds between successful plantings. */
export const LIGHT_CONDENSATION_COOLDOWN = 10;
/** Drawn / hittable square side (px). */
export const LIGHT_CONDENSATION_SIZE = 14;
/** HP — a few bullets or one solid slash. */
export const LIGHT_CONDENSATION_HP = 36;
/** Reveal radius = size × this (ally fog + team vision). */
export const LIGHT_CONDENSATION_REVEAL_MULT = 10;
/** Sight block box side = size × this (centered on the sprite). */
export const LIGHT_CONDENSATION_BLOCK_MULT = 5;
/** Aim-placed distance from planter center. */
export const LIGHT_CONDENSATION_PLACE_REACH = 110;
/** Neon fill for the condensed core. */
export const LIGHT_CONDENSATION_COLOR = "#f7f4c8";
export const LIGHT_CONDENSATION_GLOW = "#ffe56a";

export function lightCondensationRevealRadius(size = LIGHT_CONDENSATION_SIZE) {
  return Math.max(8, size * LIGHT_CONDENSATION_REVEAL_MULT);
}

export function lightCondensationBlockSide(size = LIGHT_CONDENSATION_SIZE) {
  return Math.max(size, size * LIGHT_CONDENSATION_BLOCK_MULT);
}

export function isLightCondensation(fighterOrId) {
  if (typeof fighterOrId === "string") return fighterOrId === LIGHT_CONDENSATION_ID;
  if (fighterOrId?.lightCondensation === true) return true;
  const id = fighterOrId?.loadout?.extensionSecondary;
  return id === LIGHT_CONDENSATION_ID
    || GEAR_BY_ID[id]?.lightCondensation === true;
}

export function isLightCondensationProp(prop) {
  return !!prop && (prop.lightCondensation === true || prop.kind === "lightCondensation");
}

/** Inflated LOS box for a living glare node (or null). */
export function lightCondensationSightBox(prop) {
  if (!isLightCondensationProp(prop) || prop.destroyed || !(prop.hp > 0)) return null;
  const side = prop.sightBlockSide || lightCondensationBlockSide(prop.w || LIGHT_CONDENSATION_SIZE);
  const cx = prop.x + (prop.w || 0) / 2;
  const cy = prop.y + (prop.h || 0) / 2;
  return {
    x: cx - side / 2,
    y: cy - side / 2,
    w: side,
    h: side,
    blocksSight: true,
    lightCondensation: true
  };
}

/** Living glare nodes on `game.props`. */
export function listLightCondensationProps(game) {
  return (game?.props || []).filter(
    (p) => isLightCondensationProp(p) && !p.destroyed && (p.hp == null || p.hp > 0)
  );
}

/**
 * Team fog / visibility reveal: target center inside an allied node's reveal radius.
 */
export function inLightCondensationReveal(game, team, target) {
  if (!game || target == null || team == null) return false;
  const cx = target.x + SIZE / 2;
  const cy = target.y + SIZE / 2;
  for (const prop of listLightCondensationProps(game)) {
    if (prop.team !== team) continue;
    const pr = prop.revealRadius || lightCondensationRevealRadius(prop.w || LIGHT_CONDENSATION_SIZE);
    const px = prop.x + (prop.w || 0) / 2;
    const py = prop.y + (prop.h || 0) / 2;
    if (Math.hypot(cx - px, cy - py) <= pr) return true;
  }
  return false;
}

function placePoint(fighter) {
  const cx = fighter.x + SIZE / 2;
  const cy = fighter.y + SIZE / 2;
  const aim = Number.isFinite(fighter.aim) ? fighter.aim : 0;
  return {
    x: cx + Math.cos(aim) * LIGHT_CONDENSATION_PLACE_REACH,
    y: cy + Math.sin(aim) * LIGHT_CONDENSATION_PLACE_REACH
  };
}

/**
 * Build a breakable glare prop (not solid; projectile-hittable; inflated LOS).
 */
export function createLightCondensationProp(xCenter, yCenter, owner) {
  const size = LIGHT_CONDENSATION_SIZE;
  const x = clamp(xCenter - size / 2, 0, WORLD.w - size);
  const y = clamp(yCenter - size / 2, 0, WORLD.h - size);
  return {
    kind: "lightCondensation",
    lightCondensation: true,
    x,
    y,
    w: size,
    h: size,
    hp: LIGHT_CONDENSATION_HP,
    maxHp: LIGHT_CONDENSATION_HP,
    solid: false,
    blocksProjectiles: true,
    blocksSight: true,
    baseSolid: false,
    baseBlocksProjectiles: true,
    baseBlocksSight: true,
    breakable: true,
    canopy: null,
    hitFlash: 0,
    destroyed: false,
    // No scrap pile / reconquer — glare just pops.
    groundDebrisDropped: true,
    revealRadius: lightCondensationRevealRadius(size),
    sightBlockSide: lightCondensationBlockSide(size),
    team: owner?.team ?? 0,
    ownerId: owner?.id ?? null,
    color: LIGHT_CONDENSATION_COLOR,
    glow: LIGHT_CONDENSATION_GLOW
  };
}

/**
 * Press 3: plant a condensed light spot along aim.
 * @returns {object|null} the new prop
 */
export function tryLightCondensation(fighter, game) {
  if (!fighter || fighter.dead || !game) return null;
  if (!isLightCondensation(fighter)) return null;
  if ((fighter.lightCondensationCd || 0) > 0) return null;

  const at = placePoint(fighter);
  const prop = createLightCondensationProp(at.x, at.y, fighter);
  game.props ||= [];
  game.props.push(prop);
  fighter.lightCondensationCd = LIGHT_CONDENSATION_COOLDOWN;
  fighter.lightCondensationFlash = 0.2;

  if (game.effects) {
    game.effects.push({
      type: "muzzle",
      x: prop.x + prop.w / 2,
      y: prop.y + prop.h / 2,
      life: 0.1,
      angle: fighter.aim || 0,
      report: false
    });
    game.effects.push({
      type: "propHit",
      x: prop.x + prop.w / 2,
      y: prop.y + prop.h / 2,
      life: 0.16
    });
  }
  return prop;
}

export function tickLightCondensation(fighter, dt) {
  if (!fighter) return;
  const step = dt || 0;
  if (fighter.lightCondensationCd > 0) {
    fighter.lightCondensationCd = Math.max(0, fighter.lightCondensationCd - step);
  }
  if (fighter.lightCondensationFlash > 0) {
    fighter.lightCondensationFlash = Math.max(0, fighter.lightCondensationFlash - step);
  }
}

