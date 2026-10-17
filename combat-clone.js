/**
 * Real clone Extensions (key 3): Doppel, Shadow Clone, and Split.
 * Doppel uses 25% max HP and a 30s cooldown. Shadows divide a 100-HP budget
 * and transfer damage through their owner. Split exchanges physical
 * bodies while retaining the controller's normal kit and stored health.
 */
import { SIZE, WORLD } from "./config.js";
import {
  applyLoadout, GEAR_BY_ID, NO_EXTENSION_ID, SHADOW_CLONE_ID, SPLIT_ID,
  syncNanotechDisplayedHp
} from "./equipment.js";
import { clamp } from "./utils.js";
import { dropHeldBreakable } from "./throw-breakable.js";

export const COMBAT_CLONE_ID = "doppel";
export { SHADOW_CLONE_ID, SPLIT_ID };
export const SHADOW_CLONE_HP_BUDGET = 100;
export const SHADOW_CLONE_COOLDOWN = 0;
export const SHADOW_CLONE_MAX_ACTIVE = 10;
export const SHADOW_CLONE_HP_REGEN = 20;
export const SHADOW_CLONE_SHIELD_REGEN_SECONDS = 2.5;
export const SPLIT_TWIN_HP = 250;
export const SPLIT_SWITCH_MIN_HP = 100;
export const SPLIT_SWITCH_COOLDOWN = 3;
export const SPLIT_SWITCH_KEY = "KeyH";

const BODY_STATUS_FIELDS = [
  "trapLockT", "trapLockKind", "signalRevealT", "signalRevealTeam",
  "icePinT", "iceSlowT"
];

const BODY_FIELDS = [
  "x", "y", "vx", "vy", "grounded", "facing", "aim", "fuel", "jetLocked",
  "jetReleased", "thrusting", "powerBuffs", ...BODY_STATUS_FIELDS
];

export function cloneSpawnCooldown(fighter) {
  return fighter?.shadowCloneGear ? SHADOW_CLONE_COOLDOWN : COMBAT_CLONE_COOLDOWN;
}

export function cloneMaxActive(fighter) {
  return fighter?.shadowCloneGear ? SHADOW_CLONE_MAX_ACTIVE : COMBAT_CLONE_MAX_ACTIVE;
}

export function cloneGearName(fighter) {
  return fighter?.shadowCloneGear ? "Shadow Clone" : fighter?.splitGear ? "Split" : "Doppel";
}

export function isSplitGear(fighter) {
  return fighter?.splitGear === true || fighter?.loadout?.extensionSecondary === SPLIT_ID;
}

export function shadowReserves(owner) {
  if (!owner.shadowLink) {
    const shieldMax = Math.max(owner.shieldMaxDurability || 0,
      owner._dedicatedShieldSnap?.shieldMaxDurability || 0, owner.modularPlateMax || 0) / 2;
    owner.shadowLink = {
      owner, members: new Set([owner]), hpReserve: SHADOW_CLONE_HP_BUDGET,
      shieldReserve: shieldMax, shieldMax
    };
  }
  return owner.shadowLink;
}

function livingShadows(link) {
  return [...link.members].filter((member) => member !== link.owner && !member.dead && member.hp > 0);
}

function setShadowShield(shadow, max, current) {
  shadow.shieldMaxDurability = max;
  shadow.shieldDurability = Math.min(max, Math.max(0, current));
  shadow.shieldBroken = max > 0 && shadow.shieldDurability <= 0;
  if (shadow.shieldBroken) shadow.shieldRaised = false;
  if (shadow.modularWeapon) {
    shadow.modularPlateMax = max;
    shadow.modularPlateDurability = shadow.shieldDurability;
    shadow.modularPlateBroken = shadow.shieldBroken;
  }
}

function linkShadowClone(owner, clone) {
  const link = shadowReserves(owner);
  const existing = livingShadows(link);
  const currentHp = Math.min(SHADOW_CLONE_HP_BUDGET,
    link.hpReserve + existing.reduce((sum, member) => sum + member.hp, 0));
  const currentShield = Math.min(link.shieldMax,
    link.shieldReserve + existing.reduce((sum, member) => sum + member.shieldDurability, 0));
  clone.shadowLink = link;
  link.members.add(clone);
  link.hpReserve = link.shieldReserve = 0;
  const shadows = [...existing, clone];
  for (const shadow of shadows) {
    shadow.coreMaxHp = SHADOW_CLONE_HP_BUDGET / shadows.length;
    shadow.coreHp = currentHp / shadows.length;
    syncNanotechDisplayedHp(shadow);
    setShadowShield(shadow, link.shieldMax / shadows.length, currentShield / shadows.length);
  }
}

