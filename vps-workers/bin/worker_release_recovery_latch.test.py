import json
import os
from pathlib import Path
import tempfile
import unittest

from worker_release_recovery_latch import (
    LatchError, clear_latch, create_latch, load_latch, service_allowed, update_latch,
)
from worker_release_quiesce_gate import HealthGateServer


FENCE = {"run_id": "1234", "run_attempt": 2, "sha": "a" * 40}
PRIOR = "b" * 40
SERVICES = ("baci-domain-event-router", "baci-event-delivery-worker", "baci-quiz-finalization")


class RecoveryLatchTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.root.chmod(0o710)
        self.uid, self.gid = os.geteuid(), os.getegid()
        self.locks = self.root / "locks"
        self.locks.mkdir()
        self.locks.chmod(0o710)
        self.latch = self.locks / "release-recovery-latch.json"
        self.socket = self.root / "health.sock"
        self.state = self.root / "release-state.json"
        self.gate = None

    def tearDown(self):
        if self.gate:
            self.gate.close()
        self.temp.cleanup()

    def write_state(self, status, *, fence=FENCE):
        self.state.write_text(json.dumps({
            "version": 1, "status": status, "sha": FENCE["sha"],
            "previous_sha": PRIOR, "fence": fence,
        }), encoding="utf-8")
        self.state.chmod(0o600)

    def make_latch(self):
        return create_latch(FENCE, PRIOR, path=self.latch, uid=self.uid, gid=self.gid)

    def test_latch_blocks_scheduled_and_unit_starts_without_live_broker(self):
        self.make_latch()
        self.assertFalse(service_allowed("scheduled", path=self.latch, uid=self.uid, gid=self.gid))
        self.assertFalse(service_allowed("baci-domain-event-router", path=self.latch,
                                         socket_path=self.socket, uid=self.uid, gid=self.gid))
        self.assertEqual(load_latch(self.latch, uid=self.uid, gid=self.gid)["phase"], "quiescing")

    def test_repeated_terminal_takeovers_preserve_original_candidate_and_owner(self):
        original = create_latch(FENCE, PRIOR, path=self.latch, job_id="7001",
                                uid=self.uid, gid=self.gid)
        first_fence = {"run_id": "2234", "run_attempt": 1, "sha": "c" * 40}
        first = create_latch(first_fence, PRIOR, path=self.latch, recovery=True,
                             takeover_from=original["fence"], job_id="7002",
                             uid=self.uid, gid=self.gid)
        second_fence = {"run_id": "3234", "run_attempt": 1, "sha": "d" * 40}
        second = create_latch(second_fence, PRIOR, path=self.latch, recovery=True,
                              takeover_from=first["fence"], job_id="7003",
                              uid=self.uid, gid=self.gid)
        self.assertEqual(second["release_sha"], FENCE["sha"])
        self.assertEqual(second["recovered_from"], FENCE)
        self.assertEqual(second["recovered_from_job_id"], "7001")
        self.assertEqual(second["fence"], second_fence)

    def test_post_swap_health_phase_requires_live_same_process_gate(self):
        self.make_latch()
        releases = self.root / "releases"
        releases.mkdir()
        for sha in (PRIOR, FENCE["sha"]):
            (releases / sha).mkdir()
        current = self.root / "current"
        os.symlink(f"releases/{PRIOR}", current)
        self.write_state("promoting")

        # Crash immediately before pointer replacement: all launch paths deny.
        self.assertFalse(service_allowed("scheduled", path=self.latch, uid=self.uid, gid=self.gid))
        self.assertFalse(service_allowed("baci-domain-event-router", path=self.latch,
                                         socket_path=self.socket, uid=self.uid, gid=self.gid))

        # Simulate atomic promotion followed by broker death before health receipt.
        temp_link = self.root / ".current.tmp"
        os.symlink(f"releases/{FENCE['sha']}", temp_link)
        os.replace(temp_link, current)
        self.assertEqual(os.readlink(current), f"releases/{FENCE['sha']}")
        update_latch(path=self.latch, phase="health_probe", service_active=SERVICES[0],
                     uid=self.uid, gid=self.gid)
        self.assertFalse(service_allowed("baci-domain-event-router", path=self.latch,
                                         socket_path=self.socket, uid=self.uid, gid=self.gid))

        alive = {"value": True}
        self.gate = HealthGateServer(
            worker_uid=self.uid, worker_gid=self.gid, owner_uid=self.uid,
            path=self.socket, authorize=lambda unit: alive["value"] and unit in SERVICES,
        )
        self.gate.start()
        self.assertTrue(service_allowed("baci-domain-event-router", path=self.latch,
                                        socket_path=self.socket, uid=self.uid, gid=self.gid))
        self.gate.close()
        self.gate = None
        alive["value"] = False
        self.assertFalse(service_allowed("baci-domain-event-router", path=self.latch,
                                         socket_path=self.socket, uid=self.uid, gid=self.gid))
        self.assertFalse(service_allowed("scheduled", path=self.latch, uid=self.uid, gid=self.gid))

    def test_cleanup_failure_keeps_latch_and_rollback_requires_durable_state(self):
        self.make_latch()
        self.write_state("healthy", fence={**FENCE, "run_id": "1235"})
        with self.assertRaisesRegex(LatchError, "cannot be confirmed"):
            clear_latch(path=self.latch, fence=FENCE, state_path=self.state,
                        uid=self.uid, gid=self.gid, state_gid=self.gid)
        self.assertIsNotNone(load_latch(self.latch, uid=self.uid, gid=self.gid))
        self.assertFalse(service_allowed("scheduled", path=self.latch, uid=self.uid, gid=self.gid))

        self.write_state("rolled_back")
        update_latch(path=self.latch, phase="restore", service_active=SERVICES[0],
                     uid=self.uid, gid=self.gid)
        alive = {"value": True}
        self.gate = HealthGateServer(
            worker_uid=self.uid, worker_gid=self.gid, owner_uid=self.uid,
            path=self.socket, authorize=lambda unit: alive["value"] and unit == SERVICES[0],
        )
        self.gate.start()
        self.assertTrue(service_allowed(SERVICES[0], path=self.latch, socket_path=self.socket,
                                        uid=self.uid, gid=self.gid))
        self.assertFalse(service_allowed(SERVICES[1], path=self.latch, socket_path=self.socket,
                                         uid=self.uid, gid=self.gid))
        clear_latch(path=self.latch, fence=FENCE, state_path=self.state,
                    uid=self.uid, gid=self.gid, state_gid=self.gid)
        self.assertTrue(service_allowed("scheduled", path=self.latch, uid=self.uid, gid=self.gid))


if __name__ == "__main__":
    unittest.main()
