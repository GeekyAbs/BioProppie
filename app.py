"""FastAPI server for the BioProppie private biotech workspace."""

from __future__ import annotations

import html
import json
import re
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from policy import CLOUD_APPROVED, LOCAL_ONLY, PolicyManager
from retrieval import RetrievalIndex
from synthesis import LLMClient, build_cloud_demo_answer, build_local_answer
from tools import search_europepmc
from verifier import QUOTE_PATTERN, normalize, verify_answer

BASE_DIR = Path(__file__).resolve().parent
CORPUS_PATH = BASE_DIR / "data" / "corpus.json"
STATIC_DIR = BASE_DIR / "static"

policy = PolicyManager()
index: RetrievalIndex | None = None
bundled_documents: list[dict] = []
live_documents: dict[str, dict] = {}
llm = LLMClient()


class ModeRequest(BaseModel):
    mode: str = Field(pattern="^(LOCAL_ONLY|CLOUD_APPROVED)$")


class QueryRequest(BaseModel):
    query: str = Field(min_length=2, max_length=600)


def all_documents() -> list[dict]:
    return bundled_documents + list(live_documents.values())


def _load_corpus() -> list[dict]:
    payload = json.loads(CORPUS_PATH.read_text())
    return payload["documents"]


@asynccontextmanager
async def lifespan(_: FastAPI):
    global index, bundled_documents
    bundled_documents = _load_corpus()
    index = RetrievalIndex(bundled_documents)
    policy.add_system_event(
        f"Workspace initialised with {len(bundled_documents)} bundled documents. "
        f"Local index: {len(index.chunks)} chunks via {index.backend_name}. Egress guard armed."
    )
    yield


app = FastAPI(title="BioProppie — Private Biotech Workspace", lifespan=lifespan)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/")
async def root() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/api/health")
@app.get("/health")
async def health() -> dict:
    return {"ok": True, "mode": policy.mode}


@app.get("/api/state")
async def state() -> dict:
    docs = all_documents()
    notes = [doc for doc in docs if doc.get("type") == "meeting_note"]
    papers = [doc for doc in docs if doc.get("type") == "paper"]
    return {
        "privacy_mode": policy.mode,
        "documents": docs,
        "audit_log": policy.snapshot(),
        "counts": {
            "papers": len(papers),
            "meeting_notes": len(notes),
            "live": len([doc for doc in papers if doc.get("live")]),
            "total": len(docs),
        },
        "retrieval": {
            "backend": index.backend_name if index else "initialising",
            "chunks": len(index.chunks) if index else 0,
        },
        "llm": {
            "configured": llm.configured,
            "provider": llm.provider or "deterministic-demo",
            "model": llm.model,
        },
    }


@app.post("/api/mode")
async def set_mode(request: ModeRequest) -> dict:
    entry = policy.set_mode(request.mode)
    return {"privacy_mode": policy.mode, "audit_entry": entry, "audit_log": policy.snapshot()}


def _badge_html(quote_info: dict) -> str:
    status = quote_info["status"]
    label = html.escape(quote_info["label"])
    source_title = html.escape(quote_info.get("source_title", ""), quote=True)
    reason = html.escape(quote_info.get("reason", ""), quote=True)
    return (
        f'<span class="claim claim-{status}" title="{source_title} — {reason}">'
        f'<span class="claim-text">“{html.escape(quote_info["quote"])}”</span> '
        f'<span class="claim-badge">{label}</span>'
        f'<button class="source-ref" data-source-id="{html.escape(quote_info["source_id"], quote=True)}">'
        f'[{html.escape(quote_info["source_id"])}]</button>'
        "</span>"
    )


def render_answer_html(answer: str, verification: dict) -> str:
    by_key = {
        (normalize(quote["quote"]), quote["source_id"].upper()): quote
        for quote in verification.get("quotes", [])
    }
    parts: list[str] = []
    cursor = 0
    for match in QUOTE_PATTERN.finditer(answer or ""):
        parts.append(html.escape(answer[cursor : match.start()]))
        key = (normalize(match.group("quote")), match.group("source").upper())
        quote_info = by_key.get(
            key,
            {
                "quote": match.group("quote"),
                "source_id": match.group("source"),
                "source_title": "Unknown source",
                "status": "unverified",
                "label": "Paraphrased / Unverified",
                "reason": "This citation could not be matched to a verified quote.",
            },
        )
        parts.append(_badge_html(quote_info))
        cursor = match.end()
    parts.append(html.escape(answer[cursor:]))

    annotated = "".join(parts)
    lines = annotated.splitlines()
    blocks: list[str] = []
    in_list = False
    for line in lines:
        stripped = line.strip()
        if not stripped:
            if in_list:
                blocks.append("</ul>")
                in_list = False
            continue
        if stripped.startswith("- "):
            if not in_list:
                blocks.append('<ul class="answer-list">')
                in_list = True
            blocks.append(f"<li>{stripped[2:]}</li>")
            continue
        if in_list:
            blocks.append("</ul>")
            in_list = False
        if stripped in {"Decisions", "Action items", "Open question", "Internal decision", "Internal position", "Live Europe PMC evidence"}:
            blocks.append(f'<h4 class="answer-label">{stripped}</h4>')
        elif stripped.startswith("Bundled literature —") or stripped.startswith("Internal position vs."):
            blocks.append(f'<h4 class="answer-label">{stripped}</h4>')
        else:
            blocks.append(f"<p>{stripped}</p>")
    if in_list:
        blocks.append("</ul>")
    return "".join(blocks)


