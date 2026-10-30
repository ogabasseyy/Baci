"""Fixed systemd launch, identity, and cgroup proof for seed preverification."""
from __future__ import annotations

import secrets
import socket
import os
import grp
from pathlib import Path
import pwd
import re
import stat
import subprocess
import sys
import time

from dependency_seed_generation_contract import SeedGenerationRejected
from dependency_seed_filesystem import open_directory
from worker_release_dependency_supervisor_cgroup import (
    bounded_systemctl_query, preflight_cgroup_root, prove_collected_unit, stop_unit,
)
from worker_release_egress_identity import egress_identity

TOOLS = Path(__file__).resolve().parent
BIN = TOOLS.parents[1] / "bin"
EGRESS_SOCKET = Path("/run/baci-worker-egress/broker.sock")
EGRESS_SOURCE_ROOT = Path("/var/cache/baci-worker-release/seed-work")
EGRESS_TARGET = "/tmp/baci-seed-egress.sock"
EGRESS_SOURCE_RE = re.compile(r"^baci-seed-egress-[0-9a-f]{32}\.sock$")
TRANSACTION_ID_RE = re.compile(r"^[0-9a-f]{32}$")
CGROUP_ROOT = Path("/sys/fs/cgroup")
SYSTEMD_RUN = "/usr/bin/systemd-run"
SYSTEMCTL = "/usr/bin/systemctl"
PYTHON = "/usr/bin/python3"
MAX_UNIT_SECONDS = 330
MAX_CLEANUP_SECONDS = 30
MAX_UNIT_OUTPUT = 8192
_REQUIRED_ADDRESS_FAMILIES = frozenset({"AF_UNIX", "AF_INET", "AF_INET6"})


class EgressSourceAlias:
    """Pinned temporary bind-mount alias for the root broker socket."""

    def __init__(self, path: Path, source_identity: tuple[int, int, int, int, int, int],
                 placeholder_identity: tuple[int, int, int, int, int]):
        self.path = path
        self.source_identity = source_identity
        self.placeholder_identity = placeholder_identity


def _alias_path(path: Path) -> bool:
    path = Path(path)
    return (path.parent == EGRESS_SOURCE_ROOT
            and EGRESS_SOURCE_RE.fullmatch(path.name) is not None
            and path.is_absolute() and path == Path(os.path.normpath(str(path))))


def _mount_command(*args: str, timeout: float = 5) -> None:
    executable = args[0]
    if executable not in {"/usr/bin/mount", "/usr/bin/umount"}:
        raise SeedGenerationRejected("egress source mount command is outside fixed policy")
    try:
        result = subprocess.run((executable, *args[1:]), check=False,
                                stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                stderr=subprocess.DEVNULL, timeout=timeout,
                                env={"PATH": "/usr/bin:/bin", "LC_ALL": "C"})
    except (OSError, subprocess.SubprocessError) as error:
        raise SeedGenerationRejected("egress source mount operation failed") from error
    if result.returncode != 0:
        raise SeedGenerationRejected("egress source mount operation was rejected")


def _address_families_match(actual: str) -> bool:
    """Accept systemd token reordering, but reject duplicates and policy drift."""
    families = actual.split()
    return (len(families) == len(_REQUIRED_ADDRESS_FAMILIES)
            and frozenset(families) == _REQUIRED_ADDRESS_FAMILIES)


def identity() -> tuple[int, int]:
    try:
        return egress_identity()
    except Exception as error:
        raise SeedGenerationRejected("dedicated egress identity is unavailable") from error


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


def _source_socket_identity(path: Path, gid: int) -> tuple[int, int, int, int, int, int]:
    source = EGRESS_SOCKET.lstat()
    if (not stat.S_ISSOCK(source.st_mode) or source.st_uid != 0 or source.st_gid != gid
            or stat.S_IMODE(source.st_mode) != 0o660):
        raise SeedGenerationRejected("egress broker socket ownership or mode is unsafe")
    return (source.st_dev, source.st_ino, source.st_uid, source.st_gid,
            stat.S_IFMT(source.st_mode), stat.S_IMODE(source.st_mode))


