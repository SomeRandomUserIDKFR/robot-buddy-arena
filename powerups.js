/**
 * Metal power-up crates — breakable loot boxes with timed / instant buffs.
 * Separate from map cover props (wooden crates, bushes, trees).
 */

import { SIZE, SIGHT } from "./config.js";
import { spawnPowerCrateDebris, tryReconquerAtSpawn } from "./debris.js";
import { healFighter } from "./equipment.js";
import { POWER_CRATE_MAP, POWER_CRATE_SPAWNS } from "./maps.js";
import { inBeamReveal, inDirectionalSight, hasLineOfSight } from "./vision.js";
import { clamp, dist } from "./utils.js";

export const POWER_CRATE_HP = 60;
export const POWER_CRATE_SIZE = 40;
export const POWER_CRATE_RESPAWN = 20;
export const FIRE_RATE_MULT = 1.35;
export const FIRE_RATE_DURATION = 15;
export const HEAL_AMOUNT = 50;
export const REGEN_TOTAL = 50;
export const REGEN_DURATION = 15;
export const COUNTER_SLASH_DURATION = 18;
/** Min seconds between counter triggers (melee or projectile spam). */
export const COUNTER_SLASH_COOLDOWN = 0.75;
export const SPEED_SURGE_MULT = 1.18;
export const SPEED_SURGE_DURATION = 10;
export const SHIELD_PATCH_AMOUNT = 40;
export const SHIELD_PATCH_HEAL = 25;
export const JET_SIPHON_AMOUNT = 0.45;
export const OVERCHARGE_BONUS = 1.4;
export const OVERCHARGE_HITS = 2;

export { POWER_CRATE_MAP, POWER_CRATE_SPAWNS };

/** Theme overlay + metal tint keyed by map theme / id. */
export const POWER_CRATE_THEME = Object.freeze({
  battlefield: {
    metal: "#6a7078", rim: "#2a3038", overlay: "mudScorch", accent: "#4a3a28"
  },
  city: {
    metal: "#5a6470", rim: "#1e242c", overlay: "graffiti", accent: "#c84a8a"
  },
  desert: {
    metal: "#8a7a58", rim: "#4a3c28", overlay: "sand", accent: "#c4a574"
  },
  forest: {
    metal: "#5a6a58", rim: "#243028", overlay: "leaves", accent: "#3d8a4a"
  },
  industrial: {
    metal: "#6a5a48", rim: "#2a2018", overlay: "rustOil", accent: "#8a5030"
  },
  yard: {
    metal: "#6a5a48", rim: "#2a2018", overlay: "rustOil", accent: "#8a5030"
  },
  ruins: {
    metal: "#6a6270", rim: "#2a2228", overlay: "mossRubble", accent: "#4a7a58"
  },
  docks: {
    metal: "#5a6a78", rim: "#1a2838", overlay: "wetSalt", accent: "#3a6a8a"
  }
});

export const POWERUP_DEFS = Object.freeze({
  fireRate: {
    id: "fireRate",
    label: "Fire Rate!",
    short: "RATE",
    color: "#ffb040",
    timed: true,
    duration: FIRE_RATE_DURATION,
    meleeOnly: false
  },
  heal: {
    id: "heal",
    label: "Heal +50!",
    short: "HEAL",
    color: "#5dff8a",
    timed: false,
    meleeOnly: false
  },
  regen: {
    id: "regen",
    label: "Regen!",
    short: "REGEN",
    color: "#7dffb0",
    timed: true,
    duration: REGEN_DURATION,
    meleeOnly: false
  },
  counterSlash: {
    id: "counterSlash",
    label: "Counter Slash!",
    short: "COUNTER",
    color: "#ff6ec8",
    timed: true,
    duration: COUNTER_SLASH_DURATION,
    meleeOnly: true
  },
  speedSurge: {
    id: "speedSurge",
    label: "Speed Surge!",
    short: "SPEED",
    color: "#6ec8ff",
    timed: true,
    duration: SPEED_SURGE_DURATION,
    meleeOnly: false
  },
  shieldPatch: {
    id: "shieldPatch",
    label: "Shield Patch!",
    short: "PATCH",
    color: "#9cf0ff",
    timed: false,
    meleeOnly: false
  },
  jetSiphon: {
    id: "jetSiphon",
    label: "Jet Siphon!",
    short: "JET",
    color: "#ffd64a",
    timed: false,
    meleeOnly: false
  },
  overcharge: {
    id: "overcharge",
    label: "Overcharge!",
    short: "OVR",
    color: "#ff7050",
    timed: false,
    meleeOnly: false
  }
});

