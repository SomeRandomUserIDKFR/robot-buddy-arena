/**
 * Illusionist — most expensive extension (key 3).
 * T cycles type (HUD); 3 plants. Strictly deception for everyone else: no cues,
 * no collision, no LOS block. Fighter decoys are AI clones with the same loadout;
 * their attacks only gaslight (phantom HP). Real shots pass through illusions;
 * illusion shots vanish on impact.
 * Illusionists themselves have truth sight: outlined illusions, visible ghost
 * rounds, and real (non-phantom) enemy HP bars.
 */
import { SIZE, WORLD } from "./config.js";
import { applyLoadout, GEAR_BY_ID } from "./equipment.js";
import { createMapProp, MAP_PROP_KINDS } from "./maps.js";
import { POWER_CRATE_SIZE } from "./powerups.js";
import { clamp } from "./utils.js";

export const ILLUSIONIST_ID = "illusionist";

export const ILLUSION_TYPES = Object.freeze(["fighter", "prop", "platform"]);
/** Selection id for a metal power-crate illusion (bait). */
export const ILLUSION_METAL_PROP = "metal";

/** Theme pools mirror Reconjurer so bait looks native to the map. */
const ILLUSION_THEME_KINDS = Object.freeze({
  desert: ["cactus", "bush", "crate", "barrel", "rock", "sandbag"],
  forest: ["tree", "bush", "crate", "barrel", "rock", "pallet"],
  industrial: [
    "crate", "pipe", "barrel", "redBarrel", "oilBarrel", "pillar",
    "tireStack", "sandbag", "pallet", "lightPost"
  ],
  yard: [
    "crate", "pipe", "barrel", "redBarrel", "oilBarrel", "crateStack",
    "tireStack", "sandbag", "pallet", "lightPost"
  ],
  ruins: ["pillar", "crate", "barrel", "bush", "rock", "sandbag"],
  docks: [
    "crate", "barrel", "redBarrel", "oilBarrel", "pipe",
    "pallet", "tireStack", "sandbag"
  ],
  city: [
    "crate", "barrel", "redBarrel", "oilBarrel", "pipe", "pillar",
    "lightPost", "sandbag", "tireStack"
  ],
  battlefield: [
    "crate", "barrel", "pipe", "bush", "sandbag", "tireStack", "rock", "pallet"
  ]
});

/** Plant cooldown (s). */
export const ILLUSIONIST_COOLDOWN = 5;
/** Max living illusions per planter. */
export const ILLUSIONIST_MAX_ACTIVE = 2;
/** World lifetime for prop / platform illusions. */
export const ILLUSION_PROP_LIFE = 28;
/** World lifetime for fighter decoys. */
export const ILLUSION_FIGHTER_LIFE = 22;
/** Hits a fighter illusion can absorb before fading. */
export const ILLUSION_FIGHTER_HITS = 10;
/** Minimum phantom damage per illusion connect. */
export const ILLUSION_PHANTOM_DAMAGE = 40;
/** How long phantom HP gaslight lingers after the last fake hit. */
export const ILLUSION_PHANTOM_DECAY = 6;
/** Swirling smoke dissolve when an illusion is broken / expires. */
export const ILLUSION_BREAK_LIFE = 0.72;

export const ILLUSION_PLATFORM_W = 160;
export const ILLUSION_PLATFORM_H = 26;
export const ILLUSION_PROP_W = 44;
export const ILLUSION_PROP_H = 44;

/**
 * Cool swirling smoke puff when an illusion breaks — pale vapor spiral, not a flash.
 * @param {{ w?: number, h?: number }} [options]
 */
export function spawnIllusionBreakSwirl(game, x, y, options = {}) {
  if (!game) return null;
  game.effects ||= [];
  const w = Math.max(18, options.w || SIZE);
  const h = Math.max(18, options.h || SIZE);
  const effect = {
    type: "illusionBreak",
    x,
    y,
    life: ILLUSION_BREAK_LIFE,
    maxLife: ILLUSION_BREAK_LIFE,
    radius: Math.max(w, h) * 0.62,
    seed: Math.random() * Math.PI * 2,
    spin: Math.random() < 0.5 ? 1 : -1
  };
  game.effects.push(effect);
  return effect;
}

