import { spawnBrokenArmorDebris } from "./debris.js";
import { angleDiff } from "./utils.js";
import {
  applyPerkModifiersToStats, CONQUEST_EXP, cyberWinMultiplier, ensureProgressionProfile,
  grantExp, normalizeEquippedPerk, perkCombatExtras
} from "./perks.js";

const item = (id, slot, name, tradeoff, modifiers = {}, extra = {}) => ({
  id, slot, name, tradeoff, modifiers, ...extra
});

const gun = (id, name, tradeoff, stats, price, extra = {}) => item(
  id, "weapon", name, tradeoff,
  {
    damage: stats.baseDamage / 12,
    fireRate: stats.rpm / 500,
    range: stats.range / 1317.5,
    projectileSpeed: stats.projectileSpeed / 1550
  },
  {
    baseKind: "gun",
    dps: stats.baseDamage * stats.rpm / 60,
    weaponStats: { kind: "gun", ...stats },
    ...(price ? { price } : {}),
    ...extra
  }
);

const melee = (id, name, tradeoff, stats, price, extra = {}) => item(
  id, "weapon", name, tradeoff,
  {
    damage: stats.baseDamage / 40,
    fireRate: stats.rpm / 150,
    range: stats.range / 120
  },
  {
    baseKind: "saber",
    dps: stats.baseDamage * stats.rpm / 60,
    weaponStats: {
      kind: "melee", projectileSpeed: 0, dropoff: null, cameraLead: 0,
      sightExtension: 0, aimSettle: 0, unsettledSpread: 0,
      movementMultiplier: 1.1, iframeMultiplier: 1,
      ...stats
    },
    ...(price ? { price } : {}),
    ...extra
  }
);

const shield = (id, name, tradeoff, stats, price) => item(
  id, "shield", name, tradeoff, {},
  {
    durability: stats.durability,
    blockHalfAngle: stats.blockHalfAngle,
    raisedSpeed: stats.raisedSpeed,
    brokenSpeed: stats.brokenSpeed,
    ...(price != null ? { price } : {})
  }
);

export const SLOT_ORDER = ["body", "helmet", "weapon", "jetpack", "shield"];
export const SLOT_LABELS = {
  body: "Main Armor",
  helmet: "Helmet",
  weapon: "Weapon",
  jetpack: "Jetpack",
  shield: "Shield"
};

export const GEAR = [
  item("field-frame", "body", "Field Frame", "Balanced protection and mobility.", {}),
  item("scout-frame", "body", "Scout Frame", "Faster, but lighter and more exposed.",
    { hp: .88, speed: 1.12, damageTaken: 1.08 }),
  item("bulwark-frame", "body", "Bulwark Frame", "Tough and stable, but slower.",
    { hp: 1.18, speed: .86, damageTaken: .92 }, { price: 110 }),
  item("reactive-frame", "body", "Reactive Frame", "Deflects hits, but sacrifices integrity.",
    { hp: .9, speed: 1.04, damageTaken: .84 }, { price: 145 }),
  // F deploys/retracts a separate HP pool (+120). Deployed: ~10% slower. Visual uses modular plates.
  item(
    "retractable-armor",
    "body",
    "Retractable Armor",
    "F deploys folding plates: +120 armor HP while on, ~10% slower. Pool is separate; Protective Rebuilding can refill it mid-match.",
    {},
    { price: 130, retractableArmor: { hp: 120 } }
  ),

  item("survey-visor", "helmet", "Survey Visor", "Balanced armor and sensor range.", {}),
  item("wideband-array", "helmet", "Wideband Array", "More awareness, slightly less integrity.",
    { hp: .95, sight: 1.15 }),
  item("guard-helm", "helmet", "Guard Helm", "Extra integrity, narrower awareness.",
    { hp: 1.08, sight: .88 }, { price: 85 }),
  item("hunter-optics", "helmet", "Hunter Optics", "Long-range sensors with a fragile shell.",
    { hp: .9, sight: 1.28 }, { price: 135 }),

  gun("pulse-rifle", "Pulse Rifle", "Reliable 100 DPS ranged fire and reach.", {
    baseDamage: 12, rpm: 500, range: 1317.5, projectileSpeed: 1550,
    dropoff: { start: 300, end: 1200, minMultiplier: 10 / 12 },
    aimSettle: 0, unsettledSpread: 0, cameraLead: .08, sightExtension: 0,
    movementMultiplier: 1, iframeMultiplier: 1
  }),
  melee("arc-saber", "Arc Saber", "55 damage at 150 RPM (137.5 DPS); +10% base speed.", {
    baseDamage: 55, rpm: 150, range: 120
  }),
  // Featured early in the shop weapon row (2 cards visible); was buried at the end.
  // Hybrid morph weapon: default catalog/loadout stats match Arc Saber (sword mode).
  // Active mode (sword / shield / rifle) drives combat + learning via fighter.weapon.
  item(
    "mechanical-modularity",
    "weapon",
    "Mechanical Modularity",
    "E morphs Sword ↔ Shield ↔ Pulse Rifle. Sword matches Arc Saber; rifle & modular plate are slightly weaker. Learning uses the active mode's gun/saber key.",
    {
      damage: 55 / 40,
      fireRate: 150 / 150,
      range: 120 / 120
    },
    {
      baseKind: "saber",
      dps: 55 * 150 / 60,
      modular: true,
      price: 210,
      weaponStats: {
        kind: "melee", projectileSpeed: 0, dropoff: null, cameraLead: 0,
        sightExtension: 0, aimSettle: 0, unsettledSpread: 0,
        movementMultiplier: 1.1, iframeMultiplier: 1,
        baseDamage: 55, rpm: 150, range: 120
      }
    }
  ),
  gun("burst-carbine", "Burst Carbine", "Fast 108 DPS fire; shorter reach and lighter hits.", {
    baseDamage: 9.36, rpm: 690, range: 1118, projectileSpeed: 1426,
    dropoff: { start: 300, end: 1200, minMultiplier: 10 / 12 },
    aimSettle: 0, unsettledSpread: .025, cameraLead: .06, sightExtension: 0,
    movementMultiplier: 1, iframeMultiplier: 1
  }, 100),
  melee("duelist-blade", "Duelist Blade", "36 damage at 217.5 RPM (130.5 DPS); short, quick, +10% speed.", {
    baseDamage: 36, rpm: 217.5, range: 106
  }, 100),
  gun("marksman-rifle", "Marksman Rifle", "18.6 damage at 290 RPM (89.9 DPS); faster, longer shots.", {
    baseDamage: 18.6, rpm: 290, range: 1909, projectileSpeed: 2092,
    dropoff: { start: 435, end: 1740, minMultiplier: 10 / 12 },
    aimSettle: .12, unsettledSpread: .045, cameraLead: .15, sightExtension: 0,
    movementMultiplier: 1, iframeMultiplier: 1
  }, 155),
  melee("heavy-saber", "Heavy Saber", "85 damage at 93 RPM (131.8 DPS); long, slow, +10% speed.", {
    baseDamage: 85, rpm: 93, range: 142
  }, 155),
  gun("quick-fire-sniper", "Quick-Fire Sniper", "100 damage at 60 RPM. Settle aim 0.35s; inaccurate from the hip.", {
    baseDamage: 100, rpm: 60, range: 2300, projectileSpeed: 3000,
    dropoff: null, aimSettle: .35, unsettledSpread: .35, cameraLead: .32,
    sightExtension: 1480, sightHalfAngle: .18, movementMultiplier: 1,
    iframeMultiplier: 1, tracer: true
  }, 160),
  gun("classic-sniper", "Classic Sniper", "180 damage at 30 RPM. Settle aim 0.45s; inaccurate from the hip.", {
    baseDamage: 180, rpm: 30, range: 2450, projectileSpeed: 3200,
    dropoff: null, aimSettle: .45, unsettledSpread: .42, cameraLead: .35,
    sightExtension: 1580, sightHalfAngle: .17, movementMultiplier: 1,
    iframeMultiplier: 1, tracer: true
  }, 190),
  gun("strong-sniper", "Strong Sniper", "250 damage at 20 RPM. Settle aim 0.55s; heaviest hip-fire penalty.", {
    baseDamage: 250, rpm: 20, range: 2600, projectileSpeed: 3400,
    dropoff: null, aimSettle: .55, unsettledSpread: .5, cameraLead: .38,
    sightExtension: 1680, sightHalfAngle: .16, movementMultiplier: 1,
    iframeMultiplier: 1, tracer: true
  }, 220),
  // Next-gen sidegrades: volume hose vs perfect hitscan beam (gun family learning).
  gun("gattler", "Gattler", "4 dmg hose at 1380 RPM (92 DPS); short spray, shreds shields 1.35×.", {
    baseDamage: 4, rpm: 1380, range: 960, projectileSpeed: 1180,
    dropoff: { start: 180, end: 780, minMultiplier: .72 },
    aimSettle: 0, unsettledSpread: .055, cameraLead: .05, sightExtension: 0,
    movementMultiplier: 1, iframeMultiplier: 1, tracer: true, shieldDamageMult: 1.35
  }, 175),
  gun("laser", "Laser", "2 dmg hitscan ticks at 3150 RPM (105 DPS); no spread/dropoff; beam reveals sight.", {
    baseDamage: 2, rpm: 3150, range: 1720, projectileSpeed: 1550,
    dropoff: null, aimSettle: 0, unsettledSpread: 0, cameraLead: .1, sightExtension: 0,
    movementMultiplier: 1, iframeMultiplier: 1, hitscan: true, beamRevealRadius: 56
  }, 185),
  melee("daggers", "Daggers", "24 damage at 300 RPM (120 DPS); very short reach, +25% speed and dodge i-frames.", {
    baseDamage: 24, rpm: 300, range: 64, movementMultiplier: 1.25,
    iframeMultiplier: 1.25
  }, 135),

  // Nanotech: counterpart weapon stats; shared bot pool. Weapons need free bots ≥ cost to fire.
  melee("nanotech-sword", "Nanotech Sword", "Arc Saber. E forms from bots (partial OK). Incomplete swings bleed 2% bots.", {
    baseDamage: 55, rpm: 150, range: 120
  }, 100, { nanotech: true, nanobotCost: 100 }),
  gun("nanotech-rifle", "Nanotech Rifle", "Pulse Rifle. E forms from bots; damage scales with form %.", {
    baseDamage: 12, rpm: 500, range: 1317.5, projectileSpeed: 1550,
    dropoff: { start: 300, end: 1200, minMultiplier: 10 / 12 },
    aimSettle: 0, unsettledSpread: 0, cameraLead: .08, sightExtension: 0,
    movementMultiplier: 1, iframeMultiplier: 1
  }, 150, { nanotech: true, nanobotCost: 150 }),
  gun("nanotech-sniper", "Nanotech Sniper", "Classic Sniper. E forms from bots; damage scales with form %.", {
    baseDamage: 180, rpm: 30, range: 2450, projectileSpeed: 3200,
    dropoff: null, aimSettle: .45, unsettledSpread: .42, cameraLead: .35,
    sightExtension: 1580, sightHalfAngle: .17, movementMultiplier: 1,
    iframeMultiplier: 1, tracer: true
  }, 175, { nanotech: true, nanobotCost: 175 }),
  item(
    "nanotech-chestplate",
    "body",
    "Nanotech Chestplate",
    "Hold F: loan reserve bots into armor (2 bots = 1 HP, cap 250). Release F to return bots. 10% less damage taken.",
    { damageTaken: 0.9 },
    { price: 500, nanotech: true, nanobotCost: 500 }
  ),
  item(
    "nanotech-reserve",
    "jetpack",
    "Nanotech Reserve",
    "Huge shared bot tank for nanotech gear. 5% slower. Fuel/thrust unchanged.",
    { speed: 0.95 },
    { price: 1000, nanotech: true, nanobotCost: 1000 }
  ),

  item("vector-pack", "jetpack", "Vector Pack", "Balanced fuel, thrust, and recharge.", {}),
  item("sprinter-pack", "jetpack", "Sprinter Pack", "Hard thrust, smaller tank.",
    { fuel: .82, thrust: 1.2, recharge: 1.08 }),
  item("endurance-pack", "jetpack", "Endurance Pack", "Long burn, gentler lift and recharge.",
    { fuel: 1.3, thrust: .88, recharge: .84 }, { price: 95 }),
  item("recycler-pack", "jetpack", "Recycler Pack", "Rapid recharge, but less fuel and lift.",
    { fuel: .88, thrust: .92, recharge: 1.35 }, { price: 125 }),

  // Shields: per-match block HP vs ~500 HP / ~100 DPS weapons. Heavier = more
  // block pool, narrower cone, and harsher raised/broken speed penalties.
  shield("no-shield", "No Shield", "Hands free — no blocking, no weight.", {
    durability: 0, blockHalfAngle: 0, raisedSpeed: 1, brokenSpeed: 1
  }),
  shield("light-buckler", "Light Buckler", "175 block HP; wide arc; light raised/broken drag.", {
    durability: 175, blockHalfAngle: 1.4, raisedSpeed: .95, brokenSpeed: .9
  }),
  shield("kinetic-targe", "Kinetic Targe", "320 block HP; solid midweight cover.", {
    durability: 320, blockHalfAngle: 1.31, raisedSpeed: .9, brokenSpeed: .82
  }, 95),
  shield("bastion-bulwark", "Bastion Bulwark", "500 block HP; heavy; slows hard when raised or broken.", {
    durability: 500, blockHalfAngle: 1.22, raisedSpeed: .82, brokenSpeed: .7
  }, 155),
  // Shield-slot retractable: no frontal block cone — F toggles the same armor system as body retractable.
  item(
    "retractable-shell",
    "shield",
    "Retractable Shell",
    "F deploys folding plates: +100 armor HP while on, ~10% slower. Not a block shield — armor HP only. Can pair with Retractable Armor (one toggle, uses the higher pool).",
    {},
    {
      price: 115,
      durability: 0,
      blockHalfAngle: 0,
      raisedSpeed: 1,
      brokenSpeed: 1,
      retractableArmor: { hp: 100 }
    }
  )
];

