const state = {
  mode: "LOCAL_ONLY",
  docs: [],
  audit: [],
  counts: { papers: 8, meeting_notes: 4, live: 0, total: 12 },
  retrieval: { backend: "initialising", chunks: 0 },
  llm: { configured: false, provider: "deterministic-demo", model: "" },
  messages: [],
  busy: false,
  tab: "chat",
  selectedMeeting: null,
  highlightTerms: [],
  lastTerms: [],
  litFilter: "",
  litHighlight: null,
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function highlightText(value, terms = []) {
  let output = escapeHtml(value);
  const usable = Array.from(new Set((terms || []).map((term) => String(term).toLowerCase())))
    .filter((term) => term.length > 2 && /^[a-z0-9.-]+$/.test(term))
    .sort((a, b) => b.length - a.length)
    .slice(0, 14);
  if (!usable.length) return output;
  const pattern = new RegExp(`(?<![\\w-])(${usable.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?![\\w-])`, "gi");
  return output.replace(pattern, "<mark>$1</mark>");
}

function timeOnly(iso) {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso.slice(11, 19) || iso;
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function nowTime() {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch (_) {
    payload = null;
  }
  if (!response.ok) {
    throw new Error(payload?.detail || `Request failed (${response.status})`);
  }
  return payload;
}

function toast(message, duration = 2600) {
  const element = $("#toast");
  element.textContent = message;
  element.classList.add("show");
  window.clearTimeout(toast._timer);
  toast._timer = window.setTimeout(() => element.classList.remove("show"), duration);
}

/* ---------- state + chrome ---------- */
function applyState(payload) {
  if (!payload) return;
  state.mode = payload.privacy_mode || state.mode;
  state.docs = payload.documents || [];
  state.audit = payload.audit_log || state.audit;
  state.counts = payload.counts || state.counts;
  state.retrieval = payload.retrieval || state.retrieval;
  state.llm = payload.llm || state.llm;
  if (!state.selectedMeeting) {
    const notes = meetingNotes();
    state.selectedMeeting = notes.at(-1)?.id || notes[0]?.id || null;
  }
  document.body.dataset.mode = state.mode;
  renderChrome();
  renderMeetings();
  renderLiterature();
  renderAudit();
}

function renderChrome() {
  $("#top-papers").textContent = String(state.counts.papers ?? 0).padStart(2, "0");
  $("#top-notes").textContent = String(state.counts.meeting_notes ?? 0).padStart(2, "0");
  $("#hero-bundled").textContent = String((state.counts.total || 12) - (state.counts.live || 0));
  $("#top-chunks").textContent = state.retrieval.chunks || "—";
  $("#tab-notes-count").textContent = state.counts.meeting_notes ?? 0;
  $("#tab-papers-count").textContent = state.counts.papers ?? 0;
  $("#workspace-backend").textContent = `${state.retrieval.backend} · ${state.retrieval.chunks} chunks`;
  $("#lit-bundled-count").textContent = Math.max(0, (state.counts.papers || 0) - (state.counts.live || 0));
  $("#lit-live-count").textContent = state.counts.live || 0;
  $("#tab-logs-count").textContent = state.audit.length;

  $$(".mode-btn").forEach((button) => {
    button.classList.toggle("active", button.dataset.mode === state.mode);
  });

  const local = state.mode === "LOCAL_ONLY";
  $("#egress-text").textContent = local ? "External egress: blocked" : "Europe PMC + synthesis: on";
  $("#workspace-policy").textContent = local ? "Local index" : "Cloud approved";
  $("#chat-policy-pill").innerHTML = local
    ? '<svg><use href="#i-shield"/></svg><span>Extractive only</span>'
    : '<svg><use href="#i-globe"/></svg><span>Synthesis + live</span>';
  $("#composer-policy").innerHTML = local
    ? '<svg><use href="#i-lock"/></svg>Local-only: no query leaves this server'
    : '<svg><use href="#i-globe"/></svg>Cloud approved: Europe PMC + synthesis enabled';
  $("#guard-title").textContent = local ? "Egress off" : "Egress on";
  const queryCount = state.audit.filter((entry) => entry.event === "query").length;
  $("#guard-copy").textContent = local
    ? `${queryCount} ${queryCount === 1 ? "query" : "queries"} · 0 outbound calls.`
    : "Europe PMC and synthesis enabled. Calls appear in the log.";
  $("#guard-card").classList.toggle("cloud", !local);
  $("#boundary-local").textContent = `${state.counts.total || 12} docs`;
  $("#boundary-mode").textContent = local ? "Blocked" : "Open";
  $("#boundary-egress").textContent = local ? "0 calls" : "audited egress";
  $("#boundary-web").textContent = local ? "ebi.ac.uk · off" : "ebi.ac.uk · on";
  $("#send-btn").disabled = state.busy;
}

function meetingNotes() {
  return state.docs
    .filter((doc) => doc.type === "meeting_note")
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

function papers() {
  return state.docs
    .filter((doc) => doc.type === "paper")
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

/* ---------- chat ---------- */
function welcomeCard() {
  const local = state.mode === "LOCAL_ONLY";
  return `
    <div class="msg assistant">
      <div class="msg-avatar"><svg><use href="#i-spark"/></svg></div>
      <div class="msg-body">
        <div class="msg-head"><b>BioProppie</b><span class="msg-mode">${local ? "local only" : "cloud approved"}</span><span>index ready</span></div>
        <div class="assistant-card">
          <div class="answer-content">
            <p>The index holds ${(state.counts.papers || 8) - (state.counts.live || 0)} papers and ${state.counts.meeting_notes || 4} meeting notes.</p>
            <p>${local ? "LOCAL_ONLY returns extracts from those documents. Direct quotes are checked against the cited source. No query is sent out." : "CLOUD_APPROVED adds Europe PMC records and a grounded synthesis. Outbound calls are logged on the right."}</p>
          </div>
          <div class="verify-bar">
            <span class="verify-chip exact"><b>${local ? "0" : "on"}</b> outbound</span>
            <span class="verify-chip"><b>${state.retrieval.chunks || 235}</b> chunks</span>
            <span class="verify-chip"><b>${state.counts.total || 12}</b> sources</span>
            <span class="verify-chip egress">${local ? "egress blocked" : "egress allowed"}</span>
          </div>
        </div>
      </div>
    </div>`;
}

function sourceCard(result) {
  const isMeeting = result.type === "meeting_note";
  const isLive = result.live;
  const kindClass = isLive ? "live" : isMeeting ? "meeting" : "";
  const kindLabel = isLive ? "Live fetch" : isMeeting ? "Meeting note" : "Europe PMC paper";
  const bm25 = Math.round((result.bm25 || 0) * 100);
  const vector = Math.round((result.vector || 0) * 100);
  const terms = JSON.stringify(result.matched_terms || []).replaceAll("'", "&#39;");
  return `
    <article class="source-card">
      <div class="source-top">
        <span class="source-kind ${kindClass}">${kindLabel}</span>
        <span class="source-score">${isLive ? "live · " : ""}${Number(result.score || 0).toFixed(2)}</span>
      </div>
      <h3 class="source-title">${escapeHtml(result.title)}</h3>
      <div class="source-snippet">${result.snippet_html || escapeHtml(result.text || "")}</div>
      <div class="source-bars">
        <div class="bar-row"><span>BM25</span><div class="bar-track"><div class="bar-fill" style="width:${bm25}%"></div></div><span>${bm25}%</span></div>
        <div class="bar-row"><span>Vector</span><div class="bar-track"><div class="bar-fill vector" style="width:${vector}%"></div></div><span>${vector}%</span></div>
      </div>
      <div class="source-actions">
        <span class="score-pill">${escapeHtml(result.display_date || result.date || "")}</span>
        <button class="jump-btn" type="button" data-jump="${escapeHtml(result.doc_id)}" data-terms="${escapeHtml(terms)}">Jump to source ↗</button>
      </div>
    </article>`;
}

function assistantMessage(message) {
  const data = message.data || {};
  const verification = data.verification || { counts: { exact: 0, close: 0, unverified: 0, total: 0 }, quotes: [] };
  const counts = verification.counts || {};
  const local = (data.privacy_mode || state.mode) === "LOCAL_ONLY";
  const modeLabel = data.answer_mode === "llm"
    ? "LLM synthesis"
    : data.answer_mode === "deterministic_demo"
      ? "Deterministic demo synthesis"
      : "Local extractive brief";
  const egress = data.audit_entry?.egress_status || (local ? "BLOCKED (0 outbound calls)" : "ALLOWED");
  const results = data.results || [];
  const liveMeta = data.live_meta;
  const warnings = [data.live_error && `Live tool: ${data.live_error}`, data.llm_error && `LLM fallback: ${data.llm_error}`].filter(Boolean);
  return `
    <div class="msg assistant">
      <div class="msg-avatar"><svg><use href="#i-spark"/></svg></div>
      <div class="msg-body">
        <div class="msg-head"><b>BioProppie</b><span class="msg-mode">${modeLabel}</span><span>${escapeHtml(message.time || nowTime())}</span></div>
        <div class="assistant-card">
          <div class="answer-content">${data.answer_html || `<p>${escapeHtml(data.answer || "")}</p>`}</div>
          <div class="verify-bar">
            <span class="verify-chip exact"><b>${counts.exact || 0}</b> exact</span>
            ${counts.close ? `<span class="verify-chip close"><b>${counts.close}</b> review</span>` : ""}
            ${counts.unverified ? `<span class="verify-chip unverified"><b>${counts.unverified}</b> unverified</span>` : ""}
            <span class="verify-chip egress">${escapeHtml(egress)}</span>
          </div>
          ${liveMeta ? `<div class="live-strip"><svg><use href="#i-network"/></svg><span>Europe PMC · ${liveMeta.returned} abstracts from ${liveMeta.hit_count} hits · query: ${escapeHtml(liveMeta.query)}</span></div>` : ""}
          ${warnings.map((warning) => `<div class="live-strip"><svg><use href="#i-network"/></svg><span>${escapeHtml(warning)}</span></div>`).join("")}
          ${results.length ? `<div class="sources-title"><span><b>${results.length}</b> retrieved sources</span><span>${local ? "local index" : "hybrid + live"}</span></div><div class="source-grid">${results.map(sourceCard).join("")}</div>` : ""}
          <div class="answer-foot">
            <span>${counts.total || 0} quote${counts.total === 1 ? "" : "s"} checked against source text</span>
            <span>${local ? "0 outbound calls" : "egress audited"}</span>
          </div>
        </div>
      </div>
    </div>`;
}

function userMessage(message) {
  return `
    <div class="msg user">
      <div>
        <div class="user-bubble">${escapeHtml(message.text)}</div>
        <div class="user-meta">you · ${escapeHtml(message.time || nowTime())}</div>
      </div>
    </div>`;
}

function typingMessage() {
  return `
    <div class="msg assistant">
      <div class="msg-avatar"><svg><use href="#i-spark"/></svg></div>
      <div class="msg-body">
        <div class="msg-head"><b>BioProppie</b><span class="msg-mode">${state.mode === "LOCAL_ONLY" ? "local only" : "cloud approved"}</span><span>working</span></div>
        <div class="assistant-card">
          <div class="typing"><i></i><i></i><i></i></div>
          <div class="answer-foot"><span>${state.mode === "LOCAL_ONLY" ? "Searching local chunks · no egress" : "Retrieving evidence · checking policy"}</span><span>running</span></div>
        </div>
      </div>
    </div>`;
}

function renderChat() {
  const thread = $("#chat-thread");
  const messages = state.messages.length ? state.messages : [];
  thread.innerHTML = [
    welcomeCard(),
    ...messages.map((message) => message.role === "user" ? userMessage(message) : assistantMessage(message)),
    state.busy ? typingMessage() : "",
  ].join("");
  scrollThread();
}

function scrollThread() {
  const thread = $("#chat-thread");
  if (!thread) return;
  requestAnimationFrame(() => {
    thread.scrollTop = thread.scrollHeight;
  });
}

async function submitQuery(rawQuery) {
  const query = String(rawQuery || "").trim();
  if (!query || state.busy) return;
  state.messages.push({ role: "user", text: query, time: nowTime() });
  state.busy = true;
  $("#query-input").value = "";
  autoResize();
  renderChrome();
  renderChat();
  try {
    const data = await api("/api/query", {
      method: "POST",
      body: JSON.stringify({ query }),
    });
    state.lastTerms = Array.from(new Set((data.results || []).flatMap((result) => result.matched_terms || []))).slice(0, 18);
    state.messages.push({ role: "assistant", data, time: nowTime() });
    state.audit = [...state.audit, data.audit_entry].filter(Boolean);
    state.counts = data.counts || state.counts;
    try {
      await refreshState(false);
    } catch (_) {
      renderChrome();
      renderAudit();
    }
  } catch (error) {
    state.messages.push({
      role: "assistant",
      data: {
        privacy_mode: state.mode,
        answer_mode: "local_extractive",
        answer_html: `<p><strong>The request failed.</strong> ${escapeHtml(error.message)}</p>`,
        verification: { counts: { exact: 0, close: 0, unverified: 0, total: 0 }, quotes: [] },
        results: [],
        audit_entry: { egress_status: "BLOCKED (no completed request)" },
      },
      time: nowTime(),
    });
    toast(error.message);
  } finally {
    state.busy = false;
    renderChrome();
    renderChat();
  }
}

/* ---------- meetings ---------- */
function renderMeetings() {
  const notes = meetingNotes();
  const list = $("#meeting-list");
  list.innerHTML = `
    <div class="meeting-list-head">${notes.length} dated notes / internal</div>
    ${notes.map((note, index) => `
      <button class="meeting-item ${note.id === state.selectedMeeting ? "active" : ""}" type="button" data-meeting="${escapeHtml(note.id)}">
        <span class="meeting-date">${String(index + 1).padStart(2, "0")} · ${escapeHtml(note.display_date || note.date)}</span>
        <span class="meeting-item-title">${escapeHtml(note.title)}</span>
        <span class="meeting-item-meta">${(note.decisions || []).length} decisions · ${(note.action_items || []).length} actions</span>
      </button>`).join("")}`;
  renderMeetingMain();
}

function renderMeetingMain() {
  const main = $("#meeting-main");
  const note = meetingNotes().find((item) => item.id === state.selectedMeeting);
  if (!note) {
    main.innerHTML = `<div class="empty-state"><div class="serif">Choose a note.</div><p>The dated record is the internal memory layer.</p></div>`;
    return;
  }
  const terms = state.highlightTerms;
  const section = (title, items, className, count) => `
    <div class="note-section ${className}">
      <h3>${title} <span class="count">${count}</span></h3>
      <ul>${(items || []).map((item) => `<li>${highlightText(item, terms)}</li>`).join("") || "<li>None recorded.</li>"}</ul>
    </div>`;
  main.innerHTML = `
    <div class="meeting-main-head">
      <div class="meeting-main-kicker">${escapeHtml(note.display_date || note.date)} · internal meeting note</div>
      <h2>${highlightText(note.title, terms)}</h2>
      <div class="meeting-attendees"><b>Present:</b> ${escapeHtml((note.attendees || []).join(" · "))}</div>
    </div>
    <div class="note-sections">
      ${section("Decisions", note.decisions, "decisions", (note.decisions || []).length)}
      ${section("Action items", note.action_items, "actions", (note.action_items || []).length)}
      ${section("Open questions", note.open_questions, "questions", (note.open_questions || []).length)}
    </div>
    <div class="note-full">
      <h3>Full note / transcript summary</h3>
      <div class="note-body">${highlightText(note.content || "", terms)}</div>
    </div>`;
  if (terms.length) {
    requestAnimationFrame(() => {
      const mark = main.querySelector("mark");
      if (mark) mark.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  }
}

/* ---------- literature ---------- */
function renderLiterature() {
  const grid = $("#lit-grid");
  const needle = state.litFilter.trim().toLowerCase();
  const items = papers().filter((doc) => {
    if (!needle) return true;
    return [doc.title, doc.journal, doc.id, doc.pmid, doc.doi, doc.authors].join(" ").toLowerCase().includes(needle);
  });
  grid.innerHTML = items.map((doc) => `
    <article class="paper-card ${doc.id === state.litHighlight ? "highlight" : ""}" data-paper="${escapeHtml(doc.id)}">
      <div class="paper-top">
        <span class="paper-date">${escapeHtml(doc.display_date || doc.date)}</span>
        ${doc.live ? '<span class="live-badge"><span class="dot"></span>Live fetched</span>' : '<span class="paper-id">Bundled</span>'}
      </div>
      <h3 class="paper-title">${highlightText(doc.title, state.highlightTerms)}</h3>
      <div class="paper-journal">${escapeHtml(doc.journal || "Europe PMC")}</div>
      <p class="paper-abstract">${escapeHtml(doc.content || "")}</p>
      <div class="paper-foot">
        <span class="paper-id">${escapeHtml(doc.id)}</span>
        <a class="paper-link" href="${escapeHtml(doc.url || "#")}" target="_blank" rel="noopener">Open paper ↗</a>
      </div>
    </article>`).join("");
  if (!items.length) {
    grid.innerHTML = `<div class="empty-state"><div class="serif">No papers found.</div><p>Try a broader filter, or enable live Europe PMC records.</p></div>`;
  }
  if (state.litHighlight) {
    requestAnimationFrame(() => {
      const card = grid.querySelector(`[data-paper="${CSS.escape(state.litHighlight)}"]`);
      if (card) card.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  }
}

/* ---------- audit ---------- */
function renderAudit() {
  const feed = $("#audit-feed");
  const events = [...state.audit].reverse();
  $("#audit-count").textContent = `${state.audit.length} event${state.audit.length === 1 ? "" : "s"}`;
  if (!events.length) {
    feed.innerHTML = `<div class="audit-entry"><div class="audit-entry-top"><span class="audit-time">standby</span><span class="audit-event">boot</span></div><div class="audit-query">Audit stream initialising.</div></div>`;
    return;
  }
  feed.innerHTML = events.map((entry) => {
    const allowed = String(entry.egress_status || "").startsWith("ALLOWED");
    const verification = entry.verification || {};
    const stats = [];
    if (verification.total) {
      stats.push(`<span class="audit-stat"><b>${verification.exact || 0}</b> exact</span>`);
      if (verification.close) stats.push(`<span class="audit-stat"><b>${verification.close}</b> review</span>`);
      if (verification.unverified) stats.push(`<span class="audit-stat"><b>${verification.unverified}</b> unverified</span>`);
    }
    if (entry.live_fetched) stats.push(`<span class="audit-stat"><b>${entry.live_fetched}</b> live fetched</span>`);
    if ((entry.sources_accessed || []).length) stats.push(`<span class="audit-stat"><b>${entry.sources_accessed.length}</b> sources</span>`);
    return `
      <div class="audit-entry">
        <div class="audit-entry-top">
          <span class="audit-time">${escapeHtml(timeOnly(entry.timestamp))}</span>
          <span class="audit-event ${escapeHtml(entry.event)}">${escapeHtml(entry.event || "event")}</span>
        </div>
        <span class="egress ${allowed ? "allowed" : "blocked"}">${escapeHtml(entry.egress_status || "BLOCKED")}</span>
        ${entry.query ? `<div class="audit-query">${escapeHtml(entry.query)}</div>` : ""}
        ${entry.detail ? `<div class="audit-detail">${escapeHtml(entry.detail)}</div>` : ""}
        ${stats.length ? `<div class="audit-stats">${stats.join("")}</div>` : ""}
        ${(entry.sources_accessed || []).length ? `<div class="audit-sources">${escapeHtml(entry.sources_accessed.join(" · "))}</div>` : ""}
      </div>`;
  }).join("");
}

/* ---------- navigation + source jumps ---------- */
function switchTab(tab, scrollToWorkspace = true) {
  state.tab = tab;
  $$(".tab-btn").forEach((button) => {
    const active = button.dataset.tab === tab;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  $$(".panel").forEach((panel) => panel.classList.toggle("active", panel.id === `panel-${tab}`));
  if (tab === "meetings") renderMeetings();
  if (tab === "literature") renderLiterature();
  if (tab === "logs") renderAudit();
  if (scrollToWorkspace) window.scrollTo({ top: 0, behavior: "smooth" });
}

function jumpToSource(docId, terms = []) {
  const doc = state.docs.find((item) => item.id === docId);
  if (!doc) {
    toast(`Source ${docId} is not in the active corpus`);
    return;
  }
  state.highlightTerms = terms.length ? terms : state.lastTerms;
  if (doc.type === "meeting_note") {
    state.selectedMeeting = doc.id;
    switchTab("meetings", false);
    renderMeetings();
  } else {
    state.litHighlight = doc.id;
    state.litFilter = "";
    $("#lit-filter").value = "";
    switchTab("literature", false);
    renderLiterature();
  }
}

async function setMode(mode) {
  if (mode === state.mode) return;
  if (state.busy) return;
  try {
    const payload = await api("/api/mode", { method: "POST", body: JSON.stringify({ mode }) });
    state.mode = payload.privacy_mode;
    state.audit = payload.audit_log || state.audit;
    await refreshState(false);
    toast(mode === "LOCAL_ONLY" ? "Local-only — egress blocked at the server" : "Cloud approved — external tools armed and audited");
  } catch (error) {
    toast(error.message);
  }
}

/* ---------- boot ---------- */
async function refreshState(renderChatToo = false) {
  const payload = await api("/api/state");
  applyState(payload);
  if (renderChatToo) renderChat();
}

function bindEvents() {
  $$(".tab-btn").forEach((button) => button.addEventListener("click", () => switchTab(button.dataset.tab)));
  $$(".mode-btn").forEach((button) => button.addEventListener("click", () => setMode(button.dataset.mode)));
  $$(".prompt-chip").forEach((button) => button.addEventListener("click", () => {
    const prompt = button.dataset.prompt;
    if (state.mode === "LOCAL_ONLY" && prompt.includes("live PubMed")) {
      toast("Local mode: showing a bundled comparison. Switch to Cloud for Europe PMC.");
    }
    submitQuery(prompt);
  }));
  $("#query-form").addEventListener("submit", (event) => {
    event.preventDefault();
    submitQuery($("#query-input").value);
  });
  $("#query-input").addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submitQuery($("#query-input").value);
    }
  });
  $("#query-input").addEventListener("input", autoResize);
  $("#chat-thread").addEventListener("click", (event) => {
    const citation = event.target.closest(".source-ref");
    if (citation) {
      jumpToSource(citation.dataset.sourceId, state.lastTerms);
      return;
    }
    const jump = event.target.closest(".jump-btn");
    if (jump) {
      let terms = [];
      try { terms = JSON.parse(jump.dataset.terms || "[]"); } catch (_) { terms = []; }
      jumpToSource(jump.dataset.jump, terms);
    }
  });
  $("#meeting-list").addEventListener("click", (event) => {
    const item = event.target.closest("[data-meeting]");
    if (!item) return;
    state.selectedMeeting = item.dataset.meeting;
    state.highlightTerms = [];
    renderMeetings();
  });
  $("#lit-filter").addEventListener("input", (event) => {
    state.litFilter = event.target.value;
    state.litHighlight = null;
    renderLiterature();
  });
  $("#lit-grid").addEventListener("click", (event) => {
    const card = event.target.closest("[data-paper]");
    if (card && !event.target.closest("a")) {
      state.litHighlight = card.dataset.paper;
      renderLiterature();
    }
  });
}

function autoResize() {
  const input = $("#query-input");
  if (!input) return;
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 100)}px`;
}

async function boot() {
  bindEvents();
  try {
    await refreshState(true);
    renderChat();
  } catch (error) {
    toast(`Workspace failed to initialise: ${error.message}`, 6000);
    $("#workspace-backend").textContent = "offline";
  }
}

boot();
