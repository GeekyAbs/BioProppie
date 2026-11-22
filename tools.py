"""Europe PMC live literature tool, gated by the server-side policy."""

from __future__ import annotations

import html
import re
from datetime import datetime, timezone

import httpx

from policy import PolicyManager

EUROPE_PMC_URL = "https://www.ebi.ac.uk/europepmc/webservices/rest/search"
WORD_RE = re.compile(r"[A-Za-z0-9]+")
STOP = {
    "a", "an", "and", "against", "are", "as", "at", "be", "by", "compare", "decision", "did",
    "for", "from", "in", "internal", "is", "it", "live", "literature", "meeting",
    "of", "on", "our", "paper", "pubmed", "the", "to", "we", "what", "with",
}


def _clean(value: str) -> str:
    value = re.sub(r"<h4>(.*?)</h4>", r"\n\n\1: ", value or "")
    value = re.sub(r"<[^>]+>", "", value)
    value = html.unescape(value)
    value = re.sub(r"\s+", " ", value)
    return value.strip()


def _display_date(value: str) -> str:
    try:
        return datetime.strptime(value[:10], "%Y-%m-%d").strftime("%-d %B %Y")
    except Exception:
        return value or "Date unavailable"


def build_live_query(question: str) -> str:
    lowered = (question or "").lower()
    tokens = [
        token.lower()
        for token in WORD_RE.findall(question or "")
        if token.lower() not in STOP and len(token) > 2
    ]
    if "cd3" in lowered or "bispecific" in lowered:
        if "affinity" in lowered or "cytokine" in lowered or "crs" in lowered:
            return '("bispecific" AND "CD3" AND ("affinity" OR "cytokine release syndrome" OR "T-cell engager")) AND HAS_ABSTRACT:Y'
        return '("bispecific" AND "CD3" AND ("T-cell engager" OR "BCMA" OR "affinity")) AND HAS_ABSTRACT:Y'
    if "adc" in lowered or "linker" in lowered:
        return '("antibody-drug conjugate" AND ("linker" OR "bystander" OR "topoisomerase")) AND HAS_ABSTRACT:Y'
    if "infection" in lowered or "ivig" in lowered:
        return '("BCMA" AND "bispecific" AND ("infection" OR "immunoglobulin")) AND HAS_ABSTRACT:Y'
    terms: list[str] = []
    for token in tokens[:6]:
        if token.upper() not in {term.upper() for term in terms}:
            terms.append(token)
    if not terms:
        terms = ["bispecific antibodies"]
    clauses = []
    for term in terms[:5]:
        clauses.append(f'"{term}"' if " " in term else term)
    return "(" + " AND ".join(clauses) + ") AND HAS_ABSTRACT:Y"


async def search_europepmc(question: str, policy: PolicyManager, page_size: int = 4) -> tuple[list[dict], dict]:
    policy.require_cloud_approved("europepmc_search", question)
    query = build_live_query(question)
    params = {
        "query": query,
        "format": "json",
        "resultType": "core",
        "pageSize": str(page_size),
    }
    async with httpx.AsyncClient(timeout=20.0, follow_redirects=True) as client:
        response = await client.get(EUROPE_PMC_URL, params=params)
        response.raise_for_status()
        payload = response.json()

    documents: list[dict] = []
    for item in payload.get("resultList", {}).get("result", []):
        pmid = str(item.get("pmid") or item.get("id") or "")
        if not pmid or not item.get("abstractText"):
            continue
        journal = ((item.get("journalInfo") or {}).get("journal") or {}).get("title") or ""
        documents.append(
            {
                "id": f"PMID-{pmid}",
                "type": "paper",
                "title": _clean(item.get("title", "")),
                "date": (item.get("firstPublicationDate") or "")[:10],
                "display_date": _display_date(item.get("firstPublicationDate", "")),
                "journal": journal,
                "authors": item.get("authorString", ""),
                "url": f"https://europepmc.org/article/MED/{pmid}",
                "pmid": pmid,
                "pmcid": item.get("pmcid"),
                "doi": item.get("doi"),
                "content": _clean(item.get("abstractText", "")),
                "live": True,
            }
        )
    meta = {
        "query": query,
        "hit_count": payload.get("hitCount", 0),
        "returned": len(documents),
        "host": "ebi.ac.uk",
        "fetched_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
    }
    return documents, meta
