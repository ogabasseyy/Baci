#!/usr/bin/env python3
"""Migrate the event-pipeline and quiz workers to baci-worker system units.

This operation is intentionally separate from identity and broker provisioning.
It removes only the replaced event/quiz cron rows; it never changes worker
secrets, releases, or unrelated schedules.
`migrate` requires a root-owned baci-worker runtime and an available legacy
user manager. The old services are stopped and disabled before the system
services start; any failure attempts to restore their recorded states.
"""

from __future__ import annotations

import argparse
import grp
import hashlib
import importlib.util
import json
import os
import pwd
import stat
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Callable, Sequence

_HELPER_SPEC = importlib.util.spec_from_file_location(
    "event_worker_system_service_helpers", Path(__file__).with_name("event_worker_system_service_helpers.py")
)
assert _HELPER_SPEC and _HELPER_SPEC.loader
_HELPERS = importlib.util.module_from_spec(_HELPER_SPEC)
sys.modules.setdefault(_HELPER_SPEC.name, _HELPERS)
_HELPER_SPEC.loader.exec_module(_HELPERS)
from event_worker_system_service_helpers import (
    WORKER, LEGACY_USER, ROOT, UNIT_DIR, UNIT_SOURCE_DIR, BACKUP_ROOT, SERVICES,
    REVIEWED_UNIT_SHA256, LOCKS, Paths, _drain_worker_locks, _run, _read_crontab,
    _write_crontab, _assert_dir, verify_worker_layout, _unit_contents,
    _legacy_systemctl, snapshot_legacy_services, _safe_backup_root,
    _write_json_atomic, _install_unit_atomically, _restore_legacy,
    LEGACY_CRON_SCHEDULES, remove_legacy_worker_cron_rows,
    _validated_crontab_snapshot, _write_crontab_backup, validate_lock_inodes,
)



