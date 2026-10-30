"""Bounded, fixed-field diagnostics for the disposable dependency builder unit."""
from __future__ import annotations

import re
import threading

UNIT_RE = re.compile(r"^baci-worker-deps-[0-9a-f]{12}-[0-9a-f]{10}(?:\.service)?$")
ALLOWED_PROPERTIES = frozenset({
    "LoadState", "ActiveState", "SubState", "Result", "ExecMainCode",
    "ExecMainStatus", "StatusText", "StatusErrno",
})


def _category(value: str) -> str:
    text = value.lower()
    if "namespace" in text or "namespac" in text:
        return "namespace"
    if "no such file" in text or "not found" in text:
        return "path-missing"
    if "permission denied" in text or "operation not permitted" in text:
        return "permission"
    if "exec" in text or "spawn" in text:
        return "exec"
    if text.strip():
        return "other"
    return "absent"


class BoundedOutputDrain:
    """Continuously drain one fixture pipe while retaining only its final bound."""

    def __init__(self, stream, *, max_bytes: int = 4096) -> None:
        if type(max_bytes) is not int or not 0 < max_bytes <= 8192:
            raise ValueError("fixture output bound is invalid")
        self._stream = stream
        self._max_bytes = max_bytes
        self._tail = bytearray()
        self._thread = threading.Thread(target=self._drain, daemon=True)
        self._thread.start()

    def _drain(self) -> None:
        while True:
            chunk = self._stream.read(1024)
            if not chunk:
                return
            self._tail.extend(chunk)
            if len(self._tail) > self._max_bytes:
                del self._tail[:len(self._tail) - self._max_bytes]

    def read(self) -> bytes:
        self._thread.join(timeout=2)
        if self._thread.is_alive():
            return b""
        return bytes(self._tail)


def summarize_child_output(stdout: bytes, stderr: bytes) -> str:
    """Reduce synthetic child output to a closed category without printing text."""
    text = (stdout + b"\n" + stderr).decode("utf-8", errors="replace").lower()
    if not text.strip():
        return "absent"
    if "modulenotfounderror" in text or "importerror" in text:
        return "python-import"
    if "traceback (most recent call last)" in text:
        return "python-exception"
    if "no space left" in text or "disk quota" in text:
        return "storage"
    if "permission denied" in text or "operation not permitted" in text:
        return "permission"
    if "no such file or directory" in text or "not found" in text:
        return "path-missing"
    rejection = next((line.split("dependency build rejected:", 1)[1].strip()
                      for line in text.splitlines()
                      if "dependency build rejected:" in line), "")
    if rejection:
        categories = (
            (("sandbox worker identity or environment",), "sandbox-identity"),
            (("sandbox source",), "sandbox-source"),
            (("per-build offline pnpm store",), "scratch-store"),
            (("per-build offline pnpm policy cache",), "scratch-cache"),
            (("immutable pnpm policy seed",), "seed-input"),
            (("metadata cache changed",), "seed-receipt-cache-changed"),
            (("does not match exact lockfiles and policy",), "seed-receipt-policy-mismatch"),
            (("does not match expected source sha",), "seed-receipt-source-mismatch"),
            (("receipt is unsafe",), "seed-receipt-unsafe"),
            (("receipt is unavailable or malformed",), "seed-receipt-malformed"),
            (("receipt",), "seed-receipt"),
            (("installed pnpm version",), "pnpm-version"),
            (("offline install did not verify", "supply-chain policy"), "pnpm-policy"),
            (("worker dependency install", "worker install tree"), "worker-dependencies"),
            (("runtime candidate", "runtime shape"), "runtime-candidate"),
            (("payload",), "payload"),
            (("source",), "source"),
        )
        category = next((category for patterns, category in categories
                         if any(pattern in rejection for pattern in patterns)),
                        "rejected-other")
        return f"builder-{category}"
    if "dependency build rejected stage=" in text:
        return "pnpm-step-rejected"
    return "other"


def receipt_difference(actual: object, expected: object) -> str:
    """Return only mismatched fields from the closed synthetic receipt schema."""
    fields = (
        "schema", "sourceSha", "pnpmVersion", "lockfiles", "policyFiles",
        "effectiveFlags", "lockInjectionSettings", "registryRouting",
        "metadataCacheSha256", "verification",
    )
    if not isinstance(actual, dict) or not isinstance(expected, dict):
        return "malformed"
    if set(actual) != set(fields) or set(expected) != set(fields):
        return "shape"
    differences = [field for field in fields if actual[field] != expected[field]]
    return ",".join(differences) if differences else "none"


