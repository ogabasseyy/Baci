"""Test cleanup helpers that retain candidates when cgroup quiescence is unknown."""
from __future__ import annotations

import os
import re
import shutil
from pathlib import Path

from worker_release_runtime_verifier import RuntimeVerificationQuiescenceUnproven


def classify_namespace_failure(journal_text: str) -> str:
    """Reduce manager journal text to a fixed, non-sensitive test diagnostic."""
    text = journal_text.lower()
    if not text.strip():
        return "namespace-message-unavailable"
    if not any(marker in text for marker in (
            "failed to set up mount namespacing", "failed at step namespace",
            "mount namespac", "namespace setup")):
        return "namespace-message-unclassified"
    if "/var/run" in text:
        return "namespace-path-run-alias"
    if "/root" in text or "/home" in text:
        return "namespace-path-protect-home-overlap"
    if "/srv" in text:
        return "namespace-path-worker-root-mask"
    if "/var/lib/baci-worker-runtime-views" in text:
        return "namespace-path-runtime-view"
    return "namespace-path-unclassified"


def emit_namespace_failure_diagnostic(unit: str) -> str:
    """Emit a fixed category from a bounded disposable-test unit journal query."""
    from worker_release_bounded_process import run_bounded_capture

    if not re.fullmatch(r"baci-worker-runtime-[0-9a-f]{16}-[0-9a-f]{12}-[01]\.service", unit):
        return "namespace-diagnostic-invalid-unit"
    try:
        result = run_bounded_capture(
            # systemd setup failures are manager messages and are not always
            # tagged as the transient unit's stdout/stderr. Search only for
            # this fixed-format unit identifier in the boot journal; emit a
            # fixed category below, never the journal content itself.
            ("/usr/bin/journalctl", "--no-pager", "--output=short", "--lines=20",
             f"--grep={unit}"),
            timeout=2, max_stream_bytes=4096,
            env={"PATH": "/usr/bin:/bin", "LC_ALL": "C"},
        )
        category = classify_namespace_failure(result.stdout + result.stderr)
    except Exception:
        category = "namespace-journal-unavailable"
    print(f"RUNTIME_SYSTEMD_DIAGNOSTIC={category}", flush=True)
    return category


def cleanup_candidate_after_verifier(candidate: Path,
                                     error: BaseException | None) -> bool:
    """Delete a test candidate only when the verifier did not report unproven drain."""
    if isinstance(error, RuntimeVerificationQuiescenceUnproven):
        return False
    candidate = Path(candidate)
    if not os.path.lexists(candidate):
        return True
    for current, directories, _files in os.walk(candidate, topdown=True, followlinks=False):
        os.chmod(current, 0o700)
        for name in directories:
            child = Path(current) / name
            if not child.is_symlink():
                os.chmod(child, 0o700)
    shutil.rmtree(candidate)
    return not os.path.lexists(candidate)


__all__ = ["classify_namespace_failure", "cleanup_candidate_after_verifier",
           "emit_namespace_failure_diagnostic"]
