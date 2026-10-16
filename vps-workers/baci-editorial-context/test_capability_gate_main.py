"""Gate main() tests (stdlib only, no writer checkout needed).

Split from test_capability_gate.py to hold the 300-line limit: process
entry, checkout selection, and fail-closed paths live here.
"""
import datetime as dt
import importlib.util
import json
import os
import re
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

_gate_spec = importlib.util.spec_from_file_location(
    "capability_gate", Path(__file__).parent / "capability_gate.py"
)
gate = importlib.util.module_from_spec(_gate_spec)
_gate_spec.loader.exec_module(gate)


class CapabilityGateMainTests(unittest.TestCase):
    def test_main_without_base_runs_suite_for_dispatch(self):
        with patch.object(gate.subprocess, "run") as suite:
            suite.return_value.returncode = 0
            with patch.dict(os.environ, {}, clear=False):
                os.environ.pop("BASE_SHA", None)
                self.assertEqual(gate.main(), 0)
            suite.assert_called_once()

    def test_main_runs_suite_in_target_checkout(self):
        with tempfile.TemporaryDirectory() as root:
            with patch.object(gate.subprocess, "run") as suite:
                suite.return_value.returncode = 0
                with patch.dict(os.environ, {}, clear=False):
                    os.environ.pop("BASE_SHA", None)
                    self.assertEqual(gate.main(cwd=root), 0)
                suite.assert_called_once()
                self.assertEqual(suite.call_args.kwargs.get("cwd"), root)

    def test_main_resolves_relative_checkout_once(self):
        with tempfile.TemporaryDirectory() as parent:
            repo = Path(parent, "checkout")
            repo.mkdir()
            previous = os.getcwd()
            os.chdir(parent)
            try:
                with patch.object(gate.subprocess, "run") as suite:
                    suite.return_value.returncode = 0
                    with patch.dict(os.environ, {}, clear=False):
                        os.environ.pop("BASE_SHA", None)
                        self.assertEqual(gate.main(cwd="checkout"), 0)
                    suite.assert_called_once()
                    child_cwd = suite.call_args.kwargs.get("cwd")
                    # realpath: macOS symlinks /var into /private/var.
                    self.assertEqual(os.path.realpath(child_cwd), os.path.realpath(str(repo)))
                    suite_dir = suite.call_args.args[0]
                    self.assertTrue(
                        any(str(repo) in str(arg) and "checkout/checkout" not in str(arg) for arg in suite_dir),
                        f"suite path must not double the checkout: {suite_dir}",
                    )
            finally:
                os.chdir(previous)

    def test_main_operates_on_explicit_cwd(self):
        with tempfile.TemporaryDirectory() as root:
            repo = Path(root)

            def git(*args):
                subprocess.run(["git", "-C", str(repo), "-c", "user.email=t@example.com", "-c", "user.name=t", *args], check=True, capture_output=True)

            git("init", "-q", ".")
            now = dt.datetime.now(dt.timezone.utc).isoformat()
            (repo / "docs/product").mkdir(parents=True)
            (repo / "docs/product/baci-capabilities.json").write_text(json.dumps({"reviewed_at": now, "capabilities": []}))
            git("add", ".")
            git("commit", "-q", "-m", "one")
            base = subprocess.run(["git", "-C", str(repo), "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
            # No chdir: an empty diff against the fixture checkout must skip.
            with patch.dict(os.environ, {"BASE_SHA": base, "GITHUB_EVENT_NAME": "pull_request"}):
                self.assertEqual(gate.main(cwd=str(repo)), 0)

    def test_main_fails_when_changed_set_unknowable(self):
        now = dt.datetime.now(dt.timezone.utc).isoformat()
        register = {"reviewed_at": now, "capabilities": [
            {"status": "unverified", "source_refs": ["apps/web/src/app/(platform)/pricing/page.tsx"]},
        ]}
        with tempfile.TemporaryDirectory() as root:
            repo = Path(root)
            (repo / "docs/product").mkdir(parents=True)
            (repo / "docs/product/baci-capabilities.json").write_text(json.dumps(register))
            previous = os.getcwd()
            os.chdir(repo)
            try:
                with patch.object(gate, "changed_paths", return_value=None):
                    with patch.object(gate.subprocess, "run", side_effect=AssertionError("suite must not run")):
                        with patch.dict(os.environ, {"BASE_SHA": "b" * 40}):
                            self.assertEqual(gate.main(), 1)
            finally:
                os.chdir(previous)

    def test_main_rejects_unverified_change_without_register_update(self):
        now = dt.datetime.now(dt.timezone.utc).isoformat()
        register = {"reviewed_at": now, "capabilities": [
            {"status": "unverified", "source_refs": ["apps/web/src/app/(platform)/pricing/page.tsx"]},
        ]}
        with tempfile.TemporaryDirectory() as root:
            repo = Path(root)
            (repo / "docs/product").mkdir(parents=True)
            (repo / "docs/product/baci-capabilities.json").write_text(json.dumps(register))
            previous = os.getcwd()
            os.chdir(repo)
            try:
                with patch.object(gate, "changed_paths", return_value={"apps/web/src/app/(platform)/pricing/page.tsx"}):
                    with patch.object(gate, "_base_register", return_value=None):
                        with patch.object(gate.subprocess, "run", side_effect=AssertionError("suite must not run")):
                            with patch.dict(os.environ, {"BASE_SHA": "b" * 40, "BACI_REGISTER_REQUIRE_FRESH": "1"}):
                                self.assertEqual(gate.main(), 1)
            finally:
                os.chdir(previous)

    def test_main_rejects_whitespace_only_register_touch(self):
        reviewed = dt.datetime.now(dt.timezone.utc).isoformat()
        capabilities = [{"status": "unverified", "source_refs": ["apps/web/src/app/(platform)/pricing/page.tsx"]}]
        base_register = {"reviewed_at": reviewed, "capabilities": capabilities}
        head_register = {"reviewed_at": reviewed, "capabilities": capabilities}
        changed = {"apps/web/src/app/(platform)/pricing/page.tsx", gate.REGISTER_PATH}
        with tempfile.TemporaryDirectory() as root:
            repo = Path(root)
            (repo / "docs/product").mkdir(parents=True)
            (repo / "docs/product/baci-capabilities.json").write_text(json.dumps(head_register))
            previous = os.getcwd()
            os.chdir(repo)
            try:
                with patch.object(gate, "changed_paths", return_value=changed):
                    with patch.object(gate, "_base_register", return_value=base_register):
                        with patch.object(gate.subprocess, "run", side_effect=AssertionError("suite must not run")):
                            with patch.dict(os.environ, {"BASE_SHA": "b" * 40}):
                                self.assertEqual(gate.main(), 1)
            finally:
                os.chdir(previous)

    def test_ci_invokes_capability_gate_unconditionally(self):
        # The gate cannot notice its own caller changing: if ci.yml drops or
        # conditions the invocation, cited-source changes bypass re-review.
        # Lives here (not in the register pattern) so the scheduled
        # freshness job only runs register-scoped tests.
        repo = Path(__file__).resolve().parents[2]
        workflow = repo / ".github/workflows/ci.yml"
        action = repo / ".github/actions/capability-gate/action.yml"
        if not workflow.exists() or not action.exists():
            self.skipTest("CI workflow or gate action unavailable")
        lines = workflow.read_text().splitlines()
        starts = [i for i, line in enumerate(lines) if line.strip() == "- name: Test capability register binding"]
        self.assertEqual(len(starts), 1, "ci.yml must invoke the capability gate exactly once")
        self.assertEqual(lines[starts[0]], "      - name: Test capability register binding")
        headers = [i for i, line in enumerate(lines) if re.match(r"^  [A-Za-z0-9_.\-]+:", line)]
        job_start = max(i for i in headers if i < starts[0])
        later = [i for i in headers if i > starts[0]]
        job = lines[job_start : later[0] if later else len(lines)]
        self.assertFalse(
            any(re.match(r"^    (if|needs):", line) for line in job),
            "gate job must stay unconditional (no job-level if:/needs:)",
        )
        step = []
        for line in lines[starts[0] + 1:]:
            if re.match(r"^      - ", line):
                break
            if line.strip() and not line.strip().startswith("#"):
                step.append(line)
        self.assertEqual(step, ["        uses: ./.github/actions/capability-gate"])

    def test_freshness_probe_falls_back_to_broken(self):
        # If register_status.py itself errors, the probe must still emit a
        # routable status instead of an empty one that files no issue.
        # Lives here (not in the register pattern) so the scheduled
        # freshness job only runs register-scoped tests.
        repo = Path(__file__).resolve().parents[2]
        workflow = repo / ".github/workflows/capability-register-freshness.yml"
        if not workflow.exists():
            self.skipTest("freshness workflow unavailable")
        text = workflow.read_text()
        probe = [line for line in text.splitlines() if "register_status.py" in line]
        self.assertEqual(len(probe), 1, "probe must invoke register_status.py exactly once")
        self.assertIn("|| echo broken", probe[0])
        # A multi-line capture would write a bare second line that matches
        # no routing step, so the value must be sanitized before writing.
        self.assertIn('case "$status" in fresh|stale|broken)', text)
        self.assertIn('echo "status=$status" >> "$GITHUB_OUTPUT"', text)


if __name__ == "__main__":
    unittest.main()
