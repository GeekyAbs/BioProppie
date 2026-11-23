import { normalizeQuote, splitSentences, tokenize } from "./text.js";

const QUOTE_PATTERN = /["“]([^"”\n]{3,600})["”]\s*\[([A-Za-z0-9_.:-]+)\]/g;

const LABELS = {
  exact: "Exact Quote Verified",
  close: "Close Match (Review)",
  unverified: "Paraphrased / Unverified",
};

function bestRatio(quote, sourceText) {
  const quoteTokens = tokenize(quote);
  if (!quoteTokens.length) return 0;
  let best = 0;
  for (const sentence of splitSentences(sourceText)) {
    const sentenceTokens = new Set(tokenize(sentence));
    if (!sentenceTokens.size) continue;
    const matched = quoteTokens.filter((token) => sentenceTokens.has(token)).length;
    const ratio = matched / quoteTokens.length;
    if (ratio > best) best = ratio;
  }
  return best;
}

export function verifyQuote(quote, source) {
  const sourceId = source.id || "UNKNOWN";
  const normalizedQuote = normalizeQuote(quote).replace(/^[ .,;:]+|[ .,;:]+$/g, "");
  const normalizedSource = normalizeQuote(source.content || "");
  let status = "unverified";
  let reason = "No verbatim or close sentence-level match was found in the cited source.";
  let confidence = 0;

  if (normalizedQuote && normalizedSource.includes(normalizedQuote)) {
    status = "exact";
    reason = "The quote appears verbatim in the source text after whitespace and case normalisation.";
    confidence = 1;
  } else {
    confidence = bestRatio(quote, source.content || "");
    if (confidence >= 0.85) {
      status = "close";
      reason = "The quote is not verbatim, but at least 85% of its tokens match a source sentence.";
    }
  }

  return {
    quote: String(quote).trim(),
    source_id: sourceId,
    source_title: source.title || sourceId,
    source_type: source.type || "paper",
    url: source.url || null,
    status,
    label: LABELS[status],
    reason,
    confidence: Number(confidence.toFixed(3)),
  };
}

export function verifyAnswer(answer, documents) {
  const byId = new Map(documents.map((doc) => [String(doc.id).toUpperCase(), doc]));
  const quotes = [];
  for (const match of String(answer || "").matchAll(QUOTE_PATTERN)) {
    const quote = match[1].trim();
    const sourceId = match[2].trim();
    const source = byId.get(sourceId.toUpperCase());
    if (!source) {
      quotes.push({
        quote,
        source_id: sourceId,
        source_title: "Unknown source",
        source_type: "unknown",
        url: null,
        status: "unverified",
        label: LABELS.unverified,
        reason: "The cited source ID is not present in the active corpus.",
        confidence: 0,
      });
    } else {
      quotes.push(verifyQuote(quote, source));
    }
  }
  const counts = { exact: 0, close: 0, unverified: 0, total: quotes.length };
  for (const quote of quotes) counts[quote.status] += 1;
  return {
    quotes,
    counts,
    pass_rate: quotes.length ? counts.exact / quotes.length : 0,
  };
}
