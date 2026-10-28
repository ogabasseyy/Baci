"""Broker-owned, read-only readiness checks for the isolated worker release.

This module returns only the installed SHA and fixed unit names. It never reads
or returns runtime environment values. Paths, units, and the legacy crontab
owner are constants; callers cannot select a host path or service.
"""

from __future__ import annotations

import os
import grp
import json
import re
import stat
import shlex
import subprocess
from pathlib import Path
from typing import Callable, Sequence


WORKER_ROOT = Path("/srv/baci-workers")
LEGACY_USER = "bassey"
SHA_RE = re.compile(r"^[0-9a-f]{40}$")
MAX_COMMAND_OUTPUT = 128 * 1024

# Long-running workers must be active. The two migrated pollers run as
# systemd timers; their oneshot services are validated for identity/config,
# while the timers must be active and enabled.
LONG_RUNNING_UNITS = (
    "baci-domain-event-router.service",
    "baci-event-delivery-worker.service",
    "baci-quiz-finalization.service",
)
TIMER_UNITS = {
    "baci-gigl-tracking.timer": "baci-gigl-tracking.service",
    "baci-cache-invalidation-drain.timer": "baci-cache-invalidation-drain.service",
}
TIMER_SCHEDULES = {
    "baci-gigl-tracking.timer": "*-*-* *:0/5:00",
    "baci-cache-invalidation-drain.timer": "*-*-* *:0/2:00",
}
WORKER_SERVICES = (
    "baci-gigl-tracking.service",
    "baci-cache-invalidation-drain.service",
)
LONG_RUNNING_PROFILES = {
    "baci-domain-event-router.service": ("event-pipeline", "process-domain-events.sh"),
    "baci-event-delivery-worker.service": ("event-pipeline", "process-event-deliveries.sh"),
    "baci-quiz-finalization.service": ("quiz-finalization", "process-quiz-finalization.sh"),
}


class ReadinessRejected(RuntimeError):
    """Readiness is incomplete, ambiguous, or belongs to another SHA."""


def _run(command: Sequence[str], runner: Callable[..., subprocess.CompletedProcess]) -> str:
    try:
        result = runner(tuple(command), stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                        stderr=subprocess.DEVNULL, text=True, check=False, close_fds=True,
                        cwd="/", env={"PATH": "/usr/bin:/bin", "HOME": "/root"}, timeout=10)
    except (OSError, subprocess.TimeoutExpired) as error:
        raise ReadinessRejected("worker readiness probe could not complete") from error
    if result.returncode != 0 or len(result.stdout or "") > MAX_COMMAND_OUTPUT:
        raise ReadinessRejected("worker readiness probe failed closed")
    return result.stdout or ""


def _properties(output: str) -> dict[str, str]:
    result: dict[str, str] = {}
    for line in output.splitlines():
        key, separator, value = line.partition("=")
        if not separator or not key or key in result:
            raise ReadinessRejected("worker unit metadata is ambiguous")
        result[key] = value
    return result


def _show_unit(name: str, runner: Callable[..., subprocess.CompletedProcess]) -> dict[str, str]:
    allowed = LONG_RUNNING_UNITS + tuple(TIMER_UNITS) + WORKER_SERVICES
    if name not in allowed:
        raise ReadinessRejected("worker readiness unit is outside fixed policy")
    output = _run(("/usr/bin/systemctl", "show", "--no-pager", "--property=LoadState,ActiveState,UnitFileState,FragmentPath,User,Group,WorkingDirectory,ExecStart,Environment,EnvironmentFiles,Unit,TimersCalendar", name), runner)
    properties = _properties(output)
    expected_fragment = f"/etc/systemd/system/{name}"
    if properties.get("LoadState") != "loaded" or properties.get("FragmentPath") != expected_fragment:
        raise ReadinessRejected("worker system unit is missing or not the expected installed unit")
    return properties


def _validate_worker_service(name: str, properties: dict[str, str]) -> None:
    if properties.get("User") != "baci-worker" or properties.get("Group") != "baci-worker" or properties.get("WorkingDirectory") != str(WORKER_ROOT / "current"):
        raise ReadinessRejected("worker unit identity or working directory is not isolated")
    environment = properties.get("Environment", "")
    if f"BACI_WORKER_ENV={WORKER_ROOT}/runtime/worker.env" not in environment:
        raise ReadinessRejected("worker unit does not use the fixed isolated runtime environment")
    command = properties.get("ExecStart", "")
    if str(WORKER_ROOT / "current") not in command:
        raise ReadinessRejected("worker unit does not execute from the installed release")
    if name == "baci-gigl-tracking.service" and "GIGL_ENV_FILE_AUTHORITATIVE=1" not in environment:
        raise ReadinessRejected("GIGL worker does not use the authoritative isolated environment")


def _validate_long_running_service(name: str, properties: dict[str, str], root: Path) -> None:
    profile, executable = LONG_RUNNING_PROFILES[name]
    try:
        assignments = shlex.split(properties.get("Environment", ""), posix=True)
    except ValueError as error:
        raise ReadinessRejected("worker service environment is ambiguous") from error
    environment: dict[str, str] = {}
    for assignment in assignments:
        key, separator, value = assignment.partition("=")
        if not separator or not key or key in environment:
            raise ReadinessRejected("worker service environment is ambiguous")
        environment[key] = value
    expected_environment = {
        "HOME": str(root / "home"),
        "NODE_ENV": "production",
        "BACI_WORKER_PROFILE": profile,
        "BACI_REPO_DIR": str(root / "current"),
        "BACI_WORKER_ENV": str(root / "runtime/worker.env"),
    }
    if any(environment.get(key) != value for key, value in expected_environment.items()):
        raise ReadinessRejected("required baci-worker service runtime environment or profile is misconfigured")
    if properties.get("EnvironmentFiles", ""):
        raise ReadinessRejected("required baci-worker service unexpectedly loads an ambient environment file")
    command = properties.get("ExecStart", "")
    if f"{root}/current/bin/{executable}" not in command:
        raise ReadinessRejected("required baci-worker service command does not match its fixed worker profile")


