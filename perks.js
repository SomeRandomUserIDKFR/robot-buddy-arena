/**
 * Perk catalog, Conquest EXP progression, unlock picks, and buddy perk autonomy.
 * Perks are mostly tradeoffs; modifiers flow through the loadout/stats pipeline.
 */

const perk = (id, name, tradeoff, modifiers) => ({ id, name, tradeoff, modifiers });

/** Starter pool: shared for You and Buddy (equip one unlocked perk each). */
export const PERKS = [
  perk("glass-sprint", "Glass Sprint",
    "Faster move, lower max HP.",
    { speed: 1.12, hp: .88 }),
  perk("bastion-brace", "Bastion Brace",
    "More shield durability, slower while raised.",
    { shieldDurability: 1.28, shieldRaisedSpeed: .82 }),
  perk("deep-tank", "Deep Tank",
    "Longer jet fuel, slower recharge.",
    { fuel: 1.28, recharge: .78 }),
  perk("heavy-trigger", "Heavy Trigger",
    "Slightly more weapon damage, slower fire / swing rate.",
    { damage: 1.12, fireRate: .88 }),
  perk("ghost-step", "Ghost Step",
    "Better dodge i-frames, longer dodge cooldown.",
    { iframe: 1.22, dodgeCooldown: 1.28 }),
  perk("wide-lens", "Wide Lens",
    "Wider vision, slightly less HP.",
    { sight: 1.18, hp: .94 }),
  perk("cyber-broker", "Cyber Broker",
    "+20% Cyber after Conquest wins, but you take more damage.",
    { cyberWinBonus: 1.2, damageTaken: 1.1 }),
  perk("overdrive-jets", "Overdrive Jets",
    "Harder thrust, smaller fuel tank.",
    { thrust: 1.16, fuel: .86 }),
  perk("hardened-shell", "Hardened Shell",
    "More HP, slower move.",
    { hp: 1.1, speed: .9 }),
  perk("quick-clip", "Quick Clip",
    "Faster fire / swing, lighter hits.",
    { fireRate: 1.14, damage: .9 }),
  perk("slipstream", "Slipstream",
    "Shorter dodge cooldown, slightly less HP.",
    { dodgeCooldown: .84, hp: .92 }),
  perk("anchor-brace", "Anchor Brace",
    "Take less damage, move slower.",
    { damageTaken: .9, speed: .92 })
];

export const PERKS_BY_ID = Object.fromEntries(PERKS.map((entry) => [entry.id, entry]));

/** EXP from Conquest wins by trainer tier (Training never grants EXP). */
export const CONQUEST_EXP = Object.freeze({ rookie: 40, veteran: 70, elite: 110 });

/** Level 1→2 target; each later level multiplies by EXP_SCALE. */
export const EXP_BASE = 100;
export const EXP_SCALE = 1.3;

export const PERK_AUTONOMY_MODES = Object.freeze(["user", "suggested", "choice"]);

export function expRequiredForLevel(level) {
  const safe = Math.max(1, Math.floor(Number(level) || 1));
  return Math.round(EXP_BASE * EXP_SCALE ** (safe - 1));
}

export function getPerk(id) {
  return PERKS_BY_ID[id] || null;
}

export function isPerkUnlocked(profile, perkId) {
  return Array.isArray(profile?.unlockedPerks) && profile.unlockedPerks.includes(perkId);
}

export function normalizeEquippedPerk(perkId, unlocked = []) {
  return typeof perkId === "string" && unlocked.includes(perkId) && PERKS_BY_ID[perkId]
    ? perkId
    : null;
}

function sanitizeUnlocked(list) {
  return Array.from(new Set(
    (Array.isArray(list) ? list : []).filter((id) => typeof id === "string" && PERKS_BY_ID[id])
  ));
}

