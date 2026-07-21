import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = fileURLToPath(new URL("..", import.meta.url));
const port = Number(process.env.PORT) || 8000;
const autoPull = process.env.AUTO_PULL !== "0"
  && !process.argv.includes("--no-sync");
const pullSeconds = Math.max(15, Number(process.env.AUTO_PULL_SECONDS) || 45);
const syncBranch = process.env.SYNC_BRANCH || "master";

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".onnx": "application/octet-stream",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
};

function resolvePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0].split("#")[0]);
  const relative = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  const resolved = normalize(join(root, relative));
  if (!resolved.startsWith(root)) {
    return null;
  }
  return resolved;
}

async function git(args) {
  const { stdout } = await execFileAsync("git", args, {
    cwd: root,
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  });
  return String(stdout || "").trim();
}

let syncing = false;
let lastSyncNote = "not synced yet";

async function syncFromRemote(reason = "poll") {
  if (!autoPull || syncing) return;
  syncing = true;
  try {
    const dirty = await git(["status", "--porcelain"]);
    if (dirty) {
      lastSyncNote = `skipped (${reason}): local uncommitted changes`;
      console.log(`[sync] ${lastSyncNote}`);
      return;
    }

    const branch = await git(["rev-parse", "--abbrev-ref", "HEAD"]);
    if (branch !== syncBranch) {
      lastSyncNote = `skipped (${reason}): on ${branch}, expected ${syncBranch}`;
      console.log(`[sync] ${lastSyncNote}`);
      return;
    }

    await git(["fetch", "origin", syncBranch]);
    const local = await git(["rev-parse", "HEAD"]);
    const remote = await git(["rev-parse", `origin/${syncBranch}`]);
    if (local === remote) {
      lastSyncNote = `up to date with origin/${syncBranch}`;
      if (reason === "start") console.log(`[sync] ${lastSyncNote}`);
      return;
    }

    // Fast-forward only — never invent merge commits while serving.
    await git(["merge", "--ff-only", `origin/${syncBranch}`]);
    const after = await git(["rev-parse", "--short", "HEAD"]);
    lastSyncNote = `updated to ${after} (${reason})`;
    console.log(`[sync] ${lastSyncNote} — hard-refresh the browser`);
  } catch (error) {
    lastSyncNote = `failed (${reason}): ${error?.message || error}`;
    console.warn(`[sync] ${lastSyncNote}`);
  } finally {
    syncing = false;
  }
}

const noCacheExt = new Set([".html", ".js", ".mjs", ".css", ".json"]);

createServer(async (req, res) => {
  if ((req.url || "").split("?")[0] === "/__sync") {
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify({
      autoPull,
      branch: syncBranch,
      intervalSeconds: pullSeconds,
      lastSyncNote,
    }));
    return;
  }

  const filePath = resolvePath(req.url || "/");
  if (!filePath) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Forbidden");
    return;
  }

  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }

    const body = await readFile(filePath);
    const ext = extname(filePath).toLowerCase();
    const headers = {
      "Content-Type": mimeTypes[ext] || "application/octet-stream",
    };
    if (noCacheExt.has(ext)) {
      headers["Cache-Control"] = "no-store";
    }
    res.writeHead(200, headers);
    res.end(body);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}).listen(port, async () => {
  console.log(`Robot Buddy Arena running at http://localhost:${port}`);
  if (autoPull) {
    console.log(
      `[sync] auto-pull origin/${syncBranch} every ${pullSeconds}s (AUTO_PULL=0 to disable)`
    );
    await syncFromRemote("start");
    setInterval(() => {
      syncFromRemote("poll").catch(() => {});
    }, pullSeconds * 1000);
  } else {
    console.log("[sync] auto-pull disabled");
  }
});
