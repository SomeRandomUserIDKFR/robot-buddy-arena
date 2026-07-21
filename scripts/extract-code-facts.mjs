#!/usr/bin/env node
/**
 * Build knowledge/code-facts.json from allowlisted gameplay modules.
 * Runtime chat never reads raw source; only this extracted pack.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "knowledge", "code-facts.json");

const ALLOWLIST = [
  "config.js",
  "equipment.js",
  "powerups.js",
  "conquest.js",
  "maps.js",
  "perks.js",
  "power.js"
];

/** Named exports / tables we always want as readable facts when present. */
const PRIORITY_NAMES = new Set([
  "CEILING",
  "JET_BURN_TIME",
  "JET_RECHARGE_TIME",
  "JET_RESTART_FUEL",
  "JET_THRUST",
  "SIGHT",
  "MIMIC_BLEND",
  "STARTING_CYBER",
  "CONQUEST_REWARDS",
  "CONQUEST_EXP",
  "REROLL_CYBER_COST",
  "LEAGUE_BANDS",
  "POWER_CRATE_HP",
  "POWER_CRATE_RESPAWN",
  "FIRE_RATE_MULT",
  "FIRE_RATE_DURATION",
  "HEAL_AMOUNT",
  "REGEN_TOTAL",
  "REGEN_DURATION",
  "COUNTER_SLASH_DURATION",
  "SPEED_SURGE_MULT",
  "SPEED_SURGE_DURATION",
  "SHIELD_PATCH_AMOUNT",
  "JET_SIPHON_AMOUNT",
  "OVERCHARGE_BONUS",
  "OVERCHARGE_HITS",
  "POWERUP_DEFS",
  "STORAGE_KEY"
]);

