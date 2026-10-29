"""Test cleanup helpers that retain candidates when cgroup quiescence is unknown."""
from __future__ import annotations

import os
import shutil
from pathlib import Path

from worker_release_runtime_verifier import RuntimeVerificationQuiescenceUnproven


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


__all__ = ["cleanup_candidate_after_verifier"]
