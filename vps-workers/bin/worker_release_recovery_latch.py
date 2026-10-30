"""Durable root-owned launch gate for worker release recovery."""
from __future__ import annotations

import json
import os
import re
import sys
import socket
import stat
import tempfile
from pathlib import Path
from typing import Any

WORKER_ROOT = Path("/srv/baci-workers")
LOCKS_DIR = WORKER_ROOT / "locks"
LATCH_PATH = LOCKS_DIR / "release-recovery-latch.json"
STATE_PATH = WORKER_ROOT / "release-state.json"
GATE_SOCKET_PATH = Path("/run/baci-worker-release-gate/health.sock")
SERVICES = (
    "baci-domain-event-router",
    "baci-event-delivery-worker",
    "baci-quiz-finalization",
)
PHASES = {"quiescing", "health_probe", "restore", "recovery_required"}
ID_RE = re.compile(r"^[1-9][0-9]{0,19}$")
SHA_RE = re.compile(r"^[0-9a-f]{40}$")


class LatchError(RuntimeError):
    """The worker recovery latch is unsafe or inconsistent."""


def _read_json(path: Path, *, uid: int, gid: int, mode: int) -> dict[str, Any] | None:
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    except FileNotFoundError:
        return None
    except OSError:
        raise LatchError("worker recovery metadata cannot be opened") from None
    try:
        info = os.fstat(fd)
        if (not stat.S_ISREG(info.st_mode) or info.st_uid != uid or info.st_gid != gid
                or stat.S_IMODE(info.st_mode) != mode or info.st_nlink != 1):
            raise LatchError("worker recovery metadata is untrusted")
        raw = os.read(fd, 16_385)
        if len(raw) > 16_384:
            raise LatchError("worker recovery metadata exceeds limit")
    finally:
        os.close(fd)
    try:
        value = json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise LatchError("worker recovery metadata is malformed") from None
    if not isinstance(value, dict):
        raise LatchError("worker recovery metadata is malformed")
    return value


def _validate_latch(value: dict[str, Any]) -> dict[str, Any]:
    fence = value.get("fence")
    services = value.get("services_to_restore")
    intents = value.get("stop_intent")
    previous = value.get("previous_sha")
    job_id = value.get("job_id")
    recovered_job_id = value.get("recovered_from_job_id")
    release_sha = value.get("release_sha", fence.get("sha") if isinstance(fence, dict) else None)
    recovered_from = value.get("recovered_from")
    snapshot_complete = value.get("service_snapshot_complete", False)
    if (value.get("version") != 1 or value.get("phase") not in PHASES
            or not isinstance(fence, dict)
            or not ID_RE.fullmatch(str(fence.get("run_id", "")))
            or not ID_RE.fullmatch(str(fence.get("run_attempt", "")))
            or not SHA_RE.fullmatch(str(fence.get("sha", "")))
            or not SHA_RE.fullmatch(str(release_sha or ""))
            or (job_id is not None and not ID_RE.fullmatch(str(job_id)))
            or (recovered_job_id is not None and not ID_RE.fullmatch(str(recovered_job_id)))
            or (recovered_from is not None and (not isinstance(recovered_from, dict)
                or not ID_RE.fullmatch(str(recovered_from.get("run_id", "")))
                or not ID_RE.fullmatch(str(recovered_from.get("run_attempt", "")))
                or not SHA_RE.fullmatch(str(recovered_from.get("sha", "")))))
            or (previous is not None and not SHA_RE.fullmatch(str(previous)))
            or not isinstance(services, list) or not isinstance(intents, list)
            or not isinstance(snapshot_complete, bool)
            or any(not isinstance(item, str) for item in services + intents)
            or len(services) != len(set(services))
            or any(item not in SERVICES for item in services + intents)):
        raise LatchError("worker recovery latch contract is invalid")
    if snapshot_complete and set(services) != set(SERVICES):
        raise LatchError("worker recovery service snapshot is incomplete")
    value.setdefault("release_sha", release_sha)
    value.setdefault("service_snapshot_complete", snapshot_complete)
    return value


