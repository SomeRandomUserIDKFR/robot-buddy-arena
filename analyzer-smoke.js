const out = document.querySelector("#result");
const remoteHits = [];
const logs = [];
const originalFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input.url;
  logs.push(`fetch ${url}`);
  if (/huggingface\.co|hf\.co|cdn\.jsdelivr|unpkg\.com|hf-mirror|googleapis/i.test(url)) {
    remoteHits.push(url);
    throw new Error(`remote fetch blocked: ${url}`);
  }
  return originalFetch(input, init);
};

function fail(message) {
  out.textContent = JSON.stringify({
    result: "FAIL",
    message: String(message),
    remoteFetches: remoteHits,
    logs: logs.slice(-40)
  }, null, 2);
}

try {
  const {
    initializeLanguageAnalyzer, analyzeCoachingText, analyzerStatus
  } = await import("./language-analyzer.js");

  const loadStarted = performance.now();
  const status = await Promise.race([
    initializeLanguageAnalyzer(),
    new Promise((_, reject) => setTimeout(() => reject(new Error("initialize timed out")), 90_000))
  ]);
  const loadMs = Math.round(performance.now() - loadStarted);
  logs.push(`status ${JSON.stringify(status)}`);

  if (status.state !== "ready") {
    throw new Error(`expected ready, got ${status.state}: ${status.error || ""}`);
  }

  const inferStarted = performance.now();
  const analyzed = await analyzeCoachingText("circle around behind them and focus my ping");
  const inferenceMs = Math.round(performance.now() - inferStarted);

  if (remoteHits.length) throw new Error(`remote URLs touched: ${remoteHits.join(", ")}`);
  if (!analyzed.intents?.includes("flankScout") && !analyzed.intents?.includes("focusTargets")) {
    throw new Error(`unexpected intents: ${JSON.stringify(analyzed)}`);
  }
  if (analyzed.analyzer !== "ready") throw new Error("analyzer flag not ready");

  const { analyzeBuddyMessage } = await import("./language-analyzer.js");
  const qa = await analyzeBuddyMessage("How does jetpack fuel work?");
  if (qa.kind !== "question") throw new Error(`expected FAQ question route, got ${qa.kind}`);
  if (qa.match?.entry?.id !== "jetpack-fuel") {
    throw new Error(`unexpected FAQ match: ${JSON.stringify(qa.match)}`);
  }

  out.textContent = JSON.stringify({
    result: "PASS",
    state: analyzerStatus().state,
    loadMs: analyzerStatus().loadMs ?? loadMs,
    inferenceMs: analyzerStatus().inferenceMs ?? inferenceMs,
    intents: analyzed.intents,
    faqId: qa.match.entry.id,
    faqSemantic: Boolean(qa.semantic),
    remoteFetches: remoteHits.length
  }, null, 2);
} catch (error) {
  fail(error?.message || error);
}
