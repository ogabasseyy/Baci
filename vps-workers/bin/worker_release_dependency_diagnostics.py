#!/usr/bin/env python3
"""Redacted, fixed-category diagnostics for pnpm preverification failures."""
from __future__ import annotations

import subprocess
import json
import os
import stat
from pathlib import Path

from worker_release_dependency_artifacts import BuilderRejected

DIAGNOSTIC_STAGES = frozenset({
    "policy-preverify", "preverify-web-deploy", "preverify-worker-install",
})
DIAGNOSTIC_CATEGORIES = frozenset({
    "lockfile-trust-downgrade", "minimum-release-age", "frozen-lockfile-mismatch",
    "registry-network", "registry-response", "lockfile-policy", "unsupported-pnpm-option",
    "filesystem-access", "dependency-resolution", "pnpm-exit", "policy-rejected",
    "filesystem-error", "preverify-timeout", "operation-error",
})


class PnpmStepRejected(BuilderRejected):
    def __init__(self, stage: str, category: str, exit_code: int):
        self.safe_stage = stage if stage in DIAGNOSTIC_STAGES else "policy-preverify"
        self.safe_category = category if category in DIAGNOSTIC_CATEGORIES else "pnpm-exit"
        self.exit_code = exit_code
        super().__init__(self.safe_stage)


def write_diagnostic(path: Path, stage: str, category: str, exit_code: int | None) -> None:
    safe_stage = stage if stage in DIAGNOSTIC_STAGES else "policy-preverify"
    safe_category = category if category in DIAGNOSTIC_CATEGORIES else "operation-error"
    value = {"stage": safe_stage, "category": safe_category,
             "exit_code": exit_code if isinstance(exit_code, int) and 0 <= exit_code <= 255 else None}
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600)
    try:
        payload = (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode("ascii")
        remaining = memoryview(payload)
        while remaining:
            written = os.write(fd, remaining)
            if written <= 0:
                raise OSError("short diagnostic write")
            remaining = remaining[written:]
        os.fsync(fd)
    finally:
        os.close(fd)


def read_diagnostic(path: Path, *, owner_uid: int) -> dict[str, object] | None:
    try:
        fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    except OSError:
        return None
    try:
        info = os.fstat(fd)
        if (not stat.S_ISREG(info.st_mode) or info.st_uid != owner_uid or info.st_nlink != 1
                or info.st_mode & 0o077 or info.st_size > 512):
            return None
        raw = os.read(fd, 513)
        value = json.loads(raw)
        if (not isinstance(value, dict) or set(value) != {"stage", "category", "exit_code"}
                or value["stage"] not in DIAGNOSTIC_STAGES
                or value["category"] not in DIAGNOSTIC_CATEGORIES
                or (value["exit_code"] is not None and (type(value["exit_code"]) is not int
                    or not 0 <= value["exit_code"] <= 255))):
            return None
        return value
    except (OSError, ValueError, TypeError):
        return None
    finally:
        os.close(fd)


def pnpm_failure_category(output: str) -> str:
    """Classify bounded tool output without returning any of its contents."""
    sample = output[:65_536].lower()
    if "err_pnpm_trust_downgrade" in sample:
        return "lockfile-trust-downgrade"
    if "err_pnpm_no_mature_matching_version" in sample:
        return "minimum-release-age"
    if any(code in sample for code in ("err_pnpm_outdated_lockfile", "err_pnpm_lockfile_config_mismatch")):
        return "frozen-lockfile-mismatch"
    if any(token in sample for token in ("econnreset", "econnrefused", "etimedout", "eai_again", "certificate has expired")):
        return "registry-network"
    if any(token in sample for token in ("http 401", "http 403", "http 404", "http 429", "http 5", "status code 401", "status code 403", "status code 429")):
        return "registry-response"
    if any(token in sample for token in ("trustpolicy", "minimumreleaseage", "supply-chain policy", "lockfile passes supply-chain")):
        return "lockfile-policy"
    if any(token in sample for token in ("unknown option", "unknown argument", "unsupported option", "invalid option")):
        return "unsupported-pnpm-option"
    if any(token in sample for token in ("enoent", "no such file or directory", "permission denied", "eacces")):
        return "filesystem-access"
    if any(token in sample for token in ("lockfile", "resolution", "could not resolve", "no matching version")):
        return "dependency-resolution"
    return "pnpm-exit"


def run_pnpm_checked(command: tuple[str, ...], *, cwd, env=None, timeout: int, stage: str):
    try:
        return subprocess.run(command, cwd=cwd, env=env, check=True, capture_output=True,
                              text=True, timeout=timeout)
    except subprocess.CalledProcessError as exc:
        category = pnpm_failure_category((exc.stdout or "") + "\n" + (exc.stderr or ""))
        safe_stage = f"preverify-{stage.split()[-1]}"
        raise PnpmStepRejected(safe_stage, category, exc.returncode) from exc
    except subprocess.TimeoutExpired as exc:
        raise BuilderRejected(f"pnpm {stage} timed out") from exc
