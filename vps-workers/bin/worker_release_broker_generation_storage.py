"""Manifest verification and immutable generation publication."""
from __future__ import annotations

import fcntl
import hashlib
import json
import os
import secrets
import stat
from pathlib import Path
from typing import Iterable

from worker_release_broker_generation import (
    GenerationFile, MAX_FILES, _canonical_files, generation_digest,
)
from worker_release_broker_generation_fs import (
    BrokerGenerationRejected, DIR_FLAGS, FILE_FLAGS, MAX_FILE_BYTES, MAX_TOTAL_BYTES,
    _freeze_directory, _open_directory, _open_rel_parent, _read_fd, _safe_parts, _verify_exact_membership, _write_file,
)

def verify_generation(root: Path, digest: str, *, owner_uid: int = 0,
                      root_gid: int = 0, generation_mode: int = 0o555) -> bool:
    if not isinstance(digest, str) or len(digest) != 64 or any(c not in "0123456789abcdef" for c in digest):
        raise BrokerGenerationRejected("generation digest is invalid")
    generation_root = root / "generations" / digest
    root_fd = _open_directory(generation_root, uid=owner_uid, gid=root_gid,
                              mode=generation_mode)
    try:
        manifest_fd = os.open("generation.json", FILE_FLAGS, dir_fd=root_fd)
        try:
            info = os.fstat(manifest_fd)
            raw = _read_fd(manifest_fd, 256 * 1024)
            if (not stat.S_ISREG(info.st_mode) or info.st_uid != owner_uid
                    or info.st_gid != root_gid or stat.S_IMODE(info.st_mode) != 0o444
                    or info.st_nlink != 1):
                raise BrokerGenerationRejected("generation manifest metadata is unsafe")
        finally:
            os.close(manifest_fd)
        try:
            document = json.loads(raw)
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise BrokerGenerationRejected("generation manifest is invalid") from None
        if (not isinstance(document, dict) or set(document) != {"version", "digest", "files"}
                or document["version"] != 1 or document["digest"] != digest
                or not isinstance(document["files"], list) or not document["files"]
                or len(document["files"]) > MAX_FILES):
            raise BrokerGenerationRejected("generation manifest shape is invalid")
        canonical_payload = json.dumps({"version": 1, "files": document["files"]},
                                       sort_keys=True, separators=(",", ":")).encode("utf-8")
        if hashlib.sha256(canonical_payload).hexdigest() != digest:
            raise BrokerGenerationRejected("generation manifest digest does not match")
        expected_paths = set()
        total = 0
        for entry in document["files"]:
            if (not isinstance(entry, dict) or set(entry) != {"path", "mode", "gid", "size", "sha256"}
                    or type(entry["mode"]) is not int or entry["mode"] not in (0o440, 0o550, 0o640, 0o750)
                    or type(entry["gid"]) is not int or entry["gid"] < 0
                    or type(entry["size"]) is not int or not 0 <= entry["size"] <= MAX_FILE_BYTES
                    or not isinstance(entry["sha256"], str)
                    or len(entry["sha256"]) != 64):
                raise BrokerGenerationRejected("generation manifest entry is invalid")
            parts = _safe_parts(entry["path"])
            if entry["path"] in expected_paths:
                raise BrokerGenerationRejected("generation manifest has duplicate paths")
            expected_paths.add(entry["path"])
            parent_fd, name = _open_rel_parent(root_fd, parts, uid=owner_uid, gid=root_gid)
            try:
                named_before = os.stat(name, dir_fd=parent_fd, follow_symlinks=False)
                if not stat.S_ISREG(named_before.st_mode):
                    raise BrokerGenerationRejected("generation contains a link or special file")
                fd = os.open(name, FILE_FLAGS, dir_fd=parent_fd)
                try:
                    info = os.fstat(fd)
                    content = _read_fd(fd, MAX_FILE_BYTES)
                    named_after = os.stat(name, dir_fd=parent_fd, follow_symlinks=False)
                    if ((not stat.S_ISREG(info.st_mode) or info.st_uid != owner_uid
                         or info.st_gid != entry["gid"] or stat.S_IMODE(info.st_mode) != entry["mode"]
                         or info.st_nlink != 1 or info.st_size != entry["size"]
                         or hashlib.sha256(content).hexdigest() != entry["sha256"]
                         or (named_before.st_dev, named_before.st_ino) != (info.st_dev, info.st_ino)
                         or (named_after.st_dev, named_after.st_ino) != (info.st_dev, info.st_ino))):
                        raise BrokerGenerationRejected("generation file differs from manifest")
                finally:
                    os.close(fd)
            finally:
                os.close(parent_fd)
            total += entry["size"]
            if total > MAX_TOTAL_BYTES:
                raise BrokerGenerationRejected("generation manifest exceeds total size limit")
        _verify_exact_membership(root_fd, expected_paths)
        return True
    finally:
        os.close(root_fd)


