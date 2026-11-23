import { AVGDL, BM25_N, CHUNKS, DF, DOCUMENTS } from "../data.generated.js";
import { embedVector, cosine } from "./hash.js";
import { escapeHtml, highlight, snippet, splitSentences, tokenize } from "./text.js";

let chunks = [...CHUNKS];
let documents = [...DOCUMENTS];
let df = { ...DF };
let bm25N = BM25_N;
let avgdl = AVGDL;

const K1 = 1.5;
const B = 0.75;

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function chunkDocument(doc) {
  const made = [];
  const seen = new Set();
  const meta = {
    type: doc.type || "paper",
    title: doc.title || "",
    date: doc.date || "",
    display_date: doc.display_date || "",
    journal: doc.journal || "",
    url: doc.url || null,
    live: Boolean(doc.live),
  };
  const add = (text, kind) => {
    const cleaned = cleanText(text);
    if (cleaned.length < 30 || seen.has(cleaned)) return;
    seen.add(cleaned);
    made.push({
      id: `${doc.id}-${made.length + 1}`,
      docId: doc.id,
      kind,
      text: cleaned,
      tokens: tokenize(cleaned),
      vector: embedVector(cleaned),
      ...meta,
    });
  };

  if (doc.type === "meeting_note") {
    for (const [field, kind] of [["decisions", "decision"], ["action_items", "action_item"], ["open_questions", "open_question"]]) {
      for (const item of doc[field] || []) add(item, kind);
    }
  }
  for (const paragraph of String(doc.content || "").split(/\n\s*\n/)) {
    add(paragraph, "paragraph");
    for (const sentence of splitSentences(paragraph)) add(sentence, "sentence");
  }
  return made;
}

export function getDocuments() {
  return documents;
}

export function getChunkCount() {
  return chunks.length;
}

export function addDocuments(newDocs) {
  for (const doc of newDocs) {
    if (documents.some((item) => item.id === doc.id)) continue;
    documents = [...documents, doc];
    const made = chunkDocument(doc);
    chunks = [...chunks, ...made];
    for (const chunk of made) {
      for (const token of new Set(chunk.tokens)) df[token] = (df[token] || 0) + 1;
    }
    bm25N = chunks.length;
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.tokens.length, 0);
    avgdl = totalLength / Math.max(chunks.length, 1);
  }
}

function idf(token) {
  const seen = df[token] || 0;
  return Math.log(bm25N - seen + 0.5) - Math.log(seen + 0.5);
}

function bm25Score(queryTokens, chunk) {
  const counts = new Map();
  for (const token of chunk.tokens) counts.set(token, (counts.get(token) || 0) + 1);
  const length = chunk.tokens.length || 1;
  let score = 0;
  for (const token of queryTokens) {
    const frequency = counts.get(token) || 0;
    if (!frequency) continue;
    const denominator = frequency + K1 * (1 - B + (B * length) / avgdl);
    score += idf(token) * ((frequency * (K1 + 1)) / denominator);
  }
  return score;
}

function minmax(values) {
  if (!values.length) return [];
  let low = values[0];
  let high = values[0];
  for (const value of values) {
    if (value < low) low = value;
    if (value > high) high = value;
  }
  if (high === low) return values.map(() => 0);
  return values.map((value) => (value - low) / (high - low));
}

function round4(value) {
  return Number(value.toFixed(4));
}

export function search(query, topK = 4) {
  const queryTokens = tokenize(query);
  if (!queryTokens || !queryTokens.length || !chunks.length) return [];

  const bm25Raw = chunks.map((chunk) => bm25Score(queryTokens, chunk));
  const queryVector = embedVector(query);
  const vectorRaw = chunks.map((chunk) => cosine(chunk.vector, queryVector));
  const bm25Norm = minmax(bm25Raw);
  const vectorNorm = minmax(vectorRaw);
  const combined = chunks.map((_, index) => 0.5 * bm25Norm[index] + 0.5 * vectorNorm[index]);

  const lowered = String(query || "").toLowerCase();
  const comparison = ["compare", "internal", "our internal"].some((term) => lowered.includes(term));
  let allowedType = null;
  if (!comparison && ["paper", "abstract", "study", "literature"].some((term) => lowered.includes(term))) {
    allowedType = "paper";
  } else if (!comparison && ["meeting", "notes", "discuss", "decision", "action item"].some((term) => lowered.includes(term))) {
    allowedType = "meeting_note";
  }

  const bestByDoc = new Map();
  const indices = combined.map((_, index) => index).sort((a, b) => combined[b] - combined[a]);
  for (const index of indices) {
    const chunk = chunks[index];
    if (allowedType && chunk.type !== allowedType) continue;
    if (!bestByDoc.has(chunk.docId)) bestByDoc.set(chunk.docId, index);
    if (bestByDoc.size >= topK) break;
  }

  const queryTerms = queryTokens.filter((term) => term.length >= 2);
  const results = [];
  for (const [docId, index] of bestByDoc) {
    const chunk = chunks[index];
    const matched = [...new Set(queryTerms.filter((term) => chunk.tokens.includes(term)))].sort((a, b) => b.length - a.length).slice(0, 12);
    results.push({
      chunk_id: chunk.id,
      doc_id: docId,
      type: chunk.type,
      title: chunk.title,
      date: chunk.date,
      display_date: chunk.display_date,
      journal: chunk.journal,
      url: chunk.url,
      live: chunk.live,
      kind: chunk.kind,
      text: chunk.text,
      snippet_html: snippet(chunk.text, queryTerms),
      matched_terms: matched,
      score: round4(combined[index]),
      bm25: round4(bm25Norm[index]),
      vector: round4(vectorNorm[index]),
      bm25_raw: round4(bm25Raw[index]),
      vector_raw: round4(vectorRaw[index]),
    });
  }
  return results.sort((a, b) => b.score - a.score);
}

export function resultForDoc(docId, query) {
  const found = search(query, 40).find((result) => result.doc_id === docId);
  if (found) return found;
  const doc = documents.find((item) => item.id === docId);
  if (!doc) return null;
  return {
    chunk_id: `${docId}-0`,
    doc_id: docId,
    type: doc.type,
    title: doc.title,
    date: doc.date,
    display_date: doc.display_date,
    journal: doc.journal || "",
    url: doc.url,
    live: Boolean(doc.live),
    kind: "document",
    text: doc.content || "",
    snippet_html: escapeHtml(doc.content || "").slice(0, 430),
    matched_terms: [],
    score: 0,
    bm25: 0,
    vector: 0,
    bm25_raw: 0,
    vector_raw: 0,
  };
}
