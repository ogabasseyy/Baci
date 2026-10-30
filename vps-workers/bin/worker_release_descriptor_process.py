"""Process-identity checks for the disconnected release-freeze prototype."""
from __future__ import annotations

import os
import subprocess


class ProcessIdentityRejected(RuntimeError):
    """The extractor process was not the expected isolated child."""


def verify_live_child_identity(process: subprocess.Popen[bytes], uid: int, gid: int) -> None:
    """Check kernel-reported credentials, including empty supplementary groups."""
    try:
        with open(f"/proc/{process.pid}/status", encoding="ascii") as stream:
            status = stream.read()
    except OSError as exc:
        raise ProcessIdentityRejected("cannot verify live extractor identity") from exc
    values = {}
    for line in status.splitlines():
        if line.startswith(("Uid:", "Gid:", "Groups:")):
            key, raw = line.split(":", 1)
            values[key] = tuple(int(value) for value in raw.split())
    if (values.get("Uid") != (uid, uid, uid, uid)
            or values.get("Gid") != (gid, gid, gid, gid)
            or values.get("Groups") != ()):
        raise ProcessIdentityRejected("live extractor credentials or supplementary groups are unsafe")


def assert_no_uid_processes(uid: int) -> None:
    """Defense in depth only; this is not process-containment evidence."""
    try:
        pids = [name for name in os.listdir("/proc") if name.isdecimal()]
    except OSError as exc:
        raise ProcessIdentityRejected("cannot verify extractor UID process cleanup") from exc
    for pid in pids:
        try:
            with open(f"/proc/{pid}/status", encoding="ascii") as stream:
                status = stream.read()
        except FileNotFoundError:
            continue
        except OSError as exc:
            raise ProcessIdentityRejected("cannot inspect process table for extractor descendants") from exc
        for line in status.splitlines():
            if line.startswith("Uid:"):
                ids = tuple(int(value) for value in line.split(":", 1)[1].split())
                if uid in ids:
                    raise ProcessIdentityRejected("extractor UID still has a live process")


__all__ = ["ProcessIdentityRejected", "verify_live_child_identity", "assert_no_uid_processes"]
