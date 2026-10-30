"""Bounded, fixed-field diagnostics for the disposable dependency builder unit."""
from __future__ import annotations

import re

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


__all__ = ["cleanup_unit", "collect_unit_diagnostics", "summarize_status"]
