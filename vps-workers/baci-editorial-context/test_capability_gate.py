"""Gate and register-binding tests (stdlib only, no writer checkout needed)."""
import datetime as dt
import hashlib
import importlib.util
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

_spec = importlib.util.spec_from_file_location(
    "platform_capabilities", Path(__file__).parent / "platform_capabilities.py"
)
_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mod)
capability_context = _mod.capability_context

_gate_spec = importlib.util.spec_from_file_location(
    "capability_gate", Path(__file__).parent / "capability_gate.py"
)
gate = importlib.util.module_from_spec(_gate_spec)
_gate_spec.loader.exec_module(gate)


def evidence_digest_for(repo, data):
    """Content digest over cited paths, their contents, and the claim text.

    Refs of `unverified` rows are existence-checked but not content-bound:
    those claims record that a capability is not established, so unrelated
    edits to the audited surfaces must not force a full re-review.
    """
    refs = sorted({ref for row in data["capabilities"] if row.get("status") != "unverified" for ref in row["source_refs"]})
    digest = hashlib.sha256()
    for ref in refs:
        digest.update(ref.encode())
        digest.update(b"\0")
        digest.update(hashlib.sha256((Path(repo) / ref).read_bytes()).hexdigest().encode())
        digest.update(b"\n")
    digest.update(json.dumps(data["capabilities"], sort_keys=True).encode())
    digest.update(str(data.get("reviewed_at", "")).encode())
    digest.update(str(data.get("source_revision", "")).encode())
    return digest.hexdigest()


def binding_failures(repo, data):
    """Return binding failure strings for a register dict (empty = bound)."""
    failures = []
    refs = sorted({ref for row in data["capabilities"] for ref in row["source_refs"]})
    repo_root = str(Path(repo).resolve())
    for ref in refs:
        resolved = (Path(repo) / ref).resolve()
        if not str(resolved).startswith(repo_root + os.sep):
            failures.append(f"cited source escapes repo: {ref}")
        elif not resolved.exists():
            failures.append(f"cited source missing: {ref}")
        else:
            tracked = subprocess.run(
                ["git", "-C", str(repo), "ls-files", "--error-unmatch", "--", ref],
                capture_output=True, text=True,
            )
            if tracked.returncode != 0:
                failures.append(f"cited source is not tracked: {ref}")
    if not failures:
        expected = data.get("evidence_digest")
        if not isinstance(expected, str) or evidence_digest_for(repo, data) != expected:
            failures.append("cited evidence or claim text changed since review; re-review the claims and update evidence_digest")
    return failures


class CapabilityGateTests(unittest.TestCase):
    def test_register_binding_matches_shipped_tree(self):
        repo = Path(__file__).resolve().parents[2]
        register_path = repo / "docs/product/baci-capabilities.json"
        if not (repo / ".git").exists():
            self.skipTest("repo checkout unavailable")
        self.assertTrue(register_path.exists(), "committed capability register is missing; restore it or re-review")
        data = json.loads(register_path.read_text())
        reviewed = dt.datetime.fromisoformat(data["reviewed_at"].replace("Z", "+00:00"))
        age = dt.datetime.now(dt.timezone.utc) - reviewed
        self.assertGreaterEqual(age, dt.timedelta(0), "register reviewed_at is future-dated; runtime would reject it")
        stale = age > dt.timedelta(days=14)
        if not stale:
            # Freshness and runtime acceptance are only asserted inside the
            # evidence window; structural binding below is always enforced.
            with patch.dict(os.environ, {"BACI_CAPABILITY_REGISTER_PATH": str(register_path), "BACI_CAPABILITY_REGISTER_DIGEST": data["evidence_digest"]}):
                rendered = capability_context()
            self.assertIn("<capability-register-json untrusted-evidence-data>", rendered)
            self.assertNotIn("Register unavailable", rendered)
        if stale and os.environ.get("BACI_REGISTER_REQUIRE_FRESH"):
            self.fail("register outside its 14-day evidence window; owner re-review required")
        self.assertEqual(binding_failures(repo, data), [])

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

    def test_binding_failures_are_detected_in_fixture_repo(self):
        def git(repo, *args):
            subprocess.run(
                ["git", "-C", str(repo), "-c", "user.email=t@example.com", "-c", "user.name=t", *args],
                check=True, capture_output=True, text=True,
            )

        with tempfile.TemporaryDirectory() as root:
            repo = Path(root)
            git(repo, "init", "-q", ".")
            (repo / "cited.txt").write_text("v1")
            git(repo, "add", ".")
            git(repo, "commit", "-q", "-m", "one")
            refs = ["cited.txt"]
            data = {"capabilities": [{"source_refs": refs}]}
            data["evidence_digest"] = evidence_digest_for(repo, data)
            self.assertEqual(binding_failures(repo, data), [])
            (repo / "cited.txt").write_text("v2")
            self.assertTrue(binding_failures(repo, data), "changed cited content must fail the digest binding")
            self.assertTrue(binding_failures(repo, {"capabilities": [{"source_refs": ["missing.txt"]}], "evidence_digest": "x"}), "missing cited source must fail")
            self.assertTrue(binding_failures(repo, {"capabilities": [{"source_refs": ["../escape.txt"]}], "evidence_digest": "x"}), "escaping cited source must fail")


if __name__ == "__main__":
    unittest.main()
