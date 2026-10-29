"""Bounded process invocation helpers for the disposable dependency experiment."""
from __future__ import annotations

import os
from pathlib import Path
from typing import Callable

from worker_release_actual_dependency_guard import MonitorFailure, run_monitored
from worker_release_dependency_diagnostics import read_diagnostic


def run(command: tuple[str, ...], *, cwd: Path, env: dict[str, str], timeout: int,
        stage: str, resource_root: Path,
        observe_resource: Callable[[str, int, int], None] | None = None) -> None:
    run_monitored(command, cwd=cwd, env=env, timeout=timeout, stage=stage,
                  resource_root=resource_root, observe_resource=observe_resource)


def run_policy_preverify(command: tuple[str, ...], *, cwd: Path, env: dict[str, str],
                         timeout: int, resource_root: Path, diagnostic_path: Path,
                         run_fn=run,
                         observe_resource: Callable[[str, int, int], None] | None = None) -> None:
    try:
        run_fn(command, cwd=cwd, env=env, timeout=timeout, stage="policy-preverify",
               resource_root=resource_root, observe_resource=observe_resource)
    except MonitorFailure as exc:
        record = read_diagnostic(diagnostic_path, owner_uid=os.geteuid())
        if record is not None and exc.category == "process-exit":
            raise MonitorFailure(str(record["stage"]), str(record["category"]),
                                 record["exit_code"] if isinstance(record["exit_code"], int)
                                 else exc.exit_code, record.get("evidence"),
                                 record.get("os_error")) from exc
        raise
