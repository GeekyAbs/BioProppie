Private Biotech AI Workspace — Implementation Plan1. Architecture & Tech StackBackend: Python 3.11+ with FastAPI and Uvicorn (single-process, stateless API + static file server).Offline Hybrid Retrieval: rank-bm25 (exact keyword/date matching) + fastembed (BAAI/bge-small-en-v1.5 ONNX model, ~130 MB footprint, zero PyTorch dependency) with NumPy cosine similarity.Live Literature Tool: Europe PMC REST API ([https://www.ebi.ac.uk/europepmc/webservices/rest/search](https://www.ebi.ac.uk/europepmc/webservices/rest/search)) via httpx (no API key required, single-call JSON response).Cloud Synthesis LLM: OpenAI / Anthropic / Gemini API (invoked strictly when server policy is set to CLOUD_APPROVED).   Frontend: Single-page index.html using Tailwind CSS (CDN) and Alpine.js (CDN) for zero-build-step reactivity.Hosting: Railway, Render, or Hugging Face Spaces (pre-compute embeddings on startup from corpus.json).2. Repository StructurePlaintexteverest-biotech-workspace/
├── app.py                  # FastAPI server, routes, and startup index builder
├── policy.py               # Server-enforced LOCAL_ONLY vs. CLOUD_APPROVED guard + audit logger
├── retrieval.py            # Chunking, BM25 + FastEmbed hybrid search, and span highlighting
├── tools.py                # Europe PMC live search tool (gated by policy)
├── verifier.py             # Deterministic substring & fuzzy quote verification engine
├── data/
│   └── corpus.json         # 8 bundled bispecific/ADC papers + 4 simulated meeting notes
├── static/
│   └── index.html          # 3-tab workspace UI + policy header + live audit log panel
├── requirements.txt        # fastapi, uvicorn, httpx, rank-bm25, fastembed, numpy, openai
└── README.md               # Architecture notes & local/cloud trade-off explanation
3. Data Layer (data/corpus.json)Store a single structured JSON corpus split into two document types so offline search and citation links work uniformly across internal and external knowledge:JSON{
  "documents": [
    {
      "id": "PMC10984211",
      "type": "paper",
      "title": "Next-Generation CD3xBCMA Bispecific Antibodies in Relapsed Myeloma",
      "date": "2025-08-14",
      "journal": "Blood Advances",
      "url": "https://europepmc.org/article/PMC/PMC10984211",
      "content": "Full abstract and key quantitative results..."
    },
    {
      "id": "MEETING-2026-09-24",
      "type": "meeting_note",
      "title": "Biologics R&D Sync — Bispecific Affinity & CRS Mitigation",
      "date": "24 September 2026",
      "attendees": ["Dr. Rao", "Elena V.", "Marcus T."],
      "decisions": [
        "Cap CD3 arm affinity at 15 nM to reduce cytokine release syndrome risk.",
        "Benchmark internal VH-only bispecific format against PMC10984211."
      ],
      "action_items": [
        "Elena: Run IL-6 release assay across 3 donor PBMC lots by Oct 2.",
        "Marcus: Pull recent clinical ADC linker stability papers for next review."
      ],
      "open_questions": [
        "Does subcutaneous dosing alter peak IL-6 kinetics in cynomolgus models?"
      ],
      "content": "Full transcript summary of the 24 September 2026 meeting..."
    }
  ]
}
Corpus Scope: Include 8 real PubMed/Europe PMC abstracts (bispecific antibodies & ADCs) and 4 dated meeting notes (10 September, 24 September, 03 October, 14 October) containing explicit Decisions, Action Items, and Open Questions.   4. Core Backend Modules4.1 Server-Enforced Privacy Policy & Audit Log (policy.py)Maintain server-side session/app state for privacy_mode: "LOCAL_ONLY" (default) or "CLOUD_APPROVED".   Implement a decorator/guard require_cloud_approved(action_name) that raises HTTPException(403, "Blocked by server LOCAL_ONLY policy") if any external tool (search_pubmed) or cloud LLM client is called while in LOCAL_ONLY mode.   Append an immutable entry to an in-memory audit_log list on every request:Python{
  "timestamp": "2026-11-23T18:05:12Z",
  "mode": "LOCAL_ONLY",
  "query": "what did we discuss on 24 september meeting",
  "egress_status": "BLOCKED (0 outbound calls)",
  "sources_accessed": ["MEETING-2026-09-24"],
  "quotes_checked": 0
}
4.2 Offline Hybrid Retrieval (retrieval.py)Indexing (at startup): Split each document in corpus.json into sentence-level and paragraph-level chunks tagged with doc_id, type, title, and date. Build a BM25Okapi index and pre-compute fastembed vectors in memory (~1 second startup time).Scoring: Compute min-max normalized bm25_score and cosine_score for each chunk:$$\text{score} = 0.5 \cdot \text{norm\_bm25} + 0.5 \cdot \text{norm\_cosine}$$Span Highlighting: Extract overlapping query tokens and top-scoring sentences within matched chunks, wrapping matched terms/phrases in <mark> tags so the UI can highlight exact evidence in both chat cards and the Meeting Notes viewer.4.3 Live Europe PMC Tool (tools.py)Gated behind require_cloud_approved("europepmc_search").   Queries [https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=](https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=)({query}) AND HAS_ABSTRACT:Y&format=json&resultType=core&pageSize=4.Normalizes results into the same schema as corpus.json, appends them to the session's active literature list (so Tab 3 updates live), and passes them into the LLM context window.4.4 Deterministic Quote Verifier (verifier.py)Instruct the cloud LLM to wrap direct claims in quotes followed by [SOURCE_ID], e.g., "ORR was 30.2% across 53 evaluable patients" [PMC10984211].Parse all "..." [ID] pairs from the model's response and verify each quote against the raw text of ID:   Exact Match: Normalized whitespace/case substring exists in source.content $\rightarrow$ badge Exact Quote Verified (green).Close Fuzzy Match ($\ge 85\%$ token overlap): Minor punctuation/tense edit $\rightarrow$ badge Close Match (Review) (amber).No Match: Claim not found verbatim in source text $\rightarrow$ badge Paraphrased / Unverified (red).4.5 FastAPI Endpoints (app.py)GET / $\rightarrow$ Serves static/index.html.GET /api/state $\rightarrow$ Returns current privacy_mode, bundled + dynamically fetched documents, and audit_log.POST /api/mode $\rightarrow$ Toggles privacy_mode ("LOCAL_ONLY" | "CLOUD_APPROVED") and logs the policy change to audit_log.   POST /api/query $\rightarrow$ Executes the query pipeline:If LOCAL_ONLY: Runs offline hybrid retrieval (retrieval.py), skips all external calls, returns top 3 highlighted source chunks + similarity breakdowns + "Local-Only Policy Active: Extractive retrieval only" banner.   If CLOUD_APPROVED: Runs offline retrieval + live search_pubmed (tools.py), calls LLM to synthesize an answer with inline quotes, runs verifier.py on every quote, and returns the synthesized answer, verification badges, and retrieved sources.   5. Frontend UI Specification (static/index.html)Header: Server Policy Control BarLeft: App title (Propeller Private AI Workspace — Prototype) + corpus counter (8 Papers • 4 Meeting Notes).Right: High-contrast toggle switch between LOCAL-ONLY (amber/emerald lock icon, badge: External Egress: BLOCKED) and CLOUD-APPROVED (blue globe icon, badge: PubMed Live Tool + Synthesis: ON).   Main Workspace (Left 70%): 3 TabsTab 1 — Research & Memory Chat3 One-Click Demo Prompt Chips:"What did we discuss in the 24 September meeting?" (Tests offline BM25 + semantic retrieval across meeting notes)"Compare our internal CD3 affinity decision against live PubMed literature" (Tests hybrid internal + external Europe PMC tool use)"Quote the exact efficacy and safety numbers from our bundled bispecific paper" (Tests deterministic quote verification)   Response Area:In LOCAL_ONLY mode: Renders ranked Extractive Match Cards showing document type badge (Meeting Note vs. PubMed Paper), BM25 + Vector similarity scores, highlighted matching text, and a "Jump to Source" button.In CLOUD_APPROVED mode: Renders the synthesized answer with inline color-coded Exact Quote Verified / Paraphrased badges and expandable source cards below.   Tab 2 — Meeting Notes (Interactive Viewer)Sidebar list of the 4 dated meeting notes (10 Sep, 24 Sep, 03 Oct, 14 Oct).Main pane displays structured Decisions, Action Items, Open Questions, and full notes, automatically scrolling to and highlighting matching sentences when navigated from a chat citation.   Tab 3 — Literature CorpusSearchable list of all bundled papers plus a "Live Fetched" badge on papers pulled dynamically via Europe PMC during CLOUD_APPROVED queries.Right Sidebar (30%): Live Server Audit LogReal-time feed of every query and policy toggle showing timestamp, active mode, network egress status (BLOCKED vs. ALLOWED: ebi.ac.uk), document IDs read, and quote verification pass/fail counts.  