/**
 * Survival mode — endless waves of lower-tier AIs that ramp with time.
 *
 * Player + buddy (team 0) vs swarm enemies (team 1). Match ends only when
 * team 0 is wiped. Enemies keep spawning; dead swarm bots are pruned.
 *
 * Ramp (by survival seconds):
 *   0–45    recruit AI, bare kits, slow spawn, low cap
 *   45–90   recruit/rookie, light starter sidegrades
 *   90–150  rookie, more concurrent
 *   150–240 contender pressure, mid-low gear
 *   240+    contender/veteran mix, denser spawns (still no elite toys)
 */

import {
  DEFAULT_LOADOUT, NO_EXTENSION_ID, NO_SECONDARY_ID, applyLoadout, trainerLoadout
} from "./equipment.js";
import { ensureEconomyProfile, STARTING_CYBER } from "./equipment.js";
import {
  ensureProgressionProfile, grantExp, cyberWinMultiplier
} from "./perks.js";
import { POWER_CRATE_SPAWNS } from "./maps.js";
import { SIZE } from "./config.js";
import { isRealCombatant } from "./illusionist.js";

export const SURVIVAL_REWARD = Object.freeze({
  cyberPerWave: 12,
  cyberPerKill: 2,
  cyberPerTenSec: 4,
  cyberCap: 280,
  expPerWave: 8,
  expPerThirtySec: 6,
  expCap: 160
});

const ENEMY_NAMES = Object.freeze([
  "Drone", "Scrap", "Wisp", "Bolt", "Clip", "Nix", "Proxy", "Gasket",
  "Echo", "Rust", "Spark", "Mote", "Chip", "Cog", "Relay", "Unit"
]);

const ENEMY_COLORS = Object.freeze([
  "#ff5e56", "#ff9b4a", "#ff6b5a", "#e82d4a", "#ff8c3a", "#ff4d5c"
]);

/** Soft kit tiers — all intentionally below Conquest elite toys. */
export const SURVIVAL_KITS = Object.freeze({
  bare: Object.freeze([
    Object.freeze({
      body: "scout-frame", helmet: "survey-visor", weapon: "pulse-rifle",
      secondaryWeapon: NO_SECONDARY_ID, extensionSecondary: NO_EXTENSION_ID,
      jetpack: "sprinter-pack", shield: "no-shield"
    }),
    Object.freeze({
      body: "field-frame", helmet: "survey-visor", weapon: "pulse-rifle",
      secondaryWeapon: NO_SECONDARY_ID, extensionSecondary: NO_EXTENSION_ID,
      jetpack: "vector-pack", shield: "no-shield"
    })
  ]),
  light: Object.freeze([
    Object.freeze({
      body: "field-frame", helmet: "survey-visor", weapon: "pulse-rifle",
      secondaryWeapon: NO_SECONDARY_ID, extensionSecondary: NO_EXTENSION_ID,
      jetpack: "vector-pack", shield: "light-buckler"
    }),
    Object.freeze({
      body: "scout-frame", helmet: "wideband-array", weapon: "arc-saber",
      secondaryWeapon: NO_SECONDARY_ID, extensionSecondary: NO_EXTENSION_ID,
      jetpack: "sprinter-pack", shield: "no-shield"
    }),
    Object.freeze({
      ...trainerLoadout("rookie", true),
      secondaryWeapon: NO_SECONDARY_ID,
      extensionSecondary: NO_EXTENSION_ID
    })
  ]),
  mid: Object.freeze([
    Object.freeze({
      body: "field-frame", helmet: "guard-helm", weapon: "burst-carbine",
      secondaryWeapon: NO_SECONDARY_ID, extensionSecondary: NO_EXTENSION_ID,
      jetpack: "endurance-pack", shield: "light-buckler"
    }),
    Object.freeze({
      body: "scout-frame", helmet: "wideband-array", weapon: "duelist-blade",
      secondaryWeapon: "frag-grenade", extensionSecondary: NO_EXTENSION_ID,
      jetpack: "recycler-pack", shield: "no-shield"
    }),
    Object.freeze({
      body: "field-frame", helmet: "survey-visor", weapon: "marksman-rifle",
      secondaryWeapon: NO_SECONDARY_ID, extensionSecondary: NO_EXTENSION_ID,
      jetpack: "vector-pack", shield: "light-buckler"
    })
  ]),
  hard: Object.freeze([
    Object.freeze({
      body: "bulwark-frame", helmet: "guard-helm", weapon: "arc-saber",
      secondaryWeapon: "throw-breakable", extensionSecondary: NO_EXTENSION_ID,
      jetpack: "endurance-pack", shield: "kinetic-targe"
    }),
    Object.freeze({
      body: "reactive-frame", helmet: "hunter-optics", weapon: "burst-carbine",
      secondaryWeapon: "frag-grenade", extensionSecondary: NO_EXTENSION_ID,
      jetpack: "recycler-pack", shield: "light-buckler"
    }),
    Object.freeze({
      body: "field-frame", helmet: "guard-helm", weapon: "heavy-saber",
      secondaryWeapon: NO_SECONDARY_ID, extensionSecondary: "trapper",
      jetpack: "vector-pack", shield: "kinetic-targe"
    })
  ])
});

