/**
 * Deep buddy Q&A composer: curated FAQ, snippet stitcher, optional Gemma blurb,
 * and code-facts answers. Never invents mechanics outside provided hits.
 */
import { composeFaqReply, FAQ_TOPIC_CHIPS } from "./game-faq.js";
import { retrieveKnowledge } from "./knowledge-retrieve.js";
import { generateBuddyBlurb, generatorStatus } from "./language-generator.js";

function nextVariant(coaching, group, variants) {
  if (!coaching || typeof coaching !== "object") return variants[0];
  coaching.responseVariants ||= {};
  const previous = Number(coaching.responseVariants[group]);
  const next = Number.isInteger(previous) ? (previous + 1) % variants.length : 0;
  coaching.responseVariants[group] = next;
  return variants[next];
}

function stitchSnippets(hits, { codePrefixed = false } = {}) {
  const parts = (hits || [])
    .filter((hit) => hit?.text)
    .slice(0, 3)
    .map((hit) => String(hit.text).trim())
    .filter(Boolean);
  if (!parts.length) return null;
  // Prefer one tight blurb; join lightly when multiple sources help.
  let body = parts[0];
  if (parts.length > 1) {
    const second = parts[1];
    if (second.length < 180 && !body.includes(second.slice(0, 40))) {
      body = `${body} ${second}`;
    }
  }
  // Keep stitcher answers short.
  if (body.length > 420) body = `${body.slice(0, 400).trim()}…`;
  if (codePrefixed) return `From the code facts: ${body}`;
  return body;
}

function unknownReply(coaching, forceCode) {
  const hints = FAQ_TOPIC_CHIPS.slice(0, 5).join(", ");
  if (forceCode) {
    return nextVariant(coaching, "codeUnknown", [
      "I checked the local code-facts pack and do not have a reliable match. Try naming a constant, reward, map, or system (jetpack, Cyber, leagues).",
      "No code-fact snippet covers that clearly. Ask about an exported value or gameplay table, or drop the code-based request for the normal FAQ.",
      "The code dig came up empty for that. Rephrase with a game system name, or ask without forcing a code-based answer."
    ]);
  }
  return nextVariant(coaching, "faqUnknown", [
    `I am not sure I have a reliable answer for that. Try rephrasing, or ask about ${hints}.`,
    `I do not want to invent a rule. Ask another way, or pick a topic like ${hints}.`,
    `That is outside my local knowledge confidence. Rephrase the question, or try ${hints}.`
  ]);
}

/**
 * Compose a question reply from a retrieval result.
 * @param {object} retrieval from retrieveKnowledge
 * @param {object|null} coaching profile.coaching for variant rotation
 * @param {object} options
 * @param {string|null} options.generatedBlurb optional Gemma/precomputed blurb
 */
export function composeDeepReply(retrieval, coaching = null, options = {}) {
  if (!retrieval || retrieval.path === "unknown" || !retrieval.hits?.length) {
    return {
      reply: unknownReply(coaching, retrieval?.forceCode),
      kind: retrieval?.forceCode ? "code-miss" : "faq-unknown",
      path: "unknown",
      source: null,
      hits: []
    };
  }

  const codePath = retrieval.path === "code" || retrieval.path === "code-fallback";
  if (retrieval.path === "faq" && retrieval.faqAnswer && !retrieval.forceCode) {
    const pack = { unknownHints: FAQ_TOPIC_CHIPS };
    const match = retrieval.faqMatch;
    return {
      reply: composeFaqReply(match, pack, coaching),
      kind: "faq",
      path: "faq",
      source: "faq",
      faqId: match?.entry?.id || retrieval.hits[0]?.id || null,
      hits: retrieval.hits
    };
  }

  const generated = options.generatedBlurb
    || (typeof options.generate === "function" ? options.generate(retrieval) : null);

  if (generated && String(generated).trim()) {
    let reply = String(generated).trim();
    if (codePath && !/^from the code facts:/i.test(reply)) {
      reply = `From the code facts: ${reply}`;
    }
    return {
      reply,
      kind: codePath ? "code" : "deep",
      path: retrieval.path,
      source: codePath ? "code" : "deep",
      generator: generatorStatus().state,
      hits: retrieval.hits
    };
  }

  const stitched = stitchSnippets(retrieval.hits, { codePrefixed: codePath });
  if (!stitched) {
    return {
      reply: unknownReply(coaching, retrieval.forceCode || codePath),
      kind: "faq-unknown",
      path: "unknown",
      source: null,
      hits: []
    };
  }

  const wrapped = codePath
    ? stitched
    : nextVariant(coaching, "deepStitch", [
      stitched,
      `From what I can pull together: ${stitched}`,
      `Here is the local deep answer I have: ${stitched}`
    ]);

  return {
    reply: wrapped,
    kind: codePath ? "code" : "deep",
    path: retrieval.path,
    source: codePath ? "code" : "manual",
    generator: "stitcher",
    hits: retrieval.hits
  };
}

/**
 * Full async question reply: retrieve → optional Gemma → compose.
 */
export async function answerGameQuestion(text, coaching = null, options = {}) {
  const forceCode = options.forceCode === true
    || (options.forceCode !== false && Boolean(options.retrieval?.forceCode));
  const retrieval = options.retrieval || retrieveKnowledge(text, {
    forceCode,
    faqSemanticScores: options.faqSemanticScores || null,
    faqPack: options.faqPack,
    manualPack: options.manualPack,
    codePack: options.codePack
  });

  let generatedBlurb = options.generatedBlurb || null;
  if (!generatedBlurb && (retrieval.path === "deep" || retrieval.path === "code" || retrieval.path === "code-fallback")) {
    generatedBlurb = await generateBuddyBlurb(retrieval.query || text, retrieval.hits, {
      codePrefixed: retrieval.path !== "deep"
    });
  }

  return composeDeepReply(retrieval, coaching, { generatedBlurb });
}

export { stitchSnippets, retrieveKnowledge };
