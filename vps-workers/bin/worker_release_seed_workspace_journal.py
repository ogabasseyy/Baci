"""Crash-durable transaction record for the fixed seed workspace provisioner."""
from __future__ import annotations

import fcntl
import json
import os
import re
import secrets
import stat
from pathlib import Path

from worker_release_dependency_artifacts import BuilderRejected
from worker_release_seed_workspace_paths import rename_noreplace

JOURNAL_NAME = ".seed-workspace-provision.json"
LOCK_NAME = ".seed-workspace-provision.lock"
TEMP_RE = re.compile(r"^\.seed-workspace-provision\.([0-9a-f]{32})\.tmp$")
MAX_BYTES = 4096
PHASES = {"planned", "image_created", "formatting", "unit_installing", "enabling", "complete"}


class SeedWorkspaceJournal:
    """Hold the fixed parent lock and atomically update one root-owned record."""

    def __init__(self, parent: Path, *, owner_uid: int = 0):
        self.parent = Path(parent)
        self.owner_uid = owner_uid
        self.root_fd = os.open(self.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        self.lock_fd = -1
        try:
            root = os.fstat(self.root_fd)
            if (not stat.S_ISDIR(root.st_mode) or root.st_uid != owner_uid
                    or root.st_mode & 0o022):
                raise BuilderRejected("seed workspace journal parent is unsafe")
            self.lock_fd = os.open(LOCK_NAME, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW,
                                   0o600, dir_fd=self.root_fd)
            lock = os.fstat(self.lock_fd)
            named = os.stat(LOCK_NAME, dir_fd=self.root_fd, follow_symlinks=False)
            if (not stat.S_ISREG(lock.st_mode) or lock.st_uid != owner_uid
                    or lock.st_nlink != 1 or stat.S_IMODE(lock.st_mode) != 0o600
                    or (lock.st_dev, lock.st_ino) != (named.st_dev, named.st_ino)):
                raise BuilderRejected("seed workspace journal lock is unsafe")
            try:
                fcntl.flock(self.lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError as error:
                raise BuilderRejected("seed workspace provisioning is already active") from error
        except BaseException:
            self.close()
            raise

    def close(self) -> None:
        if self.lock_fd >= 0:
            os.close(self.lock_fd)
            self.lock_fd = -1
        if self.root_fd >= 0:
            os.close(self.root_fd)
            self.root_fd = -1

    def __enter__(self) -> "SeedWorkspaceJournal":
        return self

    def __exit__(self, *_args) -> None:
        self.close()

    def read(self) -> dict[str, object] | None:
        try:
            fd = os.open(JOURNAL_NAME, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=self.root_fd)
        except FileNotFoundError:
            self._cleanup_temps(None)
            return None
        try:
            info = os.fstat(fd)
            named = os.stat(JOURNAL_NAME, dir_fd=self.root_fd, follow_symlinks=False)
            if (not stat.S_ISREG(info.st_mode) or info.st_uid != self.owner_uid
                    or info.st_nlink not in (1, 2) or stat.S_IMODE(info.st_mode) != 0o600
                    or info.st_size > MAX_BYTES
                    or (info.st_dev, info.st_ino) != (named.st_dev, named.st_ino)):
                raise BuilderRejected("seed workspace journal metadata is unsafe")
            raw = os.read(fd, MAX_BYTES + 1)
            value = json.loads(raw)
            if (not isinstance(value, dict)
                    or set(value) != {"schema", "transaction_id", "phase", "image_identity"}
                    or value.get("schema") != 1
                    or not isinstance(value.get("transaction_id"), str)
                    or not re.fullmatch(r"[0-9a-f]{32}", value["transaction_id"])
                    or value.get("phase") not in PHASES):
                raise BuilderRejected("seed workspace journal contract is invalid")
            identity = value.get("image_identity")
            if identity is not None and (not isinstance(identity, list) or len(identity) != 2
                    or any(type(item) is not int or item < 0 for item in identity)
                    or identity[1] == 0):
                raise BuilderRejected("seed workspace journal image identity is invalid")
            self._cleanup_temps(value["transaction_id"],
                                journal_identity=(info.st_dev, info.st_ino))
            after_cleanup = os.fstat(fd)
            named_after_cleanup = os.stat(JOURNAL_NAME, dir_fd=self.root_fd,
                                          follow_symlinks=False)
            if (after_cleanup.st_nlink != 1
                    or (after_cleanup.st_dev, after_cleanup.st_ino)
                    != (named_after_cleanup.st_dev, named_after_cleanup.st_ino)):
                raise BuilderRejected("seed workspace journal has an unrecognized hardlink")
            return value
        except (OSError, UnicodeError, json.JSONDecodeError, TypeError, ValueError) as error:
            raise BuilderRejected("seed workspace journal cannot be read safely") from error
        finally:
            os.close(fd)

    def begin(self) -> dict[str, object]:
        if self.read() is not None:
            raise BuilderRejected("seed workspace journal already exists")
        value: dict[str, object] = {
            "schema": 1, "transaction_id": secrets.token_hex(16),
            "phase": "planned", "image_identity": None,
        }
        self._write(value, create=True)
        return value

    def update(self, value: dict[str, object], *, phase: str,
               image_identity: tuple[int, int] | None = None) -> dict[str, object]:
        if phase not in PHASES - {"planned"}:
            raise BuilderRejected("seed workspace journal phase is invalid")
        current = self.read()
        if (current is None or current["transaction_id"] != value.get("transaction_id")):
            raise BuilderRejected("seed workspace journal transaction changed")
        updated = dict(current)
        updated["phase"] = phase
        if image_identity is not None:
            updated["image_identity"] = [image_identity[0], image_identity[1]]
        self._write(updated, create=False)
        value.clear()
        value.update(updated)
        return value

    def clear(self, transaction_id: str) -> None:
        value = self.read()
        if value is None or value["transaction_id"] != transaction_id:
            raise BuilderRejected("seed workspace journal changed before clear")
        os.unlink(JOURNAL_NAME, dir_fd=self.root_fd)
        os.fsync(self.root_fd)
        self._cleanup_temps(None)

    def _write(self, value: dict[str, object], *, create: bool) -> None:
        tx = value["transaction_id"]
        temp = f".seed-workspace-provision.{tx}.tmp"
        payload = (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode("ascii")
        if len(payload) > MAX_BYTES:
            raise BuilderRejected("seed workspace journal exceeds its size limit")
        fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                     0o600, dir_fd=self.root_fd)
        try:
            view = memoryview(payload)
            while view:
                written = os.write(fd, view)
                if written <= 0:
                    raise BuilderRejected("seed workspace journal write was incomplete")
                view = view[written:]
            os.fsync(fd)
            info = os.fstat(fd)
            if (not stat.S_ISREG(info.st_mode) or info.st_uid != self.owner_uid
                    or stat.S_IMODE(info.st_mode) != 0o600 or info.st_nlink != 1):
                raise BuilderRejected("seed workspace journal temporary is unsafe")
        except BaseException:
            os.close(fd)
            raise
        os.close(fd)
        if create:
            rename_noreplace(self.root_fd, temp, JOURNAL_NAME)
        else:
            os.replace(temp, JOURNAL_NAME, src_dir_fd=self.root_fd, dst_dir_fd=self.root_fd)
        os.fsync(self.root_fd)

    def _cleanup_temps(self, transaction_id: str | None,
                       journal_identity: tuple[int, int] | None = None) -> None:
        for name in os.listdir(self.root_fd):
            match = TEMP_RE.fullmatch(name)
            if match is None:
                continue
            info = os.stat(name, dir_fd=self.root_fd, follow_symlinks=False)
            if (not stat.S_ISREG(info.st_mode) or info.st_uid != self.owner_uid
                    or info.st_nlink not in (1, 2) or stat.S_IMODE(info.st_mode) != 0o600
                    or info.st_size > MAX_BYTES):
                raise BuilderRejected("seed workspace journal temporary is unsafe")
            if transaction_id is not None and match.group(1) != transaction_id:
                raise BuilderRejected("seed workspace journal temporary transaction differs")
            if info.st_nlink == 2 and (
                journal_identity is None
                or (info.st_dev, info.st_ino) != journal_identity
            ):
                raise BuilderRejected("seed workspace journal hardlink window is not exact")
            if transaction_id is not None and match.group(1) != transaction_id:
                raise BuilderRejected("seed workspace journal temporary transaction differs")
            # Temporary records are never authoritative. With a primary record,
            # recovery uses its earlier durable phase and rolls back. Without a
            # primary record, begin() has not returned and resource mutation has
            # not started. Removing a bounded root-owned protocol temp is safe
            # even when SIGKILL interrupted its JSON write.
            os.unlink(name, dir_fd=self.root_fd)
            os.fsync(self.root_fd)
