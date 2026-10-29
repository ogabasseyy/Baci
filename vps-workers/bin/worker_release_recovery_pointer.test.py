"""Real pointer behavior for the broker's interrupted-recovery path."""
from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from contextlib import nullcontext

import worker_release_broker as broker
from worker_release_recovery_dispatch import recover, recovery_target

SHA_OLD = "a" * 40
SHA_PRIOR = "b" * 40
SHA_NEW = "c" * 40
FENCE = {"run_id": "101", "run_attempt": 1, "sha": SHA_OLD}
STATE = {
    "sha": SHA_OLD,
    "previous_sha": SHA_PRIOR,
    "status": "recovery_required",
    "fence": {**FENCE, "job_id": "9001"},
}


class Lease:
    def operation(self):
        return nullcontext()

    def require_active(self):
        pass

    def confirm_rollback(self):
        pass


class Quiescence:
    def recovery_latch(self):
        return {
            "fence": FENCE,
            "job_id": "9001",
            "previous_sha": SHA_PRIOR,
            "release_sha": SHA_OLD,
            "service_snapshot_complete": True,
            "services_to_restore": ["baci-domain-event-router", "baci-event-delivery-worker",
                                    "baci-quiz-finalization"],
        }

    def acquire(self, _fence, **_kwargs):
        return Lease()


class Identity:
    def fence(self):
        return {"run_id": "202", "run_attempt": 1, "sha": SHA_NEW, "job_id": "9002"}


class CurrentOwnerIdentity:
    def __init__(self, job_id="9001"):
        self.job_id = job_id

    def fence(self):
        return {**FENCE, "job_id": self.job_id}


class CurrentOwnerQuiescence(Quiescence):
    def acquire(self, _fence, **kwargs):
        self.acquire_kwargs = kwargs
        return Lease()


def _recover(current_sha: str, root: Path):
    releases = root / "releases"
    releases.mkdir()
    for sha in (SHA_OLD, SHA_PRIOR, current_sha):
        (releases / sha).mkdir(exist_ok=True)
    current = root / "current"
    current.symlink_to(f"releases/{current_sha}")
    latch = Quiescence().recovery_latch()
    verified = {
        "sourceSha": SHA_NEW,
        "runId": "202",
        "runAttempt": 1,
        "jobId": "9002",
        "recoveryOf": recovery_target(latch),
    }
    return current, patch.object(broker, "_load_release_state", return_value=STATE), verified


class RecoveryPointerTests(unittest.TestCase):
    def test_same_active_owner_recovers_without_terminal_target_but_exact_job_is_required(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            releases = root / "releases"
            releases.mkdir()
            for sha in (SHA_OLD, SHA_PRIOR):
                (releases / sha).mkdir()
            current = root / "current"
            current.symlink_to(f"releases/{SHA_OLD}")
            quiescence = CurrentOwnerQuiescence()
            verified = {"sourceSha": SHA_OLD, "runId": "101", "runAttempt": 1, "jobId": "9001"}
            with patch.object(broker, "_load_release_state", return_value=STATE), \
                 patch("worker_release_lifecycle.release_lock", return_value=nullcontext()), \
                 patch.object(broker, "_record_promotion_failure") as record:
                result = recover(
                    verified=verified, identity=CurrentOwnerIdentity(), quiescence=quiescence,
                    current_link=str(current), releases_root=str(releases),
                    lock_path="unused", state_path="unused",
                )
            self.assertEqual(os.readlink(current), f"releases/{SHA_PRIOR}")
            self.assertTrue(result["alreadyRestored"] is False)
            self.assertIsNone(quiescence.acquire_kwargs["takeover_from"])
            record.assert_called_once()

            with patch.object(broker, "_load_release_state", return_value=STATE), \
                 patch("worker_release_lifecycle.release_lock", return_value=nullcontext()):
                with self.assertRaisesRegex(broker.BrokerProtocolError, "does not match the durable recovery owner"):
                    recover(
                        verified={**verified, "jobId": "9003"}, identity=CurrentOwnerIdentity("9003"),
                        quiescence=quiescence, current_link=str(current), releases_root=str(releases),
                        lock_path="unused", state_path="unused",
                    )

    def test_unmocked_restore_moves_candidate_pointer_to_recorded_prior(self):
        with tempfile.TemporaryDirectory() as directory:
            current, state_patch, verified = _recover(SHA_OLD, Path(directory))
            with state_patch, patch("worker_release_lifecycle.release_lock", return_value=nullcontext()), \
                 patch.object(broker, "_record_promotion_failure"):
                result = recover(
                    verified=verified, identity=Identity(), quiescence=Quiescence(),
                    current_link=str(current), releases_root=str(Path(directory) / "releases"),
                    lock_path="unused", state_path="unused",
                )
            self.assertEqual(os.readlink(current), f"releases/{SHA_PRIOR}")
        self.assertFalse(result["alreadyRestored"])
        self.assertEqual(result["rolledBackSha"], SHA_OLD)
        self.assertEqual(result["previousSha"], SHA_PRIOR)

    def test_unmocked_restore_refuses_unrelated_pointer_without_state_write(self):
        unrelated = "d" * 40
        with tempfile.TemporaryDirectory() as directory:
            current, state_patch, verified = _recover(unrelated, Path(directory))
            with state_patch, patch("worker_release_lifecycle.release_lock", return_value=nullcontext()), \
                 patch.object(broker, "_record_promotion_failure") as record:
                with self.assertRaisesRegex(broker.BrokerProtocolError, "active release does not match"):
                    recover(
                        verified=verified, identity=Identity(), quiescence=Quiescence(),
                        current_link=str(current), releases_root=str(Path(directory) / "releases"),
                        lock_path="unused", state_path="unused",
                    )
            self.assertEqual(os.readlink(current), f"releases/{unrelated}")
        record.assert_not_called()


if __name__ == "__main__":
    unittest.main()
