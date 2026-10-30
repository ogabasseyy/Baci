"""Filesystem and host-service helpers for the event worker migration CLI."""
from __future__ import annotations
import grp, hashlib, json, os, pwd, shutil, stat, subprocess, tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Sequence
from event_worker_cron_migration import (
 LEGACY_CRON_SCHEDULES, MAX_LOCK_DRAIN_SECONDS, remove_legacy_worker_cron_rows,
 validated_crontab_snapshot as _validated_crontab_snapshot,
 write_crontab_backup as _write_crontab_backup, drain_worker_locks, validate_lock_inodes,
)
WORKER = "baci-worker"
LEGACY_USER = "bassey"
ROOT = Path("/srv/baci-workers")
UNIT_DIR = Path("/etc/systemd/system")
UNIT_SOURCE_DIR = Path(__file__).resolve().parents[1] / "systemd"
BACKUP_ROOT = Path("/var/lib/baci-workers/event-unit-migration")
SERVICES = ("baci-domain-event-router", "baci-event-delivery-worker", "baci-quiz-finalization")
REVIEWED_UNIT_SHA256 = {
 "baci-domain-event-router.service": "1305e7134cb22566cf61d2a2dbca2806b294dfd517dee9d1d4d6a6a530f7510e",
 "baci-event-delivery-worker.service": "38b99b94aa3cf7c980d8f0480cb060dc2af73faed1fc6d5b310521273119ae1a",
 "baci-quiz-finalization.service": "f2f4ae4dfabcc5e8d40e798d2fc043925ab2f23cc88ee4f07034be710ed552e3",
}
LOCKS = {"baci-domain-event-router": "process-domain-events.lock", "baci-event-delivery-worker": "process-event-deliveries.lock", "baci-quiz-finalization": "quiz-finalize.lock"}

def _drain_worker_locks(root: Path = ROOT, *, lock_gid: int | None = None,
                        timeout_seconds: int = MAX_LOCK_DRAIN_SECONDS) -> None:
    expected_gid = grp.getgrnam("baci-locks").gr_gid if lock_gid is None else lock_gid
    drain_worker_locks(root, tuple(LOCKS.values()), lock_gid=expected_gid, timeout_seconds=timeout_seconds)

@dataclass(frozen=True)
class Paths:
    root: Path = ROOT
    unit_dir: Path = UNIT_DIR
    backup_root: Path = BACKUP_ROOT
    unit_source_dir: Path = UNIT_SOURCE_DIR

def _run(argv: Sequence[str], *, runner: Callable[..., subprocess.CompletedProcess] = subprocess.run,
         check: bool = True, capture: bool = False) -> subprocess.CompletedProcess:
    result = runner(tuple(argv), check=False, stdin=subprocess.DEVNULL,
                    stdout=subprocess.PIPE if capture else subprocess.DEVNULL,
                    stderr=subprocess.PIPE if capture else subprocess.DEVNULL, text=True)
    if check and result.returncode != 0:
        detail = result.stderr.strip() if capture and result.stderr else "command failed"
        raise RuntimeError(f"{argv[0]} failed: {detail}")
    return result

def _read_crontab(*, runner: Callable[..., subprocess.CompletedProcess] = subprocess.run) -> str:
    result = _run(("/usr/bin/crontab", "-u", LEGACY_USER, "-l"), runner=runner, capture=True)
    return result.stdout or ""

def _write_crontab(text: str, *, runner: Callable[..., subprocess.CompletedProcess] = subprocess.run) -> None:
    descriptor, filename = tempfile.mkstemp(prefix="baci-event-cron-", dir="/run")
    try:
        os.fchmod(descriptor, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="") as output:
            output.write(text)
            output.flush()
            os.fsync(output.fileno())
        _run(("/usr/bin/crontab", "-u", LEGACY_USER, filename), runner=runner)
    finally:
        try:
            os.unlink(filename)
        except FileNotFoundError:
            pass

def _assert_dir(path: Path, *, uid: int, gid: int, mode: int, label: str) -> os.stat_result:
    metadata = path.lstat()
    if (not stat.S_ISDIR(metadata.st_mode) or stat.S_ISLNK(metadata.st_mode) or
            (metadata.st_uid, metadata.st_gid, stat.S_IMODE(metadata.st_mode)) != (uid, gid, mode)):
        raise RuntimeError(f"{label} ownership, mode, or type is unsafe")
    return metadata

