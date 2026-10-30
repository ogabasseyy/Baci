"""Fixed systemd lifecycle and digest health probes for broker upgrades."""
from __future__ import annotations

import os
import subprocess
import time
from pathlib import Path
from typing import Protocol

from worker_release_broker_upgrade_errors import BrokerUpgradeRejected
from worker_release_broker_status_client import read_broker_generation_status
from worker_release_dependency_supervisor_cgroup import (
    UnitCgroupAbsent, open_unit_cgroup, preflight_cgroup_root,
    require_exact_unit_cgroup_absent,
)
from worker_release_descriptor_cgroup import require_empty_cgroup

BROKER_UNIT = "baci-worker-release-broker.service"
BROKER_SOCKET = Path("/run/baci-worker-release/broker.sock")
CGROUP_ROOT = Path("/sys/fs/cgroup")
STOP_TIMEOUT_SECONDS = 1200
READY_TIMEOUT_SECONDS = 60


class BrokerControl(Protocol):
    def stop_and_prove(self) -> None: ...
    def prove_stopped(self) -> None: ...
    def prove_prestart_safe(self) -> None: ...
    def start(self) -> None: ...
    def wait_ready(self, expected_digest: str, deadline: float) -> None: ...


def _valid_digest(value: object) -> bool:
    return (isinstance(value, str) and len(value) == 64
            and all(char in "0123456789abcdef" for char in value))


def _require_only_pid(cgroup_fd: int, expected_pid: int) -> None:
    try:
        fd = os.open("cgroup.procs", os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0),
                     dir_fd=cgroup_fd)
        try:
            raw = os.read(fd, 4097)
            if len(raw) > 4096:
                raise BrokerUpgradeRejected("broker cgroup membership exceeds fixed bound")
        finally:
            os.close(fd)
    except OSError as error:
        raise BrokerUpgradeRejected("broker launcher membership cannot be proven") from error
    try:
        pids = [int(value) for value in raw.split()]
    except ValueError:
        raise BrokerUpgradeRejected("broker cgroup membership is malformed") from None
    if pids != [expected_pid]:
        raise BrokerUpgradeRejected("broker cgroup contains an unexpected process")