def migrate(*, paths: Paths = Paths(), runner: Callable[..., subprocess.CompletedProcess] = subprocess.run,
            verify: Callable[[Path], tuple[int, int]] = verify_worker_layout,
            snapshot: Callable[..., dict[str, dict[str, bool]]] = snapshot_legacy_services,
            read_crontab: Callable[..., str] = _read_crontab,
            write_crontab: Callable[..., None] = _write_crontab,
            drain_locks: Callable[..., None] = _drain_worker_locks,
            root_uid: int = 0, root_gid: int = 0) -> Path:
    if os.geteuid() != 0:
        raise RuntimeError("migration requires root")
    worker_uid, worker_gid = verify(paths.root)
    lock_gid = grp.getgrnam("baci-locks").gr_gid
    lock_inodes = validate_lock_inodes(paths.root, tuple(LOCKS.values()), root_uid=root_uid, lock_gid=lock_gid)
    units = _unit_contents(paths)
    states = snapshot(runner=runner)
    crontab_before = read_crontab(runner=runner)
    crontab_migrated, removed_schedules = remove_legacy_worker_cron_rows(crontab_before)
    paths.unit_dir.mkdir(mode=0o755, parents=True, exist_ok=True)
    unit_dir_info = paths.unit_dir.lstat()
    if (not stat.S_ISDIR(unit_dir_info.st_mode) or stat.S_ISLNK(unit_dir_info.st_mode) or
            unit_dir_info.st_uid != root_uid or stat.S_IMODE(unit_dir_info.st_mode) & 0o022):
        raise RuntimeError("system unit directory is not trusted")
    for name in units:
        target = paths.unit_dir / name
        if target.exists() or target.is_symlink():
            raise RuntimeError(f"system unit already exists; refusing to overwrite: {name}")
    _safe_backup_root(paths.backup_root, root_uid=root_uid)
    backup = paths.backup_root / f"event-units-{time.strftime('%Y%m%dT%H%M%SZ', time.gmtime())}-{os.getpid()}"
    backup.mkdir(mode=0o700)
    before_cron_sha = hashlib.sha256(crontab_before.encode()).hexdigest()
    migrated_cron_sha = hashlib.sha256(crontab_migrated.encode()).hexdigest()
    _write_crontab_backup(backup / "legacy.crontab", crontab_before, root_uid=root_uid, root_gid=root_gid)
    record = {
        "version": 2,
        "worker_uid": pwd.getpwnam(WORKER).pw_uid,
        "worker_gid": grp.getgrnam(WORKER).gr_gid,
        "lock_gid": lock_gid,
        "lock_inodes": {name: {"device": device, "inode": inode} for name, (device, inode) in lock_inodes.items()},
        "legacy_user": LEGACY_USER,
        "legacy_states": states,
        "legacy_crontab_sha256": before_cron_sha,
        "migrated_crontab_sha256": migrated_cron_sha,
        "removed_schedules": removed_schedules,
        "unit_sha256": {name: hashlib.sha256(data).hexdigest() for name, data in units.items()},
    }
    _write_json_atomic(backup / "migration.json", record, root_uid=root_uid, root_gid=root_gid)
    legacy = pwd.getpwnam(LEGACY_USER)
    legacy_base = _legacy_systemctl(LEGACY_USER, legacy.pw_uid)
    installed: list[Path] = []
    systemctl = ("systemctl",)
    legacy_transition_started = False
    cron_transition_started = False
    try:
        for name, data in units.items():
            target = paths.unit_dir / name
            _install_unit_atomically(target, data, root_uid=root_uid, root_gid=root_gid)
            installed.append(target)
        _run((*systemctl, "daemon-reload"), runner=runner)
        if crontab_migrated != crontab_before:
            cron_transition_started = True
            write_crontab(crontab_migrated, runner=runner)
            if read_crontab(runner=runner) != crontab_migrated:
                raise RuntimeError("event/quiz cron cleanup did not verify exactly")
        for service in SERVICES:
            state = states[service]
            if state["active"]:
                legacy_transition_started = True
                _run((*legacy_base, "stop", f"{service}.service"), runner=runner)
            if state["enabled"]:
                legacy_transition_started = True
                _run((*legacy_base, "disable", f"{service}.service"), runner=runner)
        # Stop the user units after removing cron rows, then hold/drain every
        # shared flock once before allowing the system services to start.
        drain_locks(paths.root, lock_gid=lock_gid)
        if validate_lock_inodes(paths.root, tuple(LOCKS.values()), root_uid=root_uid, lock_gid=lock_gid) != lock_inodes:
            raise RuntimeError("protected worker lock inode changed during event/quiz migration")
        for service in SERVICES:
            _run((*systemctl, "enable", "--now", f"{service}.service"), runner=runner)
        for service in SERVICES:
            _run((*systemctl, "is-active", "--quiet", f"{service}.service"), runner=runner)
        if validate_lock_inodes(paths.root, tuple(LOCKS.values()), root_uid=root_uid, lock_gid=lock_gid) != lock_inodes:
            raise RuntimeError("protected worker lock inode changed while system services started")
    except Exception as error:
        system_services_stopped = True
        for service in SERVICES:
            result = _run((*systemctl, "disable", "--now", f"{service}.service"), runner=runner, check=False)
            if result.returncode != 0:
                system_services_stopped = False
        if not system_services_stopped:
            _run((*systemctl, "daemon-reload"), runner=runner, check=False)
            raise RuntimeError("new system worker state is ambiguous; retained unit files and left legacy services and duplicate cron rows disabled") from error
        lock_namespace_restored = False
        try:
            lock_namespace_restored = (
                validate_lock_inodes(paths.root, tuple(LOCKS.values()), root_uid=root_uid, lock_gid=lock_gid) == lock_inodes
            )
        except Exception:
            lock_namespace_restored = False
        cron_restored = not cron_transition_started
        if cron_transition_started and lock_namespace_restored:
            cron_restored = True
            try:
                live_crontab = read_crontab(runner=runner)
                if live_crontab == crontab_migrated:
                    if read_crontab(runner=runner) != crontab_migrated:
                        raise RuntimeError("event/quiz crontab changed before failure rollback")
                    write_crontab(crontab_before, runner=runner)
                    if read_crontab(runner=runner) != crontab_before:
                        raise RuntimeError("restored event/quiz crontab did not verify")
                elif live_crontab != crontab_before:
                    raise RuntimeError("event/quiz crontab changed during migration")
            except Exception:
                cron_restored = False
        for target in installed:
            try:
                if hashlib.sha256(target.read_bytes()).hexdigest() == record["unit_sha256"][target.name]:
                    target.unlink()
            except OSError:
                pass
        _run((*systemctl, "daemon-reload"), runner=runner, check=False)
        if legacy_transition_started and cron_restored and lock_namespace_restored:
            try:
                _restore_legacy(states, legacy_base, runner=runner)
            except Exception as restore_error:
                raise RuntimeError("system units stopped and cron restored, but legacy service restoration is partial; manual reconciliation is required") from restore_error
        if not cron_restored or not lock_namespace_restored:
            raise RuntimeError("new units stopped but cron or protected lock state is uncertain; legacy services remain disabled for reconciliation") from error
        raise
    return backup