def verify_worker_layout(root: Path = ROOT) -> tuple[int, int]:
    account = pwd.getpwnam(WORKER)
    group = grp.getgrnam(WORKER)
    lock_group = grp.getgrnam("baci-locks")
    if account.pw_uid <= 0 or account.pw_gid != group.gr_gid or account.pw_shell != "/usr/sbin/nologin":
        raise RuntimeError("baci-worker identity does not match the isolated account contract")
    if any(entry.pw_uid == account.pw_uid and entry.pw_name != WORKER for entry in pwd.getpwall()):
        raise RuntimeError("baci-worker UID is shared by another account")
    groups = {grp.getgrgid(gid).gr_name for gid in os.getgrouplist(WORKER, account.pw_gid)}
    if groups != {WORKER, "baci-locks"} or groups.intersection({"sudo", "docker"}):
        raise RuntimeError("baci-worker must have only its identity group and protected baci-locks membership")

    ancestor = root
    while ancestor != ancestor.parent:
        metadata = ancestor.lstat()
        if (not stat.S_ISDIR(metadata.st_mode) or stat.S_ISLNK(metadata.st_mode) or
                metadata.st_uid != 0 or stat.S_IMODE(metadata.st_mode) & 0o022):
            raise RuntimeError(f"worker path ancestry is not root-owned and protected: {ancestor}")
        ancestor = ancestor.parent

    for path, uid, gid, mode, label in (
        (root, 0, lock_group.gr_gid, 0o710, "worker root"),
        (root / "releases", 0, group.gr_gid, 0o750, "worker releases"),
        (root / "locks", 0, lock_group.gr_gid, 0o710, "worker locks"),
        (root / "logs", account.pw_uid, group.gr_gid, 0o750, "worker logs"),
    ):
        metadata = _assert_dir(path, uid=uid, gid=gid, mode=mode, label=label)
        if metadata.st_mode & 0o022:
            raise RuntimeError(f"{label} is writable by group or other")

    current = root / "current"
    if not current.is_symlink():
        raise RuntimeError("worker current pointer must be a symlink")
    pointer_info = current.lstat()
    if pointer_info.st_uid != 0 or pointer_info.st_gid != group.gr_gid:
        raise RuntimeError("worker current pointer ownership is unsafe")
    release = current.resolve(strict=True)
    if release.parent != (root / "releases"):
        raise RuntimeError("current worker release must resolve to a direct releases child")
    release_stat = release.lstat()
    if not stat.S_ISDIR(release_stat.st_mode) or release_stat.st_uid != 0 or release_stat.st_gid != group.gr_gid or stat.S_IMODE(release_stat.st_mode) != 0o550:
        raise RuntimeError("current worker release root ownership or mode is unsafe")
    for directory, subdirectories, files in os.walk(release, topdown=True, followlinks=False):
        for name in subdirectories:
            path = Path(directory) / name
            info = path.lstat()
            if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_gid != group.gr_gid or stat.S_IMODE(info.st_mode) != 0o550:
                raise RuntimeError("current worker release contains an unsafe directory")
        for name in files:
            path = Path(directory) / name
            info = path.lstat()
            mode = stat.S_IMODE(info.st_mode)
            if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_gid != group.gr_gid or mode not in (0o440, 0o550):
                raise RuntimeError("current worker release contains an unsafe file")

    runtime_env = root / "runtime/worker.env"
    env_stat = runtime_env.lstat()
    if (not stat.S_ISREG(env_stat.st_mode) or env_stat.st_uid != account.pw_uid or
            env_stat.st_gid != group.gr_gid or stat.S_IMODE(env_stat.st_mode) != 0o600 or env_stat.st_nlink != 1):
        raise RuntimeError("worker runtime environment ownership or mode is unsafe")

    wrappers = (
        "process-domain-events.sh", "process-event-deliveries.sh",
        "process-quiz-finalization.sh", "run-web-script.sh",
    )
    for name in wrappers:
        path = release / "bin" / name
        info = path.lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_gid != group.gr_gid or not info.st_mode & 0o111 or info.st_mode & 0o022:
            raise RuntimeError(f"worker executable is missing or unsafe: {name}")
    return account.pw_uid, group.gr_gid

def _unit_contents(paths: Paths) -> dict[str, bytes]:
    contents: dict[str, bytes] = {}
    for service in SERVICES:
        path = paths.unit_source_dir / f"{service}.service"
        if not path.is_file() or path.is_symlink():
            raise RuntimeError(f"required system unit source is missing: {path.name}")
        data = path.read_bytes()
        if hashlib.sha256(data).hexdigest() != REVIEWED_UNIT_SHA256[path.name]:
            raise RuntimeError(f"system unit source differs from the reviewed fixed unit: {path.name}")
        expected_fields = (
            "User=baci-worker", "Group=baci-worker", "WorkingDirectory=/srv/baci-workers/current",
            "Environment=HOME=/srv/baci-workers/home", "Environment=BACI_REPO_DIR=/srv/baci-workers/current",
            "Environment=BACI_WORKER_ENV=/srv/baci-workers/runtime/worker.env", "ProtectHome=true",
        )
        text = data.decode("utf-8")
        if any(field not in text for field in expected_fields) or "systemctl --user" in text:
            raise RuntimeError(f"system unit source violates worker identity policy: {path.name}")
        contents[f"{service}.service"] = data
    return contents

