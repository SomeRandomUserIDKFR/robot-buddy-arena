/**
 * Trapper — extension secondary (key 3).
 * Cycle trap type with T; plant with 3. Traps arm before they can trigger.
 * Bear: small cue, 25 dmg + 5s mobility lock.
 * Fake platform: looks almost real but off — no collision, 10 dmg on phase-through.
 * Spring pad: launches victim away from the trapper's position.
 * Signal tripwire: thin nearly-invisible line — snare + team reveal ping.
 * Land mine: larger cue than bear; splash slightly weaker than a red barrel.
 * Owner immune. Any illusion is destroyed instantly on contact / blast.
 */
import { SIZE, WORLD } from "./config.js";
import { applyHpDamage, GEAR_BY_ID } from "./equipment.js";
import {
  fadeIllusionFighter, isIllusionFighter, registerIllusionObjectHit
} from "./illusionist.js";
import { clamp } from "./utils.js";

export const TRAPPER_ID = "trapper";

export const TRAP_TYPES = Object.freeze([
  "bear",
  "fakePlatform",
  "springPad",
  "signalTripwire",
  "landMine"
]);

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

export const SPRING_PAD_DAMAGE = 8;
export const SPRING_PAD_LAUNCH = 900;
export const SPRING_PAD_W = 72;
export const SPRING_PAD_H = 16;

export const SIGNAL_TRIPWIRE_DAMAGE = 0;
export const SIGNAL_TRIPWIRE_SNARE = 1.5;
export const SIGNAL_TRIPWIRE_REVEAL = 4.5;
export const SIGNAL_TRIPWIRE_W = 150;
export const SIGNAL_TRIPWIRE_H = 5;

/** Slightly under red barrel (48 dmg / 150 r). */
export const LAND_MINE_BLAST_DAMAGE = 36;
export const LAND_MINE_BLAST_RADIUS = 120;
export const LAND_MINE_BLAST_FALLOFF = 0.5;
/** Slightly larger cue than bear (28×10). */
export const LAND_MINE_W = 40;
export const LAND_MINE_H = 14;

const TRAP_LABELS = Object.freeze({
  bear: "BEAR",
  fakePlatform: "FAKE PLAT",
  springPad: "SPRING",
  signalTripwire: "SIGNAL WIRE",
  landMine: "LAND MINE"
});

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
  return TRAP_LABELS[normalizeTrapType(type)] || "BEAR";
}

/** Cycle through trap types. Returns the new type. */
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

function baseTrap(fighter, type, w, h, extra = {}) {
  const { x, y } = placePoint(fighter, w, h);
  return {
    trapperTrap: true,
    trapType: type,
    x,
    y,
    w,
    h,
    team: fighter.team,
    owner: fighter,
    armT: TRAPPER_ARM_TIME,
    armed: false,
    triggered: false,
    destroyed: false,
    life: TRAPPER_TRAP_LIFE,
    hitFlash: 0,
    ...extra
  };
}

function createBearTrap(fighter) {
  return baseTrap(fighter, "bear", BEAR_TRAP_W, BEAR_TRAP_H);
}

function createFakePlatform(fighter) {
  return baseTrap(fighter, "fakePlatform", FAKE_PLATFORM_W, FAKE_PLATFORM_H, {
    victims: new Set()
  });
}

function createSpringPad(fighter) {
  return baseTrap(fighter, "springPad", SPRING_PAD_W, SPRING_PAD_H);
}

function createSignalTripwire(fighter) {
  return baseTrap(fighter, "signalTripwire", SIGNAL_TRIPWIRE_W, SIGNAL_TRIPWIRE_H);
}

function createLandMine(fighter) {
  return baseTrap(fighter, "landMine", LAND_MINE_W, LAND_MINE_H);
}

const TRAP_CREATORS = Object.freeze({
  bear: createBearTrap,
  fakePlatform: createFakePlatform,
  springPad: createSpringPad,
  signalTripwire: createSignalTripwire,
  landMine: createLandMine
});

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
  const create = TRAP_CREATORS[type] || createBearTrap;
  const trap = create(fighter);

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

