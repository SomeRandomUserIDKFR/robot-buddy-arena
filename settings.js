import { DEFAULT_PROFILE } from "./config.js";
import { clamp } from "./utils.js";

// Morph styles for Mechanical Modularity + Retractable Armor plate transforms.
// "nanotech" — Mark-85 style nano swarm dissolve / reform.
export const MODULAR_MORPH_STYLES = Object.freeze(["smooth", "fold", "fly", "nanotech"]);

/** How non-armor ground debris leaves the match. */
export const DEBRIS_DESPAWN_STYLES = Object.freeze([
  "fade", "shrink", "decimate", "reconquer"
]);

/** How broken retractable-armor plates leave the match. */
export const ARMOR_DESPAWN_STYLES = Object.freeze([
  "fade", "shrink", "decimate", "buildDummy"
]);

/** Reconquer frequency multiplier relative to the baseline cadence. */
export const RECONQUER_RATE_MIN = 0.1;
export const RECONQUER_RATE_MAX = 10;

export const ARMOR_DESPAWN_TIMER_MIN = 0.1;
export const ARMOR_DESPAWN_TIMER_MAX = 120;

export function normalizeModularMorphStyle(value, legacyMechanicalShifting = false) {
  if (MODULAR_MORPH_STYLES.includes(value)) return value;
  if (legacyMechanicalShifting) return "fly";
  return DEFAULT_PROFILE.settings.visual.modularMorphStyle;
}

export function normalizeDebrisDespawnStyle(value) {
  if (DEBRIS_DESPAWN_STYLES.includes(value)) return value;
  return DEFAULT_PROFILE.settings.visual.debrisDespawnStyle;
}

export function normalizeArmorDespawnStyle(value) {
  if (ARMOR_DESPAWN_STYLES.includes(value)) return value;
  return DEFAULT_PROFILE.settings.visual.armorDespawnStyle;
}

export function normalizeReconquerRate(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_PROFILE.settings.visual.reconquerRate;
  return clamp(n, RECONQUER_RATE_MIN, RECONQUER_RATE_MAX);
}

/** Armor despawn delay in seconds, snapped to tenths. */
export function normalizeArmorDespawnTimer(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_PROFILE.settings.visual.armorDespawnTimer;
  const clamped = clamp(n, ARMOR_DESPAWN_TIMER_MIN, ARMOR_DESPAWN_TIMER_MAX);
  return Math.round(clamped * 10) / 10;
}

export function normalizeUnlockAllGearTemporary(value) {
  return value === true || value === "true" || value === 1 || value === "1";
}

export function ensureSettingsProfile(profile, saved = profile) {
  const defaults = DEFAULT_PROFILE.settings.visual;
  const visual = { ...defaults, ...(saved?.settings?.visual || {}) };
  const developerDefaults = DEFAULT_PROFILE.settings.developer;
  const developer = { ...developerDefaults, ...(saved?.settings?.developer || {}) };
  profile.settings = {
    visual: {
      modularMorphStyle: normalizeModularMorphStyle(
        visual.modularMorphStyle,
        !!visual.mechanicalShifting
      ),
      debrisDespawnStyle: normalizeDebrisDespawnStyle(visual.debrisDespawnStyle),
      reconquerRate: normalizeReconquerRate(visual.reconquerRate),
      armorDespawnStyle: normalizeArmorDespawnStyle(visual.armorDespawnStyle),
      armorDespawnTimer: normalizeArmorDespawnTimer(visual.armorDespawnTimer)
    },
    developer: {
      unlockAllGearTemporary: normalizeUnlockAllGearTemporary(
        developer.unlockAllGearTemporary
      )
    }
  };
  return profile.settings;
}

export function cloneSettings(settings) {
  return {
    visual: {
      modularMorphStyle: normalizeModularMorphStyle(
        settings?.visual?.modularMorphStyle,
        !!settings?.visual?.mechanicalShifting
      ),
      debrisDespawnStyle: normalizeDebrisDespawnStyle(
        settings?.visual?.debrisDespawnStyle
      ),
      reconquerRate: normalizeReconquerRate(settings?.visual?.reconquerRate),
      armorDespawnStyle: normalizeArmorDespawnStyle(settings?.visual?.armorDespawnStyle),
      armorDespawnTimer: normalizeArmorDespawnTimer(settings?.visual?.armorDespawnTimer)
    },
    developer: {
      unlockAllGearTemporary: normalizeUnlockAllGearTemporary(
        settings?.developer?.unlockAllGearTemporary
      )
    }
  };
}
