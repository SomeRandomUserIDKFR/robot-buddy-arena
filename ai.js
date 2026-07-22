import {
  AI_PRESETS, JET_RESTART_FUEL, SIGHT, SIZE, WORLD
} from "./config.js";
import { platformsOf } from "./maps.js";
import { directiveStrength } from "./coaching.js";
import {
  beginAdaptiveMorph, beginModularMorph, beginRetractableMorph, hasNanotechChestplate,
  hasRetractableArmor, isAdaptiveNanotechWeapon, isModularWeapon, nanotechFormPct,
  pulseNanotechArmor, setNanotechChanneling, tryFormNanotechWeapon
} from "./equipment.js";
import {
  ensureLearningProfile, evidenceReliability, evidenceState, mimicBlendFactor,
  precisionAimErrorScale
} from "./learning.js";
import { angleDiff, clamp, dist, formatTime, lerp } from "./utils.js";
import { crateVisibleToTeam } from "./powerups.js";
import { visibleToTeam } from "./vision.js";

/**
 * Soft teammate-safety weight in Conquest Mimic. Full intensity still copies
 * style strongly, but this constant keeps a light follow/protect bias so the
 * buddy does not always mirror-suicide with the player.
 */
export const MIMIC_TEAM_SAFETY = .28;

/** Half-angle (rad) for treating a foe as a frontal shield threat. */
export const SHIELD_FRONT_HALF = 1.15;
/** Absolute max hold (s) even for trained “camp shield” styles. */
export const SHIELD_MAX_HOLD = 1.25;
/** Floor hold (s) for any mind / style. */
export const SHIELD_MIN_HOLD = .35;

/**
 * Per-decision-tick dodge odds (baseline / trained panic band).
 * Buddy threat commits scale with dodgeTiming evidence: empty profiles
 * only rarely flinch; trained buddies recover the strong under-fire band.
 * Enemy trainers always use the full threat constants (not evidence-gated).
 */
export const DODGE_PANIC_BASE = .045;
export const DODGE_PANIC_TRAINED = .09;
/** Tiny idle-flinch floor for untrained buddies (occasional wrong dash). */
export const DODGE_PANIC_ROOKIE_FLOOR = .012;
/** Commit chance when a projectile / saber swing is imminent (trained). */
export const DODGE_THREAT_HIGH = .68;
/** Commit chance when recently shot at or aimed at (trained). */
export const DODGE_THREAT_MED = .36;
/** Untrained buddy floors — rare / clumsy, not semi-pro. */
export const DODGE_THREAT_HIGH_ROOKIE = .14;
export const DODGE_THREAT_MED_ROOKIE = .07;
/** Mimic floor when dodgeTiming evidence is still thin. */
export const DODGE_MIMIC_BASELINE = .07;

/**
 * Signed shield style bias from habit evidence.
 * +1 camps / burns durability; −1 pop-blocks / conserves.
 * `blend` is Mimic intensity weight (or 1 for non-Mimic buddies).
 */
export function shieldStyleBias(estimate, reliability, blend = 1) {
  if (estimate === null || estimate === undefined) return 0;
  if (!(reliability > .15) || !(blend > 0)) return 0;
  return clamp((Number(estimate) - .5) * 2, -1, 1) * reliability * blend;
}

/**
 * Threat severity for shield raises:
 * 0 none, 1 mild (brief cover), 2 danger, 3 clutch (save durability for this).
 */
export function evaluateShieldThreat(fighter, threat, game, visible) {
  if (!threat || !Array.isArray(visible) || !visible.includes(threat)) {
    return { severity: 0, range: Infinity, frontal: false, closing: false, incoming: false };
  }
  const range = dist(fighter, threat);
  const fx = fighter.x + SIZE / 2;
  const fy = fighter.y + SIZE / 2;
  const tx = threat.x + SIZE / 2;
  const ty = threat.y + SIZE / 2;
  const bearing = Math.atan2(ty - fy, tx - fx);
  const frontal = Math.abs(angleDiff(bearing, fighter.aim)) <= SHIELD_FRONT_HALF;
  const incoming = hasIncomingHostileShot(fighter, game);
  if (!frontal && !incoming) {
    return { severity: 0, range, frontal: false, closing: false, incoming: false };
  }

  const relX = fx - tx;
  const relY = fy - ty;
  const closingSpeed = range > 1
    ? ((threat.vx || 0) * relX + (threat.vy || 0) * relY) / range
    : 0;
  const closing = closingSpeed > 55 || range < 150;
  const saber = (threat.weapon || "") === "saber";
  const heavyRanged = (threat.weaponStats?.aimSettle || 0) >= .3
    || /sniper/i.test(threat.weaponId || "");
  const hpRatio = fighter.hp / Math.max(1, fighter.maxHp || 500);

  let severity = 0;
  if (
    incoming
    || (saber && range < 125)
    || (heavyRanged && incoming)
    || (hpRatio < .28 && frontal && range < 260)
  ) {
    severity = 3;
  } else if (
    (saber && range < 200 && frontal)
    || (heavyRanged && frontal && range < 1100 && (closing || range < 700))
    || (frontal && range < 145)
  ) {
    severity = 2;
  } else if (frontal && closing && range < 320) {
    severity = 1;
  } else if (frontal && range < 190) {
    severity = 1;
  }

  return { severity, range, frontal, closing, incoming };
}

/** Durability + severity gate: low shield HP needs a real reason to raise. */
export function shieldRaiseAllowed(durabilityRatio, severity, styleBias = 0) {
  if (severity <= 0) return false;
  if (severity >= 3) return true;
  const bias = clamp(Number(styleBias) || 0, -1, 1);
  // Camp loosens floors slightly; conserve tightens. Critical clutch still works via severity≥3.
  const criticalFloor = clamp(.12 - bias * .04, .08, .16);
  if (durabilityRatio < criticalFloor) return false;
  const dangerFloor = clamp(.25 - bias * .06, .16, .32);
  if (durabilityRatio < dangerFloor) return severity >= 2;
  const mildFloor = clamp(.5 - bias * .18, .28, .68);
  if (durabilityRatio < mildFloor) return severity >= 2;
  // Strong conserve: skip mild raises even at full durability.
  if (bias < -.35 && severity <= 1) return false;
  return severity >= 1;
}

/**
 * Short tactical holds (seconds). Flash panics briefly; Thinker holds a bit
 * longer when the read is good. Low durability shortens every mind mode.
 * Trained styleBias stretches/shrinks within SHIELD_MIN_HOLD..SHIELD_MAX_HOLD.
 */
export function shieldHoldDuration(aiId, durabilityRatio, severity, styleBias = 0) {
  const mind = aiId === "flash" || aiId === "thinker" ? aiId : "balanced";
  // Modest bump vs prior .42 / .58 / .78 short-hold band — still far below camping.
  let hold = mind === "flash" ? .48 : mind === "thinker" ? .88 : .66;
  if (durabilityRatio < .5) hold *= .78;
  if (durabilityRatio < .25) hold *= .72;
  if (severity >= 3) hold = Math.min(.98, hold + .14);
  if (severity <= 1) hold = Math.min(hold, mind === "flash" ? .46 : .62);
  const bias = clamp(Number(styleBias) || 0, -1, 1);
  hold *= 1 + bias * .55;
  return clamp(hold, SHIELD_MIN_HOLD, SHIELD_MAX_HOLD);
}

/** Seconds before another raise after lowering (styleBias shortens for campers). */
export function shieldLowerCooldown(durabilityRatio, styleBias = 0) {
  // Slightly shorter than prior .85 / .6 so raises return a bit sooner.
  const base = durabilityRatio < .5 ? .72 : .5;
  return clamp(base * (1 - (Number(styleBias) || 0) * .28), .28, .95);
}

