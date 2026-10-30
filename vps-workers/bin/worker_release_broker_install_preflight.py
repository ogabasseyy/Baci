"""Exact existing-file checks before any stable installer write."""
from __future__ import annotations

import grp
import os
import stat
from pathlib import Path
from typing import Callable, Iterable, Protocol


class ProtectedInstallFile(Protocol):
    destination: Path
    content: bytes
    mode: int
    group: str


def preflight_install_files(files: Iterable[ProtectedInstallFile], *,
                           read_existing: Callable[[Path], tuple[bytes, os.stat_result] | None]) -> None:
    """Reject unknown installed bytes/metadata before the caller writes any file."""
    for file in files:
        existing = read_existing(file.destination)
        if existing is None:
            continue
        content, metadata = existing
        expected_gid = grp.getgrnam(file.group).gr_gid
        if (content != file.content or metadata.st_uid != 0
                or metadata.st_gid != expected_gid
                or stat.S_IMODE(metadata.st_mode) != file.mode):
            raise RuntimeError("existing protected file is not an exact recognized install")


def prove_active_install_compatible(files: Iterable[ProtectedInstallFile], *,
                                    current_digest: str | None, control,
                                    read_existing: Callable[[Path], tuple[bytes, os.stat_result] | None]) -> bool:
    complete = all(read_existing(file.destination) is not None for file in files)
    return control.prove_installation_safe(current_digest=current_digest,
                                           stable_files_complete=complete)


def install_stable_files(files: Iterable[ProtectedInstallFile], *, current_digest: str | None,
                         control, read_existing: Callable[[Path], tuple[bytes, os.stat_result] | None],
                         writer: Callable[[ProtectedInstallFile], None]) -> None:
    records = tuple(files)
    prove_active_install_compatible(records, current_digest=current_digest,
                                    control=control, read_existing=read_existing)
    preflight_install_files(records, read_existing=read_existing)
    for record in records:
        writer(record)


__all__ = ["install_stable_files", "preflight_install_files",
           "prove_active_install_compatible"]
