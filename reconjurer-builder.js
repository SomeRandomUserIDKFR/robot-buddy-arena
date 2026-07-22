/**
 * Reconjurer / Builder — extension secondary (key 3).
 * Conjure random breakables near the fighter; metal power crates on a 10s user CD.
 * Costs free nanobots only (tank scraps are never spent — manual rebuild).
 * Successful builds grant +2 ejection-tank scraps.
 */
import { SIZE, WORLD } from "./config.js";
import { resolveStandTarget } from "./debris.js";
import {
  GEAR_BY_ID, MATERIAL_CONSUMER_BOTS_PER_PIECE, MATERIAL_CONSUMER_EJECTION_TANK_CAP,
  materialEjectionTank, NO_EXTENSION_ID, RECONJURER_BUILDER_ID
} from "./equipment.js";
import { createMapProp, MAP_PROP_KINDS } from "./maps.js";
import { createPowerCrate } from "./powerups.js";
import { clamp } from "./utils.js";

export { RECONJURER_BUILDER_ID };

/** Seconds between successful builds. */
export const RECONJURER_COOLDOWN = 2.8;
/** Global per-user cooldown between metal power-crate conjures. */
export const RECONJURER_METAL_COOLDOWN = 10;
/** World radius around the fighter for placement. */
export const RECONJURER_PLACE_RADIUS = 140;
/** Chance a conjure is a metal power crate when the metal CD is ready. */
export const RECONJURER_METAL_CRATE_CHANCE = 0.08;
/** Ejection-tank scraps granted after a successful manual rebuild. */
export const RECONJURER_SCRAP_REWARD = 2;
/** Free nanobots charged for a normal breakable. */
export const RECONJURER_BOT_COST = MATERIAL_CONSUMER_BOTS_PER_PIECE;
/** Free nanobots charged for a metal power crate. */
export const RECONJURER_METAL_BOT_COST = MATERIAL_CONSUMER_BOTS_PER_PIECE * 2;

/** @deprecated kept for tests / FAQ wording — tank scraps are no longer spent. */
export const RECONJURER_SCRAP_COST = 0;
/** @deprecated metal no longer spends tank scraps. */
export const RECONJURER_METAL_SCRAP_COST = 0;

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

/** Push reward scraps into the ejection tank (manual rebuild — you don't lose tank ammo). */
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

/**
 * Press 3: spend nanobots, conjure a breakable nearby, gain +2 ejection scraps.
 * Metal power crates only when the user's 10s metal countdown is ready.
 * @returns {object|null} spawned prop / power crate
 */
export function tryReconjurerBuild(fighter, game, random = Math.random) {
  if (!fighter || fighter.dead || !game) return null;
  if (!isReconjurerBuilder(fighter)) return null;
  if ((fighter.reconjurerCd || 0) > 0) return null;

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
    fighter.reconjurerMetalCd = RECONJURER_METAL_COOLDOWN;
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

  // Manual rebuild: never drain the ejection tank — award scraps instead.
  grantRebuildScraps(fighter, RECONJURER_SCRAP_REWARD);

  fighter.reconjurerCd = RECONJURER_COOLDOWN;
  fighter.reconjurerFlash = 0.22;
  if (game.effects) {
    game.effects.push({
      type: "crateBreak",
      x: spawned.x + spawned.w * 0.5,
      y: spawned.y + spawned.h * 0.5,
      life: 0.35,
      color: wantMetal ? "#d8e0ea" : "#8ec4d0"
    });
    game.effects.push({
      type: "propHit",
      x: spawned.x + spawned.w * 0.5,
      y: spawned.y + spawned.h * 0.5,
      life: 0.14
    });
  }
  return spawned;
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
