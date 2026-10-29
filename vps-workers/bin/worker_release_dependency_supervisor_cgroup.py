"""Pinned cgroup v2 lifecycle helpers for the dependency builder supervisor."""
from __future__ import annotations

import os
import subprocess
import time
from pathlib import Path

from worker_release_descriptor_cgroup import (
    CgroupProofRejected, _require_cgroup2_fd, require_empty_cgroup,
)

POLL_SECONDS = 0.1
MAX_CLEANUP_SECONDS = 30


class UnitCgroupAbsent(FileNotFoundError):
    """The systemd slice exists but the exact transient unit has no cgroup."""


def preflight_cgroup_root(root: Path) -> None:
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
        finally:
            os.close(child)
    finally:
        os.close(fd)


def open_unit_cgroup(root: Path, unit: str) -> tuple[int, os.stat_result]:
    root_fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    current = root_fd
    try:
        root_info = os.fstat(root_fd)
        _require_cgroup2_fd(root_fd, root_info.st_dev, root_info.st_ino)
        child = os.open("system.slice", os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                        dir_fd=current)
        current = child
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


def stop_unit(systemctl: str, unit: str) -> None:
    for command in (("kill", "--kill-whom=all", "--signal=KILL", unit), ("stop", unit)):
        try:
            subprocess.run((systemctl, *command), stdin=subprocess.DEVNULL,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                           timeout=1, env={"PATH": "/usr/bin:/bin"})
        except (OSError, subprocess.SubprocessError):
            pass


def kill_cgroup(fd: int) -> None:
    control = os.open("cgroup.kill", os.O_WRONLY | os.O_NOFOLLOW, dir_fd=fd)
    try:
        if os.write(control, b"1") != 1:
            raise RuntimeError("builder cgroup kill request was incomplete")
    finally:
        os.close(control)


def prove_stopped(unit: str, fd: int, identity: os.stat_result,
                  process: subprocess.Popen | None, *, deadline: float, query, rejected) -> None:
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
                return
            except CgroupProofRejected:
                pass
        time.sleep(POLL_SECONDS)
    raise RuntimeError("builder cgroup did not drain before deadline")


def drain_until_proven(unit: str, fd: int, info: os.stat_result,
                       process: subprocess.Popen | None, *, systemctl: str,
                       query, rejected, deadline: float, unproven, journal=None) -> None:
    # Issue bounded stop/kill requests once. Repeating 10-second systemctl
    # operations inside the poll loop could exceed the caller's lease deadline.
    stop_unit(systemctl, unit)
    try:
        kill_cgroup(fd)
    except (OSError, RuntimeError):
        pass
    try:
        prove_stopped(unit, fd, info, process, deadline=deadline,
                      query=query, rejected=rejected)
    except (RuntimeError, CgroupProofRejected):
        raise unproven(unit, "timed out before systemd/cgroup emptiness was proven") from None
    if journal is not None:
        journal.mark_drained(info)


def drain_unpinned_until_proven(unit: str, process: subprocess.Popen, *, root: Path,
                                systemctl: str, query, rejected, deadline: float,
                                unproven, journal=None) -> None:
    stop_requested = False
    while time.monotonic() < deadline:
        try:
            fd, info = open_unit_cgroup(root, unit)
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


__all__ = ["UnitCgroupAbsent", "drain_unpinned_until_proven", "drain_until_proven",
           "kill_cgroup", "open_unit_cgroup", "preflight_cgroup_root",
           "prove_stopped", "stop_unit"]
