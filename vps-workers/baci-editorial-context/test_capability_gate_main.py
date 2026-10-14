"""Gate main() tests (stdlib only, no writer checkout needed).

Split from test_capability_gate.py to hold the 300-line limit: process
entry, checkout selection, and fail-closed paths live here.
"""
import datetime as dt
import importlib.util
import json
import os
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


if __name__ == "__main__":
    unittest.main()