/**
 * Hostile projectile closing on the fighter.
 * `requireFacing` (default true) keeps shield raises front-arc honest;
 * dodge checks pass false so off-angle shots still trigger a dash.
 */
export function hasIncomingHostileShot(fighter, game, { requireFacing = true } = {}) {
  const bullets = game?.bullets;
  if (!Array.isArray(bullets) || !bullets.length) return false;
  const fx = fighter.x + SIZE / 2;
  const fy = fighter.y + SIZE / 2;
  for (const bullet of bullets) {
    if (!bullet?.owner || bullet.owner.team === fighter.team) continue;
    const dx = fx - bullet.x;
    const dy = fy - bullet.y;
    const range = Math.hypot(dx, dy);
    if (range < 8 || range > 950) continue;
    const speed = Math.hypot(bullet.vx || 0, bullet.vy || 0);
    if (speed < 1) continue;
    const closing = (bullet.vx * dx + bullet.vy * dy) / (speed * range);
    if (closing < .82) continue;
    if (requireFacing) {
      const travel = Math.atan2(bullet.vy, bullet.vx);
      if (Math.abs(angleDiff(travel, fighter.aim + Math.PI)) > 1.35) continue;
    }
    if (range / speed <= .55) return true;
  }
  return false;
}

/** Flash twitchy, Thinker selective — balanced / mimic / trainers sit in the middle. */
export function mindDodgeScale(aiId) {
  if (aiId === "flash") return 1.35;
  if (aiId === "thinker") return .78;
  if (aiId === "recruit") return .72;
  if (aiId === "rookie") return .82;
  return 1;
}

/**
 * Conquest greenhorns (Rookie trainer + Rookie-tier follower). Not Veteran/Elite.
 * These IDs use weakened dodge/shield/clumsiness paths; buddy ROOKIE_BUDDY is separate.
 */
export function isGreenEnemyAi(aiId) {
  return aiId === "rookie" || aiId === "recruit";
}

/**
 * Multiplier on full enemy threat dodge for Conquest tiers.
 * Veteran/Elite keep ~1; greenhorns sit near untrained-buddy commit rates.
 */
export function enemyDodgeScale(aiId) {
  if (aiId === "recruit") return .2;
  if (aiId === "rookie") return .28;
  if (aiId === "contender") return .55;
  if (aiId === "challenger") return .88;
  if (aiId === "elite") return 1;
  if (aiId === "veteran") return 1;
  return 1;
}

/**
 * Soft clumsiness for green Conquest enemies (not applied to player buddies).
 * Recruit is worse than Rookie trainer within the Rookie duo.
 */
export const ENEMY_GREEN = {
  overshoot: .14,
  recruitOvershoot: .2,
  overcommit: 170,
  recruitOvercommit: 260,
  fuelWaste: .5,
  recruitFuelWaste: .7,
  fireHesitation: .38,
  recruitFireHesitation: .52,
  reactionJitter: .4,
  recruitReactionJitter: .55,
  /** Shield competence 0..1 used like untrained buddy floors. */
  shieldSkill: .28,
  recruitShieldSkill: .12
};

/**
 * Dodge threat severity:
 * 0 none, 1 medium (aimed / recently shot), 2 high (incoming bolt or saber bite).
 */
export function evaluateDodgeThreat(fighter, threat, game, visible) {
  const now = game?.elapsed || 0;
  const incoming = hasIncomingHostileShot(fighter, game, { requireFacing: false });
  const recentlyHit = now - (fighter.lastHitAt ?? -99) < .28;
  const recentlyShotAt = fighter.buddy
    ? now - (game.lastShotAtPlayer ?? -99) < .4
    : recentlyHit;
  let saberSwing = false;
  let aimedAt = false;
  if (threat && Array.isArray(visible) && visible.includes(threat)) {
    const range = dist(fighter, threat);
    const fx = fighter.x + SIZE / 2;
    const fy = fighter.y + SIZE / 2;
    const tx = threat.x + SIZE / 2;
    const ty = threat.y + SIZE / 2;
    const toFighter = Math.atan2(fy - ty, fx - tx);
    if ((threat.weapon || "") === "saber" && range < 170) saberSwing = true;
    if (
      range < 780
      && Math.abs(angleDiff(threat.aim || 0, toFighter)) < .55
      && (threat.weapon || "") !== "saber"
    ) {
      aimedAt = true;
    }
  }
  let severity = 0;
  if (incoming || saberSwing) severity = 2;
  else if (recentlyHit || recentlyShotAt || aimedAt) severity = 1;
  return { severity, incoming, saberSwing, recentlyHit, recentlyShotAt, aimedAt };
}

/**
 * Probability of committing a dodge this decision tick.
 * Buddies: threat/panic climb with dodgeTiming evidence (empty = rare flinches).
 * Veteran/Elite trainers: full threat band (not gated on the player's learning).
 * Rookie/recruit enemies: scaled-down commits so they feel green, not semi-pro.
 * Mimic: copies player dodge habit when known; otherwise a soft mid floor.
 */
export function dodgeCommitChance({
  aiId = "balanced",
  isBuddy = false,
  isMimic = false,
  mimicBlend = 0,
  playerDodgeKnowledge = 0,
  dodgeEstimate = null,
  dodgeSkill = 0,
  dodgeBias = 0,
  presetChange = .5,
  threatSeverity = 0
} = {}) {
  const mind = mindDodgeScale(aiId);
  const skill = clamp(dodgeSkill, 0, 1);
  let panic = lerp(DODGE_PANIC_ROOKIE_FLOOR, DODGE_PANIC_TRAINED, skill)
    * mind
    * (1 + presetChange * .25);
  let threat = 0;

  if (!isBuddy && isGreenEnemyAi(aiId)) {
    // Ignore player training evidence — green enemies stay clumsy on their own.
    const tier = enemyDodgeScale(aiId);
    panic = DODGE_PANIC_ROOKIE_FLOOR * mind * (1 + presetChange * .25);
    if (threatSeverity >= 2) {
      threat = DODGE_THREAT_HIGH * mind * tier;
    } else if (threatSeverity >= 1) {
      threat = DODGE_THREAT_MED * mind * tier;
    }
  } else if (threatSeverity >= 2) {
    threat = isBuddy
      ? lerp(DODGE_THREAT_HIGH_ROOKIE, DODGE_THREAT_HIGH, skill) * mind
      : DODGE_THREAT_HIGH * mind;
  } else if (threatSeverity >= 1) {
    threat = isBuddy
      ? lerp(DODGE_THREAT_MED_ROOKIE, DODGE_THREAT_MED, skill) * mind
      : DODGE_THREAT_MED * mind;
  }

  if (isMimic && mimicBlend > 0) {
    if (playerDodgeKnowledge > .15 && dodgeEstimate !== null) {
      const copy = 1 + mimicBlend * playerDodgeKnowledge * clamp(Number(dodgeEstimate), 0, 1) * 1.6;
      panic *= copy;
      threat *= copy;
    } else {
      // Thin Mimic: slightly more willing than a blank mind, still far from trained.
      panic = Math.max(panic, DODGE_MIMIC_BASELINE * .45 * mind);
      if (threatSeverity >= 1) {
        threat = Math.max(
          threat,
          lerp(DODGE_THREAT_MED_ROOKIE * 1.15, DODGE_THREAT_MED * .7, skill) * mind
        );
      }
    }
  }

  panic *= 1 + dodgeBias * 1.5;
  threat *= 1 + dodgeBias * 1.15;
  return clamp(Math.max(panic, threat), 0, .92);
}