/** Deployed retractable armor move-speed multiplier. */
export const RETRACTABLE_ARMOR_SPEED = 0.9;
export const RETRACTABLE_MORPH_DURATION = 0.32;

/** Nanotech bot pool: hold F loans free→armor; release returns armor→free. */
export const NANOTECH_CHANNEL_RATE = 520;
export const NANOTECH_RECALL_RATE = 580;
export const NANOTECH_SLOW_REGEN = 55;
export const NANOTECH_BOTS_PER_HP = 2;
export const NANOTECH_ARMOR_BOT_CAP = 500;
/** Snap Mark-85 style assemble when channeling starts from empty. */
export const NANOTECH_ARMOR_SPAWN_DURATION = 0.22;
/** Sword melts when free bots drop below conjure cost / reforms when reserve returns. */
export const NANOTECH_SWORD_DISSOLVE_DURATION = 0.18;
export const NANOTECH_SWORD_REFORM_DURATION = 0.2;

export const GEAR_BY_ID = Object.fromEntries(GEAR.map((gear) => [gear.id, gear]));
export const STARTER_GEAR = [
  "field-frame", "scout-frame", "survey-visor", "wideband-array",
  "pulse-rifle", "arc-saber", "vector-pack", "sprinter-pack",
  "no-shield", "light-buckler"
];
export const DEFAULT_LOADOUT = {
  body: "field-frame",
  helmet: "survey-visor",
  weapon: "pulse-rifle",
  jetpack: "vector-pack",
  shield: "no-shield"
};
export const STARTING_CYBER = 120;
export const STARTING_RANKING = 100;
export const RANKING_FLOOR = 0;
export const CONQUEST_REWARDS = { rookie: 35, veteran: 60, elite: 90 };
export { CONQUEST_EXP };

/** Conquest win ranking gain at the current rank (before applying the win). */
export function rankingWinGain(ranking) {
  const r = Number.isFinite(Number(ranking)) ? Number(ranking) : STARTING_RANKING;
  return Math.ceil(100 + (r - 100) * 0.5);
}

/** Conquest loss: ceil(25% of the win gain you would have earned at this rank). */
export function rankingLossAmount(ranking) {
  return Math.ceil(rankingWinGain(ranking) * 0.25);
}

export function weaponKind(gearOrId) {
  const gear = typeof gearOrId === "string" ? GEAR_BY_ID[gearOrId] : gearOrId;
  return gear?.baseKind || gear?.weaponType || "gun";
}

/** Morph order for Mechanical Modularity (E cycles). */
export const MODULAR_MODE_ORDER = Object.freeze(["sword", "shield", "rifle"]);
export const MODULAR_MORPH_DURATION = 0.32;
export const MODULAR_MODE_COOLDOWN = 0.42;
export const MODULAR_WEAPON_ID = "mechanical-modularity";

