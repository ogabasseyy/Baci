"""Read-only identity, runtime, and HTTP preflight checks for cache migration."""
from __future__ import annotations

import json
import os
import pwd
import re
import stat
import urllib.request
from pathlib import Path
from urllib.parse import urlsplit

WORKER = "baci-worker"
ROOT = Path("/srv/baci-workers")
SECRET_RE = re.compile(r"^[A-Za-z0-9_+/=-]{32,}$")
MAX_PREFLIGHT_BODY = 4096


class MigrationError(RuntimeError):
    """A precondition or transaction step failed closed."""


def _parse_runtime_env(path: Path, *, worker_uid: int, worker_gid: int) -> tuple[str, str]:
    try:
        info = path.lstat()
        if (not stat.S_ISREG(info.st_mode) or stat.S_ISLNK(info.st_mode) or
                (info.st_uid, info.st_gid, stat.S_IMODE(info.st_mode)) != (worker_uid, worker_gid, 0o600)):
            raise MigrationError("isolated worker runtime env ownership or mode is unsafe")
        if info.st_size > 128 * 1024:
            raise MigrationError("isolated worker runtime env exceeds the size limit")
        text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeError) as error:
        raise MigrationError("isolated worker runtime env is unavailable") from error
    values: dict[str, str] = {}
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if stripped.startswith("export "):
            raise MigrationError("isolated worker runtime env uses shell syntax incompatible with systemd")
        match = re.fullmatch(r"([A-Za-z_][A-Za-z0-9_]*)=(.*)", stripped)
        if not match:
            continue
        key, value = match.groups()
        if key in {"CRON_SECRET", "BACI_WEB_BASE_URL"}:
            if key in values:
                raise MigrationError("required cache scheduler runtime setting is duplicated")
            value = value.strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                value = value[1:-1]
            values[key] = value
    secret = values.get("CRON_SECRET", "")
    base_url = values.get("BACI_WEB_BASE_URL", "")
    if not SECRET_RE.fullmatch(secret):
        raise MigrationError("cache scheduler CRON_SECRET is missing or malformed")
    parsed = urlsplit(base_url)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise MigrationError("cache scheduler BACI_WEB_BASE_URL must be a credential-free HTTPS origin")
    if parsed.path not in ("", "/"):
        raise MigrationError("cache scheduler BACI_WEB_BASE_URL must be an origin")
    return secret, f"https://{parsed.netloc}"


def _verify_cache_role_preflight(secret: str, base_url: str, *, opener=urllib.request.urlopen) -> None:
    expected_url = f"{base_url}/api/cron/drain-cache-invalidations?preflight=1"
    request = urllib.request.Request(expected_url, headers={"Authorization": f"Bearer {secret}", "Accept": "application/json"}, method="GET")
    try:
        with opener(request, timeout=10) as response:
            if response.status != 200 or response.geturl() != expected_url:
                raise MigrationError("cache worker capability preflight is not ready")
            body = response.read(MAX_PREFLIGHT_BODY + 1)
    except MigrationError:
        raise
    except Exception as error:
        raise MigrationError("cache worker capability preflight could not complete") from error
    if len(body) > MAX_PREFLIGHT_BODY:
        raise MigrationError("cache worker capability preflight returned an invalid response")
    try:
        payload = json.loads(body)
    except (UnicodeError, json.JSONDecodeError) as error:
        raise MigrationError("cache worker capability preflight returned an invalid response") from error
    if payload != {"ready": True}:
        raise MigrationError("cache worker capability preflight is not ready")


def _validate_layout(root: Path = ROOT, *, worker_uid: int | None = None, worker_gid: int | None = None,
                     lock_gid: int | None = None, owner_uid: int = 0) -> tuple[int, int]:
    try:
        account = pwd.getpwnam(WORKER)
    except KeyError as error:
        raise MigrationError("dedicated baci-worker identity is unavailable") from error
    uid = account.pw_uid if worker_uid is None else worker_uid
    gid = account.pw_gid if worker_gid is None else worker_gid
    try:
        expected_lock_gid = grp.getgrnam("baci-locks").gr_gid if lock_gid is None else lock_gid
    except KeyError as error:
        raise MigrationError("dedicated baci-locks group is unavailable") from error
    try:
        if account.pw_gid != gid or account.pw_shell != "/usr/sbin/nologin":
            raise MigrationError("dedicated baci-worker identity is misconfigured")
        if account.pw_name in {"root", "bassey"}:
            raise MigrationError("dedicated baci-worker identity is misconfigured")
        for path, expected in ((root, (owner_uid, expected_lock_gid, 0o710)),
                               (root / "releases", (owner_uid, gid, 0o750)),
                               (root / "locks", (owner_uid, expected_lock_gid, 0o710)),
                               (root / "logs", (uid, gid, 0o750)),
                               (root / "shared", (uid, gid, 0o750)), (root / "home", (uid, gid, 0o700))):
            info = path.lstat()
            if not stat.S_ISDIR(info.st_mode) or stat.S_ISLNK(info.st_mode) or (info.st_uid, info.st_gid, stat.S_IMODE(info.st_mode)) != expected:
                raise MigrationError("isolated worker directory ownership or mode is unsafe")
        current = root / "current"
        pointer = current.lstat()
        target = os.readlink(current)
        match = re.fullmatch(r"releases/([0-9a-f]{40})", target)
        if not stat.S_ISLNK(pointer.st_mode) or pointer.st_uid != owner_uid or match is None:
            raise MigrationError("isolated worker release pointer is unsafe")
        sha = match.group(1)
        release = root / "releases" / sha
        release_info = release.lstat()
        if not stat.S_ISDIR(release_info.st_mode) or stat.S_ISLNK(release_info.st_mode):
            raise MigrationError("isolated worker release target is unsafe")
        if (release_info.st_uid, release_info.st_gid, stat.S_IMODE(release_info.st_mode)) != (owner_uid, gid, 0o550):
            raise MigrationError("isolated worker release ownership or mode is unsafe")
        if not (current / "jobs/run-cache-invalidation-cron.mjs").is_file():
            raise MigrationError("cache HTTP scheduler is missing from the active worker release")
        state_file = root / "shared/cache-invalidations.json"
        if state_file.exists():
            state_info = state_file.lstat()
            if (not stat.S_ISREG(state_info.st_mode) or stat.S_ISLNK(state_info.st_mode) or
                    (state_info.st_uid, state_info.st_gid, stat.S_IMODE(state_info.st_mode)) != (uid, gid, 0o600)):
                raise MigrationError("cache scheduler state file is unsafe")
        lock_file = root / "locks/cache-invalidations.lock"
        if not lock_file.is_file() or lock_file.is_symlink():
            raise MigrationError("isolated cache scheduler lock is missing or unsafe")
        lock_info = lock_file.lstat()
        if (not stat.S_ISREG(lock_info.st_mode) or lock_info.st_nlink != 1 or
                (lock_info.st_uid, lock_info.st_gid, stat.S_IMODE(lock_info.st_mode)) !=
                (owner_uid, expected_lock_gid, 0o660)):
            raise MigrationError("isolated cache scheduler lock ownership or mode is unsafe")
    except OSError as error:
        raise MigrationError("isolated worker layout is unavailable") from error
    return uid, gid