function refreshShadowCapacity(owner) {
  const shadows = livingShadows(owner.shadowLink);
  for (const shadow of shadows) {
    shadow.coreMaxHp = SHADOW_CLONE_HP_BUDGET / shadows.length;
    syncNanotechDisplayedHp(shadow);
    setShadowShield(shadow, owner.shadowLink.shieldMax / shadows.length, shadow.shieldDurability);
  }
}

function rechargeReserve(current, max, deployed, rate, dt) {
  // Capacity not held by living clones recharges first, at full speed.
  const fastRoom = Math.max(0, max - deployed - current);
  const fastGain = Math.min(fastRoom, rate * dt);
  const slowTime = dt - fastGain / rate;
  return Math.min(max, current + fastGain + slowTime * rate * .5);
}

function tickShadowReserves(owner, dt) {
  const link = shadowReserves(owner);
  const shadows = livingShadows(link);
  const deployedHp = shadows.reduce((sum, shadow) => sum + shadow.hp, 0);
  const deployedShield = shadows.reduce((sum, shadow) => sum + shadow.shieldDurability, 0);
  link.hpReserve = rechargeReserve(link.hpReserve, SHADOW_CLONE_HP_BUDGET,
    deployedHp, SHADOW_CLONE_HP_REGEN, dt);
  if (link.shieldMax > 0) {
    link.shieldReserve = rechargeReserve(link.shieldReserve, link.shieldMax,
      deployedShield, link.shieldMax / SHADOW_CLONE_SHIELD_REGEN_SECONDS, dt);
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
    if (c.cloneOwner === fighter && !c.dead) n++;
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
  if (owner.shadowCloneGear) {
    const link = shadowReserves(owner);
    if (!(link.hpReserve + livingShadows(link).reduce((sum, shadow) => sum + shadow.hp, 0) > 0)) return null;
  }
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
  const maxHp = clone.cloneVariant === SPLIT_ID ? SPLIT_TWIN_HP : fixedHp ? SHADOW_CLONE_HP_BUDGET
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
  if (ownCloneCount(game, fighter) >= cloneMaxActive(fighter)) return null;
  const clone = createCombatClone(fighter, FighterCtor);
  if (!clone) return null;
  game.fighters.push(clone);
  fighter.combatCloneCd = cloneSpawnCooldown(fighter);
  fighter.combatCloneFlash = 0.18;
  refreshCombatCloneCaches(game);
  return clone;
}

export function tryDismissShadowClone(fighter, game) {
  if (!fighter || fighter.dead || !fighter.shadowCloneGear || !game
    || game.paused || game.over) return null;
  const shadows = listCombatClones(game).filter((clone) => clone.cloneOwner === fighter
    && clone.cloneVariant === SHADOW_CLONE_ID && !clone.dead);
  const newest = shadows[shadows.length - 1];
  if (!newest) return null;
  const link = newest.shadowLink;
  link.hpReserve = Math.min(SHADOW_CLONE_HP_BUDGET, link.hpReserve + newest.hp);
  link.shieldReserve = Math.min(link.shieldMax, link.shieldReserve + newest.shieldDurability);
  dropHeldBreakable(newest, game);
  newest.dead = true;
  newest.hp = newest.coreHp = 0;
  newest.vx = newest.vy = 0;
  newest.shadowLink.members.delete(newest);
  game.fighters = game.fighters.filter((actor) => actor !== newest);
  refreshShadowCapacity(fighter);
  refreshCombatCloneCaches(game);
  return newest;
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
  fighter.coreHp = (fighter.coreHp ?? fighter.hp) + Math.max(0, SPLIT_SWITCH_MIN_HP - fighter.hp);
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

export function tickCombatCloneWorld(game, dt = 0) {
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
  for (const f of game.fighters) {
    if (f.shadowLink?.owner === f && !f.dead) refreshShadowCapacity(f);
    if (f.shadowCloneGear && !f.dead && !game.paused && !game.over && dt > 0) {
      tickShadowReserves(f, dt);
    }
  }
  if (drop) {
    game.fighters = game.fighters.filter((f) => !isCombatClone(f) || !f.dead);
  }
  refreshCombatCloneCaches(game);
}