/**
 * Per-mode combat + visual targets.
 * Sword ≈ Arc Saber. Rifle ≈ 92% Pulse Rifle. Shield plate < Light Buckler.
 */
export const MODULAR_MODE_DEFS = Object.freeze({
  sword: Object.freeze({
    baseKind: "saber",
    modifiers: { damage: 55 / 40, fireRate: 1, range: 1 },
    weaponStats: Object.freeze({
      kind: "melee", projectileSpeed: 0, dropoff: null, cameraLead: 0,
      sightExtension: 0, aimSettle: 0, unsettledSpread: 0,
      movementMultiplier: 1.1, iframeMultiplier: 1,
      baseDamage: 55, rpm: 150, range: 120
    }),
    visual: Object.freeze({
      length: 48, width: 5, gripOffset: 17,
      ally: "#70f3ff", enemy: "#ff8279", buddy: "#4df2ff"
    })
  }),
  shield: Object.freeze({
    baseKind: "saber",
    modifiers: { damage: 0, fireRate: 1, range: 1 },
    weaponStats: Object.freeze({
      kind: "melee", projectileSpeed: 0, dropoff: null, cameraLead: 0,
      sightExtension: 0, aimSettle: 0, unsettledSpread: 0,
      movementMultiplier: 1, iframeMultiplier: 1,
      baseDamage: 0, rpm: 60, range: 40
    }),
    // Slightly weaker than Light Buckler (175 / 1.4 / .95 / .9).
    shield: Object.freeze({
      durability: 150, blockHalfAngle: 1.28, raisedSpeed: .9, brokenSpeed: .85
    }),
    visual: Object.freeze({
      length: 18, width: 28, gripOffset: 12,
      ally: "#8aa4b0", enemy: "#b08878", buddy: "#7eb8c4"
    })
  }),
  rifle: Object.freeze({
    baseKind: "gun",
    modifiers: {
      damage: 11.5 / 12,
      fireRate: 480 / 500,
      range: 1250 / 1317.5,
      projectileSpeed: 1480 / 1550
    },
    weaponStats: Object.freeze({
      kind: "gun",
      baseDamage: 11.5, rpm: 480, range: 1250, projectileSpeed: 1480,
      dropoff: Object.freeze({ start: 300, end: 1200, minMultiplier: 10 / 12 }),
      aimSettle: 0, unsettledSpread: 0.008, cameraLead: .08, sightExtension: 0,
      movementMultiplier: 1, iframeMultiplier: 1
    }),
    visual: Object.freeze({
      length: 32, width: 10, gripOffset: 18,
      ally: "#6a8f9c", enemy: "#8a655c", buddy: "#5aa8b4"
    })
  })
});

export function isModularWeapon(fighterOrId) {
  if (typeof fighterOrId === "string") return fighterOrId === MODULAR_WEAPON_ID;
  return fighterOrId?.weaponId === MODULAR_WEAPON_ID || fighterOrId?.modularWeapon === true;
}

export function nextModularMode(mode) {
  const idx = MODULAR_MODE_ORDER.indexOf(mode);
  return MODULAR_MODE_ORDER[(idx + 1) % MODULAR_MODE_ORDER.length];
}

function snapshotDedicatedShield(fighter) {
  return {
    shieldId: fighter.shieldId,
    shieldMaxDurability: fighter.shieldMaxDurability,
    shieldDurability: fighter.shieldDurability,
    shieldBlockHalfAngle: fighter.shieldBlockHalfAngle,
    shieldRaisedSpeed: fighter.shieldRaisedSpeed,
    shieldBrokenSpeed: fighter.shieldBrokenSpeed,
    shieldRaised: fighter.shieldRaised,
    shieldBroken: fighter.shieldBroken
  };
}

function restoreDedicatedShield(fighter, snap) {
  if (!snap) return;
  fighter.shieldId = snap.shieldId;
  fighter.shieldMaxDurability = snap.shieldMaxDurability;
  fighter.shieldDurability = snap.shieldDurability;
  fighter.shieldBlockHalfAngle = snap.shieldBlockHalfAngle;
  fighter.shieldRaisedSpeed = snap.shieldRaisedSpeed;
  fighter.shieldBrokenSpeed = snap.shieldBrokenSpeed;
  fighter.shieldRaised = !!snap.shieldRaised && !snap.shieldBroken;
  fighter.shieldBroken = !!snap.shieldBroken;
}

function applyModularPlateAsShield(fighter) {
  const plate = MODULAR_MODE_DEFS.shield.shield;
  fighter.shieldId = `${MODULAR_WEAPON_ID}-plate`;
  fighter.shieldMaxDurability = fighter.modularPlateMax;
  fighter.shieldDurability = fighter.modularPlateDurability;
  fighter.shieldBlockHalfAngle = plate.blockHalfAngle;
  fighter.shieldRaisedSpeed = plate.raisedSpeed * (fighter._modularShieldRaisedPerk || 1);
  fighter.shieldBrokenSpeed = plate.brokenSpeed;
  fighter.shieldBroken = !!fighter.modularPlateBroken
    || fighter.modularPlateDurability <= 0;
  fighter.shieldRaised = false;
}

/**
 * Apply combat stats for the active modular mode (HP / dedicated plate pool preserved).
 */
export function applyModularCombatStats(fighter, mode = fighter.modularMode) {
  const def = MODULAR_MODE_DEFS[mode] || MODULAR_MODE_DEFS.sword;
  const perkCombat = fighter._modularPerkCombat || {
    damage: 1, fireRate: 1, iframe: 1, shieldDurability: 1, shieldRaisedSpeed: 1
  };
  fighter.modularMode = mode;
  fighter.weapon = def.baseKind;
  fighter.weaponStats = { ...def.weaponStats };
  if (def.weaponStats.dropoff) {
    fighter.weaponStats.dropoff = { ...def.weaponStats.dropoff };
  }
  fighter.weaponDamage = (def.modifiers.damage || 0) * perkCombat.damage;
  fighter.weaponFireRate = (def.modifiers.fireRate || 1) * perkCombat.fireRate;
  fighter.weaponRange = def.modifiers.range || 1;
  fighter.projectileSpeed = def.modifiers.projectileSpeed || 1;
  fighter.weaponBaseDamage = def.weaponStats.baseDamage * perkCombat.damage;
  fighter.weaponRpm = Math.max(1, def.weaponStats.rpm * perkCombat.fireRate);
  fighter.weaponReach = def.weaponStats.range;
  fighter.weaponDropoff = def.weaponStats.dropoff
    ? { ...def.weaponStats.dropoff }
    : null;
  fighter.aimSettleRequired = def.weaponStats.aimSettle || 0;
  fighter.unsettledSpread = def.weaponStats.unsettledSpread || 0;
  fighter.cameraLead = def.weaponStats.cameraLead || 0;
  fighter.iframeMultiplier = (def.weaponStats.iframeMultiplier || 1) * perkCombat.iframe;
  fighter.directionalSightRange = Math.min(
    2400,
    def.weaponStats.range,
    fighter.sight + (def.weaponStats.sightExtension || 0)
  );
  fighter.sightHalfAngle = def.weaponStats.sightHalfAngle || 0;
  const baseSpeed = fighter._modularBaseMoveSpeed || 520;
  const moveMult = def.weaponStats.movementMultiplier || 1;
  fighter.moveSpeed = Math.min(520 * 1.4, Math.round(baseSpeed * moveMult));
  fighter.acceleration = 1800 * (fighter.moveSpeed / 520);
  return fighter;
}

function finishModularMorph(fighter) {
  const from = fighter.modularMorphFrom || fighter.modularMode;
  const to = fighter.modularMorphTo || fighter.modularMode;
  // Persist plate durability when leaving shield mode.
  if (from === "shield" && to !== "shield") {
    fighter.modularPlateDurability = fighter.shieldDurability;
    fighter.modularPlateBroken = !!fighter.shieldBroken
      || fighter.modularPlateDurability <= 0;
    restoreDedicatedShield(fighter, fighter._dedicatedShieldSnap);
    fighter._dedicatedShieldSnap = null;
  }
  if (to === "shield" && from !== "shield") {
    fighter._dedicatedShieldSnap = snapshotDedicatedShield(fighter);
    applyModularPlateAsShield(fighter);
  }
  applyModularCombatStats(fighter, to);
  fighter.modularMorphing = false;
  fighter.modularMorphT = 1;
  fighter.modularModeCd = MODULAR_MODE_COOLDOWN;
  fighter.shieldRaised = false;
}

