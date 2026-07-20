import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buddyChatReply, coachingReply, ensureCoaching, parseCoachingIntent
} from "./coaching.js";
import {
  classifyBuddyMessage, loadGameFaqPack, matchGameFaq, setGameFaqPackForTests,
  FAQ_TOPIC_CHIPS
} from "./game-faq.js";
import {
  analyzeBuddyMessage, analyzerStatus, initializeLanguageAnalyzer
} from "./language-analyzer.js";

const ROOT = dirname(fileURLToPath(import.meta.url));
const packJson = JSON.parse(readFileSync(join(ROOT, "knowledge", "game-faq.json"), "utf8"));
setGameFaqPackForTests({
  version: packJson.version,
  topics: packJson.topics,
  unknownHints: packJson.unknownHints,
  entries: packJson.entries
});

assert.ok(packJson.entries.length >= 20, "FAQ pack should be substantial");

const routeCases = [
  ["What are the controls?", "question"],
  ["How does jetpack fuel work?", "question"],
  ["how does fog of war work", "question"],
  ["What is Cyber?", "question"],
  ["explain readiness", "question"],
  ["Flash vs Balanced vs Thinker?", "question"],
  ["stay close to me", "coaching"],
  ["play safer next time", "coaching"],
  ["could you push with me more", "coaching"],
  ["focus my pings", "coaching"],
  ["dont rush", "coaching"],
  ["yes that's right", "coaching"],
  ["jetpack", "ambiguous"],
  ["Are you asking me to rush or explaining the rush key?", "ambiguous"]
];

for (const [text, expected] of routeCases) {
  const result = classifyBuddyMessage(text);
  assert.equal(result.route, expected, `${text} → ${result.route} (want ${expected})`);
}

const faqCases = [
  ["How do I move?", "controls-move"],
  ["What key dodges?", "controls-dodge"],
  ["How does fog of war work?", "vision-fog"],
  ["Why is my buddy outlined in cyan?", "vision-buddy-outline"],
  ["What are the cyan arrows?", "vision-arrows"],
  ["How does jetpack fuel work?", "jetpack-fuel"],
  ["What is jetpack exhausted?", "jetpack-lockout"],
  ["Is there a ceiling?", "jetpack-ceiling"],
  ["Training vs conquest?", "modes-training-vs-conquest"],
  ["How does learning work?", "learning-overview"],
  ["What is learning lock?", "learning-lock"],
  ["How do I spar without learning?", "learning-lock"],
  ["What does readiness mean?", "learning-readiness"],
  ["What are mind modes?", "mind-modes"],
  ["What is Mimic?", "mimic-mind"],
  ["How does Mimic intensity work?", "mimic-mind"],
  ["What is Cyber?", "shop-cyber"],
  ["AI Suggested vs AI's Choice?", "equipment-buddy-modes"],
  ["What are perks?", "perks-overview"],
  ["How do I unlock perks?", "perks-overview"],
  ["Does conquest give exp?", "modes-conquest"],
  ["What league am I in?", "conquest-select"],
  ["How do I reroll opponents?", "conquest-select"],
  ["What is Power?", "conquest-select"],
  ["Is Power HP?", "conquest-select"],
  ["What maps are there?", "maps-themes"],
  ["How does breakable cover work?", "maps-themes"],
  ["What are power-up crates?", "powerups-crates"],
  ["How do power-ups work?", "powerups-crates"],
  ["What weapons are there?", "weapons-families"],
  ["How do snipers work?", "weapons-snipers"],
  ["What is the gattler?", "weapons-next-gen"],
  ["How does the laser work?", "weapons-next-gen"],
  ["How do shields work?", "equipment-shields"],
  ["What does Q do?", "controls-shield"],
  ["What does E do?", "controls-modular"],
  ["how does mechanical modularity work", "weapons-mechanical-modularity"],
  ["How do I win a match?", "match-win"],
  ["Is the language analyzer offline?", "analyzer-offline"]
];

