import unittest

import worker_release_broker  # Initialize the broker facade before its dispatcher.
from worker_release_broker_dispatch import _health_after_restart


class HealthAfterRestartTests(unittest.TestCase):
    def test_probe_observes_restarted_services(self):
        events = []

        class Lease:
            def require_active(self):
                events.append("active")

            def release(self):
                events.append("services restarted")

        def probe():
            self.assertEqual(events, ["active", "services restarted"])
            return {"healthy": True}

        self.assertEqual(_health_after_restart(Lease(), probe), {"healthy": True})

    def test_failed_cleanup_never_runs_health_probe(self):
        class Lease:
            def require_active(self):
                pass

            def release(self):
                raise RuntimeError("cleanup failed")

        def probe():
            self.fail("probe must not run before confirmed restart")

        with self.assertRaisesRegex(RuntimeError, "cleanup failed"):
            _health_after_restart(Lease(), probe)


if __name__ == "__main__":
    unittest.main()
