"""Fixed isolated identity contract for the worker seed egress bridge."""
from __future__ import annotations

import grp
import os
import pwd

EGRESS_USER = "baci-worker-egress-bridge"
EGRESS_GROUP = EGRESS_USER
NOLOGIN = "/usr/sbin/nologin"


class EgressIdentityRejected(RuntimeError):
    """The seed egress bridge identity is absent or not isolated."""


def egress_identity() -> tuple[int, int]:
    try:
        user = pwd.getpwnam(EGRESS_USER)
        group = grp.getgrnam(EGRESS_GROUP)
        group_aliases = [entry for entry in grp.getgrall() if entry.gr_gid == group.gr_gid]
        primary_aliases = [entry for entry in pwd.getpwall() if entry.pw_gid == group.gr_gid]
        uid_aliases = [entry for entry in pwd.getpwall() if entry.pw_uid == user.pw_uid]
        memberships = os.getgrouplist(EGRESS_USER, user.pw_gid)
    except (KeyError, OSError) as error:
        raise EgressIdentityRejected("dedicated egress bridge identity is unavailable") from error
    if (user.pw_uid <= 0 or group.gr_gid <= 0 or user.pw_gid != group.gr_gid
            or user.pw_dir != "/nonexistent" or user.pw_shell != NOLOGIN
            or group.gr_mem or memberships != [group.gr_gid]
            or len(group_aliases) != 1 or group_aliases[0].gr_name != EGRESS_GROUP
            or sorted(row.pw_name for row in primary_aliases) != [EGRESS_USER]
            or sorted(row.pw_name for row in uid_aliases) != [EGRESS_USER]
            or memberships == []):
        raise EgressIdentityRejected("dedicated egress bridge identity is not exclusive")
    return user.pw_uid, group.gr_gid


__all__ = ["EGRESS_GROUP", "EGRESS_USER", "EgressIdentityRejected", "NOLOGIN",
           "egress_identity"]
