#!/usr/bin/env node
/**
 * Headless browser smoke via puppeteer-core + system Chrome/Edge.
 * Requires vendored model/runtime assets. Fails if any remote model URL is fetched.
 */
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 8765;
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".onnx": "application/octet-stream",
  ".txt": "text/plain",
  ".css": "text/css"
};

function requiredAssetsPresent() {
  return [
    "models/all-MiniLM-L6-v2/onnx/model_quantized.onnx",
    "vendor/analyzer-runtime.js",
    "vendor/ort-wasm/ort-wasm-simd-threaded.jsep.wasm",
    "language-analyzer-worker.js"
  ].every((rel) => existsSync(join(ROOT, rel)));
}

function findChrome() {
  return [
    process.env.CHROME_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"
  ].filter(Boolean).find((path) => existsSync(path));
}

function startStaticServer() {
  const server = createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
    const rel = urlPath === "/" ? "/analyzer-smoke.html" : urlPath;
    const filePath = join(ROOT, rel.replace(/^\//, ""));
    if (!filePath.startsWith(ROOT) || !existsSync(filePath) || statSync(filePath).isDirectory()) {
      res.writeHead(404);
      res.end("missing");
      return;
    }
    res.writeHead(200, {
      "Content-Type": TYPES[extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    res.end(readFileSync(filePath));
  });
  return new Promise((resolve) => {
    server.listen(PORT, "127.0.0.1", () => resolve(server));
  });
}

if (!requiredAssetsPresent()) {
  console.error("Missing vendored model/runtime assets. Run: npm run vendor-model");
  process.exit(1);
}

let puppeteer;
try {
  puppeteer = require(join(ROOT, "node_modules", "puppeteer-core"));
} catch {
  console.error("Install puppeteer-core for smoke: npm install --no-save puppeteer-core");
  process.exit(1);
}

const chromePath = findChrome();
if (!chromePath) {
  console.error("No Chrome/Edge found for headless smoke.");
  process.exit(1);
}

const server = await startStaticServer();
const browser = await puppeteer.launch({
  executablePath: chromePath,
  headless: "new",
  args: ["--no-sandbox", "--disable-gpu"]
});

try {
  const page = await browser.newPage();
  const consoleLines = [];
  page.on("console", (msg) => consoleLines.push(`[${msg.type()}] ${msg.text()}`));
  page.on("pageerror", (err) => consoleLines.push(`[pageerror] ${err.message}`));

  await page.goto(`http://127.0.0.1:${PORT}/analyzer-smoke.html`, {
    waitUntil: "domcontentloaded",
    timeout: 60_000
  });
  await page.waitForFunction(
    () => {
      const text = document.querySelector("#result")?.textContent || "";
      return text.includes("PASS") || text.includes("FAIL");
    },
    { timeout: 180_000 }
  );
  const text = await page.$eval("#result", (el) => el.textContent);
  const payload = JSON.parse(text);
  if (payload.result !== "PASS") {
    throw new Error(`${payload.message || text}\nConsole:\n${consoleLines.join("\n")}`);
  }
  const report = {
    ...payload,
    modelQuantizedBytes: statSync(join(ROOT, "models/all-MiniLM-L6-v2/onnx/model_quantized.onnx")).size,
    analyzerRuntimeBytes: statSync(join(ROOT, "vendor/analyzer-runtime.js")).size,
    ortWasmJsepBytes: statSync(join(ROOT, "vendor/ort-wasm/ort-wasm-simd-threaded.jsep.wasm")).size
  };
  console.log("Analyzer browser smoke PASS");
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  console.error(String(error?.message || error));
  await browser.close();
  server.close();
  process.exit(1);
}

await browser.close();
server.close();
void pathToFileURL;
