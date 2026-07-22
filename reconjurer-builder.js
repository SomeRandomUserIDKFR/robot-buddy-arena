/**
 * Reconjurer / Builder — extension secondary (key 3).
 * Conjure random breakables near the fighter; rare metal power crates.
 * Cost: ejection-tank scraps first, else free nanobots.
 */
import { SIZE, WORLD } from "./config.js";
import { resolveStandTarget } from "./debris.js";
import {
  GEAR_BY_ID, MATERIAL_CONSUMER_BOTS_PER_PIECE, NO_EXTENSION_ID,
  RECONJURER_BUILDER_ID, spendTankOrNanobots
} from "./equipment.js";
import { createMapProp, MAP_PROP_KINDS } from "./maps.js";
import { createPowerCrate } from "./powerups.js";
import { clamp } from "./utils.js";

export { RECONJURER_BUILDER_ID };

/** Seconds between successful builds. */
export const RECONJURER_COOLDOWN = 2.8;
/** World radius around the fighter for placement. */
export const RECONJURER_PLACE_RADIUS = 140;
/** Chance a conjure is a metal power crate instead of cover. */
export const RECONJURER_METAL_CRATE_CHANCE = 0.08;
/** Tank scraps (or scrap-equivalents in bots) per normal breakable. */
export const RECONJURER_SCRAP_COST = 1;
/** Extra scrap units for a metal power crate. */
export const RECONJURER_METAL_SCRAP_COST = 2;
/** Free nanobots charged per missing tank scrap. */
export const RECONJURER_BOT_COST = MATERIAL_CONSUMER_BOTS_PER_PIECE;

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

function affordUnits(fighter, units) {
  const tankLen = fighter.materialEjectionTank?.length || 0;
  const fromTank = Math.min(tankLen, units);
  const botsNeeded = (units - fromTank) * RECONJURER_BOT_COST;
  return (fighter.nanobotFree || 0) >= botsNeeded;
}

function payUnits(fighter, units) {
  if (!affordUnits(fighter, units)) return null;
  const paid = [];
  for (let i = 0; i < units; i++) {
    const result = spendTankOrNanobots(fighter, RECONJURER_BOT_COST);
    if (!result) return null;
    paid.push(result);
  }
  return paid;
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
 * Press 3: spend tank scraps (else nanobots) and conjure a breakable nearby.
 * @returns {object|null} spawned prop / power crate
 */
export function tryReconjurerBuild(fighter, game, random = Math.random) {
  if (!fighter || fighter.dead || !game) return null;
  if (!isReconjurerBuilder(fighter)) return null;
  if ((fighter.reconjurerCd || 0) > 0) return null;

  const wantMetal = random() < RECONJURER_METAL_CRATE_CHANCE;
  const units = wantMetal ? RECONJURER_METAL_SCRAP_COST : RECONJURER_SCRAP_COST;
  if (!affordUnits(fighter, units)) return null;

  const rough = placePoint(fighter, random);
  let spawned = null;

  if (wantMetal) {
    const w = 40;
    const h = 40;
    const stand = resolveStandTarget(game, [], rough.x, rough.y, w, h);
    const x = stand.targetX - w * 0.5;
    const yBottom = stand.targetY + h * 0.5;
    if (!payUnits(fighter, units)) return null;
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
    // Probe size from a temp prop for stand snap.
    const probe = createMapProp(kind, 0, 0);
    const stand = resolveStandTarget(game, [], rough.x, rough.y, probe.w, probe.h);
    const x = stand.targetX - probe.w * 0.5;
    const yBottom = stand.targetY + probe.h * 0.5;
    if (!payUnits(fighter, units)) return null;
    spawned = createMapProp(kind, x, yBottom);
    spawned.x = clamp(spawned.x, 0, WORLD.w - spawned.w);
    game.props ||= [];
    game.props.push(spawned);
  }

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
  if (fighter.reconjurerCd > 0) {
    fighter.reconjurerCd = Math.max(0, fighter.reconjurerCd - (dt || 0));
  }
  if (fighter.reconjurerFlash > 0) {
    fighter.reconjurerFlash = Math.max(0, fighter.reconjurerFlash - (dt || 0));
  }
}
