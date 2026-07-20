/**
 * Unified Power — comparable danger estimate (not HP / Ranking / Cyber).
 *
 * Formula (per fighter, then sum for duos):
 *   Power = BASE
 *         + gearContribution   (prices + effective combat stats, capped)
 *         + perkContribution   (net combat tradeoff; economy perks weigh little)
 *         + aiContribution     (0 for human player; buddy training; enemy preset)
 *         + optional jitter    (Conquest reroll flavor only)
 *
 * Weights are frozen below so tuning stays readable and stable.
 */

import {
  effectiveStats, GEAR_BY_ID, shieldStats, SLOT_ORDER, weaponKind
} from "./equipment.js";
import {
  CAPABILITY_DOMAINS, evidenceReliability, ensureLearningProfile, HABIT_DOMAINS,
  readiness
} from "./learning.js";
import { getPerk } from "./perks.js";

/** Documented scale weights — change carefully; tests lock relative orderings. */
export const POWER_WEIGHTS = Object.freeze({
  BASE: 100,

  /** Free / starter gear still contributes so bare kits are not zero. */
  FREE_GEAR_VALUE: 28,
  /** Price sum → gear points. */
  GEAR_PRICE_WEIGHT: 0.55,
  /** Extra from live effective HP / DPS / shield (beyond sticker price). */
  GEAR_HP_REF: 500,
  GEAR_DPS_REF: 100,
  GEAR_SHIELD_REF: 80,
  GEAR_STAT_WEIGHT: 28,
  GEAR_CAP: 280,

  /** Perk net combat score scale; cyber-only upside is down-weighted. */
  PERK_UNIT: 42,
  PERK_ECONOMY_WEIGHT: 0.12,
  PERK_CAP: 36,

  /**
   * Conquest / enemy AI presets. Higher = more dangerous.
   * Mind modes (flash / balanced / thinker / mimic) use training below instead.
   */
  AI_PRESET: Object.freeze({
    recruit: 10,
    rookie: 28,
    contender: 48,
    veteran: 72,
    challenger: 98,
    elite: 125
  }),
  AI_PRESET_FALLBACK: 40,

  /** Buddy mind training: readiness × habit/capability reliability × mind ceiling. */
  TRAINING_CAP: 85,
  TRAINING_FLOOR: 4,
  MIND_CEILING: Object.freeze({
    flash: 1,
    balanced: 0.94,
    thinker: 0.9,
    mimic: 0.96
  }),
  READINESS_FACTOR: Object.freeze({
    "I'm ready.": 1,
    "Am I ready?": 0.55,
    "I'm not ready yet.": 0.18
  }),

  /** UI bar reference for duo totals (Apex-ish upper band). */
  BAR_REF: 1200
});

const ENEMY_PRESETS = new Set(Object.keys(POWER_WEIGHTS.AI_PRESET));

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function roundPower(value) {
  return Math.max(1, Math.round(value));
}

/** Sum of shop prices (or free baseline) across loadout slots. */
export function gearPriceSum(loadout) {
  if (!loadout) return 0;
  return SLOT_ORDER.reduce((sum, slot) => {
    const gear = GEAR_BY_ID[loadout[slot]];
    if (!gear) return sum + POWER_WEIGHTS.FREE_GEAR_VALUE;
    return sum + (Number.isFinite(gear.price) ? gear.price : POWER_WEIGHTS.FREE_GEAR_VALUE);
  }, 0);
}

/**
 * Legacy-compatible alias used by Conquest tests / callers: raw price sum
 * (before weight + cap). Prefer gearContribution for the unified formula.
 */
export function gearPower(loadout) {
  return gearPriceSum(loadout);
}

/** Effective combat-stat bonus on top of sticker prices. */
export function gearStatBonus(loadout) {
  if (!loadout) return 0;
  const stats = effectiveStats(loadout);
  const shield = shieldStats(loadout.shield);
  const hpTerm = (stats.hp || 0) / POWER_WEIGHTS.GEAR_HP_REF;
  const dpsTerm = (stats.dps || 0) / POWER_WEIGHTS.GEAR_DPS_REF;
  const shieldTerm = (shield.durability || 0) / POWER_WEIGHTS.GEAR_SHIELD_REF;
  // Damage-taken below 100 (percent-ish) is survivability.
  const soakTerm = Math.max(0, (100 - (stats.damageTaken || 100)) / 100);
  return POWER_WEIGHTS.GEAR_STAT_WEIGHT * (hpTerm + dpsTerm + shieldTerm + soakTerm);
}

