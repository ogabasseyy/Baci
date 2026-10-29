#!/usr/bin/env python3
"""Command-line entrypoint for disposable dependency policy preverification."""
from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path
from typing import Sequence

from worker_release_dependency_artifacts import BuilderRejected
import worker_release_dependency_policy_cache as policy
from worker_release_dependency_diagnostics import PnpmStepRejected, write_diagnostic


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--preverify", action="store_true", help="fixture-only online policy check")
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--store", type=Path, required=True)
    parser.add_argument("--cache", type=Path, required=True)
    parser.add_argument("--pnpm", default="/usr/bin/pnpm")
    parser.add_argument("--node", default="/usr/bin/node")
    parser.add_argument("--diagnostic-file", type=Path)
    parser.add_argument("--experiment-cache-max-bytes", type=int,
                        help="bounded metadata-cache measurement override for disposable CI only")
    args = parser.parse_args(argv)
    try:
        if not args.preverify:
            parser.error("--preverify is required")
        cache_limit = args.experiment_cache_max_bytes
        if cache_limit is None:
            cache_limit = policy.MAX_CACHE_BYTES
        elif not policy.MAX_CACHE_BYTES < cache_limit <= policy.MAX_EXPERIMENT_CACHE_BYTES:
            parser.error("experiment cache limit must be above production cap and at most 4 GiB")
        policy.preverify(args.source, args.store, args.cache, args.pnpm, args.node,
                         cache_max_bytes=cache_limit)
        print("synthetic dependency policy preverification passed")
        return 0
    except (BuilderRejected, OSError, subprocess.SubprocessError) as exc:
        if isinstance(exc, PnpmStepRejected):
            stage, category, exit_code = exc.safe_stage, exc.safe_category, exc.exit_code
        elif isinstance(exc, subprocess.TimeoutExpired):
            stage, category, exit_code = "policy-preverify", "preverify-timeout", None
        elif isinstance(exc, OSError):
            stage, category, exit_code = "policy-preverify", "filesystem-error", None
        else:
            stage, category, exit_code = "policy-preverify", "policy-rejected", None
        if args.diagnostic_file is not None:
            try:
                write_diagnostic(args.diagnostic_file, stage, category, exit_code)
            except OSError:
                pass
        message = f"experiment failure stage={stage} category={category}"
        if exit_code is not None:
            message += f" exit={exit_code}"
        print(message, file=sys.stderr)
        return 1
    except Exception:
        if args.diagnostic_file is not None:
            try:
                write_diagnostic(args.diagnostic_file, "policy-preverify", "operation-error", None)
            except OSError:
                pass
        print("experiment failure stage=policy-preverify category=operation-error", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
