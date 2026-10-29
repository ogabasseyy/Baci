"""Pinned cgroup v2 lifecycle helpers for the dependency builder supervisor."""
from __future__ import annotations

import os
import subprocess
import time
from pathlib import Path

from worker_release_descriptor_cgroup import (
    CgroupProofRejected, _require_cgroup2_fd, require_empty_cgroup,
)
from worker_release_descriptor_process import assert_no_uid_processes

POLL_SECONDS = 0.1
MAX_CLEANUP_SECONDS = 30


class UnitCgroupAbsent(FileNotFoundError):
    """The systemd slice exists but the exact transient unit has no cgroup."""


def preflight_cgroup_root(root: Path) -> tuple[int, int, int, int]:
    """Refuse launch unless the host exposes the required cgroup v2 boundary."""
    fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        info = os.fstat(fd)
        _require_cgroup2_fd(fd, info.st_dev, info.st_ino)
        child = os.open("system.slice", os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                        dir_fd=fd)
        try:
            slice_info = os.fstat(child)
            _require_cgroup2_fd(child, slice_info.st_dev, slice_info.st_ino)
            return (info.st_dev, info.st_ino, slice_info.st_dev, slice_info.st_ino)
        finally:
            os.close(child)
    finally:
        os.close(fd)


def _verify_trusted_root(root_info: os.stat_result, slice_info: os.stat_result,
                         trusted_root: tuple[int, int, int, int] | None) -> None:
    if trusted_root is not None and trusted_root != (
            root_info.st_dev, root_info.st_ino, slice_info.st_dev, slice_info.st_ino):
        raise CgroupProofRejected("trusted cgroup root or system.slice identity changed")


def open_unit_cgroup(root: Path, unit: str, *,
                     trusted_root: tuple[int, int, int, int] | None = None
                     ) -> tuple[int, os.stat_result]:
    root_fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    current = root_fd
    try:
        root_info = os.fstat(root_fd)
        _require_cgroup2_fd(root_fd, root_info.st_dev, root_info.st_ino)
        child = os.open("system.slice", os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                        dir_fd=current)
        current = child
        slice_info = os.fstat(child)
        _require_cgroup2_fd(child, slice_info.st_dev, slice_info.st_ino)
        _verify_trusted_root(root_info, slice_info, trusted_root)
        try:
            child = os.open(unit, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                            dir_fd=current)
        except FileNotFoundError as error:
            raise UnitCgroupAbsent("transient unit cgroup is absent") from error
        os.close(current)
        info = os.fstat(child)
        _require_cgroup2_fd(child, info.st_dev, info.st_ino)
        current = root_fd
        return child, info
    finally:
        if current != root_fd:
            os.close(current)
        os.close(root_fd)


def require_exact_unit_cgroup_absent(root: Path, unit: str, *,
                                     trusted_root: tuple[int, int, int, int] | None = None) -> None:
    """Prove only the exact system.slice child is gone under a pinned cgroup2 root."""
    if "/" in unit or unit in ("", ".", ".."):
        raise CgroupProofRejected("invalid transient unit cgroup name")
    root_fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        root_info = os.fstat(root_fd)
        _require_cgroup2_fd(root_fd, root_info.st_dev, root_info.st_ino)
        slice_fd = os.open("system.slice", os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                           dir_fd=root_fd)
        try:
            slice_info = os.fstat(slice_fd)
            _require_cgroup2_fd(slice_fd, slice_info.st_dev, slice_info.st_ino)
            _verify_trusted_root(root_info, slice_info, trusted_root)
            try:
                os.stat(unit, dir_fd=slice_fd, follow_symlinks=False)
            except FileNotFoundError:
                return
            raise CgroupProofRejected("transient unit cgroup still exists")
        finally:
            os.close(slice_fd)
    finally:
        os.close(root_fd)


