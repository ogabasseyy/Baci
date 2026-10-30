"""Fixed systemd launch, identity, and cgroup proof for seed preverification."""
from __future__ import annotations

import grp
import os
from pathlib import Path
import grp
import pwd
import pwd
import re
import stat
import subprocess
import time

from dependency_seed_generation_contract import SeedGenerationRejected
from dependency_seed_filesystem import open_directory
from worker_release_dependency_supervisor_cgroup import (
    bounded_systemctl_query, preflight_cgroup_root, prove_collected_unit, stop_unit,
)

TOOLS = Path(__file__).resolve().parent
BIN = TOOLS.parents[1] / "bin"
EGRESS_SOCKET = Path("/run/baci-worker-egress/broker.sock")
CGROUP_ROOT = Path("/sys/fs/cgroup")
SYSTEMD_RUN = "/usr/bin/systemd-run"
SYSTEMCTL = "/usr/bin/systemctl"
PYTHON = "/usr/bin/python3"
MAX_UNIT_SECONDS = 330
MAX_CLEANUP_SECONDS = 30
MAX_UNIT_OUTPUT = 8192
_REQUIRED_ADDRESS_FAMILIES = frozenset({"AF_UNIX", "AF_INET", "AF_INET6"})


def _address_families_match(actual: str) -> bool:
    """Accept systemd token reordering, but reject duplicates and policy drift."""
    families = actual.split()
    return (len(families) == len(_REQUIRED_ADDRESS_FAMILIES)
            and frozenset(families) == _REQUIRED_ADDRESS_FAMILIES)


def identity() -> tuple[int, int]:
    try:
        user = pwd.getpwnam("baci-worker-egress-bridge")
        group = grp.getgrnam("baci-worker-egress-bridge")
        groups = os.getgrouplist(user.pw_name, user.pw_gid)
    except (KeyError, OSError) as error:
        raise SeedGenerationRejected("dedicated egress identity is unavailable") from error
    if (user.pw_uid <= 0 or user.pw_gid != group.gr_gid or groups != [group.gr_gid]
            or user.pw_dir != "/nonexistent" or not user.pw_shell.endswith("/nologin")):
        raise SeedGenerationRejected("dedicated egress identity is not exclusive")
    return user.pw_uid, group.gr_gid


def trusted_directory_chain(path: Path) -> None:
    """Require every path component to be a root-owned, non-writable directory."""
    absolute = path.absolute()
    fd = os.open("/", os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for component in absolute.parts[1:]:
            child = os.open(component, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                            dir_fd=fd)
            info = os.fstat(child)
            if info.st_uid != 0 or info.st_mode & 0o022:
                os.close(child)
                raise SeedGenerationRejected("trusted path component is not root protected")
            os.close(fd)
            fd = child
    except OSError as error:
        raise SeedGenerationRejected("trusted path contains a missing or linked component") from error
    finally:
        os.close(fd)


def trusted_socket(path: Path, gid: int) -> tuple[int, int]:
    if path != EGRESS_SOCKET:
        raise SeedGenerationRejected("egress broker socket path is not fixed")
    trusted_directory_chain(path.parent)
    parent_fd = open_directory(path.parent, owner_uid=0)
    try:
        parent = os.fstat(parent_fd)
    finally:
        os.close(parent_fd)
    info = path.lstat()
    if (not stat.S_ISDIR(parent.st_mode) or parent.st_uid != 0 or parent.st_mode & 0o022
            or not stat.S_ISSOCK(info.st_mode) or info.st_uid != 0 or info.st_gid != gid
            or stat.S_IMODE(info.st_mode) != 0o660):
        raise SeedGenerationRejected("egress broker socket ownership or mode is unsafe")
    return info.st_dev, info.st_ino


def trusted_file(path: Path, *, executable: bool) -> tuple[int, int]:
    trusted_directory_chain(path.parent)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        info = os.fstat(fd)
    finally:
        os.close(fd)
    if (not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_nlink != 1
            or info.st_mode & 0o022 or (executable and not info.st_mode & 0o111)):
        raise SeedGenerationRejected("seed runtime executable is not root-owned and immutable")
    return info.st_dev, info.st_ino


def trusted_code_tree(root: Path) -> None:
    trusted_directory_chain(root.parent)
    root_fd = open_directory(root, owner_uid=0, immutable=True)
    try:
        entries = 0

        def visit(fd: int) -> None:
            nonlocal entries
            before = os.fstat(fd)
            for name in os.listdir(fd):
                info = os.stat(name, dir_fd=fd, follow_symlinks=False)
                entries += 1
                if entries > 100_000 or info.st_uid != 0 or info.st_mode & 0o222:
                    raise SeedGenerationRejected("seed verifier code tree is writable or over bound")
                if stat.S_ISDIR(info.st_mode):
                    child = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                                    dir_fd=fd)
                    try:
                        opened = os.fstat(child)
                        if (opened.st_dev, opened.st_ino) != (info.st_dev, info.st_ino):
                            raise SeedGenerationRejected("seed verifier code directory changed")
                        visit(child)
                    finally:
                        os.close(child)
                elif stat.S_ISREG(info.st_mode) and info.st_nlink == 1:
                    child = os.open(name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=fd)
                    try:
                        opened = os.fstat(child)
                        if (opened.st_dev, opened.st_ino, opened.st_size) != (
                                info.st_dev, info.st_ino, info.st_size):
                            raise SeedGenerationRejected("seed verifier code file changed")
                    finally:
                        os.close(child)
                else:
                    raise SeedGenerationRejected("seed verifier code tree contains a link")
            after = os.fstat(fd)
            if (before.st_dev, before.st_ino, before.st_mtime_ns, before.st_ctime_ns) != (
                    after.st_dev, after.st_ino, after.st_mtime_ns, after.st_ctime_ns):
                raise SeedGenerationRejected("seed verifier code tree changed")

        visit(root_fd)
    finally:
        os.close(root_fd)


