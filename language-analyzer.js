/**
 * Offline language analyzer facade.
 * Prefer vendored MiniLM embeddings for closed-set intent ranking and FAQ
 * matching; fall back to deterministic hybrid parser / keyword FAQ when model
 * assets or the worker are unavailable. Never downloads models at runtime.
 */
import { DIRECTIVES, parseCoachingIntent } from "./coaching.js";
import {
  classifyBuddyMessage, loadGameFaqPack, matchGameFaq, getGameFaqPack, faqEntryCount,
  FAQ_TOPIC_CHIPS, topicChipPrompt
} from "./game-faq.js";
import {
  detectForceCode, ensureKnowledgePacks, retrieveKnowledge
} from "./knowledge-retrieve.js";
import {
  generateBuddyBlurb, generatorStatus, initializeLanguageGenerator
} from "./language-generator.js";

export const ANALYZER_STATES = Object.freeze({
  LOADING: "loading",
  READY: "ready",
  BASIC: "basic"
});

const MODEL_ID = "all-MiniLM-L6-v2";
const ALLOWED_INTENTS = Object.freeze(Object.keys(DIRECTIVES));

let state = ANALYZER_STATES.BASIC;
let worker = null;
let initPromise = null;
let nextRequestId = 1;
const pending = new Map();
let lastLoadMs = null;
let lastInferenceMs = null;
let lastError = null;
let faqReady = false;
let faqSemanticReady = false;

export function analyzerStatus() {
  const faqNote = faqReady
    ? (faqSemanticReady ? " · Q&A ready" : " · Q&A keywords")
    : "";
  const coachNote = generatorStatus().labelNote || "";
  const base = state === ANALYZER_STATES.READY
    ? "Local language analyzer ready"
    : state === ANALYZER_STATES.LOADING
      ? "Loading local analyzer…"
      : "Basic understanding active";
  return {
    state,
    label: `${base}${faqNote}${coachNote}`,
    modelId: state === ANALYZER_STATES.READY ? MODEL_ID : null,
    loadMs: lastLoadMs,
    inferenceMs: lastInferenceMs,
    error: lastError,
    faqReady,
    faqSemanticReady,
    faqEntries: faqEntryCount(),
    generator: generatorStatus()
  };
}

function rejectAll(message) {
  for (const [, entry] of pending) entry.reject(new Error(message));
  pending.clear();
}

function postWorker(type, payload = {}, timeoutMs = 120_000) {
  return new Promise((resolve, reject) => {
    if (!worker) {
      reject(new Error("analyzer worker missing"));
      return;
    }
    const id = nextRequestId++;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`analyzer worker timeout (${type})`));
    }, timeoutMs);
    pending.set(id, {
      resolve: (value) => { clearTimeout(timer); resolve(value); },
      reject: (error) => { clearTimeout(timer); reject(error); }
    });
    worker.postMessage({ id, type, ...payload });
  });
}

function detachWorker(reason) {
  lastError = reason || lastError;
  if (worker) {
    worker.terminate();
    worker = null;
  }
  rejectAll(reason || "analyzer worker stopped");
  state = ANALYZER_STATES.BASIC;
  faqSemanticReady = false;
}

async function probeLocalAssets() {
  // Only probe a small JSON file with GET. Some static servers mishandle HEAD.
  const checks = [
    `./models/${MODEL_ID}/config.json`,
    "./vendor/analyzer-runtime.js",
    "./language-analyzer-worker.js"
  ];
  for (const url of checks) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) return false;
      await response.arrayBuffer();
    } catch {
      return false;
    }
  }
  return true;
}

function attachWorker() {
  worker = new Worker(new URL("./language-analyzer-worker.js", import.meta.url), {
    type: "module"
  });
  worker.onmessage = (event) => {
    const data = event.data || {};
    const entry = pending.get(data.id);
    if (!entry) return;
    pending.delete(data.id);
    if (data.type === "error") entry.reject(new Error(data.message || "worker error"));
    else entry.resolve(data);
  };
  worker.onerror = (event) => {
    detachWorker(event.message || "worker failed");
  };
}

async function ensureFaqPack() {
  try {
    await loadGameFaqPack();
    faqReady = faqEntryCount() > 0;
  } catch (error) {
    faqReady = false;
    lastError = String(error?.message || error);
  }
}

/**
 * Start loading the local analyzer. Safe to call multiple times.
 * Typing/coaching remains usable while loading (basic parser).
 */
