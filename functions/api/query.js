import { renderAnswerHtml } from "../lib/answer.js";
import { errorResponse, json, readJson } from "../lib/http.js";
import { llmConfig, synthesize } from "../lib/llm.js";
import { searchEuropePmc } from "../lib/live.js";
import { addSystemEvent, getMode, recordQuery } from "../lib/policy.js";
import { addDocuments, getDocuments, search } from "../lib/retrieval.js";
import { buildCloudDemoAnswer, buildLocalAnswer } from "../lib/synthesis.js";
import { verifyAnswer } from "../lib/verifier.js";

const liveDocs = new Map();

function contextDocuments(results, docs) {
  const seen = new Set();
  const picked = [];
  for (const result of results) {
    const doc = docs.find((item) => item.id === result.doc_id);
    if (doc && !seen.has(doc.id)) {
      picked.push(doc);
      seen.add(doc.id);
    }
  }
  for (const doc of liveDocs.values()) {
    if (!seen.has(doc.id)) {
      picked.push(doc);
      seen.add(doc.id);
    }
  }
  return picked;
}

function responseBody({ mode, question, answer, answerMode, verification, results, docs, liveMeta, liveError, llmError, audit }) {
  return {
    privacy_mode: mode,
    query: question,
    answer,
    answer_html: renderAnswerHtml(answer, verification),
    answer_mode: answerMode,
    verification,
    results,
    live_meta: liveMeta,
    live_error: liveError,
    llm_error: llmError,
    audit_entry: audit,
    counts: {
      papers: docs.filter((doc) => doc.type === "paper").length,
      meeting_notes: docs.filter((doc) => doc.type === "meeting_note").length,
      live: liveDocs.size,
      total: docs.length,
    },
  };
}

export async function onRequestPost({ request, env }) {
  try {
    const body = await readJson(request);
    const question = String(body.query || "").trim();
    if (question.length < 2 || question.length > 600) {
      const error = new Error("query must be between 2 and 600 characters");
      error.status = 422;
      throw error;
    }

    const mode = getMode();
    let results = search(question, 4);
    let docs = getDocuments();
    let liveMeta = null;
    let liveError = null;
    let llmError = null;
    let answerMode = "local_extractive";
    let answer = "";
    const egressHosts = [];
    let liveFetched = 0;

    if (mode === "LOCAL_ONLY") {
      [answer, answerMode] = buildLocalAnswer(question, results, docs);
    } else {
      try {
        const [fetched, meta] = await searchEuropePmc(question);
        liveMeta = meta;
        egressHosts.push("ebi.ac.uk");
        liveFetched = fetched.length;
        for (const doc of fetched) liveDocs.set(doc.id, doc);
        if (fetched.length) {
          addDocuments(fetched);
          const ranked = search(question, 20);
          const localResults = ranked.filter((item) => !item.live).slice(0, 4);
          const liveResults = ranked.filter((item) => item.live).slice(0, 2);
          results = [...localResults, ...liveResults];
          if (!results.length) results = search(question, 4);
          docs = getDocuments();
        }
      } catch (error) {
        if (error.status === 403) throw error;
        liveError = `${error.name}: ${error.message}`;
        egressHosts.push("ebi.ac.uk");
        addSystemEvent(`Europe PMC fetch failed: ${liveError}`, "tool_error");
        results = search(question, 4);
        docs = getDocuments();
      }

      const context = contextDocuments(results, docs);
      const llm = llmConfig(env);
      if (llm) {
        const generated = await synthesize(env, question, context);
        if (generated.host) egressHosts.push(generated.host);
        llmError = generated.error;
        if (generated.text) {
          answer = generated.text;
          answerMode = "llm";
        } else {
          const liveContext = results
            .filter((result) => result.live)
            .map((result) => docs.find((doc) => doc.id === result.doc_id))
            .filter(Boolean);
          const seen = new Set(liveContext.map((doc) => doc.id));
          for (const doc of liveDocs.values()) if (!seen.has(doc.id)) liveContext.push(doc);
          [answer, answerMode] = buildCloudDemoAnswer(question, results, docs, liveContext, liveMeta);
        }
      } else {
        const liveContext = results
          .filter((result) => result.live)
          .map((result) => docs.find((doc) => doc.id === result.doc_id))
          .filter(Boolean);
        const seen = new Set(liveContext.map((doc) => doc.id));
        for (const doc of liveDocs.values()) if (!seen.has(doc.id)) liveContext.push(doc);
        [answer, answerMode] = buildCloudDemoAnswer(question, results, docs, liveContext, liveMeta);
      }
    }

    docs = getDocuments();
    const verification = verifyAnswer(answer, docs);
    const sources = [...new Set([
      ...results.map((result) => result.doc_id),
      ...verification.quotes.map((quote) => quote.source_id),
    ])].sort();
    const detail = mode === "LOCAL_ONLY"
      ? "LOCAL_ONLY: offline hybrid retrieval and deterministic extraction completed; zero outbound calls."
      : `CLOUD_APPROVED: live Europe PMC returned ${liveFetched} records; synthesis mode ${answerMode}.`;
    const audit = recordQuery({
      query: question,
      egressHosts: [...new Set(egressHosts)],
      sources,
      verification: verification.counts,
      detail,
      liveFetched,
    });

    return json(responseBody({
      mode, question, answer, answerMode, verification, results, docs,
      liveMeta, liveError, llmError, audit,
    }));
  } catch (error) {
    return errorResponse(error);
  }
}
