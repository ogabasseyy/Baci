"""Grant and validate candidate-only read access for the runtime verifier."""
from __future__ import annotations

import errno
import os
import re
import stat
import struct
from pathlib import Path
from worker_release_runtime_identity import RuntimeIdentityRejected, runtime_verifier_identity

VERIFY_GROUP = "baci-worker-runtime-verify"
VERIFY_USER = "baci-worker-runtime-verify"
RELEASES_ROOT = Path("/srv/baci-workers/releases")
MAX_ENTRIES = 500_000
MAX_BYTES = 2 * 1024 * 1024 * 1024
DIR_FLAGS = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
FILE_FLAGS = os.O_RDONLY | os.O_NOFOLLOW
ACL_XATTR = "system.posix_acl_access"
ACL_VERSION = 2
ACL_USER_OBJ, ACL_GROUP_OBJ, ACL_GROUP, ACL_MASK, ACL_OTHER = 1, 4, 8, 16, 32
UNDEFINED_ID = 0xFFFFFFFF
ACL_ENTRY = struct.Struct("<HHI")
TX_RE = re.compile(r"^\.([0-9a-f]{40})\.incoming\.([0-9a-f]{32})$")


class RuntimeAclRejected(RuntimeError):
    """The isolated verifier ACL could not be established exactly."""


def verifier_identity() -> tuple[int, int]:
    try:
        return runtime_verifier_identity()
    except RuntimeIdentityRejected as error:
        raise RuntimeAclRejected("dedicated verifier user and group are not isolated") from error


def verifier_gid() -> int:
    return verifier_identity()[1]


def verifier_uid() -> int:
    return verifier_identity()[0]


def expected_access_acl(mode: int, gid: int) -> bytes:
    permissions = stat.S_IMODE(mode)
    owner = (permissions >> 6) & 7
    group = (permissions >> 3) & 7
    other = permissions & 7
    entries = (
        (ACL_USER_OBJ, owner, UNDEFINED_ID),
        (ACL_GROUP_OBJ, group, UNDEFINED_ID),
        (ACL_GROUP, group, gid),
        (ACL_MASK, group, UNDEFINED_ID),
        (ACL_OTHER, other, UNDEFINED_ID),
    )
    return struct.pack("<I", ACL_VERSION) + b"".join(
        ACL_ENTRY.pack(tag, permission, identity) for tag, permission, identity in entries
    )


def _get_acl(fd: int) -> bytes | None:
    try:
        return os.getxattr(fd, ACL_XATTR)
    except OSError as error:
        if error.errno == getattr(errno, "ENODATA", 61):
            return None
        raise RuntimeAclRejected("candidate filesystem does not support safe POSIX ACL access") from error


def _set_exact_acl(fd: int, mode: int, gid: int, *, allow_absent: bool) -> None:
    expected = expected_access_acl(mode, gid)
    current = _get_acl(fd)
    if current == expected:
        return
    if current is not None or not allow_absent:
        raise RuntimeAclRejected("candidate has an unexpected access ACL")
    try:
        os.setxattr(fd, ACL_XATTR, expected)
    except OSError as error:
        raise RuntimeAclRejected("candidate verifier ACL could not be installed") from error
    updated = os.fstat(fd)
    if stat.S_IMODE(updated.st_mode) != stat.S_IMODE(mode) or _get_acl(fd) != expected:
        raise RuntimeAclRejected("candidate verifier ACL changed file mode or failed verification")


def _open_candidate(candidate: Path, expected_sha: str, owner_uid: int,
                    owner_gid: int, releases_root: Path) -> tuple[int, int]:
    match = TX_RE.fullmatch(candidate.name)
    if (not match or match.group(1) != expected_sha or candidate.parent != releases_root
            or candidate != Path(os.path.normpath(str(candidate))) or not candidate.is_absolute()):
        raise RuntimeAclRejected("candidate ACL target is not an exact incoming release")
    if (not releases_root.is_absolute()
            or releases_root != Path(os.path.normpath(str(releases_root)))):
        raise RuntimeAclRejected("candidate release root is not normalized")
    parent = os.open("/", DIR_FLAGS)
    try:
        for component in releases_root.parts[1:]:
            child = os.open(component, DIR_FLAGS, dir_fd=parent)
            info = os.fstat(child)
            if (not stat.S_ISDIR(info.st_mode) or info.st_uid not in {0, owner_uid}
                    or info.st_mode & 0o022):
                os.close(child)
                raise RuntimeAclRejected("candidate release ancestor is unsafe")
            os.close(parent)
            parent = child
        metadata = os.fstat(parent)
        if (not stat.S_ISDIR(metadata.st_mode) or metadata.st_uid != owner_uid
                or metadata.st_mode & 0o022):
            raise RuntimeAclRejected("candidate release parent is unsafe")
        root = os.open(candidate.name, DIR_FLAGS, dir_fd=parent)
        root_info = os.fstat(root)
        if (root_info.st_uid != owner_uid or root_info.st_gid != owner_gid
                or stat.S_IMODE(root_info.st_mode) != 0o550):
            os.close(root)
            raise RuntimeAclRejected("candidate root ownership or mode is unsafe")
        named = os.stat(candidate.name, dir_fd=parent, follow_symlinks=False)
        if (named.st_dev, named.st_ino) != (root_info.st_dev, root_info.st_ino):
            os.close(root)
            raise RuntimeAclRejected("candidate root path changed before ACL update")
        return parent, root
    except BaseException:
        os.close(parent)
        raise


