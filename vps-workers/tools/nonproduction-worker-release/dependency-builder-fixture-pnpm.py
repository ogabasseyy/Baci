#!/usr/bin/env python3
"""Secretless pnpm observer used only by the disposable systemd fixture."""
from __future__ import annotations

import json
import hashlib
import os
import re
import stat
import sys
from pathlib import Path
from typing import Sequence

FIXTURE_ERROR_NAME = ".fixture-pnpm-diagnostic.json"
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


def summarize_failure(output: str) -> dict[str, object]:
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
    return {
        "schema": 1,
        "error_code": "ERR_PNPM_TRUST_DOWNGRADE" if trust_failure else "OTHER_PNPM_ERROR",
        "fixture_package": fixture_package,
        "package_coordinate_sha256": coordinate_hash,
        "trust_evidence_transition": transition if trust_failure else "not-applicable",
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


def _diagnostic_path(argv: Sequence[str]) -> Path | None:
    try:
        index = argv.index("--store-dir")
        store = Path(argv[index + 1])
        info = store.lstat()
    except (ValueError, IndexError, OSError):
        return None
    if (store.name != "pnpm-store" or not stat.S_ISDIR(info.st_mode)
            or store.is_symlink() or info.st_uid != os.geteuid()):
        return None
    parent = store.parent
    try:
        parent_info = parent.lstat()
    except OSError:
        return None
    if (not parent.name.startswith("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.")
            or not stat.S_ISDIR(parent_info.st_mode) or parent_info.st_uid != os.geteuid()
            or parent_info.st_mode & 0o077):
        return None
    return parent / FIXTURE_ERROR_NAME


def _write_diagnostic(path: Path | None, value: dict[str, object]) -> None:
    if path is None:
        return
    try:
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600)
    except FileExistsError:
        return
    try:
        payload = (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode("ascii")
        view = memoryview(payload)
        while view:
            written = os.write(fd, view)
            if written <= 0:
                raise OSError("short write")
            view = view[written:]
        os.fsync(fd)
    finally:
        os.close(fd)


def read_diagnostic(path: Path, *, owner_uid: int) -> dict[str, object] | None:
    parent_fd = None
    try:
        parent_fd = os.open(path.parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0)
                            | getattr(os, "O_NOFOLLOW", 0))
    except OSError:
        return None
    try:
        return _read_diagnostic_at(parent_fd, path.name, owner_uid=owner_uid)
    finally:
        os.close(parent_fd)


def _read_diagnostic_at(directory_fd: int, name: str, *, owner_uid: int) -> dict[str, object] | None:
    try:
        fd = os.open(name, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0), dir_fd=directory_fd)
    except OSError:
        return None
    try:
        info = os.fstat(fd)
        if (not stat.S_ISREG(info.st_mode) or info.st_uid != owner_uid or info.st_nlink != 1
                or info.st_mode & 0o077 or info.st_size > 256):
            return None
        value = json.loads(os.read(fd, 257))
        if (not isinstance(value, dict) or set(value) != {
                "schema", "error_code", "fixture_package", "package_coordinate_sha256",
                "trust_evidence_transition"}
                or value["schema"] != 1
                or value["error_code"] not in {"ERR_PNPM_TRUST_DOWNGRADE", "OTHER_PNPM_ERROR"}
                or value["fixture_package"] not in {"tsx", "dotenv", "unknown", "not-applicable"}
                or value["package_coordinate_sha256"] not in {"unreported", "not-applicable"}
                and not re.fullmatch(r"[0-9a-f]{64}", str(value["package_coordinate_sha256"]))
                or value["trust_evidence_transition"] not in {
                    "trusted-publisher-to-provenance", "trusted-publisher-to-none",
                    "provenance-to-none", "unreported", "unrecognized", "not-applicable",
                }
                or (value["error_code"] == "ERR_PNPM_TRUST_DOWNGRADE"
                    and (value["trust_evidence_transition"] == "not-applicable"
                         or value["fixture_package"] == "not-applicable"
                         or value["package_coordinate_sha256"] == "not-applicable"))
                or (value["error_code"] == "OTHER_PNPM_ERROR"
                    and (value["trust_evidence_transition"] != "not-applicable"
                         or value["fixture_package"] != "not-applicable"
                         or value["package_coordinate_sha256"] != "not-applicable"))):
            return None
        return value
    except (OSError, ValueError, TypeError):
        return None
    finally:
        os.close(fd)


def read_scratch_diagnostic(scratch: Path, *, build_root: Path, expected_sha: str,
                            owner_uid: int, build_root_uid: int = 0) -> dict[str, object] | None:
    """Read only the diagnostic in the builder-owned per-release scratch."""
    scratch = Path(scratch)
    build_root = Path(build_root)
    root_fd = None
    scratch_fd = None
    try:
        root_fd = os.open(build_root, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0)
                          | getattr(os, "O_NOFOLLOW", 0))
        root_info = os.fstat(root_fd)
        scratch_fd = os.open(scratch.name, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0)
                             | getattr(os, "O_NOFOLLOW", 0), dir_fd=root_fd)
        scratch_info = os.fstat(scratch_fd)
    except OSError:
        return None
    try:
        if (scratch.parent != build_root or not scratch.name.startswith(f"{expected_sha}.")
            or not stat.S_ISDIR(root_info.st_mode) or root_info.st_uid != build_root_uid
            or not stat.S_ISDIR(scratch_info.st_mode) or scratch_info.st_uid != owner_uid
            or stat.S_IMODE(scratch_info.st_mode) != 0o700):
            return None
        return _read_diagnostic_at(scratch_fd, FIXTURE_ERROR_NAME, owner_uid=owner_uid)
    finally:
        if scratch_fd is not None:
            os.close(scratch_fd)
        if root_fd is not None:
            os.close(root_fd)


def main(argv: Sequence[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if len(args) < 1:
        return 125
    entrypoint, *pnpm_args = args
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    try:
        from worker_release_bounded_process import run_bounded_capture
        result = run_bounded_capture(("/usr/bin/node", entrypoint, *pnpm_args),
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
    summary = summarize_failure(f"{result.stdout}\n{result.stderr}")
    _write_diagnostic(_diagnostic_path(pnpm_args), summary)
    if summary["error_code"] == "ERR_PNPM_TRUST_DOWNGRADE":
        print("ERR_PNPM_TRUST_DOWNGRADE", file=sys.stderr)
    else:
        print("PNPM_FIXTURE_COMMAND_FAILED", file=sys.stderr)
    return min(max(result.returncode, 1), 255)


if __name__ == "__main__":
    raise SystemExit(main())