function overlapsIllusionObject(ill, trap, pad = 2) {
  if (!ill || !trap) return false;
  return ill.x + (ill.w || 0) > trap.x - pad
    && ill.x < trap.x + trap.w + pad
    && ill.y + (ill.h || 0) > trap.y - pad
    && ill.y < trap.y + trap.h + pad;
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

function spendTrap(trap, game, { debris = true } = {}) {
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
    if (debris) {
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
  }
}

function spendBearTrap(trap, game) {
  spendTrap(trap, game, { debris: true });
}

function applyBearTrap(trap, victim, game) {
  if (!victim || victim.dead) return false;
  if (victim === trap.owner) return false;
  if (isIllusionFighter(victim)) {
    // Decoys pop instantly — no chip / lock.
    fadeIllusionFighter(victim, game);
  } else {
    applyHpDamage(victim, BEAR_TRAP_DAMAGE, game);
    victim.trapLockT = BEAR_TRAP_LOCK;
    victim.trapLockKind = "bear";
    victim.hitFlash = Math.max(victim.hitFlash || 0, 0.2);
  }
  spendBearTrap(trap, game);
  return true;
}

function applyFakePlatform(trap, victim, game) {
  if (!victim || victim.dead) return false;
  if (victim === trap.owner) return false;
  trap.victims ||= new Set();
  if (trap.victims.has(victim)) return false;
  trap.victims.add(victim);
  if (isIllusionFighter(victim)) {
    fadeIllusionFighter(victim, game);
  } else {
    applyHpDamage(victim, FAKE_PLATFORM_DAMAGE, game);
    victim.hitFlash = Math.max(victim.hitFlash || 0, 0.14);
  }
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

/** Launch direction: away from the trapper's current position. */
function springLaunchAwayFromTrapper(trap, victim) {
  const owner = trap.owner;
  const ox = owner
    ? owner.x + SIZE / 2
    : trap.x + trap.w / 2;
  const oy = owner
    ? owner.y + SIZE / 2
    : trap.y + trap.h / 2;
  let dx = (victim.x + SIZE / 2) - ox;
  let dy = (victim.y + SIZE / 2) - oy;
  let len = Math.hypot(dx, dy);
  if (!(len > 1e-3)) {
    // Standing on the trapper — kick along aim, else to the right.
    const aim = Number.isFinite(owner?.aim) ? owner.aim : 0;
    dx = Math.cos(aim) || 1;
    dy = Math.sin(aim) * 0.35 - 0.65;
    len = Math.hypot(dx, dy) || 1;
  }
  const nx = dx / len;
  const ny = dy / len;
  // Bias upward a bit so grounded victims leave the floor.
  const up = Math.min(0, ny) - 0.35;
  const scale = SPRING_PAD_LAUNCH / Math.hypot(nx, up) || SPRING_PAD_LAUNCH;
  victim.vx = nx * scale;
  victim.vy = up * scale;
  victim.grounded = false;
}

function applySpringPad(trap, victim, game) {
  if (!victim || victim.dead) return false;
  if (victim === trap.owner) return false;
  if (isIllusionFighter(victim)) {
    fadeIllusionFighter(victim, game);
  } else {
    applyHpDamage(victim, SPRING_PAD_DAMAGE, game);
    springLaunchAwayFromTrapper(trap, victim);
    victim.hitFlash = Math.max(victim.hitFlash || 0, 0.16);
  }
  spendTrap(trap, game, { debris: true });
  if (game?.effects) {
    game.effects.push({
      type: "propHit",
      x: victim.x + SIZE / 2,
      y: trap.y,
      life: 0.16
    });
  }
  return true;
}

function applySignalTripwire(trap, victim, game) {
  if (!victim || victim.dead) return false;
  if (victim === trap.owner) return false;
  if (isIllusionFighter(victim)) {
    fadeIllusionFighter(victim, game);
  } else {
    if (SIGNAL_TRIPWIRE_DAMAGE > 0) {
      applyHpDamage(victim, SIGNAL_TRIPWIRE_DAMAGE, game);
    }
    victim.trapLockT = Math.max(victim.trapLockT || 0, SIGNAL_TRIPWIRE_SNARE);
    victim.trapLockKind = "signal";
    victim.signalRevealT = Math.max(victim.signalRevealT || 0, SIGNAL_TRIPWIRE_REVEAL);
    victim.signalRevealTeam = trap.team;
    victim.hitFlash = Math.max(victim.hitFlash || 0, 0.18);
  }
  spendTrap(trap, game, { debris: false });
  const cx = victim.x + SIZE / 2;
  const cy = victim.y + SIZE / 2;
  if (game?.pings) {
    game.pings.push({ x: cx, y: cy, life: 3 });
  }
  if (game?.effects) {
    game.effects.push({
      type: "propHit",
      x: cx,
      y: cy,
      life: 0.22
    });
  }
  return true;
}

function blastFalloff(dist, radius) {
  if (!(radius > 0) || dist >= radius) return 0;
  const t = dist / radius;
  return 1 - t * (1 - LAND_MINE_BLAST_FALLOFF);
}

function applyLandMine(trap, triggerVictim, game) {
  if (trap.triggered) return false;
  const cx = trap.x + trap.w / 2;
  const cy = trap.y + trap.h / 2;
  trap.triggered = true;
  trap.destroyed = true;
  trap.life = 0;

  if (game?.effects) {
    game.effects.push({
      type: "explosion",
      x: cx,
      y: cy,
      life: 0.38,
      radius: LAND_MINE_BLAST_RADIUS,
      color: "#ff8a3a"
    });
  }

  for (const fighter of game?.fighters || []) {
    if (!fighter || fighter.dead) continue;
    if (fighter === trap.owner) continue;
    if (fighter.team === trap.team) continue;
    const fx = fighter.x + SIZE / 2;
    const fy = fighter.y + SIZE / 2;
    const d = Math.hypot(fx - cx, fy - cy);
    const mult = blastFalloff(d, LAND_MINE_BLAST_RADIUS);
    if (!(mult > 0)) continue;
    if (isIllusionFighter(fighter)) {
      fadeIllusionFighter(fighter, game);
      continue;
    }
    const damage = LAND_MINE_BLAST_DAMAGE * mult;
    applyHpDamage(fighter, damage, game);
    const angle = Math.atan2(fy - cy, fx - cx);
    fighter.vx += Math.cos(angle) * 70 * mult;
    fighter.vy += Math.sin(angle) * 45 * mult - 20 * mult;
    fighter.hitFlash = Math.max(fighter.hitFlash || 0, 0.18);
    if ((fighter.coreHp ?? fighter.hp) <= 0) {
      fighter.dead = true;
      fighter.hp = 0;
      fighter.coreHp = 0;
    }
  }

  // Prop / platform illusions in blast radius pop too.
  for (const ill of game?.illusions || []) {
    if (!ill || ill.destroyed) continue;
    if (ill.owner === trap.owner || ill.team === trap.team) continue;
    const ix = ill.x + (ill.w || 0) / 2;
    const iy = ill.y + (ill.h || 0) / 2;
    if (Math.hypot(ix - cx, iy - cy) <= LAND_MINE_BLAST_RADIUS) {
      registerIllusionObjectHit(ill, game);
    }
  }

  return true;
}

/** Prop / platform illusions die on contact with an armed enemy trap. */
function applyTrapToIllusionObject(trap, ill, game) {
  if (!ill || ill.destroyed) return false;
  if (ill.owner === trap.owner) return false;
  if (ill.team === trap.team) return false;

  if (trap.trapType === "fakePlatform") {
    if (!overlapsIllusionObject(ill, trap)) return false;
    trap.victims ||= new Set();
    if (trap.victims.has(ill)) return false;
    trap.victims.add(ill);
    registerIllusionObjectHit(ill, game);
    if (game?.effects) {
      game.effects.push({
        type: "propHit",
        x: ill.x + (ill.w || 0) / 2,
        y: trap.y,
        life: 0.14
      });
    }
    return true;
  }

  if (trap.trapType === "landMine") {
    if (trap.triggered || !overlapsIllusionObject(ill, trap)) return false;
    applyLandMine(trap, null, game);
    return true;
  }

  // Single-use contact traps.
  if (
    trap.trapType === "bear"
    || trap.trapType === "springPad"
    || trap.trapType === "signalTripwire"
  ) {
    if (trap.triggered || !overlapsIllusionObject(ill, trap)) return false;
    registerIllusionObjectHit(ill, game);
    spendTrap(trap, game, { debris: trap.trapType !== "signalTripwire" });
    return true;
  }

  return false;
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
      if (trap.destroyed || trap.triggered) break;

      if (trap.trapType === "bear") {
        if (!trap.triggered && overlapsTrap(fighter, trap)) {
          applyBearTrap(trap, fighter, game);
        }
      } else if (trap.trapType === "fakePlatform") {
        const oldY = oldYByFighter?.get?.(fighter) ?? fighter.y;
        // Decoys die on overlap; real fighters still need a fall-through.
        if (isIllusionFighter(fighter)) {
          if (overlapsTrap(fighter, trap)) applyFakePlatform(trap, fighter, game);
        } else if (feetCrossFake(fighter, oldY, trap)) {
          applyFakePlatform(trap, fighter, game);
        }
      } else if (trap.trapType === "springPad") {
        if (!trap.triggered && overlapsTrap(fighter, trap)) {
          applySpringPad(trap, fighter, game);
        }
      } else if (trap.trapType === "signalTripwire") {
        if (!trap.triggered && overlapsTrap(fighter, trap)) {
          applySignalTripwire(trap, fighter, game);
        }
      } else if (trap.trapType === "landMine") {
        if (!trap.triggered && overlapsTrap(fighter, trap)) {
          applyLandMine(trap, fighter, game);
        }
      }
    }

    // Visual prop/platform illusions — same team rules, instant pop.
    if (!trap.destroyed) {
      for (const ill of game.illusions || []) {
        if (applyTrapToIllusionObject(trap, ill, game) && trap.destroyed) break;
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
  if (fighter.signalRevealT > 0) {
    fighter.signalRevealT = Math.max(0, fighter.signalRevealT - step);
    if (fighter.signalRevealT <= 0) fighter.signalRevealTeam = null;
  }
}

/** True while a bear / signal trap is locking mobility. */
export function isTrapLocked(fighter) {
  return !!fighter && (fighter.trapLockT || 0) > 0;
}

/**
 * Team vision: marked by an allied signal tripwire.
 * Target stays visible to that team for the reveal duration.
 */
export function inSignalTripwireReveal(game, team, target) {
  if (!target || team == null) return false;
  if (!(target.signalRevealT > 0)) return false;
  return target.signalRevealTeam === team;
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
