"""Strict atomic persistence helpers for the stage-journal prototype."""
from __future__ import annotations

import json
import os
import re
import stat
import uuid
from typing import Any

SHA_RE = re.compile(r"^[0-9a-f]{40}$")
DIGEST_RE = re.compile(r"^[0-9a-f]{64}$")
ID_RE = re.compile(r"^[1-9][0-9]{0,19}$")
JOURNAL = "release-stage-journal.json"
MAX_JOURNAL_BYTES = 16 * 1024
PHASES = {"intent", "incoming", "ownership_transfer", "published", "committed"}


class StageJournalError(RuntimeError):
    """A stage transaction cannot be safely started or recovered."""


def reject(message: str) -> None:
    raise StageJournalError(message)


def strict_object(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            reject("stage journal has duplicate JSON keys")
        value[key] = item
    return value


def trusted_directory(path, owner_uid: int):
    info = path.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != owner_uid or info.st_mode & 0o022:
        reject("stage journal directory ownership or mode is unsafe")
    return info


def read_fd(fd: int) -> dict[str, Any]:
    before = os.fstat(fd)
    if (not stat.S_ISREG(before.st_mode) or before.st_nlink != 1
            or stat.S_IMODE(before.st_mode) != 0o600 or before.st_size > MAX_JOURNAL_BYTES):
        reject("stage journal inode is unsafe")
    raw = os.read(fd, MAX_JOURNAL_BYTES + 1)
    after = os.fstat(fd)
    if (len(raw) != before.st_size or len(raw) > MAX_JOURNAL_BYTES
            or (before.st_dev, before.st_ino) != (after.st_dev, after.st_ino)
            or before.st_mtime_ns != after.st_mtime_ns or before.st_ctime_ns != after.st_ctime_ns):
        reject("stage journal changed while reading")
    try:
        value = json.loads(raw, object_pairs_hook=strict_object)
    except (UnicodeDecodeError, json.JSONDecodeError):
        reject("stage journal is malformed")
    if not isinstance(value, dict):
        reject("stage journal is malformed")
    return value


def validate(value: dict[str, Any], *, stage_uid: int, stage_gid: int) -> None:
    expected = {"schema", "phase", "transaction_id", "fence", "archive_sha256",
                "incoming_name", "release_name", "stage_uid", "stage_gid",
                "incoming_dev", "incoming_ino", "resource_root_dev", "resource_root_ino",
                "source_name", "source_dev", "source_ino", "source_state",
                "result_name", "result_dev", "result_ino", "result_state"}
    if set(value) != expected or value.get("schema") != 1 or value.get("phase") not in PHASES:
        reject("stage journal contract is invalid")
    txid = value.get("transaction_id")
    if not isinstance(txid, str) or not re.fullmatch(r"[0-9a-f]{32}", txid):
        reject("stage journal transaction identity is invalid")
    fence = value.get("fence")
    if not isinstance(fence, dict) or set(fence) != {
        "repository", "workflow", "ref", "sha", "run_id", "run_attempt", "job_id"
    }:
        reject("stage journal run fence is invalid")
    if (fence["repository"] != "ogabasseyy/Baci"
            or fence["workflow"] != ".github/workflows/production-release.yml"
            or fence["ref"] != "refs/heads/main"
            or not isinstance(fence["sha"], str) or not SHA_RE.fullmatch(fence["sha"])
            or not ID_RE.fullmatch(str(fence["run_id"]))
            or not isinstance(fence["run_attempt"], int) or isinstance(fence["run_attempt"], bool)
            or fence["run_attempt"] < 1 or not ID_RE.fullmatch(str(fence["job_id"]))):
        reject("stage journal run fence is invalid")
    sha = fence["sha"]
    if (not isinstance(value.get("archive_sha256"), str)
            or not DIGEST_RE.fullmatch(value["archive_sha256"])
            or value.get("incoming_name") != f".{sha}.incoming.{txid}"
            or value.get("release_name") != sha
            or value.get("stage_uid") != stage_uid
            or not isinstance(value.get("stage_gid"), int)
            or isinstance(value.get("stage_gid"), bool) or value["stage_gid"] != stage_gid):
        reject("stage journal path or archive identity is invalid")
    dev, ino = value.get("incoming_dev"), value.get("incoming_ino")
    if (dev is None) != (ino is None) or (dev is not None and
            (not isinstance(dev, int) or dev < 0 or not isinstance(ino, int) or ino <= 0)):
        reject("stage journal inode identity is invalid")
    if value["phase"] in ("incoming", "ownership_transfer", "published", "committed") and ino is None:
        reject("stage journal phase lacks an incoming inode")
    _validate_resource_fields(value, sha=sha, txid=txid)


def _validate_resource_fields(value: dict[str, Any], *, sha: str, txid: str) -> None:
    root_dev, root_ino = value["resource_root_dev"], value["resource_root_ino"]
    if (root_dev is None) != (root_ino is None) or (root_dev is not None and
            (not isinstance(root_dev, int) or root_dev < 0 or not isinstance(root_ino, int) or root_ino <= 0)):
        reject("stage resource root identity is invalid")
    enabled = root_dev is not None
    for kind in ("source", "result"):
        name, dev, ino, state = (value[f"{kind}_name"], value[f"{kind}_dev"],
                                 value[f"{kind}_ino"], value[f"{kind}_state"])
        if not enabled:
            if (name, dev, ino, state) != (None, None, None, "disabled"):
                reject("disabled stage resource has an identity")
            continue
        if name != f".{sha}.{kind}.{txid}" or state not in ("reserved", "created", "removed"):
            reject("stage resource name or state is invalid")
        if (dev is None) != (ino is None) or (dev is not None and
                (not isinstance(dev, int) or dev < 0 or not isinstance(ino, int) or ino <= 0)):
            reject("stage resource inode identity is invalid")
        if (state == "reserved" and dev is not None) or (state == "created" and dev is None):
            reject("stage resource state lacks its expected inode")


def load(root_fd: int, *, owner_uid: int, stage_uid: int, stage_gid: int) -> dict[str, Any] | None:
    try:
        fd = os.open(JOURNAL, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=root_fd)
    except FileNotFoundError:
        return None
    except OSError as error:
        raise StageJournalError("stage journal cannot be opened safely") from error
    try:
        info = os.fstat(fd)
        if info.st_uid != owner_uid:
            reject("stage journal ownership is unsafe")
        if info.st_nlink == 2:
            # Recover a kill between link-based no-replace publication and
            # removal of the temporary hard link.
            matches = []
            for name in os.listdir(root_fd):
                if not re.fullmatch(r"\.stage-journal\.[0-9a-f]{32}\.tmp", name):
                    continue
                try:
                    candidate = os.stat(name, dir_fd=root_fd, follow_symlinks=False)
                except FileNotFoundError:
                    continue
                if (candidate.st_dev, candidate.st_ino) == (info.st_dev, info.st_ino):
                    matches.append(name)
            if len(matches) != 1:
                reject("stage journal has an unexplained hard link")
            os.unlink(matches[0], dir_fd=root_fd)
            os.fsync(root_fd)
            info = os.fstat(fd)
        if info.st_nlink != 1:
            reject("stage journal inode has an unexpected link count")
        value = read_fd(fd)
    finally:
        os.close(fd)
    validate(value, stage_uid=stage_uid, stage_gid=stage_gid)
    return value


def write(root_fd: int, value: dict[str, Any], *, owner_uid: int, stage_uid: int,
          stage_gid: int, create: bool = False) -> None:
    validate(value, stage_uid=stage_uid, stage_gid=stage_gid)
    name = f".stage-journal.{uuid.uuid4().hex}.tmp"
    fd = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                 0o600, dir_fd=root_fd)
    try:
        payload = json.dumps(value, sort_keys=True, separators=(",", ":")).encode("utf-8")
        if len(payload) > MAX_JOURNAL_BYTES:
            reject("stage journal exceeds size limit")
        view = memoryview(payload)
        while view:
            count = os.write(fd, view)
            if count <= 0:
                reject("stage journal write failed")
            view = view[count:]
        os.fchown(fd, owner_uid, -1)
        os.fchmod(fd, 0o600)
        os.fsync(fd)
    finally:
        os.close(fd)
    try:
        if create:
            os.link(name, JOURNAL, src_dir_fd=root_fd, dst_dir_fd=root_fd, follow_symlinks=False)
            os.unlink(name, dir_fd=root_fd)
        else:
            if load(root_fd, owner_uid=owner_uid, stage_uid=stage_uid, stage_gid=stage_gid) is None:
                reject("stage journal disappeared during update")
            os.replace(name, JOURNAL, src_dir_fd=root_fd, dst_dir_fd=root_fd)
        os.fsync(root_fd)
    finally:
        try:
            os.unlink(name, dir_fd=root_fd)
        except FileNotFoundError:
            pass