def trusted_egress_source(path: Path, gid: int) -> tuple[int, int]:
    """Require an external alias to name the exact approved /run socket inode.

    The alias is supplied by the root generation orchestrator as a temporary
    bind mount. It must live outside every masked tree because systemd resolves
    BindReadOnlyPaths sources after applying InaccessiblePaths.
    """
    path = Path(path)
    if (path.parent != EGRESS_SOURCE_ROOT
            or EGRESS_SOURCE_RE.fullmatch(path.name) is None
            or not path.is_absolute() or path != Path(os.path.normpath(str(path)))):
        raise SeedGenerationRejected("egress source alias path is outside fixed policy")
    trusted_directory_chain(path.parent)
    trusted_socket(EGRESS_SOCKET, gid)
    try:
        source = EGRESS_SOCKET.lstat()
        alias = path.lstat()
    except OSError as error:
        raise SeedGenerationRejected("egress source alias is unavailable") from error
    source_identity = (source.st_dev, source.st_ino, source.st_uid, source.st_gid,
                       stat.S_IFMT(source.st_mode), stat.S_IMODE(source.st_mode))
    alias_identity = (alias.st_dev, alias.st_ino, alias.st_uid, alias.st_gid,
                      stat.S_IFMT(alias.st_mode), stat.S_IMODE(alias.st_mode))
    if (not stat.S_ISSOCK(source.st_mode) or source.st_uid != 0 or source.st_gid != gid
            or stat.S_IMODE(source.st_mode) != 0o660 or alias_identity != source_identity):
        raise SeedGenerationRejected("egress source alias is not the approved socket inode")
    return source.st_dev, source.st_ino


def prepare_egress_source_alias(gid: int, *, transaction_id: str) -> EgressSourceAlias:
    """Create and identify an unmounted placeholder before journaling its inode."""
    if os.geteuid() != 0 or not sys.platform.startswith("linux"):
        raise SeedGenerationRejected("egress source alias preparation requires root on Linux")
    trusted_directory_chain(EGRESS_SOURCE_ROOT)
    trusted_socket(EGRESS_SOCKET, gid)
    source_identity = _source_socket_identity(EGRESS_SOCKET, gid)
    if TRANSACTION_ID_RE.fullmatch(transaction_id) is None:
        raise SeedGenerationRejected("egress alias transaction identity is malformed")
    path = EGRESS_SOURCE_ROOT / f"baci-seed-egress-{transaction_id}.sock"
    placeholder_identity: tuple[int, int, int, int, int] | None = None
    try:
        placeholder = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        previous_umask = os.umask(0o177)
        try:
            placeholder.bind(str(path))
        finally:
            os.umask(previous_umask)
            placeholder.close()
        info = path.lstat()
        placeholder_identity = (info.st_dev, info.st_ino, info.st_uid, info.st_gid,
                                stat.S_IMODE(info.st_mode))
        if (not stat.S_ISSOCK(info.st_mode) or info.st_uid != 0 or info.st_nlink != 1
                or info.st_gid != 0 or stat.S_IMODE(info.st_mode) != 0o600):
            raise SeedGenerationRejected("egress alias placeholder is unsafe")
        if _source_socket_identity(EGRESS_SOCKET, gid) != source_identity:
            raise SeedGenerationRejected("egress broker socket changed while preparing alias")
        return EgressSourceAlias(path, source_identity, placeholder_identity)
    except BaseException:
        # The prepare phase has not mounted anything. Remove only the exact
        # placeholder inode this invocation created.
        try:
            current = path.lstat()
            if (placeholder_identity is not None
                    and (current.st_dev, current.st_ino, current.st_uid, current.st_gid,
                         stat.S_IMODE(current.st_mode)) == placeholder_identity
                    and not _is_mountpoint(path)):
                path.unlink()
        except (OSError, SeedGenerationRejected):
            pass
        raise


def mount_egress_source_alias(alias: EgressSourceAlias, gid: int) -> None:
    """Mount only the exact prepared socket after its inode is durable in journal."""
    if not isinstance(alias, EgressSourceAlias) or not _alias_path(alias.path):
        raise SeedGenerationRejected("egress source alias handle is invalid")
    if _source_socket_identity(EGRESS_SOCKET, gid) != alias.source_identity:
        raise SeedGenerationRejected("egress broker socket changed before alias mount")
    try:
        placeholder = alias.path.lstat()
    except OSError as error:
        raise SeedGenerationRejected("prepared egress alias disappeared before mount") from error
    expected_placeholder = alias.placeholder_identity
    if (placeholder.st_dev, placeholder.st_ino, placeholder.st_uid, placeholder.st_gid,
            stat.S_IMODE(placeholder.st_mode)) != expected_placeholder or _is_mountpoint(alias.path):
        raise SeedGenerationRejected("prepared egress alias changed before mount")
    _mount_command("/usr/bin/mount", "--bind", "--no-canonicalize",
                   str(EGRESS_SOCKET), str(alias.path))
    if _source_socket_identity(EGRESS_SOCKET, gid) != alias.source_identity:
        raise SeedGenerationRejected("egress broker socket changed while aliasing")
    if trusted_egress_source(alias.path, gid) != alias.source_identity[:2]:
        raise SeedGenerationRejected("egress source alias identity changed")