/**
 * Difficulty band from survival elapsed seconds.
 * @returns {{ id: string, aiPool: string[], kitPool: string, spawnInterval: number, maxAlive: number, burst: number, label: string }}
 */
export function survivalBand(elapsedSec) {
  const t = Math.max(0, Number(elapsedSec) || 0);
  if (t < 45) {
    return {
      id: "green",
      aiPool: ["recruit", "recruit", "rookie"],
      kitPool: "bare",
      spawnInterval: 3.8,
      maxAlive: 4,
      burst: 2,
      label: "Green swarm"
    };
  }
  if (t < 90) {
    return {
      id: "stir",
      aiPool: ["recruit", "rookie", "rookie"],
      kitPool: "light",
      spawnInterval: 3.2,
      maxAlive: 5,
      burst: 2,
      label: "Stirring"
    };
  }
  if (t < 150) {
    return {
      id: "press",
      aiPool: ["rookie", "rookie", "contender"],
      kitPool: "light",
      spawnInterval: 2.6,
      maxAlive: 7,
      burst: 3,
      label: "Pressing"
    };
  }
  if (t < 240) {
    return {
      id: "heavy",
      aiPool: ["rookie", "contender", "contender"],
      kitPool: "mid",
      spawnInterval: 2.2,
      maxAlive: 9,
      burst: 3,
      label: "Heavy push"
    };
  }
  return {
    id: "siege",
    aiPool: ["contender", "contender", "veteran"],
    kitPool: "hard",
    spawnInterval: 1.8,
    maxAlive: 11,
    burst: 4,
    label: "Siege"
  };
}

export function ensureSurvivalProfile(profile, saved = profile) {
  ensureEconomyProfile(profile, saved);
  const raw = saved?.survival && typeof saved.survival === "object" ? saved.survival : {};
  const bestTime = Number.isFinite(Number(raw.bestTime)) ? Math.max(0, Number(raw.bestTime)) : 0;
  const bestWaves = Number.isInteger(raw.bestWaves) ? Math.max(0, raw.bestWaves) : 0;
  const bestKills = Number.isInteger(raw.bestKills) ? Math.max(0, raw.bestKills) : 0;
  profile.survival = {
    bestTime,
    bestWaves,
    bestKills,
    rewardedResults: Array.from(new Set(
      Array.isArray(raw.rewardedResults) ? raw.rewardedResults : []
    )).filter((id) => typeof id === "string").slice(-100)
  };
  return profile;
}

/** Enemy spawn anchors: conquest duo side + elevated crate-ish points. */
export function listSurvivalSpawnPoints(map) {
  const conquest = map?.spawnPoints?.conquest;
  const points = [];
  if (conquest?.enemy1) points.push({ ...conquest.enemy1 });
  if (conquest?.enemy2) points.push({ ...conquest.enemy2 });
  if (conquest?.enemy1) {
    points.push({ x: conquest.enemy1.x - 220, y: conquest.enemy1.y });
    points.push({
      x: conquest.enemy2?.x || conquest.enemy1.x + 200,
      y: Math.max(180, (conquest.enemy1.y || 1300) - 280)
    });
  }
  const crateAnchors = POWER_CRATE_SPAWNS?.[map?.id] || POWER_CRATE_SPAWNS?.[map?.theme] || [];
  for (const anchor of crateAnchors) {
    if (!anchor || !Number.isFinite(anchor.x) || !Number.isFinite(anchor.y)) continue;
    // Crate y is bottom; fighter y is top of body — sit on the shelf.
    const y = Math.max(80, anchor.y - SIZE);
    // Prefer right / far side so they charge toward the player spawn.
    if (anchor.x < 900) continue;
    points.push({ x: anchor.x, y });
  }
  if (!points.length) {
    points.push({ x: 2920, y: 1300 }, { x: 3150, y: 1300 }, { x: 2700, y: 1100 });
  }
  return points;
}

