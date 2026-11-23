import { escapeHtml, normalizeQuote } from "./text.js";

const QUOTE_PATTERN = /["“]([^"”\n]{3,600})["”]\s*\[([A-Za-z0-9_.:-]+)\]/g;

function badgeHtml(quoteInfo) {
  const status = quoteInfo.status || "unverified";
  const label = escapeHtml(quoteInfo.label || "Paraphrased / Unverified");
  const title = escapeHtml(quoteInfo.source_title || "");
  const reason = escapeHtml(quoteInfo.reason || "");
  return (
    `<span class="claim claim-${status}" title="${title} — ${reason}">` +
    `<span class="claim-text">“${escapeHtml(quoteInfo.quote)}”</span> ` +
    `<span class="claim-badge">${label}</span>` +
    `<button class="source-ref" data-source-id="${escapeHtml(quoteInfo.source_id)}">[${escapeHtml(quoteInfo.source_id)}]</button>` +
    "</span>"
  );
}

const LABELS = new Set([
  "Decisions", "Action items", "Open question", "Internal decision", "Internal position", "Live Europe PMC evidence",
]);

export function renderAnswerHtml(answer, verification) {
  const byKey = new Map(
    (verification?.quotes || []).map((quote) => [`${normalizeQuote(quote.quote)}|${String(quote.source_id).toUpperCase()}`, quote]),
  );
  const source = String(answer || "");
  let cursor = 0;
  let annotated = "";
  for (const match of source.matchAll(QUOTE_PATTERN)) {
    annotated += escapeHtml(source.slice(cursor, match.index));
    const key = `${normalizeQuote(match[1])}|${match[2].toUpperCase()}`;
    const info = byKey.get(key) || {
      quote: match[1],
      source_id: match[2],
      source_title: "Unknown source",
      status: "unverified",
      label: "Paraphrased / Unverified",
      reason: "This citation could not be matched to a verified quote.",
    };
    annotated += badgeHtml(info);
    cursor = match.index + match[0].length;
  }
  annotated += escapeHtml(source.slice(cursor));

  const blocks = [];
  let inList = false;
  for (const rawLine of annotated.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      if (inList) {
        blocks.push("</ul>");
        inList = false;
      }
      continue;
    }
    if (line.startsWith("- ")) {
      if (!inList) {
        blocks.push('<ul class="answer-list">');
        inList = true;
      }
      blocks.push(`<li>${line.slice(2)}</li>`);
      continue;
    }
    if (inList) {
      blocks.push("</ul>");
      inList = false;
    }
    if (LABELS.has(line) || line.startsWith("Bundled literature —") || line.startsWith("Internal position vs.")) {
      blocks.push(`<h4 class="answer-label">${line}</h4>`);
    } else {
      blocks.push(`<p>${line}</p>`);
    }
  }
  if (inList) blocks.push("</ul>");
  return blocks.join("");
}
