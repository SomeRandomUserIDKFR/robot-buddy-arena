/**
 * Survival mode — endless waves of lower-tier AIs that ramp with time.
 *
 * Player + buddy (team 0) vs swarm enemies (team 1). Match ends only when
 * team 0 is wiped. Enemies keep spawning; dead swarm bots are pruned.
 *
 * Ramp (by survival seconds):
 *   0–45    green — recruit AI, bare kits
 *   45–90   stir — recruit/rookie, light kits
 *   90–150  press — rookie+, denser
 *   150–240 heavy — contender, mid kits
 *   240–360 siege — contender/veteran, hard kits
 *   360–480 breach — veteran heavy, peak kits
 *   480–600 onslaught — denser veteran/elite AI (still no elite toys)
 *   600+    collapse — peak pressure plateau
 *
 * One-time milestones (time / waves / kills / band) grant bonus Cyber/EXP
 * outside the soft run caps and flash mid-run when first crossed.
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
  ]),
  // Peak kits: tougher frames/tools, still below Conquest elite nanotech toys.
  peak: Object.freeze([
    Object.freeze({
      body: "bulwark-frame", helmet: "hunter-optics", weapon: "marksman-rifle",
      secondaryWeapon: "frag-grenade", extensionSecondary: "trapper",
      jetpack: "recycler-pack", shield: "kinetic-targe"
    }),
    Object.freeze({
      body: "reactive-frame", helmet: "guard-helm", weapon: "heavy-saber",
      secondaryWeapon: "throw-breakable", extensionSecondary: "reconjurer-builder",
      jetpack: "endurance-pack", shield: "kinetic-targe"
    }),
    Object.freeze({
      body: "bulwark-frame", helmet: "hunter-optics", weapon: "burst-carbine",
      secondaryWeapon: "sticky-charge", extensionSecondary: "light-condensation",
      jetpack: "recycler-pack", shield: "light-buckler"
    }),
    Object.freeze({
      ...trainerLoadout("veteran", false),
      secondaryWeapon: "hookshot-winch",
      extensionSecondary: "trapper"
    })
  ])
});

/** Ordered band timeline for tests / milestone band checks. */
export const SURVIVAL_BAND_ORDER = Object.freeze([
  "green", "stir", "press", "heavy", "siege", "breach", "onslaught", "collapse"
]);

/**
 * One-time Survival milestones. Bonus Cyber/EXP sit outside the soft run caps.
 * kind: time (sec) | waves | kills | band (band id string)
 */
export const SURVIVAL_MILESTONES = Object.freeze([
  Object.freeze({
    id: "hold-60", label: "First Minute", kind: "time", threshold: 60,
    cyber: 20, exp: 12, announce: "MILESTONE · FIRST MINUTE"
  }),
  Object.freeze({
    id: "hold-180", label: "Three Minutes", kind: "time", threshold: 180,
    cyber: 35, exp: 20, announce: "MILESTONE · THREE MINUTES"
  }),
  Object.freeze({
    id: "hold-300", label: "Five Minutes", kind: "time", threshold: 300,
    cyber: 55, exp: 30, announce: "MILESTONE · FIVE MINUTES"
  }),
  Object.freeze({
    id: "hold-480", label: "Eight Minutes", kind: "time", threshold: 480,
    cyber: 75, exp: 40, announce: "MILESTONE · EIGHT MINUTES"
  }),
  Object.freeze({
    id: "hold-600", label: "Ten Minutes", kind: "time", threshold: 600,
    cyber: 100, exp: 55, announce: "MILESTONE · TEN MINUTES"
  }),
  Object.freeze({
    id: "waves-5", label: "Wave 5", kind: "waves", threshold: 5,
    cyber: 18, exp: 10, announce: "MILESTONE · WAVE 5"
  }),
  Object.freeze({
    id: "waves-10", label: "Wave 10", kind: "waves", threshold: 10,
    cyber: 32, exp: 18, announce: "MILESTONE · WAVE 10"
  }),
  Object.freeze({
    id: "waves-15", label: "Wave 15", kind: "waves", threshold: 15,
    cyber: 48, exp: 28, announce: "MILESTONE · WAVE 15"
  }),
  Object.freeze({
    id: "waves-20", label: "Wave 20", kind: "waves", threshold: 20,
    cyber: 70, exp: 40, announce: "MILESTONE · WAVE 20"
  }),
  Object.freeze({
    id: "kills-25", label: "25 Kills", kind: "kills", threshold: 25,
    cyber: 22, exp: 12, announce: "MILESTONE · 25 KILLS"
  }),
  Object.freeze({
    id: "kills-50", label: "50 Kills", kind: "kills", threshold: 50,
    cyber: 40, exp: 22, announce: "MILESTONE · 50 KILLS"
  }),
  Object.freeze({
    id: "kills-100", label: "100 Kills", kind: "kills", threshold: 100,
    cyber: 70, exp: 40, announce: "MILESTONE · 100 KILLS"
  }),
  Object.freeze({
    id: "band-siege", label: "Reach Siege", kind: "band", threshold: "siege",
    cyber: 30, exp: 18, announce: "MILESTONE · SIEGE REACHED"
  }),
  Object.freeze({
    id: "band-breach", label: "Reach Breach", kind: "band", threshold: "breach",
    cyber: 50, exp: 28, announce: "MILESTONE · BREACH REACHED"
  }),
  Object.freeze({
    id: "band-onslaught", label: "Reach Onslaught", kind: "band", threshold: "onslaught",
    cyber: 70, exp: 38, announce: "MILESTONE · ONSLAUGHT REACHED"
  }),
  Object.freeze({
    id: "band-collapse", label: "Reach Collapse", kind: "band", threshold: "collapse",
    cyber: 95, exp: 50, announce: "MILESTONE · COLLAPSE REACHED"
  })
]);

