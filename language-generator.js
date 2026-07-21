/**
 * Optional offline Gemma 3 270M short-blurb rewriter for deep Q&A.
 * Missing assets → BASIC stitcher path (null blurb). Never downloads models.
 */
export const GENERATOR_STATES = Object.freeze({
  MISSING: "missing",
  LOADING: "loading",
  READY: "ready",
  BASIC: "basic",
  ERROR: "error"
});

const MODEL_ID = "gemma-3-270m-it";

let state = GENERATOR_STATES.MISSING;
let worker = null;
let initPromise = null;
let nextRequestId = 1;
const pending = new Map();
let lastError = null;
let probed = false;

export function generatorStatus() {
  const note = state === GENERATOR_STATES.READY
    ? " · Coach voice ready"
    : state === GENERATOR_STATES.LOADING
      ? " · Loading coach voice…"
      : state === GENERATOR_STATES.ERROR
        ? " · Coach voice basic"
        : "";
  return {
    state,
    labelNote: note,
    modelId: state === GENERATOR_STATES.READY ? MODEL_ID : null,
    error: lastError
  };
}

async function assetsPresent() {
  try {
    const config = await fetch(new URL(`./models/${MODEL_ID}/config.json`, import.meta.url), {
      cache: "no-store"
    });
    if (!config.ok) return false;
    const workerProbe = await fetch(new URL("./language-generator-worker.js", import.meta.url), {
      cache: "no-store",
      method: "HEAD"
    });
    return workerProbe.ok;
  } catch {
    return false;
  }
}

function rejectAll(message) {
  for (const [, entry] of pending) entry.reject(new Error(message));
  pending.clear();
}

function postWorker(type, payload = {}, timeoutMs = 120_000) {
  return new Promise((resolve, reject) => {
    if (!worker) {
      reject(new Error("generator worker missing"));
      return;
    }
    const id = nextRequestId++;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`generator worker timeout (${type})`));
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
  state = GENERATOR_STATES.BASIC;
  if (worker) {
    try { worker.terminate(); } catch { /* ignore */ }
  }
  worker = null;
  rejectAll(reason || "generator worker detached");
}

function attachWorker() {
  worker = new Worker(new URL("./language-generator-worker.js", import.meta.url), {
    type: "module"
  });
  worker.onmessage = (event) => {
    const data = event.data || {};
    if (data.type === "error") {
      const entry = pending.get(data.id);
      if (entry) {
        pending.delete(data.id);
        entry.reject(new Error(data.message || "generator error"));
      }
      return;
    }
    const entry = pending.get(data.id);
    if (!entry) return;
    pending.delete(data.id);
    entry.resolve(data);
  };
  worker.onerror = (event) => {
    detachWorker(String(event?.message || "generator worker error"));
  };
}

/**
 * Probe optional Gemma assets. Safe to call multiple times.
 * Does not block gameplay if missing.
 */
export async function initializeLanguageGenerator() {
  if (initPromise) return initPromise;
  if (probed && state !== GENERATOR_STATES.MISSING && state !== GENERATOR_STATES.LOADING) {
    return { state };
  }
  initPromise = (async () => {
    probed = true;
    const present = await assetsPresent();
    if (!present) {
      state = GENERATOR_STATES.MISSING;
      return { state };
    }
    state = GENERATOR_STATES.LOADING;
    try {
      attachWorker();
      const result = await postWorker("init", {}, 180_000);
      if (!result.ok) throw new Error(result.message || "generator init failed");
      state = GENERATOR_STATES.READY;
      return { state, modelId: MODEL_ID, loadMs: result.loadMs };
    } catch (error) {
      lastError = String(error?.message || error);
      detachWorker(lastError);
      state = GENERATOR_STATES.BASIC;
      return { state, error: lastError };
    } finally {
      initPromise = null;
    }
  })();
  return initPromise;
}

/**
 * Ask Gemma (if ready) for a short blurb grounded in snippets.
 * Returns null when unavailable — callers use the stitcher.
 */
export async function generateBuddyBlurb(question, hits, options = {}) {
  if (state === GENERATOR_STATES.MISSING || state === GENERATOR_STATES.BASIC) {
    // Lazy probe once if never initialized.
    if (!probed) await initializeLanguageGenerator();
  }
  if (state !== GENERATOR_STATES.READY || !worker) return null;

  const snippets = (hits || [])
    .slice(0, 5)
    .map((hit, index) => `[${index + 1}] (${hit.source || "local"}) ${hit.text}`)
    .join("\n");
  if (!snippets) return null;

  try {
    const result = await postWorker("generate", {
      question: String(question || ""),
      snippets,
      codePrefixed: Boolean(options.codePrefixed)
    }, 60_000);
    const text = String(result?.text || "").trim();
    return text || null;
  } catch (error) {
    lastError = String(error?.message || error);
    return null;
  }
}

/** Test helper */
export function setGeneratorStateForTests(next) {
  state = next;
  probed = true;
}
