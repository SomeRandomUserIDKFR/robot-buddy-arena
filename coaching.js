import { clamp } from "./utils.js";
import {
  composeAmbiguousRouteReply, composeFaqReply, faqQuickReplies, getGameFaqPack,
  matchGameFaq, topicChipPrompt, FAQ_TOPIC_CHIPS
} from "./game-faq.js";

export const DIRECTIVES = {
  rush: {
    label: "engage more aggressively",
    confirm: "Do you mean: engage sooner and close distance more often?"
  },
  safer: {
    label: "play safer and retreat earlier",
    confirm: "Do you mean: play safer and retreat from bad fights earlier?"
  },
  stayClose: {
    label: "stay close and follow you",
    confirm: "Do you mean: stay closer to you and follow your movement?"
  },
  keepDistance: {
    label: "keep distance and provide cover",
    confirm: "Do you mean: keep some distance and cover you from range?"
  },
  saveFuel: {
    label: "save jetpack fuel",
    confirm: "Do you mean: conserve jetpack fuel for important movement?"
  },
  useJetpack: {
    label: "use the jetpack more",
    confirm: "Do you mean: use the jetpack more often to take useful positions?"
  },
  dodgeMore: {
    label: "dodge more",
    confirm: "Do you mean: practice dodging incoming attacks more often?"
  },
  flankScout: {
    label: "flank and scout",
    confirm: "Do you mean: look for side angles and scout ahead when it is safe?"
  },
  focusTargets: {
    label: "focus pings and marked targets",
    confirm: "Do you mean: prioritize your pings and marked targets?"
  }
};

const INTENT_RULES = {
  rush: {
    phrases: ["push with me", "charge in", "go in", "close gap", "close distance", "engage sooner", "start the engagement", "take the fight", "commit to the fight"],
    words: ["rush", "push", "charge", "engage", "aggressive", "advance", "attack", "commit", "pressure"]
  },
  safer: {
    phrases: ["play safe", "back off", "fall back", "get out", "stop overcommit", "backing out", "cover the exit", "avoid diving", "do not dive", "reset the fight", "cut the chase", "pull out"],
    words: ["safe", "safer", "retreat", "disengage", "careful", "cautious", "withdraw", "exit", "danger", "overextend", "overcommit", "dive", "reset"]
  },
  stayClose: {
    phrases: ["stay close", "stay nearby", "stick with me", "follow me", "keep up", "push with me", "near me", "shadow me", "wait for me", "do not go alone", "by yourself", "close enough to follow", "move with me"],
    words: ["nearby", "together", "support", "escort", "shadow", "alone", "solo", "sync", "follow"]
  },
  keepDistance: {
    phrases: ["hang back", "stay back", "keep distance", "cover me", "provide cover", "from range", "with rifle", "create some space", "make some space", "cover the exit", "give me room", "hold the back line"],
    words: ["cover", "range", "ranged", "distance", "rifle", "backline", "space", "room", "spacing"]
  },
  saveFuel: {
    phrases: ["save fuel", "conserve fuel", "waste fuel", "burn fuel", "less jetpack", "burn the whole tank", "empty the tank", "keep fuel in reserve", "budget the jetpack"],
    words: ["save", "conserve", "fuel", "waste", "budget", "tank", "reserve"]
  },
  useJetpack: {
    phrases: ["use jetpack", "fly more", "get above", "high ground", "take height", "use height", "take the roof", "get vertical"],
    words: ["jetpack", "fly", "above", "height", "airborne", "vertical", "roof"]
  },
  dodgeMore: {
    phrases: ["dodge more", "avoid attack", "avoid swing", "avoid shot", "get out way", "move out of the way", "juke their shots", "duck the swing"],
    words: ["dodge", "evade", "sidestep", "dash", "swing", "projectile", "juke", "duck"]
  },
  flankScout: {
    phrases: ["go around", "get behind", "around behind", "side angle", "attack side", "scout ahead", "circle around", "wrap around", "take another angle", "check ahead"],
    words: ["flank", "scout", "behind", "recon", "circle", "around", "angle", "wrap"]
  },
  focusTargets: {
    phrases: ["follow ping", "focus ping", "where i ping", "what i mark", "marked target", "focus target", "instead chasing", "treat that player as the priority", "shoot who i tag", "focus my call"],
    words: ["ping", "pings", "mark", "marked", "target", "priority", "tag", "called"]
  }
};

const CONFLICTS = {
  rush: "safer", safer: "rush",
  stayClose: "keepDistance", keepDistance: "stayClose",
  saveFuel: "useJetpack", useJetpack: "saveFuel"
};
const POLITE = new Set(["please", "could", "would", "can", "you", "need", "try", "trying", "maybe", "just", "buddy"]);
const DIRECTION_WORDS = new Set(["more", "less", "stop", "avoid", "never", "not"]);
const NEGATIONS = new Set(["not", "never", "dont", "stop", "avoid", "without"]);
const APPROVAL_PHRASES = [
  "yes", "yeah", "yep", "sure", "okay", "ok", "confirm", "do it", "try it",
  "sounds good", "thats right", "that is right", "thats what i meant", "that one", "exactly"
];
const DENIAL_PHRASES = [
  "no", "nope", "not yet", "cancel", "wrong", "never mind", "dont practice that",
  "do not practice that", "thats not right", "that is not right", "not practiced enough",
  "havent practiced it enough", "have not practiced it enough"
];
const CORRECTIONS = {
  charging: "charge", charged: "charge", pushes: "push", pushing: "push",
  chasing: "chase", chased: "chase", dodging: "dodge", dodges: "dodge",
  swings: "swing", swinging: "swing", attacks: "attack", attacking: "attack",
  pings: "ping", pinged: "ping", marked: "mark", marking: "mark",
  flying: "fly", flies: "fly", wasting: "waste", wasted: "waste",
  using: "use", uses: "use", staying: "stay", stays: "stay",
  going: "go", goes: "go", practiced: "practice", practicing: "practice",
  disengaging: "disengage", diving: "dive", backing: "back", tagged: "tag",
  circling: "circle", prioritise: "prioritize", prioritised: "prioritize",
  yoloing: "yolo", pign: "ping"
};
const VOCABULARY = [...new Set([
  ...Object.values(INTENT_RULES).flatMap((rule) => [
    ...rule.words,
    ...rule.phrases.flatMap((phrase) => phrase.split(" "))
  ]),
  ...APPROVAL_PHRASES.flatMap((phrase) => phrase.split(" ")),
  ...DENIAL_PHRASES.flatMap((phrase) => phrase.split(" ")),
  "me", "my", "i", "when", "if", "instead", "alone", "next", "time", "practice"
])];
const MAX_LEARNED_VOCABULARY = 24;
const COMMON_WORDS = new Set([
  "a", "already", "am", "an", "are", "as", "at", "away", "be", "been", "being",
  "can", "close", "could", "do", "does", "enough", "every", "for", "from", "funny",
  "get", "gets", "getting", "have", "he", "her", "him", "his", "how", "i", "if",
  "in", "into", "is", "it", "its", "just", "little", "me", "mean", "meant", "more",
  "my", "of", "on", "or", "our", "out", "please", "right", "seems", "she", "sing",
  "some", "someone", "something", "start", "starts", "than", "that", "the", "their",
  "them", "then", "they", "think", "this", "to", "toward", "until", "us", "want",
  "unless", "was", "we", "were", "what", "when", "while", "who", "with", "would",
  "you", "your"
]);

