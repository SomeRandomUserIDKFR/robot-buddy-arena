/**
 * Web Worker: local MiniLM embeddings for closed-set coaching intents
 * and curated FAQ ranking. Loads only same-origin files under models/,
 * vendor/, and knowledge/. Never fetches remote models.
 */
import { env, pipeline } from "./vendor/analyzer-runtime.js";

const MODEL_ID = "all-MiniLM-L6-v2";

/** Exemplars used to build each intent's prototype embedding. */
const INTENT_EXEMPLARS = Object.freeze({
  rush: [
    "push with me and engage sooner",
    "charge in and close the distance",
    "be more aggressive and take the fight"
  ],
  safer: [
    "play safer and retreat earlier",
    "fall back and avoid overcommitting",
    "disengage from bad fights"
  ],
  stayClose: [
    "stay close and follow me",
    "stick with me and stay nearby",
    "shadow me and move together"
  ],
  keepDistance: [
    "keep distance and cover me from range",
    "hang back with the rifle and provide cover",
    "create space and hold the back line"
  ],
  saveFuel: [
    "save jetpack fuel and conserve the tank",
    "do not waste fuel chasing",
    "keep boost in reserve"
  ],
  useJetpack: [
    "use the jetpack more to take height",
    "fly more and get above them",
    "take the roof with vertical movement"
  ],
  dodgeMore: [
    "dodge more incoming attacks",
    "sidestep shots and evade swings",
    "juke projectiles instead of eating them"
  ],
  flankScout: [
    "flank and scout ahead",
    "go around behind them for a side angle",
    "circle around and wrap their side"
  ],
  focusTargets: [
    "focus my pings and marked targets",
    "prioritize whoever I tag",
    "shoot the person I mark"
  ]
});

function assertLocalUrl(url) {
  const value = String(url);
  if (/huggingface\.co|hf\.co|cdn\.jsdelivr|unpkg\.com|googleapis|hf-mirror|telemetry/i.test(value)) {
    throw new Error(`Blocked remote model host in URL: ${value}`);
  }
  if (/^https?:\/\//i.test(value) && self.location?.origin) {
    try {
      const parsed = new URL(value, self.location.href);
      if (parsed.origin !== self.location.origin) {
        throw new Error(`Blocked non-local URL: ${parsed.href}`);
      }
    } catch (error) {
      if (String(error.message || error).startsWith("Blocked")) throw error;
    }
  }
}

function configureOfflineEnv() {
  const base = new URL("./", self.location.href);
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.useBrowserCache = false;
  // Prevent any default CDN host usage from Transformers.js.
  env.remoteHost = "";
  env.remoteURL = "";
  env.localModelPath = new URL("./models/", base).href;
  const wasmPath = new URL("./vendor/ort-wasm/", base).href;
  if (env.backends?.onnx?.wasm) {
    env.backends.onnx.wasm.wasmPaths = wasmPath;
    env.backends.onnx.wasm.numThreads = 1;
    env.backends.onnx.wasm.proxy = false;
  }
  // Some builds stash wasmPaths on the ORT env directly.
  if (env.backends?.onnx) {
    env.backends.onnx.wasmPaths = wasmPath;
  }
}

function meanPool(vectors) {
  const dim = vectors[0].length;
  const out = new Float32Array(dim);
  for (const vector of vectors) {
    for (let i = 0; i < dim; i++) out[i] += vector[i];
  }
  for (let i = 0; i < dim; i++) out[i] /= vectors.length;
  return normalize(out);
}

function normalize(vector) {
  let sum = 0;
  for (let i = 0; i < vector.length; i++) sum += vector[i] * vector[i];
  const norm = Math.sqrt(sum) || 1;
  const out = new Float32Array(vector.length);
  for (let i = 0; i < vector.length; i++) out[i] = vector[i] / norm;
  return out;
}

function cosine(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

let extractor = null;
let prototypes = null;
let faqPrototypes = null;
let faqEntryCount = 0;
let ready = false;

async function embed(text) {
  const output = await extractor(text, { pooling: "mean", normalize: true });
  return normalize(Float32Array.from(output.data));
}

async function buildPrototypes() {
  const result = {};
  for (const [intent, phrases] of Object.entries(INTENT_EXEMPLARS)) {
    const vectors = [];
    for (const phrase of phrases) vectors.push(await embed(phrase));
    result[intent] = meanPool(vectors);
  }
  return result;
}

async function loadFaqPrototypes() {
  const url = new URL("./knowledge/game-faq.json", self.location.href);
  assertLocalUrl(url.href);
  const response = await fetch(url.href, { cache: "no-store" });
  if (!response.ok) throw new Error(`FAQ pack HTTP ${response.status}`);
  const data = await response.json();
  const entries = Array.isArray(data?.entries) ? data.entries : [];
  const result = {};
  for (const entry of entries) {
    const id = String(entry?.id || "");
    const questions = Array.isArray(entry?.questions) ? entry.questions.map(String) : [];
    if (!id || !questions.length) continue;
    // Cap exemplars so init stays practical while covering paraphrases.
    const sample = questions.slice(0, 5);
    const vectors = [];
    for (const phrase of sample) vectors.push(await embed(phrase));
    result[id] = meanPool(vectors);
  }
  faqEntryCount = Object.keys(result).length;
  return result;
}

async function initialize() {
  configureOfflineEnv();
  const originalFetch = self.fetch.bind(self);
  self.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input?.url || String(input);
    assertLocalUrl(url);
    return originalFetch(input, init);
  };

  const started = performance.now();
  extractor = await pipeline("feature-extraction", MODEL_ID, {
    quantized: true
  });
  prototypes = await buildPrototypes();
  try {
    faqPrototypes = await loadFaqPrototypes();
  } catch {
    faqPrototypes = {};
    faqEntryCount = 0;
  }
  ready = true;
  return {
    ok: true,
    loadMs: Math.round(performance.now() - started),
    modelId: MODEL_ID,
    faqEntries: faqEntryCount
  };
}

async function rankAgainst(text, table) {
  if (!ready) throw new Error("analyzer worker not ready");
  const started = performance.now();
  const vector = await embed(String(text || ""));
  const scores = {};
  for (const [key, prototype] of Object.entries(table || {})) {
    // Sentence-transformer cosines are typically in (0, 1) after normalize.
    scores[key] = Math.max(0, Math.min(1, cosine(vector, prototype)));
  }
  return {
    scores,
    inferenceMs: Math.round(performance.now() - started)
  };
}

self.onmessage = async (event) => {
  const { id, type, text } = event.data || {};
  try {
    if (type === "init") {
      const result = await initialize();
      self.postMessage({ id, type: "init", ...result });
      return;
    }
    if (type === "rank") {
      const result = await rankAgainst(text, prototypes);
      self.postMessage({ id, type: "rank", ...result });
      return;
    }
    if (type === "rankFaq") {
      const result = await rankAgainst(text, faqPrototypes);
      self.postMessage({ id, type: "rankFaq", faqEntries: faqEntryCount, ...result });
      return;
    }
    throw new Error(`Unknown worker message: ${type}`);
  } catch (error) {
    self.postMessage({
      id,
      type: "error",
      message: String(error?.message || error)
    });
  }
};