function sanitizePendingPicks(list, unlocked) {
  const unlockedSet = new Set(unlocked);
  if (!Array.isArray(list)) return [];
  return list.slice(0, 8).map((pick, index) => {
    const choices = Array.from(new Set(
      (Array.isArray(pick?.choices) ? pick.choices : [])
        .filter((id) => PERKS_BY_ID[id] && !unlockedSet.has(id))
    )).slice(0, 3);
    if (choices.length < 1) return null;
    return {
      id: typeof pick?.id === "string" && pick.id ? pick.id : `pending-${index}`,
      choices
    };
  }).filter(Boolean);
}

export function ensureProgressionProfile(profile, saved = profile) {
  const rawLevel = Number(saved?.level);
  profile.level = Number.isInteger(rawLevel) && rawLevel >= 1 ? Math.min(rawLevel, 99) : 1;
  const rawExp = Number(saved?.exp);
  profile.exp = Number.isFinite(rawExp) && rawExp >= 0 ? Math.floor(rawExp) : 0;
  profile.unlockedPerks = sanitizeUnlocked(saved?.unlockedPerks);
  profile.pendingPerkPicks = sanitizePendingPicks(saved?.pendingPerkPicks, profile.unlockedPerks);
  profile.expToNext = expRequiredForLevel(profile.level);
  if (profile.exp >= profile.expToNext) {
    // Cap overflow until grantExp runs; keep bar sane on load.
    profile.exp = Math.min(profile.exp, profile.expToNext - 1);
  }

  const autonomy = saved?.buddyPerkAutonomy ?? saved?.equipment?.buddyPerkAutonomy;
  profile.buddyPerkAutonomy = PERK_AUTONOMY_MODES.includes(autonomy) ? autonomy : "user";
  profile.perkSuggestion = null;

  if (!profile.equipment) profile.equipment = {};
  for (const owner of ["player", "buddy"]) {
    if (!profile.equipment[owner]) profile.equipment[owner] = {};
    const raw = saved?.equipment?.[owner]?.perk;
    profile.equipment[owner].perk = normalizeEquippedPerk(raw, profile.unlockedPerks);
  }
  return profile;
}

export function rollPerkChoices(unlocked = [], count = 3, random = Math.random) {
  const pool = PERKS.map((entry) => entry.id).filter((id) => !unlocked.includes(id));
  const picks = [];
  const remaining = pool.slice();
  while (picks.length < count && remaining.length) {
    const index = Math.floor(random() * remaining.length);
    picks.push(remaining.splice(index, 1)[0]);
  }
  return picks;
}

function enqueuePerkPick(profile, random = Math.random) {
  const choices = rollPerkChoices(profile.unlockedPerks, 3, random);
  if (!choices.length) return null;
  const pick = {
    id: `pick-${Date.now()}-${Math.floor(random() * 1e6)}`,
    choices
  };
  profile.pendingPerkPicks.push(pick);
  profile.pendingPerkPicks = profile.pendingPerkPicks.slice(0, 8);
  return pick;
}

/**
 * Grant Conquest EXP and enqueue one 3-choice perk pick per level gained.
 * Returns { expGranted, levelsGained, pendingPicks }.
 */
export function grantExp(profile, amount, random = Math.random) {
  const granted = Math.max(0, Math.floor(Number(amount) || 0));
  if (!granted) {
    return { expGranted: 0, levelsGained: 0, pendingPicks: [] };
  }
  ensureProgressionProfile(profile, profile);
  profile.exp += granted;
  let levelsGained = 0;
  const pendingPicks = [];
  // Soft cap: avoid endless level loops from huge grants in tests.
  while (profile.exp >= profile.expToNext && levelsGained < 20) {
    profile.exp -= profile.expToNext;
    profile.level += 1;
    levelsGained += 1;
    profile.expToNext = expRequiredForLevel(profile.level);
    const pick = enqueuePerkPick(profile, random);
    if (pick) pendingPicks.push(pick);
  }
  return { expGranted: granted, levelsGained, pendingPicks };
}

