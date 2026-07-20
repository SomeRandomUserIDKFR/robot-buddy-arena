/**
 * Conquest opponent selection — leagues from Ranking, pending encounter, Power.
 *
 * Power (danger estimate, not HP) comes from `power.js` — gear + perks + AI
 * presets for trainer/follower, with optional reroll jitter on the duo total.
 *
 * League bands (inclusive min, exclusive max except Apex):
 *   0–149   Rookie
 *   150–299 Contender (filler)
 *   300–499 Veteran
 *   500–749 Challenger (filler)
 *   750–999 Elite
 *   1000+   Apex (filler / endgame)
 *
 * AI mapping (trainer / follower):
 *   Rookie     → rookie / recruit
 *   Contender  → contender / rookie   (mid preset between rookie & veteran)
 *   Veteran    → veteran / rookie
 *   Challenger → challenger / veteran (mid preset between veteran & elite)
 *   Elite      → elite / veteran
 *   Apex       → elite / elite        (elite+)
 *
 * Cyber/EXP rewardTier still use rookie | veteran | elite:
 *   Rookie + Contender → rookie
 *   Veteran + Challenger → veteran
 *   Elite + Apex → elite
 *
 * Reroll: first reroll per visit to the select screen is free; later rerolls
 * cost REROLL_CYBER_COST (10¢). Blocked when broke. Pending encounter is
 * session-only (module state) until Fight starts. Each encounter includes a
 * themed mapId; reroll regenerates map + duo together.
 *
 * Each encounter gets a complementary duo color theme (trainer + follower
 * body fills, hues ~180° apart) stored on the pending encounter so Fight
 * matches the select-screen preview.
 */

import { GEAR_BY_ID, SLOT_ORDER, trainerLoadout } from "./equipment.js";
import {
  estimateEncounterPower, estimatePower, gearPower, POWER_WEIGHTS
} from "./power.js";
import { getMap, pickRandomMapId } from "./maps.js";

export { estimatePower, gearPower, estimateEncounterPower, POWER_WEIGHTS };
export const REROLL_CYBER_COST = 10;

/** @type {{ id: string, name: string, min: number, max: number|null, rewardTier: string, trainerAi: string, followerAi: string, training: string }[]} */
export const LEAGUE_BANDS = Object.freeze([
  {
    id: "rookie", name: "Rookie", min: 0, max: 150,
    rewardTier: "rookie", trainerAi: "rookie", followerAi: "recruit",
    training: "Green"
  },
  {
    id: "contender", name: "Contender", min: 150, max: 300,
    rewardTier: "rookie", trainerAi: "contender", followerAi: "rookie",
    training: "Developing"
  },
  {
    id: "veteran", name: "Veteran", min: 300, max: 500,
    rewardTier: "veteran", trainerAi: "veteran", followerAi: "rookie",
    training: "Trained"
  },
  {
    id: "challenger", name: "Challenger", min: 500, max: 750,
    rewardTier: "veteran", trainerAi: "challenger", followerAi: "veteran",
    training: "Hardened"
  },
  {
    id: "elite", name: "Elite", min: 750, max: 1000,
    rewardTier: "elite", trainerAi: "elite", followerAi: "veteran",
    training: "Sharp"
  },
  {
    id: "apex", name: "Apex", min: 1000, max: null,
    rewardTier: "elite", trainerAi: "elite", followerAi: "elite",
    training: "Peak"
  }
]);

const TRAINER_NAMES = [
  "Hex Coil", "Virex", "Nora Quill", "Ash Relay", "Kade Voss",
  "Sable Drift", "Juno Pike", "Rook Halcyon", "Mira Flux", "Torren Vale"
];
const FOLLOWER_NAMES = [
  "Unit 7", "Spar Echo", "Clip", "Nix", "Pebble",
  "Driftlet", "Bolt", "Wisp", "Gasket", "Proxy"
];

/**
 * Named complementary duo themes (trainer + follower). Hues ~180° apart.
 * Saturated hostile/readable fills — distinct from player white/blue (#e7f9ff)
 * and buddy cyan body/outline (#42dff5 / #4df2ff).
 */
