/**
 * Closed-world knowledge retrieval for buddy Q&A.
 * MiniLM (optional) can refine FAQ ranks; manual + code-facts use local
 * keyword/overlap ranking so BASIC mode still works offline.
 */
import {
  matchGameFaq, getGameFaqPack, loadGameFaqPack, composeFaqReply
} from "./game-faq.js";

const CODE_FORCE_PHRASES = [
  "code based answer",
  "code-based answer",
  "from the code",
  "check the source",
  "dig into the code",
  "search the code",
  "look in the code",
  "code facts",
  "based on the code",
  "from source"
];

const HIGH_CONF = 0.62;
const MID_CONF = 0.38;
const CODE_HIT_CONF = 0.34;

let manualCache = null;
let manualPromise = null;
let codeCache = null;
let codePromise = null;

function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/[^a-z0-9'\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(text) {
  return normalize(text).split(" ").filter((t) => t.length > 1);
}

const STOP = new Set([
  "a", "an", "the", "is", "are", "do", "does", "to", "of", "in", "on", "for",
  "my", "me", "i", "you", "your", "and", "or", "what", "how", "why", "when",
  "where", "which", "who", "can", "about", "with", "from", "that", "this", "it",
  "want", "please", "tell", "give", "based", "answer"
]);

function contentTerms(text) {
  return [...new Set(tokenize(text).filter((t) => !STOP.has(t)))];
}

function overlapScore(query, target) {
  const q = contentTerms(query);
  const e = contentTerms(target);
  if (!q.length || !e.length) return 0;
  const eSet = new Set(e);
  let hits = 0;
  for (const term of q) {
    if (eSet.has(term)) hits += 1;
    else if ([...eSet].some((other) => other.includes(term) || term.includes(other))) hits += 0.55;
  }
  return Math.min(1, (hits / q.length) * 0.78 + (hits / e.length) * 0.4);
}

/** Detect explicit player request for code-facts answers. */
export function detectForceCode(text) {
  const clean = normalize(text);
  if (!clean) return false;
  return CODE_FORCE_PHRASES.some((phrase) => clean.includes(phrase));
}

/** Strip force-code phrasing so retrieval matches the real question. */
export function stripForceCodePhrasing(text) {
  let clean = String(text || "");
  for (const phrase of CODE_FORCE_PHRASES) {
    const re = new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "ig");
    clean = clean.replace(re, " ");
  }
  return clean.replace(/\s+/g, " ").trim();
}

export async function loadManualPack() {
  if (manualCache) return manualCache;
  if (manualPromise) return manualPromise;
  manualPromise = (async () => {
    try {
      const response = await fetch(new URL("./knowledge/game-manual.json", import.meta.url), {
        cache: "no-store"
      });
      if (!response.ok) throw new Error(`manual HTTP ${response.status}`);
      const data = await response.json();
      manualCache = {
        version: data.version || 1,
        chunks: (Array.isArray(data.chunks) ? data.chunks : [])
          .map((chunk) => ({
            id: String(chunk.id),
            topic: String(chunk.topic || ""),
            aliases: Array.isArray(chunk.aliases) ? chunk.aliases.map(String) : [],
            text: String(chunk.text || "").trim()
          }))
          .filter((chunk) => chunk.id && chunk.text)
      };
      return manualCache;
    } catch {
      manualCache = { version: 0, chunks: [] };
      return manualCache;
    } finally {
      manualPromise = null;
    }
  })();
  return manualPromise;
}

export async function loadCodeFactsPack() {
  if (codeCache) return codeCache;
  if (codePromise) return codePromise;
  codePromise = (async () => {
    try {
      const response = await fetch(new URL("./knowledge/code-facts.json", import.meta.url), {
        cache: "no-store"
      });
      if (!response.ok) throw new Error(`code-facts HTTP ${response.status}`);
      const data = await response.json();
      codeCache = {
        version: data.version || 1,
        generatedAt: data.generatedAt || null,
        entries: (Array.isArray(data.entries) ? data.entries : [])
          .map((entry) => ({
            id: String(entry.id),
            source: String(entry.source || ""),
            name: String(entry.name || ""),
            topic: String(entry.topic || ""),
            aliases: Array.isArray(entry.aliases) ? entry.aliases.map(String) : [],
            text: String(entry.text || "").trim()
          }))
          .filter((entry) => entry.id && entry.text)
      };
      return codeCache;
    } catch {
      codeCache = { version: 0, entries: [] };
      return codeCache;
    } finally {
      codePromise = null;
    }
  })();
  return codePromise;
}

export function setManualPackForTests(pack) {
  manualCache = pack;
  manualPromise = null;
}

export function setCodeFactsPackForTests(pack) {
  codeCache = pack;
  codePromise = null;
}

export function getManualPack() {
  return manualCache;
}

export function getCodeFactsPack() {
  return codeCache;
}

