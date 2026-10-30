"""Crash-durable, root-owned journal for broker generation transitions."""
from __future__ import annotations

import json
import os
import secrets
import stat
from pathlib import Path
from typing import Any

JOURNAL_PATH = Path("/var/lib/baci-worker-broker/transaction/upgrade-journal.json")
MAX_JOURNAL_BYTES = 4096
PHASES = frozenset({"prepared", "stopped", "switched", "started",
                    "rollback_starting", "bootstrap_prepared", "bootstrap_started",
                    "bootstrap_recovery", "recovery_required"})
DIR_FLAGS = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0)


class BrokerUpgradeJournalRejected(RuntimeError):
    """The persisted broker upgrade transaction is missing or unsafe."""


def _open_parent(path: Path, *, uid: int, gid: int) -> tuple[int, str]:
    if (not path.is_absolute() or path != Path(os.path.normpath(str(path)))
            or path.name in ("", ".", "..")):
        raise BrokerUpgradeJournalRejected("upgrade journal path is invalid")
    parent = os.open("/", DIR_FLAGS)
    try:
        for component in path.parent.parts[1:]:
            child = os.open(component, DIR_FLAGS, dir_fd=parent)
            info = os.fstat(child)
            if (not stat.S_ISDIR(info.st_mode) or info.st_uid not in {0, uid}
                    or info.st_mode & 0o022):
                os.close(child)
                raise BrokerUpgradeJournalRejected("upgrade journal ancestry is unsafe")
            os.close(parent)
            parent = child
        info = os.fstat(parent)
        if (info.st_uid != uid or info.st_gid != gid or info.st_mode & 0o022):
            raise BrokerUpgradeJournalRejected("upgrade journal parent ownership is unsafe")
        return parent, path.name
    except BaseException:
        os.close(parent)
        raise


def _validate(document: Any) -> dict[str, Any]:
    fields = {"version", "transaction_id", "phase", "old_digest", "new_digest", "unit"}
    if not isinstance(document, dict) or set(document) != fields or document.get("version") != 1:
        raise BrokerUpgradeJournalRejected("upgrade journal fields are invalid")
    txid = document.get("transaction_id")
    if (not isinstance(txid, str) or len(txid) != 32
            or any(char not in "0123456789abcdef" for char in txid)):
        raise BrokerUpgradeJournalRejected("upgrade journal transaction ID is invalid")
    if document.get("phase") not in PHASES:
        raise BrokerUpgradeJournalRejected("upgrade journal phase is invalid")
    for field in ("old_digest", "new_digest"):
        digest = document.get(field)
        if (not isinstance(digest, str) or len(digest) != 64
                or any(char not in "0123456789abcdef" for char in digest)):
            raise BrokerUpgradeJournalRejected("upgrade journal generation digest is invalid")
    if document.get("old_digest") == document.get("new_digest"):
        raise BrokerUpgradeJournalRejected("upgrade journal generations must differ")
    if document.get("unit") != "baci-worker-release-broker.service":
        raise BrokerUpgradeJournalRejected("upgrade journal unit is invalid")
    return document


def read_upgrade_journal(path: Path = JOURNAL_PATH, *, owner_uid: int = 0,
                         owner_gid: int = 0) -> dict[str, Any] | None:
    parent, name = _open_parent(path, uid=owner_uid, gid=owner_gid)
    try:
        try:
            fd = os.open(name, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0), dir_fd=parent)
        except FileNotFoundError:
            return None
        try:
            info = os.fstat(fd)
            if (not stat.S_ISREG(info.st_mode) or info.st_uid != owner_uid
                    or info.st_gid != owner_gid or stat.S_IMODE(info.st_mode) != 0o600
                    or info.st_nlink != 1 or info.st_size > MAX_JOURNAL_BYTES):
                raise BrokerUpgradeJournalRejected("upgrade journal metadata is unsafe")
            raw = bytearray()
            while chunk := os.read(fd, MAX_JOURNAL_BYTES + 1 - len(raw)):
                raw.extend(chunk)
                if len(raw) > MAX_JOURNAL_BYTES:
                    raise BrokerUpgradeJournalRejected("upgrade journal exceeds fixed limit")
            named = os.stat(name, dir_fd=parent, follow_symlinks=False)
            after = os.fstat(fd)
            if (named.st_dev, named.st_ino) != (after.st_dev, after.st_ino):
                raise BrokerUpgradeJournalRejected("upgrade journal path changed while reading")
        finally:
            os.close(fd)
        try:
            document = json.loads(raw)
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise BrokerUpgradeJournalRejected("upgrade journal encoding is invalid") from None
        if json.dumps(document, sort_keys=True, separators=(",", ":")).encode() + b"\n" != raw:
            raise BrokerUpgradeJournalRejected("upgrade journal is not canonical")
        return _validate(document)
    finally:
        os.close(parent)


def write_upgrade_journal(document: dict[str, Any], path: Path = JOURNAL_PATH, *,
                          owner_uid: int = 0, owner_gid: int = 0) -> None:
    checked = _validate(document)
    payload = json.dumps(checked, sort_keys=True, separators=(",", ":")).encode() + b"\n"
    if len(payload) > MAX_JOURNAL_BYTES:
        raise BrokerUpgradeJournalRejected("upgrade journal exceeds fixed limit")
    parent, name = _open_parent(path, uid=owner_uid, gid=owner_gid)
    temporary = f".{name}.{secrets.token_hex(16)}"
    try:
        try:
            existing = os.stat(name, dir_fd=parent, follow_symlinks=False)
        except FileNotFoundError:
            existing = None
        if existing is not None and (not stat.S_ISREG(existing.st_mode)
                                     or existing.st_uid != owner_uid or existing.st_gid != owner_gid
                                     or stat.S_IMODE(existing.st_mode) != 0o600
                                     or existing.st_nlink != 1):
            raise BrokerUpgradeJournalRejected("existing upgrade journal is unsafe")
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL |
                     getattr(os, "O_NOFOLLOW", 0), 0o600, dir_fd=parent)
        try:
            os.fchown(fd, owner_uid, owner_gid)
            os.fchmod(fd, 0o600)
            view = memoryview(payload)
            while view:
                written = os.write(fd, view)
                if written <= 0:
                    raise OSError("short journal write")
                view = view[written:]
            os.fsync(fd)
        finally:
            os.close(fd)
        os.rename(temporary, name, src_dir_fd=parent, dst_dir_fd=parent)
        os.fsync(parent)
    finally:
        try:
            os.unlink(temporary, dir_fd=parent)
        except FileNotFoundError:
            pass
        os.close(parent)


def clear_upgrade_journal(path: Path = JOURNAL_PATH, *, owner_uid: int = 0,
                          owner_gid: int = 0, transaction_id: str | None = None) -> None:
    current = read_upgrade_journal(path, owner_uid=owner_uid, owner_gid=owner_gid)
    if current is None:
        return
    if transaction_id is not None and current["transaction_id"] != transaction_id:
        raise BrokerUpgradeJournalRejected("upgrade journal transaction changed before clear")
    parent, name = _open_parent(path, uid=owner_uid, gid=owner_gid)
    try:
        os.unlink(name, dir_fd=parent)
        os.fsync(parent)
    finally:
        os.close(parent)


__all__ = ["BrokerUpgradeJournalRejected", "JOURNAL_PATH", "clear_upgrade_journal",
           "read_upgrade_journal", "write_upgrade_journal"]