def _metadata(path: Path, *, uid: int, gid: int, mode: int) -> None:
    try:
        info = path.lstat()
    except OSError:
        raise LatchError("worker recovery directory is unavailable") from None
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != uid or info.st_gid != gid or stat.S_IMODE(info.st_mode) != mode:
        raise LatchError("worker recovery directory is untrusted")


def load_latch(path: Path = LATCH_PATH, *, uid: int = 0, gid: int | None = None) -> dict[str, Any] | None:
    path = Path(path)
    if gid is None:
        import grp
        gid = grp.getgrnam("baci-locks").gr_gid
    _metadata(path.parent, uid=uid, gid=gid, mode=0o710)
    value = _read_json(path, uid=uid, gid=gid, mode=0o640)
    return _validate_latch(value) if value is not None else None


def _write_latch(value: dict[str, Any], path: Path, *, uid: int, gid: int) -> None:
    _metadata(path.parent, uid=uid, gid=gid, mode=0o710)
    payload = json.dumps(_validate_latch(value), sort_keys=True, separators=(",", ":")).encode()
    fd, temporary = tempfile.mkstemp(prefix=".release-latch.", dir=path.parent)
    try:
        os.fchown(fd, uid, gid)
        os.fchmod(fd, 0o640)
        with os.fdopen(fd, "wb", closefd=False) as stream:
            stream.write(payload)
            stream.flush()
            os.fsync(fd)
        os.replace(temporary, path)
        directory_fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    finally:
        try:
            os.close(fd)
        except OSError:
            pass
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass


def create_latch(fence: dict[str, Any], previous_sha: str | None, *, path: Path = LATCH_PATH,
                 recovery: bool = False, takeover_from: dict[str, Any] | None = None,
                 job_id: str | None = None, active_services: list[str] | None = None,
                 uid: int = 0, gid: int | None = None) -> dict[str, Any]:
    path = Path(path)
    if gid is None:
        import grp
        gid = grp.getgrnam("baci-locks").gr_gid
    existing = load_latch(path, uid=uid, gid=gid)
    if existing is not None:
        if not recovery:
            raise LatchError("unresolved worker recovery latch blocks release")
        if not existing.get("service_snapshot_complete"):
            raise LatchError("worker recovery service snapshot is incomplete")
        if takeover_from is not None:
            if existing["fence"] != takeover_from or existing["previous_sha"] != previous_sha:
                raise LatchError("worker recovery takeover does not match the recorded release owner")
            # Preserve the first crashed promotion as the recovery target across
            # any number of terminal coordinator retries. The current fence is
            # only the latest recovery owner, and its SHA may differ.
            if existing.get("recovered_from") is None:
                existing["recovered_from"] = existing["fence"]
                existing["recovered_from_job_id"] = existing.get("job_id")
            existing["fence"] = fence
            existing["job_id"] = job_id
        elif existing["fence"] != fence:
            raise LatchError("unresolved worker recovery latch belongs to another release")
        existing["phase"] = "recovery_required"
        _write_latch(existing, path, uid=uid, gid=gid)
        return existing
    if (not isinstance(active_services, list) or any(not isinstance(item, str) for item in active_services)
            or len(active_services) != len(SERVICES)
            or set(active_services) != set(SERVICES) or len(set(active_services)) != len(active_services)):
        raise LatchError("complete active worker service snapshot is required")
    value = {"version": 1, "phase": "quiescing", "fence": fence,
             "previous_sha": previous_sha, "release_sha": fence["sha"],
             "job_id": job_id,
             "services_to_restore": list(active_services), "stop_intent": [],
             "service_snapshot_complete": True}
    _write_latch(value, path, uid=uid, gid=gid)
    return value


