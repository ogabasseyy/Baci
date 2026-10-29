"""Fixed transient-systemd supervisor for the dependency builder sandbox.

Disconnected prototype: callers must retain the release lock and journal the
builder's scratch resources. If the supervisor cannot prove cgroup emptiness it
raises without claiming quiescence; current builder cleanup is not safe to wire
to that exceptional path yet.
"""
from __future__ import annotations

import os
import re
import stat
import subprocess
import sys
import time
from pathlib import Path
from typing import Callable

from worker_release_dependency_fs import directory_usage
from worker_release_descriptor_cgroup import (
    CgroupProofRejected, _require_cgroup2_fd, require_process_member,
)
from worker_release_dependency_supervisor_contract import (
    BuilderUnitContractRejected, validate_builder_unit,
)
from worker_release_dependency_supervisor_cgroup import (
    bounded_systemctl_query, postspawn_drain,
    UnitCgroupAbsent, drain_unpinned_until_proven as _drain_unpinned,
    drain_until_proven as _drain_cgroup,
    open_unit_cgroup, preflight_cgroup_root,
)

SYSTEMD_RUN = "/usr/bin/systemd-run"
SYSTEMCTL = "/usr/bin/systemctl"
CGROUP_ROOT = Path("/sys/fs/cgroup")
MAX_BUILD_SECONDS = 300
MAX_CLEANUP_SECONDS = 30
POLL_SECONDS = 0.1
MAX_SCRATCH_ENTRIES = 200_000
MAX_SCRATCH_BYTES = 1536 * 1024 * 1024


class BuilderSupervisorRejected(RuntimeError):
    """The fixed builder unit did not complete under a proven cgroup boundary."""


class BuilderQuiescenceUnproven(BuilderSupervisorRejected):
    """The unit may still be running; its journaled scratch must be quarantined."""

    def __init__(self, unit: str, reason: str):
        self.unit = unit
        self.reason = reason
        super().__init__(f"builder quiescence unproven for {unit}: {reason}")


def _control_group(unit: str) -> str:
    if not re.fullmatch(r"baci-worker-deps-[0-9a-f]{12}-[0-9a-f]{32}\.service", unit):
        raise BuilderSupervisorRejected("builder unit name is not transaction-bound")
    return f"/system.slice/{unit}"


def _open_cgroup(unit: str, *, trusted_root=None) -> tuple[int, os.stat_result]:
    return open_unit_cgroup(CGROUP_ROOT, unit, trusted_root=trusted_root)


def _systemctl(*args: str, timeout: float = 1) -> str:
    try:
        result = subprocess.run((SYSTEMCTL, *args), check=True, stdin=subprocess.DEVNULL,
                                stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                timeout=timeout, text=True, env={"PATH": "/usr/bin:/bin"})
    except (OSError, subprocess.SubprocessError) as error:
        raise BuilderSupervisorRejected("builder systemd query failed") from error
    return result.stdout.strip()


def _spawn_unit(command: tuple[str, ...]) -> subprocess.Popen:
    return subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                            stderr=subprocess.DEVNULL, env={"PATH": "/usr/bin:/bin"})


def _validate_live_unit(unit: str, cgroup_path: str, uid: int, gid: int,
                        source: Path, scratch: Path) -> None:
    try:
        validate_builder_unit(_systemctl, unit, cgroup_path, uid, gid, source, scratch)
    except BuilderUnitContractRejected as error:
        raise BuilderSupervisorRejected(str(error)) from error


def _drain_until_proven(unit: str, fd: int, info: os.stat_result,
                        process: subprocess.Popen | None, *, deadline: float,
                        journal=None, uid: int | None = None,
                        trusted_root=None) -> None:
    def bounded_query(*args: str) -> str:
        return bounded_systemctl_query(_systemctl, deadline, BuilderSupervisorRejected, *args)

    _drain_cgroup(unit, fd, info, process, systemctl=SYSTEMCTL, query=bounded_query,
                  rejected=BuilderSupervisorRejected, deadline=deadline,
                  unproven=BuilderQuiescenceUnproven, journal=journal,
                  root=CGROUP_ROOT, uid=uid, trusted_root=trusted_root)


def _drain_unpinned_until_proven(unit: str, process: subprocess.Popen, *,
                                 deadline: float, journal=None,
                                 uid: int | None = None, trusted_root=None) -> None:
    _drain_unpinned(unit, process, root=CGROUP_ROOT, systemctl=SYSTEMCTL,
                    query=lambda *args: bounded_systemctl_query(
                        _systemctl, deadline, BuilderSupervisorRejected, *args),
                    rejected=BuilderSupervisorRejected,
                    deadline=deadline, unproven=BuilderQuiescenceUnproven,
                    journal=journal, uid=uid, trusted_root=trusted_root)


