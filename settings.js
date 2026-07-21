import { DEFAULT_PROFILE } from "./config.js";
import { clamp } from "./utils.js";

// Morph styles for Mechanical Modularity + Retractable Armor plate transforms.
// "nanotech" — Mark-85 style nano swarm dissolve / reform.
export const MODULAR_MORPH_STYLES = Object.freeze(["smooth", "fold", "fly", "nanotech"]);

/** How non-armor ground debris leaves the match. */
export const DEBRIS_DESPAWN_STYLES = Object.freeze([
  "fade", "shrink", "decimate", "reconquer"
]);

/** Reconquer frequency multiplier relative to the baseline cadence. */
export const RECONQUER_RATE_MIN = 1;
export const RECONQUER_RATE_MAX = 2;

export function normalizeModularMorphStyle(value, legacyMechanicalShifting = false) {
  if (MODULAR_MORPH_STYLES.includes(value)) return value;
  if (legacyMechanicalShifting) return "fly";
  return DEFAULT_PROFILE.settings.visual.modularMorphStyle;
}

export function normalizeDebrisDespawnStyle(value) {
  if (DEBRIS_DESPAWN_STYLES.includes(value)) return value;
  return DEFAULT_PROFILE.settings.visual.debrisDespawnStyle;
}

export function normalizeReconquerRate(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_PROFILE.settings.visual.reconquerRate;
  return clamp(n, RECONQUER_RATE_MIN, RECONQUER_RATE_MAX);
}

export function ensureSettingsProfile(profile, saved = profile) {
  const defaults = DEFAULT_PROFILE.settings.visual;
  const visual = { ...defaults, ...(saved?.settings?.visual || {}) };
  profile.settings = {
    visual: {
      modularMorphStyle: normalizeModularMorphStyle(
        visual.modularMorphStyle,
        !!visual.mechanicalShifting
      ),
      debrisDespawnStyle: normalizeDebrisDespawnStyle(visual.debrisDespawnStyle),
      reconquerRate: normalizeReconquerRate(visual.reconquerRate)
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
      reconquerRate: normalizeReconquerRate(settings?.visual?.reconquerRate)
    }
  };
}
