"""GIGL tracking lock, capability smoke and release identity helpers."""
import worker_release_broker as broker
import fcntl, json, os, re, stat, subprocess, tempfile, time
from typing import Any

def _run_gigl_capability_smoke(worker_root: str, worker_uid: int, worker_gid: int,
                                installed_sha: str) -> dict[str, Any]:
    """Run one fixed GIGL-only probe as baci-worker and accept safe metadata only."""
    helper = broker.os.path.join(worker_root, "current", "bin", "gigl-capability-smoke-latch.sh")
    broker._assert_root_owned_executable(helper)
    worker_env = {
        "PATH": "/usr/bin:/bin", "HOME": worker_root,
        "BACI_WORKER_ROOT": worker_root, "BACI_EXPECTED_APP_SHA": installed_sha,
    }
    try:
        completed = broker.subprocess.run(
            [helper], stdin=broker.subprocess.DEVNULL, stdout=broker.subprocess.PIPE,
            stderr=broker.subprocess.DEVNULL, check=False, close_fds=True,
            cwd="/", env=worker_env, timeout=240,
            user=worker_uid, group=worker_gid, extra_groups=(),
        )
    except (OSError, broker.subprocess.TimeoutExpired) as error:
        raise broker.BrokerProtocolError("GIGL capability smoke could not complete") from error
    raw = completed.stdout or b""
    if completed.returncode != 0 or len(raw) > 1024:
        raise broker.BrokerProtocolError("GIGL capability smoke failed")
    try:
        receipt = broker.json.loads(raw)
    except (broker.json.JSONDecodeError, UnicodeDecodeError):
        raise broker.BrokerProtocolError("GIGL capability smoke receipt is invalid") from None
    if (not isinstance(receipt, dict) or receipt.get("smokePassed") is not True or
            receipt.get("scope") not in ("enabled", "disabled") or
            receipt.get("installedSha") != installed_sha or
            not broker.re.fullmatch(r"[0-9a-f]{64}", receipt.get("credentialFingerprint", ""))):
        raise broker.BrokerProtocolError("GIGL capability smoke receipt is invalid")
    if set(receipt) != {"smokePassed", "scope", "installedSha", "credentialFingerprint"}:
        raise broker.BrokerProtocolError("GIGL capability smoke receipt contains unsupported data")
    return receipt


def _write_gigl_capability_latch(worker_root: str, scope: str, installed_sha: str,
                                 credential_fingerprint: str) -> None:
    """Persist a root-owned latch only after the worker-UID live smoke succeeds."""
    if (scope not in ("enabled", "disabled") or
            not broker.re.fullmatch(r"[0-9a-f]{40}", installed_sha or "") or
            not broker.re.fullmatch(r"[0-9a-f]{64}", credential_fingerprint or "")):
        raise broker.BrokerProtocolError("GIGL capability identity is invalid")
    latch = broker.os.path.join(worker_root, ".gigl-capability-smoke-ok")
    temporary = None
    try:
        try:
            existing = broker.os.lstat(latch)
            if not broker.stat.S_ISREG(existing.st_mode) or existing.st_mode & 0o022:
                raise broker.BrokerProtocolError("GIGL capability latch destination is invalid")
        except FileNotFoundError:
            pass
        fd, temporary = broker.tempfile.mkstemp(prefix=".gigl-capability-smoke-ok.", dir=worker_root)
        broker.os.fchmod(fd, 0o600)
        with broker.os.fdopen(fd, "w", encoding="ascii") as output:
            output.write(f"{scope}:{installed_sha}:{credential_fingerprint}\n")
            output.flush()
            broker.os.fsync(output.fileno())
        broker.os.replace(temporary, latch)
        temporary = None
    except OSError as error:
        raise broker.BrokerProtocolError("GIGL capability latch could not be persisted") from error
    finally:
        if temporary is not None:
            try:
                broker.os.unlink(temporary)
            except FileNotFoundError:
                pass


def _validate_gigl_release_sha(installed_sha: str | None, authenticated_sha: str) -> str:
    if (not isinstance(installed_sha, str) or
            not broker.re.fullmatch(r"[0-9a-f]{40}", installed_sha) or
            installed_sha != authenticated_sha):
        raise broker.BrokerProtocolError("installed worker release does not match the authenticated SHA")
    return installed_sha


def _acquire_gigl_tracking_lock(worker_root: str) -> int:
    path = broker.os.path.join(worker_root, "locks", "gigl-tracking.lock")
    try:
        fd = broker.os.open(path, broker.os.O_RDWR | getattr(broker.os, "O_NOFOLLOW", 0))
        metadata = broker.os.fstat(fd)
        if not broker.stat.S_ISREG(metadata.st_mode) or metadata.st_mode & 0o022:
            broker.os.close(fd)
            raise broker.BrokerProtocolError("GIGL tracking lock is invalid")
        deadline = broker.time.monotonic() + 180
        while True:
            try:
                broker.fcntl.flock(fd, broker.fcntl.LOCK_EX | broker.fcntl.LOCK_NB)
                return fd
            except BlockingIOError:
                if broker.time.monotonic() >= deadline:
                    broker.os.close(fd)
                    raise broker.BrokerProtocolError("GIGL tracking lock is busy") from None
                broker.time.sleep(0.25)
    except OSError as error:
        raise broker.BrokerProtocolError("GIGL tracking lock is unavailable") from error
