/**
 * Real clone Extensions (key 3): Doppel, Shadow Clone, and Split.
 * Doppel uses 25% max HP and a 30s cooldown. Shadow Clone links damage/status
 * across 25-HP twins with Illusionist's cooldown. Split exchanges physical
 * bodies while retaining the controller's normal kit and stored health.
 */
import { SIZE, WORLD } from "./config.js";
import {
  applyLoadout, GEAR_BY_ID, NO_EXTENSION_ID, SHADOW_CLONE_ID, SPLIT_ID,
  syncNanotechDisplayedHp
} from "./equipment.js";
import { ILLUSIONIST_COOLDOWN } from "./illusionist.js";
import { clamp } from "./utils.js";

export const COMBAT_CLONE_ID = "doppel";
export { SHADOW_CLONE_ID, SPLIT_ID };
export const LINKED_CLONE_HP = 25;
export const SPLIT_TWIN_HP = 100;
export const SPLIT_SWITCH_COOLDOWN = 3;
export const SPLIT_SWITCH_KEY = "KeyH";

const SHARED_STATUS_FIELDS = [
  "trapLockT", "trapLockKind", "signalRevealT", "signalRevealTeam",
  "icePinT", "iceSlowT"
];

const BODY_FIELDS = [
  "x", "y", "vx", "vy", "grounded", "facing", "aim", "fuel", "jetLocked",
  "jetReleased", "thrusting", "powerBuffs", ...SHARED_STATUS_FIELDS
];

export function cloneSpawnCooldown(fighter) {
  return fighter?.shadowCloneGear ? ILLUSIONIST_COOLDOWN : COMBAT_CLONE_COOLDOWN;
}

export function cloneGearName(fighter) {
  return fighter?.shadowCloneGear ? "Shadow Clone" : fighter?.splitGear ? "Split" : "Doppel";
}

export function isSplitGear(fighter) {
  return fighter?.splitGear === true || fighter?.loadout?.extensionSecondary === SPLIT_ID;
}

function linkShadowClone(owner, clone) {
  if (!owner.shadowLink) {
    const status = Object.fromEntries(SHARED_STATUS_FIELDS.map((key) => [key, owner[key]]));
    owner.shadowLink = { owner, members: new Set([owner]), status };
    bindShadowStatus(owner, owner.shadowLink);
  }
  const link = owner.shadowLink;
  clone.shadowLink = link;
  clone.powerBuffs = owner.powerBuffs;
  link.members.add(clone);
  bindShadowStatus(clone, link);
}

function bindShadowStatus(fighter, link) {
  // One status clock for the group; existing spell/trap setters work on any body.
  for (const key of SHARED_STATUS_FIELDS) {
    Object.defineProperty(fighter, key, {
      configurable: true,
      enumerable: true,
      get: () => link.status[key],
      set: (value) => { link.status[key] = value; }
    });
  }
}

/** Plant cooldown (s). */
export const COMBAT_CLONE_COOLDOWN = 30;
/** Max living clones per owner. */
export const COMBAT_CLONE_MAX_ACTIVE = 2;
/** Clone HP as a fraction of the owner's max HP. */
export const COMBAT_CLONE_HP_FRAC = 0.25;

