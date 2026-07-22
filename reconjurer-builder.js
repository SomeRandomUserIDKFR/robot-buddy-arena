/**
 * Reconjurer / Builder — extension secondary (key 3).
 * Near debris: rebuild that pile for free (+2 ejection scraps).
 * Otherwise: conjure a random breakable for nanobots (metal box 8% / 10s CD).
 */
import { SIZE, WORLD } from "./config.js";
import { resolveStandTarget, tryManualRebuildNear } from "./debris.js";
import {
  GEAR_BY_ID, MATERIAL_CONSUMER_BOTS_PER_PIECE, MATERIAL_CONSUMER_EJECTION_TANK_CAP,
  materialEjectionTank, NO_EXTENSION_ID, RECONJURER_BUILDER_ID
} from "./equipment.js";
import { createMapProp, MAP_PROP_KINDS } from "./maps.js";
import { createPowerCrate } from "./powerups.js";
import { clamp } from "./utils.js";

export { RECONJURER_BUILDER_ID };

/** Seconds between successful rebuilds / conjures. */
export const RECONJURER_COOLDOWN = 1.2;
/** Global per-user cooldown between metal power-crate rebuilds/conjures. */
export const RECONJURER_METAL_COOLDOWN = 10;
/** How close debris must be to rebuild with key 3. */
export const RECONJURER_REBUILD_RADIUS = 150;
/** World radius for random conjure placement when no debris is near. */
export const RECONJURER_PLACE_RADIUS = 140;
/** Chance a no-debris conjure is a metal power crate when metal CD is ready. */
export const RECONJURER_METAL_CRATE_CHANCE = 0.08;
/** Ejection-tank scraps granted after a successful rebuild or conjure. */
export const RECONJURER_SCRAP_REWARD = 2;
/** Free nanobots charged for a normal random conjure. */
export const RECONJURER_BOT_COST = MATERIAL_CONSUMER_BOTS_PER_PIECE;
/** Free nanobots charged for a metal power-crate conjure. */
export const RECONJURER_METAL_BOT_COST = MATERIAL_CONSUMER_BOTS_PER_PIECE * 2;

const THEME_KINDS = Object.freeze({
  desert: ["cactus", "bush", "crate", "barrel"],
  forest: ["tree", "bush", "crate", "barrel"],
  industrial: ["crate", "pipe", "barrel", "pillar"],
  yard: ["crate", "pipe", "barrel", "crateStack"],
  ruins: ["pillar", "crate", "barrel", "bush"],
  docks: ["crate", "barrel", "pipe"],
  city: ["crate", "barrel", "pipe", "pillar"],
  battlefield: ["crate", "barrel", "pipe", "bush"]
});

export function isReconjurerBuilder(fighterOrId) {
  if (typeof fighterOrId === "string") return fighterOrId === RECONJURER_BUILDER_ID;
  if (fighterOrId?.reconjurerBuilder === true) return true;
  const id = fighterOrId?.loadout?.extensionSecondary;
  return id === RECONJURER_BUILDER_ID
    || GEAR_BY_ID[id]?.reconjurerBuilder === true;
}

export function hasExtensionSecondary(fighter) {
  const id = fighter?.loadout?.extensionSecondary;
  return !!id && id !== NO_EXTENSION_ID && !!GEAR_BY_ID[id];
}

function kindPool(game) {
  const theme = game?.theme || game?.mapId || "battlefield";
  const pool = THEME_KINDS[theme] || THEME_KINDS.battlefield;
  return pool.filter((kind) => MAP_PROP_KINDS.includes(kind));
}

function pickKind(game, random) {
  const pool = kindPool(game);
  if (!pool.length) return "crate";
  return pool[Math.floor(random() * pool.length) % pool.length];
}

function affordBots(fighter, cost) {
  return (fighter.nanobotFree || 0) >= Math.max(0, cost | 0);
}

function spendBots(fighter, cost) {
  const need = Math.max(0, cost | 0);
  if (!affordBots(fighter, need)) return false;
  if (need > 0) fighter.nanobotFree -= need;
  return true;
}

function grantRebuildScraps(fighter, count = RECONJURER_SCRAP_REWARD) {
  const tank = materialEjectionTank(fighter);
  let gained = 0;
  for (let i = 0; i < count; i++) {
    if (tank.length >= MATERIAL_CONSUMER_EJECTION_TANK_CAP) break;
    tank.push({
      bots: 0,
      ejection: true,
      reconjurerReward: true,
      color: "#8ec4d0",
      w: 8,
      h: 8
    });
    gained += 1;
  }
  return gained;
}

