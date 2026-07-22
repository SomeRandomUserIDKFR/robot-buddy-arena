/**
 * Trapper — extension secondary (key 3).
 * Cycle trap type with T; plant with 3. Traps arm before they can trigger.
 * Bear: small cue, 25 dmg + 5s mobility lock. Fake platform: looks almost
 * real but off — no collision, 10 dmg on phase-through. Owner immune.
 */
import { SIZE, WORLD } from "./config.js";
import { applyHpDamage, GEAR_BY_ID } from "./equipment.js";
import { clamp } from "./utils.js";

export const TRAPPER_ID = "trapper";

export const TRAP_TYPES = Object.freeze(["bear", "fakePlatform"]);

/** Seconds between successful plants. */
export const TRAPPER_COOLDOWN = 3.5;
/** Delay after plant before the trap can trigger. */
export const TRAPPER_ARM_TIME = 0.65;
/** Max living traps per planter. */
export const TRAPPER_MAX_ACTIVE = 3;
/** World lifetime for an unused / lingering trap. */
export const TRAPPER_TRAP_LIFE = 40;

export const BEAR_TRAP_DAMAGE = 25;
export const BEAR_TRAP_LOCK = 5;
export const BEAR_TRAP_W = 28;
export const BEAR_TRAP_H = 10;

export const FAKE_PLATFORM_DAMAGE = 10;
export const FAKE_PLATFORM_W = 160;
export const FAKE_PLATFORM_H = 26;

export function isTrapper(fighterOrId) {
  if (typeof fighterOrId === "string") return fighterOrId === TRAPPER_ID;
  if (fighterOrId?.trapper === true) return true;
  const id = fighterOrId?.loadout?.extensionSecondary;
  return id === TRAPPER_ID || GEAR_BY_ID[id]?.trapper === true;
}

export function normalizeTrapType(type) {
  return TRAP_TYPES.includes(type) ? type : "bear";
}

export function trapTypeLabel(type) {
  return normalizeTrapType(type) === "fakePlatform" ? "FAKE PLAT" : "BEAR";
}

/** Cycle bear ↔ fake platform. Returns the new type. */
export function cycleTrapperType(fighter) {
  if (!isTrapper(fighter)) return null;
  const cur = normalizeTrapType(fighter.trapperType);
  const idx = TRAP_TYPES.indexOf(cur);
  const next = TRAP_TYPES[(idx + 1) % TRAP_TYPES.length];
  fighter.trapperType = next;
  return next;
}

export function listTrapperTraps(game) {
  return (game?.traps || []).filter((t) => t && !t.destroyed && (t.life == null || t.life > 0));
}

function ownTrapCount(game, fighter) {
  return listTrapperTraps(game).filter((t) => t.owner === fighter).length;
}

function placePoint(fighter, w, h) {
  const cx = fighter.x + SIZE / 2;
  const cy = fighter.y + SIZE / 2;
  const aim = Number.isFinite(fighter.aim) ? fighter.aim : 0;
  const reach = 90;
  const x = clamp(cx + Math.cos(aim) * reach - w / 2, 0, WORLD.w - w);
  // Rest top of trap near feet / aim height.
  const y = clamp(cy + Math.sin(aim) * reach * 0.35 - h * 0.2, 0, WORLD.h - h);
  return { x, y };
}

function createBearTrap(fighter, game) {
  const { x, y } = placePoint(fighter, BEAR_TRAP_W, BEAR_TRAP_H);
  return {
    trapperTrap: true,
    trapType: "bear",
    x,
    y,
    w: BEAR_TRAP_W,
    h: BEAR_TRAP_H,
    team: fighter.team,
    owner: fighter,
    armT: TRAPPER_ARM_TIME,
    armed: false,
    triggered: false,
    destroyed: false,
    life: TRAPPER_TRAP_LIFE,
    hitFlash: 0
  };
}

function createFakePlatform(fighter, game) {
  const { x, y } = placePoint(fighter, FAKE_PLATFORM_W, FAKE_PLATFORM_H);
  return {
    trapperTrap: true,
    trapType: "fakePlatform",
    x,
    y,
    w: FAKE_PLATFORM_W,
    h: FAKE_PLATFORM_H,
    team: fighter.team,
    owner: fighter,
    armT: TRAPPER_ARM_TIME,
    armed: false,
    triggered: false,
    destroyed: false,
    life: TRAPPER_TRAP_LIFE,
    hitFlash: 0,
    victims: new Set()
  };
}

/**
 * Press 3: plant the currently selected trap type along aim.
 * @returns {object|null}
 */
export function tryTrapperPlant(fighter, game) {
  if (!fighter || fighter.dead || !game) return null;
  if (!isTrapper(fighter)) return null;
  if ((fighter.trapperCd || 0) > 0) return null;
  if (ownTrapCount(game, fighter) >= TRAPPER_MAX_ACTIVE) return null;

  const type = normalizeTrapType(fighter.trapperType);
  const trap = type === "fakePlatform"
    ? createFakePlatform(fighter, game)
    : createBearTrap(fighter, game);

  game.traps ||= [];
  game.traps.push(trap);
  fighter.trapperCd = TRAPPER_COOLDOWN;
  fighter.trapperFlash = 0.18;

  if (game.effects) {
    game.effects.push({
      type: "propHit",
      x: trap.x + trap.w / 2,
      y: trap.y + trap.h / 2,
      life: 0.12
    });
  }
  return trap;
}

