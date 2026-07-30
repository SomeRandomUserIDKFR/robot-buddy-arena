/**
 * Selectable buddy identity / character.
 *
 * Combat AI mind (Flash/Balanced/…) and fight style (Rusher/Defender/…) stay
 * separate. Characters change voice, default name, and post-match flavor —
 * plus a soft suggested fight style (never locked).
 */

export const BUDDY_CHARACTERS = Object.freeze([
  Object.freeze({
    id: "pixel",
    name: "Pixel",
    blurb: "Bright rookie scout. Celebrates small gains.",
    accent: "#42dff5",
    suggestedFightStyle: "balanced",
    voice: Object.freeze({
      tone: "upbeat",
      catchphrases: Object.freeze(["Nice read.", "Solid.", "Ooh, noted."]),
      avoidExclaim: false,
      preferWe: false,
      openerChance: 0.28
    })
  }),
  Object.freeze({
    id: "atlas",
    name: "Atlas",
    blurb: "Calm protector. Talks in we, keeps the line steady.",
    accent: "#7ddca9",
    suggestedFightStyle: "defender",
    voice: Object.freeze({
      tone: "steady",
      catchphrases: Object.freeze(["Steady.", "I've got your flank.", "We hold."]),
      avoidExclaim: true,
      preferWe: true,
      openerChance: 0.32
    })
  }),
  Object.freeze({
    id: "quip",
    name: "Quip",
    blurb: "Dry tactician. Softens losses without mocking you.",
    accent: "#ffb020",
    suggestedFightStyle: "coverer",
    voice: Object.freeze({
      tone: "dry",
      catchphrases: Object.freeze(["Rough.", "That tracks.", "Noted, regrettably."]),
      avoidExclaim: true,
      preferWe: false,
      openerChance: 0.3
    })
  }),
  Object.freeze({
    id: "nova",
    name: "Nova",
    blurb: "Arena firebrand. Punchy, loud, always pushing.",
    accent: "#ff6b5a",
    suggestedFightStyle: "rusher",
    voice: Object.freeze({
      tone: "fiery",
      catchphrases: Object.freeze(["Light it up!", "Let's go!", "More of that!"]),
      avoidExclaim: false,
      preferWe: false,
      openerChance: 0.38
    })
  }),
  Object.freeze({
    id: "sage",
    name: "Sage",
    blurb: "Patient analyst. Precise, evidence-first.",
    accent: "#9a8cff",
    suggestedFightStyle: "coverer",
    voice: Object.freeze({
      tone: "precise",
      catchphrases: Object.freeze(["Assessment:", "Observation:", "Data point:"]),
      avoidExclaim: true,
      preferWe: false,
      openerChance: 0.34
    })
  }),
  Object.freeze({
    id: "patch",
    name: "Patch",
    blurb: "Friendly wrench. Treats practice like tune-ups.",
    accent: "#3dff7a",
    suggestedFightStyle: "support",
    voice: Object.freeze({
      tone: "warm",
      catchphrases: Object.freeze(["Quick tune-up.", "Easy fix.", "We'll recalibrate."]),
      avoidExclaim: false,
      preferWe: true,
      openerChance: 0.3
    })
  }),
  Object.freeze({
    id: "rook",
    name: "Rook",
    blurb: "Disciplined squadmate. Short calls, no fluff.",
    accent: "#c9dde6",
    suggestedFightStyle: "support",
    voice: Object.freeze({
      tone: "terse",
      catchphrases: Object.freeze(["Status:", "Copy.", "On it."]),
      avoidExclaim: true,
      preferWe: false,
      openerChance: 0.26
    })
  }),
  Object.freeze({
    id: "echo",
    name: "Echo",
    blurb: "Curious mirror. Reflects your habits back at you.",
    accent: "#2ab8c8",
    suggestedFightStyle: "balanced",
    voice: Object.freeze({
      tone: "curious",
      catchphrases: Object.freeze(["What I'm seeing…", "Interesting.", "Pattern noted."]),
      avoidExclaim: false,
      preferWe: false,
      openerChance: 0.3
    })
  })
]);

export const BUDDY_CHARACTERS_BY_ID = Object.freeze(
  Object.fromEntries(BUDDY_CHARACTERS.map((c) => [c.id, c]))
);

export function listBuddyCharacters() {
  return BUDDY_CHARACTERS.slice();
}

export function normalizeBuddyCharacterId(value) {
  const id = typeof value === "string" ? value.trim().toLowerCase() : "";
  return BUDDY_CHARACTERS_BY_ID[id] ? id : null;
}

export function getBuddyCharacter(profileOrId) {
  const id = typeof profileOrId === "string"
    ? normalizeBuddyCharacterId(profileOrId)
    : normalizeBuddyCharacterId(profileOrId?.buddyCharacterId);
  return BUDDY_CHARACTERS_BY_ID[id] || BUDDY_CHARACTERS[0];
}

export function pickRandomBuddyCharacter(random = Math.random) {
  const i = Math.floor(Math.max(0, Math.min(0.999999, Number(random()) || 0)) * BUDDY_CHARACTERS.length);
  return BUDDY_CHARACTERS[i] || BUDDY_CHARACTERS[0];
}

/**
 * Ensure profile has a valid buddyCharacterId.
 * Missing/invalid → random. Optionally sync botName to the character name.
 */
