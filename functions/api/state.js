import { json } from "../lib/http.js";
import { llmConfig } from "../lib/llm.js";
import { getMode, snapshot } from "../lib/policy.js";
import { getChunkCount, getDocuments } from "../lib/retrieval.js";

export async function onRequestGet({ env }) {
  const docs = getDocuments();
  const notes = docs.filter((doc) => doc.type === "meeting_note");
  const papers = docs.filter((doc) => doc.type === "paper");
  const llm = llmConfig(env);
  return json({
    privacy_mode: getMode(),
    documents: docs,
    audit_log: snapshot(),
    counts: {
      papers: papers.length,
      meeting_notes: notes.length,
      live: papers.filter((doc) => doc.live).length,
      total: docs.length,
    },
    retrieval: { backend: "worker-hashing-256", chunks: getChunkCount() },
    llm: {
      configured: Boolean(llm),
      provider: llm?.provider || "deterministic-demo",
      model: llm?.model || "deterministic-demo",
    },
  });
}
