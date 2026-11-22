import json
import os
from pathlib import Path

os.environ.setdefault("EVST_EMBEDDING", "hashing")

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app import app
from policy import CLOUD_APPROVED, LOCAL_ONLY, PolicyManager
from retrieval import RetrievalIndex
from tools import build_live_query
from verifier import verify_answer, verify_quote

ROOT = Path(__file__).resolve().parents[1]
CORPUS = json.loads((ROOT / "data" / "corpus.json").read_text())["documents"]


def test_corpus_scope():
    assert len([doc for doc in CORPUS if doc["type"] == "paper"]) == 8
    assert len([doc for doc in CORPUS if doc["type"] == "meeting_note"]) == 4
    assert all(doc["content"] for doc in CORPUS)


def test_retrieval_finds_dated_meeting():
    index = RetrievalIndex(CORPUS)
    results = index.search("What did we discuss in the 24 September meeting?", top_k=4)
    assert results[0]["doc_id"] == "MEETING-2026-09-24"
    assert 0 <= results[0]["score"] <= 1


def test_add_documents_is_incremental():
    index = RetrievalIndex(CORPUS[:2])
    before = len(index.chunks)
    new_doc = {
        "id": "LIVE-TEST",
        "type": "paper",
        "title": "Live CD3 bispecific abstract",
        "date": "2026-11-24",
        "display_date": "24 November 2026",
        "content": "A bispecific CD3 T-cell engager with affinity optimisation and cytokine release syndrome mitigation.",
        "live": True,
    }
    index.add_documents([new_doc])
    assert len(index.chunks) > before
    assert "LIVE-TEST" in index.documents
    assert index.search("CD3 affinity", top_k=5)[0]["doc_id"] == "LIVE-TEST"


def test_policy_blocks_external_tool_in_local_mode():
    policy = PolicyManager()
    assert policy.mode == LOCAL_ONLY
    with pytest.raises(HTTPException) as exc:
        policy.require_cloud_approved("europepmc_search", "test")
    assert exc.value.status_code == 403
    policy.set_mode(CLOUD_APPROVED)
    policy.require_cloud_approved("europepmc_search", "test")


def test_quote_verifier_statuses():
    source = {"id": "X", "content": "ORR was 30.2% across 53 evaluable patients."}
    assert verify_quote("ORR was 30.2% across 53 evaluable patients.", source)["status"] == "exact"
    assert verify_quote("ORR was 30.2% in 53 evaluable patients.", source)["status"] == "close"
    assert verify_quote("ORR was 90% across 53 evaluable patients.", source)["status"] == "unverified"


def test_verifier_parses_annotated_answer():
    answer = 'The paper reported "20 patients (87%) attained a clinical response" [PMID-34627333].'
    result = verify_answer(answer, CORPUS)
    assert result["counts"]["total"] == 1
    assert result["counts"]["exact"] == 1


def test_live_query_domain_expansion():
    query = build_live_query("Compare our internal CD3 affinity decision against live PubMed literature")
    assert "bispecific" in query
    assert "CD3" in query
    assert "affinity" in query
    assert "HAS_ABSTRACT:Y" in query


def test_api_local_query_has_no_egress():
    with TestClient(app) as client:
        state = client.get("/api/state").json()
        assert state["privacy_mode"] == LOCAL_ONLY
        response = client.post("/api/query", json={"query": "What did we discuss in the 24 September meeting?"})
        assert response.status_code == 200
        data = response.json()
        assert data["privacy_mode"] == LOCAL_ONLY
        assert data["results"][0]["doc_id"] == "MEETING-2026-09-24"
        assert data["verification"]["counts"]["exact"] >= 4
        assert data["audit_entry"]["egress_hosts"] == []
        assert "BLOCKED" in data["audit_entry"]["egress_status"]