const ROLL_POOL = Object.freeze([
  "fireRate", "heal", "regen", "counterSlash",
  "speedSurge", "shieldPatch", "jetSiphon", "overcharge"
]);

/** Baseline relative weight for each eligible power-up. */
export const POWERUP_BASE_WEIGHT = 1;
/**
 * Blade / saber Counter Slash weight (≈2.5× baseline among eligible rolls).
 * Daggers stay at/near baseline; guns exclude Counter Slash entirely.
 */
export const COUNTER_SLASH_BLADE_WEIGHT = 2.5;
/** Daggers: eligible but unboosted (slightly below baseline). */
export const COUNTER_SLASH_DAGGER_WEIGHT = 0.85;

function mapCfg(mapId) {
  return POWER_CRATE_MAP[mapId] || POWER_CRATE_MAP.battlefield;
}

export function themeForMap(mapId, theme) {
  return POWER_CRATE_THEME[theme]
    || POWER_CRATE_THEME[mapId]
    || POWER_CRATE_THEME.battlefield;
}

export function isMeleeFighter(fighter) {
  if (fighter?.weaponId === "mechanical-modularity") {
    return fighter.modularMode === "sword" && !fighter.modularMorphing;
  }
  return fighter?.weapon === "saber"
    || fighter?.weaponStats?.kind === "melee";
}

/** True for daggers specifically (baseKind saber, but not a blade). */
export function isDaggerFighter(fighter) {
  return fighter?.weaponId === "daggers";
}

/**
 * True for arc-saber / heavy-saber / duelist-blade / legacy saber —
 * melee with baseKind saber, excluding daggers.
 */
export function isBladeFighter(fighter) {
  return isMeleeFighter(fighter) && !isDaggerFighter(fighter);
}

/**
 * Relative loot weights for a breaker. Gun: counterSlash = 0.
 * Blade: counterSlash elevated; dagger: unboosted / slightly reduced.
 */
export function powerupRollWeights(fighter) {
  const melee = isMeleeFighter(fighter);
  const blade = isBladeFighter(fighter);
  const dagger = isDaggerFighter(fighter);
  const weights = {};
  for (const id of ROLL_POOL) {
    const def = POWERUP_DEFS[id];
    if (def.meleeOnly && !melee) {
      weights[id] = 0;
      continue;
    }
    if (id === "counterSlash") {
      if (blade) weights[id] = COUNTER_SLASH_BLADE_WEIGHT;
      else if (dagger) weights[id] = COUNTER_SLASH_DAGGER_WEIGHT;
      else weights[id] = 0;
    } else {
      weights[id] = POWERUP_BASE_WEIGHT;
    }
  }
  return weights;
}

/** Pseudo-target for vision checks (crate center as a SIZE box). */
function crateAsTarget(crate) {
  return {
    x: crate.x + crate.w / 2 - SIZE / 2,
    y: crate.y + crate.h / 2 - SIZE / 2
  };
}

function canSeeCrate(game, observer, crate) {
  const target = crateAsTarget(crate);
  const inRange = dist(observer, target) <= (observer.sight || SIGHT)
    || inDirectionalSight(observer, target);
  if (!inRange) return false;
  return hasLineOfSight(game, observer, target);
}

/** Same team-sight rules as enemies — unseen crates are not drawn / AI targets. */
export function crateVisibleToTeam(game, observer, crate) {
  if (!crate || crate.destroyed) return false;
  const team = observer?.team ?? 0;
  return (game.fighters || []).some(
    (fighter) => (
      !fighter.dead && fighter.team === team && canSeeCrate(game, fighter, crate)
    )
  ) || inBeamReveal(game, team, crateAsTarget(crate));
}

/** True if any living fighter on either team currently sees the spawn point. */
export function spawnPointVisibleToAnyTeam(game, spawn, size = POWER_CRATE_SIZE) {
  const probe = {
    x: spawn.x,
    y: spawn.y - size,
    w: size,
    h: size,
    destroyed: false
  };
  for (const fighter of game.fighters || []) {
    if (fighter.dead) continue;
    if (canSeeCrate(game, fighter, probe)) return true;
  }
  return false;
}

