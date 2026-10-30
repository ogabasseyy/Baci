from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


SCRIPT = Path(__file__).with_name("worker-release-health-check")
SHA = "a" * 40
SERVICES = (
    "baci-domain-event-router",
    "baci-event-delivery-worker",
    "baci-quiz-finalization",
)


FAKE_SYSTEMCTL = r'''#!/usr/bin/env python3
import json
import os
from pathlib import Path
import sys

state_path = Path(os.environ["FAKE_SYSTEMCTL_STATE"])
mode = os.environ["FAKE_SYSTEMCTL_MODE"]
state = json.loads(state_path.read_text()) if state_path.exists() else {"active": {}, "show": {}}
args = sys.argv[1:]
if len(args) == 3 and args[:2] == ["is-active", "--quiet"]:
    service = args[2]
    count = state["active"].get(service, 0) + 1
    state["active"][service] = count
    state_path.write_text(json.dumps(state))
    if mode == "inactive_after_first_pass" and service == "baci-event-delivery-worker" and count > 1:
        raise SystemExit(3)
    raise SystemExit(0)
if len(args) == 4 and args[:3] == ["show", "--property=MainPID", "--value"]:
    service = args[3]
    count = state["show"].get(service, 0) + 1
    state["show"][service] = count
    state_path.write_text(json.dumps(state))
    pid = 10000 + list((
        "baci-domain-event-router", "baci-event-delivery-worker", "baci-quiz-finalization"
    )).index(service)
    if mode == "restarted_after_first_pass" and service == "baci-event-delivery-worker" and count > 1:
        pid += 100
    print(pid)
    raise SystemExit(0)
raise SystemExit(64)
'''


class WorkerHealthCheckTests(unittest.TestCase):
    def run_check(self, mode: str):
        temporary = tempfile.TemporaryDirectory(prefix="worker-health-")
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        release = root / "releases" / SHA
        release.mkdir(parents=True)
        (root / "current").symlink_to(f"releases/{SHA}")
        bin_dir = root / "bin"
        bin_dir.mkdir()
        fake_systemctl = bin_dir / "systemctl"
        fake_systemctl.write_text(FAKE_SYSTEMCTL, encoding="utf-8")
        fake_systemctl.chmod(0o755)
        script = root / "worker-release-health-check"
        source = SCRIPT.read_text(encoding="utf-8")
        source = source.replace("readonly root='/srv/baci-workers'", f"readonly root='{root}'")
        source = source.replace("/usr/bin/systemctl", str(fake_systemctl))
        source = source.replace("readonly stability_seconds=5", "readonly stability_seconds=2")
        script.write_text(source, encoding="utf-8")
        script.chmod(0o755)
        state_path = root / "systemctl-state.json"
        result = subprocess.run(
            [str(script), SHA],
            check=False,
            capture_output=True,
            text=True,
            timeout=10,
            env={
                **os.environ,
                "FAKE_SYSTEMCTL_MODE": mode,
                "FAKE_SYSTEMCTL_STATE": str(state_path),
            },
        )
        state = json.loads(state_path.read_text(encoding="utf-8")) if state_path.exists() else {}
        return result, state

    def test_requires_active_processes_to_stay_active_for_the_window(self):
        result, state = self.run_check("inactive_after_first_pass")

        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(state["active"]["baci-event-delivery-worker"], 2)

    def test_rejects_process_restart_even_when_unit_is_active_again(self):
        result, state = self.run_check("restarted_after_first_pass")

        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(state["show"]["baci-event-delivery-worker"], 2)

    def test_accepts_all_fixed_processes_when_stable(self):
        result, state = self.run_check("stable")

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(all(state["active"][service] == 3 for service in SERVICES))
        self.assertTrue(all(state["show"][service] == 3 for service in SERVICES))


if __name__ == "__main__":
    unittest.main()