/** Capped gear contribution for one fighter. */
export function gearContribution(loadout) {
  const raw = gearPriceSum(loadout) * POWER_WEIGHTS.GEAR_PRICE_WEIGHT
    + gearStatBonus(loadout);
  return clamp(raw, 0, POWER_WEIGHTS.GEAR_CAP);
}

/**
 * Net perk combat effect. Strong combat upsides raise Power; pure economy
 * (cyberWinBonus) contributes little; tradeoff downsides pull the score back.
 */
export function perkContribution(perkId) {
  const perk = getPerk(perkId);
  if (!perk) return 0;
  let score = 0;
  for (const [key, value] of Object.entries(perk.modifiers || {})) {
    const delta = Number(value) - 1;
    if (!Number.isFinite(delta) || delta === 0) continue;
    if (key === "cyberWinBonus") {
      score += delta * POWER_WEIGHTS.PERK_ECONOMY_WEIGHT;
      continue;
    }
    // Lower is better for these keys.
    const beneficialDown = key === "damageTaken" || key === "dodgeCooldown"
      || key === "recharge" || key === "shieldRaisedSpeed";
    const signed = beneficialDown ? -delta : delta;
    score += signed;
  }
  return clamp(
    score * POWER_WEIGHTS.PERK_UNIT,
    -POWER_WEIGHTS.PERK_CAP,
    POWER_WEIGHTS.PERK_CAP
  );
}

const AI_MIND_MODES = new Set(["flash", "balanced", "thinker", "mimic"]);

/** Discrete Conquest / enemy AI tier points. */
export function presetAiContribution(aiId) {
  if (!aiId || !ENEMY_PRESETS.has(aiId)) {
    return POWER_WEIGHTS.AI_PRESET_FALLBACK;
  }
  return POWER_WEIGHTS.AI_PRESET[aiId];
}

/**
 * Buddy mind / training evidence → AI skill points.
 * Untrained (thin evidence / not ready) stays near TRAINING_FLOOR.
 */
export function buddyTrainingContribution(learned, mindMode = "balanced") {
  const profile = ensureLearningProfile(learned || {});
  const habitRecords = HABIT_DOMAINS
    .map((domain) => profile.habits?.[domain])
    .filter((record) => (record?.samples || 0) > 0);
  const habitRel = habitRecords.length
    ? habitRecords.reduce((sum, record) => sum + evidenceReliability(record), 0)
      / habitRecords.length
    : 0;
  // Core fight capabilities (skip precisionAim — niche / weapon-gated).
  const coreCaps = ["aim", "dodgeTiming", "fuelManagement"]
    .filter((domain) => CAPABILITY_DOMAINS.includes(domain));
  const capRel = coreCaps.reduce(
    (sum, domain) => sum + evidenceReliability(profile.capabilities?.[domain]),
    0
  ) / Math.max(1, coreCaps.length);

  const readyLine = readiness(profile);
  const readyFactor = POWER_WEIGHTS.READINESS_FACTOR[readyLine]
    ?? POWER_WEIGHTS.READINESS_FACTOR["I'm not ready yet."];
  const mind = POWER_WEIGHTS.MIND_CEILING[mindMode]
    ?? POWER_WEIGHTS.MIND_CEILING.balanced;
  // Blend reliability so empty profiles stay low even if readiness string is odd.
  const reliability = 0.15 + 0.55 * habitRel + 0.3 * capRel;
  const raw = POWER_WEIGHTS.TRAINING_CAP * readyFactor * mind * reliability;
  return clamp(raw, POWER_WEIGHTS.TRAINING_FLOOR, POWER_WEIGHTS.TRAINING_CAP);
}

/**
 * AI skill contribution for one fighter.
 * - human / player: 0 (combat skill unknown — gear+perk only)
 * - enemy preset (rookie…elite): discrete table
 * - buddy mind modes: training evidence + mind ceiling
 */
