"""Durable root-owned records for temporary runtime candidate bind views."""
from __future__ import annotations

import json
import os
import re
import stat
from dataclasses import dataclass
from pathlib import Path

MAX_BYTES = 4096
UNIT_RE = re.compile(r"^baci-worker-runtime-([0-9a-f]{16})-[0-9a-f]{12}-[01]\.service$")
CANDIDATE_RE = re.compile(r"^\.([0-9a-f]{40})\.incoming\.([0-9a-f]{32})$")
DIR_FLAGS = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
VIEW_ROOT = Path("/var/lib/baci-worker-runtime-views")


class RuntimeViewJournalRejected(RuntimeError):
    """The durable runtime-view record is malformed or no longer exact."""


@dataclass(frozen=True)
class RuntimeViewRecord:
    unit: str
    fence_digest: str
    candidate_path: Path
    candidate_identity: tuple[int, int]
    view_root_identity: tuple[int, int]
    record_identity: tuple[int, int, int, int, int, int, int]
    record_bytes: bytes

    @property
    def record_name(self) -> str:
        return f"{self.unit}.json"


def _identity(info: os.stat_result) -> tuple[int, int, int, int, int, int, int]:
    return (info.st_dev, info.st_ino, info.st_uid, info.st_gid, info.st_mode,
            info.st_nlink, info.st_size)


def _document(unit: str, fence_digest: str, candidate_path: Path,
              candidate_identity: tuple[int, int],
              view_root_identity: tuple[int, int]) -> dict[str, object]:
    match = UNIT_RE.fullmatch(unit)
    candidate_match = CANDIDATE_RE.fullmatch(candidate_path.name)
    if (match is None or candidate_match is None or match.group(1) != fence_digest[:16]
            or not re.fullmatch(r"[0-9a-f]{64}", fence_digest)
            or candidate_path != Path(os.path.normpath(str(candidate_path)))
            or not candidate_path.is_absolute() or candidate_match.group(1) == ""
            or len(candidate_identity) != 2 or len(view_root_identity) != 2
            or any(type(item) is not int or item <= 0
                   for item in (*candidate_identity, *view_root_identity))):
        raise RuntimeViewJournalRejected("runtime-view candidate binding is invalid")
    return {
        "version": 1, "unit": unit, "fence_digest": fence_digest,
        "candidate_path": str(candidate_path), "candidate_dev": candidate_identity[0],
        "candidate_ino": candidate_identity[1], "view_root_dev": view_root_identity[0],
        "view_root_ino": view_root_identity[1],
    }


def _record_from_bytes(name: str, raw: bytes, *, root_identity: tuple[int, int],
                       record_identity: tuple[int, int, int, int, int, int, int]
                       ) -> RuntimeViewRecord:
    try:
        value = json.loads(raw.decode("ascii"))
    except (UnicodeError, ValueError) as error:
        raise RuntimeViewJournalRejected("runtime-view journal encoding is invalid") from error
    if (not isinstance(value, dict) or set(value) != {
            "version", "unit", "fence_digest", "candidate_path", "candidate_dev",
            "candidate_ino", "view_root_dev", "view_root_ino"}
            or type(value["version"]) is not int or value["version"] != 1
            or not isinstance(value["unit"], str)
            or name != f"{value['unit']}.json"
            or not isinstance(value["fence_digest"], str)
            or not isinstance(value["candidate_path"], str)
            or type(value["candidate_dev"]) is not int or type(value["candidate_ino"]) is not int
            or type(value["view_root_dev"]) is not int or type(value["view_root_ino"]) is not int):
        raise RuntimeViewJournalRejected("runtime-view journal fields are invalid")
    canonical = json.dumps(value, sort_keys=True, separators=(",", ":")).encode("ascii")
    if raw != canonical:
        raise RuntimeViewJournalRejected("runtime-view journal is not canonical")
    expected = _document(value["unit"], value["fence_digest"], Path(value["candidate_path"]),
                          (value["candidate_dev"], value["candidate_ino"]),
                          (value["view_root_dev"], value["view_root_ino"]))
    if (value != expected or (value["view_root_dev"], value["view_root_ino"]) != root_identity):
        raise RuntimeViewJournalRejected("runtime-view journal identity does not match its root")
    return RuntimeViewRecord(
        unit=value["unit"], fence_digest=value["fence_digest"],
        candidate_path=Path(value["candidate_path"]),
        candidate_identity=(value["candidate_dev"], value["candidate_ino"]),
        view_root_identity=root_identity, record_identity=record_identity, record_bytes=raw,
    )