export function isIllusionist(fighterOrId) {
  if (typeof fighterOrId === "string") return fighterOrId === ILLUSIONIST_ID;
  if (fighterOrId?.illusionist === true) return true;
  const id = fighterOrId?.loadout?.extensionSecondary;
  return id === ILLUSIONIST_ID || GEAR_BY_ID[id]?.illusionist === true;
}

export function isIllusionFighter(fighter) {
  return !!fighter?.illusion;
}

/** Illusionists see through gaslight (ghost rounds, real HP, outlined fakes). */
export function hasIllusionTruthSight(viewer) {
  return isIllusionist(viewer);
}

export function normalizeIllusionType(type) {
  return ILLUSION_TYPES.includes(type) ? type : "fighter";
}

export function illusionTypeLabel(type) {
  const t = normalizeIllusionType(type);
  if (t === "prop") return "PROP";
  if (t === "platform") return "PLAT";
  return "FIGHTER";
}

export function cycleIllusionistType(fighter) {
  if (!isIllusionist(fighter)) return null;
  const cur = normalizeIllusionType(fighter.illusionistType);
  const idx = ILLUSION_TYPES.indexOf(cur);
  const next = ILLUSION_TYPES[(idx + 1) % ILLUSION_TYPES.length];
  fighter.illusionistType = next;
  return next;
}

/** Theme breakables + metal — bait looks native to the map. */
export function listIllusionPropKinds(game = null) {
  const theme = game?.theme || game?.mapId || "battlefield";
  const pool = ILLUSION_THEME_KINDS[theme] || ILLUSION_THEME_KINDS.battlefield;
  const kinds = pool.filter((kind) => MAP_PROP_KINDS.includes(kind));
  const base = kinds.length ? kinds : ["crate"];
  return [...base, ILLUSION_METAL_PROP];
}

export function normalizeIllusionPropKind(kind, game = null) {
  const choices = listIllusionPropKinds(game);
  if (choices.includes(kind)) return kind;
  return choices[0] || "crate";
}

export function illusionPropKindLabel(kind) {
  if (kind === ILLUSION_METAL_PROP) return "METAL";
  if (kind === "crateStack") return "STACK";
  return String(kind || "crate").toUpperCase();
}

/** Y cycles the prop look while Illusionist type is PROP. */
export function cycleIllusionPropKind(fighter, game = null) {
  if (!isIllusionist(fighter)) return null;
  if (normalizeIllusionType(fighter.illusionistType) !== "prop") return null;
  const choices = listIllusionPropKinds(game);
  const cur = normalizeIllusionPropKind(fighter.illusionPropKind, game);
  const idx = choices.indexOf(cur);
  const next = choices[(idx + 1) % choices.length];
  fighter.illusionPropKind = next;
  return next;
}

export function listIllusionObjects(game) {
  if (game?._livingIllusionObjects) return game._livingIllusionObjects;
  return (game?.illusions || []).filter((i) => i && !i.destroyed && (i.life == null || i.life > 0));
}

export function listIllusionFighters(game) {
  if (game?._livingIllusionFighters) return game._livingIllusionFighters;
  return (game?.fighters || []).filter((f) => isIllusionFighter(f) && !f.dead);
}

/**
 * Rebuild per-frame living-illusion arrays so AI / combat avoid re-filtering.
 * Safe to call once at the start of a sim tick (and again after world cleanup).
 */
export function refreshIllusionCaches(game) {
  if (!game) return;
  const objs = [];
  for (const i of game.illusions || []) {
    if (i && !i.destroyed && (i.life == null || i.life > 0)) objs.push(i);
  }
  const fighters = [];
  for (const f of game.fighters || []) {
    if (isIllusionFighter(f) && !f.dead) fighters.push(f);
  }
  game._livingIllusionObjects = objs;
  game._livingIllusionFighters = fighters;
}

function ownIllusionCount(game, fighter) {
  let n = 0;
  for (const i of listIllusionObjects(game)) {
    if (i.owner === fighter) n++;
  }
  for (const f of listIllusionFighters(game)) {
    if (f.illusionOwner === fighter) n++;
  }
  return n;
}