def verify_frozen_release(releases_fd: int, name: str, *, dev: int, ino: int,
                          owner_uid: int, worker_gid: int) -> None:
    """Verify and durably sync the complete final tree, children before parents."""
    try:
        root_fd = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=releases_fd)
    except OSError as error:
        raise StageJournalError("published release tree is unavailable or unsafe") from error
    count = 0

    def visit(directory_fd: int) -> None:
        nonlocal count
        info = os.fstat(directory_fd)
        if (not stat.S_ISDIR(info.st_mode) or info.st_uid != owner_uid or info.st_gid != worker_gid
                or stat.S_IMODE(info.st_mode) != 0o550):
            reject("published release directory is not fully frozen")
        for child_name in os.listdir(directory_fd):
            count += 1
            if count > 300_000:
                reject("published release has too many entries")
            child = os.stat(child_name, dir_fd=directory_fd, follow_symlinks=False)
            if stat.S_ISDIR(child.st_mode):
                child_fd = os.open(child_name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                                   dir_fd=directory_fd)
                try:
                    opened = os.fstat(child_fd)
                    if (opened.st_dev, opened.st_ino) != (child.st_dev, child.st_ino):
                        reject("published release directory changed during verification")
                    visit(child_fd)
                finally:
                    os.close(child_fd)
            elif stat.S_ISREG(child.st_mode):
                if (child.st_uid != owner_uid or child.st_gid != worker_gid or child.st_nlink != 1
                        or stat.S_IMODE(child.st_mode) not in (0o440, 0o550)):
                    reject("published release file is not fully frozen")
                file_fd = os.open(child_name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=directory_fd)
                try:
                    opened = os.fstat(file_fd)
                    if ((opened.st_dev, opened.st_ino) != (child.st_dev, child.st_ino)
                            or not stat.S_ISREG(opened.st_mode) or opened.st_nlink != 1
                            or opened.st_uid != owner_uid or opened.st_gid != worker_gid
                            or stat.S_IMODE(opened.st_mode) not in (0o440, 0o550)):
                        reject("published release file changed during verification")
                    os.fsync(file_fd)
                    after = os.fstat(file_fd)
                    if (opened.st_size != after.st_size or opened.st_mtime_ns != after.st_mtime_ns
                            or opened.st_ctime_ns != after.st_ctime_ns):
                        reject("published release file changed while syncing")
                finally:
                    os.close(file_fd)
            else:
                reject("published release contains a link or special file")
        after_dir = os.fstat(directory_fd)
        if ((info.st_dev, info.st_ino) != (after_dir.st_dev, after_dir.st_ino)
                or info.st_mtime_ns != after_dir.st_mtime_ns
                or info.st_ctime_ns != after_dir.st_ctime_ns):
            reject("published release directory changed while syncing")
        os.fsync(directory_fd)

    try:
        root = os.fstat(root_fd)
        if (root.st_dev, root.st_ino) != (dev, ino):
            reject("published release inode changed before verification")
        visit(root_fd)
    finally:
        os.close(root_fd)


__all__ = ["JOURNAL", "StageJournalError", "load", "reject", "trusted_directory",
           "verify_frozen_release", "write"]
