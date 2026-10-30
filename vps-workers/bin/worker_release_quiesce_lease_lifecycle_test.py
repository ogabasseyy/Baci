from worker_release_quiesce_lease_test_support import (
    WorkerQuiesceLeaseFixture, FENCE, lease_module, recovery_latch, lease_manager_module,
    QuiesceLeaseRejected, WorkerQuiesceLeaseManager, os, Path, signal, subprocess, sys,
    tempfile, time, unittest, SimpleNamespace, patch, fcntl,
)


class WorkerQuiesceLeaseLifecycleTests(WorkerQuiesceLeaseFixture):

    def test_same_fence_reuses_one_lease_and_release_waits_for_cleanup(self):
        manager = self.manager()
        lease = manager.acquire(FENCE)
        self.assertIs(manager.acquire(FENCE), lease)
        self.assertIs(manager.require_active(FENCE), lease)
        # Broker lifecycle code passes the full authenticated identity on its
        # abort path; lease checks normalize it to the reduced lease key.
        self.assertTrue(manager.is_active_for({**FENCE, "job_id": "5678",
                                               "repository": "ogabasseyy/Baci",
                                               "workflow": "deploy.yml",
                                               "ref": "refs/heads/main"}))
        self.assertTrue(lease.active)
        self.assertFalse(self.marker.exists())
        with self.assertRaisesRegex(QuiesceLeaseRejected, "another authenticated release"):
            manager.acquire({**FENCE, "run_id": "1235"})

        lease.confirm_healthy()
        self.assertEqual(self.marker.read_text(encoding="utf-8"), "cleanup")
        self.assertFalse(lease.active)
        other_fd = os.open(self.lock_path, os.O_RDWR)
        try:
            fcntl.flock(other_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        finally:
            os.close(other_fd)
        manager.close()

    def test_broker_owned_lock_survives_service_supervisor_death_during_operation(self):
        manager = self.manager()
        lease = manager.acquire(FENCE)
        probe_fd = os.open(self.lock_path, os.O_RDWR)
        try:
            with lease.operation():
                os.kill(lease._process.pid, signal.SIGKILL)
                lease._process.wait(timeout=3)
                with self.assertRaises(BlockingIOError):
                    fcntl.flock(probe_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with self.assertRaisesRegex(QuiesceLeaseRejected, "not active"):
                manager.require_active(FENCE)
            with self.assertRaisesRegex(QuiesceLeaseRejected, "recovery latch remains"):
                lease.release()
            self.assertTrue(lease._lock_fds, "failed supervisor must not release broker-owned locks")
            with self.assertRaises(BlockingIOError):
                fcntl.flock(probe_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        finally:
            os.close(probe_fd)
            for fd in lease._lock_fds:
                os.close(fd)
            lease._lock_fds.clear()

    def test_expiry_closes_the_pipe_and_prevents_use_of_expired_lease(self):
        manager = self.manager()
        with patch.object(lease_module, "LEASE_MAX_SECONDS", 0.05):
            lease = manager.acquire(FENCE)
        deadline = time.monotonic() + 3
        while not self.marker.exists() and time.monotonic() < deadline:
            time.sleep(0.01)
        self.assertTrue(self.marker.exists(), "expired lease should exit through helper cleanup")
        with self.assertRaisesRegex(QuiesceLeaseRejected, "not active"):
            lease.require_active()
        with self.assertRaisesRegex(QuiesceLeaseRejected, "not active"):
            manager.require_active(FENCE)

    def test_expiry_during_mutation_defers_cleanup_until_operation_exits(self):
        manager = self.manager()
        with patch.object(lease_module, "LEASE_MAX_SECONDS", 0.05):
            lease = manager.acquire(FENCE)
        with self.assertRaisesRegex(QuiesceLeaseRejected, "cleanup failed"):
            with lease.operation():
                time.sleep(0.1)
                self.assertFalse(self.marker.exists(), "timer must not release locks mid-operation")
        self.assertTrue(self.marker.exists(), "operation exit should finish deferred lease cleanup")
        with self.assertRaisesRegex(QuiesceLeaseRejected, "not active"):
            manager.require_active(FENCE)

    def test_broker_process_exit_closes_child_pipe_and_runs_helper_cleanup(self):
        holder = self.root / "crash-holder.py"
        broker_ready = self.root / "broker-ready"
        holder.write_text(
            "import fcntl, os, sys, time\n"
            f"sys.path.insert(0, {str(Path(__file__).resolve().parent)!r})\n"
            "import worker_release_quiesce_lease as module\n"
            f"module.LEASE_HELPER_PATH = {str(self.helper)!r}\n"
            f"module.LEASE_SUPPORT_PATHS = {tuple(self.support)!r}\n"
            "module.TRUSTED_ROOT_UID = os.geteuid()\n"
            f"lock_path = {str(self.lock_path)!r}\n"
            "def acquire_lock(**kwargs):\n"
            "  fd = os.open(lock_path, os.O_RDWR)\n"
            "  fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)\n"
            "  return [fd]\n"
            "module.acquire_production_lock_fds = acquire_lock\n"
            f"manager = module.WorkerQuiesceLeaseManager(worker_uid=os.getuid(), worker_gid=os.getgid(), lock_gid=os.getgid(), latch_path={str(self.lock_dir / 'latch')!r}, gate_socket_path={str(self.root / 'gate')!r}, owner_uid=os.geteuid())\n"
            "manager._snapshot_active_services = lambda: ['baci-domain-event-router', 'baci-event-delivery-worker', 'baci-quiz-finalization']\n"
            f"manager.acquire({FENCE!r})\n"
            f"open({str(broker_ready)!r}, 'w').close()\n"
            "time.sleep(10)\n",
            encoding="utf-8",
        )
        broker = subprocess.Popen([sys.executable, str(holder)])
        probe = os.open(self.lock_path, os.O_RDWR)
        try:
            deadline = time.monotonic() + 3
            while not broker_ready.exists() and time.monotonic() < deadline:
                time.sleep(0.01)
            self.assertTrue(broker_ready.exists(), "broker must finish service stop and lock acquisition")
            with self.assertRaises(BlockingIOError):
                fcntl.flock(probe, fcntl.LOCK_EX | fcntl.LOCK_NB)
            broker.kill()
            broker.wait(timeout=3)
        finally:
            os.close(probe)
        deadline = time.monotonic() + 3
        while not self.marker.exists() and time.monotonic() < deadline:
            time.sleep(0.01)
        self.assertTrue(self.marker.exists(), "broker exit should close the lease pipe and invoke helper cleanup")
        released_fd = os.open(self.lock_path, os.O_RDWR)
        try:
            fcntl.flock(released_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        finally:
            os.close(released_fd)


if __name__ == "__main__":
    unittest.main()
