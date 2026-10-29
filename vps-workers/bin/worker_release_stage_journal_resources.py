"""Bounded journal-owned source/result resource handling for staging."""
from __future__ import annotations

import os
import shutil
import stat
from pathlib import Path
from typing import Any, Callable

from worker_release_stage_journal_io import StageJournalError, reject

MAX_RESOURCE_ENTRIES = 500_000
MAX_RESOURCE_BYTES = 2 * 1024 * 1024 * 1024
MAX_RESOURCE_DEPTH = 128


class StageResources:
    """Manage two fixed-name resources beneath one pinned private root."""

    KINDS = ("source", "result")

    def __init__(self, root: Path | None, root_fd: int | None, owner_uid: int,
                 resource_uid: int, stage_uid: int, stage_gid: int,
                 write: Callable[[dict[str, Any]], None]):
        self.root = root
        self.fd = root_fd
        self.owner_uid = owner_uid
        self.resource_uid = resource_uid
        self.stage_uid = stage_uid
        self.stage_gid = stage_gid
        self.write = write

    def journal_fields(self, sha: str, txid: str) -> dict[str, Any]:
        if self.fd is None:
            return {"resource_root_dev": None, "resource_root_ino": None,
                    "resource_root_uid": None,
                    **{f"{kind}_{field}": None for kind in self.KINDS
                       for field in ("name", "dev", "ino")},
                    **{f"{kind}_state": "disabled" for kind in self.KINDS}}
        info = os.fstat(self.fd)
        fields = {"resource_root_dev": info.st_dev, "resource_root_ino": info.st_ino,
                  "resource_root_uid": info.st_uid}
        for kind in self.KINDS:
            fields.update({f"{kind}_name": f".{sha}.{kind}.{txid}",
                           f"{kind}_dev": None, f"{kind}_ino": None,
                           f"{kind}_state": "reserved"})
        return fields

    def create(self, value: dict[str, Any], kind: str) -> Path:
        name, dev, ino, state = self._fields(value, kind)
        if self.fd is None or state != "reserved" or dev is not None or ino is not None:
            reject("stage resource is not reserved for creation")
        os.mkdir(name, 0o700, dir_fd=self.fd)
        os.fsync(self.fd)
        fd = -1
        try:
            fd = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=self.fd)
            resource_gid = os.fstat(self.fd).st_gid
            os.fchown(fd, self.resource_uid, resource_gid)
            os.fchmod(fd, 0o700)
            os.fsync(fd)
            info = os.fstat(fd)
            if (info.st_uid != self.resource_uid or info.st_gid != resource_gid
                    or stat.S_IMODE(info.st_mode) != 0o700):
                reject("stage resource root ownership or mode is unsafe")
            value[f"{kind}_dev"], value[f"{kind}_ino"] = info.st_dev, info.st_ino
            value[f"{kind}_state"] = "created"
            self.write(value)
            return self.root / name
        finally:
            if fd >= 0:
                os.close(fd)

    def remove(self, value: dict[str, Any], kind: str, *, allow_empty_unrecorded: bool = False) -> None:
        name, dev, ino, state = self._fields(value, kind)
        if self.fd is None or state == "disabled":
            return
        try:
            entry = os.stat(name, dir_fd=self.fd, follow_symlinks=False)
        except FileNotFoundError:
            if state != "removed":
                value[f"{kind}_state"] = "removed"
                self.write(value)
            return
        if state == "reserved" and dev is None and ino is None:
            if not allow_empty_unrecorded:
                reject("unrecorded stage resource is not eligible for cleanup")
            root_gid = os.fstat(self.fd).st_gid
            fd = self._open_exact(name, expected_dev=None, expected_ino=None,
                                  expected_uid=self.resource_uid,
                                  expected_gid=(root_gid, self.stage_gid))
            try:
                info = os.fstat(fd)
                if stat.S_IMODE(info.st_mode) != 0o700 or os.listdir(fd):
                    reject("unrecorded stage resource is not an empty private directory")
            finally:
                os.close(fd)
            # A reserved name is journaled before mkdir; this gap is allowed
            # to remove only an empty directory with exact owner/mode by rmdir.
            os.rmdir(name, dir_fd=self.fd)
        else:
            if state not in ("created", "transfer", "frozen", "removed") or dev is None or ino is None:
                reject("stage resource journal identity is incomplete")
            if (entry.st_dev, entry.st_ino) != (dev, ino):
                reject("stage resource inode changed")
            expected_uid, expected_gid = self._expected_owner(kind, state)
            fd = self._open_exact(name, expected_dev=dev, expected_ino=ino,
                                  expected_uid=expected_uid, expected_gid=expected_gid)
            try:
                self._check_tree_bounds(fd)
            finally:
                os.close(fd)
            if not shutil.rmtree.avoids_symlink_attacks:
                reject("safe stage resource cleanup is unavailable")
            shutil.rmtree(name, dir_fd=self.fd)
            if self._exists(name):
                reject("stage resource remains after cleanup")
        os.fsync(self.fd)
        value[f"{kind}_state"] = "removed"
        self.write(value)

    def recover(self, value: dict[str, Any], *, quiescence_proven: bool) -> None:
        if self.fd is None:
            if value.get("resource_root_dev") is not None:
                reject("stage resource root is unavailable")
            return
        root_info = os.fstat(self.fd)
        if (root_info.st_dev, root_info.st_ino) != (
                value.get("resource_root_dev"), value.get("resource_root_ino")):
            reject("stage resource root inode changed")
        exists = any(self._exists(self._fields(value, kind)[0]) for kind in self.KINDS
                     if value.get(f"{kind}_state") != "disabled")
        if exists and not quiescence_proven:
            reject("stage resource cleanup requires process-quiescence proof")
        for kind in self.KINDS:
            self.remove(value, kind, allow_empty_unrecorded=True)

    def assert_removed(self, value: dict[str, Any]) -> None:
        for kind in self.KINDS:
            name, _dev, _ino, state = self._fields(value, kind)
            if state == "disabled":
                continue
            if state != "removed" or self._exists(name):
                reject("journal-owned stage resources must be removed before commit")

    def _fields(self, value: dict[str, Any], kind: str) -> tuple[str, int | None, int | None, str]:
        if kind not in self.KINDS:
            reject("unknown stage resource kind")
        return (value[f"{kind}_name"], value[f"{kind}_dev"], value[f"{kind}_ino"],
                value[f"{kind}_state"])

    def begin_transfer(self, value: dict[str, Any]) -> None:
        name, dev, ino, state = self._fields(value, "source")
        if state != "created" or dev is None or ino is None:
            reject("source resource is not ready for ownership transfer")
        fd = self._open_exact(name, expected_dev=dev, expected_ino=ino,
                              expected_uid=self.resource_uid,
                              expected_gid=os.fstat(self.fd).st_gid)
        os.close(fd)
        value["source_state"] = "transfer"
        self.write(value)

    def mark_frozen(self, value: dict[str, Any]) -> None:
        name, dev, ino, state = self._fields(value, "source")
        if state != "transfer" or dev is None or ino is None:
            reject("source resource is not in ownership transfer")
        fd = self._open_exact(name, expected_dev=dev, expected_ino=ino,
                              expected_uid=self.resource_uid, expected_gid=self.stage_gid)
        try:
            if stat.S_IMODE(os.fstat(fd).st_mode) != 0o550:
                reject("frozen source resource mode is unsafe")
        finally:
            os.close(fd)
        value["source_state"] = "frozen"
        self.write(value)

    def _expected_owner(self, kind: str, state: str) -> tuple[int | tuple[int, ...], int | tuple[int, ...]]:
        if kind == "source" and state == "frozen":
            return self.resource_uid, self.stage_gid
        if kind == "source" and state == "transfer":
            return self.resource_uid, (os.fstat(self.fd).st_gid, self.stage_gid)
        return self.resource_uid, os.fstat(self.fd).st_gid

    def _open_exact(self, name: str, *, expected_dev: int | None, expected_ino: int | None,
                    expected_uid: int | tuple[int, ...],
                    expected_gid: int | tuple[int, ...] | None = None) -> int:
        try:
            fd = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=self.fd)
        except OSError as error:
            raise StageJournalError("journal-owned stage resource is unavailable or unsafe") from error
        info = os.fstat(fd)
        expected_group = self.stage_gid if expected_gid is None else expected_gid
        allowed_groups = ((expected_group,) if isinstance(expected_group, int) else expected_group)
        allowed_uids = ((expected_uid,) if isinstance(expected_uid, int) else expected_uid)
        if (not stat.S_ISDIR(info.st_mode) or info.st_uid not in allowed_uids
                or info.st_gid not in allowed_groups or info.st_mode & 0o022
                or (expected_dev is not None and (info.st_dev, info.st_ino) != (expected_dev, expected_ino))):
            os.close(fd)
            reject("journal-owned stage resource ownership or inode changed")
        return fd

    def _exists(self, name: str) -> bool:
        try:
            os.stat(name, dir_fd=self.fd, follow_symlinks=False)
            return True
        except FileNotFoundError:
            return False

    @staticmethod
    def _check_tree_bounds(root_fd: int) -> None:
        pending = [(os.dup(root_fd), 0)]
        entries = total_bytes = 0
        try:
            while pending:
                directory_fd, depth = pending.pop()
                try:
                    if depth > MAX_RESOURCE_DEPTH:
                        reject("journal-owned stage resource exceeds depth limit")
                    for name in os.listdir(directory_fd):
                        if name in ("", ".", "..") or "/" in name or "\\" in name:
                            reject("journal-owned stage resource has an invalid name")
                        entries += 1
                        if entries > MAX_RESOURCE_ENTRIES:
                            reject("journal-owned stage resource exceeds entry limit")
                        info = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
                        if stat.S_ISDIR(info.st_mode):
                            child = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                                            dir_fd=directory_fd)
                            opened = os.fstat(child)
                            if (opened.st_dev, opened.st_ino) != (info.st_dev, info.st_ino):
                                os.close(child)
                                reject("journal-owned stage resource changed during cleanup check")
                            pending.append((child, depth + 1))
                        elif stat.S_ISREG(info.st_mode) or stat.S_ISLNK(info.st_mode):
                            total_bytes += info.st_size
                            if total_bytes > MAX_RESOURCE_BYTES:
                                reject("journal-owned stage resource exceeds byte limit")
                        else:
                            reject("journal-owned stage resource contains a special file")
                finally:
                    os.close(directory_fd)
        except BaseException:
            for directory_fd, _depth in pending:
                os.close(directory_fd)
            raise


__all__ = ["MAX_RESOURCE_BYTES", "MAX_RESOURCE_ENTRIES", "StageResources"]
