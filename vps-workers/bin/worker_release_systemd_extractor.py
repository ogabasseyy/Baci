"""Disconnected root supervisor for the fixed cgroup-confined archive unit."""
from __future__ import annotations

import hashlib
import json
import os
import pwd
import grp
import re
import socket
import stat
import subprocess
import time
from pathlib import Path
from worker_release_descriptor_cgroup import require_empty_cgroup, require_process_member
from worker_release_descriptor_freeze import (
    FreezeRejected, _freeze_directory, _identity, _inventory_tree, _verify_frozen_tree,
)
from worker_release_descriptor_process import ProcessIdentityRejected, assert_no_uid_processes
from worker_release_source_snapshot import pin_source_snapshot
from worker_release_systemd_contract import UnitContractRejected, validate_unit_contract
from worker_release_broker_common import MAX_ARCHIVE_COMPRESSED_BYTES

EXTRACTOR = "baci-release-extractor"
UNIT_PREFIX = "baci-worker-source-extract@"
UNIT_FILE = Path("/etc/systemd/system/baci-worker-source-extract@.service")
RUNTIME_ROOT = Path("/run/baci-worker-release-extract")
RESOURCE_ROOT = RUNTIME_ROOT / "resources"
CONTROL_ROOT = RUNTIME_ROOT / "control"
CGROUP_ROOT = Path("/sys/fs/cgroup")
MAX_WAIT_SECONDS = 210


class ExtractorRejected(RuntimeError):
    """The fixed extractor service could not prove its launch or output contract."""


def _run(*args: str, timeout: float = 10) -> str:
    try:
        result = subprocess.run(args, check=True, stdin=subprocess.DEVNULL,
                                stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                timeout=timeout, text=True)
    except (OSError, subprocess.SubprocessError) as error:
        raise ExtractorRejected("fixed extractor systemd operation failed") from error
    return result.stdout.strip()


def _credential_mismatch(status: str, uid: int, gid: int) -> str | None:
    found = {}
    try:
        for line in status.splitlines():
            if line.startswith(("Uid:", "Gid:", "Groups:")):
                key, value = line.split(":", 1)
                found[key] = tuple(int(item) for item in value.split())
    except (ValueError, TypeError):
        return "status-shape"
    if found.get("Uid") != (uid, uid, uid, uid):
        return "uid"
    if found.get("Gid") != (gid, gid, gid, gid):
        return "gid"
    # systemd initializes supplementary memberships from the account database;
    # SupplementaryGroups= only configures unit assignments, it does not replace
    # those defaults. _identity() has already pinned that database list to [gid].
    # Permit only that primary-group membership; any additional group fails closed.
    if found.get("Groups") not in ((), (gid,)):
        return "supplementary-groups"
    return None


def _pid_identity(pid: int, uid: int, gid: int) -> None:
    try:
        status = Path(f"/proc/{pid}/status").read_text(encoding="ascii")
    except OSError as error:
        raise ExtractorRejected("extractor process identity is unavailable") from error
    mismatch = _credential_mismatch(status, uid, gid)
    if mismatch is not None:
        raise ExtractorRejected(f"extractor process identity mismatch ({mismatch})")


def _open_cgroup(control_group: str, transaction_id: str) -> tuple[int, os.stat_result]:
    expected = f"/system.slice/{UNIT_PREFIX}{transaction_id}.service"
    if control_group != expected:
        raise ExtractorRejected("extractor systemd cgroup path is not the fixed instance")
    root = os.open(CGROUP_ROOT, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    current = root
    try:
        for part in control_group.split("/")[1:]:
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=current)
            if current != root:
                os.close(current)
            current = child
        info = os.fstat(current)
        return current, info
    except OSError as error:
        raise ExtractorRejected("extractor cgroup cannot be pinned") from error
    finally:
        os.close(root)


def _unit_contract(unit: str, txid: str, extractor_uid: int, extractor_gid: int) -> tuple[int, str]:
    try:
        return validate_unit_contract(
            unit=unit, transaction_id=txid, extractor_uid=extractor_uid,
            extractor_gid=extractor_gid, unit_file=UNIT_FILE, extractor=EXTRACTOR,
            unit_prefix=UNIT_PREFIX, resource_root=RESOURCE_ROOT, control_root=CONTROL_ROOT,
            run=_run, pid_identity=_pid_identity,
        )
    except UnitContractRejected as error:
        raise ExtractorRejected(str(error)) from error


def _read_line(connection: socket.socket, limit: int = 64) -> bytes:
    output = bytearray()
    while len(output) < limit:
        byte = connection.recv(1)
        if not byte:
            break
        output.extend(byte)
        if byte == b"\n":
            return bytes(output)
    raise ExtractorRejected("extractor control response is malformed")


