import assert from "node:assert/strict";
import {
  coachingReply, ensureCoaching, normalizeCoachingText, parseCoachingIntent
} from "./coaching.js";
import {
  analyzeCoachingText, analyzerStatus, initializeLanguageAnalyzer
} from "./language-analyzer.js";

function expectIntent(text, expected, options = {}) {
  const parsed = parseCoachingIntent(text, options.learned);
  assert.equal(parsed.type, options.type || "directive", `${text}: ${JSON.stringify(parsed)}`);
  if (expected) {
    const intents = parsed.intents || parsed.candidates || [];
    assert.ok(intents.includes(expected), `${text}: expected ${expected}, got ${JSON.stringify(parsed)}`);
  }
  return parsed;
}

expectIntent("could you push with me more next time", "rush");
expectIntent("could you push with me more next time", "stayClose");
expectIntent("stop charging in alone", "safer");
const conditional = expectIntent("when I rush, stay nearby", "stayClose");
assert.equal(conditional.condition?.type, "playerRush");
expectIntent("hang back and cover me with the rifle", "keepDistance");
expectIntent("please don't waste all your fuel chasing", "saveFuel");
expectIntent("use the jetpack to get above them", "useJetpack");
expectIntent("you need to dodge their saber swings more", "dodgeMore");
expectIntent("try going around behind them", "flankScout");
expectIntent("go where I ping instead of chasing", "focusTargets");
expectIntent("PLAY SAFER!!!", "safer");
expectIntent("dont rush", "safer");
expectIntent("rush less", "safer");
expectIntent("use the jetpack less", "saveFuel");
expectIntent("don't stay close to me", "keepDistance");
expectIntent("stop hanging back", "stayClose");
expectIntent("dogde thier saber swngs more", "dodgeMore");
expectIntent("flnk around behind em", "flankScout");
expectIntent("save my jetpak fuel", "saveFuel");
expectIntent("stay close and dodge more", "stayClose");
expectIntent("stay close and dodge more", "dodgeMore");
expectIntent("stay close but hang back", "stayClose", { type: "conflict" });
expectIntent("stay close but hang back", "keepDistance", { type: "conflict" });
expectIntent("yeah that's what I meant", null, { type: "approval" });
expectIntent("no, don't practice that yet", null, { type: "denial" });
expectIntent("not yet", null, { type: "denial" });
expectIntent("that one", null, { type: "approval" });
expectIntent("if I'm low, fall back", "safer");
assert.equal(parseCoachingIntent("stop dodging").type, "unknown");
assert.equal(parseCoachingIntent("dodge less").type, "unknown");
assert.equal(parseCoachingIntent("sing a victory song").type, "unknown");

const evaluationCases = [
  ["Could you avoid diving in by yourself when I'm already backing out?", ["safer", "stayClose"], "playerRetreat"],
  ["I'd rather you shadow me until I start the engagement.", ["stayClose"], "playerRush"],
  ["When my health gets sketchy, create some space and cover the exit.", ["keepDistance"], "playerLow"],
  ["Don't burn the whole tank just to chase somebody who's disengaging.", ["saveFuel"]],
  ["If I mark someone, treat that player as the priority unless we're in danger.", ["focusTargets"], "playerPing"],
  ["You mistook that for aggression; I was trying to draw them toward us.", ["stayClose"]],
  ["I don't mean never push, just wait until I'm close enough to follow.", ["stayClose"], "playerClose"],
  ["Circle around while I keep their attention.", ["flankScout"]],
  ["That assessment seems right, but I don't think you've practiced it enough yet.", [], null, "denial"],
  ["Please peel away when I retreat.", ["safer"], "playerRetreat"],
  ["If my HP looks rough make room and cover me.", ["keepDistance"], "playerLow"],
  ["Stay on my shoulder until the fight starts.", ["stayClose"]],
  ["Quit yoloing into their team alone.", ["safer"]],
  ["Save a little boost for getting out.", ["saveFuel"]],
  ["Take the roof with your jetpack.", ["useJetpack"]],
  ["Juke their shots instead of eating every projectile.", ["dodgeMore"]],
  ["Wrap around and hit their side.", ["flankScout"]],
  ["Shoot the person I tag.", ["focusTargets"]],
  ["If they get close, dodge the swing.", ["dodgeMore"], "enemyClose"],
  ["When I charge, move with me.", ["stayClose"], "playerRush"],
  ["Don't chase; reset the fight.", ["safer"]],
  ["Give me room and provide cover.", ["keepDistance"]],
  ["Keep some fuel in reserve.", ["saveFuel"]],
  ["Get vertical and take height.", ["useJetpack"]],
  ["Sidestep more when they shoot.", ["dodgeMore"]],
  ["Scout ahead but stay safe.", ["flankScout", "safer"]],
  ["Prioritize whoever I ping.", ["focusTargets"]],
  ["Push with me and dodge their first swing.", ["rush", "dodgeMore"]],
  ["Stay nearby and focus my mark.", ["stayClose", "focusTargets"]],
  ["Hang back and save your fuel.", ["keepDistance", "saveFuel"]],
  ["Do not fly more.", ["saveFuel"]],
  ["Never stay back; follow me.", ["stayClose"]],
  ["Do not focus my pings.", [], null, "unknown"],
  ["Stop dodging.", [], null, "unknown"],
  ["go arond behind em", ["flankScout"]],
  ["pls folow my pign", ["focusTargets"]],
  ["conserve teh jetpak tank", ["saveFuel"]],
  ["doge incoming projetiles", ["dodgeMore"]],
  ["play it cautious and withdraw earlier", ["safer"]],
  ["escort me into the fight", ["stayClose"]],
  ["hold the back line with the rifle", ["keepDistance"]],
  ["advance sooner and pressure them", ["rush"]],
  ["use height to scout ahead", ["useJetpack", "flankScout"]],
  ["yes exactly that is right", [], null, "approval"],
  ["nope that is not what I meant", [], null, "denial"],
  ["review our priorities", [], null, "unknown"],
  ["sing something funny", [], null, "unknown"]
];

