/**
 * Spellbook — primary weapon. E cycles Ice / Fire / Lightning. Attacks spend mana.
 * Ice: forward impale spike (unblockable) — 2s pin, then melt + 5s slow.
 * Fire: short-range AoE that ignites breakables and spreads slowly.
 * Lightning: chains across allowed breakables; metal hits hit harder.
 */
import { SIZE } from "./config.js";
import { PROP_DEBRIS_COLORS } from "./debris.js";
import { applyHpDamage, GEAR_BY_ID } from "./equipment.js";
import { fadeIllusionFighter, isIllusionFighter } from "./illusionist.js";
import { noteOilIgnition } from "./explosive-barrel.js";
import { damageProp } from "./maps.js";
import { damagePowerCrate } from "./powerups.js";
import { clamp } from "./utils.js";

export const SPELLBOOK_ID = "spellbook";
export const SPELL_TYPES = Object.freeze(["ice", "fire", "lightning"]);

export const SPELLBOOK_MANA_MAX = 100;
export const SPELLBOOK_MANA_REGEN = 14;

export const ICE_MANA_COST = 28;
export const FIRE_MANA_COST = 32;
export const LIGHTNING_MANA_COST = 36;

export const ICE_DAMAGE = 22;
export const ICE_PIN = 2;
export const ICE_SLOW = 5;
export const ICE_SLOW_MULT = 0.45;
export const ICE_REACH = 170;
export const ICE_HALF_WIDTH = 28;

export const FIRE_DAMAGE = 16;
export const FIRE_RADIUS = 110;
export const FIRE_BURN_LIFE = 5.5;
export const FIRE_SPREAD_RANGE = 95;
export const FIRE_SPREAD_INTERVAL = 0.85;
export const FIRE_TICK_DAMAGE = 7;

export const LIGHTNING_DAMAGE = 18;
export const LIGHTNING_METAL_MULT = 1.85;
export const LIGHTNING_CHAIN_RANGE = 150;
export const LIGHTNING_MAX_HOPS = 5;
export const LIGHTNING_REACH = 520;

/** Breakable kinds lightning may chain through. */
export const LIGHTNING_CHAIN_KINDS = Object.freeze([
  "crate", "crateStack", "barrel", "redBarrel", "oilBarrel", "pipe", "pillar",
  "rock", "pallet", "lightPost", "powerCrate"
]);

const SPELL_LABELS = Object.freeze({
  ice: "ICE",
  fire: "FIRE",
  lightning: "LIGHTNING"
});

const SPELL_COSTS = Object.freeze({
  ice: ICE_MANA_COST,
  fire: FIRE_MANA_COST,
  lightning: LIGHTNING_MANA_COST
});

export function isSpellbook(fighterOrId) {
  if (typeof fighterOrId === "string") return fighterOrId === SPELLBOOK_ID;
  if (fighterOrId?.spellbook === true) return true;
  const id = fighterOrId?.weaponId || fighterOrId?.loadout?.weapon;
  return id === SPELLBOOK_ID || GEAR_BY_ID[id]?.spellbook === true;
}

export function normalizeSpellType(type) {
  return SPELL_TYPES.includes(type) ? type : "ice";
}

export function spellTypeLabel(type) {
  return SPELL_LABELS[normalizeSpellType(type)] || "ICE";
}

export function spellManaCost(type) {
  return SPELL_COSTS[normalizeSpellType(type)] || ICE_MANA_COST;
}

export function cycleSpellType(fighter) {
  if (!isSpellbook(fighter)) return null;
  const cur = normalizeSpellType(fighter.spellType);
  const idx = SPELL_TYPES.indexOf(cur);
  const next = SPELL_TYPES[(idx + 1) % SPELL_TYPES.length];
  fighter.spellType = next;
  fighter.spellFlash = 0.18;
  return next;
}

export function isMetalBreakable(prop) {
  if (!prop) return false;
  if (prop.powerCrate || prop.kind === "powerCrate") return true;
  return PROP_DEBRIS_COLORS[prop.kind]?.material === "metal";
}