function placePoint(fighter, w, h) {
  const cx = fighter.x + SIZE / 2;
  const cy = fighter.y + SIZE / 2;
  const aim = Number.isFinite(fighter.aim) ? fighter.aim : 0;
  const reach = 100;
  return {
    x: clamp(cx + Math.cos(aim) * reach - w / 2, 0, WORLD.w - w),
    y: clamp(cy + Math.sin(aim) * reach * 0.4 - h * 0.25, 0, WORLD.h - h)
  };
}

/**
 * Displayed HP after phantom gaslight (never below 0).
 * Pass an Illusionist `viewer` to skip phantom and read real HP.
 */
export function displayedHp(fighter, viewer = null) {
  if (!fighter) return 0;
  // Decoys show their fake pool so hits look like real chip damage.
  if (isIllusionFighter(fighter)) {
    return Math.max(0, fighter.illusionFakeHp ?? fighter.hp ?? 0);
  }
  if (hasIllusionTruthSight(viewer)) {
    return Math.max(0, fighter.hp || 0);
  }
  return Math.max(0, (fighter.hp || 0) - (fighter.phantomDamage || 0));
}

/** Fake max HP used for decoy bars (falls back to real maxHp). */
export function displayedMaxHp(fighter, viewer = null) {
  if (!fighter) return 1;
  if (isIllusionFighter(fighter)) {
    return Math.max(1, fighter.illusionFakeMaxHp ?? fighter.maxHp ?? 1);
  }
  void viewer;
  return Math.max(1, fighter.maxHp || 1);
}

/** Apply visual-only damage. Returns phantom amount applied. */
export function applyPhantomDamage(target, amount, game = null, source = null) {
  if (!target || target.dead || isIllusionFighter(target)) return 0;
  const dealt = Math.max(ILLUSION_PHANTOM_DAMAGE, Math.max(0, amount || 0));
  target.phantomDamage = (target.phantomDamage || 0) + dealt;
  target.phantomDamage = Math.min(target.phantomDamage, target.hp || 0);
  target.phantomDecayT = ILLUSION_PHANTOM_DECAY;
  target.hitFlash = Math.max(target.hitFlash || 0, 0.1);
  target.hitFace = Math.max(target.hitFace || 0, 0.25);
  if (game?.effects) {
    game.effects.push({
      type: "propHit",
      x: target.x + SIZE / 2,
      y: target.y + SIZE / 2,
      life: 0.12
    });
  }
  if (source) source.totalDamage = (source.totalDamage || 0) + 0;
  return dealt;
}

export function tickPhantomDamage(fighter, dt) {
  if (!fighter || !(fighter.phantomDamage > 0)) return;
  fighter.phantomDecayT = Math.max(0, (fighter.phantomDecayT || 0) - (dt || 0));
  if (fighter.phantomDecayT <= 0) {
    // Ease gaslight away once the linger expires.
    fighter.phantomDamage = Math.max(0, fighter.phantomDamage - 80 * (dt || 0));
    if (fighter.phantomDamage < 1) {
      fighter.phantomDamage = 0;
      fighter.phantomDecayT = 0;
    }
  }
}

/**
 * Real hit against a fighter illusion — chips the fake HP pool / hit budget.
 * Caller should ghost the projectile (invisible, keep flying).
 */
export function registerIllusionFighterHit(illusion, game) {
  if (!isIllusionFighter(illusion) || illusion.dead) return false;
  const hits = Math.max(1, ILLUSION_FIGHTER_HITS);
  const maxFake = Math.max(1, illusion.illusionFakeMaxHp ?? illusion.maxHp ?? 500);
  if (illusion.illusionFakeHp == null) illusion.illusionFakeHp = maxFake;
  illusion.illusionHitsLeft = Math.max(0, (illusion.illusionHitsLeft ?? hits) - 1);
  // Drain fake pool in equal chunks so the bar sells a real fight.
  const chunk = maxFake / hits;
  illusion.illusionFakeHp = Math.max(0, illusion.illusionFakeHp - chunk);
  illusion.hitFlash = 0.12;
  // Keep `.hp` mirrored to the fake pool so any generic HP UI stays consistent.
  illusion.hp = illusion.illusionFakeHp;
  if (game?.effects) {
    game.effects.push({
      type: "hit",
      x: illusion.x + SIZE / 2,
      y: illusion.y + SIZE / 2,
      life: 0.16
    });
  }
  if (illusion.illusionHitsLeft <= 0 || illusion.illusionFakeHp <= 0) {
    fadeIllusionFighter(illusion, game);
  }
  return true;
}