let evaluationPassed = 0;
const evaluationFailures = [];
for (const [text, expectedIntents, condition, expectedType = "directive"] of evaluationCases) {
  const parsed = parseCoachingIntent(text);
  const actualIntents = parsed.intents || [];
  const intentsMatch = expectedIntents.every((intent) => actualIntents.includes(intent));
  const conditionMatches = !condition || parsed.condition?.type === condition;
  if (parsed.type === expectedType && intentsMatch && conditionMatches) evaluationPassed++;
  else evaluationFailures.push({ text, expectedIntents, condition, expectedType, parsed });
}
const evaluationAccuracy = evaluationPassed / evaluationCases.length;
assert.ok(
  evaluationAccuracy >= 0.85,
  `language evaluation accuracy ${(evaluationAccuracy * 100).toFixed(1)}% `
  + `(${evaluationPassed}/${evaluationCases.length}): ${JSON.stringify(evaluationFailures, null, 2)}`
);

const learned = [{
  phrase: "watch my six",
  terms: ["watch", "six"],
  intents: ["stayClose"],
  uses: 1,
  confirmedAt: 1
}];
expectIntent("watch my six please", "stayClose", { learned });

const profile = { coaching: {}, weapons: {} };
ensureCoaching(profile);
let response = coachingReply(profile, "watch my six", "gun");
assert.match(response.reply, /missing the behavior/i);
response = coachingReply(profile, "I mean stay nearby", "gun");
assert.match(response.reply, /correcting me/i);
response = coachingReply(profile, "yes, that's what I meant", "gun");
assert.match(response.reply, /practice|saved the goal/i);
assert.equal(profile.coaching.learnedVocabulary.length, 1);
expectIntent("watch my six next time", "stayClose", {
  learned: profile.coaching.learnedVocabulary
});

// Denying a proposed lesson persists a structured per-weapon preference and
// the buddy acknowledges it plainly. Repeated denials strengthen the memory.
const prefProfile = { coaching: {}, weapons: {} };
ensureCoaching(prefProfile);
prefProfile.coaching.proposal = {
  intent: "useJetpack", weapon: "gun", domain: "jetpackUse",
  estimate: .5, observation: "", createdAt: 1
};
response = coachingReply(prefProfile, "not yet", "gun");
assert.equal(response.reply, "Understood. I won't prioritize that lesson in future reviews.");
assert.equal(prefProfile.coaching.proposal, null);
assert.equal(prefProfile.coaching.topicPrefs.gun.useJetpack.declines, 1);
assert.equal(prefProfile.coaching.topicPrefs.gun.useJetpack.estimateAtDecline, .5);
prefProfile.coaching.proposal = {
  intent: "useJetpack", weapon: "gun", domain: "jetpackUse",
  estimate: .9, observation: "", createdAt: 2
};
coachingReply(prefProfile, "no", "gun");
assert.equal(prefProfile.coaching.topicPrefs.gun.useJetpack.declines, 2);
assert.equal(prefProfile.coaching.topicPrefs.gun.useJetpack.estimateAtDecline, .9);

