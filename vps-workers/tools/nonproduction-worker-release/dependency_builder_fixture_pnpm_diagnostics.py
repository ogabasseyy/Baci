"""Bounded diagnostic sidecar I/O for the disposable pnpm fixture."""
from __future__ import annotations

import json
import os
import re
import stat
import sys
from pathlib import Path
from typing import Sequence

from dependency_builder_fixture_pnpm_classification import (
    _FIXTURE_INJECTION_MODES, _FIXTURE_NETWORK_MODES, _FIXTURE_PACKAGES,
    _FIXTURE_STAGES, _TRUST_TRANSITIONS,
)

FIXTURE_ERROR_NAME = ".fixture-pnpm-diagnostic.json"

def _diagnostic_path_state(argv: Sequence[str], *, env: dict[str, str] | None = None
                           ) -> tuple[Path | None, str]:
    command_env = os.environ if env is None else env
    try:
        store_values = [argv[index + 1] for index, value in enumerate(argv[:-1])
                        if value == "--store-dir"]
        store_values.extend(value.split("=", 1)[1] for value in argv
                            if value.startswith("--store-dir="))
        configured = command_env.get("PNPM_CONFIG_STORE_DIR")
        if configured:
            store_values.append(configured)
        if not store_values:
            return None, "store-config-missing"
        if len(set(store_values)) != 1:
            return None, "store-config-conflict"
        store = Path(store_values[0])
        info = store.lstat()
    except (IndexError, OSError):
        return None, "store-unavailable"
    if store.name != "pnpm-store" or not stat.S_ISDIR(info.st_mode) or store.is_symlink():
        return None, "store-shape-invalid"
    if info.st_uid != os.geteuid():
        return None, "store-owner-mismatch"
    parent = store.parent
    try:
        parent_info = parent.lstat()
    except OSError:
        return None, "scratch-unavailable"
    if not parent.name.startswith("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa."):
        return None, "scratch-name-mismatch"
    if not stat.S_ISDIR(parent_info.st_mode):
        return None, "scratch-shape-invalid"
    if parent_info.st_uid != os.geteuid():
        return None, "scratch-owner-mismatch"
    if parent_info.st_mode & 0o077:
        return None, "scratch-mode-mismatch"
    return parent / FIXTURE_ERROR_NAME, "path-accepted"


def _diagnostic_path(argv: Sequence[str], *, env: dict[str, str] | None = None) -> Path | None:
    return _diagnostic_path_state(argv, env=env)[0]


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
                or info.st_mode & 0o077 or info.st_size > 512):
            return None
        value = json.loads(os.read(fd, 513))
        if (not isinstance(value, dict) or set(value) != {
                "schema", "fixture_stage", "fixture_network", "fixture_injection",
                "error_code", "fixture_package", "package_coordinate_sha256",
                "trust_evidence_transition", "trust_headline_state", "trust_hint_state"}
                or value["schema"] != 1
                or value["fixture_stage"] not in _FIXTURE_STAGES
                or value["fixture_network"] not in _FIXTURE_NETWORK_MODES
                or value["fixture_injection"] not in _FIXTURE_INJECTION_MODES
                or value["error_code"] not in {"ERR_PNPM_TRUST_DOWNGRADE", "OTHER_PNPM_ERROR"}
                or value["fixture_package"] not in {
                    "tsx", "dotenv", "esbuild", "fsevents", "esbuild-platform-binary",
                    "unknown", "not-applicable"}
                or value["package_coordinate_sha256"] not in {"unreported", "not-applicable"}
                and not re.fullmatch(r"[0-9a-f]{64}", str(value["package_coordinate_sha256"]))
                or value["trust_evidence_transition"] not in {
                    "trusted-publisher-to-provenance", "trusted-publisher-to-none",
                    "provenance-to-none", "unreported", "unrecognized", "not-applicable",
                }
                or value["trust_headline_state"] not in {
                    "recognized", "present-unparsed", "absent", "not-applicable"}
                or value["trust_hint_state"] not in {
                    "recognized", "unrecognized", "intro-unparsed", "absent", "not-applicable"}
                or (value["trust_hint_state"] == "recognized"
                    and value["trust_evidence_transition"] not in _TRUST_TRANSITIONS.values())
                or (value["trust_hint_state"] in {"unrecognized", "intro-unparsed"}
                    and value["trust_evidence_transition"] != "unrecognized")
                or (value["trust_hint_state"] == "absent"
                    and value["trust_evidence_transition"] != "unreported")
                or (value["error_code"] == "ERR_PNPM_TRUST_DOWNGRADE"
                    and (value["trust_evidence_transition"] == "not-applicable"
                         or value["trust_headline_state"] == "not-applicable"
                         or value["trust_hint_state"] == "not-applicable"
                         or value["fixture_package"] == "not-applicable"
                         or value["package_coordinate_sha256"] == "not-applicable"))
                or (value["error_code"] == "OTHER_PNPM_ERROR"
                    and (value["trust_evidence_transition"] != "not-applicable"
                         or value["trust_headline_state"] != "not-applicable"
                         or value["trust_hint_state"] != "not-applicable"
                         or value["fixture_package"] != "not-applicable"
                         or value["package_coordinate_sha256"] != "not-applicable"))):
            return None
        return value
    except (OSError, ValueError, TypeError):
        return None
    finally:
        os.close(fd)


def read_scratch_diagnostic_status(scratch: Path, *, build_root: Path, expected_sha: str,
                                   owner_uid: int, build_root_uid: int = 0
                                   ) -> tuple[dict[str, object] | None, str]:
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
        return None, "root-or-scratch-unavailable"
    try:
        if (scratch.parent != build_root or not scratch.name.startswith(f"{expected_sha}.")
            or not stat.S_ISDIR(root_info.st_mode) or root_info.st_uid != build_root_uid
            or not stat.S_ISDIR(scratch_info.st_mode) or scratch_info.st_uid != owner_uid
            or stat.S_IMODE(scratch_info.st_mode) != 0o700):
            return None, "scratch-identity-rejected"
        value = _read_diagnostic_at(scratch_fd, FIXTURE_ERROR_NAME, owner_uid=owner_uid)
        return (value, "sidecar-accepted") if value is not None else (None, "sidecar-rejected-or-absent")
    finally:
        if scratch_fd is not None:
            os.close(scratch_fd)
        if root_fd is not None:
            os.close(root_fd)


def read_scratch_diagnostic(scratch: Path, *, build_root: Path, expected_sha: str,
                            owner_uid: int, build_root_uid: int = 0) -> dict[str, object] | None:
    return read_scratch_diagnostic_status(
        scratch, build_root=build_root, expected_sha=expected_sha,
        owner_uid=owner_uid, build_root_uid=build_root_uid,
    )[0]
