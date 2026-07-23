/**
 * Optional tool secondaries: Throwing Spear, Frag Grenade, Sticky Charge,
 * Bolas Snare, Hookshot Winch.
 *
 * Equipped: infinite uses with a per-tool cooldown (5–10s).
 * World / crate pickups: walk over to hold a one-shot, click to fire.
 */
import { SIZE, WORLD } from "./config.js";

/** Late-bound damagers (avoids import cycles with equipment / maps / powerups). */
let applyHpDamageFn = null;
let damagePropFn = null;
let damagePowerCrateFn = null;

export function bindToolHpDamager(fn) {
  applyHpDamageFn = typeof fn === "function" ? fn : null;
}
export function bindToolPropDamager(fn) {
  damagePropFn = typeof fn === "function" ? fn : null;
}
export function bindToolPowerCrateDamager(fn) {
  damagePowerCrateFn = typeof fn === "function" ? fn : null;
}

function hurt(fighter, amount, game) {
  if (!fighter || !(amount > 0)) return;
  if (applyHpDamageFn) applyHpDamageFn(fighter, amount, game);
  else fighter.hp = Math.max(0, (fighter.hp || 0) - amount);
}

function crackProp(prop, amount, game, ix, iy, opts) {
  if (damagePropFn) damagePropFn(prop, amount, game, ix, iy, opts);
}

function crackCrate(crate, amount, owner, game, ix, iy) {
  if (damagePowerCrateFn) damagePowerCrateFn(crate, amount, owner, game, ix, iy);
}

export const THROWING_SPEAR_ID = "throwing-spear";
export const FRAG_GRENADE_ID = "frag-grenade";
export const STICKY_CHARGE_ID = "sticky-charge";
export const BOLAS_SNARE_ID = "bolas-snare";
export const HOOKSHOT_WINCH_ID = "hookshot-winch";

export const TOOL_SECONDARY_IDS = Object.freeze([
  THROWING_SPEAR_ID,
  FRAG_GRENADE_ID,
  STICKY_CHARGE_ID,
  BOLAS_SNARE_ID,
  HOOKSHOT_WINCH_ID
]);

/** @type {Record<string, {
 *   id: string, name: string, label: string, cd: number,
 *   damage: number, color: string, blurb: string
 * }>} */
export const TOOL_DEFS = Object.freeze({
  [THROWING_SPEAR_ID]: {
    id: THROWING_SPEAR_ID,
    name: "Throwing Spear",
    label: "SPEAR",
    cd: 5,
    damage: 58,
    color: "#c8d0d8",
    blurb: "Fast skill-shot spear. Infinite while equipped (5s CD). Also found in crates / on maps as a one-shot pickup."
  },
  [FRAG_GRENADE_ID]: {
    id: FRAG_GRENADE_ID,
    name: "Frag Grenade",
    label: "FRAG",
    cd: 10,
    damage: 44,
    color: "#6a8a48",
    blurb: "Lobbed frag with a short fuse. Infinite while equipped (10s CD). Also found in crates / on maps as a one-shot pickup."
  },
  [STICKY_CHARGE_ID]: {
    id: STICKY_CHARGE_ID,
    name: "Sticky Charge",
    label: "STICKY",
    cd: 8,
    damage: 40,
    color: "#c45a2a",
    blurb: "Throws a charge that sticks to cover or bots, then pops. Infinite while equipped (8s CD). Also found in crates / on maps as a one-shot pickup."
  },
  [BOLAS_SNARE_ID]: {
    id: BOLAS_SNARE_ID,
    name: "Bolas Snare",
    label: "BOLAS",
    cd: 6,
    damage: 18,
    color: "#8a6a40",
    blurb: "Arcing snare disc — light damage + short mobility lock. Infinite while equipped (6s CD). Also found in crates / on maps as a one-shot pickup."
  },
  [HOOKSHOT_WINCH_ID]: {
    id: HOOKSHOT_WINCH_ID,
    name: "Hookshot Winch",
    label: "HOOK",
    cd: 7,
    damage: 12,
    color: "#5a8aaa",
    blurb: "Latch to cover or yank a foe. Infinite while equipped (7s CD). Also found in crates / on maps as a one-shot pickup."
  }
});

