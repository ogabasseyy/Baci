"""No-follow filesystem operations at the untrusted builder boundary."""
from __future__ import annotations

import json
import os
import stat
from pathlib import Path

from worker_release_dependency_artifacts import (
    MAX_ENTRIES,
    MAX_PATH_BYTES,
    MAX_PAYLOAD_BYTES,
    MANIFEST_NAME,
    SMOKE_NAME,
    BuilderRejected,
    _portable_relative_path,
    validate_payload,
)


def _open_dir_at(parent_fd: int, name: str) -> int:
    return os.open(name, os.O_RDONLY | os.O_DIRECTORY | getattr(os, "O_NOFOLLOW", 0), dir_fd=parent_fd)


def _same_inode(before: os.stat_result, after: os.stat_result) -> bool:
    return before.st_dev == after.st_dev and before.st_ino == after.st_ino


def directory_usage(root: Path, *, max_entries: int, max_bytes: int) -> tuple[int, int]:
    """Measure scratch usage without following a builder-created path link."""
    root_fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | getattr(os, "O_NOFOLLOW", 0))
    counters = {"entries": 0, "bytes": 0}

    def visit(directory_fd: int) -> None:
        for name in os.listdir(directory_fd):
            info = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
            counters["entries"] += 1
            if counters["entries"] > max_entries:
                raise BuilderRejected("build scratch has too many entries")
            if stat.S_ISDIR(info.st_mode):
                child_fd = _open_dir_at(directory_fd, name)
                try:
                    if not _same_inode(info, os.fstat(child_fd)):
                        raise BuilderRejected("build scratch changed during usage scan")
                    visit(child_fd)
                finally:
                    os.close(child_fd)
            elif stat.S_ISREG(info.st_mode) or stat.S_ISLNK(info.st_mode):
                counters["bytes"] += info.st_size
                if counters["bytes"] > max_bytes:
                    raise BuilderRejected("build scratch exceeded disk usage limit")
            else:
                raise BuilderRejected("build scratch contains a special file")

    try:
        visit(root_fd)
    finally:
        os.close(root_fd)
    return counters["entries"], counters["bytes"]


def read_smoke_evidence(scratch: Path, builder_uid: int) -> dict[str, str]:
    root_fd = os.open(scratch, os.O_RDONLY | os.O_DIRECTORY | getattr(os, "O_NOFOLLOW", 0))
    try:
        root_info = os.fstat(root_fd)
        if root_info.st_uid != builder_uid or stat.S_IMODE(root_info.st_mode) != 0o700:
            raise BuilderRejected("sandbox scratch ownership or mode is invalid")
        try:
            fd = os.open(SMOKE_NAME, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0), dir_fd=root_fd)
        except OSError as exc:
            raise BuilderRejected("sandbox smoke evidence is not a safe regular inode") from exc
        try:
            before = os.fstat(fd)
            if not stat.S_ISREG(before.st_mode) or before.st_uid != builder_uid or before.st_nlink != 1 or before.st_size > 4096 or before.st_mode & 0o077:
                raise BuilderRejected("sandbox smoke evidence inode is unsafe")
            raw = os.read(fd, 4097)
            after = os.fstat(fd)
            if len(raw) > 4096 or len(raw) != before.st_size or not _same_inode(before, after) or before.st_mtime_ns != after.st_mtime_ns or before.st_ctime_ns != after.st_ctime_ns:
                raise BuilderRejected("sandbox smoke evidence changed while reading")
        finally:
            os.close(fd)
    finally:
        os.close(root_fd)
    try:
        result = json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise BuilderRejected("sandbox smoke evidence is malformed") from exc
    if result != {"web_tsx": "passed", "worker_dotenv": "passed"}:
        raise BuilderRejected("required runtime smoke evidence is incomplete")
    return result


def write_smoke_evidence(scratch: Path, evidence: dict[str, str]) -> None:
    root_fd = os.open(scratch, os.O_RDONLY | os.O_DIRECTORY | getattr(os, "O_NOFOLLOW", 0))
    try:
        payload = json.dumps(evidence, sort_keys=True, separators=(",", ":")).encode("utf-8")
        if len(payload) > 4096:
            raise BuilderRejected("sandbox smoke evidence exceeds size limit")
        fd = os.open(SMOKE_NAME, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600, dir_fd=root_fd)
        try:
            view = memoryview(payload)
            while view:
                written = os.write(fd, view)
                if written <= 0:
                    raise BuilderRejected("sandbox smoke evidence write failed")
                view = view[written:]
            os.fchmod(fd, 0o600)
        finally:
            os.close(fd)
    finally:
        os.close(root_fd)