def prove_collected_unit(unit: str, process: subprocess.Popen | None, *, root: Path,
                         uid: int, deadline: float, query,
                         trusted_root: tuple[int, int, int, int] | None = None,
                         no_uid_processes=None,
                         absent_check=None) -> None:
    """Accept cgroup.events ENOENT only after systemd and process-table rechecks."""
    no_uid_processes = no_uid_processes or assert_no_uid_processes
    if absent_check is None:
        absent_check = lambda path, name: require_exact_unit_cgroup_absent(
            path, name, trusted_root=trusted_root)
    if process is not None:
        try:
            process.wait(timeout=max(0.0, min(1.0, deadline - time.monotonic())))
        except subprocess.TimeoutExpired as error:
            raise CgroupProofRejected("systemd-run client has not been reaped") from error
        if process.poll() is None:
            raise CgroupProofRejected("systemd-run client is still live")
    for _ in range(2):
        if time.monotonic() >= deadline:
            raise CgroupProofRejected("collected-unit proof exceeded deadline")
        absent_check(root, unit)
        no_uid_processes(uid)
        state = query("show", "--property=ActiveState", "--value", unit)
        load = query("show", "--property=LoadState", "--value", unit)
        substate = query("show", "--property=SubState", "--value", unit)
        main_pid = query("show", "--property=MainPID", "--value", unit)
        control_group = query("show", "--property=ControlGroup", "--value", unit)
        if (load != "not-found" or state != "inactive" or substate != "dead"
                or main_pid != "0" or control_group != ""):
            raise CgroupProofRejected("systemd still reports a live or bound transient unit")
        no_uid_processes(uid)
        absent_check(root, unit)


def stop_unit(systemctl: str, unit: str) -> None:
    for command in (("kill", "--kill-whom=all", "--signal=KILL", unit), ("stop", unit)):
        try:
            subprocess.run((systemctl, *command), stdin=subprocess.DEVNULL,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                           timeout=1, env={"PATH": "/usr/bin:/bin"})
        except (OSError, subprocess.SubprocessError):
            pass


def bounded_systemctl_query(systemctl, deadline: float, rejected, *args: str) -> str:
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise rejected("builder teardown deadline expired")
    return systemctl(*args, timeout=min(1, remaining))


def postspawn_drain(unit: str, process: subprocess.Popen, cgroup_fd: int,
                    cgroup_info: os.stat_result | None, *, deadline: float,
                    drain_pinned, drain_unpinned, journal, unproven) -> None:
    try:
        if cgroup_fd >= 0 and cgroup_info is not None:
            drain_pinned(unit, cgroup_fd, cgroup_info, process, deadline=deadline)
        else:
            drain_unpinned(unit, process, deadline=deadline, journal=journal)
    except unproven:
        raise
    except BaseException as error:
        raise unproven(unit, "post-launch teardown proof failed") from error


def kill_cgroup(fd: int) -> None:
    control = os.open("cgroup.kill", os.O_WRONLY | os.O_NOFOLLOW, dir_fd=fd)
    try:
        if os.write(control, b"1") != 1:
            raise RuntimeError("builder cgroup kill request was incomplete")
    finally:
        os.close(control)


def prove_stopped(unit: str, fd: int, identity: os.stat_result,
                  process: subprocess.Popen | None, *, deadline: float, query, rejected,
                  root: Path | None = None, uid: int | None = None,
                  trusted_root: tuple[int, int, int, int] | None = None,
                  no_uid_processes=None, absent_check=None) -> bool:
    while time.monotonic() < deadline:
        if process is not None and process.poll() is None:
            try:
                process.wait(timeout=POLL_SECONDS)
            except subprocess.TimeoutExpired:
                pass
        try:
            state = query("show", "--property=ActiveState", "--value", unit)
            load = query("show", "--property=LoadState", "--value", unit)
        except rejected:
            state, load = "unknown", "unknown"
        if state == "inactive" or load == "not-found":
            try:
                require_empty_cgroup(fd, identity.st_dev, identity.st_ino)
                return False
            except FileNotFoundError:
                if root is None or uid is None:
                    raise
                try:
                    prove_collected_unit(unit, process, root=root, uid=uid, deadline=deadline,
                                         query=query, trusted_root=trusted_root,
                                         no_uid_processes=no_uid_processes,
                                         absent_check=absent_check)
                    return True
                except (CgroupProofRejected, OSError, RuntimeError):
                    pass
            except CgroupProofRejected:
                pass
        time.sleep(POLL_SECONDS)
    raise RuntimeError("builder cgroup did not drain before deadline")