export const CONQUEST_COLOR_PAIRS = Object.freeze([
  Object.freeze({ id: "red-cyan", trainer: "#ff4d5c", follower: "#2ab8c8" }),
  Object.freeze({ id: "orange-blue", trainer: "#ff8c3a", follower: "#3a8cff" }),
  Object.freeze({ id: "magenta-green", trainer: "#ff3d9a", follower: "#3dff7a" }),
  Object.freeze({ id: "amber-indigo", trainer: "#ffb020", follower: "#4588ff" }),
  Object.freeze({ id: "coral-teal", trainer: "#ff6b5a", follower: "#2ac4b8" }),
  Object.freeze({ id: "crimson-aqua", trainer: "#e82d4a", follower: "#2ecfc0" }),
  Object.freeze({ id: "violet-chartreuse", trainer: "#9a4dff", follower: "#a8e82a" }),
  Object.freeze({ id: "scarlet-turquoise", trainer: "#ff3a40", follower: "#1ab8a8" })
]);

/** Parse #rgb / #rrggbb to { r, g, b } (0–255). */
export function parseHexColor(hex) {
  const raw = String(hex || "").replace("#", "").trim();
  if (raw.length === 3) {
    return {
      r: parseInt(raw[0] + raw[0], 16),
      g: parseInt(raw[1] + raw[1], 16),
      b: parseInt(raw[2] + raw[2], 16)
    };
  }
  if (raw.length !== 6) return null;
  const n = Number.parseInt(raw, 16);
  if (!Number.isFinite(n)) return null;
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/** Hue in degrees [0, 360). */
export function hexToHue(hex) {
  const rgb = parseHexColor(hex);
  if (!rgb) return NaN;
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d < 1e-6) return 0;
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return h;
}

/** Smallest absolute hue distance in degrees [0, 180]. */
export function hueDistance(a, b) {
  const d = Math.abs(Number(a) - Number(b)) % 360;
  return d > 180 ? 360 - d : d;
}

/**
 * True when two colors are complementary (hue ~180° apart).
 * @param {string} a
 * @param {string} b
 * @param {number} [tolerance=28]
 */
export function areComplementaryColors(a, b, tolerance = 28) {
  const ha = hexToHue(a);
  const hb = hexToHue(b);
  if (!Number.isFinite(ha) || !Number.isFinite(hb)) return false;
  return Math.abs(hueDistance(ha, hb) - 180) <= tolerance;
}

/**
 * Pick a duo color theme. Returns a fresh object with trainer/follower hexes.
 * @param {() => number} [random]
 */
export function pickColorPair(random = Math.random) {
  const pair = CONQUEST_COLOR_PAIRS[
    Math.floor(random() * CONQUEST_COLOR_PAIRS.length) % CONQUEST_COLOR_PAIRS.length
  ];
  return {
    id: pair.id,
    trainer: pair.trainer,
    follower: pair.follower
  };
}

/**
 * Loadout kits per league. Index 0 matches classic trainerLoadout(tier) where
 * possible; extra kits give reroll variety within the same league.
 */
