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
from worker_release_result_root import PinnedResultRoot, pin_result_root
from worker_release_stage_journal_resources import StageResources
from worker_release_stage_journal_recovery import recover as _recover_stage


class StageJournal:
    """Root-owned journal for one staged incoming release transaction."""

    def __init__(self, worker_root: Path, *, owner_uid: int = 0, stage_uid: int | None = None,
                 stage_gid: int | None = None, resource_root: Path | None = None):
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
        self._resources_pin: PinnedResultRoot | None = None
        try:
            self._releases_fd = os.open("releases", os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                                        dir_fd=self._root_fd)
            opened = os.fstat(self._releases_fd)
            if opened.st_uid != owner_uid or opened.st_mode & 0o022:
                _reject("release staging directory changed during open")
            if resource_root is not None:
                self._resources_pin = pin_result_root(Path(resource_root), owner_uid=owner_uid)
            self.resources = StageResources(
                Path(resource_root) if resource_root is not None else None,
                self._resources_pin.fd if self._resources_pin is not None else None,
                owner_uid, self.stage_uid, self.stage_gid, lambda value: self._write(value),
            )
        except BaseException:
            self.close()
            raise

    def close(self) -> None:
        if self._resources_pin is not None:
            self._resources_pin.close()
            self._resources_pin = None
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

    def _verify_resource_root(self, value: dict[str, Any]) -> None:
        if self._resources_pin is None:
            if value.get("resource_root_dev") is not None:
                _reject("stage resource root is unavailable")
            return
        self._resources_pin.verify_unchanged()
        info = os.fstat(self._resources_pin.fd)
        if (info.st_dev, info.st_ino) != (value.get("resource_root_dev"), value.get("resource_root_ino")):
            _reject("stage resource root inode changed")

    def begin(self, fence: dict[str, Any], archive_sha256: str) -> dict[str, Any]:
        if self._resources_pin is not None:
            self._resources_pin.verify_unchanged()
        if self._load() is not None:
            _reject("unresolved stage journal blocks another release stage")
        self._validate({
            "schema": 1, "phase": "intent", "transaction_id": "0" * 32,
            "fence": fence, "archive_sha256": archive_sha256,
            "incoming_name": f".{fence.get('sha')}.incoming." + "0" * 32,
            "release_name": fence.get("sha"), "stage_uid": self.stage_uid,
            "stage_gid": self.stage_gid,
            "incoming_dev": None, "incoming_ino": None,
            **self.resources.journal_fields(fence.get("sha"), "0" * 32),
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
            **self.resources.journal_fields(fence["sha"], transaction_id),
        }
        self._verify_resource_root(value)
        self._write(value, create=True)
        return dict(value)

    def create_source_snapshot(self) -> Path:
        value = self._require_journal()
        self._verify_resource_root(value)
        result = self.resources.create(value, "source")
        self._verify_resource_root(value)
        return result

    def create_builder_result(self) -> Path:
        """Record the result directory inode before a builder writes into it."""
        value = self._require_journal()
        self._verify_resource_root(value)
        result = self.resources.create(value, "result")
        self._verify_resource_root(value)
        return result

    def remove_source_snapshot(self) -> None:
        value = self._require_journal()
        self._verify_resource_root(value)
        self.resources.remove(value, "source")

    def remove_builder_result(self) -> None:
        value = self._require_journal()
        self._verify_resource_root(value)
        self.resources.remove(value, "result")

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
        self._verify_resource_root(value)
        self.resources.assert_removed(value)
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
        self._verify_resource_root(value)
        self.resources.assert_removed(value)
        self._verify_directory(value["release_name"], value, expected_uid=self.owner_uid,
                               expected_gid=self.stage_gid)
        self._verify_committed_tree(value)
        self._unlink_journal()

    def recover(self, *, terminal_attempt_proven: Callable[[dict[str, Any]], bool],
                current_link: str = "current",
                resources_quiesced: Callable[[dict[str, Any]], bool] | None = None) -> str:
        """Discard only a journal-owned incomplete tree after terminal proof."""
        return _recover_stage(self, terminal_attempt_proven=terminal_attempt_proven,
                              current_link=current_link, resources_quiesced=resources_quiesced)

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