export function canLightningChain(prop) {
  if (!prop || prop.destroyed) return false;
  if (prop.powerCrate || prop.kind === "powerCrate") return true;
  return LIGHTNING_CHAIN_KINDS.includes(prop.kind);
}

export function isIcePinned(fighter) {
  return !!fighter && (fighter.icePinT || 0) > 0;
}

export function iceSlowMult(fighter) {
  if (!fighter || !((fighter.iceSlowT || 0) > 0)) return 1;
  return ICE_SLOW_MULT;
}

/** Full stick while impaled — no walk / jump / jet / dodge. */
export function applyIcePinToIntent(fighter, intent) {
  if (!intent || !isIcePinned(fighter)) return intent;
  intent.jump = false;
  intent.jet = false;
  intent.jetHeld = false;
  intent.dodge = false;
  intent.mx = 0;
  return intent;
}

function spendMana(fighter, cost) {
  if ((fighter.mana || 0) < cost) return false;
  fighter.mana -= cost;
  return true;
}

function livingBreakables(game) {
  const out = [];
  for (const p of game?.props || []) {
    if (p && !p.destroyed && p.breakable && (p.hp == null || p.hp > 0)) out.push(p);
  }
  for (const c of game?.powerCrates || []) {
    if (c && !c.destroyed && !c.forgeHidden && (c.hp == null || c.hp > 0)) {
      out.push(c);
    }
  }
  return out;
}

function propCenter(p) {
  return {
    x: p.x + (p.w || 0) / 2,
    y: p.y + (p.h || 0) / 2
  };
}

function damageBreakable(prop, amount, game, ix, iy, attacker, opts = null) {
  if (!prop) return;
  if (prop.powerCrate || prop.kind === "powerCrate") {
    damagePowerCrate(prop, amount, attacker, game, ix, iy);
  } else {
    damageProp(prop, amount, game, ix, iy, opts);
  }
}

function igniteBreakable(prop, game, owner) {
  if (!prop || prop.destroyed) return;
  game.spellFires ||= [];
  if (game.spellFires.some((f) => f.prop === prop && !f.done)) return;
  game.spellFires.push({
    prop,
    owner: owner || null,
    team: owner?.team,
    life: FIRE_BURN_LIFE,
    spreadCd: FIRE_SPREAD_INTERVAL,
    tickCd: 0.45,
    done: false
  });
  prop.spellBurning = true;
  noteOilIgnition(prop, "fire");
  prop.hitFlash = Math.max(prop.hitFlash || 0, 0.16);
}