def _walk(root_fd: int, owner_uid: int, owner_gid: int, *, gid: int,
          install: bool) -> None:
    counters = {"entries": 0, "bytes": 0}

    def visit(directory_fd: int, depth: int = 0) -> None:
        directory = os.fstat(directory_fd)
        if (not stat.S_ISDIR(directory.st_mode) or directory.st_uid != owner_uid
                or directory.st_gid != owner_gid or stat.S_IMODE(directory.st_mode) != 0o550):
            raise RuntimeAclRejected("candidate directory metadata is unsafe")
        _set_exact_acl(directory_fd, directory.st_mode, gid, allow_absent=install)
        try:
            if os.getxattr(directory_fd, "system.posix_acl_default"):
                raise RuntimeAclRejected("candidate contains a default ACL")
        except OSError as error:
            if error.errno != getattr(errno, "ENODATA", 61):
                raise RuntimeAclRejected("candidate default ACL could not be checked") from error
        for name in sorted(os.listdir(directory_fd)):
            if name in {"", ".", ".."} or "/" in name or "\\" in name:
                raise RuntimeAclRejected("candidate entry name is unsafe")
            counters["entries"] += 1
            if counters["entries"] > MAX_ENTRIES or depth >= 128:
                raise RuntimeAclRejected("candidate exceeds fixed ACL entry bounds")
            info = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
            if stat.S_ISDIR(info.st_mode):
                child_fd = os.open(name, DIR_FLAGS, dir_fd=directory_fd)
                try:
                    opened = os.fstat(child_fd)
                    if (opened.st_dev, opened.st_ino, opened.st_uid, opened.st_gid, opened.st_mode) != (
                        info.st_dev, info.st_ino, info.st_uid, info.st_gid, info.st_mode
                    ):
                        raise RuntimeAclRejected("candidate directory changed during ACL update")
                    visit(child_fd, depth=depth + 1)
                    named = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
                    if (named.st_dev, named.st_ino) != (opened.st_dev, opened.st_ino):
                        raise RuntimeAclRejected("candidate directory path changed during ACL update")
                finally:
                    os.close(child_fd)
            elif stat.S_ISREG(info.st_mode):
                if (info.st_uid != owner_uid or info.st_gid != owner_gid or info.st_nlink != 1
                        or stat.S_IMODE(info.st_mode) not in {0o440, 0o550}):
                    raise RuntimeAclRejected("candidate file metadata is unsafe")
                counters["bytes"] += info.st_size
                if counters["bytes"] > MAX_BYTES:
                    raise RuntimeAclRejected("candidate exceeds fixed ACL byte bound")
                file_fd = os.open(name, FILE_FLAGS, dir_fd=directory_fd)
                try:
                    opened = os.fstat(file_fd)
                    if (opened.st_dev, opened.st_ino, opened.st_uid, opened.st_gid, opened.st_mode,
                            opened.st_nlink, opened.st_size, opened.st_mtime_ns) != (
                        info.st_dev, info.st_ino, info.st_uid, info.st_gid, info.st_mode,
                        info.st_nlink, info.st_size, info.st_mtime_ns
                    ):
                        raise RuntimeAclRejected("candidate file changed during ACL update")
                    _set_exact_acl(file_fd, opened.st_mode, gid, allow_absent=install)
                    named = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
                    if (named.st_dev, named.st_ino) != (opened.st_dev, opened.st_ino):
                        raise RuntimeAclRejected("candidate file path changed during ACL update")
                finally:
                    os.close(file_fd)
            else:
                raise RuntimeAclRejected("candidate contains a link or special file")

    visit(root_fd)


def grant_candidate_acl(candidate: Path, *, expected_sha: str, owner_uid: int,
                        owner_gid: int, gid: int | None = None,
                        releases_root: Path = RELEASES_ROOT) -> int:
    """Install exact verifier read ACLs on one immutable incoming tree.

    The candidate remains owned by the worker group. This only grants a named,
    empty system GID read/execute access to this tree; it does not make a claim
    about GID-owned files elsewhere on the host.
    """
    if os.geteuid() != 0 or not sys_platform_linux():
        raise RuntimeAclRejected("candidate ACL requires the Linux root broker")
    selected_gid = verifier_gid()
    if (type(selected_gid) is not int or selected_gid <= 0 or selected_gid == owner_gid
            or (gid is not None and gid != selected_gid)):
        raise RuntimeAclRejected("dedicated verifier GID is invalid")
    parent_fd, root_fd = _open_candidate(candidate, expected_sha, owner_uid, owner_gid, releases_root)
    try:
        _walk(root_fd, owner_uid, owner_gid, gid=selected_gid, install=True)
        root = os.fstat(root_fd)
        named = os.stat(candidate.name, dir_fd=parent_fd, follow_symlinks=False)
        if (root.st_dev, root.st_ino, root.st_uid, root.st_gid, root.st_mode) != (
            named.st_dev, named.st_ino, named.st_uid, named.st_gid, named.st_mode
        ):
            raise RuntimeAclRejected("candidate root changed during ACL update")
        return selected_gid
    finally:
        os.close(root_fd)
        os.close(parent_fd)


def sys_platform_linux() -> bool:
    return os.name == "posix" and Path("/proc/self").is_dir()


__all__ = ["RELEASES_ROOT", "RuntimeAclRejected", "VERIFY_GROUP", "VERIFY_USER",
           "grant_candidate_acl", "expected_access_acl", "verifier_gid", "verifier_uid",
           "verifier_identity"]
