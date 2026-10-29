"""Fixed-enum pnpm failure classification for the disposable fixture."""
from __future__ import annotations

import hashlib
import re
from pathlib import Path
from typing import Sequence

_ANSI = re.compile(r"\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))")
_TRUST_TRANSITIONS = {
    "trusted publisher|provenance attestation": "trusted-publisher-to-provenance",
    "trusted publisher|no trust evidence": "trusted-publisher-to-none",
    "provenance attestation|no trust evidence": "provenance-to-none",
}
_TRUST_TRANSITION = re.compile(
    r"earlier versions had (trusted publisher|provenance attestation), "
    r"but this version has (trusted publisher|provenance attestation|no trust evidence)"
)
_ESBUILD_PLATFORMS = (
    "aix-ppc64", "android-arm64", "android-arm", "android-x64", "darwin-arm64",
    "darwin-x64", "freebsd-arm64", "freebsd-x64", "linux-arm64", "linux-arm",
    "linux-ia32", "linux-loong64", "linux-mips64el", "linux-ppc64", "linux-riscv64",
    "linux-s390x", "linux-x64", "netbsd-arm64", "netbsd-x64", "openbsd-arm64",
    "openbsd-x64", "sunos-x64", "win32-arm64", "win32-ia32", "win32-x64",
)
_FIXTURE_PACKAGES = {
    "tsx@4.22.4": "tsx",
    "dotenv@16.6.1": "dotenv",
    "esbuild@0.28.1": "esbuild",
    "fsevents@2.3.3": "fsevents",
    **{f"@esbuild/{platform}@0.28.1": "esbuild-platform-binary"
       for platform in _ESBUILD_PLATFORMS},
}
_TRUST_HEADLINE = re.compile(
    r'high-risk trust downgrade for (?:\\?")'
    r'((?:@[a-z0-9._-]+/)?[a-z0-9._-]+@[0-9][a-z0-9.+-]{0,63})'
    r'(?:\\?") \(possible package takeover\)'
)
_FIXTURE_STAGES = {
    "version-check", "web-install", "web-deploy", "worker-install", "unknown",
}
_FIXTURE_NETWORK_MODES = {"offline", "online", "unknown"}
_FIXTURE_INJECTION_MODES = {"enabled", "disabled", "unknown"}


def _fixture_stage(pnpm_args: Sequence[str], cwd: Path) -> str:
    """Classify only the fixed synthetic pnpm command shapes."""
    args = tuple(pnpm_args)
    if args == ("--version",):
        return "version-check"
    if "deploy" in args and "@baci/web" in args:
        return "web-deploy"
    if "install" in args:
        if "@baci/web..." in args:
            return "web-install"
        if cwd.name == "vps-workers":
            return "worker-install"
    return "unknown"


def _fixture_network_mode(pnpm_args: Sequence[str], env: dict[str, str]) -> str:
    if "--offline" in pnpm_args or env.get("PNPM_CONFIG_OFFLINE") == "true":
        return "offline"
    if env.get("PNPM_CONFIG_OFFLINE") == "false":
        return "online"
    return "unknown"


def _fixture_injection_mode(env: dict[str, str]) -> str:
    value = env.get("PNPM_CONFIG_INJECT_WORKSPACE_PACKAGES")
    return {"true": "enabled", "false": "disabled"}.get(value, "unknown")


def summarize_failure(output: str, *, pnpm_args: Sequence[str] = (),
                      cwd: Path | None = None,
                      env: dict[str, str] | None = None) -> dict[str, object]:
    """Return only a bounded, non-sensitive classification of fixture output."""
    sample = _ANSI.sub("", output[:1_048_576]).lower()
    trust_failure = "err_pnpm_trust_downgrade" in sample
    normalized = re.sub(r"\s+", " ", sample)
    match = _TRUST_TRANSITION.search(normalized) if trust_failure else None
    headline = _TRUST_HEADLINE.search(normalized) if trust_failure else None
    coordinate = headline.group(1) if headline else None
    coordinate_hash = hashlib.sha256(coordinate.encode("ascii")).hexdigest() if coordinate else (
        "unreported" if trust_failure else "not-applicable"
    )
    fixture_package = _FIXTURE_PACKAGES.get(coordinate, "unknown") if coordinate else (
        "unknown" if trust_failure else "not-applicable"
    )
    transition = "unrecognized" if "earlier versions had" in normalized else "unreported"
    if match:
        transition = _TRUST_TRANSITIONS.get("|".join(match.groups()), "unrecognized")
    headline_state = (
        "recognized" if headline else
        "present-unparsed" if "high-risk trust downgrade for" in normalized else
        "absent"
    )
    hint_state = (
        "recognized" if transition in _TRUST_TRANSITIONS.values() else
        "unrecognized" if match else
        "intro-unparsed" if "earlier versions had" in normalized else
        "absent"
    )
    command_env = {} if env is None else env
    return {
        "schema": 1,
        "fixture_stage": _fixture_stage(pnpm_args, Path.cwd() if cwd is None else cwd),
        "fixture_network": _fixture_network_mode(pnpm_args, command_env),
        "fixture_injection": _fixture_injection_mode(command_env),
        "error_code": "ERR_PNPM_TRUST_DOWNGRADE" if trust_failure else "OTHER_PNPM_ERROR",
        "fixture_package": fixture_package,
        "package_coordinate_sha256": coordinate_hash,
        "trust_evidence_transition": transition if trust_failure else "not-applicable",
        "trust_headline_state": headline_state if trust_failure else "not-applicable",
        "trust_hint_state": hint_state if trust_failure else "not-applicable",
    }


def safe_success_output(stdout: str, stderr: str) -> str:
    """Keep exact version output and a strictly parsed canonical policy marker."""
    output = _ANSI.sub("", f"{stdout}\n{stderr}")
    version_lines = [line.strip() for line in output.splitlines() if line.strip() == "11.7.0"]
    marker_lines = [line for line in output.splitlines()
                    if "Lockfile passes supply-chain policies" in line]
    if len(version_lines) > 1 or len(marker_lines) > 1:
        return ""
    lines = list(version_lines)
    if marker_lines:
        from worker_release_dependency_diagnostics import (
            MAX_FRESH_VERIFICATION_ELAPSED_MS,
            MAX_RECENT_VERIFICATION_AGE_MS,
            _POLICY_PASS_CACHED,
            _POLICY_PASS_FRESH,
            _parse_pretty_ms,
        )

        marker = marker_lines[0]
        fresh = _POLICY_PASS_FRESH.fullmatch(marker)
        cached = _POLICY_PASS_CACHED.fullmatch(marker)
        if fresh and len(fresh.group(1)) <= 9 and int(fresh.group(1)) > 0:
            elapsed = _parse_pretty_ms(fresh.group(2))
            if elapsed is None or elapsed > MAX_FRESH_VERIFICATION_ELAPSED_MS:
                return ""
            count = int(fresh.group(1))
            noun = "entry" if count == 1 else "entries"
            lines.append(
                f"✓ Lockfile passes supply-chain policies ({count} {noun} in {fresh.group(2)})"
            )
        elif cached:
            age = _parse_pretty_ms(cached.group(1), compact=True)
            if age is None or age > MAX_RECENT_VERIFICATION_AGE_MS:
                return ""
            lines.append(
                f"✓ Lockfile passes supply-chain policies (verified {cached.group(1)} ago)"
            )
        else:
            return ""
    return "\n".join(lines)
