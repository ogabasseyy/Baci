"""Crash-safe exact-fence journal for one transient dependency builder unit."""
from __future__ import annotations

import json
import grp
import os
import re
import stat, time
from pathlib import Path
from typing import Any, Callable

from worker_release_dependency_supervisor import (
    CGROUP_ROOT, BuilderSupervisorRejected, _control_group, _drain_until_proven,
    _open_cgroup, _systemctl, _validate_live_unit, preflight_cgroup_root,
)
from worker_release_dependency_supervisor_cgroup import UnitCgroupAbsent, prove_collected_unit, bounded_systemctl_query
from worker_release_descriptor_cgroup import require_empty_cgroup, require_process_member

JOURNAL = "dependency-builder-unit.json"
MAX_RECORD_BYTES = 16_384
FENCE_FIELDS = {"repository", "workflow", "ref", "sha", "run_id", "run_attempt", "job_id"}

class BuilderJournalRejected(RuntimeError):
    """The builder unit journal cannot authorize launch, recovery, or cleanup."""


def _valid_fence(fence: object, sha: str) -> bool:
    return (isinstance(fence, dict) and set(fence) == FENCE_FIELDS and fence.get("sha") == sha
            and type(fence.get("run_attempt")) is int and fence["run_attempt"] > 0
            and all(isinstance(fence.get(key), str) and fence[key]
                    for key in FENCE_FIELDS - {"run_attempt"}))