function editDistance(a, b, limit = 2) {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const value = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
      current[j] = value;
      rowMin = Math.min(rowMin, value);
    }
    if (rowMin > limit) return limit + 1;
    previous = current;
  }
  return previous[b.length];
}

function correctToken(token) {
  if (CORRECTIONS[token]) return CORRECTIONS[token];
  if (token.length < 4 || VOCABULARY.includes(token) || COMMON_WORDS.has(token)) return token;
  const limit = token.length >= 5 ? 2 : 1;
  let best = token;
  let bestDistance = limit + 1;
  for (const known of VOCABULARY) {
    if (known.length < 3) continue;
    const distance = editDistance(token, known, limit);
    if (distance < bestDistance) {
      best = known;
      bestDistance = distance;
    }
  }
  return bestDistance <= limit ? best : token;
}

export function normalizeCoachingText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/\b(can't|cannot)\b/g, "can not")
    .replace(/\b(don't|dont)\b/g, "dont")
    .replace(/\b(i'm|im)\b/g, "i am")
    .replace(/\b(that's)\b/g, "thats")
    .replace(/\b(isn't)\b/g, "is not")
    .replace(/\b(you're)\b/g, "you are")
    .replace(/\b(i'd)\b/g, "i would")
    .replace(/\b(we're)\b/g, "we are")
    .replace(/\b(who's)\b/g, "who is")
    .replace(/\b(we've)\b/g, "we have")
    .replace(/\b(you've)\b/g, "you have")
    .replace(/\b(haven't)\b/g, "have not")
    .replace(/\b(shouldn't)\b/g, "should not")
    .replace(/\b(won't)\b/g, "will not")
    .replace(/[^a-z0-9'\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map(correctToken)
    .join(" ");
}

function containsPhrase(text, phrase) {
  return ` ${text} `.includes(` ${phrase} `);
}

function conversationalType(clean) {
  const words = clean.split(" ");
  const denial = DENIAL_PHRASES.some((phrase) => containsPhrase(clean, phrase));
  const approval = APPROVAL_PHRASES.some((phrase) => containsPhrase(clean, phrase))
    || /\b(?:assessment|interpretation|reading)\b.*\b(?:right|correct)\b/.test(clean);
  if (
    (denial || /\bdont\s+(?:think\s+)?(?:you\s+)?(?:have\s+)?practice\b.*\benough\b/.test(clean))
    && (words.length <= 16 || /\b(?:practice|assessment|lesson|proposal)\b/.test(clean))
  ) return "denial";
  if (approval && (words.length <= 12 || /\b(?:assessment|interpretation|reading)\b/.test(clean))) {
    return denial ? "denial" : "approval";
  }
  return null;
}

function extractCondition(clean) {
  const knownConditions = [
    {
      pattern: /^(?:when|if)\s+i\s+(rush|push|charge|engage)\s+(.+)$/,
      type: "playerRush",
      text: (match) => `i ${match[1]}`,
      request: (match) => match[2]
    },
    {
      pattern: /^(?:when|if)\s+(?:i am|my (?:health|hp) (?:is|gets|looks))\s+(?:low|sketchy|rough|critical)\s+(.+)$/,
      type: "playerLow",
      text: () => "i am low",
      request: (match) => match[1]
    },
    {
      pattern: /^(?:when|if)\s+i\s+ping\s+(.+)$/,
      type: "playerPing",
      text: () => "i ping",
      request: (match) => match[1]
    },
    {
      pattern: /^(?:when|if)\s+i\s+(?:back out|retreat|disengage|pull out)\s+(.+)$/,
      type: "playerRetreat",
      text: () => "i back out",
      request: (match) => match[1]
    },
    {
      pattern: /^(?:when|if)\s+(?:an enemy|someone|they)\s+(?:gets?|is)\s+close\s+(.+)$/,
      type: "enemyClose",
      text: () => "an enemy is close",
      request: (match) => match[1]
    }
  ];
  for (const known of knownConditions) {
    const knownMatch = clean.match(known.pattern);
    if (knownMatch) {
      return {
        condition: { type: known.type, text: known.text(knownMatch) },
        request: known.request(knownMatch)
      };
    }
  }
  const match = clean.match(/^(?:when|if)\s+(.+?)(?:\s*,?\s+(?:then\s+)?)(stay|hang|keep|cover|use|dodge|go|push|rush|play|stop|avoid|follow|focus|save|conserve|try|create|make|circle|wait|treat|prioritize)\b/);
  if (!match) {
    const embedded = clean.match(/\b(?:when|while|if|until|unless)\s+(.+)$/);
    if (!embedded) return { condition: null, request: clean };
    const raw = embedded[1].trim();
    let type = "situation";
    if (/\bi (?:am )?(?:already )?(?:back|backing) out\b|\bi (?:retreat|disengage|pull out)\b/.test(raw)) type = "playerRetreat";
    else if (/\bmy (?:health|hp)\b|\bi am (?:low|hurt)\b/.test(raw)) type = "playerLow";
    else if (/\bi (?:mark|ping|tag)\b/.test(raw)) type = "playerPing";
    else if (/\bi (?:start|take|begin).*(?:engagement|fight)\b|\bi (?:rush|push|engage)\b/.test(raw)) type = "playerRush";
    else if (/\bi (?:am|get) close\b|\bi am close enough\b/.test(raw)) type = "playerClose";
    else if (/\benemy\b.*\bclose\b|\bthey get close\b/.test(raw)) type = "enemyClose";
    else if (/\bdisengag|\brunning away\b|\bbacks? off\b/.test(raw)) type = "enemyRetreat";
    return {
      condition: { type, text: raw.slice(0, 80) },
      request: clean.slice(0, embedded.index).trim()
    };
  }
  const raw = match[1].trim();
  let type = "situation";
  if (/\bi (?:rush|push|charge|engage)\b/.test(raw)) type = "playerRush";
  else if (/\bi am (?:low|hurt)\b|\bmy (?:health|hp)\b/.test(raw)) type = "playerLow";
  else if (/\bi (?:ping|mark|tag)\b|\bmy ping\b/.test(raw)) type = "playerPing";
  else if (/\bi (?:back out|retreat|disengage)\b/.test(raw)) type = "playerRetreat";
  else if (/\b(?:enemy|they)\b.*\bclose\b/.test(raw)) type = "enemyClose";
  return {
    condition: { type, text: raw.slice(0, 80) },
    request: clean.slice(match[0].length - match[2].length).trim()
  };
}

function negatedNear(tokens, index) {
  return tokens.slice(Math.max(0, index - 3), index).some((token) => NEGATIONS.has(token));
}

function phraseScore(text, phrase) {
  if (containsPhrase(text, phrase)) return phrase.split(" ").length > 1 ? 0.46 : 0.25;
  return 0;
}

function scoreClause(clause) {
  const tokens = clause.split(" ").filter(Boolean);
  const scores = {};
  for (const [intent, rule] of Object.entries(INTENT_RULES)) {
    let score = 0;
    let signals = 0;
    for (const phrase of rule.phrases) {
      const value = phraseScore(clause, phrase);
      if (value) {
        score += value;
        signals++;
      }
    }
    for (const word of rule.words) {
      const index = tokens.indexOf(word);
      if (index < 0) continue;
      const discouraged = negatedNear(tokens, index)
        || tokens.slice(index + 1, index + 3).includes("less");
      score += discouraged ? -0.28 : 0.2;
      signals++;
    }
    if (signals > 1) score += Math.min(0.22, (signals - 1) * 0.08);
    if (signals === 1 && tokens.length <= 3) score += 0.3;
    scores[intent] = clamp(score, 0, 1);
  }
  return applyIntentGuards(clause, scores);
}

function applyIntentGuards(clause, scores) {
  const has = (pattern) => pattern.test(clause);
  if (has(/\b(?:dont|not|never|stop|avoid)\s+(?:\w+\s+){0,2}(?:rush|push|charge|engage|chase)\b|\b(?:rush|push|charge|engage)\s+less\b/)) {
    scores.rush = 0;
    scores.safer = Math.max(scores.safer, 0.72);
  }
  if (has(/\b(?:dont|do not)\s+mean\s+never\s+(?:rush|push|engage)\b/)) {
    scores.rush = 0;
    scores.safer = 0;
  }
  if (has(/\b(?:dont|do not)\s+meant?\s+never\s+(?:rush|push|engage)\b/)) {
    scores.rush = 0;
    scores.safer = 0;
  }
  if (has(/\b(?:avoid|dont|never|stop)\s+(?:\w+\s+){0,3}(?:dive|overextend|overcommit)\b/)) {
    scores.rush = 0;
    scores.safer = Math.max(scores.safer, 0.9);
  }
  if (has(/\b(?:alone|solo|by yourself)\b/) && has(/\b(?:dive|push|rush|go|engage|charge)\b/)) {
    scores.rush = 0;
    scores.safer = Math.max(scores.safer, 0.82);
    scores.stayClose = Math.max(scores.stayClose, 0.72);
  }
  if (has(/\bstop\s+(?:charge|rush|push).*\balone\b|\bdont\s+.*\balone\b/)) {
    scores.safer = Math.max(scores.safer, 0.72);
    scores.stayClose = Math.max(scores.stayClose, 0.61);
  }
  if (has(/\b(?:dont|never|stop)\s+(?:waste|burn|use).*\bfuel\b|\buse\s+less\s+(?:fuel|jetpack)\b/)) {
    scores.saveFuel = Math.max(scores.saveFuel, 0.88);
    scores.useJetpack = 0;
  }
  if (has(/\b(?:dont|do not|never)\b.*\b(?:burn|empty|drain)\b.*\b(?:tank|fuel|jetpack)\b/)) {
    scores.saveFuel = Math.max(scores.saveFuel, 0.94);
    scores.useJetpack = 0;
  }
  if (has(/\b(?:use|fly|jetpack)\b.*\b(?:jetpack|fuel)\b.*\bless\b|\bjetpack\s+less\b/)) {
    scores.saveFuel = Math.max(scores.saveFuel, 0.78);
    scores.useJetpack = 0;
  }
  if (has(/\b(?:dont|stop|avoid)\s+(?:stay|stick|follow).*(?:close|near|me)\b/)) {
    scores.stayClose = 0;
    scores.keepDistance = Math.max(scores.keepDistance, 0.7);
  }
  if (has(/\b(?:dont|stop|avoid)\s+(?:hang|stay|keep).*\bback\b/)) {
    scores.keepDistance = 0;
    scores.stayClose = Math.max(scores.stayClose, 0.68);
  }
  if (has(/\bnever\s+(?:hang|stay|keep).*\bback\b/)) {
    scores.keepDistance = 0;
    scores.stayClose = Math.max(scores.stayClose, 0.78);
  }
  if (has(/\binstead\s+of?\s*(?:chase|rush|charge)|\binstead\s+(?:chase|rush|charge)/)) {
    scores.rush = 0;
    scores.focusTargets = Math.max(scores.focusTargets, 0.58);
  }
  if (has(/\b(?:above|height|high ground)\b/) && has(/\b(?:jetpack|fly|use|get|take)\b/)) {
    scores.useJetpack = Math.max(scores.useJetpack, 0.86);
  }
  if (has(/\b(?:behind|around|side)\b/) && has(/\b(?:go|get|attack|try|flank)\b/)) {
    scores.flankScout = Math.max(scores.flankScout, 0.82);
  }
  if (has(/\b(?:circle|wrap)\s+around\b|\bother (?:side|angle)\b/)) {
    scores.flankScout = Math.max(scores.flankScout, 0.92);
  }
  if (has(/\bping\b/) && has(/\b(?:go|follow|focus|where|instead)\b/)) {
    scores.focusTargets = Math.max(scores.focusTargets, 0.86);
  }
  if (has(/\b(?:mark|tag|ping)\b/) && has(/\b(?:priority|prioritize|focus|shoot|target)\b/)) {
    scores.focusTargets = Math.max(scores.focusTargets, 0.94);
  }
  if (has(/\btreat\b.*\bpriority\b/)) {
    scores.focusTargets = Math.max(scores.focusTargets, 0.9);
  }
  if (has(/\b(?:do not|dont|never|stop)\s+(?:\w+\s+){0,2}(?:focus|follow|prioritize)\b.*\b(?:ping|mark|target)\b/)) {
    scores.focusTargets = 0;
  }
  if (has(/\b(?:shadow|wait for|move with|stick with)\b.*\b(?:me|us)\b/)) {
    scores.stayClose = Math.max(scores.stayClose, 0.91);
  }
  if (has(/\b(?:shoulder|escort me|at my side)\b/)) {
    scores.stayClose = Math.max(scores.stayClose, 0.86);
  }
  if (has(/\bwait\b.*\b(?:close|follow|with me)\b/)) {
    scores.stayClose = Math.max(scores.stayClose, 0.9);
  }
  if (has(/\bmistook\b.*\b(?:aggression|aggressive)\b/)) {
    scores.rush = 0;
    scores.safer = Math.max(scores.safer, 0.62);
  }
  if (has(/\bdraw\b.*\b(?:toward|to)\s+(?:me|us)\b/)) {
    scores.stayClose = Math.max(scores.stayClose, 0.86);
  }
  if (has(/\b(?:create|make|give)\b.*\b(?:space|room|distance)\b/)) {
    scores.keepDistance = Math.max(scores.keepDistance, 0.9);
  }
  if (has(/\bcover\b.*\b(?:exit|retreat|escape|way out)\b/)) {
    scores.keepDistance = Math.max(scores.keepDistance, 0.84);
    scores.safer = Math.max(scores.safer, 0.66);
  }
  if (has(/\b(?:peel away|yolo|getting out|way out)\b/)) {
    scores.safer = Math.max(scores.safer, 0.82);
  }
  if (has(/\b(?:boost|fuel|tank)\b/) && has(/\b(?:save|reserve|conserve|budget)\b/)) {
    scores.saveFuel = Math.max(scores.saveFuel, 0.88);
  }
  if (has(/\b(?:do not|dont|never)\s+(?:fly|jetpack)\b/)) {
    scores.useJetpack = 0;
    scores.saveFuel = Math.max(scores.saveFuel, 0.78);
  }
  if (has(/\bpush with me\b/)) {
    scores.rush = Math.max(scores.rush, 0.78);
    scores.stayClose = Math.max(scores.stayClose, 0.64);
  }
  if (has(/\bdodge\b/) && has(/\b(?:swing|saber|attack|shot|more)\b/)) {
    scores.dodgeMore = Math.max(scores.dodgeMore, 0.86);
  }
  return scores;
}

function meaningfulTerms(text) {
  return [...new Set(text.split(" ").filter((token) => (
    token.length >= 3 && !POLITE.has(token) && !DIRECTION_WORDS.has(token)
  )))].slice(0, 10);
}

function learnedScores(clean, learnedVocabulary) {
  const scores = {};
  const inputTerms = meaningfulTerms(clean);
  for (const entry of sanitizeLearnedVocabulary(learnedVocabulary)) {
    const terms = entry.terms || meaningfulTerms(entry.phrase);
    const overlap = terms.filter((term) => inputTerms.includes(term)).length;
    const union = new Set([...terms, ...inputTerms]).size || 1;
    const similarity = overlap / union;
    const phraseDistance = clean.length <= 80 && entry.phrase.length <= 80
      ? editDistance(clean, entry.phrase, 4)
      : 5;
    const boost = phraseDistance <= 2 ? 0.92 : similarity >= 0.5 ? 0.78 : similarity >= 0.34 ? 0.54 : 0;
    if (!boost) continue;
    for (const intent of entry.intents) scores[intent] = Math.max(scores[intent] || 0, boost);
  }
  return scores;
}

function splitClauses(clean) {
  return clean
    .replace(/\b(?:but also|as well as)\b/g, " and ")
    .replace(/\b(?:i dont mean|i do not mean)\s+(?:never|not to)?\s*[^,;]+[,;]?\s*(?:just|instead)\s+/g, "")
    .replace(/\bnot\s+[^,;]+[,;]?\s+(?:just|but rather|instead)\s+/g, "")
    .split(/\s+(?:and|but|then|while)\s+/)
    .map((clause) => clause.trim())
    .filter(Boolean)
    .slice(0, 4);
}

function rankedScores(clean, learnedVocabulary) {
  const { condition, request } = extractCondition(clean);
  if (condition && /\bunless\b.*\b(?:danger|unsafe|trapped)\b/.test(clean)) {
    condition.exception = "danger";
  }
  const totals = {};
  for (const clause of splitClauses(request)) {
    const clauseScores = scoreClause(clause);
    for (const [intent, score] of Object.entries(clauseScores)) {
      totals[intent] = Math.max(totals[intent] || 0, score);
    }
  }
  if (condition?.type === "playerClose" && /\bwait\b/.test(request)) {
    totals.stayClose = Math.max(totals.stayClose || 0, 0.88);
  }
  if (condition?.type === "playerPing" && /\bpriority\b|\bfocus\b/.test(request)) {
    totals.focusTargets = Math.max(totals.focusTargets || 0, 0.9);
  }
  for (const [intent, score] of Object.entries(learnedScores(clean, learnedVocabulary))) {
    totals[intent] = Math.max(totals[intent] || 0, score);
  }
  return { totals, condition, request };
}

function mergeSemanticScores(totals, semanticScores, request) {
  if (!semanticScores || typeof semanticScores !== "object") {
    return Object.entries(totals)
      .filter(([, score]) => score >= 0.24)
      .sort((a, b) => b[1] - a[1]);
  }
  const merged = { ...totals };
  for (const [intent, raw] of Object.entries(semanticScores)) {
    if (!DIRECTIVES[intent]) continue;
    const sim = clamp(Number(raw) || 0, 0, 1);
    if (sim < 0.34) continue;
    const det = merged[intent] || 0;
    if (det > 0) {
      merged[intent] = clamp(det * 0.58 + sim * 0.52, 0, 1);
    } else if (sim >= 0.46) {
      // Model-only candidates need a higher bar so lexical negation stays decisive.
      merged[intent] = sim * 0.74;
    }
  }
  // Deterministic guards remain authoritative after the blend.
  for (const clause of splitClauses(request || "")) {
    applyIntentGuards(clause, merged);
  }
  applyIntentGuards(request || "", merged);
  return Object.entries(merged)
    .filter(([, score]) => score >= 0.24)
    .sort((a, b) => b[1] - a[1]);
}

function suggestionCandidates(ranked) {
  return ranked.filter(([, score]) => score >= 0.24).slice(0, 3).map(([intent]) => intent);
}

export function parseCoachingIntent(text, learnedVocabulary = [], semanticScores = null) {
  const clean = normalizeCoachingText(text);
  if (!clean) return { type: "empty", normalized: clean };
  const conversational = conversationalType(clean);
  if (conversational) return { type: conversational, normalized: clean };

  const { totals, condition, request } = rankedScores(clean, learnedVocabulary);
  const ranked = mergeSemanticScores(totals, semanticScores, request);
  if (!ranked.length) return { type: "unknown", candidates: [], normalized: clean, condition };
  const [first, second] = ranked;
  const candidates = suggestionCandidates(ranked);
  const selected = [first];
  if (second && second[1] >= 0.5 && first[1] - second[1] <= 0.28) selected.push(second);
  const conflicts = selected.length === 2 && CONFLICTS[selected[0][0]] === selected[1][0];
  if (conflicts) {
    return {
      type: "conflict",
      candidates: selected.map(([intent]) => intent),
      scores: Object.fromEntries(selected),
      normalized: clean,
      condition
    };
  }
  const confidence = first[1];
  if (confidence < 0.45) {
    return { type: "unknown", candidates, confidence, normalized: clean, condition };
  }
  const intents = selected.map(([intent]) => intent).slice(0, 2);
  return {
    type: "directive",
    intent: intents[0],
    intents,
    confidence,
    level: confidence >= 0.72 ? "high" : "medium",
    candidates,
    normalized: clean,
    condition,
    semantic: Boolean(semanticScores)
  };
}

export function sanitizeLearnedVocabulary(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry) => entry && typeof entry === "object")
    .map((entry) => {
      const phrase = normalizeCoachingText(String(entry.phrase || "")).slice(0, 120);
      const intents = [...new Set(
        (Array.isArray(entry.intents) ? entry.intents : [entry.intent])
          .filter((intent) => DIRECTIVES[intent])
      )].slice(0, 2);
      return {
        phrase,
        terms: meaningfulTerms(phrase),
        intents,
        uses: clamp(Number(entry.uses) || 1, 1, 99),
        confirmedAt: Number(entry.confirmedAt) || Date.now()
      };
    })
    .filter((entry) => entry.phrase.length >= 3 && entry.intents.length)
    .slice(-MAX_LEARNED_VOCABULARY);
}

export function learnCoachingPhrase(profile, phrase, intents) {
  const coaching = ensureCoaching(profile);
  const clean = normalizeCoachingText(phrase).slice(0, 120);
  const safeIntents = [...new Set(intents)].filter((intent) => DIRECTIVES[intent]).slice(0, 2);
  if (clean.length < 3 || !safeIntents.length) return;
  const existing = coaching.learnedVocabulary.find((entry) => entry.phrase === clean);
  if (existing) {
    existing.intents = safeIntents;
    existing.terms = meaningfulTerms(clean);
    existing.uses = clamp((existing.uses || 1) + 1, 1, 99);
    existing.confirmedAt = Date.now();
  } else {
    coaching.learnedVocabulary.push({
      phrase: clean,
      terms: meaningfulTerms(clean),
      intents: safeIntents,
      uses: 1,
      confirmedAt: Date.now()
    });
  }
  coaching.learnedVocabulary = sanitizeLearnedVocabulary(coaching.learnedVocabulary);
}

const MAX_TOPIC_DECLINES = 9;
const MAX_RECENT_PROPOSALS = 4;

// Per-weapon, per-topic lesson preferences ("declined" = the player told the
// buddy not to learn this; it stays valid evidence but drops to lowest
// proposal priority). Sanitized on load so old saves migrate cleanly.
function sanitizeTopicPrefs(value) {
  if (!value || typeof value !== "object") return {};
  const prefs = {};
  for (const [weapon, topics] of Object.entries(value)) {
    if (!topics || typeof topics !== "object") continue;
    const clean = {};
    for (const [intent, pref] of Object.entries(topics)) {
      if (!DIRECTIVES[intent] || !pref || typeof pref !== "object") continue;
      const estimate = Number(pref.estimateAtDecline);
      clean[intent] = {
        declined: pref.declined !== false,
        declines: clamp(Math.round(Number(pref.declines) || 1), 1, MAX_TOPIC_DECLINES),
        lastDeclinedAt: Number(pref.lastDeclinedAt) || 0,
        estimateAtDecline: pref.estimateAtDecline === null || !Number.isFinite(estimate)
          ? null
          : clamp(estimate, 0, 1)
      };
    }
    if (Object.keys(clean).length) prefs[weapon] = clean;
  }
  return prefs;
}

function sanitizeRecentProposals(value) {
  if (!value || typeof value !== "object") return {};
  const recents = {};
  for (const [weapon, list] of Object.entries(value)) {
    if (!Array.isArray(list)) continue;
    const clean = list.filter((intent) => DIRECTIVES[intent]).slice(-MAX_RECENT_PROPOSALS);
    if (clean.length) recents[weapon] = clean;
  }
  return recents;
}

export function topicPreference(profile, weapon, intent) {
  return ensureCoaching(profile).topicPrefs[weapon]?.[intent] || null;
}

export function declineTopic(profile, weapon, intent, estimateAtDecline = null) {
  if (!DIRECTIVES[intent]) return null;
  const coaching = ensureCoaching(profile);
  const topics = coaching.topicPrefs[weapon] ||= {};
  const existing = topics[intent];
  const estimate = Number(estimateAtDecline);
  topics[intent] = {
    declined: true,
    declines: clamp((existing?.declines || 0) + 1, 1, MAX_TOPIC_DECLINES),
    lastDeclinedAt: Date.now(),
    estimateAtDecline: estimateAtDecline !== null && Number.isFinite(estimate)
      ? clamp(estimate, 0, 1)
      : existing?.estimateAtDecline ?? null
  };
  return topics[intent];
}

export function restoreTopic(profile, weapon, intent) {
  const coaching = ensureCoaching(profile);
  const topics = coaching.topicPrefs[weapon];
  if (!topics?.[intent]) return false;
  delete topics[intent];
  if (!Object.keys(topics).length) delete coaching.topicPrefs[weapon];
  return true;
}

export function declinedTopics(profile, weapon) {
  const topics = ensureCoaching(profile).topicPrefs[weapon] || {};
  return Object.entries(topics)
    .filter(([, pref]) => pref.declined)
    .map(([intent, pref]) => ({ intent, ...pref }));
}

export function rememberProposal(profile, weapon, intent) {
  if (!DIRECTIVES[intent]) return;
  const coaching = ensureCoaching(profile);
  const list = coaching.recentProposals[weapon] ||= [];
  list.push(intent);
  coaching.recentProposals[weapon] = list.slice(-MAX_RECENT_PROPOSALS);
}

export function recentProposalIntents(profile, weapon) {
  return ensureCoaching(profile).recentProposals[weapon] || [];
}

export function ensureCoaching(profile) {
  if (!profile.coaching || typeof profile.coaching !== "object") profile.coaching = {};
  const coaching = profile.coaching;
  if (!Array.isArray(coaching.directives)) coaching.directives = [];
  if (!Array.isArray(coaching.history)) coaching.history = [];
  coaching.history = coaching.history.slice(-20);
  if (!("pending" in coaching)) coaching.pending = null;
  if (!("proposal" in coaching)) coaching.proposal = null;
  coaching.learnedVocabulary = sanitizeLearnedVocabulary(coaching.learnedVocabulary);
  coaching.topicPrefs = sanitizeTopicPrefs(coaching.topicPrefs);
  coaching.recentProposals = sanitizeRecentProposals(coaching.recentProposals);
  if (!coaching.responseVariants || typeof coaching.responseVariants !== "object") {
    coaching.responseVariants = {};
  }
  for (const [key, value] of Object.entries(coaching.responseVariants)) {
    if (!Number.isInteger(Number(value)) || Number(value) < 0 || Number(value) > 20) {
      delete coaching.responseVariants[key];
    } else {
      coaching.responseVariants[key] = Number(value);
    }
  }
  for (const directive of coaching.directives) {
    const hasOutcomeEvidence = "successes" in directive || "failures" in directive;
    directive.successes = Math.max(0, Number(directive.successes) || 0);
    directive.failures = Math.max(0, Number(directive.failures) || 0);
    // Legacy match/duration evidence is intentionally not converted to skill.
    if (!hasOutcomeEvidence) {
      directive.successes = 0;
      directive.failures = 0;
    }
    directive.evidence = (directive.successes + directive.failures)
      ? ((directive.successes + 1) / (directive.successes + directive.failures + 2))
        * ((directive.successes + directive.failures) / (directive.successes + directive.failures + 5))
      : 0;
    directive.status = directive.evidence >= .58 && directive.successes + directive.failures >= 7
      ? "practiced"
      : "needs-practice";
  }
  if (!("clarification" in coaching)) coaching.clarification = null;
  return coaching;
}

export function addHistory(profile, role, text, meta = {}) {
  const coaching = ensureCoaching(profile);
  coaching.history.push({
    role: role === "player" ? "player" : "buddy",
    text: String(text).slice(0, 280),
    at: Date.now(),
    ...meta
  });
  coaching.history = coaching.history.slice(-20);
}

function replaceConflict(directives, intent, weapon) {
  const conflict = CONFLICTS[intent];
  if (!conflict) return;
  for (const directive of directives) {
    if (directive.intent === conflict && directive.weapon === weapon) directive.active = false;
  }
}

export function confirmDirective(profile, intent, weapon) {
  const coaching = ensureCoaching(profile);
  // Explicit approval of a topic overrides any earlier "don't learn that".
  restoreTopic(profile, weapon, intent);
  replaceConflict(coaching.directives, intent, weapon);
  let directive = coaching.directives.find((item) => item.intent === intent && item.weapon === weapon);
  if (directive) {
    directive.active = true;
    directive.status = "needs-practice";
    directive.confirmedAt = Date.now();
  } else {
    directive = {
      intent,
      weapon,
      active: true,
      status: "needs-practice",
      evidence: 0,
      successes: 0,
      failures: 0,
      observations: [],
      confirmedAt: Date.now()
    };
    coaching.directives.push(directive);
  }
  coaching.pending = null;
  coaching.proposal = null;
  coaching.clarification = null;
  return directive;
}

export function activeDirectives(profile, weapon) {
  return ensureCoaching(profile).directives
    .filter((directive) => directive.active !== false && directive.weapon === weapon);
}

export function directiveStrength(profile, intent, weapon, training = false) {
  const directive = activeDirectives(profile, weapon).find((item) => item.intent === intent);
  if (!directive) return 0;
  if (training) return clamp(.15 + directive.evidence, .15, 1);
  return clamp(directive.evidence, 0, 1);
}

export function directiveStatusLine(directive) {
  const label = DIRECTIVES[directive.intent]?.label || directive.intent;
  const outcomes = (directive.successes || 0) + (directive.failures || 0);
  if (directive.status === "practiced") return `${label}: practiced (${outcomes} judged attempts)`;
  return `${label}: needs practice (${outcomes} judged attempts)`;
}

function intentList(intents) {
  return intents.map((intent) => DIRECTIVES[intent].label).join(intents.length > 1 ? " and " : "");
}

function conditionSuffix(condition) {
  if (!condition) return "";
  const labels = {
    playerRush: " when you rush",
    playerLow: " when you are low on health",
    playerPing: " when you ping or mark someone",
    playerRetreat: " when you are backing out",
    enemyClose: " when an enemy gets close",
    enemyRetreat: " when an enemy is disengaging",
    playerClose: " once you are close enough",
    safetyOverride: " unless staying would put us in danger"
  };
  const base = labels[condition.type] || ` when “${condition.text}” applies`;
  return condition.exception === "danger"
    ? `${base}, unless that would put us in danger`
    : base;
}

const NATURAL_INTENTS = {
  rush: "join engagements sooner",
  safer: "back out of bad fights earlier",
  stayClose: "stay with you instead of going alone",
  keepDistance: "make space and cover you",
  saveFuel: "keep jetpack fuel in reserve",
  useJetpack: "use the jetpack for useful positions",
  dodgeMore: "dodge incoming attacks more often",
  flankScout: "look for a safe side angle",
  focusTargets: "prioritize whoever you mark"
};

function naturalIntentList(intents) {
  const phrases = intents.map((intent) => NATURAL_INTENTS[intent] || DIRECTIVES[intent].label);
  if (phrases.length < 2) return phrases[0] || "that";
  return `${phrases[0]} and ${phrases[1]}`;
}

function chooseResponseVariant(coaching, group, variants) {
  coaching.responseVariants ||= {};
  const previous = Number(coaching.responseVariants[group]);
  const next = Number.isInteger(previous) ? (previous + 1) % variants.length : 0;
  coaching.responseVariants[group] = next;
  return variants[next];
}

function interpretationReply(coaching, intents, condition, uncertain = false) {
  const request = `${naturalIntentList(intents)}${conditionSuffix(condition)}`;
  const variants = uncertain
    ? [
      `I may be reading you wrong. Do you want me to ${request}?`,
      `My best reading is that you want me to ${request}. Is that right?`,
      `Let me check that I understood: should I ${request}?`
    ]
    : [
      `I understand the request as: ${request}. Should I save that for practice?`,
      `To make sure I have it right, you want me to ${request}. Correct?`,
      `I hear you asking me to ${request}. Is that what you want practiced?`
    ];
  return chooseResponseVariant(coaching, uncertain ? "uncertain" : "confirm", variants);
}

function acceptedReply(coaching, intents, condition) {
  const request = `${naturalIntentList(intents)}${conditionSuffix(condition)}`;
  return chooseResponseVariant(coaching, "accepted", [
    `Understood. I will practice trying to ${request}; I do not have enough evidence to call it reliable yet.`,
    `Got it: ${request}. I have saved the goal, but only judged practice can show that I can do it.`,
    `Thanks. I will work on how to ${request}. I am not claiming competence until the training evidence supports it.`
  ]);
}

function pendingIntents(pending) {
  const intents = Array.isArray(pending?.intents) ? pending.intents : [pending?.intent];
  return intents.filter((intent) => DIRECTIVES[intent]).slice(0, 2);
}

function setPending(coaching, parsed, weapon, original, learnOnConfirm = false) {
  coaching.pending = {
    intent: parsed.intents[0],
    intents: parsed.intents,
    weapon,
    condition: parsed.condition || null,
    sourcePhrase: original,
    learnOnConfirm,
    createdAt: Date.now()
  };
}

function confirmPending(profile, pending) {
  const intents = pendingIntents(pending);
  const directives = intents.map((intent) => confirmDirective(profile, intent, pending.weapon));
  if (pending.learnOnConfirm && pending.sourcePhrase) learnCoachingPhrase(profile, pending.sourcePhrase, intents);
  return directives;
}

function resolveChoice(clean, clarification) {
  const candidates = clarification?.candidates || [];
  if (!candidates.length) return null;
  if (/\b(?:first|1st|one)\b/.test(clean)) return candidates[0];
  if (/\b(?:second|2nd|two)\b/.test(clean)) return candidates[1] || null;
  if (/\b(?:third|3rd|three)\b/.test(clean)) return candidates[2] || null;
  const named = candidates.find((intent) => {
    const label = normalizeCoachingText(DIRECTIVES[intent].label);
    const terms = meaningfulTerms(label);
    return terms.some((term) => containsPhrase(clean, term));
  });
  return named || (candidates.length === 1 && /\bthat one\b/.test(clean) ? candidates[0] : null);
}

// Extra aliases so "revisit height" resolves to the jetpack lesson even
// though "height" is not in the directive label.
const TOPIC_ALIASES = {
  useJetpack: ["height", "vertical", "fly", "jet", "jetpack"],
  saveFuel: ["fuel"],
  keepDistance: ["range", "distance"],
  stayClose: ["close", "nearby"],
  dodgeMore: ["dodge", "dodging"],
  focusTargets: ["ping", "pings", "mark", "marks"],
  flankScout: ["flank", "scout"],
  rush: ["rush", "push", "aggressive"],
  safer: ["safer", "safe", "retreat"]
};

function matchDeclinedTopic(rest, declined) {
  if (!declined.length) return null;
  if (!rest && declined.length === 1) return declined[0].intent;
  const tokens = rest.split(" ").filter(Boolean);
  if (!tokens.length) return null;
  const found = declined.find(({ intent }) => {
    const terms = new Set([
      ...meaningfulTerms(normalizeCoachingText(DIRECTIVES[intent].label)),
      ...(TOPIC_ALIASES[intent] || [])
    ]);
    return tokens.some((token) => terms.has(token));
  });
  return found?.intent || null;
}

export function coachingReply(profile, text, weapon, parsedOverride = null) {
  const coaching = ensureCoaching(profile);
  addHistory(profile, "player", text);
  let parsed = parsedOverride || parseCoachingIntent(text, coaching.learnedVocabulary);
  const clean = normalizeCoachingText(text);

  if (coaching.pending) {
    if (/\brephrase\b|\bstart over\b/.test(clean)) {
      coaching.pending = null;
      const reply = "I got that interpretation wrong and did not store it. Please phrase the behavior another way.";
      addHistory(profile, "buddy", reply);
      return { reply, quickReplies: defaultQuickReplies(profile, weapon) };
    }
    if (parsed.type === "approval") {
      const pending = coaching.pending;
      const directives = confirmPending(profile, pending);
      const reply = acceptedReply(coaching, directives.map((item) => item.intent), pending.condition);
      addHistory(profile, "buddy", reply);
      return { reply, quickReplies: ["Show coaching status", "Play safer", "Focus my pings"] };
    }
    if (parsed.type === "denial") {
      coaching.pending = null;
      const reply = chooseResponseVariant(coaching, "misunderstood", [
        "I misunderstood you. I did not save that instruction; tell me what I should change.",
        "That reading was mine, and it was wrong. Nothing was stored. Please correct the behavior you meant.",
        "Thanks for stopping me. I got the request wrong and did not save it. What should I do instead?"
      ]);
      addHistory(profile, "buddy", reply);
      return { reply, quickReplies: defaultQuickReplies(profile, weapon) };
    }
    if (parsed.type !== "directive" && parsed.type !== "conflict") {
      const reply = "I am still checking my last interpretation. Type yes, no, or rephrase it in your own words.";
      addHistory(profile, "buddy", reply);
      return { reply, quickReplies: ["Yes", "No", "Rephrase"] };
    }
    coaching.pending = null;
  }

  if (coaching.clarification) {
    const choice = resolveChoice(clean, coaching.clarification);
    if (choice) {
      const original = coaching.clarification.original;
      coaching.clarification = null;
      parsed = {
        type: "directive", intent: choice, intents: [choice],
        confidence: 0.7, level: "medium", normalized: clean, condition: null
      };
      setPending(coaching, parsed, weapon, original, true);
      const reply = interpretationReply(coaching, [choice], null, true);
      addHistory(profile, "buddy", reply);
      return { reply, quickReplies: ["Yes", "No", "Rephrase"] };
    }
    if (parsed.type === "directive") {
      const original = coaching.clarification.original;
      coaching.clarification = null;
      setPending(coaching, parsed, weapon, original, true);
      const reply = `Thanks for correcting me. ${interpretationReply(coaching, parsed.intents, parsed.condition, true)}`;
      addHistory(profile, "buddy", reply);
      return { reply, quickReplies: ["Yes", "No", "Rephrase"] };
    }
  }

  if (/\bpriorit/.test(clean) && /\b(?:review|show|list|lesson|check)\b/.test(clean)) {
    coaching.clarification = null;
    const declined = declinedTopics(profile, weapon);
    const reply = declined.length
      ? `Deprioritized lessons for this weapon: ${declined.map((topic) => `“${DIRECTIVES[topic.intent].label}” (declined ${topic.declines === 1 ? "once" : `${topic.declines} times`})`).join("; ")}. Say “revisit” plus the lesson to re-enable it.`
      : "No deprioritized lessons for this weapon. I will propose whatever the evidence supports.";
    addHistory(profile, "buddy", reply);
    return {
      reply,
      quickReplies: declined.length
        ? declined.slice(0, 3).map((topic) => `Revisit ${DIRECTIVES[topic.intent].label}`)
        : defaultQuickReplies(profile, weapon)
    };
  }

  const revisit = clean.match(/\b(?:revisit|reconsider)\b\s*(.*)$/);
  if (revisit) {
    coaching.clarification = null;
    const declined = declinedTopics(profile, weapon);
    const intent = matchDeclinedTopic(revisit[1].trim(), declined);
    if (intent) {
      restoreTopic(profile, weapon, intent);
      const reply = `Okay — “${DIRECTIVES[intent].label}” is back to normal priority. I will bring it up again when the evidence supports it.`;
      addHistory(profile, "buddy", reply);
      return { reply, quickReplies: defaultQuickReplies(profile, weapon) };
    }
    const reply = declined.length
      ? `Which lesson should I revisit? Deprioritized: ${declined.map((topic) => `“${DIRECTIVES[topic.intent].label}”`).join(", ")}.`
      : "Nothing is deprioritized for this weapon right now.";
    addHistory(profile, "buddy", reply);
    return {
      reply,
      quickReplies: declined.length
        ? declined.slice(0, 3).map((topic) => `Revisit ${DIRECTIVES[topic.intent].label}`)
        : defaultQuickReplies(profile, weapon)
    };
  }

  if (parsed.type === "directive") {
    setPending(coaching, parsed, weapon, text, parsed.level === "medium");
    const reply = interpretationReply(coaching, parsed.intents, parsed.condition, parsed.level !== "high");
    addHistory(profile, "buddy", reply);
    return { reply, quickReplies: ["Yes", "No", "Rephrase"] };
  }

  if ((parsed.type === "approval" || parsed.type === "denial") && coaching.proposal) {
    if (parsed.type === "approval") {
      const directive = confirmDirective(profile, coaching.proposal.intent, coaching.proposal.weapon);
      const reply = acceptedReply(coaching, [directive.intent], null);
      addHistory(profile, "buddy", reply);
      return { reply, quickReplies: ["Show coaching status", "Play safer", "Focus my pings"] };
    }
    // A denial of the proposed lesson is remembered per weapon and topic, so
    // future reviews treat it as lowest priority instead of re-proposing it.
    // Combat coaching like "don't rush" parses as a directive, not a denial,
    // so it never lands here and never suppresses a topic.
    declineTopic(
      profile,
      coaching.proposal.weapon,
      coaching.proposal.intent,
      coaching.proposal.estimate ?? null
    );
    coaching.proposal = null;
    const reply = "Understood. I won't prioritize that lesson in future reviews.";
    addHistory(profile, "buddy", reply);
    return { reply, quickReplies: defaultQuickReplies(profile, weapon) };
  }

  if (/show (coaching )?status|what (are you|you are) practic(?:e|ing)/.test(clean)) {
    const active = activeDirectives(profile, weapon);
    const reply = active.length
      ? `Current coaching: ${active.map(directiveStatusLine).join("; ")}.`
      : "I do not have a confirmed coaching instruction for this weapon yet.";
    addHistory(profile, "buddy", reply);
    return { reply, quickReplies: defaultQuickReplies(profile, weapon) };
  }

  if (parsed.type === "approval" || parsed.type === "denial") {
    const reply = "I do not have a current proposal to approve or reject. Tell me what behavior you want me to practice.";
    addHistory(profile, "buddy", reply);
    return { reply, quickReplies: defaultQuickReplies(profile, weapon) };
  }

  if (parsed.type === "conflict") {
    const labels = parsed.candidates.map((intent) => DIRECTIVES[intent].label);
    coaching.clarification = {
      original: text,
      candidates: parsed.candidates,
      weapon,
      createdAt: Date.now()
    };
    const reply = `I heard two conflicting requests: “${labels[0]}” and “${labels[1]}.” Which should take priority?`;
    addHistory(profile, "buddy", reply);
    return { reply, quickReplies: labels };
  }

  const candidates = parsed.candidates || [];
  coaching.clarification = {
    original: text,
    candidates,
    weapon,
    createdAt: Date.now()
  };
  const reply = candidates.length
    ? `I am not certain what you meant. Was it ${candidates.map((intent) => `“${NATURAL_INTENTS[intent] || DIRECTIVES[intent].label}”`).join(", or ")}? You can choose one or rephrase it.`
    : "I am missing the behavior you want changed. Could you describe what I should do and when?";
  addHistory(profile, "buddy", reply);
  return {
    reply,
    quickReplies: candidates.length
      ? candidates.map((intent) => DIRECTIVES[intent].label).slice(0, 3)
      : defaultQuickReplies(profile, weapon)
  };
}

export function defaultQuickReplies(profile, weapon) {
  const proposal = ensureCoaching(profile).proposal;
  if (proposal?.weapon === weapon) return ["Yes, try it", "No, not yet", "Show coaching status"];
  return ["Stay close to me", "Play safer", "Focus my pings"];
}

export function quickReplyText(label) {
  const found = Object.entries(DIRECTIVES).find(([, directive]) => directive.label === label);
  return found ? found[1].confirm.replace(/^Do you mean: /, "").replace(/\?$/, "") : label;
}

/**
 * Unified buddy chat: FAQ Q&A, ambiguous clarification, or coaching directives.
 * @param {object} options.analysis result from analyzeBuddyMessage
 * @param {boolean} options.allowDirectives false after Conquest (Q&A only)
 */
export function buddyChatReply(profile, text, weapon, analysis = null, options = {}) {
  const allowDirectives = options.allowDirectives !== false;
  const coaching = ensureCoaching(profile);

  // Pending confirmation / clarification always stay on the coaching path.
  if (coaching.pending || coaching.clarification) {
    if (!allowDirectives) {
      addHistory(profile, "player", text);
      const reply = "I am still checking a previous coaching interpretation from Training. After Conquest I can answer game questions, but I will not save new practice goals here.";
      addHistory(profile, "buddy", reply);
      return { reply, quickReplies: FAQ_TOPIC_CHIPS.slice(0, 3), kind: "blocked" };
    }
    return { ...coachingReply(profile, text, weapon, analysis?.coaching || null), kind: "coaching" };
  }

  if (analysis?.kind === "ambiguous") {
    addHistory(profile, "player", text);
    const reply = composeAmbiguousRouteReply(coaching);
    addHistory(profile, "buddy", reply, { kind: "ambiguous" });
    return {
      reply,
      quickReplies: ["Asking about the game", "Coaching how to play", ...FAQ_TOPIC_CHIPS.slice(0, 2)],
      kind: "ambiguous"
    };
  }

  if (analysis?.kind === "question") {
    addHistory(profile, "player", text);
    const pack = getGameFaqPack();
    const reply = composeFaqReply(analysis.match, pack, coaching);
    addHistory(profile, "buddy", reply, {
      kind: "faq",
      faqId: analysis.match?.entry?.id || null,
      confidence: analysis.match?.confidence || 0
    });
    return {
      reply,
      quickReplies: faqQuickReplies(analysis.match),
      kind: "faq",
      faqId: analysis.match?.entry?.id || null
    };
  }

  // Topic chips and explicit "asking about the game" follow-ups.
  const clean = normalizeCoachingText(text);
  if (/^asking about the game$/.test(clean)) {
    addHistory(profile, "player", text);
    const reply = "Ask me about controls, learning, vision, the shop, jetpack, weapons, or match rules. I only answer from the local FAQ.";
    addHistory(profile, "buddy", reply, { kind: "faq" });
    return { reply, quickReplies: FAQ_TOPIC_CHIPS.slice(), kind: "faq" };
  }
  if (/^coaching how to play$/.test(clean)) {
    if (!allowDirectives) {
      addHistory(profile, "player", text);
      const reply = "Practice coaching is available after Training matches. Here I can still answer questions about how the game works.";
      addHistory(profile, "buddy", reply);
      return { reply, quickReplies: FAQ_TOPIC_CHIPS.slice(0, 3), kind: "blocked" };
    }
    addHistory(profile, "player", text);
    const reply = "Tell me the behavior you want me to practice—rushing, playing safer, staying close, covering from range, jetpack use, dodging, flanking, or focusing pings.";
    addHistory(profile, "buddy", reply);
    return { reply, quickReplies: defaultQuickReplies(profile, weapon), kind: "coaching" };
  }

  if (FAQ_TOPIC_CHIPS.some((chip) => normalizeCoachingText(chip) === clean)) {
    const chip = FAQ_TOPIC_CHIPS.find((item) => normalizeCoachingText(item) === clean);
    const prompt = topicChipPrompt(chip);
    const pack = getGameFaqPack();
    const match = matchGameFaq(prompt, pack);
    return buddyChatReply(profile, prompt, weapon, {
      kind: "question",
      match,
      classification: { route: "question" }
    }, options);
  }

  if (!allowDirectives) {
    addHistory(profile, "player", text);
    if (analysis?.kind === "coaching" && analysis.coaching?.type === "directive") {
      const reply = "After Conquest I will not save practice goals. Ask a game question, or run Training if you want me to practice a behavior.";
      addHistory(profile, "buddy", reply);
      return { reply, quickReplies: FAQ_TOPIC_CHIPS.slice(0, 3), kind: "blocked" };
    }
    const pack = getGameFaqPack();
    const match = pack ? matchGameFaq(text, pack) : null;
    if (match?.type === "match") {
      const reply = composeFaqReply(match, pack, coaching);
      addHistory(profile, "buddy", reply, { kind: "faq", faqId: match.entry.id });
      return { reply, quickReplies: faqQuickReplies(match), kind: "faq", faqId: match.entry.id };
    }
    const reply = "I can answer questions about the game here. Practice coaching waits for Training. Try Controls, Learning, Vision, Shop, or Jetpack.";
    addHistory(profile, "buddy", reply);
    return { reply, quickReplies: FAQ_TOPIC_CHIPS.slice(), kind: "blocked" };
  }

  return {
    ...coachingReply(profile, text, weapon, analysis?.coaching || null),
    kind: "coaching"
  };
}