def supervise_builder_unit(source: Path, scratch: Path, expected_sha: str, uid: int,
                           gid: int, unit: str, *, usage_root: Path,
                           unit_journal=None) -> None:
    """Run the canonical systemd command and return only after cgroup-empty proof."""
    if os.geteuid() != 0 or not sys.platform.startswith("linux"):
        raise BuilderSupervisorRejected("builder supervisor requires Linux root")
    expected_path = _control_group(unit)
    if (not re.fullmatch(r"[0-9a-f]{40}", expected_sha)
            or not unit.startswith(f"baci-worker-deps-{expected_sha[:12]}-")
            or uid <= 0 or gid <= 0
            or source.is_symlink() or scratch.is_symlink()):
        raise BuilderSupervisorRejected("builder supervisor inputs are invalid")
    record = unit_journal.read() if unit_journal is not None else None
    source_info, scratch_info = source.lstat(), scratch.lstat()
    if (record is None or record.get("phase") != "prepared"
            or (record.get("unit"), record.get("sha"), record.get("uid"), record.get("gid"))
            != (unit, expected_sha, uid, gid)
            or record.get("source_path") != str(source)
            or (record.get("source_dev"), record.get("source_ino"))
            != (source_info.st_dev, source_info.st_ino)
            or record.get("scratch_path") != str(scratch)
            or (record.get("scratch_dev"), record.get("scratch_ino"))
            != (scratch_info.st_dev, scratch_info.st_ino)):
        raise BuilderSupervisorRejected("builder unit has no exact durable fence record")
    for key in ("input_path", "result_path"):
        path = record.get(key)
        if path is None:
            continue
        try:
            info = Path(path).lstat()
        except OSError as error:
            raise BuilderSupervisorRejected("journaled builder resource disappeared before launch") from error
        if (not stat.S_ISDIR(info.st_mode)
                or (info.st_dev, info.st_ino)
                != (record.get(f"{key}_dev"), record.get(f"{key}_ino"))):
            raise BuilderSupervisorRejected("journaled builder resource inode changed before launch")
    if record.get("input_path") is not None and Path(record["input_path"]) != source.parent:
        raise BuilderSupervisorRejected("builder source is outside its journaled input root")
    from worker_release_dependency_sandbox import systemd_command

    command = systemd_command(source, scratch, expected_sha, uid, gid, unit)
    try:
        trusted_root = preflight_cgroup_root(CGROUP_ROOT)
    except (OSError, CgroupProofRejected, RuntimeError) as error:
        raise BuilderSupervisorRejected("required cgroup v2 system.slice is unavailable") from error
    started = time.monotonic()
    build_deadline = started + MAX_BUILD_SECONDS
    cleanup_deadline = started + MAX_BUILD_SECONDS + MAX_CLEANUP_SECONDS
    try:
        process = _spawn_unit(command)
    except OSError as error:
        raise BuilderSupervisorRejected("builder systemd-run could not start") from error
    cgroup_fd = -1
    cgroup_info = None
    unit_quiesced = False
    failure = None
    try:
        while process.poll() is None:
            try:
                directory_usage(usage_root, max_entries=MAX_SCRATCH_ENTRIES,
                                max_bytes=MAX_SCRATCH_BYTES)
            except Exception as error:
                failure = BuilderSupervisorRejected("builder scratch exceeded fixed bounds")
                break
            if cgroup_fd < 0:
                try:
                    cgroup_fd, cgroup_info = _open_cgroup(unit, trusted_root=trusted_root)
                except OSError:
                    pass
                else:
                    reported = _systemctl("show", "--property=ControlGroup", "--value", unit)
                    if reported != expected_path:
                        failure = BuilderSupervisorRejected("builder unit cgroup path is unexpected")
                        break
                    _validate_live_unit(unit, reported, uid, gid, source, scratch)
                    main_pid = int(_systemctl("show", "--property=MainPID", "--value", unit))
                    if main_pid <= 0:
                        failure = BuilderSupervisorRejected("builder unit has no live main process")
                        break
                    require_process_member(cgroup_fd, cgroup_info.st_dev, cgroup_info.st_ino,
                                           main_pid)
                    if unit_journal is not None:
                        unit_journal.mark_running(cgroup_info)
            if time.monotonic() >= build_deadline:
                failure = BuilderSupervisorRejected("builder unit exceeded fixed wall-clock limit")
                break
            time.sleep(POLL_SECONDS)
        if cgroup_fd < 0:
            _drain_unpinned_until_proven(unit, process, deadline=cleanup_deadline,
                                         journal=unit_journal, uid=uid,
                                         trusted_root=trusted_root)
            unit_quiesced = True
            if failure is not None:
                raise failure
            exit_code = process.returncode
            if exit_code is not None and exit_code != 0:
                raise BuilderSupervisorRejected(
                    f"builder systemd-run exited before cgroup pin (status {exit_code})"
                )
            raise BuilderSupervisorRejected("builder cgroup was not pinned before completion")
        if failure is not None:
            _drain_until_proven(unit, cgroup_fd, cgroup_info, process,
                                deadline=cleanup_deadline, uid=uid,
                                journal=unit_journal, trusted_root=trusted_root)
            unit_quiesced = True
            raise failure
        try:
            return_code = process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            _drain_until_proven(unit, cgroup_fd, cgroup_info, process,
                                deadline=cleanup_deadline, uid=uid,
                                journal=unit_journal, trusted_root=trusted_root)
            unit_quiesced = True
            raise BuilderSupervisorRejected("builder systemd-run did not reap its unit") from None
        if return_code != 0:
            _drain_until_proven(unit, cgroup_fd, cgroup_info, process,
                                deadline=cleanup_deadline, uid=uid,
                                journal=unit_journal, trusted_root=trusted_root)
            unit_quiesced = True
            raise BuilderSupervisorRejected("builder systemd unit failed")
        _validate_live_unit(unit, expected_path, uid, gid, source, scratch) if _systemctl(
            "show", "--property=LoadState", "--value", unit) == "loaded" else None
        require_empty_cgroup(cgroup_fd, cgroup_info.st_dev, cgroup_info.st_ino)
        if unit_journal is not None:
            unit_journal.mark_drained(cgroup_info)
        unit_quiesced = True
    except BuilderQuiescenceUnproven:
        raise
    except BaseException:
        if not unit_quiesced:
            postspawn_drain(
                unit, process, cgroup_fd, cgroup_info, deadline=cleanup_deadline,
                drain_pinned=lambda u, fd, info, child, **kwargs: _drain_until_proven(
                    u, fd, info, child, uid=uid, trusted_root=trusted_root, **kwargs),
                drain_unpinned=lambda u, child, **kwargs: _drain_unpinned_until_proven(
                    u, child, uid=uid, trusted_root=trusted_root, **kwargs),
                journal=unit_journal, unproven=BuilderQuiescenceUnproven,
            )
        raise
    finally:
        if cgroup_fd >= 0:
            os.close(cgroup_fd)