def create_egress_source_alias(gid: int, *, transaction_id: str | None = None) -> EgressSourceAlias:
    """Convenience wrapper for isolated tests; production journals between phases."""
    alias = prepare_egress_source_alias(
        gid, transaction_id=transaction_id if transaction_id is not None else secrets.token_hex(16))
    mount_egress_source_alias(alias, gid)
    return alias


def release_egress_source_alias(alias: EgressSourceAlias, gid: int) -> None:
    """Remove only the exact prepared or mounted alias after unit quiescence."""
    if not isinstance(alias, EgressSourceAlias) or not _alias_path(alias.path):
        raise SeedGenerationRejected("egress source alias handle is invalid")
    if _source_socket_identity(EGRESS_SOCKET, gid) != alias.source_identity:
        raise SeedGenerationRejected("egress broker socket changed before alias cleanup")
    try:
        current = alias.path.lstat()
    except OSError as error:
        raise SeedGenerationRejected("egress alias disappeared before cleanup") from error
    if _is_mountpoint(alias.path):
        if trusted_egress_source(alias.path, gid) != alias.source_identity[:2]:
            raise SeedGenerationRejected("egress source alias changed before cleanup")
        _mount_command("/usr/bin/umount", "--no-canonicalize", str(alias.path))
        try:
            current = alias.path.lstat()
        except OSError as error:
            raise SeedGenerationRejected("egress alias placeholder disappeared after unmount") from error
    restored_identity = (current.st_dev, current.st_ino, current.st_uid,
                         current.st_gid, stat.S_IMODE(current.st_mode))
    if (not stat.S_ISSOCK(current.st_mode) or restored_identity != alias.placeholder_identity
            or _is_mountpoint(alias.path)):
        raise SeedGenerationRejected("egress alias placeholder changed before cleanup")
    alias.path.unlink()


def _is_mountpoint(path: Path) -> bool:
    """Return a fixed boolean from mountinfo without exposing mount contents."""
    try:
        with open("/proc/self/mountinfo", encoding="ascii") as stream:
            for index, line in enumerate(stream):
                if index >= 100_000:
                    raise SeedGenerationRejected("mount table exceeds fixed bound")
                fields = line.split()
                if len(fields) >= 5 and fields[4].replace("\\040", " ") == str(path):
                    return True
    except OSError as error:
        raise SeedGenerationRejected("mount table is unavailable during recovery") from error
    return False


