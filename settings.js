import { DEFAULT_PROFILE } from "./config.js";

// Morph styles for Mechanical Modularity + Retractable Armor plate transforms.
// "nanotech" — Mark-85 style nano swarm dissolve / reform.
export const MODULAR_MORPH_STYLES = Object.freeze(["smooth", "fold", "fly", "nanotech"]);

export function normalizeModularMorphStyle(value, legacyMechanicalShifting = false) {
  if (MODULAR_MORPH_STYLES.includes(value)) return value;
  if (legacyMechanicalShifting) return "fly";
  return DEFAULT_PROFILE.settings.visual.modularMorphStyle;
}

export function ensureSettingsProfile(profile, saved = profile) {
  const defaults = DEFAULT_PROFILE.settings.visual;
  const visual = { ...defaults, ...(saved?.settings?.visual || {}) };
  profile.settings = {
    visual: {
      modularMorphStyle: normalizeModularMorphStyle(
        visual.modularMorphStyle,
        !!visual.mechanicalShifting
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
      )
    }
  };
}