def _read_record(root_fd: int, name: str, root_identity: tuple[int, int]) -> RuntimeViewRecord:
    info = os.stat(name, dir_fd=root_fd, follow_symlinks=False)
    fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=root_fd)
    try:
        opened = os.fstat(fd)
        identity = _identity(opened)
        if (not stat.S_ISREG(opened.st_mode) or opened.st_uid != 0 or opened.st_gid != 0
                or stat.S_IMODE(opened.st_mode) != 0o600 or opened.st_nlink != 1
                or opened.st_size <= 0 or opened.st_size > MAX_BYTES
                or _identity(info) != identity):
            raise RuntimeViewJournalRejected("runtime-view journal file metadata is unsafe")
        raw = os.read(fd, MAX_BYTES + 1)
        if len(raw) != opened.st_size or os.read(fd, 1):
            raise RuntimeViewJournalRejected("runtime-view journal size changed")
        return _record_from_bytes(name, raw, root_identity=root_identity,
                                  record_identity=identity)
    finally:
        os.close(fd)


def write_runtime_view_record(root_fd: int, *, unit: str, fence_digest: str,
                              candidate_path: Path, candidate_identity: tuple[int, int],
                              view_root_identity: tuple[int, int]) -> RuntimeViewRecord:
    value = _document(unit, fence_digest, candidate_path, candidate_identity,
                      view_root_identity)
    raw = json.dumps(value, sort_keys=True, separators=(",", ":")).encode("ascii")
    if len(raw) > MAX_BYTES:
        raise RuntimeViewJournalRejected("runtime-view journal exceeds its fixed bound")
    fd = os.open(f"{unit}.json", os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                 0o600, dir_fd=root_fd)
    try:
        os.fchown(fd, 0, 0)
        os.fchmod(fd, 0o600)
        offset = 0
        while offset < len(raw):
            offset += os.write(fd, raw[offset:])
        os.fsync(fd)
        identity = _identity(os.fstat(fd))
    finally:
        os.close(fd)
    os.fsync(root_fd)
    return RuntimeViewRecord(unit, fence_digest, candidate_path, candidate_identity,
                             view_root_identity, identity, raw)


def verify_runtime_view_record(root_fd: int, record: RuntimeViewRecord) -> None:
    current = _read_record(root_fd, record.record_name, record.view_root_identity)
    if current != record:
        raise RuntimeViewJournalRejected("runtime-view journal changed")


def remove_runtime_view_record(root_fd: int, record: RuntimeViewRecord) -> None:
    verify_runtime_view_record(root_fd, record)
    os.unlink(record.record_name, dir_fd=root_fd)
    os.fsync(root_fd)


def list_all_runtime_view_records(view_root: Path = VIEW_ROOT) -> tuple[RuntimeViewRecord, ...]:
    if not view_root.is_absolute() or view_root != Path(os.path.normpath(str(view_root))):
        raise RuntimeViewJournalRejected("runtime-view root path is invalid")
    parent_fd = os.open(view_root.parent, DIR_FLAGS)
    try:
        parent = os.fstat(parent_fd)
        if parent.st_uid != 0 or parent.st_gid != 0 or parent.st_mode & 0o022:
            raise RuntimeViewJournalRejected("runtime-view parent is untrusted")
        root_fd = os.open(view_root.name, DIR_FLAGS, dir_fd=parent_fd)
    finally:
        os.close(parent_fd)
    try:
        root = os.fstat(root_fd)
        if (not stat.S_ISDIR(root.st_mode) or root.st_uid != 0 or root.st_gid != 0
                or stat.S_IMODE(root.st_mode) != 0o711):
            raise RuntimeViewJournalRejected("runtime-view root ownership or mode is unsafe")
        root_identity = (root.st_dev, root.st_ino)
        names = set(os.listdir(root_fd))
        record_names = {name[:-5] for name in names if name.endswith(".json")}
        directory_names = names - {f"{name}.json" for name in record_names}
        if any(not UNIT_RE.fullmatch(name) for name in directory_names):
            raise RuntimeViewJournalRejected("runtime-view root contains an untracked entry")
        if directory_names - record_names:
            raise RuntimeViewJournalRejected("runtime-view unit directory has no durable record")
        for name in directory_names:
            info = os.stat(name, dir_fd=root_fd, follow_symlinks=False)
            if (not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_gid != 0
                    or stat.S_IMODE(info.st_mode) != 0o711):
                raise RuntimeViewJournalRejected("runtime-view unit directory metadata is unsafe")
        records = [_read_record(root_fd, f"{name}.json", root_identity)
                   for name in sorted(record_names)]
        return tuple(records)
    finally:
        os.close(root_fd)


def list_runtime_view_records_for_candidate(candidate_path: Path, candidate_dev: int,
                                            candidate_ino: int, *,
                                            view_root: Path = VIEW_ROOT) -> tuple[RuntimeViewRecord, ...]:
    if type(candidate_dev) is not int or type(candidate_ino) is not int:
        raise RuntimeViewJournalRejected("candidate inode identity is invalid")
    matches = tuple(record for record in list_all_runtime_view_records(view_root)
                    if record.candidate_path == candidate_path
                    and record.candidate_identity == (candidate_dev, candidate_ino))
    return matches


__all__ = ["RuntimeViewJournalRejected", "RuntimeViewRecord", "list_all_runtime_view_records",
           "list_runtime_view_records_for_candidate", "remove_runtime_view_record",
           "verify_runtime_view_record", "write_runtime_view_record"]
