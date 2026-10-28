#!/usr/bin/env python3
"""Provision the isolated baci-worker OS identity and empty runtime layout.

Dry-run is the default. This intentionally does not install/enable services,
modify cron, create secrets, or migrate any existing worker data. The GIGL
service/cron transition is handled separately by
``migrate-gigl-tracking-system-service.sh`` after its preflight succeeds.
"""

from __future__ import annotations

import argparse
import os
import pwd
import grp
import shlex
import stat
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Sequence


WORKER = "baci-worker"
LOCK_GROUP = "baci-locks"
DEFAULT_ROOT = "/srv/baci-workers"
NOLOGIN = "/usr/sbin/nologin"
CACHE_LOCK = "cache-invalidations.lock"


@dataclass(frozen=True)
class Action:
    argv: tuple[str, ...]

    def display(self) -> str:
        if self.argv[0] == "ensure-lock":
            return (f"ensure regular lock file root:{LOCK_GROUP} 0660 {self.argv[1]} "
                    "(create only if absent; reject unsafe existing inode)")
        return shlex.join(self.argv)


def provisioning_plan(root: str = DEFAULT_ROOT) -> tuple[Action, ...]:
    """Return fixed, shell-free setup operations for a dedicated worker."""
    root_path = Path(root)
    if not root_path.is_absolute() or root_path == Path("/"):
        raise ValueError("worker root must be an absolute non-root path")
    # Refuse whitespace/newline paths: systemd and downstream shell wrappers
    # consume these paths, and this provisioner deliberately keeps one fixed layout.
    if any(character.isspace() for character in str(root_path)):
        raise ValueError("worker root may not contain whitespace")

    dirs = (
        (root_path, "root", LOCK_GROUP, "0710"),
        (root_path / "releases", "root", WORKER, "0750"),
        (root_path / "shared", WORKER, WORKER, "0750"),
        # The release and worker identities traverse this root-owned namespace
        # through baci-locks; neither can create, unlink, or replace pathnames.
        (root_path / "locks", "root", LOCK_GROUP, "0710"),
        (root_path / "logs", WORKER, WORKER, "0750"),
        (root_path / "runtime", WORKER, WORKER, "0700"),
        (root_path / "home", WORKER, WORKER, "0700"),
    )
    actions: list[Action] = [
        Action(("groupadd", "--system", WORKER)),
        Action(("groupadd", "--system", LOCK_GROUP)),
        Action(("useradd", "--system", "--gid", WORKER, "--home-dir", str(root_path / "home"),
                "--no-create-home", "--shell", NOLOGIN, WORKER)),
        Action(("usermod", "--append", "--groups", LOCK_GROUP, WORKER)),
        Action(("usermod", "--append", "--groups", LOCK_GROUP, "bassey")),
    ]
    actions.extend(
        Action(("install", "-d", "-o", owner, "-g", group, "-m", mode, str(path)))
        for path, owner, group, mode in dirs
    )
    # This lock is opened by a baci-worker systemd service. Use the special
    # idempotent action below so re-running provisioning never replaces an
    # inode that may currently be held by flock.
    actions.append(Action(("ensure-lock", str(root_path / "locks" / CACHE_LOCK))))
    return tuple(actions)


def ensure_cache_lock_file(
    root: str,
    *,
    owner_uid: int = 0,
    worker_gid: int,
) -> None:
    """Create the fixed cache flock inode once, or verify it without replacing it."""
    path = Path(root) / "locks" / CACHE_LOCK
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    flags |= getattr(os, "O_NOFOLLOW", 0)
    try:
        descriptor = os.open(path, flags, 0o660)
    except FileExistsError:
        metadata = path.lstat()
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_nlink != 1:
            raise RuntimeError("existing cache worker lock is not a private regular inode")
        if (metadata.st_uid, metadata.st_gid, stat.S_IMODE(metadata.st_mode)) != (
            owner_uid, worker_gid, 0o660
        ):
            raise RuntimeError("existing cache worker lock has unexpected ownership or mode")
        return

    try:
        os.fchown(descriptor, owner_uid, worker_gid)
        os.fchmod(descriptor, 0o660)
        metadata = os.fstat(descriptor)
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_nlink != 1 or (
            metadata.st_uid, metadata.st_gid, stat.S_IMODE(metadata.st_mode)
        ) != (owner_uid, worker_gid, 0o660):
            raise RuntimeError("new cache worker lock did not match the protected inode contract")
    except BaseException:
        os.close(descriptor)
        try:
            path.unlink()
        except OSError:
            pass
        raise
    else:
        os.close(descriptor)