def systemd_command(unit: str, sha: str, uid: int, gid: int, *, source: Path,
                    cache: Path, store: Path, pnpm: Path, node: Path) -> tuple[str, ...]:
    if (not re.fullmatch(r"baci-worker-seed-[0-9a-f]{12}-[0-9a-f]{32}\.service", unit)
            or not re.fullmatch(r"[0-9a-f]{12}", sha)
            or not unit.startswith(f"baci-worker-seed-{sha}-")):
        raise SeedGenerationRejected("seed verifier unit name is invalid")
    bind_ro = (
        f"{source}:/run/baci-seed/source", f"{TOOLS}:/run/baci-seed-tools",
        f"{BIN}:/run/baci-seed-bin", f"{pnpm}:/run/baci-seed-runtime/pnpm.cjs",
        f"{node}:/run/baci-seed-runtime/node", "/etc/ssl/certs:/etc/ssl/certs",
        f"{EGRESS_SOCKET}:/run/baci-seed-egress.sock",
    )
    bind_rw = (f"{cache}:/run/baci-seed/cache", f"{store}:/run/baci-seed/store")
    command = [SYSTEMD_RUN, "--quiet", "--system", "--wait", "--pipe", "--collect",
               f"--unit={unit}", f"--uid={uid}", f"--gid={gid}"]
    properties = {
        "Type": "exec", "KillMode": "mixed", "PrivateNetwork": "yes",
        "RemainAfterExit": "yes", "PrivateUsers": "yes",
        "PrivateTmp": "yes", "PrivateDevices": "yes", "NoNewPrivileges": "yes",
        "ProtectSystem": "strict", "ProtectHome": "yes", "ProtectKernelTunables": "yes",
        "ProtectKernelModules": "yes", "ProtectKernelLogs": "yes",
        "ProtectControlGroups": "yes", "ProtectProc": "invisible", "ProcSubset": "pid",
        "RestrictRealtime": "yes", "RestrictSUIDSGID": "yes", "SupplementaryGroups": "",
        "RestrictAddressFamilies": "AF_UNIX AF_INET AF_INET6", "UMask": "0077",
        "RuntimeMaxSec": f"{MAX_UNIT_SECONDS}s", "TasksMax": "128",
        "MemoryMax": "2G", "LimitFSIZE": "4G", "CPUQuota": "200%",
        "LimitNOFILE": "4096",
        "ReadWritePaths": "/run/baci-seed/cache /run/baci-seed/store",
        # PrivateNetwork does not hide AF_UNIX sockets. Mask host /run, then
        # bind back only the fixed root broker socket at its worker alias.
        "InaccessiblePaths": "/root /home /var/lib /var/log /run /srv /mnt /media",
        "TemporaryFileSystem": "/etc:ro",
    }
    command.extend(f"--property={key}={value}" for key, value in properties.items())
    command.extend(f"--property=BindReadOnlyPaths={item}" for item in bind_ro)
    command.extend(f"--property=BindPaths={item}" for item in bind_rw)
    command.extend((PYTHON, "/run/baci-seed-tools/dependency_seed_generation_worker.py",
                    "--source", "/run/baci-seed/source", "--cache", "/run/baci-seed/cache",
                    "--store", "/run/baci-seed/store", "--pnpm", "/run/baci-seed-runtime/pnpm.cjs",
                    "--node", "/run/baci-seed-runtime/node", "--sha", sha,
                    "--host-uid", str(uid), "--host-gid", str(gid)))
    return tuple(command)