def collect_worker_readiness(
    expected_sha: str,
    *,
    runner: Callable[..., subprocess.CompletedProcess] = subprocess.run,
    root: Path = WORKER_ROOT,
    owner_uid: int = 0,
    worker_gid: int | None = None,
    lock_gid: int | None = None,
) -> dict[str, object]:
    """Require one exact healthy release, all fixed units, and no legacy poller cron."""
    if not SHA_RE.fullmatch(expected_sha or ""):
        raise ReadinessRejected("expected worker release SHA is invalid")
    try:
        expected_gid = grp.getgrnam("baci-worker").gr_gid if worker_gid is None else worker_gid
        expected_lock_gid = grp.getgrnam("baci-locks").gr_gid if lock_gid is None else lock_gid
    except KeyError as error:
        raise ReadinessRejected("dedicated worker group is unavailable") from error
    try:
        root_info = root.lstat()
        releases_root = root / "releases"
        releases_info = releases_root.lstat()
        current = root / "current"
        pointer_info = current.lstat()
        target = os.readlink(current)
        if (not stat.S_ISDIR(root_info.st_mode) or stat.S_ISLNK(root_info.st_mode) or (root_info.st_uid, root_info.st_gid, stat.S_IMODE(root_info.st_mode)) != (owner_uid, expected_lock_gid, 0o710) or
                not stat.S_ISDIR(releases_info.st_mode) or stat.S_ISLNK(releases_info.st_mode) or
                (releases_info.st_uid, releases_info.st_gid, stat.S_IMODE(releases_info.st_mode)) != (owner_uid, expected_gid, 0o750) or
                not stat.S_ISLNK(pointer_info.st_mode) or pointer_info.st_uid != owner_uid or
                target != expected_sha):
            raise ReadinessRejected("isolated worker root or current release pointer is invalid")
        release = releases_root / target
        release_info = release.lstat()
        if (not stat.S_ISDIR(release_info.st_mode) or stat.S_ISLNK(release_info.st_mode) or
                (release_info.st_uid, release_info.st_gid, stat.S_IMODE(release_info.st_mode)) != (owner_uid, expected_gid, 0o550)):
            raise ReadinessRejected("installed worker release ownership or mode is invalid")
        state_path = root / "release-state.json"
        state_fd = os.open(state_path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
        try:
            state_info = os.fstat(state_fd)
            if not stat.S_ISREG(state_info.st_mode) or state_info.st_uid != owner_uid or stat.S_IMODE(state_info.st_mode) != 0o600:
                raise ReadinessRejected("worker release state ownership or mode is invalid")
            raw_state = os.read(state_fd, 16_385)
        finally:
            os.close(state_fd)
        if len(raw_state) > 16_384:
            raise ReadinessRejected("worker release state exceeds size limit")
        state = json.loads(raw_state)
        if not isinstance(state, dict) or state.get("version") != 1 or state.get("status") != "healthy" or state.get("sha") != expected_sha:
            raise ReadinessRejected("worker release state does not prove healthy exact-SHA installation")
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise ReadinessRejected("isolated worker release metadata is unavailable") from error

    active_units: list[str] = []
    for unit in LONG_RUNNING_UNITS:
        properties = _show_unit(unit, runner)
        if properties.get("ActiveState") != "active" or properties.get("User") != "baci-worker" or properties.get("Group") != "baci-worker" or properties.get("WorkingDirectory") != str(root / "current"):
            raise ReadinessRejected("required baci-worker service is inactive or misconfigured")
        if str(root / "current") not in properties.get("ExecStart", ""):
            raise ReadinessRejected("required baci-worker service is not bound to the installed release")
        _validate_long_running_service(unit, properties, root)
        active_units.append(unit)

    for timer, service in TIMER_UNITS.items():
        timer_properties = _show_unit(timer, runner)
        if (timer_properties.get("ActiveState") != "active" or timer_properties.get("UnitFileState") != "enabled" or
                timer_properties.get("Unit") != service or timer_properties.get("TimersCalendar") != TIMER_SCHEDULES[timer]):
            raise ReadinessRejected("required baci-worker timer is inactive or misconfigured")
        service_properties = _show_unit(service, runner)
        _validate_worker_service(service, service_properties)
        active_units.extend((service, timer))

    # Root's broker can read the old user's crontab without granting the
    # release identity access to it. Any legacy GIGL/cache poller is mixed
    # execution state and therefore blocks the systemd readiness receipt.
    crontab = _run(("/usr/bin/crontab", "-u", LEGACY_USER, "-l"), runner)
    legacy_markers = (
        "process-gigl-tracking.sh",
        "run-cache-invalidation-cron.mjs",
        # These workers now run as baci-worker system services. Their legacy
        # per-minute cron rows must be removed as part of cutover; otherwise a
        # healthy system unit can conceal a second execution path.
        "process-domain-events.sh",
        "process-event-deliveries.sh",
        "process-quiz-finalization.sh",
        "/api/quiz/finalize",
    )
    if any(marker in line and not line.lstrip().startswith("#") for line in crontab.splitlines() for marker in legacy_markers):
        raise ReadinessRejected("legacy worker poller or event/quiz schedule remains active")

    return {"ready": True, "installedSha": expected_sha, "units": active_units}