class SystemdBrokerControl:
    """Exact systemd lifecycle and root-only status checks for one unit."""

    def __init__(self, *, systemctl: str = "/usr/bin/systemctl",
                 cgroup_root: Path = CGROUP_ROOT, status_socket: Path = BROKER_SOCKET,
                 run=subprocess.run, status_reader=None):
        if systemctl != "/usr/bin/systemctl" or status_socket != BROKER_SOCKET:
            raise BrokerUpgradeRejected("broker control paths are outside fixed policy")
        self.systemctl, self.cgroup_root = systemctl, cgroup_root
        self.status_socket, self.run = status_socket, run
        self.status_reader = status_reader or read_broker_generation_status
        self.trusted_cgroup_root = preflight_cgroup_root(cgroup_root)

    def _command(self, *args: str, timeout: int) -> str:
        if os.geteuid() != 0 or not 1 <= timeout <= STOP_TIMEOUT_SECONDS:
            raise BrokerUpgradeRejected("systemd broker control requires root and bounded timeout")
        try:
            result = self.run((self.systemctl, "--system", *args), stdin=subprocess.DEVNULL,
                              stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True,
                              timeout=timeout, env={"PATH": "/usr/bin:/bin", "LC_ALL": "C"},
                              check=False)
        except (OSError, subprocess.SubprocessError) as error:
            raise BrokerUpgradeRejected("systemd broker control command failed") from error
        if result.returncode != 0:
            raise BrokerUpgradeRejected("systemd broker control command was rejected")
        return result.stdout

    def _properties(self) -> dict[str, str]:
        keys = ("LoadState", "ActiveState", "SubState", "MainPID", "ControlGroup")
        output = self._command("show", *(f"--property={key}" for key in keys),
                               BROKER_UNIT, timeout=5)
        values = {}
        for line in output.splitlines():
            key, separator, value = line.partition("=")
            if separator and key in keys and key not in values:
                values[key] = value
        if set(values) != set(keys):
            raise BrokerUpgradeRejected("systemd broker unit state is incomplete")
        return values

    def _prove_empty_cgroup(self) -> None:
        try:
            fd, info = open_unit_cgroup(self.cgroup_root, BROKER_UNIT,
                                        trusted_root=self.trusted_cgroup_root)
        except UnitCgroupAbsent:
            require_exact_unit_cgroup_absent(self.cgroup_root, BROKER_UNIT,
                                             trusted_root=self.trusted_cgroup_root)
            return
        try:
            require_empty_cgroup(fd, info.st_dev, info.st_ino)
        finally:
            os.close(fd)

    def _prove_state(self, active: set[str], substates: set[str], message: str) -> None:
        first = self._properties()
        if (first["LoadState"] != "loaded" or first["ActiveState"] not in active
                or first["SubState"] not in substates or first["MainPID"] != "0"
                or first["ControlGroup"] != f"/system.slice/{BROKER_UNIT}"):
            raise BrokerUpgradeRejected(message)
        self._prove_empty_cgroup()
        if self._properties() != first:
            raise BrokerUpgradeRejected("broker unit state changed during stop proof")
        self._prove_empty_cgroup()

    def prove_stopped(self) -> None:
        self._prove_state({"inactive", "failed"}, {"dead", "failed"},
                          "broker unit is not proven stopped")

    def prove_installation_safe(self, *, current_digest: str | None,
                                stable_files_complete: bool) -> bool:
        """Reject active flat/unknown services before installer writes stable files."""
        state = self._properties()
        if state["LoadState"] == "not-found":
            if state["MainPID"] != "0" or state["ActiveState"] != "inactive":
                raise BrokerUpgradeRejected("unloaded broker unit has unexpected runtime state")
            return False
        if state["LoadState"] != "loaded":
            raise BrokerUpgradeRejected("broker unit load state is not recognized")
        if state["ActiveState"] == "active" and state["SubState"] == "running":
            if (not _valid_digest(current_digest) or not stable_files_complete
                    or state["ControlGroup"] != f"/system.slice/{BROKER_UNIT}"
                    or not state["MainPID"].isdigit() or int(state["MainPID"]) <= 1):
                raise BrokerUpgradeRejected(
                    "active broker is not a complete recognized generation; refusing stable-file writes"
                )
            self.wait_ready(current_digest, time.monotonic() + READY_TIMEOUT_SECONDS)
            return True
        if state["ActiveState"] in {"inactive", "failed"}:
            self.prove_stopped()
            return False
        raise BrokerUpgradeRejected("broker unit state is not safe for stable-file installation")

    def prove_prestart_safe(self) -> None:
        """Permit only this ExecStart launcher in the fixed broker cgroup."""
        pid = os.getpid()
        first = self._properties()
        if (first["LoadState"] != "loaded" or first["ActiveState"] != "activating"
                or first["SubState"] != "start" or first["MainPID"] != str(pid)
                or first["ControlGroup"] != f"/system.slice/{BROKER_UNIT}"):
            raise BrokerUpgradeRejected("broker is not in a safe launcher phase")
        fd, info = self._open_prestart_cgroup()
        try:
            _require_only_pid(fd, pid)
            second = self._properties()
            _require_only_pid(fd, pid)
            fd2, after = self._open_prestart_cgroup()
            try:
                if (info.st_dev, info.st_ino) != (after.st_dev, after.st_ino):
                    raise BrokerUpgradeRejected("broker cgroup changed during startup recovery")
                _require_only_pid(fd2, pid)
            finally:
                os.close(fd2)
            if second != first:
                raise BrokerUpgradeRejected("broker launcher state changed during recovery")
        finally:
            os.close(fd)

    def _open_prestart_cgroup(self):
        try:
            return open_unit_cgroup(self.cgroup_root, BROKER_UNIT,
                                    trusted_root=self.trusted_cgroup_root)
        except UnitCgroupAbsent as error:
            raise BrokerUpgradeRejected("broker launcher cgroup is absent") from error

    def stop_and_prove(self) -> None:
        self._command("stop", BROKER_UNIT, timeout=STOP_TIMEOUT_SECONDS)
        self.prove_stopped()

    def start(self) -> None:
        self._command("start", BROKER_UNIT, timeout=60)

    def wait_ready(self, expected_digest: str, deadline: float) -> None:
        if not _valid_digest(expected_digest):
            raise BrokerUpgradeRejected("expected broker generation digest is invalid")
        previous_pid, samples = None, 0
        while time.monotonic() < deadline:
            try:
                state = self._properties()
                running = (state["LoadState"] == "loaded" and state["ActiveState"] == "active"
                           and state["SubState"] == "running" and state["MainPID"].isdigit()
                           and int(state["MainPID"]) > 1
                           and state["ControlGroup"] == f"/system.slice/{BROKER_UNIT}")
                if running:
                    pid = state["MainPID"]
                    digest = self.status_reader(self.status_socket, timeout=2)
                    if digest == expected_digest and pid == previous_pid:
                        samples += 1
                        if samples >= 2:
                            return
                    else:
                        previous_pid = pid if digest == expected_digest else None
                        samples = 0
                else:
                    previous_pid, samples = None, 0
            except BrokerUpgradeRejected:
                previous_pid, samples = None, 0
            time.sleep(0.25)
        raise BrokerUpgradeRejected("broker did not report the exact running generation")


__all__ = ["BROKER_SOCKET", "BROKER_UNIT", "BrokerControl", "CGROUP_ROOT",
           "READY_TIMEOUT_SECONDS", "STOP_TIMEOUT_SECONDS", "SystemdBrokerControl",
           "read_broker_generation_status"]