export function choosePerkUnlock(profile, pickId, perkId) {
  ensureProgressionProfile(profile, profile);
  const pickIndex = profile.pendingPerkPicks.findIndex((pick) => pick.id === pickId);
  if (pickIndex < 0) return { ok: false, reason: "no-pick" };
  const pick = profile.pendingPerkPicks[pickIndex];
  if (!pick.choices.includes(perkId) || !PERKS_BY_ID[perkId]) {
    return { ok: false, reason: "invalid-choice" };
  }
  if (profile.unlockedPerks.includes(perkId)) {
    return { ok: false, reason: "already-unlocked" };
  }
  profile.unlockedPerks.push(perkId);
  profile.pendingPerkPicks.splice(pickIndex, 1);
  return { ok: true, perk: PERKS_BY_ID[perkId] };
}

export function equipPerk(profile, owner, perkId) {
  if (!["player", "buddy"].includes(owner)) return false;
  ensureProgressionProfile(profile, profile);
  if (owner === "buddy" && profile.buddyPerkAutonomy === "choice") return false;
  if (perkId == null || perkId === "" || perkId === "none") {
    profile.equipment[owner].perk = null;
    return true;
  }
  if (!isPerkUnlocked(profile, perkId)) return false;
  profile.equipment[owner].perk = perkId;
  if (owner === "buddy" && profile.buddyPerkAutonomy === "suggested" && profile.perkSuggestion) {
    profile.perkSuggestion.perkId = perkId;
  }
  return true;
}

function evidenceStyle(profile) {
  const weaponId = profile?.equipment?.player?.weapon;
  const weapon = weaponId === "arc-saber" || weaponId === "duelist-blade"
    || weaponId === "heavy-saber" || weaponId === "daggers"
    ? "saber"
    : "gun";
  const learned = profile?.weapons?.[weapon]?.habits || {};
  const range = learned.engagementRange;
  const rush = learned.rushPrediction;
  const reliableRange = (range?.samples || 0) >= 3 ? range.estimate : null;
  const reliableRush = (rush?.samples || 0) >= 3 ? rush.estimate : null;
  if (reliableRange != null && reliableRange > .58) return "ranged";
  if (reliableRush != null && reliableRush > .5) return "rusher";
  if (weapon === "saber") return "rusher";
  return "balanced";
}

const STYLE_PREFERENCES = {
  ranged: [
    "wide-lens", "heavy-trigger", "bastion-brace", "cyber-broker",
    "deep-tank", "hardened-shell", "ghost-step", "anchor-brace"
  ],
  rusher: [
    "glass-sprint", "slipstream", "ghost-step", "overdrive-jets",
    "quick-clip", "hardened-shell", "deep-tank", "anchor-brace"
  ],
  balanced: [
    "hardened-shell", "deep-tank", "bastion-brace", "cyber-broker",
    "glass-sprint", "wide-lens", "quick-clip", "ghost-step"
  ]
};

export function suggestBuddyPerk(profile) {
  ensureProgressionProfile(profile, profile);
  const unlocked = profile.unlockedPerks;
  if (!unlocked.length) {
    return {
      perkId: null,
      reason: "I have no unlocked perks yet. Win Conquest to earn picks.",
      style: "balanced"
    };
  }
  const style = evidenceStyle(profile);
  const preferred = (STYLE_PREFERENCES[style] || STYLE_PREFERENCES.balanced)
    .find((id) => unlocked.includes(id));
  const perkId = preferred || unlocked[0];
  const reason = style === "ranged"
    ? "You fight at range, so I favor awareness or steady fire. I may be wrong."
    : style === "rusher"
      ? "You close distance, so I favor mobility or dodge tradeoffs. I may be wrong."
      : "I do not have strong evidence yet, so I suggest a balanced perk.";
  return { perkId, reason, style };
}

export function setBuddyPerkAutonomy(profile, mode) {
  ensureProgressionProfile(profile, profile);
  if (!PERK_AUTONOMY_MODES.includes(mode)) return profile;
  profile.buddyPerkAutonomy = mode;
  if (mode === "suggested") {
    profile.perkSuggestion = suggestBuddyPerk(profile);
  } else if (mode === "choice") {
    const choice = suggestBuddyPerk(profile);
    profile.equipment.buddy.perk = normalizeEquippedPerk(choice.perkId, profile.unlockedPerks);
    profile.perkSuggestion = choice;
  } else {
    profile.perkSuggestion = null;
  }
  return profile;
}