def summarize_status(status_text: str, journal_text: str) -> dict[str, str]:
    """Discard arbitrary log strings and return only closed diagnostic enums."""
    values: dict[str, str] = {}
    for line in status_text.splitlines():
        key, separator, value = line.partition("=")
        if separator and key in ALLOWED_PROPERTIES and key not in values:
            values[key] = value
    status_category = _category(values.get("StatusText", ""))
    journal_category = _category(journal_text)
    return {
        "load_state": values.get("LoadState", "unavailable")
        if values.get("LoadState") in {"loaded", "not-found", "error"} else "other",
        "active_state": values.get("ActiveState", "unavailable")
        if values.get("ActiveState") in {"active", "inactive", "failed", "activating", "deactivating"}
        else "other",
        "sub_state": values.get("SubState", "unavailable")
        if values.get("SubState") in {"running", "dead", "failed", "start", "auto-restart"}
        else "other",
        "result": values.get("Result", "unavailable")
        if values.get("Result") in {"success", "exit-code", "signal", "timeout", "resources", "protocol"}
        else "other",
        "exec_main_code": values.get("ExecMainCode", "unavailable")
        if values.get("ExecMainCode") in {"exited", "killed", "dumped", "aborted"} else "other",
        "exec_main_status": values.get("ExecMainStatus", "unavailable")
        if re.fullmatch(r"[0-9]{1,3}", values.get("ExecMainStatus", "")) else "other",
        "status_errno": values.get("StatusErrno", "unavailable")
        if re.fullmatch(r"[0-9]{1,5}", values.get("StatusErrno", "")) else "other",
        "status_category": status_category,
        "journal_category": journal_category,
    }


def _runner(run):
    if run is not None:
        return run
    from worker_release_bounded_process import run_bounded_capture
    return run_bounded_capture


def collect_unit_diagnostics(unit: str, *, run=None) -> dict[str, str]:
    """Query only fixed properties and exact-unit journal with strict output bounds."""
    if not UNIT_RE.fullmatch(unit):
        raise ValueError("builder fixture unit name is invalid")
    fixed_unit = unit if unit.endswith(".service") else f"{unit}.service"
    env = {"PATH": "/usr/bin:/bin", "LC_ALL": "C"}
    run = _runner(run)
    try:
        status = run(("/usr/bin/systemctl", "--system", "show", "--no-pager",
                      "--property=LoadState", "--property=ActiveState", "--property=SubState",
                      "--property=Result", "--property=ExecMainCode", "--property=ExecMainStatus",
                      "--property=StatusText", "--property=StatusErrno", fixed_unit),
                     timeout=2, max_stream_bytes=4096, env=env)
        journal = run(("/usr/bin/journalctl", "--no-pager", "--output=cat", "--lines=30",
                      f"--unit={fixed_unit}"), timeout=2,
                     max_stream_bytes=4096, env=env)
    except Exception:
        return summarize_status("", "")
    status_text = status.stdout[:4096] if status.returncode == 0 else ""
    journal_text = journal.stdout[:4096] if journal.returncode == 0 else ""
    return summarize_status(status_text, journal_text)


def cleanup_unit(unit: str, *, run=None) -> None:
    """Stop and reset only the exact test unit; ignore an absent unit."""
    if not UNIT_RE.fullmatch(unit):
        raise ValueError("builder fixture unit name is invalid")
    fixed_unit = unit if unit.endswith(".service") else f"{unit}.service"
    env = {"PATH": "/usr/bin:/bin", "LC_ALL": "C"}
    run = _runner(run)
    try:
        state = run(("/usr/bin/systemctl", "--system", "show", "--property=LoadState", "--value",
                     fixed_unit), timeout=3, max_stream_bytes=1024, env=env)
    except Exception:
        raise RuntimeError("builder fixture unit state could not be checked") from None
    if state.returncode != 0:
        raise RuntimeError("builder fixture unit state could not be checked")
    if state.stdout.strip() == "not-found":
        return
    for operation, timeout in (("stop", 10), ("reset-failed", 3)):
        try:
            result = run(("/usr/bin/systemctl", "--system", operation, fixed_unit),
                         timeout=timeout, max_stream_bytes=1024, env=env)
        except Exception:
            raise RuntimeError("builder fixture unit cleanup failed") from None
        if result.returncode != 0:
            raise RuntimeError("builder fixture unit cleanup failed")


__all__ = [
    "BoundedOutputDrain", "cleanup_unit", "collect_unit_diagnostics",
    "receipt_difference", "summarize_child_output", "summarize_status",
]
