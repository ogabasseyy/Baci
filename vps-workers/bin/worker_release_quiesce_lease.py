"""Broker-owned, bounded process lease for strict worker quiescence.

This is an integration candidate. It is intentionally not wired into release
operations until the installed helper/service identity is independently
verified. The command is fixed; callers cannot supply shell commands, paths,
callbacks, or service names. A live lease spans multiple broker requests.
Closing the broker's pipe makes the helper exit through its cleanup trap, so a
broker crash does not leave its lock keepers or stopped services orphaned.
"""

from __future__ import annotations

import os
import re
import select
import stat
import subprocess
import threading
import time
from contextlib import contextmanager
from pathlib import Path


LEASE_HELPER_PATH = "/usr/local/lib/baci-worker-broker/worker-release-quiesce-lease.sh"
LEASE_SUPPORT_PATHS = (
    "/usr/local/lib/baci-worker-broker/quiesce-worker-release-strict.sh",
    "/usr/local/lib/baci-worker-broker/strict-lock-keeper.py",
)
LEASE_MAX_SECONDS = 20 * 60
LEASE_READY_SECONDS = 630
LEASE_CLEANUP_SECONDS = 35
TRUSTED_ROOT_UID = 0
SHA_RE = re.compile(r"^[0-9a-f]{40}$")
ID_RE = re.compile(r"^[1-9][0-9]{0,19}$")


class QuiesceLeaseRejected(RuntimeError):
    """The fixed quiescence lease could not be safely acquired or released."""


from worker_release_quiesce_lease_identity import identity_key as _identity_key_impl, verify_installed_helper as _verify_installed_helper_impl

def _identity_key(identity: object) -> tuple[str, int, str]:
    return _identity_key_impl(identity, id_re=ID_RE, sha_re=SHA_RE, rejected=QuiesceLeaseRejected)

def _verify_installed_helper() -> None:
    return _verify_installed_helper_impl(LEASE_HELPER_PATH, LEASE_SUPPORT_PATHS, trusted_uid=TRUSTED_ROOT_UID, rejected=QuiesceLeaseRejected)


class WorkerQuiesceLease:
    """One broker-owned lease, backed by the fixed helper's open stdin pipe."""

    def __init__(self, manager: "WorkerQuiesceLeaseManager", key: tuple[str, int, str], process: subprocess.Popen[bytes]):
        self._manager = manager
        self.key = key
        self._process = process
        self._guard = threading.Condition()
        self._state = "active"
        self._operations = 0
        self._deadline = time.monotonic() + LEASE_MAX_SECONDS
        self._timer = threading.Timer(LEASE_MAX_SECONDS, self._expire)
        self._timer.daemon = True
        self._timer.start()

    @property
    def active(self) -> bool:
        with self._guard:
            return self._state == "active" and self._process.poll() is None and time.monotonic() < self._deadline

    def require_active(self) -> None:
        if not self.active:
            raise QuiesceLeaseRejected("worker quiescence lease is not active")

    def _expire(self) -> None:
        with self._guard:
            if self._state in ("released", "failed"):
                return
            self._state = "expiring"
            if self._operations:
                return
        try:
            self.release(expired=True)
        except QuiesceLeaseRejected:
            # Preserve the failed lease in the manager. Further mutations
            # remain blocked until cleanup can be confirmed or the broker is
            # restarted under operator recovery.
            return

    @contextmanager
    def operation(self):
        """Keep the lease held until one broker lifecycle operation exits."""
        with self._guard:
            if self._state != "active" or self._process.poll() is not None or time.monotonic() >= self._deadline:
                raise QuiesceLeaseRejected("worker quiescence lease is not active")
            self._operations += 1
        try:
            yield self
        finally:
            should_release = False
            with self._guard:
                self._operations -= 1
                self._guard.notify_all()
                should_release = self._operations == 0 and self._state == "expiring"
            if should_release:
                self.release(expired=True)

    def release(self, *, expired: bool = False) -> None:
        with self._guard:
            if self._state == "released":
                return
            if self._state == "failed":
                raise QuiesceLeaseRejected("worker quiescence lease cleanup is unconfirmed")
            if self._operations:
                self._state = "expiring"
                deadline = time.monotonic() + LEASE_CLEANUP_SECONDS
                while self._operations:
                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        self._state = "failed"
                        raise QuiesceLeaseRejected("active worker release operation did not finish; lease remains held")
                    self._guard.wait(remaining)
            self._state = "closing"
            self._timer.cancel()
            if self._process.stdin is not None and not self._process.stdin.closed:
                try:
                    self._process.stdin.close()
                except OSError:
                    pass
            try:
                code = self._process.wait(timeout=LEASE_CLEANUP_SECONDS)
            except subprocess.TimeoutExpired:
                self._state = "failed"
                raise QuiesceLeaseRejected("worker quiescence cleanup timed out; release remains blocked") from None
            if self._process.stdout is not None:
                self._process.stdout.close()
            if code != 0:
                self._state = "failed"
                raise QuiesceLeaseRejected("worker quiescence cleanup failed; release remains blocked")
            self._state = "released"
        self._manager._lease_ended(self)
        if expired:
            # The manager has dropped the completed process, but the release
            # operation still receives a negative lease result.
            return