export function createPowerCrate(spawn, mapId, theme, id) {
  const look = themeForMap(mapId, theme);
  const h = POWER_CRATE_SIZE;
  const w = POWER_CRATE_SIZE;
  return {
    id: id ?? `pc-${spawn.x}-${spawn.y}`,
    kind: "powerCrate",
    powerCrate: true,
    x: spawn.x,
    y: spawn.y - h,
    w,
    h,
    hp: POWER_CRATE_HP,
    maxHp: POWER_CRATE_HP,
    solid: true,
    blocksProjectiles: true,
    blocksSight: false,
    breakable: true,
    destroyed: false,
    hitFlash: 0,
    lastDamager: null,
    spawnKey: `${spawn.x},${spawn.y}`,
    mapId,
    theme,
    look,
    respawnAt: null
  };
}

/**
 * Initial crates for a match — seed a fraction of spawn points up to the cap.
 */
export function initPowerCrates(mapId, theme, random = Math.random) {
  const cfg = mapCfg(mapId);
  const spots = POWER_CRATE_SPAWNS[mapId] || POWER_CRATE_SPAWNS.battlefield;
  const shuffled = spots.slice().sort(() => random() - 0.5);
  const seedCount = Math.min(
    cfg.maxConcurrent,
    Math.max(1, Math.round(cfg.density * Math.min(spots.length, cfg.maxConcurrent + 1)))
  );
  const crates = [];
  for (let i = 0; i < seedCount && i < shuffled.length; i++) {
    crates.push(createPowerCrate(shuffled[i], mapId, theme, `pc-seed-${i}`));
  }
  return {
    crates,
    pending: [],
    spawnIndex: 0,
    nextSpawnCheck: 4 + random() * 3
  };
}

export function alivePowerCrates(game) {
  return (game.powerCrates || []).filter((c) => !c.destroyed);
}

export function powerCrateBlockers(game) {
  return alivePowerCrates(game).filter((c) => c.blocksProjectiles);
}

/**
 * Pick a power-up id via weapon-aware weights.
 * Guns never roll melee-only counterSlash; blades weight it higher; daggers do not.
 */
export function pickPowerupType(fighter, random = Math.random) {
  const weights = powerupRollWeights(fighter);
  const entries = [];
  let total = 0;
  for (const id of ROLL_POOL) {
    const w = weights[id] || 0;
    if (w <= 0) continue;
    entries.push([id, w]);
    total += w;
  }
  if (total <= 0 || !entries.length) return "heal";
  let roll = random() * total;
  for (const [id, w] of entries) {
    roll -= w;
    if (roll < 0) return id;
  }
  return entries[entries.length - 1][0];
}

export function ensureBuffBag(fighter) {
  if (!fighter.powerBuffs) fighter.powerBuffs = {};
  return fighter.powerBuffs;
}

function pushLootPopup(game, fighter, def) {
  if (!game?.effects) return;
  game.effects.push({
    type: "lootPopup",
    x: fighter.x + SIZE / 2,
    y: fighter.y - 8,
    life: 1.1,
    label: def.label,
    color: def.color,
    owner: fighter
  });
}

/**
 * Apply a rolled power-up to the fighter who scored the killing blow.
 */