export const TOOL_PICKUP_RADIUS = 36;
/** Chance a destroyed wood crate drops a random tool pickup. */
export const TOOL_CRATE_DROP_CHANCE = 0.2;
export const GRENADE_FUSE = 1.15;
export const GRENADE_RADIUS = 115;
export const STICKY_FUSE = 1.35;
export const STICKY_RADIUS = 95;
export const BOLAS_LOCK = 2.4;
export const HOOK_RANGE = 420;
export const HOOK_REEL_TIME = 0.28;

export function isToolSecondaryId(id) {
  return TOOL_SECONDARY_IDS.includes(id);
}

export function isToolSecondary(fighterOrId) {
  if (typeof fighterOrId === "string") return isToolSecondaryId(fighterOrId);
  if (fighterOrId?.toolSecondary) return isToolSecondaryId(fighterOrId.toolSecondary);
  return isToolSecondaryId(fighterOrId?.weaponId);
}

export function toolDef(id) {
  return TOOL_DEFS[id] || null;
}

export function normalizeToolId(id) {
  return isToolSecondaryId(id) ? id : null;
}

function aimOf(fighter) {
  return Number.isFinite(fighter?.aim) ? fighter.aim : 0;
}

function muzzle(fighter) {
  const aim = aimOf(fighter);
  return {
    x: fighter.x + SIZE / 2 + Math.cos(aim) * 28,
    y: fighter.y + SIZE / 2 + Math.sin(aim) * 28,
    aim
  };
}

function livingFighters(game) {
  return (game?.fighters || []).filter((f) => f && !f.dead);
}

function blastDamage(game, owner, cx, cy, radius, baseDamage) {
  for (const foe of livingFighters(game)) {
    if (foe === owner) continue;
    const fx = foe.x + SIZE / 2;
    const fy = foe.y + SIZE / 2;
    const d = Math.hypot(fx - cx, fy - cy);
    if (d >= radius) continue;
    const mult = 1 - (d / radius) * 0.55;
    hurt(foe, baseDamage * mult, game);
    foe.hitFlash = Math.max(foe.hitFlash || 0, 0.18);
    const ang = Math.atan2(fy - cy, fx - cx);
    foe.vx = (foe.vx || 0) + Math.cos(ang) * 220 * mult;
    foe.vy = (foe.vy || 0) + Math.sin(ang) * 160 * mult;
  }
  for (const prop of game?.props || []) {
    if (!prop || prop.destroyed || !prop.breakable) continue;
    const px = prop.x + prop.w / 2;
    const py = prop.y + prop.h / 2;
    const d = Math.hypot(px - cx, py - cy);
    if (d >= radius) continue;
    crackProp(prop, baseDamage * (1 - d / radius * 0.5), game, px, py, {
      fromExplosion: true
    });
  }
  for (const crate of game?.powerCrates || []) {
    if (!crate || crate.destroyed) continue;
    const px = crate.x + crate.w / 2;
    const py = crate.y + crate.h / 2;
    const d = Math.hypot(px - cx, py - cy);
    if (d >= radius) continue;
    crackCrate(crate, baseDamage * (1 - d / radius * 0.5), owner, game, px, py);
  }
  if (game?.effects) {
    game.effects.push({
      type: "explosion",
      x: cx,
      y: cy,
      life: 0.38,
      radius,
      color: "#ff8a3a"
    });
  }
}

function pushProj(game, proj) {
  game.toolProjectiles ||= [];
  game.toolProjectiles.push(proj);
  return proj;
}

