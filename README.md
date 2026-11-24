# BioProppie — Private Biotech AI Workspace

A working prototype of a private research workspace for biotech R&D. It combines **local hybrid retrieval** over bundled literature and simulated meeting notes, a **server-enforced privacy policy**, a **live Europe PMC tool**, and **deterministic quote verification**.

It is a demo, not a production system. The bundled papers are real; the meeting notes are fictional.

The interface is a single-page, zero-build workspace: chat, meeting-note viewer, literature corpus, and a live server audit feed.

### Preview

- [Chat with verified evidence](screenshots/preview-answer.png)
- [Cloud-approved synthesis + live Europe PMC](screenshots/preview-cloud.png)
- [Meeting note viewer](screenshots/preview-meetings.png)
- [Literature corpus with live-fetched papers](screenshots/preview-literature.png)
- [Mobile layout](screenshots/preview-mobile.png)

---

## What makes this demo different

Most RAG demos answer with a paragraph and a few links. This one shows its work:

1. **Policy is enforced on the server, not in the UI.** The default `LOCAL_ONLY` mode blocks external tools at the Python boundary before any outbound call can be made. Every query is written to an in-memory audit log with egress status, sources read, and quote verification counts.
2. **Retrieval is hybrid and cheap.** `rank-bm25` handles exact keywords, dates, and IDs. A deterministic local hashing vector handles semantic-ish similarity with no model download. `fastembed`/BGE is available as an opt-in upgrade on bigger machines.
3. **Every direct claim is checked.** Quotes in the answer are parsed and matched against the cited source with exact, fuzzy, or unverified badges. This works even with no LLM key because the local brief is extractive.
4. **Cloud mode degrades gracefully.** With no API key, a deterministic synthesizer assembles a grounded brief from retrieved evidence. With `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`, the same pipeline calls a cloud LLM and still verifies its quotes.
5. **The UI is designed, not scaffolded.** The visual language follows `design.md`: alpine palette, wide tracking, mono data labels, serif italic accents, springy motion, and a fixed sky/topography backdrop.

---

## Run it

Python 3.11+ is recommended.

```bash
uv venv --python 3.11 .venv
uv pip install --python .venv/bin/python -r python/requirements.txt

.venv/bin/uvicorn app:app --host 127.0.0.1 --port 8000
```

Open `http://127.0.0.1:8000`.

The default embedding backend is a 512-dimension deterministic hash. It starts instantly and uses almost no CPU. If you want the BGE ONNX model on a larger machine:

```bash
uv pip install --python .venv/bin/python -r python/requirements-vector.txt
EVST_EMBEDDING=fastembed .venv/bin/uvicorn app:app --host 127.0.0.1 --port 8000
```

The first fastembed start downloads ~130 MB and can take ~25 seconds to embed the corpus. The demo does not need it.

Run the tests with:

```bash
.venv/bin/python -m pytest -q
```

---

## Demo script

Start in **LOCAL_ONLY**. The header shows an amber/green lock and `External egress: blocked`.

1. **Meeting recall**
   Click `What did we discuss in the 24 September meeting?`
   - BM25 matches the date; embeddings match the topic.
   - The answer is an extractive brief with five `Exact Quote Verified` badges.
   - Source cards show BM25 and vector similarity bars.
   - The audit feed records `BLOCKED (0 outbound calls)`.
   - Click a citation or `Jump to source` to open the note in Tab 2 with matched terms highlighted.

2. **Internal vs. literature**
   Click `Compare our internal CD3 affinity decision against live PubMed literature`.
   - In LOCAL_ONLY, the answer compares the 15 nM CD3 affinity decision with bundled literature only.
   - Switch the header toggle to **CLOUD_APPROVED**.
   - Run the same prompt again. The server calls Europe PMC, appends live abstracts to Tab 3, and synthesizes a comparison. The audit feed changes to `ALLOWED: ebi.ac.uk`.

3. **Quote verification**
   Click `Quote the exact efficacy and safety numbers from our bundled bispecific paper`.
   - The answer quotes exact efficacy and safety figures.
   - Each quote is verified against the raw corpus source and badged inline.
   - The verification summary shows exact/review/unverified counts.

4. **Meeting notes and literature tabs**
   - Tab 2 shows all four dated notes with Decisions, Action Items, Open Questions, and full summaries.
   - Tab 3 shows eight bundled papers plus live-fetched Europe PMC records with a `Live fetched` badge.

---

## Architecture

