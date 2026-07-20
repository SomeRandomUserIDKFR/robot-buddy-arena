/**
 * Local offline game FAQ: classify player questions, match curated answers,
 * never invent mechanics. MiniLM (optional) only ranks against this pack.
 */

export const FAQ_TOPIC_CHIPS = Object.freeze([
  "Controls",
  "Learning",
  "Vision",
  "Shop",
  "Jetpack",
  "Maps",
  "Power-ups"
]);

const TOPIC_CHIP_PROMPTS = Object.freeze({
  Controls: "What are the controls?",
  Learning: "How does learning work?",
  Vision: "How does fog of war work?",
  Shop: "What is Cyber and how does the shop work?",
  Jetpack: "How does jetpack fuel work?",
  Maps: "What maps are there?",
  "Power-ups": "How do power-ups work?"
});

function normalizeFaqText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/\b(can't|cannot)\b/g, "can not")
    .replace(/\b(don't|dont)\b/g, "dont")
    .replace(/\b(what's|whats)\b/g, "what is")
    .replace(/\b(i'm|im)\b/g, "i am")
    .replace(/\b(that's)\b/g, "thats")
    .replace(/\b(isn't)\b/g, "is not")
    .replace(/\b(you're)\b/g, "you are")
    .replace(/[^a-z0-9'\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const QUESTION_CUES = [
  "what", "how", "why", "when", "where", "which", "who",
  "explain", "tell me", "difference", "does", "do i", "do you", "can i",
  "can you tell", "is there", "are there", "meaning of", "mean by"
];

const COACHING_IMPERATIVE = [
  "stay close", "hang back", "play safer", "play safe", "rush", "push with",
  "focus my", "dodge more", "flank", "scout ahead", "save fuel", "use the jetpack",
  "use jetpack", "cover me", "follow me", "stick with", "fall back", "back off",
  "practice", "try to", "i want you to", "could you", "please", "next time"
];

const GAME_TOPIC_TERMS = new Set([
  "control", "controls", "key", "keys", "keyboard", "mouse", "jump", "dodge",
  "dash", "ping", "pause", "escape", "training", "conquest", "cyber", "shop",
  "equipment", "loadout", "slot", "helmet", "armor", "weapon", "weapons",
  "gun", "guns", "rifle", "sniper", "snipers", "saber", "sabers", "dagger",
  "daggers", "melee", "jetpack", "fuel", "exhausted", "ceiling", "fog",
  "vision", "sight", "arrow", "arrows", "outline", "readiness", "ready",
  "learning", "evidence", "xp", "mind", "flash", "balanced", "thinker", "mimic",
  "minilm", "analyzer", "offline", "wipe", "win", "victory", "currency",
  "suggested", "autonomy", "mode", "modes", "shield", "shields", "block",
  "blocking", "buckler", "bulwark", "intensity", "style", "spar", "lock",
  "locked", "gattler", "laser", "hitscan", "beam", "perk", "perks", "level",
  "exp", "experience", "milestone", "tradeoff", "map", "maps", "battlefield",
  "desert", "forest", "city", "docks", "ruins", "yard", "cover", "breakable",
  "cactus", "tree", "crate", "powerup", "power-up", "buff", "loot"
]);

let packCache = null;
let packPromise = null;

function tokenize(text) {
  return normalizeFaqText(text)
    .split(" ")
    .filter((token) => token.length > 1);
}

function uniqueTerms(text) {
  return [...new Set(tokenize(text))];
}

export function topicChipPrompt(label) {
  return TOPIC_CHIP_PROMPTS[label] || `Tell me about ${label}`;
}

export async function loadGameFaqPack() {
  if (packCache) return packCache;
  if (packPromise) return packPromise;
  packPromise = (async () => {
    try {
      const response = await fetch(new URL("./knowledge/game-faq.json", import.meta.url), {
        cache: "no-store"
      });
      if (!response.ok) throw new Error(`FAQ HTTP ${response.status}`);
      const data = await response.json();
      if (!Array.isArray(data?.entries) || !data.entries.length) {
        throw new Error("FAQ pack empty");
      }
      packCache = {
        version: data.version || 1,
        topics: data.topics || [],
        unknownHints: data.unknownHints || FAQ_TOPIC_CHIPS.slice(),
        entries: data.entries.map((entry) => ({
          id: String(entry.id),
          tags: Array.isArray(entry.tags) ? entry.tags.map(String) : [],
          questions: Array.isArray(entry.questions) ? entry.questions.map(String) : [],
          answer: String(entry.answer || "").trim()
        })).filter((entry) => entry.id && entry.answer && entry.questions.length)
      };
      return packCache;
    } catch (error) {
      packCache = null;
      throw error;
    } finally {
      packPromise = null;
    }
  })();
  return packPromise;
}

/** Sync accessor for tests that inject a pack. */
export function setGameFaqPackForTests(pack) {
  packCache = pack;
  packPromise = null;
}

export function getGameFaqPack() {
  return packCache;
}

export function faqEntryCount(pack = packCache) {
  return pack?.entries?.length || 0;
}

/**
 * Route player text: question about the game vs coaching command vs ambiguous.
 * Approval/denial/empty stay on the coaching path (handled by coachingReply).
 */
export function classifyBuddyMessage(text) {
  const clean = normalizeFaqText(text);
  if (!clean) return { route: "empty", normalized: clean };

  const hasQuestionMark = /\?/.test(String(text || ""));
  const questionCue = QUESTION_CUES.some((cue) => {
    if (cue.includes(" ")) return clean.includes(cue);
    return new RegExp(`\\b${cue}\\b`).test(clean);
  });
  const looksLikeQuestion = hasQuestionMark || questionCue
    || /^(?:tell me about|explain)\b/.test(clean);

  const coachingCue = COACHING_IMPERATIVE.some((phrase) => clean.includes(phrase))
    || (
      /\b(?:stay|hang|play|rush|push|focus|dodge|flank|scout|save|conserve|follow|cover|retreat|disengage)\b/.test(clean)
      && /\b(?:me|my|you|your|us|we|buddy)\b/.test(clean)
    );

  const topicHit = uniqueTerms(clean).some((token) => GAME_TOPIC_TERMS.has(token)
    || [...GAME_TOPIC_TERMS].some((term) => term.startsWith(token) && token.length >= 4));

  const shortTopicAsk = !coachingCue && topicHit && clean.split(" ").length <= 6
    && clean.split(" ").length >= 2
    && !/\b(?:stay|play|rush|focus|dodge|flank|save|use|follow)\b/.test(clean);

  if (looksLikeQuestion && coachingCue && topicHit) {
    return { route: "ambiguous", normalized: clean, reason: "question-and-directive" };
  }
  if (looksLikeQuestion || shortTopicAsk) {
    if (coachingCue && !hasQuestionMark && !/\b(?:how|what|why|explain|difference|mean)\b/.test(clean)) {
      return { route: "coaching", normalized: clean, reason: "imperative-question-form" };
    }
    if (coachingCue && /\b(?:how do i|how can i|what (?:are|is)|explain|difference)\b/.test(clean)) {
      return { route: "question", normalized: clean, reason: "game-how-to" };
    }
    if (coachingCue && looksLikeQuestion && !/\b(?:how|what|why|explain|difference|tell me about)\b/.test(clean)) {
      return { route: "ambiguous", normalized: clean, reason: "polite-imperative" };
    }
    return { route: "question", normalized: clean, reason: looksLikeQuestion ? "question-cue" : "topic-ask" };
  }
  if (coachingCue) {
    return { route: "coaching", normalized: clean, reason: "directive-cue" };
  }
  if (topicHit && clean.split(" ").length <= 8) {
    return { route: "ambiguous", normalized: clean, reason: "bare-topic" };
  }
  return { route: "coaching", normalized: clean, reason: "default-coaching" };
}

const STOP_TERMS = new Set([
  "a", "an", "the", "is", "are", "do", "does", "did", "to", "of", "in", "on",
  "for", "my", "me", "i", "you", "your", "and", "or", "what", "how", "why",
  "when", "where", "which", "who", "can", "about", "with", "from", "that",
  "this", "it", "key", "keys", "button", "buttons"
]);

function contentTerms(text) {
  return uniqueTerms(text).filter((term) => !STOP_TERMS.has(term) && term.length > 1);
}

function phraseOverlapScore(query, exemplar) {
  const qTerms = contentTerms(query);
  const eTerms = contentTerms(exemplar);
  if (!qTerms.length || !eTerms.length) return 0;
  const eSet = new Set(eTerms);
  let hits = 0;
  for (const term of qTerms) {
    if (eSet.has(term)) hits += 1;
    else if ([...eSet].some((other) => other.includes(term) || term.includes(other))) hits += 0.55;
  }
  const coverage = hits / Math.max(qTerms.length, 1);
  const density = hits / Math.max(eTerms.length, 1);
  return Math.min(1, coverage * 0.78 + density * 0.4);
}

/**
 * Deterministic FAQ ranking. Optional semanticScores: { [faqId]: 0..1 }.
 */
export function matchGameFaq(text, pack, semanticScores = null) {
  const entries = pack?.entries || [];
  if (!entries.length) {
    return { type: "unknown", confidence: 0, entry: null, scores: {} };
  }
  const clean = normalizeFaqText(text);
  const scores = {};
  for (const entry of entries) {
    let best = 0;
    for (const question of entry.questions) {
      best = Math.max(best, phraseOverlapScore(clean, question));
    }
    for (const tag of entry.tags) {
      if (containsWord(clean, tag)) best = Math.max(best, 0.42);
    }
    const semantic = Number(semanticScores?.[entry.id]);
    if (Number.isFinite(semantic) && semantic >= 0.34) {
      if (best > 0) best = Math.min(1, best * 0.55 + semantic * 0.55);
      else if (semantic >= 0.48) best = semantic * 0.78;
    }
    scores[entry.id] = best;
  }
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [topId, topScore] = ranked[0] || [null, 0];
  const second = ranked[1]?.[1] || 0;
  if (!topId || topScore < 0.38) {
    return { type: "unknown", confidence: topScore || 0, entry: null, scores, ranked };
  }
  if (topScore < 0.48 && topScore - second < 0.08) {
    return { type: "unknown", confidence: topScore, entry: null, scores, ranked };
  }
  const entry = entries.find((item) => item.id === topId);
  return {
    type: "match",
    confidence: topScore,
    level: topScore >= 0.62 ? "high" : "medium",
    entry,
    scores,
    ranked
  };
}

function containsWord(text, word) {
  const needle = normalizeFaqText(word);
  if (!needle) return false;
  return new RegExp(`\\b${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(text);
}

export function composeFaqReply(match, pack, coaching = null) {
  const hints = (pack?.unknownHints || FAQ_TOPIC_CHIPS).slice(0, 5);
  if (!match || match.type !== "match" || !match.entry) {
    return chooseUnknown(coaching, hints);
  }
  return chooseKnown(coaching, match.entry.answer);
}

function nextVariant(coaching, group, variants) {
  if (!coaching || typeof coaching !== "object") {
    return variants[0];
  }
  coaching.responseVariants ||= {};
  const previous = Number(coaching.responseVariants[group]);
  const next = Number.isInteger(previous) ? (previous + 1) % variants.length : 0;
  coaching.responseVariants[group] = next;
  return variants[next];
}

function chooseKnown(coaching, answer) {
  return nextVariant(coaching, "faqAnswer", [
    answer,
    `From what I know: ${answer}`,
    `Here is the curated answer I have: ${answer}`
  ]);
}

function chooseUnknown(coaching, hints) {
  const prompt = hints.join(", ");
  return nextVariant(coaching, "faqUnknown", [
    `I am not sure I have a reliable answer for that. Try rephrasing, or ask about ${prompt}.`,
    `I do not want to invent a rule. Ask another way, or pick a topic like ${prompt}.`,
    `That is outside my local FAQ confidence. Rephrase the question, or try ${prompt}.`
  ]);
}

export function composeAmbiguousRouteReply(coaching = null) {
  return nextVariant(coaching, "faqAmbiguous", [
    "Are you asking about how the game works, or telling me how you want me to play?",
    "Just to be sure: is that a question about the game, or a coaching instruction for me?",
    "I can answer a game question or take a practice request—which did you mean?"
  ]);
}

export function faqQuickReplies(match) {
  if (match?.type === "match") {
    return FAQ_TOPIC_CHIPS.filter((chip) => {
      const tags = match.entry?.tags || [];
      return !tags.includes(chip.toLowerCase());
    }).slice(0, 3);
  }
  return FAQ_TOPIC_CHIPS.slice();
}
