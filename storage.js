import { DEFAULT_PROFILE, STORAGE_KEY } from "./config.js";
import { ensureCoaching } from "./coaching.js";
import {
  ensureEconomyProfile, ensureEquipmentProfile, setBuddyMode, weaponKind
} from "./equipment.js";
import {
  ensureLearningProfile, mimicUnlockLevel, normalizeAiMode, normalizeMimicIntensity
} from "./learning.js";
import { ensureProgressionProfile, setBuddyPerkAutonomy } from "./perks.js";
import { ensureSettingsProfile } from "./settings.js";

function freshDefaults() {
  return structuredClone(DEFAULT_PROFILE);
}

export function migrateProfile(saved) {
  const loaded = {
    ...freshDefaults(),
    ...(saved || {}),
    coaching: {
      ...DEFAULT_PROFILE.coaching,
      ...(saved?.coaching || {}),
      directives: Array.isArray(saved?.coaching?.directives) ? saved.coaching.directives : [],
      history: Array.isArray(saved?.coaching?.history) ? saved.coaching.history.slice(-20) : []
    },
    weapons: {
      gun: { ...DEFAULT_PROFILE.weapons.gun, ...(saved?.weapons?.gun || {}) },
      saber: { ...DEFAULT_PROFILE.weapons.saber, ...(saved?.weapons?.saber || {}) }
    }
  };
  for (const weapon of ["gun", "saber"]) {
    const old = saved?.weapons?.[weapon];
    if (old && !old.habits) {
      loaded.weapons[weapon].legacyHabits = {
        range: Number(old.range) || null,
        rush: Number(old.rush) || null,
        dodgesPerMin: Number(old.dodgesPerMin) || null,
        reactiveDodge: Number(old.reactiveDodge) || null,
        jetAggro: Number(old.jetAggro) || null,
        lowHpAggro: Number(old.lowHpAggro) || null
      };
    }
    ensureLearningProfile(loaded.weapons[weapon]);
    delete loaded.weapons[weapon].seconds;
    delete loaded.weapons[weapon].counter;
  }
  ensureEquipmentProfile(loaded, saved || {});
  ensureEconomyProfile(loaded, saved || {});
  ensureProgressionProfile(loaded, saved || {});
  ensureSettingsProfile(loaded, saved || {});
  if (loaded.equipment.buddyMode !== "user") {
    setBuddyMode(loaded, loaded.equipment.buddyMode);
  }
  if (loaded.buddyPerkAutonomy !== "user") {
    setBuddyPerkAutonomy(loaded, loaded.buddyPerkAutonomy);
  }
  ensureCoaching(loaded);
  loaded.learningLocked = !!loaded.learningLocked;
  loaded.aiMode = normalizeAiMode(loaded.aiMode);
  loaded.mimicIntensity = normalizeMimicIntensity(loaded.mimicIntensity);
  const learnedWeapon = weaponKind(loaded.equipment.player.weapon);
  const learned = loaded.weapons[learnedWeapon] || loaded.weapons.gun;
  if (loaded.aiMode === "mimic" && mimicUnlockLevel(learned) === "locked") {
    loaded.aiMode = "balanced";
  }
  if (loaded.mimicIntensity === "full" && mimicUnlockLevel(learned) !== "full") {
    loaded.mimicIntensity = "quite";
  }
  return loaded;
}

function loadProfile() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!saved) return freshDefaults();
    return migrateProfile(saved);
  } catch {
    return freshDefaults();
  }
}

export const profile = loadProfile();
ensureCoaching(profile);
ensureEquipmentProfile(profile, profile);
ensureEconomyProfile(profile, profile);
ensureProgressionProfile(profile, profile);

export function saveProfile() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
}