```text
app.py            FastAPI routes, index bootstrap, answer rendering, audit wiring
policy.py         LOCAL_ONLY / CLOUD_APPROVED guard + append-only audit entries
retrieval.py      Chunking, BM25 + local hash vectors, span highlighting
tools.py          Europe PMC live search, gated by require_cloud_approved()
verifier.py       Exact/fuzzy quote verification against cited source text
synthesis.py      Deterministic local/cloud briefs + optional OpenAI/Anthropic calls
functions/        Cloudflare Pages Function port of the same API + precomputed data
scripts/          Regenerate functions/data.generated.js from the corpus
data/corpus.json  8 real Europe PMC abstracts + 4 simulated internal meeting notes
static/           index.html, app.js, styles.css — zero-build UI
tests/            Pytest suite for policy, retrieval, verification, and API
```

### Request flow

- `GET /api/state` → current mode, documents, counts, audit log, backend info.
- `POST /api/mode` → switches server policy and logs the change.
- `POST /api/query` → retrieval → optional gated Europe PMC call → synthesis/extraction → quote verification → audit entry.

### Privacy modes

| Mode | External calls | UI indicator |
|---|---|---|
| `LOCAL_ONLY` (default) | None. External tools raise `HTTPException(403)` before any network call. | Lock icon, `External egress: blocked`, `BLOCKED (0 outbound calls)` audit entries. |
| `CLOUD_APPROVED` | Europe PMC REST, plus optional cloud LLM if a key is configured. | Globe icon, `Europe PMC + synthesis: on`, `ALLOWED: ebi.ac.uk` audit entries. |

### Cloud synthesis fallback

The app checks for `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`. If neither is present, `CLOUD_APPROVED` uses a deterministic synthesizer that still performs live Europe PMC retrieval and still runs the quote verifier. This keeps every button in the demo functional without secrets.

Optional environment variables:

```bash
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-4o-mini
ANTHROPIC_API_KEY=...
ANTHROPIC_MODEL=claude-3-5-sonnet-latest
EVST_LLM_PROVIDER=auto        # auto, openai, or anthropic
EVST_EMBEDDING=hashing        # default; set to fastembed on a bigger machine
```

---

## Data provenance

The eight bundled papers are real Europe PMC abstracts relevant to bispecific antibodies, T-cell engagers, ADCs, CRS, and BCMA infection risk. The four meeting notes are fictional internal records created for the demo, dated 10 and 24 September and 3 and 14 October 2026. The `data/corpus.json` file stores abstracts and notes in one schema so search, citation links, and verification work uniformly.

---

## Deployment notes

### Cloudflare Pages (recommended demo link)

The repo is already prepared for Cloudflare Pages. There is no build step.

1. Push the repo to GitHub.
2. In Cloudflare, go to **Workers & Pages → Create → Pages → Connect to Git**.
3. Select the `BioProppie` repository.
4. Use these build settings:
   - Framework preset: **None**
   - Build command: `npm run build` (explicit no-op; prevents Python auto-detection)
   - Build output directory: `static`
   - Root directory: `/`
5. Add optional environment variables only if you want real synthesis:
   - `OPENAI_API_KEY` and optionally `OPENAI_MODEL`
   - or `ANTHROPIC_API_KEY` and optionally `ANTHROPIC_MODEL`
6. Deploy. Cloudflare detects `functions/` automatically.

If the log shows `Executing user deploy command: npx wrangler deploy`, the **Deploy command** field in Cloudflare is wrong. Change it to `npx wrangler pages deploy static`, or clear the custom deploy command so Pages handles deployment itself. A warning saying `you have run wrangler deploy on a Pages project` confirms the project type is correct and only this setting needs fixing.

The Pages Function API lives in `functions/`. It uses the same UI, policy guard, audit log, BM25 + hash-vector scoring, Europe PMC tool, and quote verifier as the Python app, but runs in the Worker runtime with no model and no CPU spike.

Preview locally before pushing:

```bash
npx wrangler pages dev static
```

Then open `http://localhost:8788`.

If you edit `data/corpus.json`, regenerate the Worker data before committing:

```bash
.venv/bin/python scripts/build-worker-data.py
```

The generated `functions/data.generated.js` is committed so Cloudflare needs no build step.

State note: the audit log and live-fetched papers live in Worker memory. Different isolates/regions may not share the same history, which is fine for a short demo. For strict global state you would need a Durable Object.

### Python host (optional)

The FastAPI version also works on Railway, Render, Hugging Face Spaces, or a small VPS. The default hashing backend starts in under a second and stays within cheap hardware. Skip `python/requirements-vector.txt` unless you deliberately want BGE embeddings.

Because both versions use in-memory audit/session state, both are intended for a single-process demo rather than multi-replica production.