/**
 * Begin a morph to `targetMode` (or the next mode in the cycle). Returns false if locked.
 */
export function beginModularMorph(fighter, targetMode = null) {
  if (!isModularWeapon(fighter) || fighter.dead) return false;
  if (fighter.modularMorphing) return false;
  if ((fighter.modularModeCd || 0) > 0) return false;
  const next = targetMode && MODULAR_MODE_DEFS[targetMode]
    ? targetMode
    : nextModularMode(fighter.modularMode || "sword");
  if (next === fighter.modularMode) return false;
  fighter.modularMorphFrom = fighter.modularMode || "sword";
  fighter.modularMorphTo = next;
  fighter.modularMorphT = 0;
  fighter.modularMorphing = true;
  fighter.shieldRaised = false;
  fighter.attackCd = Math.max(fighter.attackCd || 0, MODULAR_MORPH_DURATION);
  return true;
}

export function cycleModularMode(fighter) {
  return beginModularMorph(fighter, null);
}

/** Advance morph animation / cooldowns. Call from stepFighter. */
export function tickModularWeapon(fighter, dt) {
  if (!isModularWeapon(fighter)) return;
  if ((fighter.modularModeCd || 0) > 0) {
    fighter.modularModeCd = Math.max(0, fighter.modularModeCd - dt);
  }
  if (!fighter.modularMorphing) return;
  const duration = MODULAR_MORPH_DURATION;
  fighter.modularMorphT = Math.min(1, (fighter.modularMorphT || 0) + dt / duration);
  if (fighter.modularMorphT >= 1) finishModularMorph(fighter);
}

/** True while transforming — no attacks. */
export function modularAttackLocked(fighter) {
  return isModularWeapon(fighter)
    && (!!fighter.modularMorphing || fighter.modularMode === "shield");
}

/** Marksman / sniper IDs that can earn and use the tiny precision-aim gimmick. */
export const PRECISION_AIM_WEAPONS = Object.freeze([
  "marksman-rifle",
  "quick-fire-sniper",
  "classic-sniper",
  "nanotech-sniper",
  "strong-sniper"
]);

export function isPrecisionAimWeapon(gearOrId) {
  const id = typeof gearOrId === "string" ? gearOrId : gearOrId?.id;
  return PRECISION_AIM_WEAPONS.includes(id);
}

export function weaponStats(gearOrId) {
  const gear = typeof gearOrId === "string" ? GEAR_BY_ID[gearOrId] : gearOrId;
  return gear?.weaponStats || GEAR_BY_ID["pulse-rifle"].weaponStats;
}

export function theoreticalDps(gearOrId) {
  const stats = weaponStats(gearOrId);
  return stats.baseDamage * stats.rpm / 60;
}

export function shieldStats(gearOrId) {
  const gear = typeof gearOrId === "string" ? GEAR_BY_ID[gearOrId] : gearOrId;
  const fallback = GEAR_BY_ID["no-shield"];
  if (!gear || gear.slot !== "shield") {
    return {
      durability: fallback.durability,
      blockHalfAngle: fallback.blockHalfAngle,
      raisedSpeed: fallback.raisedSpeed,
      brokenSpeed: fallback.brokenSpeed
    };
  }
  return {
    durability: gear.durability || 0,
    blockHalfAngle: gear.blockHalfAngle || 0,
    raisedSpeed: gear.raisedSpeed ?? 1,
    brokenSpeed: gear.brokenSpeed ?? 1
  };
}

export function hasUsableShield(fighter) {
  return (fighter?.shieldMaxDurability || 0) > 0 && !fighter.shieldBroken;
}

export function shieldSpeedMultiplier(fighter) {
  if (!(fighter?.shieldMaxDurability > 0)) return 1;
  if (fighter.shieldBroken) return fighter.shieldBrokenSpeed ?? .85;
  if (fighter.shieldRaised) return fighter.shieldRaisedSpeed ?? .92;
  return 1;
}

/** True when a raised intact shield faces the incoming attack direction. */
export function shieldBlocksAttack(fighter, attackAngle) {
  if (!fighter?.shieldRaised || fighter.shieldBroken) return false;
  if (!(fighter.shieldMaxDurability > 0) || !(fighter.shieldDurability > 0)) return false;
  const half = fighter.shieldBlockHalfAngle || 0;
  if (half <= 0) return false;
  // Attack travel angle π opposite aim = frontal hit against the shield face.
  return Math.abs(angleDiff(attackAngle, fighter.aim + Math.PI)) <= half;
}

export function toggleShieldRaise(fighter) {
  if (!(fighter?.shieldMaxDurability > 0) || fighter.dead) return false;
  if (fighter.shieldBroken) {
    fighter.shieldRaised = false;
    return false;
  }
  fighter.shieldRaised = !fighter.shieldRaised;
  return true;
}

/** Resolve retractable armor pool from body and/or shield slots (higher HP wins — one toggle). */
export function resolveRetractableArmor(loadout) {
  let best = 0;
  let source = null;
  for (const slot of ["body", "shield"]) {
    const gear = GEAR_BY_ID[loadout?.[slot]];
    const pool = gear?.retractableArmor?.hp || 0;
    if (pool > best) {
      best = pool;
      source = gear.id;
    }
  }
  return best > 0 ? { hp: best, sourceId: source } : null;
}

export function hasRetractableArmor(fighter) {
  return (fighter?.retractableMax || 0) > 0;
}

export function nanotechCostOf(gearOrId) {
  const gear = typeof gearOrId === "string" ? GEAR_BY_ID[gearOrId] : gearOrId;
  if (!gear?.nanotech) return 0;
  return Math.max(0, Number(gear.nanobotCost) || 0);
}

export function nanotechPoolCapacity(loadout) {
  let total = 0;
  for (const slot of SLOT_ORDER) {
    total += nanotechCostOf(loadout?.[slot]);
  }
  return total;
}

export function hasNanotechGear(fighter) {
  return !!fighter?.forceNanotechMorph || (fighter?.nanobotMax || 0) > 0;
}

export function hasNanotechChestplate(fighter) {
  return !!fighter?.hasNanotechChestplate
    || fighter?.loadout?.body === "nanotech-chestplate";
}

export function nanotechArmorHp(fighter) {
  const bots = Math.min(
    NANOTECH_ARMOR_BOT_CAP,
    Math.max(0, fighter?.nanobotArmor || 0)
  );
  return Math.floor(bots / NANOTECH_BOTS_PER_HP);
}

export function nanotechArmorMaxHp(fighter) {
  return Math.floor(NANOTECH_ARMOR_BOT_CAP / NANOTECH_BOTS_PER_HP);
}

export function canNanotechAttack(fighter) {
  const cost = fighter?.nanotechWeaponCost || 0;
  if (cost <= 0) return true;
  return (fighter.nanobotWeapon || 0) > 0;
}

/** 0–1 how fully the nanotech weapon is formed. */
export function nanotechFormPct(fighter) {
  const cost = fighter?.nanotechWeaponCost || 0;
  if (cost <= 0) return 1;
  return Math.max(0, Math.min(1, (fighter.nanobotWeapon || 0) / cost));
}

/**
 * E: pull free reserve bots into the weapon, trying to reach full cost.
 * Partial form is allowed when free bots run short.
 */
export function tryFormNanotechWeapon(fighter) {
  if (!fighter || fighter.dead) return { ok: false, reason: "dead" };
  const cost = fighter.nanotechWeaponCost || 0;
  if (cost <= 0) return { ok: false, reason: "no-nanotech-weapon" };
  const need = Math.max(0, cost - (fighter.nanobotWeapon || 0));
  if (need <= 0) return { ok: true, fullyFormed: true, pulled: 0 };
  const pull = Math.min(need, Math.max(0, fighter.nanobotFree || 0));
  if (pull <= 0) return { ok: false, reason: "no-free-bots", fullyFormed: false, pulled: 0 };
  fighter.nanobotFree -= pull;
  fighter.nanobotWeapon = (fighter.nanobotWeapon || 0) + pull;
  clampNanotechPool(fighter);
  return {
    ok: true,
    fullyFormed: (fighter.nanobotWeapon || 0) >= cost,
    pulled: pull,
    formPct: nanotechFormPct(fighter)
  };
}