export function awardPowerup(fighter, typeId, game) {
  if (!fighter || fighter.dead) return null;
  const def = POWERUP_DEFS[typeId] || POWERUP_DEFS.heal;
  const buffs = ensureBuffBag(fighter);

  if (def.id === "heal") {
    healFighter(fighter, HEAL_AMOUNT);
  } else if (def.id === "shieldPatch") {
    if ((fighter.shieldMaxDurability || 0) > 0) {
      fighter.shieldDurability = Math.min(
        fighter.shieldMaxDurability,
        (fighter.shieldDurability || 0) + SHIELD_PATCH_AMOUNT
      );
      if (fighter.shieldDurability > 0) fighter.shieldBroken = false;
    } else {
      healFighter(fighter, SHIELD_PATCH_HEAL);
    }
  } else if (def.id === "jetSiphon") {
    fighter.fuel = Math.min(1, (fighter.fuel || 0) + JET_SIPHON_AMOUNT);
  } else if (def.id === "fireRate") {
    buffs.fireRate = { remaining: FIRE_RATE_DURATION, duration: FIRE_RATE_DURATION };
  } else if (def.id === "regen") {
    buffs.regen = {
      remaining: REGEN_DURATION,
      duration: REGEN_DURATION,
      rate: REGEN_TOTAL / REGEN_DURATION
    };
  } else if (def.id === "counterSlash") {
    if (!isMeleeFighter(fighter)) {
      return awardPowerup(fighter, pickPowerupType(fighter), game);
    }
    buffs.counterSlash = {
      remaining: COUNTER_SLASH_DURATION,
      duration: COUNTER_SLASH_DURATION,
      cooling: 0
    };
  } else if (def.id === "speedSurge") {
    buffs.speedSurge = {
      remaining: SPEED_SURGE_DURATION,
      duration: SPEED_SURGE_DURATION,
      mult: SPEED_SURGE_MULT
    };
  } else if (def.id === "overcharge") {
    buffs.overcharge = { charges: OVERCHARGE_HITS, bonus: OVERCHARGE_BONUS };
  }

  pushLootPopup(game, fighter, def);
  if (game?.effects) {
    game.effects.push({
      type: "crateBreak",
      x: fighter.x + SIZE / 2,
      y: fighter.y + SIZE / 2,
      life: .35,
      color: def.color
    });
  }
  return def.id;
}

/**
 * Damage a power crate. Killing blow awards the power-up to `attacker`.
 * @returns {boolean} whether the hit was absorbed (projectile should stop)
 */
export function damagePowerCrate(crate, amount, attacker, game, impactX, impactY) {
  if (!crate || crate.destroyed || !crate.breakable) return false;
  if (attacker) crate.lastDamager = attacker;
  crate.hp = Math.max(0, (crate.hp ?? crate.maxHp ?? 1) - amount);
  crate.hitFlash = .14;
  if (game?.effects) {
    game.effects.push({
      type: "propHit",
      x: impactX ?? crate.x + crate.w / 2,
      y: impactY ?? crate.y + crate.h / 2,
      life: .12
    });
  }
  if (crate.hp <= 0) {
    crate.destroyed = true;
    crate.solid = false;
    crate.blocksProjectiles = false;
    const killer = crate.lastDamager || attacker;
    const typeId = pickPowerupType(killer, Math.random);
    const awarded = awardPowerup(killer, typeId, game);
    crate.lastAward = awarded;
    if (game?.effects) {
      game.effects.push({
        type: "debris",
        x: crate.x + crate.w / 2,
        y: crate.y + crate.h / 2,
        life: .5,
        kind: "powerCrate",
        w: crate.w,
        h: crate.h
      });
      game.effects.push({
        type: "crateBreak",
        x: crate.x + crate.w / 2,
        y: crate.y + crate.h / 2,
        life: .4,
        color: "#d8e0ea"
      });
    }
    spawnPowerCrateDebris(game, crate);
    scheduleRespawn(game, crate);
  }
  return true;
}

function scheduleRespawn(game, crate) {
  if (!game.powerCrateState) return;
  game.powerCrateState.pending.push({
    spawnKey: crate.spawnKey,
    x: crate.x,
    yBottom: crate.y + crate.h,
    readyAt: (game.elapsed || 0) + POWER_CRATE_RESPAWN,
    mapId: crate.mapId || game.mapId,
    theme: crate.theme || game.theme
  });
}

/**
 * Fire-rate multiplier from active buff (1 if none).
 */
export function fireRateBuffMult(fighter) {
  const buff = fighter?.powerBuffs?.fireRate;
  if (!buff || !(buff.remaining > 0)) return 1;
  return FIRE_RATE_MULT;
}

export function moveSpeedBuffMult(fighter) {
  const buff = fighter?.powerBuffs?.speedSurge;
  if (!buff || !(buff.remaining > 0)) return 1;
  return buff.mult || SPEED_SURGE_MULT;
}

/**
 * Consume overcharge on an outgoing attack; returns damage multiplier.
 */