function lowerAiShield(fighter, state, now, cooldown = .65) {
  fighter.shieldRaised = false;
  state.shieldHoldUntil = 0;
  state.shieldCooldownUntil = Math.max(state.shieldCooldownUntil || 0, now + cooldown);
}

/** Between decision ticks: expire max hold and shorten after a blocked hit. */
export function tickAiShieldHold(fighter, state, game) {
  const now = game.elapsed || 0;
  if (!(fighter.shieldMaxDurability > 0) || fighter.shieldBroken || fighter.dead) {
    fighter.shieldRaised = false;
    state.shieldHoldUntil = 0;
    return;
  }
  if (!fighter.shieldRaised) return;

  if (fighter.shieldFlash > 0 && (state.shieldHoldUntil || 0) > now + .14) {
    state.shieldHoldUntil = now + .14;
  }
  if ((state.shieldHoldUntil || 0) > 0 && now >= state.shieldHoldUntil) {
    const ratio = fighter.shieldDurability / Math.max(1, fighter.shieldMaxDurability);
    lowerAiShield(fighter, state, now, shieldLowerCooldown(ratio, state.shieldStyleBias || 0));
    return;
  }
  state.attack = false;
}

/**
 * Shared buddy/enemy shield policy: short frontal raises, durability-aware,
 * never park raised until broken. Buddies with shieldUse evidence bias toward
 * the player's camp vs conserve style (Mimic scales by intensity blend).
 */
export function updateAiShield(fighter, state, game, visible, target, aiId, styleBias = 0) {
  const now = game.elapsed || 0;
  const bias = clamp(Number(styleBias) || 0, -1, 1);
  state.shieldStyleBias = bias;
  if (!(fighter.shieldMaxDurability > 0) || fighter.shieldBroken || fighter.dead) {
    fighter.shieldRaised = false;
    state.shieldHoldUntil = 0;
    return;
  }

  const ratio = fighter.shieldDurability / Math.max(1, fighter.shieldMaxDurability);
  const threat = target && visible.includes(target) ? target : null;
  const info = evaluateShieldThreat(fighter, threat, game, visible);

  // Drop early once the threat leaves the front arc / disappears.
  if (fighter.shieldRaised && info.severity <= 0 && !info.incoming) {
    lowerAiShield(fighter, state, now, .45);
    return;
  }

  // Finish an in-progress hold (also covers post-block cut from tickAiShieldHold).
  if (fighter.shieldRaised) {
    if (fighter.shieldFlash > 0 && (state.shieldHoldUntil || 0) > now + .14) {
      state.shieldHoldUntil = now + .14;
    }
    if ((state.shieldHoldUntil || 0) > 0 && now >= state.shieldHoldUntil) {
      lowerAiShield(fighter, state, now, shieldLowerCooldown(ratio, bias));
      return;
    }
    state.attack = false;
    return;
  }

  if ((state.shieldCooldownUntil || 0) > now) return;
  if (!shieldRaiseAllowed(ratio, info.severity, bias)) return;

  let hold = shieldHoldDuration(aiId, ratio, info.severity, bias);
  // Untrained buddies: short pops; often miss mild reads, still raise on clutch.
  if (fighter.buddy) {
    const skill = clamp(Number(state.shieldCompetence) || 0, 0, 1);
    if (info.severity < 3 && Math.random() > lerp(.42, 1, skill)) return;
    hold *= lerp(.48, 1, skill);
  } else if (isGreenEnemyAi(aiId)) {
    // Rookie/recruit: miss mild threats often; when they raise, holds are short
    // or occasionally too long (naive "camp the button" discipline).
    const skill = aiId === "recruit"
      ? ENEMY_GREEN.recruitShieldSkill
      : ENEMY_GREEN.shieldSkill;
    if (info.severity < 3 && Math.random() > lerp(.42, 1, skill)) return;
    hold *= lerp(.48, 1, skill);
    if (Math.random() < .32) {
      hold = Math.min(SHIELD_MAX_HOLD, hold * 1.45);
    }
  }
  fighter.shieldRaised = true;
  state.shieldHoldUntil = now + hold;
  state.attack = false;
}

/** Minimum seconds between AI retractable deploy/retract morphs. */
export const RETRACTABLE_AI_COOLDOWN = .7;
/** Keep plates out at least this long once deployed (readable fight use). */
export const RETRACTABLE_AI_MIN_HOLD = 1.75;

/**
 * Decide whether plates should be deployed right now.
 * Default fight posture: plates ON whenever a foe is visible.
 * Fold for speed when searching/idle, or escaping without hard pressure.
 * Empty pools cannot deploy.
 */
export function wantRetractableDeployed(fighter, state, game, visible, target) {
  if (!hasRetractableArmor(fighter) || fighter.dead) return false;
  if ((fighter.retractableHp || 0) <= 0) return false;

  const threatFoe = target && Array.isArray(visible) && visible.includes(target)
    ? target
    : null;
  const shieldInfo = evaluateShieldThreat(fighter, threatFoe, game, visible || []);
  const dodgeInfo = evaluateDodgeThreat(fighter, threatFoe, game, visible || []);
  const underFire = dodgeInfo.severity >= 1
    || shieldInfo.severity >= 1
    || shieldInfo.incoming;
  const hardPressure = dodgeInfo.severity >= 2 || shieldInfo.severity >= 2;
  const escaping = !!state?.escape;

  // Incoming / melee pressure always wants plates.
  if (hardPressure || underFire) return true;
  // Escape wants mobility unless still taking heavy fire (handled above).
  if (escaping) return false;
  // Active fight: keep plates out whenever eyes are on a foe.
  if (threatFoe) return true;
  // Searching / idle: fold for speed.
  return false;
}

/**
 * Buddy/enemy retractable armor policy: plates on in fights, off when safe or
 * escaping. Min-hold keeps deploys readable. Green enemies sometimes fumble;
 * player buddies deploy reliably (this is a loadout verb, not a timing skill).
 */
export function updateAiRetractableArmor(fighter, state, game, visible, target, aiId) {
  // Nanotech chestplate owns F — do not toggle retractable shell while channeling.
  if (hasNanotechChestplate(fighter)) return;
  if (!hasRetractableArmor(fighter) || fighter.dead || fighter.retractableMorphing) {
    return;
  }
  const now = game.elapsed || 0;
  if ((state.retractableCooldownUntil || 0) > now) return;

  let want = wantRetractableDeployed(fighter, state, game, visible, target);

  // Honor min-hold so plates don't blink off between shots.
  if (
    fighter.retractableDeployed
    && !want
    && (fighter.retractableHp || 0) > 0
    && (state.retractableHoldUntil || 0) > now
  ) {
    want = true;
  }

  // Only green Conquest enemies fumble retractable use. Buddies should clearly
  // use the gear the player equipped for them.
  if (isGreenEnemyAi(aiId) && !fighter.buddy) {
    const skill = aiId === "recruit"
      ? ENEMY_GREEN.recruitShieldSkill
      : ENEMY_GREEN.shieldSkill;
    if (want && !fighter.retractableDeployed && Math.random() > lerp(.62, 1, skill)) {
      want = false;
    } else if (
      !want && fighter.retractableDeployed && Math.random() > lerp(.55, 1, skill)
    ) {
      want = true;
    }
  }

  if (!!want === !!fighter.retractableDeployed) return;
  if (!beginRetractableMorph(fighter, want)) return;
  state.retractableCooldownUntil = now + RETRACTABLE_AI_COOLDOWN;
  if (want) state.retractableHoldUntil = now + RETRACTABLE_AI_MIN_HOLD;
}