/** Incomplete melee hit destroys 2% of the weapon's full bot cost. */
export function applyNanotechSlashBotLoss(fighter) {
  const cost = fighter?.nanotechWeaponCost || 0;
  if (cost <= 0 || fighter.weapon !== "saber") return 0;
  if (nanotechFormPct(fighter) >= 1) return 0;
  const loss = cost * 0.02;
  const before = fighter.nanobotWeapon || 0;
  fighter.nanobotWeapon = Math.max(0, before - loss);
  clampNanotechPool(fighter);
  return before - fighter.nanobotWeapon;
}

function clampNanotechPool(fighter) {
  if (!fighter) return;
  const max = Math.max(0, fighter.nanobotMax || 0);
  let weapon = Math.max(0, fighter.nanobotWeapon || 0);
  let armor = Math.max(0, fighter.nanobotArmor || 0);
  let free = Math.max(0, fighter.nanobotFree || 0);
  const cost = fighter.nanotechWeaponCost || 0;
  if (cost > 0) weapon = Math.min(cost, weapon);
  armor = Math.min(max, armor);
  free = Math.min(max, free);
  let used = free + armor + weapon;
  if (used > max) {
    // Prefer trimming free, then armor — never auto-strip the formed weapon first.
    const over = used - max;
    const fromFree = Math.min(free, over);
    free -= fromFree;
    const rest = over - fromFree;
    if (rest > 0) armor = Math.max(0, armor - rest);
  }
  fighter.nanobotWeapon = weapon;
  fighter.nanobotArmor = armor;
  fighter.nanobotFree = free;
}

/** Nanotech sword melts when unformed — fully hidden near end of dissolve. */
export function nanotechSwordHidden(fighter) {
  if (fighter?.weaponId !== "nanotech-sword") return false;
  return nanotechSwordVisibility(fighter) <= 0.02;
}

/** 1 = blade out, 0 = fully dissolved into particles. */
export function nanotechSwordVisibility(fighter) {
  if (fighter?.weaponId !== "nanotech-sword") return 1;
  const form = nanotechFormPct(fighter);
  const t = Math.max(0, Math.min(1, fighter.nanotechSwordDissolveT ?? 0));
  const eased = t * t * (3 - 2 * t);
  // Scale by form % so a half-built sword looks thinner / fainter.
  return form * (1 - eased * 0.15);
}

function beginNanotechArmorSpawn(fighter) {
  if (!fighter || !hasNanotechChestplate(fighter)) return false;
  fighter.nanotechArmorSpawning = true;
  fighter.nanotechArmorSpawnT = 0;
  return true;
}

export function setNanotechChanneling(fighter, on) {
  if (!fighter || !hasNanotechChestplate(fighter) || fighter.dead) {
    if (fighter) fighter.nanotechChanneling = false;
    return false;
  }
  const want = !!on;
  const was = !!fighter.nanotechChanneling;
  fighter.nanotechChanneling = want;
  // Fresh channel from empty armor → particle suit spawn (sword dissolves into it).
  if (want && !was && (fighter.nanobotArmor || 0) <= 0) {
    beginNanotechArmorSpawn(fighter);
  }
  return true;
}

/** Core + retractable (if deployed) + nanotech armor buffer → displayed hp/maxHp. */
export function syncNanotechDisplayedHp(fighter) {
  if (!fighter) return;
  fighter.coreMaxHp = fighter.coreMaxHp ?? fighter.maxHp;
  fighter.coreHp = Math.max(0, Math.min(fighter.coreMaxHp, fighter.coreHp ?? fighter.hp));
  if (fighter.retractableMax > 0) {
    fighter.retractableHp = Math.max(
      0,
      Math.min(fighter.retractableMax, fighter.retractableHp ?? fighter.retractableMax)
    );
  }
  const retOn = fighter.retractableMax > 0 && fighter.retractableDeployed;
  const nanoHp = nanotechArmorHp(fighter);
  fighter.maxHp = fighter.coreMaxHp + (retOn ? fighter.retractableMax : 0) + nanoHp;
  fighter.hp = fighter.coreHp + (retOn ? fighter.retractableHp : 0) + nanoHp;
}

export function tickNanotech(fighter, dt) {
  if (!fighter || !(fighter.nanobotMax > 0) || fighter.dead) return;
  const max = fighter.nanobotMax;
  let free = Math.max(0, fighter.nanobotFree || 0);
  let armor = Math.max(0, fighter.nanobotArmor || 0);
  let weapon = Math.max(0, fighter.nanobotWeapon || 0);
  const armorBefore = armor;
  const weaponCost = fighter.nanotechWeaponCost || 0;

  if (fighter.nanotechChanneling && hasNanotechChestplate(fighter)) {
    // Hold F: loan free reserve into armor (never steals committed weapon bots).
    const room = Math.max(0, max - armor - weapon);
    const flow = Math.min(free, room, NANOTECH_CHANNEL_RATE * dt);
    free -= flow;
    armor += flow;
  } else if (hasNanotechChestplate(fighter) && armor > 0) {
    // Release F: armor returns to free reserve.
    const flow = Math.min(armor, NANOTECH_RECALL_RATE * dt);
    armor -= flow;
    free += flow;
  } else if (free + armor + weapon < max) {
    // Rebuild free reserve when bots were destroyed (slash bleed / armor damage).
    const room = Math.max(0, max - free - armor - weapon);
    const gain = Math.min(room, NANOTECH_SLOW_REGEN * dt);
    free += gain;
  }

  fighter.nanobotFree = free;
  fighter.nanobotArmor = armor;
  fighter.nanobotWeapon = weapon;
  clampNanotechPool(fighter);

  // Rising edge into armor while already channeling (e.g. bots arrive mid-hold).
  if (
    armorBefore <= 0
    && fighter.nanobotArmor > 0
    && fighter.nanotechChanneling
    && !fighter.nanotechArmorSpawning
  ) {
    beginNanotechArmorSpawn(fighter);
  }

  if (fighter.nanotechArmorSpawning) {
    fighter.nanotechArmorSpawnT = Math.min(
      1,
      (fighter.nanotechArmorSpawnT || 0) + dt / NANOTECH_ARMOR_SPAWN_DURATION
    );
    if (fighter.nanotechArmorSpawnT >= 1) {
      fighter.nanotechArmorSpawning = false;
      fighter.nanotechArmorSpawnT = 1;
    }
  }

  // Particle dissolve when the weapon has no committed bots.
  if (fighter.weaponId === "nanotech-sword") {
    const wantDissolved = weaponCost > 0 && (fighter.nanobotWeapon || 0) <= 0;
    let dissolve = Math.max(0, Math.min(1, fighter.nanotechSwordDissolveT ?? 0));
    if (wantDissolved) {
      dissolve = Math.min(1, dissolve + dt / NANOTECH_SWORD_DISSOLVE_DURATION);
    } else {
      dissolve = Math.max(0, dissolve - dt / NANOTECH_SWORD_REFORM_DURATION);
    }
    fighter.nanotechSwordDissolveT = dissolve;
  } else {
    fighter.nanotechSwordDissolveT = 0;
  }

  syncNanotechDisplayedHp(fighter);
}

export function syncRetractableDisplayedHp(fighter) {
  if (!fighter) return;
  if (!(fighter.retractableMax > 0)) {
    fighter.coreMaxHp = fighter.coreMaxHp ?? fighter.maxHp;
    fighter.coreHp = fighter.coreHp ?? fighter.hp;
    syncNanotechDisplayedHp(fighter);
    return;
  }
  fighter.coreMaxHp = fighter.coreMaxHp ?? fighter.maxHp;
  fighter.coreHp = Math.max(0, Math.min(fighter.coreMaxHp, fighter.coreHp ?? fighter.hp));
  fighter.retractableHp = Math.max(
    0,
    Math.min(fighter.retractableMax, fighter.retractableHp ?? fighter.retractableMax)
  );
  syncNanotechDisplayedHp(fighter);
}

export function retractableSpeedMultiplier(fighter) {
  if (!hasRetractableArmor(fighter)) return 1;
  if (fighter.retractableDeployed || fighter.retractableMorphing) {
    return RETRACTABLE_ARMOR_SPEED;
  }
  return 1;
}

export function beginRetractableMorph(fighter, deploy) {
  if (!hasRetractableArmor(fighter) || fighter.dead) return false;
  if (fighter.retractableMorphing) return false;
  if (!!fighter.retractableDeployed === !!deploy) return false;
  if (deploy && fighter.retractableHp <= 0) return false;
  fighter.retractableMorphFrom = fighter.retractableDeployed ? "on" : "off";
  fighter.retractableMorphTo = deploy ? "on" : "off";
  fighter.retractableMorphT = 0;
  fighter.retractableMorphing = true;
  return true;
}