export function acceptPerkSuggestion(profile) {
  const suggestion = profile.perkSuggestion;
  if (!suggestion?.perkId) return false;
  return equipPerk(profile, "buddy", suggestion.perkId);
}

/** Multiply Cyber payout by equipped economy perks (player + buddy). */
export function cyberWinMultiplier(profile) {
  let mult = 1;
  for (const owner of ["player", "buddy"]) {
    const id = profile?.equipment?.[owner]?.perk;
    const bonus = PERKS_BY_ID[id]?.modifiers?.cyberWinBonus;
    if (bonus) mult *= bonus;
  }
  return mult;
}

export function perkCombatExtras(perkId) {
  const mods = PERKS_BY_ID[perkId]?.modifiers || {};
  return {
    dodgeCooldown: mods.dodgeCooldown || 1,
    iframe: mods.iframe || 1,
    shieldDurability: mods.shieldDurability || 1,
    shieldRaisedSpeed: mods.shieldRaisedSpeed || 1,
    damage: mods.damage || 1,
    fireRate: mods.fireRate || 1
  };
}

/**
 * Apply perk numeric modifiers onto an effectiveStats-style result object.
 * Returns combat-only extras used by applyLoadout.
 */
export function applyPerkModifiersToStats(stats, perkId) {
  const mods = PERKS_BY_ID[perkId]?.modifiers;
  const extras = perkCombatExtras(perkId);
  if (!mods) return extras;
  if (mods.hp) stats.hp *= mods.hp;
  if (mods.speed) stats.speed *= mods.speed;
  if (mods.fuel) stats.fuel *= mods.fuel;
  if (mods.thrust) stats.thrust *= mods.thrust;
  if (mods.recharge) stats.recharge /= mods.recharge;
  if (mods.sight) stats.sight *= mods.sight;
  if (mods.damageTaken) stats.damageTaken *= mods.damageTaken;
  if (mods.damage || mods.fireRate) {
    stats.dps = Math.round(stats.dps * (mods.damage || 1) * (mods.fireRate || 1));
  }
  return extras;
}

export function perkTradeoffLines(perkId) {
  const entry = PERKS_BY_ID[perkId];
  if (!entry) return [];
  const names = {
    hp: "HP", speed: "Speed", fuel: "Fuel", thrust: "Thrust", recharge: "Recharge",
    sight: "Sight", damageTaken: "Damage taken", damage: "Weapon damage",
    fireRate: "Fire / swing rate", iframe: "Dodge i-frames",
    dodgeCooldown: "Dodge cooldown", shieldDurability: "Shield durability",
    shieldRaisedSpeed: "Raised shield speed", cyberWinBonus: "Cyber after wins"
  };
  return Object.entries(entry.modifiers).map(([key, value]) => {
    const percent = Math.round((value - 1) * 100);
    const sign = percent > 0 ? "+" : "";
    const beneficialDown = key === "damageTaken" || key === "dodgeCooldown";
    // dodgeCooldown down = good; raised shield speed down = downside.
    const good = key === "cyberWinBonus" || key === "iframe" || key === "shieldDurability"
      || key === "damage" || key === "fireRate" || key === "hp" || key === "speed"
      || key === "fuel" || key === "thrust" || key === "sight"
      ? percent > 0
      : beneficialDown ? percent < 0 : percent > 0;
    // Recharge mod < 1 means slower recharge (downside) in our catalog.
    if (key === "recharge") {
      const slower = value < 1;
      return {
        key, label: names[key], text: `${names[key]} ${slower ? "slower" : "faster"}`,
        good: !slower, percent
      };
    }
    return {
      key, label: names[key] || key,
      text: `${names[key] || key} ${sign}${percent}%`,
      good, percent
    };
  });
}