class WorkerQuiesceLeaseManager:
    """Own at most one fixed quiescence lease for a serialized release broker."""

    def __init__(self) -> None:
        self._guard = threading.Lock()
        self._lease: WorkerQuiesceLease | None = None
        self._orphan: subprocess.Popen[bytes] | None = None
        self._orphan_cleanup_confirmed = True

    def acquire(self, identity: object) -> WorkerQuiesceLease:
        key = _identity_key(identity)
        with self._guard:
            self._refresh_orphan()
            if self._orphan is not None:
                raise QuiesceLeaseRejected("prior quiescence helper cleanup is unconfirmed")
            if self._lease is not None:
                if self._lease.key != key:
                    raise QuiesceLeaseRejected("another authenticated release owns the quiescence lease")
                self._lease.require_active()
                return self._lease
            _verify_installed_helper()
            try:
                process = subprocess.Popen(
                    ["/bin/bash", LEASE_HELPER_PATH],
                    stdin=subprocess.PIPE,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.DEVNULL,
                    cwd="/",
                    env={"PATH": "/usr/bin:/bin", "HOME": "/root"},
                    close_fds=True,
                    start_new_session=True,
                )
            except OSError:
                raise QuiesceLeaseRejected("trusted quiescence helper could not start") from None
            try:
                self._await_ready(process)
            except Exception:
                self._orphan_cleanup_confirmed = self._abandon_start(process)
                if not self._orphan_cleanup_confirmed:
                    self._orphan = process
                raise
            lease = WorkerQuiesceLease(self, key, process)
            self._lease = lease
            return lease

    @staticmethod
    def _await_ready(process: subprocess.Popen[bytes]) -> None:
        if process.stdout is None:
            raise QuiesceLeaseRejected("trusted quiescence helper protocol is unavailable")
        try:
            deadline = time.monotonic() + LEASE_READY_SECONDS
            payload = bytearray()
            descriptor = process.stdout.fileno()
            while not payload.endswith(b"\n"):
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise QuiesceLeaseRejected("worker quiescence acquisition timed out")
                ready, _, _ = select.select([descriptor], [], [], remaining)
                if not ready:
                    raise QuiesceLeaseRejected("worker quiescence acquisition timed out")
                chunk = os.read(descriptor, 1)
                if not chunk:
                    raise QuiesceLeaseRejected("worker quiescence acquisition was not confirmed")
                payload.extend(chunk)
                if len(payload) > 64:
                    raise QuiesceLeaseRejected("worker quiescence helper protocol is invalid")
            if bytes(payload) != b"READY\n" or process.poll() is not None:
                raise QuiesceLeaseRejected("worker quiescence acquisition was not confirmed")
        except OSError:
            raise QuiesceLeaseRejected("worker quiescence acquisition protocol failed") from None

    @staticmethod
    def _abandon_start(process: subprocess.Popen[bytes]) -> bool:
        if process.stdin is not None and not process.stdin.closed:
            try:
                process.stdin.close()
            except OSError:
                pass
        try:
            code = process.wait(timeout=LEASE_CLEANUP_SECONDS)
            if process.stdout is not None:
                process.stdout.close()
            return code == 0
        except subprocess.TimeoutExpired:
            # Avoid SIGKILL: the fixed helper's EXIT cleanup is responsible for
            # releasing locks and restarting only services it stopped.
            return False

    def _refresh_orphan(self) -> None:
        if self._orphan is None:
            return
        code = self._orphan.poll()
        if code is None:
            return
        if self._orphan.stdout is not None and not self._orphan.stdout.closed:
            self._orphan.stdout.close()
        self._orphan_cleanup_confirmed = code == 0
        if code == 0:
            self._orphan = None

    def _lease_ended(self, lease: WorkerQuiesceLease) -> None:
        with self._guard:
            if self._lease is lease:
                self._lease = None

    def require_active(self, identity: object) -> WorkerQuiesceLease:
        """Return an existing lease; observations must never silently reacquire."""
        key = _identity_key(identity)
        with self._guard:
            lease = self._lease
            if lease is None or lease.key != key:
                raise QuiesceLeaseRejected("worker quiescence lease is not active for this release")
            lease.require_active()
            return lease

    def close(self) -> None:
        with self._guard:
            lease = self._lease
            orphan = self._orphan
        if lease is not None:
            lease.release()
        if orphan is not None:
            confirmed = self._abandon_start(orphan)
            with self._guard:
                self._orphan_cleanup_confirmed = self._orphan_cleanup_confirmed and confirmed
                self._refresh_orphan()
                if not self._orphan_cleanup_confirmed:
                    raise QuiesceLeaseRejected("orphan quiescence cleanup is unconfirmed")


__all__ = ["QuiesceLeaseRejected", "WorkerQuiesceLease", "WorkerQuiesceLeaseManager"]