export function isCombatCloneGear(fighterOrId) {
  if (typeof fighterOrId === "string") {
    return fighterOrId === COMBAT_CLONE_ID || fighterOrId === SHADOW_CLONE_ID || fighterOrId === SPLIT_ID;
  }
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
  }), loadout, { healthScale: owner.healthScale || 1 });
  clone.human = false;
  clone.buddy = false;
  clone.combatClone = true;
  clone.cloneOwner = owner;
  clone.cloneVariant = owner.loadout.extensionSecondary;
  clone.aim = owner.aim;
  clone.facing = owner.facing || 1;
  const minHp = 40 * (owner.healthScale || 1);
  const fixedHp = clone.cloneVariant === SHADOW_CLONE_ID || clone.cloneVariant === SPLIT_ID;
  const maxHp = clone.cloneVariant === SPLIT_ID ? SPLIT_TWIN_HP : fixedHp ? LINKED_CLONE_HP
    : Math.max(minHp, Math.round((owner.maxHp || 500 * (owner.healthScale || 1)) * COMBAT_CLONE_HP_FRAC));
  clone.maxHp = maxHp;
  clone.hp = maxHp;
  clone.coreMaxHp = maxHp;
  clone.coreHp = maxHp;
  if (fixedHp) {
    clone.retractableMax = 0;
    clone.retractableHp = 0;
    clone.retractableDeployed = false;
    clone.nanobotArmor = 0;
  }
  clone.fuel = Math.min(1, owner.fuel ?? 1);
  if (clone.cloneVariant === SHADOW_CLONE_ID) linkShadowClone(owner, clone);
  // Look like an Illusionist decoy at a glance: no special name tag.
  return clone;
}

/**
 * Press 3: spawn a real twin along aim.
 * @param {Function} [FighterCtor]
 * @returns {object|null}
 */
export function tryCombatCloneSpawn(fighter, game, FighterCtor = null) {
  if (!fighter || fighter.dead || !game) return null;
  if ((fighter.shadowCloneGear || fighter.splitGear) && (game.paused || game.over)) return null;
  if (!isCombatCloneGear(fighter)) return null;
  if ((fighter.combatCloneCd || 0) > 0) return null;
  if (ownCloneCount(game, fighter) >= COMBAT_CLONE_MAX_ACTIVE) return null;
  const clone = createCombatClone(fighter, FighterCtor);
  if (!clone) return null;
  game.fighters.push(clone);
  fighter.combatCloneCd = cloneSpawnCooldown(fighter);
  fighter.combatCloneFlash = 0.18;
  refreshCombatCloneCaches(game);
  return clone;
}

export function trySplitSwitch(fighter, game) {
  if (!fighter || fighter.dead || !isSplitGear(fighter) || !game
    || game.paused || game.over || (fighter.splitSwitchCd || 0) > 0) return null;
  const bodies = listCombatClones(game).filter((c) => c.cloneOwner === fighter && !c.dead);
  if (!bodies.length) return null;
  const index = (fighter.splitNextBody || 0) % bodies.length;
  const body = bodies[index];
  const abandonedHp = Math.min(SPLIT_TWIN_HP, fighter.hp);
  // Keep the player object (profile, kit, cooldowns, scoring) and exchange bodies.
  for (const key of BODY_FIELDS) {
    const value = fighter[key];
    fighter[key] = body[key];
    body[key] = value;
  }
  body.hp = abandonedHp;
  body.coreHp = abandonedHp;
  fighter.coreHp = (fighter.coreHp ?? fighter.hp) + Math.max(0, SPLIT_TWIN_HP - fighter.hp);
  syncNanotechDisplayedHp(fighter);
  fighter.splitSwitchCd = SPLIT_SWITCH_COOLDOWN;
  fighter.splitNextBody = (index + 1) % bodies.length;
  fighter.hitFlash = 0.18;
  body.hitFlash = 0.18;
  fighter.aiState.target = null;
  fighter.aiState.lastKnown = null;
  fighter.aiState.timer = 0;
  body.aiState.target = null;
  body.aiState.lastKnown = null;
  body.aiState.timer = 0;
  return body;
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
  if (fighter.splitSwitchCd > 0) {
    fighter.splitSwitchCd = Math.max(0, fighter.splitSwitchCd - step);
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
    if (f.shadowLink && f.dead) f.shadowLink.members.delete(f);
    if (isCombatClone(f) && f.dead) {
      drop = true;
    }
  }
  if (drop) {
    game.fighters = game.fighters.filter((f) => !isCombatClone(f) || !f.dead);
  }
  refreshCombatCloneCaches(game);
}