const LOADOUT_KITS = {
  rookie: {
    trainer: [
      () => trainerLoadout("rookie", false),
      () => ({
        body: "scout-frame", helmet: "survey-visor", weapon: "arc-saber",
        jetpack: "sprinter-pack", shield: "light-buckler"
      }),
      () => ({
        body: "field-frame", helmet: "wideband-array", weapon: "pulse-rifle",
        jetpack: "vector-pack", shield: "no-shield"
      })
    ],
    follower: [
      () => trainerLoadout("rookie", true),
      () => ({
        body: "field-frame", helmet: "survey-visor", weapon: "pulse-rifle",
        jetpack: "sprinter-pack", shield: "no-shield"
      }),
      () => ({
        body: "scout-frame", helmet: "wideband-array", weapon: "arc-saber",
        jetpack: "vector-pack", shield: "no-shield"
      })
    ]
  },
  contender: {
    trainer: [
      () => ({
        body: "field-frame", helmet: "survey-visor", weapon: "arc-saber",
        jetpack: "vector-pack", shield: "light-buckler"
      }),
      () => ({
        body: "field-frame", helmet: "wideband-array", weapon: "burst-carbine",
        jetpack: "sprinter-pack", shield: "light-buckler"
      }),
      () => ({
        body: "scout-frame", helmet: "survey-visor", weapon: "pulse-rifle",
        jetpack: "vector-pack", shield: "kinetic-targe"
      })
    ],
    follower: [
      () => ({
        body: "scout-frame", helmet: "survey-visor", weapon: "pulse-rifle",
        jetpack: "sprinter-pack", shield: "no-shield"
      }),
      () => ({
        body: "field-frame", helmet: "wideband-array", weapon: "arc-saber",
        jetpack: "vector-pack", shield: "no-shield"
      }),
      () => ({
        body: "scout-frame", helmet: "survey-visor", weapon: "burst-carbine",
        jetpack: "sprinter-pack", shield: "light-buckler"
      })
    ]
  },
  veteran: {
    trainer: [
      () => trainerLoadout("veteran", false),
      () => ({
        body: "field-frame", helmet: "guard-helm", weapon: "duelist-blade",
        jetpack: "vector-pack", shield: "kinetic-targe"
      }),
      () => ({
        body: "reactive-frame", helmet: "survey-visor", weapon: "arc-saber",
        jetpack: "endurance-pack", shield: "light-buckler"
      })
    ],
    follower: [
      () => trainerLoadout("veteran", true),
      () => ({
        body: "scout-frame", helmet: "wideband-array", weapon: "burst-carbine",
        jetpack: "sprinter-pack", shield: "light-buckler"
      }),
      () => ({
        body: "field-frame", helmet: "survey-visor", weapon: "pulse-rifle",
        jetpack: "vector-pack", shield: "no-shield"
      })
    ]
  },
  challenger: {
    trainer: [
      () => ({
        body: "field-frame", helmet: "guard-helm", weapon: "heavy-saber",
        jetpack: "endurance-pack", shield: "kinetic-targe"
      }),
      () => ({
        body: "bulwark-frame", helmet: "survey-visor", weapon: "arc-saber",
        jetpack: "vector-pack", shield: "kinetic-targe"
      }),
      () => ({
        body: "reactive-frame", helmet: "hunter-optics", weapon: "marksman-rifle",
        jetpack: "endurance-pack", shield: "light-buckler"
      })
    ],
    follower: [
      () => ({
        body: "field-frame", helmet: "guard-helm", weapon: "marksman-rifle",
        jetpack: "vector-pack", shield: "light-buckler"
      }),
      () => ({
        body: "field-frame", helmet: "wideband-array", weapon: "burst-carbine",
        jetpack: "endurance-pack", shield: "kinetic-targe"
      }),
      () => trainerLoadout("veteran", true)
    ]
  },
  elite: {
    trainer: [
      () => trainerLoadout("elite", false),
      () => ({
        body: "bulwark-frame", helmet: "hunter-optics", weapon: "heavy-saber",
        jetpack: "endurance-pack", shield: "kinetic-targe"
      }),
      () => ({
        body: "reactive-frame", helmet: "guard-helm", weapon: "marksman-rifle",
        jetpack: "vector-pack", shield: "kinetic-targe"
      })
    ],
    follower: [
      () => trainerLoadout("elite", true),
      () => ({
        body: "field-frame", helmet: "hunter-optics", weapon: "marksman-rifle",
        jetpack: "endurance-pack", shield: "kinetic-targe"
      }),
      () => ({
        body: "bulwark-frame", helmet: "guard-helm", weapon: "heavy-saber",
        jetpack: "vector-pack", shield: "light-buckler"
      })
    ]
  },
  apex: {
    trainer: [
      () => trainerLoadout("elite", false),
      () => ({
        body: "bulwark-frame", helmet: "hunter-optics", weapon: "heavy-saber",
        jetpack: "endurance-pack", shield: "kinetic-targe"
      }),
      () => ({
        body: "reactive-frame", helmet: "hunter-optics", weapon: "marksman-rifle",
        jetpack: "endurance-pack", shield: "kinetic-targe"
      })
    ],
    follower: [
      () => trainerLoadout("elite", false),
      () => trainerLoadout("elite", true),
      () => ({
        body: "bulwark-frame", helmet: "guard-helm", weapon: "marksman-rifle",
        jetpack: "endurance-pack", shield: "kinetic-targe"
      })
    ]
  }
};

/** Session pending encounter + free-reroll flag (not persisted). */
let session = {
  encounter: null,
  freeRerollAvailable: true,
  lastKitIndex: -1
};

export function resetConquestSelectSession() {
  session = { encounter: null, freeRerollAvailable: true, lastKitIndex: -1 };
}

export function getPendingEncounter() {
  return session.encounter;
}

export function setPendingEncounter(encounter) {
  session.encounter = encounter;
}

export function hasFreeReroll() {
  return session.freeRerollAvailable;
}