function fireSpear(fighter, game, fromPickup) {
  const { x, y, aim } = muzzle(fighter);
  const def = TOOL_DEFS[THROWING_SPEAR_ID];
  return pushProj(game, {
    kind: "spear",
    owner: fighter,
    team: fighter.team,
    x,
    y,
    vx: Math.cos(aim) * 980,
    vy: Math.sin(aim) * 980,
    life: 0.85,
    damage: def.damage,
    fromPickup: !!fromPickup,
    angle: aim
  });
}

function fireGrenade(fighter, game, fromPickup) {
  const { x, y, aim } = muzzle(fighter);
  const speed = 520;
  return pushProj(game, {
    kind: "grenade",
    owner: fighter,
    team: fighter.team,
    x,
    y,
    vx: Math.cos(aim) * speed,
    vy: Math.sin(aim) * speed - 120,
    fuse: GRENADE_FUSE,
    damage: TOOL_DEFS[FRAG_GRENADE_ID].damage,
    fromPickup: !!fromPickup
  });
}

function fireSticky(fighter, game, fromPickup) {
  const { x, y, aim } = muzzle(fighter);
  const speed = 480;
  return pushProj(game, {
    kind: "sticky",
    owner: fighter,
    team: fighter.team,
    x,
    y,
    vx: Math.cos(aim) * speed,
    vy: Math.sin(aim) * speed - 80,
    fuse: STICKY_FUSE,
    stuck: false,
    damage: TOOL_DEFS[STICKY_CHARGE_ID].damage,
    fromPickup: !!fromPickup
  });
}

function fireBolas(fighter, game, fromPickup) {
  const { x, y, aim } = muzzle(fighter);
  const speed = 620;
  return pushProj(game, {
    kind: "bolas",
    owner: fighter,
    team: fighter.team,
    x,
    y,
    vx: Math.cos(aim) * speed,
    vy: Math.sin(aim) * speed - 40,
    life: 1.1,
    damage: TOOL_DEFS[BOLAS_SNARE_ID].damage,
    fromPickup: !!fromPickup,
    spin: 0
  });
}

function rayHit(game, owner, ox, oy, aim, range) {
  const steps = Math.ceil(range / 12);
  let bestFoe = null;
  let bestFoeD = range;
  let bestPoint = null;
  let bestPointD = range;
  for (let i = 1; i <= steps; i++) {
    const d = (i / steps) * range;
    const x = ox + Math.cos(aim) * d;
    const y = oy + Math.sin(aim) * d;
    if (x < 0 || y < 0 || x > WORLD.w || y > WORLD.h) {
      return { kind: "world", x, y, d };
    }
    for (const foe of livingFighters(game)) {
      if (foe === owner || foe.team === owner.team) continue;
      if (
        x >= foe.x && x <= foe.x + SIZE
        && y >= foe.y && y <= foe.y + SIZE
      ) {
        if (d < bestFoeD) {
          bestFoeD = d;
          bestFoe = foe;
        }
      }
    }
    for (const prop of game?.props || []) {
      if (!prop || prop.destroyed || !prop.solid) continue;
      if (x >= prop.x && x <= prop.x + prop.w && y >= prop.y && y <= prop.y + prop.h) {
        if (d < bestPointD) {
          bestPointD = d;
          bestPoint = { kind: "prop", x, y, d, prop };
        }
      }
    }
    for (const plat of game?.platforms || []) {
      if (!plat) continue;
      if (x >= plat.x && x <= plat.x + plat.w && y >= plat.y && y <= plat.y + plat.h) {
        if (d < bestPointD) {
          bestPointD = d;
          bestPoint = { kind: "plat", x, y, d };
        }
      }
    }
  }
  if (bestFoe && bestFoeD <= bestPointD) {
    return {
      kind: "fighter",
      foe: bestFoe,
      x: bestFoe.x + SIZE / 2,
      y: bestFoe.y + SIZE / 2,
      d: bestFoeD
    };
  }
  return bestPoint;
}