class BuilderUnitJournal:
    """Caller must hold the release lock for every journal transition."""

    def __init__(self, worker_root: Path, *, owner_uid: int = 0):
        if os.geteuid() != owner_uid:
            raise BuilderJournalRejected("builder journal caller identity is invalid")
        self.root = Path(worker_root)
        info = self.root.lstat()
        private_root = stat.S_IMODE(info.st_mode) == 0o700
        provisioned_worker_root = False
        if owner_uid == 0 and stat.S_IMODE(info.st_mode) == 0o710:
            try:
                provisioned_worker_root = info.st_gid == grp.getgrnam("baci-locks").gr_gid
            except KeyError:
                provisioned_worker_root = False
        if (not stat.S_ISDIR(info.st_mode) or info.st_uid != owner_uid
                or not (private_root or provisioned_worker_root)):
            raise BuilderJournalRejected("builder journal root is not owner-private")
        self.fd = os.open(self.root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        opened = os.fstat(self.fd)
        if (opened.st_dev, opened.st_ino) != (info.st_dev, info.st_ino):
            os.close(self.fd)
            raise BuilderJournalRejected("builder journal root changed while opening")
        self.owner_uid = owner_uid

    def close(self) -> None:
        if self.fd >= 0:
            os.close(self.fd)
            self.fd = -1

    def __enter__(self) -> "BuilderUnitJournal":
        return self

    def __exit__(self, *_exc) -> None:
        self.close()

    def read(self) -> dict[str, Any] | None:
        try:
            fd = os.open(JOURNAL, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=self.fd)
        except FileNotFoundError:
            return None
        except OSError as error:
            raise BuilderJournalRejected("builder unit journal is unavailable") from error
        try:
            before = os.fstat(fd)
            if (not stat.S_ISREG(before.st_mode) or before.st_uid != self.owner_uid
                    or stat.S_IMODE(before.st_mode) != 0o600 or before.st_size > MAX_RECORD_BYTES):
                raise BuilderJournalRejected("builder journal owner, mode, or size is unsafe")
            raw = os.read(fd, before.st_size + 1)
            after = os.fstat(fd)
            if (len(raw) != before.st_size or (before.st_dev, before.st_ino, before.st_mtime_ns)
                    != (after.st_dev, after.st_ino, after.st_mtime_ns)):
                raise BuilderJournalRejected("builder journal changed during read")
        finally:
            os.close(fd)
        try:
            value = json.loads(raw)
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise BuilderJournalRejected("builder journal is malformed") from error
        if (not isinstance(value, dict) or value.get("schema") != 1
                or not re.fullmatch(r"[0-9a-f]{32}", str(value.get("transaction_id", "")))
                or not re.fullmatch(r"[0-9a-f]{40}", str(value.get("sha", "")))
                or not _valid_fence(value.get("fence"), value.get("sha"))
                or not re.fullmatch(r"baci-worker-deps-[0-9a-f]{12}-[0-9a-f]{32}\.service",
                                    str(value.get("unit", "")))
                or not value["unit"].startswith(f"baci-worker-deps-{value['sha'][:12]}-")
                or value.get("phase") not in ("prepared", "running", "drained")
                or type(value.get("uid")) is not int or value["uid"] <= 0
                or type(value.get("gid")) is not int or value["gid"] <= 0
                or not isinstance(value.get("source_path"), str)
                or not isinstance(value.get("scratch_path"), str)
                or not self._optional_path_fields_valid(value, "input_path")
                or not self._optional_path_fields_valid(value, "result_path")):
            raise BuilderJournalRejected("builder journal fields are invalid")
        return value

    @staticmethod
    def _optional_path_fields_valid(value: dict[str, Any], prefix: str) -> bool:
        path = value.get(prefix)
        dev, ino = value.get(f"{prefix}_dev"), value.get(f"{prefix}_ino")
        return ((path is None and dev is None and ino is None)
                or (isinstance(path, str) and type(dev) is int and type(ino) is int
                    and type(value.get(f"{prefix}_gid")) is int))

    def _write(self, value: dict[str, Any], *, create: bool = False) -> None:
        temp = f".{JOURNAL}.{value['transaction_id']}.tmp"
        try:
            fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                         0o600, dir_fd=self.fd)
        except FileExistsError as error:
            prior = self.read()
            try:
                info = os.stat(temp, dir_fd=self.fd, follow_symlinks=False)
            except FileNotFoundError:
                raise BuilderJournalRejected("builder journal temporary state changed") from error
            if (create or prior is None or prior["transaction_id"] != value["transaction_id"]
                    or not stat.S_ISREG(info.st_mode) or info.st_uid != self.owner_uid
                    or stat.S_IMODE(info.st_mode) != 0o600 or info.st_nlink not in (1, 2)
                    or info.st_size > MAX_RECORD_BYTES):
                raise BuilderJournalRejected("builder journal has unresolved temporary state") from error
            os.unlink(temp, dir_fd=self.fd)
            os.fsync(self.fd)
            fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                         0o600, dir_fd=self.fd)
        try:
            data = json.dumps(value, sort_keys=True, separators=(",", ":")).encode("ascii")
            if len(data) > MAX_RECORD_BYTES or os.write(fd, data) != len(data):
                raise BuilderJournalRejected("builder journal write exceeded its bound")
            os.fsync(fd)
        finally:
            os.close(fd)
        try:
            if create:
                os.link(temp, JOURNAL, src_dir_fd=self.fd, dst_dir_fd=self.fd,
                        follow_symlinks=False)
                os.unlink(temp, dir_fd=self.fd)
            else:
                os.replace(temp, JOURNAL, src_dir_fd=self.fd, dst_dir_fd=self.fd)
            os.fsync(self.fd)
        except BaseException:
            try:
                os.unlink(temp, dir_fd=self.fd)
            except FileNotFoundError:
                pass
            raise

    def begin(self, fence: dict[str, object], unit: str, source: Path,
              scratch: Path, uid: int, gid: int, *,
              input_root: Path | None = None,
              result_dir: Path | None = None) -> dict[str, Any]:
        sha = fence.get("sha") if isinstance(fence, dict) else None
        if (not isinstance(sha, str) or not re.fullmatch(r"[0-9a-f]{40}", sha)
                or not _valid_fence(fence, sha) or not unit.startswith(f"baci-worker-deps-{sha[:12]}-")
                or _control_group(unit) != f"/system.slice/{unit}"):
            raise BuilderJournalRejected("builder journal fence or unit is invalid")
        source_info, scratch_info = source.lstat(), scratch.lstat()
        if (not stat.S_ISDIR(source_info.st_mode) or source_info.st_uid != self.owner_uid
                or source_info.st_mode & 0o022 or not stat.S_ISDIR(scratch_info.st_mode)
                or scratch_info.st_uid != uid or scratch_info.st_gid != gid
                or stat.S_IMODE(scratch_info.st_mode) != 0o700):
            raise BuilderJournalRejected("builder source or scratch identity is unsafe")
        resources: dict[str, Any] = {}
        for name, path, expected_mode in (("input_path", input_root, 0o555),
                                          ("result_path", result_dir, 0o700)):
            if path is None:
                resources.update({name: None, f"{name}_dev": None, f"{name}_ino": None,
                                  f"{name}_gid": None})
                continue
            info = path.lstat()
            if (not stat.S_ISDIR(info.st_mode) or info.st_uid != self.owner_uid
                    or stat.S_IMODE(info.st_mode) != expected_mode or info.st_mode & 0o022):
                raise BuilderJournalRejected(f"builder {name} identity or mode is unsafe")
            resources.update({name: str(path), f"{name}_dev": info.st_dev,
                              f"{name}_ino": info.st_ino, f"{name}_gid": info.st_gid})
        if self.read() is not None:
            raise BuilderJournalRejected("builder journal has an unresolved prior run")
        transaction_id = unit.rsplit("-", 1)[1].removesuffix(".service")
        record = {"schema": 1, "transaction_id": transaction_id, "phase": "prepared",
                  "fence": fence, "sha": sha, "unit": unit, "uid": uid, "gid": gid,
                  "source_path": str(source), "source_dev": source_info.st_dev,
                  "source_ino": source_info.st_ino, "scratch_path": str(scratch),
                  "scratch_dev": scratch_info.st_dev, "scratch_ino": scratch_info.st_ino,
                  **resources, "cgroup_dev": None, "cgroup_ino": None}
        self._write(record, create=True)
        return record

    def mark_running(self, info: os.stat_result) -> None:
        record = self.read()
        if record is None or record["phase"] != "prepared":
            raise BuilderJournalRejected("builder journal is not prepared")
        record.update(phase="running", cgroup_dev=info.st_dev, cgroup_ino=info.st_ino)
        self._write(record)

    def mark_drained(self, info: os.stat_result | None) -> None:
        record = self.read()
        if record is None:
            raise BuilderJournalRejected("builder journal cannot record drained state")
        if record["phase"] == "drained":
            recorded = (record["cgroup_dev"], record["cgroup_ino"])
            supplied = None if info is None else (info.st_dev, info.st_ino)
            if (recorded is None and supplied is None) or recorded == supplied:
                return
            if supplied is None:
                # The caller may supply None only after proving systemd has
                # collected the exact unit cgroup. Clear the now-stale inode
                # while replaying a durable drained transition.
                record.update(cgroup_dev=None, cgroup_ino=None)
                self._write(record)
                return
            raise BuilderJournalRejected("drained builder journal cgroup identity changed")
        if record["phase"] not in ("prepared", "running"):
            raise BuilderJournalRejected("builder journal cannot record drained state")
        if info is not None:
            if (record["phase"] == "running" and (record["cgroup_dev"], record["cgroup_ino"])
                    != (info.st_dev, info.st_ino)):
                raise BuilderJournalRejected("builder journal cgroup inode changed")
            record.update(cgroup_dev=info.st_dev, cgroup_ino=info.st_ino)
        else:
            # None is recorded only after the caller's collected-unit proof.
            record.update(cgroup_dev=None, cgroup_ino=None)
        record["phase"] = "drained"
        self._write(record)

    def clear(self, fence: dict[str, object], *, resources_removed: Callable[[dict[str, Any]], bool]) -> None:
        record = self.read()
        if record is None:
            return
        if (record["phase"] != "drained" or record["fence"] != fence
                or resources_removed(record) is not True):
            raise BuilderJournalRejected("builder journal clear lacks exact resource cleanup proof")
        os.unlink(JOURNAL, dir_fd=self.fd)
        os.fsync(self.fd)


