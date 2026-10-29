"""Disconnected durable journal for interrupted incoming worker releases.

This prototype is not wired into the broker. Callers must hold release.lock
for every journal transition and recovery operation.
"""
from __future__ import annotations

import os
import re
import shutil
import stat
import uuid
from pathlib import Path
from typing import Callable, Any

from worker_release_stage_journal_io import (
    JOURNAL, StageJournalError, load as load_journal, reject as _reject,
    trusted_directory as _trusted_directory, verify_frozen_release, write as write_journal,
)


class StageJournal:
    """Root-owned journal for one staged incoming release transaction."""

    def __init__(self, worker_root: Path, *, owner_uid: int = 0, stage_uid: int | None = None,
                 stage_gid: int | None = None):
        self.root = Path(worker_root)
        self.owner_uid = owner_uid
        self.stage_uid = owner_uid if stage_uid is None else stage_uid
        self.stage_gid = os.getgid() if stage_gid is None else stage_gid
        if os.geteuid() != owner_uid:
            _reject("stage journal must be managed by its trusted owner")
        _trusted_directory(self.root, owner_uid)
        self.releases = self.root / "releases"
        _trusted_directory(self.releases, owner_uid)
        self._root_fd = os.open(self.root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        self._releases_fd = -1
        try:
            self._releases_fd = os.open("releases", os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                                        dir_fd=self._root_fd)
            opened = os.fstat(self._releases_fd)
            if opened.st_uid != owner_uid or opened.st_mode & 0o022:
                _reject("release staging directory changed during open")
        except BaseException:
            self.close()
            raise

    def close(self) -> None:
        if self._releases_fd >= 0:
            os.close(self._releases_fd)
            self._releases_fd = -1
        if self._root_fd >= 0:
            os.close(self._root_fd)
            self._root_fd = -1

    def __enter__(self) -> "StageJournal":
        return self

    def __exit__(self, *_exc) -> None:
        self.close()

    def _load(self) -> dict[str, Any] | None:
        return load_journal(self._root_fd, owner_uid=self.owner_uid, stage_uid=self.stage_uid,
                            stage_gid=self.stage_gid)

    def _validate(self, value: dict[str, Any]) -> None:
        from worker_release_stage_journal_io import validate
        validate(value, stage_uid=self.stage_uid, stage_gid=self.stage_gid)

    def _write(self, value: dict[str, Any], *, create: bool = False) -> None:
        write_journal(self._root_fd, value, owner_uid=self.owner_uid,
                      stage_uid=self.stage_uid, stage_gid=self.stage_gid, create=create)

    def begin(self, fence: dict[str, Any], archive_sha256: str) -> dict[str, Any]:
        if self._load() is not None:
            _reject("unresolved stage journal blocks another release stage")
        self._validate({
            "schema": 1, "phase": "intent", "transaction_id": "0" * 32,
            "fence": fence, "archive_sha256": archive_sha256,
            "incoming_name": f".{fence.get('sha')}.incoming." + "0" * 32,
            "release_name": fence.get("sha"), "stage_uid": self.stage_uid,
            "stage_gid": self.stage_gid,
            "incoming_dev": None, "incoming_ino": None,
        })
        if self._exists(fence["sha"]):
            _reject("release SHA already exists")
        transaction_id = uuid.uuid4().hex
        incoming_name = f".{fence['sha']}.incoming.{transaction_id}"
        if self._exists(incoming_name):
            _reject("randomized incoming release path already exists")
        value = {
            "schema": 1, "phase": "intent", "transaction_id": transaction_id,
            "fence": dict(fence), "archive_sha256": archive_sha256,
            "incoming_name": incoming_name,
            "release_name": fence["sha"], "stage_uid": self.stage_uid,
            "stage_gid": self.stage_gid,
            "incoming_dev": None, "incoming_ino": None,
        }
        self._write(value, create=True)
        return dict(value)

    def create_incoming(self) -> Path:
        value = self._require_journal()
        if value["phase"] != "intent":
            _reject("incoming directory creation is out of sequence")
        os.mkdir(value["incoming_name"], 0o700, dir_fd=self._releases_fd)
        self._sync_releases()
        fd = os.open(value["incoming_name"], os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                     dir_fd=self._releases_fd)
        try:
            os.fchown(fd, self.stage_uid, self.stage_gid)
            os.fchmod(fd, 0o700)
            os.fsync(fd)
            info = os.fstat(fd)
            if (info.st_uid != self.stage_uid or info.st_gid != self.stage_gid
                    or info.st_mode & 0o077):
                _reject("new incoming release ownership or mode is unsafe")
            value.update(phase="incoming", incoming_dev=info.st_dev, incoming_ino=info.st_ino)
            self._write(value)
        finally:
            os.close(fd)
        return self.releases / value["incoming_name"]

    def publish(self) -> Path:
        value = self._require_journal()
        if value["phase"] != "ownership_transfer":
            _reject("stage publication is out of sequence")
        self._verify_directory(value["incoming_name"], value,
                               expected_uid=(self.stage_uid, self.owner_uid),
                               expected_gid=self.stage_gid)
        if self._exists(value["release_name"]):
            _reject("release SHA appeared before publication")
        os.rename(value["incoming_name"], value["release_name"],
                  src_dir_fd=self._releases_fd, dst_dir_fd=self._releases_fd)
        self._sync_releases()
        value["phase"] = "published"
        self._write(value)
        return self.releases / value["release_name"]

    def begin_ownership_transfer(self) -> None:
        """Durably enter the phase before caller recursively chowns the tree."""
        value = self._require_journal()
        if value["phase"] != "incoming":
            _reject("ownership transfer is out of sequence")
        self._verify_directory(value["incoming_name"], value, expected_uid=self.stage_uid,
                               expected_gid=self.stage_gid)
        value["phase"] = "ownership_transfer"
        self._write(value)

    def commit(self) -> None:
        value = self._require_journal()
        if value["phase"] != "published":
            _reject("stage commit is out of sequence")
        self._verify_directory(value["release_name"], value, expected_uid=self.owner_uid,
                               expected_gid=self.stage_gid)
        verify_frozen_release(self._releases_fd, value["release_name"],
                              dev=value["incoming_dev"], ino=value["incoming_ino"],
                              owner_uid=self.owner_uid, worker_gid=self.stage_gid)
        value["phase"] = "committed"
        self._write(value)

    def finish(self) -> None:
        value = self._require_journal()
        if value["phase"] != "committed":
            _reject("cannot finish an uncommitted stage")
        self._verify_directory(value["release_name"], value, expected_uid=self.owner_uid,
                               expected_gid=self.stage_gid)
        self._verify_committed_tree(value)
        self._unlink_journal()

    def recover(self, *, terminal_attempt_proven: Callable[[dict[str, Any]], bool],
                current_link: str = "current") -> str:
        """Discard only a journal-owned incomplete tree after terminal proof."""
        value = self._require_journal()
        if value["phase"] == "committed":
            self._verify_directory(value["release_name"], value, expected_uid=self.owner_uid,
                                   expected_gid=self.stage_gid)
            self._verify_committed_tree(value)
            self._unlink_journal()
            return "committed"
        if terminal_attempt_proven(value["fence"]) is not True:
            _reject("stage recovery requires proof that the owning run attempt is terminal")
        sha = value["fence"]["sha"]
        if self._current_sha(current_link) == sha:
            _reject("refusing to discard the active release")
        incoming_exists = self._exists(value["incoming_name"])
        final_exists = self._exists(value["release_name"])
        if incoming_exists and final_exists:
            _reject("both incoming and published release paths exist")
        if incoming_exists:
            if value["incoming_ino"] is None:
                _reject("cannot discard an incoming path without its recorded inode")
            if value["phase"] not in ("incoming", "ownership_transfer"):
                _reject("incoming path is inconsistent with the journal phase")
            allowed_uids = ((self.stage_uid, self.owner_uid)
                            if value["phase"] == "ownership_transfer" else self.stage_uid)
            self._verify_directory(value["incoming_name"], value, expected_uid=allowed_uids,
                                   expected_gid=self.stage_gid)
            self._remove_exact(value["incoming_name"])
        elif final_exists:
            if value["incoming_ino"] is None:
                _reject("cannot discard a published path without its recorded inode")
            if value["phase"] not in ("ownership_transfer", "published"):
                _reject("published path is inconsistent with the journal phase")
            allowed_uids = ((self.stage_uid, self.owner_uid)
                            if value["phase"] in ("ownership_transfer", "published")
                            else self.owner_uid)
            self._verify_directory(value["release_name"], value, expected_uid=allowed_uids,
                                   expected_gid=self.stage_gid)
            self._remove_exact(value["release_name"])
        self._sync_releases()
        self._unlink_journal()
        return "discarded"

    def _verify_directory(self, name: str, value: dict[str, Any], *, expected_uid: int | tuple[int, ...],
                          expected_gid: int) -> os.stat_result:
        try:
            fd = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=self._releases_fd)
        except OSError as error:
            raise StageJournalError("journal-owned release directory is unavailable or unsafe") from error
        try:
            info = os.fstat(fd)
            expected_uids = expected_uid if isinstance(expected_uid, tuple) else (expected_uid,)
            if (not stat.S_ISDIR(info.st_mode) or info.st_uid not in expected_uids
                    or info.st_gid != expected_gid or info.st_mode & 0o022):
                _reject("journal-owned release directory ownership or mode changed")
            if value["incoming_ino"] is None:
                _reject("journal-owned release directory lacks recorded inode")
            elif (info.st_dev, info.st_ino) != (value["incoming_dev"], value["incoming_ino"]):
                _reject("journal-owned release directory inode changed")
            return info
        finally:
            os.close(fd)

    def _remove_exact(self, name: str) -> None:
        if not shutil.rmtree.avoids_symlink_attacks:
            _reject("safe descriptor-based release cleanup is unavailable")
        shutil.rmtree(name, dir_fd=self._releases_fd)
        if self._exists(name):
            _reject("journal-owned release directory remains after cleanup")

    def _verify_committed_tree(self, value: dict[str, Any]) -> None:
        verify_frozen_release(self._releases_fd, value["release_name"],
                              dev=value["incoming_dev"], ino=value["incoming_ino"],
                              owner_uid=self.owner_uid, worker_gid=self.stage_gid)

    def _current_sha(self, link_name: str) -> str | None:
        try:
            target = os.readlink(link_name, dir_fd=self._root_fd)
        except FileNotFoundError:
            return None
        match = re.fullmatch(r"releases/([0-9a-f]{40})", target)
        if not match:
            _reject("current release pointer is invalid")
        return match.group(1)

    def _exists(self, name: str) -> bool:
        try:
            os.stat(name, dir_fd=self._releases_fd, follow_symlinks=False)
            return True
        except FileNotFoundError:
            return False

    def _sync_releases(self) -> None:
        os.fsync(self._releases_fd)

    def _require_journal(self) -> dict[str, Any]:
        value = self._load()
        if value is None:
            _reject("stage journal is absent")
        return value

    def _unlink_journal(self) -> None:
        os.unlink(JOURNAL, dir_fd=self._root_fd)
        os.fsync(self._root_fd)


__all__ = ["StageJournal", "StageJournalError"]
