#!/usr/bin/env python3
"""Redacted, fixed-category diagnostics for pnpm preverification failures."""
from __future__ import annotations

import subprocess
import json
import os
import re
import stat
from pathlib import Path

from worker_release_dependency_artifacts import BuilderRejected
from worker_release_dependency_evidence_shape import (
    format_policy_line_shapes,
    summarize_line_shape,
    validate_evidence_summary as _validate_evidence_summary,
)

DIAGNOSTIC_STAGES = frozenset({
    "policy-preverify", "preverify-web-install", "preverify-worker-install", "web-install", "web-deploy", "worker-install",
})
DIAGNOSTIC_CATEGORIES = frozenset({
    "lockfile-trust-downgrade", "minimum-release-age", "frozen-lockfile-mismatch",
    "registry-network", "registry-response", "lockfile-policy", "unsupported-pnpm-option",
    "filesystem-access", "dependency-resolution", "pnpm-exit", "policy-rejected",
    "filesystem-error", "preverify-timeout", "operation-error", "policy-pass-marker-missing",
    "registry-policy", "source-policy-invalid", "metadata-cache-bound", "metadata-cache-invalid",
    "pnpm-version-mismatch", "source-policy-mutated",
    "policy-cache-not-fresh",
})
POLICY_PASS_MARKER = "Lockfile passes supply-chain policies"
_ANSI_ESCAPE = re.compile(r"\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))")
_POLICY_PASS_FRESH = re.compile(
    r"^\s*✓\s+Lockfile passes supply-chain policies \(([0-9]+) entr(?:y|ies) in ([0-9]+(?:\.[0-9]+)?)(ms|s)\)\s*$"
)
_POLICY_PASS_CACHED = re.compile(
    r"^\s*✓\s+Lockfile passes supply-chain policies \(verified ([0-9]+(?:\.[0-9]+)?)(ms|s) ago\)\s*$"
)
MAX_RECENT_VERIFICATION_AGE_MS = 10 * 60 * 1000
MAX_FRESH_VERIFICATION_ELAPSED_MS = 240 * 1000


class PnpmStepRejected(BuilderRejected):
    def __init__(self, stage: str, category: str, exit_code: int,
                 evidence: dict[str, object] | None = None):
        self.safe_stage = stage if stage in DIAGNOSTIC_STAGES else "policy-preverify"
        self.safe_category = category if category in DIAGNOSTIC_CATEGORIES else "pnpm-exit"
        self.exit_code = exit_code
        self.evidence = evidence
        super().__init__(self.safe_stage)


def policy_evidence_summary(stdout: str, stderr: str) -> dict[str, object]:
    """Return bounded structural facts about policy output, never output text."""
    phrase_lines = 0
    recognized = 0
    first_evidence: tuple[str, int] | None = None
    line_shapes: list[dict[str, object]] = []
    for output in (stdout, stderr):
        normalized = _ANSI_ESCAPE.sub("", output)
        for line in normalized.splitlines():
            if POLICY_PASS_MARKER not in line:
                continue
            phrase_lines += 1
            if len(line_shapes) < 2:
                marker_at = line.find(POLICY_PASS_MARKER)
                prefix, suffix = line[:marker_at], line[marker_at + len(POLICY_PASS_MARKER):]
                line_shapes.append(summarize_line_shape(prefix, suffix))
            fresh = _POLICY_PASS_FRESH.fullmatch(line)
            cached = _POLICY_PASS_CACHED.fullmatch(line)
            if fresh and int(fresh.group(1)) > 0:
                elapsed = float(fresh.group(2)) * (1000 if fresh.group(3) == "s" else 1)
                evidence = ("fresh", int(elapsed))
            elif cached:
                age = float(cached.group(1)) * (1000 if cached.group(2) == "s" else 1)
                evidence = ("cached", int(age))
            else:
                continue
            recognized += 1
            if first_evidence is None:
                first_evidence = evidence
    if phrase_lines == 0:
        classification = "absent"
    elif phrase_lines > 1 or recognized > 1:
        classification = "ambiguous"
    elif recognized == 0:
        classification = "malformed"
    elif first_evidence is None or (
        first_evidence[0] == "fresh" and first_evidence[1] > MAX_FRESH_VERIFICATION_ELAPSED_MS
    ) or (
        first_evidence[0] == "cached" and first_evidence[1] > MAX_RECENT_VERIFICATION_AGE_MS
    ):
        classification = "stale"
    else:
        classification = first_evidence[0]
    return {
        "classification": classification,
        "phrase_lines": min(phrase_lines, 255),
        "recognized_lines": min(recognized, 255),
        "line_shapes": line_shapes,
    }