export const SURVIVAL_MILESTONES_BY_ID = Object.freeze(
  Object.fromEntries(SURVIVAL_MILESTONES.map((m) => [m.id, m]))
);

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
  if (t < 360) {
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
  if (t < 480) {
    return {
      id: "breach",
      aiPool: ["contender", "veteran", "veteran"],
      kitPool: "peak",
      spawnInterval: 1.55,
      maxAlive: 12,
      burst: 4,
      label: "Breach"
    };
  }
  if (t < 600) {
    return {
      id: "onslaught",
      aiPool: ["veteran", "veteran", "elite"],
      kitPool: "peak",
      spawnInterval: 1.35,
      maxAlive: 13,
      burst: 5,
      label: "Onslaught"
    };
  }
  return {
    id: "collapse",
    aiPool: ["veteran", "elite", "elite"],
    kitPool: "peak",
    spawnInterval: 1.2,
    maxAlive: 14,
    burst: 5,
    label: "Collapse"
  };
}

function bandReached(currentBandId, targetBandId) {
  const cur = SURVIVAL_BAND_ORDER.indexOf(currentBandId);
  const want = SURVIVAL_BAND_ORDER.indexOf(targetBandId);
  if (cur < 0 || want < 0) return currentBandId === targetBandId;
  return cur >= want;
}

/** Whether a milestone's threshold is met by the given run stats. */
export function survivalMilestoneMet(milestone, stats = {}) {
  if (!milestone) return false;
  const time = Math.max(0, Number(stats.time) || 0);
  const waves = Math.max(0, Number(stats.waves) || 0);
  const kills = Math.max(0, Number(stats.kills) || 0);
  const bandId = stats.bandId || survivalBand(time).id;
  if (milestone.kind === "time") return time >= milestone.threshold;
  if (milestone.kind === "waves") return waves >= milestone.threshold;
  if (milestone.kind === "kills") return kills >= milestone.threshold;
  if (milestone.kind === "band") return bandReached(bandId, milestone.threshold);
  return false;
}

/**
 * Milestones newly unlocked by this run (not yet on profile).
 * Does not mutate profile.
 */
export function listNewSurvivalMilestones(profile, stats = {}) {
  ensureSurvivalProfile(profile);
  const owned = new Set(profile.survival.milestones || []);
  return SURVIVAL_MILESTONES.filter((m) => (
    !owned.has(m.id) && survivalMilestoneMet(m, stats)
  ));
}

