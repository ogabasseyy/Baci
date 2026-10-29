"""Crash record for the root-owned source view passed to the dependency consumer."""
from __future__ import annotations

import json
import os
import re
import shutil
import stat
from pathlib import Path
from typing import Any


class SourceViewRejected(RuntimeError):
    """The consumer source view cannot be safely created or recovered."""


JOURNAL_NAME = "release-source-view-journal.json"
MAX_ENTRIES = 600_000
MAX_BYTES = 2 * 1024 * 1024 * 1024


def _write_record(worker_root: Path, value: dict[str, Any], *, create: bool = False) -> None:
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
    temp = worker_root / f".{JOURNAL_NAME}.{value['transaction_id']}.tmp"
    try:
        fd = os.open(temp, flags, 0o600)
        try:
            data = json.dumps(value, sort_keys=True, separators=(",", ":")).encode("ascii")
            if os.write(fd, data) != len(data):
                raise SourceViewRejected("source view journal write was incomplete")
            os.fsync(fd)
        finally:
            os.close(fd)
        if create:
            os.link(temp, worker_root / JOURNAL_NAME, follow_symlinks=False)
            os.unlink(temp)
        else:
            os.replace(temp, worker_root / JOURNAL_NAME)
        parent_fd = os.open(worker_root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            os.fsync(parent_fd)
        finally:
            os.close(parent_fd)
    except BaseException:
        try:
            os.unlink(temp)
        except FileNotFoundError:
            pass
        raise


def _read_record(worker_root: Path, *, owner_uid: int = 0) -> dict[str, Any] | None:
    path = worker_root / JOURNAL_NAME
    try:
        fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    except FileNotFoundError:
        return None
    except OSError as error:
        raise SourceViewRejected("source view journal is unavailable") from error
    try:
        info = os.fstat(fd)
        if (not stat.S_ISREG(info.st_mode) or info.st_uid != owner_uid or info.st_mode & 0o077
                or info.st_size > 16_384):
            raise SourceViewRejected("source view journal ownership or size is unsafe")
        raw = os.read(fd, info.st_size + 1)
        if len(raw) != info.st_size or os.fstat(fd).st_mtime_ns != info.st_mtime_ns:
            raise SourceViewRejected("source view journal changed while reading")
    finally:
        os.close(fd)
    try:
        value = json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise SourceViewRejected("source view journal is malformed") from error
    if (not isinstance(value, dict) or value.get("schema") != 1
            or not re.fullmatch(r"[0-9a-f]{32}", str(value.get("transaction_id", "")))
            or not re.fullmatch(r"[0-9a-f]{40}", str(value.get("source_sha", "")))
            or not re.fullmatch(r"[0-9a-f]{64}", str(value.get("archive_sha256", "")))
            or value.get("phase") not in ("intent", "copying", "ready")
            or value.get("view_name") != f".source-view.{value.get('transaction_id')}"
            or type(value.get("result_root_dev")) is not int
            or type(value.get("result_root_ino")) is not int
            or (value.get("view_dev") is not None and type(value.get("view_dev")) is not int)
            or (value.get("view_ino") is not None and type(value.get("view_ino")) is not int)):
        raise SourceViewRejected("source view journal fields are invalid")
    return value


def _remove_record_temp(worker_root: Path, transaction_id: str, *, owner_uid: int) -> None:
    name = f".{JOURNAL_NAME}.{transaction_id}.tmp"
    root_fd = os.open(worker_root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        try:
            info = os.stat(name, dir_fd=root_fd, follow_symlinks=False)
        except FileNotFoundError:
            return
        if (not stat.S_ISREG(info.st_mode) or info.st_uid != owner_uid
                or stat.S_IMODE(info.st_mode) != 0o600 or info.st_nlink not in (1, 2)
                or info.st_size > 16_384):
            raise SourceViewRejected("source view temporary journal identity is unsafe")
        os.unlink(name, dir_fd=root_fd)
        os.fsync(root_fd)
    finally:
        os.close(root_fd)


def _root_fd(path: Path, *, owner_uid: int) -> tuple[int, os.stat_result]:
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    info = os.fstat(fd)
    if (not stat.S_ISDIR(info.st_mode) or info.st_uid != owner_uid
            or stat.S_IMODE(info.st_mode) != 0o700):
        os.close(fd)
        raise SourceViewRejected("consumer source root must be owner-private")
    return fd, info


def _tree_usage(fd: int) -> tuple[int, int]:
    pending, entries, total = [(os.dup(fd), 0)], 0, 0
    try:
        while pending:
            directory, depth = pending.pop()
            try:
                if depth > 128:
                    raise SourceViewRejected("source view exceeds depth limit")
                for name in os.listdir(directory):
                    if name in ("", ".", "..") or "/" in name or "\\" in name:
                        raise SourceViewRejected("source view has an invalid entry")
                    info = os.stat(name, dir_fd=directory, follow_symlinks=False)
                    entries += 1
                    total += info.st_size
                    if entries > MAX_ENTRIES or total > MAX_BYTES:
                        raise SourceViewRejected("source view exceeds configured bounds")
                    if stat.S_ISDIR(info.st_mode):
                        child = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                                        dir_fd=directory)
                        if (os.fstat(child).st_dev, os.fstat(child).st_ino) != (info.st_dev, info.st_ino):
                            os.close(child)
                            raise SourceViewRejected("source view changed during traversal")
                        pending.append((child, depth + 1))
                    elif not (stat.S_ISREG(info.st_mode) or stat.S_ISLNK(info.st_mode)):
                        raise SourceViewRejected("source view contains a special file")
            finally:
                os.close(directory)
        return entries, total
    finally:
        for directory, _depth in pending:
            os.close(directory)


class SourceViewJournal:
    """Trusted-owner sidecar for files the dependency consumer owns temporarily."""

    def __init__(self, worker_root: Path, result_root: Path, *, owner_uid: int = 0):
        if os.geteuid() != owner_uid:
            raise SourceViewRejected("source view journal owner identity mismatch")
        self.worker_root, self.result_root, self.owner_uid = Path(worker_root), Path(result_root), owner_uid
        worker = self.worker_root.lstat()
        if not stat.S_ISDIR(worker.st_mode) or worker.st_uid != owner_uid or worker.st_mode & 0o022:
            raise SourceViewRejected("worker root is not trusted for sidecar journaling")
        self.fd, self.root_info = _root_fd(self.result_root, owner_uid=owner_uid)

    def close(self) -> None:
        if self.fd >= 0:
            os.close(self.fd)
            self.fd = -1

    def __enter__(self) -> "SourceViewJournal":
        if self.fd < 0:
            raise SourceViewRejected("source view journal is closed")
        return self

    def __exit__(self, *_exc) -> None:
        self.close()

    def pending_record(self) -> dict[str, Any] | None:
        return _read_record(self.worker_root, owner_uid=self.owner_uid)

    def begin(self, transaction_id: str, fence: dict[str, object], source_sha: str,
              archive_sha256: str) -> Path:
        if not re.fullmatch(r"[0-9a-f]{32}", transaction_id):
            raise SourceViewRejected("source view transaction identity is invalid")
        if os.listdir(self.fd):
            raise SourceViewRejected("builder result root contains unclaimed prior output")
        record = {"schema": 1, "phase": "intent", "transaction_id": transaction_id,
                  "fence": fence, "source_sha": source_sha, "archive_sha256": archive_sha256,
                  "view_name": f".source-view.{transaction_id}",
                  "result_root_dev": self.root_info.st_dev, "result_root_ino": self.root_info.st_ino,
                  "view_dev": None, "view_ino": None}
        _write_record(self.worker_root, record, create=True)
        os.mkdir(record["view_name"], 0o700, dir_fd=self.fd)
        os.fsync(self.fd)
        view_fd = os.open(record["view_name"], os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                          dir_fd=self.fd)
        try:
            info = os.fstat(view_fd)
            record.update(phase="copying", view_dev=info.st_dev, view_ino=info.st_ino)
            _write_record(self.worker_root, record)
        finally:
            os.close(view_fd)
        return self.result_root / record["view_name"]

    def mark_ready(self) -> None:
        record = _read_record(self.worker_root, owner_uid=self.owner_uid)
        if record is None or record["phase"] != "copying":
            raise SourceViewRejected("source view is not in copying state")
        record["phase"] = "ready"
        _write_record(self.worker_root, record)

    def cleanup(self, *, fence: dict[str, object], terminal_proven: bool = False,
                current_owner_proven: bool = False, processes_quiesced: bool) -> None:
        record = _read_record(self.worker_root, owner_uid=self.owner_uid)
        if record is None:
            return
        if (not (terminal_proven or current_owner_proven) or not processes_quiesced
                or record.get("fence") != fence):
            raise SourceViewRejected("source view cleanup requires matching owner and quiescence proof")
        if (os.fstat(self.fd).st_dev, os.fstat(self.fd).st_ino) != (
                record["result_root_dev"], record["result_root_ino"]):
            raise SourceViewRejected("builder result root inode changed")
        _tree_usage(self.fd)
        if record["view_dev"] is not None:
            try:
                source_entry = os.stat(record["view_name"], dir_fd=self.fd, follow_symlinks=False)
            except FileNotFoundError:
                # Cleanup may have removed this exact recorded inode before a
                # crash, while the journal unlink was still pending.
                source_entry = None
            except OSError as error:
                raise SourceViewRejected("recorded source view is unavailable") from error
            if (source_entry is not None and (not stat.S_ISDIR(source_entry.st_mode)
                    or (source_entry.st_dev, source_entry.st_ino)
                    != (record["view_dev"], record["view_ino"]))):
                raise SourceViewRejected("recorded source view inode changed")
        elif self._exists(record["view_name"]):
            empty_fd = os.open(record["view_name"], os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                               dir_fd=self.fd)
            try:
                info = os.fstat(empty_fd)
                if (info.st_uid != self.owner_uid or stat.S_IMODE(info.st_mode) != 0o700
                        or os.listdir(empty_fd)):
                    raise SourceViewRejected("unrecorded source view is not empty and private")
            finally:
                os.close(empty_fd)
        for name in os.listdir(self.fd):
            entry = os.stat(name, dir_fd=self.fd, follow_symlinks=False)
            if stat.S_ISDIR(entry.st_mode):
                child = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=self.fd)
                try:
                    opened = os.fstat(child)
                    if (opened.st_dev, opened.st_ino) != (entry.st_dev, entry.st_ino) or opened.st_uid != self.owner_uid:
                        raise SourceViewRejected("builder output identity changed before cleanup")
                finally:
                    os.close(child)
                if not shutil.rmtree.avoids_symlink_attacks:
                    raise SourceViewRejected("safe builder output cleanup is unavailable")
                shutil.rmtree(name, dir_fd=self.fd)
            elif stat.S_ISREG(entry.st_mode) or stat.S_ISLNK(entry.st_mode):
                os.unlink(name, dir_fd=self.fd)
            else:
                raise SourceViewRejected("builder output contains a special file")
        os.fsync(self.fd)
        _remove_record_temp(self.worker_root, record["transaction_id"], owner_uid=self.owner_uid)
        root_fd = os.open(self.worker_root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            os.unlink(JOURNAL_NAME, dir_fd=root_fd)
            os.fsync(root_fd)
        finally:
            os.close(root_fd)

    def _exists(self, name: str) -> bool:
        try:
            os.stat(name, dir_fd=self.fd, follow_symlinks=False)
            return True
        except FileNotFoundError:
            return False


__all__ = ["JOURNAL_NAME", "SourceViewJournal", "SourceViewRejected"]