/** Minimal nanotech: form weapon; tap +100 under fire; hold-recall when needing free bots. */
export function updateAiNanotech(fighter, state, game, visible, target) {
  if (fighter.dead) {
    setNanotechChanneling(fighter, false);
    return;
  }
  if ((fighter.nanotechWeaponCost || 0) > 0 && nanotechFormPct(fighter) < 1) {
    tryFormNanotechWeapon(fighter);
  }
  if (!hasNanotechChestplate(fighter)) {
    setNanotechChanneling(fighter, false);
    return;
  }
  const free = fighter.nanobotFree || 0;
  const armor = fighter.nanobotArmor || 0;
  const underFire = (visible || []).some((foe) => foe && !foe.dead)
    || (!!target && !target.dead);
  if (underFire && free >= 40 && armor < 400) {
    if (!state.nanoPulseLatch) {
      pulseNanotechArmor(fighter);
      state.nanoPulseLatch = true;
    }
    setNanotechChanneling(fighter, false);
    return;
  }
  state.nanoPulseLatch = false;
  const weaponCost = fighter.nanotechWeaponCost || 0;
  const wantRecall = armor > 0 && free < Math.max(40, weaponCost * 0.5);
  setNanotechChanneling(fighter, wantRecall);
}

/**
 * Preferred fight distance under Mimic: blend default weapon spacing toward
 * the player's engagementRange / rush habits by intensity × reliability.
 */
export function mimicPreferredRange(fighter, learned, blend, baseDesired) {
  let desired = baseDesired;
  const rangeEst = learned.habits.engagementRange.estimate;
  const rangeRel = evidenceReliability(learned.habits.engagementRange);
  if (rangeEst !== null && rangeRel > .15) {
    const playerRange = rangeEst * SIGHT;
    const target = fighter.weapon === "saber"
      ? clamp(playerRange, 45, 220)
      : clamp(playerRange, 140, 1100);
    desired = lerp(desired, target, blend * rangeRel);
  }
  const rushEst = learned.habits.rushPrediction.estimate;
  const rushRel = evidenceReliability(learned.habits.rushPrediction);
  if (rushEst !== null && rushRel > .15 && rushEst > .1) {
    const closer = fighter.weapon === "gun" ? 280 : 75;
    desired = lerp(desired, closer, blend * rushRel * clamp(rushEst * 3.5, 0, 1));
  }
  return Math.max(40, desired);
}

// An untrained buddy knows only the basics: walk, jump, jetpack, shoot toward
// visible foes, and soft self-preservation. Aim, reaction tempo, spacing, fuel,
// and dodge/shield timing start crippled and are earned through training.
// Mind modes still flavor the rookie floor (Flash faster than Thinker) and set
// the trained ceiling. Veteran/Elite enemies use raw presets; Rookie/recruit
// enemies layer ENEMY_GREEN clumsiness on top of their weaker presets.
export const ROOKIE_BUDDY = {
  reaction: .8,       // base untrained decision loop (scaled per mind below)
  /** Flash stays snappier than Thinker at 0 evidence, still far from trained. */
  reactionMindScale: { flash: .52, balanced: .82, thinker: 1.05, mimic: .82 },
  aim: .9,            // wildly scattered shots (~±26° half-cone)
  prediction: 0,      // no target leading at all
  turnRateScale: .22, // fraction of mind-mode turn rate while untrained
  overshoot: .18,     // radians of flick overshoot while untrained (~10°)
  overcommit: 320,    // walks this much too close before it feels "in range"
  fuelWaste: 1,       // full chance of pointless jetpack bursts
  fireHesitation: .55 // chance to skip an otherwise-valid shot when untrained
};

/** Max aim turn rate (rad/s) for this fighter's mind mode, scaled by buddy aim skill. */
export function aimTurnRateFor(fighter, basePreset, learned) {
  const cap = basePreset.aimTurnRate ?? AI_PRESETS.balanced.aimTurnRate;
  if (!fighter.buddy || !learned) return cap;
  const skill = evidenceReliability(learned.capabilities.aim);
  return lerp(cap * ROOKIE_BUDDY.turnRateScale, cap, skill);
}

/**
 * Move aim toward desiredAim at a constant angular rate (shortest arc).
 * Returns the signed step applied this tick (0 if already on target / no desire).
 */
export function stepAimSmoothing(fighter, dt, turnRate) {
  const state = fighter.aiState;
  if (state.desiredAim == null || !(turnRate > 0) || !(dt > 0)) return 0;
  const delta = angleDiff(state.desiredAim, fighter.aim);
  const maxStep = turnRate * dt;
  if (Math.abs(delta) <= maxStep) {
    fighter.aim = state.desiredAim;
    return delta;
  }
  const step = Math.sign(delta) * maxStep;
  fighter.aim = Math.atan2(Math.sin(fighter.aim + step), Math.cos(fighter.aim + step));
  return step;
}

const EDGE_MARGIN = 150;
const ESCAPE_DURATION = 2.8;
const JET_ESCAPE_START_FUEL = .62;
const JET_ESCAPE_RESERVE = Math.max(.3, JET_RESTART_FUEL + .1);

/** Short retreat detour radius for opportunistic crate hops. */
export const CRATE_ESCAPE_HOP_RADIUS = 340;
/** HP fraction that motivates escape-route crate hops (heal intent). */
export const CRATE_ESCAPE_HP_FRAC = .45;

/** Aim angle toward a power crate's center. */
export function aimAtPowerCrate(fighter, crate) {
  const cx = crate.x + (crate.w || 0) / 2;
  const cy = crate.y + (crate.h || 0) / 2;
  return Math.atan2(cy - fighter.y - SIZE / 2, cx - fighter.x - SIZE / 2);
}

/** Nearest intact power crate the fighter's team can currently see. */
export function pickNearestVisibleCrate(game, fighter) {
  let best = null;
  let bestD = Infinity;
  for (const crate of game.powerCrates || []) {
    if (crate.destroyed || crate.forgeHidden || !crateVisibleToTeam(game, fighter, crate)) continue;
    const d = dist(fighter, crate);
    if (d < bestD) {
      best = crate;
      bestD = d;
    }
  }
  return best;
}

/**
 * Pick a visible crate near the escape path for a brief hop.
 * Prefers crates ahead along the retreat direction within hop radius.
 */
export function pickEscapeCrateHop(
  fighter,
  game,
  escape,
  hopRadius = CRATE_ESCAPE_HOP_RADIUS
) {
  if (!escape) return null;
  const dir = escape.direction
    || Math.sign((escape.targetX ?? fighter.x) - fighter.x)
    || 1;
  const fx = fighter.x + SIZE / 2;
  let best = null;
  let bestScore = Infinity;
  for (const crate of game.powerCrates || []) {
    if (crate.destroyed || crate.forgeHidden || !crateVisibleToTeam(game, fighter, crate)) continue;
    const cx = crate.x + (crate.w || 0) / 2;
    const dx = cx - fx;
    const d = dist(fighter, crate);
    if (d > hopRadius) continue;
    // Skip crates clearly behind the retreat direction.
    if (dx * dir < -90) continue;
    const along = dx * dir;
    const score = d - Math.min(Math.max(along, 0), 220) * .12;
    if (score < bestScore) {
      bestScore = score;
      best = crate;
    }
  }
  return best;
}

function supportingPlatform(fighter, game) {
  const feet = fighter.y + SIZE;
  return platformsOf(game).find((platform) => (
    fighter.x + SIZE > platform.x
    && fighter.x < platform.x + platform.w
    && Math.abs(feet - platform.y) <= 12
  ));
}

