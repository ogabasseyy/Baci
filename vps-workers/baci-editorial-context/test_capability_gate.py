"""Gate tests (stdlib only, no writer checkout needed).

Register/evidence binding coverage lives in test_capability_register_binding.py
so neither module exceeds the 300-line limit.
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


class CapabilityGateTests(unittest.TestCase):
    def test_gate_decision_fails_closed(self):
        register = {"capabilities": [{"source_refs": ["apps/web/src/lib/feeds.ts"]}]}
        self.assertTrue(gate.should_run("base", register, None), "unknown change set must run the suite")
        self.assertFalse(gate.should_run("base", register, {"docs/other.md"}))
        self.assertFalse(gate.should_run("base", {}, {"docs/other.md"}), "structurally invalid register must not crash the gate")
        self.assertTrue(gate.should_run("base", {}, {"docs/product/baci-capabilities.json"}))
        self.assertTrue(gate.should_run("base", register, {"apps/web/src/lib/feeds.ts"}))
        self.assertTrue(gate.should_run("base", register, {"vps-workers/baci-editorial-context/README.md"}))
        with tempfile.TemporaryDirectory() as root:
            repo = Path(root)
            subprocess.run(["git", "-C", str(repo), "init", "-q", "."], check=True, capture_output=True)
            self.assertIsNone(gate.changed_paths("f" * 40, cwd=repo), "unresolvable base must yield unknown, not empty")
        with tempfile.TemporaryDirectory() as root:
            repo = Path(root)

            def git(*args):
                subprocess.run(["git", "-C", str(repo), "-c", "user.email=t@example.com", "-c", "user.name=t", *args], check=True, capture_output=True)

            git("init", "-q", ".")
            (repo / "cited.ts").write_text("export {};\n")
            git("add", ".")
            git("commit", "-q", "-m", "one")
            base = subprocess.run(["git", "-C", str(repo), "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
            git("mv", "cited.ts", "renamed.ts")
            git("commit", "-q", "-m", "rename")
            changed = gate.changed_paths(base, cwd=repo)
            self.assertIn("cited.ts", changed, "rename source path must stay visible to the gate")
            self.assertIn("renamed.ts", changed)
            citing = {"capabilities": [{"source_refs": ["cited.ts"]}]}
            self.assertTrue(gate.should_run(base, citing, changed), "renaming a cited source must run the suite")
        with tempfile.TemporaryDirectory() as root:
            repo = Path(root)
            (repo / "docs/product").mkdir(parents=True)
            (repo / "docs/product/agent-access-map.md").write_text("See `apps/web/src/lib/agentic/` for tools.")
            previous = os.getcwd()
            os.chdir(repo)
            try:
                citing = {"capabilities": [{"source_refs": ["cited.ts"]}]}
                self.assertTrue(
                    gate.should_run("base", citing, {"apps/web/src/lib/agentic/new-route.ts"}),
                    "a new file under a map-cited directory must run the suite",
                )
                self.assertFalse(gate.should_run("base", citing, {"apps/web/src/lib/other.ts"}))
            finally:
                os.chdir(previous)

    def test_freshness_scoping(self):
        now = dt.datetime.now(dt.timezone.utc).isoformat()
        fresh = {"reviewed_at": now, "capabilities": [
            {"status": "code_evidenced", "source_refs": ["apps/web/src/lib/feeds.ts"]},
            {"status": "unverified", "source_refs": ["apps/web/src/app/(platform)/pricing/page.tsx"]},
        ]}
        stale = {**fresh, "reviewed_at": "2020-01-01T00:00:00Z"}
        naive = {**fresh, "reviewed_at": "2026-10-14T07:27:04"}
        self.assertTrue(gate._register_stale(naive), "naive reviewed_at must stale like the runtime rejects it")
        bound_change = {"apps/web/src/lib/feeds.ts"}
        future = {**fresh, "reviewed_at": (dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=1)).isoformat()}
        self.assertTrue(gate._register_stale(future), "future-dated register must stale like the runtime rejects it")
        self.assertTrue(gate.freshness_required(future, bound_change))
        self.assertFalse(gate.freshness_required(fresh, bound_change))
        self.assertTrue(gate.freshness_required(stale, bound_change), "re-digesting must not bypass a stale register")
        self.assertTrue(gate.freshness_required(fresh, {"docs/product/baci-capabilities.json"}))
        self.assertTrue(gate.freshness_required(fresh, {"apps/web/src/app/(platform)/pricing/page.tsx"}))
        self.assertTrue(gate.freshness_required(fresh, None))
        self.assertTrue(gate.freshness_required(None, bound_change))

    def test_comparison_base_uses_merge_base_for_prs(self):
        with tempfile.TemporaryDirectory() as root:
            repo = Path(root)

            def git(*args):
                subprocess.run(["git", "-C", str(repo), "-c", "user.email=t@example.com", "-c", "user.name=t", *args], check=True, capture_output=True)

            git("init", "-q", ".")
            (repo / "docs/product").mkdir(parents=True)
            (repo / "docs/product/baci-capabilities.json").write_text(json.dumps({"reviewed_at": "2026-10-01T00:00:00Z"}))
            git("add", ".")
            git("commit", "-q", "-m", "one")
            # Branch name is only reliable once HEAD is born.
            trunk = subprocess.run(["git", "-C", str(repo), "rev-parse", "--abbrev-ref", "HEAD"], capture_output=True, text=True).stdout.strip()
            fork = subprocess.run(["git", "-C", str(repo), "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
            git("checkout", "-q", "-b", "feature")
            (repo / "docs/product/baci-capabilities.json").write_text(json.dumps({"reviewed_at": "2026-10-05T00:00:00Z"}))
            git("commit", "-q", "-am", "pr re-review")
            feature_tip = subprocess.run(["git", "-C", str(repo), "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
            git("checkout", "-q", trunk)
            (repo / "docs/product/baci-capabilities.json").write_text(json.dumps({"reviewed_at": "2026-10-10T00:00:00Z"}))
            git("commit", "-q", "-am", "main advances register")
            tip = subprocess.run(["git", "-C", str(repo), "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
            git("checkout", "-q", "feature")
            previous = os.getcwd()
            os.chdir(repo)
            try:
                with patch.dict(os.environ, {}, clear=False):
                    os.environ.pop("GITHUB_EVENT_NAME", None)
                    # PR baseline is the fork point, not the advanced tip.
                    self.assertEqual(gate._comparison_base(tip, cwd=repo), fork)
                    self.assertEqual(gate._base_register(gate._comparison_base(tip, cwd=repo), cwd=repo)["reviewed_at"], "2026-10-01T00:00:00Z")
                    with patch.dict(os.environ, {"GITHUB_EVENT_NAME": "push"}):
                        self.assertEqual(gate._comparison_base(tip, cwd=repo), tip)
                # Replacement revisions need continuity, not mere existence.
                self.assertTrue(gate._replacement_revision_ok(feature_tip, fork, cwd=repo))
                self.assertFalse(gate._replacement_revision_ok(fork, feature_tip, cwd=repo))
                self.assertFalse(gate._replacement_revision_ok("f" * 40, fork, cwd=repo))
                self.assertFalse(gate._replacement_revision_ok(feature_tip, "f" * 40, cwd=repo))
            finally:
                os.chdir(previous)
            # Synthetic PR merge commit (parents: tip, feature): the baseline
            # must be the fork point, not the already-advanced base tip.
            git("checkout", "-q", tip)
            git("merge", "-q", "--no-ff", "-X", "ours", "-m", "synthetic pr merge", "feature")
            previous = os.getcwd()
            os.chdir(repo)
            try:
                with patch.dict(os.environ, {}, clear=False):
                    os.environ.pop("GITHUB_EVENT_NAME", None)
                    self.assertEqual(gate._comparison_base(tip, cwd=repo), fork)
            finally:
                os.chdir(previous)

    def test_map_link_targets_parse_balanced_parentheses(self):
        text = "See [Public features](../../apps/web/src/app/(platform)/features/page.tsx) and [map](other.md)."
        targets = gate.map_link_targets(text)
        self.assertIn("apps/web/src/app/(platform)/features/page.tsx", targets)
        self.assertNotIn("apps/web/src/app/(platform", targets)
        self.assertIn("docs/product/other.md", targets)
        self.assertEqual(gate.map_link_targets("See [x](https://example.com/a_(b)) and [y](#frag)."), set())

    def test_requires_register_update(self):
        now = dt.datetime.now(dt.timezone.utc)
        fresh = {"reviewed_at": now.isoformat(), "source_revision": "a" * 40, "capabilities": [
            {"status": "code_evidenced", "source_refs": ["apps/web/src/lib/feeds.ts"]},
            {"status": "unverified", "source_refs": ["apps/web/src/app/(platform)/pricing/page.tsx"]},
        ]}
        stale = {**fresh, "reviewed_at": "2020-01-01T00:00:00Z"}
        base = {**fresh, "reviewed_at": (now - dt.timedelta(days=1)).isoformat(), "source_revision": "b" * 40}
        rereviewed = {**fresh}  # now: fresh and advanced past base, not future-dated
        unverified_change = {"apps/web/src/app/(platform)/pricing/page.tsx"}
        touched = unverified_change | {gate.REGISTER_PATH}
        # Fresh register + unverified source changed + register untouched: re-review required.
        self.assertTrue(gate.requires_register_update(fresh, unverified_change))
        # Whitespace-only register touch (reviewed_at not advanced): still required.
        same_date = {**fresh, "reviewed_at": base["reviewed_at"]}
        self.assertTrue(gate.requires_register_update(same_date, touched, base))
        # Genuine re-review (reviewed_at advanced past base): accepted.
        self.assertFalse(gate.requires_register_update(rereviewed, touched, base))
        # Reference removed at head while its unverified file changed, same date: still required.
        dropped = {"reviewed_at": base["reviewed_at"], "source_revision": "a" * 40, "capabilities": [
            {"status": "code_evidenced", "source_refs": ["apps/web/src/lib/feeds.ts"]},
        ]}
        self.assertTrue(gate.requires_register_update(dropped, touched, base))
        # Same removal with an advanced re-review: accepted.
        dropped_reviewed = {**dropped, "reviewed_at": rereviewed["reviewed_at"]}
        self.assertFalse(gate.requires_register_update(dropped_reviewed, touched, base))
        # Content-bound change with a redigest but no date advance: still required.
        coded_change = {"apps/web/src/lib/feeds.ts"}
        self.assertTrue(gate.requires_register_update(fresh, coded_change))
        redigest = coded_change | {gate.REGISTER_PATH}
        self.assertTrue(gate.requires_register_update(same_date, redigest, base))
        self.assertFalse(gate.requires_register_update(rereviewed, redigest, base))
        # Date advanced but old revision carried forward: still required.
        carried = {**rereviewed, "source_revision": base["source_revision"]}
        self.assertTrue(gate.requires_register_update(carried, touched, base))
        # New but rejected replacement revision: still required; accepted: clear.
        ghost = {**rereviewed, "source_revision": "f" * 40}
        self.assertTrue(gate.requires_register_update(ghost, touched, base, rev_acceptable=lambda new, old: False))
        self.assertFalse(gate.requires_register_update(ghost, touched, base, rev_acceptable=lambda new, old: True))
        # Base register unloadable: the path touch is the only signal, accepted.
        self.assertFalse(gate.requires_register_update(fresh, touched, None))
        self.assertFalse(gate.requires_register_update(fresh, touched))
        # Unrelated change: no re-review.
        self.assertFalse(gate.requires_register_update(fresh, {"apps/web/src/lib/other.ts"}, base))
        # Stale register: the freshness hard gate (not this rule) owns the failure.
        self.assertFalse(gate.requires_register_update(stale, unverified_change, base))
        # Unknown inputs: fail closed elsewhere, nothing to enforce here.
        self.assertFalse(gate.requires_register_update(fresh, None, base))
        self.assertFalse(gate.requires_register_update(None, unverified_change, base))

    def test_main_without_base_runs_suite_for_dispatch(self):
        with patch.object(gate.subprocess, "run") as suite:
            suite.return_value.returncode = 0
            with patch.dict(os.environ, {}, clear=False):
                os.environ.pop("BASE_SHA", None)
                self.assertEqual(gate.main(), 0)
            suite.assert_called_once()

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
