/**
 * Reconjurer / Builder — extension secondary (key 3).
 * Press 3 near debris to rebuild that pile into its prop / metal box.
 * Free (+2 ejection scraps). Metal power-crate rebuilds use a 10s user CD.
 */
import { SIZE } from "./config.js";
import { tryManualRebuildNear } from "./debris.js";
import {
  GEAR_BY_ID, MATERIAL_CONSUMER_EJECTION_TANK_CAP, materialEjectionTank,
  NO_EXTENSION_ID, RECONJURER_BUILDER_ID
} from "./equipment.js";
import { createPowerCrate } from "./powerups.js";

export { RECONJURER_BUILDER_ID };

/** Seconds between successful rebuilds. */
export const RECONJURER_COOLDOWN = 1.2;
/** Global per-user cooldown between metal power-crate rebuilds. */
export const RECONJURER_METAL_COOLDOWN = 10;
/** How close debris must be to rebuild with key 3. */
export const RECONJURER_REBUILD_RADIUS = 150;
/** Ejection-tank scraps granted after a successful manual rebuild. */
export const RECONJURER_SCRAP_REWARD = 2;

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

/** Push reward scraps into the ejection tank (manual rebuild — free scraps). */
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

/**
 * Press 3 near debris: rebuild that pile. Free; +2 ejection scraps.
 * Metal boxes only when the user's 10s metal countdown is ready.
 * @returns {object|null} restored prop / power crate
 */
export function tryReconjurerBuild(fighter, game) {
  if (!fighter || fighter.dead || !game) return null;
  if (!isReconjurerBuilder(fighter)) return null;
  if ((fighter.reconjurerCd || 0) > 0) return null;

  const cx = fighter.x + SIZE / 2;
  const cy = fighter.y + SIZE / 2;
  const metalReady = (fighter.reconjurerMetalCd || 0) <= 0;

  const result = tryManualRebuildNear(game, cx, cy, RECONJURER_REBUILD_RADIUS, {
    allowPowerCrate: metalReady,
    createPowerCrate
  });
  if (!result?.target) return null;

  if (result.sourceType === "powerCrate") {
    fighter.reconjurerMetalCd = RECONJURER_METAL_COOLDOWN;
  }

  grantRebuildScraps(fighter, RECONJURER_SCRAP_REWARD);
  fighter.reconjurerCd = RECONJURER_COOLDOWN;
  fighter.reconjurerFlash = 0.22;

  const target = result.target;
  if (game.effects) {
    game.effects.push({
      type: "crateBreak",
      x: target.x + target.w * 0.5,
      y: target.y + target.h * 0.5,
      life: 0.35,
      color: result.sourceType === "powerCrate" ? "#d8e0ea" : "#8ec4d0"
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
