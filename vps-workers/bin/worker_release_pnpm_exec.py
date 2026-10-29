"""Bounded execution wrapper for trusted, fixed pnpm commands."""
from __future__ import annotations

from worker_release_bounded_process import (
    OutputLimitExceeded,
    ProcessCleanupTimedOut,
    ProcessTimedOut,
    run_bounded_capture,
)
from worker_release_dependency_diagnostics import PnpmStepRejected, pnpm_failure_category


def run_pnpm_checked(command, *, cwd, env=None, timeout: int, stage: str):
    safe_stage = f"preverify-{stage.split()[-1]}"
    try:
        result = run_bounded_capture(command, cwd=cwd, env=env, timeout=timeout)
    except OutputLimitExceeded:
        raise PnpmStepRejected(safe_stage, "pnpm-output-limit", 125) from None
    except ProcessTimedOut:
        raise PnpmStepRejected(safe_stage, "preverify-timeout", 124) from None
    except ProcessCleanupTimedOut:
        raise PnpmStepRejected(safe_stage, "operation-error", 125) from None
    if result.returncode != 0:
        category = pnpm_failure_category((result.stdout or "") + "\n" + (result.stderr or ""))
        raise PnpmStepRejected(safe_stage, category, result.returncode) from None
    return result