function overlapsTrap(fighter, trap, pad = 2) {
  return fighter.x + SIZE > trap.x - pad
    && fighter.x < trap.x + trap.w + pad
    && fighter.y + SIZE > trap.y - pad
    && fighter.y < trap.y + trap.h + pad;
}

function feetCrossFake(fighter, oldY, trap) {
  // Falling through the fake top edge.
  if (!(fighter.vy >= 0)) return false;
  const feet = fighter.y + SIZE;
  const oldFeet = oldY + SIZE;
  const wasAbove = oldFeet <= trap.y + 6;
  const nowThrough = feet >= trap.y && feet <= trap.y + trap.h + 28;
  const overX = fighter.x + SIZE > trap.x && fighter.x < trap.x + trap.w;
  return wasAbove && nowThrough && overX;
}

function applyBearTrap(trap, victim, game) {
  if (!victim || victim.dead) return false;
  if (victim === trap.owner) return false;
  applyHpDamage(victim, BEAR_TRAP_DAMAGE, game);
  victim.trapLockT = BEAR_TRAP_LOCK;
  victim.trapLockKind = "bear";
  victim.hitFlash = Math.max(victim.hitFlash || 0, 0.2);
  trap.triggered = true;
  trap.destroyed = true;
  trap.life = 0;
  if (game?.effects) {
    game.effects.push({
      type: "propHit",
      x: trap.x + trap.w / 2,
      y: trap.y + trap.h / 2,
      life: 0.2
    });
    game.effects.push({
      type: "debris",
      x: trap.x + trap.w / 2,
      y: trap.y + trap.h / 2,
      life: 0.28,
      kind: "barrel",
      w: trap.w,
      h: trap.h
    });
  }
  return true;
}

function applyFakePlatform(trap, victim, game) {
  if (!victim || victim.dead) return false;
  if (victim === trap.owner) return false;
  trap.victims ||= new Set();
  if (trap.victims.has(victim)) return false;
  trap.victims.add(victim);
  applyHpDamage(victim, FAKE_PLATFORM_DAMAGE, game);
  victim.hitFlash = Math.max(victim.hitFlash || 0, 0.14);
  if (game?.effects) {
    game.effects.push({
      type: "propHit",
      x: victim.x + SIZE / 2,
      y: trap.y,
      life: 0.14
    });
  }
  return true;
}

/**
 * Arm traps, run trigger checks, expire old ones.
 * Call once per frame with each fighter's previous Y for fake-platform falls.
 */
export function tickTrapperWorld(game, dt, oldYByFighter = null) {
  if (!game) return;
  game.traps ||= [];
  const keep = [];
  for (const trap of game.traps) {
    if (!trap || trap.destroyed) continue;
    trap.life = (trap.life ?? TRAPPER_TRAP_LIFE) - dt;
    if (trap.hitFlash > 0) trap.hitFlash -= dt;
    if (trap.life <= 0) continue;

    if (!trap.armed) {
      trap.armT = Math.max(0, (trap.armT || 0) - dt);
      if (trap.armT <= 0) trap.armed = true;
      // Still arming this frame — no triggers until the next tick after armed.
      if (!trap.armed) {
        keep.push(trap);
        continue;
      }
    }

    for (const fighter of game.fighters || []) {
      if (fighter.dead) continue;
      if (fighter === trap.owner) continue;
      // Friendly fire off — traps only hurt other teams.
      if (fighter.team === trap.team) continue;

      if (trap.trapType === "bear") {
        if (!trap.triggered && overlapsTrap(fighter, trap)) {
          applyBearTrap(trap, fighter, game);
        }
      } else if (trap.trapType === "fakePlatform") {
        const oldY = oldYByFighter?.get?.(fighter) ?? fighter.y;
        if (feetCrossFake(fighter, oldY, trap)) {
          applyFakePlatform(trap, fighter, game);
        }
      }
    }

    if (!trap.destroyed && trap.life > 0) keep.push(trap);
  }
  game.traps = keep;
}

export function tickTrapperFighter(fighter, dt) {
  if (!fighter) return;
  const step = dt || 0;
  if (fighter.trapperCd > 0) {
    fighter.trapperCd = Math.max(0, fighter.trapperCd - step);
  }
  if (fighter.trapperFlash > 0) {
    fighter.trapperFlash = Math.max(0, fighter.trapperFlash - step);
  }
  if (fighter.trapLockT > 0) {
    fighter.trapLockT = Math.max(0, fighter.trapLockT - step);
    if (fighter.trapLockT <= 0) fighter.trapLockKind = null;
  }
}

/** True while a bear trap is locking mobility. */
export function isTrapLocked(fighter) {
  return !!fighter && (fighter.trapLockT || 0) > 0;
}

/**
 * Strip mobility intents while trap-locked (jump / jet / dodge).
 * Walk remains at a crawl so victims aren't totally frozen statues.
 */
export function applyTrapLockToIntent(fighter, intent) {
  if (!intent || !isTrapLocked(fighter)) return intent;
  intent.jump = false;
  intent.jet = false;
  intent.jetHeld = false;
  intent.dodge = false;
  if (intent.mx) intent.mx = Math.sign(intent.mx) * 0.35;
  return intent;
}