function escapeBlock(fighter, direction, game) {
  if (direction < 0 && fighter.x <= EDGE_MARGIN) return "left edge";
  if (direction > 0 && fighter.x >= WORLD.w - SIZE - EDGE_MARGIN) return "right edge";
  if (!fighter.grounded) return null;

  const platform = supportingPlatform(fighter, game);
  if (!platform) return "dangerous drop";
  const room = direction < 0
    ? fighter.x - platform.x
    : platform.x + platform.w - (fighter.x + SIZE);
  if (room > EDGE_MARGIN) return null;

  const probeX = fighter.x + SIZE / 2 + direction * (EDGE_MARGIN + 35);
  const nearbyLanding = platformsOf(game).some((candidate) => (
    probeX >= candidate.x + SIZE / 2
    && probeX <= candidate.x + candidate.w - SIZE / 2
    && candidate.y >= fighter.y + SIZE - 8
    && candidate.y - (fighter.y + SIZE) <= 220
  ));
  return nearbyLanding ? null : "platform dead-end";
}

function elevatedEscapeTarget(fighter, threat, direction, game) {
  return platformsOf(game)
    .map((platform) => {
      const x = clamp(
        platform.x + platform.w / 2 - SIZE / 2,
        EDGE_MARGIN,
        WORLD.w - SIZE - EDGE_MARGIN
      );
      const rise = fighter.y + SIZE - platform.y;
      const horizontal = Math.abs(x - fighter.x);
      const separation = Math.abs(x - threat.x);
      return { x, y: platform.y - SIZE, rise, horizontal, separation };
    })
    .filter((candidate) => (
      candidate.rise >= 100 && candidate.rise <= 580
      && candidate.horizontal <= 680
      && Math.sign(candidate.x - fighter.x || direction) === direction
    ))
    .sort((a, b) => (
      (b.separation - a.separation) * .35
      + (a.horizontal - b.horizontal)
      + (a.rise - b.rise) * .2
    ))[0] || {
    x: clamp(fighter.x + direction * 340, EDGE_MARGIN, WORLD.w - SIZE - EDGE_MARGIN),
    y: Math.max(12, fighter.y - 300)
  };
}

function trustedJetEscape(fighter, learned, basePreset) {
  if (fighter.jetLocked || fighter.fuel < JET_ESCAPE_START_FUEL) return false;
  if (!fighter.buddy) {
    return basePreset.fuelCare >= .5 || basePreset.prediction >= .45;
  }
  return evidenceState(learned.habits.jetpackUse, "jetpackUse") === "ready"
    && evidenceState(learned.capabilities.fuelManagement) === "ready";
}

function reachedSafePlatform(fighter, threat, game) {
  return fighter.grounded
    && !!supportingPlatform(fighter, game)
    && Math.abs(fighter.y - threat.y) > 150
    && dist(fighter, threat) > 220;
}

function logEscape(game, text) {
  if (!Array.isArray(game.thoughts)) return;
  game.thoughts.push(`${formatTime(game.elapsed || 0)} — ${text}`);
}

function makeEscapePlan(fighter, threat, game, learned, basePreset) {
  const away = Math.sign(fighter.x - threat.x || fighter.facing || 1);
  const blockedBy = escapeBlock(fighter, away, game);
  const direction = blockedBy
    ? (escapeBlock(fighter, -away, game) ? Math.sign(WORLD.w / 2 - fighter.x || -away) : -away)
    : away;
  const useJet = trustedJetEscape(fighter, learned, basePreset);
  const vertical = useJet;
  const target = vertical
    ? elevatedEscapeTarget(fighter, threat, direction, game)
    : {
      x: clamp(
        fighter.x + direction * 520,
        EDGE_MARGIN,
        WORLD.w - SIZE - EDGE_MARGIN
      ),
      y: fighter.y
    };

  if (blockedBy) {
    logEscape(game, `Retreated inward: the ${blockedBy} blocked my escape`);
  }
  if (vertical) {
    logEscape(game, "Used a vertical escape: I had enough fuel and trusted that route");
  }
  return {
    until: (game.elapsed || 0) + ESCAPE_DURATION,
    direction,
    targetX: target.x,
    targetY: target.y,
    startY: fighter.y,
    vertical,
    blockedBy,
    threatWeapon: threat.weapon || "gun"
  };
}

/**
 * Buddy motor skill from evidence. Empty profiles stay near ROOKIE_BUDDY;
 * mind presets are the trained ceiling (Flash still faster than Thinker at 0).
 */
export function buddySkill(preset, learned, aiId = "balanced") {
  const aim = evidenceReliability(learned.capabilities.aim);
  const dodge = evidenceReliability(learned.capabilities.dodgeTiming);
  const prediction = Math.max(
    evidenceReliability(learned.habits.engagementRange),
    evidenceReliability(learned.habits.rushPrediction)
  );
  const fuel = evidenceReliability(learned.capabilities.fuelManagement);
  // Reaction tempo earns toward the mind ceiling from aim + some dodge feel.
  const motor = clamp(Math.max(aim, dodge * .55), 0, 1);
  const mindKey = aiId === "flash" || aiId === "thinker" || aiId === "mimic"
    ? aiId
    : "balanced";
  const rookieReaction = ROOKIE_BUDDY.reaction
    * (ROOKIE_BUDDY.reactionMindScale[mindKey] ?? ROOKIE_BUDDY.reactionMindScale.balanced);
  return {
    reaction: lerp(rookieReaction, preset.reaction, motor),
    aim: lerp(ROOKIE_BUDDY.aim, preset.aim, aim),
    prediction: lerp(ROOKIE_BUDDY.prediction, preset.prediction, prediction),
    fuelCare: lerp(.05, preset.fuelCare, fuel),
    change: preset.change
  };
}

