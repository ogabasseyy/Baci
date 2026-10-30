#!/usr/bin/env python3
"""Redacted, fixed-category diagnostics for pnpm preverification failures."""
from __future__ import annotations

import json
import os
import re
import stat
from decimal import Decimal, InvalidOperation, ROUND_CEILING
from pathlib import Path

from worker_release_dependency_artifacts import BuilderRejected
from worker_release_dependency_evidence_shape import (
    format_policy_line_shapes,
    safe_errno_category,
    summarize_line_shape,
    validate_evidence_summary as _validate_evidence_summary,
    validate_os_error,
)

DIAGNOSTIC_STAGES = frozenset({
    "policy-preverify", "preverify-web-install", "preverify-worker-install", "web-install", "web-deploy", "worker-install",
})
DIAGNOSTIC_CATEGORIES = frozenset({
    "lockfile-trust-downgrade", "minimum-release-age", "frozen-lockfile-mismatch",
    "registry-network", "registry-response", "lockfile-policy", "unsupported-pnpm-option",
    "filesystem-access", "dependency-resolution", "pnpm-exit", "policy-rejected",
    "filesystem-error", "preverify-timeout", "operation-error", "policy-pass-marker-missing",
    "filesystem-no-space", "filesystem-permission", "filesystem-missing", "filesystem-read-only",
    "filesystem-descriptor-limit", "filesystem-memory", "filesystem-exists", "filesystem-loop",
    "filesystem-not-directory", "filesystem-io",
    "registry-policy", "source-policy-invalid", "metadata-cache-bound", "metadata-cache-invalid",
    "pnpm-version-mismatch", "source-policy-mutated",
    "policy-cache-not-fresh",
    "pnpm-output-limit",
})
POLICY_PASS_MARKER = "Lockfile passes supply-chain policies"
_ANSI_ESCAPE = re.compile(r"\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))")
_POLICY_PASS_FRESH = re.compile(
    r"^\s*✓\s+Lockfile passes supply-chain policies \(([0-9]+) entr(?:y|ies) in (.+)\)\s*$"
)
_POLICY_PASS_CACHED = re.compile(
    r"^\s*✓\s+Lockfile passes supply-chain policies \(verified ([0-9]+(?:\.[0-9]+)?(?:ms|s|m|h|d|y)) ago\)\s*$"
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
            elapsed = _parse_pretty_ms(fresh.group(2)) if fresh else None
            if (fresh and len(fresh.group(1)) <= 9 and int(fresh.group(1)) > 0
                    and elapsed is not None):
                evidence = ("fresh", elapsed)
            elif cached:
                age = _parse_pretty_ms(cached.group(1), compact=True)
                if age is None:
                    continue
                evidence = ("cached", age)
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
                     evidence: dict[str, object] | None = None,
                     os_error: dict[str, object] | None = None) -> None:
    safe_stage = stage if stage in DIAGNOSTIC_STAGES else "policy-preverify"
    safe_category = category if category in DIAGNOSTIC_CATEGORIES else "operation-error"
    value = {"stage": safe_stage, "category": safe_category,
             "exit_code": exit_code if isinstance(exit_code, int) and 0 <= exit_code <= 255 else None}
    if evidence is not None:
        value["evidence"] = _validate_evidence_summary(evidence)
    if os_error is not None:
        value["os_error"] = validate_os_error(os_error)
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
        allowed = {"stage", "category", "exit_code"}
        if not isinstance(value, dict) or not allowed.issubset(value) or set(value) - (
                allowed | {"evidence", "os_error"}):
            return None
        if (value["stage"] not in DIAGNOSTIC_STAGES
                or value["category"] not in DIAGNOSTIC_CATEGORIES
                or (value["exit_code"] is not None and (type(value["exit_code"]) is not int
                    or not 0 <= value["exit_code"] <= 255))):
            return None
        if "evidence" in value:
            value["evidence"] = _validate_evidence_summary(value["evidence"])
        if "os_error" in value:
            value["os_error"] = validate_os_error(value["os_error"])
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
            if POLICY_PASS_MARKER not in line:
                continue
            # Any marker-bearing line must be a single valid claim. Do not
            # accept a good line alongside malformed or duplicate output.
            if evidence is not None:
                return None
            fresh = _POLICY_PASS_FRESH.fullmatch(line)
            elapsed = _parse_pretty_ms(fresh.group(2)) if fresh else None
            if fresh:
                if (len(fresh.group(1)) > 9 or int(fresh.group(1)) <= 0
                        or elapsed is None):
                    return None
                current = ("fresh", elapsed)
            else:
                cached = _POLICY_PASS_CACHED.fullmatch(line)
                if not cached:
                    return None
                age = _parse_pretty_ms(cached.group(1), compact=True)
                if age is None:
                    return None
                current = ("cached", age)
            evidence = current
    return evidence


_PRETTY_MS_PART = re.compile(r"([0-9]+(?:\.[0-9]+)?)(ms|s|m|h|d|y)")
_PRETTY_MS_FACTORS = {"ms": 1, "s": 1000, "m": 60_000, "h": 3_600_000,
                      "d": 86_400_000, "y": 31_536_000_000}


def _parse_pretty_ms(value: str, *, compact: bool = False) -> int | None:
    """Parse pinned pretty-ms units with strict order and no unrecognized text."""
    if len(value) > 96:
        return None
    parts = value.split(" ")
    if not parts or len(parts) > (1 if compact else 6):
        return None
    total = Decimal(0)
    previous_rank = -1
    seen: set[str] = set()
    ranks = {unit: index for index, unit in enumerate(("y", "d", "h", "m", "s", "ms"))}
    for part in parts:
        match = _PRETTY_MS_PART.fullmatch(part)
        if not match:
            return None
        amount, unit = match.groups()
        if (len(amount) > 12 or unit in seen or ranks[unit] <= previous_rank
                or ("." in amount and (unit != "s" or compact))):
            return None
        try:
            total += Decimal(amount) * _PRETTY_MS_FACTORS[unit]
        except InvalidOperation:
            return None
        seen.add(unit)
        previous_rank = ranks[unit]
    return int(total.to_integral_value(rounding=ROUND_CEILING))


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