def recover_egress_source_alias(path: Path, gid: int, *, transaction_id: str,
                               allow_absent: bool = False,
                               expected_source_identity: tuple[int, int] | None = None,
                               expected_placeholder_identity: tuple[int, int] | None = None) -> None:
    """Remove only the exact journal-derived alias after a crash.

    The journal is written before mount creation. A prepared record pins both
    inodes; a planned record may clean only an exact root-owned, 0600 unmounted
    placeholder in the private fixed directory. Any mounted or malformed
    identity-less artifact is preserved.
    """
    if TRANSACTION_ID_RE.fullmatch(transaction_id) is None:
        raise SeedGenerationRejected("egress alias transaction identity is malformed")
    if ((expected_source_identity is None) != (expected_placeholder_identity is None)
            or expected_source_identity is not None and (
                len(expected_source_identity) != 2
                or any(type(item) is not int or item < 0 for item in expected_source_identity))
            or expected_placeholder_identity is not None and (
                len(expected_placeholder_identity) != 2
                or any(type(item) is not int or item < 0 for item in expected_placeholder_identity))):
        raise SeedGenerationRejected("journaled egress alias inode identity is malformed")
    expected = EGRESS_SOURCE_ROOT / f"baci-seed-egress-{transaction_id}.sock"
    path = Path(path)
    if path != expected or not _alias_path(path):
        raise SeedGenerationRejected("egress alias recovery path is not journal-derived")
    if os.geteuid() != 0 or not sys.platform.startswith("linux"):
        raise SeedGenerationRejected("egress alias recovery requires root on Linux")
    _, source_gid = identity()
    if gid != source_gid:
        raise SeedGenerationRejected("egress alias recovery group differs from fixed policy")
    trusted_directory_chain(EGRESS_SOURCE_ROOT)
    trusted_socket(EGRESS_SOCKET, gid)
    try:
        alias = path.lstat()
    except FileNotFoundError:
        if allow_absent and not _is_mountpoint(path):
            return
        raise SeedGenerationRejected("journaled egress alias is absent") from None
    alias_id = (alias.st_dev, alias.st_ino)
    if _is_mountpoint(path):
        recorded_source_id = expected_source_identity
        if recorded_source_id is None or alias_id != recorded_source_id:
            raise SeedGenerationRejected("journaled egress alias source inode is not recorded")
        if (not stat.S_ISSOCK(alias.st_mode) or alias.st_uid != 0 or alias.st_gid != gid
                or alias.st_nlink != 1 or stat.S_IMODE(alias.st_mode) != 0o660):
            raise SeedGenerationRejected("journaled egress alias source metadata is unsafe")
        if expected_source_identity is not None and recorded_source_id != expected_source_identity:
            raise SeedGenerationRejected("journaled egress alias source inode differs")
        _mount_command("/usr/bin/umount", "--no-canonicalize", str(path))
        try:
            restored = path.lstat()
        except OSError as error:
            raise SeedGenerationRejected("egress alias placeholder is unavailable after recovery") from error
        placeholder_id = (restored.st_dev, restored.st_ino)
        if (not stat.S_ISSOCK(restored.st_mode) or restored.st_uid != 0
                or restored.st_gid != 0 or restored.st_nlink != 1
                or stat.S_IMODE(restored.st_mode) != 0o600
                or expected_placeholder_identity is None
                or placeholder_id != expected_placeholder_identity):
            raise SeedGenerationRejected("egress alias placeholder is unsafe after recovery")
    else:
        restored = alias
        if (not stat.S_ISSOCK(restored.st_mode) or restored.st_uid != 0
                or restored.st_gid != 0 or restored.st_nlink != 1
                or stat.S_IMODE(restored.st_mode) != 0o600
                or (expected_placeholder_identity is not None
                    and (restored.st_dev, restored.st_ino) != expected_placeholder_identity)):
            raise SeedGenerationRejected("egress alias placeholder is unsafe after recovery")
    # Recheck the source and alias before unlinking, so a changed source or
    # unexpected replacement cannot turn journal cleanup into arbitrary delete.
    trusted_socket(EGRESS_SOCKET, gid)
    after = path.lstat()
    if (after.st_dev, after.st_ino, after.st_uid, after.st_gid, after.st_nlink,
            stat.S_IFMT(after.st_mode), stat.S_IMODE(after.st_mode)) != (
            restored.st_dev, restored.st_ino, 0, 0, 1,
            stat.S_IFMT(restored.st_mode), 0o600):
        raise SeedGenerationRejected("egress alias placeholder changed during recovery")
    path.unlink()


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
                    cache: Path, store: Path, pnpm: Path, node: Path,
                    egress_source: Path) -> tuple[str, ...]:
    if (not re.fullmatch(r"baci-worker-seed-[0-9a-f]{12}-[0-9a-f]{32}\.service", unit)
            or not re.fullmatch(r"[0-9a-f]{12}", sha)
            or not unit.startswith(f"baci-worker-seed-{sha}-")):
        raise SeedGenerationRejected("seed verifier unit name is invalid")
    egress_source = Path(egress_source)
    if (egress_source.parent != EGRESS_SOURCE_ROOT
            or EGRESS_SOURCE_RE.fullmatch(egress_source.name) is None
            or not egress_source.is_absolute()
            or egress_source != Path(os.path.normpath(str(egress_source)))):
        raise SeedGenerationRejected("egress source alias path is outside fixed policy")
    bind_ro = (
        f"{source}:/run/baci-seed/source", f"{TOOLS}:/run/baci-seed-tools",
        f"{BIN}:/run/baci-seed-bin", f"{pnpm}:/run/baci-seed-runtime/pnpm.cjs",
        f"{node}:/run/baci-seed-runtime/node", "/etc/ssl/certs:/etc/ssl/certs",
        f"{egress_source}:{EGRESS_TARGET}",
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
                         cache: Path, store: Path, pnpm: Path, node: Path,
                         egress_source: Path) -> None:
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
            f"{egress_source}:{EGRESS_TARGET}",
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
            or EGRESS_TARGET not in " ".join(
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
           "BIN", "EGRESS_SOURCE_ROOT", "EGRESS_TARGET", "drain_unit", "identity",
           "create_egress_source_alias", "prepare_egress_source_alias",
           "mount_egress_source_alias", "preflight_cgroup_root",
           "release_egress_source_alias", "systemd_command", "trusted_egress_source",
           "trusted_code_tree", "trusted_directory_chain", "trusted_file", "trusted_socket",
           "validate_active_unit"]
