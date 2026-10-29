"""Contract tests for status and owner selection in automatic recovery."""
from __future__ import annotations

import unittest
import os
import tempfile
from pathlib import Path
from unittest.mock import patch

import worker_release_broker as broker
from worker_release_recovery_dispatch import recover, recovery_target, status


SHA_OLD = "a" * 40
SHA_PREVIOUS = "b" * 40
SHA_NEW = "c" * 40


def latch(*, recovered: bool = False):
    original = {"run_id": "101", "run_attempt": 1, "sha": SHA_OLD}
    value = {
        "fence": {"run_id": "202", "run_attempt": 1, "sha": SHA_NEW} if recovered else original,
        "job_id": "9002" if recovered else "9001",
        "previous_sha": SHA_PREVIOUS,
        "release_sha": SHA_OLD,
        "service_snapshot_complete": True,
        "services_to_restore": ["baci-domain-event-router", "baci-event-delivery-worker", "baci-quiz-finalization"],
    }
    if recovered:
        value["recovered_from"] = original
        value["recovered_from_job_id"] = "9001"
    return value


class FakeQuiescence:
    def __init__(self, value):
        self.value = value

    def recovery_latch(self):
        return self.value

    def acquire(self, fence, **kwargs):
        self.acquired = (fence, kwargs)
        return FakeLease()


class FakeLease:
    def operation(self):
        from contextlib import nullcontext
        return nullcontext()

    def confirm_rollback(self):
        self.confirmed = True

    def require_active(self):
        return None


class FakeIdentity:
    def __init__(self, run_id="202", sha=SHA_NEW, job_id="9002"):
        self.value = {"run_id": run_id, "run_attempt": 1, "sha": sha, "job_id": job_id}

    def fence(self):
        return self.value