def publish_generation(root: Path, files: Iterable[GenerationFile], *, owner_uid: int = 0,
                       root_gid: int = 0, generation_mode: int = 0o555) -> str:
    ordered, manifest_files = _canonical_files(files)
    digest = generation_digest(manifest_files)
    root_fd = _open_directory(root, uid=owner_uid, gid=root_gid, mode=0o755, create=True)
    try:
        try:
            os.mkdir("generations", 0o755, dir_fd=root_fd)
            created_fd = os.open("generations", DIR_FLAGS, dir_fd=root_fd)
            try:
                os.fchown(created_fd, owner_uid, root_gid)
                os.fchmod(created_fd, 0o755)
                os.fsync(created_fd)
            finally:
                os.close(created_fd)
            os.fsync(root_fd)
        except FileExistsError:
            pass
        generations_fd = os.open("generations", DIR_FLAGS, dir_fd=root_fd)
        try:
            info = os.fstat(generations_fd)
            if (info.st_uid, info.st_gid, stat.S_IMODE(info.st_mode)) != (owner_uid, root_gid, 0o755):
                raise BrokerGenerationRejected("generation collection metadata is unsafe")
            lock_fd = os.open(".install.lock", os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0),
                              0o600, dir_fd=generations_fd)
            try:
                lock_info = os.fstat(lock_fd)
                if (not stat.S_ISREG(lock_info.st_mode) or lock_info.st_uid != owner_uid
                        or lock_info.st_gid != root_gid or lock_info.st_nlink != 1
                        or stat.S_IMODE(lock_info.st_mode) != 0o600):
                    raise BrokerGenerationRejected("generation lock metadata is unsafe")
                fcntl.flock(lock_fd, fcntl.LOCK_EX)
                try:
                    existing = os.stat(digest, dir_fd=generations_fd, follow_symlinks=False)
                except FileNotFoundError:
                    existing = None
                if existing is not None:
                    if not stat.S_ISDIR(existing.st_mode):
                        raise BrokerGenerationRejected("generation path is not a directory")
                    verify_generation(root, digest, owner_uid=owner_uid, root_gid=root_gid,
                                      generation_mode=generation_mode)
                    return digest
                transaction = f".staging.{secrets.token_hex(16)}"
                os.mkdir(transaction, 0o700, dir_fd=generations_fd)
                staging_fd = os.open(transaction, DIR_FLAGS, dir_fd=generations_fd)
                try:
                    for item in ordered:
                        parent_fd, name = _open_rel_parent(staging_fd, _safe_parts(item.path),
                                                           uid=owner_uid, gid=root_gid,
                                                           directory_mode=0o700)
                        try:
                            _write_file(parent_fd, name, item.content, uid=owner_uid,
                                        gid=item.gid, mode=item.mode)
                            os.fsync(parent_fd)
                        finally:
                            os.close(parent_fd)
                    manifest = {"version": 1, "digest": digest, "files": manifest_files}
                    _write_file(staging_fd, "generation.json",
                                (json.dumps(manifest, sort_keys=True, separators=(",", ":")) + "\n").encode(),
                                uid=owner_uid, gid=root_gid, mode=0o444)
                    os.fsync(staging_fd)
                    _freeze_directory(staging_fd, uid=owner_uid, gid=root_gid)
                    os.fchmod(staging_fd, generation_mode)
                    os.fsync(staging_fd)
                finally:
                    os.close(staging_fd)
                # The install lock serializes all trusted publishers; rename is
                # atomic and refuses a nonempty existing destination directory.
                os.rename(transaction, digest, src_dir_fd=generations_fd, dst_dir_fd=generations_fd)
                os.fsync(generations_fd)
                verify_generation(root, digest, owner_uid=owner_uid, root_gid=root_gid,
                                  generation_mode=generation_mode)
                return digest
            finally:
                os.close(lock_fd)
        finally:
            os.close(generations_fd)
    finally:
        os.close(root_fd)
