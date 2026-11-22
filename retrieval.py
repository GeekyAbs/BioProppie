"""Offline hybrid retrieval: BM25 + local sentence embeddings, with no query egress."""

from __future__ import annotations

import html
import math
import os
import re
import threading
from collections import Counter

import numpy as np
from rank_bm25 import BM25Okapi

WORD_RE = re.compile(r"[a-z0-9]+(?:[.\-][a-z0-9]+)*")
SENTENCE_SPLIT = re.compile(r"(?<=[.!?])\s+(?=[A-Z0-9(\"“])")
STOPWORDS = {
    "a", "an", "and", "are", "as", "at", "be", "been", "by", "did", "do", "does", "for",
    "from", "had", "has", "have", "how", "in", "into", "is", "it", "its", "of", "on", "or",
    "our", "that", "the", "their", "this", "to", "was", "we", "were", "what", "when", "where",
    "which", "who", "why", "with", "would", "me", "my", "you", "your", "about", "against",
}
MONTHS = {
    "january", "february", "march", "april", "may", "june", "july", "august",
    "september", "october", "november", "december",
}


def tokenize(text: str) -> list[str]:
    tokens: list[str] = []
    for token in WORD_RE.findall((text or "").lower()):
        if token in STOPWORDS:
            continue
        tokens.append(token)
        if token.endswith("s") and len(token) > 3:
            tokens.append(token[:-1])
    return tokens


def _minmax(values: np.ndarray) -> np.ndarray:
    if values.size == 0:
        return values
    low = float(values.min())
    high = float(values.max())
    if math.isclose(low, high):
        return np.zeros_like(values, dtype=np.float32)
    return ((values - low) / (high - low)).astype(np.float32)


def split_sentences(text: str) -> list[str]:
    clean = html.unescape(text or "")
    clean = re.sub(r"\s+", " ", clean).strip()
    return [part.strip() for part in SENTENCE_SPLIT.split(clean) if len(part.strip()) > 25]


def _chunk_document(doc: dict) -> list[dict]:
    doc_id = doc["id"]
    chunks: list[dict] = []

    def add(text: str, kind: str) -> None:
        text = re.sub(r"\s+", " ", html.unescape(text or "")).strip()
        if len(text) < 30:
            return
        if any(existing["text"] == text for existing in chunks):
            return
        chunks.append({"chunk_id": f"{doc_id}-{len(chunks) + 1}", "doc_id": doc_id, "kind": kind, "text": text})

    if doc.get("type") == "meeting_note":
        for field, kind in (
            ("decisions", "decision"),
            ("action_items", "action_item"),
            ("open_questions", "open_question"),
        ):
            for item in doc.get(field, []) or []:
                add(item, kind)
        for paragraph in re.split(r"\n\s*\n", doc.get("content", "")):
            add(paragraph, "paragraph")
            for sentence in split_sentences(paragraph):
                add(sentence, "sentence")
    else:
        for paragraph in re.split(r"\n\s*\n", doc.get("content", "")):
            add(paragraph, "paragraph")
            for sentence in split_sentences(paragraph):
                add(sentence, "sentence")
    return chunks


class HashingEmbedder:
    """Tiny deterministic local vectors. Shared with the Cloudflare Worker build."""

    name = "local-hashing-256"
    dimensions = 256

    @staticmethod
    def _fnv1a(value: str) -> int:
        h = 2166136261
        for byte in value.encode("utf-8"):
            h ^= byte
            h = (h * 16777619) & 0xFFFFFFFF
        return h

    def embed(self, texts: list[str]) -> np.ndarray:
        matrix = np.zeros((len(texts), self.dimensions), dtype=np.float32)
        for row, text in enumerate(texts):
            norm_text = html.unescape(text or "").lower()
            features: Counter[str] = Counter()
            for token in tokenize(norm_text):
                features[f"t:{token}"] += 1
            for token in norm_text.split():
                cleaned = re.sub(r"[^a-z0-9]", "", token)
                if len(cleaned) < 3:
                    continue
                features[f"w:{cleaned}"] += 1
                for index in range(len(cleaned) - 2):
                    features[f"c:{cleaned[index:index + 3]}"] += 0.35
            for feature, count in features.items():
                digest = self._fnv1a(feature)
                bucket = digest % self.dimensions
                sign = -1.0 if (digest >> 16) & 1 else 1.0
                matrix[row, bucket] += sign * (1.0 + math.log(count))
            norm = float(np.linalg.norm(matrix[row]))
            if norm:
                matrix[row] /= norm
        return matrix