def snapshot_payload(scratch: Path, result_dir: Path, builder_uid: int, *, before_entry=None) -> Path:
    """Export a quiesced sandbox tree into fresh result inodes.

    Source files may be hardlinked to the private pnpm store. Only bytes and
    symlink text cross this boundary; result validation still requires nlink=1.
    The caller must prove the builder cgroup has terminated before exporting.
    """
    scratch_fd = -1
    result_fd = -1
    try:
        scratch_fd = os.open(scratch, os.O_RDONLY | os.O_DIRECTORY | getattr(os, "O_NOFOLLOW", 0))
        result_fd = os.open(result_dir, os.O_RDONLY | os.O_DIRECTORY | getattr(os, "O_NOFOLLOW", 0))
    except OSError as exc:
        if result_fd >= 0:
            os.close(result_fd)
        if scratch_fd >= 0:
            os.close(scratch_fd)
        raise BuilderRejected("scratch or result directory is not a safe real directory") from exc
    try:
        source_info, result_info = os.fstat(scratch_fd), os.fstat(result_fd)
        if source_info.st_uid != builder_uid or stat.S_IMODE(source_info.st_mode) != 0o700:
            raise BuilderRejected("sandbox scratch ownership or mode is invalid")
        if result_info.st_uid != os.geteuid() or stat.S_IMODE(result_info.st_mode) != 0o700:
            raise BuilderRejected("result directory ownership or mode is invalid")
        source_payload_fd = _open_dir_at(scratch_fd, "payload")
        try:
            if before_entry is not None:
                before_entry("", "directory", 0)
            os.mkdir("payload", 0o700, dir_fd=result_fd)
            target_payload_fd = _open_dir_at(result_fd, "payload")
            try:
                counters = {"bytes": 0, "entries": 0}
                _snapshot_dir(source_payload_fd, target_payload_fd, "", counters, before_entry)
            finally:
                os.close(target_payload_fd)
        finally:
            os.close(source_payload_fd)
    finally:
        os.close(result_fd)
        os.close(scratch_fd)
    target = result_dir / "payload"
    validate_payload(target)
    return target


