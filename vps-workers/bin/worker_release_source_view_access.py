"""Narrow POSIX ACL access for the frozen seed source view."""
from __future__ import annotations

import os
import grp
import pwd
import stat
import struct
from pathlib import Path


class SourceViewAccessRejected(RuntimeError):
    """The seed source view cannot be exposed to its fixed readers safely."""


ACL_XATTR = "system.posix_acl_access"
ACL_VERSION = 2
USER_OBJ, USER, GROUP_OBJ, MASK, OTHER = 0x01, 0x02, 0x04, 0x10, 0x20
READ_EXECUTE = 0x05
READ_ONLY = 0x04
UNDEFINED_ID = 0xFFFFFFFF


def fixed_reader_uids() -> tuple[int, int]:
    """Return only the provisioned builder and egress identities."""
    try:
        builder = pwd.getpwnam("baci-release-build")
        builder_group = grp.getgrnam("baci-release-build")
        lock_group = grp.getgrnam("baci-locks")
        egress = pwd.getpwnam("baci-worker-egress-bridge")
    except KeyError as error:
        raise SourceViewAccessRejected("fixed source-view readers are unavailable") from error
    builder_memberships = os.getgrouplist(builder.pw_name, builder.pw_gid)
    builder_aliases = [row for row in grp.getgrall() if row.gr_gid == builder_group.gr_gid]
    builder_primary_aliases = [row for row in pwd.getpwall() if row.pw_gid == builder_group.gr_gid]
    builder_uid_aliases = [row for row in pwd.getpwall() if row.pw_uid == builder.pw_uid]
    egress_uid, egress_gid = _egress_identity()
    egress_uid_aliases = [row for row in pwd.getpwall() if row.pw_uid == egress_uid]
    egress_group_aliases = [row for row in grp.getgrall() if row.gr_gid == egress_gid]
    egress_primary_aliases = [row for row in pwd.getpwall() if row.pw_gid == egress_gid]
    if (builder.pw_uid <= 0 or egress_uid <= 0 or builder.pw_uid == egress_uid
            or builder.pw_gid != builder_group.gr_gid or builder_group.gr_gid <= 0
            or builder_group.gr_mem or len(builder_aliases) != 1
            or builder_aliases[0].gr_name != "baci-release-build"
            or sorted(row.pw_name for row in builder_primary_aliases) != [builder.pw_name]
            or sorted(row.pw_name for row in builder_uid_aliases) != [builder.pw_name]
            or builder_memberships != [builder_group.gr_gid]
            or lock_group.gr_gid in builder_memberships or egress_gid <= 0
            or sorted(row.pw_name for row in egress_uid_aliases) != ["baci-worker-egress-bridge"]
            or len(egress_group_aliases) != 1
            or egress_group_aliases[0].gr_name != "baci-worker-egress-bridge"
            or egress_group_aliases[0].gr_mem
            or sorted(row.pw_name for row in egress_primary_aliases) != ["baci-worker-egress-bridge"]
            or builder.pw_dir != "/nonexistent" or egress.pw_dir != "/nonexistent"
            or not builder.pw_shell.endswith("/nologin")
            or not egress.pw_shell.endswith("/nologin")):
        raise SourceViewAccessRejected("fixed source-view readers are not isolated")
    return tuple(sorted((builder.pw_uid, egress_uid)))


def _egress_identity() -> tuple[int, int]:
    try:
        from dependency_seed_generation_unit import identity
        return identity()
    except Exception as error:
        raise SourceViewAccessRejected("fixed egress reader identity is not isolated") from error


def _acl(owner_permissions: int, read_uids: tuple[int, ...]) -> bytes:
    if (not read_uids or len(set(read_uids)) != len(read_uids)
            or any(type(uid) is not int or uid <= 0 for uid in read_uids)):
        raise SourceViewAccessRejected("source-view reader policy is invalid")
    named = [(USER, owner_permissions, uid) for uid in sorted(read_uids)]
    mask = owner_permissions
    entries = [(USER_OBJ, owner_permissions, UNDEFINED_ID), *named,
               (GROUP_OBJ, 0, UNDEFINED_ID), (MASK, mask, UNDEFINED_ID),
               (OTHER, 0, UNDEFINED_ID)]
    return struct.pack("<I", ACL_VERSION) + b"".join(
        struct.pack("<HHI", tag, perm, qualifier) for tag, perm, qualifier in entries
    )


def grant_source_view_access(root: Path, *, read_uids: tuple[int, ...]) -> None:
    """Set exact per-UID ACLs on the root-owned frozen tree, descriptor-relatively."""
    if os.geteuid() != 0 or not hasattr(os, "setxattr"):
        raise SourceViewAccessRejected("source-view ACL setup requires Linux root")
    root_fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    pending = [root_fd]
    try:
        while pending:
            directory_fd = pending.pop()
            try:
                info = os.fstat(directory_fd)
                if (info.st_uid != 0 or stat.S_IMODE(info.st_mode) != 0o550):
                    raise SourceViewAccessRejected("source-view directory is not frozen root-owned")
                os.setxattr(directory_fd, ACL_XATTR, _acl(READ_EXECUTE, read_uids))
                os.fsync(directory_fd)
                for name in os.listdir(directory_fd):
                    item = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
                    if stat.S_ISDIR(item.st_mode):
                        child = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                                        dir_fd=directory_fd)
                        opened = os.fstat(child)
                        if ((opened.st_dev, opened.st_ino) != (item.st_dev, item.st_ino)
                                or opened.st_uid != 0 or stat.S_IMODE(opened.st_mode) != 0o550):
                            os.close(child)
                            raise SourceViewAccessRejected("source-view directory changed during ACL setup")
                        pending.append(child)
                    elif stat.S_ISREG(item.st_mode):
                        if item.st_uid != 0 or stat.S_IMODE(item.st_mode) not in (0o440, 0o550) or item.st_nlink != 1:
                            raise SourceViewAccessRejected("source-view file is not frozen root-owned")
                        fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=directory_fd)
                        try:
                            opened = os.fstat(fd)
                            if (opened.st_dev, opened.st_ino, opened.st_uid) != (item.st_dev, item.st_ino, 0):
                                raise SourceViewAccessRejected("source-view file changed during ACL setup")
                            os.setxattr(fd, ACL_XATTR,
                                        _acl(READ_EXECUTE if item.st_mode & 0o111 else READ_ONLY,
                                             read_uids))
                            os.fsync(fd)
                            expected = _acl(READ_EXECUTE if item.st_mode & 0o111 else READ_ONLY,
                                            read_uids)
                            if os.getxattr(fd, ACL_XATTR) != expected:
                                raise SourceViewAccessRejected("source-view ACL differs after install")
                        finally:
                            os.close(fd)
                    else:
                        raise SourceViewAccessRejected("source-view contains a link or special file")
            finally:
                os.close(directory_fd)
    except OSError as error:
        raise SourceViewAccessRejected("exact source-view ACL could not be installed") from error
    finally:
        while pending:
            os.close(pending.pop())


__all__ = ["SourceViewAccessRejected", "fixed_reader_uids", "grant_source_view_access"]