def validate_active_unit(query, unit: str, uid: int, gid: int, *, source: Path,
                         cache: Path, store: Path, pnpm: Path, node: Path) -> None:
    """Check effective unit properties while RemainAfterExit pins the unit."""
    expected = {
        "ActiveState": "active", "SubState": "exited", "Result": "success",
        "ExecMainStatus": "0", "MainPID": "0", "ControlGroup": f"/system.slice/{unit}",
        "Type": "exec", "RemainAfterExit": "yes", "SupplementaryGroups": "",
        "KillMode": "mixed", "NoNewPrivileges": "yes",
        "PrivateNetwork": "yes", "PrivateUsers": "yes", "ProtectSystem": "strict",
        "ProtectHome": "yes", "PrivateTmp": "yes", "PrivateDevices": "yes",
        "ProtectControlGroups": "yes", "ProtectKernelTunables": "yes",
        "ProtectKernelModules": "yes", "ProtectKernelLogs": "yes",
        "ProtectProc": "invisible", "ProcSubset": "pid", "RestrictSUIDSGID": "yes",
        "RestrictRealtime": "yes", "TasksMax": "128", "MemoryMax": str(2 * 1024**3),
        "CPUQuotaPerSecUSec": "2s", "UMask": "0077", "LimitNOFILE": "4096",
        "ReadWritePaths": "/run/baci-seed/cache /run/baci-seed/store",
        "BindPaths": f"{cache}:/run/baci-seed/cache {store}:/run/baci-seed/store",
        "BindReadOnlyPaths": " ".join((
            f"{source}:/run/baci-seed/source", f"{TOOLS}:/run/baci-seed-tools",
            f"{BIN}:/run/baci-seed-bin", f"{pnpm}:/run/baci-seed-runtime/pnpm.cjs",
            f"{node}:/run/baci-seed-runtime/node", "/etc/ssl/certs:/etc/ssl/certs",
            f"{EGRESS_SOCKET}:/run/baci-seed-egress.sock",
        )),
        "InaccessiblePaths": "/root /home /var/lib /var/log /run /srv /mnt /media",
        "TemporaryFileSystem": "/etc:ro",
    }
    for key, expected_value in expected.items():
        if query("show", f"--property={key}", "--value", unit) != expected_value:
            raise SeedGenerationRejected(f"seed unit {key} differs from fixed policy")
    if query("show", "--property=User", "--value", unit) not in {
            str(uid), pwd.getpwuid(uid).pw_name}:
        raise SeedGenerationRejected("seed unit user differs from fixed policy")
    if query("show", "--property=Group", "--value", unit) not in {
            str(gid), grp.getgrgid(gid).gr_name}:
        raise SeedGenerationRejected("seed unit group differs from fixed policy")
    exec_start = query("show", "--property=ExecStart", "--value", unit)
    if (exec_start.count("path=") != 1 or exec_start.count("argv[]=") != 1
            or "path=/usr/bin/python3" not in exec_start
            or "dependency_seed_generation_worker.py" not in exec_start
            or "/run/baci-seed-runtime/pnpm.cjs" not in exec_start
            or "/run/baci-seed-runtime/node" not in exec_start
            or "--source /run/baci-seed/source" not in exec_start
            or "--cache /run/baci-seed/cache" not in exec_start
            or "--store /run/baci-seed/store" not in exec_start
            or f"--sha {unit.split('-')[3]}" not in exec_start
            or f"--host-uid {uid}" not in exec_start
            or f"--host-gid {gid}" not in exec_start
            or "/run/baci-seed-egress.sock" not in " ".join(
                (query("show", "--property=BindReadOnlyPaths", "--value", unit),))):
        raise SeedGenerationRejected("seed unit command differs from fixed policy")
    if query("show", "--property=RuntimeMaxUSec", "--value", unit) not in {
            f"{MAX_UNIT_SECONDS}s", "5min 30s"}:
        raise SeedGenerationRejected("seed unit runtime limit differs from fixed policy")
    if query("show", "--property=LimitFSIZE", "--value", unit) not in {
            str(4 * 1024**3), "4G"}:
        raise SeedGenerationRejected("seed unit file-size limit differs from fixed policy")
    if not _address_families_match(
            query("show", "--property=RestrictAddressFamilies", "--value", unit)):
        raise SeedGenerationRejected("seed unit address-family policy differs from fixed policy")


def _systemctl(*args: str, timeout: float = 1) -> str:
    try:
        result = subprocess.run((SYSTEMCTL, *args), check=True, stdin=subprocess.DEVNULL,
                                stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                timeout=timeout, text=True, env={"PATH": "/usr/bin:/bin"})
    except (OSError, subprocess.SubprocessError) as error:
        raise SeedGenerationRejected("seed verifier systemd query failed") from error
    return result.stdout.strip()


def drain_unit(unit: str, uid: int, trusted_root: tuple[int, int, int, int], *,
               failed: bool) -> None:
    deadline = time.monotonic() + MAX_CLEANUP_SECONDS
    if failed:
        stop_unit(SYSTEMCTL, unit)
    prove_collected_unit(
        unit, None, root=CGROUP_ROOT, uid=uid, deadline=deadline,
        query=lambda *args: bounded_systemctl_query(
            _systemctl, deadline, SeedGenerationRejected, *args),
        trusted_root=trusted_root,
    )


__all__ = ["CGROUP_ROOT", "EGRESS_SOCKET", "MAX_UNIT_OUTPUT", "MAX_UNIT_SECONDS",
           "PYTHON", "SeedGenerationRejected", "SYSTEMD_RUN", "SYSTEMCTL", "TOOLS",
           "BIN", "drain_unit", "identity", "preflight_cgroup_root", "systemd_command",
           "trusted_code_tree", "trusted_directory_chain", "trusted_file", "trusted_socket",
           "validate_active_unit"]