def write_diagnostic(path: Path, stage: str, category: str, exit_code: int | None,
                     evidence: dict[str, object] | None = None) -> None:
    safe_stage = stage if stage in DIAGNOSTIC_STAGES else "policy-preverify"
    safe_category = category if category in DIAGNOSTIC_CATEGORIES else "operation-error"
    value = {"stage": safe_stage, "category": safe_category,
             "exit_code": exit_code if isinstance(exit_code, int) and 0 <= exit_code <= 255 else None}
    if evidence is not None:
        value["evidence"] = _validate_evidence_summary(evidence)
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
        if (not isinstance(value, dict) or set(value) not in (
                {"stage", "category", "exit_code"}, {"stage", "category", "exit_code", "evidence"})
                or value["stage"] not in DIAGNOSTIC_STAGES
                or value["category"] not in DIAGNOSTIC_CATEGORIES
                or (value["exit_code"] is not None and (type(value["exit_code"]) is not int
                    or not 0 <= value["exit_code"] <= 255))):
            return None
        if "evidence" in value:
            value["evidence"] = _validate_evidence_summary(value["evidence"])
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


def policy_rejection_category(message: str) -> tuple[str, str]:
    """Map fixed policy exception messages to closed stage/category pairs."""
    sample = message.lower()
    if "pnpm preverify web-install did not report" in sample:
        return "preverify-web-install", "policy-pass-marker-missing"
    if "pnpm preverify worker-install did not report" in sample:
        return "preverify-worker-install", "policy-pass-marker-missing"
    if "pnpm version" in sample or "runtime differs" in sample:
        return "policy-preverify", "pnpm-version-mismatch"
    if "registry" in sample or "npmrc" in sample:
        return "policy-preverify", "registry-policy"
    if "cache exceeds its byte limit" in sample:
        return "policy-preverify", "metadata-cache-bound"
    if "requires a fresh empty metadata cache" in sample:
        return "policy-preverify", "policy-cache-not-fresh"
    if "policy cache" in sample or "metadata cache" in sample:
        return "policy-preverify", "metadata-cache-invalid"
    if "changed a lockfile or policy" in sample:
        return "policy-preverify", "source-policy-mutated"
    if "policy input" in sample or "lockfile" in sample:
        return "policy-preverify", "source-policy-invalid"
    return "policy-preverify", "policy-rejected"


def policy_pass_evidence(stdout: str, stderr: str) -> tuple[str, int] | None:
    """Parse only pinned pnpm's bounded, standalone verification evidence lines."""
    evidence: tuple[str, int] | None = None
    for output in (stdout, stderr):
        normalized = _ANSI_ESCAPE.sub("", output)
        for line in normalized.splitlines():
            fresh = _POLICY_PASS_FRESH.fullmatch(line)
            if fresh and int(fresh.group(1)) > 0:
                elapsed = float(fresh.group(2)) * (1000 if fresh.group(3) == "s" else 1)
                current = ("fresh", int(elapsed))
            else:
                cached = _POLICY_PASS_CACHED.fullmatch(line)
                if not cached:
                    continue
                age = float(cached.group(1)) * (1000 if cached.group(2) == "s" else 1)
                current = ("cached", int(age))
            # Multiple claims make the command output ambiguous. Even matching
            # duplicates are rejected so callers rely on one unambiguous proof.
            if evidence is not None:
                return None
            evidence = current
    return evidence


def has_policy_pass_marker(stdout: str, stderr: str, *,
                           max_cached_age_ms: int = MAX_RECENT_VERIFICATION_AGE_MS) -> bool:
    """Accept fresh evidence or a recent cache hit; callers bind cache by receipt."""
    evidence = policy_pass_evidence(stdout, stderr)
    return evidence is not None and (
        (evidence[0] == "fresh" and evidence[1] <= MAX_FRESH_VERIFICATION_ELAPSED_MS)
        or (evidence[0] == "cached" and evidence[1] <= max_cached_age_ms)
    )


def has_fresh_policy_pass(stdout: str, stderr: str) -> bool:
    """Require the current command to perform, and report, a verification pass."""
    evidence = policy_pass_evidence(stdout, stderr)
    return (evidence is not None and evidence[0] == "fresh"
            and evidence[1] <= MAX_FRESH_VERIFICATION_ELAPSED_MS)


def run_pnpm_checked(command: tuple[str, ...], *, cwd, env=None, timeout: int, stage: str):
    try:
        return subprocess.run(command, cwd=cwd, env=env, check=True, capture_output=True,
                              text=True, timeout=timeout)
    except subprocess.CalledProcessError as exc:
        category = pnpm_failure_category((exc.stdout or "") + "\n" + (exc.stderr or ""))
        safe_stage = f"preverify-{stage.split()[-1]}"
        raise PnpmStepRejected(safe_stage, category, exc.returncode) from None
    except subprocess.TimeoutExpired as exc:
        raise BuilderRejected(f"pnpm {stage} timed out") from None