function fireHook(fighter, game, fromPickup) {
  const { x, y, aim } = muzzle(fighter);
  const hit = rayHit(game, fighter, x, y, aim, HOOK_RANGE);
  game.effects ||= [];
  const tx = hit?.x ?? x + Math.cos(aim) * HOOK_RANGE;
  const ty = hit?.y ?? y + Math.sin(aim) * HOOK_RANGE;
  game.effects.push({
    type: "hookLine",
    x1: x,
    y1: y,
    x2: tx,
    y2: ty,
    life: 0.22,
    color: TOOL_DEFS[HOOKSHOT_WINCH_ID].color
  });
  if (!hit) return null;
  if (hit.kind === "fighter" && hit.foe) {
    hurt(hit.foe, TOOL_DEFS[HOOKSHOT_WINCH_ID].damage, game);
    hit.foe.hitFlash = Math.max(hit.foe.hitFlash || 0, 0.16);
    const pull = 340;
    const ang = Math.atan2(
      fighter.y + SIZE / 2 - (hit.foe.y + SIZE / 2),
      fighter.x + SIZE / 2 - (hit.foe.x + SIZE / 2)
    );
    hit.foe.vx = (hit.foe.vx || 0) + Math.cos(ang) * pull;
    hit.foe.vy = (hit.foe.vy || 0) + Math.sin(ang) * pull * 0.7;
  } else {
    fighter.hookReel = {
      x: hit.x,
      y: hit.y,
      t: HOOK_REEL_TIME,
      fromPickup: !!fromPickup
    };
  }
  return hit;
}

const FIRE_BY_ID = {
  [THROWING_SPEAR_ID]: fireSpear,
  [FRAG_GRENADE_ID]: fireGrenade,
  [STICKY_CHARGE_ID]: fireSticky,
  [BOLAS_SNARE_ID]: fireBolas,
  [HOOKSHOT_WINCH_ID]: fireHook
};

/**
 * Click-to-fire for tool secondaries / held pickups.
 * @returns {boolean} whether a tool was fired
 */
export function attackToolSecondary(fighter, game) {
  if (!fighter || fighter.dead || !game) return false;

  // One-shot world pickup in hand takes priority.
  const held = normalizeToolId(fighter.heldToolPickup);
  if (held) {
    const fire = FIRE_BY_ID[held];
    if (!fire) return false;
    fire(fighter, game, true);
    fighter.heldToolPickup = null;
    fighter.attackCd = Math.max(fighter.attackCd || 0, 0.18);
    fighter.toolFlash = 0.2;
    return true;
  }

  const id = normalizeToolId(fighter.toolSecondary);
  if (!id) return false;
  if ((fighter.toolCd || 0) > 0) return false;
  const fire = FIRE_BY_ID[id];
  if (!fire) return false;
  fire(fighter, game, false);
  const def = TOOL_DEFS[id];
  fighter.toolCd = def.cd;
  fighter.attackCd = Math.max(fighter.attackCd || 0, 0.18);
  fighter.toolFlash = 0.2;
  return true;
}

export function tickToolSecondary(fighter, dt) {
  if (!fighter) return;
  const step = dt || 0;
  if ((fighter.toolCd || 0) > 0) {
    fighter.toolCd = Math.max(0, fighter.toolCd - step);
  }
  if ((fighter.toolFlash || 0) > 0) {
    fighter.toolFlash = Math.max(0, fighter.toolFlash - step);
  }
  if (fighter.hookReel) {
    fighter.hookReel.t -= step;
    const reel = fighter.hookReel;
    const cx = fighter.x + SIZE / 2;
    const cy = fighter.y + SIZE / 2;
    const ang = Math.atan2(reel.y - cy, reel.x - cx);
    fighter.vx = Math.cos(ang) * 780;
    fighter.vy = Math.sin(ang) * 780;
    if (reel.t <= 0 || Math.hypot(reel.x - cx, reel.y - cy) < 28) {
      fighter.hookReel = null;
      fighter.vx *= 0.35;
      fighter.vy *= 0.35;
    }
  }
}

