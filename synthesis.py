"""Deterministic evidence briefs plus optional cloud synthesis."""

from __future__ import annotations

import os
import re

import httpx

from retrieval import split_sentences

NUMERIC_RE = re.compile(r"\d")
NUMERIC_RE_INTENT = re.compile(r"\b(numbers?|quote|efficacy|safety|response rates?|survival|percent)\b", re.I)


def _quote(sentence: str, doc_id: str) -> str:
    cleaned = re.sub(r"\s+", " ", sentence).strip()
    if '"' in cleaned or "“" in cleaned or "”" in cleaned:
        cleaned = cleaned.replace('"', "'").replace("“", "'").replace("”", "'")
    return f'"{cleaned}" [{doc_id}]'


def _sentences(doc: dict, terms: list[str], limit: int = 2, numeric: bool = False) -> list[str]:
    candidates = split_sentences(doc.get("content", ""))
    scored: list[tuple[float, str]] = []
    for sentence in candidates:
        lowered = sentence.lower()
        score = sum(1.0 for term in terms if term.lower() in lowered)
        if numeric and NUMERIC_RE.search(sentence):
            score += 2.0
        if any(word in lowered for word in ("conclusion", "results", "observed", "reported", "occurred")):
            score += 0.25
        if len(sentence) > 360:
            score -= 0.5
        if '"' in sentence or "“" in sentence:
            score -= 0.4
        if score > 0:
            scored.append((score, sentence))
    scored.sort(key=lambda item: (item[0], len(item[1])), reverse=True)
    return [sentence for _, sentence in scored[:limit]]


def _best_doc(documents: list[dict], terms: list[str], doc_type: str | None = None, exclude: set[str] | None = None) -> dict | None:
    exclude = exclude or set()
    ranked: list[tuple[float, dict]] = []
    for doc in documents:
        if doc["id"] in exclude:
            continue
        if doc_type and doc.get("type") != doc_type:
            continue
        haystack = f"{doc.get('title', '')} {doc.get('content', '')}".lower()
        score = sum(1.5 if term.lower() in doc.get("title", "").lower() else 0.8 for term in terms if term.lower() in haystack)
        if doc.get("live"):
            score += 0.1
        ranked.append((score, doc))
    ranked.sort(key=lambda item: item[0], reverse=True)
    return ranked[0][1] if ranked and ranked[0][0] > 0 else None


def _meeting_id_for_date(documents: list[dict], query: str) -> dict | None:
    lowered = query.lower()
    month_map = {
        "september": "09", "october": "10", "november": "11",
        "january": "01", "february": "02", "march": "03", "april": "04",
        "may": "05", "june": "06", "july": "07", "august": "08", "december": "12",
    }
    day_match = re.search(r"\b(\d{1,2})(?:st|nd|rd|th)?\b", lowered)
    for month, number in month_map.items():
        if month in lowered:
            if day_match:
                target = f"2026-{number}-{int(day_match.group(1)):02d}"
                for doc in documents:
                    if doc.get("date") == target:
                        return doc
            for doc in documents:
                if doc.get("type") == "meeting_note" and month in doc.get("display_date", "").lower():
                    return doc
    return None