def rollback(backup: Path, *, paths: Paths = Paths(), runner: Callable[..., subprocess.CompletedProcess] = subprocess.run,
             root_uid: int = 0,
             snapshot: Callable[..., dict[str, dict[str, bool]]] = snapshot_legacy_services,
             read_crontab: Callable[..., str] = _read_crontab,
             write_crontab: Callable[..., None] = _write_crontab) -> None:
    if os.geteuid() != 0:
        raise RuntimeError("rollback requires root")
    if backup.parent != paths.backup_root or backup.is_symlink():
        raise RuntimeError("rollback snapshot must be a direct child of the fixed backup directory")
    backup_parent = paths.backup_root.lstat()
    unit_dir_info = paths.unit_dir.lstat()
    if (not stat.S_ISDIR(backup_parent.st_mode) or stat.S_ISLNK(backup_parent.st_mode) or
            backup_parent.st_uid != root_uid or stat.S_IMODE(backup_parent.st_mode) != 0o700):
        raise RuntimeError("rollback snapshot parent ownership or mode is unsafe")
    if (not stat.S_ISDIR(unit_dir_info.st_mode) or stat.S_ISLNK(unit_dir_info.st_mode) or
            unit_dir_info.st_uid != root_uid or stat.S_IMODE(unit_dir_info.st_mode) & 0o022):
        raise RuntimeError("system unit directory is not trusted")
    info = backup.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != root_uid or stat.S_IMODE(info.st_mode) != 0o700:
        raise RuntimeError("rollback snapshot ownership or mode is unsafe")
    metadata = (backup / "migration.json").lstat()
    if not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != root_uid or stat.S_IMODE(metadata.st_mode) != 0o600:
        raise RuntimeError("rollback state ownership or mode is unsafe")
    record = json.loads((backup / "migration.json").read_text())
    allowed_units = {f"{service}.service" for service in SERVICES}
    if (not isinstance(record, dict) or record.get("version") != 2 or record.get("legacy_user") != LEGACY_USER or
            not isinstance(record.get("legacy_states"), dict) or set(record["legacy_states"]) != set(SERVICES) or
            not isinstance(record.get("unit_sha256"), dict) or set(record["unit_sha256"]) != allowed_units or
            not isinstance(record.get("legacy_crontab_sha256"), str) or len(record["legacy_crontab_sha256"]) != 64 or
            not isinstance(record.get("migrated_crontab_sha256"), str) or len(record["migrated_crontab_sha256"]) != 64 or
            not isinstance(record.get("removed_schedules"), list) or
            any(name not in LEGACY_CRON_SCHEDULES for name in record["removed_schedules"]) or
            type(record.get("lock_gid")) is not int or record["lock_gid"] != grp.getgrnam("baci-locks").gr_gid or
            not isinstance(record.get("lock_inodes"), dict) or set(record["lock_inodes"]) != set(LOCKS.values())):
        raise RuntimeError("rollback snapshot is invalid")
    recorded_lock_inodes: dict[str, tuple[int, int]] = {}
    for name, identity in record["lock_inodes"].items():
        if (not isinstance(identity, dict) or set(identity) != {"device", "inode"} or
                type(identity["device"]) is not int or type(identity["inode"]) is not int or
                identity["device"] < 0 or identity["inode"] <= 0):
            raise RuntimeError("rollback protected lock identity is invalid")
        recorded_lock_inodes[name] = (identity["device"], identity["inode"])
    live_lock_inodes = validate_lock_inodes(paths.root, tuple(LOCKS.values()), root_uid=root_uid, lock_gid=record["lock_gid"])
    if live_lock_inodes != recorded_lock_inodes:
        raise RuntimeError("protected worker lock inode changed since migration; refusing rollback")
    legacy_crontab = _validated_crontab_snapshot(backup / "legacy.crontab", record["legacy_crontab_sha256"], root_uid=root_uid)
    current_crontab = read_crontab(runner=runner)
    if hashlib.sha256(current_crontab.encode()).hexdigest() != record["migrated_crontab_sha256"]:
        raise RuntimeError("release crontab changed since migration; refusing rollback overwrite")
    for state in record["legacy_states"].values():
        if not isinstance(state, dict) or set(state) != {"active", "enabled"} or any(type(value) is not bool for value in state.values()):
            raise RuntimeError("rollback legacy service state is invalid")
    for name, digest in record["unit_sha256"].items():
        if not isinstance(digest, str) or len(digest) != 64 or any(character not in "0123456789abcdef" for character in digest):
            raise RuntimeError("rollback unit hash is invalid")
        target = paths.unit_dir / name
        if not target.is_file() or target.is_symlink() or hashlib.sha256(target.read_bytes()).hexdigest() != digest:
            raise RuntimeError(f"system unit changed since migration; refusing rollback: {name}")
        unit_info = target.lstat()
        if unit_info.st_uid != root_uid or stat.S_IMODE(unit_info.st_mode) != 0o644:
            raise RuntimeError(f"system unit ownership or mode changed since migration: {name}")
    legacy = pwd.getpwnam(LEGACY_USER)
    legacy_base = _legacy_systemctl(LEGACY_USER, legacy.pw_uid)
    live_states = snapshot(runner=runner)
    if any(state["active"] or state["enabled"] for state in live_states.values()):
        raise RuntimeError("legacy user services are active or enabled; refusing rollback")
    for service in SERVICES:
        _run(("systemctl", "disable", "--now", f"{service}.service"), runner=runner)
    for name in record["unit_sha256"]:
        (paths.unit_dir / name).unlink()
    _run(("systemctl", "daemon-reload"), runner=runner)
    if validate_lock_inodes(paths.root, tuple(LOCKS.values()), root_uid=root_uid, lock_gid=record["lock_gid"]) != recorded_lock_inodes:
        raise RuntimeError("protected worker lock inode changed during rollback; crontab remains migrated")
    if read_crontab(runner=runner) != current_crontab:
        raise RuntimeError("release crontab changed during rollback; refusing overwrite")
    write_crontab(legacy_crontab, runner=runner)
    if read_crontab(runner=runner) != legacy_crontab:
        raise RuntimeError("restored event worker crontab did not verify")
    try:
        _restore_legacy(record["legacy_states"], legacy_base, runner=runner)
    except Exception as error:
        raise RuntimeError("system units stopped and crontab restored, but legacy service restoration is partial; manual reconciliation is required") from error


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="action", required=True)
    subparsers.add_parser("migrate", help="install and activate baci-worker system units")
    rollback_parser = subparsers.add_parser("rollback", help="restore legacy user-service states")
    rollback_parser.add_argument("backup", type=Path)
    args = parser.parse_args(argv)
    try:
        if args.action == "migrate":
            backup = migrate()
            print(f"Event and quiz services migrated; replaced cron rows removed and rollback snapshot saved: {backup}")
        else:
            rollback(args.backup)
            print("System units removed and recorded legacy user-service states restored.")
        return 0
    except (OSError, RuntimeError, KeyError, json.JSONDecodeError, subprocess.CalledProcessError) as error:
        print(f"event worker service migration failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