export function leagueFromRanking(ranking) {
  const r = Number.isFinite(Number(ranking)) ? Math.max(0, Number(ranking)) : 0;
  for (const band of LEAGUE_BANDS) {
    if (band.max == null) {
      if (r >= band.min) return band;
      continue;
    }
    if (r >= band.min && r < band.max) return band;
  }
  return LEAGUE_BANDS[0];
}

function pickName(pool, random, used) {
  const available = pool.filter((name) => !used.has(name));
  const list = available.length ? available : pool;
  const name = list[Math.floor(random() * list.length) % list.length];
  used.add(name);
  return name;
}

function pickKit(leagueId, role, random, avoidIndex = -1) {
  const kits = LOADOUT_KITS[leagueId]?.[role] || LOADOUT_KITS.rookie[role];
  let index = Math.floor(random() * kits.length) % kits.length;
  if (kits.length > 1 && index === avoidIndex) {
    index = (index + 1) % kits.length;
  }
  return { loadout: kits[index](), index };
}

/**
 * Build a duo encounter for the player's current league.
 * @param {number} ranking
 * @param {() => number} [random]
 * @param {{ avoidKitIndex?: number }} [opts]
 */
export function generateEncounter(ranking, random = Math.random, opts = {}) {
  const league = leagueFromRanking(ranking);
  const used = new Set();
  const trainerKit = pickKit(league.id, "trainer", random, opts.avoidKitIndex);
  const followerKit = pickKit(league.id, "follower", random, opts.avoidKitIndex);
  const colorPair = pickColorPair(random);
  // Slight power variance within league (±8) so rerolls feel different.
  const jitter = Math.floor(random() * 17) - 8;
  const mapId = pickRandomMapId(random);
  const map = getMap(mapId);
  const trainer = {
    role: "trainer",
    name: pickName(TRAINER_NAMES, random, used),
    label: "Trainer",
    ai: league.trainerAi,
    loadout: trainerKit.loadout,
    training: league.training,
    color: colorPair.trainer
  };
  const follower = {
    role: "follower",
    name: pickName(FOLLOWER_NAMES, random, used),
    label: "Follower",
    ai: league.followerAi,
    loadout: followerKit.loadout,
    training: league.training,
    color: colorPair.follower
  };
  const encounter = {
    leagueId: league.id,
    leagueName: league.name,
    rewardTier: league.rewardTier,
    training: league.training,
    mapId: map.id,
    mapName: map.name,
    mapTheme: map.theme,
    mapBlurb: map.blurb,
    trainer,
    follower,
    colorPair,
    powerJitter: jitter,
    kitIndex: trainerKit.index
  };
  const breakdown = estimateEncounterPower(encounter, jitter);
  encounter.power = breakdown.duo;
  encounter.trainerPower = breakdown.trainer;
  encounter.followerPower = breakdown.follower;
  return encounter;
}

/**
 * Open / refresh select session: always rolls a fresh encounter and restores
 * the free first reroll for this visit.
 */
export function beginConquestSelect(ranking, random = Math.random) {
  resetConquestSelectSession();
  const encounter = generateEncounter(ranking, random);
  session.encounter = encounter;
  session.lastKitIndex = encounter.kitIndex;
  return encounter;
}

/**
 * Reroll within the current league.
 * @returns {{ ok: boolean, encounter?: object, cost?: number, error?: string, free?: boolean }}
 */
export function rerollEncounter(profile, random = Math.random) {
  const ranking = Number.isInteger(profile?.ranking) ? profile.ranking : 0;
  const free = session.freeRerollAvailable;
  const cost = free ? 0 : REROLL_CYBER_COST;
  if (cost > 0 && (profile.cyber | 0) < cost) {
    return { ok: false, cost, error: "broke", free: false };
  }
  if (cost > 0) {
    profile.cyber -= cost;
  }
  if (free) session.freeRerollAvailable = false;
  const encounter = generateEncounter(ranking, random, {
    avoidKitIndex: session.lastKitIndex
  });
  session.encounter = encounter;
  session.lastKitIndex = encounter.kitIndex;
  return { ok: true, encounter, cost, free };
}

export function loadoutSummary(loadout) {
  return SLOT_ORDER.map((slot) => {
    const gear = GEAR_BY_ID[loadout?.[slot]];
    return { slot, id: loadout?.[slot] || null, name: gear?.name || "—" };
  });
}