export function consumeOvercharge(fighter) {
  const buff = fighter?.powerBuffs?.overcharge;
  if (!buff || !(buff.charges > 0)) return 1;
  buff.charges -= 1;
  if (buff.charges <= 0) delete fighter.powerBuffs.overcharge;
  return buff.bonus || OVERCHARGE_BONUS;
}

/**
 * Tick regen / timed buffs. Call once per fighter per frame.
 */
export function tickFighterPowerBuffs(fighter, dt) {
  if (!fighter?.powerBuffs || fighter.dead) return;
  const buffs = fighter.powerBuffs;

  if (buffs.regen) {
    const heal = buffs.regen.rate * dt;
    healFighter(fighter, heal);
    buffs.regen.remaining -= dt;
    if (buffs.regen.remaining <= 0) delete buffs.regen;
  }
  if (buffs.fireRate) {
    buffs.fireRate.remaining -= dt;
    if (buffs.fireRate.remaining <= 0) delete buffs.fireRate;
  }
  if (buffs.speedSurge) {
    buffs.speedSurge.remaining -= dt;
    if (buffs.speedSurge.remaining <= 0) delete buffs.speedSurge;
  }
  if (buffs.counterSlash) {
    buffs.counterSlash.remaining -= dt;
    if (buffs.counterSlash.cooling > 0) {
      buffs.counterSlash.cooling -= dt;
    }
    if (buffs.counterSlash.remaining <= 0) delete buffs.counterSlash;
  }
}

/**
 * Prefer unseen spawn points; fall back to any free slot under the concurrent cap.
 */
export function pickRespawnSpot(game, random = Math.random) {
  const mapId = game.mapId || "battlefield";
  const cfg = mapCfg(mapId);
  const alive = alivePowerCrates(game).length;
  if (alive >= cfg.maxConcurrent) return null;

  const occupied = new Set(alivePowerCrates(game).map((c) => c.spawnKey));
  const spots = (POWER_CRATE_SPAWNS[mapId] || POWER_CRATE_SPAWNS.battlefield)
    .filter((s) => !occupied.has(`${s.x},${s.y}`));
  if (!spots.length) return null;

  const unseen = spots.filter((s) => !spawnPointVisibleToAnyTeam(game, s));
  const pool = unseen.length ? unseen : spots;
  return pool[Math.floor(random() * pool.length) % pool.length];
}

/**
 * Match-time spawn chance scales up; density from map theme.
 * Also processes pending respawns (prefer off-sight).
 */
export function tickPowerCrateSpawns(game, dt, random = Math.random) {
  if (!game?.powerCrateState) return;
  const state = game.powerCrateState;
  const cfg = mapCfg(game.mapId);
  const elapsed = game.elapsed || 0;

  // Hit-flash decay
  for (const crate of game.powerCrates || []) {
    if (crate.hitFlash > 0) crate.hitFlash -= dt;
  }

  // Pending respawns
  const stillPending = [];
  for (const pending of state.pending) {
    if (elapsed < pending.readyAt) {
      stillPending.push(pending);
      continue;
    }
    if (alivePowerCrates(game).length >= cfg.maxConcurrent) {
      stillPending.push({ ...pending, readyAt: elapsed + 2 });
      continue;
    }
    const spot = pickRespawnSpot(game, random)
      || { x: pending.x, y: pending.yBottom };
    if (!spot) {
      stillPending.push({ ...pending, readyAt: elapsed + 3 });
      continue;
    }
    // Prefer off-sight: if chosen spot is visible, try one more pick.
    let final = spot;
    if (spawnPointVisibleToAnyTeam(game, spot)) {
      const retry = pickRespawnSpot(game, random);
      if (retry && !spawnPointVisibleToAnyTeam(game, retry)) final = retry;
    }
    const crate = createPowerCrate(
      { x: final.x, y: final.y ?? final.yBottom ?? pending.yBottom },
      game.mapId,
      game.theme,
      `pc-r-${Math.floor(elapsed * 10)}-${state.spawnIndex++}`
    );
    game.powerCrates.push(crate);
    // Reconquer debris may rebuild here when a new object spawns.
    tryReconquerAtSpawn(game, crate, { preferPowerCrate: true });
    tryReconquerAtSpawn(game, crate, { preferPowerCrate: false });
  }
  state.pending = stillPending;

  // Extra mid-match spawns (abundance vs time)
  state.nextSpawnCheck -= dt;
  if (state.nextSpawnCheck > 0) return;
  state.nextSpawnCheck = 6 + random() * 4;

  if (alivePowerCrates(game).length >= cfg.maxConcurrent) return;

  const timeFactor = clamp(0.35 + elapsed / 180, 0.35, 1.15);
  const chance = cfg.density * 0.28 * timeFactor;
  if (random() > chance) return;

  const spot = pickRespawnSpot(game, random);
  if (!spot) return;
  if (spawnPointVisibleToAnyTeam(game, spot) && random() > 0.35) {
    // Soft prefer unseen — skip this tick often when only visible spots remain.
    const unseenTry = pickRespawnSpot(game, random);
    if (!unseenTry || spawnPointVisibleToAnyTeam(game, unseenTry)) return;
  }
  const spawned = createPowerCrate(
    spot,
    game.mapId,
    game.theme,
    `pc-s-${state.spawnIndex++}`
  );
  game.powerCrates.push(spawned);
  tryReconquerAtSpawn(game, spawned, { preferPowerCrate: true });
  tryReconquerAtSpawn(game, spawned, { preferPowerCrate: false });
}