function scoreChunk(query, chunk) {
  let best = overlapScore(query, chunk.text);
  for (const alias of chunk.aliases || []) {
    if (normalize(query).includes(normalize(alias))) best = Math.max(best, 0.48);
    best = Math.max(best, overlapScore(query, alias) * 0.9);
  }
  if (chunk.topic && containsWord(query, chunk.topic)) best = Math.max(best, 0.4);
  if (chunk.name && containsWord(query, chunk.name)) best = Math.max(best, 0.5);
  return best;
}

function containsWord(text, word) {
  const needle = normalize(word);
  if (!needle) return false;
  return new RegExp(`\\b${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(normalize(text));
}

function rankChunks(query, chunks, source) {
  return chunks.map((chunk) => ({
    id: chunk.id,
    source,
    topic: chunk.topic || "",
    text: chunk.text,
    score: scoreChunk(query, chunk)
  })).sort((a, b) => b.score - a.score);
}

/**
 * Retrieve closed-world hits for a question.
 * @param {string} text
 * @param {object} options
 * @param {boolean} options.forceCode
 * @param {object|null} options.faqSemanticScores MiniLM FAQ id→score map
 * @param {number} options.topK
 */
export function retrieveKnowledge(text, options = {}) {
  const forceCode = Boolean(options.forceCode);
  const topK = options.topK || 5;
  const query = stripForceCodePhrasing(text) || String(text || "");
  const faqPack = options.faqPack || getGameFaqPack();
  const manual = options.manualPack || manualCache;
  const code = options.codePack || codeCache;

  const faqMatch = faqPack
    ? matchGameFaq(query, faqPack, options.faqSemanticScores || null)
    : { type: "unknown", confidence: 0, entry: null, ranked: [] };

  const manualHits = rankChunks(query, manual?.chunks || [], "manual");
  const codeHits = rankChunks(query, code?.entries || [], "code");

  if (forceCode) {
    const hits = codeHits.filter((h) => h.score >= CODE_HIT_CONF).slice(0, topK);
    return {
      forceCode: true,
      query,
      path: hits.length ? "code" : "unknown",
      confidence: hits[0]?.score || 0,
      level: hits.length ? (hits[0].score >= HIGH_CONF ? "high" : "mid") : "low",
      faqMatch,
      hits,
      faqAnswer: null
    };
  }

  const faqConf = faqMatch.type === "match" ? faqMatch.confidence : 0;
  const bestManual = manualHits[0]?.score || 0;
  const bestCode = codeHits[0]?.score || 0;

  if (faqMatch.type === "match" && faqConf >= HIGH_CONF) {
    return {
      forceCode: false,
      query,
      path: "faq",
      confidence: faqConf,
      level: "high",
      faqMatch,
      hits: [{
        id: faqMatch.entry.id,
        source: "faq",
        topic: (faqMatch.entry.tags || [])[0] || "",
        text: faqMatch.entry.answer,
        score: faqConf
      }],
      faqAnswer: faqMatch.entry.answer
    };
  }

  // Mid FAQ or stronger manual → deep path from mixed snippets.
  if (
    (faqMatch.type === "match" && faqConf >= MID_CONF)
    || bestManual >= MID_CONF
  ) {
    const mixed = [];
    if (faqMatch.type === "match") {
      mixed.push({
        id: faqMatch.entry.id,
        source: "faq",
        topic: (faqMatch.entry.tags || [])[0] || "",
        text: faqMatch.entry.answer,
        score: faqConf
      });
    }
    for (const hit of manualHits) {
      if (hit.score >= MID_CONF) mixed.push(hit);
    }
    mixed.sort((a, b) => b.score - a.score);
    const hits = mixed.slice(0, topK);
    return {
      forceCode: false,
      query,
      path: "deep",
      confidence: hits[0]?.score || 0,
      level: "mid",
      faqMatch,
      hits,
      faqAnswer: faqMatch.type === "match" ? faqMatch.entry.answer : null
    };
  }

  // Automatic code dig fallback when FAQ/manual are weak.
  if (bestCode >= CODE_HIT_CONF) {
    const hits = codeHits.filter((h) => h.score >= CODE_HIT_CONF).slice(0, topK);
    return {
      forceCode: false,
      query,
      path: "code-fallback",
      confidence: hits[0]?.score || 0,
      level: "mid",
      faqMatch,
      hits,
      faqAnswer: null
    };
  }

  return {
    forceCode: false,
    query,
    path: "unknown",
    confidence: Math.max(faqConf, bestManual, bestCode),
    level: "low",
    faqMatch,
    hits: [],
    faqAnswer: null
  };
}

export async function ensureKnowledgePacks() {
  await Promise.all([
    loadGameFaqPack().catch(() => null),
    loadManualPack(),
    loadCodeFactsPack()
  ]);
}

export { composeFaqReply, HIGH_CONF, MID_CONF, CODE_HIT_CONF };