function sha256(text) {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function summarizeValue(raw) {
  const text = raw.trim();
  if (!text) return null;
  if (text.length <= 220) return text.replace(/\s+/g, " ");
  // Keep object/array starts readable without dumping huge catalogs.
  if (text.startsWith("{") || text.startsWith("[")) {
    return `${text.slice(0, 200).replace(/\s+/g, " ")}…`;
  }
  return `${text.slice(0, 200).replace(/\s+/g, " ")}…`;
}

function extractExportConsts(source, file) {
  const clean = stripComments(source);
  const facts = [];
  const re = /export\s+const\s+([A-Z][A-Z0-9_]*)\s*=\s*/g;
  let match;
  while ((match = re.exec(clean))) {
    const name = match[1];
    const start = match.index + match[0].length;
    let i = start;
    let depth = 0;
    let inString = null;
    for (; i < clean.length; i++) {
      const ch = clean[i];
      if (inString) {
        if (ch === "\\") {
          i += 1;
          continue;
        }
        if (ch === inString) inString = null;
        continue;
      }
      if (ch === "'" || ch === "\"" || ch === "`") {
        inString = ch;
        continue;
      }
      if (ch === "{" || ch === "[" || ch === "(") depth += 1;
      else if (ch === "}" || ch === "]" || ch === ")") depth = Math.max(0, depth - 1);
      else if ((ch === ";" || ch === "\n") && depth === 0) break;
    }
    const valueRaw = clean.slice(start, i);
    const summary = summarizeValue(valueRaw);
    if (!summary) continue;
    const priority = PRIORITY_NAMES.has(name);
    // Skip huge anonymous-looking dumps unless prioritized.
    if (!priority && summary.endsWith("…") && summary.length >= 200) continue;
    if (!priority && !/^[0-9.[{\-"']/.test(summary) && summary.length > 80) continue;
    facts.push({
      id: `code-${file.replace(/\.js$/, "")}-${name}`.toLowerCase(),
      source: file,
      name,
      topic: topicFor(file, name),
      aliases: aliasesFor(name),
      text: `${file}: ${name} = ${summary}`,
      priority
    });
  }
  return facts;
}

function topicFor(file, name) {
  if (file === "config.js") {
    if (/JET|CEILING/.test(name)) return "jetpack";
    if (/SIGHT|WORLD/.test(name)) return "vision";
    if (/MIMIC|AI_/.test(name)) return "mind";
    return "config";
  }
  if (file === "equipment.js") return /REWARD|CYBER|EXP/.test(name) ? "conquest" : "equipment";
  if (file === "powerups.js") return "powerups";
  if (file === "conquest.js") return "conquest";
  if (file === "maps.js") return "maps";
  if (file === "perks.js") return "perks";
  if (file === "power.js") return "power";
  return "code";
}

function aliasesFor(name) {
  const parts = name.toLowerCase().split("_").filter(Boolean);
  return [...new Set([name.toLowerCase(), ...parts, parts.join(" ")])];
}

function extractMapIds(source) {
  const ids = [...source.matchAll(/id:\s*"([a-z0-9-]+)"/g)].map((m) => m[1]);
  const unique = [...new Set(ids)].filter((id) => ![
    "cactus", "bush", "tree", "crate", "pipe", "pillar", "barrel", "crateStack"
  ].includes(id));
  // Prefer known map catalog names if present as MAPS keys.
  const mapKeyMatch = source.match(/export\s+const\s+MAPS\s*=\s*\{([\s\S]*?)\n\};/);
  let mapNames = [];
  if (mapKeyMatch) {
    mapNames = [...mapKeyMatch[1].matchAll(/^\s*([a-zA-Z][a-zA-Z0-9_]*)\s*:/gm)].map((m) => m[1]);
  }
  if (!mapNames.length) mapNames = unique.slice(0, 12);
  return [{
    id: "code-maps-catalog",
    source: "maps.js",
    name: "MAPS",
    topic: "maps",
    aliases: ["maps", "arenas", "layouts", "battlefield", "forest", "desert"],
    text: `maps.js: themed arena catalog includes ${mapNames.join(", ")}. Layouts are fixed (~3-screen width) with breakable props; not procedural.`,
    priority: true
  }];
}

function extractLeagueBands(source) {
  if (!source.includes("LEAGUE_BANDS")) return [];
  const bands = [...source.matchAll(/id:\s*"(rookie|contender|veteran|challenger|elite|apex)"[\s\S]*?name:\s*"([^"]+)"[\s\S]*?min:\s*(\d+)[\s\S]*?max:\s*(\d+|null)/g)];
  if (!bands.length) return [];
  const lines = bands.map((m) => {
    const max = m[4] === "null" ? "∞" : m[4];
    return `${m[2]} (${m[3]}–${max})`;
  });
  return [{
    id: "code-conquest-leagues",
    source: "conquest.js",
    name: "LEAGUE_BANDS",
    topic: "conquest",
    aliases: ["league", "ranking", "rookie", "veteran", "elite", "apex"],
    text: `conquest.js: Ranking leagues are ${lines.join("; ")}.`,
    priority: true
  }];
}

function main() {
  const facts = [];
  for (const file of ALLOWLIST) {
    const path = join(ROOT, file);
    const source = readFileSync(path, "utf8");
    facts.push(...extractExportConsts(source, file));
    if (file === "maps.js") facts.push(...extractMapIds(source));
    if (file === "conquest.js") facts.push(...extractLeagueBands(source));
  }

  // Deduplicate by id; prefer priority / longer text.
  const byId = new Map();
  for (const fact of facts) {
    const prev = byId.get(fact.id);
    if (!prev || (fact.priority && !prev.priority) || fact.text.length > prev.text.length) {
      byId.set(fact.id, fact);
    }
  }
  const entries = [...byId.values()]
    .sort((a, b) => Number(b.priority) - Number(a.priority) || a.id.localeCompare(b.id))
    .map(({ priority, ...rest }) => rest);

  const payload = {
    version: 1,
    generatedAt: new Date().toISOString(),
    allowlist: ALLOWLIST,
    contentHash: sha256(entries.map((e) => e.text).join("\n")),
    entries
  };

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`Wrote ${entries.length} code facts → knowledge/code-facts.json`);
}

main();