export function updateAI(fighter, dt, game, profile) {
  const state = fighter.aiState;
  const priorRetreatDecision = state.plan === "covering retreat";
  const basePreset = AI_PRESETS[fighter.ai] || AI_PRESETS.balanced;
  const player = game.fighters[0];
  const learned = ensureLearningProfile(profile.weapons[player.weapon]);
  const rangeKnowledge = evidenceReliability(learned.habits.engagementRange);
  const rushKnowledge = evidenceReliability(learned.habits.rushPrediction);
  const playerDodgeKnowledge = evidenceReliability(learned.habits.dodgeTiming);
  const jetKnowledge = evidenceReliability(learned.habits.jetpackUse);
  const lowHpKnowledge = evidenceReliability(learned.habits.lowHpBehavior);
  const shieldKnowledge = evidenceReliability(learned.habits.shieldUse);
  const dodgeSkill = evidenceReliability(learned.capabilities.dodgeTiming);
  const fuelSkill = evidenceReliability(learned.capabilities.fuelManagement);
  const preset = fighter.buddy
    ? buddySkill(basePreset, learned, fighter.ai || "balanced")
    : basePreset;
  const isMimic = !!fighter.buddy && fighter.ai === "mimic";
  const mimicBlend = isMimic
    ? mimicBlendFactor(profile.mimicIntensity, learned)
    : 0;
  const coachingBias = (intent) => fighter.buddy
    ? directiveStrength(profile, intent, player.weapon, game.mode === "training")
    : 0;

  state.timer -= dt;
  state.stale += dt;
  // An exhausted jet is locked out: release immediately (releasing is what
  // re-arms it once fuel recovers) instead of holding thrust uselessly.
  if (fighter.jetLocked) state.jet = false;
  const turnRate = aimTurnRateFor(fighter, basePreset, learned);
  // Crosshair tracking runs every frame; decisions only refresh desiredAim.
  // Shield max-hold still expires between decision ticks.
  if (state.timer > 0) {
    tickAiShieldHold(fighter, state, game);
    stepAimSmoothing(fighter, dt, turnRate);
    return state;
  }
  // Untrained buddies also hesitate irregularly instead of ticking steadily.
  // Green Conquest enemies share that jitter (recruit worse than rookie trainer).
  const greenEnemy = !fighter.buddy && isGreenEnemyAi(fighter.ai);
  const reactionJitter = fighter.buddy
    ? .45
    : greenEnemy
      ? (fighter.ai === "recruit"
        ? ENEMY_GREEN.recruitReactionJitter
        : ENEMY_GREEN.reactionJitter)
      : 0;
  state.timer = preset.reaction * (reactionJitter > 0 ? 1 + reactionJitter * Math.random() : 1);

  const enemies = game.fighters.filter((enemy) => !enemy.dead && enemy.team !== fighter.team);
  const visible = enemies.filter((enemy) => visibleToTeam(game, fighter, enemy));
  const latestPing = game.pings[game.pings.length - 1];
  let target = visible.sort((a, b) => {
    const hpBias = preset.change * (a.hp - b.hp) * 1.2;
    const pingBias = latestPing
      ? coachingBias("focusTargets") * (dist(a, latestPing) - dist(b, latestPing)) * 1.4
      : 0;
    return dist(fighter, a) - dist(fighter, b) + hpBias + pingBias;
  })[0];

  if (target) {
    state.target = target;
    state.lastKnown = {
      x: target.x, y: target.y, vx: target.vx, vy: target.vy, weapon: target.weapon
    };
    state.stale = 0;
    fighter.spotted = .4;
  } else if (state.lastKnown && state.stale < 6) {
    target = { ...state.lastKnown, hp: 500, dead: false };
  } else {
    state.target = null;
    target = null;
  }

  const reach = fighter.weaponReach || (fighter.weapon === "saber" ? 120 : 920);
  const sniper = (fighter.weaponStats?.aimSettle || 0) >= .3;
  const laser = !!fighter.weaponStats?.hitscan;
  const gattler = fighter.weaponId === "gattler";
  let desired = fighter.weapon === "saber"
    ? Math.max(45, reach * .78)
    : laser ? Math.min(980, reach * .52)
      : gattler ? Math.min(360, reach * .4)
        : sniper ? Math.min(1350, reach * .58) : Math.min(520, reach * .38);
  let protect = .35;
  // Flash / Balanced / Thinker: Conquest counter/support from habits.
  // Mimic: copy player style instead (applied below).
  if (fighter.buddy && game.mode === "conquest" && !isMimic) {
    if (rushKnowledge > .35 && learned.habits.rushPrediction.estimate > .08) {
      desired = fighter.weapon === "gun" ? 320 : 100;
      protect = .8;
    } else if (
      rangeKnowledge > .35
      && learned.habits.engagementRange.estimate > 500 / SIGHT
    ) {
      desired = fighter.weapon === "saber" ? 90 : 300;
      protect = .55;
    }
    if (
      lowHpKnowledge > .35 && player.hp < 190
    ) {
      protect = learned.habits.lowHpBehavior.estimate > .45 ? .95 : .6;
    }
  }
  if (isMimic && mimicBlend > 0) {
    desired = mimicPreferredRange(fighter, learned, mimicBlend, desired);
    if (
      lowHpKnowledge > .2
      && learned.habits.lowHpBehavior.estimate !== null
      && player.hp < 190
      && game.mode === "conquest"
    ) {
      // Copy low-HP aggression: high estimate → stay aggressive near the player.
      const lowHp = learned.habits.lowHpBehavior.estimate;
      protect = lerp(protect, lerp(.45, .95, lowHp), mimicBlend * lowHpKnowledge);
    }
  }
  desired -= coachingBias("rush") * (fighter.weapon === "gun" ? 130 : 45);
  desired += coachingBias("safer") * 150;
  desired -= coachingBias("stayClose") * 70;
  desired += coachingBias("keepDistance") * 160;
  // A clueless buddy misjudges spacing and overcommits: it wanders far
  // inside its weapon's effective range instead of holding position.
  // Green Conquest enemies share a milder overcommit (recruit worse).
  if (fighter.buddy) {
    desired = Math.max(40, desired - ROOKIE_BUDDY.overcommit * (1 - rangeKnowledge));
  } else if (greenEnemy) {
    const over = fighter.ai === "recruit"
      ? ENEMY_GREEN.recruitOvercommit
      : ENEMY_GREEN.overcommit;
    desired = Math.max(40, desired - over);
  }
  // Expose for tests / HUD debugging of Mimic blend.
  state.mimicDesired = isMimic ? desired : null;
  state.mimicBlend = isMimic ? mimicBlend : 0;

  let goalX = target ? target.x : fighter.x;
  if (fighter.buddy && game.mode === "conquest") {
    if (!isMimic) {
      if (
        rangeKnowledge > .35
        && learned.habits.engagementRange.estimate > 500 / SIGHT
      ) goalX = target ? target.x : player.x + player.facing * 250;
      else if (protect > .7 && dist(fighter, player) > 460) goalX = player.x;
    } else if (protect > .55 && dist(fighter, player) > 460) {
      goalX = lerp(goalX, player.x, MIMIC_TEAM_SAFETY);
    }
    const ping = game.pings[game.pings.length - 1];
    if (ping && ping.life > 1.5) {
      const pingPriority = coachingBias("focusTargets");
      goalX = lerp(goalX, ping.x, .45 + pingPriority * .55);
      state.plan = "answering ping";
    }
    const followBias = coachingBias("stayClose");
    if (followBias && dist(fighter, player) > lerp(460, 260, followBias)) {
      goalX = lerp(goalX, player.x, followBias);
    }
    // Mimic soft safety: always keep a light teammate bias in 2v2.
    if (isMimic && (player.hp < 190 || dist(fighter, player) > 520)) {
      goalX = lerp(goalX, player.x, MIMIC_TEAM_SAFETY * (player.hp < 190 ? 1.15 : 1));
      protect = Math.max(protect, lerp(protect, .75, MIMIC_TEAM_SAFETY));
    }
  }

  // Untrained buddies panic earlier (soft self-preservation); habits refine it.
  let retreatHp = fighter.buddy
    ? lerp(105, 130, evidenceReliability(learned.habits.lowHpBehavior))
      + coachingBias("safer") * 90
    : 130;
  if (isMimic && mimicBlend > 0 && lowHpKnowledge > .2
    && learned.habits.lowHpBehavior.estimate !== null) {
    // High estimate = player keeps fighting when hurt → lower retreat threshold.
    const aggressive = learned.habits.lowHpBehavior.estimate;
    const mimicRetreat = lerp(155, 55, aggressive);
    retreatHp = lerp(retreatHp, mimicRetreat, mimicBlend * lowHpKnowledge);
  }

  if (target) {
    const dx = target.x - fighter.x;
    const distance = dist(fighter, target);
    const idealX = target.x - Math.sign(dx || 1) * desired;
    if (Math.abs(distance - desired) > 45) goalX = idealX;
    const flankBias = coachingBias("flankScout");
    if (flankBias && game.mode === "conquest" && dist(fighter, player) < 700) {
      goalX += Math.sign(target.x - player.x || fighter.facing) * 180 * flankBias;
    }
    const lead = preset.prediction * Math.min(.5, distance / 1500);
    const tx = target.x + SIZE / 2 + (target.vx || 0) * lead;
    const ty = target.y + SIZE / 2 + (target.vy || 0) * lead;
    // Desired aim includes competence error; smoothing moves the crosshair toward it.
    // PrecisionAim only trims this cone when the buddy is holding a marksman/sniper
    // (evidence from those Training fights); pulse/carbine and enemy trainers skip it.
    let aimError = preset.aim;
    if (fighter.buddy) {
      aimError *= precisionAimErrorScale(learned, fighter);
    }
    let aimAngle = Math.atan2(ty - fighter.y - SIZE / 2, tx - fighter.x - SIZE / 2)
      + (Math.random() - .5) * aimError;
    if (fighter.buddy) {
      const aimSkill = evidenceReliability(learned.capabilities.aim);
      const delta = angleDiff(aimAngle, fighter.aim);
      // Subtle flick overshoot while untrained; fades as aim competence grows.
      const overshoot = Math.sign(delta || 1)
        * ROOKIE_BUDDY.overshoot
        * (1 - aimSkill)
        * Math.min(1, Math.abs(delta) / 1.2);
      aimAngle += overshoot;
    } else if (greenEnemy) {
      const delta = angleDiff(aimAngle, fighter.aim);
      const overAmt = fighter.ai === "recruit"
        ? ENEMY_GREEN.recruitOvershoot
        : ENEMY_GREEN.overshoot;
      aimAngle += Math.sign(delta || 1)
        * overAmt
        * Math.min(1, Math.abs(delta) / 1.2);
    }
    state.desiredAim = aimAngle;
    state.attack = visible.includes(target) && distance < reach;
    // Clueless buddies hesitate on the trigger even when a foe is in reach.
    if (fighter.buddy && state.attack) {
      const aimSkill = evidenceReliability(learned.capabilities.aim);
      const fireReady = lerp(1 - ROOKIE_BUDDY.fireHesitation, 1, aimSkill);
      if (Math.random() > fireReady) {
        state.attack = false;
        state.plan = "hesitating to shoot";
      }
    } else if (greenEnemy && state.attack) {
      const hesitate = fighter.ai === "recruit"
        ? ENEMY_GREEN.recruitFireHesitation
        : ENEMY_GREEN.fireHesitation;
      if (Math.random() < hesitate) {
        state.attack = false;
        state.plan = "hesitating to shoot";
      }
    }
    if (
      fighter.buddy && !isMimic && game.mode === "training" && playerDodgeKnowledge > .4
      && learned.habits.dodgeTiming.estimate > .55 && target.dodgeCd > .9
    ) {
      // Hold the predicted follow-up until the player's dodge protection ends.
      state.attack = false;
      state.plan = "waiting out predicted dodge";
    }
    // Only a somewhat-trained buddy knows to back out of point-blank gunfights.
    const keepsDistance = !fighter.buddy || rangeKnowledge > .3;
    if (distance < 150 && fighter.weapon === "gun" && keepsDistance) {
      goalX = fighter.x - Math.sign(dx) * 220;
    }
    state.plan = distance > desired + 100
      ? "closing safely"
      : "pressing target";
  } else {
    state.attack = false;
    state.plan = "searching last sighting";
  }

  // No eyes on an enemy: preferentially break visible power crates while searching.
  // Visible foes always keep combat priority (crate farming must not override).
  const hasVisibleEnemy = visible.length > 0;
  if (!hasVisibleEnemy) {
    const lootCrate = pickNearestVisibleCrate(game, fighter);
    if (lootCrate) {
      goalX = lootCrate.x;
      state.desiredAim = aimAtPowerCrate(fighter, lootCrate);
      const crateDist = dist(fighter, lootCrate);
      state.attack = crateDist < reach;
      state.plan = "looting power crate";
      state.jump = fighter.grounded && lootCrate.y < fighter.y - 120;
    }
  }

  state.mx = Math.abs(goalX - fighter.x) > 32 ? Math.sign(goalX - fighter.x) : 0;
  if (hasVisibleEnemy || state.plan !== "looting power crate") {
    state.jump = !!target && target.y < fighter.y - 150 && fighter.grounded;
  }
  const verticalNeed = target && target.y < fighter.y - 100;
  const saveFuel = coachingBias("saveFuel");
  const useJetpack = coachingBias("useJetpack");
  let fuelCare = clamp(preset.fuelCare + saveFuel * .35 - useJetpack * .2, .05, .95);
  if (
    isMimic && mimicBlend > 0 && jetKnowledge > .15
    && learned.habits.jetpackUse.estimate !== null
  ) {
    // Copy jet habit: high estimate → burn more freely; low → thriftier.
    const jetEst = learned.habits.jetpackUse.estimate;
    fuelCare = clamp(
      lerp(fuelCare, lerp(.88, .1, jetEst), mimicBlend * jetKnowledge),
      .05,
      .95
    );
  }
  state.jet = !!verticalNeed
    && fighter.fuel > fuelCare * .35
    && (!target || dist(fighter, target) < SIGHT);
  if (
    target && useJetpack > 0 && !fighter.grounded && fighter.fuel > fuelCare * .25
    && (target.y < fighter.y - 40 || dist(fighter, target) > desired + 180)
  ) {
    state.jet = Math.random() < useJetpack;
  }
  if (
    fighter.buddy && game.mode === "conquest" && player.thrusting
    && jetKnowledge > .4 && learned.habits.jetpackUse.estimate > .5
    && fighter.fuel > fuelCare * .35
  ) {
    if (isMimic) {
      // Soft safety: Full Mimic still hesitates to mirror-suicide on fumes.
      const safeToMirror = fighter.hp > 120 || fighter.fuel > .45;
      if (safeToMirror || Math.random() > MIMIC_TEAM_SAFETY) state.jet = true;
    } else {
      state.jet = true;
    }
  }
  // Untrained buddies burn fuel on pointless mid-air bursts.
  if (
    fighter.buddy && !fighter.grounded && fighter.fuel > .05
    && Math.random() < ROOKIE_BUDDY.fuelWaste * (1 - fuelSkill) * .35 * (1 - saveFuel)
  ) {
    state.jet = true;
  }
  // Green Conquest enemies waste fuel too (recruit worse); no player evidence gate.
  if (
    greenEnemy && !fighter.grounded && fighter.fuel > .05
    && Math.random() < (
      fighter.ai === "recruit" ? ENEMY_GREEN.recruitFuelWaste : ENEMY_GREEN.fuelWaste
    ) * .35
  ) {
    state.jet = true;
  }
  if (fighter.y > 1300 && !fighter.grounded && fighter.fuel > .12) state.jet = true;
  // Never fight the lockout: wait for the reserve to rebuild, then retry.
  if (fighter.jetLocked) state.jet = false;

  // Threat-reactive dodge (projectiles / saber / recent fire). Respects CD & i-frames.
  // Buddy commit chance scales with dodgeTiming evidence; empty profiles rarely dash.
  // Conquest escape must not starve trained dodges when severity is high.
  const visibleThreat = target && visible.includes(target) ? target : null;
  const dodgeInfo = evaluateDodgeThreat(fighter, visibleThreat, game, visible);
  const dodgeBias = coachingBias("dodgeMore");
  const dodgeEst = learned.habits.dodgeTiming.estimate;
  const canDodge = fighter.dodgeCd <= 0 && (fighter.iframe || 0) <= 0;
  const commitChance = dodgeCommitChance({
    aiId: fighter.ai || "balanced",
    isBuddy: !!fighter.buddy,
    isMimic,
    mimicBlend,
    playerDodgeKnowledge,
    dodgeEstimate: dodgeEst,
    dodgeSkill,
    dodgeBias,
    presetChange: preset.change,
    threatSeverity: dodgeInfo.severity
  });
  let wantDodge = canDodge && Math.random() < commitChance;
  // High danger / medium reads may dash without a hard target lock; idle panic needs a foe.
  if (dodgeInfo.severity < 1 && !visibleThreat) {
    wantDodge = false;
  }
  state.dodge = wantDodge;
  if (state.dodge && dodgeInfo.severity >= 2) state.attack = false;

  // Retreat is a short-lived plan, not another spacing hint. It owns movement,
  // jet use, and attack priority until separation, a safe position, or a timed
  // re-evaluation. Threats come only from current/last-known sight information.
  const threat = target || state.lastKnown;
  if (state.escape && threat) {
    const safeDistance = state.escape.threatWeapon === "saber" ? 380 : 680;
    if (
      dist(fighter, threat) >= safeDistance
      || reachedSafePlatform(fighter, threat, game)
      || (game.elapsed || 0) >= state.escape.until
    ) {
      state.escape = null;
    }
  } else if (state.escape) {
    state.escape = null;
  }

  if (threat && !state.escape) {
    const threatDistance = dist(fighter, threat);
    const threatReach = (threat.weapon || "gun") === "saber" ? 300 : 780;
    const closeEngagement = (threat.weapon || "gun") === "saber" ? 260 : 430;
    const critical = fighter.hp < retreatHp && threatDistance < threatReach;
    const badlyLosing = fighter.hp + 120 < (threat.hp || 500)
      && threatDistance < closeEngagement;
    if (critical || badlyLosing || (priorRetreatDecision && threatDistance < threatReach)) {
      state.escape = makeEscapePlan(fighter, threat, game, learned, basePreset);
    }
  }

  if (state.escape && threat) {
    const escape = state.escape;
    const newlyBlocked = escapeBlock(fighter, escape.direction, game);
    if (newlyBlocked && !escape.blockedBy) {
      escape.blockedBy = newlyBlocked;
      escape.direction = escapeBlock(fighter, -escape.direction, game)
        ? Math.sign(WORLD.w / 2 - fighter.x || -escape.direction)
        : -escape.direction;
      escape.targetX = clamp(
        fighter.x + escape.direction * 420,
        EDGE_MARGIN,
        WORLD.w - SIZE - EDGE_MARGIN
      );
      logEscape(game, `Retreated inward: the ${newlyBlocked} blocked my escape`);
      if (trustedJetEscape(fighter, learned, basePreset)) {
        const elevated = elevatedEscapeTarget(fighter, threat, escape.direction, game);
        escape.vertical = true;
        escape.targetX = elevated.x;
        escape.targetY = elevated.y;
        escape.startY = fighter.y;
        logEscape(game, "Used a vertical escape: I had enough fuel and trusted that route");
      }
    }

    goalX = escape.targetX;
    state.mx = Math.abs(goalX - fighter.x) > 24
      ? Math.sign(goalX - fighter.x)
      : escape.direction;
    state.jump = fighter.grounded && (!!escape.blockedBy || escape.vertical);
    state.jet = escape.vertical
      && !fighter.jetLocked
      && fighter.fuel > JET_ESCAPE_RESERVE
      && fighter.y > escape.targetY
      && escape.startY - fighter.y < 380;
    const selfDefenseRange = fighter.weapon === "saber" ? reach : Math.min(320, reach);
    const defending = visible.includes(target) && dist(fighter, target) <= selfDefenseRange;
    state.attack = defending;
    // Escape no longer starves dodges: high threat still preempts; wall-pin keeps a dash.
    const wallPinDodge = !escape.vertical
      && !!escape.blockedBy
      && canDodge
      && dist(fighter, threat) < 145;
    if (dodgeInfo.severity >= 2) {
      state.dodge = canDodge && (wantDodge || Math.random() < commitChance);
      if (state.dodge) state.attack = false;
    } else if (dodgeInfo.severity >= 1) {
      state.dodge = canDodge && (wantDodge || wallPinDodge);
    } else {
      state.dodge = wallPinDodge;
    }
    state.plan = escape.vertical ? "vertical escape" : "covering retreat";

    // Low-HP retreat hops: brief detour to a nearby visible crate, then resume escape.
    // Never overrides close self-defense or imminent high-severity dodges.
    const maxHp = Math.max(1, fighter.maxHp || 500);
    const wantsHealHop = fighter.hp < retreatHp
      || fighter.hp / maxHp < CRATE_ESCAPE_HP_FRAC;
    if (wantsHealHop && !defending && dodgeInfo.severity < 2 && !state.dodge) {
      const hopCrate = pickEscapeCrateHop(fighter, game, escape);
      if (hopCrate) {
        goalX = hopCrate.x;
        state.mx = Math.abs(goalX - fighter.x) > 24
          ? Math.sign(goalX - fighter.x)
          : escape.direction;
        state.desiredAim = aimAtPowerCrate(fighter, hopCrate);
        if (dist(fighter, hopCrate) < reach) {
          state.attack = true;
        }
        if (fighter.grounded && hopCrate.y < fighter.y - 100) {
          state.jump = true;
        }
        state.plan = "retreat crate hop";
      }
    }
  }
  // Mechanical Modularity: rifle at range, sword close, shield under fire.
  if (isModularWeapon(fighter) && !fighter.modularMorphing) {
    const threatFoe = visibleThreat || (target && visible.includes(target) ? target : null);
    const threatInfo = evaluateShieldThreat(fighter, threatFoe, game, visible);
    const underFire = dodgeInfo.severity >= 2
      || threatInfo.severity >= 2
      || (threatInfo.severity >= 1 && fighter.hp < 180);
    let wantMode = fighter.modularMode || "sword";
    if (underFire) {
      wantMode = "shield";
    } else if (target && visible.includes(target)) {
      const d = dist(fighter, target);
      if (d > 340) wantMode = "rifle";
      else if (d < 160) wantMode = "sword";
      else wantMode = fighter.modularMode === "shield" ? "rifle" : (fighter.modularMode || "rifle");
    } else if (fighter.modularMode === "shield") {
      wantMode = "rifle";
    }
    if (wantMode !== fighter.modularMode) {
      beginModularMorph(fighter, wantMode);
    }
  }
  if (fighter.modularMorphing || fighter.modularMode === "shield") {
    state.attack = false;
  }

  // Adaptive Nanotech Unit: sword close, sniper long range, rifle mid — R cycles.
  if (isAdaptiveNanotechWeapon(fighter) && !fighter.adaptiveMorphing) {
    let wantMode = fighter.adaptiveMode || "sword";
    if (target && visible.includes(target)) {
      const d = dist(fighter, target);
      if (d < 160) wantMode = "sword";
      else if (d > 500) wantMode = "sniper";
      else wantMode = "rifle";
    }
    if (wantMode !== fighter.adaptiveMode) {
      beginAdaptiveMorph(fighter, wantMode);
    }
  }
  if (fighter.adaptiveMorphing) {
    state.attack = false;
  }

  // Enemy trainers stay on the baseline tactical shield policy (bias 0).
  // Buddies blend toward player shieldUse; Mimic scales by intensity blend.
  let shieldBias = 0;
  if (fighter.buddy) {
    const shieldEst = learned.habits.shieldUse.estimate;
    const styleBlend = isMimic ? mimicBlend : 1;
    shieldBias = shieldStyleBias(shieldEst, shieldKnowledge, styleBlend);
  }
  state.shieldStyleBias = shieldBias;
  state.shieldCompetence = fighter.buddy ? shieldKnowledge : 1;
  updateAiShield(fighter, state, game, visible, target, fighter.ai || "balanced", shieldBias);
  updateAiRetractableArmor(
    fighter, state, game, visible, target, fighter.ai || "balanced"
  );
  updateAiNanotech(fighter, state, game, visible, target);
  stepAimSmoothing(fighter, dt, turnRate);
  return state;
}