@app.post("/api/query")
async def query(request: QueryRequest) -> dict:
    global index
    if index is None:
        raise HTTPException(status_code=503, detail="Index is still initialising")
    question = request.query.strip()
    results = index.search(question, top_k=4)
    docs = all_documents()
    mode = policy.mode
    live_meta = None
    live_error = None
    egress_hosts: list[str] = []
    live_fetched = 0
    llm_error = None
    answer_mode = "local_extractive"

    if mode == LOCAL_ONLY:
        answer, answer_mode = build_local_answer(question, results, docs)
    else:
        try:
            fetched, live_meta = await search_europepmc(question, policy)
            egress_hosts.append("ebi.ac.uk")
            live_fetched = len(fetched)
            for doc in fetched:
                live_documents[doc["id"]] = doc
            if fetched:
                index.add_documents(all_documents())
                ranked = index.search(question, top_k=20)
                local_results = [item for item in ranked if not item.get("live")][:4]
                live_results = [item for item in ranked if item.get("live")][:2]
                results = local_results + live_results
                if not results:
                    results = index.search(question, top_k=4)
                docs = all_documents()
        except HTTPException:
            raise
        except Exception as exc:
            live_error = f"{type(exc).__name__}: {exc}"
            if mode == CLOUD_APPROVED:
                egress_hosts.append("ebi.ac.uk")
                policy.add_system_event(f"Europe PMC fetch failed: {live_error}", event="tool_error")

        context_docs: list[dict] = []
        seen: set[str] = set()
        for result in results:
            doc = next((item for item in docs if item["id"] == result["doc_id"]), None)
            if doc and doc["id"] not in seen:
                context_docs.append(doc)
                seen.add(doc["id"])
        for doc in live_documents.values():
            if doc["id"] not in seen:
                context_docs.append(doc)
                seen.add(doc["id"])

        if llm.configured:
            synthesized, llm_error = await llm.synthesize(question, context_docs)
            egress_hosts.append("api.openai.com" if llm.provider == "openai" else "api.anthropic.com")
            if synthesized:
                answer = synthesized
                answer_mode = "llm"
            else:
                live_context = [doc for result in results if result.get("live") and (doc := next((item for item in docs if item["id"] == result["doc_id"]), None))]
                live_context += [doc for doc in live_documents.values() if doc["id"] not in {item["id"] for item in live_context}]
                answer, answer_mode = build_cloud_demo_answer(question, results, docs, live_context, live_meta)
        else:
            live_context = [doc for result in results if result.get("live") and (doc := next((item for item in docs if item["id"] == result["doc_id"]), None))]
            live_context += [doc for doc in live_documents.values() if doc["id"] not in {item["id"] for item in live_context}]
            answer, answer_mode = build_cloud_demo_answer(question, results, docs, live_context, live_meta)

    current_docs = all_documents()
    verification = verify_answer(answer, current_docs)
    sources = sorted({result["doc_id"] for result in results} | {quote["source_id"] for quote in verification["quotes"]})
    detail = (
        "LOCAL_ONLY: offline hybrid retrieval and deterministic extraction completed; zero outbound calls."
        if mode == LOCAL_ONLY
        else f"CLOUD_APPROVED: live Europe PMC returned {live_fetched} records; synthesis mode {answer_mode}."
    )
    audit = policy.record_query(
        query=question,
        egress_hosts=sorted(set(egress_hosts)),
        sources=sources,
        verification=verification["counts"],
        detail=detail,
        live_fetched=live_fetched,
    )
    return {
        "privacy_mode": mode,
        "query": question,
        "answer": answer,
        "answer_html": render_answer_html(answer, verification),
        "answer_mode": answer_mode,
        "verification": verification,
        "results": results,
        "live_meta": live_meta,
        "live_error": live_error,
        "llm_error": llm_error,
        "audit_entry": audit,
        "counts": {
            "papers": len([doc for doc in current_docs if doc.get("type") == "paper"]),
            "meeting_notes": len([doc for doc in current_docs if doc.get("type") == "meeting_note"]),
            "live": len(live_documents),
            "total": len(current_docs),
        },
    }


# Also serve assets at the root so the same HTML works on Cloudflare Pages,
# where the build output directory is `static/` and files live at `/styles.css`.
app.mount("/", StaticFiles(directory=STATIC_DIR), name="static-root")