/**
 * Counter-slash: while shield raised + buff active, dash at damage source and slash once.
 * Triggers on melee and projectile/laser hits alike (dash toward owner / source).
 * Returns true if a counter was performed.
 *
 * @param {{ requireShield?: boolean }} [opts] Pass `requireShield: false` when the
 *   caller already snapshotted eligibility (e.g. before a shield-break clears raised).
 */
export function tryCounterSlash(target, source, game, opts = {}) {
  const buff = target?.powerBuffs?.counterSlash;
  if (!buff || !(buff.remaining > 0)) return false;
  if (buff.cooling > 0) return false;
  if (opts.requireShield !== false) {
    if (!target.shieldRaised || target.shieldBroken) return false;
  }
  if (!isMeleeFighter(target) || target.dead || !source || source === target) return false;
  if (source.dead) return false;

  const angle = Math.atan2(
    (source.y + SIZE / 2) - (target.y + SIZE / 2),
    (source.x + SIZE / 2) - (target.x + SIZE / 2)
  );
  const dash = 280;
  target.vx = Math.cos(angle) * dash;
  target.vy = Math.sin(angle) * dash * 0.45 - 40;
  target.aim = angle;
  target.facing = Math.sign(Math.cos(angle)) || target.facing;
  buff.cooling = COUNTER_SLASH_COOLDOWN;

  const reach = target.weaponReach || 120;
  if (dist(target, source) < reach + 80) {
    // Import cycle avoidance: combat.hit is injected via game._hit or dynamic.
    const hitFn = game._powerupHit;
    if (typeof hitFn === "function") {
      const dmg = (target.weaponBaseDamage || 40) * 0.85;
      hitFn(source, target, dmg, angle, game, { fromCounterSlash: true });
    }
  }
  if (game?.effects) {
    game.effects.push({
      type: "saber",
      x: target.x + SIZE / 2,
      y: target.y + SIZE / 2,
      life: .16,
      angle,
      owner: target
    });
    game.effects.push({
      type: "dash",
      x: target.x,
      y: target.y,
      life: .22,
      color: POWERUP_DEFS.counterSlash.color
    });
  }
  return true;
}

/** Active timed buffs for HUD / world clocks. */
export function listTimedBuffs(fighter) {
  const buffs = fighter?.powerBuffs || {};
  const out = [];
  for (const key of ["fireRate", "regen", "speedSurge", "counterSlash"]) {
    const b = buffs[key];
    if (!b || !(b.remaining > 0)) continue;
    const def = POWERUP_DEFS[key];
    out.push({
      id: key,
      label: def.short,
      color: def.color,
      remaining: b.remaining,
      duration: b.duration || def.duration || 1
    });
  }
  if (buffs.overcharge?.charges > 0) {
    out.push({
      id: "overcharge",
      label: `OVR×${buffs.overcharge.charges}`,
      color: POWERUP_DEFS.overcharge.color,
      remaining: buffs.overcharge.charges,
      duration: OVERCHARGE_HITS,
      charges: true
    });
  }
  return out;
}
