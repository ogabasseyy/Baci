from worker_release_quiesce_lease_test_support import (
    WorkerQuiesceLeaseFixture, FENCE, lease_module, recovery_latch, lease_manager_module,
    QuiesceLeaseRejected, WorkerQuiesceLeaseManager, os, Path, signal, subprocess, sys,
    tempfile, time, unittest, SimpleNamespace, patch, fcntl,
)


class WorkerQuiesceLeaseProtocolTests(WorkerQuiesceLeaseFixture):

    def test_invalid_fence_is_rejected_before_starting_a_helper(self):
        manager = self.manager()
        with self.assertRaisesRegex(QuiesceLeaseRejected, "fence is invalid"):
            manager.acquire({**FENCE, "run_attempt": True})
        self.assertFalse(self.marker.exists())

    def test_incomplete_active_snapshot_fails_before_latch_or_helper_creation(self):
        manager = self.manager()
        manager._snapshot_active_services = lambda: (_ for _ in ()).throw(
            QuiesceLeaseRejected("all fixed worker services must be active before quiescing")
        )
        with patch.object(lease_module, "create_latch") as create:
            with self.assertRaisesRegex(QuiesceLeaseRejected, "all fixed worker services"):
                manager.acquire(FENCE)
        create.assert_not_called()
        self.assertFalse(self.marker.exists())

    def test_helper_start_failure_leaves_complete_durable_restore_snapshot(self):
        manager = self.manager()
        real_create = recovery_latch.create_latch
        with patch.object(lease_module, "create_latch", side_effect=real_create) as create, \
             patch.object(lease_manager_module.subprocess, "Popen", side_effect=OSError("injected helper crash")):
            with self.assertRaisesRegex(QuiesceLeaseRejected, "could not start"):
                manager.acquire(FENCE)
        create.assert_called_once()
        persisted = recovery_latch.load_latch(
            self.lock_dir / "release-recovery-latch.json", uid=os.geteuid(), gid=os.getegid()
        )
        self.assertTrue(persisted["service_snapshot_complete"])
        self.assertEqual(persisted["services_to_restore"], [
            "baci-domain-event-router", "baci-event-delivery-worker", "baci-quiz-finalization"
        ])
        self.assertEqual(persisted["stop_intent"], [])
        self.assertFalse(self.marker.exists())

    def test_snapshot_queries_every_fixed_service_and_fails_on_one_inactive(self):
        manager = self.manager()
        del manager._snapshot_active_services
        expected = ["baci-domain-event-router", "baci-event-delivery-worker", "baci-quiz-finalization"]
        with patch("worker_release_quiesce_lease_manager.subprocess.run",
                   return_value=SimpleNamespace(returncode=0)) as run:
            self.assertEqual(manager._snapshot_active_services(), expected)
        self.assertEqual([call.args[0][-1] for call in run.call_args_list], expected)
        with patch("worker_release_quiesce_lease_manager.subprocess.run",
                   side_effect=[SimpleNamespace(returncode=0), SimpleNamespace(returncode=3)]) as run:
            with self.assertRaisesRegex(QuiesceLeaseRejected, "all fixed worker services"):
                manager._snapshot_active_services()
        self.assertEqual(run.call_count, 2)

    def test_partial_ready_frame_times_out_and_closes_the_helper(self):
        # The production helper gets a fixed minimal environment. This fixture
        # uses a literal marker path so the timeout branch can verify cleanup.
        self.helper.write_text(
            "#!/bin/bash\n"
            f"trap 'printf cleanup >> {str(self.marker)!r}' EXIT\n"
            "printf REA\n"
            "cat >/dev/null\n",
            encoding="utf-8",
        )
        self.helper.chmod(0o700)
        manager = self.manager()
        with patch.object(lease_module, "LEASE_READY_SECONDS", 0.05):
            with self.assertRaisesRegex(QuiesceLeaseRejected, "acquisition timed out"):
                manager.acquire(FENCE)
        self.assertEqual(self.marker.read_text(encoding="utf-8"), "cleanup")

    def test_unconfirmed_startup_cleanup_blocks_reacquire_until_child_exits(self):
        self.helper.write_text(
            "#!/bin/bash\n"
            f"trap 'printf cleanup >> {str(self.marker)!r}' EXIT\n"
            "trap 'exit 0' HUP INT TERM\n"
            "printf REA\n"
            "sleep 10\n",
            encoding="utf-8",
        )
        self.helper.chmod(0o700)
        manager = self.manager()
        with patch.object(lease_module, "LEASE_READY_SECONDS", 0.03), patch.object(lease_module, "LEASE_CLEANUP_SECONDS", 0.03):
            with self.assertRaisesRegex(QuiesceLeaseRejected, "acquisition timed out"):
                manager.acquire(FENCE)
            self.assertIsNotNone(manager._orphan)
            with self.assertRaisesRegex(QuiesceLeaseRejected, "cleanup is unconfirmed"):
                manager.acquire(FENCE)
            os.killpg(manager._orphan.pid, signal.SIGTERM)
            self.assertEqual(manager._orphan.wait(timeout=3), 0)

        self.write_protocol_helper()
        lease_module.load_latch.return_value = {
            "fence": FENCE, "phase": "recovery_required", "service_snapshot_complete": True,
            "services_to_restore": ["baci-domain-event-router", "baci-event-delivery-worker", "baci-quiz-finalization"],
        }
        lease = manager.acquire(FENCE, recovery=True)
        lease.confirm_healthy()

    def test_installed_shell_wrapper_uses_fixed_root_and_never_dispatches_input(self):
        wrapper = Path(__file__).resolve().parents[1] / "lib" / "worker-release-quiesce-lease.sh"
        source = wrapper.read_text(encoding="utf-8")
        self.assertIn('/usr/bin/systemctl stop "$service"', source)
        self.assertNotIn("strict_worker_release_quiesce", source)
        self.assertIn("while IFS= read -r command", source)
        self.assertIn('HEALTHY)', source)
        self.assertIn('recovery clear', source)
        self.assertIn('Parent death or a broken control pipe never means "restart services"', source)
        self.assertNotRegex(source, r"\beval\b|bash\s+-c|\$\{?[@*]}")


if __name__ == "__main__":
    unittest.main()