def _legacy_systemctl(user: str, uid: int) -> list[str]:
    runtime = Path(f"/run/user/{uid}")
    if not runtime.is_dir() or runtime.is_symlink() or not (runtime / "bus").is_socket():
        raise RuntimeError("legacy user systemd manager is unavailable")
    return ["runuser", "-u", user, "--", "env",
            f"XDG_RUNTIME_DIR={runtime}", f"DBUS_SESSION_BUS_ADDRESS=unix:path={runtime / 'bus'}",
            "systemctl", "--user"]

def snapshot_legacy_services(*, runner: Callable[..., subprocess.CompletedProcess] = subprocess.run) -> dict[str, dict[str, bool]]:
    legacy = pwd.getpwnam(LEGACY_USER)
    base = _legacy_systemctl(LEGACY_USER, legacy.pw_uid)
    snapshot: dict[str, dict[str, bool]] = {}
    for service in SERVICES:
        name = f"{service}.service"
        load = _run((*base, "show", name, "-p", "LoadState", "--value"), runner=runner, capture=True).stdout.strip()
        if load != "loaded":
            raise RuntimeError(f"legacy user unit is not loaded: {name}")
        active_state = _run((*base, "show", name, "-p", "ActiveState", "--value"), runner=runner, capture=True).stdout.strip()
        if active_state not in {"active", "inactive", "failed"}:
            raise RuntimeError(f"legacy user unit has transitional state: {name}")
        unit_state = _run((*base, "show", name, "-p", "UnitFileState", "--value"), runner=runner, capture=True).stdout.strip()
        if unit_state not in {"enabled", "disabled", "static", "indirect", "generated", "transient", "masked"}:
            raise RuntimeError(f"legacy user unit has unknown enable state: {name}")
        snapshot[service] = {"active": active_state == "active", "enabled": unit_state == "enabled"}
    return snapshot

def _safe_backup_root(path: Path, *, root_uid: int = 0) -> None:
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    parent = path.parent
    if parent.exists():
        parent_info = parent.lstat()
        if not stat.S_ISDIR(parent_info.st_mode) or stat.S_ISLNK(parent_info.st_mode) or parent_info.st_uid != root_uid or stat.S_IMODE(parent_info.st_mode) & 0o022:
            raise RuntimeError("service migration backup parent is not trusted")
    info = path.lstat()
    if not stat.S_ISDIR(info.st_mode) or stat.S_ISLNK(info.st_mode) or info.st_uid != root_uid or stat.S_IMODE(info.st_mode) != 0o700:
        raise RuntimeError("service migration backup root is not root-owned mode 0700")

def _write_json_atomic(path: Path, value: object, *, root_uid: int = 0, root_gid: int = 0) -> None:
    fd, temporary = tempfile.mkstemp(prefix=".migration-", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(value, handle, sort_keys=True, separators=(",", ":"))
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.chown(temporary, root_uid, root_gid)
        os.chmod(temporary, 0o600)
        os.replace(temporary, path)
    finally:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass

def _install_unit_atomically(target: Path, data: bytes, *, root_uid: int = 0, root_gid: int = 0) -> None:
    fd, temporary = tempfile.mkstemp(prefix=".baci-unit-", dir=target.parent)
    published = False
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.chown(temporary, root_uid, root_gid)
        os.chmod(temporary, 0o644)
        # link() is atomic and refuses to replace a path that appeared after
        # the preflight; the temp link is removed immediately after publication.
        os.link(temporary, target, follow_symlinks=False)
        published = True
        os.unlink(temporary)
        parent_fd = os.open(target.parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
        try:
            os.fsync(parent_fd)
        finally:
            os.close(parent_fd)
    except Exception:
        if published:
            try:
                if target.is_file() and not target.is_symlink() and target.read_bytes() == data:
                    target.unlink()
            except OSError:
                pass
        raise
    finally:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass

def _restore_legacy(snapshot: dict[str, dict[str, bool]], base: Sequence[str], *, runner: Callable[..., subprocess.CompletedProcess]) -> None:
    for service in SERVICES:
        state = snapshot[service]
        unit = f"{service}.service"
        if state["enabled"]:
            _run((*base, "enable", unit), runner=runner)
        else:
            _run((*base, "disable", unit), runner=runner)
        if state["active"]:
            _run((*base, "start", unit), runner=runner)
        else:
            _run((*base, "stop", unit), runner=runner)