export function toggleRetractableArmor(fighter) {
  if (!hasRetractableArmor(fighter) || fighter.dead) return false;
  if (fighter.retractableMorphing) return false;
  return beginRetractableMorph(fighter, !fighter.retractableDeployed);
}

function finishRetractableMorph(fighter) {
  const toOn = fighter.retractableMorphTo === "on";
  fighter.retractableDeployed = toOn;
  fighter.retractableMorphing = false;
  fighter.retractableMorphT = 1;
  syncRetractableDisplayedHp(fighter);
}

export function tickRetractableArmor(fighter, dt) {
  if (!hasRetractableArmor(fighter)) return;
  if (!fighter.retractableMorphing) return;
  fighter.retractableMorphT = Math.min(
    1,
    (fighter.retractableMorphT || 0) + dt / RETRACTABLE_MORPH_DURATION
  );
  if (fighter.retractableMorphT >= 1) finishRetractableMorph(fighter);
}

/** Damage after shield block: nano armor, then retractable pool while deployed, then core. */
export function applyHpDamage(fighter, dealt, game = null) {
  let left = Math.max(0, dealt);
  if (left <= 0) {
    if ((fighter.retractableMax || 0) > 0 || (fighter.nanobotMax || 0) > 0) {
      syncNanotechDisplayedHp(fighter);
    }
    return 0;
  }

  // No retractable / nano armor buffer: damage displayed hp (legacy callers reset .hp).
  if (!(fighter.retractableMax > 0) && !(fighter.nanobotArmor > 0)) {
    fighter.hp = Math.max(0, fighter.hp - left);
    fighter.coreHp = fighter.hp;
    fighter.coreMaxHp = fighter.coreMaxHp ?? fighter.maxHp;
    if ((fighter.nanobotMax || 0) > 0) syncNanotechDisplayedHp(fighter);
    else fighter.coreMaxHp = fighter.maxHp;
    return dealt;
  }

  fighter.coreMaxHp = fighter.coreMaxHp ?? fighter.maxHp;
  fighter.coreHp = fighter.coreHp ?? fighter.hp;

  if ((fighter.nanobotArmor || 0) > 0) {
    const armorHp = nanotechArmorHp(fighter);
    const absorb = Math.min(left, armorHp);
    if (absorb > 0) {
      fighter.nanobotArmor = Math.max(
        0,
        fighter.nanobotArmor - absorb * NANOTECH_BOTS_PER_HP
      );
      left -= absorb;
    }
  }

  if (fighter.retractableMax > 0) {
    if (fighter.retractableDeployed && fighter.retractableHp > 0 && left > 0) {
      const absorb = Math.min(fighter.retractableHp, left);
      fighter.retractableHp -= absorb;
      left -= absorb;
    }
    if (left > 0) {
      fighter.coreHp = Math.max(0, fighter.coreHp - left);
    }
    if (fighter.retractableDeployed && fighter.retractableHp <= 0 && !fighter.retractableMorphing) {
      beginRetractableMorph(fighter, false);
      spawnBrokenArmorDebris(game, fighter);
    }
  } else if (left > 0) {
    fighter.coreHp = Math.max(0, fighter.coreHp - left);
  }

  syncNanotechDisplayedHp(fighter);
  return dealt;
}

export function healFighter(fighter, amount) {
  let left = Math.max(0, amount);
  if (!(fighter.retractableMax > 0) && !(fighter.nanobotArmor > 0)) {
    fighter.hp = Math.min(fighter.maxHp, fighter.hp + left);
    fighter.coreHp = fighter.hp;
    fighter.coreMaxHp = fighter.coreMaxHp ?? fighter.maxHp;
    if ((fighter.nanobotMax || 0) > 0) syncNanotechDisplayedHp(fighter);
    else fighter.coreMaxHp = fighter.maxHp;
    return;
  }
  fighter.coreMaxHp = fighter.coreMaxHp ?? fighter.maxHp;
  fighter.coreHp = fighter.coreHp ?? fighter.hp;
  const coreRoom = Math.max(0, fighter.coreMaxHp - fighter.coreHp);
  const toCore = Math.min(left, coreRoom);
  fighter.coreHp += toCore;
  left -= toCore;
  if (fighter.retractableDeployed && left > 0) {
    const armorRoom = Math.max(0, fighter.retractableMax - fighter.retractableHp);
    fighter.retractableHp += Math.min(left, armorRoom);
  }
  syncNanotechDisplayedHp(fighter);
}

function legacyWeapon(value) {
  if (value === "saber" || value === "arc-saber") return "arc-saber";
  return "pulse-rifle";
}

export function normalizeLoadout(loadout, owned = STARTER_GEAR, legacy = null) {
  const source = loadout || {};
  const normalized = {};
  for (const slot of SLOT_ORDER) {
    let id = source[slot];
    if (slot === "weapon" && (!id || id === "gun" || id === "saber")) {
      id = legacyWeapon(id || legacy);
    }
    const gear = GEAR_BY_ID[id];
    normalized[slot] = gear?.slot === slot && owned.includes(id)
      ? id
      : DEFAULT_LOADOUT[slot];
  }
  return normalized;
}

export function ensureEquipmentProfile(profile, saved = profile) {
  const owned = Array.from(new Set([
    ...STARTER_GEAR,
    "no-shield",
    ...(Array.isArray(saved?.equipment?.owned) ? saved.equipment.owned : [])
  ])).filter((id) => !!GEAR_BY_ID[id]);
  const oldPlayer = saved?.playerWeapon || saved?.equipment?.playerWeapon;
  const oldBuddy = saved?.buddyWeapon || saved?.equipment?.buddyWeapon;
  const player = normalizeLoadout(saved?.equipment?.player, owned, oldPlayer);
  const buddy = normalizeLoadout(saved?.equipment?.buddy, owned, oldBuddy);
  ensureProgressionProfile(profile, saved);
  player.perk = normalizeEquippedPerk(
    saved?.equipment?.player?.perk, profile.unlockedPerks
  );
  buddy.perk = normalizeEquippedPerk(
    saved?.equipment?.buddy?.perk, profile.unlockedPerks
  );
  profile.equipment = {
    owned,
    player,
    buddy,
    buddyMode: ["user", "suggested", "choice"].includes(saved?.equipment?.buddyMode)
      ? saved.equipment.buddyMode
      : "user",
    suggestion: null
  };
  return profile.equipment;
}

export function ensureEconomyProfile(profile, saved = profile) {
  const rawBalance = saved?.cyber;
  profile.cyber = Number.isInteger(rawBalance) && rawBalance >= 0
    ? rawBalance
    : STARTING_CYBER;
  const rawRanking = saved?.ranking;
  profile.ranking = Number.isInteger(rawRanking) && rawRanking >= RANKING_FLOOR
    ? rawRanking
    : STARTING_RANKING;
  profile.rewardedConquests = Array.from(new Set(
    Array.isArray(saved?.rewardedConquests) ? saved.rewardedConquests : []
  )).filter((id) => typeof id === "string").slice(-100);
  return profile;
}

export function purchaseGear(profile, gearId) {
  const gear = GEAR_BY_ID[gearId];
  if (!gear || !Number.isInteger(gear.price)) return { ok: false, reason: "not-for-sale" };
  if (effectiveOwned(profile).includes(gearId)) return { ok: false, reason: "owned" };
  if (profile.cyber < gear.price) return {
    ok: false, reason: "insufficient", shortfall: gear.price - profile.cyber
  };
  profile.cyber -= gear.price;
  profile.equipment.owned.push(gearId);
  return { ok: true, spent: gear.price, balance: profile.cyber, gear };
}

export function equipOwned(profile, owner, slot, gearId) {
  const gear = GEAR_BY_ID[gearId];
  if (!["player", "buddy"].includes(owner)
    || gear?.slot !== slot
    || !effectiveOwned(profile).includes(gearId)
    || (owner === "buddy" && profile.equipment.buddyMode === "choice")) return false;
  profile.equipment[owner][slot] = gearId;
  if (owner === "buddy" && profile.equipment.buddyMode === "suggested"
    && profile.equipment.suggestion) {
    profile.equipment.suggestion.loadout[slot] = gearId;
  }
  return true;
}

/**
 * Owned ids usable right now. Developer "unlock all gear temporary" overlays the
 * catalog without mutating permanent profile.equipment.owned.
 */
export function effectiveOwned(profile) {
  if (profile?.settings?.developer?.unlockAllGearTemporary) {
    return GEAR.map((gear) => gear.id);
  }
  return Array.isArray(profile?.equipment?.owned) ? profile.equipment.owned : [];
}