class FastEmbedBackend:
    name = "BAAI/bge-small-en-v1.5"
    dimensions = 384

    def __init__(self) -> None:
        from fastembed import TextEmbedding

        self._model = TextEmbedding(model_name=self.name)

    def embed(self, texts: list[str]) -> np.ndarray:
        vectors = np.asarray(list(self._model.embed(texts)), dtype=np.float32)
        norms = np.linalg.norm(vectors, axis=1, keepdims=True)
        norms[norms == 0] = 1.0
        return vectors / norms


class RetrievalIndex:
    def __init__(self, documents: list[dict] | None = None) -> None:
        self._lock = threading.Lock()
        self.embedder = self._make_embedder()
        self.documents: dict[str, dict] = {}
        self.chunks: list[dict] = []
        self.bm25: BM25Okapi | None = None
        self.vectors = np.zeros((0, self.embedder.dimensions), dtype=np.float32)
        if documents:
            self._build(documents)

    @property
    def backend_name(self) -> str:
        return self.embedder.name

    def _make_embedder(self):
        # Default to the tiny deterministic local backend. FastEmbed is opt-in for
        # machines that can afford the model download and embedding CPU.
        choice = os.getenv("EVST_EMBEDDING", "hashing").strip().lower()
        if choice in {"fastembed", "onnx", "bge"}:
            try:
                return FastEmbedBackend()
            except Exception:
                return HashingEmbedder()
        return HashingEmbedder()

    def _decorate_chunks(self, doc: dict) -> list[dict]:
        chunks = _chunk_document(doc)
        for chunk in chunks:
            chunk.update(
                {
                    "type": doc.get("type", "paper"),
                    "title": doc.get("title", ""),
                    "date": doc.get("date", ""),
                    "display_date": doc.get("display_date", ""),
                    "journal": doc.get("journal", ""),
                    "url": doc.get("url"),
                    "live": bool(doc.get("live", False)),
                }
            )
        return chunks

    def _build(self, documents: list[dict]) -> None:
        self.documents = {doc["id"]: doc for doc in documents}
        self.chunks = []
        for doc in documents:
            self.chunks.extend(self._decorate_chunks(doc))
        corpus = [tokenize(chunk["text"]) for chunk in self.chunks]
        self.bm25 = BM25Okapi(corpus) if corpus else None
        if self.chunks:
            self.vectors = self.embedder.embed([chunk["text"] for chunk in self.chunks])
        else:
            self.vectors = np.zeros((0, self.embedder.dimensions), dtype=np.float32)

    def add_documents(self, documents: list[dict]) -> None:
        """Index only newly fetched documents; never re-embed the whole corpus."""
        with self._lock:
            new_docs = [doc for doc in documents if doc["id"] not in self.documents]
            if not new_docs:
                return
            new_chunks: list[dict] = []
            for doc in new_docs:
                self.documents[doc["id"]] = doc
                new_chunks.extend(self._decorate_chunks(doc))
            if not new_chunks:
                return
            new_vectors = self.embedder.embed([chunk["text"] for chunk in new_chunks])
            self.chunks.extend(new_chunks)
            self.vectors = (
                np.vstack([self.vectors, new_vectors])
                if self.vectors.size
                else new_vectors
            )
            self.bm25 = BM25Okapi([tokenize(chunk["text"]) for chunk in self.chunks])

    def _highlight(self, text: str, terms: list[str]) -> str:
        escaped = html.escape(text)
        usable = [term for term in terms if len(term) >= 2 and term not in STOPWORDS]
        usable = sorted(set(usable), key=len, reverse=True)[:16]
        if not usable:
            return escaped
        pattern = re.compile(r"(?<!\w)(" + "|".join(re.escape(term) for term in usable) + r")(?!\w)", re.I)
        return pattern.sub(r"<mark>\1</mark>", escaped)

    def _snippet(self, text: str, query_terms: list[str], limit: int = 430) -> str:
        sentences_list = split_sentences(text) or [text]
        ranked = sorted(
            enumerate(sentences_list),
            key=lambda item: sum(1 for term in query_terms if term in tokenize(item[1])),
            reverse=True,
        )
        chosen_indices: list[int] = []
        for index, _ in ranked:
            chosen_indices.append(index)
            if len(chosen_indices) >= 2:
                break
        chosen = " ".join(sentences_list[index] for index in sorted(chosen_indices))
        if len(chosen) > limit:
            chosen = chosen[: limit - 1].rsplit(" ", 1)[0] + "…"
        return self._highlight(chosen, query_terms)

    def search(self, query: str, top_k: int = 4) -> list[dict]:
        if not self.chunks or self.bm25 is None:
            return []
        query_tokens = tokenize(query)
        if not query_tokens:
            return []
        bm25_scores = np.asarray(self.bm25.get_scores(query_tokens), dtype=np.float32)
        query_vector = self.embedder.embed([query])[0]
        cosine_scores = np.asarray(self.vectors @ query_vector, dtype=np.float32)
        combined = 0.5 * _minmax(bm25_scores) + 0.5 * _minmax(cosine_scores)

        lowered = (query or "").lower()
        comparison = any(term in lowered for term in ("compare", "internal", "our internal"))
        allowed_type = None
        if not comparison and any(term in lowered for term in ("paper", "abstract", "study", "literature")):
            allowed_type = "paper"
        elif not comparison and any(term in lowered for term in ("meeting", "notes", "discuss", "decision", "action item")):
            allowed_type = "meeting_note"

        ranked = np.argsort(combined)[::-1]
        per_doc: dict[str, tuple[int, float]] = {}
        for index in ranked:
            chunk = self.chunks[int(index)]
            if allowed_type and chunk["type"] != allowed_type:
                continue
            if chunk["doc_id"] not in per_doc:
                per_doc[chunk["doc_id"]] = (int(index), float(combined[index]))
            if len(per_doc) >= top_k:
                break

        query_terms = [term for term in query_tokens if len(term) >= 2]
        results: list[dict] = []
        for doc_id, (index, score) in per_doc.items():
            chunk = self.chunks[index]
            doc = self.documents[doc_id]
            results.append(
                {
                    "chunk_id": chunk["chunk_id"],
                    "doc_id": doc_id,
                    "type": chunk["type"],
                    "title": chunk["title"],
                    "date": chunk["date"],
                    "display_date": chunk["display_date"],
                    "journal": chunk["journal"],
                    "url": chunk["url"],
                    "live": chunk["live"],
                    "kind": chunk["kind"],
                    "text": chunk["text"],
                    "snippet_html": self._snippet(chunk["text"], query_terms),
                    "matched_terms": sorted(
                        {term for term in query_terms if term in tokenize(chunk["text"])},
                        key=len,
                        reverse=True,
                    )[:12],
                    "score": round(score, 4),
                    "bm25": round(float(_minmax(bm25_scores)[index]), 4),
                    "vector": round(float(_minmax(cosine_scores)[index]), 4),
                    "bm25_raw": round(float(bm25_scores[index]), 4),
                    "vector_raw": round(float(cosine_scores[index]), 4),
                }
            )
        return sorted(results, key=lambda item: item["score"], reverse=True)