def fixed_builder_runner(expected_sha: str, uid: int, gid: int, *,
                        fence: dict[str, object], unit_journal,
                        usage_root: Path) -> Callable[[tuple[str, ...], Path, str], None]:
    """Create the exact `runner=` adapter expected by dependency_builder.build."""
    from worker_release_dependency_sandbox import systemd_command
    from worker_release_dependency_builder import BUILD_INPUT_ROOT
    entrypoint = Path(__file__).with_name("worker_release_dependency_builder.py")

    def run(command: tuple[str, ...], scratch: Path, unit: str, *,
            input_root: Path | None = None, result_dir: Path | None = None) -> None:
        if len(command) < 6 or command[-5] != str(entrypoint) or command[-4] != "--sandbox-worker":
            raise BuilderSupervisorRejected("dependency builder command entrypoint is unexpected")
        source = Path(command[-3])
        source_parent = source.parent
        scratch_info = scratch.lstat()
        source_info = source.lstat()
        if (source.name != "source" or source_parent.parent != BUILD_INPUT_ROOT
                or not source_parent.name.startswith(f"{expected_sha}.input.")
                or scratch.parent != BUILD_INPUT_ROOT
                or not scratch.name.startswith(f"{expected_sha}.")
                or not stat.S_ISDIR(scratch_info.st_mode) or scratch_info.st_uid != uid
                or scratch_info.st_gid != gid
                or stat.S_IMODE(scratch_info.st_mode) != 0o700
                or not stat.S_ISDIR(source_info.st_mode) or source_info.st_uid != 0
                or source_info.st_mode & 0o022):
            raise BuilderSupervisorRejected("dependency builder private paths are unsafe")
        expected = systemd_command(source, scratch, expected_sha, uid, gid, unit)
        if tuple(command) != expected:
            raise BuilderSupervisorRejected("dependency builder supplied a noncanonical systemd command")
        unit_journal.begin(fence, unit, source, scratch, uid, gid,
                           input_root=input_root, result_dir=result_dir)
        supervise_builder_unit(source, scratch, expected_sha, uid, gid, unit,
                               usage_root=usage_root, unit_journal=unit_journal)

    run.accepts_build_resources = True
    return run


__all__ = ["BuilderQuiescenceUnproven", "BuilderSupervisorRejected",
           "fixed_builder_runner", "preflight_cgroup_root", "supervise_builder_unit"]