def drain_until_proven(unit: str, fd: int, info: os.stat_result,
                       process: subprocess.Popen | None, *, systemctl: str,
                       query, rejected, deadline: float, unproven, journal=None,
                       root: Path | None = None, uid: int | None = None,
                       trusted_root: tuple[int, int, int, int] | None = None,
                       no_uid_processes=None, absent_check=None) -> None:
    # Issue bounded stop/kill requests once. Repeating 10-second systemctl
    # operations inside the poll loop could exceed the caller's lease deadline.
    stop_unit(systemctl, unit)
    try:
        kill_cgroup(fd)
    except (OSError, RuntimeError):
        pass
    try:
        collected = prove_stopped(unit, fd, info, process, deadline=deadline,
                                  query=query, rejected=rejected, root=root, uid=uid,
                                  trusted_root=trusted_root,
                                  no_uid_processes=no_uid_processes,
                                  absent_check=absent_check)
    except (RuntimeError, CgroupProofRejected):
        raise unproven(unit, "timed out before systemd/cgroup emptiness was proven") from None
    if journal is not None:
        journal.mark_drained(None if collected else info)


def drain_unpinned_until_proven(unit: str, process: subprocess.Popen, *, root: Path,
                                systemctl: str, query, rejected, deadline: float,
                                unproven, journal=None, uid: int | None = None,
                                trusted_root: tuple[int, int, int, int] | None = None) -> None:
    stop_requested = False
    while time.monotonic() < deadline:
        try:
            fd, info = open_unit_cgroup(root, unit, trusted_root=trusted_root)
        except UnitCgroupAbsent:
            try:
                load = query("show", "--property=LoadState", "--value", unit)
            except rejected:
                load = "unknown"
            if load == "not-found":
                try:
                    process.wait(timeout=max(0.0, deadline - time.monotonic()))
                except subprocess.TimeoutExpired:
                    raise unproven(unit, "systemd-run client did not exit") from None
                if uid is None:
                    raise unproven(unit, "builder UID was not supplied for collected-unit proof")
                try:
                    prove_collected_unit(unit, process, root=root, uid=uid, deadline=deadline,
                                         trusted_root=trusted_root,
                                         query=query)
                except (OSError, RuntimeError, CgroupProofRejected, rejected) as error:
                    raise unproven(unit, "collected-unit proof failed") from error
                if journal is not None:
                    journal.mark_drained(None)
                return
            if not stop_requested:
                stop_unit(systemctl, unit)
                stop_requested = True
        except OSError:
            time.sleep(POLL_SECONDS)
            continue
        else:
            try:
                drain_until_proven(unit, fd, info, process, systemctl=systemctl,
                                   query=query, rejected=rejected, deadline=deadline,
                                   unproven=unproven, journal=journal)
                return
            finally:
                os.close(fd)
        try:
            process.wait(timeout=min(POLL_SECONDS, max(0.0, deadline - time.monotonic())))
        except subprocess.TimeoutExpired:
            pass
    raise unproven(unit, "timed out before absent unit/cgroup was proven")


__all__ = ["UnitCgroupAbsent", "bounded_systemctl_query", "drain_unpinned_until_proven", "drain_until_proven",
           "kill_cgroup", "open_unit_cgroup", "preflight_cgroup_root",
           "prove_collected_unit", "require_exact_unit_cgroup_absent",
           "postspawn_drain", "prove_stopped", "stop_unit"]