function castIce(fighter, game) {
  const aim = Number.isFinite(fighter.aim) ? fighter.aim : 0;
  // Spike stabs along aim; visual reads as a ~45° shard.
  const ox = fighter.x + SIZE / 2 + Math.cos(aim) * 28;
  const oy = fighter.y + SIZE / 2 + Math.sin(aim) * 28;
  const tipX = ox + Math.cos(aim) * ICE_REACH;
  const tipY = oy + Math.sin(aim) * ICE_REACH;

  game.effects ||= [];
  game.effects.push({
    type: "iceSpike",
    x: ox,
    y: oy,
    tipX,
    tipY,
    angle: aim,
    life: 0.28,
    owner: fighter
  });

  let hitSomeone = false;
  for (const enemy of game.fighters || []) {
    if (!enemy || enemy.dead || enemy === fighter) continue;
    if (enemy.team === fighter.team) continue;
    const ex = enemy.x + SIZE / 2;
    const ey = enemy.y + SIZE / 2;
    // Distance from segment ox,oy → tip to enemy center.
    const dx = tipX - ox;
    const dy = tipY - oy;
    const len2 = dx * dx + dy * dy || 1;
    let t = ((ex - ox) * dx + (ey - oy) * dy) / len2;
    t = clamp(t, 0, 1);
    const px = ox + dx * t;
    const py = oy + dy * t;
    if (Math.hypot(ex - px, ey - py) > ICE_HALF_WIDTH + SIZE * 0.35) continue;

    if (isIllusionFighter(enemy)) {
      fadeIllusionFighter(enemy, game);
      hitSomeone = true;
      continue;
    }
    // Unblockable — pierces raised shields.
    spellHit(enemy, fighter, ICE_DAMAGE, aim, game, { unblockable: true });
    enemy.icePinT = ICE_PIN;
    enemy.iceSlowT = 0;
    enemy.vx = 0;
    enemy.vy = 0;
    enemy.grounded = true;
    hitSomeone = true;
    game.effects.push({
      type: "icePin",
      target: enemy,
      life: ICE_PIN,
      angle: aim - Math.PI / 4
    });
  }

  // Soft chip on breakables along the spike.
  for (const prop of livingBreakables(game)) {
    const c = propCenter(prop);
    const dx = tipX - ox;
    const dy = tipY - oy;
    const len2 = dx * dx + dy * dy || 1;
    let t = ((c.x - ox) * dx + (c.y - oy) * dy) / len2;
    t = clamp(t, 0, 1);
    const px = ox + dx * t;
    const py = oy + dy * t;
    if (Math.hypot(c.x - px, c.y - py) > ICE_HALF_WIDTH + 20) continue;
    damageBreakable(prop, 12, game, c.x, c.y, fighter);
  }

  return hitSomeone;
}

function castFire(fighter, game) {
  const aim = Number.isFinite(fighter.aim) ? fighter.aim : 0;
  const cx = fighter.x + SIZE / 2 + Math.cos(aim) * 70;
  const cy = fighter.y + SIZE / 2 + Math.sin(aim) * 70;
  game.effects ||= [];
  game.effects.push({
    type: "fireBurst",
    x: cx,
    y: cy,
    radius: FIRE_RADIUS,
    life: 0.32
  });

  for (const enemy of game.fighters || []) {
    if (!enemy || enemy.dead || enemy === fighter) continue;
    if (enemy.team === fighter.team) continue;
    const ex = enemy.x + SIZE / 2;
    const ey = enemy.y + SIZE / 2;
    if (Math.hypot(ex - cx, ey - cy) > FIRE_RADIUS) continue;
    if (isIllusionFighter(enemy)) {
      fadeIllusionFighter(enemy, game);
      continue;
    }
    spellHit(enemy, fighter, FIRE_DAMAGE, Math.atan2(ey - cy, ex - cx), game, {});
  }

  for (const prop of livingBreakables(game)) {
    const c = propCenter(prop);
    if (Math.hypot(c.x - cx, c.y - cy) > FIRE_RADIUS) continue;
    damageBreakable(prop, 10, game, c.x, c.y, fighter);
    if (!prop.destroyed) igniteBreakable(prop, game, fighter);
  }
  return true;
}

