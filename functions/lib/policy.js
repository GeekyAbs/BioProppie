export const LOCAL_ONLY = "LOCAL_ONLY";
export const CLOUD_APPROVED = "CLOUD_APPROVED";

let mode = LOCAL_ONLY;
let audit = [];

// One boot entry per Worker isolate.
audit.push({
  id: "AUD-0001",
  timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  event: "boot",
  mode,
  query: null,
  egress_status: "BLOCKED (0 outbound calls)",
  egress_hosts: [],
  sources_accessed: [],
  quotes_checked: 0,
  verification: emptyVerification(),
  detail: "BioProppie Worker initialised in LOCAL_ONLY. Egress guard armed.",
});

export class PolicyError extends Error {
  constructor(message) {
    super(message);
    this.status = 403;
  }
}

function utcNow() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function emptyVerification() {
  return { exact: 0, close: 0, unverified: 0, total: 0 };
}

function push(entry) {
  audit = [...audit, { id: `AUD-${String(audit.length + 1).padStart(4, "0")}`, timestamp: utcNow(), ...entry }];
  return audit[audit.length - 1];
}

export function getMode() {
  return mode;
}

export function setMode(nextMode, actor = "workspace") {
  if (nextMode !== LOCAL_ONLY && nextMode !== CLOUD_APPROVED) {
    const error = new Error(`Unknown privacy mode: ${nextMode}`);
    error.status = 422;
    throw error;
  }
  const previous = mode;
  mode = nextMode;
  return push({
    event: "mode_change",
    mode,
    query: null,
    egress_status: mode === CLOUD_APPROVED ? "ALLOWED: ebi.ac.uk" : "BLOCKED (0 outbound calls)",
    egress_hosts: mode === CLOUD_APPROVED ? ["ebi.ac.uk"] : [],
    sources_accessed: [],
    quotes_checked: 0,
    verification: emptyVerification(),
    detail: `Policy switched from ${previous} to ${mode} by ${actor}.`,
  });
}

export function requireCloudApproved(action, query = null) {
  if (mode !== CLOUD_APPROVED) {
    push({
      event: "egress_blocked",
      mode,
      query,
      egress_status: "BLOCKED (0 outbound calls)",
      egress_hosts: [],
      sources_accessed: [],
      quotes_checked: 0,
      verification: emptyVerification(),
      detail: `Blocked external action '${action}' at the server policy boundary.`,
    });
    throw new PolicyError("Blocked by server LOCAL_ONLY policy");
  }
}

export function recordQuery({ query, egressHosts = [], sources = [], verification = emptyVerification(), detail = "", liveFetched = 0 }) {
  return push({
    event: "query",
    mode,
    query,
    egress_status: egressHosts.length ? `ALLOWED: ${egressHosts.join(", ")}` : "BLOCKED (0 outbound calls)",
    egress_hosts: egressHosts,
    sources_accessed: sources,
    quotes_checked: verification.total || 0,
    verification,
    live_fetched: liveFetched,
    detail,
  });
}

export function addSystemEvent(detail, event = "boot") {
  return push({
    event,
    mode,
    query: null,
    egress_status: "BLOCKED (0 outbound calls)",
    egress_hosts: [],
    sources_accessed: [],
    quotes_checked: 0,
    verification: emptyVerification(),
    detail,
  });
}

export function snapshot(limit = 100) {
  return audit.slice(-limit).map((entry) => ({ ...entry }));
}

export function auditCount() {
  return audit.length;
}