def _snapshot_dir(source_fd: int, target_fd: int, prefix: str, counters: dict[str, int],
                  before_entry=None) -> None:
    before_dir = os.fstat(source_fd)
    for name in sorted(os.listdir(source_fd)):
        if name in ("", ".", "..") or "/" in name or "\\" in name:
            raise BuilderRejected("dependency candidate contains an unsafe entry name")
        relative = f"{prefix}/{name}" if prefix else name
        _portable_relative_path(relative)
        before = os.stat(name, dir_fd=source_fd, follow_symlinks=False)
        counters["entries"] += 1
        if counters["entries"] > MAX_ENTRIES:
            raise BuilderRejected("dependency payload has too many entries")
        if stat.S_ISDIR(before.st_mode):
            if before.st_mode & 0o6022:
                raise BuilderRejected("dependency candidate directory has unsafe write or set-id bits")
            child_source = _open_dir_at(source_fd, name)
            try:
                if not _same_inode(before, os.fstat(child_source)):
                    raise BuilderRejected("dependency candidate directory changed while snapshotting")
                if before_entry is not None:
                    before_entry(relative, "directory", 0)
                os.mkdir(name, 0o700, dir_fd=target_fd)
                child_target = _open_dir_at(target_fd, name)
                try:
                    _snapshot_dir(child_source, child_target, relative, counters, before_entry)
                finally:
                    os.close(child_target)
            finally:
                os.close(child_source)
        elif stat.S_ISREG(before.st_mode):
            if before.st_nlink < 1 or before.st_size < 0:
                raise BuilderRejected("dependency candidate has an invalid file")
            if before.st_mode & 0o6022:
                raise BuilderRejected("dependency candidate file has unsafe write or set-id bits")
            counters["bytes"] += before.st_size
            if counters["bytes"] > MAX_PAYLOAD_BYTES:
                raise BuilderRejected("dependency payload exceeds size limit")
            source_file = os.open(name, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0), dir_fd=source_fd)
            target_file = -1
            try:
                opened = os.fstat(source_file)
                if (not _same_inode(before, opened) or not stat.S_ISREG(opened.st_mode)
                        or (before.st_size, before.st_mode, before.st_uid, before.st_gid, before.st_nlink,
                            before.st_mtime_ns, before.st_ctime_ns) !=
                        (opened.st_size, opened.st_mode, opened.st_uid, opened.st_gid, opened.st_nlink,
                         opened.st_mtime_ns, opened.st_ctime_ns)):
                    raise BuilderRejected("dependency candidate file changed while snapshotting")
                if before_entry is not None:
                    before_entry(relative, "file", before.st_size)
                target_file = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600, dir_fd=target_fd)
                copied = 0
                while True:
                    block = os.read(source_file, min(1024 * 1024, before.st_size - copied + 1))
                    if not block:
                        break
                    copied += len(block)
                    if copied > before.st_size:
                        raise BuilderRejected("dependency candidate file grew while snapshotting")
                    view = memoryview(block)
                    while view:
                        written = os.write(target_file, view)
                        if written <= 0:
                            raise BuilderRejected("dependency snapshot write failed")
                        view = view[written:]
                after = os.fstat(source_file)
                named = os.stat(name, dir_fd=source_fd, follow_symlinks=False)
                if (copied != before.st_size or
                        (before.st_dev, before.st_ino, before.st_size, before.st_mode,
                         before.st_uid, before.st_gid,
                         before.st_nlink, before.st_mtime_ns, before.st_ctime_ns) !=
                        (after.st_dev, after.st_ino, after.st_size, after.st_mode,
                         after.st_uid, after.st_gid,
                         after.st_nlink, after.st_mtime_ns, after.st_ctime_ns) or
                        (named.st_dev, named.st_ino) != (before.st_dev, before.st_ino)):
                    raise BuilderRejected("dependency candidate file changed while snapshotting")
                os.fchmod(target_file, 0o550 if before.st_mode & 0o111 else 0o440)
            finally:
                if target_file >= 0:
                    os.close(target_file)
                os.close(source_file)
        elif stat.S_ISLNK(before.st_mode):
            target = os.readlink(name, dir_fd=source_fd)
            if not _same_inode(before, os.stat(name, dir_fd=source_fd, follow_symlinks=False)):
                raise BuilderRejected("dependency symlink changed while snapshotting")
            if not target or target.startswith("/") or "\\" in target or len(target.encode("utf-8")) > MAX_PATH_BYTES:
                raise BuilderRejected("dependency candidate has a non-portable symlink")
            expanded = relative.split("/")[:-1]
            for part in target.split("/"):
                if part in ("", "."):
                    continue
                if part == "..":
                    if not expanded:
                        raise BuilderRejected("dependency symlink escapes payload root")
                    expanded.pop()
                else:
                    expanded.append(part)
            if before_entry is not None:
                before_entry(relative, "symlink", len(target.encode("utf-8")))
            counters["bytes"] += len(target.encode("utf-8"))
            if counters["bytes"] > MAX_PAYLOAD_BYTES:
                raise BuilderRejected("dependency payload exceeds size limit")
            os.symlink(target, name, dir_fd=target_fd)
        else:
            raise BuilderRejected("dependency candidate contains a special file")
    after_dir = os.fstat(source_fd)
    if not _same_inode(before_dir, after_dir) or before_dir.st_mtime_ns != after_dir.st_mtime_ns or before_dir.st_ctime_ns != after_dir.st_ctime_ns:
        raise BuilderRejected("dependency candidate directory changed while snapshotting")


def write_manifest(result_dir: Path, manifest: dict[str, object]) -> Path:
    directory_fd = os.open(result_dir, os.O_RDONLY | os.O_DIRECTORY | getattr(os, "O_NOFOLLOW", 0))
    try:
        info = os.fstat(directory_fd)
        if info.st_uid != os.geteuid() or stat.S_IMODE(info.st_mode) != 0o700:
            raise BuilderRejected("result directory ownership or mode is invalid")
        try:
            fd = os.open(MANIFEST_NAME, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600, dir_fd=directory_fd)
        except OSError as exc:
            raise BuilderRejected("manifest destination already exists or is unsafe") from exc
        try:
            payload = json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode("utf-8") + b"\n"
            if len(payload) > 16 * 1024 * 1024:
                raise BuilderRejected("dependency manifest exceeds size limit")
            view = memoryview(payload)
            while view:
                written = os.write(fd, view)
                if written <= 0:
                    raise BuilderRejected("dependency manifest write failed")
                view = view[written:]
            os.fchmod(fd, 0o600)
        finally:
            os.close(fd)
    finally:
        os.close(directory_fd)
    return result_dir / MANIFEST_NAME
