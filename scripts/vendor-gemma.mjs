#!/usr/bin/env node
/**
 * Optional one-time setup: vendor Gemma 3 270M IT (ONNX) for deep buddy blurbs.
 * Runtime gameplay never calls this and never fetches remote model URLs.
 *
 * Expected layout after a successful vendor:
 *   models/gemma-3-270m-it/config.json (+ tokenizer + onnx weights)
 *   models/MANIFEST.json → generator section
 *
 * If Hugging Face gated/auth is required for the chosen repo, place files
 * manually into models/gemma-3-270m-it/ then re-run with --manifest-only.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, cpSync, statSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MODEL_ID = "gemma-3-270m-it";
const MODEL_DIR = join(ROOT, "models", MODEL_ID);
const MANIFEST_PATH = join(ROOT, "models", "MANIFEST.json");
/** onnx-community style repo id; override with GEMMA_HF_REPO. */
const HF_REPO = process.env.GEMMA_HF_REPO || "onnx-community/gemma-3-270m-it-ONNX";
const HF_MIRRORS = [
  "https://huggingface.co",
  "https://hf-mirror.com"
];

const MODEL_FILES = [
  "config.json",
  "tokenizer.json",
  "tokenizer_config.json",
  "special_tokens_map.json",
  "generation_config.json",
  "onnx/model_q4.onnx",
  "onnx/model_quantized.onnx"
];

function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}

function sha256File(path) {
  const hash = createHash("sha256");
  hash.update(readFileSync(path));
  return hash.digest("hex");
}

function dirSize(path) {
  if (!existsSync(path)) return 0;
  let total = 0;
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const full = join(path, entry.name);
    total += entry.isDirectory() ? dirSize(full) : statSync(full).size;
  }
  return total;
}

function curlBin() {
  for (const bin of ["curl", "curl.exe"]) {
    const probe = spawnSync(bin, ["--version"], { encoding: "utf8" });
    if (probe.status === 0) return bin;
  }
  return null;
}

function downloadWithCurl(url, dest) {
  const bin = curlBin();
  if (!bin) throw new Error("curl not available");
  ensureDir(dirname(dest));
  const tmp = `${dest}.partial`;
  const result = spawnSync(
    bin,
    [
      "-L", "--retry", "5", "--retry-all-errors", "--retry-delay", "2",
      "--connect-timeout", "30", "--fail", "--silent", "--show-error",
      "-A", "robot-buddy-arena-vendor-gemma/1.0",
      "-o", tmp, url
    ],
    { encoding: "utf8" }
  );
  if (result.status !== 0) {
    try { rmSync(tmp, { force: true }); } catch { /* ignore */ }
    throw new Error((result.stderr || result.stdout || `curl exit ${result.status}`).trim());
  }
  try { rmSync(dest, { force: true }); } catch { /* ignore */ }
  cpSync(tmp, dest);
  rmSync(tmp, { force: true });
  return statSync(dest).size;
}

function tryDownload() {
  ensureDir(MODEL_DIR);
  const got = [];
  for (const rel of MODEL_FILES) {
    const dest = join(MODEL_DIR, rel);
    if (existsSync(dest) && statSync(dest).size > 0) {
      got.push(rel);
      continue;
    }
    let saved = false;
    for (const mirror of HF_MIRRORS) {
      const url = `${mirror}/${HF_REPO}/resolve/main/${rel}`;
      try {
        console.log(`Fetching ${rel}…`);
        downloadWithCurl(url, dest);
        got.push(rel);
        saved = true;
        break;
      } catch (error) {
        console.warn(`  ${mirror} failed: ${error.message}`);
      }
    }
    if (!saved && /model_q4|model_quantized/.test(rel)) {
      // One of the quantized weight names is enough.
      continue;
    }
  }
  const hasConfig = existsSync(join(MODEL_DIR, "config.json"));
  const hasWeights = existsSync(join(MODEL_DIR, "onnx/model_q4.onnx"))
    || existsSync(join(MODEL_DIR, "onnx/model_quantized.onnx"));
  return hasConfig && hasWeights;
}

function writeLicenseStub() {
  const licensePath = join(MODEL_DIR, "LICENSE");
  if (!existsSync(licensePath)) {
    writeFileSync(licensePath, [
      "Gemma models are subject to Google's Gemma Terms of Use.",
      "Review https://ai.google.dev/gemma/terms before distributing weights.",
      "This game vendors weights optionally; runtime never downloads them.",
      ""
    ].join("\n"));
  }
  writeFileSync(join(MODEL_DIR, "ATTRIBUTION.md"), [
    `# ${MODEL_ID}`,
    "",
    `- Source repo: \`${HF_REPO}\``,
    "- Role: optional short-blurb rewriter for deep buddy Q&A",
    "- Offline contract: local models/ only, no runtime download",
    "- License: Gemma Terms of Use (not Apache-2.0)",
    ""
  ].join("\n"));
}

function updateManifest(ok) {
  let manifest = {};
  if (existsSync(MANIFEST_PATH)) {
    try { manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")); } catch { manifest = {}; }
  }
  const files = [];
  if (existsSync(MODEL_DIR)) {
    const walk = (dir, prefix = "") => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full, rel);
        else {
          files.push({
            path: rel,
            bytes: statSync(full).size,
            sha256: sha256File(full)
          });
        }
      }
    };
    walk(MODEL_DIR);
  }
  manifest.generator = {
    id: MODEL_ID,
    sourceRepo: HF_REPO,
    license: "Gemma Terms of Use",
    optional: true,
    vendored: ok,
    vendoredAt: new Date().toISOString(),
    diskBytes: dirSize(MODEL_DIR),
    files,
    offlineContract: {
      allowRemoteModels: false,
      connectSrc: "self",
      runtimeDownload: false
    }
  };
  ensureDir(dirname(MANIFEST_PATH));
  writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
}

const manifestOnly = process.argv.includes("--manifest-only");
const ok = manifestOnly
  ? (existsSync(join(MODEL_DIR, "config.json"))
    && (existsSync(join(MODEL_DIR, "onnx/model_q4.onnx"))
      || existsSync(join(MODEL_DIR, "onnx/model_quantized.onnx"))))
  : tryDownload();

if (ok) writeLicenseStub();
updateManifest(ok);

if (!ok) {
  console.log(`Gemma assets not fully vendored under models/${MODEL_ID}/.`);
  console.log("Deep Q&A will use the snippet stitcher until weights are present.");
  console.log("Place ONNX + tokenizer files manually, then: npm run vendor-gemma -- --manifest-only");
  process.exitCode = 0;
} else {
  console.log(`Gemma generator ready in models/${MODEL_ID}/ (${dirSize(MODEL_DIR)} bytes).`);
}