export function fadeIllusionFighter(illusion, game) {
  if (!illusion || illusion.dead) return;
  illusion.dead = true;
  illusion.hp = 0;
  illusion.illusionFakeHp = 0;
  illusion.life = 0;
  spawnIllusionBreakSwirl(
    game,
    (illusion.x || 0) + SIZE / 2,
    (illusion.y || 0) + SIZE / 2,
    { w: SIZE, h: SIZE }
  );
}

/** Mark a real bullet as visually gone while it keeps traveling for collisions. */
export function ghostBulletThroughIllusion(bullet, game = null) {
  if (!bullet || bullet.ghost) return bullet;
  bullet.ghost = true;
  bullet.hidden = true;
  // One-shot impact puff so the round looks like it "died" on the decoy.
  if (game?.effects) {
    game.effects.push({
      type: "propHit",
      x: bullet.x,
      y: bullet.y,
      life: 0.1
    });
  }
  return bullet;
}

/** Hit prop/platform illusion — fades; caller must not stop the projectile. */
export function registerIllusionObjectHit(illusion, game) {
  if (!illusion || illusion.destroyed) return false;
  illusion.destroyed = true;
  illusion.life = 0;
  spawnIllusionBreakSwirl(
    game,
    illusion.x + (illusion.w || 0) / 2,
    illusion.y + (illusion.h || 0) / 2,
    { w: illusion.w || ILLUSION_PROP_W, h: illusion.h || ILLUSION_PROP_H }
  );
  return true;
}

function createPropIllusion(owner, kind = "crate", game = null) {
  const sel = normalizeIllusionPropKind(kind ?? owner?.illusionPropKind, game);
  let w = ILLUSION_PROP_W;
  let h = ILLUSION_PROP_H;
  let propKind = "crate";
  let powerCrate = false;
  if (sel === ILLUSION_METAL_PROP) {
    w = POWER_CRATE_SIZE;
    h = POWER_CRATE_SIZE;
    propKind = "powerCrate";
    powerCrate = true;
  } else {
    const probe = createMapProp(sel, 0, 0);
    w = probe.w || w;
    h = probe.h || h;
    propKind = probe.kind || sel;
  }
  const { x, y } = placePoint(owner, w, h);
  return {
    illusionObject: true,
    illusionType: "prop",
    kind: propKind,
    illusionPropKind: sel,
    powerCrate,
    x,
    y,
    w,
    h,
    owner,
    team: owner.team,
    life: ILLUSION_PROP_LIFE,
    destroyed: false,
    solid: false,
    blocksSight: false,
    blocksProjectiles: false
  };
}

function createPlatformIllusion(owner) {
  const { x, y } = placePoint(owner, ILLUSION_PLATFORM_W, ILLUSION_PLATFORM_H);
  return {
    illusionObject: true,
    illusionType: "platform",
    x,
    y,
    w: ILLUSION_PLATFORM_W,
    h: ILLUSION_PLATFORM_H,
    owner,
    team: owner.team,
    life: ILLUSION_PROP_LIFE,
    destroyed: false,
    solid: false,
    blocksSight: false,
    blocksProjectiles: false
  };
}

/**
 * Build an AI decoy cloning `owner`'s loadout.
 * `FighterCtor` is injected to avoid a combat ↔ illusionist import cycle.
 */
