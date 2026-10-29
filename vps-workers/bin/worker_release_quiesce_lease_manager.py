"""Acquire and supervise the broker's durable worker quiescence lease."""
from __future__ import annotations

import os
import subprocess
import threading
import time
from pathlib import Path

import worker_release_quiesce_lease as config
from worker_release_quiesce_lease_core import WorkerQuiesceLease

REQUIRED_SERVICES = (
    "baci-domain-event-router",
    "baci-event-delivery-worker",
    "baci-quiz-finalization",
)


class WorkerQuiesceLeaseManager:
    def __init__(self, *, worker_uid=None, worker_gid=None, lock_gid=None,
                 latch_path=None, gate_socket_path=None, owner_uid=0):
        self._guard = threading.Lock()
        self._lease = None
        self._orphan = None
        self._orphan_lock_fds = []
        self._orphan_cleanup_confirmed = True
        self.worker_uid = os.getuid() if worker_uid is None else worker_uid
        self.worker_gid = os.getgid() if worker_gid is None else worker_gid
        if lock_gid is None:
            import grp
            lock_gid = grp.getgrnam("baci-locks").gr_gid
        self.lock_gid = lock_gid
        self.latch_path = config.LATCH_PATH if latch_path is None else latch_path
        self._phase = None
        self._fence = None
        gate_kwargs = {} if gate_socket_path is None else {"path": gate_socket_path}
        from worker_release_quiesce_gate import HealthGateServer
        self._gate = HealthGateServer(worker_uid=self.worker_uid, worker_gid=self.worker_gid,
                                      authorize=self._authorize_unit, owner_uid=owner_uid, **gate_kwargs)

    def _authorize_unit(self, unit):
        with self._guard:
            lease, phase, fence = self._lease, self._phase, self._fence
        if lease is None or lease._state not in ("active", "expiring") or phase not in ("health_probe", "restore"):
            return False
        try:
            latch = config.load_latch(self.latch_path, uid=os.geteuid(), gid=self.lock_gid)
        except config.LatchError:
            return False
        return bool(latch and latch["fence"] == fence and latch["phase"] == phase
                    and (phase != "restore" or unit in latch["services_to_restore"]))

    def _set_phase(self, lease, phase):
        with self._guard:
            if self._lease is not lease:
                raise config.QuiesceLeaseRejected("worker quiescence lease is not current")
            try:
                config.update_latch(path=self.latch_path, phase=phase, fence=lease._fence,
                                    uid=os.geteuid(), gid=self.lock_gid)
            except config.LatchError as error:
                raise config.QuiesceLeaseRejected(str(error)) from None
            self._phase = phase

    def _snapshot_active_services(self):
        """Require a complete pre-mutation snapshot of the fixed core units."""
        for service in REQUIRED_SERVICES:
            try:
                result = subprocess.run(
                    ["/usr/bin/systemctl", "is-active", "--quiet", service],
                    stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL, check=False, close_fds=True,
                    cwd="/", env={"PATH": "/usr/bin:/bin", "HOME": "/root"}, timeout=5,
                )
            except (OSError, subprocess.TimeoutExpired):
                raise config.QuiesceLeaseRejected("required worker service snapshot failed") from None
            if result.returncode != 0:
                raise config.QuiesceLeaseRejected("all fixed worker services must be active before quiescing")
        return list(REQUIRED_SERVICES)

    def acquire(self, identity, *, previous_sha=None, recovery=False, takeover_from=None):
        key = config._identity_key(identity)
        with self._guard:
            self._refresh_orphan()
            if self._orphan is not None:
                raise config.QuiesceLeaseRejected("prior quiescence cleanup is unconfirmed")
            if self._lease is not None:
                if self._lease.key != key:
                    raise config.QuiesceLeaseRejected("another authenticated release owns the lease")
                self._lease.require_active()
                return self._lease
            config._verify_installed_helper()
            fence = {"run_id": key[0], "run_attempt": key[1], "sha": key[2]}
            try:
                existing = config.load_latch(self.latch_path, uid=os.geteuid(), gid=self.lock_gid)
                if existing is not None:
                    if not recovery or not existing.get("service_snapshot_complete"):
                        raise config.QuiesceLeaseRejected("worker recovery snapshot is incomplete")
                    active_services = existing["services_to_restore"]
                else:
                    if recovery:
                        raise config.QuiesceLeaseRejected("worker recovery latch is missing")
                    active_services = self._snapshot_active_services()
                config.create_latch(fence, previous_sha, path=self.latch_path, recovery=recovery,
                                    takeover_from=takeover_from,
                                    job_id=str(identity.get("job_id", "")) or None,
                                    active_services=active_services,
                                    uid=os.geteuid(), gid=self.lock_gid)
                self._fence, self._phase = fence, "quiescing"
                self._gate.start()
            except (config.LatchError, OSError, PermissionError):
                raise config.QuiesceLeaseRejected("worker recovery latch could not be established") from None
            except config.QuiesceLeaseRejected:
                raise
            deadline = time.monotonic() + min(config.LEASE_READY_SECONDS, config.LEASE_LOCK_SECONDS)
            try:
                process = subprocess.Popen(
                    ["/bin/bash", config.LEASE_HELPER_PATH], stdin=subprocess.PIPE,
                    stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, cwd="/",
                    env={"PATH": "/usr/bin:/bin", "HOME": "/root",
                         "PYTHONPATH": str(Path(config.__file__).resolve().parent)},
                    close_fds=True, start_new_session=True,
                )
            except OSError:
                self._gate_failed()
                raise config.QuiesceLeaseRejected("trusted quiescence helper could not start") from None
            lock_fds = []
            try:
                config._await_ready(process, deadline=deadline, rejected=config.QuiesceLeaseRejected)
                lock_fds = config.acquire_production_lock_fds(deadline=deadline)
                if process.poll() is not None:
                    raise config.QuiesceLeaseRejected("service supervisor exited after lock acquisition")
            except Exception as error:
                confirmed = False
                if process.poll() is None:
                    for fd in reversed(lock_fds):
                        os.close(fd)
                    lock_fds.clear()
                    confirmed = config._abandon_start(process, cleanup_seconds=config.LEASE_CLEANUP_SECONDS)
                else:
                    confirmed = config._abandon_start(process, cleanup_seconds=config.LEASE_CLEANUP_SECONDS)
                    if confirmed:
                        for fd in reversed(lock_fds):
                            os.close(fd)
                    else:
                        self._orphan_lock_fds.extend(lock_fds)
                self._orphan_cleanup_confirmed = confirmed
                if not confirmed:
                    self._orphan = process
                self._gate_failed()
                if isinstance(error, config.LockSetError):
                    raise config.QuiesceLeaseRejected(str(error)) from None
                raise
            lease = WorkerQuiesceLease(self, key, process, lock_fds, fence,
                                       getattr(lock_fds, "service_fds", ()))
            self._lease = lease
            return lease

    def _gate_failed(self):
        self._phase = None
        try:
            self._gate.close()
        except (OSError, RuntimeError):
            pass

    def _refresh_orphan(self):
        if self._orphan is None:
            return
        code = self._orphan.poll()
        if code is None:
            return
        if self._orphan.stdout is not None and not self._orphan.stdout.closed:
            self._orphan.stdout.close()
        self._orphan_cleanup_confirmed = code == 0
        if code == 0:
            for fd in reversed(self._orphan_lock_fds):
                os.close(fd)
            self._orphan_lock_fds.clear()
            self._orphan = None

    def _lease_ended(self, lease):
        with self._guard:
            if self._lease is lease:
                self._lease = None
                self._phase = self._fence = None
                self._gate.close()

    def _lease_failed(self, lease):
        with self._guard:
            if self._lease is lease:
                self._phase = "recovery_required"
                self._gate_failed()

    def is_active_for(self, fence):
        with self._guard:
            lease = self._lease
            return bool(lease and lease._fence == fence and lease.active)

    def recovery_latch(self):
        try:
            return config.load_latch(self.latch_path, uid=os.geteuid(), gid=self.lock_gid)
        except config.LatchError as error:
            raise config.QuiesceLeaseRejected(str(error)) from None

    def require_active(self, identity):
        key = config._identity_key(identity)
        with self._guard:
            lease = self._lease
            if lease is None or lease.key != key:
                raise config.QuiesceLeaseRejected("worker quiescence lease is not active for this release")
            lease.require_active()
            return lease

    def close(self):
        with self._guard:
            lease, orphan = self._lease, self._orphan
        if lease is not None:
            lease.release()
        if orphan is not None:
            confirmed = config._abandon_start(orphan, cleanup_seconds=config.LEASE_CLEANUP_SECONDS)
            with self._guard:
                self._orphan_cleanup_confirmed = self._orphan_cleanup_confirmed and confirmed
                self._refresh_orphan()
                if not self._orphan_cleanup_confirmed:
                    raise config.QuiesceLeaseRejected("orphan quiescence cleanup is unconfirmed")


__all__ = ["WorkerQuiesceLeaseManager"]