function circleHitsFighter(x, y, r, foe) {
  const fx = foe.x + SIZE / 2;
  const fy = foe.y + SIZE / 2;
  return Math.hypot(fx - x, fy - y) <= r + SIZE * 0.35;
}

function bounceOrStick(proj, game, stick) {
  for (const prop of game.props || []) {
    if (!prop || prop.destroyed || !prop.solid) continue;
    if (
      proj.x >= prop.x && proj.x <= prop.x + prop.w
      && proj.y >= prop.y && proj.y <= prop.y + prop.h
    ) {
      if (stick) {
        proj.stuck = true;
        proj.vx = 0;
        proj.vy = 0;
        proj.stickProp = prop;
        proj.stickOx = proj.x - prop.x;
        proj.stickOy = proj.y - prop.y;
      } else {
        // Soft bounce for grenades.
        if (proj.vy > 0) proj.vy *= -0.45;
        else proj.vy *= -0.3;
        proj.vx *= 0.7;
        proj.x += proj.vx * 0.02;
        proj.y += proj.vy * 0.02;
      }
      return true;
    }
  }
  for (const plat of game.platforms || []) {
    if (!plat) continue;
    if (
      proj.x >= plat.x && proj.x <= plat.x + plat.w
      && proj.y >= plat.y && proj.y <= plat.y + plat.h
    ) {
      if (stick) {
        proj.stuck = true;
        proj.vx = 0;
        proj.vy = 0;
      } else {
        if (proj.vy > 0) proj.vy *= -0.4;
        proj.vx *= 0.72;
        proj.y = plat.y - 2;
      }
      return true;
    }
  }
  return false;
}

export function tickToolProjectiles(game, dt) {
  if (!game) return;
  const step = dt || 0;
  const keep = [];
  for (const proj of game.toolProjectiles || []) {
    if (!proj) continue;
    let alive = true;

    if (proj.kind === "spear") {
      proj.life -= step;
      proj.x += proj.vx * step;
      proj.y += proj.vy * step;
      if (proj.life <= 0 || proj.x < -40 || proj.x > WORLD.w + 40
        || proj.y < -40 || proj.y > WORLD.h + 40) {
        alive = false;
      } else {
        for (const foe of livingFighters(game)) {
          if (foe === proj.owner || foe.team === proj.team) continue;
          if (circleHitsFighter(proj.x, proj.y, 10, foe)) {
            hurt(foe, proj.damage, game);
            foe.hitFlash = Math.max(foe.hitFlash || 0, 0.2);
            foe.vx = (foe.vx || 0) + Math.cos(proj.angle || 0) * 200;
            alive = false;
            break;
          }
        }
        if (alive) {
          for (const prop of game.props || []) {
            if (!prop || prop.destroyed || !prop.breakable) continue;
            if (
              proj.x >= prop.x && proj.x <= prop.x + prop.w
              && proj.y >= prop.y && proj.y <= prop.y + prop.h
            ) {
              crackProp(prop, proj.damage * 0.55, game, proj.x, proj.y);
              alive = false;
              break;
            }
          }
        }
      }
    } else if (proj.kind === "grenade") {
      proj.fuse -= step;
      proj.vy += 1400 * step;
      proj.x += proj.vx * step;
      proj.y += proj.vy * step;
      bounceOrStick(proj, game, false);
      if (proj.fuse <= 0) {
        blastDamage(game, proj.owner, proj.x, proj.y, GRENADE_RADIUS, proj.damage);
        alive = false;
      }
    } else if (proj.kind === "sticky") {
      proj.fuse -= step;
      if (!proj.stuck) {
        proj.vy += 1300 * step;
        proj.x += proj.vx * step;
        proj.y += proj.vy * step;
        for (const foe of livingFighters(game)) {
          if (foe === proj.owner || foe.team === proj.team) continue;
          if (circleHitsFighter(proj.x, proj.y, 14, foe)) {
            proj.stuck = true;
            proj.stickFoe = foe;
            proj.stickOx = proj.x - foe.x;
            proj.stickOy = proj.y - foe.y;
            proj.vx = 0;
            proj.vy = 0;
            break;
          }
        }
        if (!proj.stuck) bounceOrStick(proj, game, true);
      } else if (proj.stickFoe && !proj.stickFoe.dead) {
        proj.x = proj.stickFoe.x + (proj.stickOx || SIZE / 2);
        proj.y = proj.stickFoe.y + (proj.stickOy || SIZE / 2);
      } else if (proj.stickProp && !proj.stickProp.destroyed) {
        proj.x = proj.stickProp.x + (proj.stickOx || 0);
        proj.y = proj.stickProp.y + (proj.stickOy || 0);
      }
      if (proj.fuse <= 0) {
        blastDamage(game, proj.owner, proj.x, proj.y, STICKY_RADIUS, proj.damage);
        alive = false;
      }
    } else if (proj.kind === "bolas") {
      proj.life -= step;
      proj.spin = (proj.spin || 0) + step * 14;
      proj.vy += 900 * step;
      proj.x += proj.vx * step;
      proj.y += proj.vy * step;
      if (proj.life <= 0) alive = false;
      else {
        for (const foe of livingFighters(game)) {
          if (foe === proj.owner || foe.team === proj.team) continue;
          if (circleHitsFighter(proj.x, proj.y, 16, foe)) {
            hurt(foe, proj.damage, game);
            foe.trapLockT = Math.max(foe.trapLockT || 0, BOLAS_LOCK);
            foe.trapLockKind = "bolas";
            foe.hitFlash = Math.max(foe.hitFlash || 0, 0.18);
            alive = false;
            break;
          }
        }
        if (alive) bounceOrStick(proj, game, false);
      }
    } else {
      alive = false;
    }

    if (alive) keep.push(proj);
  }
  game.toolProjectiles = keep;
}

