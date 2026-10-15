import { SIZE, WORLD } from "./config.js";
import { relocateMapProp } from "./debris.js";
import { damageProp } from "./maps.js";
import { clamp } from "./utils.js";

export const DISGUISE_ID = "disguise";
export const DISGUISE_RANGE = 100;
export const DISGUISE_SPEED_MULT = 0.55;
export const DISGUISE_COOLDOWN = 5;

export function isDisguiseGear(fighterOrId) {
  if (typeof fighterOrId === "string") return fighterOrId === DISGUISE_ID;
  return !!fighterOrId?.disguiseGear
    || fighterOrId?.loadout?.extensionSecondary === DISGUISE_ID;
}

export function canDisguiseAs(prop) {
  return !!prop && prop.breakable && !prop.destroyed && (prop.hp ?? prop.maxHp ?? 0) > 0
    && prop.w > 0 && prop.h > 0
    && !prop.disguisedBy && !prop.heldBy && !prop.thrownInFlight
    && !prop.illusionObject && !prop.illusionHeldProp && !prop.illusionGhosted
    && !prop.powerCrate && prop.kind !== "powerCrate"
    && !prop.armorDummy && !prop.forgeHidden && !prop.lightCondensation
    && !prop.reconjurerCreated;
}

export function findDisguiseProp(fighter, game) {
  if (!fighter || !game) return null;
  const cx = fighter.x + SIZE / 2;
  const cy = fighter.y + SIZE / 2;
  let nearest = null;
  let nearestDistance = DISGUISE_RANGE;
  for (const prop of game.props || []) {
    if (!canDisguiseAs(prop)) continue;
    const distance = Math.hypot(
      cx - clamp(cx, prop.x, prop.x + prop.w),
      cy - clamp(cy, prop.y, prop.y + prop.h)
    );
    if (distance <= nearestDistance) {
      nearest = prop;
      nearestDistance = distance;
    }
  }
  return nearest;
}

function invalidateGeometry(game) {
  game._landables = null;
  game._projectileBlockers = null;
  game._sightBlockers = null;
}

export function syncDisguisePosition(fighter) {
  const prop = fighter?.disguiseProp;
  if (!prop) return;
  relocateMapProp(prop,
    clamp(fighter.x + SIZE / 2, prop.w / 2, WORLD.w - prop.w / 2),
    fighter.y + SIZE - prop.h / 2);
}

export function endDisguise(fighter, game = fighter?.disguiseGame) {
  const prop = fighter?.disguiseProp;
  if (!prop || !game) return null;
  syncDisguisePosition(fighter);
  fighter.disguiseProp = null;
  fighter.disguiseGame = null;
  fighter.disguiseCd = DISGUISE_COOLDOWN;
  delete prop.disguisedBy;
  delete prop.onDisguiseBreak;
  delete prop.onDisguiseHit;
  if (!game.props.includes(prop)) game.props.push(prop);
  invalidateGeometry(game);
  return prop;
}

export function tryDisguise(fighter, game) {
  if (!fighter || fighter.dead || !isDisguiseGear(fighter) || !game
    || game.paused || game.over) return null;
  if (fighter.disguiseProp) return endDisguise(fighter, game);
  if ((fighter.disguiseCd || 0) > 0 || fighter.shieldRaised || fighter.heldProp
    || fighter.hookReel || fighter.hookHang || fighter.hookDrag) return null;
  const prop = findDisguiseProp(fighter, game);
  if (!prop) return null;
  game.props.splice(game.props.indexOf(prop), 1);
  fighter.disguiseProp = prop;
  fighter.disguiseGame = game;
  prop.disguisedBy = fighter;
  prop.onDisguiseHit = () => syncDisguisePosition(fighter);
  // Reveal before destruction effects/explosions so they use the relocated prop.
  prop.onDisguiseBreak = () => endDisguise(fighter, game);
  syncDisguisePosition(fighter);
  invalidateGeometry(game);
  return prop;
}

export function damageDisguise(fighter, amount, game = fighter?.disguiseGame, extras = {}) {
  const prop = fighter?.disguiseProp;
  if (!prop || !game) return 0;
  syncDisguisePosition(fighter);
  const before = (prop.hp || 0) + (prop.braceHp || 0);
  const scale = game.healthScale || (game.settings?.visual?.useClassic100Hp ? 0.2 : 1);
  const raw = extras.alreadyScaled ? amount / scale : amount;
  damageProp(prop, raw, game, prop.x + prop.w / 2, prop.y + prop.h / 2, extras);
  return Math.max(0, before - (prop.hp || 0) - (prop.braceHp || 0));
}

export function tickDisguise(fighter, game, dt) {
  if (!fighter) return;
  fighter.disguiseCd = Math.max(0, (fighter.disguiseCd || 0) - dt);
  if (!fighter.disguiseProp) return;
  syncDisguisePosition(fighter);
  fighter.disguiseProp.hitFlash = Math.max(0, (fighter.disguiseProp.hitFlash || 0) - dt);
  if (fighter.dead || fighter.shieldRaised || fighter.disguiseProp.destroyed) {
    endDisguise(fighter, game);
  }
}

export function fighterHitbox(fighter) {
  if (fighter.disguiseProp) {
    syncDisguisePosition(fighter);
    const prop = fighter.disguiseProp;
    return { x: prop.x, y: prop.y, w: prop.w, h: prop.h };
  }
  return { x: fighter.x, y: fighter.y, w: SIZE, h: SIZE };
}

export function fighterHitPoint(fighter, x, y) {
  const box = fighterHitbox(fighter);
  return fighter.disguiseProp
    ? { x: clamp(x, box.x, box.x + box.w), y: clamp(y, box.y, box.y + box.h) }
    : { x: box.x + box.w / 2, y: box.y + box.h / 2 };
}
