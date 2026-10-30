"""Lease operations and health/rollback supervisor protocol."""
from __future__ import annotations

import os
import subprocess
import threading
import time
from contextlib import contextmanager

import worker_release_quiesce_lease as config


class WorkerQuiesceLease:
    def __init__(self, manager, key, process, lock_fds, fence, service_lock_fds=()):
        self._manager, self.key, self._process = manager, key, process
        self._lock_fds, self._fence = lock_fds, fence
        self._service_lock_fds = list(service_lock_fds)
        self._guard = threading.Condition()
        self._state, self._operations = "active", 0
        self._deadline = time.monotonic() + config.LEASE_MAX_SECONDS
        self._timer = threading.Timer(config.LEASE_MAX_SECONDS, self._expire)
        self._timer.daemon = True
        self._timer.start()

    @property
    def active(self):
        with self._guard:
            return self._state == "active" and self._process.poll() is None and time.monotonic() < self._deadline

    def require_active(self):
        if not self.active:
            raise config.QuiesceLeaseRejected("worker quiescence lease is not active")

    def _expire(self):
        with self._guard:
            if self._state in ("released", "failed"):
                return
            self._state = "expiring"
            if self._operations:
                return
        try:
            self.release(expired=True)
        except config.QuiesceLeaseRejected:
            return

    def _command(self, command, response, *, allow_exit=False):
        if self._process.stdin is None or self._process.poll() is not None:
            self._state = "failed"
            raise config.QuiesceLeaseRejected("quiescence supervisor is unavailable")
        try:
            self._process.stdin.write(command + b"\n")
            self._process.stdin.flush()
            config._await_line(
                self._process, response, deadline=time.monotonic() + config.LEASE_CLEANUP_SECONDS,
                rejected=config.QuiesceLeaseRejected, timeout_message="worker service transition timed out",
                allow_exit=allow_exit,
            )
        except (OSError, subprocess.TimeoutExpired):
            self._state = "failed"
            raise config.QuiesceLeaseRejected("worker service transition was not confirmed") from None

    def start_health(self):
        self.require_active()
        self._manager._set_phase(self, "health_probe")
        self._release_service_locks()
        self._command(b"START_HEALTH", b"STARTED\n")

    def abort_health(self):
        self._manager._set_phase(self, "recovery_required")
        self._command(b"ABORT", b"STOPPED\n")

    def confirm_healthy(self):
        self._command(b"HEALTHY", b"DONE\n", allow_exit=True)
        self._finish_success()

    def confirm_rollback(self):
        self._manager._set_phase(self, "restore")
        self._release_service_locks()
        self._command(b"RESTORE", b"DONE\n", allow_exit=True)
        self._finish_success()

    def _finish_success(self):
        if self._process.stdin is not None and not self._process.stdin.closed:
            self._process.stdin.close()
        self._wait_helper()
        self._close_locks()
        self._state = "released"
        self._timer.cancel()
        self._manager._lease_ended(self)

    def _wait_helper(self):
        try:
            code = self._process.wait(timeout=config.LEASE_CLEANUP_SECONDS)
        except subprocess.TimeoutExpired:
            self._state = "failed"
            raise config.QuiesceLeaseRejected("worker quiescence cleanup timed out; recovery latch remains") from None
        if self._process.stdout is not None:
            self._process.stdout.close()
        if code != 0:
            self._state = "failed"
            raise config.QuiesceLeaseRejected("worker quiescence cleanup failed; recovery latch remains")

    def _close_locks(self):
        for fd in reversed(self._lock_fds):
            try:
                os.close(fd)
            except OSError:
                pass
        self._lock_fds.clear()

    def _release_service_locks(self):
        for fd in self._service_lock_fds:
            try:
                os.close(fd)
            except OSError:
                pass
            if fd in self._lock_fds:
                self._lock_fds.remove(fd)
        self._service_lock_fds.clear()

    @contextmanager
    def operation(self):
        with self._guard:
            if self._state != "active" or self._process.poll() is not None or time.monotonic() >= self._deadline:
                raise config.QuiesceLeaseRejected("worker quiescence lease is not active")
            self._operations += 1
        try:
            yield self
        finally:
            with self._guard:
                self._operations -= 1
                self._guard.notify_all()
                should_release = self._operations == 0 and self._state == "expiring"
            if should_release:
                self.release(expired=True)

    def release(self, *, expired=False):
        with self._guard:
            if self._state == "released":
                return
            if self._state == "failed":
                raise config.QuiesceLeaseRejected("worker quiescence cleanup is unconfirmed")
            if self._process.poll() is not None:
                self._state = "failed"
                raise config.QuiesceLeaseRejected("service supervisor exited; recovery latch remains")
            if self._operations:
                self._state = "expiring"
                deadline = time.monotonic() + config.LEASE_CLEANUP_SECONDS
                while self._operations:
                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        self._state = "failed"
                        raise config.QuiesceLeaseRejected("active worker release operation did not finish")
                    self._guard.wait(remaining)
            self._state = "closing"
            self._timer.cancel()
            if self._process.stdin is not None and not self._process.stdin.closed:
                self._process.stdin.close()
        self._wait_helper()
        self._close_locks()
        self._state = "failed"  # Unconfirmed release always keeps the durable latch.
        self._manager._lease_failed(self)
        if not expired:
            raise config.QuiesceLeaseRejected("release ended without a healthy or restored state")


__all__ = ["WorkerQuiesceLease"]
