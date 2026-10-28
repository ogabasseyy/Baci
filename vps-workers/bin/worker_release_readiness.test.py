#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import json
import os
import stat
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


SCRIPT = Path(__file__).with_name("worker_release_readiness.py")
SPEC = importlib.util.spec_from_file_location("worker_release_readiness", SCRIPT)
assert SPEC and SPEC.loader
readiness = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(readiness)


SHA = "a" * 40


class WorkerReleaseReadinessTests(unittest.TestCase):
    def fixture(self, base: Path):
        root = base / "srv" / "baci-workers"
        release = root / "releases" / SHA
        release.mkdir(parents=True)
        os.chmod(root, 0o710)
        os.chmod(root / "releases", 0o750)
        os.chmod(release, 0o550)
        (root / "current").symlink_to(SHA)
        (root / "release-state.json").write_text(json.dumps({"version": 1, "status": "healthy", "sha": SHA}), encoding="utf-8")
        os.chmod(root / "release-state.json", 0o600)
        return root

    def fake_runner(self, *, legacy_cron: str = "", inactive_timer: str | None = None):
        def run(command, **_kwargs):
            if command[0] == "/usr/bin/crontab":
                return subprocess.CompletedProcess(command, 0, legacy_cron, "")
            unit = command[-1]
            if unit in readiness.TIMER_UNITS:
                service = readiness.TIMER_UNITS[unit]
                output = (
                    f"LoadState=loaded\nActiveState={'inactive' if unit == inactive_timer else 'active'}\nUnitFileState=enabled\n"
                    f"FragmentPath=/etc/systemd/system/{unit}\nUnit={service}\n"
                    f"TimersCalendar={readiness.TIMER_SCHEDULES[unit]}\n"
                )
            else:
                active = "inactive" if unit == "baci-cache-invalidation-drain.service" else "active"
                profile = readiness.LONG_RUNNING_PROFILES.get(unit, ("", ""))[0]
                output = (
                    f"LoadState=loaded\nActiveState={active}\nUnitFileState=static\n"
                    f"FragmentPath=/etc/systemd/system/{unit}\nUser=baci-worker\nGroup=baci-worker\n"
                    f"WorkingDirectory={readiness.WORKER_ROOT}/current\n"
                    f"ExecStart={{ path={readiness.WORKER_ROOT}/current/bin/{readiness.LONG_RUNNING_PROFILES.get(unit, ('', 'job'))[1]} }}\n"
                    f"Environment=HOME={readiness.WORKER_ROOT}/home NODE_ENV=production BACI_WORKER_PROFILE={profile} "
                    f"BACI_REPO_DIR={readiness.WORKER_ROOT}/current BACI_WORKER_ENV={readiness.WORKER_ROOT}/runtime/worker.env"
                    + (" GIGL_ENV_FILE_AUTHORITATIVE=1" if unit == "baci-gigl-tracking.service" else "")
                    + "\n"
                )
            return subprocess.CompletedProcess(command, 0, output, "")
        return run

    def test_returns_only_safe_metadata_when_exact_release_and_units_are_ready(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = self.fixture(Path(temporary))
            with patch.object(readiness, "WORKER_ROOT", root):
                result = readiness.collect_worker_readiness(SHA, runner=self.fake_runner(), root=root, owner_uid=os.getuid(), worker_gid=os.getgid(), lock_gid=os.getgid())
            self.assertEqual(result, {
                "ready": True,
                "installedSha": SHA,
                "units": [
                    "baci-domain-event-router.service", "baci-event-delivery-worker.service",
                    "baci-quiz-finalization.service", "baci-gigl-tracking.service",
                    "baci-gigl-tracking.timer", "baci-cache-invalidation-drain.service",
                    "baci-cache-invalidation-drain.timer",
                ],
            })
            self.assertNotIn("worker.env", json.dumps(result))

    def test_rejects_bad_sha_or_release_pointer_mismatch(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = self.fixture(Path(temporary))
            with self.assertRaisesRegex(readiness.ReadinessRejected, "SHA is invalid"):
                readiness.collect_worker_readiness("not-a-sha", root=root)
            with self.assertRaisesRegex(readiness.ReadinessRejected, "pointer is invalid"):
                readiness.collect_worker_readiness("b" * 40, root=root, owner_uid=os.getuid(), worker_gid=os.getgid(), lock_gid=os.getgid())

    def test_rejects_inactive_timer_or_legacy_cron_even_when_release_is_healthy(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = self.fixture(Path(temporary))
            with patch.object(readiness, "WORKER_ROOT", root):
                with self.assertRaisesRegex(readiness.ReadinessRejected, "timer is inactive"):
                    readiness.collect_worker_readiness(SHA, runner=self.fake_runner(inactive_timer="baci-cache-invalidation-drain.timer"), root=root, owner_uid=os.getuid(), worker_gid=os.getgid(), lock_gid=os.getgid())

    def test_rejects_legacy_pollers_in_crontab(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = self.fixture(Path(temporary))
            runner = self.fake_runner(legacy_cron="*/5 * * * * /home/bassey/baci-workers/bin/process-gigl-tracking.sh\n")
            with patch.object(readiness, "WORKER_ROOT", root):
                with self.assertRaisesRegex(readiness.ReadinessRejected, "legacy worker poller"):
                    readiness.collect_worker_readiness(SHA, runner=runner, root=root, owner_uid=os.getuid(), worker_gid=os.getgid(), lock_gid=os.getgid())

    def test_rejects_each_legacy_event_and_quiz_schedule_alongside_healthy_system_units(self):
        legacy_rows = (
            "* * * * * flock -n /srv/baci-workers/locks/process-domain-events.lock /srv/baci-workers/current/bin/process-domain-events.sh --once",
            "* * * * * flock -n /srv/baci-workers/locks/process-event-deliveries.lock /srv/baci-workers/current/bin/process-event-deliveries.sh --once",
            "* * * * * flock -n /srv/baci-workers/locks/quiz-finalize.lock /srv/baci-workers/current/bin/process-quiz-finalization.sh --once",
            "* * * * * node /srv/baci-workers/current/jobs/run-web-cron.mjs /api/quiz/finalize",
        )
        for row in legacy_rows:
            with self.subTest(row=row), tempfile.TemporaryDirectory() as temporary:
                root = self.fixture(Path(temporary))
                runner = self.fake_runner(legacy_cron=f"# retired example\n{row}\n")
                with patch.object(readiness, "WORKER_ROOT", root):
                    with self.assertRaisesRegex(readiness.ReadinessRejected, "event/quiz schedule remains active"):
                        readiness.collect_worker_readiness(SHA, runner=runner, root=root, owner_uid=os.getuid(), worker_gid=os.getgid(), lock_gid=os.getgid())

    def test_ignores_comment_only_legacy_schedule_examples(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = self.fixture(Path(temporary))
            runner = self.fake_runner(legacy_cron="# /bin/process-domain-events.sh\n# /bin/process-quiz-finalization.sh\n")
            with patch.object(readiness, "WORKER_ROOT", root):
                result = readiness.collect_worker_readiness(SHA, runner=runner, root=root, owner_uid=os.getuid(), worker_gid=os.getgid(), lock_gid=os.getgid())
            self.assertTrue(result["ready"])

    def test_rejects_misconfigured_unit_identity_and_non_healthy_state(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = self.fixture(Path(temporary))
            with patch.object(readiness, "WORKER_ROOT", root):
                def wrong_identity(command, **kwargs):
                    result = self.fake_runner()(command, **kwargs)
                    if command[-1] == "baci-domain-event-router.service":
                        result.stdout = result.stdout.replace("User=baci-worker", "User=bassey")
                    return result
                with self.assertRaisesRegex(readiness.ReadinessRejected, "inactive or misconfigured"):
                    readiness.collect_worker_readiness(SHA, runner=wrong_identity, root=root, owner_uid=os.getuid(), worker_gid=os.getgid(), lock_gid=os.getgid())

            (root / "release-state.json").write_text(json.dumps({"version": 1, "status": "promoted", "sha": SHA}), encoding="utf-8")
            os.chmod(root / "release-state.json", 0o600)
            with self.assertRaisesRegex(readiness.ReadinessRejected, "does not prove healthy"):
                readiness.collect_worker_readiness(SHA, runner=self.fake_runner(), root=root, owner_uid=os.getuid(), worker_gid=os.getgid(), lock_gid=os.getgid())

    def test_rejects_wrong_runtime_environment_file_or_profile_for_each_long_running_service(self):
        for unit in readiness.LONG_RUNNING_UNITS:
            for property_name, old, new in (
                ("BACI_WORKER_ENV", "/runtime/worker.env", "/home/bassey/.env"),
                ("BACI_WORKER_PROFILE", readiness.LONG_RUNNING_PROFILES[unit][0], "gigl-tracking"),
            ):
                with self.subTest(unit=unit, property=property_name), tempfile.TemporaryDirectory() as temporary:
                    root = self.fixture(Path(temporary))

                    def wrong_runtime(command, **kwargs):
                        result = self.fake_runner()(command, **kwargs)
                        if command[-1] == unit:
                            if property_name == "BACI_WORKER_ENV":
                                result.stdout = result.stdout.replace(
                                    f"BACI_WORKER_ENV={readiness.WORKER_ROOT}/runtime/worker.env",
                                    f"BACI_WORKER_ENV={readiness.WORKER_ROOT}{new}",
                                )
                            else:
                                result.stdout = result.stdout.replace(
                                    f"BACI_WORKER_PROFILE={old}", f"BACI_WORKER_PROFILE={new}"
                                )
                        return result

                    with patch.object(readiness, "WORKER_ROOT", root):
                        with self.assertRaisesRegex(readiness.ReadinessRejected, "environment or profile"):
                            readiness.collect_worker_readiness(
                                SHA, runner=wrong_runtime, root=root, owner_uid=os.getuid(),
                                worker_gid=os.getgid(), lock_gid=os.getgid(),
                            )


if __name__ == "__main__":
    unittest.main()
