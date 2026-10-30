"""Durable per-stage seed-unit record stored inside the journaled result resource."""
from __future__ import annotations

import json
import os
import stat
from pathlib import Path
from typing import Any

from dependency_seed_generation_contract import SeedGenerationRejected
from dependency_seed_generation_journal_validation import (
    FENCE_KEYS as _FENCE_KEYS, SHA as _SHA, TXID as _TXID, UNIT as _UNIT,
    is_legacy_alias_record, valid_record,
)
from dependency_seed_publication import rename_noreplace

NAME = "seed-generation-unit.json"
MAX_BYTES = 16_384
class SeedGenerationJournal:
    """Caller holds the release lock; root owns the resource and record."""

    def __init__(self, resource: Path, *, scratch_root: Path, owner_uid: int = 0):
        if os.geteuid() != owner_uid:
            raise SeedGenerationRejected("seed journal caller identity is invalid")
        self.path = Path(resource)
        self.fd = os.open(self.path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        info = os.fstat(self.fd)
        if (not stat.S_ISDIR(info.st_mode) or info.st_uid != owner_uid
                or stat.S_IMODE(info.st_mode) != 0o700):
            os.close(self.fd)
            raise SeedGenerationRejected("seed journal resource identity is unsafe")
        self.owner_uid = owner_uid
        self.resource_identity = (info.st_dev, info.st_ino)
        self.scratch_root = Path(scratch_root)
        try:
            self.scratch_fd = os.open(self.scratch_root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        except BaseException:
            self.close()
            raise
        scratch_info = os.fstat(self.scratch_fd)
        if (not stat.S_ISDIR(scratch_info.st_mode) or scratch_info.st_uid != owner_uid
                or stat.S_IMODE(scratch_info.st_mode) != 0o700):
            os.close(self.scratch_fd)
            self.close()
            raise SeedGenerationRejected("seed scratch root identity is unsafe")
        self.scratch_identity = (scratch_info.st_dev, scratch_info.st_ino)

    def close(self) -> None:
        if self.fd >= 0:
            os.close(self.fd)
            self.fd = -1
        if getattr(self, "scratch_fd", -1) >= 0:
            os.close(self.scratch_fd)
            self.scratch_fd = -1

    def __enter__(self) -> "SeedGenerationJournal":
        return self

    def __exit__(self, *_exc) -> None:
        self.close()

    def read(self) -> dict[str, Any] | None:
        try:
            fd = os.open(NAME, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=self.fd)
        except FileNotFoundError:
            return None
        except OSError as error:
            raise SeedGenerationRejected("seed unit journal is unavailable") from error
        try:
            info = os.fstat(fd)
            if (not stat.S_ISREG(info.st_mode) or info.st_uid != self.owner_uid
                    or info.st_nlink != 1 or stat.S_IMODE(info.st_mode) != 0o600
                    or info.st_size > MAX_BYTES):
                raise SeedGenerationRejected("seed unit journal inode is unsafe")
            payload = os.read(fd, info.st_size + 1)
            after = os.fstat(fd)
            if (len(payload) != info.st_size or
                    (info.st_dev, info.st_ino, info.st_mtime_ns) !=
                    (after.st_dev, after.st_ino, after.st_mtime_ns)):
                raise SeedGenerationRejected("seed unit journal changed while reading")
        finally:
            os.close(fd)
        try:
            value = json.loads(payload)
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise SeedGenerationRejected("seed unit journal is malformed") from error
        if is_legacy_alias_record(value):
            raise SeedGenerationRejected(
                "legacy alias seed journal requires explicit recovery preflight")
        if not self._valid(value):
            raise SeedGenerationRejected("seed unit journal fields are invalid")
        return value

    def begin(self, *, transaction_id: str, fence: dict[str, object], unit: str,
              source: Path, egress_socket: tuple[int, int], scratch_name: str,
              builder_uid: int, builder_gid: int) -> dict[str, Any]:
        if self.read() is not None:
            raise SeedGenerationRejected("seed unit journal already exists")
        sha = fence.get("sha") if isinstance(fence, dict) else None
        source_info = source.lstat()
        if (not isinstance(transaction_id, str) or not _TXID.fullmatch(transaction_id)
                or not isinstance(sha, str) or not _SHA.fullmatch(sha)
                or not isinstance(unit, str) or not _UNIT.fullmatch(unit)
                or not unit.startswith(f"baci-worker-seed-{sha[:12]}-")
                or set(fence) != _FENCE_KEYS or fence.get("repository") != "ogabasseyy/Baci"
                or fence.get("workflow") != ".github/workflows/production-release.yml"
                or fence.get("ref") != "refs/heads/main" or fence.get("status") != "in_progress"
                or len(egress_socket) != 2
                or any(type(item) is not int or item < 0 for item in egress_socket)
                or scratch_name != f"seed-{transaction_id}"
                or not source.is_absolute()
                or not stat.S_ISDIR(source_info.st_mode) or source_info.st_uid != self.owner_uid
                or stat.S_IMODE(source_info.st_mode) != 0o550
                or min(builder_uid, builder_gid) <= 0):
            raise SeedGenerationRejected("seed unit journal identity is invalid")
        value = {
            "schema": 2, "phase": "prepared", "transaction_id": transaction_id,
            "fence": dict(fence), "unit": unit,
            "source_path": str(source), "source_dev": source_info.st_dev,
            "source_ino": source_info.st_ino,
            "resource_dev": self.resource_identity[0], "resource_ino": self.resource_identity[1],
            "scratch_root_dev": self.scratch_identity[0], "scratch_root_ino": self.scratch_identity[1],
            "scratch_name": scratch_name, "scratch_dev": None, "scratch_ino": None,
            "cache_dev": None, "cache_ino": None, "store_dev": None, "store_ino": None,
            "builder_uid": builder_uid, "builder_gid": builder_gid,
            "egress_socket_dev": egress_socket[0], "egress_socket_ino": egress_socket[1],
        }
        self._write(value, create=True)
        return value

    def mark_scratch_created(self, identity: tuple[int, int]) -> None:
        value = self._require("prepared")
        value.update(scratch_dev=identity[0], scratch_ino=identity[1])
        self._write(value)

    def mark_outputs_created(self, cache: tuple[int, int], store: tuple[int, int]) -> None:
        value = self._require("prepared")
        value.update(cache_dev=cache[0], cache_ino=cache[1],
                     store_dev=store[0], store_ino=store[1])
        self._write(value)

    def mark_egress_binding_ready(self, socket_identity: tuple[int, int]) -> None:
        value = self._require("prepared")
        if len(socket_identity) != 2 or any(type(item) is not int or item < 0 for item in socket_identity):
            raise SeedGenerationRejected("fixed egress socket identity is invalid")
        if (value["egress_socket_dev"], value["egress_socket_ino"]) != socket_identity:
            raise SeedGenerationRejected("fixed egress socket changed before unit launch")

    def mark_running(self) -> None:
        value = self._require("prepared")
        if any(type(value.get(key)) is not int for key in
               ("scratch_dev", "scratch_ino", "cache_dev", "cache_ino", "store_dev", "store_ino")):
            raise SeedGenerationRejected("seed workspace identities must be journaled before launch")
        value["phase"] = "running"
        self._write(value)

    def mark_drained(self) -> None:
        value = self.read()
        if value is None or value["phase"] not in ("prepared", "running", "drained"):
            raise SeedGenerationRejected("seed unit journal cannot record drain proof")
        value["phase"] = "drained"
        self._write(value)

    def mark_outputs_removed(self) -> None:
        value = self._require("drained")
        scratch_exists = self._entry_exists(value["scratch_name"])
        if scratch_exists and any(self._entry_exists(f"{value['scratch_name']}/{name}")
                                  for name in ("cache", "store")):
            raise SeedGenerationRejected("seed output directories remain before removal transition")
        value.update(cache_dev=None, cache_ino=None, store_dev=None, store_ino=None)
        self._write(value)

    def mark_scratch_removed(self) -> None:
        value = self._require("drained")
        if self._entry_exists(value["scratch_name"]):
            raise SeedGenerationRejected("seed scratch remains before removal transition")
        if any(type(value.get(key)) is int for key in ("cache_dev", "cache_ino", "store_dev", "store_ino")):
            raise SeedGenerationRejected("seed outputs must be removed before scratch")
        value.update(scratch_dev=None, scratch_ino=None)
        self._write(value)

    def clear(self) -> None:
        value = self._require("drained")
        if (value["scratch_dev"] is not None
                or value["scratch_ino"] is not None):
            raise SeedGenerationRejected("seed scratch must be removed before clearing journal")
        os.unlink(NAME, dir_fd=self.fd)
        os.fsync(self.fd)

    def remove_stale_temp(self, transaction_id: str) -> None:
        if not _TXID.fullmatch(transaction_id):
            raise SeedGenerationRejected("seed journal temporary transaction id is invalid")
        name = f".{NAME}.{transaction_id}.tmp"
        try:
            info = os.stat(name, dir_fd=self.fd, follow_symlinks=False)
        except FileNotFoundError:
            return
        if (not stat.S_ISREG(info.st_mode) or info.st_uid != self.owner_uid
                or info.st_nlink != 1 or stat.S_IMODE(info.st_mode) != 0o600
                or info.st_size > MAX_BYTES):
            raise SeedGenerationRejected("seed journal temporary inode is unsafe")
        os.unlink(name, dir_fd=self.fd)
        os.fsync(self.fd)

    def _require(self, phase: str) -> dict[str, Any]:
        value = self.read()
        if value is None or value["phase"] != phase:
            raise SeedGenerationRejected("seed unit journal phase is invalid")
        return value

    def _entry_exists(self, name: str) -> bool:
        parts = name.split("/")
        if len(parts) not in (1, 2) or any(part in ("", ".", "..") for part in parts):
            raise SeedGenerationRejected("seed cleanup entry name is invalid")
        try:
            if len(parts) == 1:
                os.stat(parts[0], dir_fd=self.scratch_fd, follow_symlinks=False)
                return True
            parent_fd = os.open(
                parts[0], os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                dir_fd=self.scratch_fd,
            )
        except FileNotFoundError:
            return False
        except OSError as error:
            raise SeedGenerationRejected("seed cleanup parent is unsafe") from error
        try:
            parent_info = os.fstat(parent_fd)
            if not stat.S_ISDIR(parent_info.st_mode) or parent_info.st_uid != self.owner_uid:
                raise SeedGenerationRejected("seed cleanup parent identity is unsafe")
            try:
                os.stat(parts[1], dir_fd=parent_fd, follow_symlinks=False)
                return True
            except FileNotFoundError:
                return False
        finally:
            os.close(parent_fd)

    def _valid(self, value: object) -> bool:
        return valid_record(value, self.resource_identity, self.scratch_identity)

    def _write(self, value: dict[str, Any], *, create: bool = False) -> None:
        if not self._valid(value):
            raise SeedGenerationRejected("seed unit journal update is invalid")
        temporary = f".{NAME}.{value['transaction_id']}.tmp"
        try:
            fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                         0o600, dir_fd=self.fd)
        except FileExistsError as error:
            raise SeedGenerationRejected("seed unit journal has unresolved temporary state") from error
        try:
            data = (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode("ascii")
            if len(data) > MAX_BYTES or os.write(fd, data) != len(data):
                raise SeedGenerationRejected("seed unit journal write exceeded bounds")
            os.fsync(fd)
        finally:
            os.close(fd)
        try:
            if create:
                rename_noreplace(self.fd, temporary, NAME)
            else:
                os.replace(temporary, NAME, src_dir_fd=self.fd, dst_dir_fd=self.fd)
            os.fsync(self.fd)
        except BaseException:
            try:
                os.unlink(temporary, dir_fd=self.fd)
            except FileNotFoundError:
                pass
            raise


__all__ = ["MAX_BYTES", "NAME", "SeedGenerationJournal"]