function castLightning(fighter, game) {
  const aim = Number.isFinite(fighter.aim) ? fighter.aim : 0;
  const ox = fighter.x + SIZE / 2;
  const oy = fighter.y + SIZE / 2;
  const candidates = livingBreakables(game).filter(canLightningChain);
  // First hop: nearest chainable prop along aim cone / reach.
  let best = null;
  let bestScore = Infinity;
  for (const prop of candidates) {
    const c = propCenter(prop);
    const ang = Math.atan2(c.y - oy, c.x - ox);
    let dAng = Math.abs(ang - aim);
    while (dAng > Math.PI) dAng -= Math.PI * 2;
    dAng = Math.abs(dAng);
    const d = Math.hypot(c.x - ox, c.y - oy);
    if (d > LIGHTNING_REACH || dAng > 0.55) continue;
    const score = d + dAng * 80;
    if (score < bestScore) {
      bestScore = score;
      best = prop;
    }
  }

  game.effects ||= [];
  const bolts = [];
  let fromX = ox;
  let fromY = oy;
  const hitProps = new Set();
  let node = best;
  let hops = 0;
  let totalDamage = 0;

  while (node && hops < LIGHTNING_MAX_HOPS) {
    hitProps.add(node);
    const c = propCenter(node);
    bolts.push({ x1: fromX, y1: fromY, x2: c.x, y2: c.y });
    const metal = isMetalBreakable(node);
    const dmg = LIGHTNING_DAMAGE * (metal ? LIGHTNING_METAL_MULT : 1);
    damageBreakable(node, dmg, game, c.x, c.y, fighter);
    totalDamage += dmg;

    // Splash fighters near this node (stronger if metal).
    const splash = metal ? 70 : 48;
    const fighterDmg = LIGHTNING_DAMAGE * (metal ? 1.35 : 0.85);
    for (const enemy of game.fighters || []) {
      if (!enemy || enemy.dead || enemy === fighter) continue;
      if (enemy.team === fighter.team) continue;
      const ex = enemy.x + SIZE / 2;
      const ey = enemy.y + SIZE / 2;
      if (Math.hypot(ex - c.x, ey - c.y) > splash) continue;
      if (isIllusionFighter(enemy)) {
        fadeIllusionFighter(enemy, game);
        continue;
      }
      spellHit(enemy, fighter, fighterDmg, Math.atan2(ey - c.y, ex - c.x), game, {});
    }

    fromX = c.x;
    fromY = c.y;
    hops += 1;

    // Next hop: nearest unused chainable prop in range.
    let next = null;
    let nextD = Infinity;
    const range = LIGHTNING_CHAIN_RANGE * (metal ? 1.25 : 1);
    for (const prop of candidates) {
      if (hitProps.has(prop) || prop.destroyed) continue;
      const pc = propCenter(prop);
      const d = Math.hypot(pc.x - c.x, pc.y - c.y);
      if (d < nextD && d <= range) {
        nextD = d;
        next = prop;
      }
    }
    node = next;
  }

  // No prop to start on — short bolt along aim that can still tag a fighter.
  if (!bolts.length) {
    const tipX = ox + Math.cos(aim) * 220;
    const tipY = oy + Math.sin(aim) * 220;
    bolts.push({ x1: ox, y1: oy, x2: tipX, y2: tipY });
    for (const enemy of game.fighters || []) {
      if (!enemy || enemy.dead || enemy === fighter) continue;
      if (enemy.team === fighter.team) continue;
      const ex = enemy.x + SIZE / 2;
      const ey = enemy.y + SIZE / 2;
      const dx = tipX - ox;
      const dy = tipY - oy;
      const len2 = dx * dx + dy * dy || 1;
      let t = ((ex - ox) * dx + (ey - oy) * dy) / len2;
      t = clamp(t, 0, 1);
      const px = ox + dx * t;
      const py = oy + dy * t;
      if (Math.hypot(ex - px, ey - py) > 36) continue;
      if (isIllusionFighter(enemy)) {
        fadeIllusionFighter(enemy, game);
        continue;
      }
      spellHit(enemy, fighter, LIGHTNING_DAMAGE, aim, game, {});
    }
  }

  game.effects.push({
    type: "lightningBolt",
    bolts,
    life: 0.22
  });
  return totalDamage > 0 || bolts.length > 0;
}

/**
 * Cast the active spell. Returns true if mana was spent.
 */
export function castSpellbook(fighter, game) {
  if (!fighter || fighter.dead || !game) return false;
  if (!isSpellbook(fighter)) return false;
  const type = normalizeSpellType(fighter.spellType);
  const cost = spellManaCost(type);
  if (!spendMana(fighter, cost)) {
    fighter.manaFlash = 0.2;
    return false;
  }
  fighter.attackCd = (60 / Math.max(1, fighter.weaponRpm || 48));
  fighter.spellFlash = 0.14;

  if (type === "ice") castIce(fighter, game);
  else if (type === "fire") castFire(fighter, game);
  else castLightning(fighter, game);
  return true;
}

