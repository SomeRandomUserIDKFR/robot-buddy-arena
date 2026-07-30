/**
 * Independent buddy fight styles (tactical posture).
 *
 * Orthogonal to mind (Flash/Balanced/Thinker/Mimic motor tempo) and to
 * character identity (voice/name). Styles bias spacing, protect, retreat,
 * shield willingness, and cover-tool eagerness — not aimTurnRate/reaction.
 */

import { getBuddyCharacter } from "./buddy-characters.js";

export const FIGHT_STYLES = Object.freeze([
  Object.freeze({
    id: "balanced",
    name: "Balanced",
    blurb: "Default mix of pressure and backup.",
    bias: Object.freeze({
      desiredGun: 0,
      desiredSaber: 0,
      protect: 0,
      retreatHp: 0,
      followPlayer: 0,
      pingBoost: 0,
      shield: 0,
      coverEager: 0
    })
  }),
  Object.freeze({
    id: "rusher",
    name: "Rusher",
    blurb: "Closes hard. Late retreats, light shields.",
    bias: Object.freeze({
      desiredGun: -150,
      desiredSaber: -40,
      protect: -0.12,
      retreatHp: -50,
      followPlayer: 0,
      pingBoost: 0.05,
      shield: -0.28,
      coverEager: -0.15
    })
  }),
  Object.freeze({
    id: "defender",
    name: "Defender",
    blurb: "Holds the line. Earlier peels, heavier shields.",
    bias: Object.freeze({
      desiredGun: 55,
      desiredSaber: 10,
      protect: 0.22,
      retreatHp: 55,
      followPlayer: 0.28,
      pingBoost: 0.1,
      shield: 0.42,
      coverEager: 0.2
    })
  }),
  Object.freeze({
    id: "coverer",
    name: "Coverer",
    blurb: "Backline fire. Makes space and rebuilds cover.",
    bias: Object.freeze({
      desiredGun: 140,
      desiredSaber: 25,
      protect: 0.08,
      retreatHp: 25,
      followPlayer: 0.12,
      pingBoost: 0.08,
      shield: 0.18,
      coverEager: 0.55
    })
  }),
  Object.freeze({
    id: "support",
    name: "Support",
    blurb: "Stays near you. Answers pings and covers flanks.",
    bias: Object.freeze({
      desiredGun: 35,
      desiredSaber: 8,
      protect: 0.38,
      retreatHp: 20,
      followPlayer: 0.55,
      pingBoost: 0.4,
      shield: 0.12,
      coverEager: 0.22
    })
  })
]);

export const FIGHT_STYLES_BY_ID = Object.freeze(
  Object.fromEntries(FIGHT_STYLES.map((style) => [style.id, style]))
);

export function listFightStyles() {
  return FIGHT_STYLES.slice();
}

export function normalizeFightStyle(value) {
  const id = typeof value === "string" ? value.trim().toLowerCase() : "";
  return FIGHT_STYLES_BY_ID[id] ? id : "balanced";
}

export function getFightStyle(profileOrId) {
  const id = typeof profileOrId === "string"
    ? normalizeFightStyle(profileOrId)
    : normalizeFightStyle(profileOrId?.fightStyle);
  return FIGHT_STYLES_BY_ID[id] || FIGHT_STYLES_BY_ID.balanced;
}

/**
 * Ensure profile.fightStyle is a known id.
 * null/missing → character suggestedFightStyle when available, else balanced.
 */
export function ensureFightStyle(profile) {
  if (!profile || typeof profile !== "object") return FIGHT_STYLES_BY_ID.balanced;
  if (profile.fightStyle == null || profile.fightStyle === "") {
    const character = getBuddyCharacter(profile);
    profile.fightStyle = character.suggestedFightStyle || "balanced";
  }
  profile.fightStyle = normalizeFightStyle(profile.fightStyle);
  return getFightStyle(profile);
}

export function selectFightStyle(profile, styleId) {
  if (!profile) return false;
  const id = normalizeFightStyle(styleId);
  if (!FIGHT_STYLES_BY_ID[id]) return false;
  profile.fightStyle = id;
  return true;
}

/**
 * Soft spacing / protect deltas for a style. Weapon-aware desired range.
 */
export function fightStyleSpacingBias(styleOrId, weapon) {
  const style = typeof styleOrId === "string"
    ? getFightStyle(styleOrId)
    : (styleOrId || FIGHT_STYLES_BY_ID.balanced);
  const bias = style.bias || FIGHT_STYLES_BY_ID.balanced.bias;
  const desiredDelta = weapon === "saber" ? bias.desiredSaber : bias.desiredGun;
  return {
    desiredDelta: Number(desiredDelta) || 0,
    protectDelta: Number(bias.protect) || 0,
    retreatHpDelta: Number(bias.retreatHp) || 0,
    followPlayer: Number(bias.followPlayer) || 0,
    pingBoost: Number(bias.pingBoost) || 0,
    shield: Number(bias.shield) || 0,
    coverEager: Number(bias.coverEager) || 0
  };
}