export function createFighterIllusion(owner, FighterCtor) {
  if (!owner?.loadout || typeof FighterCtor !== "function") return null;
  const { x, y } = placePoint(owner, SIZE, SIZE);
  const loadout = { ...owner.loadout };
  const decoy = applyLoadout(new FighterCtor({
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
  decoy.human = false;
  decoy.buddy = false;
  decoy.illusion = true;
  decoy.illusionOwner = owner;
  decoy.illusionHitsLeft = ILLUSION_FIGHTER_HITS;
  decoy.illusionLife = ILLUSION_FIGHTER_LIFE;
  decoy.phantomDamage = 0;
  decoy.aim = owner.aim;
  decoy.facing = owner.facing || 1;
  // Fake health pool mirrors the source's current displayed HP.
  const fakeMax = Math.max(40, owner.maxHp || 500);
  const fakeNow = Math.max(
    40,
    Math.min(fakeMax, (owner.hp || fakeMax) - (owner.phantomDamage || 0))
  );
  decoy.illusionFakeMaxHp = fakeMax;
  decoy.illusionFakeHp = fakeNow;
  decoy.maxHp = fakeMax;
  decoy.hp = fakeNow;
  decoy.fuel = owner.fuel;
  return decoy;
}

/**
 * Press 3: plant the selected illusion along aim.
 * @param {Function} [FighterCtor] required for fighter illusions
 * @returns {object|null}
 */
export function tryIllusionistPlant(fighter, game, FighterCtor = null) {
  if (!fighter || fighter.dead || !game) return null;
  if (!isIllusionist(fighter)) return null;
  if ((fighter.illusionistCd || 0) > 0) return null;
  if (ownIllusionCount(game, fighter) >= ILLUSIONIST_MAX_ACTIVE) return null;

  const type = normalizeIllusionType(fighter.illusionistType);
  if (type === "fighter") {
    const decoy = createFighterIllusion(fighter, FighterCtor);
    if (!decoy) return null;
    game.fighters.push(decoy);
    fighter.illusionistCd = ILLUSIONIST_COOLDOWN;
    fighter.illusionistFlash = 0.18;
    return decoy;
  }

  game.illusions ||= [];
  const obj = type === "platform"
    ? createPlatformIllusion(fighter)
    : createPropIllusion(fighter, fighter.illusionPropKind, game);
  game.illusions.push(obj);
  fighter.illusionistCd = ILLUSIONIST_COOLDOWN;
  fighter.illusionistFlash = 0.18;
  return obj;
}

export function tickIllusionistFighter(fighter, dt, game = null) {
  if (!fighter) return;
  const step = dt || 0;
  if (fighter.illusionistCd > 0) {
    fighter.illusionistCd = Math.max(0, fighter.illusionistCd - step);
  }
  if (fighter.illusionistFlash > 0) {
    fighter.illusionistFlash = Math.max(0, fighter.illusionistFlash - step);
  }
  tickPhantomDamage(fighter, step);
  if (isIllusionFighter(fighter) && !fighter.dead) {
    fighter.illusionLife = (fighter.illusionLife ?? ILLUSION_FIGHTER_LIFE) - step;
    if (fighter.illusionLife <= 0) {
      fadeIllusionFighter(fighter, game);
    }
  }
}

export function tickIllusionistWorld(game, dt) {
  if (!game) return;
  game.illusions ||= [];
  const keep = [];
  for (const ill of game.illusions) {
    if (!ill || ill.destroyed) continue;
    ill.life = (ill.life ?? ILLUSION_PROP_LIFE) - dt;
    if (ill.life > 0) {
      keep.push(ill);
    } else {
      // Timed-out prop/platform — same smoke dissolve as a hit break.
      spawnIllusionBreakSwirl(
        game,
        ill.x + (ill.w || 0) / 2,
        ill.y + (ill.h || 0) / 2,
        { w: ill.w || ILLUSION_PROP_W, h: ill.h || ILLUSION_PROP_H }
      );
    }
  }
  game.illusions = keep;
  // Drop faded decoys only when needed (avoid reallocating fighters every frame).
  if (Array.isArray(game.fighters)) {
    let drop = false;
    for (const f of game.fighters) {
      if (isIllusionFighter(f) && f.dead) {
        drop = true;
        break;
      }
    }
    if (drop) {
      game.fighters = game.fighters.filter((f) => !isIllusionFighter(f) || !f.dead);
    }
  }
  refreshIllusionCaches(game);
}

/** Axis-aligned overlap test for illusion objects vs a segment (bullet). */
export function illusionObjectHitBySegment(ill, x1, y1, x2, y2) {
  if (!ill || ill.destroyed) return false;
  // Thickened point sample along segment mid — good enough for small dt steps.
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  return mx >= ill.x && mx <= ill.x + ill.w && my >= ill.y && my <= ill.y + ill.h
    || (x2 >= ill.x && x2 <= ill.x + ill.w && y2 >= ill.y && y2 <= ill.y + ill.h);
}

/** Living fighters that count for match win/loss (excludes decoys / Doppels). */
export function isRealCombatant(fighter) {
  return !!fighter
    && !fighter.dead
    && !isIllusionFighter(fighter)
    && !fighter.combatClone;
}