export async function initializeLanguageAnalyzer({ forceBasic = false } = {}) {
  await ensureFaqPack();
  await ensureKnowledgePacks();
  // Optional Gemma probe — never blocks BASIC/MiniLM paths.
  initializeLanguageGenerator().catch(() => {});
  if (forceBasic) {
    detachWorker("forced basic");
    state = ANALYZER_STATES.BASIC;
    faqSemanticReady = false;
    return analyzerStatus();
  }
  if (state === ANALYZER_STATES.READY) return analyzerStatus();
  if (initPromise) return initPromise;

  initPromise = (async () => {
    state = ANALYZER_STATES.LOADING;
    lastError = null;
    try {
      if (typeof Worker === "undefined") {
        state = ANALYZER_STATES.BASIC;
        lastError = "Web Workers unavailable";
        return analyzerStatus();
      }
      const present = await probeLocalAssets();
      if (!present) {
        state = ANALYZER_STATES.BASIC;
        lastError = "local model assets missing";
        return analyzerStatus();
      }
      attachWorker();
      const result = await postWorker("init");
      lastLoadMs = result.loadMs ?? null;
      state = ANALYZER_STATES.READY;
      faqSemanticReady = faqReady && Number(result.faqEntries || 0) > 0;
      return analyzerStatus();
    } catch (error) {
      detachWorker(String(error?.message || error));
      return analyzerStatus();
    } finally {
      initPromise = null;
    }
  })();

  return initPromise;
}

async function semanticScoresFor(text) {
  if (state !== ANALYZER_STATES.READY || !worker) return null;
  try {
    const result = await postWorker("rank", { text });
    lastInferenceMs = result.inferenceMs ?? null;
    const scores = {};
    for (const intent of ALLOWED_INTENTS) {
      if (typeof result.scores?.[intent] === "number") {
        scores[intent] = result.scores[intent];
      }
    }
    return scores;
  } catch (error) {
    detachWorker(String(error?.message || error));
    return null;
  }
}

async function faqSemanticScoresFor(text) {
  if (state !== ANALYZER_STATES.READY || !worker || !faqSemanticReady) return null;
  try {
    const result = await postWorker("rankFaq", { text });
    lastInferenceMs = result.inferenceMs ?? null;
    return result.scores || null;
  } catch (error) {
    // Keep intent ranking if FAQ rank fails; keyword FAQ still works.
    lastError = String(error?.message || error);
    faqSemanticReady = false;
    return null;
  }
}

/**
 * Analyze coaching text. Deterministic rules stay authoritative for approval,
 * denial, negation flips, conditions, and conflicts; semantic scores only
 * refine closed-set intent ranking when the local model is ready.
 */
export async function analyzeCoachingText(text, learnedVocabulary = []) {
  const semanticScores = await semanticScoresFor(text);
  const analysis = parseCoachingIntent(text, learnedVocabulary, semanticScores);
  const intents = (analysis.intents || analysis.candidates || [])
    .filter((intent) => Object.hasOwn(DIRECTIVES, intent))
    .slice(0, 2);
  return {
    ...analysis,
    ...(analysis.intents ? { intents, intent: intents[0] } : { candidates: intents }),
    analyzer: state,
    semantic: Boolean(semanticScores)
  };
}

/**
 * Route and analyze a buddy chat turn: game question vs coaching directive.
 * Pending confirmations should skip this and stay on coachingReply directly,
 * but callers may still pass allowRoute=false.
 */
export async function analyzeBuddyMessage(text, learnedVocabulary = [], options = {}) {
  const { allowRoute = true, forceRoute = null } = options;
  if (!faqReady) await ensureFaqPack();

  const chip = FAQ_TOPIC_CHIPS.find((item) => item.toLowerCase() === String(text || "").trim().toLowerCase());
  const effectiveText = chip ? topicChipPrompt(chip) : text;

  const classification = forceRoute
    ? { route: forceRoute, normalized: String(effectiveText || ""), reason: "forced" }
    : allowRoute
      ? classifyBuddyMessage(effectiveText)
      : { route: "coaching", normalized: String(effectiveText || ""), reason: "route-disabled" };

  if (classification.route === "empty") {
    return { kind: "empty", classification, analyzer: state };
  }

  if (classification.route === "ambiguous") {
    return {
      kind: "ambiguous",
      classification,
      analyzer: state,
      faqReady
    };
  }

  if (classification.route === "question") {
    const pack = getGameFaqPack();
    await ensureKnowledgePacks();
    const semantic = await faqSemanticScoresFor(effectiveText);
    const forceCode = detectForceCode(effectiveText);
    const retrieval = retrieveKnowledge(effectiveText, {
      forceCode,
      faqSemanticScores: semantic
    });
    const match = retrieval.faqMatch?.type === "match"
      ? retrieval.faqMatch
      : matchGameFaq(effectiveText, pack, semantic);
    let generatedBlurb = null;
    if (
      retrieval.path === "deep"
      || retrieval.path === "code"
      || retrieval.path === "code-fallback"
    ) {
      generatedBlurb = await generateBuddyBlurb(
        retrieval.query || effectiveText,
        retrieval.hits,
        { codePrefixed: retrieval.path !== "deep" }
      );
    }
    return {
      kind: "question",
      classification,
      match,
      retrieval,
      forceCode,
      generatedBlurb,
      analyzer: state,
      semantic: Boolean(semantic),
      faqReady: Boolean(pack),
      effectiveText
    };
  }

  const coaching = await analyzeCoachingText(effectiveText, learnedVocabulary);
  return {
    kind: "coaching",
    classification,
    coaching,
    analyzer: state,
    semantic: coaching.semantic
  };
}