def _identity_preflight(root: str = DEFAULT_ROOT) -> None:
    """Reject conflicting pre-existing identities; never repair them silently."""
    try:
        group = grp.getgrnam(WORKER)
    except KeyError:
        group = None
    try:
        user = pwd.getpwnam(WORKER)
    except KeyError:
        user = None
    try:
        lock_group = grp.getgrnam(LOCK_GROUP)
    except KeyError:
        lock_group = None

    if lock_group is not None and set(lock_group.gr_mem) - {"bassey", WORKER}:
        raise RuntimeError("baci-locks group has unexpected members")

    if group is not None:
        primary_members = sorted(entry.pw_name for entry in pwd.getpwall() if entry.pw_gid == group.gr_gid)
        expected_primary_members = [WORKER] if user is not None else []
        if primary_members != expected_primary_members:
            raise RuntimeError("existing baci-worker group has unexpected primary members")
        if group.gr_mem:
            raise RuntimeError("existing baci-worker group has unexpected members")
    if user is not None and group is None:
        raise RuntimeError("baci-worker user exists without its dedicated primary group")
    if user is not None:
        uid_names = sorted(entry.pw_name for entry in pwd.getpwall() if entry.pw_uid == user.pw_uid)
        if uid_names != [WORKER]:
            raise RuntimeError("baci-worker UID is shared by another passwd entry")
        if user.pw_gid != group.gr_gid or user.pw_shell != NOLOGIN:
            raise RuntimeError("existing baci-worker identity does not match the isolated account contract")
        if user.pw_dir != str(Path(root) / "home"):
            raise RuntimeError("existing baci-worker home path is unexpected")
        groups = {grp.getgrgid(gid).gr_name for gid in os.getgrouplist(user.pw_name, user.pw_gid)}
        if groups not in ({WORKER}, {WORKER, LOCK_GROUP}):
            raise RuntimeError("existing baci-worker has unexpected supplementary groups")


def _reject_symlinked_path(root: str) -> None:
    current = Path(root)
    while current != current.parent:
        if current.is_symlink():
            raise RuntimeError(f"worker path contains a symlink: {current}")
        current = current.parent


def _directory_preflight(root: str = DEFAULT_ROOT) -> None:
    """Refuse existing layout paths whose ownership or mode install -d would change."""
    layout_paths = (
        Path(root), Path(root) / "releases", Path(root) / "shared",
        Path(root) / "locks", Path(root) / "logs", Path(root) / "runtime",
        Path(root) / "home",
    )
    try:
        worker_uid = pwd.getpwnam(WORKER).pw_uid
        worker_gid = grp.getgrnam(WORKER).gr_gid
        lock_gid = grp.getgrnam(LOCK_GROUP).gr_gid
    except KeyError:
        existing = next((path for path in layout_paths if path.exists() or path.is_symlink()), None)
        if existing is not None:
            raise RuntimeError(f"worker layout exists without the complete baci-worker identity: {existing}")
        if any(path.exists() or path.is_symlink() for path in layout_paths):
            raise RuntimeError("existing worker layout requires the dedicated baci-locks group")
        return
    expectations = (
        (Path(root), 0, lock_gid, 0o710),
        (Path(root) / "releases", 0, worker_gid, 0o750),
        (Path(root) / "shared", worker_uid, worker_gid, 0o750),
        (Path(root) / "locks", 0, lock_gid, 0o710),
        (Path(root) / "logs", worker_uid, worker_gid, 0o750),
        (Path(root) / "runtime", worker_uid, worker_gid, 0o700),
        (Path(root) / "home", worker_uid, worker_gid, 0o700),
    )
    for path, uid, gid, mode in expectations:
        try:
            metadata = path.lstat()
        except FileNotFoundError:
            continue
        if not stat.S_ISDIR(metadata.st_mode):
            raise RuntimeError(f"existing worker path is not a directory: {path}")
        if (metadata.st_uid, metadata.st_gid, stat.S_IMODE(metadata.st_mode)) != (uid, gid, mode):
            raise RuntimeError(f"existing worker directory has unexpected ownership or mode: {path}")


def apply_plan(
    actions: Sequence[Action],
    *,
    runner: Callable[..., subprocess.CompletedProcess] = subprocess.run,
    identity_check: Callable[[], None] = _identity_preflight,
    lock_provisioner: Callable[..., None] = ensure_cache_lock_file,
) -> None:
    """Apply an idempotent plan, skipping already-created identity objects."""
    identity_check()
    group_exists = _has_group(WORKER)
    user_exists = _has_user(WORKER)
    for action in actions:
        if action.argv[0] == "ensure-lock":
            lock_provisioner(
                str(Path(action.argv[1]).parents[1]),
                owner_uid=0,
                worker_gid=grp.getgrnam(LOCK_GROUP).gr_gid,
            )
            continue
        if action.argv[0] == "groupadd" and _has_group(action.argv[-1]):
            continue
        if action.argv[0] == "useradd" and user_exists:
            continue
        runner(action.argv, check=True, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL)


def _has_group(name: str) -> bool:
    try:
        grp.getgrnam(name)
        return True
    except KeyError:
        return False


def _has_user(name: str) -> bool:
    try:
        pwd.getpwnam(name)
        return True
    except KeyError:
        return False


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", default=DEFAULT_ROOT, help="worker root (default: %(default)s)")
    parser.add_argument("--apply", action="store_true", help="apply the plan; default only prints it")
    args = parser.parse_args(argv)
    try:
        plan = provisioning_plan(args.root)
        if not args.apply:
            for action in plan:
                print(action.display())
            print("Dry run only. Pass --apply to provision the identity and directories.")
            return 0
        if os.geteuid() != 0:
            raise RuntimeError("--apply requires root")
        if args.root != DEFAULT_ROOT:
            raise RuntimeError("--apply is restricted to the fixed /srv/baci-workers root")
        _reject_symlinked_path(args.root)
        _directory_preflight(args.root)
        apply_plan(plan, identity_check=lambda: _identity_preflight(args.root))
        print("baci-worker identity and empty directory layout provisioned.")
        print("No services, cron entries, runtime secrets, or worker checkouts were changed.")
        return 0
    except (OSError, RuntimeError, ValueError, subprocess.CalledProcessError) as error:
        print(f"baci-worker provisioning failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
