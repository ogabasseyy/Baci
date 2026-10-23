"""Real-Git regressions for a retained branch after squash merge."""
import datetime as dt
import os
import importlib.util
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("capability_gate", Path(__file__).with_name("capability_gate.py"))
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)


class SquashContinuityTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.repo = Path(self.tmp.name)
        self.git("init", "-q", "-b", "main")
        self.write("anchor.txt", "root")
        self.commit("root")
        self.git("checkout", "-q", "-b", "retained-source")
        self.write("apps/evidence.txt", "reviewed")
        self.write("apps/unverified.txt", "not established")
        self.write("apps/directory/one.txt", "one")
        self.write("apps/map-only.txt", "map source")
        self.old = self.commit("reviewed feature")
        self.git("checkout", "-q", "main")
        self.write("apps/evidence.txt", "reviewed")
        self.write("apps/unverified.txt", "not established")
        self.write("apps/directory/one.txt", "one")
        self.write("apps/map-only.txt", "map source")
        self.register = {"reviewed_at": (dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=1)).isoformat(), "source_revision": self.old, "capabilities": [
            {"status": "code_evidenced", "source_refs": ["apps/evidence.txt", "apps/directory/"]},
            {"status": "unverified", "source_refs": ["apps/unverified.txt"]},
        ]}
        self.write(gate.REGISTER_PATH, json.dumps(self.register))
        self.write(gate.MAP_PATH, "See `apps/map-only.txt` and [register](baci-capabilities.json).")
        self.base = self.commit("squashed feature plus review metadata")
        self.write("apps/evidence.txt", "new review")
        self.new = self.commit("next reviewed feature")

    def git(self, *args):
        return subprocess.check_output(["git", "-C", str(self.repo), "-c", "user.name=Test", "-c", "user.email=test@example.com", *args], stderr=subprocess.DEVNULL).decode().strip()

    def write(self, path, content):
        target = self.repo / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content)

    def commit(self, message):
        self.git("add", ".")
        self.git("commit", "-q", "-m", message)
        return self.git("rev-parse", "HEAD")

    def accepted(self, new=None, base=None, register=None):
        return gate._replacement_revision_ok(new or self.new, self.old, cwd=self.repo,
            base=base or self.base, base_register=register if register is not None else self.register)

    def changed_base(self, path, content):
        self.git("checkout", "-q", "main")
        self.write(path, content)
        base = self.commit("base evidence changed")
        self.write("candidate.txt", "new")
        new = self.commit("new descendant")
        return new, base

    def test_retained_squash_source_with_equivalent_evidence_passes(self):
        self.assertFalse(gate._replacement_revision_ok(self.new, self.old, cwd=self.repo))
        self.assertTrue(self.accepted())

    def test_matching_tree_on_unrelated_revision_is_rejected(self):
        self.git("checkout", "-q", "--orphan", "unrelated")
        unrelated = self.commit("same evidence without reviewed ancestry")
        self.assertFalse(self.accepted(new=unrelated))

    def test_changed_verified_unverified_and_map_evidence_is_rejected(self):
        for path in ("apps/evidence.txt", "apps/unverified.txt", "apps/map-only.txt"):
            with self.subTest(path=path):
                new, base = self.changed_base(path, "changed")
                self.assertFalse(self.accepted(new=new, base=base))
                self.git("reset", "--hard", self.base)

    def test_directory_addition_deletion_rename_and_mode_change_are_rejected(self):
        for operation in ("addition", "deletion", "rename", "mode"):
            with self.subTest(operation=operation):
                self.git("checkout", "-q", "main")
                self.git("reset", "--hard", self.base)
                if operation == "addition":
                    self.write("apps/directory/two.txt", "two")
                elif operation == "deletion":
                    self.git("rm", "apps/directory/one.txt")
                elif operation == "rename":
                    self.git("mv", "apps/directory/one.txt", "apps/directory/two.txt")
                else:
                    (self.repo / "apps/directory/one.txt").chmod(0o755)
                base = self.commit(operation)
                self.write("candidate.txt", operation)
                new = self.commit("new descendant")
                self.assertFalse(self.accepted(new=new, base=base))

    def test_missing_empty_malformed_or_wrong_baseline_evidence_is_rejected(self):
        for refs in ([], [""], ["../escape"], [":(glob)apps/*"], ["apps/missing.txt"]):
            with self.subTest(refs=refs):
                register = {"source_revision": self.old, "capabilities": [{"source_refs": refs}]}
                self.assertFalse(self.accepted(register=register))
        self.assertFalse(self.accepted(register={**self.register, "source_revision": "f" * 40}))
        self.assertFalse(self.accepted(base="f" * 40))

    def test_unresolved_map_filename_is_rejected(self):
        new, base = self.changed_base(gate.MAP_PATH, "See `not-present.ts`.")
        self.assertFalse(self.accepted(new=new, base=base))

    def test_map_bare_filename_covers_all_matching_sources(self):
        self.git("checkout", "-q", "main")
        self.write(gate.MAP_PATH, "See `map-only.txt`.")
        self.write("other/map-only.txt", "extra")
        base = self.commit("new same-name source")
        self.write("candidate.txt", "new")
        new = self.commit("candidate")
        self.assertFalse(self.accepted(new=new, base=base))

    def test_git_failure_fails_closed(self):
        self.assertFalse(gate._replacement_revision_ok(self.new, self.old,
            cwd=self.repo / "missing", base=self.base, base_register=self.register))

    def test_main_supplies_trusted_base_and_runs_suite_after_continuity_proof(self):
        reviewed = {**self.register, "reviewed_at": dt.datetime.now(dt.timezone.utc).isoformat(), "source_revision": self.new}
        self.write(gate.REGISTER_PATH, json.dumps(reviewed))
        self.commit("record re-review of candidate")
        real_run = subprocess.run
        suite_calls = []

        def run(command, **kwargs):
            if command[0] == "git":
                return real_run(command, **kwargs)
            suite_calls.append(command)
            return subprocess.CompletedProcess(command, 0)

        with patch.dict(os.environ, {"BASE_SHA": self.base, "GITHUB_EVENT_NAME": "pull_request"}):
            with patch.object(gate.subprocess, "run", side_effect=run):
                self.assertEqual(gate.main(cwd=self.repo), 0)
        self.assertEqual(len(suite_calls), 1)

    def test_ancestry_error_is_not_treated_as_proven_non_ancestry(self):
        with patch.object(gate._revision_module, "_ancestor", side_effect=[1, 0, 128]):
            self.assertFalse(self.accepted())