/** After turning unlock off, strip loadout slots that are not permanently owned. */
export function reconcileLoadoutsToOwned(profile) {
  const owned = Array.isArray(profile?.equipment?.owned) ? profile.equipment.owned : [];
  for (const owner of ["player", "buddy"]) {
    const loadout = profile.equipment[owner];
    if (!loadout) continue;
    profile.equipment[owner] = normalizeLoadout(loadout, owned);
    profile.equipment[owner].perk = loadout.perk ?? null;
  }
  if (profile.equipment.suggestion?.loadout) {
    profile.equipment.suggestion.loadout = normalizeLoadout(
      profile.equipment.suggestion.loadout, owned
    );
  }
  return profile;
}

/**
 * Award Conquest rewards once per result id.
 * Wins: Cyber + EXP + ranking gain. Losses: ranking loss only (floor at 0).
 * Training / Spar: no change. Returns { cyber, exp, levelsGained, pendingPicks, rankingDelta }.
 */
export function awardConquest(profile, result, random = Math.random) {
  const empty = { cyber: 0, exp: 0, levelsGained: 0, pendingPicks: [], rankingDelta: 0 };
  if (result?.mode !== "conquest") return empty;
  const resultId = String(result.id || "");
  if (!resultId || profile.rewardedConquests.includes(resultId)) return empty;
  ensureEconomyProfile(profile, profile);
  ensureProgressionProfile(profile, profile);
  profile.rewardedConquests.push(resultId);
  profile.rewardedConquests = profile.rewardedConquests.slice(-100);

  if (!result.win) {
    const loss = rankingLossAmount(profile.ranking);
    const before = profile.ranking;
    profile.ranking = Math.max(RANKING_FLOOR, before - loss);
    return {
      cyber: 0,
      exp: 0,
      levelsGained: 0,
      pendingPicks: [],
      rankingDelta: profile.ranking - before
    };
  }

  const baseCyber = CONQUEST_REWARDS[result.difficulty] || CONQUEST_REWARDS.rookie;
  const cyber = Math.round(baseCyber * cyberWinMultiplier(profile));
  const exp = CONQUEST_EXP[result.difficulty] || CONQUEST_EXP.rookie;
  const rankingDelta = rankingWinGain(profile.ranking);
  profile.cyber += cyber;
  profile.ranking += rankingDelta;
  const progression = grantExp(profile, exp, random);
  return {
    cyber,
    exp: progression.expGranted,
    levelsGained: progression.levelsGained,
    pendingPicks: progression.pendingPicks,
    rankingDelta
  };
}

export function ownedForSlot(profileOrEquipment, slot) {
  const owned = profileOrEquipment?.equipment
    ? effectiveOwned(profileOrEquipment)
    : (profileOrEquipment?.owned || []);
  return GEAR.filter((gear) => gear.slot === slot && owned.includes(gear.id));
}

function evidenceStyle(profile, playerLoadout) {
  const weapon = weaponKind(playerLoadout.weapon);
  const learned = profile.weapons?.[weapon]?.habits || {};
  const range = learned.engagementRange;
  const rush = learned.rushPrediction;
  const reliableRange = (range?.samples || 0) >= 3 ? range.estimate : null;
  const reliableRush = (rush?.samples || 0) >= 3 ? rush.estimate : null;
  if (reliableRange != null && reliableRange > .58) return "ranged";
  if (reliableRush != null && reliableRush > .5) return "rusher";
  if (weaponKind(playerLoadout.weapon) === "saber") return "rusher";
  return "balanced";
}

function pickOwned(profileOrEquipment, slot, preferences = []) {
  const owned = profileOrEquipment?.equipment
    ? effectiveOwned(profileOrEquipment)
    : (profileOrEquipment?.owned || []);
  return (preferences || []).find((id) => (
    owned.includes(id) && GEAR_BY_ID[id]?.slot === slot
  )) || ownedForSlot(profileOrEquipment, slot)[0]?.id || (
    owned.includes(DEFAULT_LOADOUT[slot]) ? DEFAULT_LOADOUT[slot] : null
  ) || DEFAULT_LOADOUT[slot];
}

export function suggestBuddyLoadout(profile) {
  const equipment = profile.equipment;
  const style = evidenceStyle(profile, equipment.player);
  const preferences = style === "ranged"
    ? {
      body: ["field-frame", "bulwark-frame", "scout-frame", "retractable-armor", "nanotech-chestplate"],
      helmet: ["wideband-array", "survey-visor", "guard-helm"],
      weapon: [
        "laser", "quick-fire-sniper", "classic-sniper", "nanotech-sniper", "strong-sniper",
        "marksman-rifle", "nanotech-rifle", "pulse-rifle", "gattler", "burst-carbine",
        "mechanical-modularity", "arc-saber", "duelist-blade"
      ],
      jetpack: [
        "endurance-pack", "vector-pack", "recycler-pack", "sprinter-pack", "nanotech-reserve"
      ],
      shield: [
        "light-buckler", "kinetic-targe", "retractable-shell", "no-shield", "bastion-bulwark"
      ]
    }
    : style === "rusher"
      ? {
        body: ["scout-frame", "field-frame", "bulwark-frame", "retractable-armor", "nanotech-chestplate"],
        helmet: ["survey-visor", "wideband-array", "guard-helm"],
        weapon: [
          "daggers", "heavy-saber", "arc-saber", "nanotech-sword", "duelist-blade",
          "mechanical-modularity",
          "gattler", "burst-carbine", "pulse-rifle", "laser"
        ],
        jetpack: [
          "sprinter-pack", "vector-pack", "recycler-pack", "endurance-pack", "nanotech-reserve"
        ],
        shield: ["no-shield", "light-buckler", "retractable-shell", "kinetic-targe", "bastion-bulwark"]
      }
      : {
        body: ["field-frame", "scout-frame", "bulwark-frame", "retractable-armor", "nanotech-chestplate"],
        helmet: ["survey-visor", "wideband-array", "guard-helm"],
        weapon: [
          "pulse-rifle", "arc-saber", "mechanical-modularity", "burst-carbine",
          "duelist-blade",
          "gattler", "laser", "marksman-rifle", "heavy-saber",
          "quick-fire-sniper", "classic-sniper", "nanotech-sniper", "nanotech-rifle",
          "nanotech-sword", "strong-sniper", "daggers"
        ],
        jetpack: [
          "vector-pack", "sprinter-pack", "endurance-pack", "recycler-pack", "nanotech-reserve"
        ],
        shield: [
          "light-buckler", "no-shield", "retractable-shell", "kinetic-targe", "bastion-bulwark"
        ]
      };
  const loadout = Object.fromEntries(
    SLOT_ORDER.map((slot) => [slot, pickOwned(profile, slot, preferences[slot])])
  );
  const reason = style === "ranged"
    ? "You seem to fight at range, so I favor awareness and reliable reach. I may be wrong."
    : style === "rusher"
      ? "You tend to close distance, so I favor mobility and close support. I may be wrong."
      : "I do not have strong evidence yet, so I suggest a balanced kit.";
  return { loadout, reason, style };
}

export function setBuddyMode(profile, mode) {
  const equipment = profile.equipment;
  equipment.buddyMode = mode;
  if (mode === "suggested") equipment.suggestion = suggestBuddyLoadout(profile);
  if (mode === "choice") {
    const choice = suggestBuddyLoadout(profile);
    equipment.buddy = choice.loadout;
    equipment.suggestion = choice;
  }
  if (mode === "user") equipment.suggestion = null;
  return equipment;
}

export function acceptSuggestion(profile) {
  const suggestion = profile.equipment.suggestion;
  if (suggestion) profile.equipment.buddy = normalizeLoadout(
    suggestion.loadout, effectiveOwned(profile)
  );
}

export function effectiveStats(loadout) {
  const result = {
    hp: 500, speed: 520, fuel: 3, thrust: 4000, recharge: 5,
    sight: 820, damageTaken: 100, dps: 100
  };
  for (const slot of SLOT_ORDER) {
    const id = loadout?.[slot];
    const gear = GEAR_BY_ID[id];
    const mods = gear?.modifiers || {};
    if (mods.hp) result.hp *= mods.hp;
    if (mods.speed) result.speed *= mods.speed;
    if (mods.fuel) result.fuel *= mods.fuel;
    if (mods.thrust) result.thrust *= mods.thrust;
    if (mods.recharge) result.recharge /= mods.recharge;
    if (mods.sight) result.sight *= mods.sight;
    if (mods.damageTaken) result.damageTaken *= mods.damageTaken;
    if (gear?.slot === "weapon") result.dps = theoreticalDps(gear);
  }
  applyPerkModifiersToStats(result, loadout?.perk);
  const weapon = weaponStats(loadout.weapon);
  result.speed = Math.min(520 * 1.4, result.speed * (weapon.movementMultiplier || 1));
  return Object.fromEntries(Object.entries(result).map(([key, value]) => [key, Math.round(value)]));
}

