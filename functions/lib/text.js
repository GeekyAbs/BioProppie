import { STOPWORDS } from "../data.generated.js";

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function unescapeBasic(value) {
  return String(value ?? "")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#039;", "'");
}

export function tokenize(value) {
  const clean = unescapeBasic(value || "").toLowerCase();
  const found = clean.match(/[a-z0-9]+(?:[.\-][a-z0-9]+)*/g) || [];
  const out = [];
  for (const token of found) {
    if (STOPWORDS.includes(token)) continue;
    out.push(token);
    if (token.endsWith("s") && token.length > 3) out.push(token.slice(0, -1));
  }
  return out;
}

export function splitSentences(value) {
  const clean = unescapeBasic(value || "").replace(/\s+/g, " ").trim();
  if (!clean) return [];
  return clean
    .split(/(?<=[.!?])\s+(?=[A-Z0-9("“])/)
    .map((part) => part.trim())
    .filter((part) => part.length > 25);
}

export function highlight(value, terms = []) {
  let output = escapeHtml(value);
  const usable = [...new Set((terms || []).map((term) => String(term).toLowerCase()))]
    .filter((term) => term.length >= 2 && !STOPWORDS.includes(term))
    .sort((a, b) => b.length - a.length)
    .slice(0, 16);
  if (!usable.length) return output;
  const escaped = usable.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(`(?<![\\w-])(${escaped.join("|")})(?![\\w-])`, "gi");
  return output.replace(pattern, "<mark>$1</mark>");
}

function truncate(text, limit) {
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut) + "…";
}

export function snippet(text, terms = [], limit = 430) {
  const parts = splitSentences(text);
  const candidates = parts.length ? parts : [text || ""];
  const ranked = candidates
    .map((sentence, index) => {
      const sentenceTokens = tokenize(sentence);
      const score = terms.reduce((total, term) => total + (sentenceTokens.includes(term) ? 1 : 0), 0);
      return { index, score };
    })
    .sort((a, b) => b.score - a.score);
  const chosen = ranked.slice(0, 2).map((item) => candidates[item.index]).sort((a, b) => {
    const ai = candidates.indexOf(a);
    const bi = candidates.indexOf(b);
    return ai - bi;
  });
  return highlight(truncate(chosen.join(" "), limit), terms);
}

export function normalizeQuote(value) {
  return unescapeBasic(value || "")
    .replaceAll("’", "'")
    .replaceAll("“", '"')
    .replaceAll("”", '"')
    .replaceAll("–", "-")
    .replaceAll("—", "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}
