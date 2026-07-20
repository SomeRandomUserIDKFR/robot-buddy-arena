#!/usr/bin/env node
/**
 * One-time setup: download MiniLM encoder + bundle Transformers.js/ONNX for the browser.
 * Runtime gameplay never calls this and never fetches remote model URLs.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, cpSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MODEL_ID = "all-MiniLM-L6-v2";
const HF_REPO = "Xenova/all-MiniLM-L6-v2";
const HF_REVISION = "main";
const TRANSFORMERS_VERSION = "3.7.2";
const MODEL_DIR = join(ROOT, "models", MODEL_ID);
const VENDOR_DIR = join(ROOT, "vendor");
const MANIFEST_PATH = join(ROOT, "models", "MANIFEST.json");
const HF_MIRRORS = [
  "https://huggingface.co",
  "https://hf-mirror.com"
];

const MODEL_FILES = [
  "config.json",
  "tokenizer.json",
  "tokenizer_config.json",
  "special_tokens_map.json",
  "vocab.txt",
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

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 ** 2)).toFixed(1)} MB`;
}

function downloadWithCurl(url, dest) {
  ensureDir(dirname(dest));
  const tmp = `${dest}.partial`;
  const result = spawnSync(
    "curl.exe",
    [
      "-L", "--retry", "10", "--retry-all-errors", "--retry-delay", "2",
      "--connect-timeout", "30", "--fail", "--silent", "--show-error",
      "-A", "robot-buddy-arena-vendor-model/1.0",
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

function downloadFile(pathSuffix, dest) {
  let lastError;
  for (const base of HF_MIRRORS) {
    const url = `${base}/${pathSuffix}`;
    try {
      return downloadWithCurl(url, dest);
    } catch (error) {
      lastError = error;
      console.warn(`  mirror failed (${base}): ${error.message.split("\n")[0]}`);
    }
  }
  throw lastError;
}

function vendorModelFiles() {
  console.log(`Downloading ${HF_REPO} (quantized ONNX)…`);
  ensureDir(MODEL_DIR);
  const files = [];
  for (const file of MODEL_FILES) {
    const dest = join(MODEL_DIR, file);
    process.stdout.write(`  ${file}… `);
    const size = downloadFile(`${HF_REPO}/resolve/${HF_REVISION}/${file}`, dest);
    const digest = sha256File(dest);
    files.push({ path: file, bytes: size, sha256: digest });
    console.log(`${formatBytes(size)}  sha256=${digest.slice(0, 12)}…`);
  }

  const licenseDest = join(MODEL_DIR, "LICENSE");
  writeFileSync(licenseDest, `Apache License 2.0

Model: sentence-transformers/all-MiniLM-L6-v2
ONNX port: Xenova/all-MiniLM-L6-v2
https://www.apache.org/licenses/LICENSE-2.0
`);
  files.push({ path: "LICENSE", bytes: statSync(licenseDest).size, sha256: sha256File(licenseDest) });

  writeFileSync(join(MODEL_DIR, "ATTRIBUTION.md"), `# Model attribution

- **Identity:** \`sentence-transformers/all-MiniLM-L6-v2\` (MiniLM L6, 384-d)
- **ONNX package:** \`Xenova/all-MiniLM-L6-v2\`
- **Runtime weights:** \`onnx/model_quantized.onnx\` (dynamic quantized)
- **License:** Apache-2.0
- **Use:** closed-set coaching intent ranking only

L6 quantized (~22 MB) is preferred over MiniLM-L3 for ranking quality while remaining practical for localhost static serving.
`);
  return files;
}

function vendorRuntimeBundle() {
  console.log(`Bundling @huggingface/transformers@${TRANSFORMERS_VERSION} for offline browser use…`);
  const staging = join(VENDOR_DIR, ".bundle-staging");
  rmSync(staging, { recursive: true, force: true });
  ensureDir(staging);
  writeFileSync(join(staging, "package.json"), JSON.stringify({
    name: "robot-buddy-arena-bundle-staging",
    private: true,
    type: "module",
    dependencies: {
      "@huggingface/transformers": TRANSFORMERS_VERSION,
      esbuild: "^0.25.0"
    }
  }, null, 2));

  const install = spawnSync("npm", ["install", "--omit=dev", "--no-fund", "--no-audit"], {
    cwd: staging,
    stdio: "inherit",
    shell: true
  });
  if (install.status !== 0) throw new Error("npm install for bundle staging failed");

  const transformersPkg = join(staging, "node_modules", "@huggingface", "transformers");
  const ortWeb = join(staging, "node_modules", "onnxruntime-web");
  const ortCommon = join(staging, "node_modules", "onnxruntime-common");

  const build = spawnSync("node", ["--input-type=module"], {
    cwd: ROOT,
    shell: true,
    encoding: "utf8",
    input: `
import * as esbuild from ${JSON.stringify(join(staging, "node_modules/esbuild/lib/main.js").replace(/\\/g, "/"))};
await esbuild.build({
  entryPoints: ["scripts/analyzer-runtime-entry.mjs"],
  bundle: true,
  format: "esm",
  platform: "browser",
  outfile: "vendor/analyzer-runtime.js",
  target: ["es2022"],
  logLevel: "info",
  alias: {
    "@huggingface/transformers": ${JSON.stringify(join(transformersPkg, "dist/transformers.web.js").replace(/\\/g, "/"))},
    "onnxruntime-web": ${JSON.stringify(join(ortWeb, "dist/ort.mjs").replace(/\\/g, "/"))},
    "onnxruntime-common": ${JSON.stringify(join(ortCommon, "dist/esm/index.js").replace(/\\/g, "/"))}
  }
});
`
  });
  if (build.status !== 0) {
    console.error(build.stderr || build.stdout);
    throw new Error("esbuild bundle failed");
  }

  const wasmDest = join(VENDOR_DIR, "ort-wasm");
  rmSync(wasmDest, { recursive: true, force: true });
  ensureDir(wasmDest);
  const wasmSrc = join(ortWeb, "dist");
  for (const name of readdirSync(wasmSrc)) {
    if (/ort-wasm.*\.(wasm|mjs)$/.test(name)) {
      cpSync(join(wasmSrc, name), join(wasmDest, name));
    }
  }

  writeFileSync(join(VENDOR_DIR, "ATTRIBUTION.md"), `# Runtime attribution

- **@huggingface/transformers** ${TRANSFORMERS_VERSION} — Apache-2.0 (bundled into \`analyzer-runtime.js\`)
- **onnxruntime-web** — MIT (WASM under \`ort-wasm/\`)
- Gameplay never downloads models or runtimes from the network.
`);

  const licenseSrc = join(transformersPkg, "LICENSE");
  if (existsSync(licenseSrc)) {
    writeFileSync(join(VENDOR_DIR, "TRANSFORMERS_LICENSE"), readFileSync(licenseSrc));
  }

  rmSync(staging, { recursive: true, force: true });

  // Prevent the bundled Transformers.js default from pointing WASM at jsDelivr.
  spawnSync(process.execPath, [join(ROOT, "scripts", "patch-runtime-cdn.mjs")], {
    cwd: ROOT,
    stdio: "inherit"
  });

  return {
    analyzerRuntimeBytes: statSync(join(VENDOR_DIR, "analyzer-runtime.js")).size,
    ortWasmBytes: dirSize(wasmDest)
  };
}

function writeManifest(modelFiles, runtimeSizes) {
  const manifest = {
    vendoredAt: new Date().toISOString(),
    model: {
      id: MODEL_ID,
      sourceRepo: HF_REPO,
      baseModel: "sentence-transformers/all-MiniLM-L6-v2",
      license: "Apache-2.0",
      quantization: "onnx/model_quantized.onnx (dynamic quantized / q8)",
      embeddingDims: 384,
      files: modelFiles,
      diskBytes: dirSize(MODEL_DIR)
    },
    runtime: {
      package: `@huggingface/transformers@${TRANSFORMERS_VERSION}`,
      license: "Apache-2.0",
      analyzerRuntimeBytes: runtimeSizes.analyzerRuntimeBytes,
      ortWasmBytes: runtimeSizes.ortWasmBytes
    },
    offlineContract: {
      allowRemoteModels: false,
      connectSrc: "self",
      runtimeDownload: false
    }
  };
  ensureDir(dirname(MANIFEST_PATH));
  writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`\nWrote ${relative(ROOT, MANIFEST_PATH)}`);
  console.log(`Model dir: ${formatBytes(manifest.model.diskBytes)}`);
  console.log(`analyzer-runtime.js: ${formatBytes(runtimeSizes.analyzerRuntimeBytes)}`);
  console.log(`ort-wasm/: ${formatBytes(runtimeSizes.ortWasmBytes)}`);
  return manifest;
}

function verifyLayout() {
  const required = [
    join(MODEL_DIR, "config.json"),
    join(MODEL_DIR, "tokenizer.json"),
    join(MODEL_DIR, "onnx", "model_quantized.onnx"),
    join(MODEL_DIR, "LICENSE"),
    join(VENDOR_DIR, "analyzer-runtime.js"),
    join(VENDOR_DIR, "ort-wasm"),
    MANIFEST_PATH
  ];
  const missing = required.filter((path) => !existsSync(path));
  if (missing.length) {
    throw new Error(`Vendor verification failed; missing:\n${missing.join("\n")}`);
  }
  console.log("Verification OK — all required local assets present.");
}

const skipModel = process.argv.includes("--runtime-only");
const modelFiles = skipModel && existsSync(join(MODEL_DIR, "onnx", "model_quantized.onnx"))
  ? (JSON.parse(readFileSync(MANIFEST_PATH, "utf8")).model?.files || [])
  : vendorModelFiles();
const runtimeSizes = vendorRuntimeBundle();
if (!modelFiles.length && existsSync(MANIFEST_PATH)) {
  // keep previous file hashes when --runtime-only without prior parse
}
writeManifest(
  modelFiles.length ? modelFiles : [{ path: "onnx/model_quantized.onnx", bytes: statSync(join(MODEL_DIR, "onnx", "model_quantized.onnx")).size }],
  runtimeSizes
);
verifyLayout();
console.log("\nDone. Runtime loads only from models/ and vendor/. Do not fetch during gameplay.");