def _wait_stopped(unit: str, timeout: float = MAX_WAIT_SECONDS) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        active = _run("systemctl", "show", "-p", "ActiveState", "--value", unit)
        if active == "inactive":
            result = _run("systemctl", "show", "-p", "Result", "--value", unit)
            code = _run("systemctl", "show", "-p", "ExecMainStatus", "--value", unit)
            if result != "success" or code != "0":
                raise ExtractorRejected("extractor unit did not exit successfully")
            return
        if active not in ("active", "activating", "deactivating"):
            raise ExtractorRejected("extractor unit entered an unexpected state")
        time.sleep(0.1)
    _run("systemctl", "kill", "--kill-whom=all", "--signal=KILL", unit)
    _run("systemctl", "stop", unit)
    raise ExtractorRejected("extractor unit exceeded its fixed runtime")


def _freeze_stopped_source(journal, path: Path, extractor_uid: int, extractor_gid: int) -> dict[str, int]:
    value = journal._require_journal()
    name, dev, ino, state = journal.resources._fields(value, "source")
    if path != RESOURCE_ROOT / name or state != "created" or dev is None or ino is None:
        raise ExtractorRejected("journal source resource identity is not the fixed output")
    root_fd = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                      dir_fd=journal.resources.fd)
    try:
        info = os.fstat(root_fd)
        if ((info.st_dev, info.st_ino) != (dev, ino) or info.st_uid != extractor_uid
                or info.st_gid != extractor_gid or stat.S_IMODE(info.st_mode) != 0o700):
            raise ExtractorRejected("extractor output root changed before freeze")
        marker_fd = os.open(".baci-source-sha", os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                            0o440, dir_fd=root_fd)
        try:
            data = (value["fence"]["sha"] + "\n").encode("ascii")
            if os.write(marker_fd, data) != len(data):
                raise ExtractorRejected("source SHA marker write was incomplete")
            os.fchown(marker_fd, extractor_uid, extractor_gid)
            os.fchmod(marker_fd, 0o440)
            os.fsync(marker_fd)
        finally:
            os.close(marker_fd)
        os.fsync(root_fd)
        inventory = _inventory_tree(root_fd, info.st_dev, extractor_uid, extractor_gid)
        journal.begin_source_transfer()
        counters = {"entries": 0, "bytes": 0}
        _freeze_directory(root_fd, "", info.st_dev, extractor_uid, extractor_gid,
                          journal.stage_gid, extractor_uid, counters, inventory)
        if counters["entries"] != len(inventory) - 1:
            raise FreezeRejected("extractor output membership changed during freeze")
        _verify_frozen_tree(root_fd, inventory, info.st_dev, extractor_uid, journal.stage_gid)
        journal.mark_source_frozen()
        with pin_source_snapshot(path, trusted_root=RESOURCE_ROOT, owner_uid=extractor_uid):
            pass
        return counters
    finally:
        os.close(root_fd)