export function ensureSurvivalProfile(profile, saved = profile) {
  ensureEconomyProfile(profile, saved);
  const raw = saved?.survival && typeof saved.survival === "object" ? saved.survival : {};
  const bestTime = Number.isFinite(Number(raw.bestTime)) ? Math.max(0, Number(raw.bestTime)) : 0;
  const bestWaves = Number.isInteger(raw.bestWaves) ? Math.max(0, raw.bestWaves) : 0;
  const bestKills = Number.isInteger(raw.bestKills) ? Math.max(0, raw.bestKills) : 0;
  const milestones = Array.from(new Set(
    Array.isArray(raw.milestones) ? raw.milestones : []
  )).filter((id) => typeof id === "string" && SURVIVAL_MILESTONES_BY_ID[id]);
  profile.survival = {
    bestTime,
    bestWaves,
    bestKills,
    milestones,
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
    announcement: 0,
    // Milestone ids flashed this run (profile unlock still happens at award).
    milestonesFlashed: [],
    milestoneAnnounce: null
  };
}

/**
 * Flash newly reached milestones mid-run. `clearedIds` = already owned on profile.
 * Returns the milestone just announced, or null.
 */
export function tickSurvivalMilestones(state, clearedIds = []) {
  if (!state) return null;
  const owned = new Set([
    ...(Array.isArray(clearedIds) ? clearedIds : []),
    ...(state.milestonesFlashed || [])
  ]);
  const stats = {
    time: state.elapsed,
    waves: state.wave,
    kills: state.kills,
    bandId: state.bandId
  };
  for (const milestone of SURVIVAL_MILESTONES) {
    if (owned.has(milestone.id)) continue;
    if (!survivalMilestoneMet(milestone, stats)) continue;
    state.milestonesFlashed = [...(state.milestonesFlashed || []), milestone.id];
    state.milestoneAnnounce = milestone.announce || `MILESTONE · ${milestone.label}`;
    state.announcement = Math.max(state.announcement || 0, 2.5);
    return milestone;
  }
  return null;
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
  }), spec.loadout, {
    healthScale: game.healthScale || 1,
    settings: game.settings
  });
  game.fighters.push(fighter);
  state.spawned += 1;
  return fighter;
}

/**
 * Advance survival timers, spawn bursts, prune corpses, tally kills.
 * Call once per frame from the main update loop.
 * Optional `profile` enables mid-run milestone flashes for unowned badges.
 */
export function tickSurvival(game, dt, FighterCtor, random = Math.random, profile = null) {
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
    state.milestoneAnnounce = null;
    game.announcement = Math.max(game.announcement || 0, 2.4);
  }

  const cleared = profile?.survival?.milestones || [];
  const hit = tickSurvivalMilestones(state, cleared);
  if (hit) {
    game.announcement = Math.max(game.announcement || 0, 2.5);
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
  if ((state.announcement || 0) > 0 && state.milestoneAnnounce) {
    return state.milestoneAnnounce;
  }
  const band = survivalBand(state.elapsed);
  const alive = countLivingSwarm(game);
  const secs = Math.floor(state.elapsed);
  return `Wave ${state.wave || 1} · ${band.label} · ${alive} live · ${state.kills} down · ${secs}s`;
}

/**
 * Soft rewards on death / quit — based on waves, kills, time. No Ranking.
 * Always awards once per result id (even though Survival is a "loss").
 * First-time milestones add bonus Cyber/EXP outside the soft run caps.
 */
export function awardSurvival(profile, result, random = Math.random) {
  const empty = {
    cyber: 0, exp: 0, levelsGained: 0, pendingPicks: [], rankingDelta: 0,
    waves: 0, kills: 0, time: 0, best: false, milestones: []
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
  const bandId = result.bandId || survivalBand(time).id;
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

  const unlocked = listNewSurvivalMilestones(profile, { time, waves, kills, bandId });
  let milestoneCyber = 0;
  let milestoneExp = 0;
  for (const milestone of unlocked) {
    milestoneCyber += Number(milestone.cyber) || 0;
    milestoneExp += Number(milestone.exp) || 0;
    profile.survival.milestones.push(milestone.id);
  }
  milestoneCyber = Math.round(milestoneCyber * cyberWinMultiplier(profile));
  cyber += milestoneCyber;
  exp += milestoneExp;

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
    best,
    milestones: unlocked.map((m) => ({
      id: m.id, label: m.label, cyber: m.cyber, exp: m.exp
    })),
    milestoneCyber,
    milestoneExp
  };
}

// Silence unused STARTING_CYBER if tree-shaken checks complain — kept for tests.
void STARTING_CYBER;