// The review-priorities view lists declined lessons; revisit re-enables one.
response = coachingReply(prefProfile, "review priorities", "gun");
assert.match(response.reply, /use the jetpack more/);
assert.match(response.reply, /2 times/);
response = coachingReply(prefProfile, "revisit use the jetpack more", "gun");
assert.match(response.reply, /back to normal priority/i);
assert.equal(prefProfile.coaching.topicPrefs.gun?.useJetpack, undefined);
response = coachingReply(prefProfile, "review priorities", "gun");
assert.match(response.reply, /no deprioritized lessons/i);

assert.equal(normalizeCoachingText("PLEASE, don't CHARGING!!!"), "please dont charge");

// Hybrid merge: semantic scores may promote paraphrases, but deterministic
// negation guards remain authoritative (model cannot revive a negated rush).
const semanticPromote = parseCoachingIntent(
  "Could you shadow my movement into the fight?",
  [],
  { stayClose: 0.82, rush: 0.2, safer: 0.1 }
);
assert.equal(semanticPromote.type, "directive");
assert.ok(semanticPromote.intents.includes("stayClose"));

const semanticNegation = parseCoachingIntent(
  "dont rush in",
  [],
  { rush: 0.95, safer: 0.2 }
);
assert.notEqual(semanticNegation.intent, "rush");
assert.ok(
  semanticNegation.type === "directive" && semanticNegation.intents.includes("safer")
  || semanticNegation.candidates?.includes("safer")
);

const hybridCases = [
  ["Mind keeping me company on the approach?", ["stayClose"], { stayClose: 0.8 }],
  ["Leave yourself a jet reserve for the exit.", ["saveFuel"], { saveFuel: 0.84 }],
  ["Cut across their flank when you see an opening.", ["flankScout"], { flankScout: 0.86 }],
  ["I need you glued to my mark, not freelancing.", ["focusTargets"], { focusTargets: 0.88 }]
];
let hybridPassed = 0;
for (const [text, expectedIntents, semantic] of hybridCases) {
  const parsed = parseCoachingIntent(text, [], semantic);
  if (parsed.type === "directive" && expectedIntents.every((intent) => (parsed.intents || []).includes(intent))) {
    hybridPassed++;
  }
}
assert.equal(hybridPassed, hybridCases.length, "hybrid semantic assist cases");

// The analyzer facade must not download remote models. Intercepting fetch during
// load + inference requires zero remote URLs. Missing assets → basic fallback.
const originalFetch = globalThis.fetch;
const fetched = [];
globalThis.fetch = async (...args) => {
  const url = String(args[0]);
  fetched.push(url);
  if (/huggingface|jsdelivr|unpkg|hf-mirror|googleapis/i.test(url)) {
    throw new Error(`remote model fetch forbidden: ${url}`);
  }
  throw new Error("network access forbidden in analyzer test");
};
await initializeLanguageAnalyzer({ forceBasic: true });
const analyzed = await analyzeCoachingText("circle around and focus my ping");
globalThis.fetch = originalFetch;
assert.equal(
  fetched.filter((url) => /huggingface|jsdelivr|unpkg|hf-mirror/i.test(url)).length,
  0
);
assert.equal(analyzerStatus().state, "basic");
assert.ok(analyzed.intents.every((intent) => [
  "rush", "safer", "stayClose", "keepDistance", "saveFuel",
  "useJetpack", "dodgeMore", "flankScout", "focusTargets"
].includes(intent)));

// Confirmations remain evidence-humble and template variants never repeat
// immediately for the same response context.
const responseProfile = { coaching: {}, weapons: {} };
let first = coachingReply(responseProfile, "stay close to me", "gun").reply;
coachingReply(responseProfile, "no", "gun");
let second = coachingReply(responseProfile, "stay close to me", "gun").reply;
assert.notEqual(first, second);
response = coachingReply(responseProfile, "yes", "gun");
assert.doesNotMatch(response.reply, /\b(?:mastered|learned|reliable now|expert)\b/i);
assert.match(response.reply, /\b(?:evidence|practice|competence)\b/i);

console.log(
  `Coaching parser suite passed: ${evaluationPassed}/${evaluationCases.length} evaluation cases `
  + `(${(evaluationAccuracy * 100).toFixed(1)}%).`
  + (evaluationFailures.length
    ? ` Conservative misses: ${evaluationFailures.map((failure) => `“${failure.text}”`).join("; ")}`
    : "")
);