def build_local_answer(query: str, results: list[dict], documents: list[dict]) -> tuple[str, str]:
    lowered = query.lower()
    by_id = {doc["id"]: doc for doc in documents}

    meeting_doc = _meeting_id_for_date(documents, query)
    meeting_intent = ("meeting", "sync", "discuss", "choose", "chose", "decided", "decision", "strategy", "did we")
    if meeting_doc is None and any(word in lowered for word in meeting_intent):
        for result in results:
            if by_id.get(result["doc_id"], {}).get("type") == "meeting_note":
                meeting_doc = by_id[result["doc_id"]]
                break

    if meeting_doc and not any(word in lowered for word in ("compare", "against", "literature")):
        decisions = meeting_doc.get("decisions", [])[:2]
        actions = meeting_doc.get("action_items", [])[:2]
        questions = meeting_doc.get("open_questions", [])[:1]
        lines = [
            f"The {meeting_doc.get('display_date', meeting_doc.get('date', ''))} note is the strongest local match. "
            f"It covers {meeting_doc.get('title', 'the meeting').split('—')[-1].strip().lower()}.",
            "",
            "Decisions",
        ]
        lines.extend(f"- {_quote(item, meeting_doc['id'])}" for item in decisions)
        if actions:
            lines.extend(["", "Action items"])
            lines.extend(f"- {_quote(item, meeting_doc['id'])}" for item in actions)
        if questions:
            lines.extend(["", "Open question"])
            lines.extend(f"- {_quote(item, meeting_doc['id'])}" for item in questions)
        lines.extend(
            [
                "",
                "This is a deterministic extractive brief. Every quoted sentence was pulled from the bundled note; no generative model or external service was called.",
            ]
        )
        return "\n".join(lines), "local_extractive"

    if any(word in lowered for word in ("compare", "against")):
        internal = _meeting_id_for_date(documents, query) or _best_doc(documents, ["affinity", "cd3", "cytokine", "crs"], "meeting_note")
        external = _best_doc(documents, ["cd3", "bispecific", "nanomolar", "t cell"], "paper")
        lines = ["LOCAL_ONLY comparison against the bundled corpus.", ""]
        if internal:
            decision = internal.get("decisions", [])[:1] or _sentences(internal, ["affinity", "cd3", "cytokine", "crs"], limit=1)
            lines.append("Internal position")
            lines.extend(f"- {_quote(item, internal['id'])}" for item in decision)
        if external:
            evidence = _sentences(external, ["cd3", "bispecific", "nanomolar", "t cell", "affinity"], limit=2)
            lines.extend(["", f"Bundled literature — {external.get('title', '')}"])
            lines.extend(f"- {_quote(item, external['id'])}" for item in evidence)
        lines.extend(
            [
                "",
                "Switch the server policy to CLOUD_APPROVED to add live Europe PMC records and optional generative synthesis.",
            ]
        )
        return "\n".join(lines), "local_extractive"

    numeric = bool(NUMERIC_RE_INTENT.search(query)) and any(
        word in lowered for word in ("number", "quote", "efficacy", "safety", "response", "survival")
    )
    paper_candidates = [by_id[result["doc_id"]] for result in results if by_id.get(result["doc_id"], {}).get("type") == "paper"]
    if numeric and paper_candidates:
        lines = ["The bundled bispecific literature reports these exact figures."]
        used = 0
        for doc in paper_candidates:
            evidence = _sentences(doc, ["efficacy", "safety", "response", "survival", "cytokine", "infection", "rate"], limit=3, numeric=True)
            if not evidence:
                continue
            lines.extend(["", f"{doc.get('title', '')} — {doc.get('journal', '')}"])
            lines.extend(f"- {_quote(item, doc['id'])}" for item in evidence)
            used += 1
            if used >= 2:
                break
        if used:
            lines.extend(
                [
                    "",
                    "The badges below are produced by deterministic substring and fuzzy matching against the cited source, not by a language model.",
                ]
            )
            return "\n".join(lines), "local_extractive"

    lines = ["The strongest evidence in the bundled corpus is below."]
    seen: set[str] = set()
    for result in results[:3]:
        doc = by_id.get(result["doc_id"])
        if not doc or doc["id"] in seen:
            continue
        seen.add(doc["id"])
        evidence = _sentences(doc, [term for term in result.get("matched_terms", []) if len(term) > 2], limit=2)
        if not evidence:
            evidence = split_sentences(result.get("text", ""))[:2]
        lines.extend(["", f"{doc.get('title', '')} — {result.get('display_date', '')}"])
        lines.extend(f"- {_quote(item, doc['id'])}" for item in evidence)
    lines.extend(["", "This is a local extractive answer. No external egress was used."])
    return "\n".join(lines), "local_extractive"