function placePoint(fighter, random) {
  const cx = fighter.x + SIZE / 2;
  const cy = fighter.y + SIZE / 2;
  const aim = Number.isFinite(fighter.aim) ? fighter.aim : 0;
  const dist = 48 + random() * RECONJURER_PLACE_RADIUS;
  const spread = (random() - 0.5) * 1.1;
  return {
    x: cx + Math.cos(aim + spread) * dist,
    y: cy + Math.sin(aim + spread) * dist * 0.55
  };
}

function finishBuild(fighter, game, target, isMetal) {
  grantRebuildScraps(fighter, RECONJURER_SCRAP_REWARD);
  fighter.reconjurerCd = RECONJURER_COOLDOWN;
  fighter.reconjurerFlash = 0.22;
  if (isMetal) fighter.reconjurerMetalCd = RECONJURER_METAL_COOLDOWN;
  if (game.effects) {
    game.effects.push({
      type: "crateBreak",
      x: target.x + target.w * 0.5,
      y: target.y + target.h * 0.5,
      life: 0.35,
      color: isMetal ? "#d8e0ea" : "#8ec4d0"
    });
    game.effects.push({
      type: "propHit",
      x: target.x + target.w * 0.5,
      y: target.y + target.h * 0.5,
      life: 0.14
    });
  }
  return target;
}

/**
 * No debris nearby: spend nanobots and conjure a random breakable (old chances).
 * @returns {object|null}
 */
function conjureRandomBreakable(fighter, game, random) {
  const metalReady = (fighter.reconjurerMetalCd || 0) <= 0;
  const wantMetal = metalReady && random() < RECONJURER_METAL_CRATE_CHANCE;
  const botCost = wantMetal ? RECONJURER_METAL_BOT_COST : RECONJURER_BOT_COST;
  if (!affordBots(fighter, botCost)) return null;

  const rough = placePoint(fighter, random);
  let spawned = null;

  if (wantMetal) {
    const w = 40;
    const h = 40;
    const stand = resolveStandTarget(game, [], rough.x, rough.y, w, h);
    const x = stand.targetX - w * 0.5;
    const yBottom = stand.targetY + h * 0.5;
    if (!spendBots(fighter, botCost)) return null;
    spawned = createPowerCrate(
      { x, y: yBottom },
      game.mapId || "battlefield",
      game.theme || "battlefield",
      `rj-pc-${Math.floor((game.elapsed || 0) * 1000)}-${Math.floor(random() * 1e6)}`
    );
    game.powerCrates ||= [];
    game.powerCrates.push(spawned);
  } else {
    const kind = pickKind(game, random);
    const probe = createMapProp(kind, 0, 0);
    const stand = resolveStandTarget(game, [], rough.x, rough.y, probe.w, probe.h);
    const x = stand.targetX - probe.w * 0.5;
    const yBottom = stand.targetY + probe.h * 0.5;
    if (!spendBots(fighter, botCost)) return null;
    spawned = createMapProp(kind, x, yBottom);
    spawned.x = clamp(spawned.x, 0, WORLD.w - spawned.w);
    game.props ||= [];
    game.props.push(spawned);
  }

  return finishBuild(fighter, game, spawned, wantMetal);
}

/**
 * Press 3 near debris: free rebuild (+2 scraps).
 * Otherwise: paid random conjure (same metal chance / costs as before).
 * @returns {object|null} restored or spawned prop / power crate
 */
export function tryReconjurerBuild(fighter, game, random = Math.random) {
  if (!fighter || fighter.dead || !game) return null;
  if (!isReconjurerBuilder(fighter)) return null;
  if ((fighter.reconjurerCd || 0) > 0) return null;

  const cx = fighter.x + SIZE / 2;
  const cy = fighter.y + SIZE / 2;
  const metalReady = (fighter.reconjurerMetalCd || 0) <= 0;

  const rebuilt = tryManualRebuildNear(game, cx, cy, RECONJURER_REBUILD_RADIUS, {
    allowPowerCrate: metalReady,
    createPowerCrate
  });
  if (rebuilt?.target) {
    return finishBuild(
      fighter,
      game,
      rebuilt.target,
      rebuilt.sourceType === "powerCrate"
    );
  }

  return conjureRandomBreakable(fighter, game, random);
}

export function tickReconjurerBuilder(fighter, dt) {
  if (!fighter) return;
  const step = dt || 0;
  if (fighter.reconjurerCd > 0) {
    fighter.reconjurerCd = Math.max(0, fighter.reconjurerCd - step);
  }
  if (fighter.reconjurerMetalCd > 0) {
    fighter.reconjurerMetalCd = Math.max(0, fighter.reconjurerMetalCd - step);
  }
  if (fighter.reconjurerFlash > 0) {
    fighter.reconjurerFlash = Math.max(0, fighter.reconjurerFlash - step);
  }
}