export function createToolPickup(id, x, y) {
  const toolId = normalizeToolId(id);
  if (!toolId) return null;
  const def = TOOL_DEFS[toolId];
  return {
    id: `tool-${toolId}-${Math.floor(x)}-${Math.floor(y)}-${Math.random().toString(36).slice(2, 7)}`,
    toolId,
    x,
    y,
    w: 22,
    h: 22,
    life: 45,
    color: def.color,
    label: def.label
  };
}

export function seedMapToolPickups(game, random = Math.random) {
  if (!game) return;
  game.toolPickups ||= [];
  const platforms = (game.platforms || []).filter((p) => p && p.w >= 80 && p.h <= 40);
  if (!platforms.length) return;
  const count = 2 + Math.floor(random() * 3);
  for (let i = 0; i < count; i++) {
    const plat = platforms[Math.floor(random() * platforms.length)];
    const id = TOOL_SECONDARY_IDS[Math.floor(random() * TOOL_SECONDARY_IDS.length)];
    const x = plat.x + 20 + random() * Math.max(8, plat.w - 40);
    const y = plat.y - 26;
    const pickup = createToolPickup(id, x, y);
    if (pickup) game.toolPickups.push(pickup);
  }
}

/** Roll a tool drop when a wood crate is destroyed. */
export function maybeDropToolFromCrate(prop, game, ix, iy, random = Math.random) {
  if (!prop || !game) return null;
  if (prop.kind !== "crate") return null;
  if (random() > TOOL_CRATE_DROP_CHANCE) return null;
  const id = TOOL_SECONDARY_IDS[Math.floor(random() * TOOL_SECONDARY_IDS.length)];
  const pickup = createToolPickup(id, (ix ?? prop.x) - 8, (iy ?? prop.y) - 8);
  if (!pickup) return null;
  game.toolPickups ||= [];
  game.toolPickups.push(pickup);
  if (game.effects) {
    game.effects.push({
      type: "lootPopup",
      x: pickup.x + 10,
      y: pickup.y,
      life: 0.9,
      label: TOOL_DEFS[id].label,
      color: TOOL_DEFS[id].color
    });
  }
  return pickup;
}

