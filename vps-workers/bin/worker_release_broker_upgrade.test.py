"""Transactional broker upgrade and recovery regressions."""
from __future__ import annotations

import os
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent))

from worker_release_broker_generation import GenerationFile, current_generation, publish_generation, switch_generation
from worker_release_broker_upgrade import (
    BrokerUpgradeRejected, BrokerUpgradeRecoveryRequired, mutations_blocked,
    bootstrap_generation, recover_before_start, recover_interrupted_upgrade,
    upgrade_generation,
)
from worker_release_broker_upgrade_journal import read_upgrade_journal


class FakeControl:
    def __init__(self, current, *, fail_new_ready=False, fail_old_ready=False):
        self.digest = current
        self.fail_new_ready = fail_new_ready
        self.fail_old_ready = fail_old_ready
        self.running = True
        self.calls = []
        self.old_ready_count = 0
        self.journal_path = None

    def stop_and_prove(self):
        self.calls.append("stop")
        self.running = False

    def prove_stopped(self):
        self.calls.append("prove-stopped")
        if self.running:
            raise BrokerUpgradeRejected("test unit still running")

    def prove_prestart_safe(self):
        self.calls.append("prove-prestart-safe")

    def start(self):
        self.calls.append("start")
        if self.journal_path is not None:
            record = read_upgrade_journal(self.journal_path, owner_uid=os.getuid(),
                                          owner_gid=os.getgid())
            self.calls.append(("start-journal-phase", None if record is None else record["phase"]))
        self.running = True

    def wait_ready(self, expected_digest, deadline):
        self.calls.append(("ready", expected_digest))
        if time.monotonic() > deadline:
            raise BrokerUpgradeRejected("test deadline expired")
        if expected_digest == self.old_digest:
            self.old_ready_count += 1
        if ((expected_digest == self.new_digest and self.fail_new_ready) or
                (expected_digest == self.old_digest and self.fail_old_ready
                 and self.old_ready_count > 1)):
            raise BrokerUpgradeRejected("test readiness failure")
        self.digest = expected_digest


class BrokerUpgradeTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(dir=Path.home())
        self.root = Path(self.temporary.name)
        os.chmod(self.root, 0o755)
        self.uid, self.gid = os.getuid(), os.getgid()
        self.journal = self.root / "upgrade-journal.json"
        self.state_root = self.root / "state"
        self.state_root.mkdir(mode=0o755)
        self.transaction_root = self.root / "transaction"
        self.transaction_root.mkdir(mode=0o700)
        self.old = publish_generation(self.root, (
            GenerationFile("broker.py", b"old", 0o550, self.gid),
        ), owner_uid=self.uid, root_gid=self.gid)
        switch_generation(self.root, self.old, expected_current=None,
                          owner_uid=self.uid, root_gid=self.gid)
        self.new = publish_generation(self.root, (
            GenerationFile("broker.py", b"new", 0o550, self.gid),
        ), owner_uid=self.uid, root_gid=self.gid)

    def tearDown(self):
        for current, _directories, _files in os.walk(self.root, topdown=True):
            os.chmod(current, 0o700)
        self.temporary.cleanup()

    def control(self, **kwargs):
        control = FakeControl(self.old, **kwargs)
        control.old_digest, control.new_digest = self.old, self.new
        return control

    def upgrade(self, control):
        return upgrade_generation(self.root, self.new, control=control,
                                  journal_path=self.journal, owner_uid=self.uid,
                                  root_gid=self.gid, ready_timeout=1)

    def test_switches_only_after_stop_and_clears_after_exact_new_digest_ready(self):
        control = self.control()
        control.journal_path = self.journal
        self.assertEqual(self.upgrade(control), self.new)
        self.assertEqual(current_generation(self.root, owner_uid=self.uid,
                                            root_gid=self.gid), self.new)
        self.assertFalse(mutations_blocked(self.journal, owner_uid=self.uid,
                                           owner_gid=self.gid))
        self.assertLess(control.calls.index("stop"), control.calls.index(("ready", self.new)))
        self.assertIn(("start-journal-phase", "started"), control.calls)

    def test_failed_new_health_restores_and_verifies_previous_generation(self):
        control = self.control(fail_new_ready=True)
        control.journal_path = self.journal
        with self.assertRaisesRegex(BrokerUpgradeRejected, "previous generation restored"):
            self.upgrade(control)
        self.assertEqual(current_generation(self.root, owner_uid=self.uid,
                                            root_gid=self.gid), self.old)
        self.assertIsNone(read_upgrade_journal(self.journal, owner_uid=self.uid,
                                               owner_gid=self.gid))
        self.assertEqual(control.digest, self.old)
        self.assertIn(("start-journal-phase", "rollback_starting"), control.calls)

    def test_failed_rollback_retains_durable_mutation_blocking_journal(self):
        control = self.control(fail_new_ready=True, fail_old_ready=True)
        with self.assertRaises(BrokerUpgradeRecoveryRequired):
            self.upgrade(control)
        self.assertTrue(mutations_blocked(self.journal, owner_uid=self.uid,
                                          owner_gid=self.gid))
        self.assertEqual(read_upgrade_journal(self.journal, owner_uid=self.uid,
                                              owner_gid=self.gid)["phase"], "recovery_required")

    def test_startup_refuses_switched_transaction_without_waiting_on_installer_lock(self):
        from worker_release_broker_upgrade_journal import write_upgrade_journal
        txid = "a" * 32
        switch_generation(self.root, self.new, expected_current=self.old,
                          owner_uid=self.uid, root_gid=self.gid)
        write_upgrade_journal({"version": 1, "transaction_id": txid, "phase": "switched",
                               "old_digest": self.old, "new_digest": self.new,
                               "unit": "baci-worker-release-broker.service"},
                              self.journal, owner_uid=self.uid, owner_gid=self.gid)
        control = self.control()
        with self.assertRaises(BrokerUpgradeRecoveryRequired):
            recover_before_start(self.root, control=control, journal_path=self.journal,
                                 owner_uid=self.uid, root_gid=self.gid)
        self.assertEqual(current_generation(self.root, owner_uid=self.uid,
                                            root_gid=self.gid), self.new)
        self.assertEqual(control.calls, [])
        self.assertTrue(mutations_blocked(self.journal, owner_uid=self.uid,
                                          owner_gid=self.gid))

    def test_startup_allows_only_journaled_candidate_and_keeps_mutations_blocked(self):
        from worker_release_broker_upgrade_journal import write_upgrade_journal
        txid = "b" * 32
        switch_generation(self.root, self.new, expected_current=self.old,
                          owner_uid=self.uid, root_gid=self.gid)
        write_upgrade_journal({"version": 1, "transaction_id": txid, "phase": "started",
                               "old_digest": self.old, "new_digest": self.new,
                               "unit": "baci-worker-release-broker.service"},
                              self.journal, owner_uid=self.uid, owner_gid=self.gid)
        control = self.control()
        with patch.object(control, "prove_prestart_safe", wraps=control.prove_prestart_safe) as proof:
            self.assertEqual(recover_before_start(self.root, control=control,
                                                  journal_path=self.journal,
                                                  owner_uid=self.uid, root_gid=self.gid), self.new)
            proof.assert_called_once_with()
        self.assertTrue(mutations_blocked(self.journal, owner_uid=self.uid,
                                          owner_gid=self.gid))

    def test_rollback_startup_requires_exact_prestart_proof(self):
        from worker_release_broker_upgrade_journal import write_upgrade_journal
        txid = "d" * 32
        write_upgrade_journal({"version": 1, "transaction_id": txid,
                               "phase": "rollback_starting", "old_digest": self.old,
                               "new_digest": self.new,
                               "unit": "baci-worker-release-broker.service"},
                              self.journal, owner_uid=self.uid, owner_gid=self.gid)
        with self.assertRaisesRegex(BrokerUpgradeRecoveryRequired,
                                    "prestart proof is unavailable"):
            recover_before_start(self.root, control=object(), journal_path=self.journal,
                                 owner_uid=self.uid, root_gid=self.gid)
        control = self.control()
        self.assertEqual(recover_before_start(
            self.root, control=control, journal_path=self.journal,
            owner_uid=self.uid, root_gid=self.gid), self.old)
        self.assertIn("prove-prestart-safe", control.calls)

    def test_provisioner_recovers_switched_transaction_before_installation(self):
        from worker_release_broker_upgrade_journal import write_upgrade_journal
        txid = "c" * 32
        switch_generation(self.root, self.new, expected_current=self.old,
                          owner_uid=self.uid, root_gid=self.gid)
        write_upgrade_journal({"version": 1, "transaction_id": txid, "phase": "switched",
                               "old_digest": self.old, "new_digest": self.new,
                               "unit": "baci-worker-release-broker.service"},
                              self.journal, owner_uid=self.uid, owner_gid=self.gid)
        control = self.control()
        control.journal_path = self.journal
        self.assertEqual(recover_interrupted_upgrade(
            self.root, control=control, journal_path=self.journal,
            owner_uid=self.uid, root_gid=self.gid, ready_timeout=1), self.old)
        self.assertIn(("start-journal-phase", "rollback_starting"), control.calls)
        self.assertEqual(current_generation(self.root, owner_uid=self.uid,
                                            root_gid=self.gid), self.old)
        self.assertIsNone(read_upgrade_journal(self.journal, owner_uid=self.uid,
                                               owner_gid=self.gid))

    def test_first_bootstrap_writes_fence_and_requires_exact_generation_health(self):
        control = self.control()
        control.running = False
        control.journal_path = self.journal
        self.assertEqual(bootstrap_generation(
            self.root, self.new, control=control, journal_path=self.journal,
            owner_uid=self.uid, root_gid=self.gid,
            state_root=self.state_root, state_mode=0o755,
            transaction_root=self.transaction_root, ready_timeout=1), self.new)
        self.assertEqual(current_generation(self.root, owner_uid=self.uid,
                                            root_gid=self.gid, state_root=self.state_root,
                                            state_mode=0o755), self.new)
        self.assertIn(("start-journal-phase", "bootstrap_started"), control.calls)
        self.assertEqual(control.calls[-1], ("ready", self.new))
        self.assertIsNone(read_upgrade_journal(self.journal, owner_uid=self.uid,
                                               owner_gid=self.gid))

    def test_first_bootstrap_health_failure_leaves_no_pointer_or_live_service(self):
        control = self.control(fail_new_ready=True)
        control.running = False
        with self.assertRaisesRegex(BrokerUpgradeRejected, "service left stopped"):
            bootstrap_generation(self.root, self.new, control=control,
                                 journal_path=self.journal, owner_uid=self.uid,
                                 root_gid=self.gid, state_root=self.state_root, state_mode=0o755,
                                 transaction_root=self.transaction_root, ready_timeout=1)
        self.assertIsNone(current_generation(self.root, owner_uid=self.uid,
                                             root_gid=self.gid, state_root=self.state_root,
                                             state_mode=0o755))
        self.assertFalse(control.running)
        self.assertIsNone(read_upgrade_journal(self.journal, owner_uid=self.uid,
                                               owner_gid=self.gid))

    def test_recovery_of_interrupted_first_bootstrap_removes_candidate_and_keeps_service_stopped(self):
        from worker_release_broker_upgrade_journal import write_upgrade_journal
        from worker_release_broker_upgrade import NO_PREVIOUS_GENERATION
        switch_generation(self.root, self.new, expected_current=None,
                          owner_uid=self.uid, root_gid=self.gid,
                          state_root=self.state_root, state_mode=0o755)
        txid = "e" * 32
        write_upgrade_journal({"version": 1, "transaction_id": txid,
                               "phase": "bootstrap_recovery",
                               "old_digest": NO_PREVIOUS_GENERATION,
                               "new_digest": self.new,
                               "unit": "baci-worker-release-broker.service"},
                              self.journal, owner_uid=self.uid, owner_gid=self.gid)
        control = self.control()
        self.assertIsNone(recover_interrupted_upgrade(
            self.root, control=control, journal_path=self.journal,
            owner_uid=self.uid, root_gid=self.gid, state_root=self.state_root,
            state_mode=0o755, transaction_root=self.transaction_root,
            ready_timeout=1))
        self.assertEqual(control.calls, ["stop"])
        self.assertIsNone(current_generation(self.root, owner_uid=self.uid,
                                             root_gid=self.gid, state_root=self.state_root,
                                             state_mode=0o755))
        self.assertIsNone(read_upgrade_journal(self.journal, owner_uid=self.uid,
                                               owner_gid=self.gid))


if __name__ == "__main__":
    unittest.main()