class RecoveryDispatchTests(unittest.TestCase):
    def test_target_preserves_original_owner_after_one_or_more_takeovers(self):
        original = recovery_target(latch())
        recovered = recovery_target(latch(recovered=True))
        self.assertEqual(original, {
            "run_id": "101", "run_attempt": 1, "sha": SHA_OLD, "job_id": "9001"
        })
        self.assertEqual(recovered, original)

    def test_recovery_target_rejects_invalid_run_attempt_before_conversion(self):
        for attempt in (None, "1", True, False, 0, -1, 1.5):
            with self.subTest(attempt=attempt):
                value = latch()
                value["fence"]["run_attempt"] = attempt
                with self.assertRaises(broker.BrokerProtocolError):
                    recovery_target(value)

    def test_status_returns_exact_candidate_and_recovery_owner(self):
        value = latch(recovered=True)
        state = {
            "sha": SHA_OLD,
            "previous_sha": SHA_PREVIOUS,
            "status": "recovery_required",
            "fence": {"run_id": "202", "run_attempt": 1, "sha": SHA_NEW, "job_id": "9002"},
        }
        with patch.object(broker, "_load_release_state", return_value=state):
            receipt = status(source_sha=SHA_NEW, quiescence=FakeQuiescence(value), state_path="ignored",
                             identity=FakeIdentity())
        self.assertEqual(receipt["recoveryOf"], {
            "run_id": "101", "run_attempt": 1, "sha": SHA_OLD, "job_id": "9001"
        })
        self.assertEqual(receipt["recoveryOwner"], {
            "run_id": "202", "run_attempt": 1, "sha": SHA_NEW, "job_id": "9002"
        })
        self.assertEqual(receipt["previousSha"], SHA_PREVIOUS)
        self.assertTrue(receipt["currentOwner"])

    def test_status_current_owner_requires_exact_authenticated_job_id(self):
        value = latch(recovered=True)
        state = {"sha": SHA_OLD, "previous_sha": SHA_PREVIOUS, "status": "recovery_required",
                 "fence": {"run_id": "202", "run_attempt": 1, "sha": SHA_NEW, "job_id": "9002"}}
        with patch.object(broker, "_load_release_state", return_value=state):
            exact = status(source_sha=SHA_NEW, quiescence=FakeQuiescence(value), state_path="ignored",
                           identity=FakeIdentity(job_id="9002"))
            other_job = status(source_sha=SHA_NEW, quiescence=FakeQuiescence(value), state_path="ignored",
                               identity=FakeIdentity(job_id="9003"))
        self.assertTrue(exact["currentOwner"])
        self.assertFalse(other_job["currentOwner"])

    def test_latch_before_promoting_state_is_validated_as_pre_promotion_journal(self):
        value = latch()
        prior_state = {
            "sha": SHA_PREVIOUS,
            "previous_sha": "e" * 40,
            "status": "healthy",
            "fence": {"run_id": "88", "run_attempt": 1, "sha": SHA_PREVIOUS},
        }
        with patch.object(broker, "_load_release_state", return_value=prior_state):
            receipt = status(source_sha=SHA_NEW, quiescence=FakeQuiescence(value), state_path="ignored",
                             identity=FakeIdentity())
        self.assertTrue(receipt["pending"])
        self.assertEqual(receipt["recoveryOf"]["sha"], SHA_OLD)
        self.assertEqual(receipt["previousSha"], SHA_PREVIOUS)

    def test_rolled_back_prior_state_uses_restored_sha_when_new_promotion_latch_precedes_state(self):
        value = {
            "fence": {"run_id": "202", "run_attempt": 1, "sha": SHA_NEW},
            "job_id": "9002", "previous_sha": SHA_PREVIOUS,
            "release_sha": SHA_NEW, "service_snapshot_complete": True,
            "services_to_restore": ["baci-domain-event-router", "baci-event-delivery-worker",
                                    "baci-quiz-finalization"],
        }
        old_fence = {"run_id": "101", "run_attempt": 1, "sha": SHA_OLD, "job_id": "9001"}
        persisted = {}
        with patch.object(broker, "_write_release_state",
                          side_effect=lambda _path, state: persisted.update(state)):
            broker._record_promotion_failure("unused", SHA_OLD, SHA_PREVIOUS, old_fence, restored=True)
        prior_state = dict(persisted)
        self.assertEqual(prior_state["status"], "rolled_back")
        self.assertEqual(prior_state["sha"], SHA_OLD)
        self.assertEqual(prior_state["previous_sha"], SHA_PREVIOUS)

        with patch.object(broker, "_load_release_state", return_value=prior_state):
            receipt = status(source_sha=SHA_NEW, quiescence=FakeQuiescence(value), state_path="ignored",
                             identity=FakeIdentity())
        self.assertTrue(receipt["pending"])
        self.assertEqual(receipt["recoveryOf"]["sha"], SHA_NEW)
        self.assertEqual(receipt["previousSha"], SHA_PREVIOUS)

        from contextlib import nullcontext
        quiescence = FakeQuiescence(value)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            releases = root / "releases"
            releases.mkdir()
            (releases / SHA_PREVIOUS).mkdir()
            current = root / "current"
            current.symlink_to(f"releases/{SHA_PREVIOUS}")
            with patch.object(broker, "_load_release_state", return_value=prior_state), \
                 patch("worker_release_lifecycle.release_lock", return_value=nullcontext()), \
                 patch.object(broker, "_record_promotion_failure") as record:
                recovered = recover(
                    verified={"sourceSha": SHA_NEW, "runId": "303", "runAttempt": 1,
                              "jobId": "9003", "recoveryOf": recovery_target(value)},
                    identity=FakeIdentity("303", SHA_NEW, "9003"), quiescence=quiescence,
                    current_link=str(current), releases_root=str(releases),
                    lock_path="unused/release.lock", state_path="unused/state",
                )
            self.assertEqual(os.readlink(current), f"releases/{SHA_PREVIOUS}")
        self.assertTrue(recovered["alreadyRestored"])
        self.assertEqual(recovered["previousSha"], SHA_PREVIOUS)
        record.assert_called_once()

    def test_recovery_recovers_pre_promotion_state_after_terminal_proof(self):
        from contextlib import nullcontext
        value = latch()
        prior_state = {
            "sha": SHA_PREVIOUS,
            "previous_sha": "e" * 40,
            "status": "healthy",
            "fence": {"run_id": "88", "run_attempt": 1, "sha": SHA_PREVIOUS},
        }
        quiescence = FakeQuiescence(value)
        restore = {"sha": SHA_PREVIOUS, "alreadyRestored": True}
        with patch.object(broker, "_load_release_state", return_value=prior_state), \
             patch("worker_release_lifecycle.release_lock", return_value=nullcontext()), \
             patch("worker_release_recovery_lifecycle.restore_recorded_prior", return_value=restore), \
             patch.object(broker, "_record_promotion_failure") as record:
            receipt = recover(
                verified={"sourceSha": SHA_NEW, "runId": "202", "runAttempt": 1,
                          "jobId": "9002", "recoveryOf": recovery_target(value)},
                identity=FakeIdentity(), quiescence=quiescence,
                current_link="unused/current", releases_root="unused/releases",
                lock_path="unused/release.lock", state_path="unused/state",
            )
        self.assertTrue(receipt["recovered"])
        self.assertEqual(receipt["rolledBackSha"], SHA_OLD)
        self.assertEqual(receipt["previousSha"], SHA_PREVIOUS)
        self.assertEqual(quiescence.acquired[1]["takeover_from"], value["fence"])
        record.assert_called_once()

    def test_same_sha_redeploy_crash_after_latch_is_idempotently_recovered(self):
        from contextlib import nullcontext

        value = {
            "fence": {"run_id": "101", "run_attempt": 1, "sha": SHA_PREVIOUS},
            "job_id": "9001", "previous_sha": SHA_PREVIOUS,
            "release_sha": SHA_PREVIOUS,
            "service_snapshot_complete": True,
            "services_to_restore": ["baci-domain-event-router", "baci-event-delivery-worker", "baci-quiz-finalization"],
        }
        prior_state = {
            "sha": SHA_PREVIOUS, "previous_sha": "e" * 40, "status": "healthy",
            "fence": {"run_id": "88", "run_attempt": 1, "sha": SHA_PREVIOUS},
        }
        quiescence = FakeQuiescence(value)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            releases = root / "releases"
            releases.mkdir()
            (releases / SHA_PREVIOUS).mkdir()
            current = root / "current"
            current.symlink_to(f"releases/{SHA_PREVIOUS}")
            with patch.object(broker, "_load_release_state", return_value=prior_state), \
                 patch("worker_release_lifecycle.release_lock", return_value=nullcontext()), \
                 patch.object(broker, "_record_promotion_failure") as record:
                receipt = recover(
                    verified={"sourceSha": SHA_PREVIOUS, "runId": "303", "runAttempt": 1,
                              "jobId": "9003", "recoveryOf": recovery_target(value)},
                    identity=FakeIdentity("303", SHA_PREVIOUS, "9003"), quiescence=quiescence,
                    current_link=str(current), releases_root=str(releases),
                    lock_path="unused/release.lock", state_path="unused/state",
                )
            self.assertTrue(receipt["alreadyRestored"])
            self.assertEqual(os.readlink(current), f"releases/{SHA_PREVIOUS}")
            self.assertEqual(receipt["rolledBackSha"], SHA_PREVIOUS)
            record.assert_called_once()

    def test_status_fails_closed_when_state_or_latch_disagree(self):
        value = latch()
        mismatched = {
            "sha": SHA_OLD, "previous_sha": "d" * 40,
            "fence": {"run_id": "101", "run_attempt": 1, "sha": SHA_OLD, "job_id": "9001"},
        }
        with patch.object(broker, "_load_release_state", return_value=mismatched):
            with self.assertRaises(broker.BrokerProtocolError):
                status(source_sha=SHA_NEW, quiescence=FakeQuiescence(value), state_path="ignored",
                       identity=FakeIdentity())

    def test_incomplete_legacy_snapshot_blocks_automatic_recovery(self):
        value = latch()
        value["service_snapshot_complete"] = False
        with patch.object(broker, "_load_release_state", return_value={
            "sha": SHA_OLD, "previous_sha": SHA_PREVIOUS,
            "fence": {"run_id": "101", "run_attempt": 1, "sha": SHA_OLD, "job_id": "9001"},
        }):
            with self.assertRaisesRegex(broker.BrokerProtocolError, "complete service restoration snapshot"):
                status(source_sha=SHA_NEW, quiescence=FakeQuiescence(value), state_path="ignored",
                       identity=FakeIdentity())

    def test_missing_latch_with_unresolved_state_fails_closed(self):
        with patch.object(broker, "_load_release_state", return_value={"status": "promoting"}):
            with self.assertRaises(broker.BrokerProtocolError):
                status(source_sha=SHA_NEW, quiescence=FakeQuiescence(None), state_path="ignored",
                       identity=FakeIdentity())


if __name__ == "__main__":
    unittest.main()