/** Nearest ground tool pickup within range, or null. */
export function findToolPickupNear(fighter, game, maxRange = TOOL_PICKUP_RADIUS) {
  if (!fighter || !game || !(maxRange > 0)) return null;
  const cx = fighter.x + SIZE / 2;
  const cy = fighter.y + SIZE / 2;
  let best = null;
  let bestD = maxRange;
  for (const p of game.toolPickups || []) {
    if (!p) continue;
    const d = Math.hypot(p.x + 11 - cx, p.y + 11 - cy);
    if (d <= bestD) {
      best = p;
      bestD = d;
    }
  }
  return best;
}

/**
 * Put a ground tool into hand as a one-shot.
 * World tools are grab-only (Throw Breakable) — never walk-over collect.
 */
export function takeToolPickup(fighter, game, pickup) {
  if (!fighter || !game || !pickup) return null;
  fighter.heldToolPickup = pickup.toolId;
  fighter.toolFlash = 0.18;
  game.toolPickups = (game.toolPickups || []).filter((p) => p !== pickup);
  if (game.effects) {
    game.effects.push({
      type: "propHit",
      x: pickup.x + 11,
      y: pickup.y + 11,
      life: 0.12
    });
  }
  return pickup;
}

/**
 * @deprecated Walk-over collect removed — tools require Throw Breakable grab.
 * Kept for tests that call take via grab path.
 */
export function tryCollectToolPickup(fighter, game) {
  return null;
}

/**
 * Throw Breakable grab: pick up a ground tool into hand (one-shot hold).
 * @returns {object|null} the pickup taken
 */
export function tryGrabToolPickup(fighter, game, maxRange = TOOL_PICKUP_RADIUS) {
  if (!fighter || fighter.dead || !game) return null;
  if (fighter.heldToolPickup || fighter.heldProp) return null;
  const best = findToolPickupNear(fighter, game, maxRange);
  if (!best) return null;
  return takeToolPickup(fighter, game, best);
}

/** Lifetime / bob only — no auto pickup. */
export function tickToolPickups(game, dt) {
  if (!game) return;
  const step = dt || 0;
  game.toolPickups = (game.toolPickups || []).filter((p) => {
    if (!p) return false;
    p.life = (p.life ?? 45) - step;
    p.bob = (p.bob || 0) + step * 4;
    return p.life > 0;
  });
}

/** Tool id shown in-hand: grabbed one-shot, else equipped tool secondary. */
export function handheldToolId(fighter) {
  if (!fighter || fighter.dead) return null;
  if (fighter.heldToolPickup) return normalizeToolId(fighter.heldToolPickup);
  if (fighter.toolSecondary && isToolSecondaryId(fighter.toolSecondary)) {
    return fighter.toolSecondary;
  }
  return null;
}

export function ensureToolSecondaryState(fighter) {
  if (!fighter) return;
  fighter.toolCd = fighter.toolCd || 0;
  fighter.toolFlash = fighter.toolFlash || 0;
  fighter.heldToolPickup = normalizeToolId(fighter.heldToolPickup);
  fighter.hookReel = fighter.hookReel || null;
  if (!isToolSecondaryId(fighter.toolSecondary)) fighter.toolSecondary = null;
}

/** Resolve active tool id from equipped secondary gear. */
export function toolSecondaryFromGear(gear) {
  if (!gear) return null;
  if (gear.toolSecondary && isToolSecondaryId(gear.toolSecondary)) {
    return gear.toolSecondary;
  }
  if (isToolSecondaryId(gear.id)) return gear.id;
  return null;
}

export function toolSecondaryShopStats(id) {
  const def = TOOL_DEFS[id];
  if (!def) return {};
  return {
    damage: def.damage / 40,
    fireRate: (60 / def.cd) / 150,
    range: 1
  };
}