export function ensureBuddyCharacter(profile, random = Math.random, options = {}) {
  if (!profile || typeof profile !== "object") return BUDDY_CHARACTERS[0];
  const syncName = options.syncName !== false;
  let id = normalizeBuddyCharacterId(profile.buddyCharacterId);
  let assigned = false;
  if (!id) {
    const picked = pickRandomBuddyCharacter(random);
    profile.buddyCharacterId = picked.id;
    id = picked.id;
    assigned = true;
  }
  const character = BUDDY_CHARACTERS_BY_ID[id];
  if (syncName && assigned) {
    const stockNames = new Set(BUDDY_CHARACTERS.map((c) => c.name));
    // Only overwrite empty / stock character names so custom nicknames stick.
    if (!profile.botName || stockNames.has(profile.botName)) {
      profile.botName = character.name;
    }
  }
  // First identity assign: soft-seed fight style from the character suggestion
  // when the player has not picked a style yet (null / missing).
  if (assigned && (profile.fightStyle == null || profile.fightStyle === "")) {
    profile.fightStyle = character.suggestedFightStyle || "balanced";
  }
  return character;
}

/** Select a character; updates id and default name. */
export function selectBuddyCharacter(profile, characterId, options = {}) {
  const id = normalizeBuddyCharacterId(characterId);
  if (!id || !profile) return false;
  const character = BUDDY_CHARACTERS_BY_ID[id];
  const previous = getBuddyCharacter(profile);
  profile.buddyCharacterId = id;
  const rename = options.rename !== false;
  if (rename) {
    const stockNames = new Set(BUDDY_CHARACTERS.map((c) => c.name));
    if (!profile.botName || stockNames.has(profile.botName) || profile.botName === previous.name) {
      profile.botName = character.name;
    }
  }
  // Soft style follow: only nudge when still on the previous character's
  // suggestion (or unset). A manual fight-style pick is left alone.
  if (options.syncFightStyle !== false) {
    const prevSuggested = previous.suggestedFightStyle || "balanced";
    const nextSuggested = character.suggestedFightStyle || "balanced";
    const current = profile.fightStyle;
    if (current == null || current === "" || current === prevSuggested) {
      profile.fightStyle = nextSuggested;
    }
  }
  return true;
}

function nextVariant(coaching, group, variants) {
  if (!variants?.length) return "";
  if (!coaching || typeof coaching !== "object") return variants[0];
  coaching.responseVariants ||= {};
  const previous = Number(coaching.responseVariants[group]);
  const next = Number.isInteger(previous) ? (previous + 1) % variants.length : 0;
  coaching.responseVariants[group] = next;
  return variants[next];
}

function applyPreferWe(text) {
  return String(text)
    .replace(/\bI stayed\b/g, "We stayed")
    .replace(/\bI got\b/g, "We got")
    .replace(/\bI edged\b/g, "We edged")
    .replace(/\bI contributed\b/g, "We contributed")
    .replace(/\bI own my part\b/g, "We own our part")
    .replace(/\bI'll\b/g, "We'll")
    .replace(/\bI am\b/g, "We are")
    .replace(/\bI'm\b/g, "We're");
}

/**
 * Soft voice pass for buddy dialogue. Preserves factual body; may add a
 * catchphrase opener and light pronoun/punctuation quirks.
 */
export function voiceBuddyText(profile, text, coaching = null) {
  const character = getBuddyCharacter(profile);
  let out = String(text || "").trim();
  if (!out) return out;

  if (character.voice.avoidExclaim) {
    out = out.replace(/!+/g, ".");
  }
  if (character.voice.preferWe) {
    out = applyPreferWe(out);
  }

  // Sage-style assessment labels already end with ':' — keep body intact.
  const chance = Number(character.voice.openerChance) || 0;
  const rollGroup = `voiceOpen:${character.id}`;
  // Deterministic-ish via variant counter: every Nth reply gets an opener.
  const variants = character.voice.catchphrases || [];
  if (variants.length && coaching) {
    coaching.responseVariants ||= {};
    const tick = Number(coaching.responseVariants[rollGroup]) || 0;
    coaching.responseVariants[rollGroup] = tick + 1;
    const every = Math.max(2, Math.round(1 / Math.max(0.15, chance)));
    if (tick % every === 0) {
      const phrase = nextVariant(coaching, `catch:${character.id}`, variants);
      if (phrase && !out.startsWith(phrase)) {
        // Colon openers glue without a second sentence break.
        out = phrase.endsWith(":") ? `${phrase} ${out}` : `${phrase} ${out}`;
      }
    }
  }

  return out;
}

/** Personalize narrative post-match lines; leave numeric/reward lines alone. */
export function personalizeResultLines(profile, lines) {
  const character = getBuddyCharacter(profile);
  const coaching = profile?.coaching || null;
  return (lines || []).map((line, index) => {
    const text = String(line || "");
    if (!text) return text;
    // Skip pure status / meter lines.
    if (/^\+?\d/.test(text) || /CYBER|EXP|Ranking|LVL\b/.test(text)) return text;
    let out = text;
    if (character.voice.preferWe) out = applyPreferWe(out);
    if (character.voice.avoidExclaim) out = out.replace(/!+/g, ".");
    // First narrative line can take a character-flavored beat.
    if (index === 0 && character.voice.catchphrases?.length) {
      const phrase = nextVariant(coaching, `result:${character.id}`, character.voice.catchphrases);
      if (phrase && !out.startsWith(phrase)) {
        out = phrase.endsWith(":") ? `${phrase} ${out}` : `${phrase} ${out}`;
      }
    }
    // Nova boosts energy on closers.
    if (character.id === "nova" && /together|adjust|try again|last longer/i.test(out)) {
      out = out.replace(/\.$/, "!");
    }
    // Rook shortens a bit.
    if (character.id === "rook") {
      out = out
        .replace(/\bThat was my fault\./g, "My mistake.")
        .replace(/\bLet's adjust and try again\./g, "Reset. Again.");
    }
    return out;
  });
}