def update_latch(*, path: Path = LATCH_PATH, phase: str | None = None,
                 stop_intent: str | None = None, service_active: str | None = None,
                 fence: dict[str, Any] | None = None, uid: int = 0, gid: int | None = None) -> dict[str, Any]:
    path = Path(path)
    if gid is None:
        import grp
        gid = grp.getgrnam("baci-locks").gr_gid
    value = load_latch(path, uid=uid, gid=gid)
    if value is None or (fence is not None and value["fence"] != fence):
        raise LatchError("worker recovery latch is missing or belongs to another release")
    if phase is not None:
        if phase not in PHASES:
            raise LatchError("worker recovery phase is invalid")
        value["phase"] = phase
    if stop_intent is not None:
        if stop_intent not in SERVICES:
            raise LatchError("worker service identity is invalid")
        if stop_intent not in value["stop_intent"]:
            value["stop_intent"].append(stop_intent)
    if service_active is not None:
        if service_active not in SERVICES:
            raise LatchError("worker service identity is invalid")
        if service_active not in value["services_to_restore"]:
            value["services_to_restore"].append(service_active)
    _write_latch(value, path, uid=uid, gid=gid)
    return value


def clear_latch(*, path: Path = LATCH_PATH, fence: dict[str, Any], state_path: Path = STATE_PATH,
                uid: int = 0, gid: int | None = None, state_gid: int = 0) -> None:
    path, state_path = Path(path), Path(state_path)
    if gid is None:
        import grp
        gid = grp.getgrnam("baci-locks").gr_gid
    latch = load_latch(path, uid=uid, gid=gid)
    state = _read_json(state_path, uid=uid, gid=state_gid, mode=0o600)
    state_fence = state.get("fence") if state else None
    if (latch is None or latch["fence"] != fence or state is None or not isinstance(state_fence, dict)
            or state.get("sha") != latch.get("release_sha")
            or state.get("previous_sha") != latch.get("previous_sha")
            or any(state_fence.get(key) != fence.get(key) for key in ("run_id", "run_attempt", "sha"))
            or (latch.get("job_id") is not None and state_fence.get("job_id") != latch["job_id"])):
        raise LatchError("worker recovery cannot be confirmed")
    if state.get("status") not in ("healthy", "rolled_back"):
        raise LatchError("worker release is not safe to resume")
    path.unlink()
    directory_fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(directory_fd)
    finally:
        os.close(directory_fd)


def service_allowed(service: str, *, path: Path = LATCH_PATH, socket_path: Path = GATE_SOCKET_PATH,
                    uid: int = 0, gid: int | None = None) -> bool:
    path, socket_path = Path(path), Path(socket_path)
    latch = load_latch(path, uid=uid, gid=gid)
    if latch is None:
        return True
    if service not in SERVICES:
        return False
    try:
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
            client.settimeout(1)
            client.connect(str(socket_path))
            client.sendall((service + "\n").encode("ascii"))
            return client.recv(16) == b"ALLOW\n"
    except OSError:
        return False


def cli(argv: list[str]) -> int:
    if not argv:
        return 64
    if argv[0] == "services":
        latch = load_latch()
        if latch is None or not latch.get("service_snapshot_complete"):
            return 1
        sys.stdout.write("".join(f"{service}\n" for service in latch["services_to_restore"]))
        return 0
    if argv[0] == "intent" and len(argv) == 2:
        # Record restore membership before the helper stops the unit. This is
        # also the recovery snapshot if the supervisor dies during quiescing.
        update_latch(service_active=argv[1], stop_intent=argv[1])
        return 0
    if argv[0] == "phase" and len(argv) == 2:
        update_latch(phase=argv[1])
        return 0
    if argv[0] == "recovery":
        update_latch(phase="recovery_required")
        return 0
    if argv[0] == "clear" and len(argv) == 1:
        latch = load_latch()
        if latch is None:
            return 0
        clear_latch(fence=latch["fence"])
        return 0
    return 64


__all__ = ["LATCH_PATH", "LatchError", "SERVICES", "clear_latch", "create_latch", "load_latch", "service_allowed", "update_latch"]


if __name__ == "__main__":
    try:
        raise SystemExit(cli(sys.argv[1:]))
    except LatchError:
        raise SystemExit(1)
