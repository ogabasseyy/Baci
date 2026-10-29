"""Validation for the dedicated, non-login runtime verifier account."""
from __future__ import annotations

import grp
import os
import pwd

VERIFY_GROUP = "baci-worker-runtime-verify"
VERIFY_USER = "baci-worker-runtime-verify"
NOLOGIN = "/usr/sbin/nologin"


class RuntimeIdentityRejected(RuntimeError):
    """The verifier account or group is not uniquely isolated."""


def runtime_verifier_identity() -> tuple[int, int]:
    try:
        group = grp.getgrnam(VERIFY_GROUP)
        user = pwd.getpwnam(VERIFY_USER)
        aliases = [entry for entry in grp.getgrall() if entry.gr_gid == group.gr_gid]
        users = pwd.getpwall()
        primary = [entry for entry in users if entry.pw_gid == group.gr_gid]
        uid_aliases = [entry for entry in users if entry.pw_uid == user.pw_uid]
        supplementary = {grp.getgrgid(gid).gr_name
                         for gid in os.getgrouplist(VERIFY_USER, user.pw_gid)}
    except KeyError as error:
        raise RuntimeIdentityRejected("dedicated runtime verifier identity is unavailable") from error
    if (group.gr_gid <= 0 or group.gr_mem or len(aliases) != 1
            or aliases[0].gr_name != VERIFY_GROUP
            or sorted(item.pw_name for item in primary) != [VERIFY_USER]
            or user.pw_uid <= 0 or user.pw_gid != group.gr_gid
            or user.pw_shell != NOLOGIN or user.pw_dir != "/nonexistent"
            or sorted(item.pw_name for item in uid_aliases) != [VERIFY_USER]
            or supplementary != {VERIFY_GROUP}):
        raise RuntimeIdentityRejected("runtime verifier user and group are not uniquely isolated")
    return user.pw_uid, group.gr_gid


def validate_runtime_verifier_provisioning() -> None:
    """Allow only absent or complete account state during idempotent setup."""
    try:
        group = grp.getgrnam(VERIFY_GROUP)
    except KeyError:
        group = None
    try:
        user = pwd.getpwnam(VERIFY_USER)
    except KeyError:
        user = None
    if group is None and user is None:
        return
    if user is not None:
        runtime_verifier_identity()
        return
    aliases = [entry for entry in grp.getgrall() if entry.gr_gid == group.gr_gid]
    primary = [entry for entry in pwd.getpwall() if entry.pw_gid == group.gr_gid]
    if (group.gr_gid <= 0 or group.gr_mem or primary or len(aliases) != 1
            or aliases[0].gr_name != VERIFY_GROUP):
        raise RuntimeIdentityRejected("runtime verifier group is not uniquely isolated")


__all__ = ["NOLOGIN", "RuntimeIdentityRejected", "VERIFY_GROUP", "VERIFY_USER",
           "runtime_verifier_identity", "validate_runtime_verifier_provisioning"]
