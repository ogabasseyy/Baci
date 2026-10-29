#!/usr/bin/env python3
"""Redacted, fixed-category diagnostics for pnpm preverification failures."""
from __future__ import annotations

import subprocess

from worker_release_dependency_artifacts import BuilderRejected


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
        raise BuilderRejected(f"pnpm {stage} failed (exit {exc.returncode}; category={category})") from exc
    except subprocess.TimeoutExpired as exc:
        raise BuilderRejected(f"pnpm {stage} timed out") from exc
