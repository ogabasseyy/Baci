"""Idempotent, fail-closed account setup for the fixed seed egress bridge."""
from __future__ import annotations

import grp
import os
import pwd
import subprocess
from typing import Callable

from worker_release_egress_identity import EGRESS_GROUP, EGRESS_USER, NOLOGIN, egress_identity


class EgressProvisionRejected(RuntimeError):
    """The egress identity cannot be provisioned without adopting unsafe state."""


Runner = Callable[..., subprocess.CompletedProcess]


def ensure_egress_identity(*, runner: Runner = subprocess.run) -> tuple[int, int]:
    """Create only an absent identity, or resume its exact empty-group prefix."""
    if os.geteuid() != 0:
        raise EgressProvisionRejected("egress identity setup requires root")
    group = _group_state()
    user = _user_state()
    if user is not None and group is None:
        raise EgressProvisionRejected("egress user exists without its dedicated group")
    if group is None:
        runner(("groupadd", "--system", EGRESS_GROUP), check=True,
               stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        group = _group_state()
    _validate_empty_group(group)
    if user is None:
        runner(("useradd", "--system", "--gid", EGRESS_GROUP, "--home-dir", "/nonexistent",
                "--no-create-home", "--shell", NOLOGIN, EGRESS_USER), check=True,
               stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        return egress_identity()
    except Exception as error:
        raise EgressProvisionRejected("egress account did not reach its exact isolated state") from error


def _group_state():
    try:
        return grp.getgrnam(EGRESS_GROUP)
    except KeyError:
        return None


def _user_state():
    try:
        return pwd.getpwnam(EGRESS_USER)
    except KeyError:
        return None


def _validate_empty_group(group) -> None:
    if group is None:
        raise EgressProvisionRejected("egress group creation did not complete")
    aliases = [entry for entry in grp.getgrall() if entry.gr_gid == group.gr_gid]
    primary = [entry for entry in pwd.getpwall() if entry.pw_gid == group.gr_gid]
    if (group.gr_gid <= 0 or group.gr_name != EGRESS_GROUP or group.gr_mem
            or len(aliases) != 1 or aliases[0].gr_name != EGRESS_GROUP
            or any(entry.pw_name != EGRESS_USER for entry in primary)):
        raise EgressProvisionRejected("existing egress group is not an exact isolated prefix")


__all__ = ["EgressProvisionRejected", "ensure_egress_identity"]
