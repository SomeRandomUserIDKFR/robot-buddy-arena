/**
 * Optional Web Worker: Gemma 3 270M short blurb rewriter.
 * Loads only same-origin models/gemma-3-270m-it + vendor runtime.
 * Never fetches remote models. Answers only from provided snippets.
 */
import { env, pipeline } from "./vendor/analyzer-runtime.js";

const MODEL_ID = "gemma-3-270m-it";
const MAX_NEW_TOKENS = 96;

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
  env.remoteHost = "";
  env.remoteURL = "";
  env.localModelPath = new URL("./models/", base).href;
  const wasmPath = new URL("./vendor/ort-wasm/", base).href;
  if (env.backends?.onnx?.wasm) {
    env.backends.onnx.wasm.wasmPaths = wasmPath;
    env.backends.onnx.wasm.numThreads = 1;
    env.backends.onnx.wasm.proxy = false;
  }
  if (env.backends?.onnx) {
    env.backends.onnx.wasmPaths = wasmPath;
  }
}

let generator = null;
let ready = false;

function buildPrompt(question, snippets, codePrefixed) {
  return [
    "You are the robot buddy in Robot Buddy Arena.",
    "Answer ONLY using the provided local snippets.",
    "Write 1-3 short sentences in a humble coaching voice.",
    "If the snippets do not cover the question, say you do not know.",
    "Never invent Cyber rewards, controls, jetpack rules, or other mechanics.",
    "Never answer off-topic questions.",
    codePrefixed ? "Prefix is handled by the host; do not invent source citations." : "",
    "",
    "SNIPPETS:",
    snippets,
    "",
    `QUESTION: ${question}`,
    "ANSWER:"
  ].filter(Boolean).join("\n");
}

function cleanGenerated(text, prompt) {
  let out = String(text || "");
  if (out.startsWith(prompt)) out = out.slice(prompt.length);
  out = out.replace(/^ANSWER:\s*/i, "").trim();
  // Keep short blurbs only.
  const sentences = out.split(/(?<=[.!?])\s+/).filter(Boolean).slice(0, 3);
  out = sentences.join(" ").trim();
  if (out.length > 420) out = `${out.slice(0, 400).trim()}…`;
  return out;
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
  generator = await pipeline("text-generation", MODEL_ID, {
    quantized: true
  });
  ready = true;
  return {
    ok: true,
    loadMs: Math.round(performance.now() - started),
    modelId: MODEL_ID
  };
}

async function generate({ question, snippets, codePrefixed }) {
  if (!ready || !generator) throw new Error("generator worker not ready");
  const prompt = buildPrompt(question, snippets, codePrefixed);
  const started = performance.now();
  const output = await generator(prompt, {
    max_new_tokens: MAX_NEW_TOKENS,
    temperature: 0.2,
    do_sample: false,
    return_full_text: false
  });
  const raw = Array.isArray(output)
    ? (output[0]?.generated_text || output[0]?.text || "")
    : (output?.generated_text || "");
  return {
    text: cleanGenerated(raw, prompt),
    inferenceMs: Math.round(performance.now() - started)
  };
}

self.onmessage = async (event) => {
  const { id, type } = event.data || {};
  try {
    if (type === "init") {
      const result = await initialize();
      self.postMessage({ id, type: "init", ...result });
      return;
    }
    if (type === "generate") {
      const result = await generate(event.data || {});
      self.postMessage({ id, type: "generate", ...result });
      return;
    }
    throw new Error(`Unknown generator message: ${type}`);
  } catch (error) {
    self.postMessage({
      id,
      type: "error",
      message: String(error?.message || error)
    });
  }
};