/** Regen mana + tick pin/slow on a fighter. */
export function tickSpellbookFighter(fighter, dt) {
  if (!fighter) return;
  const step = dt || 0;
  if (fighter.spellFlash > 0) {
    fighter.spellFlash = Math.max(0, fighter.spellFlash - step);
  }
  if (fighter.manaFlash > 0) {
    fighter.manaFlash = Math.max(0, fighter.manaFlash - step);
  }
  if (isSpellbook(fighter)) {
    const max = fighter.manaMax || SPELLBOOK_MANA_MAX;
    if ((fighter.mana || 0) < max) {
      fighter.mana = Math.min(max, (fighter.mana || 0) + SPELLBOOK_MANA_REGEN * step);
    }
  }
  if (fighter.icePinT > 0) {
    fighter.icePinT = Math.max(0, fighter.icePinT - step);
    fighter.vx = 0;
    fighter.vy = 0;
    if (fighter.icePinT <= 0) {
      // Melt → slow.
      fighter.iceSlowT = Math.max(fighter.iceSlowT || 0, ICE_SLOW);
    }
  }
  if (fighter.iceSlowT > 0) {
    fighter.iceSlowT = Math.max(0, fighter.iceSlowT - step);
  }
}

/** Fire spread / burn ticks on breakables. */
export function tickSpellbookWorld(game, dt) {
  if (!game) return;
  game.spellFires ||= [];
  const keep = [];
  for (const fire of game.spellFires) {
    if (!fire || fire.done) continue;
    const prop = fire.prop;
    if (!prop || prop.destroyed || !(fire.life > 0)) {
      if (prop) prop.spellBurning = false;
      continue;
    }
    fire.life -= dt;
    fire.tickCd = (fire.tickCd || 0) - dt;
    fire.spreadCd = (fire.spreadCd || 0) - dt;

    if (fire.tickCd <= 0) {
      fire.tickCd = 0.55;
      const c = propCenter(prop);
      damageBreakable(prop, FIRE_TICK_DAMAGE, game, c.x, c.y, fire.owner, {
        fromFire: true
      });
    }

    if (fire.spreadCd <= 0 && fire.life > 0.8) {
      fire.spreadCd = FIRE_SPREAD_INTERVAL;
      const c = propCenter(prop);
      let nearest = null;
      let nearestD = FIRE_SPREAD_RANGE;
      for (const other of livingBreakables(game)) {
        if (other === prop || other.destroyed || other.spellBurning) continue;
        const oc = propCenter(other);
        const d = Math.hypot(oc.x - c.x, oc.y - c.y);
        if (d < nearestD) {
          nearestD = d;
          nearest = other;
        }
      }
      if (nearest) igniteBreakable(nearest, game, fire.owner);
    }

    if (prop.destroyed || fire.life <= 0) {
      prop.spellBurning = false;
      continue;
    }
    keep.push(fire);
    if (game.effects && Math.random() < 0.25) {
      const c = propCenter(prop);
      game.effects.push({
        type: "fireBurst",
        x: c.x + (Math.random() - 0.5) * 20,
        y: c.y + (Math.random() - 0.5) * 20,
        radius: 18,
        life: 0.16
      });
    }
  }
  game.spellFires = keep;

  // Age ice pin visuals tied to targets.
  for (const effect of game.effects || []) {
    if (effect.type === "icePin" && effect.target) {
      if (effect.target.dead || !((effect.target.icePinT || 0) > 0)) {
        effect.life = 0;
      }
    }
  }
}

/** Late-bound combat.hit to avoid import cycles. */
let hitFn = null;

export function bindSpellbookHitter(fn) {
  hitFn = typeof fn === "function" ? fn : null;
}

function spellHit(target, source, damage, angle, game, extras) {
  if (typeof hitFn === "function") {
    hitFn(target, source, damage, angle, game, extras || {});
    return;
  }
  applyHpDamage(target, damage * (target.damageTaken || 1), game);
  target.hitFlash = Math.max(target.hitFlash || 0, 0.14);
}