export function initSurvivalState(map, random = Math.random) {
  const spawns = listSurvivalSpawnPoints(map);
  return {
    elapsed: 0,
    wave: 0,
    kills: 0,
    spawned: 0,
    nextSpawnIn: 1.2,
    spawnIndex: Math.floor(random() * Math.max(1, spawns.length)),
    spawnPoints: spawns,
    bandId: "green",
    announcement: 0
  };
}

function pick(list, random) {
  if (!list?.length) return null;
  return list[Math.floor(random() * list.length) % list.length];
}

export function rollSurvivalEnemySpec(elapsedSec, random = Math.random) {
  const band = survivalBand(elapsedSec);
  const kits = SURVIVAL_KITS[band.kitPool] || SURVIVAL_KITS.bare;
  const loadout = { ...DEFAULT_LOADOUT, ...(pick(kits, random) || kits[0]) };
  const ai = pick(band.aiPool, random) || "recruit";
  return {
    ai,
    loadout,
    name: pick(ENEMY_NAMES, random) || "Drone",
    color: pick(ENEMY_COLORS, random) || "#ff5e56",
    bandId: band.id
  };
}

export function countLivingSwarm(game) {
  if (!game?.fighters) return 0;
  return game.fighters.filter((f) => (
    f.team === 1 && isRealCombatant(f) && !f.buddy && !f.human
  )).length;
}

export function pruneDeadSwarm(game) {
  if (!game?.fighters) return 0;
  const before = game.fighters.length;
  game.fighters = game.fighters.filter((f) => {
    if (f.team !== 1 || f.buddy || f.human) return true;
    if (f.illusion || f.combatClone) return true;
    return !f.dead;
  });
  return before - game.fighters.length;
}

/**
 * Spawn one survival enemy onto the map.
 * @returns {object|null} the fighter or null if capped / no Fighter ctor
 */
export function spawnSurvivalEnemy(game, FighterCtor, random = Math.random) {
  if (!game || typeof FighterCtor !== "function") return null;
  const state = game.survival;
  if (!state) return null;
  const band = survivalBand(state.elapsed);
  if (countLivingSwarm(game) >= band.maxAlive) return null;

  const points = state.spawnPoints?.length
    ? state.spawnPoints
    : listSurvivalSpawnPoints({ id: game.mapId, spawnPoints: game.spawnPoints });
  state.spawnIndex = (state.spawnIndex + 1) % Math.max(1, points.length);
  const spot = points[state.spawnIndex] || points[0] || { x: 3000, y: 1300 };
  const jitterX = (random() - 0.5) * 60;
  const spec = rollSurvivalEnemySpec(state.elapsed, random);
  const fighter = applyLoadout(new FighterCtor({
    x: spot.x + jitterX,
    y: spot.y,
    team: 1,
    color: spec.color,
    name: `${spec.name}-${state.spawned + 1}`,
    ai: spec.ai,
    survivalSwarm: true
  }), spec.loadout);
  game.fighters.push(fighter);
  state.spawned += 1;
  return fighter;
}

/**
 * Advance survival timers, spawn bursts, prune corpses, tally kills.
 * Call once per frame from the main update loop.
 */
