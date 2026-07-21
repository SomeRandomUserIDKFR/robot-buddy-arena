import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buddyChatReply, ensureCoaching } from "./coaching.js";
import { setGameFaqPackForTests } from "./game-faq.js";
import {
  composeDeepReply, stitchSnippets
} from "./buddy-reply.js";
import {
  detectForceCode, retrieveKnowledge, setCodeFactsPackForTests, setManualPackForTests,
  stripForceCodePhrasing
} from "./knowledge-retrieve.js";
import { setGeneratorStateForTests } from "./language-generator.js";

const ROOT = dirname(fileURLToPath(import.meta.url));
const faqJson = JSON.parse(readFileSync(join(ROOT, "knowledge", "game-faq.json"), "utf8"));
const manualJson = JSON.parse(readFileSync(join(ROOT, "knowledge", "game-manual.json"), "utf8"));
const codeJson = JSON.parse(readFileSync(join(ROOT, "knowledge", "code-facts.json"), "utf8"));

setGameFaqPackForTests({
  version: faqJson.version,
  topics: faqJson.topics,
  unknownHints: faqJson.unknownHints,
  entries: faqJson.entries
});
setManualPackForTests({
  version: manualJson.version,
  chunks: manualJson.chunks
});
setCodeFactsPackForTests({
  version: codeJson.version,
  entries: codeJson.entries
});
setGeneratorStateForTests("missing");

assert.equal(detectForceCode("I want a code based answer about jetpack fuel"), true);
assert.equal(detectForceCode("from the code, what is CEILING?"), true);
assert.equal(detectForceCode("How does jetpack fuel work?"), false);
assert.match(stripForceCodePhrasing("code based answer: what is JET_BURN_TIME"), /JET_BURN_TIME/i);

const highFaq = retrieveKnowledge("How does jetpack fuel work?");
assert.equal(highFaq.path, "faq");
assert.equal(highFaq.level, "high");
assert.ok(highFaq.faqAnswer);

const forced = retrieveKnowledge("code based answer what is JET_BURN_TIME", { forceCode: true });
assert.equal(forced.path, "code");
assert.ok(forced.hits.length >= 1);
assert.ok(forced.hits.some((hit) => /JET_BURN_TIME|burn/i.test(hit.text)));

const deep = composeDeepReply(forced, { responseVariants: {} });
assert.match(deep.reply, /From the code facts:/i);
assert.equal(deep.kind, "code");

const invent = retrieveKnowledge("What is the secret moon plasma damage formula?");
assert.equal(invent.path, "unknown");
const inventReply = composeDeepReply(invent, { responseVariants: {} });
assert.match(inventReply.reply, /not sure|do not want to invent|outside my local|code-facts pack/i);

// Stitcher must not invent: only uses provided hits.
const stitched = stitchSnippets([
  { text: "config.js: JET_BURN_TIME = 3", source: "code" },
  { text: "config.js: JET_RECHARGE_TIME = 5", source: "code" }
], { codePrefixed: true });
assert.match(stitched, /From the code facts:.*JET_BURN_TIME/i);
assert.doesNotMatch(stitched, /moon plasma/i);

// Mid/deep path from manual when FAQ is weaker / paraphrased broadly.
const manualHit = retrieveKnowledge("Explain shared team fog arrows and buddy outline vision rules in detail");
assert.ok(["deep", "faq", "code-fallback"].includes(manualHit.path), manualHit.path);

const profile = { coaching: {}, weapons: {} };
ensureCoaching(profile);
const chat = buddyChatReply(profile, "I want a code based answer about CONQUEST_REWARDS", "gun", {
  kind: "question",
  forceCode: true,
  retrieval: retrieveKnowledge("I want a code based answer about CONQUEST_REWARDS", { forceCode: true }),
  match: { type: "unknown", confidence: 0, entry: null }
});
assert.match(chat.reply, /From the code facts:/i);
assert.ok(chat.kind === "code" || chat.path === "code");

// Auto code fallback still refuses empty digs.
const miss = buddyChatReply(profile, "code based answer about marine biology reactors", "gun", {
  kind: "question",
  forceCode: true,
  retrieval: retrieveKnowledge("code based answer about marine biology reactors", { forceCode: true }),
  match: { type: "unknown", confidence: 0, entry: null }
});
assert.match(miss.reply, /code-fact|do not have a reliable match|came up empty|Rephrase/i);

assert.ok(codeJson.entries.length >= 20, "code-facts pack should be substantial");
assert.ok(manualJson.chunks.length >= 8, "manual pack should be substantial");
assert.ok(codeJson.entries.some((e) => e.name === "CONQUEST_REWARDS"));
assert.ok(codeJson.entries.some((e) => e.name === "CEILING"));

console.log(
  `Buddy deep Q&A suite passed: FAQ/manual/code packs `
  + `(${faqJson.entries.length}/${manualJson.chunks.length}/${codeJson.entries.length}), `
  + "force-code + refuse-invent checks ok."
);
