/**
 * Doppel — Extension (key 3).
 * Spawns a real fighter clone that looks like an Illusionist decoy (same face,
 * color, kit silhouette) but deals / takes real damage. 25% of your max HP,
 * max 2 alive, 30s cooldown. Priced under Illusionist.
 */
import { SIZE, WORLD } from "./config.js";
import { applyLoadout, GEAR_BY_ID, NO_EXTENSION_ID } from "./equipment.js";
import { clamp } from "./utils.js";

export const COMBAT_CLONE_ID = "doppel";

/** Plant cooldown (s). */
export const COMBAT_CLONE_COOLDOWN = 30;
/** Max living clones per owner. */
export const COMBAT_CLONE_MAX_ACTIVE = 2;
/** Clone HP as a fraction of the owner's max HP. */
export const COMBAT_CLONE_HP_FRAC = 0.25;

export function isCombatCloneGear(fighterOrId) {
  if (typeof fighterOrId === "string") return fighterOrId === COMBAT_CLONE_ID;
  if (fighterOrId?.combatCloneGear === true) return true;
  const id = fighterOrId?.loadout?.extensionSecondary;
  return id === COMBAT_CLONE_ID || GEAR_BY_ID[id]?.combatClone === true;
}

export function isCombatClone(fighter) {
  return !!fighter?.combatClone;
}

export function listCombatClones(game) {
  if (game?._livingCombatClones) return game._livingCombatClones;
  return (game?.fighters || []).filter((f) => isCombatClone(f) && !f.dead);
}

export function refreshCombatCloneCaches(game) {
  if (!game) return;
  const living = [];
  for (const f of game.fighters || []) {
    if (isCombatClone(f) && !f.dead) living.push(f);
  }
  game._livingCombatClones = living;
}

function ownCloneCount(game, fighter) {
  let n = 0;
  for (const c of listCombatClones(game)) {
    if (c.cloneOwner === fighter) n++;
  }
  return n;
}

function placePoint(fighter) {
  const cx = fighter.x + SIZE / 2;
  const cy = fighter.y + SIZE / 2;
  const aim = Number.isFinite(fighter.aim) ? fighter.aim : 0;
  const reach = 90;
  return {
    x: clamp(cx + Math.cos(aim) * reach - SIZE / 2, 0, WORLD.w - SIZE),
    y: clamp(cy + Math.sin(aim) * reach * 0.35 - SIZE * 0.2, 0, WORLD.h - SIZE)
  };
}

/**
 * Build a real AI twin cloning `owner`'s kit (extension stripped so it can't
 * nest-spawn). Inject `FighterCtor` to avoid combat import cycles.
 */
export function createCombatClone(owner, FighterCtor) {
  if (!owner?.loadout || typeof FighterCtor !== "function") return null;
  const { x, y } = placePoint(owner);
  const loadout = {
    ...owner.loadout,
    // Clones fight — they don't bring another Extension plant tool.
    extensionSecondary: NO_EXTENSION_ID
  };
  const clone = applyLoadout(new FighterCtor({
    x,
    y,
    team: owner.team,
    color: owner.color,
    name: owner.name,
    ai: owner.ai || "balanced",
    grounded: !!owner.grounded,
    aim: owner.aim,
    facing: owner.facing || 1,
    sight: owner.sight
  }), loadout);
  clone.human = false;
  clone.buddy = false;
  clone.combatClone = true;
  clone.cloneOwner = owner;
  clone.aim = owner.aim;
  clone.facing = owner.facing || 1;
  const maxHp = Math.max(40, Math.round((owner.maxHp || 500) * COMBAT_CLONE_HP_FRAC));
  clone.maxHp = maxHp;
  clone.hp = maxHp;
  clone.fuel = Math.min(1, owner.fuel ?? 1);
  // Look like an Illusionist decoy at a glance: no special name tag.
  return clone;
}

/**
 * Press 3: spawn a real doppel along aim.
 * @param {Function} [FighterCtor]
 * @returns {object|null}
 */
export function tryCombatCloneSpawn(fighter, game, FighterCtor = null) {
  if (!fighter || fighter.dead || !game) return null;
  if (!isCombatCloneGear(fighter)) return null;
  if ((fighter.combatCloneCd || 0) > 0) return null;
  if (ownCloneCount(game, fighter) >= COMBAT_CLONE_MAX_ACTIVE) return null;
  const clone = createCombatClone(fighter, FighterCtor);
  if (!clone) return null;
  game.fighters.push(clone);
  fighter.combatCloneCd = COMBAT_CLONE_COOLDOWN;
  fighter.combatCloneFlash = 0.18;
  refreshCombatCloneCaches(game);
  return clone;
}

export function tickCombatCloneFighter(fighter, dt) {
  if (!fighter) return;
  const step = dt || 0;
  if (fighter.combatCloneCd > 0) {
    fighter.combatCloneCd = Math.max(0, fighter.combatCloneCd - step);
  }
  if (fighter.combatCloneFlash > 0) {
    fighter.combatCloneFlash = Math.max(0, fighter.combatCloneFlash - step);
  }
}

export function tickCombatCloneWorld(game) {
  if (!game || !Array.isArray(game.fighters)) return;
  let drop = false;
  for (const f of game.fighters) {
    if (!isCombatClone(f) || f.dead) continue;
    const owner = f.cloneOwner;
    if (!owner || owner.dead) {
      f.dead = true;
      f.hp = 0;
      drop = true;
    }
  }
  for (const f of game.fighters) {
    if (isCombatClone(f) && f.dead) {
      drop = true;
      break;
    }
  }
  if (drop) {
    game.fighters = game.fighters.filter((f) => !isCombatClone(f) || !f.dead);
  }
  refreshCombatCloneCaches(game);
}