for (const [text, expectedId] of faqCases) {
  const match = matchGameFaq(text, packJson);
  assert.equal(match.type, "match", `${text}: ${JSON.stringify(match)}`);
  assert.equal(match.entry.id, expectedId, `${text}: got ${match.entry?.id}`);
}

const unknown = matchGameFaq("What is the secret moon plasma damage formula?", packJson);
assert.equal(unknown.type, "unknown");

const profile = { coaching: {}, weapons: {} };
ensureCoaching(profile);
let response = buddyChatReply(profile, "How does jetpack fuel work?", "gun", {
  kind: "question",
  match: matchGameFaq("How does jetpack fuel work?", packJson)
});
assert.match(response.reply, /3 seconds|fuel|thrust/i);
assert.equal(response.kind, "faq");

response = buddyChatReply(profile, "invent a new double jump rule please?", "gun", {
  kind: "question",
  match: unknown
});
assert.match(response.reply, /not sure|do not want to invent|outside my local FAQ/i);

response = buddyChatReply(profile, "jetpack?", "gun", { kind: "ambiguous" });
assert.match(response.reply, /asking about|game works|coaching/i);

// Coaching path still confirms directives.
response = buddyChatReply(profile, "stay close to me", "gun", {
  kind: "coaching",
  coaching: parseCoachingIntent("stay close to me")
});
assert.match(response.reply, /stay with you|practice/i);
assert.equal(response.kind, "coaching");
response = coachingReply(profile, "yes", "gun");
assert.match(response.reply, /evidence|practice|competence/i);

// Conquest read-only blocks new practice goals.
const conquest = { coaching: {}, weapons: {} };
ensureCoaching(conquest);
response = buddyChatReply(conquest, "rush with me", "gun", {
  kind: "coaching",
  coaching: parseCoachingIntent("rush with me")
}, { allowDirectives: false });
assert.equal(response.kind, "blocked");
assert.equal(conquest.coaching.pending, null);

response = buddyChatReply(conquest, "How do I ping?", "gun", {
  kind: "question",
  match: matchGameFaq("How do I ping?", packJson)
}, { allowDirectives: false });
assert.equal(response.kind, "faq");
assert.match(response.reply, /\bG\b|ping/i);

assert.deepEqual(FAQ_TOPIC_CHIPS, [
  "Controls", "Learning", "Vision", "Shop", "Jetpack", "Maps", "Power-ups"
]);

const loaded = await loadGameFaqPack();
assert.ok(loaded.entries.length >= 20);

const originalFetch = globalThis.fetch;
const fetched = [];
globalThis.fetch = async (...args) => {
  const url = String(args[0]);
  fetched.push(url);
  if (/huggingface|jsdelivr|unpkg|hf-mirror|googleapis/i.test(url)) {
    throw new Error(`remote model fetch forbidden: ${url}`);
  }
  throw new Error("network access forbidden in faq analyzer test");
};
await initializeLanguageAnalyzer({ forceBasic: true });
const analyzed = await analyzeBuddyMessage("How does shared vision work?");
globalThis.fetch = originalFetch;
assert.equal(
  fetched.filter((url) => /huggingface|jsdelivr|unpkg|hf-mirror/i.test(url)).length,
  0
);
assert.equal(analyzed.kind, "question");
assert.equal(analyzed.match?.entry?.id, "vision-fog");
assert.match(analyzerStatus().label, /Q&A/i);

const coachingTurn = await analyzeBuddyMessage("stay close and focus my pings");
assert.equal(coachingTurn.kind, "coaching");
assert.ok(
  coachingTurn.coaching.intents?.includes("stayClose")
  || coachingTurn.coaching.intents?.includes("focusTargets")
);

console.log(
  `Game FAQ suite passed: ${routeCases.length} routes, ${faqCases.length} FAQ matches, `
  + `${packJson.entries.length} curated entries.`
);
