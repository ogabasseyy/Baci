"""Durable release pointer and promotion state validation."""
import worker_release_broker as broker
import json, os, re, stat, tempfile
from typing import Any

def _read_current_sha(current_link: str, releases_root: str) -> str | None:
    try:
        target = broker.os.readlink(current_link)
    except FileNotFoundError:
        return None
    match = broker.re.fullmatch(r"releases/([0-9a-f]{40})", target)
    if match is None:
        raise broker.BrokerProtocolError("current release pointer is invalid")
    sha = match.group(1)
    release = broker.os.path.join(releases_root, sha)
    metadata = broker.os.lstat(release)
    if not broker.stat.S_ISDIR(metadata.st_mode) or metadata.st_uid != 0:
        raise broker.BrokerProtocolError("current release target ownership is invalid")
    return sha


def _load_release_state(path: str) -> dict[str, Any] | None:
    try:
        fd = broker.os.open(path, broker.os.O_RDONLY | getattr(broker.os, "O_NOFOLLOW", 0))
    except FileNotFoundError:
        return None
    try:
        metadata = broker.os.fstat(fd)
        if not broker.stat.S_ISREG(metadata.st_mode) or metadata.st_uid != 0 or broker.stat.S_IMODE(metadata.st_mode) != 0o600:
            raise broker.BrokerProtocolError("release state ownership or mode is invalid")
        raw = broker.os.read(fd, 16_385)
        if len(raw) > 16_384:
            raise broker.BrokerProtocolError("release state exceeds size limit")
    finally:
        broker.os.close(fd)
    try:
        state = broker.json.loads(raw)
    except (UnicodeDecodeError, broker.json.JSONDecodeError):
        raise broker.BrokerProtocolError("release state is malformed") from None
    if not isinstance(state, dict) or state.get("version") != 1 or state.get("status") not in (
        "promoting", "promoted", "healthy", "rollback_required", "recovery_required", "rolled_back",
    ) or not broker.re.fullmatch(r"[0-9a-f]{40}", str(state.get("sha", ""))) or not isinstance(state.get("fence"), dict):
        raise broker.BrokerProtocolError("release state contract is invalid")
    previous = state.get("previous_sha")
    if previous is not None and not broker.re.fullmatch(r"[0-9a-f]{40}", str(previous)):
        raise broker.BrokerProtocolError("release state prior SHA is invalid")
    return state


def _write_release_state(path: str, state: dict[str, Any]) -> None:
    parent = broker.os.path.dirname(path)
    parent_metadata = broker.os.stat(parent, follow_symlinks=False)
    if not broker.stat.S_ISDIR(parent_metadata.st_mode) or parent_metadata.st_uid != 0 or parent_metadata.st_mode & 0o022:
        raise broker.BrokerProtocolError("release state directory ownership or mode is invalid")
    payload = broker.json.dumps(state, sort_keys=True, separators=(",", ":")).encode("utf-8")
    if len(payload) > 16_384:
        raise broker.BrokerProtocolError("release state exceeds size limit")
    fd, temporary = broker.tempfile.mkstemp(prefix=".release-state.", dir=parent)
    try:
        broker.os.fchown(fd, 0, 0)
        broker.os.fchmod(fd, 0o600)
        with broker.os.fdopen(fd, "wb", closefd=False) as stream:
            stream.write(payload)
            stream.flush()
            broker.os.fsync(fd)
        broker.os.replace(temporary, path)
        directory_fd = broker.os.open(parent, broker.os.O_RDONLY | getattr(broker.os, "O_DIRECTORY", 0))
        try:
            broker.os.fsync(directory_fd)
        finally:
            broker.os.close(directory_fd)
    finally:
        try:
            broker.os.close(fd)
        except OSError:
            pass
        try:
            broker.os.unlink(temporary)
        except FileNotFoundError:
            pass


def _record_promotion_failure(path: str, sha: str, previous_sha: str | None,
                             fence: dict[str, Any], *, restored: bool) -> str:
    """Persist only a proven rollback; uncertain pointer recovery blocks later promotion."""
    status = "rolled_back" if restored else "recovery_required"
    broker._write_release_state(path, {
        "version": 1, "status": status, "sha": sha,
        "previous_sha": previous_sha, "fence": fence,
    })
    return status


def _record_promotion_success(path: str, sha: str, previous_sha: str | None,
                             fence: dict[str, Any]) -> None:
    """Record pointer movement as promoted; only the later probe may mark healthy."""
    broker._write_release_state(path, {
        "version": 1, "status": "promoted", "sha": sha,
        "previous_sha": previous_sha, "fence": fence,
    })


def _promotion_restore_confirmed(error: Exception) -> bool:
    from worker_release_lifecycle import ReleaseHealthProbeError, ReleaseHealthRejected

    return isinstance(error, (ReleaseHealthProbeError, ReleaseHealthRejected))