export function aiContribution(opts = {}) {
  const {
    role = null,
    ai = null,
    learned = null,
    mindMode = null
  } = opts;
  if (role === "player" || role === "human") return 0;
  if (ai && ENEMY_PRESETS.has(ai)) return presetAiContribution(ai);
  const mind = mindMode || (AI_MIND_MODES.has(ai) ? ai : "balanced");
  if (role === "buddy" || AI_MIND_MODES.has(ai) || learned) {
    return buddyTrainingContribution(learned, mind);
  }
  if (ai) return presetAiContribution(ai);
  return 0;
}
/**
 * Full Power for one character / AI.
 * @param {{
 *   loadout?: object,
 *   role?: "player"|"buddy"|"enemy"|"human"|string,
 *   ai?: string,
 *   learned?: object,
 *   mindMode?: string,
 *   jitter?: number
 * }} input
 * @returns {{ power: number, parts: object, label: string }}
 */
export function estimateFighterPower(input = {}) {
  const loadout = input.loadout || null;
  const gear = gearContribution(loadout);
  const perk = perkContribution(loadout?.perk);
  const ai = aiContribution({
    role: input.role,
    ai: input.ai,
    learned: input.learned,
    mindMode: input.mindMode
  });
  const jitter = Number.isFinite(input.jitter) ? Number(input.jitter) : 0;
  const power = roundPower(POWER_WEIGHTS.BASE + gear + perk + ai + jitter);
  return {
    power,
    parts: {
      base: POWER_WEIGHTS.BASE,
      gear: Math.round(gear),
      perk: Math.round(perk),
      ai: Math.round(ai),
      jitter: Math.round(jitter)
    },
    label: powerScaleLabel(power)
  };
}

/** Short scale label for a Power number. */
export function powerScaleLabel(power) {
  const value = Number(power) || 0;
  if (value < 160) return "Low";
  if (value < 220) return "Fair";
  if (value < 290) return "Solid";
  if (value < 370) return "High";
  if (value < 460) return "Fierce";
  return "Peak";
}

export function formatPower(power) {
  const value = roundPower(power);
  const label = powerScaleLabel(value);
  return { value, label, text: `${label} · ${value}` };
}

/**
 * Player + buddy Power from a profile (Equipment Bay).
 * Buddy training uses the active player-weapon learning profile (same as AI).
 */
export function estimateProfilePowers(profile) {
  const equipment = profile?.equipment || {};
  const playerLoadout = equipment.player || null;
  const buddyLoadout = equipment.buddy || null;
  const weapon = weaponKind(playerLoadout?.weapon);
  const learned = profile?.weapons?.[weapon] || profile?.weapons?.gun || null;
  const mindMode = profile?.aiMode || "balanced";

  const player = estimateFighterPower({
    loadout: playerLoadout,
    role: "player"
  });
  const buddy = estimateFighterPower({
    loadout: buddyLoadout,
    role: "buddy",
    mindMode,
    learned
  });
  return {
    player: player.power,
    buddy: buddy.power,
    duo: player.power + buddy.power,
    playerDetail: player,
    buddyDetail: buddy
  };
}

/**
 * Conquest encounter Power — same formula for trainer + follower.
 * Optional jitter (reroll flavor) applies once to the duo total via trainer.
 */
export function estimateEncounterPower(encounter, jitter = 0) {
  const trainer = estimateFighterPower({
    loadout: encounter?.trainer?.loadout,
    role: "enemy",
    ai: encounter?.trainer?.ai
  });
  const follower = estimateFighterPower({
    loadout: encounter?.follower?.loadout,
    role: "enemy",
    ai: encounter?.follower?.ai
  });
  const j = Number.isFinite(jitter) ? Number(jitter) : 0;
  const duo = roundPower(trainer.power + follower.power + j);
  return {
    trainer: trainer.power,
    follower: follower.power,
    duo,
    jitter: Math.round(j),
    trainerDetail: trainer,
    followerDetail: follower
  };
}

/**
 * Back-compat Conquest helper: returns the duo total (integer).
 * Prefer estimateEncounterPower when UI needs per-fighter breakdown.
 */
export function estimatePower(encounter, jitter = 0) {
  return estimateEncounterPower(encounter, jitter).duo;
}

/** Width % for the Conquest power bar. */
export function powerBarPercent(power, ref = POWER_WEIGHTS.BAR_REF) {
  const value = Number(power) || 0;
  const denom = Math.max(1, Number(ref) || POWER_WEIGHTS.BAR_REF);
  return clamp(Math.round((value / denom) * 100), 6, 100);
}
