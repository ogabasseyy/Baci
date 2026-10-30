import os
from pathlib import Path
import tempfile
import unittest
from contextlib import contextmanager

from worker_release_lifecycle import (
    AuthenticatedRun,
    LifecycleRejected,
    check_release_health,
    promote_release,
    release_lock,
    rollback_release,
)


SHA_OLD = "a" * 40
SHA_NEW = "b" * 40


class WorkerReleaseLifecycleTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.releases = self.root / "releases"
        self.releases.mkdir()
        (self.releases / SHA_OLD).mkdir()
        (self.releases / SHA_NEW).mkdir()
        self.current = self.root / "current"
        self.current.symlink_to(Path("releases") / SHA_OLD)
        self.identity = AuthenticatedRun(
            repository="ogabasseyy/Baci",
            workflow=".github/workflows/production-release.yml",
            ref="refs/heads/main",
            sha=SHA_NEW,
            run_id="1234",
            run_attempt=2,
            job_id="5678",
            status="in_progress",
        )

    def tearDown(self):
        self.temp.cleanup()

    def test_broker_identity_binds_sha_and_run_fence(self):
        value = {
            "repository": "ogabasseyy/Baci",
            "workflow": ".github/workflows/production-release.yml",
            "ref": "refs/heads/main",
            "status": "in_progress",
            "sha": SHA_NEW,
            "run_id": "1234",
            "run_attempt": 2,
            "job_id": "5678",
        }
        identity = AuthenticatedRun.from_broker(value, expected_sha=SHA_NEW)
        self.assertEqual(identity.fence()["sha"], SHA_NEW)
        with self.assertRaises(LifecycleRejected):
            AuthenticatedRun.from_broker(value, expected_sha=SHA_OLD)
        value["run_attempt"] = True
        with self.assertRaises(LifecycleRejected):
            AuthenticatedRun.from_broker(value, expected_sha=SHA_NEW)

    def test_promotion_requires_active_quiescence_lease(self):
        with self.assertRaisesRegex(LifecycleRejected, "quiescence lease is required"):
            promote_release(
                current_link=self.current,
                releases_root=self.releases,
                identity=self.identity,
                health_check=lambda _sha: True,
            )
        self.assertEqual(os.readlink(self.current), f"releases/{SHA_OLD}")

    def test_release_lock_proof_is_broker_issued_path_bound_and_context_scoped(self):
        lock_path = self.root / "release.lock"
        with release_lock(lock_path, expected_owner_uid=os.getuid()) as proof:
            proof.require_active(lock_path)
            with self.assertRaises(LifecycleRejected):
                proof.require_active(self.root / "other.lock")
        with self.assertRaisesRegex(LifecycleRejected, "inactive"):
            proof.require_active(lock_path)

    def test_release_lock_proof_cannot_be_constructed_by_callers(self):
        from worker_release_lifecycle import ReleaseLockProof

        with self.assertRaises(TypeError):
            ReleaseLockProof(object(), 0, self.root / "release.lock")

    def test_promotion_switches_pointer_only_with_active_lease(self):
        class Lease:
            active = True
            entered = 0
            @contextmanager
            def operation(self):
                self.entered += 1
                yield
            def require_active(self):
                if not self.active:
                    raise LifecycleRejected("worker quiescence lease is not active")
        lease = Lease()
        result = promote_release(
            current_link=self.current, releases_root=self.releases,
            identity=self.identity, health_check=lambda _sha: True,
            quiescence_lease=lease,
        )
        self.assertEqual(result["previous_sha"], SHA_OLD)
        self.assertEqual(os.readlink(self.current), f"releases/{SHA_NEW}")
        self.assertEqual(self.current.resolve(strict=True), self.releases.resolve() / SHA_NEW)
        self.assertEqual(lease.entered, 1, "direct lifecycle callers must enter the lease operation guard")

    def test_rollback_refuses_without_fixed_quiescence_lease(self):
        self.current.unlink()
        self.current.symlink_to(Path("releases") / SHA_NEW)
        with self.assertRaisesRegex(LifecycleRejected, "quiescence lease is required"):
            rollback_release(
                current_link=self.current,
                releases_root=self.releases,
                identity=self.identity,
                promoted_sha=SHA_NEW,
                previous_sha=SHA_OLD,
            )
        self.assertEqual(os.readlink(self.current), f"releases/{SHA_NEW}")

    def test_rollback_restores_only_authenticated_current_release_with_active_lease(self):
        class Lease:
            @contextmanager
            def operation(self):
                yield
            def require_active(self):
                return None
        self.current.unlink()
        self.current.symlink_to(Path("releases") / SHA_NEW)
        result = rollback_release(
            current_link=self.current, releases_root=self.releases,
            identity=self.identity, promoted_sha=SHA_NEW, previous_sha=SHA_OLD,
            quiescence_lease=Lease(),
        )
        self.assertEqual(result["sha"], SHA_OLD)
        self.assertEqual(os.readlink(self.current), f"releases/{SHA_OLD}")

    def test_health_requires_authenticated_sha_to_remain_current(self):
        self.current.unlink()
        self.current.symlink_to(Path("releases") / SHA_NEW)
        result = check_release_health(
            current_link=self.current,
            releases_root=self.releases,
            identity=self.identity,
            health_check=lambda _sha: True,
        )
        self.assertTrue(result["healthy"])
        self.current.unlink()
        self.current.symlink_to(Path("releases") / SHA_OLD)
        with self.assertRaises(LifecycleRejected):
            check_release_health(
                current_link=self.current,
                releases_root=self.releases,
                identity=self.identity,
                health_check=lambda _sha: True,
            )

    def test_lock_is_exclusive_and_rejects_symlink(self):
        lock_path = self.root / "release.lock"
        with release_lock(lock_path, expected_owner_uid=os.geteuid()):
            with self.assertRaises(LifecycleRejected):
                with release_lock(lock_path, expected_owner_uid=os.geteuid()):
                    pass
        lock_path.unlink()
        lock_path.symlink_to(self.root / "other")
        with self.assertRaises(OSError):
            with release_lock(lock_path, expected_owner_uid=os.geteuid()):
                pass

    def test_bare_sha_pointer_is_rejected(self):
        self.current.unlink()
        self.current.symlink_to(SHA_OLD)
        with self.assertRaisesRegex(LifecycleRejected, "pointer is invalid"):
            check_release_health(
                current_link=self.current,
                releases_root=self.releases,
                identity=self.identity,
                health_check=lambda _sha: True,
            )


if __name__ == "__main__":
    unittest.main()