def recover_recorded_builder(journal: BuilderUnitJournal, fence: dict[str, object], *, terminal_attempt_proven: Callable[[dict[str, object]], bool]) -> str:
    """Stop the exact recorded unit after terminal proof; leave scratch for journal cleanup."""
    record = journal.read()
    if record is None:
        return "clean"
    if record["fence"] != fence or terminal_attempt_proven(fence) is not True:
        raise BuilderJournalRejected("builder recovery lacks matching terminal-run proof")
    try:
        trusted_root = preflight_cgroup_root(CGROUP_ROOT)
    except (OSError, RuntimeError) as error:
        raise BuilderJournalRejected("builder recovery cgroup v2 hierarchy is unavailable") from error
    unit = record["unit"]
    recovery_deadline = time.monotonic() + 5
    bounded_query = lambda *args: bounded_systemctl_query(_systemctl, recovery_deadline, BuilderSupervisorRejected, *args)
    try:
        load_state = bounded_query("show", "--property=LoadState", "--value", unit)
    except BuilderSupervisorRejected as error:
        raise BuilderJournalRejected("builder recovery cannot query systemd") from error
    try:
        fd, info = _open_cgroup(unit, trusted_root=trusted_root)
    except UnitCgroupAbsent:
        if load_state != "not-found":
            raise BuilderJournalRejected("builder recovery cgroup is unavailable") from None
        try:
            prove_collected_unit(unit, None, root=CGROUP_ROOT, uid=record["uid"],
                                 deadline=recovery_deadline, query=bounded_query,
                                 trusted_root=trusted_root)
        except (OSError, RuntimeError) as error: raise BuilderJournalRejected("builder recovery collected-unit proof failed") from error
        journal.mark_drained(None)
        return "drained"
    except OSError as error:
        raise BuilderJournalRejected("builder recovery cannot open the cgroup hierarchy") from error
    try:
        if record["cgroup_dev"] is not None and (record["cgroup_dev"], record["cgroup_ino"]) != (
                info.st_dev, info.st_ino):
            raise BuilderJournalRejected("builder recovery cgroup inode differs from journal")
        try:
            active = _systemctl("show", "--property=ActiveState", "--value", unit)
        except BuilderSupervisorRejected:
            active = "unknown"
        if record["phase"] == "drained" and active not in ("inactive", "not-found"):
            raise BuilderJournalRejected("drained builder unit unexpectedly became active")
        if active not in ("inactive", "not-found"):
            path = _systemctl("show", "--property=ControlGroup", "--value", unit)
            if path != _control_group(unit):
                raise BuilderJournalRejected("builder recovery unit path differs from journal")
            _validate_live_unit(unit, path, record["uid"], record["gid"],
                                Path(record["source_path"]), Path(record["scratch_path"]))
            pid = int(_systemctl("show", "--property=MainPID", "--value", unit))
            require_process_member(fd, info.st_dev, info.st_ino, pid)
            _drain_until_proven(unit, fd, info, None,
                                deadline=time.monotonic() + 30,
                                uid=record["uid"], trusted_root=trusted_root)
        else:
            require_empty_cgroup(fd, info.st_dev, info.st_ino)
        journal.mark_drained(info)
        return "drained"
    finally:
        os.close(fd)


__all__ = ["BuilderJournalRejected", "BuilderUnitJournal", "JOURNAL", "recover_recorded_builder"]
