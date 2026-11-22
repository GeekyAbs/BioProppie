"""Server-enforced egress policy and the in-memory audit trail."""

from __future__ import annotations

import threading
from datetime import datetime, timezone

from fastapi import HTTPException

LOCAL_ONLY = "LOCAL_ONLY"
CLOUD_APPROVED = "CLOUD_APPROVED"
VALID_MODES = {LOCAL_ONLY, CLOUD_APPROVED}


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


class PolicyManager:
    """The single source of truth for whether external egress is allowed."""

    def __init__(self) -> None:
        self._mode = LOCAL_ONLY
        self._audit: list[dict] = []
        self._lock = threading.Lock()

    @property
    def mode(self) -> str:
        return self._mode

    def set_mode(self, mode: str, actor: str = "workspace") -> dict:
        if mode not in VALID_MODES:
            raise HTTPException(status_code=422, detail=f"Unknown privacy mode: {mode}")
        with self._lock:
            previous = self._mode
            self._mode = mode
            entry = {
                "id": f"AUD-{len(self._audit) + 1:04d}",
                "timestamp": utc_now(),
                "event": "mode_change",
                "mode": mode,
                "query": None,
                "egress_status": "ALLOWED: ebi.ac.uk" if mode == CLOUD_APPROVED else "BLOCKED (0 outbound calls)",
                "egress_hosts": ["ebi.ac.uk"] if mode == CLOUD_APPROVED else [],
                "sources_accessed": [],
                "quotes_checked": 0,
                "verification": {"exact": 0, "close": 0, "unverified": 0, "total": 0},
                "detail": f"Policy switched from {previous} to {mode} by {actor}.",
            }
            self._audit.append(entry)
            return entry

    def require_cloud_approved(self, action: str, query: str | None = None) -> None:
        """Raise before any outbound call can happen while in LOCAL_ONLY."""
        if self._mode != CLOUD_APPROVED:
            with self._lock:
                self._audit.append(
                    {
                        "id": f"AUD-{len(self._audit) + 1:04d}",
                        "timestamp": utc_now(),
                        "event": "egress_blocked",
                        "mode": self._mode,
                        "query": query,
                        "egress_status": "BLOCKED (0 outbound calls)",
                        "egress_hosts": [],
                        "sources_accessed": [],
                        "quotes_checked": 0,
                        "verification": {"exact": 0, "close": 0, "unverified": 0, "total": 0},
                        "detail": f"Blocked external action '{action}' at the server policy boundary.",
                    }
                )
            raise HTTPException(status_code=403, detail="Blocked by server LOCAL_ONLY policy")

    def record_query(
        self,
        *,
        query: str,
        egress_hosts: list[str],
        sources: list[str],
        verification: dict,
        detail: str,
        live_fetched: int = 0,
    ) -> dict:
        with self._lock:
            entry = {
                "id": f"AUD-{len(self._audit) + 1:04d}",
                "timestamp": utc_now(),
                "event": "query",
                "mode": self._mode,
                "query": query,
                "egress_status": (
                    f"ALLOWED: {', '.join(egress_hosts)}" if egress_hosts else "BLOCKED (0 outbound calls)"
                ),
                "egress_hosts": egress_hosts,
                "sources_accessed": sources,
                "quotes_checked": verification.get("total", 0),
                "verification": verification,
                "live_fetched": live_fetched,
                "detail": detail,
            }
            self._audit.append(entry)
            return entry

    def add_system_event(self, detail: str, event: str = "boot") -> dict:
        with self._lock:
            entry = {
                "id": f"AUD-{len(self._audit) + 1:04d}",
                "timestamp": utc_now(),
                "event": event,
                "mode": self._mode,
                "query": None,
                "egress_status": "BLOCKED (0 outbound calls)",
                "egress_hosts": [],
                "sources_accessed": [],
                "quotes_checked": 0,
                "verification": {"exact": 0, "close": 0, "unverified": 0, "total": 0},
                "detail": detail,
            }
            self._audit.append(entry)
            return entry

    def snapshot(self, limit: int = 100) -> list[dict]:
        with self._lock:
            return [dict(entry) for entry in self._audit[-limit:]]
