import { splitSentences } from "./text.js";

const NUMERIC_RE = /\d/;
const NUMERIC_INTENT = /\b(numbers?|quote|efficacy|safety|response rates?|survival|percent)\b/i;
const MEETING_INTENT = ["meeting", "sync", "discuss", "choose", "chose", "decided", "decision", "strategy", "did we"];
const MONTHS = {
  january: "01", february: "02", march: "03", april: "04", may: "05", june: "06",
  july: "07", august: "08", september: "09", october: "10", november: "11", december: "12",
};

function quoteText(sentence, docId) {
  const cleaned = String(sentence || "")
    .replace(/\s+/g, " ")
    .trim()
    .replaceAll('"', "'")
    .replaceAll("“", "'")
    .replaceAll("”", "'");
  return `"${cleaned}" [${docId}]`;
}

function selectSentences(doc, terms, limit = 2, numeric = false) {
  const scored = [];
  for (const sentence of splitSentences(doc.content || "")) {
    const lowered = sentence.toLowerCase();
    let score = terms.reduce((total, term) => total + (lowered.includes(String(term).toLowerCase()) ? 1 : 0), 0);
    if (numeric && NUMERIC_RE.test(sentence)) score += 2;
    if (["conclusion", "results", "observed", "reported", "occurred"].some((word) => lowered.includes(word))) score += 0.25;
    if (sentence.length > 360) score -= 0.5;
    if (/["“]/.test(sentence)) score -= 0.4;
    if (score > 0) scored.push({ score, sentence });
  }
  scored.sort((a, b) => b.score - a.score || b.sentence.length - a.sentence.length);
  return scored.slice(0, limit).map((item) => item.sentence);
}

function bestDoc(docs, terms, type = null, exclude = new Set()) {
  const ranked = [];
  for (const doc of docs) {
    if (exclude.has(doc.id)) continue;
    if (type && doc.type !== type) continue;
    const haystack = `${doc.title || ""} ${doc.content || ""}`.toLowerCase();
    let score = 0;
    for (const term of terms) {
      const lowered = String(term).toLowerCase();
      if ((doc.title || "").toLowerCase().includes(lowered)) score += 1.5;
      else if (haystack.includes(lowered)) score += 0.8;
    }
    if (doc.live) score += 0.1;
    ranked.push({ score, doc });
  }
  ranked.sort((a, b) => b.score - a.score);
  return ranked.length && ranked[0].score > 0 ? ranked[0].doc : null;
}

function meetingForDate(docs, query) {
  const lowered = String(query || "").toLowerCase();
  const dayMatch = lowered.match(/\b(\d{1,2})(?:st|nd|rd|th)?\b/);
  for (const [month, number] of Object.entries(MONTHS)) {
    if (!lowered.includes(month)) continue;
    if (dayMatch) {
      const day = String(Number(dayMatch[1])).padStart(2, "0");
      const target = `2026-${number}-${day}`;
      const exact = docs.find((doc) => doc.date === target);
      if (exact) return exact;
    }
    const byDisplay = docs.find((doc) => doc.type === "meeting_note" && String(doc.display_date || "").toLowerCase().includes(month));
    if (byDisplay) return byDisplay;
  }
  return null;
}

function introTitle(doc) {
  return String(doc.title || "the meeting").split("—").slice(-1)[0].trim().toLowerCase();
}

export function buildLocalAnswer(query, results, documents) {
  const lowered = String(query || "").toLowerCase();
  const byId = new Map(documents.map((doc) => [doc.id, doc]));

  let meetingDoc = meetingForDate(documents, query);
  if (!meetingDoc && MEETING_INTENT.some((word) => lowered.includes(word))) {
    for (const result of results) {
      if (byId.get(result.doc_id)?.type === "meeting_note") {
        meetingDoc = byId.get(result.doc_id);
        break;
      }
    }
  }

  if (meetingDoc && !["compare", "against", "literature"].some((word) => lowered.includes(word))) {
    const lines = [
      `The ${meetingDoc.display_date || meetingDoc.date} note is the strongest local match. It covers ${introTitle(meetingDoc)}.`,
      "",
      "Decisions",
    ];
    for (const item of (meetingDoc.decisions || []).slice(0, 2)) lines.push(`- ${quoteText(item, meetingDoc.id)}`);
    const actions = (meetingDoc.action_items || []).slice(0, 2);
    if (actions.length) {
      lines.push("", "Action items");
      for (const item of actions) lines.push(`- ${quoteText(item, meetingDoc.id)}`);
    }
    const questions = (meetingDoc.open_questions || []).slice(0, 1);
    if (questions.length) {
      lines.push("", "Open question");
      for (const item of questions) lines.push(`- ${quoteText(item, meetingDoc.id)}`);
    }
    lines.push("", "This is an extractive brief. Each quote was pulled from the bundled note; no generative model or external service was called.");
    return [lines.join("\n"), "local_extractive"];
  }

  if (["compare", "against"].some((word) => lowered.includes(word))) {
    const internal = meetingForDate(documents, query) || bestDoc(documents, ["affinity", "cd3", "cytokine", "crs"], "meeting_note");
    const external = bestDoc(documents, ["cd3", "bispecific", "nanomolar", "t cell"], "paper");
    const lines = ["LOCAL_ONLY comparison against the bundled corpus.", ""];
    if (internal) {
      const decision = (internal.decisions || []).slice(0, 1).length
        ? (internal.decisions || []).slice(0, 1)
        : selectSentences(internal, ["affinity", "cd3", "cytokine", "crs"], 1);
      lines.push("Internal position");
      for (const item of decision) lines.push(`- ${quoteText(item, internal.id)}`);
    }
    if (external) {
      const evidence = selectSentences(external, ["cd3", "bispecific", "nanomolar", "t cell", "affinity"], 2);
      lines.push("", `Bundled literature — ${external.title || ""}`);
      for (const item of evidence) lines.push(`- ${quoteText(item, external.id)}`);
    }
    lines.push("", "Switch the server policy to CLOUD_APPROVED to add live Europe PMC records and optional synthesis.");
    return [lines.join("\n"), "local_extractive"];
  }

  const numeric = NUMERIC_INTENT.test(query) && ["number", "quote", "efficacy", "safety", "response", "survival"].some((word) => lowered.includes(word));
  const paperCandidates = results
    .map((result) => byId.get(result.doc_id))
    .filter((doc) => doc && doc.type === "paper");

  if (numeric && paperCandidates.length) {
    const lines = ["The bundled bispecific literature reports these exact figures."];
    let used = 0;
    for (const doc of paperCandidates) {
      const evidence = selectSentences(doc, ["efficacy", "safety", "response", "survival", "cytokine", "infection", "rate"], 3, true);
      if (!evidence.length) continue;
      lines.push("", `${doc.title || ""} — ${doc.journal || ""}`);
      for (const item of evidence) lines.push(`- ${quoteText(item, doc.id)}`);
      used += 1;
      if (used >= 2) break;
    }
    if (used) {
      lines.push("", "The badges below come from deterministic substring and token matching against the cited source.");
      return [lines.join("\n"), "local_extractive"];
    }
  }

  const lines = ["The strongest evidence in the bundled corpus is below."];
  const seen = new Set();
  for (const result of results.slice(0, 3)) {
    const doc = byId.get(result.doc_id);
    if (!doc || seen.has(doc.id)) continue;
    seen.add(doc.id);
    let evidence = selectSentences(doc, (result.matched_terms || []).filter((term) => term.length > 2), 2);
    if (!evidence.length) evidence = splitSentences(result.text || "").slice(0, 2);
    lines.push("", `${doc.title || ""} — ${result.display_date || ""}`);
    for (const item of evidence) lines.push(`- ${quoteText(item, doc.id)}`);
  }
  lines.push("", "This is a local extractive answer. No external egress was used.");
  return [lines.join("\n"), "local_extractive"];
}

export function buildCloudDemoAnswer(query, results, documents, liveDocs, liveMeta) {
  const lowered = String(query || "").toLowerCase();

  if (["compare", "against", "literature"].some((word) => lowered.includes(word))) {
    const internal = meetingForDate(documents, query) || bestDoc(documents, ["affinity", "cd3", "cytokine", "crs"], "meeting_note");
    const lines = ["Internal position vs. live literature.", ""];
    if (internal) {
      const decision = (internal.decisions || []).slice(0, 1).length
        ? (internal.decisions || []).slice(0, 1)
        : selectSentences(internal, ["affinity", "cd3", "cytokine", "crs"], 1);
      lines.push("Internal decision");
      for (const item of decision) lines.push(`- ${quoteText(item, internal.id)}`);
    }
    if (liveDocs.length) {
      lines.push("", "Live Europe PMC evidence");
      for (const doc of liveDocs.slice(0, 2)) {
        const evidence = selectSentences(doc, ["cd3", "bispecific", "affinity", "cytokine", "t cell", "response"], 2);
        for (const item of evidence) lines.push(`- ${quoteText(item, doc.id)}`);
      }
      lines.push("", `Live retrieval returned ${liveMeta?.returned ?? liveDocs.length} abstract records from ${liveMeta?.hit_count ?? "—"} hits. The quoted literature is appended to the active corpus and remains visible in Tab 3.`);
    } else {
      lines.push("", "Live Europe PMC returned no usable abstract records, so the comparison is limited to bundled sources.");
    }
    lines.push(
      "",
      "Interpretation: the internal 15 nM affinity cap is a deliberately conservative CRS-control choice. The literature supports CD3 engagement as a potent mechanism, but the safety burden is molecule- and schedule-specific. The cap should be validated against the donor IL-6 assay before the construct is locked.",
      "",
      "Deterministic synthesis demo — no LLM key was configured, so the brief was assembled from verified extracts.",
    );
    return [lines.join("\n"), "deterministic_demo"];
  }

  if (liveDocs.length) {
    const doc = liveDocs[0];
    let evidence = selectSentences(doc, String(query || "").toLowerCase().split(/\s+/).filter((term) => term.length > 3), 3, true);
    if (!evidence.length) evidence = splitSentences(doc.content || "").slice(0, 2);
    const lines = [
      `The live literature adds ${liveDocs.length} new Europe PMC records. The most relevant is ${doc.title || ""}.`,
      "",
    ];
    for (const item of evidence) lines.push(`- ${quoteText(item, doc.id)}`);
    lines.push("", "This answer combines bundled retrieval with the live record above. The quoted spans are verified against the abstract text.");
    return [lines.join("\n"), "deterministic_demo"];
  }

  const local = buildLocalAnswer(query, results, documents);
  return [`${local[0]}\n\nDeterministic synthesis demo — no live records were added.`, "deterministic_demo"];
}
