"""Deterministic quote verification for grounded biotech answers."""

from __future__ import annotations

import html
import re
from difflib import SequenceMatcher

QUOTE_PATTERN = re.compile(
    r'["“](?P<quote>[^"”\n]{3,600})["”]\s*\[(?P<source>[A-Za-z0-9_.:-]+)\]'
)
WORD_PATTERN = re.compile(r"[a-z0-9]+")
SENTENCE_SPLIT = re.compile(r"(?<=[.!?])\s+(?=[A-Z0-9(\"“])")
LABELS = {
    "exact": "Exact Quote Verified",
    "close": "Close Match (Review)",
    "unverified": "Paraphrased / Unverified",
}


def normalize(value: str) -> str:
    value = html.unescape(value or "")
    value = value.replace("’", "'").replace("“", '"').replace("”", '"')
    value = value.replace("–", "-").replace("—", "-")
    value = re.sub(r"\s+", " ", value)
    return value.strip().lower()


def words(value: str) -> list[str]:
    return WORD_PATTERN.findall(normalize(value))


def sentences(value: str) -> list[str]:
    clean = html.unescape(value or "")
    clean = re.sub(r"\s+", " ", clean).strip()
    parts = SENTENCE_SPLIT.split(clean)
    return [part.strip() for part in parts if len(part.strip()) > 20]


def _best_sentence_ratio(quote: str, source_text: str) -> float:
    quote_tokens = words(quote)
    if not quote_tokens:
        return 0.0
    best = 0.0
    for sentence in sentences(source_text):
        sentence_tokens = words(sentence)
        if not sentence_tokens:
            continue
        ratio = SequenceMatcher(None, quote_tokens, sentence_tokens).ratio()
        if ratio > best:
            best = ratio
    return best


def verify_quote(quote: str, source: dict) -> dict:
    source_id = source.get("id", "UNKNOWN")
    source_text = source.get("content", "")
    normalized_quote = normalize(quote).strip(' .,;:')
    normalized_source = normalize(source_text)
    if normalized_quote and normalized_quote in normalized_source:
        status = "exact"
        reason = "The quote appears verbatim in the source text after whitespace and case normalisation."
        confidence = 1.0
    else:
        ratio = _best_sentence_ratio(quote, source_text)
        if ratio >= 0.85:
            status = "close"
            reason = "The quote is not verbatim, but at least 85% of its tokens match a source sentence."
            confidence = round(ratio, 3)
        else:
            status = "unverified"
            reason = "No verbatim or close sentence-level match was found in the cited source."
            confidence = round(ratio, 3)
    return {
        "quote": quote.strip(),
        "source_id": source_id,
        "source_title": source.get("title", source_id),
        "source_type": source.get("type", "paper"),
        "url": source.get("url"),
        "status": status,
        "label": LABELS[status],
        "reason": reason,
        "confidence": confidence,
    }


def verify_answer(answer: str, documents: list[dict]) -> dict:
    by_id = {str(doc.get("id", "")).upper(): doc for doc in documents}
    quotes: list[dict] = []
    for match in QUOTE_PATTERN.finditer(answer or ""):
        quote = match.group("quote").strip()
        source_id = match.group("source").strip()
        source = by_id.get(source_id.upper())
        if source is None:
            quotes.append(
                {
                    "quote": quote,
                    "source_id": source_id,
                    "source_title": "Unknown source",
                    "source_type": "unknown",
                    "url": None,
                    "status": "unverified",
                    "label": LABELS["unverified"],
                    "reason": "The cited source ID is not present in the active corpus.",
                    "confidence": 0.0,
                }
            )
        else:
            quotes.append(verify_quote(quote, source))
    counts = {key: 0 for key in LABELS}
    for quote in quotes:
        counts[quote["status"]] += 1
    counts["total"] = len(quotes)
    return {"quotes": quotes, "counts": counts, "pass_rate": counts["exact"] / len(quotes) if quotes else 0.0}