export function applyLoadout(fighter, loadout) {
  const stats = effectiveStats(loadout);
  const perkCombat = perkCombatExtras(loadout?.perk);
  const weapon = GEAR_BY_ID[loadout.weapon] || GEAR_BY_ID["pulse-rifle"];
  const shieldGear = GEAR_BY_ID[loadout.shield]?.slot === "shield"
    ? GEAR_BY_ID[loadout.shield]
    : GEAR_BY_ID["no-shield"];
  const shield = shieldStats(shieldGear);
  fighter.loadout = {
    ...DEFAULT_LOADOUT, ...loadout, shield: shieldGear.id,
    perk: loadout?.perk || null
  };
  fighter.perkId = loadout?.perk || null;
  fighter.weaponId = weapon.id;
  fighter.weapon = weaponKind(weapon);
  fighter.weaponStats = { ...weaponStats(weapon) };
  fighter.coreMaxHp = stats.hp;
  fighter.coreHp = stats.hp;
  fighter.maxHp = stats.hp;
  fighter.hp = stats.hp;
  fighter.moveSpeed = stats.speed;
  fighter.acceleration = 1800 * (stats.speed / 520);
  const retractable = resolveRetractableArmor(loadout);
  if (retractable) {
    fighter.retractableMax = retractable.hp;
    fighter.retractableHp = retractable.hp;
    fighter.retractableSourceId = retractable.sourceId;
    fighter.retractableDeployed = false;
    fighter.retractableMorphing = false;
    fighter.retractableMorphT = 1;
    fighter.retractableMorphFrom = "off";
    fighter.retractableMorphTo = "off";
    fighter._retractableBaseMoveSpeed = stats.speed;
  } else {
    fighter.retractableMax = 0;
    fighter.retractableHp = 0;
    fighter.retractableSourceId = null;
    fighter.retractableDeployed = false;
    fighter.retractableMorphing = false;
    fighter.retractableMorphT = 1;
    fighter._retractableBaseMoveSpeed = null;
  }
  syncRetractableDisplayedHp(fighter);
  const nanobotMax = nanotechPoolCapacity(fighter.loadout);
  fighter.nanobotMax = nanobotMax;
  fighter.nanobotFree = nanobotMax;
  fighter.nanobotArmor = 0;
  fighter.nanobotWeapon = 0;
  fighter.nanotechChanneling = false;
  fighter.nanotechArmorSpawning = false;
  fighter.nanotechArmorSpawnT = 1;
  fighter.nanotechSwordDissolveT = 0;
  fighter.nanotechWeaponCost = weapon.nanotech ? nanotechCostOf(weapon) : 0;
  fighter.hasNanotechChestplate = fighter.loadout.body === "nanotech-chestplate";
  fighter.forceNanotechMorph = SLOT_ORDER.some((slot) => {
    const gear = GEAR_BY_ID[fighter.loadout[slot]];
    return !!gear?.nanotech;
  });
  // Start with a formed weapon when reserve allows (E still tops up after bleeds).
  if (fighter.nanotechWeaponCost > 0) {
    tryFormNanotechWeapon(fighter);
  }
  syncNanotechDisplayedHp(fighter);
  fighter.damageTaken = stats.damageTaken / 100;
  fighter.sight = stats.sight;
  fighter.jetFuelCapacity = stats.fuel / 3;
  fighter.jetThrust = stats.thrust;
  fighter.jetRechargeScale = 5 / stats.recharge;
  fighter.weaponDamage = (weapon.modifiers.damage || 1) * perkCombat.damage;
  fighter.weaponFireRate = (weapon.modifiers.fireRate || 1) * perkCombat.fireRate;
  fighter.weaponRange = weapon.modifiers.range || 1;
  fighter.projectileSpeed = weapon.modifiers.projectileSpeed || 1;
  fighter.weaponBaseDamage = fighter.weaponStats.baseDamage * perkCombat.damage;
  fighter.weaponRpm = fighter.weaponStats.rpm * perkCombat.fireRate;
  fighter.weaponReach = fighter.weaponStats.range;
  fighter.weaponDropoff = fighter.weaponStats.dropoff;
  fighter.aimSettleRequired = fighter.weaponStats.aimSettle || 0;
  fighter.unsettledSpread = fighter.weaponStats.unsettledSpread || 0;
  fighter.cameraLead = fighter.weaponStats.cameraLead || 0;
  fighter.iframeMultiplier = (fighter.weaponStats.iframeMultiplier || 1) * perkCombat.iframe;
  fighter.dodgeCooldownMult = perkCombat.dodgeCooldown;
  fighter.directionalSightRange = Math.min(
    2400,
    fighter.weaponStats.range,
    fighter.sight + (fighter.weaponStats.sightExtension || 0)
  );
  fighter.sightHalfAngle = fighter.weaponStats.sightHalfAngle || 0;
  // Per-match shield pool: full at spawn; Protective Rebuilding can refill mid-match.
  fighter.shieldId = shieldGear.id;
  fighter.shieldMaxDurability = shield.durability * perkCombat.shieldDurability;
  fighter.shieldDurability = fighter.shieldMaxDurability;
  fighter.shieldBlockHalfAngle = shield.blockHalfAngle;
  fighter.shieldRaisedSpeed = shield.raisedSpeed * perkCombat.shieldRaisedSpeed;
  fighter.shieldBrokenSpeed = shield.brokenSpeed;
  fighter.shieldRaised = false;
  fighter.shieldBroken = false;
  fighter.shieldFlash = 0;

  // Mechanical Modularity: start in sword mode; plate pool is separate from slot shield.
  if (weapon.id === MODULAR_WEAPON_ID) {
    const moveMult = weapon.weaponStats?.movementMultiplier || 1;
    fighter.modularWeapon = true;
    fighter.modularMode = "sword";
    fighter.modularMorphing = false;
    fighter.modularMorphT = 1;
    fighter.modularMorphFrom = "sword";
    fighter.modularMorphTo = "sword";
    fighter.modularModeCd = 0;
    fighter._modularBaseMoveSpeed = stats.speed / moveMult;
    fighter._modularPerkCombat = perkCombat;
    fighter._modularShieldRaisedPerk = perkCombat.shieldRaisedSpeed;
    const plate = MODULAR_MODE_DEFS.shield.shield;
    fighter.modularPlateMax = plate.durability * perkCombat.shieldDurability;
    fighter.modularPlateDurability = fighter.modularPlateMax;
    fighter.modularPlateBroken = false;
    fighter._dedicatedShieldSnap = null;
    applyModularCombatStats(fighter, "sword");
  } else {
    fighter.modularWeapon = false;
    fighter.modularMode = null;
    fighter.modularMorphing = false;
    fighter.modularModeCd = 0;
    fighter._dedicatedShieldSnap = null;
  }
  return fighter;
}

export function trainerLoadout(tier, follower = false) {
  if (tier === "elite") {
    return {
      body: follower ? "field-frame" : "bulwark-frame",
      helmet: "guard-helm",
      weapon: follower ? "marksman-rifle" : "heavy-saber",
      jetpack: "endurance-pack",
      shield: follower ? "light-buckler" : "kinetic-targe"
    };
  }
  if (tier === "veteran") {
    return {
      body: "field-frame", helmet: "survey-visor",
      weapon: follower ? "pulse-rifle" : "arc-saber", jetpack: "vector-pack",
      shield: follower ? "no-shield" : "light-buckler"
    };
  }
  // Rookie Conquest: starter-ish kits only — no marksman / bulwark / heavy saber.
  // Trainer gets a light buckler so naive shield AI can show; follower is bare.
  if (follower) {
    return {
      body: "scout-frame",
      helmet: "survey-visor",
      weapon: "pulse-rifle",
      jetpack: "sprinter-pack",
      shield: "no-shield"
    };
  }
  return {
    body: "field-frame",
    helmet: "survey-visor",
    weapon: "pulse-rifle",
    jetpack: "vector-pack",
    shield: "light-buckler"
  };
}
