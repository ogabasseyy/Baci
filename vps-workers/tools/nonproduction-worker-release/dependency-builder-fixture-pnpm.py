#!/usr/bin/env python3
"""Secretless pnpm observer used only by the disposable systemd fixture."""
from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Sequence

# This observer is also imported from its staged systemd helper directory.
# Keep sibling fixture modules importable when an importlib caller's sys.path
# points at the checkout or a shell's current directory instead.
sys.path.insert(0, str(Path(__file__).resolve().parent))

from dependency_builder_fixture_pnpm_classification import safe_success_output, summarize_failure
from dependency_builder_fixture_pnpm_diagnostics import (
    FIXTURE_ERROR_NAME, _diagnostic_path, _write_diagnostic, read_diagnostic,
    read_scratch_diagnostic,
)


def _pnpm_command(entrypoint: str, pnpm_args: Sequence[str]) -> tuple[str, ...]:
    """Use the fixed NDJSON diagnostic reporter for synthetic deploy only.

    The reporter changes output formatting only, not resolution or trust
    policy. NDJSON retains pnpm's error code, headline, and trust hint so the
    allowlisting classifier can identify a synthetic trust transition. Bounded
    raw output is processed in memory only and never emitted or persisted.
    """
    reporter = ("--reporter=ndjson",) if "deploy" in pnpm_args else ()
    return ("/usr/bin/node", entrypoint, *reporter, *pnpm_args)

def main(argv: Sequence[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if len(args) < 1:
        return 125
    entrypoint, *pnpm_args = args
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    try:
        from worker_release_bounded_process import run_bounded_capture
        result = run_bounded_capture(_pnpm_command(entrypoint, pnpm_args),
                                     cwd=Path.cwd(), env=os.environ,
                                     timeout=240, max_stream_bytes=1_048_576)
    except Exception:
        print("PNPM_FIXTURE_COMMAND_FAILED", file=sys.stderr)
        return 125
    if result.returncode == 0:
        output = safe_success_output(result.stdout, result.stderr)
        if output:
            print(output)
        return 0
    summary = summarize_failure(f"{result.stdout}\n{result.stderr}",
                                pnpm_args=pnpm_args, cwd=Path.cwd(), env=os.environ)
    _write_diagnostic(_diagnostic_path(pnpm_args, env=os.environ), summary)
    if summary["error_code"] == "ERR_PNPM_TRUST_DOWNGRADE":
        print("ERR_PNPM_TRUST_DOWNGRADE", file=sys.stderr)
    else:
        print("PNPM_FIXTURE_COMMAND_FAILED", file=sys.stderr)
    return min(max(result.returncode, 1), 255)


if __name__ == "__main__":
    raise SystemExit(main())