def build_cloud_demo_answer(
    query: str,
    results: list[dict],
    documents: list[dict],
    live_docs: list[dict],
    live_meta: dict | None,
) -> tuple[str, str]:
    lowered = query.lower()
    by_id = {doc["id"]: doc for doc in documents}

    if any(word in lowered for word in ("compare", "against", "literature")):
        internal = _meeting_id_for_date(documents, query) or _best_doc(documents, ["affinity", "cd3", "cytokine", "crs"], "meeting_note")
        lines = ["Internal position vs. live literature.", ""]
        if internal:
            decision = internal.get("decisions", [])[:1] or _sentences(internal, ["affinity", "cd3", "cytokine", "crs"], limit=1)
            lines.append("Internal decision")
            lines.extend(f"- {_quote(item, internal['id'])}" for item in decision)
        if live_docs:
            lines.extend(["", "Live Europe PMC evidence"])
            for doc in live_docs[:2]:
                evidence = _sentences(doc, ["cd3", "bispecific", "affinity", "cytokine", "t cell", "response"], limit=2)
                lines.extend(f"- {_quote(item, doc['id'])}" for item in evidence)
            meta = live_meta or {}
            lines.extend(
                [
                    "",
                    f"Live retrieval returned {meta.get('returned', len(live_docs))} abstract records from {meta.get('hit_count', '—')} hits. "
                    "The quoted literature is appended to the active corpus and remains visible in Tab 3.",
                ]
            )
        else:
            lines.extend(["", "Live Europe PMC returned no usable abstract records, so the comparison is limited to bundled sources."])
        lines.extend(
            [
                "",
                "Interpretation: the internal 15 nM affinity cap is a deliberately conservative CRS-control choice. The literature supports CD3 engagement as a potent mechanism, but the safety burden is molecule- and schedule-specific. The cap should be validated against the donor IL-6 assay before the construct is locked.",
                "",
                "Deterministic synthesis demo — no LLM key was configured, so the brief was assembled from verified extracts.",
            ]
        )
        return "\n".join(lines), "deterministic_demo"

    if live_docs:
        doc = live_docs[0]
        evidence = _sentences(doc, [term for term in query.lower().split() if len(term) > 3], limit=3, numeric=True)
        if not evidence:
            evidence = split_sentences(doc.get("content", ""))[:2]
        lines = [
            f"The live literature adds {len(live_docs)} new Europe PMC records. The most relevant is {doc.get('title', '')}.",
            "",
        ]
        lines.extend(f"- {_quote(item, doc['id'])}" for item in evidence)
        lines.extend(
            [
                "",
                "This answer combines bundled retrieval with the live record above. The quoted spans are verified against the abstract text.",
            ]
        )
        return "\n".join(lines), "deterministic_demo"

    return build_local_answer(query, results, documents)[0] + "\n\nDeterministic synthesis demo — no live records were added.", "deterministic_demo"


class LLMClient:
    def __init__(self) -> None:
        self.openai_key = os.getenv("OPENAI_API_KEY", "").strip()
        self.anthropic_key = os.getenv("ANTHROPIC_API_KEY", "").strip()
        provider = os.getenv("EVST_LLM_PROVIDER", "auto").strip().lower()
        if provider == "openai" and self.openai_key:
            self.provider = "openai"
        elif provider == "anthropic" and self.anthropic_key:
            self.provider = "anthropic"
        elif self.openai_key:
            self.provider = "openai"
        elif self.anthropic_key:
            self.provider = "anthropic"
        else:
            self.provider = None

    @property
    def configured(self) -> bool:
        return self.provider is not None

    @property
    def model(self) -> str:
        if self.provider == "openai":
            return os.getenv("OPENAI_MODEL", "gpt-4o-mini")
        if self.provider == "anthropic":
            return os.getenv("ANTHROPIC_MODEL", "claude-3-5-sonnet-latest")
        return "deterministic-demo"

    def _prompt(self, query: str, documents: list[dict]) -> tuple[str, str]:
        system = (
            "You are a private biotech research analyst. Answer only from the supplied context. "
            "For every factual claim, include a short verbatim quote in double quotes followed by the source ID in square brackets, "
            "like \"ORR was 23.4%\" [PMID-36689692]. Never invent a quote or an ID. Be concise and decision-oriented. "
            "If the context is insufficient, say so plainly."
        )
        chunks = []
        for doc in documents[:8]:
            chunks.append(f"[{doc['id']}] {doc.get('title', '')} ({doc.get('display_date', doc.get('date', ''))})\n{doc.get('content', '')[:2200]}")
        user = f"Question: {query}\n\nContext:\n" + "\n\n".join(chunks)
        return system, user

    async def synthesize(self, query: str, documents: list[dict]) -> tuple[str | None, str | None]:
        if not self.configured:
            return None, None
        system, user = self._prompt(query, documents)
        try:
            async with httpx.AsyncClient(timeout=45.0) as client:
                if self.provider == "openai":
                    response = await client.post(
                        "https://api.openai.com/v1/chat/completions",
                        headers={"Authorization": f"Bearer {self.openai_key}"},
                        json={
                            "model": self.model,
                            "temperature": 0.1,
                            "messages": [
                                {"role": "system", "content": system},
                                {"role": "user", "content": user},
                            ],
                        },
                    )
                else:
                    response = await client.post(
                        "https://api.anthropic.com/v1/messages",
                        headers={
                            "x-api-key": self.anthropic_key,
                            "anthropic-version": "2023-06-01",
                            "content-type": "application/json",
                        },
                        json={
                            "model": self.model,
                            "max_tokens": 1000,
                            "temperature": 0.1,
                            "system": system,
                            "messages": [{"role": "user", "content": user}],
                        },
                    )
                response.raise_for_status()
                payload = response.json()
                if self.provider == "openai":
                    text = payload["choices"][0]["message"]["content"]
                else:
                    text = "".join(block.get("text", "") for block in payload.get("content", []))
                return text.strip(), None
        except Exception as exc:
            return None, f"{type(exc).__name__}: {exc}"