def extract_frozen_source(journal, archive: bytes, expected_archive_sha256: str) -> dict[str, object]:
    """Run the fixed unit, prove its cgroup drained, then freeze journal-owned output."""
    if os.geteuid() != 0:
        raise ExtractorRejected("extractor supervisor must run as root")
    value = journal._require_journal()
    sha, txid = value["fence"]["sha"], value["transaction_id"]
    if (journal.resources.root != RESOURCE_ROOT or not re.fullmatch(r"[0-9a-f]{32}", txid)
            or not isinstance(archive, bytes) or not 0 < len(archive) <= MAX_ARCHIVE_COMPRESSED_BYTES
            or not re.fullmatch(r"[0-9a-f]{64}", expected_archive_sha256)
            or hashlib.sha256(archive).hexdigest() != expected_archive_sha256):
        raise ExtractorRejected("extractor input or journal binding is invalid")
    try:
        extractor = pwd.getpwnam(EXTRACTOR)
        extractor_gid = grp.getgrnam(EXTRACTOR).gr_gid
        runtime_info = RUNTIME_ROOT.lstat()
        control_info = CONTROL_ROOT.lstat()
        resource_info = RESOURCE_ROOT.lstat()
        if ((runtime_info.st_uid, runtime_info.st_gid, stat.S_IMODE(runtime_info.st_mode)) != (0, 0, 0o711)
                or (control_info.st_uid, control_info.st_gid, stat.S_IMODE(control_info.st_mode))
                != (0, extractor_gid, 0o710)
                or (resource_info.st_uid, resource_info.st_gid, stat.S_IMODE(resource_info.st_mode))
                != (extractor.pw_uid, extractor_gid, 0o700)):
            raise ExtractorRejected("extractor runtime paths do not match the fixed ownership contract")
    except KeyError as error:
        raise ExtractorRejected("dedicated extractor identity is unavailable") from error
    if (journal.resource_uid != extractor.pw_uid or journal.stage_uid != extractor.pw_uid
            or extractor.pw_gid != extractor_gid):
        raise ExtractorRejected("stage journal is not bound to the dedicated extractor identity")
    unit = f"{UNIT_PREFIX}{txid}.service"
    prior_state = _run("systemctl", "show", "-p", "ActiveState", "--value", unit)
    if prior_state not in ("", "inactive"):
        raise ExtractorRejected("extractor unit has unresolved prior state")
    source = journal.create_source_snapshot()
    if set(os.listdir(journal.resources.fd)) != {source.name}:
        raise ExtractorRejected("extractor resource root has unexpected entries")
    control_path = CONTROL_ROOT / f"{txid}.sock"
    listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    listener.settimeout(20)
    listener.bind(str(control_path))
    os.chown(control_path, 0, extractor_gid)
    os.chmod(control_path, 0o660)
    socket_info = control_path.lstat()
    listener.listen(1)
    cgroup_fd = -1
    try:
        _run("systemctl", "start", unit, timeout=25)
        connection, _ = listener.accept()
        with connection:
            connection.settimeout(30)
            ready = _read_line(connection)
            if ready != f"READY {txid}\n".encode("ascii"):
                raise ExtractorRejected("extractor readiness handshake is invalid")
            peer = connection.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12)
            pid, uid, gid = __import__("struct").unpack("3i", peer)
            if uid != extractor.pw_uid or gid != extractor_gid:
                raise ExtractorRejected("extractor control peer identity is invalid")
            main_pid, control_group = _unit_contract(unit, txid, extractor.pw_uid, extractor_gid)
            if pid != main_pid:
                raise ExtractorRejected("extractor control peer is not the systemd main process")
            cgroup_fd, cgroup_info = _open_cgroup(control_group, txid)
            require_process_member(cgroup_fd, cgroup_info.st_dev, cgroup_info.st_ino, main_pid)
            header = json.dumps({"sha": sha, "archive_sha256": expected_archive_sha256,
                                 "archive_bytes": len(archive), "destination": source.name},
                                separators=(",", ":")).encode("ascii") + b"\n"
            connection.sendall(header)
            connection.settimeout(190)
            connection.sendall(archive)
            result = _read_line(connection)
            if not re.fullmatch(rb"DONE [1-9][0-9]{0,8}\n", result):
                raise ExtractorRejected("extractor rejected the fixed archive input")
            entries = int(result.split()[1])
        _wait_stopped(unit)
        require_empty_cgroup(cgroup_fd, cgroup_info.st_dev, cgroup_info.st_ino)
        assert_no_uid_processes(extractor.pw_uid)
        if set(os.listdir(journal.resources.fd)) != {source.name}:
            raise ExtractorRejected("extractor created an unjournaled resource")
        tree = _freeze_stopped_source(journal, source, extractor.pw_uid, extractor_gid)
        if set(os.listdir(journal.resources.fd)) != {source.name}:
            raise ExtractorRejected("extractor resource root changed during freeze")
        return {"source_sha": sha, "archive_sha256": expected_archive_sha256,
                "archive_entries": entries, "frozen_entries": tree["entries"],
                "frozen_bytes": tree["bytes"], "snapshot": source}
    except BaseException:
        cgroup_error = None
        if cgroup_fd < 0:
            try:
                control_group = _run("systemctl", "show", "-p", "ControlGroup", "--value", unit)
                cgroup_fd, cgroup_info = _open_cgroup(control_group, txid)
            except Exception as error:
                cgroup_error = error
        try:
            _run("systemctl", "stop", unit)
        except ExtractorRejected:
            pass
        if cgroup_error is not None:
            raise ExtractorRejected("extractor cgroup could not be pinned before cleanup") from cgroup_error
        if cgroup_fd >= 0:
            try:
                require_empty_cgroup(cgroup_fd, cgroup_info.st_dev, cgroup_info.st_ino)
            except Exception as error:
                raise ExtractorRejected("extractor cgroup could not be proven empty after failure") from error
        raise
    finally:
        if cgroup_fd >= 0:
            os.close(cgroup_fd)
        listener.close()
        try:
            current = control_path.lstat()
            if (current.st_dev, current.st_ino) == (socket_info.st_dev, socket_info.st_ino):
                control_path.unlink()
        except FileNotFoundError:
            pass