export function tickSurvival(game, dt, FighterCtor, random = Math.random) {
  if (!game || game.mode !== "survival" || game.over || !game.survival) return;
  const state = game.survival;
  state.elapsed += dt;
  if (state.announcement > 0) state.announcement -= dt;

  // Tally kills from freshly dead swarm bots before prune.
  for (const fighter of game.fighters) {
    if (
      fighter.team === 1
      && fighter.survivalSwarm
      && fighter.dead
      && !fighter._survivalKillCounted
    ) {
      fighter._survivalKillCounted = true;
      state.kills += 1;
    }
  }
  pruneDeadSwarm(game);

  const band = survivalBand(state.elapsed);
  if (band.id !== state.bandId) {
    state.bandId = band.id;
    state.announcement = 2.4;
    game.announcement = Math.max(game.announcement || 0, 2.4);
  }

  state.nextSpawnIn -= dt;
  if (state.nextSpawnIn > 0) return;
  state.nextSpawnIn = band.spawnInterval * (0.85 + random() * 0.3);

  const living = countLivingSwarm(game);
  const room = Math.max(0, band.maxAlive - living);
  if (room <= 0) return;
  // Empty field: count a new wave and burst. Otherwise trickle 1–2.
  const freshWave = living === 0;
  if (freshWave) state.wave += 1;
  const want = freshWave
    ? Math.min(room, band.burst)
    : Math.min(room, 1 + (random() < 0.35 ? 1 : 0));
  for (let i = 0; i < want; i++) spawnSurvivalEnemy(game, FighterCtor, random);
}

export function survivalHudLine(game) {
  const state = game?.survival;
  if (!state) return "";
  const band = survivalBand(state.elapsed);
  const alive = countLivingSwarm(game);
  const secs = Math.floor(state.elapsed);
  return `Wave ${state.wave || 1} · ${band.label} · ${alive} live · ${state.kills} down · ${secs}s`;
}

/**
 * Soft rewards on death / quit — based on waves, kills, time. No Ranking.
 * Always awards once per result id (even though Survival is a "loss").
 */
export function awardSurvival(profile, result, random = Math.random) {
  const empty = {
    cyber: 0, exp: 0, levelsGained: 0, pendingPicks: [], rankingDelta: 0,
    waves: 0, kills: 0, time: 0, best: false
  };
  if (result?.mode !== "survival") return empty;
  ensureSurvivalProfile(profile);
  ensureProgressionProfile(profile, profile);
  const resultId = String(result.id || "");
  if (!resultId) return empty;
  profile.survival.rewardedResults = Array.isArray(profile.survival.rewardedResults)
    ? profile.survival.rewardedResults
    : [];
  if (profile.survival.rewardedResults.includes(resultId)) return empty;
  profile.survival.rewardedResults.push(resultId);
  profile.survival.rewardedResults = profile.survival.rewardedResults.slice(-100);

  const waves = Math.max(0, Number(result.waves) || 0);
  const kills = Math.max(0, Number(result.kills) || 0);
  const time = Math.max(0, Number(result.time) || 0);
  let cyber = Math.round(
    waves * SURVIVAL_REWARD.cyberPerWave
    + kills * SURVIVAL_REWARD.cyberPerKill
    + Math.floor(time / 10) * SURVIVAL_REWARD.cyberPerTenSec
  );
  cyber = Math.min(SURVIVAL_REWARD.cyberCap, Math.round(cyber * cyberWinMultiplier(profile)));
  let exp = Math.round(
    waves * SURVIVAL_REWARD.expPerWave
    + Math.floor(time / 30) * SURVIVAL_REWARD.expPerThirtySec
  );
  exp = Math.min(SURVIVAL_REWARD.expCap, exp);

  profile.cyber += cyber;
  const progression = exp > 0
    ? grantExp(profile, exp, random)
    : { expGranted: 0, levelsGained: 0, pendingPicks: [] };

  let best = false;
  if (time > profile.survival.bestTime) {
    profile.survival.bestTime = time;
    best = true;
  }
  if (waves > profile.survival.bestWaves) {
    profile.survival.bestWaves = waves;
    best = true;
  }
  if (kills > profile.survival.bestKills) {
    profile.survival.bestKills = kills;
    best = true;
  }

  return {
    cyber,
    exp: progression.expGranted,
    levelsGained: progression.levelsGained,
    pendingPicks: progression.pendingPicks,
    rankingDelta: 0,
    waves,
    kills,
    time,
    best
  };
}

// Silence unused STARTING_CYBER if tree-shaken checks complain — kept for tests.
void STARTING_CYBER;
